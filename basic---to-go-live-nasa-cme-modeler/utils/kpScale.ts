/**
 * Turning a fractional Kp forecast into a NOAA G-scale band.
 *
 * NOAA publishes Kp in thirds, and the thirds are named around the integer
 * rather than counted up from it:
 *
 *     4.667 = "Kp 5-"    5.000 = "5o"    5.333 = "5+"    5.667 = "6-"
 *
 * So the band a value belongs to is the *nearest* integer, not the one below
 * it. Comparing the raw value against `>= 6` put every .667 one band too low:
 * a 5.67 forecast, which NOAA itself calls Kp6- and rates G2, was displayed as
 * G1. The same one-band error ran through the visibility wording and the colour
 * of the aurora band, so every value ending .67 described a quieter night than
 * the forecast actually called for.
 *
 * Rounding is exact rather than approximate here, because every value is on the
 * thirds grid: the NOAA anchors arrive that way and the hourly interpolation
 * snaps back to it.
 */

/** The whole-number Kp index a fractional forecast value belongs to. */
export function kpIndex(kp: number): number {
  return Math.round(kp);
}

/** NOAA's own notation for a Kp value, e.g. 5.667 -> "6-". */
export function kpLabel(kp: number): string {
  const index = kpIndex(kp);
  const third = Math.round((kp - index) * 3); // -1, 0 or +1
  return `${index}${third < 0 ? '-' : third > 0 ? '+' : 'o'}`;
}

/** The NOAA geomagnetic storm band, or '' below G1. */
export function gScale(kp: number): string {
  const g = kpIndex(kp);
  if (g >= 9) return 'G5';
  if (g >= 8) return 'G4';
  if (g >= 7) return 'G3';
  if (g >= 6) return 'G2';
  if (g >= 5) return 'G1';
  return '';
}

/** The colour the app uses for a storm band. */
export function gColor(kp: number): string {
  const g = kpIndex(kp);
  if (g >= 8) return '#ff6060';
  if (g >= 7) return '#ff9944';
  if (g >= 6) return '#508cff';
  if (g >= 5) return '#44dd88';
  return '#888';
}
