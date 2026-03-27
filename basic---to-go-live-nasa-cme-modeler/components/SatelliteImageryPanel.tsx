// --- START OF FILE src/components/SatelliteImageryPanel.tsx ---
import React, { useState, useEffect, useCallback, useRef } from 'react';

const WORKER_URL = 'https://nz-aurora-imagery.thenamesrock.workers.dev';

// ── Region definitions ────────────────────────────────────────────────────────
type RegionKey = 'full' | 'nz' | 'north' | 'south' | 'stewart' | 'location';

interface RegionDef {
  key: RegionKey;
  label: string;
  description: string;
  region?: string;
}

const REGIONS: RegionDef[] = [
  {
    key: 'full',
    label: 'Full Image',
    description: 'Full swath from the top of New Zealand to Antarctica — shows the entire aurora oval when active.',
    region: 'full',
  },
  {
    key: 'location',
    label: '📍 400 km Radius',
    description: 'Imagery centred on your current GPS location with a ~400 km radius.',
  },
  {
    key: 'south',
    label: 'South Island',
    description: 'South Island focus — the primary aurora viewing zone in New Zealand.',
    region: 'south',
  },
  {
    key: 'north',
    label: 'North Island',
    description: 'North Island focus — useful for checking aurora visibility from Wellington and above.',
    region: 'north',
  },
  {
    key: 'nz',
    label: 'NZ Only',
    description: 'Tight frame covering all of New Zealand — both islands clearly resolved.',
    region: 'nz',
  },
];

type LayerKey = 'snpp' | 'noaa20';

const LAYERS: { key: LayerKey; label: string }[] = [
  { key: 'snpp',   label: 'SuomiNPP' },
  { key: 'noaa20', label: 'NOAA-20'  },

];

function locationToBbox(lat: number, lon: number, radiusDeg = 3.6): string {
  const minLat = Math.max(-90, lat - radiusDeg);
  const maxLat = Math.min(90,  lat + radiusDeg);
  return `${minLat.toFixed(3)},${(lon - radiusDeg).toFixed(3)},${maxLat.toFixed(3)},${(lon + radiusDeg).toFixed(3)}`;
}

function yesterdayUTC(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0];
}

// ── Component ─────────────────────────────────────────────────────────────────
const SatelliteImageryPanel: React.FC = () => {
  const [activeRegion, setActiveRegion] = useState<RegionKey>('full');
  const [activeLayer,  setActiveLayer]  = useState<LayerKey>('snpp');
  const [date,         setDate]         = useState<string>(yesterdayUTC());

  const [imgSrc,   setImgSrc]   = useState<string>('');
  const [loading,  setLoading]  = useState<boolean>(true);
  const [error,    setError]    = useState<string | null>(null);
  const [cacheHit, setCacheHit] = useState<boolean | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [userLat,    setUserLat]    = useState<number | null>(null);
  const [userLon,    setUserLon]    = useState<number | null>(null);
  const [geoLoading, setGeoLoading] = useState<boolean>(false);
  const [geoError,   setGeoError]   = useState<string | null>(null);

  const mountedRef   = useRef(true);
  const objectUrlRef = useRef<string>('');

  const buildUrl = useCallback((): string | null => {
    const params = new URLSearchParams({ date, layer: activeLayer, w: '900', h: '700' });
    if (activeRegion === 'location') {
      if (userLat === null || userLon === null) return null;
      params.set('bbox', locationToBbox(userLat, userLon));
    } else {
      const def = REGIONS.find(r => r.key === activeRegion);
      if (!def?.region) return null;
      params.set('region', def.region);
    }
    return `${WORKER_URL}/image?${params}`;
  }, [activeRegion, activeLayer, date, userLat, userLon]);

  const fetchImage = useCallback(async () => {
    const url = buildUrl();
    if (!url || !mountedRef.current) return;

    setLoading(true);
    setError(null);
    setCacheHit(null);

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = '';
    }

    try {
      const res = await fetch(url);
      if (!mountedRef.current) return;
      if (!res.ok) {
        setError(`No imagery available (HTTP ${res.status}). Try an earlier date or different satellite.`);
        setLoading(false);
        return;
      }
      const hit = res.headers.get('X-Cache-Status');
      setCacheHit(hit === 'HIT');
      const blob = await res.blob();
      if (!mountedRef.current) return;
      const objUrl = URL.createObjectURL(blob);
      objectUrlRef.current = objUrl;
      setImgSrc(objUrl);
      setLastUpdated(new Date());
    } catch {
      if (mountedRef.current) setError('Failed to fetch imagery — check your connection.');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [buildUrl]);

  useEffect(() => {
    mountedRef.current = true;
    if (activeRegion !== 'location' || (userLat !== null && userLon !== null)) {
      fetchImage();
    }
    return () => { mountedRef.current = false; };
  }, [activeRegion, activeLayer, date, userLat, userLon]); // eslint-disable-line

  useEffect(() => () => {
    mountedRef.current = false;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) { setGeoError('Geolocation not supported by your browser.'); return; }
    setGeoLoading(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      pos => { setUserLat(pos.coords.latitude); setUserLon(pos.coords.longitude); setGeoLoading(false); },
      err => { setGeoError(err.code === 1 ? 'Location access denied.' : 'Could not get location.'); setGeoLoading(false); },
      { timeout: 10000 }
    );
  }, []);

  const handleRegionClick = (key: RegionKey) => {
    if (key === 'location' && userLat === null) {
      setActiveRegion('location');
      requestLocation();
    } else {
      setActiveRegion(key);
    }
  };

  const today   = new Date().toISOString().split('T')[0];
  const minDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const currentRegion = REGIONS.find(r => r.key === activeRegion)!;
  const fullResUrl    = buildUrl()?.replace('w=900&h=700', 'w=1800&h=1400') ?? '#';
  const showImage     = activeRegion !== 'location' || (userLat !== null && userLon !== null);

  return (
    <div>
      {/* Header — matches EPAMPanel exactly */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold text-white">VIIRS Satellite Imagery</h2>
          <p className="text-xs text-neutral-500 mt-0.5">NASA GIBS · Day-Night Band · Near Constant Contrast · ~750 m resolution</p>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-xs text-neutral-600">
              {lastUpdated.toLocaleTimeString('en-NZ', { timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit' })} NZT
            </span>
          )}
          {cacheHit !== null && (
            <span className={`text-xs px-2 py-0.5 rounded-full border ${
              cacheHit
                ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-400'
                : 'bg-sky-950/40 border-sky-800/60 text-sky-400'
            }`}>
              {cacheHit ? 'Cached' : 'Live fetch'}
            </span>
          )}
          <button
            onClick={fetchImage}
            className="p-1.5 rounded-full text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors"
            title="Refresh"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Region buttons — same style as EPAMPanel view selector */}
      <div className="flex justify-center gap-2 mb-3 flex-wrap">
        {REGIONS.map(r => {
          const isLoc    = r.key === 'location';
          const isActive = activeRegion === r.key;
          return (
            <button
              key={r.key}
              onClick={() => handleRegionClick(r.key)}
              disabled={isLoc && geoLoading}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                isActive
                  ? 'bg-sky-600 text-white'
                  : 'bg-neutral-700 hover:bg-neutral-600 text-neutral-300'
              } ${isLoc && geoLoading ? 'opacity-60 cursor-wait' : ''}`}
            >
              {isLoc && geoLoading ? '⏳ Locating…' : r.label}
            </button>
          );
        })}
      </div>

      {/* Region description */}
      <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed mb-3">
        {currentRegion.description}
        {activeRegion === 'location' && userLat !== null && (
          <span className="text-neutral-600 ml-1">({userLat.toFixed(2)}°, {userLon!.toFixed(2)}°)</span>
        )}
      </p>

      {/* Geolocation error — matches STEREO warning style */}
      {geoError && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-red-900/30 border border-red-700/40 rounded-lg mb-3">
          <span className="text-red-400 flex-shrink-0 mt-0.5">⚠</span>
          <p className="text-xs text-red-300/80 leading-relaxed">{geoError}</p>
        </div>
      )}

      {/* Satellite layer tabs — matches EPAMPanel time range selector */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex justify-center gap-2">
          {LAYERS.map(l => (
            <button
              key={l.key}
              onClick={() => setActiveLayer(l.key)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                activeLayer === l.key
                  ? 'bg-neutral-600 text-white'
                  : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-400'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500">Date</span>
          <input
            type="date"
            value={date}
            min={minDate}
            max={today}
            onChange={e => setDate(e.target.value)}
            className="text-xs bg-neutral-800 border border-neutral-700 text-neutral-300 rounded px-2 py-1 focus:outline-none focus:border-sky-600 cursor-pointer"
          />
        </div>
      </div>

      {/* Location prompt */}
      {activeRegion === 'location' && userLat === null && !geoLoading && !geoError && (
        <div className="h-48 flex flex-col items-center justify-center bg-neutral-800/30 rounded-lg border border-neutral-700/50 mb-4">
          <p className="text-neutral-500 text-sm mb-3">Allow location access to load imagery for your area</p>
          <button
            onClick={requestLocation}
            className="px-4 py-2 bg-sky-700 hover:bg-sky-600 text-white text-xs rounded transition-colors"
          >
            📍 Share My Location
          </button>
        </div>
      )}

      {/* Image — loading skeleton matches EPAMPanel */}
      {showImage && (
        loading ? (
          <div className="h-72 bg-neutral-800/50 rounded-lg animate-pulse" />
        ) : error ? (
          <div className="h-72 flex flex-col items-center justify-center bg-neutral-800/30 rounded-lg border border-neutral-700/50 gap-3 p-6 text-center">
            <span className="text-2xl">⚠</span>
            <p className="text-neutral-400 text-sm">{error}</p>
            <button
              onClick={fetchImage}
              className="px-3 py-1.5 bg-neutral-700 hover:bg-neutral-600 text-xs text-neutral-200 rounded transition-colors"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="relative bg-neutral-900/40 rounded-lg overflow-hidden">
            <img
              src={imgSrc}
              alt={`VIIRS DNB satellite imagery — ${currentRegion.label}`}
              className="w-full block rounded-lg"
            />
            <a
              href={fullResUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute bottom-2 right-2 px-2 py-1 bg-neutral-900/80 border border-neutral-700/60 text-neutral-400 hover:text-white text-xs rounded backdrop-blur-sm transition-colors"
            >
              ⤢ Full res
            </a>
          </div>
        )
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-xs text-neutral-600">
        <span><span className="inline-block w-2 h-2 rounded-full bg-white mr-1.5 align-middle" />Aurora / moonlit cloud</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-yellow-300 mr-1.5 align-middle" />City lights</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-blue-900 mr-1.5 align-middle" />Open ocean</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-slate-400 mr-1.5 align-middle" />Sea ice / snow</span>
      </div>

      {/* Footer — matches EPAMPanel */}
      <p className="text-xs text-neutral-700 mt-4 pt-3 border-t border-neutral-800 leading-relaxed">
        Imagery from the VIIRS Day-Night Band — available ~3–5 hours after satellite overpass. ·{' '}
        <a href="https://worldview.earthdata.nasa.gov/" target="_blank" rel="noopener noreferrer" className="text-neutral-600 hover:text-sky-400">
          NASA Worldview
        </a>{' '}·{' '}
        <a href="https://auroraalert.otago.ac.nz/aurora/" target="_blank" rel="noopener noreferrer" className="text-neutral-600 hover:text-sky-400">
          Otago Aurora Alert
        </a>
      </p>
    </div>
  );
};

export default SatelliteImageryPanel;
// --- END OF FILE src/components/SatelliteImageryPanel.tsx ---