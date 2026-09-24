// All of the solar imagery, loaded in the background from the moment the app
// opens, so the sunspot tracker, SUVI and the coronagraphs play straight
// away when someone gets to them.
//
// What is loaded, in order:
//   1. What each panel shows first: the sunspot tracker's default 12 hours,
//      and the last 3 hours of the default SUVI channel and coronagraph.
//   2. The sunspot tracker's full week, sharp frames and scrubbing previews.
//   3. Every frame the SUVI and coronagraph workers hold, for every channel
//      and instrument, newest first.
//
// It stays out of the way: it starts once the first screen is up, loads
// three images at a time at low priority, pauses while the app is in the
// background, and loads nothing into memory - the images go to the
// browser's cache, and a panel decodes one only when it shows it. With the
// browser's Data Saver on, or on a 2G connection, it loads nothing; on a
// connection the browser reports as cellular, only step 1.
//
// Each image is requested exactly as its panel requests it - the same
// address and the same CORS mode - or the browser would not reuse it.

import { fetchHmiFrames, type HmiFrame } from './hmiArchive';
import { proxyImageUrl } from './imagePixels';

const CORONAGRAPHY_WORKER_BASE = 'https://coronagraphy-processing.thenamesrock.workers.dev';
const SUVI_DIFF_WORKER_BASE = 'https://suvi-difference-imagery.thenamesrock.workers.dev';

/** Must match the sunspot tracker's archive frame cache lifetime. */
export const ARCHIVE_IMAGE_TTL_S = 7 * 24 * 3600;

/** Must match the panels' defaults. */
const DEFAULT_SUVI_SOURCE = 'suvi_131_secondary';
const DEFAULT_CORONAGRAPH_SOURCE = 'ccor1';
const DEFAULT_SPOT_WINDOW_H = 12;
const FIRST_LOOK_H = 3;

const CONCURRENCY = 3;

/**
 * SUVI and coronagraph frames loaded with CORS, which the panels read to
 * tell whether a frame needs its loading spinner.
 */
export const preloadedImageUrls = new Set<string>();

interface WorkerFrame { ts?: string | null; url?: string | null }
interface WorkerState { ok?: boolean; sources?: Record<string, { frames?: WorkerFrame[] } | undefined> }

type Job = { url: string; cors: boolean };

const resolve = (base: string, url: string) =>
  url.startsWith('http://') || url.startsWith('https://') ? url : `${base}${url.startsWith('/') ? '' : '/'}${url}`;

/** How much the connection should carry: everything, the first look only, or nothing. */
function allowance(): 'all' | 'first' | 'none' {
  const c = (navigator as any).connection;
  if (!c) return 'all';
  if (c.saveData) return 'none';
  if (/(^|-)2g$/.test(String(c.effectiveType ?? ''))) return 'none';
  if (c.type === 'cellular') return 'first';
  return 'all';
}

const seen = new Set<string>();
const queue: Job[] = [];
let running = 0;

function enqueue(jobs: Job[]) {
  for (const j of jobs) {
    if (seen.has(j.url)) continue;
    seen.add(j.url);
    queue.push(j);
  }
  pump();
}

function pump() {
  if (typeof document !== 'undefined' && document.hidden) return;
  while (running < CONCURRENCY && queue.length) {
    const job = queue.shift()!;
    running++;
    load(job).finally(() => { running--; pump(); });
  }
}

function load({ url, cors }: Job): Promise<void> {
  return new Promise((done) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    (img as any).fetchPriority = 'low';
    img.onload = () => { if (cors) preloadedImageUrls.add(url); done(); };
    img.onerror = () => done();
    img.src = url;
  });
}

/** Newest first: a panel opens on now. */
function workerJobs(base: string, frames: WorkerFrame[] | undefined, sinceMs = -Infinity): Job[] {
  return (frames ?? [])
    .filter((f) => f.url && (!f.ts || Date.parse(f.ts) >= sinceMs))
    .sort((a, b) => Date.parse(b.ts ?? '') - Date.parse(a.ts ?? ''))
    .map((f) => ({ url: resolve(base, f.url as string), cors: true }));
}

const spotJobs = (frames: HmiFrame[], previews: boolean): Job[] =>
  [...frames].reverse().flatMap((f) => [
    { url: proxyImageUrl(f.url, ARCHIVE_IMAGE_TTL_S), cors: false },
    ...(previews && f.preview ? [{ url: proxyImageUrl(f.preview, ARCHIVE_IMAGE_TTL_S), cors: false }] : []),
  ]);

/** Takes one frame from each list in turn, so no channel waits on another. */
function interleave(lists: Job[][]): Job[] {
  const out: Job[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length) out.push(l[i]);
  }
  return out;
}

let started = false;

export function startImageryPreload(state: {
  coronagraph: Promise<WorkerState | null> | null;
  suvi: Promise<WorkerState | null> | null;
}) {
  if (started || typeof window === 'undefined') return;
  started = true;
  if (new URLSearchParams(window.location.search).has('embed')) return;
  const allow = allowance();
  if (allow === 'none') return;

  document.addEventListener('visibilitychange', pump);

  void (async () => {
    const now = Date.now();
    const firstLook = now - FIRST_LOOK_H * 3600000;
    const [spotDefault, suvi, corona] = await Promise.all([
      fetchHmiFrames('colorized', now - DEFAULT_SPOT_WINDOW_H * 3600000, now).catch(() => []),
      state.suvi?.catch(() => null) ?? null,
      state.coronagraph?.catch(() => null) ?? null,
    ]);
    const suviSources = suvi?.ok ? suvi.sources ?? {} : {};
    const coronaSources = corona?.ok ? corona.sources ?? {} : {};

    // 1. What each panel opens on.
    enqueue(spotJobs(spotDefault, false));
    enqueue(interleave([
      workerJobs(SUVI_DIFF_WORKER_BASE, suviSources[DEFAULT_SUVI_SOURCE]?.frames, firstLook),
      workerJobs(CORONAGRAPHY_WORKER_BASE, coronaSources[DEFAULT_CORONAGRAPH_SOURCE]?.frames, firstLook),
    ]));
    if (allow !== 'all') return;

    // 2. The sunspot tracker's week.
    const spotWeek = await fetchHmiFrames('colorized', now - 7 * 24 * 3600000, now).catch(() => []);
    enqueue(spotJobs(spotWeek, true));

    // 3. Everything the imagery workers hold.
    enqueue(interleave([
      ...Object.values(suviSources).map((s) => workerJobs(SUVI_DIFF_WORKER_BASE, s?.frames)),
      ...Object.values(coronaSources).map((s) => workerJobs(CORONAGRAPHY_WORKER_BASE, s?.frames)),
    ]));
  })();
}
