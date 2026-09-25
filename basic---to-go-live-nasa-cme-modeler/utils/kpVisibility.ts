// NOAA's Kp forecast, on the app's own visibility scale.
//
// Kp is a planetary index; what a viewer in New Zealand can see depends on
// where the oval sits over them, their magnetic latitude and the time of
// night. So a Kp is turned into the coupling that drives the oval, and from
// there goes through exactly the chain the live forecast uses
// (computeOvalBoundary, then auroraGeometryAt) - one scale for everything,
// rather than a separate table of "Kp 5 means Christchurch" to drift from it.
//
// The anchors are the same pins the shared model is tested against
// (scripts/test-aurora-visibility.mjs): a quiet night, a Kp 3 stream, a
// Kp 5 G1 storm and a Kp 7 G3 storm, each with the coupling that produces
// them. In between is linear.

import { computeOvalBoundary } from './ovalPhysics';

const KP_ANCHORS: [kp: number, newell: number][] = [
  [0, 0],
  [1, 3200],
  [3, 9800],
  [5, 18000],
  [7, 26000],
  [8, 31000],
  [9, 40000],
];

/** The hourly Newell coupling that goes with a Kp, on the model's calibration. */
export function newellForKp(kp: number): number {
  const k = Math.max(0, Math.min(9, kp));
  for (let i = 0; i < KP_ANCHORS.length - 1; i++) {
    const [k0, n0] = KP_ANCHORS[i];
    const [k1, n1] = KP_ANCHORS[i + 1];
    if (k <= k1) return n0 + (n1 - n0) * (k - k0) / (k1 - k0);
  }
  return KP_ANCHORS[KP_ANCHORS.length - 1][1];
}

/** The oval's midnight edge for a Kp, as the live forecast would place it. */
export function boundaryForKp(kp: number, atMs: number): number {
  const newell = newellForKp(kp);
  return computeOvalBoundary({ newell_avg_60m: newell, newell_avg_30m: newell }, false, new Date(atMs));
}

export interface KpBlock {
  startMs: number;
  endMs: number;
  kp: number;
  observed: 'observed' | 'estimated' | 'predicted';
}

/**
 * NOAA's planetary Kp forecast, as three-hour blocks. It comes as either an
 * array of objects or a header row and arrays; both are read. Times have no
 * zone and are UTC.
 */
export function parseNoaaKpForecast(raw: unknown): KpBlock[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const isObjects = typeof raw[0] === 'object' && raw[0] !== null && !Array.isArray(raw[0]);
  const rows = isObjects ? raw : raw.slice(1);
  const out: KpBlock[] = [];
  for (const row of rows as any[]) {
    const tag = String(isObjects ? row?.time_tag ?? '' : row?.[0] ?? '');
    const startMs = Date.parse(tag.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(tag) ? '' : 'Z'));
    const kp = parseFloat(String(isObjects ? row?.kp : row?.[1]));
    if (!Number.isFinite(startMs) || !Number.isFinite(kp)) continue;
    const obs = String(isObjects ? row?.observed ?? 'predicted' : row?.[2] ?? 'predicted');
    out.push({
      startMs, endMs: startMs + 3 * 3600000, kp,
      observed: obs === 'observed' || obs === 'estimated' ? obs : 'predicted',
    });
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

/** NOAA's Kp for a moment, from the block it falls in. */
export function kpAt(blocks: KpBlock[], atMs: number): KpBlock | null {
  return blocks.find((b) => atMs >= b.startMs && atMs < b.endMs) ?? null;
}
