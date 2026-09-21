// Giving a coronal hole a name that sticks.
//
// The detector renumbers from zero every frame, and buildChTracks only knows
// about the frames it was handed, so a track's key changes whenever the window
// changes or the page reloads. That is fine for grouping measurements and
// useless as a name: the hole somebody was watching as CH1 this morning is
// CH2 this afternoon because a new one appeared east of it.
//
// So the numbers live here instead, in a registry that outlasts any one set of
// frames. A hole keeps its number for as long as it keeps being found, and for
// a grace period after it stops - because a hole missing from one faint frame
// has not gone anywhere, and renaming it when it comes back is exactly the
// flicker this is here to stop.
//
// ON MATCHING THE PUBLISHED NUMBERS
// ─────────────────────────────────
// There is no authoritative catalogue to copy. NOAA does not number coronal
// holes at all - no SWPC product assigns them identifiers the way active
// regions get AR numbers. The numbers people quote come from whichever site
// they read, and each of those runs its own private sequence, so the same hole
// is a different number on each. Nothing can be fetched and matched.
//
// What can be done is to start our own sequence wherever it is useful for it
// to start, and then be consistent forever after. FIRST_CH_NUMBER is that
// choice.

import { longitudeAt } from './solarDisk';

/**
 * Where the numbering starts.
 *
 * Set to line up with the numbering already in use rather than starting at 1,
 * so a hole does not have two names on the same screen.
 */
export const FIRST_CH_NUMBER = 96;

/** How long a hole keeps its number after it was last seen. */
export const NUMBER_GRACE_MS = 12 * 3600 * 1000;

/**
 * How close, in degrees, a hole has to be to a remembered one to be it.
 *
 * Wider than the frame-to-frame match radius, because this is comparing
 * across hours rather than across minutes and a hole's centroid wanders as
 * its shape changes.
 */
export const REGISTRY_MATCH_DEG = 28;

export interface RegistryEntry {
  number: number;
  /** Where it was when last seen. */
  lat: number;
  lon: number;
  lastSeenMs: number;
  firstSeenMs: number;
}

export interface ChRegistry {
  nextNumber: number;
  entries: RegistryEntry[];
}

export const emptyRegistry = (): ChRegistry => ({ nextNumber: FIRST_CH_NUMBER, entries: [] });

export interface NumberableTrack {
  key: string;
  latest: { lat: number; lon: number };
  lastSeenMs: number;
  firstSeenMs: number;
}

export interface NumberingResult {
  /** Track key to the number it should be shown as. */
  numbers: Map<string, number>;
  registry: ChRegistry;
}

/**
 * Give every track a number, reusing the one it had last time.
 *
 * Both sides are carried forward to the same moment before being compared,
 * because a remembered hole has rotated since it was written down - about 13.2
 * degrees a day - and comparing raw longitudes would hand its number to
 * whatever else happens to be sitting where it used to be.
 */
export function assignChNumbers(
  tracks: NumberableTrack[],
  registry: ChRegistry,
  nowMs: number,
  graceMs: number = NUMBER_GRACE_MS,
): NumberingResult {
  const live: RegistryEntry[] = registry.entries
    .filter((e) => Number.isFinite(e.lastSeenMs) && nowMs - e.lastSeenMs <= graceMs)
    .map((e) => ({ ...e }));
  let nextNumber = Math.max(registry.nextNumber, FIRST_CH_NUMBER);

  // Biggest and most recently seen first, so when two tracks both fit one
  // remembered hole the more substantial one inherits the name.
  const ordered = [...tracks].sort((a, b) => b.lastSeenMs - a.lastSeenMs);

  const numbers = new Map<string, number>();
  const claimed = new Set<number>();

  for (const track of ordered) {
    const trackLon = longitudeAt(track.latest.lon, track.lastSeenMs, nowMs);

    let best: RegistryEntry | null = null;
    let bestDistance = REGISTRY_MATCH_DEG;
    for (const entry of live) {
      if (claimed.has(entry.number)) continue;
      const entryLon = longitudeAt(entry.lon, entry.lastSeenMs, nowMs);
      const distance = Math.hypot(entryLon - trackLon, entry.lat - track.latest.lat);
      if (distance < bestDistance) { bestDistance = distance; best = entry; }
    }

    if (best) {
      claimed.add(best.number);
      numbers.set(track.key, best.number);
      best.lat = track.latest.lat;
      best.lon = track.latest.lon;
      best.lastSeenMs = Math.max(best.lastSeenMs, track.lastSeenMs);
      best.firstSeenMs = Math.min(best.firstSeenMs, track.firstSeenMs);
    } else {
      const number = nextNumber++;
      claimed.add(number);
      numbers.set(track.key, number);
      live.push({
        number,
        lat: track.latest.lat,
        lon: track.latest.lon,
        lastSeenMs: track.lastSeenMs,
        firstSeenMs: track.firstSeenMs,
      });
    }
  }

  return {
    numbers,
    registry: { nextNumber, entries: live.sort((a, b) => a.number - b.number) },
  };
}

/** Parse a stored registry, falling back to an empty one rather than throwing. */
export function parseRegistry(raw: string | null): ChRegistry {
  if (!raw) return emptyRegistry();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.entries)) return emptyRegistry();
    const entries: RegistryEntry[] = parsed.entries.filter((e: any) =>
      Number.isFinite(e?.number) && Number.isFinite(e?.lat)
      && Number.isFinite(e?.lon) && Number.isFinite(e?.lastSeenMs));
    const highest = entries.reduce((m, e) => Math.max(m, e.number + 1), FIRST_CH_NUMBER);
    return {
      // Never reissue a number, even if the stored counter was behind.
      nextNumber: Math.max(Number(parsed.nextNumber) || FIRST_CH_NUMBER, highest),
      entries,
    };
  } catch {
    return emptyRegistry();
  }
}
