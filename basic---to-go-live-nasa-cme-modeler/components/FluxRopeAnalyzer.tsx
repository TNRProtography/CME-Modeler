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
  shockTime:     number;
  ropeEntry:     number;
  minutesInRope: number;
  thetaNow:      number;
  omega:         number;
  btMean:        number;
  r2:            number;
  confidence:    number;
  leading:       string;
  axial:         string;
  trailing:      string;
  orientCode:    string;
  bzForecast:    number[];
  thetaArr:      number[];
  thetaFit0:     number;
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

function analyzeRope(mag: MagPt[], spd: XYPt[], den: XYPt[]) {
  const now   = Date.now();
  const BKT   = 3 * 60000;
  const bkt   = (t: number) => Math.round(t / BKT) * BKT;

  const magS = [...mag].sort((a, b) => a.time - b.time);
  const spdS = [...spd].sort((a, b) => a.x - b.x);
  const denS = [...den].sort((a, b) => a.x - b.x);

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
    if (t < now - 24*3600000 || t > now) continue;
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

  const reg = linReg(timeMin, thetaArr);
  const { slope: omega, intercept: thetaFit0, r2 } = reg;
  const thetaNow = thetaFit0 + omega * minutesInRope;
  const btMean   = medArr(ropeMag.map(p => p.bt));

  const confidence = r2 * Math.min(1, minutesInRope / 90);
  if (r2 < 0.38 || minutesInRope < 15) return null;

  const leading  = dirFromTheta(thetaFit0);
  const axial    = dirFromTheta(thetaFit0 + omega * ROPE_DUR_MIN * 0.40);
  const trailing = dirFromTheta(thetaFit0 + omega * ROPE_DUR_MIN * 0.80);

  const bzForecast = FORECAST_DT.map(dt =>
    +(btMean * Math.cos(thetaNow + omega * dt)).toFixed(1)
  );

  return {
    shockTime, ropeEntry, minutesInRope,
    thetaNow, omega, btMean, r2, confidence,
    leading, axial, trailing, orientCode: leading + axial + trailing,
    bzForecast, thetaArr, thetaFit0,
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
  const R = 70, N_FL = 6, N_COILS = 3.2, N_SEG = 300, TILT = 0.20;
  const u_earth = Math.min(0.80, result.minutesInRope / ROPE_DUR_MIN);
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
  const eR = 11;
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
  ctx.fillStyle='rgba(120,155,195,0.82)'; ctx.font='500 10px system-ui'; ctx.textAlign='center';
  ctx.fillText('N',HX,CY-HR-5);
  ctx.fillStyle='rgba(210,75,75,0.92)'; ctx.fillText('S',HX,CY+HR+14);
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
  FDTS.forEach((dt, i) => {
    const conf = Math.pow(result.confidence, 1 + i * 0.22);
    if (conf < 0.12) return;
    const th = result.thetaNow + result.omega * dt;
    const px = HX + Math.sin(th)*HR;
    const py = CY - Math.cos(th)*HR;
    const bz = Math.cos(th);
    ctx.beginPath(); ctx.arc(px,py,3.5,0,Math.PI*2);
    ctx.fillStyle = bz<0 ? `rgba(55,200,85,${conf*0.82})` : `rgba(200,65,65,${conf*0.82})`;
    ctx.fill();
    ctx.fillStyle=`rgba(175,200,222,${conf*0.88})`; ctx.font='8px system-ui'; ctx.textAlign='center';
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
  magneticData, speedData, densityData,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef   = useRef<HTMLDivElement>(null);
  const animRef   = useRef<number>(0);
  const angleRef  = useRef<number>(0);
  const lastTRef  = useRef<number | null>(null);
  const [canvasW, setCanvasW] = useState(700);

  const result = useMemo(() =>
    analyzeRope(magneticData, speedData, densityData),
    [magneticData, speedData, densityData]
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
  const confLabel = confPct < 40 ? 'Low confidence' : confPct < 68 ? 'Moderate confidence' : 'Good confidence';
  const confCls   = confPct < 40 ? 'text-amber-400' : confPct < 68 ? 'text-sky-400' : 'text-emerald-400';
  const hrsIn     = (result.minutesInRope / 60).toFixed(1);

  const rotDesc = Math.abs(result.omega) < 0.004
    ? 'stable orientation — minimal rotation detected'
    : result.omega > 0
    ? 'rotating counterclockwise (eastward)'
    : 'rotating clockwise (westward)';

  const orientPlain = (() => {
    if (result.leading === 'S') {
      return `The southward-pointing (Bz−) field arrived first. Aurora conditions may be strongest right now. As the rope continues sweeping past Earth, the field will rotate and Bz is expected to turn northward — storm intensity will fade over the coming hours.`;
    }
    if (result.trailing === 'S') {
      return `Northward field (Bz+) arrived first, meaning the best aurora conditions are still coming. The southward-pointing portion of the rope is in its trailing half and has not yet reached Earth.`;
    }
    if (result.leading === 'E' || result.leading === 'W') {
      return `The rope arrived with the field pointing ${result.leading === 'E' ? 'eastward' : 'westward'}. Southward Bz may develop through the middle of the passage — watch Bz closely for a sudden aurora opportunity.`;
    }
    return `The field is mainly northward throughout this rope passage. Significant aurora is unlikely unless the rope is distorted from its forecast orientation.`;
  })();

  return (
    <div className="col-span-12 card bg-neutral-950/80 p-4">
      <div className="flex items-start justify-between flex-wrap gap-2 mb-3">
        <div>
          <h2 className="text-base font-semibold text-white">CME flux rope structure</h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Inside magnetic flux rope · {hrsIn}h of rope data · {rotDesc}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-medium px-2 py-1 rounded-full bg-neutral-800 ${confCls}`}>
            {confLabel} ({confPct}%)
          </span>
          <span className="text-xs font-mono font-semibold px-3 py-1 rounded-full bg-neutral-800 text-neutral-200 tracking-widest">
            {result.orientCode}
          </span>
        </div>
      </div>

      <div ref={wrapRef} className="mb-3">
        <canvas
          ref={canvasRef}
          style={{ display:'block', borderRadius:10, width:'100%' }}
        />
      </div>

      {confPct < 45 && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-amber-900/20 border border-amber-700/30 text-xs text-amber-300/80 leading-relaxed">
          Early estimate — the forecast improves as more rope data accumulates. Treat the further-out predictions with caution for now.
        </div>
      )}

      <div className="mb-3 text-xs text-neutral-400 leading-relaxed bg-neutral-900/50 rounded-lg px-3 py-2.5">
        <span className="font-semibold text-neutral-200 mr-1">{result.orientCode}:</span>
        {orientPlain}
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 mb-3">
        {FORECAST_LABELS.map((label, i) => {
          const bz   = result.bzForecast[i];
          const conf = i === 0 ? 1 : Math.max(0.28, Math.pow(result.confidence, 1 + i*0.26));
          const isAurora = bz < -2;
          return (
            <div
              key={label}
              className="bg-neutral-900/70 rounded-lg p-2 text-center"
              style={{ opacity: conf }}
            >
              <div className="text-xs text-neutral-500 mb-1">{label}</div>
              <div
                className="text-sm font-semibold"
                style={{ color: bz < -6 ? '#22c55e' : bz < -1 ? '#86efac' : bz < 2 ? '#f59e0b' : '#ef4444' }}
              >
                {bz > 0 ? '+' : ''}{bz.toFixed(1)} nT
              </div>
              <div className="text-xs mt-0.5" style={{ color: isAurora ? '#4ade80' : '#6b7280' }}>
                {isAurora ? '★ aurora' : 'quiet'}
              </div>
            </div>
          );
        })}
      </div>

      <div className="pt-2 border-t border-neutral-800/60 flex flex-wrap gap-x-4 gap-y-1 items-center">
        <span className="text-xs text-neutral-600">
          Left: slinky cross-section as rope sweeps past Earth · green coils = Bz southward · red = northward
        </span>
        <span className="text-xs text-neutral-600">
          Right: IMF direction rotating in By–Bz plane · blue trail = measured data · coloured dots = forecast
        </span>
        <span className="text-xs text-neutral-700 ml-auto">
          Bt {result.btMean.toFixed(1)} nT · R² {result.r2.toFixed(2)} · {result.orientCode}
        </span>
      </div>
    </div>
  );
};

export { FluxRopeAnalyzer };
export default FluxRopeAnalyzer;