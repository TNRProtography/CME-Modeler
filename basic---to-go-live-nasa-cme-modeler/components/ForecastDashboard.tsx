import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import L, { LatLng } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import CloseIcon from './icons/CloseIcon';
import { ChartOptions } from 'chart.js';
import { enNZ } from 'date-fns/locale';
import LoadingSpinner from './icons/LoadingSpinner';

interface ForecastDashboardProps {
  setViewerMedia?: (media: { url: string, type: 'image' | 'video' } | null) => void;
}

// --- CONSTANTS ---
const FORECAST_API_URL = 'https://spottheaurora.thenamesrock.workers.dev/';
const NOAA_PLASMA_URL = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json';
const NOAA_MAG_URL = 'https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json';
const ACE_EPAM_URL = 'https://services.swpc.noaa.gov/images/ace-epam-24-hour.gif';
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

const TimeRangeButtons: React.FC<{ onSelect: (duration: number, label: string) => void; selected: number }> = ({ onSelect, selected }) => {
    const timeRanges = [ { label: '1 Hr', hours: 1 }, { label: '2 Hr', hours: 2 }, { label: '4 Hr', hours: 4 }, { label: '6 Hr', hours: 6 }, { label: '12 Hr', hours: 12 }, { label: '24 Hr', hours: 24 } ];
    return (
        <div className="flex justify-center gap-2 my-2 flex-wrap">
            {timeRanges.map(({ label, hours }) => (
                <button key={hours} onClick={() => onSelect(hours * 3600000, label)} className={`px-3 py-1 text-xs rounded transition-colors ${selected === hours * 3600000 ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>
                    {label}
                </button>
            ))}
        </div>
    );
};

const ForecastDashboard: React.FC<ForecastDashboardProps> = ({ setViewerMedia }) => {
    const [isLoading, setIsLoading] = useState(true);
    const [auroraScore, setAuroraScore] = useState<number | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string>('Loading...');
    const [auroraBlurb, setAuroraBlurb] = useState<string>('Loading forecast...');
    const [gaugeData, setGaugeData] = useState<Record<string, { value: string; unit: string; emoji: string; percentage: number; lastUpdated: string; color: string }>>({
        power: { value: '...', unit: 'GW', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' },
        speed: { value: '...', unit: 'km/s', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' },
        density: { value: '...', unit: 'p/cm³', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' },
        bt: { value: '...', unit: 'nT', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' },
        bz: { value: '...', unit: 'nT', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' },
        moon: { value: '...', unit: '%', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' },
    });
    
    const [allAuroraData, setAllAuroraData] = useState<{base: any[], real: any[]}>({base: [], real: []});
    const [allMagneticData, setAllMagneticData] = useState<any[]>([]);
    const [epamImageUrl, setEpamImageUrl] = useState<string>('/placeholder.png');
    
    const [auroraChartData, setAuroraChartData] = useState<any>({ datasets: [] });
    const [magneticChartData, setMagneticChartData] = useState<any>({ datasets: [] });

    const [auroraTimeRange, setAuroraTimeRange] = useState<number>(2 * 3600000);
    const [auroraTimeLabel, setAuroraTimeLabel] = useState<string>('2 Hr');
    const [magneticTimeRange, setMagneticTimeRange] = useState<number>(2 * 3600000);
    const [magneticTimeLabel, setMagneticTimeLabel] = useState<string>('2 Hr');

    const [sightingStatus, setSightingStatus] = useState<{ loading: boolean; message: string } | null>(null);
    const [reporterName, setReporterName] = useState<string>(() => localStorage.getItem('auroraReporterName') || '');
    const [modalState, setModalState] = useState<{ isOpen: boolean; title: string; content: string } | null>(null);
    
    const [isLockedOut, setIsLockedOut] = useState(false);
    const [hasEdited, setHasEdited] = useState(false);
    const [tempSightingPin, setTempSightingPin] = useState<L.Marker | null>(null);
    const [allSightings, setAllSightings] = useState<any[]>([]);
    const [sightingPage, setSightingPage] = useState(0);
    const SIGHTINGS_PER_PAGE = 5;

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
        'epam': { title: 'ACE EPAM', content: `<strong>What it is:</strong> The Electron, Proton, and Alpha Monitor (EPAM) on the ACE spacecraft measures energetic particles from the sun.<br><br><strong>Effect on Aurora:</strong> This is not a direct aurora indicator. However, a sharp, sudden, and simultaneous rise across all energy levels can be a key indicator of an approaching CME shock front, which often precedes major auroral storms.` },
        'moon': { title: 'Moon Illumination', content: `<strong>What it is:</strong> The percentage of the moon that is illuminated by the Sun.<br><br><strong>Effect on Aurora:</strong> A bright moon (high illumination) acts like natural light pollution, washing out fainter auroral displays. A low illumination (New Moon) provides the darkest skies, making it much easier to see the aurora.` }
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
    
    useEffect(() => {
        const fetchAllData = async () => {
            setIsLoading(true);
            const apiCache: Record<string, any> = {};
            const fetchAndCache = async (url: string) => {
                const cacheBustedUrl = `${url}?_=${new Date().getTime()}`;
                if (apiCache[url]) return apiCache[url];
                const res = await fetch(cacheBustedUrl);
                if (!res.ok) throw new Error(`Fetch failed for ${url}: ${res.status}`);
                const data = await res.json();
                apiCache[url] = data;
                return data;
            };

            await Promise.allSettled([
                (async () => {
                    const data = await fetchAndCache(FORECAST_API_URL);
                    const { currentForecast, historicalData } = data;
                    setAuroraScore(currentForecast.spotTheAuroraForecast);
                    setLastUpdated(`Last Updated: ${formatNZTimestamp(currentForecast.lastUpdated)}`);
                    const score = currentForecast.spotTheAuroraForecast;
                    if (score < 10) setAuroraBlurb('Little to no auroral activity.'); else if (score < 25) setAuroraBlurb('Minimal auroral activity likely.'); else if (score < 40) setAuroraBlurb('Clear auroral activity visible in cameras.'); else if (score < 50) setAuroraBlurb('Faint auroral glow potentially visible to the naked eye.'); else if (score < 80) setAuroraBlurb('Good chance of naked-eye color and structure.'); else setAuroraBlurb('High probability of a significant substorm.');
                    const sortedHistory = (historicalData || []).sort((a: any, b: any) => a.timestamp - b.timestamp);
                    setAllAuroraData({
                        base: sortedHistory.map((item: any) => ({ x: item.timestamp, y: item.baseScore })),
                        real: sortedHistory.map((item: any) => ({ x: item.timestamp, y: item.finalScore })),
                    });
                    const moonReduction = currentForecast.inputs.moonReduction || 0;
                    const moonIllumination = Math.max(0, (moonReduction / 40) * 100);
                    let moonEmoji = '🌑';
                    if (moonIllumination > 95) moonEmoji = '🌕'; else if (moonIllumination > 55) moonEmoji = '🌖'; else if (moonIllumination > 45) moonEmoji = '🌗'; else if (moonIllumination > 5) moonEmoji = '🌒';
                    setGaugeData(prev => ({...prev, moon: { value: moonIllumination.toFixed(0), unit: '%', emoji: moonEmoji, percentage: moonIllumination, lastUpdated: `Updated: ${formatNZTimestamp(currentForecast.inputs.owmDataLastFetched)}`, color: '#A9A9A9' }}));
                    const powerVal = currentForecast.inputs.hemisphericPower;
                    setGaugeData(prev => ({ ...prev, power: { value: powerVal.toFixed(1), unit: 'GW', ...getGaugeStyle(powerVal, 'power'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast.lastUpdated)}` } }));
                    const {bt, bz} = currentForecast.inputs.magneticField;
                    setGaugeData(prev => ({...prev, bt: { ...prev.bt, value: bt.toFixed(1), ...getGaugeStyle(bt, 'bt') }, bz: { ...prev.bz, value: bz.toFixed(1), ...getGaugeStyle(bz, 'bz') }}));

                })().catch(e => { console.error("Error fetching main forecast data:", e); setLastUpdated('Update failed'); }),
                
                (async () => {
                    const [plasmaData, magData] = await Promise.all([
                        fetchAndCache(NOAA_PLASMA_URL),
                        fetchAndCache(NOAA_MAG_URL)
                    ]);

                    const magHeaders = magData[0]; const btIdx = magHeaders.indexOf('bt'); const bzIdx = magHeaders.indexOf('bz_gsm'); const magTimeIdx = magHeaders.indexOf('time_tag');
                    const latestMagRow = magData.slice(1).reverse().find((r: any) => parseFloat(r[bzIdx]) > -9999);
                    const btVal = latestMagRow ? parseFloat(latestMagRow[btIdx]) : null; const bzVal = latestMagRow ? parseFloat(latestMagRow[bzIdx]) : null;
                    const magTimestamp = latestMagRow ? Date.parse(latestMagRow[magTimeIdx]) : Date.now();

                    const plasmaHeaders = plasmaData[0]; const speedIdx = plasmaHeaders.indexOf('speed'); const densityIdx = plasmaHeaders.indexOf('density'); const plasmaTimeIdx = plasmaHeaders.indexOf('time_tag');
                    const latestPlasmaRow = plasmaData.slice(1).reverse().find((r: any) => parseFloat(r[speedIdx]) > -9999);
                    const speedVal = latestPlasmaRow ? parseFloat(latestPlasmaRow[speedIdx]) : null; const densityVal = latestPlasmaRow ? parseFloat(latestPlasmaRow[densityIdx]) : null;
                    const plasmaTimestamp = latestPlasmaRow ? Date.parse(latestPlasmaRow[plasmaTimeIdx]) : Date.now();

                    setGaugeData(prev => ({ ...prev,
                        speed: { ...prev.speed, value: speedVal ? speedVal.toFixed(1) : '...', ...getGaugeStyle(speedVal, 'speed'), lastUpdated: `Updated: ${formatNZTimestamp(plasmaTimestamp)}` },
                        density: { ...prev.density, value: densityVal ? densityVal.toFixed(1) : '...', ...getGaugeStyle(densityVal, 'density'), lastUpdated: `Updated: ${formatNZTimestamp(plasmaTimestamp)}` },
                        bt: { ...prev.bt, lastUpdated: `Updated: ${formatNZTimestamp(magTimestamp)}` }, bz: { ...prev.bz, lastUpdated: `Updated: ${formatNZTimestamp(magTimestamp)}` },
                    }));

                    const magPoints = magData.slice(1).map((r: any) => ({ time: new Date(r[magTimeIdx]).getTime(), bt: parseFloat(r[btIdx]) > -9999 ? parseFloat(r[btIdx]) : null, bz: parseFloat(r[bzIdx]) > -9999 ? parseFloat(r[bzIdx]) : null })).sort((a: any, b: any) => a.time - b.time);
                    setAllMagneticData(magPoints);
                })().catch(e => console.error("Error fetching gauge/magnetic data:", e)),
                
                (async () => {
                    setEpamImageUrl(`${ACE_EPAM_URL}?_=${new Date().getTime()}`);
                })().catch(e => console.error("Error fetching EPAM image:", e))
            ]);
            setIsLoading(false);
        };
        
        fetchAllData();
        const interval = setInterval(fetchAllData, 120000);
        return () => clearInterval(interval);
    }, [getGaugeStyle]);
    
    useEffect(() => {
        if (allAuroraData.base.length > 0) {
            setAuroraChartData({
                datasets: [ 
                    { label: 'Base Score', data: allAuroraData.base, borderColor: '#A9A9A9', tension: 0.4, borderWidth: 1.5, pointRadius: 0, spanGaps: true, backgroundColor: 'rgba(169, 169, 169, 0.2)' }, 
                    { label: 'Spot The Aurora Forecast', data: allAuroraData.real, borderColor: '#FF6347', tension: 0.4, borderWidth: 1.5, pointRadius: 0, spanGaps: true, backgroundColor: 'rgba(255, 99, 71, 0.3)' } 
                ]
            });
        }
    }, [allAuroraData]);

    useEffect(() => {
        if (allMagneticData.length > 0) {
            setMagneticChartData({
                datasets: [ 
                    { label: 'Bt', data: allMagneticData.map(p => ({x: p.time, y: p.bt})), borderColor: '#A9A9A9', tension: 0.3, borderWidth: 1.5, pointRadius: 0, spanGaps: true, backgroundColor: 'rgba(169, 169, 169, 0.2)' }, 
                    { label: 'Bz', data: allMagneticData.map(p => ({x: p.time, y: p.bz})), borderColor: '#FF6347', tension: 0.3, borderWidth: 1.5, pointRadius: 0, spanGaps: true, backgroundColor: 'rgba(255, 99, 71, 0.3)' }]
            });
        }
    }, [allMagneticData]);

    const fetchAndDisplaySightings = useCallback(() => { /* ... full implementation ... */ }, [tempSightingPin]);
    const sendReport = useCallback(async (lat: number, lng: number, status: string) => { /* ... full implementation ... */ }, [reporterName, fetchAndDisplaySightings, hasEdited, tempSightingPin]);
    const handleReportSighting = useCallback((status: string) => { /* ... full implementation ... */ }, [reporterName, sendReport, isLockedOut, hasEdited]);
    const handleEditReport = () => { setIsLockedOut(false); setHasEdited(true); };
    useEffect(() => { /* ... lockout check logic ... */ }, []);
    useEffect(() => { /* ... map initialization and event listeners ... */ }, [fetchAndDisplaySightings, sendReport]);
    
    if (isLoading) {
        return (
            <div className="w-full h-full flex justify-center items-center bg-neutral-900">
                <LoadingSpinner />
            </div>
        );
    }

    return (
        <div className="w-full h-full overflow-y-auto bg-neutral-900 text-neutral-300 p-5">
             <style>{`.leaflet-popup-content-wrapper, .leaflet-popup-tip { background-color: #171717; color: #fafafa; border: 1px solid #3f3f46; } .sighting-emoji-icon { font-size: 1.2rem; text-align: center; line-height: 1; text-shadow: 0 0 5px rgba(0,0,0,0.8); background: none; border: none; } .sighting-button { padding: 10px 15px; font-size: 0.9rem; font-weight: 600; border-radius: 10px; border: 1px solid #4b5563; cursor: pointer; transition: all 0.2s ease-in-out; color: #fafafa; } .sighting-button:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3); } .sighting-button:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }`}</style>
             <div className="container mx-auto">
                 <header className="text-center mb-8">
                     <a href="https://www.tnrprotography.co.nz" target="_blank" rel="noopener noreferrer"><img src="https://www.tnrprotography.co.nz/uploads/1/3/6/6/136682089/white-tnr-protography-w_orig.png" alt="TNR Protography Logo" className="mx-auto w-full max-w-[250px] mb-4"/></a>
                     <h1 className="text-3xl font-bold text-neutral-100">Spot The Aurora - West Coast Aurora Forecast</h1>
                 </header>
                 <main className="grid grid-cols-12 gap-5">
                    <div className="col-span-12 card bg-neutral-950/80 p-6 md:grid md:grid-cols-2 md:gap-8 items-center">
                        <div>
                            <div className="flex items-center mb-4">
                                <h2 className="text-lg font-semibold text-white">Spot The Aurora Forecast</h2>
                                <button onClick={() => openModal('forecast')} className="ml-2 tooltip-trigger">?</button>
                            </div>
                            <div className="text-6xl font-extrabold text-white">{auroraScore !== null ? `${auroraScore.toFixed(1)}%` : '...'} <span className="text-5xl">{getAuroraEmoji(auroraScore)}</span></div>
                            <div className="w-full bg-neutral-700 rounded-full h-3 mt-4"><div className="bg-green-500 h-3 rounded-full" style={{ width: `${auroraScore || 0}%`, backgroundColor: auroraScore !== null ? getGaugeStyle(auroraScore, 'power').color : GAUGE_COLORS.gray }}></div></div>
                            <div className="text-sm text-neutral-400 mt-2">{lastUpdated}</div>
                        </div>
                        <p className="text-neutral-300 mt-4 md:mt-0">{auroraBlurb}</p>
                    </div>

                    <div className="col-span-12 card bg-neutral-950/80 p-6">
                        <h2 className="text-xl font-semibold text-center text-white mb-4">Live Sighting Map</h2>
                        <div ref={mapContainerRef} className="h-[450px] w-full rounded-lg bg-neutral-800 border border-neutral-700"></div>
                        <div className="text-center mt-4">
                            <label htmlFor="reporter-name" className="mr-2">Your Name:</label>
                            <input type="text" id="reporter-name" value={reporterName} onChange={e => {setReporterName(e.target.value); localStorage.setItem('auroraReporterName', e.target.value)}} placeholder="Enter your name" className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1"/>
                        </div>
                        {sightingStatus && <div className="text-center italic mt-2">{sightingStatus.message}</div>}
                        <div className="flex justify-center gap-2 flex-wrap mt-4">
                            {isLockedOut && !hasEdited && (
                                <button onClick={handleEditReport} className="sighting-button bg-yellow-600 hover:bg-yellow-500 border-yellow-700">
                                    ✏️ Edit Last Report
                                </button>
                            )}
                            {Object.entries(SIGHTING_EMOJIS).map(([key, emoji]) => (
                                <button key={key} onClick={() => handleReportSighting(key)} className="sighting-button" disabled={isLockedOut && hasEdited}>
                                    {emoji} {key.charAt(0).toUpperCase() + key.slice(1)}
                                </button>
                            ))}
                        </div>
                         <div className="mt-6">
                            <h3 className="text-lg font-semibold text-white text-center mb-4">Recent Sightings</h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left text-neutral-400">
                                    <thead className="text-xs text-neutral-300 uppercase bg-neutral-800">
                                        <tr>
                                            <th scope="col" className="px-4 py-2">Name</th>
                                            <th scope="col" className="px-4 py-2">Report</th>
                                            <th scope="col" className="px-4 py-2">Location</th>
                                            <th scope="col" className="px-4 py-2">Time</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {allSightings.slice(sightingPage * SIGHTINGS_PER_PAGE, (sightingPage + 1) * SIGHTINGS_PER_PAGE).map((sighting:any, index:number) => (
                                            <tr key={sighting.id || index} className="bg-neutral-900 border-b border-neutral-800">
                                                <td className="px-4 py-2">{sighting.name || 'Anonymous'}</td>
                                                <td className="px-4 py-2">{SIGHTING_EMOJIS[sighting.status]} {sighting.status.charAt(0).toUpperCase() + sighting.status.slice(1)}</td>
                                                <td className="px-4 py-2">{sighting.location || 'Unknown'}</td>
                                                <td className="px-4 py-2">{new Date(sighting.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="flex justify-between items-center mt-4">
                                <button onClick={() => setSightingPage(p => Math.max(0, p - 1))} disabled={sightingPage === 0} className="sighting-button disabled:opacity-50">Previous</button>
                                <span>Page {sightingPage + 1} of {Math.ceil(allSightings.length / SIGHTINGS_PER_PAGE)}</span>
                                <button onClick={() => setSightingPage(p => Math.min(p + 1, Math.floor(allSightings.length / SIGHTINGS_PER_PAGE) -1))} disabled={(sightingPage + 1) * SIGHTINGS_PER_PAGE >= allSightings.length} className="sighting-button disabled:opacity-50">Next</button>
                            </div>
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-6 col-span-12 gap-5">
                        {Object.entries(gaugeData).map(([key, data]) => (
                            <div key={key} className="col-span-3 md:col-span-2 lg:col-span-1 card bg-neutral-950/80 p-4 text-center flex flex-col justify-between">
                                <div className="flex justify-center items-center">
                                    <h3 className="text-md font-semibold text-white h-10 flex items-center justify-center">{key === 'moon' ? 'Moon' : key.toUpperCase()}</h3>
                                    <button onClick={() => openModal(key)} className="ml-2 tooltip-trigger">?</button>
                                </div>
                                <div className="text-3xl font-bold my-2">{data.value} <span className="text-lg">{data.unit}</span></div>
                                <div className="text-3xl my-2">{data.emoji}</div>
                                <div className="w-full bg-neutral-700 rounded-full h-2"><div className="h-2 rounded-full" style={{ width: `${data.percentage}%`, backgroundColor: data.color }}></div></div>
                                <div className="text-xs text-neutral-500 mt-2 truncate" title={data.lastUpdated}>{data.lastUpdated}</div>
                            </div>
                        ))}
                    </div>
                    
                    <div className="col-span-12 lg:col-span-6 card bg-neutral-950/80 p-4 h-[500px] flex flex-col">
                        <h2 className="text-xl font-semibold text-white text-center">Spot The Aurora Forecast (Last {auroraTimeLabel})</h2>
                        <TimeRangeButtons onSelect={(duration, label) => { setAuroraTimeRange(duration); setAuroraTimeLabel(label); }} selected={auroraTimeRange} />
                        <div className="flex-grow relative mt-2">
                            {auroraChartData.datasets[0]?.data ? <Line data={auroraChartData} options={auroraOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">Loading Chart...</p>}
                        </div>
                    </div>
                    <div className="col-span-12 lg:col-span-6 card bg-neutral-950/80 p-4 h-[500px] flex flex-col">
                        <h2 className="text-xl font-semibold text-white text-center">Magnetic Field (Last {magneticTimeLabel})</h2>
                        <TimeRangeButtons onSelect={(duration, label) => { setMagneticTimeRange(duration); setMagneticTimeLabel(label); }} selected={magneticTimeRange} />
                         <div className="flex-grow relative mt-2">
                            {magneticChartData.datasets[0]?.data ? <Line data={magneticChartData} options={magneticOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">Loading Chart...</p>}
                        </div>
                    </div>
                    <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col">
                        <h3 className="text-xl font-semibold text-center text-white mb-4">Live Cloud Cover</h3>
                        <div className="relative w-full" style={{paddingBottom: "56.25%"}}>
                            <iframe title="Windy.com Cloud Map" className="absolute top-0 left-0 w-full h-full rounded-lg" src="https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=mm&metricTemp=°C&metricWind=km/h&zoom=5&overlay=clouds&product=ecmwf&level=surface&lat=-44.757&lon=169.054" frameBorder="0"></iframe>
                        </div>
                    </div>
                    <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col">
                        <h3 className="text-xl font-semibold text-center text-white mb-4">Queenstown Live Camera</h3>
                        <div className="relative w-full" style={{paddingBottom: "56.25%"}}>
                            <iframe title="Live View from Queenstown" className="absolute top-0 left-0 w-full h-full rounded-lg" src="https://queenstown.roundshot.com/#/"></iframe>
                        </div>
                    </div>
                    <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col">
                        <div className="flex justify-center items-center">
                           <h2 className="text-xl font-semibold text-white text-center">ACE EPAM (Last 3 Days)</h2>
                           <button onClick={() => openModal('epam')} className="ml-2 tooltip-trigger">?</button>
                        </div>
                         <div onClick={() => setViewerMedia && epamImageUrl !== '/placeholder.png' && setViewerMedia({ url: epamImageUrl, type: 'image' })} className="flex-grow relative mt-2 cursor-pointer min-h-[300px]">
                            <img src={epamImageUrl} alt="ACE EPAM Data" className="w-full h-full object-contain" />
                        </div>
                    </div>
                 </main>
                 <footer className="page-footer mt-10 pt-8 border-t border-neutral-700 text-center text-neutral-400 text-sm">
                    <h3 className="text-lg font-semibold text-neutral-200 mb-4">About This Dashboard</h3>
                    <p className="max-w-3xl mx-auto leading-relaxed">
                        This dashboard provides a highly localized, 2-hour aurora forecast specifically for the West Coast of New Zealand. The proprietary "Spot The Aurora Forecast" combines live solar wind data with local factors like astronomical darkness and lunar phase to generate a more nuanced prediction than global models.
                    </p>
                    <p className="max-w-3xl mx-auto leading-relaxed mt-4">
                        <strong>Disclaimer:</strong> The aurora is a natural and unpredictable phenomenon. This forecast is an indication of potential activity, not a guarantee of a visible display. Conditions can change rapidly.
                    </p>
                    <div className="mt-8 text-xs text-neutral-500">
                        <p>Data provided by <a href="https://www.swpc.noaa.gov/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">NOAA SWPC</a> & <a href="https://api.nasa.gov/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">NASA</a> | Weather & Cloud data by <a href="https://www.windy.com" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">Windy.com</a> | Live Camera by <a href="https://queenstown.roundshot.com/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">Roundshot</a></p>
                        <p className="mt-2">Forecast Algorithm, Visualization, and Development by TNR Protography</p>
                    </div>
                 </footer>
             </div>
            {modalState && <InfoModal {...modalState} onClose={closeModal} />}
        </div>
    );
};

export default ForecastDashboard;