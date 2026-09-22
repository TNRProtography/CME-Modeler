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

import { useEffect, useState } from 'react';
import { longitudeAt } from '../utils/solarDisk';
import type { RegionInput } from '../utils/regionLabels';

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
    // Not Number() alone: Number(null) and Number('') are both 0, which is a
    // perfectly finite equator. A region with no reported position would have
    // been drawn at 0,0 - dead centre of the disk, the most prominent place
    // on the Sun - rather than skipped.
    const num = (v: unknown): number | null =>
      (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
    const latitude = num(row?.latitude);
    const longitude = num(row?.longitude);
    if (latitude === null || longitude === null) continue;

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

export function useSunspotRegions(enabled = true): {
  regions: SunspotRegion[];
  error: string | null;
} {
  const [regions, setRegions] = useState<SunspotRegion[]>([]);
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
          setRegions(normaliseRegions(rows));
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

  return { regions, error };
}
