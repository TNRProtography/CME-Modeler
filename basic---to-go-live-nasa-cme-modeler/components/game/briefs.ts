// --- START OF FILE src/components/game/briefs.ts ---
// The briefs. Each one is a job: put aurora of a given quality over a given
// town, at a given time of night, with the Moon doing whatever it is doing.
//
// Three levers decide whether you pull it off, and each teaches a different
// link in the chain. Aim it, or it misses entirely. Choose a speed, which sets
// how long it takes to get here and therefore whether it lands in darkness.
// Set the twist, which decides whether the field arrives southward and so
// whether any of it counts.

import {
  NZ_PLACES, TIER_RANK, clamp, darknessAt, tierFor,
  type MoonState, type Place, type StormResult, type Tier,
} from './stormModel';

export interface Brief {
  id: string;
  title: string;
  target: Place;
  tier: Tier;
  /** Local New Zealand hour the storm has to land inside. */
  window: { fromHour: number; toHour: number };
  moon: MoonState;
  launchMs: number;
  note: string;
}

// A small deterministic generator, so everyone gets the same daily brief and
// replaying it gives the same job rather than a fresh roll of the dice.
export function seededRandom(seedStr: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5; h |= 0;
    return ((h >>> 0) % 100000) / 100000;
  };
}

const TIER_ASK: { tier: Tier; text: string }[] = [
  { tier: 'camera', text: 'enough for a long exposure' },
  { tier: 'phone',  text: 'enough for a phone on night mode' },
  { tier: 'eye',    text: 'visible to the naked eye' },
];

export function makeBrief(seed: string, launchMs = Date.now()): Brief {
  const r = seededRandom(seed);
  // Weighted toward the South Island, because that is where most of this
  // happens, but the north comes up often enough to be worth aiming for.
  const pool = r() < 0.72 ? NZ_PLACES.filter(p => p.island === 'S') : NZ_PLACES;
  const target = pool[Math.floor(r() * pool.length)];
  // Harder asks for places further north, because they need a bigger storm.
  const northness = clamp((Math.abs(target.lat) - 36) / 11, 0, 1);
  const askIdx = northness > 0.7 ? Math.floor(r() * 2) : Math.floor(r() * 3);
  const ask = TIER_ASK[clamp(askIdx, 0, 2)];

  const fromHour = 21 + Math.floor(r() * 4);      // 21:00 to 00:00
  const toHour = (fromHour + 3 + Math.floor(r() * 2)) % 24;

  const moonUp = r() < 0.55;
  const illumination = Math.round(r() * 100);

  return {
    id: seed,
    title: `${ask.text.charAt(0).toUpperCase()}${ask.text.slice(1)} over ${target.name}`,
    target, tier: ask.tier,
    window: { fromHour, toHour },
    moon: { illumination, up: moonUp },
    launchMs,
    note: moonUp && illumination > 60
      ? `The Moon is ${illumination}% and up, so it will wash out anything faint. You will need more than you think.`
      : moonUp
        ? `The Moon is up but only ${illumination}%, so it will not cost you much.`
        : 'No Moon to worry about, which makes the faint stuff count.',
  };
}

export interface BriefOutcome {
  hit: boolean;
  inWindow: boolean;
  achieved: Tier;
  score: number;      // 0 - 100
  xp: number;
  lines: string[];    // what went right and wrong, in plain words
}

function hourInWindow(h: number, from: number, to: number): boolean {
  return from <= to ? h >= from && h <= to : h >= from || h <= to;
}

export function gradeBrief(brief: Brief, res: StormResult, nzHour: number): BriefOutcome {
  const lines: string[] = [];

  if (!res.hits) {
    return { hit: false, inWindow: false, achieved: 'nothing', score: 0, xp: 5,
             lines: [res.missReason || 'It missed.', 'Aim closer to the middle of the disk, or make the cloud wider.'] };
  }

  const inWindow = hourInWindow(nzHour, brief.window.fromHour, brief.window.toHour);
  const achieved = tierFor(brief.target.lat, res.bestVisibleKp, brief.moon,
                           darknessAt(res.bestVisibleAtMs));

  const want = TIER_RANK[brief.tier], got = TIER_RANK[achieved];
  const hit = got >= want && inWindow;

  // Landing the right strength is most of it, landing it in the dark and in
  // the window is the rest. Overshooting by a mile is not free: a Carrington
  // to light up Invercargill is a waste of a good active region.
  let score = 0;
  const strength = got >= want ? 1 : Math.max(0, 1 - (want - got) * 0.42);
  score += strength * 62;
  score += inWindow ? 28 : Math.max(0, 28 - 9 * hoursOutside(nzHour, brief.window));
  const overshoot = Math.max(0, got - want);
  score += overshoot === 0 ? 10 : overshoot === 1 ? 6 : 2;
  score = clamp(Math.round(score), 0, 100);

  if (got >= want) lines.push(`${brief.target.name} got ${tierPhrase(achieved)}, which meets the brief.`);
  else lines.push(`${brief.target.name} only got ${tierPhrase(achieved)}. The brief asked for ${tierPhrase(brief.tier)}.`);

  if (inWindow) lines.push(`It peaked at ${fmtHour(nzHour)}, inside the window.`);
  else lines.push(`It peaked at ${fmtHour(nzHour)}, outside the ${fmtHour(brief.window.fromHour)} to ${fmtHour(brief.window.toHour)} window. Speed decides the transit time, so that is the lever.`);

  if (res.minBz > -5) lines.push('The field never really went south, so almost nothing coupled in. That is the whole game.');
  else if (overshoot >= 2) lines.push('Far more storm than the job needed, which is worth knowing too.');

  return { hit, inWindow, achieved, score, xp: 25 + Math.round(score * 1.4), lines };
}

function hoursOutside(h: number, w: { fromHour: number; toHour: number }): number {
  if (hourInWindow(h, w.fromHour, w.toHour)) return 0;
  const d = (a: number, b: number) => { const x = Math.abs(a - b) % 24; return Math.min(x, 24 - x); };
  return Math.min(d(h, w.fromHour), d(h, w.toHour));
}

function tierPhrase(t: Tier): string {
  return t === 'eye' ? 'naked eye aurora'
    : t === 'phone' ? 'a phone camera shot'
    : t === 'camera' ? 'a long exposure'
    : 'nothing at all';
}

export function fmtHour(h: number): string {
  const hh = Math.floor(h) % 24;
  const ampm = hh < 12 ? 'am' : 'pm';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}${ampm}`;
}
// --- END OF FILE src/components/game/briefs.ts ---
