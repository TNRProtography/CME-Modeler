// A sunspot region's history over the last two weeks, as charts on one
// timeline: NOAA's flare and proton chances, its sunspot area and spot count,
// and HMI's magnetic flux and magnetised area.
//
// NOAA's numbers come from the sunspot-history worker, which records every
// change; they step from one report to the next. HMI's are hourly: the app's
// own week of SHARPs, joined to whatever the worker has kept beyond that.
//
// Every line is coloured by level the way the X-ray flux chart is (see
// utils/regionHistorySeries for the bands), and one crosshair runs through
// all of them.

import React, { useEffect, useMemo, useState } from 'react';
import { fetchSharpHistory, fluxTrend, regionKey, type SharpHistoryPoint } from '../utils/sharpPositions';
import { SUNSPOT_HISTORY_URL, type RegionRecord } from '../utils/sunspotHistory';
import {
  SCALES, colourOf, mergeSharp, noaaSeries, valueAt, type Scale, type SeriesPoint,
} from '../utils/regionHistorySeries';


const fmtNzShort = (ms: number) => new Date(ms).toLocaleString('en-NZ', {
  timeZone: 'Pacific/Auckland', weekday: 'short', day: 'numeric', hour: 'numeric', hour12: true,
});

/** One chart: the line in level colours, with the matching fill under it. */
export const LevelChart: React.FC<{
  points: SeriesPoint[];
  scale: Scale;
  label: string;
  format: (v: number) => string;
  t0: number;
  t1: number;
  /** NOAA's values hold until the next report; HMI's are a curve. */
  step?: boolean;
  /** Fixed range (chances run 0-100); otherwise fitted to the data. */
  range?: [number, number];
  fromZero?: boolean;
  hoverMs: number | null;
  onHover: (ms: number | null) => void;
  markerMs?: number | null;
}> = ({ points, scale, label, format, t0, t1, step, range, fromZero, hoverMs, onHover, markerMs }) => {
  const W = 220, H = 30, PAD = 2;
  const values = points.map((p) => p.value);
  const hasData = points.length > 0;
  let lo = range ? range[0] : (fromZero ? 0 : Math.min(...values));
  let hi = range ? range[1] : Math.max(...values);
  if (!range && hasData) {
    const pad = Math.max((hi - lo) * 0.1, Math.abs(hi) * 0.02, 1e-9);
    hi += pad;
    if (!fromZero) lo -= pad;
  }
  const span = Math.max(hi - lo, 1e-9);
  const x = (ms: number) => PAD + ((ms - t0) / Math.max(1, t1 - t0)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((Math.min(hi, Math.max(lo, v)) - lo) / span) * (H - PAD * 2);

  const pointerMs = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width)));
    return t0 + f * (t1 - t0);
  };
  const shownMs = hoverMs ?? (hasData ? points[points.length - 1].atMs : null);
  const shown = shownMs != null ? valueAt(points, shownMs) : null;

  // The line as runs of one colour: each run one stroke and one fill, so
  // no seams where see-through slices would overlap. Like the X-ray chart,
  // a stretch takes the colour of where it ends (a step, of the value it holds).
  const runs: { colour: number; pts: [number, number][] }[] = [];
  const levelIndex = (v: number) => scale.findIndex((b) => v >= b.min);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const x0 = x(a.atMs), x1 = x(b.atMs);
    const v = step ? a.value : b.value;
    const lvl = levelIndex(v);
    const seg: [number, number][] = step
      ? [[x0, y(a.value)], [x1, y(a.value)]]
      : [[x0, y(a.value)], [x1, y(b.value)]];
    const last = runs[runs.length - 1];
    // Same colour: carry on the run (a step keeps its corner, so it steps
    // rather than sloping to the new value).
    if (last && last.colour === lvl) last.pts.push(...(step ? seg : [seg[1]]));
    else runs.push({ colour: lvl, pts: seg });
  }
  // Filled down to zero where values go negative, otherwise to the bottom.
  const base = lo < 0 && hi > 0 ? y(0) : H;
  const pieces: React.ReactNode[] = runs.map((run, i) => {
    const v = run.colour < 0 ? -Infinity : scale[run.colour].min;
    const stroke = colourOf(v, scale);
    const line = run.pts.map(([px, py], k) => `${k ? 'L' : 'M'}${px.toFixed(2)},${py.toFixed(2)}`).join(' ');
    const first = run.pts[0], end = run.pts[run.pts.length - 1];
    // A step joins the next run with a vertical in the next run's colour.
    const next = runs[i + 1];
    return (
      <g key={i}>
        <path d={`${line} L${end[0].toFixed(2)},${base.toFixed(2)} L${first[0].toFixed(2)},${base.toFixed(2)} Z`} fill={colourOf(v, scale, 0.2)} />
        <path d={line} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {step && next && (
          <line x1={end[0]} y1={end[1]} x2={next.pts[0][0]} y2={next.pts[0][1]}
                stroke={colourOf(next.colour < 0 ? -Infinity : scale[next.colour].min, scale)} strokeWidth="1.75" vectorEffect="non-scaling-stroke" />
        )}
      </g>
    );
  });

  return (
    <div>
      <div className="flex justify-between text-[10px] mb-0.5">
        <span className="text-neutral-500">{label}</span>
        <span className="font-mono font-semibold" style={{ color: shown != null ? colourOf(shown, scale) : '#737373' }}>
          {shown != null ? format(shown) : 'No data'}
        </span>
      </div>
      <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full cursor-crosshair block"
        // Sideways drags read the chart; up and down still scroll the page.
        style={{ height: H, touchAction: 'pan-y' }}
        preserveAspectRatio="none"
        onPointerDown={(e) => onHover(pointerMs(e))}
        onPointerMove={(e) => {
          // A mouse reads as it moves; a finger only while it is down.
          if (e.pointerType === 'mouse' || e.buttons) onHover(pointerMs(e));
        }}
        // A mouse leaving clears it; a finger lifting leaves the reading in
        // place, so it can be read without a finger over it.
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') onHover(null); }}
      >
        <rect x={0} y={0} width={W} height={H} fill="rgba(255,255,255,0.02)" />
        {pieces}
        {/* Where a value that can go negative (growth) crosses zero. */}
        {lo < 0 && hi > 0 && (
          <line x1={0} y1={y(0)} x2={W} y2={y(0)} stroke="rgba(163,163,163,0.45)" strokeWidth="1"
                strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        )}
        {markerMs != null && markerMs >= t0 && markerMs <= t1 && (
          <line x1={x(markerMs)} y1={0} x2={x(markerMs)} y2={H}
                stroke="#fbbf24" strokeWidth="1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
        )}
        {hoverMs != null && (
          <line x1={x(hoverMs)} y1={0} x2={x(hoverMs)} y2={H}
                stroke="#e5e5e5" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {/* The reading's dot, outside the stretched SVG so it stays round. */}
      {hoverMs != null && shown != null && (
        <span
          className="rounded-full"
          style={{
            position: 'absolute', pointerEvents: 'none', width: 8, height: 8, borderRadius: '50%',
            border: '1px solid #0a0a0a',
            left: `calc(${(x(hoverMs) / W) * 100}% - 4px)`,
            top: `${y(shown) - 4}px`,
            background: colourOf(shown, scale),
          }}
        />
      )}
      </div>
    </div>
  );
};

const RegionMagneticHistory: React.FC<{
  region: string;
  /** The region's record from the sunspot-history worker, if it has one. */
  record?: RegionRecord | null;
  /** The scrubber's moment, marked on every chart; null on the live frame. */
  markerMs?: number | null;
  /** How far back to show: the imagery's chosen time window. */
  windowHours?: number;
}> = ({ region, record = null, markerMs = null, windowHours = 14 * 24 }) => {
  const [history, setHistory] = useState<Map<string, SharpHistoryPoint[]> | null>(null);
  const [full, setFull] = useState<RegionRecord | null>(null);
  const [hoverMs, setHoverMs] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSharpHistory().then((h) => { if (!cancelled) setHistory(h.byRegion); });
    return () => { cancelled = true; };
  }, []);

  // The one region with its hourly flux, which the list leaves out.
  useEffect(() => {
    let cancelled = false;
    setFull(null);
    setHoverMs(null);
    fetch(`${SUNSPOT_HISTORY_URL}/api/region/${encodeURIComponent(region)}`, { signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d?.region) setFull(d.region); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [region]);

  const rec = full ?? record;
  // "Now" moves once a minute, not on every render. Read fresh each render,
  // it shifted the whole window a little every time the pointer moved -
  // which is what made the lines jitter under a finger or a mouse.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(id);
  }, []);

  const series = useMemo(() => {
    const until = rec ? (rec.active ? now : rec.lastSeenMs) : now;
    const noaa = (field: Parameters<typeof noaaSeries>[1]) => (rec ? noaaSeries(rec, field, until) : []);
    const hmi = mergeSharp(history?.get(regionKey(region)) ?? [], rec?.sharp ?? []);
    return {
      c: noaa('cFlareProbability'),
      m: noaa('mFlareProbability'),
      x: noaa('xFlareProbability'),
      proton: noaa('protonProbability'),
      area: noaa('areaMsh'),
      spots: noaa('spotCount'),
      flux: hmi.map((p) => ({ atMs: p.atMs, value: p.usfluxMx })),
      fieldArea: hmi.map((p) => ({ atMs: p.atMs, value: p.areaMh })),
      hmi,
    };
  }, [rec, history, region, now]);

  const trend = useMemo(() => fluxTrend(series.hmi.map((p) => ({ ...p, latitude: null, longitude: null }))), [series]);

  // The same span as the imagery above, so the charts and the frames line up.
  const t1 = now;
  const t0 = now - windowHours * 3600000;
  // A step holds whatever value was in force when the window opens.
  const clipStep = (pts: SeriesPoint[]) => {
    const atStart = valueAt(pts, t0);
    const inside = pts.filter((p) => p.atMs > t0);
    return atStart != null ? [{ atMs: t0, value: atStart }, ...inside] : inside;
  };
  const clipCurve = (pts: SeriesPoint[]) => pts.filter((p) => p.atMs >= t0);
  const shown = {
    c: clipStep(series.c), m: clipStep(series.m), x: clipStep(series.x), proton: clipStep(series.proton),
    area: clipStep(series.area), spots: clipStep(series.spots),
    flux: clipCurve(series.flux), fieldArea: clipCurve(series.fieldArea),
  };
  const anything = Object.values(shown).some((s) => s.length >= 2);
  const common = { t0, t1, hoverMs, onHover: setHoverMs, markerMs };
  const pct = (v: number) => `${Math.round(v)}%`;

  return (
    <div className="mt-3 pt-2.5 border-t border-neutral-800">
      <div className="flex justify-between items-baseline mb-1.5">
        <span className="text-xs text-neutral-500">Region history</span>
        <span className="text-xs font-semibold text-neutral-100">{history ? trend.label : 'Loading...'}</span>
      </div>

      {anything ? (
        <>
          <p className="text-[10px] uppercase tracking-wide text-neutral-600 mb-1">Flare chances · NOAA</p>
          <div className="space-y-1.5">
            <LevelChart points={shown.c} scale={SCALES.c} label="C-class" format={pct} step range={[0, 100]} {...common} />
            <LevelChart points={shown.m} scale={SCALES.m} label="M-class" format={pct} step range={[0, 100]} {...common} />
            <LevelChart points={shown.x} scale={SCALES.x} label="X-class" format={pct} step range={[0, 100]} {...common} />
            <LevelChart points={shown.proton} scale={SCALES.proton} label="Proton" format={pct} step range={[0, 100]} {...common} />
          </div>

          <p className="text-[10px] uppercase tracking-wide text-neutral-600 mt-2.5 mb-1">Sunspots · NOAA</p>
          <div className="space-y-1.5">
            <LevelChart points={shown.area} scale={SCALES.area} label="Sunspot area" step fromZero
                        format={(v) => `${Math.round(v)} MSH`} {...common} />
            <LevelChart points={shown.spots} scale={SCALES.spots} label="Number of spots" step fromZero
                        format={(v) => `${Math.round(v)}`} {...common} />
          </div>

          <p className="text-[10px] uppercase tracking-wide text-neutral-600 mt-2.5 mb-1">Magnetic field · SDO/HMI, hourly</p>
          <div className="space-y-1.5">
            <LevelChart points={shown.flux} scale={SCALES.flux} label="Magnetic flux"
                        format={(v) => `${(v / 1e21).toFixed(1)} ×10²¹ Mx`} {...common} />
            <LevelChart points={shown.fieldArea} scale={SCALES.fieldArea} label="Magnetised area"
                        format={(v) => `${Math.round(v)} μH`} {...common} />
          </div>

          <div className="flex justify-between text-[10px] text-neutral-500 mt-1">
            <span>{windowHours < 48 ? `${windowHours}h ago` : `${windowHours / 24}d ago`}</span>
            {hoverMs != null ? (
              <button type="button" onClick={() => setHoverMs(null)} className="text-neutral-200 hover:text-white">
                {fmtNzShort(hoverMs)} <span className="text-neutral-500">✕</span>
              </button>
            ) : <span className="text-neutral-600">Touch a chart to read it</span>}
            <span>now</span>
          </div>
          {series.hmi.length >= 2 && <p className="text-[11px] text-neutral-400 leading-relaxed mt-1.5">{trend.note}</p>}
          <p className="text-[10px] text-neutral-600 mt-1">
            NOAA's numbers change once or twice a day and hold until the next report. Magnetised area counts all
            the strong field, not just the dark spots, so it runs several times larger than NOAA's sunspot area.
          </p>
        </>
      ) : (
        <p className="text-[11px] text-neutral-500">
          {history ? 'No history for this region yet. Newly numbered regions take a few hours to appear.' : 'Loading...'}
        </p>
      )}
    </div>
  );
};

export default RegionMagneticHistory;
