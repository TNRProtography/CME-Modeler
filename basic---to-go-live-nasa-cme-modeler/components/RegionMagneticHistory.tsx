// A sunspot region's magnetic flux and area over the last three days, from
// SDO/HMI SHARPs - hourly, where NOAA's own history is one number a day.
//
// Flux is the headline because it is the quantity that says something: new
// field emerging through the surface is what builds up to a flare, and it
// shows in the flux curve hours before it shows in the spot count.

import React, { useEffect, useMemo, useState } from 'react';
import { fetchSharpHistory, fluxTrend, regionKey, type SharpHistoryPoint } from '../utils/sharpPositions';

const fmtNzShort = (ms: number) => new Date(ms).toLocaleString('en-NZ', {
  timeZone: 'Pacific/Auckland', weekday: 'short', hour: 'numeric', hour12: true,
});

/** A plain line with a light fill, and a crosshair where the pointer is. */
const Spark: React.FC<{
  points: SharpHistoryPoint[];
  value: (p: SharpHistoryPoint) => number;
  hoverIndex: number | null;
  onHover: (i: number | null) => void;
  label: string;
  format: (v: number) => string;
  strong?: boolean;
}> = ({ points, value, hoverIndex, onHover, label, format, strong }) => {
  const W = 220, H = strong ? 40 : 26, PAD = 2;
  const values = points.map(value);
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = Math.max(hi - lo, hi * 0.02, 1e-9);
  const t0 = points[0].atMs, t1 = points[points.length - 1].atMs;
  const x = (ms: number) => PAD + ((ms - t0) / Math.max(1, t1 - t0)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - lo) / span) * (H - PAD * 2);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.atMs).toFixed(1)},${y(value(p)).toFixed(1)}`).join(' ');
  const shown = hoverIndex != null ? points[hoverIndex] : points[points.length - 1];
  const stroke = strong ? '#38bdf8' : '#a3a3a3';

  return (
    <div>
      <div className="flex justify-between text-[10px] mb-0.5">
        <span className="text-neutral-500">{label}</span>
        <span className={`font-mono ${strong ? 'text-neutral-100' : 'text-neutral-300'}`}>{format(value(shown))}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full cursor-crosshair"
        style={{ height: H }}
        preserveAspectRatio="none"
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const wanted = t0 + ((e.clientX - rect.left) / rect.width) * (t1 - t0);
          let best = 0;
          for (let i = 1; i < points.length; i++) {
            if (Math.abs(points[i].atMs - wanted) < Math.abs(points[best].atMs - wanted)) best = i;
          }
          onHover(best);
        }}
        onPointerLeave={() => onHover(null)}
      >
        <path d={`${d} L${x(t1)},${H} L${x(t0)},${H} Z`} fill={strong ? 'rgba(56,189,248,0.12)' : 'rgba(163,163,163,0.10)'} />
        <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        {hoverIndex != null && (
          <line x1={x(points[hoverIndex].atMs)} y1={0} x2={x(points[hoverIndex].atMs)} y2={H}
                stroke="#e5e5e5" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
    </div>
  );
};

const RegionMagneticHistory: React.FC<{ region: string }> = ({ region }) => {
  const [history, setHistory] = useState<Map<string, SharpHistoryPoint[]> | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSharpHistory().then((h) => { if (!cancelled) setHistory(h); });
    return () => { cancelled = true; };
  }, []);

  const points = useMemo(() => history?.get(regionKey(region)) ?? [], [history, region]);
  const trend = useMemo(() => fluxTrend(points), [points]);
  useEffect(() => setHoverIndex(null), [region]);

  return (
    <div className="mt-3 pt-2.5 border-t border-neutral-800">
      <div className="flex justify-between items-baseline mb-1.5">
        <span className="text-xs text-neutral-500">Magnetic history · HMI</span>
        <span className="text-xs font-semibold text-neutral-100">{history ? trend.label : 'Loading...'}</span>
      </div>

      {history && points.length >= 2 ? (
        <>
          <div className="space-y-1.5">
            <Spark points={points} value={(p) => p.usfluxMx} hoverIndex={hoverIndex} onHover={setHoverIndex}
                   label="Magnetic flux" strong
                   format={(v) => `${(v / 1e21).toFixed(1)} ×10²¹ Mx`} />
            <Spark points={points} value={(p) => p.areaMh} hoverIndex={hoverIndex} onHover={setHoverIndex}
                   label="Magnetised area" format={(v) => `${Math.round(v)} μH`} />
          </div>
          <div className="flex justify-between text-[10px] text-neutral-500 mt-0.5">
            <span>{fmtNzShort(points[0].atMs)}</span>
            <span>{hoverIndex != null ? fmtNzShort(points[hoverIndex].atMs) : ''}</span>
            <span>{fmtNzShort(points[points.length - 1].atMs)}</span>
          </div>
          <p className="text-[11px] text-neutral-400 leading-relaxed mt-1.5">{trend.note}</p>
          <p className="text-[10px] text-neutral-600 mt-1">
            Hourly, from SDO's magnetograms. Magnetised area counts all the strong field, not just the dark
            spots, so it runs several times larger than NOAA's sunspot area and the two are not comparable.
          </p>
        </>
      ) : history ? (
        <p className="text-[11px] text-neutral-500">
          HMI has no patch for this region in the last three days yet. Newly numbered regions take a few hours
          to appear.
        </p>
      ) : null}
    </div>
  );
};

export default RegionMagneticHistory;
