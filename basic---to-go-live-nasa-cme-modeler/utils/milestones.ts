// Who sees the page-view milestone celebration, and which version.
//
//   84,400, and 100,000 to 900,000 every 100,000: only the visitor whose view made the
//   number. The page-views worker counts views one at a time and answers each
//   with the all-time count after counting it, so exactly one answer reads
//   100,000, and that visitor is the one.
//
//   1,000,000: the visitor whose view made it gets the same "you're the
//   1,000,000th" screen. Everyone else gets "Spot The Aurora just hit
//   1,000,000 views", once, the first time they open the app after it - for a
//   couple of months, after which it is old news.
//
// Each is shown once per browser. To preview: ?celebrate=100k (or 200k ...
// 900k, 1m, or 84400) for the personal screen, ?celebrate=1m-everyone for the other.

import type { PageViewStats } from './pageViews';

export const MILESTONE_STEP = 100000;
export const MILLION = 1000000;
// One-off numbers celebrated like the round hundred thousands.
export const EXTRA_MILESTONES = [84400];
const SHOW_MILLION_FOR_MS = 60 * 86400000;

export type Celebration = { target: number; mode: 'personal' | 'everyone'; preview?: boolean };

const seenKey = (c: Celebration) => `sta_milestone_${c.target}_${c.mode}_seen_v1`;

// Read when the app starts: it tidies the address on load, which drops the
// query before anything mounted could read it.
const startSearch = (() => { try { return window.location.search; } catch { return ''; } })();

function preview(): Celebration | null {
  try {
    const q = (new URLSearchParams(startSearch || window.location.search).get('celebrate') || '').toLowerCase();
    if (q === '1m-everyone') return { target: MILLION, mode: 'everyone', preview: true };
    if (/^\d+$/.test(q) && EXTRA_MILESTONES.includes(Number(q))) return { target: Number(q), mode: 'personal', preview: true };
    const m = q.match(/^(\d)00k$|^(1)m$/);
    if (!m) return null;
    return { target: m[2] ? MILLION : Number(m[1]) * MILESTONE_STEP, mode: 'personal', preview: true };
  } catch {
    return null;
  }
}

function seen(c: Celebration): boolean {
  try { return localStorage.getItem(seenKey(c)) === '1'; } catch { return true; }
}

/** The celebration this answer from the counter calls for, or null. Pass null for a preview check only. */
export function celebrationFor(stats: PageViewStats | null): Celebration | null {
  const p = preview();
  if (p) return p;
  if (!stats) return null;

  const n = stats.lifetime;
  if (EXTRA_MILESTONES.includes(n) || (n >= MILESTONE_STEP && n <= MILLION && n % MILESTONE_STEP === 0)) {
    const mine: Celebration = { target: n, mode: 'personal' };
    return seen(mine) ? null : mine;
  }
  if (stats.millionAt && Date.now() - stats.millionAt < SHOW_MILLION_FOR_MS) {
    const all: Celebration = { target: MILLION, mode: 'everyone' };
    // The millionth visitor has had theirs already.
    if (seen(all) || seen({ target: MILLION, mode: 'personal' })) return null;
    return all;
  }
  return null;
}

export function markCelebrated(c: Celebration): void {
  // A preview is a look, and must not use up the real thing.
  if (c.preview) return;
  try { localStorage.setItem(seenKey(c), '1'); } catch { /* storage blocked */ }
}
