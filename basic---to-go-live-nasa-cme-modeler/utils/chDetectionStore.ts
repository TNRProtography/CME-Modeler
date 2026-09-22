// One place that knows where the coronal holes are.
//
// Three panels want this now - the tracker, the SUVI imagery overlay and the
// sunspot tracker - and running the detector once per panel would mean three
// canvas decodes and three flood fills of the same frame. So detection happens
// here, once per frame, and the panels subscribe.
//
// It also remembers. The SUVI worker holds about a day of frames, but a hole
// takes a fortnight to cross the disk and its stream is still arriving days
// after it has turned out of sight. Keeping a week of compact records means a
// hole that rotated off on Tuesday is still listed on Friday with the reason
// it is no longer visible, rather than disappearing from the app as though it
// had never existed.
//
// What is kept where matters. The full detection - polygon, disk geometry,
// axis tilt - is what the overlay needs to draw, and only exists for frames
// seen this session. The persisted record is the small part: where the hole
// was, how big, how dark. That is all the list, the trend and the arrival
// estimate need, and it is about a hundred bytes rather than four kilobytes,
// which is the difference between a week of history fitting in local storage
// and not.

import { detectCoronalHolesFromSuvi195 } from './suviCoronalHoleDetector';
import type { CoronalHole } from './coronalHoleData';
import type { DiskFraction } from './solarDisk';
import type { ChTrack, TrackedHole } from './chTracking';
import { assignChNumbers, parseRegistry, type ChRegistry } from './chRegistry';

const STORAGE_KEY = 'sta-ch-history-v1';
const REGISTRY_KEY = 'sta-ch-registry-v1';
export const HISTORY_WINDOW_MS = 7 * 86400000;

/**
 * How far apart detections are taken. A hole does not change shape
 * meaningfully inside two hours and the Sun turns about a degree, so running
 * the detector on every four-minute frame buys nothing for a lot of work.
 */
export const DETECT_SPACING_MS = 2 * 3600 * 1000;

/** Frames per pass. Enough for a day at two-hour spacing, with room over. */
const MAX_PER_PASS = 16;

export interface ChDetection {
  atMs: number;
  frameUrl: string;
  holes: CoronalHole[];
  disk: DiskFraction;
  b0Deg: number;
}

/** The part worth keeping for a week. */
export interface ChRecord {
  atMs: number;
  holes: TrackedHole[];
}

export interface ChStoreState {
  /** Full detections from this session, newest last. Drawable. */
  detections: ChDetection[];
  /** Up to a week of compact records, newest last. */
  history: ChRecord[];
  progress: { done: number; total: number } | null;
  error: string | null;
}

type Listener = (state: ChStoreState) => void;

const listeners = new Set<Listener>();
const detections = new Map<string, ChDetection>();
/** Frames already tried, so a frame that fails is not retried every poll. */
const attempted = new Set<string>();
let history: ChRecord[] = [];
let registry: ChRegistry = { nextNumber: 0, entries: [] };
let progress: ChStoreState['progress'] = null;
let error: string | null = null;
let running = false;
let loaded = false;

function compact(holes: CoronalHole[]): TrackedHole[] {
  return holes.map((h) => ({
    id: h.id, lat: h.lat, lon: h.lon,
    widthDeg: h.widthDeg, heightDeg: h.heightDeg, darkness: h.darkness,
  }));
}

function loadHistory(): void {
  if (loaded) return;
  loaded = true;
  try {
    registry = parseRegistry(
      typeof localStorage !== 'undefined' ? localStorage.getItem(REGISTRY_KEY) : null);
  } catch {
    registry = parseRegistry(null);
  }
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    history = parsed.filter((r: any) => Number.isFinite(r?.atMs) && Array.isArray(r?.holes));
    prune();
  } catch {
    // A corrupt or unavailable store is not worth failing over. Private
    // browsing throws on read, and a week of history is a convenience.
    history = [];
  }
}

function prune(): void {
  const cutoff = Date.now() - HISTORY_WINDOW_MS;
  history = history
    .filter((r) => r.atMs >= cutoff)
    .sort((a, b) => a.atMs - b.atMs);
}

function saveHistory(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Quota, or storage disabled. The session still works from memory.
  }
}

function remember(atMs: number, holes: CoronalHole[]): void {
  const existing = history.findIndex((r) => r.atMs === atMs);
  const record: ChRecord = { atMs, holes: compact(holes) };
  if (existing >= 0) history[existing] = record;
  else history.push(record);
  prune();
  saveHistory();
}

function snapshot(): ChStoreState {
  return {
    detections: [...detections.values()].sort((a, b) => a.atMs - b.atMs),
    history: [...history],
    progress,
    error,
  };
}

function emit(): void {
  const state = snapshot();
  for (const listener of listeners) listener(state);
}

export function subscribeToChDetections(listener: Listener): () => void {
  loadHistory();
  listeners.add(listener);
  listener(snapshot());
  return () => { listeners.delete(listener); };
}

export function getChState(): ChStoreState {
  loadHistory();
  return snapshot();
}

export interface FrameRef {
  /** Absolute, resolved URL of the frame. */
  url: string;
  atMs: number;
}

/**
 * Pick frames roughly DETECT_SPACING_MS apart, always including the newest.
 *
 * `limit` caps how many come back, keeping the newest. Passing Infinity gets
 * the whole spaced set, which is what a caller wants when it intends to drop
 * the frames it has already measured before taking its slice.
 */
export function spacedFrames(
  frames: FrameRef[],
  spacingMs = DETECT_SPACING_MS,
  limit = MAX_PER_PASS,
): FrameRef[] {
  const ordered = [...frames]
    .filter((f) => f.url && Number.isFinite(f.atMs))
    .sort((a, b) => a.atMs - b.atMs);
  if (ordered.length === 0) return [];

  const picked: FrameRef[] = [];
  let lastMs = -Infinity;
  for (const f of ordered) {
    if (f.atMs - lastMs >= spacingMs) { picked.push(f); lastMs = f.atMs; }
  }
  const newest = ordered[ordered.length - 1];
  if (picked[picked.length - 1]?.url !== newest.url) picked.push(newest);
  // Keep the newest end when there are more than the caller can take.
  return Number.isFinite(limit) ? picked.slice(-limit) : picked;
}

/**
 * Detect any of these frames not already known.
 *
 * Newest first, so the panels get something to draw immediately and the
 * history fills in behind it. Only one pass runs at a time: several panels
 * mounting at once must not each start their own.
 */
export async function ensureChDetections(frames: FrameRef[]): Promise<void> {
  loadHistory();
  if (running) return;

  // Space first, drop what is already measured, and only then take a pass's
  // worth. Slicing before the filter - which is what spacedFrames does by
  // default - meant every pass looked at the same newest sixteen frames, so
  // once those were measured no pass ever had anything to do and tracking
  // stopped dead at MAX_PER_PASS * DETECT_SPACING_MS, about thirty-two hours,
  // however much imagery was on offer. The store remembers a week; this is
  // what lets it fill one, a pass at a time, working backwards.
  const wanted = spacedFrames(frames, DETECT_SPACING_MS, Infinity)
    .filter((f) => !detections.has(f.url) && !attempted.has(f.url))
    .slice(-MAX_PER_PASS)
    .reverse();
  if (wanted.length === 0) return;

  running = true;
  error = null;
  progress = { done: 0, total: wanted.length };
  emit();

  try {
    for (let i = 0; i < wanted.length; i++) {
      const frame = wanted[i];
      attempted.add(frame.url);
      try {
        const result = await detectCoronalHolesFromSuvi195(frame.url, 0, new Date(frame.atMs));
        if (result.succeeded && result.diskFraction) {
          detections.set(frame.url, {
            atMs: frame.atMs,
            frameUrl: frame.url,
            holes: result.coronalHoles,
            disk: result.diskFraction,
            b0Deg: result.b0Deg,
          });
          remember(frame.atMs, result.coronalHoles);
        }
      } catch {
        // One unreadable frame is not a reason to abandon the rest.
      }
      progress = { done: i + 1, total: wanted.length };
      emit();
    }
    if (detections.size === 0) {
      error = 'No coronal holes could be measured in the available imagery.';
    }
  } finally {
    running = false;
    progress = null;
    emit();
  }
}

/**
 * Record a detection somebody else ran.
 *
 * The 3D scene detects the live SUVI image rather than the worker's archived
 * frames, so its result would otherwise never reach this store and the two
 * views of the Sun could show different holes. Publishing it here means one
 * set of outlines everywhere, whichever half of the app did the work.
 */
export function publishDetection(
  frameUrl: string,
  atMs: number,
  holes: CoronalHole[],
  disk: DiskFraction,
  b0Deg: number,
): void {
  loadHistory();
  if (!frameUrl || !Number.isFinite(atMs)) return;
  detections.set(frameUrl, { atMs, frameUrl, holes, disk, b0Deg });
  attempted.add(frameUrl);
  remember(atMs, holes);
  emit();
}

/** The detection nearest a moment, for drawing over that frame. */
export function detectionNear(all: ChDetection[], atMs: number): ChDetection | null {
  if (all.length === 0) return null;
  return all.reduce((a, b) => (Math.abs(a.atMs - atMs) <= Math.abs(b.atMs - atMs) ? a : b));
}

/**
 * Everything worth following: a week of remembered records, with this
 * session's full detections layered over the top where they overlap.
 */
export function framesForTracking(state: ChStoreState): { atMs: number; holes: TrackedHole[] }[] {
  const byTime = new Map<number, TrackedHole[]>();
  for (const record of state.history) byTime.set(record.atMs, record.holes);
  for (const detection of state.detections) byTime.set(detection.atMs, compact(detection.holes));
  return [...byTime.entries()]
    .map(([atMs, holes]) => ({ atMs, holes }))
    .sort((a, b) => a.atMs - b.atMs);
}

/**
 * Number the tracks, and remember the numbering.
 *
 * Kept here rather than in the component because the numbers have to outlive
 * any one render, any one window of frames, and the page itself - a hole that
 * was CH97 this morning must still be CH97 tonight.
 */
export function numberTracks(tracks: ChTrack[], nowMs = Date.now()): Map<string, number> {
  loadHistory();
  const result = assignChNumbers(tracks, registry, nowMs);
  registry = result.registry;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry));
    }
  } catch { /* storage disabled */ }
  return result.numbers;
}

export interface DrawableHole {
  /** The track this outline belongs to. */
  trackKey: string;
  hole: CoronalHole;
  /** When the outline was measured, so it can be rotated forward. */
  observedAtMs: number;
  disk: DiskFraction;
  b0Deg: number;
  /** True when this is not from the frame being shown. */
  carriedForward: boolean;
}

/**
 * The outline to draw for each track, over a given frame.
 *
 * Takes the measurement from the frame itself where there is one, and the
 * track's most recent measurement otherwise. That second case is what stops
 * the flicker: the detector misses a hole in maybe one frame in ten, and
 * drawing only what the current frame found makes holes blink in and out as
 * the timeline plays. A carried-forward outline is rotated to the frame's
 * moment like any other, so it sits where the hole actually is.
 */
export function drawableHoles(
  state: ChStoreState,
  tracks: ChTrack[],
  atMs: number,
): DrawableHole[] {
  if (state.detections.length === 0) return [];
  const byTime = new Map<number, ChDetection>();
  for (const d of state.detections) byTime.set(d.atMs, d);

  const frameDetection = detectionNear(state.detections, atMs);
  const out: DrawableHole[] = [];

  for (const track of tracks) {
    if (!track.live) continue;

    // Newest first: the freshest outline we have for this hole.
    for (let i = track.points.length - 1; i >= 0; i--) {
      const point = track.points[i];
      const detection = byTime.get(point.atMs);
      if (!detection) continue;
      const hole = detection.holes.find((h) => h.id === point.hole.id);
      if (!hole) continue;
      out.push({
        trackKey: track.key,
        hole,
        observedAtMs: detection.atMs,
        disk: detection.disk,
        b0Deg: detection.b0Deg,
        carriedForward: detection.atMs !== frameDetection?.atMs,
      });
      break;
    }
  }

  return out;
}

/** Testing seam: forget everything, including what is on disk. */
export function resetChStore(): void {
  detections.clear();
  attempted.clear();
  history = [];
  registry = { nextNumber: 0, entries: [] };
  progress = null;
  error = null;
  running = false;
  loaded = false;
  // typeof, not optional chaining: `localStorage?.x` still throws a
  // ReferenceError where the identifier is not declared at all, which is every
  // non-browser environment this module gets imported into.
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(REGISTRY_KEY);
    }
  } catch { /* storage disabled */ }
}
