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
import { buildChTracks, type ChTrack, type TrackedHole } from './chTracking';
import { longitudeAt } from './solarDisk';
import { estimateHssSpeedFromChWidthAndDarkness } from './solarWindModel';
import { assignChNumbers, parseRegistry, type ChRegistry } from './chRegistry';
import {
  applyFrames, emptyLifecycle, isLifecycleTrack, lifecycleTracks, parseLifecycle, pruneLifecycle,
  MIN_FRAME_GAP_MS, type ChLifecycle, type LifecycleTrack,
} from './chLifecycle';

const STORAGE_KEY = 'sta-ch-history-v1';
const REGISTRY_KEY = 'sta-ch-registry-v1';
/** The 90-day record of every hole (utils/chLifecycle), and where it came from. */
const LIFECYCLE_KEY = 'sta-ch-lifecycle-v1';
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
  /**
   * Every hole's life, up to 90 days: the shared record from the forecast
   * worker when it has been fetched, this device's own otherwise, with any
   * newer frames detected here added on top.
   */
  lifecycle: ChLifecycle;
  /** The record as tracks, numbered for good: what every panel follows. */
  tracks: LifecycleTrack[];
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
/** The record as last stored or fetched, before this device's newer frames. */
let lifecycle: ChLifecycle = emptyLifecycle();
let lifecycleSource: 'server' | 'local' = 'local';
let lifecycleRev = 0;

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
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LIFECYCLE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      lifecycle = parseLifecycle(parsed?.lifecycle);
      lifecycleSource = parsed?.source === 'server' ? 'server' : 'local';
    }
  } catch { lifecycle = emptyLifecycle(); }
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

function saveLifecycle(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LIFECYCLE_KEY, JSON.stringify({ source: lifecycleSource, lifecycle }));
  } catch { /* quota or disabled: the session keeps it in memory */ }
}

let working: { key: string; lifecycle: ChLifecycle; tracks: LifecycleTrack[] } | null = null;

/**
 * The record with this device's newer frames added.
 *
 * While a detection pass is running, frames arrive newest first, and the
 * record only takes frames in order, so the additions are made to a copy and
 * kept only once the pass is over. A record this device built itself, younger
 * than the frames it now has, is rebuilt from them, so the first visit's
 * backfill is not lost; the shared record is never rebuilt here.
 */
function workingLifecycle(frames: { atMs: number; holes: TrackedHole[] }[]): typeof working & object {
  const key = `${lifecycleRev}|${frames.length}|${frames[frames.length - 1]?.atMs ?? 0}|${running}`;
  if (working && working.key === key) return working;

  let base = lifecycle;
  if (lifecycleSource === 'local' && frames.length > 0
      && (!base.startedMs || frames[0].atMs < base.startedMs - MIN_FRAME_GAP_MS)) {
    base = emptyLifecycle();
  }
  const newer = frames.filter((f) => f.atMs > base.lastFrameMs);
  let next = base;
  if (newer.length > 0 || base !== lifecycle) {
    next = parseLifecycle(JSON.parse(JSON.stringify(base)));
    applyFrames(next, newer);
    pruneLifecycle(next, Date.now());
    if (!running) {
      lifecycle = next;
      lifecycleRev++;
      saveLifecycle();
    }
  }
  working = {
    key: `${lifecycleRev}|${frames.length}|${frames[frames.length - 1]?.atMs ?? 0}|${running}`,
    lifecycle: next,
    tracks: lifecycleTracks(next),
  };
  return working;
}

function snapshot(): ChStoreState {
  const base = {
    detections: [...detections.values()].sort((a, b) => a.atMs - b.atMs),
    history: [...history],
    progress,
    error,
  };
  const w = workingLifecycle(framesForTracking(base));
  return { ...base, lifecycle: w.lifecycle, tracks: w.tracks };
}

/**
 * Take the shared record from the forecast worker. Frames detected here that
 * are newer than it are added on top, as with any record.
 */
export function adoptSharedLifecycle(raw: unknown): boolean {
  loadHistory();
  const next = parseLifecycle(raw);
  if (!next.lastFrameMs) return false;
  // An older copy than the one already held (a cached response) changes nothing.
  if (lifecycleSource === 'server' && next.lastFrameMs < lifecycle.lastFrameMs) return false;
  lifecycle = next;
  lifecycleSource = 'server';
  lifecycleRev++;
  saveLifecycle();
  emit();
  return true;
}

/** Frames this device has that the record does not, for sending to the worker. */
export function framesNewerThan(atMs: number): { atMs: number; holes: TrackedHole[] }[] {
  loadHistory();
  if (running) return [];
  return framesForTracking({ history, detections: [...detections.values()] } as Pick<ChStoreState, 'history' | 'detections'>)
    .filter((f) => f.atMs > atMs);
}

/** Whether a detection pass is under way. */
export const isDetecting = () => running;

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
export function framesForTracking(state: Pick<ChStoreState, 'history' | 'detections'>): { atMs: number; holes: TrackedHole[] }[] {
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
  // Tracks from the record carry their number already.
  if (tracks.length > 0 && tracks.every(isLifecycleTrack)) {
    return new Map(tracks.map((t) => [t.key, (t as LifecycleTrack).number]));
  }
  const result = assignChNumbers(tracks, registry, nowMs);
  registry = result.registry;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry));
    }
  } catch { /* storage disabled */ }
  return result.numbers;
}

/** How far, once rotation is taken out, a detected hole can be from a track and be it. */
const TRACK_HOLE_MATCH_DEG = 12;

/**
 * The hole in one detection that a track is, or null.
 *
 * By frame time and id when the track has a measurement from that very frame;
 * otherwise by where the track would be at that frame's moment. The second
 * is what matters for the 90-day record: its measurements come from whichever
 * frames the shared record or an earlier visit took, which are seldom the
 * frames this session happened to measure, and matching on time alone left
 * nothing to draw.
 */
export function holeForTrackIn(
  track: ChTrack,
  detection: { atMs: number; holes: CoronalHole[] },
): CoronalHole | null {
  const point = track.points.find((p) => p.atMs === detection.atMs);
  if (point) {
    const exact = detection.holes.find((h) => h.id === point.hole.id);
    if (exact) return exact;
  }
  const lon = longitudeAt(track.latest.lon, track.lastSeenMs, detection.atMs);
  let best: CoronalHole | null = null;
  let bestDistance = TRACK_HOLE_MATCH_DEG;
  for (const h of detection.holes) {
    const distance = Math.hypot(h.lon - lon, h.lat - track.latest.lat);
    if (distance < bestDistance) { bestDistance = distance; best = h; }
  }
  return best;
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
  const frameDetection = detectionNear(state.detections, atMs);
  // The frame's own detection first, then the rest nearest in time to it.
  const ordered = [...state.detections].sort((a, b) => Math.abs(a.atMs - atMs) - Math.abs(b.atMs - atMs));
  const out: DrawableHole[] = [];
  const claimed = new Set<string>();

  for (const track of tracks) {
    if (!track.live) continue;
    for (const detection of ordered) {
      const hole = holeForTrackIn(track, detection);
      if (!hole) continue;
      const id = `${detection.atMs}|${hole.id}`;
      if (claimed.has(id)) continue;
      claimed.add(id);
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
  lifecycle = emptyLifecycle();
  lifecycleSource = 'local';
  lifecycleRev++;
  working = null;
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
      localStorage.removeItem(LIFECYCLE_KEY);
    }
  } catch { /* storage disabled */ }
}

/**
 * The holes the 3D scene should draw: the same ones the Coronal Hole Tracker
 * lists as live.
 *
 * The newest detection on its own is not enough. The detector misses holes -
 * a faint frame, a flare washing out part of the disk - and the tracker keeps
 * such a hole live for a grace period, rotating with the Sun, rather than
 * letting it blink out. Drawing only the newest detection made the scene lose
 * holes the tracker was still showing. So every live track the newest
 * detection does not already have is added back, carried forward to the
 * newest detection's time.
 *
 * A carried-forward hole has no outline of its own unless its last sighting
 * was a full detection this session; otherwise it is drawn as an ellipse of
 * its measured size, the same fallback the scene already uses.
 */
export function holesForScene(state: ChStoreState): { holes: CoronalHole[]; atMs: number } | null {
  const newest = state.detections[state.detections.length - 1];
  if (!newest) return null;

  const tracks: ChTrack[] = state.tracks ?? buildChTracks(framesForTracking(state));
  const numbers = numberTracks(tracks);
  const holes: CoronalHole[] = [...newest.holes];

  // Close enough on the Sun to be the same hole, degrees.
  const SAME_HOLE_DEG = 8;
  const near = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
    Math.hypot(a.lat - b.lat, (a.lon - b.lon) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180)) < SAME_HOLE_DEG;

  for (const track of tracks) {
    if (!track.live || track.lastSeenMs >= newest.atMs) continue;
    const lon = longitudeAt(track.latest.lon, track.lastSeenMs, newest.atMs);
    const at = { lat: track.latest.lat, lon };
    if (holes.some((h) => near(h, at))) continue;

    const lastDetection = state.detections.find((d) => d.atMs === track.lastSeenMs);
    const full = lastDetection ? holeForTrackIn(track, lastDetection) : null;
    const widthDeg = Math.max(5, track.latest.widthDeg);
    const darkness = track.latest.darkness ?? 0.5;
    const id = `CH${numbers.get(track.key) ?? track.key}`;
    holes.push(full
      ? { ...full, id, lon, sourceDirectionDeg: { lat: full.lat, lon } }
      : {
          id,
          lat: at.lat,
          lon,
          widthDeg,
          heightDeg: Math.max(5, track.latest.heightDeg ?? widthDeg),
          estimatedSpeedKms: estimateHssSpeedFromChWidthAndDarkness(widthDeg, darkness),
          darkness,
          sourceDirectionDeg: { lat: at.lat, lon },
          expansionHalfAngleDeg: Math.min(22, 8 + widthDeg * 0.30),
          opacity: 0.45,
          hssVisible: true,
          animPhase: (holes.length * 0.37) % 1,
        });
  }
  return { holes, atMs: newest.atMs };
}
