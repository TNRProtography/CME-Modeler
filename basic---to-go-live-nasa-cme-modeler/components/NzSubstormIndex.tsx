import React, { useCallback, useMemo, useRef, useState } from 'react';
import { CHART_LOOKBACK_HOURS, NzTown, useNzSubstormIndexData } from './nzSubstormIndexData';

type CelestialTimes = {
  sun?: { rise: number | null; set: number | null };
  moon?: { illumination?: number };
};

interface NzSubstormIndexProps {
  celestialTimes?: CelestialTimes;
  isDaylight?: boolean;
}

const NzSubstormIndex: React.FC<NzSubstormIndexProps> = ({ celestialTimes, isDaylight }) => {
  const { data, loading } = useNzSubstormIndexData();
  const [chartRange, setChartRange] = useState(CHART_LOOKBACK_HOURS);
  const [hoverData, setHoverData] = useState<any>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const forecastText = useMemo(() => {
    if (!data) return '';
    const now = Date.now();
    const sunrise = celestialTimes?.sun?.rise ?? null;
    const sunset = celestialTimes?.sun?.set ?? null;
    const darkBuffer = 90 * 60 * 1000;
    const darkEnough = sunset && sunrise
      ? (now >= sunset - darkBuffer || now <= sunrise + darkBuffer)
      : !isDaylight;
    const moonIllumination = celestialTimes?.moon?.illumination ?? null;
    const moonNote = moonIllumination !== null
      ? moonIllumination >= 75
        ? 'The moon is bright, so faint glows will be harder to pick out.'
        : moonIllumination >= 40
        ? 'The moon is moderate, so contrast will be a little reduced.'
        : 'The moon is dim, so the sky should stay nice and dark.'
      : 'Moonlight data is unavailable, so plan for darker skies just in case.';

    const { bz, speed } = data.solarWind;
    const solarNote = bz < -10 && speed > 500
      ? `Solar wind is primed (Bz ${bz.toFixed(1)} nT, ${Math.round(speed)} km/s) for a strong response.`
      : bz < -5
      ? `Solar wind is favorable (Bz ${bz.toFixed(1)} nT, ${Math.round(speed)} km/s).`
      : `Solar wind is mostly quiet (Bz ${bz.toFixed(1)} nT, ${Math.round(speed)} km/s).`;

    const magnitude = Math.abs(data.strength);
    const sizeLabel = magnitude >= 1500 ? 'major' : magnitude >= 800 ? 'strong' : magnitude >= 450 ? 'moderate' : 'minor';

    const pickTown = (towns: NzTown[], key: 'eye' | 'phone' | 'cam') => {
      const matches = towns.filter((t) => t[key]);
      if (matches.length === 0) return null;
      return matches.sort((a, b) => b.lat - a.lat)[0];
    };
    const bestTown =
      pickTown(data.towns, 'eye') ||
      pickTown(data.towns, 'phone') ||
      pickTown(data.towns, 'cam');

    const visibilityLine = bestTown
      ? `Best odds are around ${bestTown.name} right now.`
      : 'No towns are in range yet—expect activity to remain south of New Zealand.';

    const lightLine = darkEnough
      ? 'It is dark enough to observe.'
      : 'It is still too bright right now—check back closer to darkness.';

    return `${lightLine} A ${sizeLabel} burst is possible based on current ground activity. ${solarNote} ${moonNote} ${visibilityLine}`;
  }, [data, celestialTimes, isDaylight]);
  const handleMouseMove = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!data || !chartRef.current) return;
      const rect = chartRef.current.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
      const x = clientX - rect.left;
      const w = rect.width;

      const now = Date.now();
      const cutoff = now - chartRange * 3600 * 1000;
      const activePoints = data.points.filter((p: any) => p.t >= cutoff);
      if (activePoints.length === 0) return;

      const ratio = x / w;
      const tMin = activePoints[0].t;
      const tMax = activePoints[activePoints.length - 1].t;
      const timeAtCursor = tMin + ratio * (tMax - tMin);

      let closest = activePoints[0];
      let minDiff = Math.abs(timeAtCursor - closest.t);
      for (let i = 1; i < activePoints.length; i++) {
        const diff = Math.abs(timeAtCursor - activePoints[i].t);
        if (diff < minDiff) {
          minDiff = diff;
          closest = activePoints[i];
        }
      }
      setHoverData({ x, closest });
    },
    [data, chartRange]
  );

  if (loading) return <div className="h-64 flex items-center justify-center text-neutral-500">Initializing NZ Ground Systems...</div>;
  if (!data) return <div className="h-64 flex items-center justify-center text-red-400">System Offline</div>;

  const activePoints = data.points.filter((p: any) => p.t >= Date.now() - chartRange * 3600 * 1000);
  const vals = activePoints.map((p: any) => p.v);
  let vMin = Math.min(...vals);
  let vMax = Math.max(...vals);
  if (vMax < 1000) vMax = 1000;
  if (vMin > -1000) vMin = -1000;
  const range = vMax - vMin;
  vMax += range * 0.1;
  vMin -= range * 0.1;

  const getX = (t: number) =>
    ((t - activePoints[0].t) / (activePoints[activePoints.length - 1].t - activePoints[0].t)) * 100;
  const getY = (v: number) => 100 - ((v - vMin) / (vMax - vMin)) * 100;

  let pathD = '';
  if (activePoints.length > 0) {
    pathD = `M ${getX(activePoints[0].t)} ${getY(activePoints[0].v)} ` +
      activePoints.map((p: any) => `L ${getX(p.t)} ${getY(p.v)}`).join(' ');
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-4 bg-neutral-950 p-4 rounded-xl border border-neutral-800">
      <div className="md:col-span-12 flex flex-col md:flex-row md:justify-between md:items-center pb-2 border-b border-neutral-800 gap-2">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <span className="text-sky-400">SPOT THE AURORA</span> / NZ SUBSTORM INDEX
        </h2>
        <div className="text-xs text-neutral-500">
          GeoNet Magnetometers ({data.stationCount} stations) + RTSW
          {data.lastUpdated && (
            <span className="block md:inline md:ml-2">Updated {new Date(data.lastUpdated).toLocaleTimeString()}</span>
          )}
        </div>
      </div>

      <div className="md:col-span-4 bg-neutral-900/50 rounded-lg p-6 flex flex-col justify-center items-center relative overflow-hidden border border-neutral-800">
        <div className="text-sm font-bold text-neutral-400 uppercase tracking-widest mb-2">Current Activity</div>
        <div
          className="text-6xl font-black text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]"
          style={{ color: data.strength < -1500 ? '#ef4444' : data.strength < -800 ? '#facc15' : '#e5e5e5' }}
        >
          {Math.round(data.strength)}
        </div>
        <div className="mt-4 flex gap-2">
          <span className="px-3 py-1 bg-neutral-800 rounded-full text-xs font-bold text-white border border-neutral-700">
            {data.strength < -1500 ? 'SEVERE' : data.strength < -800 ? 'STRONG' : data.strength < -450 ? 'ACTIVE' : 'QUIET'}
          </span>
          <span className="px-3 py-1 bg-neutral-800 rounded-full text-xs font-bold text-neutral-300 border border-neutral-700">
            Slope: {data.slope.toFixed(1)}/min
          </span>
        </div>
        <div className="mt-6 p-3 bg-sky-900/20 border border-sky-500/30 rounded text-sm text-sky-100 text-center">
          {forecastText}
        </div>
      </div>

      <div className="md:col-span-8 bg-neutral-900/50 rounded-lg p-4 border border-neutral-800 relative">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xs font-bold text-neutral-400 uppercase">24 Hour History</h3>
          <div className="flex gap-1">
            {[1, 3, 6, 12, 24].map((h) => (
              <button
                key={h}
                onClick={() => setChartRange(h)}
                className={`px-2 py-1 text-xs rounded font-bold transition-colors ${
                  chartRange === h ? 'bg-sky-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                }`}
              >
                {h}H
              </button>
            ))}
          </div>
        </div>

        <div
          ref={chartRef}
          className="w-full h-[200px] bg-black/20 rounded relative cursor-crosshair overflow-hidden"
          onMouseMove={handleMouseMove}
          onTouchMove={handleMouseMove}
          onMouseLeave={() => setHoverData(null)}
          onTouchEnd={() => setHoverData(null)}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
            <line x1="0" y1="50" x2="100" y2="50" stroke="#333" strokeWidth="0.5" />
            <line x1="0" y1="25" x2="100" y2="25" stroke="#222" strokeWidth="0.5" strokeDasharray="2" />
            <line x1="0" y1="75" x2="100" y2="75" stroke="#222" strokeWidth="0.5" strokeDasharray="2" />
            <path
              d={pathD}
              fill="none"
              stroke={data.strength < -450 ? '#facc15' : '#e5e5e5'}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {hoverData && (
            <>
              <div className="absolute top-0 bottom-0 w-px bg-white/20 pointer-events-none" style={{ left: hoverData.x }} />
              <div
                className="absolute top-2 bg-neutral-900/90 border border-neutral-700 p-2 rounded text-xs text-white pointer-events-none z-10 whitespace-nowrap shadow-lg"
                style={{ left: hoverData.x > 300 ? hoverData.x - 120 : hoverData.x + 10 }}
              >
                <div className="font-bold">{new Date(hoverData.closest.t).toLocaleTimeString()}</div>
                <div style={{ color: hoverData.closest.v < -450 ? '#facc15' : '#ccc' }}>
                  {Math.round(hoverData.closest.v)} nT
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default NzSubstormIndex;
