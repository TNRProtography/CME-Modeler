// Keeping this device's coronal hole record and the shared one together.
//
// The forecast worker holds the 90-day record every device adds to
// (utils/chLifecycle). Detection needs a canvas, so it happens here: this
// sends the worker any frames it has not had yet, and takes its record back,
// so every device shows the same holes under the same numbers with the same
// history. When the worker cannot be reached the app carries on with its own
// record and sends what it has missed next time.

import {
  adoptSharedLifecycle, framesNewerThan, getChState, isDetecting, LOCAL_OUTLINE_WINDOW_MS,
  sharedOutlinesCompleteToMs, subscribeToChDetections,
} from './chDetectionStore';
import { whenAppIdle } from './appReady';
import { registerDatasetTicker } from './pollingScheduler';

const FORECAST_WORKER = 'https://spot-the-aurora-forecast-worker.thenamesrock.workers.dev';
/** Frames a request: each carries every hole's outline, about a kilobyte apiece. */
const MAX_FRAMES_PER_POST = 60;
const WEEK_MS = 7 * 86400000;
const SYNC_EVERY_MS = 15 * 60000;

let inflight: Promise<boolean> | null = null;
let started = false;

/** One round trip: read the shared record, send what it lacks, adopt the result. */
export function syncChLifecycle(): Promise<boolean> {
  if (!inflight) inflight = runSync().finally(() => { inflight = null; });
  return inflight;
}

async function runSync(): Promise<boolean> {
  try {
    // Outlines only for what this device does not already have: after the
    // last complete copy it took, and never older than the 3D view reaches.
    const outlinesFrom = Math.max(sharedOutlinesCompleteToMs(), Date.now() - LOCAL_OUTLINE_WINDOW_MS);
    const res = await fetch(`${FORECAST_WORKER}/ch/lifecycle?outlinesFrom=${Math.floor(outlinesFrom)}`);
    if (!res.ok) return false;
    let shared = (await res.json())?.lifecycle ?? null;
    const since = Math.max(Number(shared?.lastFrameMs) || 0, Date.now() - WEEK_MS);

    // Only once detection has settled: a pass works newest first, and the
    // record takes frames oldest first.
    if (!isDetecting()) {
      const pending = framesNewerThan(since);
      for (let i = 0; i < pending.length; i += MAX_FRAMES_PER_POST) {
        const frames = pending.slice(i, i + MAX_FRAMES_PER_POST).map((f) => ({
          atMs: f.atMs,
          holes: f.holes.map((h) => ({
            id: h.id, lat: h.lat, lon: h.lon, widthDeg: h.widthDeg, heightDeg: h.heightDeg,
            darkness: h.darkness, outline: h.outline,
          })),
        }));
        const post = await fetch(`${FORECAST_WORKER}/ch/observe?outlinesFrom=${Math.floor(outlinesFrom)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ frames }),
        });
        if (!post.ok) break;
        shared = (await post.json())?.lifecycle ?? shared;
      }
    }
    return shared ? adoptSharedLifecycle(shared, outlinesFrom) : false;
  } catch {
    // Offline, or the worker not yet deployed with the record: this device's
    // own record stands in.
    return false;
  }
}

/**
 * Keep in step from here on: once the app is idle, every fifteen minutes,
 * and whenever a detection pass finishes. Safe to call from every panel.
 */
export function startChLifecycleSync(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  void whenAppIdle(8000).then(() => syncChLifecycle());
  registerDatasetTicker('ch-lifecycle-sync', () => { void syncChLifecycle(); }, SYNC_EVERY_MS);

  let wasDetecting = getChState().progress != null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  subscribeToChDetections((state) => {
    const detecting = state.progress != null;
    if (wasDetecting && !detecting) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void syncChLifecycle(); }, 3000);
    }
    wasDetecting = detecting;
  });
}
