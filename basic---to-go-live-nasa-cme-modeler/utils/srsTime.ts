// When the positions in a NOAA Solar Region Summary were actually measured.
//
// The SRS is issued once a day at 0030 UT and its positions are "valid at
// 2400Z" on the previous day - the header says so in words:
//
//   :Issued: 2026 Sep 22 0030 UTC
//   ...
//   I.  Regions with Sunspots.  Locations Valid at 21/2400Z
//
// That time matters more than it looks. The Sun turns 13.2 degrees a day, so
// a position read as "measured now" when it was measured seventeen hours ago
// puts every label about nine degrees east of the spot it names. The tracker
// did exactly that: the text rows carried no time, and the merge fell back to
// Date.now().

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/** The time the positions in an SRS text are valid for, or null if unreadable. */
export function parseSrsValidTime(text: string): number | null {
  const issued = text.match(/:Issued:\s*(\d{4})\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2})(\d{2})\s*UTC/i);
  if (!issued) return null;
  const year = Number(issued[1]);
  const month = MONTHS[issued[2].toUpperCase()];
  const issuedDay = Number(issued[3]);
  if (month === undefined) return null;

  const valid = text.match(/Valid\s+at\s+(\d{1,2})\/(\d{2})(\d{2})Z/i);
  if (valid) {
    const day = Number(valid[1]);
    // "Valid at 30/2400Z" in an SRS issued on the 1st belongs to the month
    // before. Date.UTC handles day 0 and hour 24 as rollovers, so only the
    // month needs deciding.
    const m = day > issuedDay ? month - 1 : month;
    return Date.UTC(year, m, day, Number(valid[2]), Number(valid[3]));
  }

  // No validity line: the bulletin is always issued half an hour after the
  // positions it reports, so that is the next best answer.
  return Date.UTC(year, month, issuedDay, Number(issued[4]), Number(issued[5])) - 30 * 60000;
}

/**
 * The most recent 0000 UT, for a bulletin whose header could not be read.
 *
 * SRS positions are always valid at 2400Z, so this is almost always right -
 * and it is far closer than "now", which was the old fallback and is wrong by
 * however much of the day has passed.
 */
export function latestSrsEpoch(nowMs: number = Date.now()): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
