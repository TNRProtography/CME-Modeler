// components/KpForecastTimeline.tsx

import React, { useCallback, useEffect, useRef, useState } from 'react';

const NOAA_KP_URL   = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';
const NZ_OFFSET_H   = 13;   // NZDT = UTC+13 (April daylight saving)
const KP_THRESHOLD  = 4.33; // below this: no aurora overlay
const MOBILE_BREAKPOINT = 768;
const MOBILE_MIN_SLOT_WIDTH = 28;

interface KpSlot {
  utcMs:    number;
  nztHour:  number;
  dayIdx:   number;
  dayLabel: string;
  kp:       number;
  observed: string; // 'observed' | 'estimated' | 'predicted'
}
interface PopupState { slotIdx: number; anchorX: number; }

interface KpForecastTimelineProps {
  moonIllumination?: number | null; // 0–100
  userLatitude?:     number | null;
  sunriseMs?:        number | null; // Unix ms UTC from celestialTimes.sun.rise
  sunsetMs?:         number | null; // Unix ms UTC from celestialTimes.sun.set
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
    const NZT_OFFSET  = NZ_OFFSET_H * 3600000;

    // Key insight: sunriseMs/sunsetMs are today's UTC timestamps, but NZ is
    // UTC+13 so a 6:30am NZT sunrise is 5:30pm UTC the *previous* day.
    // Extracting % DAY_MS in UTC gives the wrong hour entirely.
    // Fix: work in NZT — extract the NZT time-of-day, anchor to the slot's
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
  const nztH = new Date(slotUtcMs + NZ_OFFSET_H * 3600000).getUTCHours();
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

function auroraH(kp: number, skyH: number): number {
  if (kp <= KP_THRESHOLD) return 0;
  return Math.pow((kp - KP_THRESHOLD) / (9 - KP_THRESHOLD), 0.70) * skyH * 0.92;
}

// Always green (bottom) → pink (mid) → purple (top, G3+). Height + intensity vary by KP.
function auroraGrad(
  ctx: CanvasRenderingContext2D,
  x: number, topY: number, botY: number,
  kp: number, op: number
) {
  // Gradient runs top→bottom: [0]=top of band [1]=horizon
  // so colour order from stop 0 to stop 1:  purple → pink → green → transparent
  const g = ctx.createLinearGradient(x, topY, x, botY);
  const a = (v: number) => Math.min(1, v * op).toFixed(3);

  if (kp >= 8) {                              // G4+ — all three bold
    g.addColorStop(0,    `rgba(170,105,255,${a(0)})`);
    g.addColorStop(0.04, `rgba(170,105,255,${a(0.80)})`);
    g.addColorStop(0.28, `rgba(170,105,255,${a(0.85)})`);
    g.addColorStop(0.42, `rgba(255,60,150,${a(0.85)})`);
    g.addColorStop(0.60, `rgba(255,60,150,${a(0.82)})`);
    g.addColorStop(0.72, `rgba(0,220,65,${a(0.90)})`);
    g.addColorStop(0.90, `rgba(0,220,65,${a(0.92)})`);
    g.addColorStop(1,    `rgba(0,220,65,${a(0.10)})`);
  } else if (kp >= 7) {                       // G3 — purple cap, good pink, green main
    g.addColorStop(0,    `rgba(162,96,255,${a(0)})`);
    g.addColorStop(0.08, `rgba(162,96,255,${a(0.65)})`);
    g.addColorStop(0.28, `rgba(162,96,255,${a(0.70)})`);
    g.addColorStop(0.42, `rgba(255,60,148,${a(0.78)})`);
    g.addColorStop(0.60, `rgba(255,60,148,${a(0.73)})`);
    g.addColorStop(0.72, `rgba(0,218,62,${a(0.85)})`);
    g.addColorStop(0.90, `rgba(0,218,62,${a(0.88)})`);
    g.addColorStop(1,    `rgba(0,218,62,${a(0.10)})`);
  } else if (kp >= 6) {                       // G2 — hint of purple, pink band, green main
    g.addColorStop(0,    `rgba(155,92,245,${a(0)})`);
    g.addColorStop(0.10, `rgba(155,92,245,${a(0.40)})`);
    g.addColorStop(0.25, `rgba(155,92,245,${a(0.42)})`);
    g.addColorStop(0.40, `rgba(245,60,145,${a(0.68)})`);
    g.addColorStop(0.58, `rgba(245,60,145,${a(0.65)})`);
    g.addColorStop(0.70, `rgba(0,215,60,${a(0.82)})`);
    g.addColorStop(0.90, `rgba(0,215,60,${a(0.85)})`);
    g.addColorStop(1,    `rgba(0,215,60,${a(0.08)})`);
  } else {                                    // G1 — green base, faint pink, no blue
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
  if (p > 85) return `Full moon (${Math.round(p)}%) — bright sky glow`;
  if (p > 65) return `Gibbous moon (${Math.round(p)}%) — noticeable glow`;
  if (p > 40) return `Quarter moon (${Math.round(p)}%) — some interference`;
  if (p > 15) return `Crescent (${Math.round(p)}%) — minimal impact`;
  return `Near new moon (${Math.round(p)}%) — ideal dark skies`;
}

interface VisInfo {
  headline: string; detail: string;
  regions:  string[]; moonNote: string; tip: string;
  summary:  string; // single overarching sentence shown in compact panel
}

function getSkyNarrative(sky: SkyT): string {
  if (sky === 'day') return 'Sun above horizon, so aurora is not visible yet.';
  if (sky === 'golden') return 'Sun at the horizon, and twilight is still too bright for aurora.';
  if (sky === 'civil') return 'Civil twilight remains bright, which suppresses faint aurora.';
  if (sky === 'nautical') return 'Nautical twilight is improving, but faint aurora can still wash out.';
  return 'Full darkness gives the best chance to see faint detail.';
}

function getLocationNarrative(userLatitude?: number | null): string {
  if (userLatitude == null) return 'Using New Zealand-wide visibility guidance.';
  if (userLatitude <= -45) return 'Your southern location boosts visibility compared with most of NZ.';
  if (userLatitude <= -41) return 'Your location is favourable for this activity level.';
  if (userLatitude <= -38) return 'Your location is moderate; dark skies and a clear southern horizon matter more.';
  return 'Your northern location needs stronger activity and very dark skies.';
}

function buildSlotSummary(
  slot: KpSlot,
  moon: number,
  sky: SkyT,
  vis: VisInfo,
  userLatitude?: number | null,
): string {
  const kpTxt = `KP ${slot.kp.toFixed(2).replace(/\.?0+$/, '') || '0'}`;
  const moonTxt = `Moon ${Math.round(moon)}%`;
  const regionTxt = vis.regions.length > 0
    ? `Best visibility: ${vis.regions.slice(0, 3).join(', ')}${vis.regions.length > 3 ? ` +${vis.regions.length - 3} more` : ''}.`
    : 'No NZ region is strongly favoured at this level.';
  return `${kpTxt} · ${moonTxt}. ${getSkyNarrative(sky)} ${vis.detail} ${regionTxt} ${getLocationNarrative(userLatitude)} Overall: ${vis.summary}`;
}

function getVis(kp: number, moon: number, lat: number | null | undefined, sky: SkyT = 'night'): VisInfo {
  const ml = moonLabel(moon);

  // Daylight override: even with high KP, aurora cannot be seen until the sky
  // is dark enough. Keep storm context, but make visibility guidance explicit.
  if (sky === 'day' || sky === 'golden' || sky === 'civil') {
    const stormBand = kp >= 8 ? 'major storm' : kp >= 7 ? 'strong storm' : kp >= 6 ? 'moderate storm' : kp >= 5 ? 'minor storm' : 'low activity';
    const whenDark =
      kp >= 7 ? 'Once fully dark, visibility is likely across most or all of New Zealand.'
      : kp >= 6 ? 'Once fully dark, the South Island is favoured and parts of the North Island may also see it from dark sites.'
      : kp >= 5 ? 'Once fully dark, southern South Island dark-sky locations are most favoured.'
      : 'Even after dark, conditions are currently marginal for New Zealand.';
    return {
      headline: sky === 'day' ? 'Sun is up — aurora not visible yet' : 'Twilight — aurora likely not visible yet',
      detail: `KP is elevated (${kp.toFixed(2).replace(/\.?0+$/, '')}), indicating ${stormBand} conditions, but the sky is still too bright for visual aurora right now. ${whenDark}`,
      regions: kp >= 5 ? ['Southland','Otago','Canterbury','Nelson','Wellington','Auckland'] : [],
      moonNote: ml,
      tip: 'Use this slot as a readiness signal: check cloud cover and be ready to observe once full darkness begins.',
      summary: 'High geomagnetic activity can exist in daylight, but aurora viewing must wait until full darkness.',
    };
  }

  // Sky brightness note — added to tip for daytime/twilight slots
  const skyNote =
    sky === 'day'      ? ' Note: the sun is up — aurora is not visible in daylight regardless of activity level.' :
    sky === 'golden'   ? ' Note: the sun is at or near the horizon — it will still be too bright to see aurora.' :
    sky === 'civil'    ? ' Note: civil twilight — the sky is still quite bright. Aurora is unlikely to be visible yet.' :
    sky === 'nautical' ? ' Note: nautical twilight — the sky is getting darker but faint aurora may still be washed out.' :
    '';

  if (kp <= KP_THRESHOLD) return {
    headline: sky === 'day' ? 'Daytime — aurora not visible' : 'Not visible from New Zealand',
    detail:   sky === 'day'
      ? 'The sun is up. Aurora cannot be seen during daylight hours regardless of space weather conditions.'
      : sky === 'golden' || sky === 'civil'
      ? 'The sky is still too bright for aurora to be visible. Activity is also below the NZ threshold.'
      : 'Activity is too low for aurora to reach New Zealand. The aurora oval sits well south of NZ at this level.',
    regions: [], moonNote: ml,
    tip: sky === 'day' || sky === 'golden' || sky === 'civil'
      ? 'Check back after dark — aurora only becomes visible once the sky is fully dark.'
      : 'Check back when Kp reaches 5 or above.',
    summary: sky === 'day' ? 'The sun is up — aurora cannot be seen in daylight.'
      : sky === 'golden' || sky === 'civil' ? 'Too bright to see aurora — wait until fully dark.'
      : sky === 'nautical' ? 'Sky nearly dark but Kp too low for NZ aurora tonight.'
      : 'Activity is too low — aurora not expected to reach New Zealand.',
  };

  if (kp >= 8) return {
    headline: 'Visible across all of New Zealand',
    detail:   'Major geomagnetic storm. Aurora visible nationwide — Northland to Invercargill — even from suburban areas. Expect greens, pinks, and vivid blue/purple higher in the sky.',
    regions:  ['Northland','Auckland','Waikato','Bay of Plenty','Wellington','Nelson','Canterbury','Otago','Southland'],
    moonNote: `${ml} — moon has no meaningful impact at this storm level.`,
    tip: 'Go outside and look in any direction — at G4+ aurora can appear overhead. Face south for the most dramatic display.',
    summary: 'Major storm — aurora visible across all of New Zealand, moon is no obstacle.',
  };

  if (kp >= 7) {
    const northNote = moon > 80
      ? 'North Island: find a dark hilltop away from city lights — full moon may reduce visibility.'
      : moon > 55
      ? 'North Island: head to a dark location for best viewing.'
      : 'North Island visible clearly, even from suburbs.';
    return {
      headline: 'Visible across all of New Zealand',
      detail:   `Strong storm. The entire South Island will see clear aurora. ${northNote}`,
      regions:  ['Southland','Otago','Canterbury','Marlborough','Nelson','Wellington','Manawatu',"Hawke's Bay",'Waikato','Auckland','Northland'],
      moonNote: moon > 80
        ? `${ml} — may reduce North Island visibility slightly. South Island unaffected.`
        : ml,
      tip: 'Face south and look up. Green is most common; pink/red higher up indicates strong activity near you.',
      summary: moon > 80 ? 'Strong storm — all NZ should see aurora; North Island: find dark skies to counter the full moon.'
        : 'Strong storm — aurora visible the length of New Zealand tonight.',
    };
  }

  if (kp >= 6) {
    if (moon > 80) return {
      headline: 'South Island likely, North Island difficult',
      detail:   'Moderate storm. South Island should see clear aurora. Full moon will wash out fainter aurora for North Island — very dark sites needed.',
      regions:  ['Southland','Otago','Canterbury','Marlborough','Nelson','Wellington (dark sites)'],
      moonNote: `${ml} — significantly reduces North Island chances.`,
      tip:      'South Island: any dark spot works. North Island: coastal headlands or hilltops away from light pollution.',
      summary:  'Moderate storm — South Island clear, North Island needs dark skies to beat the full moon.',
    };
    return {
      headline: moon > 55 ? 'South Island to Northland — dark sites help in North Island' : 'Visible South Island to Northland',
      detail:   moon > 55
        ? 'Moderate storm. South Island clear. North Island (Auckland, Northland) has a good chance from dark locations — moon may reduce the faint edges.'
        : 'Moderate storm. South Island and North Island including Auckland and Northland all have a strong chance. Find a dark spot and look south.',
      regions:  ['Southland','Otago','Canterbury','Nelson','Wellington','Manawatu','Auckland','Northland'],
      moonNote: moon > 55 ? `${ml} — North Island: prioritise dark sites.` : ml,
      tip:      "Point your phone camera south — it's more sensitive than your eyes and may reveal colours before you see them.",
      summary:  moon > 55 ? 'Moderate storm — South Island to Northland; find dark spots in the North Island.'
        : 'Moderate storm — good chance across South Island and up to Northland.',
    };
  }

  if (kp >= 5) {
    if (moon > 80) return {
      headline: 'Southland and Otago — dark sites only',
      detail:   'Minor storm. Full moon makes conditions difficult. Only the very south of New Zealand is likely to see aurora, and only from truly dark locations.',
      regions:  ['Southland (dark sky sites)','Otago (dark sky sites)'],
      moonNote: `${ml} — aurora is faint at G1 and the moon compounds this.`,
      tip:      'Use a camera on a tripod, 10–15 second exposure pointed south. Your eyes may see nothing but the camera might.',
      summary:  'Minor storm — only extreme south NZ in very dark sites; full moon makes conditions tough.',
    };
    if (moon > 55) return {
      headline: 'South Island south of Christchurch',
      detail:   'Minor storm. Southern South Island (Southland, Otago, South Canterbury) should see aurora from dark locations. Partial moon reduces visibility further north.',
      regions:  ['Southland','Otago','South Canterbury'],
      moonNote: `${ml} — reduces visibility in marginal locations.`,
      tip:      'Look for a green or pink brightening on the southern horizon before distinct curtains develop.',
      summary:  'Minor storm — southern South Island has a fair chance from dark locations tonight.',
    };
    return {
      headline: 'South Island including Nelson',
      detail:   'Minor storm. From Invercargill up to Nelson has a good chance from dark locations. Dark skies are essential at this level.',
      regions:  ['Southland','Otago','Canterbury','Marlborough','Nelson'],
      moonNote: moon > 25 ? `${ml} — aurora visible, but darker sites improve chances.` : ml,
      tip:      'Find a spot with a clear southern horizon — coastal beaches and hilltops are ideal. Look low on the horizon first.',
      summary:  moon > 25 ? 'Minor storm — South Island to Nelson likely; dark skies improve your chances.'
        : 'Minor storm — South Island to Nelson has a good chance from dark locations.',
    };
  }

  // KP 4.34–4.99
  return {
    headline: 'Marginal — very unlikely from New Zealand',
    detail:   'Just above the minimum threshold but below what is needed to reach NZ latitudes. A faint glow might theoretically appear from extreme southern locations under perfect conditions, but is not expected.',
    regions:  [],
    moonNote: ml,
    tip:      "Not worth going out specially. If Kp climbs to 5 the situation will improve quickly — keep the forecast open.",
    summary:  'Marginal activity — aurora is not expected to be visible from New Zealand.',
  };
}

// ── Canvas draw ───────────────────────────────────────────────────────────────

function drawCanvas(
  canvas:    HTMLCanvasElement,
  slots:     KpSlot[],
  W:         number,
  sunriseMs: number | null | undefined,
  sunsetMs:  number | null | undefined,
  selectedIdx?: number | null,
) {
  const COLS   = slots.length;
  if (COLS === 0) return;
  const DPR    = window.devicePixelRatio || 1;
  const COL_W  = W / COLS;
  const H      = Math.round(Math.min(220, Math.max(160, W * 0.28)));
  const LBEL_H = 20;
  const SKY_H  = H - LBEL_H - 14;
  const HOR_Y  = LBEL_H + SKY_H;

  canvas.width  = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  canvas.style.width  = `${W}px`;
  canvas.style.height = `${H}px`;

  const ctx = canvas.getContext('2d')!;
  ctx.scale(DPR, DPR);
  ctx.clearRect(0, 0, W, H);

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
      const NZT_OFF_A = NZ_OFFSET_H * 3600000;
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
      const gNZTOff = NZ_OFFSET_H * 3600000;
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

    // Aurora overlay
    if (slot.kp > KP_THRESHOLD) {
      const ah  = auroraH(slot.kp, SKY_H);
      const op  = st === 'night' ? 1.0 : st === 'nautical' ? 0.78 : st === 'civil' ? 0.52 : st === 'golden' ? 0.38 : 0.28;
      ctx.fillStyle = auroraGrad(ctx, x, HOR_Y - ah, HOR_Y, slot.kp, op);
      ctx.fillRect(x, HOR_Y - ah, COL_W, ah);
    }

    // Sunrise / sunset arrows — use real timestamps when available
    // Show arrow in the column where the sun crosses the horizon
    const HOUR_MS_A = 3600000;
    const ARR_DAY   = 86400000;
    const ARR_NZT   = NZ_OFFSET_H * 3600000;
    const arSlotNzt = slot.utcMs + ARR_NZT;
    const arSlotMid = arSlotNzt - (arSlotNzt % ARR_DAY);
    const arRiseMs  = sunriseMs != null ? arSlotMid + ((sunriseMs + ARR_NZT) % ARR_DAY) - ARR_NZT : null;
    const arSetMs   = sunsetMs  != null ? arSlotMid + ((sunsetMs  + ARR_NZT) % ARR_DAY) - ARR_NZT : null;
    const isSet  = arSetMs != null
      ? (slot.utcMs <= arSetMs && slot.utcMs + HOUR_MS_A > arSetMs)
      : (slot.nztHour === 18 || slot.nztHour === 19);
    const isRise = arRiseMs != null
      ? (slot.utcMs <= arRiseMs && slot.utcMs + HOUR_MS_A > arRiseMs)
      : (slot.nztHour === 6 || slot.nztHour === 7);
    if (isSet || isRise) {
      const cx = x + COL_W / 2;
      const ay = HOR_Y - 7;
      const sz = Math.min(6, COL_W * 0.32);
      ctx.fillStyle = 'rgba(255,165,45,0.92)';
      ctx.beginPath();
      if (isSet) {
        // Down arrow ↓
        ctx.moveTo(cx,           ay + sz);
        ctx.lineTo(cx - sz*0.65, ay - sz*0.35);
        ctx.lineTo(cx - sz*0.22, ay - sz*0.35);
        ctx.lineTo(cx - sz*0.22, ay - sz);
        ctx.lineTo(cx + sz*0.22, ay - sz);
        ctx.lineTo(cx + sz*0.22, ay - sz*0.35);
        ctx.lineTo(cx + sz*0.65, ay - sz*0.35);
      } else {
        // Up arrow ↑
        ctx.moveTo(cx,           ay - sz);
        ctx.lineTo(cx + sz*0.65, ay + sz*0.35);
        ctx.lineTo(cx + sz*0.22, ay + sz*0.35);
        ctx.lineTo(cx + sz*0.22, ay + sz);
        ctx.lineTo(cx - sz*0.22, ay + sz);
        ctx.lineTo(cx - sz*0.22, ay + sz*0.35);
        ctx.lineTo(cx - sz*0.65, ay + sz*0.35);
      }
      ctx.closePath(); ctx.fill();
    }

    // Past-observed dimming — slightly darken observed/estimated slots
    // so the eye naturally reads left=past, right=future
    if (slot.observed === 'observed') {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x, LBEL_H, COL_W, SKY_H);
    } else if (slot.observed === 'estimated') {
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(x, LBEL_H, COL_W, SKY_H);
    }

    // Column separator — only draw at 3h boundaries and day transitions
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

  // Ground silhouette
  ctx.fillStyle = '#020609';
  ctx.fillRect(0, HOR_Y, W, H - HOR_Y + 2);
  ctx.beginPath(); ctx.moveTo(0, HOR_Y);
  [[0,0],[0.08,2.5],[0.18,-1],[0.28,3],[0.4,1.5],[0.52,4],[0.64,2],[0.77,-0.5],[0.88,3],[1,1.5]].forEach(([px,py]) => ctx.lineTo((px as number)*W, HOR_Y - (py as number)));
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle = '#030810'; ctx.fill();

  // Day-label strip
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, W, LBEL_H);
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

  // Time labels — show every 3 hours so they don't crowd on 1h columns
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

  // Selected slot marker — make the chosen time segment visually obvious.
  if (selectedIdx != null && selectedIdx >= 0 && selectedIdx < COLS) {
    const sx = selectedIdx * COL_W;
    // Brightened in-column overlay
    ctx.fillStyle = 'rgba(52, 211, 153, 0.12)';
    ctx.fillRect(sx, LBEL_H, COL_W, SKY_H);
    // High-contrast outline around full segment
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.95)';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx + 1, LBEL_H + 1, Math.max(0, COL_W - 2), SKY_H - 2);
    // Top cap for quick scan
    ctx.fillStyle = 'rgba(52, 211, 153, 0.95)';
    ctx.fillRect(sx + 1, LBEL_H + 1, Math.max(0, COL_W - 2), 3);
  }
}

// ── Main component ────────────────────────────────────────────────────────────

const KpForecastTimeline: React.FC<KpForecastTimelineProps> = ({
  moonIllumination,
  userLatitude,
  sunriseMs,
  sunsetMs,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef   = useRef<HTMLDivElement>(null);
  const [slots,   setSlots]   = useState<KpSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);
  const [popup,   setPopup]   = useState<PopupState | null>(null);
  const [viewportW, setViewportW] = useState(700);
  const [isMobile, setIsMobile] = useState(false);

  const moon = moonIllumination ?? 50;
  const mobileScrollable = isMobile && slots.length > 0;
  const mobileMinCanvasW = slots.length * MOBILE_MIN_SLOT_WIDTH;
  const canvasW = mobileScrollable ? Math.max(viewportW, mobileMinCanvasW) : viewportW;

  // Fetch KP data
  useEffect(() => {
    fetch(NOAA_KP_URL)
      .then(r => r.json())
      .then((raw: any) => {
        // The NOAA endpoint returns either:
        //   • array-of-objects: [{time_tag, kp, observed, noaa_scale}, ...]
        //   • array-of-arrays:  [["time_tag","kp",...], [val, val, ...], ...]
        // Handle both formats gracefully.
        if (!Array.isArray(raw) || raw.length === 0) { setError(true); return; }

        // Detect format
        const isObjects = typeof raw[0] === 'object' && !Array.isArray(raw[0]) && raw[0] !== null;

        const now = Date.now();
        // Show from 3h ago (so "now" marker isn't at the very left edge) through 72h ahead
        const windowStart = now - 3 * 3600000;
        const windowEnd   = now + 72 * 3600000;

        const dayLabels: string[] = [];
        const out: KpSlot[] = [];

        const rows = isObjects ? raw : raw.slice(1);
        rows.forEach((row: any) => {
          const utcStr: string = isObjects
            ? (row.time_tag ?? '')
            : (row[0] ?? '');
          const kpVal = isObjects ? row.kp : row[1];

          // time_tag has no Z suffix — append it to parse as UTC
          const utcMs = new Date(String(utcStr).replace(' ', 'T') + (utcStr.includes('Z') ? '' : 'Z')).getTime();
          if (isNaN(utcMs) || utcMs < windowStart || utcMs > windowEnd) return;

          const kp = parseFloat(String(kpVal));
          if (isNaN(kp)) return;

          // Slot type: observed/estimated/predicted — used for opacity later
          const observed: string = isObjects ? (row.observed ?? 'predicted') : 'predicted';

          const nztMs   = utcMs + NZ_OFFSET_H * 3600000;
          const nztD    = new Date(nztMs);
          const nztH    = nztD.getUTCHours();
          const dayKey  = nztD.toISOString().slice(0, 10);
          if (!dayLabels.includes(dayKey)) dayLabels.push(dayKey);
          const dayIdx   = dayLabels.indexOf(dayKey);
          const dayLabel = nztD.toLocaleDateString('en-NZ', {
            weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
          });
          out.push({ utcMs, nztHour: nztH, dayIdx, dayLabel, kp, observed });
        });

        if (out.length === 0) { setError(true); return; }

        // Interpolate the 3-hourly NOAA readings to 1-hour slots.
        // For each pair of consecutive 3h anchors, linearly interpolate KP
        // so the aurora band rises and falls smoothly across the canvas.
        const hourly: KpSlot[] = [];
        const HOUR_MS = 3600000;
        for (let i = 0; i < out.length - 1; i++) {
          const a = out[i];
          const b = out[i + 1];
          const steps = Math.round((b.utcMs - a.utcMs) / HOUR_MS); // usually 3
          for (let s = 0; s < steps; s++) {
            const t = s / steps;
            const utcMs = a.utcMs + s * HOUR_MS;
            // Smooth ease: use cosine interpolation for a gentle S-curve rise/fall
            const ease = (1 - Math.cos(t * Math.PI)) / 2;
            // KP is only valid in units of 1/3 (0, 0.33, 0.67, 1, 1.33, 1.67 ... 9)
            // Snap the interpolated value to the nearest valid third
            const kpRaw = a.kp + (b.kp - a.kp) * ease;
            const kp = Math.round(kpRaw * 3) / 3;
            const observed = s === 0 ? a.observed : (t < 0.5 ? a.observed : b.observed);
            const nztMs  = utcMs + NZ_OFFSET_H * 3600000;
            const nztD   = new Date(nztMs);
            const nztH   = nztD.getUTCHours();
            const dayKey = nztD.toISOString().slice(0, 10);
            if (!dayLabels.includes(dayKey)) dayLabels.push(dayKey);
            const dayIdx   = dayLabels.indexOf(dayKey);
            const dayLabel = nztD.toLocaleDateString('en-NZ', {
              weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
            });
            hourly.push({ utcMs, nztHour: nztH, dayIdx, dayLabel, kp, observed });
          }
        }
        // Add the final anchor point
        if (out.length > 0) hourly.push(out[out.length - 1]);

        // Trim to a clean 72-hour window from now
        const trimmed = hourly.filter(s => s.utcMs >= windowStart && s.utcMs <= now + 72 * HOUR_MS);
        if (trimmed.length === 0) { setError(true); return; }
        setSlots(trimmed);
        setLoading(false);
      })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  // Responsive resize
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const syncSizing = (width: number) => {
      const safeW = Math.max(320, Math.floor(width || 700));
      setViewportW(safeW);
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    const ro = new ResizeObserver(entries => syncSizing(entries[0].contentRect.width));
    ro.observe(el);
    syncSizing(el.clientWidth || 700);
    const onWindowResize = () => syncSizing(el.clientWidth || 700);
    window.addEventListener('resize', onWindowResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onWindowResize);
    };
  }, []);

  // Draw
  useEffect(() => {
    if (!canvasRef.current || slots.length === 0) return;
    drawCanvas(canvasRef.current, slots, canvasW, sunriseMs, sunsetMs, popup?.slotIdx ?? null);
  }, [slots, canvasW, sunriseMs, sunsetMs, popup?.slotIdx]);

  // Click
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (slots.length === 0) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const lx   = e.clientX - rect.left;
    const col  = Math.floor(lx / (canvasW / slots.length));
    if (col < 0 || col >= slots.length) return;
    if (popup?.slotIdx === col) { setPopup(null); return; }
    setPopup({ slotIdx: col, anchorX: (col + 0.5) * (canvasW / slots.length) });
  }, [slots, canvasW, popup]);

  const sel  = popup ? slots[popup.slotIdx] : null;
  const selSky = sel ? skyTypeFromMs(sel.utcMs, sunriseMs, sunsetMs) : 'night';
  const visRaw = sel ? getVis(sel.kp, moon, userLatitude, selSky) : null;
  // For daytime/twilight slots with elevated KP, append the sun note to the tip
  const daySkyNote =
    selSky === 'day'      ? 'The sun is currently up — aurora is not visible in daylight even during a storm.'
    : selSky === 'golden' ? 'The sun is at the horizon — it will still be too bright to see aurora right now.'
    : selSky === 'civil'  ? 'Civil twilight — the sky is still bright. Aurora will not be visible yet.'
    : selSky === 'nautical' ? 'Nautical twilight — the sky is darkening but faint aurora may still be washed out by the remaining glow.'
    : null;
  // For day/twilight slots, prepend the sun note to the tip so users understand
  // why they might not see aurora even during elevated activity
  const vis = (() => {
    if (!visRaw || !daySkyNote) return visRaw;
    return { ...visRaw, tip: daySkyNote + (visRaw.tip ? ' ' + visRaw.tip : '') };
  })();
  const enrichedSummary = sel && vis
    ? buildSlotSummary(sel, moon, selSky, vis, userLatitude)
    : null;

  const fmt  = (h: number) => h===0?'12am':h<12?`${h}am`:h===12?'12pm':`${h-12}pm`;
  const fmtEnd = (h: number) => fmt((h+1)%24);

  function gScale(kp: number) {
    if (kp>=9) return 'G5'; if (kp>=8) return 'G4'; if (kp>=7) return 'G3';
    if (kp>=6) return 'G2'; if (kp>=5) return 'G1'; return '';
  }
  function gColor(kp: number) {
    if (kp>=8) return '#ff6060'; if (kp>=7) return '#ff9944';
    if (kp>=6) return '#508cff'; if (kp>=5) return '#44dd88'; return '#888';
  }

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
        <span className="text-xs text-neutral-600">
          Kp data: <a
            href="https://www.swpc.noaa.gov/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-700 hover:text-sky-500 transition-colors"
          >NOAA Space Weather Prediction Center</a>
        </span>
      </div>

      {/* Canvas wrapper — no overflow constraints, clean click handling */}
      <div
        ref={wrapRef}
        style={{
          position: 'relative',
          overflowX: mobileScrollable ? 'auto' : 'visible',
          WebkitOverflowScrolling: 'touch',
          paddingBottom: mobileScrollable ? 6 : 0,
        }}
      >
        {loading && (
          <div className="h-40 bg-neutral-800/50 rounded-lg animate-pulse" />
        )}
        {error && (
          <div className="h-40 flex items-center justify-center text-neutral-500 text-sm bg-neutral-900/40 rounded-lg border border-neutral-800/50">
            Could not load NOAA forecast — check back shortly
          </div>
        )}
        {!loading && !error && (
          <div style={{ width: mobileScrollable ? `${canvasW}px` : '100%' }}>
            <canvas
              ref={canvasRef}
              onClick={handleClick}
              style={{
                display: 'block',
                cursor: 'pointer',
                borderRadius: 8,
                width: mobileScrollable ? `${canvasW}px` : '100%',
              }}
            />
          </div>
        )}
      </div>
      {mobileScrollable && !loading && !error && (
        <p className="mt-2 text-[11px] text-neutral-500">Swipe left/right to view later hours and future days.</p>
      )}

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
                  {sel.dayLabel} · {fmt(sel.nztHour)}–{fmtEnd(sel.nztHour)} NZT
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
                Kp {sel.kp.toFixed(2).replace(/\.?0+$/, '') || '0'}
              </span>
              {gScale(sel.kp) && (
                <span style={{ fontSize:11, fontWeight:500, padding:'2px 8px', borderRadius:20, background:gColor(sel.kp)+'22', color:gColor(sel.kp) }}>
                  {gScale(sel.kp)}
                </span>
              )}
              {/* Moon */}
              <span style={{ fontSize:12, color:'var(--color-text-tertiary)', borderLeft:'0.5px solid var(--color-border-tertiary)', paddingLeft:8 }}>
                Moon {Math.round(moon)}%
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
            {enrichedSummary}
          </div>

        </div>
      )}

      {/* Legend */}
      <div className="mt-2 pt-2 border-t border-neutral-800/60 flex flex-wrap gap-x-4 gap-y-1 items-center">
        {[
          { c:'#00dc3e', l:'Green (aurora base)' },
          { c:'#ff3c96', l:'Pink (active)' },
          { c:'#a569ff', l:'Purple (intense, G3+)' },
          { c:'#2060a0', l:'Blue (daytime sky)' },
          { c:'#e07028', l:'Sunrise / sunset' },
        ].map(({c,l}) => (
          <span key={l} className="flex items-center gap-1.5 text-xs text-neutral-500">
            <span style={{ width:10, height:10, background:c, borderRadius:2, display:'inline-block', flexShrink:0 }} />
            {l}
          </span>
        ))}
        <span className="text-xs text-neutral-600 ml-auto">Below Kp 4.33 — not visible from New Zealand</span>
      </div>

    </div>
  );
};

export { KpForecastTimeline };
export default KpForecastTimeline;
