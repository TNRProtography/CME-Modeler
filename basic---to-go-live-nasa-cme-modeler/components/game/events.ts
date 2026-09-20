// --- START OF FILE src/components/game/events.ts ---
// Real storms, to be rebuilt from the Sun end.
//
// Every figure below is either published or derived from a published one, and
// each is tagged so the game can say which is which rather than presenting all
// of it as measured truth.
//
//   'measured'  taken straight from the record: flare class, active region,
//               where it was on the disk, how many clouds went out.
//   'derived'   solved backwards from a published Sun-to-Earth transit time
//               using the same propagation model the visualisation draws with,
//               so the cloud reaches Earth when the real one did.
//   'estimated' not observable from the ground before it arrives. The twist of
//               the rope is the honest example: nobody knows it until it is
//               already going past.
//
// Sources, per event:
//   May 2024   NOAA SWPC and the published storm summaries. Region 13664 at
//              S19W34, flares X1.0 on 8 May, X2.25 and X1.12 on 9 May, X3.98 on
//              10 May, X5.4-5.7 on 11 May. At least seven CMEs, full halos.
//              Kp 9, Dst -412 nT, Bt 73 nT, Bz -50 nT, wind 750-950 km/s.
//   Oct 2024   X1.8 from region 3848 at 01:56 UT on 9 October, near disk
//              centre, full halo near 1200-1300 km/s. Shock 10 October
//              14:48 UT. Kp 8, Dst about -341 nT.
//   Apr 2023   M1.7 from region 13283 near disk centre at about 18:00 UT on
//              21 April with a filament eruption, full halo near 1500 km/s.
//              Shock 23 April 07:30 UT. Kp 8, Dst -212 nT.
//   Mar 1989   Two clouds: X4.5 on 10 March, transit 54.5 h, and M7.3 on
//              12 March, transit 31.5 h with a shock speed of 1320 km/s.
//              Kp 9, Dst -589 nT.
//   1859       Transit about 17.6 h. Dst estimates have come down over time
//              from -1760 nT to roughly -900 nT.

import type { CloudSpec, FlareClass, StormInput } from './stormModel';
import { STORM_DATA } from './stormData';

export type Provenance = 'measured' | 'derived' | 'estimated';

export interface HistoricEvent {
  id: string;
  date: string;
  name: string;
  hook: string;           // why this one is worth rebuilding
  whatHappened: string;   // shown after the attempt
  /** The rope inside the cloud that did the damage. Not observable before it
   *  arrives, so always an estimate. */
  rope: { axialDeg: number; rotationDeg: number; ropeHours: number; filament: boolean };
  /** Where each of those numbers came from. */
  provenance: Record<'flare' | 'position' | 'speed' | 'width' | 'count' | 'filament' | 'rope', Provenance>;
  /** What the transit and the storm actually were, for the write-up. */
  facts: { transitHours: number; kp: number; dst: number; note: string };
  clues: string[];
  moon: { illumination: number; up: boolean };
  targetNZHour: number;
}

export const EVENTS: HistoricEvent[] = [
  {
    id: 'may-2024',
    rope: { axialDeg: 178, rotationDeg: 35, ropeHours: 20, filament: false },
    date: '10 - 11 May 2024',
    name: 'The Gannon storm',
    hook: 'The one that put aurora over Auckland. Region 13664 threw seven clouds at us across three days and they arrived stacked on top of each other. It is the first geomagnetic storm ever given a name.',
    whatHappened: 'Kp reached 9 and Dst bottomed out at -412 nT, the strongest storm in twenty years. The field at L1 reached 73 nT with Bz down near -50, and the wind was running between 750 and 950 km/s. Aurora was photographed the length of New Zealand and seen with the naked eye well into the North Island. What made it extraordinary was not any single cloud but that there were seven of them, compressing each other on the way out, and that the field stayed south for hours rather than minutes. It is named for Dr Jennifer Lea Gannon, a space weather scientist who worked on geomagnetically induced currents and on the ground disturbances that storms like this one cause. She died suddenly on 2 May 2024, eight days before it arrived, and the community named the storm after her. No geomagnetic storm had been given a name before.',
    provenance: { flare: 'measured', position: 'measured', speed: 'derived', width: 'measured', count: 'measured', filament: 'measured', rope: 'estimated' },
    facts: { transitHours: 31.4, kp: 9, dst: -412, note: 'Bt 73 nT, Bz -50 nT, wind 750-950 km/s' },
    clues: [
      'Region 13664 was enormous, and sat at S19W34 when the run started.',
      'Flares right through it: X1.0, then X2.25 and X1.12, then X3.98, then X5.4 or so.',
      'At least seven clouds went out over three days, every one of them a full halo.',
      'They piled into each other on the way, and the first shock took about 31 hours.',
    ],
    moon: { illumination: 12, up: false },
    targetNZHour: 22,
  },
  {
    id: 'oct-2024',
    rope: { axialDeg: 172, rotationDeg: 65, ropeHours: 15, filament: false },
    date: '10 - 11 October 2024',
    name: 'The October surprise',
    hook: 'One cloud, thrown hard and straight, and a far better show than a single X1 has any right to produce.',
    whatHappened: 'Kp 8 and Dst near -341 nT, from one cloud rather than a train of them. Aurora was seen across the South Island and into the lower North Island. It delivered because it left quickly, it was aimed squarely, and the field went south and stayed there. A rare, clean, fast full halo.',
    provenance: { flare: 'measured', position: 'measured', speed: 'derived', width: 'measured', count: 'measured', filament: 'measured', rope: 'estimated' },
    facts: { transitHours: 36.9, kp: 8, dst: -341, note: 'X1.8 at 01:56 UT on 9 October, shock at 14:48 UT on 10 October' },
    clues: [
      'X1.8 from region 3848, near the middle of the disk.',
      'A single cloud, not a run of them.',
      'A full halo, and a fast one, around 1200 to 1300 km/s.',
      'Sun to Earth in about 37 hours.',
    ],
    moon: { illumination: 62, up: true },
    targetNZHour: 22,
  },
  {
    id: 'apr-2023',
    rope: { axialDeg: 186, rotationDeg: 85, ropeHours: 16, filament: true },
    date: '23 - 24 April 2023',
    name: 'The one nobody saw coming',
    hook: 'Only an M1.7, with a filament going up alongside it. It turned into the first severe storm of the cycle and caught almost everyone at home in bed.',
    whatHappened: 'Kp 8 and Dst -212 nT from a flare that barely rated a mention. The published analysis says as much in so many words: the speed and the mass gave no indication it could do this. The lesson in it is that the twist of the field inside a cloud is not observable before it arrives, so a modest looking event can still deliver, and a very big one can do nothing at all.',
    provenance: { flare: 'measured', position: 'measured', speed: 'derived', width: 'measured', count: 'measured', filament: 'measured', rope: 'estimated' },
    facts: { transitHours: 37.5, kp: 8, dst: -212, note: 'M1.7 with a filament eruption, about 18:00 UT on 21 April, shock at 07:30 UT on 23 April' },
    clues: [
      'Only an M1.7, from region 13283 near the middle of the disk.',
      'A filament went up with it, which is where most of the cloud came from.',
      'One cloud, a full halo, fast for its class at around 1500 km/s.',
      'Sun to Earth in about 37 and a half hours, and the field was far more southward than anyone had predicted.',
    ],
    moon: { illumination: 26, up: false },
    targetNZHour: 1,
  },
  {
    id: 'mar-1989',
    rope: { axialDeg: 180, rotationDeg: 25, ropeHours: 22, filament: false },
    date: '13 March 1989',
    name: 'The Quebec storm',
    hook: 'Two clouds, two days apart, and a power grid on the floor. Aurora was reported from the tropics.',
    whatHappened: 'Kp 9 and Dst -589 nT, deeper than May 2024. Quebec lost its grid for nine hours. Two clouds drove it: an X4.5 on 10 March that took 54 and a half hours to get here, and an M7.3 on 12 March that took 31 and a half, arriving at 1320 km/s into a path the first had already cleared. It is still the benchmark for what a severe storm does to infrastructure, and it is why space weather is forecast at all.',
    provenance: { flare: 'measured', position: 'estimated', speed: 'derived', width: 'estimated', count: 'measured', filament: 'measured', rope: 'estimated' },
    facts: { transitHours: 31.5, kp: 9, dst: -589, note: 'First cloud 54.5 h from the X4.5 on 10 March, second 31.5 h from the M7.3 on 12 March at 1320 km/s' },
    clues: [
      'Two clouds, two days apart, the first an X4.5 and the second an M7.3.',
      'The first took 54 and a half hours. It cleared the path.',
      'The second came through that cleared path in 31 and a half, arriving at 1320 km/s.',
      'The field went hard south and simply stayed there. It arrived in the early hours, local time.',
    ],
    moon: { illumination: 42, up: false },
    targetNZHour: 3,
  },
  {
    id: 'carrington',
    rope: { axialDeg: 180, rotationDeg: 15, ropeHours: 24, filament: false },
    date: '1 - 2 September 1859',
    name: 'Carrington',
    hook: 'The one every other storm is measured against. Sun to Earth in about seventeen and a half hours.',
    whatHappened: 'Telegraph systems sparked, and in some cases ran with their batteries disconnected. Aurora was reported close to the equator. The transit of about 17.6 hours needs a launch speed at the very top of what has ever been recorded, and a path already swept clear by a cloud the day before. Estimates of how deep it went have come down over the years, from -1760 nT to something nearer -900, which tells you how much of this is inference rather than measurement.',
    provenance: { flare: 'estimated', position: 'estimated', speed: 'derived', width: 'estimated', count: 'measured', filament: 'measured', rope: 'estimated' },
    facts: { transitHours: 17.6, kp: 9, dst: -900, note: 'Dst estimates range from about -900 nT to -1760 nT' },
    clues: [
      'A white light flare, visible to the eye through a telescope. Nothing else like it has been recorded.',
      'A cloud the day before had already swept the path clear, so count two.',
      'Sun to Earth in about seventeen and a half hours, which needs an enormous launch speed.',
      'Near the middle of the disk, and the field stayed south throughout.',
    ],
    moon: { illumination: 20, up: false },
    targetNZHour: 2,
  },
];

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  measured:  'from the record',
  derived:   'solved from the published transit time',
  estimated: 'not observable beforehand, so this is an estimate',
};

/** The storm as it really was, ready to run through the model. */
export function targetInput(ev: HistoricEvent, launchMs: number): StormInput {
  return { clouds: STORM_DATA[ev.id].clouds, ...ev.rope, launchMs };
}

/** The cloud that did most of the work, which is the one to compare against. */
export function dominantCloud(ev: HistoricEvent): CloudSpec {
  const clouds = STORM_DATA[ev.id].clouds;
  return clouds.reduce((a, b) => (flareVal(b.flareClass, b.flareMag) > flareVal(a.flareClass, a.flareMag) ? b : a), clouds[0]);
}

export function dataSourceFor(ev: HistoricEvent) { return STORM_DATA[ev.id]; }

// How close the player got, per control, on a 0 - 1 scale. The player builds
// one cloud and sends a run of them, so the comparison is against the biggest
// cloud in the real run, plus how many there were.
export function matchScore(ev: HistoricEvent, got: StormInput): {
  parts: { label: string; closeness: number; yours: string; actual: string; from: Provenance }[];
  overall: number;
} {
  const data = STORM_DATA[ev.id];
  const target = dominantCloud(ev);
  const mine = got.clouds[0];
  const near = (a: number, b: number, tolerance: number) =>
    Math.max(0, 1 - Math.abs(a - b) / tolerance);
  // Angles wrap, so compare the short way round.
  const nearAngle = (a: number, b: number, tolerance: number) => {
    const d = 180 - Math.abs(((a - b) % 360 + 540) % 360 - 180);
    return Math.max(0, 1 - d / tolerance);
  };

  const parts = [
    { label: 'Biggest flare', from: ev.provenance.flare,
      closeness: near(Math.log10(flareVal(target.flareClass, target.flareMag)), Math.log10(flareVal(mine.flareClass, mine.flareMag)), 1.2),
      yours: `${mine.flareClass}${mine.flareMag.toFixed(1)}`, actual: `${target.flareClass}${target.flareMag.toFixed(1)}` },
    { label: 'Where on the disk', from: ev.provenance.position,
      closeness: near(Math.hypot(target.lonDeg - mine.lonDeg, target.latDeg - mine.latDeg), 0, 55),
      yours: `${Math.round(mine.lonDeg)}\u00b0, ${Math.round(mine.latDeg)}\u00b0`,
      actual: `${Math.round(target.lonDeg)}\u00b0, ${Math.round(target.latDeg)}\u00b0` },
    { label: 'How many clouds', from: ev.provenance.count,
      closeness: near(data.clouds.length, got.clouds.length, 4),
      yours: `${got.clouds.length}`, actual: `${data.clouds.length}` },
    { label: 'Filament went up', from: ev.provenance.filament,
      closeness: ev.rope.filament === got.filament ? 1 : 0,
      yours: got.filament ? 'yes' : 'no', actual: ev.rope.filament ? 'yes' : 'no' },
    { label: 'Launch speed', from: ev.provenance.speed,
      closeness: near(target.speedKms, mine.speedKms, 700),
      yours: `${Math.round(mine.speedKms)} km/s`, actual: `${Math.round(target.speedKms)} km/s` },
    { label: 'Cloud width', from: ev.provenance.width,
      closeness: near(target.halfWidthDeg, mine.halfWidthDeg, 40),
      yours: `${Math.round(mine.halfWidthDeg)}\u00b0`, actual: `${Math.round(target.halfWidthDeg)}\u00b0` },
    { label: 'Field direction', from: ev.provenance.rope,
      closeness: nearAngle(ev.rope.axialDeg, got.axialDeg, 70),
      yours: `${Math.round(got.axialDeg)}\u00b0`, actual: `${Math.round(ev.rope.axialDeg)}\u00b0` },
    { label: 'How much it turns', from: ev.provenance.rope,
      closeness: near(ev.rope.rotationDeg, got.rotationDeg, 130),
      yours: `${Math.round(got.rotationDeg)}\u00b0`, actual: `${Math.round(ev.rope.rotationDeg)}\u00b0` },
  ];
  const overall = parts.reduce((s, p) => s + p.closeness, 0) / parts.length;
  return { parts, overall };
}

function flareVal(cls: FlareClass, mag: number): number {
  return (cls === 'X' ? 100 : cls === 'M' ? 10 : 1) * mag;
}
// --- END OF FILE src/components/game/events.ts ---
