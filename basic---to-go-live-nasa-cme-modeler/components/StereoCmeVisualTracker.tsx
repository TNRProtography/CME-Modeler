import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import StereoCmeGeometry from './StereoCmeGeometry';
import { fetchStereoTrackerData, StereoTrackerData, TrackerCmeCandidate, TrackerStatus } from '../services/stereoCmeTracker';

type TrackerMode = 'jmap' | 'visualisation';
type JMapInstrument = 'HI2' | 'HI1';

type JMapTracePoint = {
  xNorm: number;
  yNorm: number;
};

type JMapTrace = {
  instrument: JMapInstrument;
  points: JMapTracePoint[];
  createdAt: string;
};

type JMapDerivedTrackPoint = {
  time: string | null;
  elongationDeg: number;
  xNorm: number;
  yNorm: number;
};

export type CmeFrontEstimate = {
  source: 'jmap-trace' | 'ballistic' | 'donki-arrival' | 'none';
  distanceAu: number | null;
  elongationDeg?: number | null;
  model?: 'fixed-phi' | 'ballistic' | 'unknown';
  notes: string[];
};

const JMAP_URLS: Record<JMapInstrument, string> = {
  HI1: 'https://stereo-ssc.nascom.nasa.gov/beacon/jplot_hi1_ahead_090.gif',
  HI2: 'https://stereo-ssc.nascom.nasa.gov/beacon/jplot_hi2_ahead_090.gif',
};

const JMAP_CALIBRATION: Record<JMapInstrument, { minElongationDeg: number; maxElongationDeg: number; rollingDays: number; note: string }> = {
  HI1: {
    minElongationDeg: 4,
    maxElongationDeg: 24,
    rollingDays: 7,
    note: 'HI1 calibration is approximate: 4°–24° elongation over a rolling multi-day window.',
  },
  HI2: {
    // TODO: replace this with parsed plot-axis metadata if NASA exposes a machine-readable J-map calibration.
    minElongationDeg: 18,
    maxElongationDeg: 88,
    rollingDays: 14,
    note: 'HI2 calibration is approximate: 18°–88° elongation over a rolling multi-day window.',
  },
};

const STATUS_STYLES: Record<TrackerStatus, string> = {
  'No active CME': 'bg-neutral-800/80 border-neutral-700 text-neutral-300',
  'Possible Earth-relevant CME': 'bg-amber-900/30 border-amber-700/50 text-amber-200',
  'Strong Earth-relevant CME': 'bg-orange-900/40 border-orange-600/60 text-orange-100',
  'Data unavailable': 'bg-red-950/40 border-red-800/60 text-red-200',
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

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

const traceStorageKey = (instrument: JMapInstrument, cmeId?: string | null) => `stereo-cme-jmap-trace-${instrument}-${cmeId || 'latest'}`;

const buildSplinePath = (points: JMapTracePoint[]): string => {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].xNorm * 100} ${points[0].yNorm * 100}`;
  const sorted = [...points].sort((a, b) => a.xNorm - b.xNorm);
  const path = [`M ${sorted[0].xNorm * 100} ${sorted[0].yNorm * 100}`];
  for (let i = 0; i < sorted.length - 1; i++) {
    const p0 = sorted[Math.max(0, i - 1)];
    const p1 = sorted[i];
    const p2 = sorted[i + 1];
    const p3 = sorted[Math.min(sorted.length - 1, i + 2)];
    const cp1x = p1.xNorm + (p2.xNorm - p0.xNorm) / 6;
    const cp1y = p1.yNorm + (p2.yNorm - p0.yNorm) / 6;
    const cp2x = p2.xNorm - (p3.xNorm - p1.xNorm) / 6;
    const cp2y = p2.yNorm - (p3.yNorm - p1.yNorm) / 6;
    path.push(`C ${cp1x * 100} ${cp1y * 100}, ${cp2x * 100} ${cp2y * 100}, ${p2.xNorm * 100} ${p2.yNorm * 100}`);
  }
  return path.join(' ');
};

const deriveTrackPoints = (trace: JMapTrace | null): JMapDerivedTrackPoint[] => {
  if (!trace) return [];
  const calibration = JMAP_CALIBRATION[trace.instrument];
  const now = Date.now();
  const windowMs = calibration.rollingDays * 24 * 60 * 60 * 1000;
  return trace.points
    .map((point) => {
      const xNorm = clamp(point.xNorm, 0, 1);
      const yNorm = clamp(point.yNorm, 0, 1);
      const elongationDeg = calibration.maxElongationDeg - yNorm * (calibration.maxElongationDeg - calibration.minElongationDeg);
      const time = new Date(now - (1 - xNorm) * windowMs).toISOString();
      return { xNorm, yNorm, elongationDeg, time };
    })
    .sort((a, b) => a.xNorm - b.xNorm);
};

const getAngularSeparationDeg = (aDeg: number, bDeg: number): number => {
  const delta = Math.abs((((aDeg - bDeg) % 360) + 540) % 360 - 180);
  return delta;
};

const estimateFixedPhiDistance = (
  latestPoint: JMapDerivedTrackPoint | null,
  cme: TrackerCmeCandidate | null,
  stereoDistanceAu?: number | null,
  stereoLongitudeDeg?: number | null,
): CmeFrontEstimate => {
  if (!latestPoint || stereoDistanceAu == null || stereoLongitudeDeg == null) {
    return { source: 'none', distanceAu: null, model: 'unknown', notes: ['No usable J-map trace and STEREO-A geometry are both available.'] };
  }

  const cmeLongitude = cme?.longitude ?? 0;
  const observerToCmeAngleDeg = getAngularSeparationDeg(cmeLongitude, stereoLongitudeDeg);
  const epsilonRad = (latestPoint.elongationDeg * Math.PI) / 180;
  const phiRad = (observerToCmeAngleDeg * Math.PI) / 180;
  const denominator = Math.sin(epsilonRad + phiRad);
  const notes = [
    'J-map trace estimate uses the latest clicked ridge point.',
    'Fixed-Phi approximation assumes a single radial CME direction from DONKI or the Sun–Earth line.',
  ];

  if (Math.abs(denominator) < 0.05) {
    return {
      source: 'jmap-trace',
      distanceAu: null,
      elongationDeg: latestPoint.elongationDeg,
      model: 'fixed-phi',
      notes: [...notes, 'Geometry is near-singular, so no reliable distance is shown.'],
    };
  }

  const rawDistanceAu = stereoDistanceAu * Math.sin(epsilonRad) / denominator;
  if (!Number.isFinite(rawDistanceAu) || rawDistanceAu <= 0) {
    return {
      source: 'jmap-trace',
      distanceAu: null,
      elongationDeg: latestPoint.elongationDeg,
      model: 'fixed-phi',
      notes: [...notes, 'The trace geometry produced a non-physical distance.'],
    };
  }

  return {
    source: 'jmap-trace',
    distanceAu: clamp(rawDistanceAu, 0, 1.2),
    elongationDeg: latestPoint.elongationDeg,
    model: 'fixed-phi',
    notes: [...notes, `Observer–CME angle used by the model: ${observerToCmeAngleDeg.toFixed(1)}°.`],
  };
};

const buildFrontEstimate = (
  latestPoint: JMapDerivedTrackPoint | null,
  cme: TrackerCmeCandidate | null,
  stereoDistanceAu?: number | null,
  stereoLongitudeDeg?: number | null,
): CmeFrontEstimate => {
  if (latestPoint) {
    const jmapEstimate = estimateFixedPhiDistance(latestPoint, cme, stereoDistanceAu, stereoLongitudeDeg);
    if (jmapEstimate.distanceAu != null) return jmapEstimate;
    return jmapEstimate;
  }
  if (cme?.front?.distanceAu != null) {
    return {
      source: 'ballistic',
      distanceAu: cme.front.distanceAu,
      model: 'ballistic',
      notes: ['Ballistic DONKI estimate from time21_5 and CME speed; used because no manual J-map trace is active.'],
    };
  }
  return { source: 'none', distanceAu: null, model: 'unknown', notes: ['No front estimate is available.'] };
};

const getFrontSourceLabel = (estimate: CmeFrontEstimate): string => {
  if (estimate.source === 'jmap-trace') return 'J-map trace';
  if (estimate.source === 'ballistic') return 'Ballistic DONKI estimate';
  if (estimate.source === 'donki-arrival') return 'DONKI arrival model';
  return 'unavailable';
};

const StereoCmeVisualTracker: React.FC = () => {
  const [mode, setMode] = useState<TrackerMode>('jmap');
  const [instrument, setInstrument] = useState<JMapInstrument>('HI2');
  const [data, setData] = useState<StereoTrackerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const [refreshToken, setRefreshToken] = useState(Date.now());
  const [traceActive, setTraceActive] = useState(false);
  const [trace, setTrace] = useState<JMapTrace | null>(null);
  const mountedRef = useRef(true);

  const cmeId = data?.cme?.id ?? 'latest';

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

  useEffect(() => {
    try {
      const saved = localStorage.getItem(traceStorageKey(instrument, cmeId));
      if (saved) {
        const parsed = JSON.parse(saved) as JMapTrace;
        if (parsed.instrument === instrument && Array.isArray(parsed.points)) {
          setTrace(parsed);
          return;
        }
      }
    } catch (error) {
      console.warn('Unable to load saved J-map trace:', error);
    }
    setTrace({ instrument, points: [], createdAt: new Date().toISOString() });
  }, [instrument, cmeId]);

  const saveTrace = useCallback((nextTrace: JMapTrace | null) => {
    if (!nextTrace) return;
    try {
      localStorage.setItem(traceStorageKey(nextTrace.instrument, cmeId), JSON.stringify(nextTrace));
    } catch (error) {
      console.warn('Unable to save J-map trace:', error);
    }
  }, [cmeId]);

  const stereoLongitude = data?.stereo?.heeLongitudeDeg ?? null;
  const stereoSeparation = data?.stereo?.separationFromEarthDeg ?? null;
  const elongation = useMemo(() => computeEarthElongation(data?.stereo?.rAu, stereoLongitude), [data?.stereo?.rAu, stereoLongitude]);
  const derivedTrack = useMemo(() => deriveTrackPoints(trace), [trace]);
  const latestDerivedPoint = derivedTrack.length ? derivedTrack[derivedTrack.length - 1] : null;
  const latestTracePointForModel = derivedTrack.length >= 2 ? derivedTrack[derivedTrack.length - 1] : null;
  const frontEstimate = useMemo(
    () => buildFrontEstimate(latestTracePointForModel, data?.cme ?? null, data?.stereo?.rAu, stereoLongitude),
    [latestTracePointForModel, data?.cme, data?.stereo?.rAu, stereoLongitude],
  );
  const splinePath = useMemo(() => buildSplinePath(trace?.points ?? []), [trace?.points]);
  const jmapSrc = `${JMAP_URLS[instrument]}?_=${refreshToken}`;
  const status = data?.status ?? (loading ? 'Data unavailable' : 'No active CME');
  const stale = isStale(data?.updatedAt);

  const refresh = () => {
    setImageError(false);
    setRefreshToken(Date.now());
    loadData();
  };

  const handleTraceClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!traceActive) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const xNorm = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const yNorm = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    setTrace((current) => {
      const nextTrace: JMapTrace = {
        instrument,
        createdAt: current?.createdAt ?? new Date().toISOString(),
        points: [...(current?.points ?? []), { xNorm, yNorm }].sort((a, b) => a.xNorm - b.xNorm),
      };
      return nextTrace;
    });
  };

  const useTrace = () => {
    if (trace) saveTrace(trace);
    setTraceActive(false);
    setMode('visualisation');
  };

  const clearTrace = () => {
    const nextTrace = { instrument, points: [], createdAt: new Date().toISOString() };
    setTrace(nextTrace);
    try {
      localStorage.removeItem(traceStorageKey(instrument, cmeId));
    } catch (error) {
      console.warn('Unable to clear saved J-map trace:', error);
    }
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
              {(['HI2', 'HI1'] as JMapInstrument[]).map((item) => (
                <button key={item} onClick={() => { setInstrument(item); setImageError(false); setRefreshToken(Date.now()); setTraceActive(false); }} className={`px-3 py-1 text-xs rounded transition-colors ${instrument === item ? 'bg-purple-600 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'}`}>{item}</button>
              ))}
            </div>
            <a href={JMAP_URLS[instrument]} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-400 hover:text-sky-300">Open official {instrument} beacon J-map ↗</a>
          </div>

          <div className="rounded-lg border border-purple-900/50 bg-purple-950/20 px-3 py-2 text-xs text-purple-100 leading-relaxed">
            Trace the visible CME ridge in the J-map. The app converts the traced time–elongation path into a rough model-based front estimate. This is visual context only, not an official arrival prediction.
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setTraceActive((active) => !active)} className={`px-3 py-1.5 text-xs rounded border transition-colors ${traceActive ? 'bg-purple-600 border-purple-400 text-white' : 'bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-700'}`}>Trace CME</button>
            <button onClick={useTrace} disabled={(trace?.points.length ?? 0) < 2} className="px-3 py-1.5 text-xs rounded border border-sky-700 bg-sky-900/40 text-sky-100 hover:bg-sky-800/60 disabled:opacity-40 disabled:cursor-not-allowed">Use trace</button>
            <button onClick={clearTrace} className="px-3 py-1.5 text-xs rounded border border-neutral-700 bg-neutral-800 text-neutral-300 hover:bg-neutral-700">Clear trace</button>
            <span className="text-xs text-neutral-500">Trace points: {trace?.points.length ?? 0}</span>
            {latestDerivedPoint && <span className="text-xs text-purple-200">Latest traced elongation: {latestDerivedPoint.elongationDeg.toFixed(1)}°</span>}
          </div>

          <div className="rounded-xl border border-neutral-800 bg-black/60 overflow-auto max-h-[560px]">
            <div onClick={handleTraceClick} className={`relative inline-block min-w-[520px] md:min-w-0 w-full ${traceActive ? 'cursor-crosshair' : ''}`}>
              {!imageError ? (
                <img src={jmapSrc} alt={`Official STEREO-A beacon ${instrument} J-map`} className="w-full object-contain select-none" onError={() => setImageError(true)} draggable={false} />
              ) : (
                <div className="h-64 flex items-center justify-center text-sm text-neutral-500">J-map image unavailable.</div>
              )}
              {!imageError && (
                <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  {trace && trace.points.length >= 2 && <path d={splinePath} fill="none" stroke="#f472b6" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
                  {trace?.points.map((point, index) => (
                    <g key={`${point.xNorm}-${point.yNorm}-${index}`}>
                      <circle cx={point.xNorm * 100} cy={point.yNorm * 100} r="1.4" fill="#f472b6" stroke="#fdf2f8" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
                    </g>
                  ))}
                </svg>
              )}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3 text-xs leading-relaxed">
            <p className="rounded-lg bg-neutral-900/70 border border-neutral-800 px-3 py-2 text-neutral-300">Diagonal bright/dark tracks can show CME material moving outward through the heliosphere. This is visual evidence only; aurora strength still depends on the magnetic field at arrival, especially Bz.</p>
            <p className="rounded-lg bg-neutral-900/70 border border-neutral-800 px-3 py-2 text-neutral-400">STEREO beacon imagery may be low-resolution or compressed, and not every Earth-directed CME will produce a clear track.</p>
            <p className="rounded-lg bg-neutral-900/70 border border-neutral-800 px-3 py-2 text-neutral-400">{JMAP_CALIBRATION[instrument].note} Front source: {getFrontSourceLabel(frontEstimate)}.</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
          <StereoCmeGeometry stereo={data?.stereo ?? null} cme={data?.cme ?? null} frontEstimate={frontEstimate} />
          <div className="space-y-3">
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
              <h3 className="text-sm font-semibold text-neutral-100 mb-2">STEREO-A context</h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-neutral-500">Distance</span><p className="text-neutral-200">{data?.stereo?.rAu ? `${data.stereo.rAu.toFixed(3)} AU` : 'Unavailable'}</p></div>
                <div><span className="text-neutral-500">HEE/ecliptic longitude</span><p className="text-neutral-200">{stereoLongitude != null ? `${stereoLongitude.toFixed(1)}°` : 'Unavailable'}</p></div>
                <div><span className="text-neutral-500">Separation from Earth</span><p className="text-neutral-200">{stereoSeparation != null ? `${stereoSeparation.toFixed(1)}°` : 'Unavailable'}</p></div>
                <div><span className="text-neutral-500">Earth from STEREO-A</span><p className="text-purple-200">{elongation != null ? `${elongation.toFixed(1)}° elongation` : 'Unavailable'}</p></div>
              </div>
              {elongation != null && elongation > 70 && <p className="mt-2 text-xs text-amber-300/90">Earth may sit beyond the plotted HI field in the J-map, so a visible CME track may need to be extrapolated.</p>}
            </div>

            <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
              <h3 className="text-sm font-semibold text-neutral-100 mb-2">Trace-derived front estimate</h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-neutral-500">Trace points</span><p className="text-neutral-200">{trace?.points.length ?? 0}</p></div>
                <div><span className="text-neutral-500">Latest elongation</span><p className="text-neutral-200">{latestDerivedPoint ? `${latestDerivedPoint.elongationDeg.toFixed(1)}°` : 'Unavailable'}</p></div>
                <div><span className="text-neutral-500">Model</span><p className="text-neutral-200">{frontEstimate.model === 'fixed-phi' ? 'Fixed-Phi approximation' : frontEstimate.model === 'ballistic' ? 'Ballistic estimate' : 'Unknown'}</p></div>
                <div><span className="text-neutral-500">Front source</span><p className="text-neutral-200">{getFrontSourceLabel(frontEstimate)}</p></div>
                <div className="col-span-2"><span className="text-neutral-500">Estimated front</span><p className="text-orange-200">{frontEstimate.distanceAu != null ? `${frontEstimate.distanceAu.toFixed(2)} AU` : 'Unavailable'}</p></div>
              </div>
              <ul className="mt-2 list-disc pl-4 space-y-1 text-xs text-neutral-500">
                {frontEstimate.notes.map((note) => <li key={note}>{note}</li>)}
              </ul>
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
                    <div><span className="text-neutral-500">Fallback front</span><p className="text-neutral-200">{data.cme.front?.label ?? 'Unavailable'}</p></div>
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
        Visual context only · J-map traces use approximate image calibration and a simple geometry model; ballistic fronts use DONKI time21_5 and speed when available. This is not an official forecast or arrival prediction.
      </p>
    </section>
  );
};

export default StereoCmeVisualTracker;
