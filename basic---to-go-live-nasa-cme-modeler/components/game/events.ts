// --- START OF FILE src/components/game/events.ts ---
// Real storms, to be rebuilt from the Sun end.
//
// A note on the numbers. The flare class, the source region and the rough
// speeds are the published ones. The flux rope orientation and twist are not
// directly observable from the ground, so those are a reconstruction: the
// values that reproduce the observed outcome in this model. They are presented
// in the game as a target to land near, not as measured truth, and the wording
// in each event says so.

import type { FlareClass, StormInput } from './stormModel';

export interface HistoricEvent {
  id: string;
  date: string;
  name: string;
  hook: string;           // why this one is worth rebuilding
  whatHappened: string;   // shown after the attempt
  // The reconstruction the player is trying to land near.
  target: {
    flareClass: FlareClass; flareMag: number;
    lonDeg: number; latDeg: number;
    speedKms: number; halfWidthDeg: number;
    axialDeg: number; rotationDeg: number; ropeHours: number;
  };
  // Clues the player gets before they start, in the order they are revealed.
  clues: string[];
  moon: { illumination: number; up: boolean };
  // The hour in New Zealand the storm is meant to land, so timing is part of it.
  targetNZHour: number;
}

export const EVENTS: HistoricEvent[] = [
  {
    id: 'may-2024',
    date: '10 - 11 May 2024',
    name: 'The Mother’s Day storm',
    hook: 'The one that put aurora over Auckland. Active region 3664 threw everything it had at us across several days, and the clouds arrived stacked on top of each other.',
    whatHappened: 'Kp hit 9, the strongest storm in twenty years. Aurora was photographed the length of New Zealand and seen with the naked eye well into the North Island. The field at L1 reached about 70 nT with Bz down near -50, and it stayed south for hours rather than minutes. That persistence is what made it so extraordinary, not the speed on its own.',
    target: { flareClass: 'X', flareMag: 5.8, lonDeg: -5, latDeg: -17, speedKms: 1750, halfWidthDeg: 60, axialDeg: 175, rotationDeg: 40, ropeHours: 20 },
    clues: [
      'Active region 3664 was enormous, and almost dead centre on the disk.',
      'Several X class flares over three days, the largest around X5.',
      'The clouds merged on the way out and arrived together, faster than any of them left.',
      'The field stayed southward for most of a night, which is the rare part.',
    ],
    moon: { illumination: 12, up: false },
    targetNZHour: 23,
  },
  {
    id: 'oct-2024',
    date: '10 - 11 October 2024',
    name: 'The October surprise',
    hook: 'An X class flare from a region that was already on its way round, and a much better show than most people expected.',
    whatHappened: 'A severe storm, Kp 8 or so, with aurora seen across the South Island and into the lower North Island. Not a May 2024, but for a single cloud it delivered, largely because it arrived squarely and the field went south and stayed there.',
    target: { flareClass: 'X', flareMag: 1.8, lonDeg: 8, latDeg: 12, speedKms: 1500, halfWidthDeg: 50, axialDeg: 170, rotationDeg: 70, ropeHours: 15 },
    clues: [
      'X1.8, from a region just west of centre.',
      'It left the Sun quickly and lost less speed than usual on the way.',
      'The cloud hit almost square on.',
      'Field went south early in the cloud and held.',
    ],
    moon: { illumination: 62, up: true },
    targetNZHour: 22,
  },
  {
    id: 'apr-2023',
    date: '23 - 24 April 2023',
    name: 'The one nobody saw coming',
    hook: 'Forecast as a glancing blow. It turned into a severe storm and caught almost everyone at home in bed.',
    whatHappened: 'A G4 storm from a cloud that had been written off. The lesson in it is that the orientation of the field inside a cloud is very hard to know before it arrives, so a modest looking event can still deliver, and a big one can do nothing at all.',
    target: { flareClass: 'M', flareMag: 1.7, lonDeg: -12, latDeg: 20, speedKms: 900, halfWidthDeg: 55, axialDeg: 185, rotationDeg: 90, ropeHours: 16 },
    clues: [
      'Only an M class flare, and a filament eruption alongside it.',
      'Modest launch speed, a little over 900 km/s.',
      'Wide enough that it clipped us even though it was not aimed well.',
      'The field inside it was much more southward than anyone had predicted.',
    ],
    moon: { illumination: 26, up: false },
    targetNZHour: 1,
  },
  {
    id: 'mar-1989',
    date: '13 March 1989',
    name: 'The Quebec storm',
    hook: 'The storm that took down a power grid. Aurora was reported from the tropics.',
    whatHappened: 'Quebec lost its grid for nine hours. Aurora was seen far from the poles, into the Caribbean in the north and well up Australia in the south. It remains the benchmark for what a severe storm does to infrastructure, and it is why space weather is forecast at all.',
    target: { flareClass: 'X', flareMag: 4.5, lonDeg: 0, latDeg: -8, speedKms: 1900, halfWidthDeg: 65, axialDeg: 180, rotationDeg: 25, ropeHours: 22 },
    clues: [
      'A very large flare from a region facing straight at us.',
      'Extremely fast, and very wide.',
      'The field went hard south and simply stayed there.',
      'It arrived in the early hours, local time.',
    ],
    moon: { illumination: 42, up: false },
    targetNZHour: 3,
  },
  {
    id: 'carrington',
    date: '1 - 2 September 1859',
    name: 'Carrington',
    hook: 'The one every other storm is measured against. Transit from Sun to Earth in about seventeen hours.',
    whatHappened: 'Telegraph systems sparked and in some cases ran with the lines disconnected. Aurora was reported close to the equator. The transit time of roughly seventeen hours implies a launch speed at the very top of what has ever been recorded, and a path already cleared by an earlier cloud.',
    target: { flareClass: 'X', flareMag: 9.5, lonDeg: 0, latDeg: 0, speedKms: 2800, halfWidthDeg: 70, axialDeg: 180, rotationDeg: 15, ropeHours: 24 },
    clues: [
      'A white light flare, visible to the eye through a telescope. Nothing else like it has been recorded.',
      'Dead centre on the disk.',
      'Sun to Earth in about seventeen hours, which needs an enormous launch speed.',
      'A cloud a day earlier had already swept the path clear.',
    ],
    moon: { illumination: 20, up: false },
    targetNZHour: 2,
  },
];

// How close the player got, per control, on a 0 - 1 scale.
export function matchScore(target: HistoricEvent['target'], got: StormInput): {
  parts: { label: string; closeness: number; yours: string; actual: string }[];
  overall: number;
} {
  const near = (a: number, b: number, tolerance: number) =>
    Math.max(0, 1 - Math.abs(a - b) / tolerance);
  // Angles wrap, so compare the short way round.
  const nearAngle = (a: number, b: number, tolerance: number) => {
    let d = Math.abs(((a - b) % 360 + 540) % 360 - 180);
    d = 180 - d;
    return Math.max(0, 1 - d / tolerance);
  };

  const parts = [
    { label: 'Flare size', closeness: near(Math.log10(flareVal(target.flareClass, target.flareMag)), Math.log10(flareVal(got.flareClass, got.flareMag)), 1.2),
      yours: `${got.flareClass}${got.flareMag.toFixed(1)}`, actual: `${target.flareClass}${target.flareMag.toFixed(1)}` },
    { label: 'Where on the disk', closeness: near(Math.hypot(target.lonDeg - got.lonDeg, target.latDeg - got.latDeg), 0, 55),
      yours: `${Math.round(got.lonDeg)}°, ${Math.round(got.latDeg)}°`, actual: `${Math.round(target.lonDeg)}°, ${Math.round(target.latDeg)}°` },
    { label: 'Launch speed', closeness: near(target.speedKms, got.speedKms, 700),
      yours: `${Math.round(got.speedKms)} km/s`, actual: `${Math.round(target.speedKms)} km/s` },
    { label: 'Cloud width', closeness: near(target.halfWidthDeg, got.halfWidthDeg, 40),
      yours: `${Math.round(got.halfWidthDeg)}°`, actual: `${Math.round(target.halfWidthDeg)}°` },
    { label: 'Field direction', closeness: nearAngle(target.axialDeg, got.axialDeg, 70),
      yours: `${Math.round(got.axialDeg)}°`, actual: `${Math.round(target.axialDeg)}°` },
    { label: 'How much it turns', closeness: near(target.rotationDeg, got.rotationDeg, 130),
      yours: `${Math.round(got.rotationDeg)}°`, actual: `${Math.round(target.rotationDeg)}°` },
  ];
  const overall = parts.reduce((s, p) => s + p.closeness, 0) / parts.length;
  return { parts, overall };
}

function flareVal(cls: FlareClass, mag: number): number {
  return (cls === 'X' ? 100 : cls === 'M' ? 10 : 1) * mag;
}
// --- END OF FILE src/components/game/events.ts ---
