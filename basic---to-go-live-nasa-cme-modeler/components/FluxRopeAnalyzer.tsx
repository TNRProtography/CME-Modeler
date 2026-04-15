import React, { useEffect, useRef, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import CloseIcon from './icons/CloseIcon';

interface MagPt { time: number; bt: number; bz: number; by: number; bx: number; }
interface XYPt  { x: number; y: number; }

interface FluxRopeAnalyzerProps {
  magneticData: MagPt[];
  speedData:    XYPt[];
  densityData:  XYPt[];
  tempData:     XYPt[];
}

interface RopeResult {
  shockTime:        number;
  ropeEntry:        number;
  minutesInRope:    number;
  thetaNow:         number;
  omega:            number;
  btMean:           number;   // in-plane sqrt(By²+Bz²) amplitude
  r2:               number;
  confidence:       number;
  leading:          string;
  axial:            string;
  trailing:         string;
  orientCode:       string;
  chirality:        'right-handed' | 'left-handed' | 'indeterminate';
  chiralityCode:    'R' | 'L' | '?';
  bzForecast:       number[];
  bzUncertainty:    number[];  // ±nT band per slot
  thetaArr:         number[];
  thetaFit0:        number;
  estDurMin:        number;
  remainingMin:     number;
  coldFraction:     number;   // temperature-based rope confidence (0–1)
  inPlaneRatio:     number;   // sqrt(By²+Bz²) / Bt — rope field planarity
}

interface SlinkySeg {
  sx0: number; sy0: number;
  sx1: number; sy1: number;
  zm: number; theta: number; isPast: boolean;
}

const FORECAST_DT     = [0, 15, 30, 60, 180, 360];
const FORECAST_LABELS = ['Now', '+15 min', '+30 min', '+1 hr', '+3 hr', '+6 hr'];
const ROPE_DUR_MIN    = 900;

function medArr(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m-1] + s[m]) / 2 : s[m];
}

function unwrap(angles: number[]): number[] {
  if (!angles.length) return [];
  const out = [angles[0]];
  for (let i = 1; i < angles.length; i++) {
    let d = angles[i] - out[i-1];
    while (d >  Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    out.push(out[i-1] + d);
  }
  return out;
}

function linReg(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 4) return { slope: 0, intercept: ys[0] ?? 0, r2: 0 };
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxy += xs[i]*ys[i]; sxx += xs[i]*xs[i]; }
  const den = n*sxx - sx*sx;
  if (Math.abs(den) < 1e-10) return { slope: 0, intercept: sy/n, r2: 0 };
  const slope = (n*sxy - sx*sy) / den;
  const intercept = (sy - slope*sx) / n;
  const yMean = sy / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (ys[i] - yMean) ** 2;
    ssRes += (ys[i] - (slope*xs[i] + intercept)) ** 2;
  }
  return { slope, intercept, r2: ssTot > 0 ? Math.max(0, 1 - ssRes/ssTot) : 0 };
}

function dirFromTheta(theta: number): string {
  const deg = ((theta * 180 / Math.PI) % 360 + 360) % 360;
  if (deg < 45 || deg >= 315) return 'N';
  if (deg < 135) return 'E';
  if (deg < 225) return 'S';
  return 'W';
}

function segColor(cosTheta: number, alpha: number): string {
  if (cosTheta < -0.12) {
    const t = Math.min(1, -cosTheta);
    return `rgba(${Math.round(18+t*15)},${Math.round(155+t*100)},${Math.round(55+t*35)},${alpha})`;
  }
  if (cosTheta > 0.12) {
    const t = Math.min(1, cosTheta);
    return `rgba(${Math.round(178+t*77)},${Math.round(28+t*18)},28,${alpha})`;
  }
  return `rgba(135,138,158,${alpha})`;
}

// Weighted linear regression — weights decay exponentially so recent data dominates.
// This handles the non-stationary ω that characterises real flux rope rotation.
function weightedLinReg(xs: number[], ys: number[], halfLifeMin = 45) {
  const n = xs.length;
  if (n < 4) return { slope: 0, intercept: ys[0] ?? 0, r2: 0 };
  const xMax = xs[n - 1];
  const weights = xs.map(x => Math.exp(-(xMax - x) * Math.LN2 / halfLifeMin));
  let sw = 0, swx = 0, swy = 0, swxy = 0, swxx = 0;
  for (let i = 0; i < n; i++) {
    sw   += weights[i];
    swx  += weights[i] * xs[i];
    swy  += weights[i] * ys[i];
    swxy += weights[i] * xs[i] * ys[i];
    swxx += weights[i] * xs[i] * xs[i];
  }
  const den = sw * swxx - swx * swx;
  if (Math.abs(den) < 1e-10) return { slope: 0, intercept: swy / sw, r2: 0 };
  const slope     = (sw * swxy - swx * swy) / den;
  const intercept = (swy - slope * swx) / sw;
  const yMean = swy / sw;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += weights[i] * (ys[i] - yMean) ** 2;
    ssRes += weights[i] * (ys[i] - (slope * xs[i] + intercept)) ** 2;
  }
  return { slope, intercept, r2: ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0 };
}

// Expected proton temperature from solar wind speed (rough empirical relation, Lopez 1987).
function expectedTemp(speedKms: number): number {
  return Math.max(1e3, 0.5e-4 * speedKms * speedKms * 1e6);   // in K
}

function analyzeRope(mag: MagPt[], spd: XYPt[], den: XYPt[], tmp: XYPt[]) {
  const now   = Date.now();
  const BKT   = 3 * 60000;
  const bkt   = (t: number) => Math.round(t / BKT) * BKT;

  const magS = [...mag].sort((a, b) => a.time - b.time);
  const spdS = [...spd].sort((a, b) => a.x - b.x);
  const denS = [...den].sort((a, b) => a.x - b.x);
  const tmpS = [...tmp].sort((a, b) => a.x - b.x);

  if (magS.length < 20 || spdS.length < 8) return null;

  const spdJ: any = {};
  const denJ: any = {};
  const btJ:  any = {};
  const bzJ:  any = {};

  for (let i = 1; i < spdS.length; i++) {
    const d = spdS[i].y - spdS[i-1].y;
    if (Math.abs(d) >= 40) spdJ[bkt(spdS[i].x)] = d;
  }
  for (let i = 1; i < denS.length; i++) {
    const p = denS[i-1].y, c = denS[i].y;
    if (p > 0) { const r = c/p; if (r >= 1.8 || r <= 0.55) denJ[bkt(denS[i].x)] = r; }
  }
  for (let i = 1; i < magS.length; i++) {
    const db = magS[i].bt - magS[i-1].bt;
    if (Math.abs(db) >= 5) btJ[bkt(magS[i].time)] = db;
    const dz = magS[i].bz - magS[i-1].bz;
    if (Math.abs(dz) >= 8) bzJ[bkt(magS[i].time)] = dz;
  }

  let shockTime = 0;
  const allBkts = new Set([
    ...Object.keys(spdJ).map(Number), ...Object.keys(denJ).map(Number),
    ...Object.keys(btJ).map(Number),  ...Object.keys(bzJ).map(Number),
  ]);
  for (const t of allBkts) {
    if (t < now - 36*3600000 || t > now) continue;   // extended to 36 h
    const hits = [t in spdJ, t in denJ, t in btJ, t in bzJ].filter(Boolean).length;
    if (hits >= 2 && t > shockTime) shockTime = t;
  }
  if (!shockTime) return null;

  const preBt = magS.filter(p => p.time >= shockTime - 3600000 && p.time < shockTime).map(p => p.bt);
  const baseBt = preBt.length > 2 ? medArr(preBt) : 5;

  let ropeEntry = shockTime + 2 * 3600000;
  const WIN_MS = 20 * 60000;
  for (let t = shockTime + 25*60000; t < shockTime + 8*3600000; t += WIN_MS / 2) {
    const win = magS.filter(p => p.time >= t && p.time < t + WIN_MS).map(p => p.bt);
    if (win.length < 5) continue;
    const wMean = win.reduce((a, b) => a+b, 0) / win.length;
    const wStd  = Math.sqrt(win.map(v => (v-wMean)**2).reduce((a, b) => a+b, 0) / win.length);
    if (wMean > baseBt * 1.25 && wStd / wMean < 0.22) { ropeEntry = t; break; }
  }

  const ropeMag = magS.filter(p => p.time >= ropeEntry && p.time <= now);
  if (ropeMag.length < 8) return null;

  const rawTheta  = ropeMag.map(p => Math.atan2(p.by, p.bz));
  const thetaArr  = unwrap(rawTheta);
  const timeMin   = ropeMag.map(p => (p.time - ropeEntry) / 60000);
  const minutesInRope = timeMin[timeMin.length - 1];
  if (minutesInRope < 15) return null;

  // ── FIX 1: Weighted regression (recent data weighted more) ──────────────
  const reg = weightedLinReg(timeMin, thetaArr, 45);
  const { slope: omega, intercept: thetaFit0, r2 } = reg;
  const thetaNow = thetaFit0 + omega * minutesInRope;

  // ── FIX 2: In-plane amplitude sqrt(By²+Bz²) instead of total |B| ───────
  // When Bx is significant the total Bt over-estimates Bz magnitude.
  const inPlaneArr = ropeMag.map(p => Math.sqrt(p.by ** 2 + p.bz ** 2));
  const btMean     = medArr(inPlaneArr);
  // Planarity ratio — how much of |B| lives in the By-Bz plane (1 = perfect rope)
  const totalBtMean = medArr(ropeMag.map(p => p.bt));
  const inPlaneRatio = totalBtMean > 0 ? btMean / totalBtMean : 1;

  if (r2 < 0.38 || minutesInRope < 15) return null;

  // ── FIX 3: Chirality from sign of ω (right-handed = ω > 0 in GSE-like frame)
  const chirality: RopeResult['chirality'] =
    Math.abs(omega) < 0.002 ? 'indeterminate' :
    omega > 0 ? 'right-handed' : 'left-handed';
  const chiralityCode: RopeResult['chiralityCode'] =
    chirality === 'right-handed' ? 'R' : chirality === 'left-handed' ? 'L' : '?';

  // ── FIX 4: Temperature cold-fraction — genuine flux ropes are cold plasma ─
  // Cross-match rope interval with proton temperature data.
  let coldFraction = 0.5;  // neutral prior when no data
  if (tmpS.length > 4 && spdS.length > 4) {
    const ropeTemp = tmpS.filter(p => p.x >= ropeEntry && p.x <= now);
    if (ropeTemp.length >= 4) {
      // Interpolate a rough mean speed over the same window for expected Tp
      const meanSpd = spdS
        .filter(p => p.x >= ropeEntry && p.x <= now)
        .reduce((s, p, _, a) => s + p.y / a.length, 0) || 450;
      const expTp = expectedTemp(meanSpd);
      const coldPts = ropeTemp.filter(p => p.y < expTp * 0.5).length;
      coldFraction = coldPts / ropeTemp.length;
    }
  }

  // ── FIX 5: Data-driven duration estimate ────────────────────────────────
  // π / |ω| is correct for a centre-crossing; scale down slightly for
  // typical average impact parameter (~0.5 rope radius → chord ≈ 0.87 π/|ω|).
  const IMPACT_FACTOR = 0.87;
  const estDurMin = Math.abs(omega) > 0.002
    ? Math.min(1800, Math.max(360, (Math.PI * IMPACT_FACTOR) / Math.abs(omega)))
    : ROPE_DUR_MIN;

  const remainingMin = Math.max(0, estDurMin - minutesInRope);

  const leading  = dirFromTheta(thetaFit0);
  const axial    = dirFromTheta(thetaFit0 + omega * estDurMin * 0.40);
  const trailing = dirFromTheta(thetaFit0 + omega * estDurMin * 0.80);

  // ── FIX 6: Confidence incorporates R², time in rope, planarity, and cold-fraction ─
  const baseConf    = r2 * Math.min(1, minutesInRope / 90);
  const planeBonus  = 0.7 + 0.3 * inPlaneRatio;   // penalise tilted ropes
  const coldBonus   = 0.7 + 0.3 * coldFraction;    // reward cold-plasma confirmation
  const confidence  = Math.min(1, baseConf * planeBonus * coldBonus);

  // ── FIX 7: Forecast capped at rope exit; damped ω beyond current time ───
  // Damped angular velocity: ω(dt) = ω · exp(–λ·dt), λ = ln2 / 60 min half-life.
  // This reflects that rotation slows near the rope axis.
  const OMEGA_HALFLIFE = 60; // minutes — rotation rate halves every 60 min
  const bzForecast: number[] = [];
  const bzUncertainty: number[] = [];

  FORECAST_DT.forEach(dt => {
    // If this forecast slot is past the estimated rope exit, Bz returns to ~ambient
    if (dt > remainingMin) {
      bzForecast.push(0);
      bzUncertainty.push(0);
      return;
    }
    const confDecay = Math.pow(confidence, 1 + dt / 120);
    if (confDecay < 0.12) { bzForecast.push(0); bzUncertainty.push(0); return; }

    // Integrate damped rotation: ∫₀^dt ω·e^(–λt) dt = (ω/λ)(1 – e^(–λ·dt))
    const lambda = Math.LN2 / OMEGA_HALFLIFE;
    const deltaTheta = lambda > 0
      ? (omega / lambda) * (1 - Math.exp(-lambda * dt))
      : omega * dt;
    const thetaForecast = thetaNow + deltaTheta;

    const bzVal = btMean * Math.cos(thetaForecast);
    bzForecast.push(+bzVal.toFixed(1));

    // Uncertainty grows as sqrt(dt) scaled by residual scatter
    const residualStd = Math.sqrt(
      thetaArr.reduce((s, th, i) =>
        s + (th - (thetaFit0 + omega * timeMin[i])) ** 2, 0) / thetaArr.length
    );
    const thetaUncert = residualStd * Math.sqrt(1 + dt / 30);
    bzUncertainty.push(+(btMean * Math.abs(Math.sin(thetaForecast)) * thetaUncert).toFixed(1));
  });

  return {
    shockTime, ropeEntry, minutesInRope,
    thetaNow, omega, btMean, r2, confidence,
    leading, axial, trailing,
    orientCode: leading + axial + trailing,
    chirality, chiralityCode,
    bzForecast, bzUncertainty,
    thetaArr, thetaFit0, estDurMin, remainingMin,
    coldFraction, inPlaneRatio,
  };
}

function drawScene(cvs: HTMLCanvasElement, W: number, result: RopeResult, animAngle: number) {
  const DPR = window.devicePixelRatio || 1;
  const H   = 280;
  const ctx = cvs.getContext('2d');
  if (!ctx) return;

  if (+cvs.style.width.replace('px', '') !== W) {
    cvs.width  = Math.round(W * DPR);
    cvs.height = Math.round(H * DPR);
    cvs.style.width  = W + 'px';
    cvs.style.height = H + 'px';
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#030810';
  ctx.fillRect(0, 0, W, H);

  // ── Layout: slinky left 68 %, compass right 32 % ──────────────────────────
  const SW  = Math.floor(W * 0.68);
  const HX  = SW + Math.floor((W - SW) / 2);
  const HR  = Math.min(Math.floor((W - SW) / 2) - 18, 98);
  const CY  = H / 2;

  // ── Physical orientation ────────────────────────────────────────────────────
  // Map the rope's axial direction to an angle in the By-Bz plane.
  // N→0, E→π/2, S→π, W→3π/2  (measured from Bz+ going through By+)
  const axialThetaMap: {[k:string]: number} = { N:0, E:Math.PI/2, S:Math.PI, W:3*Math.PI/2 };
  const axialTheta = axialThetaMap[result.axial] ?? Math.PI/2;
  // How much the rope axis leans northward/southward in the canvas (Bz component of axial)
  const axialBzFrac = Math.cos(axialTheta);                // +1=N, 0=E/W, -1=S
  const AXIS_LEAN   = axialBzFrac * 0.60 * 74;            // max lean ≈ 60 % of coil radius

  // ── Slinky ─────────────────────────────────────────────────────────────────
  const X0 = 14, X1 = SW - 14, RLEN = X1 - X0;
  const R = 74, N_FL = 4, N_COILS = 2.0, N_SEG = 260, TILT = 0.22;
  const u_earth = Math.min(0.82, result.minutesInRope / result.estDurMin);
  const earthX  = X0 + u_earth * RLEN;

  // Faint axis line
  ctx.strokeStyle = 'rgba(40,70,120,0.2)'; ctx.lineWidth = 0.5; ctx.setLineDash([4,6]);
  ctx.beginPath(); ctx.moveTo(X0, CY); ctx.lineTo(X1, CY); ctx.stroke();
  ctx.setLineDash([]);

  const segs: any[] = [];
  for (let fl = 0; fl < N_FL; fl++) {
    // Each field line is equally spaced around the cross-section.
    const flPhaseOffset = (fl / N_FL) * Math.PI * 2;
    for (let s = 0; s < N_SEG; s++) {
      const u0 = s / N_SEG, u1 = (s + 1) / N_SEG;

      // Physical field angle at this position along the rope.
      const th0 = result.thetaFit0 + result.omega * u0 * ROPE_DUR_MIN;
      const th1 = result.thetaFit0 + result.omega * u1 * ROPE_DUR_MIN;

      // PHYSICAL PHASE: ph = π/2 − theta gives:
      //   theta=0  (Bz+, north)  → ph=π/2  → sin(ph)=+1  → coil at TOP  (north)  ✓
      //   theta=π  (Bz-, south)  → ph=−π/2 → sin(ph)=−1  → coil at BOTTOM (south) ✓
      //   theta=π/2 (By+, east)  → ph=0    → sin(ph)=0   → coil at mid-right ✓
      // Then we add the coil winding (N_COILS turns) + field-line offset + animation.
      const ph0 = (Math.PI/2 - th0) + N_COILS * Math.PI*2 * u0 + flPhaseOffset + animAngle;
      const ph1 = (Math.PI/2 - th1) + N_COILS * Math.PI*2 * u1 + flPhaseOffset + animAngle;

      const x0 = X0 + u0 * RLEN, x1 = X0 + u1 * RLEN;
      const y0 = R * Math.sin(ph0), z0 = R * Math.cos(ph0);
      const y1 = R * Math.sin(ph1), z1 = R * Math.cos(ph1);

      // Axial lean: tilt the rope centre line based on the axial direction.
      // u=0 (leading) → lean down if rope leans northward (trailing end is higher).
      const lean0 = AXIS_LEAN * (0.5 - u0);   // +lean at leading, −lean at trailing
      const lean1 = AXIS_LEAN * (0.5 - u1);

      const sx0 = x0 + z0 * TILT, sy0 = (CY + lean0) - y0;
      const sx1 = x1 + z1 * TILT, sy1 = (CY + lean1) - y1;

      if (sx1 < -5 || sx0 > SW + 5) continue;
      segs.push({ sx0, sy0, sx1, sy1, zm:(z0+z1)/2, theta:th0, isPast:u0 < u_earth });
    }
  }
  segs.sort((a, b) => a.zm - b.zm);
  segs.forEach(({ sx0, sy0, sx1, sy1, zm, theta, isPast }) => {
    const depth = (zm + R) / (2*R);
    const alpha = (isPast ? 0.22 : 0.88) * (0.18 + depth * 0.82);
    ctx.beginPath(); ctx.moveTo(sx0, sy0); ctx.lineTo(sx1, sy1);
    ctx.strokeStyle = segColor(Math.cos(theta), alpha);
    ctx.lineWidth   = 0.6 + depth * 2.2;
    ctx.stroke();
  });

  // ── Earth ──────────────────────────────────────────────────────────────────
  ctx.strokeStyle='rgba(60,100,180,0.25)'; ctx.lineWidth=0.6; ctx.setLineDash([3,4]);
  ctx.beginPath(); ctx.moveTo(earthX, CY-R-16); ctx.lineTo(earthX, CY+R+16); ctx.stroke();
  ctx.setLineDash([]);
  const eR = 15;
  ctx.fillStyle='#0d2244'; ctx.beginPath(); ctx.arc(earthX,CY,eR,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle='#2563eb'; ctx.lineWidth=2.5; ctx.stroke();
  for (let i=0; i<2; i++) {
    ctx.strokeStyle=`rgba(100,170,255,${0.38-i*0.18})`; ctx.lineWidth=0.7;
    ctx.beginPath(); ctx.arc(earthX,CY,eR+5+i*10,-Math.PI*0.78,Math.PI*0.78); ctx.stroke();
    ctx.beginPath(); ctx.arc(earthX,CY,eR+5+i*10,Math.PI+Math.PI*0.22,Math.PI*2-Math.PI*0.22); ctx.stroke();
  }
  ctx.fillStyle='rgba(160,210,255,0.85)'; ctx.font='9px system-ui'; ctx.textAlign='center';
  ctx.fillText('Earth', earthX, CY+eR+14);

  // Live Bz indicator above Earth
  const bzAtEarth = Math.cos(result.thetaFit0 + result.omega * u_earth * ROPE_DUR_MIN);
  const bzCol = bzAtEarth < -0.15 ? '#22c55e' : bzAtEarth > 0.15 ? '#ef4444' : '#f59e0b';
  const bzTxt = bzAtEarth < -0.15 ? 'Bz− now' : bzAtEarth > 0.15 ? 'Bz+ now' : 'Bz≈0 now';
  ctx.fillStyle = bzCol; ctx.font='500 9px system-ui'; ctx.textAlign='center';
  ctx.fillText(bzTxt, earthX, CY-eR-16);

  // Passage labels
  ctx.fillStyle='rgba(75,105,148,0.4)'; ctx.font='8px system-ui'; ctx.textAlign='center';
  if (u_earth > 0.1) ctx.fillText('← passed Earth', X0+u_earth*RLEN*0.48, CY+R+26);
  if (u_earth < 0.9) ctx.fillText('incoming →', X0+(u_earth+(1-u_earth)*0.5)*RLEN, CY+R+26);

  // Solar wind arrow
  ctx.strokeStyle='rgba(255,190,55,0.35)'; ctx.lineWidth=1; ctx.setLineDash([3,4]);
  ctx.beginPath(); ctx.moveTo(SW-10,CY); ctx.lineTo(SW-44,CY); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle='rgba(255,190,55,0.38)'; ctx.font='8px system-ui'; ctx.textAlign='center';
  ctx.fillText('solar wind', SW-28, CY-8);

  // Legend
  ctx.fillStyle='rgba(75,105,148,0.32)'; ctx.textAlign='left'; ctx.font='8px system-ui';
  ctx.fillText('green = Bz south · red = Bz north', X0, CY+R+38);

  // ── Divider ────────────────────────────────────────────────────────────────
  ctx.strokeStyle='rgba(55,85,135,0.18)'; ctx.lineWidth=0.5; ctx.setLineDash([2,5]);
  ctx.beginPath(); ctx.moveTo(SW,8); ctx.lineTo(SW,H-8); ctx.stroke(); ctx.setLineDash([]);

  // ── Compass dial ───────────────────────────────────────────────────────────
  ctx.fillStyle='#050d1c';
  ctx.beginPath(); ctx.arc(HX,CY,HR,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle='rgba(80,110,160,0.28)'; ctx.lineWidth=0.5; ctx.stroke();
  [0.34,0.67].forEach(f => {
    ctx.beginPath(); ctx.arc(HX,CY,HR*f,0,Math.PI*2);
    ctx.strokeStyle='rgba(80,110,160,0.15)'; ctx.stroke();
  });
  ctx.strokeStyle='rgba(80,110,160,0.2)'; ctx.lineWidth=0.5;
  ctx.beginPath(); ctx.moveTo(HX-HR,CY); ctx.lineTo(HX+HR,CY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(HX,CY-HR); ctx.lineTo(HX,CY+HR); ctx.stroke();
  ctx.fillStyle='rgba(180,80,80,0.85)'; ctx.font='500 10px system-ui'; ctx.textAlign='center';
  ctx.fillText('Bz+ (no aurora)', HX, CY-HR-5);
  ctx.fillStyle='rgba(60,200,90,0.95)'; ctx.fillText('Bz− (aurora!)', HX, CY+HR+14);
  ctx.fillStyle='rgba(120,155,195,0.48)'; ctx.font='8px system-ui';
  ctx.textAlign='left';  ctx.fillText('By+', HX+HR+3, CY+3);
  ctx.textAlign='right'; ctx.fillText('By−', HX-HR-3, CY+3);

  // Measured trail
  const TRAIL = Math.min(result.thetaArr.length, 90);
  for (let i = 0; i < TRAIL; i++) {
    const th = result.thetaArr[result.thetaArr.length - TRAIL + i];
    const px = HX + Math.sin(th)*HR, py = CY - Math.cos(th)*HR;
    ctx.beginPath(); ctx.arc(px,py,1.5,0,Math.PI*2);
    ctx.fillStyle=`rgba(100,180,255,${(i/TRAIL)*0.72})`; ctx.fill();
  }

  // Forecast dots
  const FDTS=[15,30,60,180,360], FLBLS=['15m','30m','1h','3h','6h'];
  const lambdaDraw = Math.LN2 / 60;
  FDTS.forEach((dt, i) => {
    const conf = Math.pow(result.confidence, 1+i*0.55);
    if (conf < 0.12) return;
    const isPastExit = dt > result.remainingMin;
    const dth = lambdaDraw > 0
      ? (result.omega/lambdaDraw)*(1-Math.exp(-lambdaDraw*dt))
      : result.omega*dt;
    const th = result.thetaNow + dth;
    const px = HX+Math.sin(th)*HR, py = CY-Math.cos(th)*HR;
    const bz = Math.cos(th);
    ctx.beginPath(); ctx.arc(px,py,3.5,0,Math.PI*2);
    ctx.fillStyle = isPastExit
      ? `rgba(100,100,120,${conf*0.5})`
      : bz<0 ? `rgba(55,200,85,${conf*0.82})` : `rgba(200,65,65,${conf*0.82})`;
    ctx.fill();
    ctx.fillStyle=`rgba(175,200,222,${conf*(isPastExit?0.4:0.88)})`; ctx.font='8px system-ui'; ctx.textAlign='center';
    ctx.fillText(FLBLS[i], px, py-7);
  });

  // Current IMF arrow
  const ax = HX+Math.sin(result.thetaNow)*HR, ay = CY-Math.cos(result.thetaNow)*HR;
  const bzN = Math.cos(result.thetaNow);
  const arCol = bzN<-0.1 ? '#22c55e' : bzN>0.1 ? '#ef4444' : '#f59e0b';
  ctx.strokeStyle=arCol; ctx.lineWidth=2.5;
  ctx.beginPath(); ctx.moveTo(HX,CY); ctx.lineTo(ax,ay); ctx.stroke();
  const dx=ax-HX, dy=ay-CY, L=Math.sqrt(dx*dx+dy*dy)||1;
  ctx.beginPath();
  ctx.moveTo(ax+dx/L*9,ay+dy/L*9);
  ctx.lineTo(ax+(-dy/L)*5,ay+(dx/L)*5);
  ctx.lineTo(ax+(dy/L)*5,ay+(-dx/L)*5);
  ctx.closePath(); ctx.fillStyle=arCol; ctx.fill();
  ctx.fillStyle='rgba(82,115,158,0.5)'; ctx.font='8px system-ui'; ctx.textAlign='center';
  ctx.fillText('IMF direction', HX, CY+HR+26);
  ctx.fillText('By–Bz plane · dots = forecast', HX, CY+HR+36);
}

// ── InfoModal ────────────────────────────────────────────────────────────────
interface InfoModalProps { isOpen: boolean; onClose: () => void; title: string; content: React.ReactNode; }
const InfoModal: React.FC<InfoModalProps> = ({ isOpen, onClose, title, content }) => {
  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[9999] flex justify-center items-center p-4" onClick={onClose}>
      <div className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] text-neutral-300 flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b border-neutral-700/80 shrink-0">
          <h3 className="text-xl font-bold text-neutral-200">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"><CloseIcon className="w-6 h-6" /></button>
        </div>
        <div className="overflow-y-auto p-5 text-sm leading-relaxed">{content}</div>
      </div>
    </div>,
    document.body
  );
};

// ── Flux-rope orientation SVG diagram ────────────────────────────────────────
const OrientationDiagram: React.FC<{ result: RopeResult }> = ({ result }) => {
  const cx = 110, cy = 110, R = 82;

  // Build 72 arc sectors around the cross-section, coloured by the Bz direction
  // that would be measured at that angular position around the rope.
  // theta=0 → Bz+ (north, red); theta=π → Bz- (south, green)
  const sectors: React.ReactElement[] = [];
  const N = 72;
  for (let i = 0; i < N; i++) {
    const a1  = (i / N) * Math.PI * 2 - Math.PI / 2;
    const a2  = ((i + 1) / N) * Math.PI * 2 - Math.PI / 2;
    const th  = result.thetaFit0 + (i / N) * Math.PI * 2;   // field angle at this position
    const bz  = Math.cos(th);
    const aurora = Math.max(0, -bz);
    const north  = Math.max(0, bz);
    const fillR = Math.round(north * 220);
    const fillG = Math.round(aurora * 190);
    const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
    const x2 = cx + R * Math.cos(a2), y2 = cy + R * Math.sin(a2);
    sectors.push(
      <path key={i}
        d={`M${cx},${cy} L${x1},${y1} A${R},${R} 0 0 1 ${x2},${y2} Z`}
        fill={`rgba(${fillR},${fillG},35,0.45)`} />
    );
  }

  // Current field direction (arrow from centre)
  const byNow = Math.sin(result.thetaNow);
  const bzNow = Math.cos(result.thetaNow);
  const arrowX = cx + byNow * (R * 0.72);
  const arrowY = cy - bzNow * (R * 0.72);
  const arrowCol = bzNow < -0.1 ? '#22c55e' : bzNow > 0.1 ? '#ef4444' : '#f59e0b';

  // Forecast dots
  const FDTS  = [15, 30, 60, 180, 360];
  const FLBLS = ['15m','30m','1h','3h','6h'];
  const OMEGA_HALFLIFE = 60;
  const lambda = Math.LN2 / OMEGA_HALFLIFE;
  const forecastDots = FDTS.map((dt, i) => {
    const conf = Math.pow(result.confidence, 1 + i * 0.55);
    if (conf < 0.12) return null;
    const isPast = dt > result.remainingMin;
    const dth = lambda > 0 ? (result.omega / lambda) * (1 - Math.exp(-lambda * dt)) : result.omega * dt;
    const th = result.thetaNow + dth;
    const by = Math.sin(th), bz = Math.cos(th);
    const px = cx + by * (R * 0.78), py = cy - bz * (R * 0.78);
    const col = isPast ? `rgba(100,100,120,${conf * 0.5})`
      : bz < 0 ? `rgba(55,200,85,${conf * 0.85})` : `rgba(200,65,65,${conf * 0.85})`;
    return (
      <g key={dt}>
        <circle cx={px} cy={py} r={4} fill={col} />
        <text x={px} y={py - 7} textAnchor="middle" fill={`rgba(175,200,222,${conf * 0.85})`} fontSize="8">{FLBLS[i]}</text>
      </g>
    );
  });

  // Trail of measured theta history
  const TRAIL = Math.min(result.thetaArr.length, 80);
  const trailDots = Array.from({ length: TRAIL }, (_, i) => {
    const th = result.thetaArr[result.thetaArr.length - TRAIL + i];
    const px = cx + Math.sin(th) * (R * 0.78);
    const py = cy - Math.cos(th) * (R * 0.78);
    const alpha = (i / TRAIL) * 0.7;
    return <circle key={i} cx={px} cy={py} r={1.5} fill={`rgba(100,180,255,${alpha})`} />;
  });

  // Earth dot (fixed in centre — rope is passing OVER Earth)
  // The position indicator on the rope edge showing where field now points
  const edgeX = cx + byNow * R, edgeY = cy - bzNow * R;

  // Chirality arc
  const chiralDir = result.chirality === 'right-handed' ? 1 : -1;
  const chiralR = R + 14;
  const arcStart = -Math.PI / 2;
  const arcEnd   = arcStart + chiralDir * Math.PI * 1.5;
  const arcSx = cx + chiralR * Math.cos(arcStart), arcSy = cy + chiralR * Math.sin(arcStart);
  const arcEx = cx + chiralR * Math.cos(arcEnd),   arcEy = cy + chiralR * Math.sin(arcEnd);
  const largeArc = Math.abs(arcEnd - arcStart) > Math.PI ? 1 : 0;
  const sweep    = chiralDir > 0 ? 1 : 0;

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="220" height="220" viewBox="0 0 220 220" className="mx-auto">
        {/* Dark background circle */}
        <circle cx={cx} cy={cy} r={R + 20} fill="#030810" />
        {/* Coloured sector rings */}
        {sectors}
        {/* Ring border */}
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="rgba(80,110,160,0.35)" strokeWidth="1.2" />
        {/* Inner guide rings */}
        {[0.45, 0.72].map(f => (
          <circle key={f} cx={cx} cy={cy} r={R * f} fill="none" stroke="rgba(80,110,160,0.12)" strokeWidth="0.5" />
        ))}
        {/* Crosshair */}
        <line x1={cx - R - 4} y1={cy} x2={cx + R + 4} y2={cy} stroke="rgba(80,110,160,0.22)" strokeWidth="0.5" />
        <line x1={cx} y1={cy - R - 4} x2={cx} y2={cy + R + 4} stroke="rgba(80,110,160,0.22)" strokeWidth="0.5" />

        {/* Chirality arc */}
        {result.chirality !== 'indeterminate' && (
          <path
            d={`M ${arcSx} ${arcSy} A ${chiralR} ${chiralR} 0 ${largeArc} ${sweep} ${arcEx} ${arcEy}`}
            fill="none" stroke="rgba(150,100,255,0.4)" strokeWidth="1.5" strokeDasharray="4 3"
          />
        )}

        {/* Measured trail */}
        {trailDots}

        {/* Forecast dots */}
        {forecastDots}

        {/* Current field arrow */}
        <line x1={cx} y1={cy} x2={arrowX} y2={arrowY} stroke={arrowCol} strokeWidth="2.5" strokeLinecap="round" />
        {/* Arrowhead */}
        {(() => {
          const dx = arrowX - cx, dy = arrowY - cy, L = Math.sqrt(dx*dx+dy*dy)||1;
          const ux = dx/L, uy = dy/L;
          return (
            <polygon
              points={`${arrowX+ux*8},${arrowY+uy*8} ${arrowX-uy*5},${arrowY+ux*5} ${arrowX+uy*5},${arrowY-ux*5}`}
              fill={arrowCol}
            />
          );
        })()}
        {/* Field dot on rope edge */}
        <circle cx={edgeX} cy={edgeY} r={5} fill={arrowCol} opacity={0.7} />

        {/* Earth at centre */}
        <circle cx={cx} cy={cy} r={11} fill="#0d2244" stroke="#2563eb" strokeWidth="2" />
        <text x={cx} y={cy + 3} textAnchor="middle" fill="rgba(160,210,255,0.9)" fontSize="8" fontWeight="600">🌍</text>

        {/* Compass labels */}
        <text x={cx} y={cy - R - 10} textAnchor="middle" fill="rgba(180,70,70,0.9)" fontSize="9" fontWeight="500">Bz+ ↑ (no aurora)</text>
        <text x={cx} y={cy + R + 18} textAnchor="middle" fill="rgba(50,210,90,0.95)" fontSize="9" fontWeight="500">↓ Bz− (aurora!)</text>
        <text x={cx + R + 8} y={cy + 3} textAnchor="start" fill="rgba(120,155,195,0.55)" fontSize="8">By+</text>
        <text x={cx - R - 8} y={cy + 3} textAnchor="end" fill="rgba(120,155,195,0.55)" fontSize="8">By−</text>
        {/* Direction of travel label */}
        <text x={cx} y={207} textAnchor="middle" fill="rgba(100,140,190,0.5)" fontSize="8">Cross-section · Earth at centre · arrow = current IMF</text>
      </svg>
      <div className="flex gap-3 text-xs flex-wrap justify-center">
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-green-500/70"></span> Bz south = aurora</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-red-500/70"></span> Bz north = quiet</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-blue-400/70"></span> measured trail</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full border border-violet-400/60"></span> forecast</span>
      </div>
    </div>
  );
};

const FluxRopeAnalyzer: React.FC<FluxRopeAnalyzerProps> = ({
  magneticData, speedData, densityData, tempData,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef   = useRef<HTMLDivElement>(null);
  const animRef   = useRef<number>(0);
  const angleRef  = useRef<number>(0);
  const lastTRef  = useRef<number | null>(null);
  const [canvasW, setCanvasW] = useState(700);
  const [infoOpen, setInfoOpen] = useState(false);

  const result = useMemo(() =>
    analyzeRope(magneticData, speedData, densityData, tempData),
    [magneticData, speedData, densityData, tempData]
  );

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(es => setCanvasW(Math.floor(es[0].contentRect.width)));
    ro.observe(el);
    setCanvasW(el.clientWidth || 700);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!canvasRef.current || !result) return;
    // Scale real omega (rad/min) to display rate (rad/s), preserving direction.
    // Clamp so even a fast-rotating rope doesn't spin dizzyingly.
    const rawDisp = result.omega * 55;
    const DISP_OMEGA = Math.sign(rawDisp) * Math.min(Math.abs(rawDisp), 0.32);
    const tick = (t: number) => {
      if (lastTRef.current === null) lastTRef.current = t;
      const dt = Math.min((t - lastTRef.current) / 1000, 0.05);
      lastTRef.current = t;
      if (Math.abs(DISP_OMEGA) > 0.001) angleRef.current += DISP_OMEGA * dt;
      drawScene(canvasRef.current!, canvasW, result, angleRef.current);
      animRef.current = requestAnimationFrame(tick);
    };
    lastTRef.current = null;
    animRef.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(animRef.current); };
  }, [result, canvasW]);

  if (!result) return null;

  const confPct   = Math.round(result.confidence * 100);
  const confLabel = confPct < 40 ? 'Early estimate — building'
    : confPct < 68 ? 'Reasonable forecast'
    : 'Reliable forecast';
  const confCls = confPct < 40 ? 'text-amber-400' : confPct < 68 ? 'text-sky-400' : 'text-emerald-400';
  const hrsIn      = (result.minutesInRope / 60).toFixed(1);
  const progressPct = Math.min(100, Math.round((result.minutesInRope / result.estDurMin) * 100));
  const remHrs      = result.remainingMin > 0
    ? result.remainingMin >= 60
      ? `${Math.floor(result.remainingMin / 60)}h ${Math.round(result.remainingMin % 60)}m`
      : `${Math.round(result.remainingMin)}m`
    : 'exiting';

  const rotDesc = Math.abs(result.omega) < 0.004
    ? 'stable orientation — minimal rotation detected'
    : result.omega > 0
    ? 'rotating counterclockwise (eastward)'
    : 'rotating clockwise (westward)';

  const chiralityColor = result.chirality === 'right-handed'
    ? 'text-violet-400' : result.chirality === 'left-handed'
    ? 'text-orange-400' : 'text-neutral-500';

  const coldLabel = result.coldFraction > 0.65
    ? '❄ Cold plasma confirmed' : result.coldFraction > 0.35
    ? '~ Mixed temperature' : '⚠ Warm plasma — check for sheath';
  const coldColor = result.coldFraction > 0.65
    ? 'text-cyan-400' : result.coldFraction > 0.35
    ? 'text-amber-400' : 'text-rose-400';

  const planeLabel = result.inPlaneRatio > 0.85
    ? 'High planarity' : result.inPlaneRatio > 0.65
    ? 'Moderate planarity' : 'Low planarity — Bx significant';
  const planeColor = result.inPlaneRatio > 0.85
    ? 'text-emerald-400' : result.inPlaneRatio > 0.65
    ? 'text-amber-400' : 'text-rose-400';

  const orientPlain = (() => {
    const chiralNote = result.chirality !== 'indeterminate'
      ? ` This is a ${result.chirality} rope (${result.chiralityCode}).` : '';
    if (result.leading === 'S') {
      return `The southward-pointing (Bz−) field arrived first. Aurora conditions may be strongest right now. As the rope continues sweeping past Earth, the field will rotate and Bz is expected to turn northward — storm intensity will fade over the coming hours.${chiralNote}`;
    }
    if (result.trailing === 'S') {
      return `Northward field (Bz+) arrived first, meaning the best aurora conditions are still coming. The southward-pointing portion of the rope is in its trailing half and has not yet reached Earth.${chiralNote}`;
    }
    if (result.leading === 'E' || result.leading === 'W') {
      return `The rope arrived with the field pointing ${result.leading === 'E' ? 'eastward' : 'westward'}. Southward Bz may develop through the middle of the passage — watch Bz closely for a sudden aurora opportunity.${chiralNote}`;
    }
    return `The field is mainly northward throughout this rope passage. Significant aurora is unlikely unless the rope is distorted from its forecast orientation.${chiralNote}`;
  })();

  return (
    <div className="col-span-12 card bg-neutral-950/80 p-4">
      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-2 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-white">CME flux rope structure</h2>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-amber-500/15 text-amber-400 border border-amber-500/30">
              <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              BETA
            </span>
            <button
              onClick={() => setInfoOpen(true)}
              className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors"
            >
              ?
            </button>
          </div>

      <InfoModal
        isOpen={infoOpen}
        onClose={() => setInfoOpen(false)}
        title="CME Flux Rope Structure"
        content={result ? (
          <div className="space-y-5">
            {/* What is a flux rope */}
            <section>
              <h4 className="font-semibold text-neutral-100 mb-1.5">What is a CME flux rope?</h4>
              <p className="text-neutral-400">A coronal mass ejection arrives as a magnetised plasma cloud with its magnetic field wound into a helical coil — a <em>flux rope</em>. As it sweeps past Earth, each part of the coil passes in sequence, causing the measured magnetic field direction to rotate smoothly. The key aurora driver is <strong className="text-white">Bz</strong>: when it points southward (negative), it reconnects with Earth's northward magnetosphere and injects energy into the magnetotail — triggering geomagnetic storms and aurora.</p>
            </section>

            {/* Orientation diagram */}
            <section>
              <h4 className="font-semibold text-neutral-100 mb-2">Current rope orientation relative to Earth</h4>
              <p className="text-neutral-500 text-xs mb-3">The cross-section below shows the flux rope looking down its axis (from the Sun toward Earth). Earth sits at the centre. The arrow shows the current IMF direction in the By–Bz plane. Green sectors = Bz southward (aurora-driving); red = northward (suppressed).</p>
              <OrientationDiagram result={result} />
            </section>

            {/* Current situation */}
            <section className="bg-neutral-900/60 rounded-lg p-3">
              <h4 className="font-semibold text-neutral-100 mb-1">Current orientation: <span className="font-mono text-sky-300">{result.orientCode}-{result.chiralityCode}</span></h4>
              <p className="text-neutral-400">{orientPlain}</p>
            </section>

            {/* Orientation code explained */}
            <section>
              <h4 className="font-semibold text-neutral-100 mb-1.5">Orientation code explained</h4>
              <p className="text-neutral-400 mb-2">The three-letter code describes the field direction at the <em>leading edge</em> (first to arrive) → <em>axial direction</em> (rope axis) → <em>trailing edge</em> (last to arrive). Each letter is one of:</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  ['S', 'text-emerald-400', 'Southward Bz (aurora-driving)'],
                  ['N', 'text-red-400',     'Northward Bz (aurora-suppressing)'],
                  ['E', 'text-amber-400',   'Eastward By'],
                  ['W', 'text-amber-400',   'Westward By'],
                ].map(([code, cls, desc]) => (
                  <div key={code as string} className="bg-neutral-800/60 rounded px-2 py-1.5 flex gap-2 items-start">
                    <span className={`font-mono font-bold text-sm ${cls}`}>{code}</span>
                    <span className="text-neutral-400">{desc}</span>
                  </div>
                ))}
              </div>
              <p className="text-neutral-500 text-xs mt-2">The chirality suffix — <span className="font-mono text-violet-400">R</span> (right-handed) or <span className="font-mono text-orange-400">L</span> (left-handed) — describes which way the field twists around the rope axis. Right-handed ropes (from the northern solar hemisphere) tend to produce eastward By; left-handed (southern hemisphere) tend westward.</p>
            </section>

            {/* Confidence */}
            <section>
              <h4 className="font-semibold text-neutral-100 mb-1.5">Forecast confidence: <span className={confCls}>{confLabel} ({confPct}%)</span></h4>
              <div className="space-y-1.5 text-neutral-400">
                <p>Confidence is built from four independent signals:</p>
                <ul className="list-disc list-inside space-y-1 text-xs pl-2">
                  <li><strong className="text-neutral-200">Rotation quality (R²)</strong> — how cleanly the field rotates versus noise. Current: <span className="text-sky-300">{result.r2.toFixed(2)}</span></li>
                  <li><strong className="text-neutral-200">Field planarity</strong> — what fraction of the field lies in the By–Bz plane (a perfect rope is 100% planar). Current: <span className={planeColor}>{Math.round(result.inPlaneRatio * 100)}%</span></li>
                  <li><strong className="text-neutral-200">Cold plasma fraction</strong> — real flux rope cores contain cold, dense plasma. Higher cold fraction → more confident we're inside a rope. Current: <span className={coldColor}>{Math.round(result.coldFraction * 100)}%</span></li>
                  <li><strong className="text-neutral-200">Data history</strong> — confidence builds over the first ~3 hours as more rotation is observed.</li>
                </ul>
                <p className="text-xs text-neutral-500 mt-1.5">Forecast uncertainty grows rapidly with time. The ±nT bands shown on Bz tiles widen with each step. Treat +3h and +6h as directional only until confidence exceeds ~65%.</p>
              </div>
            </section>

            {/* Chirality */}
            <section className="bg-neutral-900/60 rounded-lg p-3">
              <h4 className="font-semibold text-neutral-100 mb-1">Chirality: <span className={chiralityColor}>{result.chirality === 'right-handed' ? '↻ Right-handed' : result.chirality === 'left-handed' ? '↺ Left-handed' : '~ Indeterminate'}</span></h4>
              <p className="text-neutral-400 text-sm">The twist direction of the magnetic field around the rope axis. Determined from whether the axial field (Bx) is aligned or anti-aligned with the rotation direction. {result.chirality !== 'indeterminate' ? 'A confirmed chirality improves the reliability of the field-rotation forecast.' : 'Chirality is still unclear — this typically resolves after more rotation is observed.'}</p>
            </section>

            {/* Technical footer */}
            <section className="text-xs text-neutral-600 border-t border-neutral-800 pt-3">
              <p>Method: weighted linear regression on the unwrapped field angle θ = atan2(By, Bz), corrected for in-plane amplitude and proton temperature cold-fraction. Field amplitude: <span className="text-neutral-500">{result.btMean.toFixed(1)} nT</span> · R²: <span className="text-neutral-500">{result.r2.toFixed(2)}</span> · Data: {Math.round(result.minutesInRope)} min in rope.</p>
            </section>
          </div>
        ) : <p className="text-neutral-400">No flux rope data available yet.</p>}
      />
          <p className="text-xs text-neutral-500 mt-0.5">
            Inside magnetic flux rope · {hrsIn}h of rope data · {rotDesc}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-medium px-2 py-1 rounded-full bg-neutral-800 ${confCls}`}>
            {confLabel}
          </span>
          {/* Orient code + chirality */}
          <span
            className="text-xs font-mono font-semibold px-3 py-1 rounded-full bg-neutral-800 text-neutral-200 tracking-widest"
            title="Leading–Axial–Trailing field direction code"
          >
            {result.orientCode}-{result.chiralityCode}
          </span>
        </div>
      </div>

      {/* ── Progress through rope ── */}
      <div className="mb-3 px-0.5">
        <div className="flex justify-between text-xs text-neutral-500 mb-1">
          <span>Rope passage: {progressPct}% complete</span>
          <span className={progressPct >= 95 ? 'text-amber-400' : 'text-neutral-500'}>
            {progressPct >= 95 ? '⚠ Rope exit imminent' : `~${remHrs} remaining`}
          </span>
        </div>
        <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${progressPct}%`,
              background: progressPct > 80
                ? 'linear-gradient(90deg,#f59e0b,#ef4444)'
                : 'linear-gradient(90deg,#3b82f6,#22c55e)',
            }}
          />
        </div>
      </div>

      {/* ── Canvas ── */}
      <div ref={wrapRef} className="mb-3">
        <canvas
          ref={canvasRef}
          style={{ display:'block', borderRadius:10, width:'100%' }}
        />
      </div>

      {/* ── Quality indicators ── */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-neutral-900/60 rounded-lg px-3 py-2">
          <div className="text-xs text-neutral-500 mb-0.5">Chirality</div>
          <div className={`text-xs font-medium ${chiralityColor}`}>
            {result.chirality === 'right-handed' ? '↻ Right-handed'
             : result.chirality === 'left-handed' ? '↺ Left-handed'
             : '~ Indeterminate'}
          </div>
        </div>
        <div className="bg-neutral-900/60 rounded-lg px-3 py-2">
          <div className="text-xs text-neutral-500 mb-0.5">Plasma temp</div>
          <div className={`text-xs font-medium ${coldColor}`}>{coldLabel}</div>
        </div>
        <div className="bg-neutral-900/60 rounded-lg px-3 py-2">
          <div className="text-xs text-neutral-500 mb-0.5">Field planarity</div>
          <div className={`text-xs font-medium ${planeColor}`}>
            {planeLabel} ({Math.round(result.inPlaneRatio * 100)}%)
          </div>
        </div>
      </div>

      {/* ── Orientation narrative ── */}
      <div className="mb-3 text-xs text-neutral-400 leading-relaxed bg-neutral-900/50 rounded-lg px-3 py-2.5">
        <span className="font-semibold text-neutral-200 mr-1">{result.orientCode}-{result.chiralityCode}:</span>
        {orientPlain}
        {confPct < 55 && (
          <span className="ml-1 text-amber-400/80"> Forecast confidence is still building — treat +3h and +6h as directional only.</span>
        )}
        {result.inPlaneRatio < 0.70 && (
          <span className="ml-1 text-rose-400/80"> Bx component is significant ({Math.round((1 - result.inPlaneRatio) * 100)}% out-of-plane) — Bz amplitude may be lower than shown.</span>
        )}
      </div>

      {/* ── Bz forecast tiles ── */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 mb-3">
        {FORECAST_LABELS.map((label, i) => {
          const bz    = result.bzForecast[i];
          const unc   = result.bzUncertainty[i];
          const conf  = i === 0 ? 1 : Math.pow(result.confidence, 1 + i * 0.55);
          const isPastExit = FORECAST_DT[i] > result.remainingMin;
          const isAurora   = bz < -2 && !isPastExit;
          return (
            <div
              key={label}
              className="bg-neutral-900/70 rounded-lg p-2 text-center"
              style={{ opacity: isPastExit ? 0.35 : conf }}
            >
              <div className="text-xs text-neutral-500 mb-1">{label}</div>
              {isPastExit ? (
                <>
                  <div className="text-sm font-semibold text-neutral-600">—</div>
                  <div className="text-xs mt-0.5 text-neutral-700">post-rope</div>
                </>
              ) : (
                <>
                  <div
                    className="text-sm font-semibold"
                    style={{ color: bz < -6 ? '#22c55e' : bz < -1 ? '#86efac' : bz < 2 ? '#f59e0b' : '#ef4444' }}
                  >
                    {bz > 0 ? '+' : ''}{bz.toFixed(1)} nT
                  </div>
                  {unc > 0 && (
                    <div className="text-xs text-neutral-600 leading-none">±{unc.toFixed(1)}</div>
                  )}
                  <div className="text-xs mt-0.5" style={{ color: isAurora ? '#4ade80' : '#6b7280' }}>
                    {isAurora ? '★ aurora' : 'quiet'}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Footer metadata ── */}
      <div className="pt-2 border-t border-neutral-800/60 flex flex-wrap gap-x-4 gap-y-1 items-center">
        <span className="text-xs text-neutral-600">
          Left: slinky physically oriented to rope orientation — coil position in canvas matches real By–Bz direction · green = Bz south · red = north · tap ? for detail
        </span>
        <span className="text-xs text-neutral-600">
          Right: IMF rotating in By–Bz plane · blue trail = measured · coloured dots = forecast (grey = post-rope)
        </span>
        <span className="text-xs text-neutral-700 ml-auto">
          B⊥ {result.btMean.toFixed(1)} nT · R² {result.r2.toFixed(2)} · planarity {Math.round(result.inPlaneRatio*100)}% · cold {Math.round(result.coldFraction*100)}%
        </span>
      </div>
    </div>
  );
};

export { FluxRopeAnalyzer };
export default FluxRopeAnalyzer;
