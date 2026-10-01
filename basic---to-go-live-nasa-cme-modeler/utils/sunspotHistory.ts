// Two weeks of every sunspot region, and every change in each one.
//
// The sunspot-history worker runs this every 15 minutes and keeps the result;
// the sunspot tracker reads it. The app used to rebuild each region from
// NOAA's daily bulletins on every visit, which only ever knew today and
// yesterday. This remembers.
//
// Three sources, each recording what it is good at:
//
//   - NOAA's Solar Region Summary (solar-regions.txt): which regions exist,
//     their McIntosh class, magnetic class, spot count, area and extent.
//     Issued once a day, positions valid at 2400Z.
//   - NOAA's region JSON (solar_regions.json): flare probabilities and the
//     day's flare counts.
//   - SDO/HMI SHARPs: magnetic flux and strong-field area, hourly. New flux
//     emerging is the thing that builds to a flare, and it shows here hours
//     before it shows in a spot count.
//   - Flares (DONKI) are logged against the region that produced them.
//
// A change is recorded with the time the source measured it (`atMs`) and the
// time the worker first saw it (`seenAtMs`). Nothing here touches the
// network, so it is tested on its own and shared by worker and app.

import { parseSrsValidTime, latestSrsEpoch } from './srsTime';
import { regionKey, type SharpHistoryPoint } from './sharpPositions';

export const HISTORY_DAYS = 14;
const DAY = 86400000;
/** A change in total flux this big, since the last one logged, is logged. */
export const FLUX_CHANGE_FRACTION = 0.1;

/** What NOAA says about a region at one moment. */
export interface RegionSnapshot {
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  carringtonLon: number | null;
  areaMsh: number | null;
  /** McIntosh class, e.g. "Dkc". */
  mcintosh: string | null;
  /** Longitudinal extent, degrees. */
  extentDeg: number | null;
  spotCount: number | null;
  /** Mount Wilson class, e.g. "Beta-Gamma-Delta". */
  magClass: string | null;
  cFlareProbability: number | null;
  mFlareProbability: number | null;
  xFlareProbability: number | null;
  protonProbability: number | null;
}

export type RegionField = keyof RegionSnapshot;

/** Fields whose change is a change in the region (position drifts every day). */
export const TRACKED_FIELDS: RegionField[] = [
  'areaMsh', 'mcintosh', 'extentDeg', 'spotCount', 'magClass',
  'cFlareProbability', 'mFlareProbability', 'xFlareProbability', 'protonProbability',
];

export type RegionEventKind = 'appeared' | 'changed' | 'flux' | 'flare' | 'gone' | 'returned';

export interface RegionEvent {
  kind: RegionEventKind;
  /** When the source measured it, UTC ms. */
  atMs: number;
  /** When the worker first saw it. */
  seenAtMs: number;
  source: 'srs' | 'noaa-json' | 'sharp' | 'donki';
  /** field -> [before, after]. */
  changes?: Record<string, [unknown, unknown]>;
  /** Where the region was when it happened. */
  location?: string | null;
  /** Flares: class and id. */
  flareClass?: string;
  flareId?: string;
  peakMs?: number;
}

export interface SharpPoint {
  atMs: number;
  usfluxMx: number;
  areaMh: number;
  latitude: number | null;
  longitude: number | null;
}

export interface RegionRecord {
  /** NOAA's four-digit number, as the SRS and everybody else writes it. */
  id: string;
  firstSeenMs: number;
  /** Newest NOAA report that listed it. */
  lastSeenMs: number;
  /** Still in NOAA's latest list. */
  active: boolean;
  current: RegionSnapshot;
  /** Oldest first. */
  events: RegionEvent[];
  /** Hourly, oldest first. */
  sharp: SharpPoint[];
  /** The flux the last flux event (or the first reading) was measured at. */
  fluxRefMx: number | null;
}

export interface SunspotHistoryState {
  version: 1;
  updatedMs: number;
  /** Validity time of the newest SRS applied, so a re-read bulletin is a no-op. */
  srsValidMs: number | null;
  regions: Record<string, RegionRecord>;
}

export const emptyState = (): SunspotHistoryState =>
  ({ version: 1, updatedMs: 0, srsValidMs: null, regions: {} });

// ── Parsing ────────────────────────────────────────────────────────────────

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(typeof v === 'string' ? v.replace(/[%,]/g, '').trim() : v);
  return Number.isFinite(n) ? n : null;
};

const MAG_NAMES: Record<string, string> = {
  A: 'Alpha', ALPHA: 'Alpha',
  B: 'Beta', BETA: 'Beta',
  G: 'Gamma', GAMMA: 'Gamma',
  BG: 'Beta-Gamma', BETAGAMMA: 'Beta-Gamma',
  BD: 'Beta-Delta', BETADELTA: 'Beta-Delta',
  BGD: 'Beta-Gamma-Delta', BETAGAMMADELTA: 'Beta-Gamma-Delta',
  GD: 'Gamma-Delta', GAMMADELTA: 'Gamma-Delta',
};
export const magClassName = (v: unknown): string | null => {
  const key = String(v ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  return key ? (MAG_NAMES[key] ?? String(v).trim()) : null;
};

export const parseLocation = (loc: unknown): { latitude: number; longitude: number } | null => {
  const m = String(loc ?? '').toUpperCase().replace(/\s+/g, '').match(/^([NS])(\d{1,2})([EW])(\d{1,3})$/);
  if (!m) return null;
  return {
    latitude: (m[1] === 'N' ? 1 : -1) * Number(m[2]),
    longitude: (m[3] === 'W' ? 1 : -1) * Number(m[4]),
  };
};

const blank = (): RegionSnapshot => ({
  location: null, latitude: null, longitude: null, carringtonLon: null, areaMsh: null,
  mcintosh: null, extentDeg: null, spotCount: null, magClass: null,
  cFlareProbability: null, mFlareProbability: null, xFlareProbability: null, protonProbability: null,
});

/**
 * The regions with spots in a Solar Region Summary, and when they were valid.
 *
 *   Nmbr Location  Lo  Area  Z   LL   NN Mag Type
 *   4538 N12W34   210  0250 Dkc  10   18 Beta-Gamma
 *
 * Only section I (regions with sunspots): section IA lists plage regions
 * with no spots, whose columns mean something else.
 */
export function parseSrs(text: string, nowMs = Date.now()): { validMs: number; regions: Map<string, RegionSnapshot> } {
  const validMs = parseSrsValidTime(text) ?? latestSrsEpoch(nowMs);
  const regions = new Map<string, RegionSnapshot>();
  let inSpots = false;
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (/^I\.\s/i.test(l)) { inSpots = true; continue; }
    if (/^IA\.|^II\.|^III\./i.test(l)) { inSpots = false; continue; }
    if (!inSpots || !/^\d{4,5}\s/.test(l)) continue;
    const p = l.split(/\s+/);
    if (p.length < 8) continue;
    const pos = parseLocation(p[1]);
    if (!pos) continue;
    regions.set(regionKey(p[0]), {
      ...blank(),
      location: p[1].toUpperCase(),
      latitude: pos.latitude,
      longitude: pos.longitude,
      carringtonLon: num(p[2]),
      areaMsh: num(p[3]),
      mcintosh: p[4] || null,
      extentDeg: num(p[5]),
      spotCount: num(p[6]),
      magClass: magClassName(p.slice(7).join('-')),
    });
  }
  return { validMs, regions };
}

const pick = (row: any, keys: string[]): number | null => {
  for (const k of keys) {
    const v = num(row?.[k]);
    if (v !== null) return v;
  }
  return null;
};

const parseUtc = (v: unknown): number | null => {
  if (!v) return null;
  const s = String(v).trim();
  const ms = Date.parse(s.length === 10 ? `${s}T00:00:00Z` : (/(Z|[+-]\d{2}:?\d{2})$/i.test(s) ? s : `${s}Z`));
  return Number.isFinite(ms) ? ms : null;
};

/** The newest NOAA JSON row per region: probabilities, mainly. */
export function parseRegionJson(rows: unknown): Map<string, { atMs: number; snap: Partial<RegionSnapshot> }> {
  const out = new Map<string, { atMs: number; snap: Partial<RegionSnapshot> }>();
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    const raw = row?.region ?? row?.region_number ?? row?.noaa;
    if (raw === undefined || raw === null || raw === '') continue;
    const id = regionKey(raw);
    if (id === '0') continue;
    const atMs = parseUtc(row?.observed_date ?? row?.issue_datetime ?? row?.time_tag ?? row?.date);
    if (atMs == null) continue;
    const prev = out.get(id);
    if (prev && prev.atMs >= atMs) continue;
    out.set(id, {
      atMs,
      snap: {
        cFlareProbability: pick(row, ['c_flare_probability', 'c_class_1_day', 'cflare_probability']),
        mFlareProbability: pick(row, ['m_flare_probability', 'm_class_1_day', 'mflare_probability']),
        xFlareProbability: pick(row, ['x_flare_probability', 'x_class_1_day', 'xflare_probability']),
        protonProbability: pick(row, ['proton_probability', 's1_probability']),
      },
    });
  }
  return out;
}

// ── Applying ───────────────────────────────────────────────────────────────

const same = (a: unknown, b: unknown) =>
  (a == null && b == null) || (typeof a === 'string' && typeof b === 'string'
    ? a.toLowerCase() === b.toLowerCase() : a === b);

function newRecord(id: string, atMs: number, snap: RegionSnapshot): RegionRecord {
  return { id, firstSeenMs: atMs, lastSeenMs: atMs, active: true, current: snap, events: [], sharp: [], fluxRefMx: null };
}

/**
 * Today's Solar Region Summary. A region new to the list appears; one whose
 * numbers moved gets a change with the before and after of each; one that has
 * dropped off the list (rotated off the disk, or decayed) is gone.
 */
export function applySrs(state: SunspotHistoryState, text: string, nowMs = Date.now()): number {
  const { validMs, regions } = parseSrs(text, nowMs);
  if (regions.size === 0) return 0;
  if (state.srsValidMs != null && validMs <= state.srsValidMs) return 0;
  let events = 0;
  for (const [id, snap] of regions) {
    const rec = state.regions[id];
    if (!rec) {
      state.regions[id] = newRecord(id, validMs, snap);
      state.regions[id].events.push({ kind: 'appeared', atMs: validMs, seenAtMs: nowMs, source: 'srs', location: snap.location, changes: diff(blank(), snap) });
      events++;
      continue;
    }
    const changes = diff(rec.current, snap, ['areaMsh', 'mcintosh', 'extentDeg', 'spotCount', 'magClass']);
    if (!rec.active) {
      rec.events.push({ kind: 'returned', atMs: validMs, seenAtMs: nowMs, source: 'srs', location: snap.location, changes });
      events++;
    } else if (changes) {
      rec.events.push({ kind: 'changed', atMs: validMs, seenAtMs: nowMs, source: 'srs', location: snap.location, changes });
      events++;
    }
    // NOAA's probabilities come from the JSON; keep them.
    rec.current = {
      ...snap,
      cFlareProbability: rec.current.cFlareProbability,
      mFlareProbability: rec.current.mFlareProbability,
      xFlareProbability: rec.current.xFlareProbability,
      protonProbability: rec.current.protonProbability,
    };
    rec.lastSeenMs = Math.max(rec.lastSeenMs, validMs);
    rec.active = true;
  }
  for (const rec of Object.values(state.regions)) {
    if (rec.active && !regions.has(rec.id)) {
      rec.active = false;
      rec.events.push({ kind: 'gone', atMs: validMs, seenAtMs: nowMs, source: 'srs', location: rec.current.location });
      events++;
    }
  }
  state.srsValidMs = validMs;
  return events;
}

function diff(before: RegionSnapshot, after: RegionSnapshot, fields: RegionField[] = TRACKED_FIELDS): Record<string, [unknown, unknown]> | undefined {
  const out: Record<string, [unknown, unknown]> = {};
  for (const f of fields) {
    if (after[f] == null) continue;   // a field the source left out has not changed
    if (!same(before[f], after[f])) out[f] = [before[f] ?? null, after[f]];
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * The days before the worker existed, from solar_regions.json - which keeps a
 * row per region per day. Only fills regions it has nothing for, so it can
 * run every time without doubling anything; marked as daily NOAA reports.
 */
export function backfillFromRegionJson(state: SunspotHistoryState, rows: unknown, nowMs = Date.now()): number {
  if (!Array.isArray(rows)) return 0;
  const cutoff = nowMs - HISTORY_DAYS * DAY;
  const byRegion = new Map<string, { atMs: number; snap: RegionSnapshot }[]>();
  for (const row of rows) {
    const raw = row?.region;
    if (raw == null || raw === '') continue;
    const id = regionKey(raw);
    const atMs = parseUtc(row?.observed_date);
    if (id === '0' || atMs == null || atMs < cutoff) continue;
    const pos = parseLocation(row?.location);
    const snap: RegionSnapshot = {
      ...blank(),
      location: pos ? String(row.location).toUpperCase() : null,
      latitude: pos?.latitude ?? num(row?.latitude),
      longitude: pos?.longitude ?? null,
      carringtonLon: num(row?.carrington_longitude),
      areaMsh: num(row?.area),
      mcintosh: row?.spot_class ? String(row.spot_class) : null,
      extentDeg: num(row?.extent),
      spotCount: num(row?.number_spots),
      magClass: magClassName(row?.mag_class),
    };
    if (!byRegion.has(id)) byRegion.set(id, []);
    byRegion.get(id)!.push({ atMs, snap });
  }
  let events = 0;
  for (const [id, list] of byRegion) {
    if (state.regions[id]) continue;
    list.sort((a, b) => a.atMs - b.atMs);
    const rec = newRecord(id, list[0].atMs, list[0].snap);
    rec.events.push({ kind: 'appeared', atMs: list[0].atMs, seenAtMs: nowMs, source: 'noaa-json', location: list[0].snap.location, changes: diff(blank(), list[0].snap) });
    for (const { atMs, snap } of list.slice(1)) {
      const changes = diff(rec.current, snap, ['areaMsh', 'mcintosh', 'extentDeg', 'spotCount', 'magClass']);
      if (changes) rec.events.push({ kind: 'changed', atMs, seenAtMs: nowMs, source: 'noaa-json', location: snap.location, changes });
      rec.current = { ...rec.current, ...Object.fromEntries(Object.entries(snap).filter(([, v]) => v != null)) };
      rec.lastSeenMs = atMs;
    }
    // Active until the next bulletin says otherwise.
    rec.active = nowMs - rec.lastSeenMs < 2 * DAY;
    state.regions[id] = rec;
    events += rec.events.length;
  }
  return events;
}

/** NOAA's per-region probabilities. Only regions already known. */
export function applyRegionJson(state: SunspotHistoryState, rows: unknown, nowMs = Date.now()): number {
  let events = 0;
  for (const [id, { atMs, snap }] of parseRegionJson(rows)) {
    const rec = state.regions[id];
    if (!rec || atMs < rec.firstSeenMs - DAY) continue;
    const next = { ...rec.current, ...Object.fromEntries(Object.entries(snap).filter(([, v]) => v != null)) };
    const changes = diff(rec.current, next, ['cFlareProbability', 'mFlareProbability', 'xFlareProbability', 'protonProbability']);
    if (!changes) continue;
    rec.current = next;
    rec.events.push({ kind: 'changed', atMs, seenAtMs: nowMs, source: 'noaa-json', location: rec.current.location, changes });
    events++;
  }
  return events;
}

/**
 * Hourly SHARP flux and area, merged into each region's series. Each time the
 * flux has moved by a tenth since the last time it was logged, that is logged
 * too: emerging (or decaying) field, timestamped to the hour.
 */
export function applySharp(state: SunspotHistoryState, byRegion: Map<string, SharpHistoryPoint[]>, nowMs = Date.now()): number {
  let events = 0;
  for (const [id, points] of byRegion) {
    const rec = state.regions[id];
    if (!rec) continue;
    const have = new Set(rec.sharp.map((p) => p.atMs));
    const fresh = points.filter((p) => !have.has(p.atMs) && p.atMs > (rec.sharp[rec.sharp.length - 1]?.atMs ?? 0));
    for (const p of fresh) {
      // Rounded to what the measurement is good for: two weeks of hours for
      // every region is a lot of digits otherwise.
      const r1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
      rec.sharp.push({
        atMs: p.atMs, usfluxMx: Number(p.usfluxMx.toPrecision(4)), areaMh: Math.round(p.areaMh),
        latitude: r1(p.latitude), longitude: r1(p.longitude),
      });
      if (rec.fluxRefMx == null || rec.fluxRefMx <= 0) { rec.fluxRefMx = p.usfluxMx; continue; }
      const ratio = p.usfluxMx / rec.fluxRefMx;
      if (Math.abs(ratio - 1) >= FLUX_CHANGE_FRACTION) {
        rec.events.push({
          kind: 'flux', atMs: p.atMs, seenAtMs: nowMs, source: 'sharp', location: rec.current.location,
          changes: { usfluxMx: [rec.fluxRefMx, p.usfluxMx], areaMh: [null, p.areaMh] },
        });
        rec.fluxRefMx = p.usfluxMx;
        events++;
      }
    }
  }
  return events;
}

/** DONKI flares, logged against their region once each. */
export function applyFlares(state: SunspotHistoryState, flares: unknown, nowMs = Date.now()): number {
  if (!Array.isArray(flares)) return 0;
  let events = 0;
  for (const f of flares) {
    const ar = f?.activeRegionNum;
    if (ar == null || !f?.flrID) continue;
    const rec = state.regions[regionKey(ar)];
    if (!rec || rec.events.some((e) => e.flareId === f.flrID)) continue;
    const peakMs = parseUtc(f.peakTime) ?? parseUtc(f.beginTime);
    if (peakMs == null) continue;
    rec.events.push({
      kind: 'flare', atMs: parseUtc(f.beginTime) ?? peakMs, seenAtMs: nowMs, source: 'donki',
      location: f.sourceLocation ?? rec.current.location, flareClass: String(f.classType ?? ''), flareId: String(f.flrID), peakMs,
    });
    events++;
  }
  return events;
}

/** Two weeks: older events, readings and regions go. Events end up in time order. */
export function prune(state: SunspotHistoryState, nowMs = Date.now()): void {
  const cutoff = nowMs - HISTORY_DAYS * DAY;
  for (const [id, rec] of Object.entries(state.regions)) {
    if (rec.lastSeenMs < cutoff && !(rec.sharp.length && rec.sharp[rec.sharp.length - 1].atMs >= cutoff)) {
      delete state.regions[id];
      continue;
    }
    rec.events = rec.events.filter((e) => e.atMs >= cutoff).sort((a, b) => a.atMs - b.atMs || a.seenAtMs - b.seenAtMs);
    rec.sharp = rec.sharp.filter((p) => p.atMs >= cutoff);
  }
  state.updatedMs = nowMs;
}

/** A field's label and value, for showing a change to a person. */
export const FIELD_LABELS: Record<string, string> = {
  areaMsh: 'Area', mcintosh: 'McIntosh class', extentDeg: 'Extent', spotCount: 'Spots',
  magClass: 'Magnetic class', cFlareProbability: 'C-flare chance', mFlareProbability: 'M-flare chance',
  xFlareProbability: 'X-flare chance', protonProbability: 'Proton chance',
  usfluxMx: 'Magnetic flux', areaMh: 'Field area',
};

export function formatFieldValue(field: string, v: unknown): string {
  if (v == null) return '-';
  if (field === 'areaMsh' || field === 'areaMh') return `${Math.round(Number(v))} MSH`;
  if (field === 'extentDeg') return `${v}°`;
  if (field.endsWith('Probability')) return `${v}%`;
  if (field === 'usfluxMx') return `${(Number(v) / 1e21).toFixed(1)}×10²¹ Mx`;
  return String(v);
}

// ── Reading it back (the app) ──────────────────────────────────────────────

export const SUNSPOT_HISTORY_URL = 'https://sunspot-history.thenamesrock.workers.dev';

/**
 * A region's NOAA numbers as a series, one point per report: what the growth
 * read on the tracker draws. Rebuilt from the changes, since a day where
 * nothing changed is the same as the day before it.
 */
export function growthPoints(rec: RegionRecord): { atMs: number; area: number | null; spotCount: number | null; magneticClass: string | null }[] {
  const out: { atMs: number; area: number | null; spotCount: number | null; magneticClass: string | null }[] = [];
  let area: number | null = null, spots: number | null = null, mag: string | null = null;
  for (const e of rec.events) {
    if (e.source !== 'srs' && e.source !== 'noaa-json') continue;
    if (e.kind === 'gone') continue;
    const c = e.changes ?? {};
    if (c.areaMsh) area = c.areaMsh[1] as number;
    if (c.spotCount) spots = c.spotCount[1] as number;
    if (c.magClass) mag = c.magClass[1] as string;
    if (!c.areaMsh && !c.spotCount && !c.magClass) continue;
    const last = out[out.length - 1];
    if (last && last.atMs === e.atMs) out[out.length - 1] = { atMs: e.atMs, area, spotCount: spots, magneticClass: mag };
    else out.push({ atMs: e.atMs, area, spotCount: spots, magneticClass: mag });
  }
  // Still the same at its newest report.
  const last = out[out.length - 1];
  if (last && rec.lastSeenMs > last.atMs) {
    out.push({ atMs: rec.lastSeenMs, area: rec.current.areaMsh, spotCount: rec.current.spotCount, magneticClass: rec.current.magClass });
  }
  return out;
}

/** Every region's record, by NOAA's four-digit number, or null if the worker is unreachable. */
export async function fetchSunspotHistory(timeoutMs = 8000): Promise<Record<string, RegionRecord> | null> {
  try {
    const res = await fetch(`${SUNSPOT_HISTORY_URL}/api/regions`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data?.regions)) return null;
    const out: Record<string, RegionRecord> = {};
    for (const r of data.regions) if (r?.id) out[String(r.id)] = r;
    return out;
  } catch {
    return null;
  }
}
