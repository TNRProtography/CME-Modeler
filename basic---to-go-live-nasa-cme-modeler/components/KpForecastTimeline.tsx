// components/KpForecastTimeline.tsx

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { kpIndex, gScale, gColor } from '../utils/kpScale';
import { moonAt } from '../utils/skyConditions';
import { resolveViewerLocation } from '../utils/viewerLocation';
import { useThreeDayOutlook } from '../hooks/useThreeDayOutlook';
import { combinedAt, type GridDriver } from '../utils/threeDayGrid';
import { skyConditionsAt, visibilityOutlook, type VisibilityTier } from '../utils/skyConditions';

const TIER_EMOJI: Record<string, string> = { camera: '📷', phone: '📱', eye: '👁️' };

const KP_THRESHOLD  = 4.33; // below this: no aurora overlay
const NZ_TIME_ZONE  = 'Pacific/Auckland';


const getNzOffsetHours = (atMs: number): number => {
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone: NZ_TIME_ZONE,
    timeZoneName: 'shortOffset',
  }).formatToParts(new Date(atMs));
  const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  const match = tzPart.match(/([+-]\d{1,2})(?::(\d{2}))?/);
  if (!match) return 12;
  const hours = Number(match[1]);
  const mins = Number(match[2] ?? 0);
  return hours + mins / 60;
};

const getNzOffsetMs = (atMs: number): number => getNzOffsetHours(atMs) * 3600000;
const getNzTimeLabel = (atMs: number): 'NZDT' | 'NZST' => (getNzOffsetHours(atMs) >= 13 ? 'NZDT' : 'NZST');

interface KpSlot {
  utcMs:    number;
  nztHour:  number;
  dayIdx:   number;
  dayLabel: string;
  kp:       number;
  observed: string; // 'observed' | 'estimated' | 'predicted'
  /**
   * The combined forecast's strength for the viewer, 0-100, before the sky
   * (utils/threeDayGrid). When set, it draws the aurora and `kp` is the Kp it
   * amounts to.
   */
  strength?: number;
  driver?:   GridDriver;
  /** What can be seen in this hour after the sky, and its 0-100 strength. */
  tier?:     VisibilityTier;
  effective?: number;
}
interface PopupState { slotIdx: number; anchorX: number; }

interface KpForecastTimelineProps {
  moonIllumination?: number | null; // 0-100
  userLatitude?:     number | null;
  userLongitude?:    number | null;
  sunriseMs?:        number | null; // Unix ms UTC from celestialTimes.sun.rise
  sunsetMs?:         number | null; // Unix ms UTC from celestialTimes.sun.set
  moonRiseMs?:       number | null; // Unix ms UTC from celestialTimes.moon.rise
  moonSetMs?:        number | null; // Unix ms UTC from celestialTimes.moon.set
  moonWaxing?:       boolean | null; // true=growing, false=shrinking, null=unknown
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rand(s: number) { const x = Math.sin(s+1)*10000; return x - Math.floor(x); }

type SkyT = 'day'|'golden'|'civil'|'nautical'|'night';

// Compute sky state from actual sunrise/sunset Unix-ms timestamps when available,
// falling back to NZ April heuristic (sunrise ~7am, sunset ~7pm) otherwise.
// Twilight bands:
//   golden   = within 30 min of horizon crossing
//   civil    = 30–60 min from horizon
//   nautical = 60–90 min from horizon
// Extract just the UTC time-of-day in ms from a timestamp
// e.g. 6:43am UTC → 6*3600000 + 43*60000
function timeOfDayMs(ts: number): number {
  const DAY_MS = 86400000;
  return ((ts % DAY_MS) + DAY_MS) % DAY_MS;
}

function skyTypeFromMs(
  slotUtcMs: number,
  sunriseMs: number | null | undefined,
  sunsetMs:  number | null | undefined,
): SkyT {
  if (sunriseMs && sunsetMs) {
    const GOLDEN_MS   = 30 * 60000;
    const CIVIL_MS    = 60 * 60000;
    const NAUTICAL_MS = 90 * 60000;
    const DAY_MS      = 86400000;
    const NZT_OFFSET  = getNzOffsetMs(slotUtcMs);

    // Key insight: sunriseMs/sunsetMs are today's UTC timestamps, but NZ is
    // UTC+13 so a 6:30am NZT sunrise is 5:30pm UTC the *previous* day.
    // Extracting % DAY_MS in UTC gives the wrong hour entirely.
    // Fix: work in NZT - extract the NZT time-of-day, anchor to the slot's
    // NZT calendar day, then convert back to UTC for comparison.

    // NZT time-of-day for today's rise/set
    const riseNztTod = (sunriseMs + NZT_OFFSET) % DAY_MS;
    const setNztTod  = (sunsetMs  + NZT_OFFSET) % DAY_MS;

    // Slot's NZT midnight (start of its local calendar day)
    const slotNzt        = slotUtcMs + NZT_OFFSET;
    const slotNztMidnight = slotNzt - (slotNzt % DAY_MS);

    // Anchor rise/set onto this slot's NZT day, then back to UTC
    const riseUtc = slotNztMidnight + riseNztTod - NZT_OFFSET;
    const setUtc  = slotNztMidnight + setNztTod  - NZT_OFFSET;
    // If set < rise on the same day (unusual but possible), push set forward
    const setUtcAdj = setUtc < riseUtc ? setUtc + DAY_MS : setUtc;

    if (slotUtcMs >= riseUtc && slotUtcMs <= setUtcAdj) {
      const margin = Math.min(slotUtcMs - riseUtc, setUtcAdj - slotUtcMs);
      if (margin < GOLDEN_MS) return 'golden';
      return 'day';
    }

    const toRise  = riseUtc - slotUtcMs;
    const fromSet = slotUtcMs - setUtcAdj;
    const dist    = toRise > 0 ? toRise : fromSet > 0 ? fromSet : Math.min(Math.abs(toRise), Math.abs(fromSet));

    if (dist < GOLDEN_MS)   return 'golden';
    if (dist < CIVIL_MS)    return 'civil';
    if (dist < NAUTICAL_MS) return 'nautical';
    return 'night';
  }

  // Fallback: NZ April heuristic
  const nztH = new Date(slotUtcMs + getNzOffsetMs(slotUtcMs)).getUTCHours();
  if (nztH >= 8 && nztH < 18) return 'day';
  if (nztH === 7 || nztH === 18) return 'golden';
  if (nztH === 6 || nztH === 19) return 'civil';
  if (nztH === 5 || nztH === 20) return 'nautical';
  return 'night';
}

// Kept for backward compat inside drawCanvas which doesn't have the timestamps
function skyType(h: number): SkyT {
  if (h >= 8 && h < 18) return 'day';
  if (h === 7 || h === 18) return 'golden';
  if (h === 6 || h === 19) return 'civil';
  if (h === 5 || h === 20) return 'nautical';
  return 'night';
}

// minKp: piecewise linear between calibrated NZ anchor points.
// Northland/Auckland ~36°S → 6.3, Wellington ~41°S → 5.7,
// Christchurch ~43.5°S → 5.0, Southland ~46°S → 4.5.
// No GPS → conservative NZ-wide default of 4.67.
function minKpForLocation(lat: number | null | undefined): number {
  if (lat == null) return 4.67;
  const a = Math.abs(lat);
  // Anchors calibrated: Auckland(36.8°S)→6.3, Wellington(41.3°S)→5.7, Chch(43.5°S)→5.0
  const anchors = [
    [34,   6.5],
    [36.8, 6.3],
    [41.3, 5.7],
    [43.5, 5.0],
    [46,   4.5],
    [48,   4.5],
  ];
  if (a <= anchors[0][0]) return anchors[0][1];
  if (a >= anchors[anchors.length-1][0]) return anchors[anchors.length-1][1];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [la, ka] = anchors[i];
    const [lb, kb] = anchors[i+1];
    if (a >= la && a <= lb) {
      const t = (a - la) / (lb - la);
      return ka + (kb - ka) * t;
    }
  }
  return 4.67;
}

function auroraH(kp: number, skyH: number, minKp: number): number {
  if (kp <= minKp) return 0;
  // Bar fills from minKp to Kp 8 (where aurora is visible everywhere in NZ)
  const fraction = Math.min(1, (kp - minKp) / (8.0 - minKp));
  return Math.pow(fraction, 0.70) * skyH * 0.92;
}

// Always green (bottom) → pink (mid) → blue (top). Height + intensity vary by KP.
function auroraGrad(
  ctx: CanvasRenderingContext2D,
  x: number, topY: number, botY: number,
  kp: number, op: number
) {
  // Gradient runs top→bottom: [0]=top of band [1]=horizon
  // so colour order from stop 0 to stop 1:  blue → pink → green → transparent
  const g = ctx.createLinearGradient(x, topY, x, botY);
  const a = (v: number) => Math.min(1, v * op).toFixed(3);

  const g5 = kpIndex(kp);
  if (g5 >= 8) {                              // G4+ - all three bold
    g.addColorStop(0,    `rgba(80,130,255,${a(0)})`);
    g.addColorStop(0.04, `rgba(80,130,255,${a(0.80)})`);
    g.addColorStop(0.28, `rgba(80,130,255,${a(0.85)})`);
    g.addColorStop(0.42, `rgba(255,60,150,${a(0.85)})`);
    g.addColorStop(0.60, `rgba(255,60,150,${a(0.82)})`);
    g.addColorStop(0.72, `rgba(0,220,65,${a(0.90)})`);
    g.addColorStop(0.90, `rgba(0,220,65,${a(0.92)})`);
    g.addColorStop(1,    `rgba(0,220,65,${a(0.10)})`);
  } else if (g5 >= 7) {                       // G3 - blue cap, good pink, green main
    g.addColorStop(0,    `rgba(80,125,255,${a(0)})`);
    g.addColorStop(0.08, `rgba(80,125,255,${a(0.65)})`);
    g.addColorStop(0.28, `rgba(80,125,255,${a(0.70)})`);
    g.addColorStop(0.42, `rgba(255,60,148,${a(0.78)})`);
    g.addColorStop(0.60, `rgba(255,60,148,${a(0.73)})`);
    g.addColorStop(0.72, `rgba(0,218,62,${a(0.85)})`);
    g.addColorStop(0.90, `rgba(0,218,62,${a(0.88)})`);
    g.addColorStop(1,    `rgba(0,218,62,${a(0.10)})`);
  } else if (g5 >= 6) {                       // G2 - hint of blue, pink band, green main
    g.addColorStop(0,    `rgba(80,118,255,${a(0)})`);
    g.addColorStop(0.10, `rgba(80,118,255,${a(0.40)})`);
    g.addColorStop(0.25, `rgba(80,118,255,${a(0.42)})`);
    g.addColorStop(0.40, `rgba(245,60,145,${a(0.68)})`);
    g.addColorStop(0.58, `rgba(245,60,145,${a(0.65)})`);
    g.addColorStop(0.70, `rgba(0,215,60,${a(0.82)})`);
    g.addColorStop(0.90, `rgba(0,215,60,${a(0.85)})`);
    g.addColorStop(1,    `rgba(0,215,60,${a(0.08)})`);
  } else {                                    // G1 - green base, faint pink, no blue
    g.addColorStop(0,    `rgba(230,60,140,${a(0)})`);
    g.addColorStop(0.15, `rgba(230,60,140,${a(0.38)})`);
    g.addColorStop(0.38, `rgba(230,60,140,${a(0.40)})`);
    g.addColorStop(0.52, `rgba(0,210,58,${a(0.70)})`);
    g.addColorStop(0.85, `rgba(0,210,58,${a(0.80)})`);
    g.addColorStop(1,    `rgba(0,210,58,${a(0.07)})`);
  }
  return g;
}

// ── Visibility info for popup ─────────────────────────────────────────────────

function moonLabel(p: number) {
  if (p > 85) return `Full moon (${Math.round(p)}%) - bright sky glow`;
  if (p > 65) return `Gibbous moon (${Math.round(p)}%) - noticeable glow`;
  if (p > 40) return `Quarter moon (${Math.round(p)}%) - some interference`;
  if (p > 15) return `Crescent (${Math.round(p)}%) - minimal impact`;
  return `Near new moon (${Math.round(p)}%) - ideal dark skies`;
}

/**
 * The Moon during one forecast hour, for this viewer: its real phase on that
 * day and its real height at that hour. "moon" is what the visibility rules
 * below weigh - the lit percentage, scaled down while the Moon is low (it
 * counts in full from 30 degrees up) and zero while it is below the horizon.
 */
interface SlotMoon { moon: number; illumPct: number; up: boolean; altitude: number; label: string; }
function slotMoon(slotUtcMs: number, lat: number, lon: number): SlotMoon {
  const m = moonAt(slotUtcMs + 30 * 60000, lat, lon);
  const illumPct = m.illumination * 100;
  const height = Math.min(1, Math.max(0, Math.sin(m.altitude * Math.PI / 180)) / 0.5);
  const label = m.up
    ? `${moonLabel(illumPct)}${m.altitude < 20 ? ', low in the sky' : ''}`
    : `Moon is below the horizon (${Math.round(illumPct)}% lit) - no interference`;
  return { moon: m.up ? illumPct * height : 0, illumPct, up: m.up, altitude: m.altitude, label };
}

interface VisInfo {
  headline: string; detail: string;
  regions:  string[]; moonNote: string; tip: string;
  summary:  string; // single overarching sentence shown in compact panel
}

function getVis(kp: number, slot: SlotMoon, lat: number | null | undefined, sky: SkyT = 'night'): VisInfo {
  // The Moon as it is at this hour: zero while it is down, whatever its phase.
  const moon = slot.moon;
  const ml = slot.label;

  // Sky brightness note - added to tip for daytime/twilight slots
  const skyNote =
    sky === 'day'      ? ' Note: the sun is up - aurora is not visible in daylight regardless of activity level.' :
    sky === 'golden'   ? ' Note: the sun is at or near the horizon - it will still be too bright to see aurora.' :
    sky === 'civil'    ? ' Note: civil twilight - the sky is still quite bright. Aurora is unlikely to be visible yet.' :
    sky === 'nautical' ? ' Note: nautical twilight - the sky is getting darker but faint aurora may still be washed out.' :
    '';

  if (kp <= KP_THRESHOLD) return {
    headline: sky === 'day' ? 'Daytime - aurora not visible' : 'Not visible from New Zealand',
    detail:   sky === 'day'
      ? 'The sun is up. Aurora cannot be seen during daylight hours regardless of space weather conditions.'
      : sky === 'golden' || sky === 'civil'
      ? 'The sky is still too bright for aurora to be visible. Activity is also below the NZ threshold.'
      : 'Activity is too low for aurora to reach New Zealand. The aurora oval sits well south of NZ at this level.',
    regions: [], moonNote: ml,
    tip: sky === 'day' || sky === 'golden' || sky === 'civil'
      ? 'Check back after dark - aurora only becomes visible once the sky is fully dark.'
      : 'Check back when Kp reaches 5 or above.',
    summary: sky === 'day' ? 'The sun is up - aurora cannot be seen in daylight.'
      : sky === 'golden' || sky === 'civil' ? 'Too bright to see aurora - wait until fully dark.'
      : sky === 'nautical' ? 'Sky nearly dark but Kp too low for NZ aurora tonight.'
      : 'Activity is too low - aurora not expected to reach New Zealand.',
  };

  const g = kpIndex(kp);

  if (g >= 8) return {
    headline: 'Visible across all of New Zealand',
    detail:   'Major geomagnetic storm. Aurora visible nationwide - Northland to Invercargill - even from suburban areas. Expect greens, pinks, and vivid blue/purple higher in the sky.',
    regions:  ['Northland','Auckland','Waikato','Bay of Plenty','Wellington','Nelson','Canterbury','Otago','Southland'],
    moonNote: `${ml} - moon has no meaningful impact at this storm level.`,
    tip: 'Go outside and look in any direction - at G4+ aurora can appear overhead. Face south for the most dramatic display.',
    summary: 'Major storm - aurora visible across all of New Zealand, moon is no obstacle.',
  };

  if (g >= 7) {
    const northNote = moon > 80
      ? 'North Island: find a dark hilltop away from city lights - full moon may reduce visibility.'
      : moon > 55
      ? 'North Island: head to a dark location for best viewing.'
      : 'North Island visible clearly, even from suburbs.';
    return {
      headline: 'Visible across all of New Zealand',
      detail:   `Strong storm. The entire South Island will see clear aurora. ${northNote}`,
      regions:  ['Southland','Otago','Canterbury','Marlborough','Nelson','Wellington','Manawatu',"Hawke's Bay",'Waikato','Auckland','Northland'],
      moonNote: moon > 80
        ? `${ml} - may reduce North Island visibility slightly. South Island unaffected.`
        : ml,
      tip: 'Face south and look up. Green is most common; pink/red higher up indicates strong activity near you.',
      summary: moon > 80 ? 'Strong storm - all NZ should see aurora; North Island: find dark skies to counter the full moon.'
        : 'Strong storm - aurora visible the length of New Zealand tonight.',
    };
  }

  if (g >= 6) {
    if (moon > 80) return {
      headline: 'South Island likely, North Island difficult',
      detail:   'Moderate storm. South Island should see clear aurora. Full moon will wash out fainter aurora for North Island - very dark sites needed.',
      regions:  ['Southland','Otago','Canterbury','Marlborough','Nelson','Wellington (dark sites)'],
      moonNote: `${ml} - significantly reduces North Island chances.`,
      tip:      'South Island: any dark spot works. North Island: coastal headlands or hilltops away from light pollution.',
      summary:  'Moderate storm - South Island clear, North Island needs dark skies to beat the full moon.',
    };
    return {
      headline: moon > 55 ? 'South Island to Northland - dark sites help in North Island' : 'Visible South Island to Northland',
      detail:   moon > 55
        ? 'Moderate storm. South Island clear. North Island (Auckland, Northland) has a good chance from dark locations - moon may reduce the faint edges.'
        : 'Moderate storm. South Island and North Island including Auckland and Northland all have a strong chance. Find a dark spot and look south.',
      regions:  ['Southland','Otago','Canterbury','Nelson','Wellington','Manawatu','Auckland','Northland'],
      moonNote: moon > 55 ? `${ml} - North Island: prioritise dark sites.` : ml,
      tip:      "Point your phone camera south - it's more sensitive than your eyes and may reveal colours before you see them.",
      summary:  moon > 55 ? 'Moderate storm - South Island to Northland; find dark spots in the North Island.'
        : 'Moderate storm - good chance across South Island and up to Northland.',
    };
  }

  if (g >= 5) {
    if (moon > 80) return {
      headline: 'Southland and Otago - dark sites only',
      detail:   'Minor storm. Full moon makes conditions difficult. Only the very south of New Zealand is likely to see aurora, and only from truly dark locations.',
      regions:  ['Southland (dark sky sites)','Otago (dark sky sites)'],
      moonNote: `${ml} - aurora is faint at G1 and the moon compounds this.`,
      tip:      'Use a camera on a tripod, 10-15 second exposure pointed south. Your eyes may see nothing but the camera might.',
      summary:  'Minor storm - only extreme south NZ in very dark sites; full moon makes conditions tough.',
    };
    if (moon > 55) return {
      headline: 'South Island south of Christchurch',
      detail:   'Minor storm. Southern South Island (Southland, Otago, South Canterbury) should see aurora from dark locations. Partial moon reduces visibility further north.',
      regions:  ['Southland','Otago','South Canterbury'],
      moonNote: `${ml} - reduces visibility in marginal locations.`,
      tip:      'Look for a green or pink brightening on the southern horizon before distinct curtains develop.',
      summary:  'Minor storm - southern South Island has a fair chance from dark locations tonight.',
    };
    return {
      headline: 'South Island including Nelson',
      detail:   'Minor storm. From Invercargill up to Nelson has a good chance from dark locations. Dark skies are essential at this level.',
      regions:  ['Southland','Otago','Canterbury','Marlborough','Nelson'],
      moonNote: moon > 25 ? `${ml} - aurora visible, but darker sites improve chances.` : ml,
      tip:      'Find a spot with a clear southern horizon - coastal beaches and hilltops are ideal. Look low on the horizon first.',
      summary:  moon > 25 ? 'Minor storm - South Island to Nelson likely; dark skies improve your chances.'
        : 'Minor storm - South Island to Nelson has a good chance from dark locations.',
    };
  }

  // Kp index 4 and below - "4+" (4.333) and under, which is beneath G1.
  return {
    headline: 'Marginal - very unlikely from New Zealand',
    detail:   'Just above the minimum threshold but below what is needed to reach NZ latitudes. A faint glow might theoretically appear from extreme southern locations under perfect conditions, but is not expected.',
    regions:  [],
    moonNote: ml,
    tip:      "Not worth going out specially. If Kp climbs to 5 the situation will improve quickly - keep the forecast open.",
    summary:  'Marginal activity - aurora is not expected to be visible from New Zealand.',
  };
}

// ── Canvas draw ───────────────────────────────────────────────────────────────

function drawCanvas(
  canvas:     HTMLCanvasElement,
  slots:      KpSlot[],
  W:          number,
  sunriseMs:  number | null | undefined,
  sunsetMs:   number | null | undefined,
  lat:        number,
  lon:        number,
  minKp:       number,
  selectedCol: number,
  /** Per column: the emoji for what can be seen that hour. */
  emojis:      (string | null)[] = [],
) {
  const COLS   = slots.length;
  if (COLS === 0) return;
  const DPR    = window.devicePixelRatio || 1;
  const MIN_COL = 22; // minimum px per column - keeps slots tappable on mobile
  const COL_W  = Math.max(MIN_COL, W / COLS);
  const totalW = COL_W * COLS;
  const H      = Math.round(Math.min(220, Math.max(160, totalW * 0.18)));
  const LBEL_H = 20;
  const SKY_H  = H - LBEL_H - 14;
  const HOR_Y  = LBEL_H + SKY_H;

  canvas.width  = Math.round(totalW * DPR);
  canvas.height = Math.round(H * DPR);
  canvas.style.width  = `${totalW}px`;
  canvas.style.height = `${H}px`;

  const ctx = canvas.getContext('2d')!;
  ctx.scale(DPR, DPR);
  ctx.clearRect(0, 0, totalW, H);

  // ── Per-column sky + aurora ────────────────────────────────────────────────
  slots.forEach((slot, i) => {
    const x  = i * COL_W;
    const st = skyTypeFromMs(slot.utcMs, sunriseMs, sunsetMs);

    // Sky background
    let bg: CanvasGradient;
    if (st === 'day') {
      bg = ctx.createLinearGradient(x, LBEL_H, x, HOR_Y);
      bg.addColorStop(0, '#0c2a50'); bg.addColorStop(0.5, '#1a4a80'); bg.addColorStop(1, '#2060a0');
      ctx.fillStyle = bg; ctx.fillRect(x, LBEL_H, COL_W, SKY_H);
      // Arc: 0 at sunrise, peaks at solar noon, 0 at sunset.
      // Anchor using NZT time-of-day (same logic as skyTypeFromMs).
      const DAY_MS_A  = 86400000;
      const NZT_OFF_A = getNzOffsetMs(slot.utcMs);
      const slotNztA  = slot.utcMs + NZT_OFF_A;
      const slotNztMidA = slotNztA - (slotNztA % DAY_MS_A);
      const riseA = sunriseMs != null ? slotNztMidA + ((sunriseMs + NZT_OFF_A) % DAY_MS_A) - NZT_OFF_A : null;
      const setA  = sunsetMs  != null ? slotNztMidA + ((sunsetMs  + NZT_OFF_A) % DAY_MS_A) - NZT_OFF_A : null;
      const setAAdj = (riseA != null && setA != null && setA < riseA) ? setA + DAY_MS_A : setA;
      const dayLen = (riseA != null && setAAdj != null) ? (setAAdj - riseA) : 12 * 3600000;
      const relPos = (riseA != null && setAAdj != null)
        ? (slot.utcMs - riseA) / dayLen
        : (slot.nztHour - 7) / 12;
      const sunFrac = Math.max(0, Math.sin(Math.PI * Math.max(0, Math.min(1, relPos))));
      const sy = HOR_Y - sunFrac * SKY_H * 0.82;
      ctx.fillStyle = 'rgba(255,225,100,0.70)';
      ctx.beginPath(); ctx.arc(x+COL_W/2, sy, 4.5, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = 'rgba(255,225,100,0.14)';
      ctx.beginPath(); ctx.arc(x+COL_W/2, sy, 11, 0, Math.PI*2); ctx.fill();
    } else if (st === 'golden') {
      const eve = slot.nztHour >= 12;
      bg = ctx.createLinearGradient(x, LBEL_H, x, HOR_Y);
      bg.addColorStop(0, eve ? '#06101e' : '#07142a');
      bg.addColorStop(0.38, eve ? '#102030' : '#183050');
      bg.addColorStop(0.68, '#c04818');
      bg.addColorStop(0.86, '#e07030');
      bg.addColorStop(1, '#f09040');
      ctx.fillStyle = bg; ctx.fillRect(x, LBEL_H, COL_W, SKY_H);
      // Sun just at/near the horizon for golden hour
      const gDAY    = 86400000;
      const gNZTOff = getNzOffsetMs(slot.utcMs);
      const gSlotNzt = slot.utcMs + gNZTOff;
      const gSlotMid = gSlotNzt - (gSlotNzt % gDAY);
      const gRiseA = sunriseMs != null ? gSlotMid + ((sunriseMs + gNZTOff) % gDAY) - gNZTOff : null;
      const gSetA  = sunsetMs  != null ? gSlotMid + ((sunsetMs  + gNZTOff) % gDAY) - gNZTOff : null;
      const gSetAdj = (gRiseA != null && gSetA != null && gSetA < gRiseA) ? gSetA + gDAY : gSetA;
      const gDayLen = (gRiseA != null && gSetAdj != null) ? (gSetAdj - gRiseA) : 12 * 3600000;
      const gRelPos = (gRiseA != null && gSetAdj != null)
        ? (slot.utcMs - gRiseA) / gDayLen
        : (slot.nztHour - 7) / 12;
      const gSunFrac = Math.max(0, Math.sin(Math.PI * Math.max(0, Math.min(1, gRelPos))));
      const gSunY = HOR_Y - gSunFrac * SKY_H * 0.82 - 3;
      ctx.fillStyle = 'rgba(255,200,60,0.72)';
      ctx.beginPath(); ctx.arc(x+COL_W/2, gSunY, 4, 0, Math.PI*2); ctx.fill();
      for (let s=0;s<6;s++){ctx.beginPath();ctx.arc(rand(i*400+s*7.3)*COL_W+x,LBEL_H+rand(i*500+s*13.7)*SKY_H*0.3,0.5,0,Math.PI*2);ctx.fillStyle=`rgba(255,255,255,${(0.2+rand(i*600+s*5.1)*0.4).toFixed(2)})`;ctx.fill();}
    } else if (st === 'civil') {
      bg = ctx.createLinearGradient(x, LBEL_H, x, HOR_Y);
      bg.addColorStop(0,'#030810'); bg.addColorStop(0.45,'#0c1e32'); bg.addColorStop(0.72,'#7a2e0a'); bg.addColorStop(1,'#b84018');
      ctx.fillStyle = bg; ctx.fillRect(x, LBEL_H, COL_W, SKY_H);
      for (let s=0;s<10;s++){ctx.beginPath();ctx.arc(rand(i*400+s*7.3)*COL_W+x,LBEL_H+rand(i*500+s*13.7)*SKY_H*0.4,0.5,0,Math.PI*2);ctx.fillStyle=`rgba(255,255,255,${(0.2+rand(i*600+s*5.1)*0.45).toFixed(2)})`;ctx.fill();}
    } else if (st === 'nautical') {
      bg = ctx.createLinearGradient(x, LBEL_H, x, HOR_Y);
      bg.addColorStop(0,'#02040e'); bg.addColorStop(0.5,'#06121e'); bg.addColorStop(0.8,'#3a1808'); bg.addColorStop(1,'#6a2808');
      ctx.fillStyle = bg; ctx.fillRect(x, LBEL_H, COL_W, SKY_H);
      for (let s=0;s<16;s++){ctx.beginPath();ctx.arc(rand(i*400+s*7.3)*COL_W+x,LBEL_H+rand(i*500+s*13.7)*SKY_H*0.65,0.5,0,Math.PI*2);ctx.fillStyle=`rgba(255,255,255,${(0.2+rand(i*600+s*5.1)*0.5).toFixed(2)})`;ctx.fill();}
    } else { // night
      bg = ctx.createLinearGradient(x, LBEL_H, x, HOR_Y);
      bg.addColorStop(0,'#010307'); bg.addColorStop(0.5,'#020510'); bg.addColorStop(1,'#040c1e');
      ctx.fillStyle = bg; ctx.fillRect(x, LBEL_H, COL_W, SKY_H);
      const sc = Math.floor(COL_W * SKY_H / 88);
      for (let s=0;s<sc;s++){ctx.beginPath();ctx.arc(rand(i*300+s*7.3)*COL_W+x,LBEL_H+rand(i*400+s*13.7)*SKY_H*0.78,0.3+rand(i*600+s*3.7)*0.5,0,Math.PI*2);ctx.fillStyle=`rgba(255,255,255,${(0.15+rand(i*500+s*5.1)*0.78).toFixed(2)})`;ctx.fill();}
    }

    // Aurora overlay, in thirds of the sky by what can be seen this hour:
    // camera a third, phone two thirds, naked eye the whole column.
    const ahTier = slot.tier === 'eye' ? SKY_H : slot.tier === 'phone' ? SKY_H * 2 / 3
      : slot.tier === 'camera' ? SKY_H / 3 : 0;
    if (slot.tier != null ? ahTier > 0 : slot.kp > minKp) {
      const ah  = slot.tier != null ? ahTier : auroraH(slot.kp, SKY_H, minKp);
      const op  = st === 'night' ? 1.0 : st === 'nautical' ? 0.78 : st === 'civil' ? 0.52 : st === 'golden' ? 0.38 : 0.28;
      ctx.fillStyle = auroraGrad(ctx, x, HOR_Y - ah, HOR_Y, slot.kp, op);
      ctx.fillRect(x, HOR_Y - ah, COL_W, ah);
    }


    // The Moon where it actually is at this hour: its real altitude for this
    // viewer, so each night's moonrise and moonset land where they really do.
    {
      const m = moonAt(slot.utcMs + 30 * 60000, lat, lon);
      if (m.altitude > 0) {
        const moonY = HOR_Y - Math.sin(m.altitude * Math.PI / 180) * SKY_H * 0.80;
        const moonX = x + COL_W / 2;
        ctx.fillStyle = 'rgba(210,218,245,0.12)';
        ctx.beginPath(); ctx.arc(moonX, moonY, 11, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(208,216,238,${(0.35 + 0.53 * m.illumination).toFixed(2)})`;
        ctx.beginPath(); ctx.arc(moonX, moonY, 4.5, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Past-observed dimming - slightly darken observed/estimated slots
    // so the eye naturally reads left=past, right=future
    if (slot.observed === 'observed') {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x, LBEL_H, COL_W, SKY_H);
    } else if (slot.observed === 'estimated') {
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(x, LBEL_H, COL_W, SKY_H);
    }

    // Selection highlight
    if (i === selectedCol) {
      ctx.fillStyle = 'rgba(100,185,255,0.18)';
      ctx.fillRect(x, LBEL_H, COL_W, SKY_H);
      ctx.fillStyle = 'rgba(120,200,255,0.95)';
      ctx.fillRect(x, LBEL_H, COL_W, 3);
      ctx.strokeStyle = 'rgba(120,200,255,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, LBEL_H+3); ctx.lineTo(x, HOR_Y);
      ctx.moveTo(x+COL_W, LBEL_H+3); ctx.lineTo(x+COL_W, HOR_Y);
      ctx.stroke();
    }

    // Column separator - only draw at 3h boundaries and day transitions
    if (i > 0) {
      const isDayBound  = slots[i].dayIdx !== slots[i-1].dayIdx;
      const is3hBound   = slots[i].nztHour % 3 === 0;
      if (isDayBound || is3hBound) {
        ctx.strokeStyle = isDayBound ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.05)';
        ctx.lineWidth   = isDayBound ? 1 : 0.5;
        ctx.beginPath(); ctx.moveTo(x, LBEL_H); ctx.lineTo(x, HOR_Y); ctx.stroke();
      }
    }
  });

  // What each three-hour block is worth, from the same grid the days card
  // shows: camera, phone or eye, after the Moon and twilight at that hour.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.max(9, Math.min(12, COL_W * 0.55))}px system-ui,"Apple Color Emoji","Segoe UI Emoji",sans-serif`;
  emojis.forEach((e, i) => { if (e) ctx.fillText(e, (i + 0.5) * COL_W, LBEL_H + 14); });
  ctx.textBaseline = 'alphabetic';

  // Ground silhouette
  ctx.fillStyle = '#020609';
  ctx.fillRect(0, HOR_Y, totalW, H - HOR_Y + 2);
  ctx.beginPath(); ctx.moveTo(0, HOR_Y);
  [[0,0],[0.08,2.5],[0.18,-1],[0.28,3],[0.4,1.5],[0.52,4],[0.64,2],[0.77,-0.5],[0.88,3],[1,1.5]].forEach(([px,py]) => ctx.lineTo((px as number)*totalW, HOR_Y - (py as number)));
  ctx.lineTo(totalW, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle = '#030810'; ctx.fill();

  // Day-label strip
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, totalW, LBEL_H);
  const dayGroups: Record<number, { label: string; start: number; count: number }> = {};
  slots.forEach((s,i) => {
    if (!dayGroups[s.dayIdx]) dayGroups[s.dayIdx] = {label:s.dayLabel,start:i,count:1};
    else dayGroups[s.dayIdx].count++;
  });
  Object.values(dayGroups).sort((a, b) => a.start - b.start).forEach(({label,start,count}) => {
    ctx.font = '500 10px system-ui,sans-serif';
    ctx.fillStyle = 'rgba(200,212,224,0.9)';
    ctx.textAlign = 'center';
    ctx.fillText(label, (start + count/2)*COL_W, 13);
    if (start > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(start*COL_W, 0); ctx.lineTo(start*COL_W, H); ctx.stroke();
    }
  });

  // Time labels - show every 3 hours so they don't crowd on 1h columns
  for (let i=0; i<COLS; i++) {
    const h = slots[i].nztHour;
    // Show at midnight (day transition) and every 3h
    const showLabel = h % 3 === 0;
    if (!showLabel) continue;
    const l = h===0?'12am':h<12?`${h}am`:h===12?'12pm':`${h-12}pm`;
    ctx.font = '400 8px system-ui,sans-serif';
    ctx.fillStyle = h === 0 ? 'rgba(180,200,220,0.7)' : 'rgba(100,125,145,0.75)';
    ctx.textAlign = 'center';
    ctx.fillText(l, (i+0.5)*COL_W, H-2);
  }

  // "Now" marker
  const nowMs = Date.now();
  const ni = slots.findIndex(s => s.utcMs > nowMs);
  if (ni > 0) {
    const nx = ni * COL_W;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
    ctx.setLineDash([3,3]);
    ctx.beginPath(); ctx.moveTo(nx, LBEL_H); ctx.lineTo(nx, HOR_Y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '500 8px system-ui,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('now', nx, LBEL_H+9);
  }
}

// ── Main component ────────────────────────────────────────────────────────────

const KpForecastTimeline: React.FC<KpForecastTimelineProps> = ({
  userLatitude,
  userLongitude,
  sunriseMs,
  sunsetMs,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef   = useRef<HTMLDivElement>(null);
  // The next 72 hours, an hour at a time, from the app's own forecast: the
  // Coronal Hole Tracker's streams and the CME model (utils/threeDayGrid -
  // the days card's grid is built from the same). Each hour carries what can
  // be seen after the Sun, twilight and the Moon at that hour.
  const { gridInputs } = useThreeDayOutlook(3);
  const slots = React.useMemo((): KpSlot[] => {
    if (!gridInputs) return [];
    const HOUR = 3600000;
    const now = Date.now();
    const start = Math.floor(now / HOUR) * HOUR - 3 * HOUR;
    const dayKeys: string[] = [];
    const out: KpSlot[] = [];
    for (let utcMs = start; utcMs <= now + 72 * HOUR; utcMs += HOUR) {
      const nztD = new Date(utcMs + getNzOffsetMs(utcMs));
      const dayKey = nztD.toISOString().slice(0, 10);
      if (!dayKeys.includes(dayKey)) dayKeys.push(dayKey);
      const mid = utcMs + HOUR / 2;
      const c = combinedAt(mid, gridInputs);
      const vis = visibilityOutlook(c.raw, skyConditionsAt(mid, gridInputs.latitude, gridInputs.longitude));
      out.push({
        utcMs, nztHour: nztD.getUTCHours(), dayIdx: dayKeys.indexOf(dayKey),
        dayLabel: nztD.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }),
        kp: Math.round(c.equivalentKp * 3) / 3,
        observed: utcMs + HOUR <= now ? 'observed' : 'predicted',
        strength: c.raw, driver: c.driver, tier: vis.tier, effective: Math.round(vis.effectiveStrength),
      });
    }
    return out;
  }, [gridInputs]);
  const emojis = React.useMemo(
    () => slots.map((slot) => (slot.observed !== 'observed' && slot.tier && slot.tier !== 'none' ? TIER_EMOJI[slot.tier] ?? null : null)),
    [slots]);
  const loading = !gridInputs;
  const error = false;
  const [popup,   setPopup]   = useState<PopupState | null>(null);
  const [canvasW, setCanvasW] = useState(700);

  // The viewer, for the Moon's height at each hour.
  const where = React.useMemo(() => {
    if (userLatitude != null && userLongitude != null) return { lat: userLatitude, lon: userLongitude };
    const l = resolveViewerLocation();
    return { lat: l.latitude, lon: l.longitude };
  }, [userLatitude, userLongitude]);


  // Responsive resize
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => setCanvasW(Math.floor(entries[0].contentRect.width)));
    ro.observe(el);
    setCanvasW(el.clientWidth || 700);
    return () => ro.disconnect();
  }, []);

  // Draw
  useEffect(() => {
    if (!canvasRef.current || slots.length === 0) return;
    const drawW = Math.max(canvasW, slots.length * 22);
    drawCanvas(canvasRef.current, slots, drawW, sunriseMs, sunsetMs, where.lat, where.lon, minKpForLocation(userLatitude), popup?.slotIdx ?? -1, emojis);
  }, [slots, canvasW, sunriseMs, sunsetMs, where, userLatitude, popup, emojis]);

  // Click
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (slots.length === 0) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const lx   = e.clientX - rect.left;
    const colW = Math.max(canvasW, slots.length * 22) / slots.length;
    const col  = Math.floor(lx / colW);
    if (col < 0 || col >= slots.length) return;
    if (popup?.slotIdx === col) { setPopup(null); return; }
    setPopup({ slotIdx: col, anchorX: (col + 0.5) * colW });
  }, [slots, canvasW, popup]);

  const sel  = popup ? slots[popup.slotIdx] : null;
  const selSky = sel ? skyTypeFromMs(sel.utcMs, sunriseMs, sunsetMs) : 'night';

  const selMoon = sel ? slotMoon(sel.utcMs, where.lat, where.lon) : null;
  const visRaw = sel && selMoon ? getVis(sel.kp, selMoon, userLatitude, selSky) : null;
  // For daytime/twilight slots with elevated KP, append the sun note to the tip
  const daySkyNote =
    selSky === 'day'      ? 'The sun is currently up - aurora is not visible in daylight even during a storm.'
    : selSky === 'golden' ? 'The sun is at the horizon - it will still be too bright to see aurora right now.'
    : selSky === 'civil'  ? 'Civil twilight - the sky is still bright. Aurora will not be visible yet.'
    : selSky === 'nautical' ? 'Nautical twilight - the sky is darkening but faint aurora may still be washed out by the remaining glow.'
    : null;
  // For day/twilight slots, prepend the sun note to the tip so users understand
  // why they might not see aurora even during elevated activity
  const vis = (() => {
    if (!visRaw || !daySkyNote) return visRaw;
    return { ...visRaw, tip: daySkyNote + (visRaw.tip ? ' ' + visRaw.tip : '') };
  })();

  const fmt  = (h: number) => h===0?'12am':h<12?`${h}am`:h===12?'12pm':`${h-12}pm`;
  const fmtEnd = (h: number) => fmt((h+1)%24);
  const nzTimeLabel = getNzTimeLabel(sel?.utcMs ?? Date.now());


  return (
    <div className="col-span-12 card bg-neutral-950/80 p-4">

      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-base font-semibold text-white">3-day aurora forecast</h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            What the southern sky may look like from NZ over the next 72 hours · click any window for details
          </p>
        </div>
      </div>

      {/* Canvas wrapper - horizontally scrollable for mobile */}
      <div ref={wrapRef} style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', position: 'relative' }}>
        {loading && (
          <div className="h-40 bg-neutral-800/50 rounded-lg animate-pulse" />
        )}
        {error && (
          <div className="h-40 flex items-center justify-center text-neutral-500 text-sm bg-neutral-900/40 rounded-lg border border-neutral-800/50">
            Could not build the forecast - check back shortly
          </div>
        )}
        {!loading && !error && (
          <canvas
            ref={canvasRef}
            onClick={handleClick}
            style={{ display: 'block', cursor: 'pointer', borderRadius: 8 }}
          />
        )}
      </div>

      {/* Detail panel */}
      {popup && sel && vis && (
        <div style={{
          marginTop: 10,
          background: 'var(--color-background-secondary)',
          border: '0.5px solid var(--color-border-secondary)',
          borderRadius: 12,
          padding: '12px 16px',
        }}>

          {/* Stats row */}
          <div style={{ display:'flex', alignItems:'center', gap:0, flexWrap:'wrap' }}>

            {/* Time + badge */}
            <div style={{ flex:'1 1 auto', minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:7, flexWrap:'wrap' }}>
                <span style={{ fontSize:13, fontWeight:500, color:'var(--color-text-primary)' }}>
                  {sel.dayLabel} · {fmt(sel.nztHour)}-{fmtEnd(sel.nztHour)} {nzTimeLabel}
                </span>
                <span style={{
                  fontSize:10, padding:'1px 7px', borderRadius:10,
                  background: sel.observed === 'observed' ? 'rgba(100,100,100,0.25)' : sel.observed === 'estimated' ? 'rgba(250,180,0,0.18)' : 'rgba(50,140,255,0.18)',
                  color: sel.observed === 'observed' ? 'var(--color-text-tertiary)' : sel.observed === 'estimated' ? '#f0a030' : '#70b8ff',
                }}>
                  {sel.observed === 'observed' ? 'recorded' : sel.observed === 'estimated' ? 'estimated' : 'forecast'}
                </span>
              </div>
            </div>

            {/* Stat pills */}
            <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginLeft:8 }}>
              {/* KP */}
              <span style={{ fontSize:13, fontWeight:500, color: gColor(sel.kp) }}>
                ≈ Kp {sel.kp.toFixed(2).replace(/\.?0+$/, '') || '0'}
              </span>
              {sel.driver && (
                <span style={{ fontSize:11, color:'var(--color-text-tertiary)' }}>
                  {sel.driver === 'coronal hole' ? 'coronal hole stream'
                    : sel.driver === 'CME' ? 'CME'
                    : 'quiet'}
                  {sel.tier && sel.tier !== 'none' && ` · ${TIER_EMOJI[sel.tier]} ${sel.effective}/100`}
                </span>
              )}
              {gScale(sel.kp) && (
                <span style={{ fontSize:11, fontWeight:500, padding:'2px 8px', borderRadius:20, background:gColor(sel.kp)+'22', color:gColor(sel.kp) }}>
                  {gScale(sel.kp)}
                </span>
              )}
              {/* Moon */}
              <span style={{ fontSize:12, color:'var(--color-text-tertiary)', borderLeft:'0.5px solid var(--color-border-tertiary)', paddingLeft:8 }}>
                Moon {selMoon ? `${Math.round(selMoon.illumPct)}%${selMoon.up ? ' up' : ' down'}` : ''}
              </span>
              {/* Regions pill */}
              {vis.regions.length > 0 && (
                <span style={{ fontSize:11, color:'var(--color-text-secondary)', borderLeft:'0.5px solid var(--color-border-tertiary)', paddingLeft:8 }}>
                  {vis.regions[0]}{vis.regions.length > 1 ? ` +${vis.regions.length - 1}` : ''}
                </span>
              )}
            </div>

            {/* Close */}
            <button
              onClick={() => setPopup(null)}
              style={{ background:'none', border:'none', cursor:'pointer', fontSize:18, lineHeight:1, color:'var(--color-text-tertiary)', padding:'2px 6px', marginLeft:8 }}
            >×</button>
          </div>

          {/* Summary sentence */}
          <div style={{ marginTop:9, paddingTop:9, borderTop:'0.5px solid var(--color-border-tertiary)', fontSize:13, color:'var(--color-text-secondary)', lineHeight:1.55 }}>
            {vis.summary}
          </div>

        </div>
      )}

      {/* Legend */}
      <div className="mt-2 pt-2 border-t border-neutral-800/60 flex flex-wrap gap-x-4 gap-y-1 items-center">
        {[
          { c:'#00dc3e', l:'Green (aurora base)' },
          { c:'#ff3c96', l:'Pink (active)' },
          { c:'#508cff', l:'Blue (intense, G3+)' },
          { c:'#d2daef', l:'Moonrise / moonset' },
        ].map(({c,l}) => (
          <span key={l} className="flex items-center gap-1.5 text-xs text-neutral-500">
            <span style={{ width:10, height:10, background:c, borderRadius:2, display:'inline-block', flexShrink:0 }} />
            {l}
          </span>
        ))}
        <span className="text-xs text-neutral-500">Aurora height: 📷 camera a third · 📱 phone two thirds · 👁️ naked eye the full sky, after the Moon and twilight</span>
        <span className="text-xs text-neutral-600 ml-auto">
          {gridInputs
            ? 'From the Coronal Hole Tracker\'s streams and the CME model, for your location'
            : userLatitude != null ? `Bar height calibrated to ${Math.abs(userLatitude).toFixed(1)}°${userLatitude < 0 ? 'S' : 'N'} - aurora threshold Kp ${minKpForLocation(userLatitude).toFixed(1)}` : 'No GPS - showing NZ-wide aurora threshold (Kp 4.67)'}
        </span>
      </div>

    </div>
  );
};

export { KpForecastTimeline };
export default KpForecastTimeline;
