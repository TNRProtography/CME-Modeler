import React, { useEffect, useRef, useMemo, useState } from 'react';

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
  const H   = 264;
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

  const SW  = Math.floor(W * 0.58);
  const HX  = SW + Math.floor((W - SW) / 2);
  const HR  = Math.min(Math.floor((W - SW) / 2) - 24, 84);
  const CY  = H / 2 - 2;

  const X0 = 16, X1 = SW - 16, RLEN = X1 - X0;
  const R = 74, N_FL = 4, N_COILS = 1.8, N_SEG = 220, TILT = 0.20;
  const u_earth = Math.min(0.80, result.minutesInRope / result.estDurMin);
  const earthX  = X0 + u_earth * RLEN;

  const segs: any[] = [];
  for (let fl = 0; fl < N_FL; fl++) {
    const phase0 = (fl / N_FL) * Math.PI * 2;
    for (let s = 0; s < N_SEG; s++) {
      const u0  = s / N_SEG;
      const u1  = (s+1) / N_SEG;
      const th0 = result.thetaFit0 + result.omega * u0 * ROPE_DUR_MIN;
      const ph0 = phase0 + N_COILS * 2 * Math.PI * u0 + animAngle;
      const ph1 = phase0 + N_COILS * 2 * Math.PI * u1 + animAngle;
      const x0 = X0 + u0 * RLEN, x1 = X0 + u1 * RLEN;
      const y0 = R*Math.sin(ph0), z0 = R*Math.cos(ph0);
      const y1 = R*Math.sin(ph1), z1 = R*Math.cos(ph1);
      const sx0 = x0+z0*TILT, sy0 = CY-y0;
      const sx1 = x1+z1*TILT, sy1 = CY-y1;
      if (sx1 < -5 || sx0 > SW+5) continue;
      segs.push({ sx0, sy0, sx1, sy1, zm:(z0+z1)/2, theta:th0, isPast:u0<u_earth });
    }
  }
  segs.sort((a, b) => a.zm - b.zm);
  segs.forEach(({ sx0, sy0, sx1, sy1, zm, theta, isPast }) => {
    const depth = (zm + R) / (2*R);
    const alpha = (isPast ? 0.25 : 0.84) * (0.22 + depth * 0.78);
    ctx.beginPath(); ctx.moveTo(sx0, sy0); ctx.lineTo(sx1, sy1);
    ctx.strokeStyle = segColor(Math.cos(theta), alpha);
    ctx.lineWidth   = 0.7 + depth * 1.9;
    ctx.stroke();
  });

  ctx.strokeStyle='rgba(60,100,180,0.22)'; ctx.lineWidth=0.5; ctx.setLineDash([3,4]);
  ctx.beginPath(); ctx.moveTo(earthX, CY-R-15); ctx.lineTo(earthX, CY+R+15); ctx.stroke();
  ctx.setLineDash([]);
  const eR = 15;
  ctx.fillStyle='#0d2244'; ctx.beginPath(); ctx.arc(earthX, CY, eR, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle='#2563eb'; ctx.lineWidth=2.5; ctx.stroke();
  for (let i = 0; i < 2; i++) {
    ctx.strokeStyle=`rgba(100,170,255,${0.38-i*0.18})`; ctx.lineWidth=0.7;
    ctx.beginPath(); ctx.arc(earthX,CY,eR+5+i*10,-Math.PI*0.78,Math.PI*0.78); ctx.stroke();
    ctx.beginPath(); ctx.arc(earthX,CY,eR+5+i*10,Math.PI+Math.PI*0.22,Math.PI*2-Math.PI*0.22); ctx.stroke();
  }
  ctx.fillStyle='rgba(160,210,255,0.8)'; ctx.font='9px system-ui'; ctx.textAlign='center';
  ctx.fillText('Earth', earthX, CY+eR+14);
  ctx.fillStyle='rgba(75,105,148,0.4)'; ctx.font='8px system-ui'; ctx.textAlign='center';
  ctx.fillText('← passed Earth', X0 + u_earth*RLEN*0.5, CY+R+23);
  ctx.fillText('incoming →', X0 + (u_earth+(1-u_earth)*0.5)*RLEN, CY+R+23);
  ctx.fillStyle='rgba(75,105,148,0.3)'; ctx.textAlign='left'; ctx.font='8px system-ui';
  ctx.fillText('green = Bz south · red = Bz north', X0, CY+R+35);

  ctx.strokeStyle='rgba(255,190,55,0.42)'; ctx.lineWidth=1.2; ctx.setLineDash([3,4]);
  ctx.beginPath(); ctx.moveTo(SW-8,CY); ctx.lineTo(SW-44,CY); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle='rgba(255,190,55,0.4)'; ctx.font='8px system-ui'; ctx.textAlign='center';
  ctx.fillText('solar wind', SW-26, CY-8);

  ctx.strokeStyle='rgba(55,85,135,0.18)'; ctx.lineWidth=0.5; ctx.setLineDash([2,5]);
  ctx.beginPath(); ctx.moveTo(SW,8); ctx.lineTo(SW,H-8); ctx.stroke(); ctx.setLineDash([]);

  ctx.fillStyle='#050d1c';
  ctx.beginPath(); ctx.arc(HX,CY,HR,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle='rgba(80,110,160,0.28)'; ctx.lineWidth=0.5; ctx.stroke();
  [0.34,0.67].forEach(f => {
    ctx.beginPath(); ctx.arc(HX,CY,HR*f,0,Math.PI*2);
    ctx.strokeStyle='rgba(80,110,160,0.16)'; ctx.stroke();
  });
  ctx.strokeStyle='rgba(80,110,160,0.2)'; ctx.lineWidth=0.5;
  ctx.beginPath(); ctx.moveTo(HX-HR,CY); ctx.lineTo(HX+HR,CY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(HX,CY-HR); ctx.lineTo(HX,CY+HR); ctx.stroke();
  ctx.fillStyle='rgba(180,80,80,0.82)'; ctx.font='500 10px system-ui'; ctx.textAlign='center';
  ctx.fillText('Bz+ (no aurora)',HX,CY-HR-5);
  ctx.fillStyle='rgba(60,200,90,0.92)'; ctx.fillText('Bz− (aurora!)',HX,CY+HR+14);
  ctx.fillStyle='rgba(120,155,195,0.48)'; ctx.font='8px system-ui';
  ctx.textAlign='left'; ctx.fillText('By+',HX+HR+3,CY+3);
  ctx.textAlign='right'; ctx.fillText('By−',HX-HR-3,CY+3);

  const TRAIL = Math.min(result.thetaArr.length, 90);
  for (let i = 0; i < TRAIL; i++) {
    const th = result.thetaArr[result.thetaArr.length - TRAIL + i];
    const px = HX + Math.sin(th)*HR;
    const py = CY - Math.cos(th)*HR;
    ctx.beginPath(); ctx.arc(px,py,1.5,0,Math.PI*2);
    ctx.fillStyle=`rgba(100,180,255,${(i/TRAIL)*0.72})`; ctx.fill();
  }

  const FDTS  = [15,30,60,180,360];
  const FLBLS = ['15m','30m','1h','3h','6h'];
  const OMEGA_HALFLIFE_DRAW = 60;
  const lambdaDraw = Math.LN2 / OMEGA_HALFLIFE_DRAW;
  FDTS.forEach((dt, i) => {
    const conf = Math.pow(result.confidence, 1 + i * 0.55);
    if (conf < 0.12) return;
    // Greyed out if this slot is past the rope's estimated exit
    const isPastExit = dt > result.remainingMin;
    const deltaTheta = lambdaDraw > 0
      ? (result.omega / lambdaDraw) * (1 - Math.exp(-lambdaDraw * dt))
      : result.omega * dt;
    const th = result.thetaNow + deltaTheta;
    const px = HX + Math.sin(th)*HR;
    const py = CY - Math.cos(th)*HR;
    const bz = Math.cos(th);
    ctx.beginPath(); ctx.arc(px,py,3.5,0,Math.PI*2);
    if (isPastExit) {
      ctx.fillStyle = `rgba(100,100,120,${conf*0.5})`;
    } else {
      ctx.fillStyle = bz<0 ? `rgba(55,200,85,${conf*0.82})` : `rgba(200,65,65,${conf*0.82})`;
    }
    ctx.fill();
    ctx.fillStyle=`rgba(175,200,222,${conf*(isPastExit?0.4:0.88)})`; ctx.font='8px system-ui'; ctx.textAlign='center';
    ctx.fillText(FLBLS[i], px, py-7);
  });

  const ax = HX + Math.sin(result.thetaNow)*HR;
  const ay = CY - Math.cos(result.thetaNow)*HR;
  const bzN = Math.cos(result.thetaNow);
  const arCol = bzN < -0.1 ? '#22c55e' : bzN > 0.1 ? '#ef4444' : '#f59e0b';
  ctx.strokeStyle=arCol; ctx.lineWidth=2.5;
  ctx.beginPath(); ctx.moveTo(HX,CY); ctx.lineTo(ax,ay); ctx.stroke();
  const dx=ax-HX, dy=ay-CY, L=Math.sqrt(dx*dx+dy*dy)||1;
  ctx.beginPath();
  ctx.moveTo(ax+dx/L*9, ay+dy/L*9);
  ctx.lineTo(ax+(-dy/L)*5, ay+(dx/L)*5);
  ctx.lineTo(ax+(dy/L)*5, ay+(-dx/L)*5);
  ctx.closePath(); ctx.fillStyle=arCol; ctx.fill();
  ctx.fillStyle='rgba(82,115,158,0.5)'; ctx.font='8px system-ui'; ctx.textAlign='center';
  ctx.fillText('IMF direction', HX, CY+HR+28);
  ctx.fillText('By–Bz plane · dots = forecast', HX, CY+HR+38);
}

const FluxRopeAnalyzer: React.FC<FluxRopeAnalyzerProps> = ({
  magneticData, speedData, densityData, tempData,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef   = useRef<HTMLDivElement>(null);
  const animRef   = useRef<number>(0);
  const angleRef  = useRef<number>(0);
  const lastTRef  = useRef<number | null>(null);
  const [canvasW, setCanvasW] = useState(700);

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
    const DISP_OMEGA = result.omega !== 0 ? Math.sign(result.omega) * 0.20 : 0;
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
            <button
              className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors"
              title="CME flux rope structure: in-situ magnetic-field rotation pattern used to infer rope orientation and estimate when southward Bz windows may occur (key for aurora intensity). Uses weighted linear regression on unwrapped θ = atan2(By,Bz), corrected for in-plane field amplitude and proton temperature cold-fraction."
            >
              ?
            </button>
          </div>
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
          Left: slinky cross-section as rope sweeps past Earth · green coils = Bz southward · red = northward
        </span>
        <span className="text-xs text-neutral-600">
          Right: IMF direction rotating in By–Bz plane · blue trail = measured data · coloured dots = forecast (grey = post-rope)
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