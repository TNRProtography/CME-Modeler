import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import StereoCmeGeometry from './StereoCmeGeometry';
import { fetchStereoTrackerData, StereoTrackerData, TrackerStatus } from '../services/stereoCmeTracker';

type TrackerMode = 'jmap' | 'visualisation';
type JmapInstrument = 'HI2' | 'HI1';

const JMAP_URLS: Record<JmapInstrument, string> = {
  HI1: 'https://stereo-ssc.nascom.nasa.gov/beacon/jplot_hi1_ahead_090.gif',
  HI2: 'https://stereo-ssc.nascom.nasa.gov/beacon/jplot_hi2_ahead_090.gif',
};

const STATUS_STYLES: Record<TrackerStatus, string> = {
  'No active CME': 'bg-neutral-800/80 border-neutral-700 text-neutral-300',
  'Possible Earth-relevant CME': 'bg-amber-900/30 border-amber-700/50 text-amber-200',
  'Strong Earth-relevant CME': 'bg-orange-900/40 border-orange-600/60 text-orange-100',
  'Data unavailable': 'bg-red-950/40 border-red-800/60 text-red-200',
};

const formatDateTime = (value?: string | null) => {
  if (!value) return 'Unavailable';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString('en-NZ', {
    timeZone: 'Pacific/Auckland',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }) + ' NZT';
};

const formatNumber = (value?: number | null, suffix = '') => (
  typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)}${suffix}` : 'Unavailable'
);

const computeEarthElongation = (distanceAu?: number | null, longitudeDeg?: number | null): number | null => {
  if (distanceAu == null || longitudeDeg == null) return null;
  const theta = (longitudeDeg * Math.PI) / 180;
  const stereo = { x: distanceAu * Math.cos(theta), y: distanceAu * Math.sin(theta) };
  const sunVector = { x: -stereo.x, y: -stereo.y };
  const earthVector = { x: 1 - stereo.x, y: -stereo.y };
  const dot = sunVector.x * earthVector.x + sunVector.y * earthVector.y;
  const sunMag = Math.hypot(sunVector.x, sunVector.y);
  const earthMag = Math.hypot(earthVector.x, earthVector.y);
  if (!sunMag || !earthMag) return null;
  const cosAngle = Math.min(1, Math.max(-1, dot / (sunMag * earthMag)));
  return (Math.acos(cosAngle) * 180) / Math.PI;
};

const isStale = (updatedAt?: string | null) => {
  if (!updatedAt) return false;
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  return Number.isFinite(ageMs) && ageMs > 6 * 60 * 60 * 1000;
};

const StereoCmeVisualTracker: React.FC = () => {
  const [mode, setMode] = useState<TrackerMode>('jmap');
  const [instrument, setInstrument] = useState<JmapInstrument>('HI2');
  const [data, setData] = useState<StereoTrackerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const [refreshToken, setRefreshToken] = useState(Date.now());
  const mountedRef = useRef(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const nextData = await fetchStereoTrackerData();
      if (mountedRef.current) setData(nextData);
    } catch (error) {
      if (mountedRef.current) {
        setData({
          stereo: null,
          stereoError: error instanceof Error ? error.message : 'Tracker data unavailable',
          cme: null,
          cmeError: error instanceof Error ? error.message : 'DONKI CME data unavailable',
          status: 'Data unavailable',
          updatedAt: new Date().toISOString(),
        });
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    loadData();
    const interval = window.setInterval(loadData, 10 * 60 * 1000);
    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
    };
  }, [loadData]);

  const stereoLongitude = data?.stereo?.heeLongitudeDeg ?? data?.stereo?.separationFromEarthDeg ?? null;
  const elongation = useMemo(() => computeEarthElongation(data?.stereo?.rAu, stereoLongitude), [data?.stereo?.rAu, stereoLongitude]);
  const jmapSrc = `${JMAP_URLS[instrument]}?_=${refreshToken}`;
  const status = data?.status ?? (loading ? 'Data unavailable' : 'No active CME');
  const stale = isStale(data?.updatedAt);

  const refresh = () => {
    setImageError(false);
    setRefreshToken(Date.now());
    loadData();
  };

  return (
    <section className="col-span-12 card bg-neutral-950/80 p-4 border border-neutral-800/80">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-semibold text-white">STEREO-A CME Visual Tracker</h2>
            <span className={`px-2.5 py-1 rounded-full border text-xs font-semibold ${STATUS_STYLES[status]}`}>{status}</span>
          </div>
          <p className="text-xs text-neutral-500 mt-1 leading-relaxed max-w-3xl">
            This panel gives visual CME-tracking context from STEREO-A and DONKI. It does not guarantee an aurora. Storm strength still depends on the solar wind magnetic field at arrival, especially Bz.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          {data?.updatedAt && <span>Updated {formatDateTime(data.updatedAt)}</span>}
          <button onClick={refresh} className="p-1.5 rounded-full text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors" title="Refresh STEREO tracker">↻</button>
        </div>
      </div>

      {stale && (
        <div className="mb-3 rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          Data may be stale. Use the refresh button or inspect the official J-map source directly if you need the newest beacon frame.
        </div>
      )}

      {(data?.cmeError || data?.stereoError || imageError) && (
        <div className="mb-3 grid gap-2 md:grid-cols-3 text-xs">
          {data?.cmeError && <p className="rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-red-200">DONKI: {data.cmeError}</p>}
          {data?.stereoError && <p className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-amber-200">STEREO-A position unavailable. J-map imagery and DONKI CME details can still be used.</p>}
          {imageError && <p className="rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-red-200">J-map image failed to load. Try switching HI1/HI2 or use Visualisation mode.</p>}
        </div>
      )}

      <div className="flex justify-center gap-2 mb-4 flex-wrap">
        <button onClick={() => setMode('jmap')} className={`px-4 py-1.5 text-xs rounded-full transition-colors ${mode === 'jmap' ? 'bg-sky-600 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'}`}>J-map Image</button>
        <button onClick={() => setMode('visualisation')} className={`px-4 py-1.5 text-xs rounded-full transition-colors ${mode === 'visualisation' ? 'bg-sky-600 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'}`}>Visualisation</button>
      </div>

      {loading ? (
        <div className="h-72 rounded-xl bg-neutral-800/50 animate-pulse" />
      ) : mode === 'jmap' ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex gap-2">
              {(['HI2', 'HI1'] as JmapInstrument[]).map((item) => (
                <button key={item} onClick={() => { setInstrument(item); setImageError(false); setRefreshToken(Date.now()); }} className={`px-3 py-1 text-xs rounded transition-colors ${instrument === item ? 'bg-purple-600 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'}`}>{item}</button>
              ))}
            </div>
            <a href={JMAP_URLS[instrument]} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-400 hover:text-sky-300">Open official {instrument} beacon J-map ↗</a>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-black/60 overflow-auto max-h-[520px]">
            {!imageError ? (
              <img src={jmapSrc} alt={`Official STEREO-A beacon ${instrument} J-map`} className="w-full min-w-[520px] md:min-w-0 object-contain" onError={() => setImageError(true)} />
            ) : (
              <div className="h-64 flex items-center justify-center text-sm text-neutral-500">J-map image unavailable.</div>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2 text-xs leading-relaxed">
            <p className="rounded-lg bg-neutral-900/70 border border-neutral-800 px-3 py-2 text-neutral-300">Diagonal bright/dark tracks can show CME material moving outward through the heliosphere. This is visual evidence only; aurora strength still depends on the magnetic field at arrival, especially Bz.</p>
            <p className="rounded-lg bg-neutral-900/70 border border-neutral-800 px-3 py-2 text-neutral-400">STEREO beacon imagery may be low-resolution or compressed, and not every Earth-directed CME will produce a clear track.</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
          <StereoCmeGeometry stereo={data?.stereo ?? null} cme={data?.cme ?? null} />
          <div className="space-y-3">
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
              <h3 className="text-sm font-semibold text-neutral-100 mb-2">STEREO-A context</h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-neutral-500">Distance</span><p className="text-neutral-200">{data?.stereo?.rAu ? `${data.stereo.rAu.toFixed(3)} AU` : 'Unavailable'}</p></div>
                <div><span className="text-neutral-500">HEE longitude/separation</span><p className="text-neutral-200">{stereoLongitude != null ? `${stereoLongitude.toFixed(1)}°` : 'Unavailable'}{data?.stereo?.separationFromEarthDeg != null ? ` / ${data.stereo.separationFromEarthDeg.toFixed(1)}°` : ''}</p></div>
                <div className="col-span-2"><span className="text-neutral-500">Earth from STEREO-A</span><p className="text-purple-200">{elongation != null ? `${elongation.toFixed(1)}° elongation` : 'Unavailable'}</p></div>
              </div>
              {elongation != null && elongation > 70 && <p className="mt-2 text-xs text-amber-300/90">Earth may sit beyond the plotted HI field in the J-map, so a visible CME track may need to be extrapolated.</p>}
            </div>

            <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
              <h3 className="text-sm font-semibold text-neutral-100 mb-2">Recent DONKI CME candidate</h3>
              {data?.cme ? (
                <div className="space-y-2 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <div><span className="text-neutral-500">Start</span><p className="text-neutral-200">{formatDateTime(data.cme.startTime)}</p></div>
                    <div><span className="text-neutral-500">Speed</span><p className="text-neutral-200">{formatNumber(data.cme.speed, ' km/s')}</p></div>
                    <div><span className="text-neutral-500">Width / half-angle</span><p className="text-neutral-200">{formatNumber(data.cme.halfAngle, '°')}</p></div>
                    <div><span className="text-neutral-500">Source</span><p className="text-neutral-200">{data.cme.sourceLocation || 'Unavailable'}</p></div>
                    <div><span className="text-neutral-500">DONKI/ENLIL arrival</span><p className="text-neutral-200">{formatDateTime(data.cme.arrivalTime)}</p></div>
                    <div><span className="text-neutral-500">Front distance</span><p className="text-neutral-200">{data.cme.front?.label ?? 'Unavailable'}</p></div>
                  </div>
                  <p className="text-neutral-400">Confidence: <span className="text-neutral-100 font-semibold">{data.cme.confidence}</span></p>
                  <ul className="space-y-1 text-neutral-400 list-disc pl-4">
                    {data.cme.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                  {data.cme.link && <a href={data.cme.link} target="_blank" rel="noopener noreferrer" className="inline-block text-sky-400 hover:text-sky-300">Open DONKI event ↗</a>}
                </div>
              ) : (
                <p className="text-xs text-neutral-400 leading-relaxed">No recent Earth-relevant CME candidate found in DONKI. STEREO J-map imagery is still available for visual inspection.</p>
              )}
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-neutral-700 mt-4 pt-3 border-t border-neutral-800 leading-relaxed">
        Visual context only · Rough CME fronts use a simple ballistic estimate from DONKI time21_5 and speed when available; this is not an official forecast or arrival prediction.
      </p>
    </section>
  );
};

export default StereoCmeVisualTracker;
