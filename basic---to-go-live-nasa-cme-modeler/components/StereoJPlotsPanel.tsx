import React, { useMemo, useState } from 'react';

const STEREO_BEACON_BASE = 'https://stereo-ssc.nascom.nasa.gov/beacon';

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
  },
];

const directImageUrl = (plot: StereoJPlotInfo) => `${STEREO_BEACON_BASE}/${plot.fileName}`;
const proxiedImageUrl = (plot: StereoJPlotInfo, refreshKey: number) =>
  `/api/proxy/image?ttl=300&url=${encodeURIComponent(directImageUrl(plot))}&v=${refreshKey}`;
const formatAu = (value: number) => `${value.toFixed(3)} AU`;

const StereoJPlotsPanel: React.FC = () => {
  const [selectedKey, setSelectedKey] = useState(STEREO_JPLOTS[0].key);
  const [refreshKey, setRefreshKey] = useState(() => Date.now());
  const [useProxy, setUseProxy] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const selected = useMemo(
    () => STEREO_JPLOTS.find(plot => plot.key === selectedKey) ?? STEREO_JPLOTS[0],
    [selectedKey],
  );
  const selectedSrc = useProxy ? proxiedImageUrl(selected, refreshKey) : `${directImageUrl(selected)}?v=${refreshKey}`;
  const reachesEarth = selected.endAu >= 1;

  const handleSelect = (key: string) => {
    setSelectedKey(key);
    setUseProxy(false);
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
            onClick={() => { setRefreshKey(Date.now()); setUseProxy(false); setImageFailed(false); }}
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

      <div className="mb-3">
        <p className="text-sm font-semibold text-neutral-200">{selected.title}</p>
        <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">{selected.description}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
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
                  if (!useProxy) {
                    setUseProxy(true);
                    return;
                  }
                  setImageFailed(true);
                }}
              />
            </a>
          ) : (
            <div className="min-h-[320px] min-w-[680px] rounded bg-neutral-900/80 border border-neutral-800 flex flex-col items-center justify-center text-center p-6">
              <p className="text-sm font-semibold text-neutral-200">STEREO image could not be loaded</p>
              <p className="text-xs text-neutral-500 mt-1 max-w-md">The direct NASA image and the app proxy both failed. You can still open the source GIF directly from NASA.</p>
              <a href={directImageUrl(selected)} target="_blank" rel="noopener noreferrer" className="mt-3 px-3 py-1 text-xs rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-200 transition-colors">Open NASA GIF</a>
            </div>
          )}
          {useProxy && !imageFailed && (
            <div className="absolute right-3 top-3 rounded bg-black/70 border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300">
              using app proxy
            </div>
          )}
        </div>

        <div className="space-y-3 text-xs text-neutral-400">
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
            <p className="font-semibold text-neutral-200 mb-2">Distance coverage</p>
            <dl className="space-y-1.5">
              <div className="flex justify-between gap-3"><dt>Starts from Sun</dt><dd className="text-neutral-100 font-medium">{formatAu(selected.startAu)}</dd></div>
              <div className="flex justify-between gap-3"><dt>Ends from Sun</dt><dd className="text-neutral-100 font-medium">{formatAu(selected.endAu)}</dd></div>
              <div className="flex justify-between gap-3"><dt>Distance shown</dt><dd className="text-neutral-100 font-medium">{formatAu(selected.endAu - selected.startAu)}</dd></div>
              <div className="flex justify-between gap-3"><dt>AU left at end</dt><dd className="text-neutral-100 font-medium">{reachesEarth ? '0.000 AU' : formatAu(selected.earthRemainingAu)}</dd></div>
            </dl>
            {reachesEarth && (
              <p className="text-[11px] text-neutral-500 mt-2 leading-relaxed">
                This plot extends {formatAu(selected.endAu - 1)} beyond 1 AU, so Earth orbit is inside the graphic.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
            <p className="font-semibold text-neutral-200 mb-1">Instrument range</p>
            <p className="leading-relaxed">{selected.nominalRange}, converted to AU using 1 AU ≈ 215 R☉.</p>
          </div>

          <p className="text-neutral-600 leading-relaxed">
            If a NASA image blocks direct loading, the app automatically retries through the CORS-enabled image proxy.
          </p>
        </div>
      </div>
    </div>
  );
};

export default StereoJPlotsPanel;
