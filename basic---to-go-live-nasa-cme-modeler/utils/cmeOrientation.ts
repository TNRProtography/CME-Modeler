// CME orientation from our own analysis (scripts/cme_orientation, served by
// the cme-orientation worker): the flux rope's tilt from coronagraphs and the
// source region's magnetogram, and a triangulated direction.
//
// Only the 3D model uses it. Whether a CME is Earth-directed, arrival times
// and alerts keep using NASA's analysed direction, so this can never change
// what someone is told, only how the CME is drawn. Without a result, or with
// the worker unreachable, a CME is drawn exactly as before.

export const CME_ORIENTATION_URL = 'https://cme-orientation.thenamesrock.workers.dev/api/orientations';
const FETCH_TIMEOUT_MS = 6000;

export type OrientationStatus = 'confirmed' | 'estimated' | 'unknown';

export interface OrientationEstimate {
  /** Degrees from the solar equator, counter-clockwise toward north as seen from Earth: 0 flat, +/-90 upright. */
  tilt: number;
  confidence: number;
  uncertainty?: number;
  location?: string;
  leadingField?: string;
  ropeType?: string;
}

export interface CmeOrientation {
  id: string;
  status: OrientationStatus;
  /** Same convention as OrientationEstimate.tilt; null when not determined. */
  tilt: number | null;
  confidence: number;
  computedAt?: string;
  final?: boolean;
  estimates?: Partial<Record<'coronagraph' | 'sourceRegion' | 'nasa', OrientationEstimate>>;
  field?: { leadingField: string; axialField: string; ropeType: string; helicity: string } | null;
  direction?: {
    lon: number;
    lat: number;
    uncertainty: number;
    confidence: number;
    basis: string;
    useInModel: boolean;
    offFromDonki?: number;
  } | null;
  views?: { source: string; label?: string; detected: boolean; halo?: boolean; reason?: string }[];
  notes?: string[];
}

/** Every stored result by CME id; empty if the worker cannot be reached. */
export async function fetchCmeOrientations(): Promise<Record<string, CmeOrientation>> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const res = await fetch(CME_ORIENTATION_URL, { signal: ctrl?.signal });
    if (!res.ok) return {};
    const body = await res.json();
    return body && typeof body.cmes === 'object' && body.cmes ? body.cmes : {};
  } catch {
    return {};
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The direction the 3D model draws: ours when confident, else NASA's. */
export function modelDirection(cme: { longitude: number; latitude: number; orientation?: CmeOrientation | null }):
  { lon: number; lat: number; ours: boolean } {
  const d = cme.orientation?.direction;
  if (d && d.useInModel && Number.isFinite(d.lon) && Number.isFinite(d.lat)) {
    return { lon: d.lon, lat: d.lat, ours: true };
  }
  return {
    lon: Number.isFinite(cme.longitude) ? cme.longitude : 0,
    lat: Number.isFinite(cme.latitude) ? cme.latitude : 0,
    ours: false,
  };
}

/** The tilt to draw, or null to keep the default drawing. */
export function modelTilt(o: CmeOrientation | null | undefined): number | null {
  if (!o || o.status === 'unknown' || o.tilt == null || !Number.isFinite(o.tilt)) return null;
  return o.tilt;
}

/**
 * The rotation about the CME's direction that lays its arc (the model's
 * local x axis) along the tilt.
 *
 * Scene frame: +y is solar north; longitude increases toward west, so for a
 * direction d the local horizontal is north x d (pointing west) and the local
 * vertical d x horizontal, the same basis the analysis measures tilt in.
 * Pure vector arithmetic, so it is testable without three.js.
 */
export function tiltRotationAngle(
  dir: [number, number, number],
  arcAxisNow: [number, number, number],
  tiltDeg: number,
): number {
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (a: number[]) => { const n = Math.hypot(a[0], a[1], a[2]) || 1; return a.map((x) => x / n); };
  const d = norm(dir);
  let h = cross([0, 1, 0], d);
  if (Math.hypot(h[0], h[1], h[2]) < 1e-9) h = [1, 0, 0];
  h = norm(h);
  const v = norm(cross(d, h));
  const t = (tiltDeg * Math.PI) / 180;
  const want = [Math.cos(t) * h[0] + Math.sin(t) * v[0], Math.cos(t) * h[1] + Math.sin(t) * v[1], Math.cos(t) * h[2] + Math.sin(t) * v[2]];
  const now = norm(arcAxisNow);
  return Math.atan2(dot(cross(now, want), d), dot(now, want));
}

/** One line for the selected-CME panel. */
export function orientationSummary(o: CmeOrientation | null | undefined): string {
  if (!o) return 'Not analysed yet';
  if (o.status === 'unknown' || o.tilt == null) return 'Not determined';
  const t = Math.round(o.tilt);
  // Positive is counter-clockwise from west (right, seen from Earth) toward
  // north: the west end is the higher one.
  const shape = Math.abs(t) <= 25 ? 'lying flat' : Math.abs(t) >= 65 ? 'upright' : t > 0 ? 'tilted, higher on the west side' : 'tilted, higher on the east side';
  return `${t}° (${shape})`;
}
