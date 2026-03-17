import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { CircleMarker, MapContainer, Marker, Polygon, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { SightingReport, SightingStatus } from '../types';
import type { SubstormRiskData } from '../hooks/useForecastData';
import LoadingSpinner from './icons/LoadingSpinner';
import GuideIcon from './icons/GuideIcon';
import CloseIcon from './icons/CloseIcon';
import { NZ_TOWNS } from './nzSubstormIndexData';

// --- Local SVG Icon components for the UI ---
const GreenCheckIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
);

const RedCrossIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
);


// --- CONSTANTS & CONFIG ---
const API_URL = 'https://aurora-sightings.thenamesrock.workers.dev/';
const LOCAL_STORAGE_LAST_REPORT_KEY = 'aurora_sighting_last_report';
const REPORTING_COOLDOWN_MS = 5 * 60 * 1000;

const NZ_BOUNDS: L.LatLngBoundsLiteral = [[-48, 166], [-34, 179]];
const MAP_ZOOM = 5;
const HIGHLIGHT_MAP_ZOOM = 10;

const computeSunsetWindowStart = () => {
    const now = new Date();
    const sunset = new Date();
    sunset.setHours(18, 0, 0, 0);
    if (now.getTime() < sunset.getTime()) {
        sunset.setDate(sunset.getDate() - 1);
    }
    return sunset.getTime();
};

const STATUS_OPTIONS: { status: SightingStatus; emoji: string; label: string; description: string; category: 'visible' | 'nothing' | 'other' }[] = [
    { status: 'eye', emoji: '👁️', label: 'Naked Eye', description: 'Visible without a camera. You can see distinct shapes, structure, or even color with your eyes alone.', category: 'visible' },
    { status: 'phone', emoji: '📱', label: 'Phone Camera', description: 'Not visible to your eyes, but shows up clearly in a modern smartphone photo (e.g., a 3-second night mode shot).', category: 'visible' },
    { status: 'dslr', emoji: '📷', label: 'DSLR/Mirrorless', description: 'Only visible with a dedicated camera (DSLR/Mirrorless) on a tripod using a long exposure (e.g., >5 seconds).', category: 'visible' },
    { status: 'nothing-eye', emoji: '👁️', label: 'Naked Eye', description: 'The sky is clear, but no aurora is visible to your eyes. Reporting this is very helpful!', category: 'nothing' },
    { status: 'nothing-phone', emoji: '📱', label: 'Phone Camera', description: 'The sky is clear, but no aurora is visible in a smartphone photo.', category: 'nothing' },
    { status: 'nothing-dslr', emoji: '📷', label: 'DSLR/Mirrorless', description: 'The sky is clear, but no aurora is visible in a long-exposure shot.', category: 'nothing' },
    { status: 'cloudy', emoji: '☁️', label: 'Cloudy', description: 'Your view of the sky is mostly or completely obscured by clouds, preventing any possible sighting.', category: 'other' },
];

const getEmojiForStatus = (status: SightingStatus) => {
    const option = STATUS_OPTIONS.find(opt => opt.status === status);
    if (!option) return '❓';
    if (status.startsWith('nothing-')) {
        return `❌${option.emoji}`;
    }
    return option.emoji;
};

interface AuroraSightingsProps {
  isDaylight: boolean;
  refreshSignal?: number;
  onSightingsLoaded?: (sightings: SightingReport[]) => void;
  substormRiskData?: SubstormRiskData | null;
}

interface SightingMapControllerProps {
    selectedSightingId: string | null;
    sightings: SightingReport[];
    markerRefs: React.MutableRefObject<Map<string, L.Marker>>;
}

const SightingMapController: React.FC<SightingMapControllerProps> = ({
    selectedSightingId,
    sightings,
    markerRefs
}) => {
    const map = useMap();

    useEffect(() => {
        const timer = setTimeout(() => map.invalidateSize(), 100);
        return () => clearTimeout(timer);
    }, [map]);

    useEffect(() => {
        if (selectedSightingId) {
            const selectedSighting = sightings.find(s => (s.timestamp + s.name) === selectedSightingId);

            if (selectedSighting) {
                const targetLatLng: L.LatLngExpression = [selectedSighting.lat, selectedSighting.lng];
                const currentZoom = map.getZoom();
                const targetZoom = Math.max(currentZoom, HIGHLIGHT_MAP_ZOOM);

                map.flyTo(targetLatLng, targetZoom, {
                    duration: 1.5
                });

                setTimeout(() => {
                    const marker = markerRefs.current.get(selectedSightingId);
                    if (marker) {
                        marker.openPopup();
                    }
                }, 1600);
            }
        }
    }, [selectedSightingId, sightings, map, markerRefs]);

    return null;
};


const LocationFinder = ({ onLocationSelect }: { onLocationSelect: (latlng: L.LatLng) => void }) => {
    useMapEvents({ click(e) { onLocationSelect(e.latlng); } });
    return null;
};

const InfoModal: React.FC<{ isOpen: boolean; onClose: () => void; }> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[1000] flex justify-center items-center p-4" onClick={onClose}>
            <div className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] text-neutral-300 flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center p-4 border-b border-neutral-700/80">
                    <h3 className="text-xl font-bold text-neutral-200">How to Report a Sighting</h3>
                    <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"><CloseIcon className="w-6 h-6" /></button>
                </div>
                <div className="overflow-y-auto p-5 styled-scrollbar pr-4 space-y-5 text-sm">
                    <section>
                        <h4 className="font-semibold text-base text-neutral-200 mb-2">Placing Your Pin</h4>
                        <p>Your location is set automatically via GPS. If GPS is unavailable or permission is denied, tap anywhere on the map to place your pin manually — your report will be tagged to the nearest known location. GPS is always preferred for accuracy.</p>
                    </section>
                     <section>
                        <h4 className="font-semibold text-base text-neutral-200 mb-2">What Should I Report?</h4>
                        <p>Honest reports are crucial for everyone! Use the green check <GreenCheckIcon className="w-4 h-4 inline-block text-green-500" /> for positive sightings and the red cross <RedCrossIcon className="w-4 h-4 inline-block text-red-500" /> for clear skies with no aurora.</p>
                        <ul className="mt-3 space-y-3">
                            {STATUS_OPTIONS.filter(opt => opt.category === 'visible').map(({ emoji, label, description }) => (
                                <li key={label} className="flex items-start gap-4">
                                    <span className="text-3xl mt-[-4px]">{emoji}</span>
                                    <div> <strong className="font-semibold text-neutral-200">{label}</strong> <p className="text-neutral-400">{description}</p> </div>
                                </li>
                            ))}
                             <li className="flex items-start gap-4">
                                <span className="text-3xl mt-[-4px]">❌</span>
                                {/* MODIFIED: Updated text to describe the layered icon */}
                                <div> <strong className="font-semibold text-neutral-200">Nothing (per category)</strong> <p className="text-neutral-400">If your sky is clear but you can't see an aurora, please report it! This is extremely valuable data. On the map, these reports will show as a cross layered on top of the category icon.</p> </div>
                            </li>
                             <li className="flex items-start gap-4">
                                <span className="text-3xl mt-[-4px]">☁️</span>
                                <div> <strong className="font-semibold text-neutral-200">Cloudy</strong> <p className="text-neutral-400">If your view is obscured by clouds, preventing any possible sighting, please report it as cloudy.</p> </div>
                            </li>
                        </ul>
                    </section>
                </div>
            </div>
        </div>
    );
};


// ─────────────────────────────────────────────────────────────
// Aurora Oval Overlay — IGRF-13 dipole geomagnetic projection
// ─────────────────────────────────────────────────────────────

// IGRF-13 north magnetic dipole pole (geographic)
const POLE_LAT_RAD =  80.65 * Math.PI / 180;
const POLE_LON_RAD = -72.68 * Math.PI / 180;

function geoToGmag(latDeg: number, lonDeg: number): number {
  const φ = latDeg * Math.PI / 180;
  const λ = lonDeg * Math.PI / 180;
  const sin = Math.sin(φ) * Math.sin(POLE_LAT_RAD) +
              Math.cos(φ) * Math.cos(POLE_LAT_RAD) * Math.cos(λ - POLE_LON_RAD);
  return Math.asin(Math.max(-1, Math.min(1, sin))) * 180 / Math.PI;
}

function gmagToGeoLat(gmagLat: number, lonDeg: number): number {
  // Numerical inversion via bisection
  let lo = -90, hi = 90;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (geoToGmag(mid, lonDeg) < gmagLat) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function buildOvalRing(gmagLat: number, lonStep = 2): [number, number][] {
  const pts: [number, number][] = [];
  for (let lon = -180; lon <= 180; lon += lonStep) {
    const geoLat = gmagToGeoLat(gmagLat, lon);
    if (geoLat >= -85 && geoLat <= 85) pts.push([geoLat, lon]);
  }
  if (pts.length) pts.push(pts[0]); // close
  return pts;
}

function buildBandPolygon(gmagInner: number, gmagOuter: number, lonStep = 3): [number, number][] {
  const outer: [number, number][] = [];
  const inner: [number, number][] = [];
  for (let lon = -180; lon <= 180; lon += lonStep) {
    outer.push([gmagToGeoLat(gmagOuter, lon), lon]);
    inner.push([gmagToGeoLat(gmagInner, lon), lon]);
  }
  inner.reverse();
  return [...outer, ...inner];
}

// Activity → colour scale: grey → sky → green → amber → orange → red
function ovalColour(score: number): { line: string; fill: string; fillOpacity: number } {
  if (score >= 80) return { line: '#f87171', fill: '#f87171', fillOpacity: 0.22 };
  if (score >= 65) return { line: '#fb923c', fill: '#fb923c', fillOpacity: 0.20 };
  if (score >= 50) return { line: '#f59e0b', fill: '#f59e0b', fillOpacity: 0.18 };
  if (score >= 35) return { line: '#a3e635', fill: '#a3e635', fillOpacity: 0.15 };
  if (score >= 20) return { line: '#34d399', fill: '#34d399', fillOpacity: 0.12 };
  return             { line: '#38bdf8', fill: '#38bdf8', fillOpacity: 0.08 };
}

function computeOvalParams(metrics: SubstormRiskData['metrics'], bayOnset: boolean, score: number) {
  const newell60 = metrics?.solar_wind?.newell_avg_60m ?? 0;
  const newell30 = metrics?.solar_wind?.newell_avg_30m ?? 0;
  const newell   = Math.max(newell60, newell30 * 0.85);

  // Holzworth-Meng parameterisation via Newell coupling
  let boundary = -(65.5 - newell / 1800);
  boundary = Math.max(boundary, -76);
  boundary = Math.min(boundary, -44);
  if (bayOnset) boundary = Math.min(boundary, -47.2);

  // Band half-width: widens with activity
  const halfWidth = 3.5 + (score / 100) * 5.0;

  return { boundary, halfWidth };
}

// ── React overlay component ───────────────────────────────────
interface OvalOverlayProps {
  substormRiskData: SubstormRiskData | null | undefined;
}

const AuroraOvalOverlay: React.FC<OvalOverlayProps> = ({ substormRiskData }) => {
  const score    = substormRiskData?.current?.score     ?? 0;
  const bayOnset = substormRiskData?.current?.bay_onset_flag ?? false;
  const metrics  = substormRiskData?.metrics;

  if (!metrics) return null;

  const { boundary, halfWidth } = computeOvalParams(metrics, bayOnset, score);
  const poleward    = boundary - halfWidth;
  const equatorward = boundary;
  const { line, fill, fillOpacity } = ovalColour(score);

  // Build rings — only for southern hemisphere / NZ-visible longitudes
  // Use full global ring so the curve looks natural at all zoom levels
  const eqRing = buildOvalRing(equatorward, 1.5);
  const pwRing = buildOvalRing(poleward, 1.5);

  // Band split into 6 layers with decreasing opacity toward edges (Gaussian-like)
  const bandLayers = 6;
  const bandPolygons = Array.from({ length: bandLayers }, (_, i) => {
    const t0 = i / bandLayers;
    const t1 = (i + 1) / bandLayers;
    const g0 = poleward + t0 * halfWidth;
    const g1 = poleward + t1 * halfWidth;
    const midT = (t0 + t1) / 2;
    // Gaussian intensity — peak at centre of band
    const intensity = Math.exp(-Math.pow((midT - 0.5) / 0.28, 2));
    const alpha = intensity * fillOpacity * Math.min(score / 20, 1);
    return { poly: buildBandPolygon(g0, g1, 3), alpha };
  });

  return (
    <>
      {/* Probability fill band — layered polygons */}
      {bandPolygons.map((layer, i) => (
        <Polygon
          key={`band-${i}`}
          positions={layer.poly}
          pathOptions={{ color: 'transparent', fillColor: fill, fillOpacity: layer.alpha, weight: 0 }}
          smoothFactor={2}
        />
      ))}

      {/* Poleward boundary — dashed, dimmer */}
      <Polyline
        positions={pwRing}
        pathOptions={{ color: line, weight: 1, opacity: 0.35, dashArray: '4 6' }}
        smoothFactor={2}
      />

      {/* Equatorward boundary — solid, main indicator */}
      <Polyline
        positions={eqRing}
        pathOptions={{ color: line, weight: 2.5, opacity: 0.9, dashArray: score < 25 ? '6 5' : undefined }}
        smoothFactor={2}
      />
    </>
  );
};

const AuroraSightings: React.FC<AuroraSightingsProps> = ({ isDaylight, refreshSignal, onSightingsLoaded, substormRiskData }) => {
    const [sightings, setSightings] = useState<SightingReport[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);
    const [userPosition, setUserPosition] = useState<L.LatLng | null>(null);
    const [hasGpsLock, setHasGpsLock] = useState(false);
    const [gpsError, setGpsError] = useState<string | null>(null);
    const [gpsFailed, setGpsFailed] = useState(false);
    const [selectedStatus, setSelectedStatus] = useState<SightingStatus | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [pendingReport, setPendingReport] = useState<SightingReport | null>(null);
    const [lastReportInfo, setLastReportInfo] = useState<{timestamp: number, key: string} | null>(null);

    const [selectedSightingIdForMap, setSelectedSightingIdForMap] = useState<string | null>(null);
    const [sunsetWindowStart, setSunsetWindowStart] = useState<number>(() => computeSunsetWindowStart());

    const markerRefs = useRef<Map<string, L.Marker>>(new Map());

    const requestGpsFix = useCallback(() => {
        if (!navigator.geolocation) {
            setGpsError('GPS not supported on this device.');
            setHasGpsLock(false);
            setGpsFailed(true);
            return;
        }

        setGpsError(null);
        navigator.geolocation.getCurrentPosition(
            (position) => {
                setUserPosition(new L.LatLng(position.coords.latitude, position.coords.longitude));
                setHasGpsLock(true);
                setGpsFailed(false);
            },
            (err) => {
                setGpsError(`GPS unavailable. ${err.code === err.PERMISSION_DENIED ? 'Location permission denied.' : err.message}`);
                setHasGpsLock(false);
                setGpsFailed(true);
            },
            { timeout: 15000, enableHighAccuracy: true }
        );
    }, []);

    const fetchSightings = useCallback(async () => {
        try {
            setError(null);
            const response = await fetch(API_URL);
            if (!response.ok) throw new Error('Failed to fetch sightings data.');
            const data: SightingReport[] = await response.json();
            const sorted = data.sort((a, b) => b.timestamp - a.timestamp);
            setSightings(sorted);
            onSightingsLoaded?.(sorted);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An unknown error occurred.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        const lastReportString = localStorage.getItem(LOCAL_STORAGE_LAST_REPORT_KEY);
        if (lastReportString) setLastReportInfo(JSON.parse(lastReportString));
        fetchSightings();
        requestGpsFix();
        const intervalId = setInterval(fetchSightings, 2 * 60 * 1000);
        return () => {
            clearInterval(intervalId);
            markerRefs.current.clear();
        }
    }, [fetchSightings, requestGpsFix]);

    useEffect(() => {
        if (refreshSignal !== undefined) {
            fetchSightings();
        }
    }, [fetchSightings, refreshSignal]);

    useEffect(() => {
        const timer = setInterval(() => setSunsetWindowStart(computeSunsetWindowStart()), 5 * 60 * 1000);
        return () => clearInterval(timer);
    }, []);

    const cooldownRemaining = useMemo(() => {
        if (!lastReportInfo) return 0;
        const timePassed = Date.now() - lastReportInfo.timestamp;
        return Math.max(0, REPORTING_COOLDOWN_MS - timePassed);
    }, [lastReportInfo]);

    const canSubmit = !isSubmitting && cooldownRemaining === 0 && !isDaylight && (hasGpsLock || (gpsFailed && userPosition !== null));

    const findNearestTownName = useCallback((lat: number, lon: number) => {
        const toRad = (deg: number) => (deg * Math.PI) / 180;
        const haversine = (town: { lat: number; lon: number }) => {
            const dLat = toRad(lat - town.lat);
            const dLon = toRad(lon - town.lon);
            const lat1 = toRad(town.lat);
            const lat2 = toRad(lat);
            const h =
                Math.sin(dLat / 2) ** 2 +
                Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
            return 6371 * 2 * Math.asin(Math.sqrt(h));
        };

        let nearest = NZ_TOWNS[0];
        let best = Number.POSITIVE_INFINITY;
        for (const town of NZ_TOWNS) {
            const dist = haversine(town);
            if (dist < best) {
                best = dist;
                nearest = town;
            }
        }
        // If more than 15km from the nearest known place, prefix with "near "
        return best > 15 ? `near ${nearest.name}` : nearest.name;
    }, []);

    const handleSubmit = async () => {
        if (!userPosition || !selectedStatus || !canSubmit) {
            const alertMsg = [
                !hasGpsLock && 'GPS is required to submit. Please enable location services to continue.',
                !userPosition && 'Please set your location by enabling GPS. Tap "Try GPS again" if needed.',
                !selectedStatus && 'Please select your sighting status.',
                !canSubmit && (isDaylight ? 'Sighting reports are disabled during daylight hours.' : `You can only report once every ${REPORTING_COOLDOWN_MS / 60000} minutes.`)
            ].filter(Boolean).join('\n');
            if (alertMsg) alert(alertMsg);
            return;
        }

        setIsSubmitting(true);
        setError(null);
        const reportData: Omit<SightingReport, 'timestamp'> = {
            lat: userPosition.lat,
            lng: userPosition.lng,
            status: selectedStatus,
            name: findNearestTownName(userPosition.lat, userPosition.lng)
        };
        const pendingSighting: SightingReport = { ...reportData, timestamp: Date.now(), isPending: true };
        setPendingReport(pendingSighting);

        try {
            const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reportData) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Submission failed.');
            const newReportInfo = { timestamp: Date.now(), key: result.key };
            setLastReportInfo(newReportInfo);
            localStorage.setItem(LOCAL_STORAGE_LAST_REPORT_KEY, JSON.stringify(newReportInfo));
            await fetchSightings();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An unknown error occurred.');
        } finally {
            setIsSubmitting(false);
            setPendingReport(null);
        }
    };

    const handleTableRowClick = useCallback((sightingId: string) => {
        setSelectedSightingIdForMap(sightingId);
    }, []);

    const userMarkerIcon = L.divIcon({ html: `<div class="relative flex h-5 w-5"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span><span class="relative inline-flex rounded-full h-5 w-5 bg-sky-500 border-2 border-white"></span></div>`, className: '', iconSize: [20, 20], iconAnchor: [10, 10], });
    
    // MODIFIED: This function now creates a layered icon for "nothing" reports
    const createSightingIcon = (sighting: SightingReport) => {
        const fullEmojiString = getEmojiForStatus(sighting.status);
        const sendingAnimation = sighting.isPending ? `<div class="absolute inset-0 flex items-center justify-center text-white text-xs animate-pulse">sending...</div><div class="absolute inset-0 bg-black rounded-full opacity-60"></div>` : '';
        
        let iconHtml: string;

        if (fullEmojiString.startsWith('❌')) {
            const baseEmoji = fullEmojiString.substring(1);
            iconHtml = `
                <div class="relative w-full h-full flex items-center justify-center">
                    ${sendingAnimation}
                    <span class="absolute text-3xl">${baseEmoji}</span>
                    <span class="absolute text-3xl" style="text-shadow: 0 0 4px #000, 0 0 6px #000;">❌</span>
                </div>
            `;
        } else {
            iconHtml = `<div class="relative">${sendingAnimation}<div>${fullEmojiString}</div></div>`;
        }

        return L.divIcon({
            html: iconHtml,
            className: 'emoji-marker',
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });
    };

    const reportsSinceSunset = useMemo(
        () => sightings.filter(sighting => sighting.timestamp >= sunsetWindowStart).length,
        [sightings, sunsetWindowStart]
    );

    return (
        <div className="col-span-12 card bg-neutral-950/80 p-6 space-y-6">
            <div className="text-center space-y-2">
                <div className="flex justify-center items-center gap-2">
                     <h2 className="text-2xl font-bold text-white">Spotting The Aurora</h2>
                     <button onClick={() => setIsInfoModalOpen(true)} className="p-1 text-neutral-400 hover:text-neutral-100" title="How to use the sightings map">
                        <GuideIcon className="w-6 h-6" />
                     </button>
                </div>
                <p className="text-neutral-400 mt-1 max-w-2xl mx-auto">Help the community by reporting what you see (or don't see!) from all over NZ. Honest reports, including clouds or clear skies with no aurora, are essential for everyone.</p>
                <div className="inline-flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-400/40 rounded-full text-amber-200 text-sm font-semibold">
                    <span className="inline-flex h-2 w-2 bg-amber-300 rounded-full animate-pulse" aria-hidden="true" />
                    GPS is used for your location. If GPS is unavailable, you can place a pin on the map.
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center bg-neutral-900 p-4 rounded-lg relative">
                {isDaylight && (
                    <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex justify-center items-center rounded-lg z-10">
                        <p className="text-amber-400 font-semibold text-lg text-center p-4">Reporting is disabled during daylight hours</p>
                    </div>
                )}
                <div className="col-span-12 md:col-span-3 space-y-2">
                    <div className="text-xs text-neutral-400 bg-neutral-800/60 border border-neutral-700 rounded px-3 py-2">
                        Reports are tagged to the nearest suburb, town, or landmark automatically.
                    </div>
                </div>

                <div className="col-span-12 md:col-span-9 space-y-4">
                    <div>
                        <p className="text-sm font-semibold text-neutral-300 mb-2 text-center md:text-left flex items-center justify-center md:justify-start gap-2">
                            <GreenCheckIcon className="w-5 h-5 text-green-500" />
                            I SAW something with my:
                        </p>
                        <div className="flex flex-wrap justify-center md:justify-start gap-2">
                            {STATUS_OPTIONS.filter(opt => opt.category === 'visible').map(({ status, emoji, label }) => (
                                <button key={status} onClick={() => setSelectedStatus(status)} className={`px-3 py-2 rounded-lg border-2 transition-all text-sm flex items-center gap-2 ${selectedStatus === status ? 'border-sky-400 bg-sky-500/20' : 'border-neutral-700 bg-neutral-800 hover:bg-neutral-700'}`} title={label}>
                                    <span className="text-lg">{emoji}</span>
                                    <span className="hidden sm:inline">{label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-neutral-300 mb-2 text-center md:text-left flex items-center justify-center md:justify-start gap-2">
                            <RedCrossIcon className="w-5 h-5 text-red-500" />
                            The sky is CLEAR, but I SAW NOTHING with my:
                        </p>
                        <div className="flex flex-wrap justify-center md:justify-start gap-2">
                            {STATUS_OPTIONS.filter(opt => opt.category === 'nothing').map(({ status, emoji, label }) => (
                                <button key={status} onClick={() => setSelectedStatus(status)} className={`px-3 py-2 rounded-lg border-2 transition-all text-sm flex items-center gap-2 ${selectedStatus === status ? 'border-sky-400 bg-sky-500/20' : 'border-neutral-700 bg-neutral-800 hover:bg-neutral-700'}`} title={`Report clear sky but no aurora visible to ${label}`}>
                                    <span className="text-lg">{emoji}</span>
                                    <span className="hidden sm:inline">{label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2 border-t border-neutral-700/50">
                        <div className="flex-grow">
                            <p className="text-sm font-semibold text-neutral-300 mb-2 text-center sm:text-left">My view is:</p>
                            <div className="flex flex-wrap justify-center sm:justify-start gap-2">
                                {STATUS_OPTIONS.filter(opt => opt.category === 'other').map(({ status, emoji, label }) => (
                                    <button key={status} onClick={() => setSelectedStatus(status)} className={`px-3 py-2 rounded-lg border-2 transition-all text-sm flex items-center gap-2 ${selectedStatus === status ? 'border-sky-400 bg-sky-500/20' : 'border-neutral-700 bg-neutral-800 hover:bg-neutral-700'}`} title={label}>
                                        <span className="text-lg">{emoji}</span>
                                        <span className="hidden sm:inline">{label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="w-full sm:w-auto flex flex-col gap-2">
                            {!hasGpsLock && !gpsFailed && (
                                <div className="flex items-center gap-2 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded px-3 py-2">
                                    <span className="inline-flex h-2 w-2 bg-amber-300 rounded-full animate-pulse" aria-hidden="true" />
                                    Waiting for GPS… tap "Try GPS again" if needed.
                                </div>
                            )}
                            {gpsFailed && !userPosition && (
                                <div className="flex items-center gap-2 text-xs text-sky-200 bg-sky-500/10 border border-sky-500/30 rounded px-3 py-2">
                                    <span className="inline-flex h-2 w-2 bg-sky-300 rounded-full animate-pulse" aria-hidden="true" />
                                    GPS unavailable — tap the map to place your pin manually.
                                </div>
                            )}
                            {gpsFailed && userPosition && (
                                <div className="flex items-center gap-2 text-xs text-green-200 bg-green-500/10 border border-green-500/30 rounded px-3 py-2">
                                    <span className="inline-flex h-2 w-2 bg-green-300 rounded-full" aria-hidden="true" />
                                    Pin placed at {findNearestTownName(userPosition.lat, userPosition.lng)}. Tap map to reposition.
                                </div>
                            )}
                            <button onClick={requestGpsFix} className="w-full sm:w-auto px-6 py-2 rounded-lg text-sm font-semibold border border-sky-400/60 text-sky-100 bg-sky-500/10 hover:bg-sky-500/20 transition-colors">Try GPS again</button>
                            {gpsError && <p className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded px-3 py-2">{gpsError}</p>}
                            <button onClick={handleSubmit} disabled={!canSubmit || isSubmitting} className="w-full sm:w-auto px-6 py-3 rounded-lg text-white font-semibold transition-colors disabled:bg-neutral-600 disabled:cursor-not-allowed flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500">
                                {isSubmitting ? <LoadingSpinner /> : 'Submit Report'}
                            </button>
                        </div>
                    </div>
                </div>
                {cooldownRemaining > 0 && !isDaylight && <p className="col-span-12 text-center text-xs text-amber-400 mt-2">You can submit again in {Math.ceil(cooldownRemaining / 60000)} minutes.</p>}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 h-[500px] rounded-lg overflow-hidden border border-neutral-700">
                    <MapContainer
                        center={[(NZ_BOUNDS[0][0] + NZ_BOUNDS[1][0]) / 2, (NZ_BOUNDS[0][1] + NZ_BOUNDS[1][1]) / 2]}
                        zoom={MAP_ZOOM}
                        scrollWheelZoom={false}
                        dragging={!L.Browser.mobile}
                        touchZoom={true}
                        minZoom={MAP_ZOOM}
                        maxBounds={NZ_BOUNDS}
                        className="h-full w-full bg-neutral-800"
                    >
                        <SightingMapController
                            selectedSightingId={selectedSightingIdForMap}
                            sightings={sightings}
                            markerRefs={markerRefs}
                        />

                        <TileLayer attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>' url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"/>
        <AuroraOvalOverlay substormRiskData={substormRiskData} />
                        <LocationFinder onLocationSelect={(latlng) => { if (gpsFailed) setUserPosition(latlng); }} />
                        {userPosition && <Marker position={userPosition} icon={userMarkerIcon} draggable={false}><Popup>{hasGpsLock ? 'Your GPS location.' : 'Your manually placed pin.'}</Popup></Marker>}
                        <>
                             {sightings.map(sighting => {
                                const sightingId = sighting.timestamp + sighting.name;
                                return (
                                    <Marker
                                        key={sightingId}
                                        position={[sighting.lat, sighting.lng]}
                                        icon={createSightingIcon(sighting)}
                                        zIndexOffset={sighting.timestamp}
                                        ref={(marker: L.Marker) => {
                                            if (marker) {
                                                markerRefs.current.set(sightingId, marker);
                                            } else {
                                                markerRefs.current.delete(sightingId);
                                            }
                                        }}
                                    >
                                        <Popup>
                                            <strong>{sighting.name}</strong> (nearest town) reported: {getEmojiForStatus(sighting.status)} <br/> at {new Date(sighting.timestamp).toLocaleTimeString('en-NZ')}
                                        </Popup>
                                    </Marker>
                                );
                            })}
                        </>
                        {pendingReport && <Marker position={[pendingReport.lat, pendingReport.lng]} icon={createSightingIcon(pendingReport)} zIndexOffset={99999999999999} />}
                    </MapContainer>
                </div>

                <div className="lg:col-span-1 space-y-3">
                     <h3 className="text-xl font-semibold text-white">Latest 5 Reports</h3>
                     <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left text-neutral-400">
                            <thead className="text-xs text-neutral-300 uppercase bg-neutral-800"><tr><th scope="col" className="px-4 py-2">Time</th><th scope="col" className="px-4 py-2">Nearest Town</th><th scope="col" className="px-4 py-2">Report</th></tr></thead>
                            <tbody>
                                {isLoading ? ( <tr><td colSpan={3} className="text-center p-4 italic">Loading reports...</td></tr> ) : sightings.length === 0 ? ( <tr><td colSpan={3} className="text-center p-4 italic">No reports since sunset today.</td></tr> ) : sightings.slice(0, 5).map(s => (
                                    <tr
                                        key={s.timestamp + s.name}
                                        className="bg-neutral-900 border-b border-neutral-800 cursor-pointer hover:bg-neutral-800"
                                        onClick={() => handleTableRowClick(s.timestamp + s.name)}
                                    >
                                        <td className="px-4 py-2">{new Date(s.timestamp).toLocaleTimeString('en-NZ')}</td>
                                        <td className="px-4 py-2 font-medium text-neutral-200">{s.name}</td>
                                        <td className="px-4 py-2 text-2xl" title={s.status}>{getEmojiForStatus(s.status)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
                     </div>
                </div>
            </div>
            <div className="flex justify-center pt-2">
                <div className="mt-2 inline-flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-full text-sm text-white/90">
                    <span className="inline-flex h-2 w-2 bg-emerald-300 rounded-full" aria-hidden="true" />
                    Reports since sunset today: {isLoading ? '…' : reportsSinceSunset}
                </div>
            </div>
            <p className="text-xs text-neutral-400 text-center">This count refreshes as new reports arrive after today's sunset.</p>
            <InfoModal isOpen={isInfoModalOpen} onClose={() => setIsInfoModalOpen(false)} />
        </div>
    );
};

export default AuroraSightings;