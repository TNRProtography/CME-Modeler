// --- START OF FILE src/components/game/stormData.ts ---
//
// The cloud-by-cloud make-up of each preset storm.
//
// THIS FILE IS MEANT TO BE GENERATED. Run:
//
//     npm run fetch-storms
//
// which queries NASA's DONKI catalogue for each event's window and writes this
// file from what it returns: every CME's own speed, half angle, source latitude
// and longitude, and the flare it came with. DONKI is the same catalogue the
// app's CME visualisation runs on, so the presets and the live scene end up
// speaking about the same objects.
//
// Until that is run, the values below are reconstructed from the published
// storm summaries rather than from the catalogue, and `source` says so on every
// entry. Nothing here is presented to the player as measured unless it is.
//
// DONKI only goes back to 2010, so the two historical events cannot come from
// it and never will. They stay reconstructed, and the game says so.

import type { CloudSpec } from './stormModel';

export type DataSource = 'donki' | 'reconstructed';

export interface StormData {
  /** Every cloud in the run, in the order they left the Sun. */
  clouds: CloudSpec[];
  /** Where these numbers came from. */
  source: DataSource;
  /** When the catalogue was queried, if it was. */
  fetchedAt?: string;
  /** The window that was queried, so the fetch is reproducible. */
  window?: { from: string; to: string };
}

// Region 13664 sat at S19W34 when the run started and rotated west through it.
// Seven clouds over three days, every one a full halo. The flare classes are
// from the record; the individual speeds and widths are not, which is exactly
// what the fetch replaces.
//
// A note on widths, because this was wrong here first time round. "Full halo"
// does not mean the cloud is enormous. It means it is coming more or less
// straight at us, so its expanding shell appears in a coronagraph to surround
// the occulting disk. That is a projection, not a measurement of size. Real
// half angles in the catalogue sit around 30 to 60 degrees even for halos, and
// the visualisation scales a cloud by the tangent of this, so putting 85 in
// here drew something twenty times the size of a normal CME.
const GANNON: CloudSpec[] = [
  { flareClass: 'X', flareMag: 1.0,  lonDeg: 8,  latDeg: -19, speedKms: 1100, halfWidthDeg: 45, offsetHours: 0,  label: 'X1.0, 8 May' },
  { flareClass: 'M', flareMag: 8.0,  lonDeg: 12, latDeg: -19, speedKms: 1250, halfWidthDeg: 40, offsetHours: 12, label: 'M8.0, 8 May' },
  { flareClass: 'X', flareMag: 2.25, lonDeg: 18, latDeg: -19, speedKms: 1550, halfWidthDeg: 52, offsetHours: 25, label: 'X2.25, 9 May' },
  { flareClass: 'X', flareMag: 1.12, lonDeg: 22, latDeg: -19, speedKms: 1400, halfWidthDeg: 46, offsetHours: 32, label: 'X1.12, 9 May' },
  { flareClass: 'M', flareMag: 9.8,  lonDeg: 26, latDeg: -19, speedKms: 1350, halfWidthDeg: 44, offsetHours: 40, label: 'M9.8, 9 May' },
  { flareClass: 'X', flareMag: 3.98, lonDeg: 30, latDeg: -19, speedKms: 1600, halfWidthDeg: 55, offsetHours: 50, label: 'X3.98, 10 May' },
  { flareClass: 'X', flareMag: 5.8,  lonDeg: 36, latDeg: -19, speedKms: 1700, halfWidthDeg: 50, offsetHours: 64, label: 'X5.8, 11 May' },
];

const OCT_2024: CloudSpec[] = [
  { flareClass: 'X', flareMag: 1.8, lonDeg: 8, latDeg: 12, speedKms: 1346, halfWidthDeg: 48, offsetHours: 0, label: 'X1.8, 9 Oct' },
];

const APR_2023: CloudSpec[] = [
  { flareClass: 'M', flareMag: 1.7, lonDeg: -6, latDeg: 18, speedKms: 1326, halfWidthDeg: 50, offsetHours: 0, label: 'M1.7 with a filament, 21 Apr' },
];

// Pre-DONKI. Both are reconstructions and will stay that way.
const MAR_1989: CloudSpec[] = [
  { flareClass: 'X', flareMag: 4.5, lonDeg: -10, latDeg: -26, speedKms: 951,  halfWidthDeg: 45, offsetHours: 0,  label: 'X4.5, 10 March' },
  { flareClass: 'M', flareMag: 7.3, lonDeg: 8,   latDeg: -26, speedKms: 1546, halfWidthDeg: 50, offsetHours: 48, label: 'M7.3, 12 March' },
];

const CARRINGTON: CloudSpec[] = [
  { flareClass: 'X', flareMag: 6.0, lonDeg: -6, latDeg: -8, speedKms: 1500, halfWidthDeg: 50, offsetHours: 0,  label: 'The cloud that cleared the path, 28 Aug' },
  { flareClass: 'X', flareMag: 9.5, lonDeg: 0,  latDeg: -8, speedKms: 2605, halfWidthDeg: 55, offsetHours: 44, label: 'The white light flare, 1 Sept' },
];

export const STORM_DATA: Record<string, StormData> = {
  'may-2024':   { clouds: GANNON,     source: 'reconstructed', window: { from: '2024-05-07', to: '2024-05-12' } },
  'oct-2024':   { clouds: OCT_2024,   source: 'reconstructed', window: { from: '2024-10-07', to: '2024-10-11' } },
  'apr-2023':   { clouds: APR_2023,   source: 'reconstructed', window: { from: '2023-04-20', to: '2023-04-24' } },
  'mar-1989':   { clouds: MAR_1989,   source: 'reconstructed' },
  'carrington': { clouds: CARRINGTON, source: 'reconstructed' },
};
// --- END OF FILE src/components/game/stormData.ts ---
