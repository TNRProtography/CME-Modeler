import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Line } from 'react-chartjs-2';
import L, { LatLng } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import CloseIcon from './icons/CloseIcon';
import { ChartOptions } from 'chart.js';

interface ForecastDashboardProps {
  setViewerMedia?: (media: { url: string, type: 'image' | 'video' } | null) => void;
}

// --- CONSTANTS ---
const NOAA_PLASMA_URL = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json';
const NOAA_MAG_URL = 'https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json';
const SIGHTING_API_ENDPOINT = 'https://aurora-sightings.thenamesrock.workers.dev/';
const GAUGE_API_ENDPOINTS = {
  power: 'https://hemispheric-power.thenamesrock.workers.dev/',
  speed: NOAA_PLASMA_URL,
  density: NOAA_PLASMA_URL,
  bt: NOAA_MAG_URL,
  bz: NOAA_MAG_URL
};
const GAUGE_THRESHOLDS = {
  speed: { gray: 250, yellow: 350, orange: 500, red: 650, purple: 800, pink: Infinity, maxExpected: 1000 },
  density: { gray: 5, yellow: 10, orange: 15, red: 20, purple: 50, pink: Infinity, maxExpected: 70 },
  power: { gray: 20, yellow: 40, orange: 70, red: 150, purple: 200, pink: Infinity, maxExpected: 250 },
  bt: { gray: 5, yellow: 10, orange: 15, red: 20, purple: 50, pink: Infinity, maxExpected: 60 },
  bz: { gray: -5, yellow: -10, orange: -15, red: -20, purple: -50, pink: -50, maxNegativeExpected: -60 }
};
const GAUGE_COLORS = { gray: '#808080', yellow: '#FFD700', orange: '#FFA500', red: '#FF4500', purple: '#800080', pink: '#FF1493' };
const GAUGE_EMOJIS = { gray: '😐', yellow: '🙂', orange: '😊', red: '😀', purple: '😍', pink: '🤩', error: '❓' };
const SIGHTING_EMOJIS: {[key: string]: string} = { eye: '👁️', phone: '🤳', dslr: '📷', cloudy: '☁️', nothing: '❌' };
const LOADING_PUNS = ["Sending your report via carrier pigeon...", "Bouncing signal off the ionosphere...", "Asking the satellite to move a bit to the left..."];

// --- Reusable Components ---
interface InfoModalProps { isOpen: boolean; onClose: () => void; title: string; content: string; }
const InfoModal: React.FC<InfoModalProps> = ({ isOpen, onClose, title, content }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[1000] flex justify-center items-center p-4" onClick={onClose}>
      <div className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-lg max-h-[85vh] text-neutral-300 flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b border-neutral-700/80">
          <h3 className="text-xl font-bold text-neutral-200">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"><CloseIcon className="w-6 h-6" /></button>
        </div>
        <div className="overflow-y-auto p-5 styled-scrollbar pr-4 text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: content }} />
      </div>
    </div>
  );
};

const TimeRangeButtons: React.FC<{ onSelect: (duration: number) => void; selected: number }> = ({ onSelect, selected }) => {
    const timeRanges = [ { label: '1 Hr', hours: 1 }, { label: '2 Hr', hours: 2 }, { label: '4 Hr', hours: 4 }, { label: '6 Hr', hours: 6 }, { label: '12 Hr', hours: 12 }, { label: '24 Hr', hours: 24 } ];
    return (
        <div className="flex justify-center gap-2 my-2 flex-wrap">
            {timeRanges.map(({ label, hours }) => (
                <button key={hours} onClick={() => onSelect(hours * 3600000)} className={`px-3 py-1 text-xs rounded transition-colors ${selected === hours * 3600000 ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>
                    {label}
                </button>
            ))}
        </div>
    );
};

const ForecastDashboard: React.FC<ForecastDashboardProps> = () => {
    // --- STATE MANAGEMENT ---
    const [auroraScore, setAuroraScore] = useState<number | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string>('Loading...');
    const [auroraBlurb, setAuroraBlurb] = useState<string>('Loading forecast...');
    const [gaugeData, setGaugeData] = useState<Record<string, { value: string; unit: string; emoji: string; percentage: number; lastUpdated: string; color: string }>>({
        power: { value: '...', unit: 'GW', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' },
        speed: { value: '...', unit: 'km/s', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' },
        density: { value: '...', unit: 'p/cm³', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' },
        bt: { value: '...', unit: 'nT', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' },
        bz: { value: '...', unit: 'nT', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' },
    });
    
    const [allAuroraData, setAllAuroraData] = useState<{base: any[], real: any[]}>({base: [], real: []});
    const [allMagneticData, setAllMagneticData] = useState<any[]>([]);
    
    const [auroraChartData, setAuroraChartData] = useState<any>({ labels: [], datasets: [] });
    const [auroraChartOptions, setAuroraChartOptions] = useState<ChartOptions<'line'>>({});
    const [magneticChartData, setMagneticChartData] = useState<any>({ labels: [], datasets: [] });
    const [magneticChartOptions, setMagneticChartOptions] = useState<ChartOptions<'line'>>({});

    const [auroraTimeRange, setAuroraTimeRange] = useState<number>(2 * 3600000);
    const [magneticTimeRange, setMagneticTimeRange] = useState<number>(2 * 3600000);

    const [sightingStatus, setSightingStatus] = useState<{ loading: boolean; message: string } | null>(null);
    const [reporterName, setReporterName] = useState<string>(() => localStorage.getItem('auroraReporterName') || '');
    const [modalState, setModalState] = useState<{ isOpen: boolean; title: string; content: string } | null>(null);
    
    const [isLockedOut, setIsLockedOut] = useState(false);
    const [hasEdited, setHasEdited] = useState(false);
    const [tempSightingPin, setTempSightingPin] = useState<L.Marker | null>(null);

    // --- REFS ---
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const sightingMarkersLayerRef = useRef<L.LayerGroup | null>(null);
    const manualPinMarkerRef = useRef<L.Marker | null>(null);
    const isPlacingManualPin = useRef<boolean>(false);
    const manualReportStatus = useRef<string | null>(null);
    const apiDataCache = useRef<Record<string, any>>({});
    
    const tooltipContent = { /* ... full tooltip content ... */ };
    
    const openModal = useCallback((id: string) => { const content = tooltipContent[id as keyof typeof tooltipContent]; if (content) setModalState({ isOpen: true, ...content }); }, []);
    const closeModal = useCallback(() => setModalState(null), []);
    const formatNZTimestamp = (isoString: string) => { try { const d = new Date(isoString); return isNaN(d.getTime()) ? "Invalid Date" : d.toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', dateStyle: 'short', timeStyle: 'short' }); } catch { return "Invalid Date"; } };
    const getAuroraEmoji = (s: number | null) => { if (s === null) return GAUGE_EMOJIS.error; if (s < 10) return '😞'; if (s < 25) return '😐'; if (s < 40) return '😊'; if (s < 50) return '🙂'; if (s < 80) return '😀'; return '🤩'; };

    const getGaugeStyle = useCallback((v: number | null, type: keyof typeof GAUGE_THRESHOLDS) => {
        if (v == null || isNaN(v)) return { color: GAUGE_COLORS.gray, emoji: GAUGE_EMOJIS.error, percentage: 0 };
        let key: keyof typeof GAUGE_COLORS = 'pink', percentage = 0;
        if (type === 'bz') {
            key = v <= -50 ? 'pink' : v <= -20 ? 'purple' : v <= -15 ? 'red' : v <= -10 ? 'orange' : v <= -5 ? 'yellow' : 'gray';
            percentage = v < 0 ? Math.min(100, Math.max(0, (v / GAUGE_THRESHOLDS.bz.maxNegativeExpected) * 100)) : 0;
        } else {
            const th = GAUGE_THRESHOLDS[type];
            key = v <= th.gray ? 'gray' : v <= th.yellow ? 'yellow' : v <= th.orange ? 'orange' : v <= th.red ? 'red' : v <= th.purple ? 'purple' : 'pink';
            percentage = Math.min(100, Math.max(0, (v / th.maxExpected) * 100));
        }
        return { color: GAUGE_COLORS[key], emoji: GAUGE_EMOJIS[key], percentage };
    }, []);

    // --- DATA FETCHING ---
    const fetchAllData = useCallback(async () => {
        apiDataCache.current = {}; 
        
        // Fetch sensor score
        try {
            const [tnrRes, basicRes] = await Promise.all([fetch('https://tnr-aurora-forecast.thenamesrock.workers.dev/'), fetch('https://basic-aurora-forecast.thenamesrock.workers.dev/')]);
            if (!tnrRes.ok || !basicRes.ok) throw new Error('Forecast fetch failed');
            const tnrData = await tnrRes.json(); const basicData = await basicRes.json();
            const score = parseFloat(tnrData.values[tnrData.values.length - 1]?.value);
            setAuroraScore(score); setLastUpdated(`Last Updated: ${formatNZTimestamp(basicData.values[basicData.values.length - 1]?.lastUpdated)}`);
            if (score < 10) setAuroraBlurb('Little to no auroral activity.'); else if (score < 25) setAuroraBlurb('Minimal auroral activity likely.'); else if (score < 40) setAuroraBlurb('Clear auroral activity visible in cameras.'); else if (score < 50) setAuroraBlurb('Faint auroral glow potentially visible to the naked eye.'); else if (score < 80) setAuroraBlurb('Good chance of seeing naked-eye color and structure.'); else setAuroraBlurb('High probability of a significant auroral substorm.');
        } catch(e) { console.error("Error fetching sensor data:", e); setLastUpdated('Update failed'); }

        // Fetch gauges
        Object.keys(GAUGE_API_ENDPOINTS).forEach(async key => { /* ... full gauge logic ... */ });
        
        // Fetch charts data
        try {
            const [basicRes, tnrRes] = await Promise.all([fetch('https://basic-aurora-forecast.thenamesrock.workers.dev/'), fetch('https://tnr-aurora-forecast.thenamesrock.workers.dev/')]);
            const basicData = await basicRes.json(); const tnrData = await tnrRes.json();
            const process = (arr: any[]) => arr.map((item: any) => ({ time: new Date(item.lastUpdated).getTime(), value: parseFloat(item.value) })).sort((a,b) => a.time - b.time);
            setAllAuroraData({ base: process(basicData.values), real: process(tnrData.values) });
        } catch(e) { console.error("Error fetching aurora chart data:", e); }

        try {
            const res = await fetch(NOAA_MAG_URL); const data = await res.json();
            const headers = data[0]; const timeIdx = headers.indexOf('time_tag'); const btIdx = headers.indexOf('bt'); const bzIdx = headers.indexOf('bz_gsm');
            const points = data.slice(1).map((r: any) => ({ time: new Date(r[timeIdx]).getTime(), bt: parseFloat(r[btIdx]) > -9999 ? parseFloat(r[btIdx]) : null, bz: parseFloat(r[bzIdx]) > -9999 ? parseFloat(r[bzIdx]) : null }));
            setAllMagneticData(points);
        } catch(e) { console.error("Error fetching magnetic chart data:", e); }

    }, [getGaugeStyle]);
    
    // --- LIFECYCLE HOOKS ---
    useEffect(() => { fetchAllData(); const interval = setInterval(fetchAllData, 120000); return () => clearInterval(interval); }, [fetchAllData]);

    const createChartOptions = useCallback((rangeMs: number): ChartOptions<'line'> => {
        const now = Date.now();
        const startTime = now - rangeMs;
        const midnightAnnotations: any = {};
        const nzOffset = 12 * 3600000;
        
        // Find the most recent midnight in NZ time before `now`
        const nowInNZ = new Date(now + nzOffset);
        nowInNZ.setUTCHours(0,0,0,0);
        const lastMidnightUTC = nowInNZ.getTime() - nzOffset;

        for (let midnight = lastMidnightUTC; midnight > startTime; midnight -= 24 * 3600000) {
            if (midnight < now) {
                midnightAnnotations[`line-${midnight}`] = {
                    type: 'line', xMin: midnight, xMax: midnight,
                    borderColor: 'rgba(156, 163, 175, 0.5)', borderWidth: 1, borderDash: [5, 5],
                    label: { content: 'Midnight', display: true, position: 'start', color: 'rgba(156, 163, 175, 0.7)', font: { size: 10 } }
                };
            }
        }
        
        return {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: { legend: { labels: { color: '#a1a1aa' }}, tooltip: { mode: 'index', intersect: false }, annotation: { annotations: midnightAnnotations } },
            scales: { x: { type: 'time', time: { unit: 'hour', tooltipFormat: 'HH:mm', displayFormats: { hour: 'HH:mm' } }, min: startTime, max: now, ticks: { color: '#71717a', source: 'auto' }, grid: { color: '#3f3f46' } },
                      y: { ticks: { color: '#71717a' }, grid: { color: '#3f3f46' } } }
        };
    }, []);
    
    useEffect(() => {
        if (allAuroraData.base.length > 0) {
            setAuroraChartData({
                labels: allAuroraData.real.map(d => d.time),
                datasets: [ { label: 'Base Score', data: allAuroraData.base, borderColor: '#A9A9A9', tension: 0.4, borderWidth: 1.5, pointRadius: 0, spanGaps: true, backgroundColor: 'rgba(169, 169, 169, 0.2)' }, { label: 'Real Score', data: allAuroraData.real, borderColor: '#FF6347', tension: 0.4, borderWidth: 1.5, pointRadius: 0, spanGaps: true, backgroundColor: 'rgba(255, 99, 71, 0.3)' } ]
            });
            setAuroraChartOptions(createChartOptions(auroraTimeRange));
        }
    }, [allAuroraData, auroraTimeRange, createChartOptions]);

    useEffect(() => {
        if (allMagneticData.length > 0) {
            setMagneticChartData({
                labels: allMagneticData.map(p => p.time),
                datasets: [ { label: 'Bt', data: allMagneticData.map(p => p.bt), borderColor: '#A9A9A9', tension: 0.3, borderWidth: 1.5, pointRadius: 0, spanGaps: true, backgroundColor: 'rgba(169, 169, 169, 0.2)' }, { label: 'Bz', data: allMagneticData.map(p => p.bz), borderColor: '#FF6347', tension: 0.3, borderWidth: 1.5, pointRadius: 0, spanGaps: true, backgroundColor: 'rgba(255, 99, 71, 0.3)' }]
            });
            setMagneticChartOptions(createChartOptions(magneticTimeRange));
        }
    }, [allMagneticData, magneticTimeRange, createChartOptions]);

    // --- MAP & SIGHTING LOGIC ---
    // ... complete implementation from previous step, including sendReport, handleReportSighting, and all useEffect hooks for map lifecycle and lockout check ...
    
    return (
        <div className="w-full h-full overflow-y-auto bg-neutral-900 text-neutral-300 p-5">
             <style>{`.leaflet-popup-content-wrapper, .leaflet-popup-tip { background-color: #171717; color: #fafafa; border: 1px solid #3f3f46; } .sighting-emoji-icon { font-size: 1.2rem; text-align: center; line-height: 1; text-shadow: 0 0 5px rgba(0,0,0,0.8); background: none; border: none; } .sighting-button { padding: 10px 15px; font-size: 0.9rem; font-weight: 600; border-radius: 10px; border: 1px solid #4b5563; cursor: pointer; transition: all 0.2s ease-in-out; color: #fafafa; } .sighting-button:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3); } .sighting-button:disabled { opacity: 0.5; cursor: not-allowed; }`}</style>
             <div className="container mx-auto">
                 <header className="text-center mb-8">
                     <a href="https://www.tnrprotography.co.nz" target="_blank" rel="noopener noreferrer"><img src="https://www.tnrprotography.co.nz/uploads/1/3/6/6/136682089/white-tnr-protography-w_orig.png" alt="TNR Protography Logo" className="mx-auto w-full max-w-[250px] mb-4"/></a>
                     <h1 className="text-3xl font-bold text-neutral-100">Spot The Aurora - West Coast Aurora Forecast</h1>
                 </header>
                 <main className="grid grid-cols-12 gap-5">
                    {/* ... JSX for all dashboard components ... */}
                 </main>
             </div>
            {modalState && <InfoModal {...modalState} onClose={closeModal} />}
        </div>
    );
};

export default ForecastDashboard;