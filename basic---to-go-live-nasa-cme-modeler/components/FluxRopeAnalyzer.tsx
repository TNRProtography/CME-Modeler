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

import {
  drawGlow, loadMilkyWay, drawMilkyWay,
  loadEarthTexture, earthTexture, renderGlobe, drawSun,
} from '../utils/spaceScene';
import { SUN_FRAGMENT_SHADER } from '../constants';
import { effectiveBz } from '../utils/rmEffect';

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
  inPlaneRatio:     number;   // sqrt(By²+Bz²) / Bt - rope field planarity
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

// Weighted linear regression - weights decay exponentially so recent data dominates.
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
  // Planarity ratio - how much of |B| lives in the By-Bz plane (1 = perfect rope)
  const totalBtMean = medArr(ropeMag.map(p => p.bt));
  const inPlaneRatio = totalBtMean > 0 ? btMean / totalBtMean : 1;

  if (r2 < 0.38 || minutesInRope < 15) return null;

  // ── FIX 3: Chirality from sign of ω (right-handed = ω > 0 in GSE-like frame)
  const chirality: RopeResult['chirality'] =
    Math.abs(omega) < 0.002 ? 'indeterminate' :
    omega > 0 ? 'right-handed' : 'left-handed';
  const chiralityCode: RopeResult['chiralityCode'] =
    chirality === 'right-handed' ? 'R' : chirality === 'left-handed' ? 'L' : '?';

  // ── FIX 4: Temperature cold-fraction - genuine flux ropes are cold plasma ─
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
  const OMEGA_HALFLIFE = 60; // minutes - rotation rate halves every 60 min
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

// Earth is drawn with the same texture and renderer the magnetotail uses, so
// the planet looks identical wherever it appears.
let ropeGlobe: HTMLCanvasElement | null = null;
const ROPE_GLOBE_PX = 120;
function ropeGlobeSprite(): HTMLCanvasElement | null {
  const tex = earthTexture();
  if (!tex) return null;
  if (!ropeGlobe) {
    ropeGlobe = document.createElement('canvas');
    renderGlobe(ropeGlobe, tex, 172, -62, 0, false, ROPE_GLOBE_PX);
  }
  return ropeGlobe;
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
  // Same sky as the CME visualisation and the magnetotail.
  drawMilkyWay(ctx, W, H, performance.now() / 1000, 0.30, 0.8);

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

  // ── Rope ───────────────────────────────────────────────────────────────────
  // A force-free flux rope is not a single hollow coil. The field runs almost
  // straight along the axis at the centre and becomes progressively more wound
  // the further out you go, until the outer shell is twisted tight. So the rope
  // is drawn as nested shells whose twist scales with radius, around a bright
  // axial core, which reads as one solid structure rather than a loose spring.
  const X0 = 14, X1 = SW - 14, RLEN = X1 - X0;
  // Segment count has to beat the twist rate or the outer shells alias into a
  // flat band instead of reading as a helix. The outer shell does 4.2 turns, so
  // this gives roughly 30 samples per turn.
  const R = 50, N_SEG = 150, TILT = 0.34;
  const SHELLS = [
    { rf: 0.26, lines: 2, turns: 0.9, size: 1.35, alpha: 0.95 },
    { rf: 0.52, lines: 3, turns: 2.6, size: 1.20, alpha: 0.85 },
    { rf: 0.78, lines: 5, turns: 4.4, size: 1.05, alpha: 0.70 },
    { rf: 1.00, lines: 6, turns: 6.2, size: 0.92, alpha: 0.58 },
  ];
  const u_earth = Math.min(0.92, result.minutesInRope / result.estDurMin);
  // Earth sits near the left, the Sun is off-frame right, and the rope streams
  // leftward past us. The part already through Earth is squeezed into the strip
  // on the left, the part still to arrive gets the rest of the width, because
  // that is the half worth looking at.
  const EARTH_FRAC = 0.2;
  const earthX = X0 + RLEN * EARTH_FRAC;
  // The rope is drawn to scale against a fixed Earth, rather than always being
  // stretched to fill the panel. That matters: when the passage is nearly done
  // the trailing end sits right in front of Earth and the space beyond it is
  // empty, which is the honest picture. Stretching the remainder across the
  // full width made a finished rope look like it still had plenty to come.
  const PX_PER_U = RLEN * 0.92;
  const xOfU = (u: number) => earthX + (u - u_earth) * PX_PER_U;
  // Screen span that actually holds rope, used to sample at even density.
  const uAtX0 = u_earth + (X0 - earthX) / PX_PER_U;
  const uAtX1 = u_earth + (X1 - earthX) / PX_PER_U;
  const uLo = Math.max(0, uAtX0), uHi = Math.min(1, uAtX1);

  // Field colour is driven by the field Earth's dipole actually sees, not the
  // raw Bz. Because the dipole is tilted, By projects onto the GSM Bz axis, so
  // the same By helps or hinders depending on the season and time of day. That
  // is the Russell-McPherron effect, and it is why a rope with modest Bz can
  // still light the sky up.
  const nowDate = new Date();
  const ropeColourAt = (theta: number, alpha: number) => {
    const bt = Math.max(0.1, result.btMean);
    const by = bt * Math.sin(theta), bz = bt * Math.cos(theta);
    const { bzEff } = effectiveBz(by, bz, nowDate);
    return segColor(Math.max(-1, Math.min(1, bzEff / bt)), alpha);
  };
  const ropeRgbAt = (theta: number) => {
    const c = ropeColourAt(theta, 1);
    const m = c.match(/rgba?\(([^)]+)\)/);
    return m ? m[1].split(',').slice(0, 3).map(v => Math.round(parseFloat(v))).join(',') : '255,255,255';
  };

  // Faint axis line
  ctx.strokeStyle = 'rgba(40,70,120,0.2)'; ctx.lineWidth = 0.5; ctx.setLineDash([4,6]);
  ctx.beginPath(); ctx.moveTo(X0, CY); ctx.lineTo(X1, CY); ctx.stroke();
  ctx.setLineDash([]);

  type Pt = { x: number; y: number; z: number; theta: number; isPast: boolean; size: number; alpha: number };
  const pts: Pt[] = [];

  for (const sh of SHELLS) {
    const rad = R * sh.rf;
    for (let fl = 0; fl < sh.lines; fl++) {
      const flPhase = (fl / sh.lines) * Math.PI * 2;
      for (let seg = 0; seg <= N_SEG; seg++) {
        const u = uLo + (seg / N_SEG) * (uHi - uLo);
        const th = result.thetaFit0 + result.omega * u * ROPE_DUR_MIN;
        // Physical phase, then the shell's own winding. Twist scales with
        // radius, so the core barely rotates and the outer shell spins hard.
        const ph = (Math.PI / 2 - th) + sh.turns * Math.PI * 2 * u + flPhase + animAngle;
        const x = xOfU(u);
        const y = rad * Math.sin(ph), z = rad * Math.cos(ph);
        const lean = AXIS_LEAN * (0.5 - u);
        const sx = x + z * TILT, sy = (CY + lean) - y;
        if (sx < -6 || sx > SW + 6) continue;
        pts.push({ x: sx, y: sy, z, theta: th, isPast: u < u_earth, size: sh.size, alpha: sh.alpha });
      }
    }
  }

  // Bright axial core, drawn first so the shells sit over it.
  ctx.globalCompositeOperation = 'lighter';
  for (let seg = 0; seg <= N_SEG * 3; seg++) {
    const u = uLo + (seg / (N_SEG * 3)) * (uHi - uLo);
    const th = result.thetaFit0 + result.omega * u * ROPE_DUR_MIN;
    const x = xOfU(u);
    const lean = AXIS_LEAN * (0.5 - u);
    const past = u < u_earth;
    drawGlow(ctx, ropeRgbAt(th), x, CY + lean, past ? 2.8 : 4.0, past ? 0.10 : 0.24);
  }

  // Shells, painted back to front so the depth cue survives additive blending.
  pts.sort((a, b) => a.z - b.z);
  for (const pt of pts) {
    const depth = (pt.z + R) / (2 * R);
    const a = (pt.isPast ? 0.34 : 1) * pt.alpha * (0.16 + depth * 0.84);
    drawGlow(ctx, ropeRgbAt(pt.theta), pt.x, pt.y, (1.1 + depth * 1.9) * pt.size, a);
  }
  ctx.globalCompositeOperation = 'source-over';

  // ── Leading edge, drawn like the CME visualisation's front ────────────────
  // The 3D scene draws a CME as a curved particle front with a body trailing
  // behind it. The same idea here marks the part of the rope that has already
  // reached us, so the moment of impact is visible rather than implied.
  {
    const thLead = result.thetaFit0 + result.omega * u_earth * ROPE_DUR_MIN;
    const rgb = ropeRgbAt(thLead);
    const lx = earthX, ly = CY + AXIS_LEAN * (0.5 - u_earth);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i <= 70; i++) {
      const a = (i / 70) * Math.PI - Math.PI / 2;      // arc across the rope face
      const px = lx + Math.cos(a) * R * 0.30;
      const py = ly + Math.sin(a) * R * 1.04;
      drawGlow(ctx, rgb, px, py, 2.0, 0.5);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ── What Bz does from here ────────────────────────────────────────────────
  // The rope's rotation is what sets Bz, so the same fit that draws the coil
  // draws the forward trace. Southward is shaded, because that is the half
  // that produces aurora.
  {
    const sy = H - 58, sh = 20;
    const bt = Math.max(0.1, result.btMean);
    ctx.strokeStyle = 'rgba(90,120,170,0.25)'; ctx.lineWidth = 0.5; ctx.setLineDash([3,4]);
    const traceEnd = Math.max(earthX + 2, xOfU(uHi));
    ctx.beginPath(); ctx.moveTo(earthX, sy); ctx.lineTo(traceEnd, sy); ctx.stroke(); ctx.setLineDash([]);

    const pathPts: { x: number; y: number; bzEff: number }[] = [];
    for (let i = 0; i <= 90; i++) {
      const u = u_earth + (i / 90) * Math.max(0, uHi - u_earth);
      const th = result.thetaFit0 + result.omega * u * ROPE_DUR_MIN;
      const { bzEff } = effectiveBz(bt * Math.sin(th), bt * Math.cos(th), nowDate);
      pathPts.push({ x: xOfU(u), y: sy - (bzEff / bt) * sh, bzEff });
    }
    // Shade the southward stretches.
    ctx.fillStyle = 'rgba(34,197,94,0.16)';
    ctx.beginPath(); ctx.moveTo(pathPts[0].x, sy);
    pathPts.forEach(q => ctx.lineTo(q.x, q.bzEff < 0 ? q.y : sy));
    ctx.lineTo(pathPts[pathPts.length - 1].x, sy); ctx.closePath(); ctx.fill();

    ctx.lineWidth = 1.4;
    for (let i = 1; i < pathPts.length; i++) {
      ctx.beginPath(); ctx.moveTo(pathPts[i-1].x, pathPts[i-1].y); ctx.lineTo(pathPts[i].x, pathPts[i].y);
      ctx.strokeStyle = segColor(Math.max(-1, Math.min(1, pathPts[i].bzEff / bt)), 0.9);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(120,155,195,0.45)'; ctx.font = '7px system-ui'; ctx.textAlign = 'left';
    ctx.fillText('Bz from here', earthX + 3, sy - sh - 4);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(34,197,94,0.5)'; ctx.fillText('south', traceEnd, sy + sh + 8);
    ctx.fillStyle = 'rgba(210,60,60,0.5)'; ctx.fillText('north', traceEnd, sy - sh - 4);
  }

  // ── Where it came from, where it is going, and how it turns ────────────────
  // Material arrives from the Sun on the right and sweeps leftward past Earth.
  // ── Ambient wind behind the rope ──────────────────────────────────────────
  // Once the rope has passed, the space between its trailing end and the Sun is
  // ordinary solar wind, not nothing. Drawing it keeps the gap meaningful and
  // shows the flow direction without needing a label to explain it.
  {
    const tailX = Math.min(X1, xOfU(uHi));
    if (tailX < X1 - 20) {
      const drift = (performance.now() / 1000) * 26;
      ctx.globalCompositeOperation = 'lighter';
      // Kept modest: this is backdrop, and the shells already cost the frame.
      for (let i = 0; i < 110; i++) {
        const seed = i * 97.13;
        const span = X1 - tailX;
        const px = X1 - (((seed * 7.7 + drift) % span));
        const py = 26 + ((seed * 31.7) % (H - 90));
        const sp = 3 + ((seed * 13.1) % 5);
        drawGlow(ctx, '190,205,230', px, py, 1.5, 0.38);
        ctx.globalAlpha = 0.20;
        ctx.strokeStyle = 'rgba(190,205,230,0.5)'; ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + sp, py); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(150,170,205,0.3)'; ctx.font = '7px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('ambient solar wind', (tailX + X1) / 2, H - 22);
    }
  }

  // ── The Sun ───────────────────────────────────────────────────────────────
  // An actual Sun at the right edge, rather than labels and arrows explaining
  // which way is sunward. The geometry then reads on its own: Sun on the right,
  // rope between, Earth on the left.
  {
    const sunX = SW - 46, sunR = 26;
    drawSun(ctx, sunX, CY, sunR, performance.now() / 1000, SUN_FRAGMENT_SHADER);
    ctx.fillStyle = 'rgba(255,205,110,0.75)';
    ctx.font = '600 8px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('SUN', sunX, CY + sunR + 15);
  }

  // ── Cross section ─────────────────────────────────────────────────────────
  // The rope seen end-on, looking back down its axis toward the Sun. Same
  // nested shells as the side view, so the structure the coil is made of is
  // legible. The arrow is the field direction passing Earth right now, in the
  // By-Bz plane, and it turns as the rope rotates.
  {
    const ccX = X0 + 54, ccY = 60, ccR = 36;
    ctx.fillStyle = 'rgba(4,10,22,0.72)';
    ctx.beginPath(); ctx.arc(ccX, ccY, ccR + 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(80,110,160,0.22)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.arc(ccX, ccY, ccR + 8, 0, Math.PI * 2); ctx.stroke();

    const thHere = result.thetaFit0 + result.omega * u_earth * ROPE_DUR_MIN;
    ctx.globalCompositeOperation = 'lighter';
    for (const sh of SHELLS) {
      const rr = ccR * sh.rf;
      const dots = Math.max(10, Math.round(sh.rf * 34));
      for (let i = 0; i < dots; i++) {
        // Shells rotate at their own rate, matching the twist in the side view.
        const a = (i / dots) * Math.PI * 2 + animAngle * sh.turns * 0.5;
        const th = thHere + sh.turns * 0.35;
        drawGlow(ctx, ropeRgbAt(th), ccX + Math.cos(a) * rr, ccY + Math.sin(a) * rr,
                 1.5 * sh.size, sh.alpha * 0.7);
      }
    }
    drawGlow(ctx, ropeRgbAt(thHere), ccX, ccY, 4.4, 0.5);
    ctx.globalCompositeOperation = 'source-over';

    // Field direction at Earth: up is Bz north, right is By east.
    const fx = Math.sin(thHere), fy = -Math.cos(thHere);
    ctx.strokeStyle = segColor(Math.cos(thHere), 0.95); ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(ccX, ccY); ctx.lineTo(ccX + fx * ccR, ccY + fy * ccR); ctx.stroke();
    const ha = Math.atan2(fy, fx);
    const tipX = ccX + fx * ccR, tipY = ccY + fy * ccR;
    const HEAD = 8;
    ctx.fillStyle = segColor(Math.cos(thHere), 0.95);
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX + Math.cos(ha + 2.5) * HEAD, tipY + Math.sin(ha + 2.5) * HEAD);
    ctx.lineTo(tipX + Math.cos(ha - 2.5) * HEAD, tipY + Math.sin(ha - 2.5) * HEAD);
    ctx.closePath(); ctx.fill();

    ctx.font = '7px system-ui';
    ctx.fillStyle = 'rgba(120,155,195,0.5)'; ctx.textAlign = 'left';
    ctx.fillText('cross section', ccX + ccR + 12, ccY - 2);
    ctx.fillStyle = 'rgba(120,155,195,0.32)';
    ctx.fillText('looking back down the rope', ccX + ccR + 12, ccY + 8);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(210,60,60,0.5)'; ctx.fillText('Bz+', ccX, ccY - ccR - 4);
    ctx.fillStyle = 'rgba(34,197,94,0.5)'; ctx.fillText('Bz−', ccX, ccY + ccR + 9);
  }

  // Rotation sense, taken from the sign of omega.
  const ccw = result.omega >= 0;
  const rcx = X0 + 34, rcy = H - 34, rr = 13;
  ctx.strokeStyle = 'rgba(150,190,255,0.5)'; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.arc(rcx, rcy, rr, ccw ? 0.5 : 2.0, ccw ? 5.2 : 6.7); ctx.stroke();
  const tipA = ccw ? 5.2 : 2.0;
  const tx = rcx + Math.cos(tipA) * rr, ty = rcy + Math.sin(tipA) * rr;
  const perp = tipA + (ccw ? Math.PI / 2 : -Math.PI / 2);
  ctx.fillStyle = 'rgba(150,190,255,0.5)';
  ctx.beginPath();
  ctx.moveTo(tx + Math.cos(perp) * 5, ty + Math.sin(perp) * 5);
  ctx.lineTo(tx + Math.cos(perp + 2.4) * 5, ty + Math.sin(perp + 2.4) * 5);
  ctx.lineTo(tx + Math.cos(perp - 2.4) * 5, ty + Math.sin(perp - 2.4) * 5);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(150,190,255,0.5)'; ctx.font = '8px system-ui'; ctx.textAlign = 'left';
  ctx.fillText(ccw ? 'rotating counterclockwise' : 'rotating clockwise', rcx + rr + 7, rcy - 2);
  ctx.fillStyle = 'rgba(120,155,195,0.4)';
  ctx.fillText(result.chirality === 'right-handed' ? 'right-handed rope' : result.chirality === 'left-handed' ? 'left-handed rope' : 'handedness unclear', rcx + rr + 7, rcy + 9);

  // ── Earth ──────────────────────────────────────────────────────────────────
  ctx.strokeStyle='rgba(60,100,180,0.25)'; ctx.lineWidth=0.6; ctx.setLineDash([3,4]);
  ctx.beginPath(); ctx.moveTo(earthX, CY-R-16); ctx.lineTo(earthX, CY+R+16); ctx.stroke();
  ctx.setLineDash([]);
  const eR = 15;
  const globe = ropeGlobeSprite();
  if (globe) {
    ctx.drawImage(globe, earthX - eR, CY - eR, eR * 2, eR * 2);
  } else {
    ctx.fillStyle='#0d2244'; ctx.beginPath(); ctx.arc(earthX,CY,eR,0,Math.PI*2); ctx.fill();
  }
  ctx.strokeStyle='rgba(96,165,250,0.6)'; ctx.lineWidth=1.2;
  ctx.beginPath(); ctx.arc(earthX,CY,eR,0,Math.PI*2); ctx.stroke();
  for (let i=0; i<2; i++) {
    ctx.strokeStyle=`rgba(100,170,255,${0.38-i*0.18})`; ctx.lineWidth=0.7;
    ctx.beginPath(); ctx.arc(earthX,CY,eR+5+i*10,-Math.PI*0.78,Math.PI*0.78); ctx.stroke();
    ctx.beginPath(); ctx.arc(earthX,CY,eR+5+i*10,Math.PI+Math.PI*0.22,Math.PI*2-Math.PI*0.22); ctx.stroke();
  }
  ctx.fillStyle='rgba(160,210,255,0.85)'; ctx.font='9px system-ui'; ctx.textAlign='center';
  ctx.fillText('Earth', earthX, CY+eR+14);

  // Live Bz indicator above Earth
  // Effective Bz, so the label agrees with the colour of the rope beside it.
  const thAtEarth = result.thetaFit0 + result.omega * u_earth * ROPE_DUR_MIN;
  const btE = Math.max(0.1, result.btMean);
  const bzAtEarth = effectiveBz(btE * Math.sin(thAtEarth), btE * Math.cos(thAtEarth), nowDate).bzEff / btE;
  const bzCol = bzAtEarth < -0.15 ? '#22c55e' : bzAtEarth > 0.15 ? '#ef4444' : '#f59e0b';
  const bzTxt = bzAtEarth < -0.15 ? 'Bz− now' : bzAtEarth > 0.15 ? 'Bz+ now' : 'Bz≈0 now';
  ctx.fillStyle = bzCol; ctx.font='500 9px system-ui'; ctx.textAlign='center';
  ctx.fillText(bzTxt, earthX, CY-eR-16);

  // Passage labels
  ctx.fillStyle='rgba(75,105,148,0.4)'; ctx.font='8px system-ui'; ctx.textAlign='center';
  if (u_earth > 0.06) ctx.fillText('already through', (Math.max(X0, xOfU(uLo)) + earthX) / 2, CY + R + 26);
  if (u_earth < 0.97) ctx.fillText('still to arrive', (earthX + Math.min(X1, xOfU(uHi))) / 2, CY + R + 26);
  else { ctx.fillStyle = 'rgba(248,180,90,0.7)'; ctx.fillText('trailing end of the rope', earthX + 54, CY + R + 26); }

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

  // Earth dot (fixed in centre - rope is passing OVER Earth)
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
  useEffect(() => { loadMilkyWay(); loadEarthTexture(); }, []);
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
  const confLabel = confPct < 40 ? 'Early estimate - building'
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
    ? 'stable orientation - minimal rotation detected'
    : result.omega > 0
    ? 'rotating counterclockwise (eastward)'
    : 'rotating clockwise (westward)';

  const chiralityColor = result.chirality === 'right-handed'
    ? 'text-violet-400' : result.chirality === 'left-handed'
    ? 'text-orange-400' : 'text-neutral-500';

  const coldLabel = result.coldFraction > 0.65
    ? '❄ Cold plasma confirmed' : result.coldFraction > 0.35
    ? '~ Mixed temperature' : '⚠ Warm plasma - check for sheath';
  const coldColor = result.coldFraction > 0.65
    ? 'text-cyan-400' : result.coldFraction > 0.35
    ? 'text-amber-400' : 'text-rose-400';

  const planeLabel = result.inPlaneRatio > 0.85
    ? 'High planarity' : result.inPlaneRatio > 0.65
    ? 'Moderate planarity' : 'Low planarity - Bx significant';
  const planeColor = result.inPlaneRatio > 0.85
    ? 'text-emerald-400' : result.inPlaneRatio > 0.65
    ? 'text-amber-400' : 'text-rose-400';

  const orientPlain = (() => {
    const chiralNote = result.chirality !== 'indeterminate'
      ? ` This is a ${result.chirality} rope (${result.chiralityCode}).` : '';
    if (result.leading === 'S') {
      return `The southward-pointing (Bz−) field arrived first. Aurora conditions may be strongest right now. As the rope continues sweeping past Earth, the field will rotate and Bz is expected to turn northward - storm intensity will fade over the coming hours.${chiralNote}`;
    }
    if (result.trailing === 'S') {
      return `Northward field (Bz+) arrived first, meaning the best aurora conditions are still coming. The southward-pointing portion of the rope is in its trailing half and has not yet reached Earth.${chiralNote}`;
    }
    if (result.leading === 'E' || result.leading === 'W') {
      return `The rope arrived with the field pointing ${result.leading === 'E' ? 'eastward' : 'westward'}. Southward Bz may develop through the middle of the passage - watch Bz closely for a sudden aurora opportunity.${chiralNote}`;
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
              <p className="text-neutral-400">A coronal mass ejection arrives as a magnetised plasma cloud with its magnetic field wound into a helical coil - a <em>flux rope</em>. As it sweeps past Earth, each part of the coil passes in sequence, causing the measured magnetic field direction to rotate smoothly. The key aurora driver is <strong className="text-white">Bz</strong>: when it points southward (negative), it reconnects with Earth's northward magnetosphere and injects energy into the magnetotail - triggering geomagnetic storms and aurora.</p>
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
              <p className="text-neutral-500 text-xs mt-2">The chirality suffix - <span className="font-mono text-violet-400">R</span> (right-handed) or <span className="font-mono text-orange-400">L</span> (left-handed) - describes which way the field twists around the rope axis. Right-handed ropes (from the northern solar hemisphere) tend to produce eastward By; left-handed (southern hemisphere) tend westward.</p>
            </section>

            {/* Confidence */}
            <section>
              <h4 className="font-semibold text-neutral-100 mb-1.5">Forecast confidence: <span className={confCls}>{confLabel} ({confPct}%)</span></h4>
              <div className="space-y-1.5 text-neutral-400">
                <p>Confidence is built from four independent signals:</p>
                <ul className="list-disc list-inside space-y-1 text-xs pl-2">
                  <li><strong className="text-neutral-200">Rotation quality (R²)</strong> - how cleanly the field rotates versus noise. Current: <span className="text-sky-300">{result.r2.toFixed(2)}</span></li>
                  <li><strong className="text-neutral-200">Field planarity</strong> - what fraction of the field lies in the By–Bz plane (a perfect rope is 100% planar). Current: <span className={planeColor}>{Math.round(result.inPlaneRatio * 100)}%</span></li>
                  <li><strong className="text-neutral-200">Cold plasma fraction</strong> - real flux rope cores contain cold, dense plasma. Higher cold fraction → more confident we're inside a rope. Current: <span className={coldColor}>{Math.round(result.coldFraction * 100)}%</span></li>
                  <li><strong className="text-neutral-200">Data history</strong> - confidence builds over the first ~3 hours as more rotation is observed.</li>
                </ul>
                <p className="text-xs text-neutral-500 mt-1.5">Forecast uncertainty grows rapidly with time. The ±nT bands shown on Bz tiles widen with each step. Treat +3h and +6h as directional only until confidence exceeds ~65%.</p>
              </div>
            </section>

            {/* Chirality */}
            <section className="bg-neutral-900/60 rounded-lg p-3">
              <h4 className="font-semibold text-neutral-100 mb-1">Chirality: <span className={chiralityColor}>{result.chirality === 'right-handed' ? '↻ Right-handed' : result.chirality === 'left-handed' ? '↺ Left-handed' : '~ Indeterminate'}</span></h4>
              <p className="text-neutral-400 text-sm">The twist direction of the magnetic field around the rope axis. Determined from whether the axial field (Bx) is aligned or anti-aligned with the rotation direction. {result.chirality !== 'indeterminate' ? 'A confirmed chirality improves the reliability of the field-rotation forecast.' : 'Chirality is still unclear - this typically resolves after more rotation is observed.'}</p>
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
          <span className="ml-1 text-amber-400/80"> Forecast confidence is still building - treat +3h and +6h as directional only.</span>
        )}
        {result.inPlaneRatio < 0.70 && (
          <span className="ml-1 text-rose-400/80"> Bx component is significant ({Math.round((1 - result.inPlaneRatio) * 100)}% out-of-plane) - Bz amplitude may be lower than shown.</span>
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
                  <div className="text-sm font-semibold text-neutral-600"> - </div>
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
          Left: slinky physically oriented to rope orientation - coil position in canvas matches real By–Bz direction · green = Bz south · red = north · tap ? for detail
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
