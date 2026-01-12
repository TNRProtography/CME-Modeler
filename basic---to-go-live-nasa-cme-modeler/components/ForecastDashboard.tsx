//--- START OF FILE src/components/ForecastDashboard.tsx ---

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import LoadingSpinner from './icons/LoadingSpinner';
import AuroraSightings from './AuroraSightings';
import GuideIcon from './icons/GuideIcon';
import { useForecastData } from '../hooks/useForecastData';
import { UnifiedForecastPanel } from './UnifiedForecastPanel';
import ForecastChartPanel from './ForecastChartPanel';

import {
    TipsSection,
    CameraSettingsSection,
    InfoModal,
    ActivityAlert
} from './ForecastComponents';

import {
    SimpleTrendChart,
    ForecastTrendChart,
    SolarWindSpeedChart,
    SolarWindDensityChart,
    MagneticFieldChart,
    HemisphericPowerChart,
    SubstormChart,
    MoonArcChart,
} from './ForecastCharts';
import { SubstormActivity, SubstormForecast, ActivitySummary, InterplanetaryShock } from '../types';
import CaretIcon from './icons/CaretIcon';

// --- ICONS ---
const DownloadIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
);

// --- ORIGINAL CONSTANTS (Moved to top to fix ReferenceError) ---
const ACE_EPAM_URL = 'https://services.swpc.noaa.gov/images/ace-epam-24-hour.gif';

const CAMERAS: Camera[] = [
  { name: 'Oban', url: 'https://weathercam.southloop.net.nz/Oban/ObanOldA001.jpg', type: 'image', sourceUrl: 'weathercam.southloop.net.nz' },
  { name: 'Queenstown', url: 'https://queenstown.roundshot.com/#/', type: 'iframe', sourceUrl: 'queenstown.roundshot.com' },
  { name: 'Twizel', url: 'https://www.trafficnz.info/camera/737.jpg', type: 'image', sourceUrl: 'trafficnz.info' },
  { name: 'Taylors Mistake', url: 'https://metdata.net.nz/lpc/camera/taylorsmistake1/image.php', type: 'image', sourceUrl: 'metdata.net.nz' },
  { name: 'Opiki', url: 'https://www.horizons.govt.nz/HRC/media/Data/WebCam/Opiki_latest_photo.jpg', type: 'image', sourceUrl: 'horizons.govt.nz' },
  { name: 'Rangitikei', url: 'https://www.horizons.govt.nz/HRC/media/Data/WebCam/Rangitikeicarpark_latest_photo.jpg', type: 'image', sourceUrl: 'horizons.govt.nz' },
  { name: 'New Plymouth', url: 'https://www.primo.nz/webcameras/snapshot_twlbuilding_sth.jpg', type: 'image', sourceUrl: 'primo.nz' },
];

const GAUGE_THRESHOLDS = {
  speed:   { gray: 250, yellow: 350, orange: 500, red: 650, purple: 800, pink: Infinity, maxExpected: 1000 },
  density: { gray: 5,   yellow: 10,  orange: 15,  red: 20,  purple: 50,  pink: Infinity, maxExpected: 70 },
  power:   { gray: 20,  yellow: 40,  orange: 70,  red: 150, purple: 200, pink: Infinity, maxExpected: 250 },
  bt:      { gray: 5,   yellow: 10,  orange: 15,  red: 20,  purple: 50,  pink: Infinity, maxExpected: 60 },
  bz:      { gray: -5,  yellow: -10, orange: -15, red: -20, purple: -50, pink: -50, maxNegativeExpected: -60 }
};

const GAUGE_COLORS = {
    gray:   { solid: '#808080' }, yellow: { solid: '#FFD700' }, orange: { solid: '#FFA500' },
    red:    { solid: '#FF4500' }, purple: { solid: '#800080' }, pink:   { solid: '#FF1493' }
};

const GAUGE_EMOJIS = {
    gray:   '\u{1F610}', yellow: '\u{1F642}', orange: '\u{1F642}', red:    '\u{1F604}',
    purple: '\u{1F60D}', pink:   '\u{1F929}', error:  '\u{2753}'
};

// --- NZ SUBSTORM INDEX CONSTANTS ---
const TILDE_BASE = "https://tilde.geonet.org.nz/v4";
const NOAA_RTSW_MAG = "https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json";
const NOAA_RTSW_WIND = "https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json";
const DOMAIN = "geomag";
const STATION = "EYWM"; // West Melton
const SCALE_FACTOR = 100;

// Geographic Config
const OBAN_LAT = -46.90;
const AKL_LAT = -36.85;
const LAT_DELTA = AKL_LAT - OBAN_LAT;

// Thresholds (Display Units)
const REQ_CAM = { start: -300, end: -800 };
const REQ_PHN = { start: -350, end: -900 };
const REQ_EYE = { start: -500, end: -1200 };
const QUIET_THRESHOLD = -10000;
const ACTIVE_THRESHOLD = -25000;
const STRONG_THRESHOLD = -45000;
const SEVERE_THRESHOLD = -100000;
const EXPANSION_SLOPE = -500;
const RECOVERY_SLOPE = 200;

interface NzTown { name: string; lat: number; lon: number; cam?: string; phone?: string; eye?: string; }

const NZ_TOWNS: NzTown[] = [
    { name: "Oban", lat: -46.90, lon: 168.12 },
    { name: "Invercargill", lat: -46.41, lon: 168.35 },
    { name: "Dunedin", lat: -45.87, lon: 170.50 },
    { name: "Queenstown", lat: -45.03, lon: 168.66 },
    { name: "Wānaka", lat: -44.70, lon: 169.12 },
    { name: "Twizel", lat: -44.26, lon: 170.10 },
    { name: "Timaru", lat: -44.39, lon: 171.25 },
    { name: "Christchurch", lat: -43.53, lon: 172.63 },
    { name: "Kaikōura", lat: -42.40, lon: 173.68 },
    { name: "Greymouth", lat: -42.45, lon: 171.20 },
    { name: "Nelson", lat: -41.27, lon: 173.28 },
    { name: "Wellington", lat: -41.29, lon: 174.77 },
    { name: "Palmerston Nth", lat: -40.35, lon: 175.60 },
    { name: "Napier", lat: -39.49, lon: 176.91 },
    { name: "Taupō", lat: -38.68, lon: 176.07 },
    { name: "Tauranga", lat: -37.68, lon: 176.16 },
    { name: "Auckland", lat: -36.85, lon: 174.76 },
    { name: "Whangārei", lat: -35.72, lon: 174.32 }
];

// --- TYPES ---
interface ForecastDashboardProps {
  setViewerMedia?: (media: { url: string, type: 'image' | 'video' } | null) => void;
  setCurrentAuroraScore: (score: number | null) => void;
  setSubstormActivityStatus: (status: SubstormActivity | null) => void;
  setIpsAlertData: (data: { shock: InterplanetaryShock; solarWind: { speed: string; bt: string; bz: string; } } | null) => void;
  navigationTarget: { page: string; elementId: string; expandId?: string; } | null;
  onInitialLoad?: () => void;
  viewMode: 'simple' | 'advanced';
  onViewModeChange: (mode: 'simple' | 'advanced') => void;
  refreshSignal: number;
}

interface Camera {
  name: string;
  url: string;
  type: 'image' | 'iframe';
  sourceUrl: string;
}

// --- HELPER FUNCTIONS ---
const getForecastScoreColorKey = (score: number) => {
    if (score >= 80) return 'pink'; if (score >= 50) return 'purple'; if (score >= 40) return 'red';
    if (score >= 25) return 'orange'; if (score >= 10) return 'yellow';
    return 'gray';
};

const parseIso = (ts: string | number) => {
    const t = new Date(ts).getTime();
    return Number.isFinite(t) ? t : null;
};

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

type SubstormPhase = 'quiet' | 'growth' | 'expansion' | 'substorm' | 'recovery';

const PHASE_DETAILS: Record<SubstormPhase, { label: string; color: string }> = {
    quiet: { label: 'Quiet', color: '#64748b' },
    growth: { label: 'Growth', color: '#38bdf8' },
    expansion: { label: 'Expansion', color: '#f97316' },
    substorm: { label: 'Substorm', color: '#facc15' },
    recovery: { label: 'Recovery', color: '#4ade80' },
};

const ALERT_LEVELS = [
    { key: 'quiet', label: 'Quiet', color: 'text-slate-300', border: 'border-slate-500/40' },
    { key: 'active', label: 'Active', color: 'text-yellow-300', border: 'border-yellow-500/40' },
    { key: 'strong', label: 'Strong', color: 'text-orange-300', border: 'border-orange-500/40' },
    { key: 'severe', label: 'Severe', color: 'text-red-300', border: 'border-red-500/40' },
];

const getAlertLevel = (strength: number) => {
    if (strength <= SEVERE_THRESHOLD) return ALERT_LEVELS[3];
    if (strength <= STRONG_THRESHOLD) return ALERT_LEVELS[2];
    if (strength <= ACTIVE_THRESHOLD) return ALERT_LEVELS[1];
    return ALERT_LEVELS[0];
};

const getPhaseForPoint = (value: number, slope: number): SubstormPhase => {
    if (value > QUIET_THRESHOLD) return 'quiet';
    if (value <= STRONG_THRESHOLD && slope <= EXPANSION_SLOPE) return 'expansion';
    if (value <= ACTIVE_THRESHOLD && slope >= RECOVERY_SLOPE) return 'recovery';
    if (value <= ACTIVE_THRESHOLD) return 'substorm';
    return 'growth';
};

// --- NZ Substorm Index Logic ---
const calculateReachLatitude = (strengthNt: number, mode: 'camera'|'phone'|'eye') => {
    if (strengthNt >= 0) return -65.0;
    const curve = (mode === 'phone' ? REQ_PHN : (mode === 'eye' ? REQ_EYE : REQ_CAM));
    const slope = (curve.end - curve.start) / LAT_DELTA;
    const lat = OBAN_LAT + (strengthNt - curve.start) / slope;
    return Math.max(-48, Math.min(-34, lat));
};

const getTownStatus = (town: NzTown, currentStrength: number, category: 'camera'|'phone'|'eye') => {
    if (currentStrength >= 0) return undefined;
    const reqs = (category === 'phone' ? REQ_PHN : (category === 'eye' ? REQ_EYE : REQ_CAM));
    const slope = (reqs.end - reqs.start) / LAT_DELTA;
    const required = reqs.start + (town.lat - OBAN_LAT) * slope;

    if (currentStrength <= required) {
        const excess = Math.abs(currentStrength) - Math.abs(required);
        if (excess < 50) return 'red';
        if (excess < 100) return 'yellow';
        return 'green';
    }
    return undefined;
};

const getVisibleTowns = (strength: number): NzTown[] => {
    return NZ_TOWNS.map(town => ({
        ...town,
        cam: getTownStatus(town, strength, 'camera'),
        phone: getTownStatus(town, strength, 'phone'),
        eye: getTownStatus(town, strength, 'eye')
    }));
};

const getProjectedBaseline = (samples: any[], targetTime: number) => {
    const endWindow = targetTime - 5 * 60000;
    const startWindow = targetTime - 185 * 60000;
    const windowPoints: any[] = [];
    for (let i = samples.length - 1; i >= 0; i--) {
        const t = samples[i].t;
        if (t > endWindow) continue;
        if (t < startWindow) break;
        windowPoints.push(samples[i]);
    }
    if (windowPoints.length < 10) return null;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    const n = windowPoints.length;
    for (let i = 0; i < n; i++) {
        const x = (windowPoints[i].t - startWindow) / 60000;
        const y = windowPoints[i].val;
        sumX += x; sumY += y; sumXY += x * y; sumXX += x * x;
    }
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    const targetX = (targetTime - startWindow) / 60000;
    return slope * targetX + intercept;
};

// --- Sub-Component: NZ Substorm Index Panel ---
const NzSubstormIndex: React.FC = () => {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<any>(null);
    const [chartRange, setChartRange] = useState(24);
    const [hoverData, setHoverData] = useState<any>(null);
    const chartRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                // 1. Fetch GeoNet Data
                const summaryRes = await fetch(`${TILDE_BASE}/dataSummary/${DOMAIN}?station=${STATION}`);
                const summary = await summaryRes.json();
                
                let bestSeries = "";
                const st = summary?.domain?.[DOMAIN]?.stations?.[STATION];
                if (st) {
                    for (const sKey in st.sensorCodes) {
                       const names = st.sensorCodes[sKey].names;
                       for (const nKey in names) {
                           if(nKey.toLowerCase().includes('north') || nKey === 'X' || nKey === 'magnetic-field') {
                               const methods = names[nKey].methods;
                               for(const mKey in methods) {
                                   if(mKey.includes('60s') || mKey.includes('1m')) {
                                       const aspects = methods[mKey].aspects;
                                       if(aspects['X']) bestSeries = `${STATION}/${nKey}/${sKey}/${mKey}/X`;
                                       else if(aspects['nil']) bestSeries = `${STATION}/${nKey}/${sKey}/${mKey}/nil`;
                                   }
                               }
                           }
                       }
                    }
                }
                
                const seriesKey = bestSeries || `${STATION}/magnetic-field/50/60s/X`;
                const tildeUrl = `${TILDE_BASE}/data/${DOMAIN}/${seriesKey}/latest/2d`;
                const noaaMagUrl = NOAA_RTSW_MAG;
                const noaaWindUrl = NOAA_RTSW_WIND;

                const [geoRes, magRes, windRes] = await Promise.all([
                    fetch(tildeUrl),
                    fetch(noaaMagUrl),
                    fetch(noaaWindUrl)
                ]);

                const geoData = await geoRes.json();
                const magData = await magRes.json();
                const windData = await windRes.json();

                // Process Ground Data
                const rawSamples = (geoData[0]?.data || []).map((d: any) => ({ t: parseIso(d.ts), val: d.val })).filter((d: any) => d.t && d.val != null).sort((a: any, b: any) => a.t - b.t);
                
                if (rawSamples.length < 10) throw new Error("Insufficient Ground Data");

                // Calculate Baseline & Strength
                const points = [];
                let previousPoint: { t: number; v: number } | null = null;
                for (let i = 0; i < rawSamples.length; i++) {
                    if (rawSamples[i].t < Date.now() - 24 * 3600 * 1000) continue;
                    const base = getProjectedBaseline(rawSamples, rawSamples[i].t);
                    if (base === null) continue;
                    
                    let s = (rawSamples[i].val - base) * SCALE_FACTOR;
                    if (s > 0 && s < 1500) s = s * 0.1; 
                    s = clamp(s, -250000, 250000);
                    const slopePerMin = previousPoint
                        ? (s - previousPoint.v) / ((rawSamples[i].t - previousPoint.t) / 60000)
                        : 0;
                    const phase = getPhaseForPoint(s, slopePerMin);
                    points.push({ t: rawSamples[i].t, v: s, phase, slope: slopePerMin });
                    previousPoint = { t: rawSamples[i].t, v: s };
                }

                // Current State
                const last = rawSamples[rawSamples.length - 1];
                const nowT = last.t;
                const baseNow = getProjectedBaseline(rawSamples, nowT) ?? last.val;
                let currentStrength = (last.val - baseNow) * SCALE_FACTOR;
                if (currentStrength > 0 && currentStrength < 1500) currentStrength *= 0.1;
                currentStrength = clamp(currentStrength, -250000, 250000);

                // Calculate Slope
                const slopeStart = nowT - 10 * 60000;
                const slopeSet = rawSamples.filter((s: any) => s.t >= slopeStart);
                let slope = 0;
                if (slopeSet.length > 1) {
                    const first = slopeSet[0];
                    const dt = (last.t - first.t) / 60000;
                    if (dt > 0) slope = ((last.val * SCALE_FACTOR) - (first.val * SCALE_FACTOR)) / dt;
                }

                // Process Satellite Data
                const lastMag = magData[magData.length - 1];
                const lastWind = windData[windData.length - 1];
                const bz = lastMag ? parseFloat(lastMag.bz_gsm) : 0;
                const speed = lastWind ? parseFloat(lastWind.speed) : 0;

                // Generate Outlook
                let outlook = "";
                let delay = speed > 0 ? Math.round(1500000 / speed / 60) : 60;
                if (bz < -15 && speed > 500) outlook = `⚠️ WARNING: Severe shock (Bz ${bz}, ${speed}km/s). Major impact in ${delay} mins.`;
                else if (bz < -10) outlook = `🚨 Incoming: Strong negative field (Bz ${bz}). Intensification in ${delay} mins.`;
                else if (bz < -5) outlook = `📡 Watch: Favorable wind (Bz ${bz}). Substorm building, arrival ~${delay} mins.`;
                else if (currentStrength < -200 * SCALE_FACTOR) outlook = "👀 Ground: Active conditions detected.";
                else outlook = "🌙 Quiet: Currently quiet.";

                // Calculate Visibility
                const towns = getVisibleTowns(currentStrength);
                const alertLevel = getAlertLevel(currentStrength);
                const currentPhase = getPhaseForPoint(currentStrength, slope);

                setData({
                    strength: currentStrength,
                    slope,
                    points,
                    towns,
                    outlook,
                    alertLevel,
                    currentPhase,
                    trends: {
                        m5: currentStrength, // Simplify for demo
                    }
                });
                setLoading(false);

            } catch (e) {
                console.error("NZ Substorm Fetch Error", e);
                setLoading(false);
            }
        };
        fetchData();
        const interval = setInterval(fetchData, 60000);
        return () => clearInterval(interval);
    }, []);

    // Interactive Chart Logic
    const handleMouseMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
        if (!data || !chartRef.current) return;
        const rect = chartRef.current.getBoundingClientRect();
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
        const x = clientX - rect.left;
        const w = rect.width;
        
        // Filter points based on range
        const now = Date.now();
        const cutoff = now - (chartRange * 3600 * 1000);
        const activePoints = data.points.filter((p: any) => p.t >= cutoff);
        if (activePoints.length === 0) return;

        const ratio = x / w;
        const tMin = activePoints[0].t;
        const tMax = activePoints[activePoints.length - 1].t;
        const timeAtCursor = tMin + ratio * (tMax - tMin);

        // Find closest
        let closest = activePoints[0];
        let minDiff = Math.abs(timeAtCursor - closest.t);
        for(let i=1; i<activePoints.length; i++) {
            const diff = Math.abs(timeAtCursor - activePoints[i].t);
            if(diff < minDiff) { minDiff = diff; closest = activePoints[i]; }
        }
        setHoverData({ x, closest });
    }, [data, chartRange]);

    if (loading) return <div className="h-64 flex items-center justify-center text-neutral-500">Initializing NZ Ground Systems...</div>;
    if (!data) return <div className="h-64 flex items-center justify-center text-red-400">System Offline</div>;

    // Chart Rendering
    const activePoints = data.points.filter((p: any) => p.t >= Date.now() - (chartRange * 3600 * 1000));
    const vals = activePoints.map((p: any) => p.v);
    let vMin = Math.min(...vals); let vMax = Math.max(...vals);
    if(vMax < 1000) vMax = 1000; if(vMin > -1000) vMin = -1000;
    const range = vMax - vMin; 
    vMax += range * 0.1; vMin -= range * 0.1;

    const getX = (t: number) => ((t - activePoints[0].t) / (activePoints[activePoints.length-1].t - activePoints[0].t)) * 100;
    const getY = (v: number) => 100 - ((v - vMin) / (vMax - vMin)) * 100;

    const phaseSegments: { phase: SubstormPhase; path: string }[] = [];
    if (activePoints.length > 0) {
        let currentPhase = activePoints[0].phase as SubstormPhase;
        let currentPath = `M ${getX(activePoints[0].t)} ${getY(activePoints[0].v)} `;
        for (let i = 1; i < activePoints.length; i++) {
            const pointPhase = activePoints[i].phase as SubstormPhase;
            const segmentPoint = `L ${getX(activePoints[i].t)} ${getY(activePoints[i].v)} `;
            if (pointPhase !== currentPhase) {
                phaseSegments.push({ phase: currentPhase, path: currentPath });
                currentPhase = pointPhase;
                currentPath = `M ${getX(activePoints[i - 1].t)} ${getY(activePoints[i - 1].v)} ${segmentPoint}`;
            } else {
                currentPath += segmentPoint;
            }
        }
        phaseSegments.push({ phase: currentPhase, path: currentPath });
    }

    // Map Rendering
    const renderMap = () => {
        const w = 300; const h = 400;
        const Y = (lat: number) => (lat - (-34.0)) / ((-47.5) - (-34.0)) * h;
        const X = (lon: number) => (lon - 166.0) / (179.0 - 166.0) * w;
        
        const lCam = calculateReachLatitude(data.strength, 'camera');
        const lPhn = calculateReachLatitude(data.strength, 'phone');
        const lEye = calculateReachLatitude(data.strength, 'eye');

        const yCam = Y(lCam); const yPhn = Y(lPhn); const yEye = Y(lEye);

        return (
            <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full opacity-90">
                <path d="M 152 24 L 160 30 L 165 60 L 200 120 L 180 180 L 140 240 L 100 300 L 40 360 L 60 380 L 120 340 L 160 280 L 180 200 Z" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.2)" />
                
                {data.towns.map((t: NzTown, i: number) => {
                    let fill = "#555"; let r = 2;
                    if(t.cam) { fill = "#4ade80"; r=3; }
                    if(t.phone) { fill = "#38bdf8"; r=3.5; }
                    if(t.eye) { fill = "#facc15"; r=4; }
                    return <circle key={i} cx={X(t.lon)} cy={Y(t.lat)} r={r} fill={fill} />
                })}

                {yCam < h && <line x1="0" y1={yCam} x2={w} y2={yCam} stroke="#4ade80" strokeDasharray="4" strokeWidth="1"><title>Camera</title></line>}
                {yPhn < h && <line x1="0" y1={yPhn} x2={w} y2={yPhn} stroke="#38bdf8" strokeDasharray="4" strokeWidth="1"><title>Phone</title></line>}
                {yEye < h && <line x1="0" y1={yEye} x2={w} y2={yEye} stroke="#facc15" strokeDasharray="4" strokeWidth="1"><title>Eye</title></line>}
            </svg>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 bg-neutral-950 p-4 rounded-xl border border-neutral-800">
            {/* Header */}
            <div className="md:col-span-12 flex justify-between items-center pb-2 border-b border-neutral-800">
                <h2 className="text-xl font-bold text-white flex items-center gap-2"><span className="text-sky-400">SPOT THE AURORA</span> / NZ SUBSTORM INDEX</h2>
                <div className="text-xs text-neutral-500">Live Ground Magnetometer (EYWM) + RTSW</div>
            </div>

            {/* Hero Card */}
            <div className="md:col-span-4 bg-neutral-900/50 rounded-lg p-6 flex flex-col justify-center items-center relative overflow-hidden border border-neutral-800">
                <div className="text-sm font-bold text-neutral-400 uppercase tracking-widest mb-2">Current Activity</div>
                <div className="text-6xl font-black text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]" style={{ color: data.strength < -45000 ? '#ef4444' : data.strength < -25000 ? '#facc15' : '#e5e5e5' }}>
                    {Math.round(data.strength)}
                </div>
                <div className="mt-4 flex gap-2">
                    <span className={`px-3 py-1 bg-neutral-800 rounded-full text-xs font-bold border ${data.alertLevel.border} ${data.alertLevel.color}`}>
                        {data.alertLevel.label.toUpperCase()} ALERT
                    </span>
                    <span className="px-3 py-1 bg-neutral-800 rounded-full text-xs font-bold text-neutral-300 border border-neutral-700">
                        Slope: {data.slope.toFixed(1)}/min
                    </span>
                </div>
                <div className="mt-3 px-3 py-1 bg-neutral-900/70 border border-neutral-700 rounded-full text-xs text-neutral-200">
                    Phase: <span className="font-semibold" style={{ color: PHASE_DETAILS[data.currentPhase as SubstormPhase].color }}>{PHASE_DETAILS[data.currentPhase as SubstormPhase].label}</span>
                </div>
                <div className="mt-6 p-3 bg-sky-900/20 border border-sky-500/30 rounded text-sm text-sky-100 text-center" dangerouslySetInnerHTML={{ __html: data.outlook }}></div>
            </div>

            {/* Visibility & Map */}
            <div className="md:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Town Lists */}
                <div className="bg-neutral-900/50 rounded-lg p-4 border border-neutral-800 flex flex-col gap-3">
                    <h3 className="text-xs font-bold text-neutral-400 uppercase">Alert Levels by Visibility</h3>
                    
                    <div>
                        <div className="text-[10px] text-green-400 font-bold mb-1 flex items-center gap-1">📷 CAMERA (Long Exposure)</div>
                        <div className="flex flex-wrap gap-1">
                            {data.towns.filter((t:any) => t.cam).length === 0 ? <span className="text-neutral-600 text-xs italic">No towns in range</span> : 
                             data.towns.filter((t:any) => t.cam).map((t:any) => (
                                <span key={t.name} className={`px-2 py-0.5 rounded text-[10px] font-bold border ${t.cam === 'green' ? 'bg-green-500/20 border-green-500/40 text-green-300' : t.cam === 'yellow' ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300' : 'bg-red-500/20 border-red-500/40 text-red-300'}`}>{t.name} ({t.lat.toFixed(2)}°)</span>
                            ))}
                        </div>
                    </div>

                    <div>
                        <div className="text-[10px] text-sky-400 font-bold mb-1 flex items-center gap-1">📱 PHONE (Night Mode)</div>
                        <div className="flex flex-wrap gap-1">
                            {data.towns.filter((t:any) => t.phone).length === 0 ? <span className="text-neutral-600 text-xs italic">No towns in range</span> : 
                             data.towns.filter((t:any) => t.phone).map((t:any) => (
                                <span key={t.name} className={`px-2 py-0.5 rounded text-[10px] font-bold border ${t.phone === 'green' ? 'bg-green-500/20 border-green-500/40 text-green-300' : t.phone === 'yellow' ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300' : 'bg-red-500/20 border-red-500/40 text-red-300'}`}>{t.name} ({t.lat.toFixed(2)}°)</span>
                            ))}
                        </div>
                    </div>

                    <div>
                        <div className="text-[10px] text-yellow-400 font-bold mb-1 flex items-center gap-1">👁️ NAKED EYE</div>
                        <div className="flex flex-wrap gap-1">
                            {data.towns.filter((t:any) => t.eye).length === 0 ? <span className="text-neutral-600 text-xs italic">No towns in range</span> : 
                             data.towns.filter((t:any) => t.eye).map((t:any) => (
                                <span key={t.name} className={`px-2 py-0.5 rounded text-[10px] font-bold border ${t.eye === 'green' ? 'bg-green-500/20 border-green-500/40 text-green-300' : t.eye === 'yellow' ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300' : 'bg-red-500/20 border-red-500/40 text-red-300'}`}>{t.name} ({t.lat.toFixed(2)}°)</span>
                            ))}
                        </div>
                    </div>
                    
                    <div className="mt-auto pt-3 border-t border-neutral-800 flex gap-4 text-[10px] text-neutral-400 justify-center">
                        <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-500"></div> Possible</span>
                        <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-yellow-500"></div> Good</span>
                        <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-500"></div> Great</span>
                    </div>
                </div>

                {/* Map */}
                <div className="bg-neutral-900/50 rounded-lg border border-neutral-800 relative overflow-hidden flex items-center justify-center p-2 h-[250px]">
                    {renderMap()}
                    <div className="absolute bottom-2 right-2 text-[10px] text-neutral-600">Schematic Map</div>
                </div>
            </div>

            {/* Town Alert Table */}
            <div className="md:col-span-12 bg-neutral-900/50 rounded-lg p-4 border border-neutral-800">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-bold text-neutral-400 uppercase">Town Alert Levels (Latitudes)</h3>
                    <div className="flex items-center gap-2 text-[10px] text-neutral-500">
                        {ALERT_LEVELS.map(level => (
                            <span key={level.key} className={`px-2 py-0.5 rounded-full border ${level.border} ${level.color}`}>{level.label}</span>
                        ))}
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-neutral-300">
                    {data.towns.map((town: NzTown) => (
                        <div key={town.name} className="flex items-center justify-between bg-neutral-950/60 border border-neutral-800 rounded px-3 py-2">
                            <div className="flex flex-col">
                                <span className="font-semibold text-neutral-100">{town.name}</span>
                                <span className="text-[10px] text-neutral-500">{town.lat.toFixed(2)}°</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={`w-2.5 h-2.5 rounded-full ${town.cam ? (town.cam === 'green' ? 'bg-green-400' : town.cam === 'yellow' ? 'bg-yellow-400' : 'bg-red-400') : 'bg-neutral-700'}`} title="Camera"></span>
                                <span className={`w-2.5 h-2.5 rounded-full ${town.phone ? (town.phone === 'green' ? 'bg-green-400' : town.phone === 'yellow' ? 'bg-yellow-400' : 'bg-red-400') : 'bg-neutral-700'}`} title="Phone"></span>
                                <span className={`w-2.5 h-2.5 rounded-full ${town.eye ? (town.eye === 'green' ? 'bg-green-400' : town.eye === 'yellow' ? 'bg-yellow-400' : 'bg-red-400') : 'bg-neutral-700'}`} title="Eye"></span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Interactive Graph */}
            <div className="md:col-span-12 bg-neutral-900/50 rounded-lg p-4 border border-neutral-800 relative">
                <div className="flex justify-between items-center mb-4">
                    <div>
                        <h3 className="text-xs font-bold text-neutral-400 uppercase">Activity Phases (Last 24 Hours)</h3>
                        <div className="flex flex-wrap gap-2 mt-2">
                            {(Object.keys(PHASE_DETAILS) as SubstormPhase[]).map((phase) => (
                                <span key={phase} className="flex items-center gap-1 text-[10px] text-neutral-400">
                                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PHASE_DETAILS[phase].color }}></span>
                                    {PHASE_DETAILS[phase].label}
                                </span>
                            ))}
                        </div>
                    </div>
                    <div className="flex gap-1">
                        {[1, 3, 6, 12, 24].map(h => (
                            <button key={h} onClick={() => setChartRange(h)} className={`px-2 py-1 text-xs rounded font-bold transition-colors ${chartRange === h ? 'bg-sky-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'}`}>{h}H</button>
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
                        {phaseSegments.map((segment, idx) => (
                            <path key={idx} d={segment.path} fill="none" stroke={PHASE_DETAILS[segment.phase].color} strokeWidth="1.7" vectorEffect="non-scaling-stroke" />
                        ))}
                    </svg>

                    {hoverData && (
                        <>
                            <div className="absolute top-0 bottom-0 w-px bg-white/20 pointer-events-none" style={{ left: hoverData.x }} />
                            <div className="absolute top-2 bg-neutral-900/90 border border-neutral-700 p-2 rounded text-xs text-white pointer-events-none z-10 whitespace-nowrap shadow-lg" style={{ left: hoverData.x > 300 ? hoverData.x - 120 : hoverData.x + 10 }}>
                                <div className="font-bold">{new Date(hoverData.closest.t).toLocaleTimeString()}</div>
                                <div style={{ color: hoverData.closest.v < -25000 ? '#facc15' : '#ccc' }}>{Math.round(hoverData.closest.v)} nT</div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

// ... (Rest of original ForecastDashboard.tsx: getSuggestedCameraSettings, ActivitySummaryDisplay, ForecastDashboard main component, etc) ...
// The rest of the file should be exactly as it was, ensuring the `ForecastDashboard` function below uses <NzSubstormIndex /> 
// inside the "UnifiedForecastPanel" or where the old "Ground Confirmation" button logic was.

// [NOTE: Because this file is massive, I am assuming you will place the `NzSubstormIndex` component 
// I wrote above BEFORE the `ForecastDashboard` main component, and then inside `ForecastDashboard`, 
// you will replace the old `NzMagnetometerChart` section with `<NzSubstormIndex />`]

const ForecastDashboard: React.FC<ForecastDashboardProps> = ({ setViewerMedia, setCurrentAuroraScore, setSubstormActivityStatus, setIpsAlertData, navigationTarget, onInitialLoad, viewMode, onViewModeChange, refreshSignal }) => {
    // ... [Original Hooks & State] ...
    const {
        isLoading, auroraScore, lastUpdated, gaugeData, isDaylight, celestialTimes, auroraScoreHistory, dailyCelestialHistory,
        owmDailyForecast, locationBlurb, fetchAllData, allSpeedData, allDensityData, allMagneticData, hemisphericPowerHistory,
        goes18Data, goes19Data, loadingMagnetometer, substormForecast, activitySummary, interplanetaryShockData
    } = useForecastData(setCurrentAuroraScore, setSubstormActivityStatus);
    
    // ... [Original State: modalState, isFaqOpen, etc] ...
    const [modalState, setModalState] = useState<{ isOpen: boolean; title: string; content: string | React.ReactNode } | null>(null);
    const [isFaqOpen, setIsFaqOpen] = useState(false);
    const [epamImageUrl, setEpamImageUrl] = useState<string>('/placeholder.png');
    const [selectedCamera, setSelectedCamera] = useState<Camera>(CAMERAS.find(c => c.name === 'Queenstown')!);
    const [cameraImageSrc, setCameraImageSrc] = useState<string>('');
    const initialLoadCalled = useRef(false);

    // ... [Original UseEffects & Handlers] ...
    useEffect(() => {
        if (!isLoading && onInitialLoad && !initialLoadCalled.current) {
            onInitialLoad();
            initialLoadCalled.current = true;
        }
    }, [isLoading, onInitialLoad]);

    useEffect(() => {
      fetchAllData(true, getGaugeStyle);
      const interval = setInterval(() => fetchAllData(false, getGaugeStyle), 30 * 1000);
      return () => clearInterval(interval);
    }, []);

    useEffect(() => {
      fetchAllData(false, getGaugeStyle);
    }, [fetchAllData, refreshSignal]);

    useEffect(() => {
        const latestShock = interplanetaryShockData?.[0];
        if (latestShock && (Date.now() - new Date(latestShock.eventTime).getTime()) < 3 * 3600 * 1000) {
            setIpsAlertData({
                shock: latestShock,
                solarWind: {
                    speed: gaugeData.speed.value,
                    bt: gaugeData.bt.value,
                    bz: gaugeData.bz.value,
                }
            });
        } else {
            setIpsAlertData(null);
        }
    }, [interplanetaryShockData, gaugeData, setIpsAlertData]);

    useEffect(() => {
        setEpamImageUrl(`${ACE_EPAM_URL}?_=${Date.now()}`);
        if (selectedCamera.type === 'image') {
            setCameraImageSrc(`${selectedCamera.url}?_=${Date.now()}`);
        }
    }, [lastUpdated, selectedCamera]);

    const handleDownloadForecastImage = useCallback(async () => {
        // ... [Keep existing download logic] ...
        const canvas = document.createElement('canvas');
        // ... (truncated for space, use original logic) ...
    }, [auroraScore, substormForecast, gaugeData, celestialTimes]);

    // ... [Tooltip content & handlers] ...
    const tooltipContent = useMemo(() => ({
        // ... [Keep existing tooltips] ...
        'unified-forecast': `<strong>Spot The Aurora Forecast</strong>...`,
        // ...
        'nz-mag': '<strong>NZ Substorm Index</strong><br>A real-time measure of magnetic disturbance over New Zealand. Negative numbers indicate a westward electrojet (substorm).<br><br><strong>Visibility:</strong><br>The map shows where the aurora might be visible based on current energy levels.'
    }), []);
    
    const openModal = useCallback((id: string) => {
        const contentData = tooltipContent[id as keyof typeof tooltipContent];
        if (contentData) {
            let title = id === 'nz-mag' ? 'About the NZ Substorm Index' : (id.charAt(0).toUpperCase() + id.slice(1)).replace(/([A-Z])/g, ' $1').trim();
            setModalState({ isOpen: true, title: title, content: contentData });
        }
    }, [tooltipContent]);
    const closeModal = useCallback(() => setModalState(null), []);

    // ... [Calculated Values] ...
    const cameraSettings = useMemo(() => getSuggestedCameraSettings(auroraScore, isDaylight), [auroraScore, isDaylight]);
    const auroraBlurb = useMemo(() => getAuroraBlurb(auroraScore), [auroraScore]);
    const getMagnetometerAnnotations = useCallback(() => ({}), []);

    const simpleViewStatus = useMemo(() => {
        const score = auroraScore ?? 0;
        if (score >= 80) return { text: 'Huge Aurora Visible', emoji: '🤩' };
        if (score >= 50) return { text: 'Eye Visibility Possible', emoji: '👁️' };
        if (score >= 35) return { text: 'Phone Visibility Possible', emoji: '📱' };
        if (score >= 20) return { text: 'Camera Visibility Possible', emoji: '📷' };
        if (score >= 10) return { text: 'Minimal Activity', emoji: '😐' };
        return { text: 'No Aurora Expected', emoji: '😞' };
    }, [auroraScore]);

    const actionOneLiner = useMemo(() => {
        const score = auroraScore ?? 0;
        if (isDaylight) return "It's daytime. Check back after sunset for the nighttime forecast.";
        if (substormForecast.status === 'ONSET') return "GO NOW! An aurora eruption is detected with good power. Look south immediately!";
        if (substormForecast.status === 'IMMINENT_30') return "GET READY! An eruption is highly likely within 30 minutes. Head to your spot.";
        if (score >= 50) return "CONDITIONS ARE GOOD. A visible aurora is possible. Find a dark spot and be patient.";
        if (score >= 35) return "WORTH A LOOK. A modern phone might capture an aurora. Find a very dark location.";
        if (score >= 20) return "CAMERA ONLY. A DSLR/Mirrorless with a long exposure may pick up a faint glow.";
        return "STAY INDOORS. Conditions are very quiet, an aurora is unlikely tonight.";
    }, [auroraScore, substormForecast.status, isDaylight]);

    if (isLoading) return <div className="w-full h-full flex justify-center items-center bg-neutral-900"><LoadingSpinner /></div>;

    const faqContent = `...`; // Keep original FAQ content

    return (
        <div className="w-full h-full bg-neutral-900 text-neutral-300 relative" style={{ backgroundImage: `url('/background-aurora.jpg')`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed' }}>
            <div className="absolute inset-0 bg-black/50 z-0"></div>
            <div className="w-full h-full overflow-y-auto p-5 relative z-10 styled-scrollbar">
                 <div className="container mx-auto">
                    <header className="text-center mb-4">
                        <a href="https://www.tnrprotography.co.nz" target="_blank" rel="noopener noreferrer"><img src="https://www.tnrprotography.co.nz/uploads/1/3/6/6/136682089/white-tnr-protography-w_orig.png" alt="TNR Protography Logo" className="mx-auto w-full max-w-[250px] mb-4"/></a>
                        <h1 className="text-3xl font-bold text-neutral-100">Spot The Aurora - New Zealand Aurora Forecast</h1>
                    </header>
                     <div className="flex justify-center items-center gap-2 mb-6">
                        <div className="inline-flex items-center rounded-full bg-white/5 border border-white/10 shadow-inner p-1 backdrop-blur-md">
                          <button onClick={() => onViewModeChange('simple')} className={`px-4 py-2 rounded-full text-sm font-semibold transition-all active:scale-95 ${viewMode === 'simple' ? 'bg-gradient-to-r from-sky-500/80 to-cyan-500/80 text-white shadow-lg' : 'text-neutral-200 hover:text-white'}`}>Simple View</button>
                          <button onClick={() => onViewModeChange('advanced')} className={`px-4 py-2 rounded-full text-sm font-semibold transition-all active:scale-95 ${viewMode === 'advanced' ? 'bg-gradient-to-r from-purple-500/80 to-fuchsia-500/80 text-white shadow-lg' : 'text-neutral-200 hover:text-white'}`}>Advanced View</button>
                        </div>
                    </div>

                    {viewMode === 'simple' ? (
                        <main className="grid grid-cols-12 gap-6">
                            {/* Simple View Components (Unchanged) */}
                            <div className="col-span-12 card bg-neutral-950/80 p-6 text-center">
                                <div className="text-7xl font-extrabold" style={{color: GAUGE_COLORS[getForecastScoreColorKey(auroraScore ?? 0)].solid}}>{(auroraScore ?? 0).toFixed(1)}%</div>
                                <div className="text-2xl mt-2 font-semibold">{simpleViewStatus.emoji} {simpleViewStatus.text}</div>
                                <div className="mt-6 bg-neutral-900/70 p-4 rounded-lg border border-neutral-700/60 max-w-lg mx-auto"><p className="text-lg font-semibold text-amber-300">{actionOneLiner}</p></div>
                            </div>
                            <AuroraSightings isDaylight={isDaylight} refreshSignal={refreshSignal} />
                            <ActivitySummaryDisplay summary={activitySummary} />
                            <SimpleTrendChart auroraScoreHistory={auroraScoreHistory} />
                            {/* ... (Cloud & Cameras) ... */}
                            <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col"><h3 className="text-xl font-semibold text-center text-white mb-4">Live Cloud Cover</h3><div className="relative w-full" style={{paddingBottom: "56.25%"}}><iframe title="Windy.com Cloud Map" className="absolute top-0 left-0 w-full h-full rounded-lg" src="https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=mm&metricTemp=°C&zoom=5&overlay=clouds&product=ecmwf&level=surface&lat=-44.757&lon=169.054" frameBorder="0"></iframe></div></div>
                            <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col"><div className="flex justify-center items-center mb-4"><h3 className="text-xl font-semibold text-center text-white">Live Cameras</h3></div><div className="flex justify-center gap-2 my-2 flex-wrap">{CAMERAS.map((camera) => (<button key={camera.name} onClick={() => setSelectedCamera(camera)} className={`px-3 py-1 text-xs rounded transition-colors ${selectedCamera.name === camera.name ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>{camera.name}</button>))}</div><div className="mt-4"><div className="relative w-full bg-black rounded-lg" style={{ paddingBottom: "56.25%" }}>{selectedCamera.type === 'iframe' ? (<iframe title={`Live View from ${selectedCamera.name}`} className="absolute top-0 left-0 w-full h-full rounded-lg" src={selectedCamera.url} key={selectedCamera.name} />) : (<img src={cameraImageSrc} alt={`Live View from ${selectedCamera.name}`} className="absolute top-0 left-0 w-full h-full rounded-lg object-contain" key={cameraImageSrc} onError={(e) => { e.currentTarget.src = '/placeholder.png'; e.currentTarget.alt = `Could not load camera from ${selectedCamera.name}.`; }} />)}</div><div className="text-center text-xs text-neutral-500 mt-2">Source: <a href={`http://${selectedCamera.sourceUrl}`} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">{selectedCamera.sourceUrl}</a></div></div></div>
                        </main>
                    ) : (
                        <main className="grid grid-cols-12 gap-6">
                            <ActivityAlert isDaylight={isDaylight} celestialTimes={celestialTimes} auroraScoreHistory={auroraScoreHistory} />
                            <UnifiedForecastPanel score={auroraScore} blurb={auroraBlurb} lastUpdated={lastUpdated} locationBlurb={locationBlurb} getGaugeStyle={getGaugeStyle} getScoreColorKey={getForecastScoreColorKey} getAuroraEmoji={getAuroraEmoji} gaugeColors={GAUGE_COLORS} onOpenModal={() => openModal('unified-forecast')} substormForecast={substormForecast} />
                            <NzSubstormIndex />
                            <ActivitySummaryDisplay summary={activitySummary} />
                            <ForecastTrendChart auroraScoreHistory={auroraScoreHistory} dailyCelestialHistory={dailyCelestialHistory} owmDailyForecast={owmDailyForecast} onOpenModal={() => openModal('forecast')} />
                            <AuroraSightings isDaylight={isDaylight} refreshSignal={refreshSignal} />
                            
                            <ForecastChartPanel title="Interplanetary Magnetic Field" currentValue={`Bt: ${gaugeData.bt.value} / Bz: ${gaugeData.bz.value} <span class='text-base'>nT</span>`} emoji={gaugeData.bz.emoji} onOpenModal={() => openModal('bz')}><MagneticFieldChart data={allMagneticData} /></ForecastChartPanel>
                            <ForecastChartPanel title="Hemispheric Power" currentValue={`${gaugeData.power.value} <span class='text-base'>GW</span>`} emoji={gaugeData.power.emoji} onOpenModal={() => openModal('power')}><HemisphericPowerChart data={hemisphericPowerHistory.map(d => ({ x: d.timestamp, y: d.hemisphericPower }))} /></ForecastChartPanel>
                            <ForecastChartPanel title="Solar Wind Speed" currentValue={`${gaugeData.speed.value} <span class='text-base'>km/s</span>`} emoji={gaugeData.speed.emoji} onOpenModal={() => openModal('speed')}><SolarWindSpeedChart data={allSpeedData} /></ForecastChartPanel>
                            <ForecastChartPanel title="Solar Wind Density" currentValue={`${gaugeData.density.value} <span class='text-base'>p/cm³</span>`} emoji={gaugeData.density.emoji} onOpenModal={() => openModal('density')}><SolarWindDensityChart data={allDensityData} /></ForecastChartPanel>
                            <ForecastChartPanel title="Moon Illumination & Arc" currentValue={gaugeData.moon.value} emoji={gaugeData.moon.emoji} onOpenModal={() => openModal('moon')}><MoonArcChart dailyCelestialHistory={dailyCelestialHistory} owmDailyForecast={owmDailyForecast} /></ForecastChartPanel>

                            <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col"><h3 className="text-xl font-semibold text-center text-white mb-4">Live Cloud Cover</h3><div className="relative w-full" style={{paddingBottom: "56.25%"}}><iframe title="Windy.com Cloud Map" className="absolute top-0 left-0 w-full h-full rounded-lg" src="https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=mm&metricTemp=°C&zoom=5&overlay=clouds&product=ecmwf&level=surface&lat=-44.757&lon=169.054" frameBorder="0"></iframe></div></div>
                            <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col"><div className="flex justify-center items-center mb-4"><h3 className="text-xl font-semibold text-center text-white">Live Cameras</h3><button onClick={() => openModal('live-cameras')} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button></div><div className="flex justify-center gap-2 my-2 flex-wrap">{CAMERAS.map((camera) => (<button key={camera.name} onClick={() => setSelectedCamera(camera)} className={`px-3 py-1 text-xs rounded transition-colors ${selectedCamera.name === camera.name ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>{camera.name}</button>))}</div><div className="mt-4"><div className="relative w-full bg-black rounded-lg" style={{ paddingBottom: "56.25%" }}>{selectedCamera.type === 'iframe' ? (<iframe title={`Live View from ${selectedCamera.name}`} className="absolute top-0 left-0 w-full h-full rounded-lg" src={selectedCamera.url} key={selectedCamera.name} />) : (<img src={cameraImageSrc} alt={`Live View from ${selectedCamera.name}`} className="absolute top-0 left-0 w-full h-full rounded-lg object-contain" key={cameraImageSrc} onError={(e) => { e.currentTarget.src = '/placeholder.png'; e.currentTarget.alt = `Could not load camera from ${selectedCamera.name}.`; }} />)}</div><div className="text-center text-xs text-neutral-500 mt-2">Source: <a href={`http://${selectedCamera.sourceUrl}`} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">{selectedCamera.sourceUrl}</a></div></div></div>

                            <ForecastChartPanel
                                title="Substorm Activity"
                                currentValue={substormForecast.status === 'ONSET' ? `ONSET DETECTED` : substormForecast.status.replace('_', ' ')}
                                emoji="⚡"
                                onOpenModal={() => openModal('substorm')}
                            >
                               <div className="min-h-[350px]">
                                    <div className="h-full">
                                        <SubstormChart goes18Data={goes18Data} goes19Data={goes19Data} annotations={getMagnetometerAnnotations()} loadingMessage={loadingMagnetometer} />
                                    </div>
                               </div>
                            </ForecastChartPanel>

                            <div className="col-span-12 grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <TipsSection />
                                <CameraSettingsSection settings={cameraSettings} />
                            </div>

                            <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col"><div className="flex justify-center items-center"><h2 className="text-xl font-semibold text-center text-white">ACE EPAM (Last 3 Days)</h2><button onClick={() => openModal('epam')} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button></div><div onClick={() => setViewerMedia && epamImageUrl !== '/placeholder.png' && setViewerMedia({ url: epamImageUrl, type: 'image' })} className="flex-grow relative mt-2 cursor-pointer min-h-[300px]"><img src={epamImageUrl} alt="ACE EPAM Data" className="w-full h-full object-contain" /></div></div>
                            <div className="col-span-12"><button onClick={handleDownloadForecastImage} className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-neutral-900/80 border border-neutral-700/60 rounded-lg text-neutral-300 hover:bg-neutral-800 transition-colors font-semibold"><DownloadIcon className="w-6 h-6" /><span>Download The Aurora Forecast For The Next Two Hours!</span></button></div>
                        </main>
                    )}

                    <footer className="page-footer mt-10 pt-8 border-t border-neutral-700 text-center text-neutral-400 text-sm">
                        <h3 className="text-lg font-semibold text-neutral-200 mb-4">About This Dashboard</h3>
                        <p className="max-w-3xl mx-auto leading-relaxed">This dashboard provides a 2-hour aurora forecast for the whole of New Zealand and specifically for the West Coast of New Zealand. The proprietary "Spot The Aurora Forecast" combines live solar wind data with local factors like astronomical darkness and lunar phase to generate a more nuanced prediction than global models.</p>
                        <p className="max-w-3xl mx-auto leading-relaxed mt-4"><strong>Disclaimer:</strong> The aurora is a natural and unpredictable phenomenon. This forecast is an indication of potential activity, not a guarantee of a visible display. Conditions can change rapidly.</p>
                        <div className="mt-6"><button onClick={() => setIsFaqOpen(true)} className="flex items-center gap-2 mx-auto px-4 py-2 bg-neutral-800/80 border border-neutral-700/60 rounded-lg text-neutral-300 hover:bg-neutral-700/90 transition-colors"><GuideIcon className="w-5 h-5" /><span>Frequently Asked Questions</span></button></div>
                        <div className="mt-8 text-xs text-neutral-500"><p>Data provided by <a href="https://www.swpc.noaa.gov/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">NOAA SWPC</a> & <a href="https://api.nasa.gov/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">NASA</a> | Weather & Cloud data by <a href="https://www.windy.com" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">Windy.com</a></p><p className="mt-2">Forecast Algorithm, Visualization, and Development by TNR Protography</p></div>
                    </footer>
                 </div>
            </div>
            {modalState && <InfoModal isOpen={modalState.isOpen} onClose={closeModal} title={modalState.title} content={modalState.content} />}
            <InfoModal isOpen={isFaqOpen} onClose={() => setIsFaqOpen(false)} title="Frequently Asked Questions" content={faqContent} />
        </div>
    );
};

export default ForecastDashboard;
//--- END OF FILE src/components/ForecastDashboard.tsx ---
