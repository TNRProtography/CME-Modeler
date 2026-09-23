// NOAA active regions, for anything that wants to draw them on the Sun.
//
// The solar activity dashboard parses these too, from the TXT bulletin with
// the JSON as a supplement, because it needs flare probabilities and magnetic
// classes. Nothing that only wants to draw a dot needs any of that, and
// lifting three hundred lines out of that component to share it would be a
// bigger change than the drawing itself. This takes the JSON alone, which
// carries position and size and nothing else.
//
// Through the image proxy's data route: SWPC sends no CORS headers.

import { useEffect, useMemo, useState } from 'react';
import { longitudeAt } from '../utils/solarDisk';
import type { RegionInput } from '../utils/regionLabels';
import { fetchSharpByRegion, withSharpPosition } from '../utils/sharpPositions';

const SOURCE = 'https://services.swpc.noaa.gov/json/solar_regions.json';
const PROXY = '/api/proxy/data';
const PRODUCTION_PROXY = 'https://spottheaurora.co.nz/api/proxy/data';

/** Bigger spots get bigger markers; this is the area that counts as "big". */
const BIG_AREA_MSH = 500;

export interface SunspotRegion extends RegionInput {
  region: string;
  /** Millionths of a solar hemisphere. Null when NOAA did not report one. */
  areaMsh: number | null;
}

/**
 * Not Number() alone: Number(null) and Number('') are both 0, which is a
 * perfectly finite equator. A region with no reported position would be drawn
 * at 0,0 - dead centre of the disk, the most prominent place on the Sun.
 */
const num = (v: unknown): number | null =>
  (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

/**
 * Stonyhurst degrees from the report, west positive.
 *
 * The `location` string ("N12W34") is preferred because it is unambiguously
 * Stonyhurst - degrees from the central meridian, which is what placing a
 * marker on the visible disk needs. The bare `longitude` field is not always
 * that: SWPC also publishes Carrington longitude, which runs 0-360 and is
 * measured from a rotating prime meridian that has nothing to do with where
 * Earth is. Reading one as the other put every region past the limb, where
 * the Earth-facing filter then dropped it - which is why none appeared.
 *
 * So the numeric field is only trusted when it falls in the range a
 * Stonyhurst longitude can occupy.
 */
const parsePosition = (row: any): { latitude: number; longitude: number } | null => {
  const location = String(row?.location ?? row?.lat_long ?? row?.latLong ?? '').toUpperCase().replace(/\s+/g, '');
  const m = location.match(/([NS])(\d{1,2})([EW])(\d{1,3})/);
  if (m) {
    return {
      latitude: m[1] === 'N' ? Number(m[2]) : -Number(m[2]),
      longitude: m[3] === 'W' ? Number(m[4]) : -Number(m[4]),
    };
  }

  const latitude = num(row?.latitude ?? row?.lat);
  const longitude = num(row?.longitude ?? row?.lon);
  if (latitude === null || longitude === null) return null;
  if (Math.abs(latitude) > 90) return null;
  // Anything beyond a hemisphere is Carrington, not Stonyhurst, and there is
  // no way to convert it here without the Carrington longitude of the central
  // meridian. Better to draw nothing than to draw it in the wrong place.
  if (Math.abs(longitude) > 90) return null;
  return { latitude, longitude };
};

const parseObserved = (raw: any): number | null => {
  const value = raw?.observed_date ?? raw?.time_tag ?? raw?.date;
  if (!value) return null;
  // A bare date means midnight UT on that day, which is close enough for a
  // rotation rate of half a degree an hour.
  const ms = Date.parse(typeof value === 'string' && value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isFinite(ms) ? ms : null;
};

/**
 * The newest report for each region, filtered to the ones worth drawing.
 *
 * solar_regions.json is a history: the same region appears once per day for as
 * long as it lives. Drawing every row would stack a dozen markers of the same
 * spot along its own track across the disk.
 */
export function normaliseRegions(rows: any[], nowMs = Date.now()): SunspotRegion[] {
  const newest = new Map<string, any>();
  for (const row of rows) {
    const id = String(row?.region ?? '').trim();
    if (!id) continue;
    const at = parseObserved(row) ?? 0;
    const existing = newest.get(id);
    if (!existing || at > (parseObserved(existing) ?? 0)) newest.set(id, row);
  }

  const out: SunspotRegion[] = [];
  for (const [id, row] of newest) {
    const position = parsePosition(row);
    if (!position) continue;
    const { latitude, longitude } = position;

    const observedAtMs = parseObserved(row);
    // A report more than three days old is a region that has almost certainly
    // rotated off the visible disk, and carrying it forward would put a marker
    // on the far side of the Sun.
    if (observedAtMs != null && nowMs - observedAtMs > 3 * 86400000) continue;

    // Carried to now, because NOAA reports where it WAS and the Sun has turned
    // since - about half a degree an hour.
    const carried = observedAtMs != null ? longitudeAt(longitude, observedAtMs, nowMs) : longitude;
    if (Math.abs(carried) > 90) continue;   // round the back

    const areaRaw = Number(row?.area);
    const areaMsh = Number.isFinite(areaRaw) ? areaRaw : null;

    out.push({
      id,
      region: id,
      latitude,
      longitude,
      observedAtMs,
      areaMsh,
      magneticClass: row?.mag_class ?? row?.magnetic_class ?? null,
      spotCount: Number.isFinite(Number(row?.number_spots)) ? Number(row.number_spots) : null,
      area: areaMsh,
      // Warmer for the bigger ones, so size reads before the number does.
      color: (areaMsh ?? 0) >= BIG_AREA_MSH ? '#fb923c' : '#fbbf24',
    });
  }

  return out.sort((a, b) => (b.areaMsh ?? -1) - (a.areaMsh ?? -1));
}

/** How a region's spot count moved over the last day of NOAA reports. */
export interface SpotCountChange {
  now: number;
  before: number;
  delta: number;
  /** When each of the two counts was reported. */
  nowAtMs: number;
  beforeAtMs: number;
}

/**
 * Each region's spot count against its report a day earlier.
 *
 * solar_regions.json keeps a row per region per day, so the history is
 * already in the same download: the newest report, and the newest one at
 * least 20 hours older (the reports are daily, give or take). A region first
 * reported today has nothing to compare against and is left out rather than
 * shown as having grown from zero.
 */
export function spotCountChanges(rows: any[]): Record<string, SpotCountChange> {
  const byRegion = new Map<string, { at: number; spots: number }[]>();
  for (const row of rows) {
    const id = String(row?.region ?? '').trim();
    const at = parseObserved(row);
    const spots = num(row?.number_spots);
    if (!id || at == null || spots == null) continue;
    if (!byRegion.has(id)) byRegion.set(id, []);
    byRegion.get(id)!.push({ at, spots });
  }
  const out: Record<string, SpotCountChange> = {};
  for (const [id, list] of byRegion) {
    list.sort((a, b) => a.at - b.at);
    const latest = list[list.length - 1];
    const earlier = list.filter((x) => x.at <= latest.at - 20 * 3600000);
    const before = earlier[earlier.length - 1];
    if (!before) continue;
    out[id] = {
      now: latest.spots,
      before: before.spots,
      delta: latest.spots - before.spots,
      nowAtMs: latest.at,
      beforeAtMs: before.at,
    };
  }
  return out;
}

export function useSunspotRegions(enabled = true): {
  regions: SunspotRegion[];
  /** When NOAA measured the newest region in the set. */
  observedAtMs: number | null;
  /** Spot count against the day before, by region. */
  spotChanges: Record<string, SpotCountChange>;
  error: string | null;
} {
  const [regions, setRegions] = useState<SunspotRegion[]>([]);
  const [spotChanges, setSpotChanges] = useState<Record<string, SpotCountChange>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const load = async () => {
      for (const base of [PROXY, PRODUCTION_PROXY]) {
        try {
          const res = await fetch(`${base}?url=${encodeURIComponent(SOURCE)}&ttl=900`);
          if (!res.ok) continue;
          // The proxy answers with the SPA's index.html when it is not
          // deployed at this address, and that parses as neither JSON nor an
          // error - so the type is checked rather than assumed.
          if (!(res.headers.get('content-type') ?? '').includes('json')) continue;
          const rows = await res.json();
          if (cancelled) return;
          if (!Array.isArray(rows)) continue;
          // NOAA says which regions exist; HMI SHARPs say where they are now.
          const sharp = await fetchSharpByRegion();
          if (cancelled) return;
          setRegions(normaliseRegions(rows).map((r) => withSharpPosition(r, sharp, 'observedAtMs')));
          setSpotChanges(spotCountChanges(rows));
          setError(null);
          return;
        } catch {
          // Try the next route before giving up.
        }
      }
      if (!cancelled) setError('Could not load NOAA active regions.');
    };

    load();
    const id = setInterval(load, 30 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [enabled]);

  // The bulletin is daily, so how old it is matters: the Sun turns 13.2
  // degrees between issues, and a reader comparing markers against live
  // imagery deserves to know which of the two is behind.
  const observedAtMs = useMemo(() => {
    const times = regions.map((r) => r.observedAtMs).filter((t): t is number => t != null);
    return times.length ? Math.max(...times) : null;
  }, [regions]);

  return { regions, observedAtMs, spotChanges, error };
}
