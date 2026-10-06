// Links to a WSA-ENLIL run's own model output on NASA's iSWA.
//
// CCMC keeps each run's animation in a folder per month, named for the run's
// completion time and how far out it ran, e.g.
//   .../animation-cme-velocity/2026/10/20261006_121900_2.0_anim.tim-vel.gif
// for a run DONKI lists as completed 2026-10-06T12:19Z at 2.0 AU. DONKI gives
// a run its DONKI page but not this file's name, so it is built here.

const ENLIL_ANIMATIONS_BASE = 'https://iswa.ccmc.gsfc.nasa.gov/iswa_data_tree/model/heliosphere/wsa-enlil-cone/animation-cme-velocity';
const pad2 = (n: number) => String(n).padStart(2, '0');

const monthFolder = (at: Date): string =>
  `${ENLIL_ANIMATIONS_BASE}/${at.getUTCFullYear()}/${pad2(at.getUTCMonth() + 1)}/`;

/** The run's own animation, or null when its time or reach is missing. */
export function enlilAnimationUrl(modelCompletionTime: string | null | undefined, au: number | null | undefined): string | null {
  const at = new Date(modelCompletionTime ?? '');
  if (Number.isNaN(at.getTime()) || typeof au !== 'number' || !Number.isFinite(au)) return null;
  const stamp = `${at.getUTCFullYear()}${pad2(at.getUTCMonth() + 1)}${pad2(at.getUTCDate())}`
    + `_${pad2(at.getUTCHours())}${pad2(at.getUTCMinutes())}${pad2(at.getUTCSeconds())}`;
  return `${monthFolder(at)}${stamp}_${au.toFixed(1)}_anim.tim-vel.gif`;
}

/** The month's animations, newest first: the way in when a run's own file is not there. */
export function enlilAnimationFolder(modelCompletionTime: string | null | undefined): string {
  const d = new Date(modelCompletionTime ?? '');
  return `${monthFolder(Number.isNaN(d.getTime()) ? new Date() : d)}?C=M;O=D`;
}
