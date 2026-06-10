import React, { useMemo, useState } from 'react';

const STEREO_BEACON_BASE = 'https://stereo-ssc.nascom.nasa.gov/beacon';
const MAX_GUIDE_AU = 1.5;

interface StereoJPlotInfo {
  key: string;
  label: string;
  title: string;
  description: string;
  fileName: string;
  startAu: number;
  endAu: number;
  earthRemainingAu: number;
  nominalRange: string;
  color: string;
  fill: string;
}

const STEREO_JPLOTS: StereoJPlotInfo[] = [
  {
    key: 'hi1',
    label: 'HI1',
    title: 'STEREO-A HI1 J-plot',
    description: 'Inner heliosphere view for following material after it leaves the coronagraph field and before it enters the wider HI2 plot.',
    fileName: 'jplot_hi1_ahead_090.gif',
    startAu: 0.056,
    endAu: 0.391,
    earthRemainingAu: 0.609,
    nominalRange: '12–84 R☉',
    color: '#38bdf8',
    fill: 'rgba(56, 189, 248, 0.26)',
  },
  {
    key: 'hi2',
    label: 'HI2',
    title: 'STEREO-A HI2 J-plot',
    description: 'Wide heliospheric view for following structures across Earth-orbit distances along the Sun–Earth line.',
    fileName: 'jplot_hi2_ahead_090.gif',
    startAu: 0.307,
    endAu: 1.479,
    earthRemainingAu: 0,
    nominalRange: '66–318 R☉',
    color: '#a78bfa',
    fill: 'rgba(167, 139, 250, 0.24)',
  },
  {
    key: 'cor2',
    label: 'COR2',
    title: 'STEREO-A COR2 west J-plot',
    description: 'Near-Sun coronagraph view for the first outward motion before the CME front reaches the HI fields.',
    fileName: 'jplot_cor2_ahead_west_090.gif',
    startAu: 0.012,
    endAu: 0.070,
    earthRemainingAu: 0.930,
    nominalRange: '2.5–15 R☉',
    color: '#f59e0b',
    fill: 'rgba(245, 158, 11, 0.28)',
  },
];

const directImageUrl = (plot: StereoJPlotInfo) => `${STEREO_BEACON_BASE}/${plot.fileName}`;
const proxiedImageUrl = (plot: StereoJPlotInfo, refreshKey: number) =>
  `/api/proxy/image?ttl=300&url=${encodeURIComponent(directImageUrl(plot))}&v=${refreshKey}`;
const formatAu = (value: number) => `${value.toFixed(3)} AU`;
const xForAu = (value: number) => 72 + (Math.min(value, MAX_GUIDE_AU) / MAX_GUIDE_AU) * 548;

const StereoFovGuide: React.FC<{ selected: StereoJPlotInfo }> = ({ selected }) => {
  const sunX = xForAu(0);
  const earthX = xForAu(1);
  const stereoX = xForAu(0.96);
  const selectedStart = xForAu(selected.startAu);
  const selectedEnd = xForAu(selected.endAu);

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="font-semibold text-neutral-200">Sun–Earth field of view</p>
        <span className="text-[11px] text-neutral-500">Selected: {selected.label}</span>
      </div>
      <svg viewBox="0 0 680 270" role="img" aria-label="Sun, Earth, STEREO-A and instrument field of view ranges" className="w-full h-auto overflow-visible">
        <defs>
          <radialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fde68a" />
            <stop offset="55%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#7c2d12" />
          </radialGradient>
          <radialGradient id="earthGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#bfdbfe" />
            <stop offset="58%" stopColor="#2563eb" />
            <stop offset="100%" stopColor="#0f172a" />
          </radialGradient>
          <filter id="softGlow">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect x="0" y="0" width="680" height="270" rx="12" fill="rgba(2, 6, 23, 0.52)" />
        <line x1={sunX} y1="138" x2={xForAu(MAX_GUIDE_AU)} y2="138" stroke="#334155" strokeWidth="2" />
        {[0, 0.25, 0.5, 0.75, 1, 1.25, 1.5].map(tick => (
          <g key={tick}>
            <line x1={xForAu(tick)} y1="128" x2={xForAu(tick)} y2="148" stroke={tick === 1 ? '#60a5fa' : '#475569'} strokeWidth={tick === 1 ? 2 : 1} />
            <text x={xForAu(tick)} y="170" textAnchor="middle" fill={tick === 1 ? '#93c5fd' : '#64748b'} fontSize="11">{tick.toFixed(tick === 0 ? 0 : 2)} AU</text>
          </g>
        ))}

        <path d={`M ${stereoX} 96 Q ${earthX + 36} 112 ${earthX} 138`} fill="none" stroke="#64748b" strokeWidth="1.5" strokeDasharray="4 5" />
        <circle cx={sunX} cy="138" r="22" fill="url(#sunGlow)" filter="url(#softGlow)" />
        <text x={sunX} y="198" textAnchor="middle" fill="#fbbf24" fontSize="12" fontWeight="600">Sun</text>
        <circle cx={earthX} cy="138" r="14" fill="url(#earthGlow)" filter="url(#softGlow)" />
        <text x={earthX} y="198" textAnchor="middle" fill="#93c5fd" fontSize="12" fontWeight="600">Earth</text>
        <g transform={`translate(${stereoX} 82)`}>
          <rect x="-13" y="-8" width="26" height="16" rx="3" fill="#1f2937" stroke="#a78bfa" />
          <path d="M -22 -6 L -13 -2 M -22 6 L -13 2 M 13 -2 L 22 -6 M 13 2 L 22 6" stroke="#a78bfa" strokeWidth="2" />
          <text x="0" y="-17" textAnchor="middle" fill="#c4b5fd" fontSize="11" fontWeight="600">STEREO-A</text>
        </g>

        {STEREO_JPLOTS.map((plot, index) => {
          const y = 64 + index * 30;
          const startX = xForAu(plot.startAu);
          const endX = xForAu(plot.endAu);
          const active = plot.key === selected.key;
          return (
            <g key={plot.key} opacity={active ? 1 : 0.46}>
              <line x1={startX} y1={y} x2={endX} y2={y} stroke={plot.color} strokeWidth={active ? 12 : 8} strokeLinecap="round" />
              <rect x={startX} y={y - (active ? 13 : 9)} width={Math.max(3, endX - startX)} height={active ? 26 : 18} rx="7" fill={plot.fill} stroke={active ? plot.color : 'transparent'} />
              <line x1={startX} y1={y - 16} x2={startX} y2="138" stroke={plot.color} strokeWidth="1" strokeDasharray="3 5" />
              <line x1={endX} y1={y - 16} x2={endX} y2="138" stroke={plot.color} strokeWidth="1" strokeDasharray="3 5" />
              <text x="18" y={y + 4} fill={active ? '#e5e7eb' : '#94a3b8'} fontSize="12" fontWeight={active ? 700 : 500}>{plot.label}</text>
              <text x={Math.min(628, endX + 8)} y={y + 4} fill={plot.color} fontSize="11">{formatAu(plot.startAu)}–{formatAu(plot.endAu)}</text>
            </g>
          );
        })}

        <path d={`M ${selectedStart} 216 L ${selectedEnd} 216`} stroke={selected.color} strokeWidth="7" strokeLinecap="round" />
        <text x={(selectedStart + selectedEnd) / 2} y="240" textAnchor="middle" fill="#d4d4d8" fontSize="12">
          {selected.label} is the highlighted distance band shown in the selected J-plot
        </text>
      </svg>
    </div>
  );
};

const StereoJPlotsPanel: React.FC = () => {
  const [selectedKey, setSelectedKey] = useState(STEREO_JPLOTS[0].key);
  const [refreshKey, setRefreshKey] = useState(() => Date.now());
  const [useProxy, setUseProxy] = useState(true);
  const [imageFailed, setImageFailed] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  const selected = useMemo(
    () => STEREO_JPLOTS.find(plot => plot.key === selectedKey) ?? STEREO_JPLOTS[0],
    [selectedKey],
  );
  const selectedSrc = useProxy ? proxiedImageUrl(selected, refreshKey) : `${directImageUrl(selected)}?v=${refreshKey}`;

  const handleSelect = (key: string) => {
    setSelectedKey(key);
    setUseProxy(true);
    setImageFailed(false);
  };

  return (
    <div id="stereo-jplots-section" className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold text-white">STEREO Beacon J-plots</h2>
            <span className="rounded-full border border-neutral-700/80 bg-neutral-800/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
              STEREO-A
            </span>
          </div>
          <p className="text-xs text-neutral-500 mt-0.5">
            NASA beacon Sun→Earth J-plots for following outward-moving CME structure after an EPAM particle rise.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-600 hidden sm:inline">Source: NASA STEREO/SECCHI</span>
          <button
            onClick={() => { setRefreshKey(Date.now()); setUseProxy(true); setImageFailed(false); }}
            className="p-1.5 rounded-full text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors"
            title="Refresh STEREO J-plots"
          >
            ↻
          </button>
        </div>
      </div>

      <div className="flex justify-center gap-2 mb-4 flex-wrap">
        {STEREO_JPLOTS.map(plot => (
          <button
            key={plot.key}
            onClick={() => handleSelect(plot.key)}
            className={`px-3 py-1 text-xs rounded transition-colors ${selected.key === plot.key ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600 text-neutral-300'}`}
          >
            {plot.label}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-neutral-200">{selected.title}</p>
          <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">{selected.description}</p>
        </div>
        <button
          onClick={() => setShowGuide(v => !v)}
          className="self-start px-3 py-1 text-xs rounded border border-neutral-700 bg-neutral-800/70 text-neutral-300 hover:bg-neutral-700 transition-colors"
          aria-expanded={showGuide}
          aria-controls="stereo-fov-guide"
        >
          {showGuide ? 'Hide FOV guide' : 'Show FOV guide'}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="relative bg-neutral-900/40 rounded-lg p-2 border border-neutral-800/80 overflow-x-auto">
          {!imageFailed ? (
            <a href={directImageUrl(selected)} target="_blank" rel="noopener noreferrer" title={`Open ${selected.title} at NASA`}>
              <img
                key={`${selected.key}-${refreshKey}-${useProxy ? 'proxy' : 'direct'}`}
                src={selectedSrc}
                alt={`${selected.title} from NASA STEREO beacon`}
                className="block min-w-[680px] w-full h-auto rounded bg-black object-contain"
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => {
                  if (useProxy) {
                    setUseProxy(false);
                    return;
                  }
                  setImageFailed(true);
                }}
              />
            </a>
          ) : (
            <div className="min-h-[320px] min-w-[680px] rounded bg-neutral-900/80 border border-neutral-800 flex flex-col items-center justify-center text-center p-6">
              <p className="text-sm font-semibold text-neutral-200">STEREO image could not be loaded</p>
              <p className="text-xs text-neutral-500 mt-1 max-w-md">The app proxy and direct NASA image both failed. You can still open the source GIF directly from NASA.</p>
              <a href={directImageUrl(selected)} target="_blank" rel="noopener noreferrer" className="mt-3 px-3 py-1 text-xs rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-200 transition-colors">Open NASA GIF</a>
            </div>
          )}
          {useProxy && !imageFailed && (
            <div className="absolute right-3 top-3 rounded bg-black/70 border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300">
              using app proxy
            </div>
          )}
        </div>

        <div id="stereo-fov-guide" className="space-y-3 text-xs text-neutral-400">
          {showGuide ? (
            <StereoFovGuide selected={selected} />
          ) : (
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
              <p className="font-semibold text-neutral-200">Field-of-view guide hidden</p>
              <p className="text-neutral-500 mt-1">Open it to see where COR2, HI1, and HI2 sit between the Sun, STEREO-A, and Earth.</p>
            </div>
          )}
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
            <p className="font-semibold text-neutral-200 mb-1">Selected range</p>
            <div className="h-2 rounded-full bg-neutral-800 overflow-hidden mb-2">
              <div
                className="h-full rounded-full"
                style={{
                  marginLeft: `${(selected.startAu / MAX_GUIDE_AU) * 100}%`,
                  width: `${((Math.min(selected.endAu, MAX_GUIDE_AU) - selected.startAu) / MAX_GUIDE_AU) * 100}%`,
                  backgroundColor: selected.color,
                }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-neutral-500">
              <span>Sun</span>
              <span>Earth · 1 AU</span>
              <span>1.5 AU</span>
            </div>
          </div>
          <p className="text-neutral-600 leading-relaxed">
            Images load through the app proxy first for CORS support, then retry direct from NASA if the proxy is unavailable.
          </p>
        </div>
      </div>
    </div>
  );
};

export default StereoJPlotsPanel;
