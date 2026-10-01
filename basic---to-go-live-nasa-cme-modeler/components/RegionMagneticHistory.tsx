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

const DAY = 86400000;

const fmtNzShort = (ms: number) => new Date(ms).toLocaleString('en-NZ', {
  timeZone: 'Pacific/Auckland', weekday: 'short', day: 'numeric', hour: 'numeric', hour12: true,
});

/** One chart: the line in level colours, with the matching fill under it. */
const LevelChart: React.FC<{
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

  const shownMs = hoverMs ?? (hasData ? points[points.length - 1].atMs : null);
  const shown = shownMs != null ? valueAt(points, shownMs) : null;

  const pieces: React.ReactNode[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const x0 = x(a.atMs), x1 = x(b.atMs);
    if (step) {
      // Held at a's value until b: coloured by a. Then the step to b.
      const ya = y(a.value), yb = y(b.value);
      pieces.push(
        <path key={`f${i}`} d={`M${x0},${ya} L${x1},${ya} L${x1},${H} L${x0},${H} Z`} fill={colourOf(a.value, scale, 0.2)} />,
        <line key={`h${i}`} x1={x0} y1={ya} x2={x1} y2={ya} stroke={colourOf(a.value, scale)} strokeWidth="1.75" vectorEffect="non-scaling-stroke" />,
        <line key={`v${i}`} x1={x1} y1={ya} x2={x1} y2={yb} stroke={colourOf(b.value, scale)} strokeWidth="1.75" vectorEffect="non-scaling-stroke" />,
      );
    } else {
      // As the X-ray chart: each stretch coloured by where it ends.
      const ya = y(a.value), yb = y(b.value);
      pieces.push(
        // Overlapped a touch, so neighbouring slices leave no seam.
        <path key={`f${i}`} d={`M${x0 - 0.3},${ya} L${x1 + 0.3},${yb} L${x1 + 0.3},${H} L${x0 - 0.3},${H} Z`} fill={colourOf(b.value, scale, 0.2)} />,
        <line key={`l${i}`} x1={x0} y1={ya} x2={x1} y2={yb} stroke={colourOf(b.value, scale)} strokeWidth="1.75" strokeLinecap="round" vectorEffect="non-scaling-stroke" />,
      );
    }
  }

  return (
    <div>
      <div className="flex justify-between text-[10px] mb-0.5">
        <span className="text-neutral-500">{label}</span>
        <span className="font-mono font-semibold" style={{ color: shown != null ? colourOf(shown, scale) : '#737373' }}>
          {shown != null ? format(shown) : 'No data'}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full cursor-crosshair"
        style={{ height: H }}
        preserveAspectRatio="none"
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          onHover(t0 + ((e.clientX - rect.left) / rect.width) * (t1 - t0));
        }}
        onPointerLeave={() => onHover(null)}
      >
        <rect x={0} y={0} width={W} height={H} fill="rgba(255,255,255,0.02)" />
        {pieces}
        {markerMs != null && markerMs >= t0 && markerMs <= t1 && (
          <line x1={x(markerMs)} y1={0} x2={x(markerMs)} y2={H}
                stroke="#fbbf24" strokeWidth="1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
        )}
        {hoverMs != null && (
          <line x1={x(hoverMs)} y1={0} x2={x(hoverMs)} y2={H}
                stroke="#e5e5e5" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
    </div>
  );
};

const RegionMagneticHistory: React.FC<{
  region: string;
  /** The region's record from the sunspot-history worker, if it has one. */
  record?: RegionRecord | null;
  /** The scrubber's moment, marked on every chart; null on the live frame. */
  markerMs?: number | null;
}> = ({ region, record = null, markerMs = null }) => {
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
  const now = Date.now();

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
    // `now` moves every render; the series only need rebuilding when the data does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec, history, region]);

  const trend = useMemo(() => fluxTrend(series.hmi.map((p) => ({ ...p, latitude: null, longitude: null }))), [series]);

  const all = [series.c, series.m, series.x, series.proton, series.area, series.spots, series.flux, series.fieldArea];
  const firstMs = Math.min(...all.filter((s) => s.length).map((s) => s[0].atMs));
  const t1 = now;
  const t0 = Number.isFinite(firstMs) ? Math.max(firstMs, now - 14 * DAY) : now - DAY;
  const anything = all.some((s) => s.length >= 2);
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
            <LevelChart points={series.c} scale={SCALES.c} label="C-class" format={pct} step range={[0, 100]} {...common} />
            <LevelChart points={series.m} scale={SCALES.m} label="M-class" format={pct} step range={[0, 100]} {...common} />
            <LevelChart points={series.x} scale={SCALES.x} label="X-class" format={pct} step range={[0, 100]} {...common} />
            <LevelChart points={series.proton} scale={SCALES.proton} label="Proton" format={pct} step range={[0, 100]} {...common} />
          </div>

          <p className="text-[10px] uppercase tracking-wide text-neutral-600 mt-2.5 mb-1">Sunspots · NOAA</p>
          <div className="space-y-1.5">
            <LevelChart points={series.area} scale={SCALES.area} label="Sunspot area" step fromZero
                        format={(v) => `${Math.round(v)} MSH`} {...common} />
            <LevelChart points={series.spots} scale={SCALES.spots} label="Number of spots" step fromZero
                        format={(v) => `${Math.round(v)}`} {...common} />
          </div>

          <p className="text-[10px] uppercase tracking-wide text-neutral-600 mt-2.5 mb-1">Magnetic field · SDO/HMI, hourly</p>
          <div className="space-y-1.5">
            <LevelChart points={series.flux} scale={SCALES.flux} label="Magnetic flux"
                        format={(v) => `${(v / 1e21).toFixed(1)} ×10²¹ Mx`} {...common} />
            <LevelChart points={series.fieldArea} scale={SCALES.fieldArea} label="Magnetised area"
                        format={(v) => `${Math.round(v)} μH`} {...common} />
          </div>

          <div className="flex justify-between text-[10px] text-neutral-500 mt-1">
            <span>{fmtNzShort(t0)}</span>
            <span>{hoverMs != null ? fmtNzShort(hoverMs) : ''}</span>
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
