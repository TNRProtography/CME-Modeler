// --- START OF FILE src/components/game/progress.ts ---
// Ranks, experience and the daily streak, all kept on the device. No account,
// no server, nothing to sign up for. Clearing your browser loses it, which is
// the trade for not asking anyone to register to play a game about the sky.

const KEY = 'sta-storm-builder-v1';

export interface Progress {
  xp: number;
  bestScore: number;
  played: number;
  streak: number;
  bestStreak: number;
  lastDailyKey: string | null;   // the day key of the last daily completed
  dailyScores: Record<string, number>;
  seenEvents: string[];          // ids of historical storms already rebuilt
}

const EMPTY: Progress = {
  xp: 0, bestScore: 0, played: 0, streak: 0, bestStreak: 0,
  lastDailyKey: null, dailyScores: {}, seenEvents: [],
};

export interface Rank { name: string; at: number; blurb: string; }

// Deliberately understated. Nobody needs to be told they are a legend for
// tapping a slider, and the names should mean something to a chaser.
export const RANKS: Rank[] = [
  { name: 'Cloud Watcher',   at: 0,    blurb: 'Everyone starts here, usually under cloud.' },
  { name: 'Porch Checker',   at: 250,  blurb: 'You have started looking south before bed.' },
  { name: 'Gate Opener',     at: 700,  blurb: 'You know which paddock has the clear southern horizon.' },
  { name: 'Bz Watcher',      at: 1500, blurb: 'You check the field direction before the score.' },
  { name: 'Substorm Reader', at: 2800, blurb: 'You wait through the quiet bit, because you know what it means.' },
  { name: 'Chaser',          at: 4800, blurb: 'You have driven a long way on a maybe, and been right.' },
  { name: 'Forecaster',      at: 7500, blurb: 'You can read an arrival before it lands.' },
  { name: 'Storm Builder',   at: 11000, blurb: 'You know what the Sun has to do to put light over Dunedin.' },
];

export function rankFor(xp: number): { rank: Rank; next: Rank | null; toNext: number; progress: number } {
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) if (xp >= RANKS[i].at) idx = i;
  const rank = RANKS[idx];
  const next = idx + 1 < RANKS.length ? RANKS[idx + 1] : null;
  const toNext = next ? next.at - xp : 0;
  const span = next ? next.at - rank.at : 1;
  return { rank, next, toNext, progress: next ? (xp - rank.at) / span : 1 };
}

export function load(): Progress {
  if (typeof localStorage === 'undefined') return { ...EMPTY };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    return { ...EMPTY, ...JSON.parse(raw) };
  } catch { return { ...EMPTY }; }
}

export function save(p: Progress): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode, nothing to do */ }
}

// The day key is the New Zealand date, so the daily rolls over at local
// midnight rather than at some hour that means nothing to anyone here.
export function dayKey(ms = Date.now()): string {
  const d = new Date(ms);
  const month = d.getUTCMonth();
  const offset = month >= 8 || month <= 2 ? 13 : 12;
  const local = new Date(ms + offset * 3_600_000);
  return local.toISOString().slice(0, 10);
}

function previousDayKey(key: string): string {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function recordDaily(p: Progress, score: number, xp: number): Progress {
  const key = dayKey();
  if (p.lastDailyKey === key) return p;    // one a day, no farming it
  const continues = p.lastDailyKey === previousDayKey(key);
  const streak = continues ? p.streak + 1 : 1;
  const next: Progress = {
    ...p,
    xp: p.xp + xp,
    played: p.played + 1,
    bestScore: Math.max(p.bestScore, score),
    streak,
    bestStreak: Math.max(p.bestStreak, streak),
    lastDailyKey: key,
    dailyScores: { ...p.dailyScores, [key]: score },
  };
  save(next);
  return next;
}

export function recordRun(p: Progress, score: number, xp: number, eventId?: string): Progress {
  const next: Progress = {
    ...p,
    xp: p.xp + xp,
    played: p.played + 1,
    bestScore: Math.max(p.bestScore, score),
    seenEvents: eventId && !p.seenEvents.includes(eventId) ? [...p.seenEvents, eventId] : p.seenEvents,
  };
  save(next);
  return next;
}

// A streak only survives if you played yesterday. Checked on open so the menu
// can show an honest number rather than one that quietly keeps counting.
export function streakStanding(p: Progress): { alive: boolean; playedToday: boolean } {
  const key = dayKey();
  if (p.lastDailyKey === key) return { alive: true, playedToday: true };
  if (p.lastDailyKey === previousDayKey(key)) return { alive: true, playedToday: false };
  return { alive: false, playedToday: false };
}
// --- END OF FILE src/components/game/progress.ts ---
