import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import CloseIcon from './icons/CloseIcon';
import { useCmeEarthArrivals } from '../hooks/useCmeEarthArrivals';
import { jplotCmes, type JplotCme } from '../utils/jplotCmes';

const STEREO_BEACON_BASE = 'https://stereo-ssc.nascom.nasa.gov/beacon';
const SUN_TEXTURE_URL = 'https://upload.wikimedia.org/wikipedia/commons/c/cb/Solarsystemscope_texture_2k_sun.jpg';
const EARTH_TEXTURE_URL = 'https://upload.wikimedia.org/wikipedia/commons/c/c3/Solarsystemscope_texture_2k_earth_daymap.jpg';
const MAX_GUIDE_AU = 1.5;
const GUIDE_LEFT = 92;
const GUIDE_RIGHT = 936;
const GUIDE_WIDTH = GUIDE_RIGHT - GUIDE_LEFT;
const SUN_GUIDE_Y = 154;
const AXIS_Y = 174;
/** CME colours: apart from the imagers' blue and violet and from Earth's blue. */
const CME_COLORS = ['#fb923c', '#f87171', '#facc15', '#f472b6'];
const cmeColor = (index: number) => CME_COLORS[index % CME_COLORS.length];
const NZ_TIME_ZONE = 'Pacific/Auckland';
const formatWhen = (ms: number) => new Date(ms).toLocaleString('en-NZ', {
  timeZone: NZ_TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
});
const formatShortWhen = (ms: number) => new Date(ms).toLocaleString('en-NZ', {
  timeZone: NZ_TIME_ZONE, weekday: 'short', hour: 'numeric', minute: '2-digit',
});
/** "2 days 17 h", "15 h 25 min": never broken between a number and its unit. */
const formatSpan = (ms: number) => {
  const mins = Math.max(0, Math.round(ms / 60000));
  const days = Math.floor(mins / 1440), hours = Math.floor((mins % 1440) / 60), rest = mins % 60;
  if (days > 0) return `${days}\u00a0day${days === 1 ? '' : 's'} ${hours}\u00a0h`;
  if (hours > 0) return `${hours}\u00a0h ${rest}\u00a0min`;
  return `${rest}\u00a0min`;
};

interface InfoModalProps { isOpen: boolean; onClose: () => void; title: string; content: string | React.ReactNode; }
const InfoModal: React.FC<InfoModalProps> = ({ isOpen, onClose, title, content }) => {
  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[9999] flex justify-center items-center p-4" onClick={onClose}>
      <div className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-lg max-h-[85vh] text-neutral-300 flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b border-neutral-700/80">
          <h3 className="text-xl font-bold text-neutral-200">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"><CloseIcon className="w-6 h-6" /></button>
        </div>
        <div className="overflow-y-auto p-5 styled-scrollbar pr-4 text-sm leading-relaxed">
          {typeof content === 'string' ? (<div dangerouslySetInnerHTML={{ __html: content }} />) : (content)}
        </div>
      </div>
    </div>,
    document.body
  );
};


interface StereoJPlotInfo {
  key: string;
  label: string;
  title: string;
  description: string;
  fileName: string;
  startAu: number;
  endAu: number;
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
    nominalRange: '12-84 R☉',
    color: '#38bdf8',
    fill: 'rgba(56, 189, 248, 0.26)',
  },
  {
    key: 'hi2',
    label: 'HI2',
    title: 'STEREO-A HI2 J-plot',
    description: 'Wide heliospheric view for following structures across Earth-orbit distances along the Sun-Earth line.',
    fileName: 'jplot_hi2_ahead_090.gif',
    startAu: 0.307,
    endAu: 1.479,
    nominalRange: '66-318 R☉',
    color: '#a78bfa',
    fill: 'rgba(167, 139, 250, 0.24)',
  },
];

const directImageUrl = (plot: StereoJPlotInfo) => `${STEREO_BEACON_BASE}/${plot.fileName}`;
const proxiedImageUrl = (plot: StereoJPlotInfo, refreshKey: number) =>
  `/api/proxy/image?ttl=300&url=${encodeURIComponent(directImageUrl(plot))}&v=${refreshKey}`;
const formatAu = (value: number) => `${value.toFixed(3)} AU`;
const xForAu = (value: number) => GUIDE_LEFT + (Math.min(value, MAX_GUIDE_AU) / MAX_GUIDE_AU) * GUIDE_WIDTH;

const SelectedRangeBar: React.FC<{ selected: StereoJPlotInfo; cmes: JplotCme[] }> = ({ selected, cmes }) => {
  const startPct = (selected.startAu / MAX_GUIDE_AU) * 100;
  const widthPct = ((Math.min(selected.endAu, MAX_GUIDE_AU) - selected.startAu) / MAX_GUIDE_AU) * 100;
  const earthPct = (1 / MAX_GUIDE_AU) * 100;

  return (
    <div className="mb-4 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between mb-2">
        <p className="text-xs font-semibold text-neutral-200">Selected FOV range · {selected.label}</p>
        <p className="text-[11px] text-neutral-500">{formatAu(selected.startAu)} → {formatAu(selected.endAu)} from the Sun · {selected.nominalRange}</p>
      </div>
      <div className="relative h-5 rounded-full bg-neutral-800/90 overflow-hidden border border-neutral-700/70">
        <div className="absolute inset-y-0 w-px bg-sky-300/80" style={{ left: `${earthPct}%` }} />
        <div className="absolute inset-y-0 rounded-full" style={{ left: `${startPct}%`, width: `${widthPct}%`, backgroundColor: selected.color, boxShadow: `0 0 16px ${selected.color}` }} />
        {cmes.map((cme, index) => (
          <div
            key={cme.id}
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-neutral-950"
            style={{ left: `${(Math.min(cme.distanceAu, MAX_GUIDE_AU) / MAX_GUIDE_AU) * 100}%`, backgroundColor: cmeColor(index) }}
            title={`CME ${index + 1}: ${cme.distanceAu.toFixed(2)} AU from the Sun`}
          />
        ))}
      </div>
      <div className="relative mt-1 h-4 text-[10px] text-neutral-500">
        <span className="absolute left-0">Sun</span>
        <span className="absolute -translate-x-1/2 text-sky-300" style={{ left: `${earthPct}%` }}>Earth · 1 AU</span>
        <span className="absolute right-0">1.5 AU</span>
      </div>
    </div>
  );
};

/**
 * The CMEs on the guide's own Sun-Earth line: the way each has come from the
 * Sun, its front where the CME Visualization has it now, and the rest of the
 * way to Earth.
 */
const GuideCmes: React.FC<{ cmes: JplotCme[] }> = ({ cmes }) => {
  const sunEdge = xForAu(0) + 28;
  const earthX = xForAu(1);
  const next = cmes.findIndex(cme => !cme.arrived);
  const placed = cmes.map((cme, index) => ({ cme, index, color: cmeColor(index), frontX: xForAu(cme.distanceAu) }));
  // The rest of the way to Earth: one line on from the leading front.
  const onTheWay = placed.filter(p => !p.cme.arrived);
  const toGoFrom = onTheWay.length ? Math.max(sunEdge, ...onTheWay.map(p => p.frontX)) : null;
  // Labels share a row unless they would overlap; a second row sits just above.
  const rows: number[][] = [[], []];
  const labelY = placed.map(p => {
    const x = Math.max(200, Math.min(880, p.frontX)); // clear of the Sun
    const row = rows.findIndex(r => r.every(other => Math.abs(other - x) > 150));
    const use = row < 0 ? rows.length - 1 : row;
    rows[use].push(x);
    return { x, y: 142 - use * 18 };
  });
  return (
    <g>
      {toGoFrom != null && toGoFrom < earthX - 18 && (
        <line x1={toGoFrom} y1={AXIS_Y} x2={earthX - 18} y2={AXIS_Y} stroke="#d4d4d4" strokeWidth="3" strokeDasharray="2 7" strokeLinecap="round" opacity="0.45" />
      )}
      {/* The way each has come, furthest first, so a nearer CME's path sits on top. */}
      {[...placed].sort((a, b) => b.frontX - a.frontX).map(p => (
        p.frontX > sunEdge
          ? <line key={p.cme.id} x1={sunEdge} y1={AXIS_Y} x2={p.frontX} y2={AXIS_Y} stroke={p.color} strokeWidth="6" strokeLinecap="round" />
          : null
      ))}
      {placed.map((p, i) => (
        <g key={p.cme.id}>
          <line x1={p.frontX} y1={labelY[i].y + 5} x2={p.frontX} y2={AXIS_Y - 26} stroke={p.color} strokeWidth="1" opacity="0.7" />
          <path d={`M ${p.frontX - 7} ${AXIS_Y - 24} Q ${p.frontX + 13} ${AXIS_Y} ${p.frontX - 7} ${AXIS_Y + 24}`} fill="none" stroke={p.color} strokeWidth="5" strokeLinecap="round" />
          <circle cx={p.frontX} cy={AXIS_Y} r="6" fill={p.color} stroke="#030303" strokeWidth="2" />
          <text x={labelY[i].x} y={labelY[i].y} textAnchor="middle" fill={p.color} fontSize="15" fontWeight="800">
            CME {p.index + 1} · {p.cme.arrived ? 'arrived' : `${p.cme.distanceAu.toFixed(2)} AU`}
          </text>
        </g>
      ))}
      {next >= 0 && (
        <text x={earthX} y="262" textAnchor="middle" fill={cmeColor(next)} fontSize="13" fontWeight="700">
          CME {next + 1} due {formatShortWhen(cmes[next].arrivalMs)}
        </text>
      )}
    </g>
  );
};

const StereoFovGuide: React.FC<{ selected: StereoJPlotInfo; cmes: JplotCme[] }> = ({ selected, cmes }) => {
  const sunX = xForAu(0);
  const earthX = xForAu(1);
  const stereoX = xForAu(0.96);
  const selectedStart = xForAu(selected.startAu);
  const selectedEnd = xForAu(selected.endAu);

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between mb-2">
        <p className="font-semibold text-neutral-200">Sun-Earth field of view</p>
        <span className="text-[11px] text-neutral-500">AU positions are linear; planet icon sizes are illustrative.</span>
      </div>
      <svg viewBox="0 0 1000 320" role="img" aria-label={`Sun, Earth, STEREO-A and instrument field of view ranges on a linear AU scale${cmes.length ? `, with ${cmes.length} CME${cmes.length === 1 ? '' : 's'} on the way to Earth` : ''}`} className="w-full h-auto overflow-visible">
        <defs>
          <clipPath id="stereoGuideSunClip">
            <circle cx={sunX} cy={SUN_GUIDE_Y} r="26" />
          </clipPath>
          <clipPath id="stereoGuideEarthClip">
            <circle cx={earthX} cy="174" r="16" />
          </clipPath>
        </defs>

        <rect x="0" y="0" width="1000" height="320" rx="12" fill="#030303" />
        <line x1={GUIDE_LEFT} y1="174" x2={GUIDE_RIGHT} y2="174" stroke="#262626" strokeWidth="2" />
        <line x1={earthX} y1="48" x2={earthX} y2="262" stroke="#525252" strokeWidth="1.5" strokeDasharray="5 6" />

        {[0, 0.25, 0.5, 0.75, 1, 1.25, 1.5].map(tick => (
          <g key={tick}>
            <line x1={xForAu(tick)} y1="162" x2={xForAu(tick)} y2="186" stroke={tick === 1 ? '#60a5fa' : '#475569'} strokeWidth={tick === 1 ? 2 : 1} />
            <text x={xForAu(tick)} y="207" textAnchor="middle" fill={tick === 1 ? '#93c5fd' : '#64748b'} fontSize="12">{tick.toFixed(tick === 0 ? 0 : 2)} AU</text>
          </g>
        ))}

        <path d={`M ${stereoX} 106 Q ${earthX + 52} 130 ${earthX} 174`} fill="none" stroke="#525252" strokeWidth="1.5" strokeDasharray="4 5" />
        <image href={SUN_TEXTURE_URL} x={sunX - 26} y={SUN_GUIDE_Y - 26} width="52" height="52" preserveAspectRatio="xMidYMid slice" clipPath="url(#stereoGuideSunClip)" />
        <circle cx={sunX} cy={SUN_GUIDE_Y} r="26" fill="none" stroke="#a16207" strokeWidth="1" />
        <text x={sunX} y={SUN_GUIDE_Y + 70} textAnchor="middle" fill="#d4d4d4" fontSize="13" fontWeight="700">Sun</text>
        <image href={EARTH_TEXTURE_URL} x={earthX - 16} y="158" width="32" height="32" preserveAspectRatio="xMidYMid slice" clipPath="url(#stereoGuideEarthClip)" />
        <circle cx={earthX} cy="174" r="16" fill="none" stroke="#737373" strokeWidth="1" />
        <text x={earthX} y="242" textAnchor="middle" fill="#d4d4d4" fontSize="13" fontWeight="700">Earth · 1 AU</text>
        <g transform={`translate(${stereoX} 94)`}>
          <rect x="-16" y="-10" width="32" height="20" rx="3" fill="#1f2937" stroke="#a78bfa" strokeWidth="2" />
          <path d="M -27 -7 L -16 -2 M -27 7 L -16 2 M 16 -2 L 27 -7 M 16 2 L 27 7" stroke="#a78bfa" strokeWidth="2" />
          <text x="0" y="-20" textAnchor="middle" fill="#c4b5fd" fontSize="12" fontWeight="700">STEREO-A</text>
        </g>

        {STEREO_JPLOTS.map((plot, index) => {
          const y = 70 + index * 36;
          const startX = xForAu(plot.startAu);
          const endX = xForAu(plot.endAu);
          const active = plot.key === selected.key;
          return (
            <g key={plot.key} opacity={active ? 1 : 0.38}>
              {active && <rect x={startX - 8} y={y - 20} width={Math.max(18, endX - startX + 16)} height="40" rx="12" fill={plot.fill} stroke={plot.color} strokeWidth="2" />}
              <line x1={startX} y1={y} x2={endX} y2={y} stroke={plot.color} strokeWidth={active ? 15 : 8} strokeLinecap="round" />
              <line x1={startX} y1={y - 23} x2={startX} y2="174" stroke={plot.color} strokeWidth="1" strokeDasharray="3 6" />
              <line x1={endX} y1={y - 23} x2={endX} y2="174" stroke={plot.color} strokeWidth="1" strokeDasharray="3 6" />
              <text x="28" y={y + 5} fill={active ? '#f8fafc' : '#94a3b8'} fontSize="13" fontWeight={active ? 800 : 600}>{plot.label}</text>
              {active && <text x={Math.min(930, endX + 14)} y={y + 5} fill={plot.color} fontSize="12" fontWeight="700">SELECTED</text>}
            </g>
          );
        })}

        <GuideCmes cmes={cmes} />

        <path d={`M ${selectedStart} 284 L ${selectedEnd} 284`} stroke={selected.color} strokeWidth="8" strokeLinecap="round" />
        <text x={(selectedStart + selectedEnd) / 2} y="306" textAnchor="middle" fill="#d4d4d8" fontSize="12">
          {selected.label}: {formatAu(selected.startAu)}-{formatAu(selected.endAu)} from Sun
        </text>
      </svg>
    </div>
  );
};

/** Where in each imager's range a CME's front is, the selected imager first. */
const viewStatus = (cme: JplotCme, selected: StereoJPlotInfo, nowMs: number) =>
  [...cme.views]
    .sort((a, b) => (a.key === selected.key ? -1 : b.key === selected.key ? 1 : 0))
    .map(view => {
      const label = STEREO_JPLOTS.find(plot => plot.key === view.key)?.label ?? view.key;
      const text = view.inViewNow ? `In the ${label} view now`
        : view.enterMs != null && view.enterMs > nowMs ? `Reaches the ${label} view ${formatShortWhen(view.enterMs)}`
        : `Past the ${label} view`;
      return { key: view.key, text, selected: view.key === selected.key };
    });

interface EarthBoundCmesProps {
  cmes: JplotCme[];
  selected: StereoJPlotInfo;
  nowMs: number;
  onViewCME?: (cmeId: string) => void;
}

/** Each CME on its way: a timeline from the Sun to Earth, where it is now, and when it arrives. */
const EarthBoundCmes: React.FC<EarthBoundCmesProps> = ({ cmes, selected, nowMs, onViewCME }) => (
  <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 text-xs text-neutral-400">
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between mb-2">
      <p className="font-semibold text-neutral-200">CMEs heading for Earth</p>
      <span className="text-[11px] text-neutral-500">From the CME Visualization · NZ time</span>
    </div>
    {cmes.length === 0 ? (
      <p className="text-neutral-500">
        None right now. When the CME Visualization has a CME reaching Earth, it shows here and on the guide, from launch until a day after it arrives.
      </p>
    ) : (
      <ul className="space-y-4">
        {cmes.map((cme, index) => {
          const color = cmeColor(index);
          const pct = cme.progress * 100;
          return (
            <li key={cme.id}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold" style={{ color }}>
                  CME {index + 1}
                  <span className="ml-2 text-xs font-normal text-neutral-400">left the Sun {formatWhen(cme.launchMs)}</span>
                </p>
                {onViewCME && (
                  <button type="button" onClick={() => onViewCME(cme.id)} className="shrink-0 text-[11px] text-sky-300 hover:text-sky-200 hover:underline">
                    See it in 3D
                  </button>
                )}
              </div>
              <div className="relative mt-3 h-2 rounded-full bg-neutral-800" role="img" aria-label={`CME ${index + 1} is ${Math.round(pct)}% of the way to Earth`}>
                <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.85 }} />
                <div className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-neutral-950" style={{ left: `${pct}%`, backgroundColor: color }} />
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-neutral-500">
                <span>Sun · {formatShortWhen(cme.launchMs)}</span>
                <span className="text-sky-300">Earth · {formatShortWhen(cme.arrivalMs)}</span>
              </div>
              <p className="mt-1.5 text-neutral-200">
                {cme.arrived
                  ? <>Arrived {formatWhen(cme.arrivalMs)}, {formatSpan(nowMs - cme.arrivalMs)} ago</>
                  : <>Expected at Earth <strong>{formatWhen(cme.arrivalMs)}</strong>, in {formatSpan(cme.arrivalMs - nowMs)}</>}
              </p>
              <p className="mt-0.5 text-[11px] text-neutral-500">
                {cme.distanceAu.toFixed(2)} AU from the Sun · {Math.round(cme.speedNowKms)} km/s now (left at {Math.round(cme.launchSpeedKms)} km/s)
              </p>
              <p className="mt-0.5 text-[11px]">
                {viewStatus(cme, selected, nowMs).map((v, i) => (
                  <span key={v.key} className={v.selected ? 'text-neutral-200' : 'text-neutral-500'}>
                    {i > 0 && ' · '}{v.text}
                  </span>
                ))}
              </p>
            </li>
          );
        })}
      </ul>
    )}
  </div>
);

interface StereoJPlotsPanelProps {
  /** Opens a CME in the CME Visualization. */
  onViewCMEInVisualization?: (cmeId: string) => void;
}

const StereoJPlotsPanel: React.FC<StereoJPlotsPanelProps> = ({ onViewCMEInVisualization }) => {
  const [selectedKey, setSelectedKey] = useState(STEREO_JPLOTS[0].key);
  const [refreshKey, setRefreshKey] = useState(() => Date.now());
  const [useProxy, setUseProxy] = useState(true);
  const [imageFailed, setImageFailed] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  const [modalState, setModalState] = useState<{ title: string; content: string } | null>(null);
  const imageScrollRef = useRef<HTMLDivElement | null>(null);
  const selected = useMemo(
    () => STEREO_JPLOTS.find(plot => plot.key === selectedKey) ?? STEREO_JPLOTS[0],
    [selectedKey],
  );
  const selectedSrc = useProxy ? proxiedImageUrl(selected, refreshKey) : `${directImageUrl(selected)}?v=${refreshKey}`;

  // The CMEs the CME Visualization has reaching Earth, moved on with the clock.
  const arrivals = useCmeEarthArrivals();
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!arrivals.length) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [arrivals]);
  const cmes = useMemo(() => jplotCmes(arrivals, nowMs, STEREO_JPLOTS), [arrivals, nowMs]);

  const scrollImageToNewest = useCallback(() => {
    const scroller = imageScrollRef.current;
    if (!scroller) return;
    requestAnimationFrame(() => {
      scroller.scrollLeft = scroller.scrollWidth;
    });
  }, []);

  useEffect(() => {
    const id = window.setTimeout(scrollImageToNewest, 80);
    return () => window.clearTimeout(id);
  }, [selectedKey, refreshKey, useProxy, imageFailed, scrollImageToNewest]);

  const handleSelect = (key: string) => {
    setSelectedKey(key);
    setUseProxy(true);
    setImageFailed(false);
  };

  const openModal = useCallback(() => {
    setModalState({
      title: 'About STEREO Beacon J-plots',
      content: `
        <div class='space-y-3 text-left'>
          <p><strong>STEREO Beacon J-plots</strong></p>
          <p><strong>What this is:</strong> These are NASA STEREO-A heliospheric imager J-plots. A J-plot stacks narrow image slices over time so outward-moving CME structure appears as bright or dark diagonal tracks.</p>
          <p><strong>How to view it:</strong> Choose <strong>HI1</strong> for the inner heliosphere closer to the Sun, or <strong>HI2</strong> for the wider view that reaches Earth-orbit distances. On mobile, the image opens scrolled to the newest/right-hand side. You can still drag sideways to inspect earlier times.</p>
          <p><strong>Field-of-view guide:</strong> The bar and diagram show where the selected imager sits between the Sun, STEREO-A, and Earth. AU positions are shown to scale; the Sun, Earth, and spacecraft icons are not size-to-scale.</p>
          <p><strong>CMEs heading for Earth:</strong> The coloured fronts on the bar and the guide are the CMEs the CME Visualization has reaching Earth, drawn where its model puts them now, with the arrival time from the same model. Each shows from launch until a day after it arrives. While a front is inside an imager's range, that is the J-plot to look for its track on.</p>
          <p><strong>What to look for:</strong> A real CME front usually appears as a coherent diagonal feature moving upward/right through time. The slope gives a quick visual sense of speed: steeper tracks generally mean faster outward motion.</p>
          <p class='text-xs text-neutral-400'><strong>Advanced:</strong> These beacon products are context imagery, not a direct impact forecast. Use them alongside EPAM, solar-wind shock markers, and CME model timing. STEREO-A views the Sun from a different longitude than Earth, so alignment and projection can shift where a feature appears.</p>
        </div>
      `,
    });
  }, []);

  return (
    <div id="stereo-jplots-section" className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col">
      <InfoModal isOpen={!!modalState} onClose={() => setModalState(null)} title={modalState?.title ?? ''} content={modalState?.content ?? ''} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold text-white">STEREO Beacon J-plots</h2>
            <button
              type="button"
              onClick={openModal}
              className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors"
              title="About STEREO Beacon J-plots"
            >
              ?
            </button>
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

      <div className="flex justify-center gap-2 mb-3 flex-wrap">
        {STEREO_JPLOTS.map(plot => (
          <button
            key={plot.key}
            onClick={() => handleSelect(plot.key)}
            style={selected.key === plot.key ? { borderColor: plot.color, boxShadow: `0 0 0 1px ${plot.color}, 0 0 18px ${plot.fill}`, backgroundColor: plot.color } : undefined}
            className={`px-3 py-1 text-xs rounded border transition-colors ${selected.key === plot.key ? 'text-white font-semibold' : 'bg-neutral-700 border-neutral-700 hover:bg-neutral-600 text-neutral-300'}`}
          >
            {plot.label}
          </button>
        ))}
      </div>

      <SelectedRangeBar selected={selected} cmes={cmes} />

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

      <div ref={imageScrollRef} className="relative bg-neutral-900/40 rounded-lg p-2 border border-neutral-800/80 overflow-x-auto">
        {!imageFailed ? (
          <a href={directImageUrl(selected)} target="_blank" rel="noopener noreferrer" title={`Open ${selected.title} at NASA`}>
            <img
              key={`${selected.key}-${refreshKey}-${useProxy ? 'proxy' : 'direct'}`}
              src={selectedSrc}
              alt={`${selected.title} from NASA STEREO beacon`}
              className="block min-w-[680px] w-full h-auto rounded bg-black object-contain"
              loading="lazy"
              referrerPolicy="no-referrer"
              onLoad={scrollImageToNewest}
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

      <div id="stereo-fov-guide" className="mt-4 text-xs text-neutral-400">
        {showGuide ? (
          <StereoFovGuide selected={selected} cmes={cmes} />
        ) : (
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
            <p className="font-semibold text-neutral-200">Field-of-view guide hidden</p>
            <p className="text-neutral-500 mt-1">Open it to see where HI1 and HI2 sit between the Sun, STEREO-A, and Earth.</p>
          </div>
        )}
        <EarthBoundCmes cmes={cmes} selected={selected} nowMs={nowMs} onViewCME={onViewCMEInVisualization} />
      </div>
    </div>
  );
};

export default StereoJPlotsPanel;
