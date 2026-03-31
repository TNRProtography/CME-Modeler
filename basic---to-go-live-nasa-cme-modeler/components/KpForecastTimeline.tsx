// components/KpForecastTimeline.tsx

import React, { useCallback, useEffect, useRef, useState } from 'react';

const NOAA_KP_URL   = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';
const NZ_OFFSET_H   = 13;   // NZDT = UTC+13 (April daylight saving)
const KP_THRESHOLD  = 4.33; // below this: no aurora overlay

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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rand(s: number) { const x = Math.sin(s+1)*10000; return x - Math.floor(x); }

type SkyT = 'day'|'golden'|'civil'|'nautical'|'night';
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

  if (kp >= 8) {                              // G4+ — all three bold
    g.addColorStop(0,    `rgba(80,130,255,${a(0)})`);
    g.addColorStop(0.04, `rgba(80,130,255,${a(0.80)})`);
    g.addColorStop(0.28, `rgba(80,130,255,${a(0.85)})`);
    g.addColorStop(0.42, `rgba(255,60,150,${a(0.85)})`);
    g.addColorStop(0.60, `rgba(255,60,150,${a(0.82)})`);
    g.addColorStop(0.72, `rgba(0,220,65,${a(0.90)})`);
    g.addColorStop(0.90, `rgba(0,220,65,${a(0.92)})`);
    g.addColorStop(1,    `rgba(0,220,65,${a(0.10)})`);
  } else if (kp >= 7) {                       // G3 — blue cap, good pink, green main
    g.addColorStop(0,    `rgba(80,125,255,${a(0)})`);
    g.addColorStop(0.08, `rgba(80,125,255,${a(0.65)})`);
    g.addColorStop(0.28, `rgba(80,125,255,${a(0.70)})`);
    g.addColorStop(0.42, `rgba(255,60,148,${a(0.78)})`);
    g.addColorStop(0.60, `rgba(255,60,148,${a(0.73)})`);
    g.addColorStop(0.72, `rgba(0,218,62,${a(0.85)})`);
    g.addColorStop(0.90, `rgba(0,218,62,${a(0.88)})`);
    g.addColorStop(1,    `rgba(0,218,62,${a(0.10)})`);
  } else if (kp >= 6) {                       // G2 — hint of blue, pink band, green main
    g.addColorStop(0,    `rgba(80,118,255,${a(0)})`);
    g.addColorStop(0.10, `rgba(80,118,255,${a(0.40)})`);
    g.addColorStop(0.25, `rgba(80,118,255,${a(0.42)})`);
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
}

function getVis(kp: number, moon: number, lat: number | null | undefined): VisInfo {
  const ml = moonLabel(moon);

  if (kp <= KP_THRESHOLD) return {
    headline: 'Not visible from New Zealand',
    detail:   'Activity is too low for aurora to reach New Zealand. The aurora oval sits well south of NZ at this level.',
    regions: [], moonNote: ml,
    tip: 'Check back when Kp reaches 5 or above.',
  };

  if (kp >= 8) return {
    headline: 'Visible across all of New Zealand',
    detail:   'Major geomagnetic storm. Aurora visible nationwide — Northland to Invercargill — even from suburban areas. Expect greens, pinks, and vivid blue/purple higher in the sky.',
    regions:  ['Northland','Auckland','Waikato','Bay of Plenty','Wellington','Nelson','Canterbury','Otago','Southland'],
    moonNote: `${ml} — moon has no meaningful impact at this storm level.`,
    tip: 'Go outside and look in any direction — at G4+ aurora can appear overhead. Face south for the most dramatic display.',
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
    };
  }

  if (kp >= 6) {
    if (moon > 80) return {
      headline: 'South Island likely, North Island difficult',
      detail:   'Moderate storm. South Island should see clear aurora. Full moon will wash out fainter aurora for North Island — very dark sites needed.',
      regions:  ['Southland','Otago','Canterbury','Marlborough','Nelson','Wellington (dark sites)'],
      moonNote: `${ml} — significantly reduces North Island chances.`,
      tip:      'South Island: any dark spot works. North Island: coastal headlands or hilltops away from light pollution.',
    };
    return {
      headline: moon > 55 ? 'South Island to Northland — dark sites help in North Island' : 'Visible South Island to Northland',
      detail:   moon > 55
        ? 'Moderate storm. South Island clear. North Island (Auckland, Northland) has a good chance from dark locations — moon may reduce the faint edges.'
        : 'Moderate storm. South Island and North Island including Auckland and Northland all have a strong chance. Find a dark spot and look south.',
      regions:  ['Southland','Otago','Canterbury','Nelson','Wellington','Manawatu','Auckland','Northland'],
      moonNote: moon > 55 ? `${ml} — North Island: prioritise dark sites.` : ml,
      tip:      "Point your phone camera south — it's more sensitive than your eyes and may reveal colours before you see them.",
    };
  }

  if (kp >= 5) {
    if (moon > 80) return {
      headline: 'Southland and Otago — dark sites only',
      detail:   'Minor storm. Full moon makes conditions difficult. Only the very south of New Zealand is likely to see aurora, and only from truly dark locations.',
      regions:  ['Southland (dark sky sites)','Otago (dark sky sites)'],
      moonNote: `${ml} — aurora is faint at G1 and the moon compounds this.`,
      tip:      'Use a camera on a tripod, 10–15 second exposure pointed south. Your eyes may see nothing but the camera might.',
    };
    if (moon > 55) return {
      headline: 'South Island south of Christchurch',
      detail:   'Minor storm. Southern South Island (Southland, Otago, South Canterbury) should see aurora from dark locations. Partial moon reduces visibility further north.',
      regions:  ['Southland','Otago','South Canterbury'],
      moonNote: `${ml} — reduces visibility in marginal locations.`,
      tip:      'Look for a green or pink brightening on the southern horizon before distinct curtains develop.',
    };
    return {
      headline: 'South Island including Nelson',
      detail:   'Minor storm. From Invercargill up to Nelson has a good chance from dark locations. Dark skies are essential at this level.',
      regions:  ['Southland','Otago','Canterbury','Marlborough','Nelson'],
      moonNote: moon > 25 ? `${ml} — aurora visible, but darker sites improve chances.` : ml,
      tip:      'Find a spot with a clear southern horizon — coastal beaches and hilltops are ideal. Look low on the horizon first.',
    };
  }

  // KP 4.34–4.99
  return {
    headline: 'Marginal — very unlikely from New Zealand',
    detail:   'Just above the minimum threshold but below what is needed to reach NZ latitudes. A faint glow might theoretically appear from extreme southern locations under perfect conditions, but is not expected.',
    regions:  [],
    moonNote: ml,
    tip:      "Not worth going out specially. If Kp climbs to 5 the situation will improve quickly — keep the forecast open.",
  };
}

// ── Canvas draw ───────────────────────────────────────────────────────────────

function drawCanvas(
  canvas: HTMLCanvasElement,
  slots:  KpSlot[],
  W:      number,
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
    const st = skyType(slot.nztHour);

    // Sky background
    let bg: CanvasGradient;
    if (st === 'day') {
      bg = ctx.createLinearGradient(x, LBEL_H, x, HOR_Y);
      bg.addColorStop(0, '#0c2a50'); bg.addColorStop(0.5, '#1a4a80'); bg.addColorStop(1, '#2060a0');
      ctx.fillStyle = bg; ctx.fillRect(x, LBEL_H, COL_W, SKY_H);
      // Arc: sun rises at h=7, peaks at h=13, sets at h=19 (NZ April)
      const sunFrac = Math.max(0, Math.sin(Math.PI * (slot.nztHour - 7) / 12));
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
      const gSunFrac = Math.max(0, Math.sin(Math.PI * (slot.nztHour - 7) / 12));
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

    // Sunrise / sunset arrows (no text — arrow only)
    const isSet  = slot.nztHour === 18 || slot.nztHour === 19;
    const isRise = slot.nztHour === 6  || slot.nztHour === 7;
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
}

// ── Main component ────────────────────────────────────────────────────────────

const KpForecastTimeline: React.FC<KpForecastTimelineProps> = ({
  moonIllumination,
  userLatitude,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef   = useRef<HTMLDivElement>(null);
  const [slots,   setSlots]   = useState<KpSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);
  const [popup,   setPopup]   = useState<PopupState | null>(null);
  const [canvasW, setCanvasW] = useState(700);

  const moon = moonIllumination ?? 50;

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
            const kp = a.kp + (b.kp - a.kp) * ease;
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
    const ro = new ResizeObserver(entries => setCanvasW(Math.floor(entries[0].contentRect.width)));
    ro.observe(el);
    setCanvasW(el.clientWidth || 700);
    return () => ro.disconnect();
  }, []);

  // Draw
  useEffect(() => {
    if (!canvasRef.current || slots.length === 0) return;
    drawCanvas(canvasRef.current, slots, canvasW);
  }, [slots, canvasW]);

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
  const vis  = sel ? getVis(sel.kp, moon, userLatitude) : null;

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
      <div ref={wrapRef} style={{ position: 'relative' }}>
        {loading && (
          <div className="h-40 bg-neutral-800/50 rounded-lg animate-pulse" />
        )}
        {error && (
          <div className="h-40 flex items-center justify-center text-neutral-500 text-sm bg-neutral-900/40 rounded-lg border border-neutral-800/50">
            Could not load NOAA forecast — check back shortly
          </div>
        )}
        {!loading && !error && (
          <canvas
            ref={canvasRef}
            onClick={handleClick}
            style={{ display: 'block', cursor: 'pointer', borderRadius: 8, width: '100%' }}
          />
        )}
      </div>

      {/* Detail panel — renders in-flow below canvas, no overflow/z-index issues */}
      {popup && sel && vis && (
        <div style={{
          marginTop: 10,
          background: 'var(--color-background-secondary)',
          border: '0.5px solid var(--color-border-secondary)',
          borderRadius: 12,
          padding: '14px 16px',
        }}>
          {/* Header row: time, badge, KP, close */}
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:12 }}>
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6, flexWrap:'wrap' }}>
                <span style={{ fontSize:14, fontWeight:500, color:'var(--color-text-primary)' }}>
                  {sel.dayLabel} · {fmt(sel.nztHour)}–{fmtEnd(sel.nztHour)} NZT
                </span>
                <span style={{
                  fontSize:10, padding:'2px 8px', borderRadius:10,
                  background: sel.observed === 'observed' ? 'rgba(100,100,100,0.25)' : sel.observed === 'estimated' ? 'rgba(250,180,0,0.18)' : 'rgba(50,140,255,0.18)',
                  color: sel.observed === 'observed' ? 'var(--color-text-tertiary)' : sel.observed === 'estimated' ? '#f0a030' : '#70b8ff',
                }}>
                  {sel.observed === 'observed' ? 'recorded' : sel.observed === 'estimated' ? 'estimated' : 'forecast'}
                </span>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ fontSize:22, fontWeight:500, color: gColor(sel.kp) }}>Kp {sel.kp.toFixed(1)}</span>
                {gScale(sel.kp) && (
                  <span style={{ fontSize:12, fontWeight:500, padding:'3px 10px', borderRadius:20, background:gColor(sel.kp)+'22', color:gColor(sel.kp) }}>
                    {gScale(sel.kp)}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => setPopup(null)}
              style={{ background:'none', border:'none', cursor:'pointer', fontSize:20, lineHeight:1, color:'var(--color-text-tertiary)', padding:'2px 4px', marginTop:2 }}
            >×</button>
          </div>

          {/* Two-column layout for details */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px 20px' }}>

            {/* Left col: visibility headline + detail */}
            <div style={{ gridColumn: vis.regions.length > 0 ? '1' : '1 / -1' }}>
              <div style={{ fontSize:11, color:'var(--color-text-tertiary)', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.06em' }}>Aurora visibility</div>
              <div style={{ fontSize:13, fontWeight:500, color:'var(--color-text-primary)', marginBottom:6 }}>
                {vis.headline}
              </div>
              <div style={{ fontSize:12, color:'var(--color-text-secondary)', lineHeight:1.6 }}>
                {vis.detail}
              </div>
            </div>

            {/* Right col: regions (only if any) */}
            {vis.regions.length > 0 && (
              <div>
                <div style={{ fontSize:11, color:'var(--color-text-tertiary)', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.06em' }}>Likely regions</div>
                <div style={{ fontSize:12, color:'var(--color-text-secondary)', lineHeight:1.7 }}>
                  {vis.regions.map((r, ri) => (
                    <span key={r}>
                      {r}{ri < vis.regions.length - 1 ? <span style={{ color:'var(--color-text-tertiary)' }}> · </span> : ''}
                    </span>
                  ))}
                </div>
              </div>
            )}

          </div>

          {/* Moon + tip row */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px 20px', marginTop:10, paddingTop:10, borderTop:'0.5px solid var(--color-border-tertiary)' }}>
            <div>
              <div style={{ fontSize:11, color:'var(--color-text-tertiary)', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.06em' }}>Moon conditions</div>
              <div style={{ fontSize:12, color:'var(--color-text-secondary)', lineHeight:1.55 }}>{vis.moonNote}</div>
            </div>
            <div>
              <div style={{ fontSize:11, color:'var(--color-text-tertiary)', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.06em' }}>What to do</div>
              <div style={{ fontSize:12, color:'var(--color-text-secondary)', lineHeight:1.55 }}>{vis.tip}</div>
            </div>
          </div>

        </div>
      )}

      {/* Legend */}
      <div className="mt-2 pt-2 border-t border-neutral-800/60 flex flex-wrap gap-x-4 gap-y-1 items-center">
        {[
          { c:'#00dc3e', l:'Green (aurora base)' },
          { c:'#ff3c96', l:'Pink (active)' },
          { c:'#508cff', l:'Blue (intense, G3+)' },
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