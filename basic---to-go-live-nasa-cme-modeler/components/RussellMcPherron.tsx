// --- START OF FILE src/components/RussellMcPherron.tsx ---
//
// Russell-McPherron Effect (live, status-led)
// Leads with a plain-language status and a simple "helping / neutral / against"
// meter that any aurora chaser can read at a glance. The technical geometry
// (tilt angles, GSEQ/GSM axes) is tucked into an optional "show the science"
// panel for advanced users.
//
// Geometry: Hapgood (1992) GSE-GSM transformation, IGRF-13 dipole.
// Live IMF (GSM By, Bz) is rotated back to GSEQ to isolate the RM contribution.

import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const POLE_LAT = 80.65, POLE_LON = -72.68; // IGRF-13, matches AuroraSightings

interface MagPoint { time: number; bt: number; bz: number; by: number; bx: number; clock: number | null }
interface Props { magneticData: MagPoint[]; onOpenModal: () => void }

// ---- Hapgood (1992) angles ----
interface RMAngles { psi: number; mu: number; delta: number; beta: number }
function rmAngles(date: Date): RMAngles {
  const MJD = date.getTime() / 86400000 + 40587;
  const T0 = (MJD - 51544.5) / 36525.0;
  const H = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const M = (357.528 + 35999.050 * T0 + 0.04107 * H) * D2R;
  const Lam = 280.460 + 36000.772 * T0 + 0.04107 * H;
  const lambdaSun = (Lam + (1.915 - 0.0048 * T0) * Math.sin(M) + 0.020 * Math.sin(2 * M)) * D2R;
  const eps = (23.439 - 0.013 * T0) * D2R;
  const theta = ((100.461 + 36000.770 * T0 + 15.04107 * H) % 360) * D2R;
  const phi = POLE_LAT * D2R, lam = POLE_LON * D2R;
  const Qg = [Math.cos(phi) * Math.cos(lam), Math.cos(phi) * Math.sin(lam), Math.sin(phi)];
  const ct = Math.cos(theta), st = Math.sin(theta);
  const Qei = [ct * Qg[0] - st * Qg[1], st * Qg[0] + ct * Qg[1], Qg[2]];
  const ce = Math.cos(eps), se = Math.sin(eps);
  const a = [Qei[0], ce * Qei[1] + se * Qei[2], -se * Qei[1] + ce * Qei[2]];
  const cl = Math.cos(lambdaSun), sl = Math.sin(lambdaSun);
  const Qgse = [cl * a[0] + sl * a[1], -sl * a[0] + cl * a[1], a[2]];
  const xe = Qgse[0], ye = Qgse[1], ze = Qgse[2];
  const psi = Math.atan2(ye, ze) * R2D;
  const mu = Math.atan2(xe, Math.sqrt(ye * ye + ze * ze)) * R2D;
  const i_s = 7.25 * D2R, Omega = 75.76 * D2R;
  const delta = Math.atan(Math.tan(i_s) * Math.sin(lambdaSun - Omega)) * R2D;
  return { psi, mu, delta, beta: psi + delta };
}
function gsmToGseqBy(byGsm: number, bzGsm: number, betaDeg: number): number {
  const b = betaDeg * D2R;
  return byGsm * Math.cos(b) + bzGsm * Math.sin(b);
}

// Days to nearest equinox + label
function equinoxContext(now: Date): string {
  const y = now.getUTCFullYear();
  const cands = [
    { d: new Date(Date.UTC(y, 2, 20)), name: 'March equinox' },
    { d: new Date(Date.UTC(y, 8, 23)), name: 'September equinox' },
    { d: new Date(Date.UTC(y - 1, 8, 23)), name: 'September equinox' },
    { d: new Date(Date.UTC(y + 1, 2, 20)), name: 'March equinox' },
  ];
  let best = cands[0], bestAbs = Infinity, bestSigned = 0;
  for (const c of cands) {
    const days = Math.round((c.d.getTime() - now.getTime()) / 86400000);
    if (Math.abs(days) < bestAbs) { bestAbs = Math.abs(days); best = c; bestSigned = days; }
  }
  const wk = Math.round(bestAbs / 7);
  if (bestAbs <= 18) return `Near the ${best.name}, when this effect is at its strongest for the year.`;
  if (bestSigned > 0) return `About ${wk} week${wk === 1 ? '' : 's'} before the ${best.name}, when this effect peaks.`;
  return `About ${wk} week${wk === 1 ? '' : 's'} after the ${best.name}.`;
}

const VB = 360;

const RussellMcPherron: React.FC<Props> = ({ magneticData, onOpenModal }) => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(id); }, []);
  const [showScience, setShowScience] = useState(false);

  const ang = useMemo(() => rmAngles(now), [now]);
  const latest = magneticData && magneticData.length ? magneticData[magneticData.length - 1] : null;
  const byGsm = latest?.by ?? null;
  const bzGsm = latest?.bz ?? null;

  const byGseq = byGsm != null && bzGsm != null ? gsmToGseqBy(byGsm, bzGsm, ang.beta) : null;
  const rmContribution = byGseq != null ? byGseq * Math.sin(ang.beta * D2R) : null; // nT, negative = southward
  const convFactor = Math.sin(ang.beta * D2R);

  // Best window tonight (NZ local), holding By steady
  const peakLocal = useMemo(() => {
    if (byGseq == null) return null;
    let best = { hour: 0, val: Infinity };
    const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    for (let h = 0; h < 24; h++) {
      const d = new Date(base.getTime() + h * 3600000);
      const contrib = byGseq * Math.sin(rmAngles(d).beta * D2R);
      if (contrib < best.val) best = { hour: h, val: contrib };
    }
    if (best.val >= -0.05) return null;
    const d = new Date(base.getTime() + best.hour * 3600000);
    try {
      return d.toLocaleTimeString('en-NZ', { timeZone: 'Pacific/Auckland', hour: 'numeric', minute: '2-digit' });
    } catch { return `${String(best.hour).padStart(2, '0')}:00 UTC`; }
  }, [byGseq, now]);

  // ---- Status ----
  // Helping = southward push (negative nT). Map to a 0..100 meter (0 = against, 100 = helping).
  const helpNt = rmContribution != null ? -rmContribution : 0; // positive = helping
  const meterPct = Math.max(0, Math.min(100, 50 + (helpNt / 3) * 50));

  let status: { word: string; colour: string; emoji: string; line: string };
  if (rmContribution == null) {
    status = { word: 'No data', colour: '#9aa2b1', emoji: '·', line: 'Waiting for live magnetic field readings.' };
  } else if (helpNt >= 0.3) {
    status = { word: 'Helping', colour: '#34d399', emoji: '✅', line: `The season and time of day are adding about ${helpNt.toFixed(1)} nT of extra southward push to the field right now.` };
  } else if (helpNt <= -0.3) {
    status = { word: 'Against', colour: '#fb923c', emoji: '⚠️', line: `The geometry is pulling about ${Math.abs(helpNt).toFixed(1)} nT of the field northward right now, slightly working against aurora.` };
  } else {
    status = { word: 'Quiet', colour: '#38bdf8', emoji: '➖', line: 'The geometry is close to neutral, so it is barely changing the field either way right now.' };
  }

  // Geometry potential, independent of By (how loaded the season/time is)
  const potential = Math.abs(convFactor); // 0..1
  const potentialLabel = potential >= 0.45 ? 'Strong' : potential >= 0.25 ? 'Moderate' : potential >= 0.1 ? 'Weak' : 'Minimal';
  const favouredSign = ang.beta >= 0 ? 'toward the Sun (negative)' : 'away from the Sun (positive)';

  const fmt = (v: number, d = 0) => (v >= 0 ? '+' : '') + v.toFixed(d);

  // ---- Science diagram geometry ----
  const cx = VB / 2, cy = VB / 2 - 6, axLen = 118, b = ang.beta * D2R;
  const gsmZx = cx + axLen * Math.sin(b), gsmZy = cy - axLen * Math.cos(b);
  const gsmYx = cx + axLen * Math.cos(b), gsmYy = cy + axLen * Math.sin(b);
  const haveIMF = byGsm != null && bzGsm != null;
  const bt = haveIMF ? Math.max(1, Math.hypot(byGsm!, bzGsm!)) : 1;
  const imfScale = 95 / Math.max(5, bt);
  const imfX = haveIMF ? cx + byGsm! * imfScale : cx;
  const imfY = haveIMF ? cy - bzGsm! * imfScale : cy;

  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tipT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTip = useCallback((e: React.MouseEvent | React.TouchEvent, text: string) => {
    if (!svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const px = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const py = 'touches' in e ? e.touches[0].clientY : e.clientY;
    setTip({ text, x: ((px - r.left) / r.width) * VB, y: ((py - r.top) / r.height) * VB - 8 });
    if (tipT.current) clearTimeout(tipT.current);
    tipT.current = setTimeout(() => setTip(null), 4000);
  }, []);
  const hideTip = useCallback(() => { if (tipT.current) clearTimeout(tipT.current); setTip(null); }, []);

  return (
    <div className="col-span-12 card bg-neutral-950/80 p-3 sm:p-4 flex flex-col overflow-hidden">
      <style>{`
        @keyframes rmPulse { 0%,100% { opacity:.5 } 50% { opacity:1 } }
        .rm-pulse { animation: rmPulse 2.5s ease-in-out infinite }
        .rm-h { pointer-events:all; cursor:help }
        @media (prefers-reduced-motion:reduce){ .rm-pulse{animation:none} }
      `}</style>

      {/* Header */}
      <div className="flex flex-wrap justify-between items-start gap-1 mb-2">
        <div className="flex items-center gap-1.5">
          <h3 className="text-lg sm:text-xl font-semibold text-white">Equinox Boost</h3>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-amber-500/15 text-amber-400 border border-amber-500/30">
            <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            BETA
          </span>
          <button onClick={onOpenModal} className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors" title="About the Russell-McPherron effect">?</button>
        </div>
        <span className="text-[10px] text-neutral-500 mt-1">Russell-McPherron effect</span>
      </div>

      {/* HERO STATUS */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex items-center justify-center rounded-xl shrink-0" style={{ width: 52, height: 52, background: status.colour + '18', border: `1px solid ${status.colour}40` }}>
          <span className="text-2xl">{status.emoji}</span>
        </div>
        <div className="min-w-0">
          <div className="text-xl font-bold leading-tight" style={{ color: status.colour }}>{status.word}</div>
          <div className="text-xs text-neutral-300 leading-snug">{status.line}</div>
        </div>
      </div>

      {/* METER */}
      <div className="mb-1">
        <div className="relative h-3 rounded-full overflow-hidden" style={{ background: 'linear-gradient(90deg,#fb923c33,#9aa2b133 50%,#34d39933)' }}>
          <div className="absolute inset-0 flex">
            <div className="flex-1 border-r border-neutral-700/50" />
            <div className="flex-1" />
          </div>
          {/* marker */}
          <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full"
            style={{ left: `${meterPct}%`, width: 14, height: 14, background: status.colour, boxShadow: `0 0 8px ${status.colour}`, border: '2px solid #0a0e16' }} />
        </div>
        <div className="flex justify-between text-[10px] text-neutral-500 mt-1">
          <span>Against aurora</span>
          <span>Neutral</span>
          <span>Helping aurora</span>
        </div>
      </div>

      {/* Quick facts row */}
      <div className="grid grid-cols-2 gap-2 mt-3">
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-2.5">
          <div className="text-[10px] text-neutral-500 uppercase tracking-wide">Best window tonight</div>
          <div className="text-sm font-semibold text-neutral-100">{peakLocal ? `around ${peakLocal}` : 'no clear window'}</div>
          <div className="text-[10px] text-neutral-500">if the field holds steady (NZ time)</div>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-2.5">
          <div className="text-[10px] text-neutral-500 uppercase tracking-wide">Season setup</div>
          <div className="text-sm font-semibold text-neutral-100">{potentialLabel}</div>
          <div className="text-[10px] text-neutral-500">how primed the geometry is</div>
        </div>
      </div>

      {/* Seasonal context */}
      <p className="text-[11px] text-neutral-400 leading-relaxed mt-3 px-0.5">{equinoxContext(now)}</p>

      {/* Honesty note */}
      <p className="text-[10px] text-neutral-600 leading-relaxed mt-2 px-0.5">
        This is already baked into the Bz you chase, so it is not an extra number to add on. It just shows whether the season and time of day are quietly working for or against you right now.
      </p>

      {/* Science toggle */}
      <button onClick={() => setShowScience(s => !s)}
        className="mt-3 self-start text-xs text-neutral-400 hover:text-white transition-colors flex items-center gap-1">
        <span style={{ transform: showScience ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 0.2s' }}>▸</span>
        {showScience ? 'Hide the science' : 'Show the science'}
      </button>

      {showScience && (
        <div className="mt-3 border-t border-neutral-800 pt-3">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-3">
            {/* Diagram */}
            <div className="relative w-full mx-auto" style={{ maxWidth: 380, aspectRatio: '1 / 1' }}>
              <svg ref={svgRef} viewBox={`0 0 ${VB} ${VB}`} className="absolute inset-0 w-full h-full">
                <defs>
                  <radialGradient id="rm-earth" cx="42%" cy="38%" r="62%">
                    <stop offset="0%" stopColor="#3a6fa5" /><stop offset="60%" stopColor="#244a72" /><stop offset="100%" stopColor="#0f2438" />
                  </radialGradient>
                  <marker id="rm-arr" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0 0 L9 4.5 L0 9 Z" fill="context-stroke" /></marker>
                </defs>
                <text x={cx} y={16} textAnchor="middle" fill="#7e8794" fontSize="9" letterSpacing="0.1em" style={{ textTransform: 'uppercase' as const, fontFamily: 'system-ui,sans-serif' }}>View from the Sun</text>
                {/* GSEQ ref */}
                <g className="rm-h" onMouseMove={e => showTip(e, 'Dashed lines: the solar wind\'s natural frame. Its field mostly points along the horizontal (dawn-dusk) direction.')} onMouseLeave={hideTip} onClick={e => showTip(e, 'The solar wind\'s natural frame. Field mostly points horizontal (dawn-dusk).')}>
                  <line x1={cx - axLen} y1={cy} x2={cx + axLen} y2={cy} stroke="#4b5563" strokeWidth="1" strokeDasharray="3 4" />
                  <line x1={cx} y1={cy - axLen} x2={cx} y2={cy + axLen} stroke="#4b5563" strokeWidth="1" strokeDasharray="3 4" />
                  <text x={cx + axLen - 4} y={cy + 13} textAnchor="end" fill="#6b7280" fontSize="8.5" style={{ fontFamily: 'system-ui,sans-serif' }}>sideways field (By)</text>
                </g>
                {/* GSM rotated */}
                <g className="rm-h" onMouseMove={e => showTip(e, `Our chasing frame, tilted ${fmt(ang.beta,1)}° by Earth's dipole. This tilt is what turns sideways field into up/down Bz.`)} onMouseLeave={hideTip} onClick={e => showTip(e, `Our frame, tilted ${fmt(ang.beta,1)}°. This turns sideways field into Bz.`)}>
                  <line x1={cx - (gsmZx - cx)} y1={cy - (gsmZy - cy)} x2={gsmZx} y2={gsmZy} stroke="#8b93a1" strokeWidth="1.4" />
                  <line x1={cx - (gsmYx - cx)} y1={cy - (gsmYy - cy)} x2={gsmYx} y2={gsmYy} stroke="#8b93a1" strokeWidth="1.4" />
                  <text x={gsmZx + (ang.beta >= 0 ? 8 : -8)} y={gsmZy - 4} textAnchor={ang.beta >= 0 ? 'start' : 'end'} fill="#aeb7c6" fontSize="9" fontWeight="600" style={{ fontFamily: 'system-ui,sans-serif' }}>up/down (Bz)</text>
                </g>
                <path d={`M ${cx} ${cy - 40} A 40 40 0 0 ${ang.beta >= 0 ? 1 : 0} ${cx + 40 * Math.sin(b)} ${cy - 40 * Math.cos(b)}`} fill="none" stroke={status.colour} strokeWidth="1.5" className="rm-pulse" />
                <circle cx={cx} cy={cy} r={20} fill="url(#rm-earth)" stroke="#2a4258" strokeWidth="0.5" />
                {haveIMF && (
                  <g className="rm-h"
                    onMouseMove={e => showTip(e, `Live field: sideways ${fmt(byGsm!,1)}, up/down ${fmt(bzGsm!,1)} nT. The thick line is the part that lands on our up/down axis.`)} onMouseLeave={hideTip}
                    onClick={e => showTip(e, `Live field: By ${fmt(byGsm!,1)}, Bz ${fmt(bzGsm!,1)} nT.`)}>
                    {(() => {
                      const uzx = Math.sin(b), uzy = -Math.cos(b);
                      const vx = imfX - cx, vy = imfY - cy;
                      const dot = vx * uzx + vy * uzy;
                      const px = cx + dot * uzx, py = cy + dot * uzy;
                      return (<>
                        <line x1={imfX} y1={imfY} x2={px} y2={py} stroke="#5fb47a" strokeWidth="1" strokeDasharray="2 3" opacity="0.7" />
                        <line x1={cx} y1={cy} x2={px} y2={py} stroke={dot > 0 ? '#34d399' : '#f87171'} strokeWidth="3" opacity="0.85" />
                      </>);
                    })()}
                    <line x1={cx} y1={cy} x2={imfX} y2={imfY} stroke="#fbbf24" strokeWidth="2" markerEnd="url(#rm-arr)" />
                    <text x={imfX} y={imfY - 6} textAnchor="middle" fill="#fbbf24" fontSize="8.5" fontWeight="600" style={{ fontFamily: 'system-ui,sans-serif' }}>field</text>
                  </g>
                )}
                {tip && (
                  <foreignObject x={Math.max(4, Math.min(tip.x - 60, VB - 200))} y={Math.min(Math.max(4, tip.y - 40), VB - 76)} width="196" height="72" style={{ pointerEvents: 'none' }}>
                    <div style={{ background: 'rgba(10,14,22,0.96)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, padding: '6px 8px', fontSize: 10.5, lineHeight: 1.4, color: '#d4d8e0', fontFamily: 'system-ui,sans-serif', backdropFilter: 'blur(8px)', maxWidth: 188 }}>{tip.text}</div>
                  </foreignObject>
                )}
              </svg>
            </div>
            {/* Angle readouts */}
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-2">
                  <div className="text-[9px] text-neutral-500 uppercase tracking-wide">Dipole tilt</div>
                  <div className="text-base font-bold text-white">{fmt(ang.mu, 1)}°</div>
                  <div className="text-[9px] text-neutral-400">{ang.mu >= 0 ? 'toward Sun' : 'away from Sun'}</div>
                </div>
                <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-2">
                  <div className="text-[9px] text-neutral-500 uppercase tracking-wide">Dawn-dusk lean</div>
                  <div className="text-base font-bold text-white">{fmt(ang.psi, 1)}°</div>
                  <div className="text-[9px] text-neutral-400">{ang.psi >= 0 ? 'toward dusk' : 'toward dawn'}</div>
                </div>
              </div>
              <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-2">
                <div className="text-[9px] text-neutral-500 uppercase tracking-wide">Conversion right now</div>
                <div className="text-base font-bold text-white">{fmt(convFactor * 100)}%</div>
                <div className="text-[9px] text-neutral-400">of sideways field becomes up/down</div>
              </div>
              <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-2">
                <div className="text-[9px] text-neutral-500 uppercase tracking-wide">Geoeffective sign</div>
                <div className="text-xs font-semibold text-neutral-200">By {favouredSign}</div>
                <div className="text-[9px] text-neutral-400">is the helpful direction now</div>
              </div>
            </div>
          </div>
          <p className="text-[10px] text-neutral-600 leading-relaxed mt-3">
            Angles use the Hapgood (1992) GSE-GSM transformation with the IGRF-13 dipole. Live GSM By and Bz are rotated back to GSEQ to isolate the converted part.
          </p>
        </div>
      )}
    </div>
  );
};

export default RussellMcPherron;
// --- END OF FILE src/components/RussellMcPherron.tsx ---
