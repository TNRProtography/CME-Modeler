import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import L, { LatLng } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import CloseIcon from './icons/CloseIcon';
import { ChartOptions } from 'chart.js';
import { enNZ } from 'date-fns/locale';

interface ForecastDashboardProps {
  setViewerMedia?: (media: { url: string, type: 'image' | 'video' } | null) => void;
}

// --- CONSTANTS ---
const FORECAST_API_URL = 'https://spottheaurora.thenamesrock.workers.dev/';
const NOAA_PLASMA_URL = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json';
const NOAA_MAG_URL = 'https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json';
const SIGHTING_API_ENDPOINT = 'https://aurora-sightings.thenamesrock.workers.dev/';
const ACE_EPAM_URL = 'https://services.swpc.noaa.gov/json/ace/epam/ace_epam_3d.json';
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
    const [allEpamData, setAllEpamData] = useState<any[]>([]);
    
    const [auroraChartData, setAuroraChartData] = useState<any>({ datasets: [] });
    const [magneticChartData, setMagneticChartData] = useState<any>({ datasets: [] });
    const [epamChartData, setEpamChartData] = useState<any>({ datasets: [] });

    const [auroraTimeRange, setAuroraTimeRange] = useState<number>(2 * 3600000);
    const [magneticTimeRange, setMagneticTimeRange] = useState<number>(2 * 3600000);

    const [sightingStatus, setSightingStatus] = useState<{ loading: boolean; message: string } | null>(null);
    const [reporterName, setReporterName] = useState<string>(() => localStorage.getItem('auroraReporterName') || '');
    const [modalState, setModalState] = useState<{ isOpen: boolean; title: string; content: string } | null>(null);
    
    const [isLockedOut, setIsLockedOut] = useState(false);
    const [hasEdited, setHasEdited] = useState(false);
    const [tempSightingPin, setTempSightingPin] = useState<L.Marker | null>(null);

    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const sightingMarkersLayerRef = useRef<L.LayerGroup | null>(null);
    const manualPinMarkerRef = useRef<L.Marker | null>(null);
    const isPlacingManualPin = useRef<boolean>(false);
    const manualReportStatus = useRef<string | null>(null);
    
    const tooltipContent = {
        'forecast': { title: 'About The Forecast Score', content: `This is a proprietary TNR Protography forecast that combines live solar wind data with local conditions like lunar phase and astronomical darkness. It is highly accurate for the next 2 hours. Remember, patience is key and always look south! <br><br><strong>What the Percentage Means:</strong><ul><li><strong>< 10% 😞:</strong> Little to no auroral activity.</li><li><strong>10-25% 😐:</strong> Minimal activity; cameras may detect a faint glow.</li><li><strong>25-40% 😊:</strong> Clear activity on camera; a faint naked-eye glow is possible.</li><li><strong>40-50% 🙂:</strong> Faint naked-eye aurora likely, maybe with color.</li><li><strong>50-80% 😀:</strong> Good chance of naked-eye color and structure.</li><li><strong>80%+ 🤩:</strong> High probability of a significant substorm.</li></ul>` },
        'chart': { title: 'Reading The Visibility Chart', content: `This chart shows the estimated visibility over time.<br><br><strong><span class="inline-block w-3 h-3 rounded-sm mr-2 align-middle" style="background-color: #FF6347;"></span>Spot The Aurora Forecast:</strong> This is the main forecast, including solar wind data and local factors like moonlight and darkness.<br><br><strong><span class="inline-block w-3 h-3 rounded-sm mr-2 align-middle" style="background-color: #A9A9A9;"></span>Base Score:</strong> This shows the forecast based *only* on solar wind data. It represents the "raw potential" if there were no sun or moon interference.` },
        'power': { title: 'Hemispheric Power', content: `<strong>What it is:</strong> The total energy being deposited by the solar wind into an entire hemisphere (North or South), measured in Gigawatts (GW).<br><br><strong>Effect on Aurora:</strong> Think of this as the aurora's overall brightness level. Higher power means more energy is available for a brighter and more widespread display.` },
        'speed': { title: 'Solar Wind Speed', content: `<strong>What it is:</strong> The speed of the charged particles flowing from the Sun, measured in kilometers per second (km/s).<br><br><strong>Effect on Aurora:</strong> Faster particles hit Earth's magnetic field with more energy, leading to more dynamic and vibrant auroras with faster-moving structures.` },
        'density': { title: 'Solar Wind Density', content: `<strong>What it is:</strong> The number of particles within a cubic centimeter of the solar wind, measured in protons per cm³.<br><br><strong>Effect on Aurora:</strong> Higher density means more particles are available to collide with our atmosphere, resulting in more widespread and "thicker" looking auroral displays.` },
        'bt': { title: 'IMF Bt (Total)', content: `<strong>What it is:</strong> The total strength of the Interplanetary Magnetic Field (IMF), measured in nanoteslas (nT).<br><br><strong>Effect on Aurora:</strong> A high Bt value indicates a strong magnetic field. While not a guarantee on its own, a strong field can carry more energy and lead to powerful events if the Bz is also favorable.` },
        'bz': { title: 'IMF Bz (N/S)', content: `<strong>What it is:</strong> The North-South direction of the IMF, measured in nanoteslas (nT). This is the most critical component.<br><br><strong>Effect on Aurora:</strong> Think of Bz as the "gatekeeper." When Bz is strongly <strong>negative (south)</strong>, it opens a gateway for solar wind energy to pour in. A positive Bz closes this gate. <strong>The more negative, the better!</strong>` },
        'epam': { title: 'ACE EPAM', content: `<strong>What it is:</strong> The Electron, Proton, and Alpha Monitor (EPAM) on the ACE spacecraft measures energetic particles from the sun.<br><br><strong>Effect on Aurora:</strong> This is not a direct aurora indicator. However, a sharp, sudden, and simultaneous rise across all energy levels (all lines on the graph moving up together) can be a key indicator of an approaching CME shock front, which often precedes major auroral storms.` }
    };
    
    const openModal = useCallback((id: string) => { const content = tooltipContent[id as keyof typeof tooltipContent]; if (content) setModalState({ isOpen: true, ...content }); }, []);
    const closeModal = useCallback(() => setModalState(null), []);
    const formatNZTimestamp = (timestamp: number) => { try { const d = new Date(timestamp); return isNaN(d.getTime()) ? "Invalid Date" : d.toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', dateStyle: 'short', timeStyle: 'short' }); } catch { return "Invalid Date"; } };
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

    const createChartOptions = useCallback((rangeMs: number, yConfig: {min?: number, max?: number, type?: 'linear' | 'logarithmic'} = {}): ChartOptions<'line'> => {
        const now = Date.now();
        const startTime = now - rangeMs;
        const midnightAnnotations: any = {};
        const nzOffset = 12 * 3600000;
        const startDayNZ = new Date(startTime - nzOffset).setUTCHours(0,0,0,0) + nzOffset;
        for (let d = startDayNZ; d < now + 24 * 3600000; d += 24 * 3600000) {
            const midnight = new Date(d).setUTCHours(12,0,0,0);
            if (midnight > startTime && midnight < now) {
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
            scales: { 
                x: { type: 'time', adapters: { date: { locale: enNZ } }, time: { unit: 'hour', tooltipFormat: 'HH:mm', displayFormats: { hour: 'HH:mm' } }, min: startTime, max: now, ticks: { color: '#71717a', source: 'auto' }, grid: { color: '#3f3f46' } },
                y: { type: yConfig.type || 'linear', min: yConfig.min, max: yConfig.max, ticks: { color: '#71717a' }, grid: { color: '#3f3f46' } } 
            }
        };
    }, []);
    
    const auroraOptions = useMemo(() => createChartOptions(auroraTimeRange, { min: 0, max: 100 }), [auroraTimeRange, createChartOptions]);
    const magneticOptions = useMemo(() => createChartOptions(magneticTimeRange), [magneticTimeRange, createChartOptions]);
    const epamOptions = useMemo((): ChartOptions<'line'> => ({ ...createChartOptions(3 * 24 * 3600000), scales: { ...createChartOptions(3 * 24 * 3600000).scales, y: { type: 'logarithmic', ticks: {color: '#71717a'}, grid: {color: '#3f3f46'} }}}), [createChartOptions]);

    useEffect(() => {
        const fetchAllData = async () => {
            const apiCache: Record<string, any> = {};
            const fetchAndCache = async (url: string) => {
                const cacheBustedUrl = `${url}?_=${new Date().getTime()}`;
                if (apiCache[cacheBustedUrl]) return apiCache[cacheBustedUrl];
                const res = await fetch(cacheBustedUrl);
                if (!res.ok) throw new Error(`Fetch failed for ${url}: ${res.status}`);
                const data = await res.json();
                apiCache[cacheBustedUrl] = data;
                return data;
            };

            try {
                const forecastData = await fetchAndCache(FORECAST_API_URL);
                const { currentForecast, historicalData } = forecastData;
                setAuroraScore(currentForecast.spotTheAuroraForecast);
                setLastUpdated(`Last Updated: ${formatNZTimestamp(currentForecast.lastUpdated)}`);
                const score = currentForecast.spotTheAuroraForecast;
                if (score < 10) setAuroraBlurb('Little to no auroral activity.'); else if (score < 25) setAuroraBlurb('Minimal auroral activity likely.'); else if (score < 40) setAuroraBlurb('Clear auroral activity visible in cameras.'); else if (score < 50) setAuroraBlurb('Faint auroral glow potentially visible to the naked eye.'); else if (score < 80) setAuroraBlurb('Good chance of naked-eye color and structure.'); else setAuroraBlurb('High probability of a significant substorm.');
                const sortedHistory = (historicalData || []).sort((a: any, b: any) => a.timestamp - b.timestamp);
                setAllAuroraData({
                    base: sortedHistory.map((item: any) => ({ x: item.timestamp, y: item.baseScore })),
                    real: sortedHistory.map((item: any) => ({ x: item.timestamp, y: item.finalScore })),
                });
            } catch (e) { console.error("Error fetching main forecast data:", e); setLastUpdated('Update failed'); }

            try {
                const epamData = await fetchAndCache(ACE_EPAM_URL);
                const headers = epamData[0];
                const timeIdx = headers.indexOf('time_tag');
                const p1Idx = headers.indexOf('p1');
                const p3Idx = headers.indexOf('p3');
                const p5Idx = headers.indexOf('p5');
                const epamPoints = epamData.slice(1).map((r: any) => ({
                    time: new Date(r[timeIdx]).getTime(),
                    p1: parseFloat(r[p1Idx]) > -9999 ? parseFloat(r[p1Idx]) : null,
                    p3: parseFloat(r[p3Idx]) > -9999 ? parseFloat(r[p3Idx]) : null,
                    p5: parseFloat(r[p5Idx]) > -9999 ? parseFloat(r[p5Idx]) : null,
                })).sort((a:any, b:any) => a.time - b.time);
                setAllEpamData(epamPoints);
            } catch (e) { console.error("Error fetching EPAM data:", e); }
        };
        
        fetchAllData();
        const interval = setInterval(fetchAllData, 120000);
        return () => clearInterval(interval);
    }, []);
    
    // ... other useEffect hooks and logic ...
    
    return (
        <div className="w-full h-full overflow-y-auto bg-neutral-900 text-neutral-300 p-5">
             <style>{/* ... styles ... */}</style>
             <div className="container mx-auto">
                 <header className="text-center mb-8">{/* ... header ... */}</header>
                 <main className="grid grid-cols-12 gap-5">
                    {/* ... (Aurora Score, Sighting Map, Gauges) ... */}
                    <div className="col-span-12 lg:col-span-6 card bg-neutral-950/80 p-4 h-[500px] flex flex-col">
                        <h2 className="text-xl font-semibold text-white text-center">Spot The Aurora Forecast (Last {auroraTimeRange / 3600000} Hr)</h2>
                        <TimeRangeButtons onSelect={(duration) => setAuroraTimeRange(duration)} selected={auroraTimeRange} />
                        <div className="flex-grow relative mt-2">
                            {allAuroraData.real.length > 0 ? <Line data={auroraChartData} options={auroraOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">Loading Chart...</p>}
                        </div>
                    </div>
                    <div className="col-span-12 lg:col-span-6 card bg-neutral-950/80 p-4 h-[500px] flex flex-col">
                        <h2 className="text-xl font-semibold text-white text-center">Magnetic Field</h2>
                        <TimeRangeButtons onSelect={(duration) => setMagneticTimeRange(duration)} selected={magneticTimeRange} />
                         <div className="flex-grow relative mt-2">
                            {allMagneticData.length > 0 ? <Line data={magneticChartData} options={magneticOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">Loading Chart...</p>}
                        </div>
                    </div>
                    <div className="col-span-12 card bg-neutral-950/80 p-4 h-[500px] flex flex-col">
                        <div className="flex justify-center items-center">
                           <h2 className="text-xl font-semibold text-white text-center">ACE EPAM (Last 3 Days)</h2>
                           <button onClick={() => openModal('epam')} className="ml-2 tooltip-trigger">?</button>
                        </div>
                         <div className="flex-grow relative mt-2">
                            {allEpamData.length > 0 ? <Line data={epamChartData} options={epamOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">Loading Chart...</p>}
                        </div>
                    </div>
                 </main>
             </div>
            {modalState && <InfoModal {...modalState} onClose={closeModal} />}
        </div>
    );
};

export default ForecastDashboard;