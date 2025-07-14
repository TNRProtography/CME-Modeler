import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import L from 'leaflet';
import 'leaflet.markercluster';

import CloseIcon from './icons/CloseIcon';
import { ChartOptions } from 'chart.js';
import { enNZ } from 'date-fns/locale';
import LoadingSpinner from './icons/LoadingSpinner';

// --- Type Definitions ---
interface ForecastDashboardProps {
  setViewerMedia?: (media: { url: string, type: 'image' | 'video' } | null) => void;
}
interface InfoModalProps { isOpen: boolean; onClose: () => void; title: string; content: string; }
type ReportingState = 'idle' | 'placing_pin' | 'confirming_location' | 'submitting';

// --- Constants ---
const FORECAST_API_URL = 'https://spottheaurora.thenamesrock.workers.dev/';
const NOAA_PLASMA_URL = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json';
const NOAA_MAG_URL = 'https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json';
const ACE_EPAM_URL = 'https://services.swpc.noaa.gov/images/ace-epam-24-hour.gif';
const SIGHTING_API_ENDPOINT = 'https://aurora-sightings.thenamesrock.workers.dev/';
const SIGHTING_TYPES: { [key: string]: { label: string; emoji: string; } } = {
  eye:    { label: 'Naked Eye',  emoji: '👁️' },
  phone:  { label: 'Phone',      emoji: '🤳' },
  dslr:   { label: 'DSLR',       emoji: '📷' },
  cloudy: { label: 'Cloudy',     emoji: '☁️' },
  nothing:{ label: 'Nothing',    emoji: '❌' },
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

// --- Reusable UI Components ---
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
    // --- State Declarations ---
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
    const [auroraChartData, setAuroraChartData] = useState<any>({ datasets: [] });
    const [magneticChartData, setMagneticChartData] = useState<any>({ datasets: [] });
    const [auroraTimeRange, setAuroraTimeRange] = useState<number>(2 * 3600000);
    const [auroraTimeLabel, setAuroraTimeLabel] = useState<string>('2 Hr');
    const [magneticTimeRange, setMagneticTimeRange] = useState<number>(2 * 3600000);
    const [magneticTimeLabel, setMagneticTimeLabel] = useState<string>('2 Hr');
    const [modalState, setModalState] = useState<{ isOpen: boolean; title: string; content: string } | null>(null);
    const [epamImageUrl, setEpamImageUrl] = useState<string>('/placeholder.png');
    
    // --- Map and Sighting State ---
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const sightingMarkersLayerRef = useRef<L.MarkerClusterGroup | null>(null);
    const userPinRef = useRef<L.Marker | null>(null);

    const [reporterName, setReporterName] = useState<string>(() => localStorage.getItem('auroraReporterName') || '');
    const [allSightings, setAllSightings] = useState<any[]>([]);
    const [sightingPage, setSightingPage] = useState(0);
    const [reportingState, setReportingState] = useState<ReportingState>('idle');
    const reportingStateRef = useRef(reportingState);
    useEffect(() => { reportingStateRef.current = reportingState; }, [reportingState]);
    
    // --- Tooltip Content ---
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
    
    // --- Utility and Data Processing Functions ---
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
        return {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: { legend: { labels: { color: '#a1a1aa' }}, tooltip: { mode: 'index', intersect: false } },
            scales: { 
                x: { type: 'time', adapters: { date: { locale: enNZ } }, time: { unit: 'hour', tooltipFormat: 'HH:mm', displayFormats: { hour: 'HH:mm' } }, min: startTime, max: now, ticks: { color: '#71717a', source: 'auto' }, grid: { color: '#3f3f46' } },
                y: { type: yConfig.type || 'linear', min: yConfig.min, max: yConfig.max, ticks: { color: '#71717a' }, grid: { color: '#3f3f46' } } 
            }
        };
    }, []);
    const auroraOptions = useMemo(() => createChartOptions(auroraTimeRange, { min: 0, max: 100 }), [auroraTimeRange, createChartOptions]);
    const magneticOptions = useMemo(() => createChartOptions(magneticTimeRange), [magneticTimeRange, createChartOptions]);
    
    // --- Data Fetching & Processing Effects ---
    useEffect(() => {
        setIsLoading(true);
        Promise.all([
            fetch(`${FORECAST_API_URL}?_=${Date.now()}`).then(res => res.json()),
            fetch(`${NOAA_PLASMA_URL}?_=${Date.now()}`).then(res => res.json()),
            fetch(`${NOAA_MAG_URL}?_=${Date.now()}`).then(res => res.json()),
        ]).then(([forecastData, plasmaData, magData]) => {
            const { currentForecast, historicalData } = forecastData;
            setAuroraScore(currentForecast.spotTheAuroraForecast);
            setLastUpdated(`Last Updated: ${formatNZTimestamp(currentForecast.lastUpdated)}`);
            setAuroraBlurb(getAuroraBlurb(currentForecast.spotTheAuroraForecast));
            setAllAuroraData({
                base: (historicalData || []).map((item: any) => ({ x: item.timestamp, y: item.baseScore })),
                real: (historicalData || []).map((item: any) => ({ x: item.timestamp, y: item.finalScore })),
            });
            const { bt, bz } = currentForecast.inputs.magneticField;
            setGaugeData(prev => ({ ...prev, power: { ...prev.power, value: currentForecast.inputs.hemisphericPower.toFixed(1), ...getGaugeStyle(currentForecast.inputs.hemisphericPower, 'power'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast.lastUpdated)}` }, bt: { ...prev.bt, value: bt.toFixed(1), ...getGaugeStyle(bt, 'bt'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast.lastUpdated)}` }, bz: { ...prev.bz, value: bz.toFixed(1), ...getGaugeStyle(bz, 'bz'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast.lastUpdated)}` }, moon: getMoonData(currentForecast.inputs.moonReduction, currentForecast.inputs.owmDataLastFetched) }));
            
            // ** FIX: Appending 'Z' to plasma timestamp to ensure it's parsed as UTC **
            const plasmaHeaders = plasmaData[0]; const speedIdx = plasmaHeaders.indexOf('speed'); const densityIdx = plasmaHeaders.indexOf('density'); const plasmaTimeIdx = plasmaHeaders.indexOf('time_tag');
            const latestPlasmaRow = plasmaData.slice(1).reverse().find((r: any[]) => parseFloat(r[speedIdx]) > -9999);
            const speedVal = latestPlasmaRow ? parseFloat(latestPlasmaRow[speedIdx]) : null; const densityVal = latestPlasmaRow ? parseFloat(latestPlasmaRow[densityIdx]) : null; 
            const plasmaTimestamp = latestPlasmaRow ? Date.parse(latestPlasmaRow[plasmaTimeIdx] + 'Z') : Date.now();
            setGaugeData(prev => ({ ...prev, speed: { ...prev.speed, value: speedVal ? speedVal.toFixed(1) : '...', ...getGaugeStyle(speedVal, 'speed'), lastUpdated: `Updated: ${formatNZTimestamp(plasmaTimestamp)}` }, density: { ...prev.density, value: densityVal ? densityVal.toFixed(1) : '...', ...getGaugeStyle(densityVal, 'density'), lastUpdated: `Updated: ${formatNZTimestamp(plasmaTimestamp)}` } }));

            // ** FIX: Appending 'Z' to magnetic field timestamps to ensure they are parsed as UTC **
            const magHeaders = magData[0]; const magBtIdx = magHeaders.indexOf('bt'); const magBzIdx = magHeaders.indexOf('bz_gsm'); const magTimeIdx = magHeaders.indexOf('time_tag');
            setAllMagneticData(magData.slice(1).map((r: any[]) => ({ time: new Date(r[magTimeIdx] + 'Z').getTime(), bt: parseFloat(r[magBtIdx]) > -9999 ? parseFloat(r[magBtIdx]) : null, bz: parseFloat(r[magBzIdx]) > -9999 ? parseFloat(r[magBzIdx]) : null })));
        
        }).catch(error => { console.error("Dashboard data failed to load:", error); setAuroraBlurb("Could not load forecast data.");
        }).finally(() => { setIsLoading(false); });
        
        setEpamImageUrl(`${ACE_EPAM_URL}?_=${Date.now()}`);
    }, []);

    // --- Map Initialization and Sightings Logic ---
    useEffect(() => {
        if (isLoading || !mapContainerRef.current || mapRef.current) return;

        mapRef.current = L.map(mapContainerRef.current, {
            center: [-41.2, 172.5],
            zoom: 5,
            scrollWheelZoom: true,
        });

        L.tileLayer('https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
        }).addTo(mapRef.current);

        sightingMarkersLayerRef.current = L.markerClusterGroup();
        mapRef.current.addLayer(sightingMarkersLayerRef.current);

        mapRef.current.on('click', (e: L.LeafletMouseEvent) => {
            if (reportingStateRef.current === 'placing_pin') {
                if (userPinRef.current) {
                    userPinRef.current.setLatLng(e.latlng);
                } else {
                    const pinIcon = L.divIcon({ html: '📍', className: 'sighting-emoji-icon !text-4xl', iconAnchor: [16, 32] });
                    userPinRef.current = L.marker(e.latlng, { draggable: true, icon: pinIcon }).addTo(mapRef.current!);
                }
            }
        });
        
        setTimeout(() => mapRef.current?.invalidateSize(), 100);

        return () => {
            mapRef.current?.remove();
            mapRef.current = null;
        };
    }, [isLoading]);

    useEffect(() => {
        const fetchAndDisplaySightings = () => {
            if (!sightingMarkersLayerRef.current) return;

            fetch(`${SIGHTING_API_ENDPOINT}?_=${Date.now()}`)
            .then(res => res.ok ? res.json() : Promise.reject(new Error(`API Error ${res.status}`)))
            .then(sightings => {
                if (Array.isArray(sightings) && sightingMarkersLayerRef.current) {
                    sightingMarkersLayerRef.current.clearLayers();
                    const sortedSightings = [...sightings].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                    setAllSightings(sortedSightings);

                    sortedSightings.forEach(s => {
                        const sightingInfo = SIGHTING_TYPES[s.status];
                        if (sightingInfo && typeof s.lat === 'number' && typeof s.lng === 'number') {
                            const emojiIcon = L.divIcon({ html: sightingInfo.emoji, className: 'sighting-emoji-icon', iconSize: [24, 24] });
                            const marker = L.marker([s.lat, s.lng], { icon: emojiIcon });
                            marker.bindPopup(`<b>${sightingInfo.label}</b> by ${s.name || 'Anonymous'}<br>at ${new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
                            sightingMarkersLayerRef.current?.addLayer(marker);
                        }
                    });
                }
            })
            .catch(e => console.error("Failed to fetch sightings:", e));
        };
        
        if (!isLoading) {
            fetchAndDisplaySightings();
            const interval = setInterval(fetchAndDisplaySightings, 60000);
            return () => clearInterval(interval);
        }
    }, [isLoading]);

    const getAuroraBlurb = (score: number) => { if (score < 10) return 'Little to no auroral activity.'; if (score < 25) return 'Minimal auroral activity likely.'; if (score < 40) return 'Clear auroral activity visible in cameras.'; if (score < 50) return 'Faint auroral glow potentially visible to the naked eye.'; if (score < 80) return 'Good chance of naked-eye color and structure.'; return 'High probability of a significant substorm.'; };
    const getMoonData = (moonReduction: number, timestamp: number) => { const moonIllumination = Math.max(0, (moonReduction || 0) / 40 * 100); let moonEmoji = '🌑'; if (moonIllumination > 95) moonEmoji = '🌕'; else if (moonIllumination > 55) moonEmoji = '🌖'; else if (moonIllumination > 45) moonEmoji = '🌗'; else if (moonIllumination > 5) moonEmoji = '🌒'; return { value: moonIllumination.toFixed(0), unit: '%', emoji: moonEmoji, percentage: moonIllumination, lastUpdated: `Updated: ${formatNZTimestamp(timestamp)}`, color: '#A9A9A9' }; };
    
    useEffect(() => { if (allAuroraData.base.length) { setAuroraChartData({ datasets: [ { label: 'Base Score', data: allAuroraData.base, borderColor: '#A9A9A9', tension: 0.4, borderWidth: 1.5, pointRadius: 0 }, { label: 'Spot The Aurora Forecast', data: allAuroraData.real, borderColor: '#FF6347', tension: 0.4, borderWidth: 2, pointRadius: 0, fill: 'origin', backgroundColor: 'rgba(255, 99, 71, 0.2)' } ] }); } }, [allAuroraData]);
    useEffect(() => { if (allMagneticData.length) { setMagneticChartData({ datasets: [ { label: 'Bt', data: allMagneticData.map(p => ({x: p.time, y: p.bt})), borderColor: '#A9A9A9', tension: 0.3, borderWidth: 1.5, pointRadius: 0 }, { label: 'Bz', data: allMagneticData.map(p => ({x: p.time, y: p.bz})), borderColor: '#FF6347', tension: 0.3, borderWidth: 1.5, pointRadius: 0 } ] }); } }, [allMagneticData]);

    const handleStartReporting = () => { if (!reporterName.trim()) { alert("Please enter your name to start reporting."); return; } setReportingState('placing_pin'); };
    const handleCancelReporting = () => { 
        if(userPinRef.current && mapRef.current) {
            mapRef.current.removeLayer(userPinRef.current);
            userPinRef.current = null;
        }
        setReportingState('idle'); 
    };
    const handleConfirmLocation = () => { if (!userPinRef.current) { alert("Please place a pin on the map by clicking your location."); return; } userPinRef.current.dragging?.disable(); setReportingState('confirming_location'); };
    const handleSubmitSighting = async (sightingType: string) => { if (!userPinRef.current) return; setReportingState('submitting'); const { lat, lng } = userPinRef.current.getLatLng(); try { await fetch(SIGHTING_API_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat, lng, status: sightingType, name: reporterName }) }); handleCancelReporting(); } catch (error) { alert("There was an error submitting your report. Please try again."); setReportingState('confirming_location'); } };
    const paginatedSightings = allSightings.slice(sightingPage * 5, (sightingPage + 1) * 5);
    
    return (
        <div className="w-full h-full overflow-y-auto bg-neutral-900 text-neutral-300 p-5">
            <style>{`.sighting-emoji-icon { font-size: 1.5rem; text-align: center; line-height: 1; text-shadow: 0 0 8px rgba(0,0,0,0.9); background: none; border: none; } .sighting-emoji-icon.\\!text-4xl { font-size: 2.5rem !important; } .leaflet-popup-content-wrapper, .leaflet-popup-tip { background-color: #262626; color: #fafafa; }`}</style>
            <div className="container mx-auto">
                <header className="text-center mb-8">
                    <a href="https://www.tnrprotography.co.nz" target="_blank" rel="noopener noreferrer"><img src="https://www.tnrprotography.co.nz/uploads/1/3/6/6/136682089/white-tnr-protography-w_orig.png" alt="TNR Protography Logo" className="mx-auto w-full max-w-[250px] mb-4"/></a>
                    <h1 className="text-3xl font-bold text-neutral-100">Spot The Aurora - West Coast Aurora Forecast</h1>
                </header>
                <main className="grid grid-cols-12 gap-6">
                    <div className="col-span-12 card bg-neutral-950/80 p-6 md:grid md:grid-cols-2 md:gap-8 items-center">
                        <div>
                            <div className="flex items-center mb-4"><h2 className="text-lg font-semibold text-white">Spot The Aurora Forecast</h2><button onClick={() => openModal('forecast')} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button></div>
                            <div className="text-6xl font-extrabold text-white">{auroraScore !== null ? `${auroraScore.toFixed(1)}%` : '...'} <span className="text-5xl">{getAuroraEmoji(auroraScore)}</span></div>
                            <div className="w-full bg-neutral-700 rounded-full h-3 mt-4"><div className="h-3 rounded-full" style={{ width: `${auroraScore || 0}%`, backgroundColor: auroraScore !== null ? getGaugeStyle(auroraScore, 'power').color : GAUGE_COLORS.gray }}></div></div>
                            <div className="text-sm text-neutral-400 mt-2">{lastUpdated}</div>
                        </div>
                        <p className="text-neutral-300 mt-4 md:mt-0">{auroraBlurb}</p>
                    </div>

                    <div className="col-span-12 grid grid-cols-6 gap-5">
                        {Object.entries(gaugeData).map(([key, data]) => (
                            <div key={key} className="col-span-3 md:col-span-2 lg:col-span-1 card bg-neutral-950/80 p-4 text-center flex flex-col justify-between">
                                <div className="flex justify-center items-center"><h3 className="text-md font-semibold text-white h-10 flex items-center justify-center">{key === 'moon' ? 'Moon' : key.toUpperCase()}</h3><button onClick={() => openModal(key)} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button></div>
                                <div className="text-3xl font-bold my-2">{data.value} <span className="text-lg">{data.unit}</span></div>
                                <div className="text-3xl my-2">{data.emoji}</div>
                                <div className="w-full bg-neutral-700 rounded-full h-2"><div className="h-2 rounded-full" style={{ width: `${data.percentage}%`, backgroundColor: data.color }}></div></div>
                                <div className="text-xs text-neutral-500 mt-2 truncate" title={data.lastUpdated}>{data.lastUpdated}</div>
                            </div>
                        ))}
                    </div>

                    <div className="col-span-12 card bg-neutral-950/80 p-6">
                        <div className="flex flex-col lg:flex-row gap-6">
                            <div className="w-full lg:w-2/3 h-[500px] rounded-lg overflow-hidden border border-neutral-700" ref={mapContainerRef}>
                                {isLoading && <div className="w-full h-full flex justify-center items-center"><LoadingSpinner/></div>}
                            </div>
                            
                            <div className="w-full lg:w-1/3 flex flex-col gap-4">
                                <h3 className="text-xl font-semibold text-white text-center">Community Sightings</h3>
                                <div className="bg-neutral-900 p-4 rounded-lg border border-neutral-800 flex-shrink-0">
                                    {reportingState === 'idle' && (<><h4 className="font-semibold text-center mb-2">File a New Report</h4><input type="text" value={reporterName} onChange={e => setReporterName(e.target.value)} placeholder="Your Name" className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm mb-2"/><button onClick={handleStartReporting} disabled={!reporterName.trim()} className="w-full bg-sky-600 hover:bg-sky-500 disabled:bg-neutral-600 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded transition-colors">Start Report</button></>)}
                                    {reportingState === 'placing_pin' && (<div className="text-center space-y-3"><p className="text-sm font-semibold">Step 1: Place Your Pin</p><p className="text-xs text-neutral-400">Click the map to place a pin, then confirm.</p><button onClick={handleConfirmLocation} disabled={!userPinRef.current} className="w-full bg-green-600 hover:bg-green-500 disabled:bg-neutral-600 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded transition-colors">Confirm Location</button><button onClick={handleCancelReporting} className="text-xs text-neutral-400 hover:underline">Cancel</button></div>)}
                                    {(reportingState === 'confirming_location' || reportingState === 'submitting') && (<div className="space-y-2"><p className="text-sm font-semibold text-center">Step 2: What did you see?</p>{Object.entries(SIGHTING_TYPES).map(([key, { label, emoji }]) => (<button key={key} onClick={() => handleSubmitSighting(key)} disabled={reportingState === 'submitting'} className="w-full flex items-center gap-3 p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors disabled:opacity-50"><span className="text-2xl">{emoji}</span><span>{label}</span></button>))}<button onClick={handleCancelReporting} disabled={reportingState === 'submitting'} className="text-xs text-neutral-400 hover:underline mt-2 w-full text-center disabled:opacity-50">Cancel</button></div>)}
                                </div>
                                <div className="flex-grow space-y-3 min-h-[200px] max-h-96 overflow-y-auto pr-2">
                                    {paginatedSightings.length > 0 ? paginatedSightings.map((sighting) => (<div key={sighting.timestamp} className="bg-neutral-900 p-3 rounded-lg flex items-center gap-4"><span className="text-3xl">{SIGHTING_TYPES[sighting.status]?.emoji || '❓'}</span><div><p className="font-semibold text-neutral-200">{SIGHTING_TYPES[sighting.status]?.label} by <span className="text-sky-400">{sighting.name || 'Anonymous'}</span></p><p className="text-sm text-neutral-400">{sighting.location || 'Unknown'} • {new Date(sighting.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p></div></div>)) : <p className="text-center text-neutral-500 italic pt-8">No recent sightings.</p>}
                                </div>
                                {allSightings.length > 5 && (<div className="flex justify-between items-center mt-2 flex-shrink-0"><button onClick={() => setSightingPage(p => Math.max(0, p - 1))} disabled={sightingPage === 0} className="px-3 py-1 text-xs bg-neutral-700 hover:bg-neutral-600 rounded-md disabled:opacity-50">Prev</button><span className="text-xs">Page {sightingPage + 1} of {Math.ceil(allSightings.length / 5)}</span><button onClick={() => setSightingPage(p => p + 1)} disabled={(sightingPage + 1) * 5 >= allSightings.length} className="px-3 py-1 text-xs bg-neutral-700 hover:bg-neutral-600 rounded-md disabled:opacity-50">Next</button></div>)}
                            </div>
                        </div>
                    </div>

                    <div className="col-span-12 lg:col-span-6 card bg-neutral-950/80 p-4 h-[500px] flex flex-col">
                        <h2 className="text-xl font-semibold text-white text-center">Spot The Aurora Forecast (Last {auroraTimeLabel})</h2>
                        <TimeRangeButtons onSelect={(duration, label) => { setAuroraTimeRange(duration); setAuroraTimeLabel(label); }} selected={auroraTimeRange} />
                        <div className="flex-grow relative mt-2">{auroraChartData.datasets.length > 0 && auroraChartData.datasets[0]?.data.length > 0 ? <Line data={auroraChartData} options={auroraOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">Loading Chart...</p>}</div>
                    </div>
                    <div className="col-span-12 lg:col-span-6 card bg-neutral-950/80 p-4 h-[500px] flex flex-col">
                        <h2 className="text-xl font-semibold text-white text-center">Magnetic Field (Last {magneticTimeLabel})</h2>
                        <TimeRangeButtons onSelect={(duration, label) => {setMagneticTimeRange(duration); setMagneticTimeLabel(label)}} selected={magneticTimeRange} />
                         <div className="flex-grow relative mt-2">{magneticChartData.datasets.length > 0 && magneticChartData.datasets[0]?.data.length > 0 ? <Line data={magneticChartData} options={magneticOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">Loading Chart...</p>}</div>
                    </div>
                    <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col">
                        <h3 className="text-xl font-semibold text-center text-white mb-4">Live Cloud Cover</h3>
                        <div className="relative w-full" style={{paddingBottom: "56.25%"}}><iframe title="Windy.com Cloud Map" className="absolute top-0 left-0 w-full h-full rounded-lg" src="https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=mm&metricTemp=°C&metricWind=km/h&zoom=5&overlay=clouds&product=ecmwf&level=surface&lat=-44.757&lon=169.054" frameBorder="0"></iframe></div>
                    </div>
                    <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col">
                        <h3 className="text-xl font-semibold text-center text-white mb-4">Queenstown Live Camera</h3>
                        <div className="relative w-full" style={{paddingBottom: "56.25%"}}><iframe title="Live View from Queenstown" className="absolute top-0 left-0 w-full h-full rounded-lg" src="https://queenstown.roundshot.com/#/"></iframe></div>
                    </div>
                    <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col">
                        <div className="flex justify-center items-center"><h2 className="text-xl font-semibold text-white text-center">ACE EPAM (Last 3 Days)</h2><button onClick={() => openModal('epam')} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button></div>
                         <div onClick={() => setViewerMedia && epamImageUrl !== '/placeholder.png' && setViewerMedia({ url: epamImageUrl, type: 'image' })} className="flex-grow relative mt-2 cursor-pointer min-h-[300px]"><img src={epamImageUrl} alt="ACE EPAM Data" className="w-full h-full object-contain" /></div>
                    </div>
                </main>
                <footer className="page-footer mt-10 pt-8 border-t border-neutral-700 text-center text-neutral-400 text-sm">
                    <h3 className="text-lg font-semibold text-neutral-200 mb-4">About This Dashboard</h3>
                    <p className="max-w-3xl mx-auto leading-relaxed">This dashboard provides a highly localized, 2-hour aurora forecast specifically for the West Coast of New Zealand. The proprietary "Spot The Aurora Forecast" combines live solar wind data with local factors like astronomical darkness and lunar phase to generate a more nuanced prediction than global models.</p>
                    <p className="max-w-3xl mx-auto leading-relaxed mt-4"><strong>Disclaimer:</strong> The aurora is a natural and unpredictable phenomenon. This forecast is an indication of potential activity, not a guarantee of a visible display. Conditions can change rapidly.</p>
                    <div className="mt-8 text-xs text-neutral-500"><p>Data provided by <a href="https://www.swpc.noaa.gov/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">NOAA SWPC</a> & <a href="https://api.nasa.gov/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">NASA</a> | Weather & Cloud data by <a href="https://www.windy.com" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">Windy.com</a> | Live Camera by <a href="https://queenstown.roundshot.com/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">Roundshot</a></p><p className="mt-2">Forecast Algorithm, Visualization, and Development by TNR Protography</p></div>
                </footer>
             </div>
            {modalState && <InfoModal {...modalState} onClose={closeModal} />}
        </div>
    );
};

export default ForecastDashboard;