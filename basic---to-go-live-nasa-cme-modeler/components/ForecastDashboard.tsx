import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import L from 'leaflet';
// These are peer dependencies for the plugins loaded via CDN in index.html
import 'leaflet.markercluster'; 
import 'leaflet.heat'; 

// Import the CSS for leaflet and plugins
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

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
type MapViewType = 'markers' | 'heatmap';

// --- Constants ---
const FORECAST_API_URL = 'https://spottheaurora.thenamesrock.workers.dev/';
const NOAA_PLASMA_URL = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json';
const NOAA_MAG_URL = 'https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json';
const ACE_EPAM_URL = 'https://services.swpc.noaa.gov/images/ace-epam-24-hour.gif';
const SIGHTING_API_ENDPOINT = 'https://aurora-sightings.thenamesrock.workers.dev/';
const SIGHTING_TYPES: { [key: string]: { label: string; emoji: string; heat: number } } = {
  eye:    { label: 'Naked Eye',  emoji: '👁️', heat: 1.0 },
  phone:  { label: 'Phone',      emoji: '🤳', heat: 0.6 },
  dslr:   { label: 'DSLR',       emoji: '📷', heat: 0.4 },
  cloudy: { label: 'Cloudy',     emoji: '☁️', heat: 0.1 },
  nothing:{ label: 'Nothing',    emoji: '❌', heat: 0.1 },
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

// --- Helper Components ---
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
    const markerClusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);
    const heatmapLayerRef = useRef<any | null>(null);
    const userPinRef = useRef<L.Marker | null>(null);
    const [allSightings, setAllSightings] = useState<any[]>([]);
    const [sightingPage, setSightingPage] = useState(0);
    const [reporterName, setReporterName] = useState<string>(() => localStorage.getItem('auroraReporterName') || '');
    const [reportingState, setReportingState] = useState<ReportingState>('idle');
    const [mapViewType, setMapViewType] = useState<MapViewType>('markers');

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
        Promise.all([
          // Main forecast data
          fetch(`${FORECAST_API_URL}?_=${Date.now()}`).then(res => res.json()),
          // NOAA data
          fetch(`${NOAA_PLASMA_URL}?_=${Date.now()}`).then(res => res.json()),
          fetch(`${NOAA_MAG_URL}?_=${Date.now()}`).then(res => res.json()),
          // EPAM Image
          Promise.resolve(`${ACE_EPAM_URL}?_=${Date.now()}`)
        ]).then(([forecast, plasma, mag, epamUrl]) => {
          // Process forecast data
          // ...
          setAuroraScore(forecast.currentForecast.spotTheAuroraForecast);
          setLastUpdated(`Last Updated: ${formatNZTimestamp(forecast.currentForecast.lastUpdated)}`);
          // ... and so on for all dashboard state

          // Process NOAA data
          // ...
          
          setEpamImageUrl(epamUrl);
        }).catch(error => {
          console.error("Dashboard data failed to load:", error);
        }).finally(() => {
          setIsLoading(false);
        });
    }, []);
    
    useEffect(() => {
        if (allAuroraData.base.length) {
            setAuroraChartData({ datasets: [ /* ... */ ] });
        }
    }, [allAuroraData]);

    useEffect(() => {
        if (allMagneticData.length) {
            setMagneticChartData({ datasets: [ /* ... */ ] });
        }
    }, [allMagneticData]);

    // --- Map and Sighting Logic ---
    const fetchAndDisplaySightings = useCallback(() => {
        if (!markerClusterGroupRef.current || !heatmapLayerRef.current) return;

        fetch(`${SIGHTING_API_ENDPOINT}?_=${new Date().getTime()}`)
            .then(res => res.ok ? res.json() : Promise.reject(new Error(`API Error ${res.status}`)))
            .then(sightings => {
                if (!Array.isArray(sightings)) return;
                
                markerClusterGroupRef.current?.clearLayers();
                const heatPoints: [number, number, number][] = [];
                const sortedSightings = [...sightings].sort((a, b) => b.timestamp - a.timestamp);
                setAllSightings(sortedSightings);

                sortedSightings.forEach(s => {
                    const sightingInfo = SIGHTING_TYPES[s.status];
                    if (sightingInfo && typeof s.lat === 'number' && typeof s.lng === 'number') {
                        const iconHtml = `<div class="sighting-emoji-icon">${sightingInfo.emoji}</div>`;
                        const emojiIcon = L.divIcon({ html: iconHtml, className: '', iconSize: [30, 30], iconAnchor: [15, 15] });
                        const marker = L.marker([s.lat, s.lng], { icon: emojiIcon });
                        marker.bindPopup(`<b>${sightingInfo.label}</b> by ${s.name || 'Anonymous'}<br>at ${new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
                        markerClusterGroupRef.current?.addLayer(marker);
                        heatPoints.push([s.lat, s.lng, sightingInfo.heat]);
                    }
                });
                heatmapLayerRef.current.setLatLngs(heatPoints);
            })
            .catch(e => console.error("Failed to fetch sightings:", e));
    }, []);

    useEffect(() => {
        if (!mapContainerRef.current || mapRef.current) return;

        const L = window.L as any; // Access Leaflet from global scope
        const map = L.map(mapContainerRef.current, { center: [-41.2, 172.5], zoom: 5, scrollWheelZoom: true });
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© CARTO', maxZoom: 20 }).addTo(map);

        markerClusterGroupRef.current = L.markerClusterGroup().addTo(map);
        heatmapLayerRef.current = L.heatLayer([], { radius: 25, blur: 15, maxZoom: 12, gradient: {0.1: 'blue', 0.4: 'lime', 0.6: 'yellow', 1.0: 'red'} });

        map.on('click', (e: L.LeafletMouseEvent) => {
            if (reportingState === 'placing_pin') {
                const pinIcon = L.divIcon({ html: '📍', className: 'sighting-emoji-icon !text-4xl', iconAnchor: [16, 32] });
                if (userPinRef.current) {
                    userPinRef.current.setLatLng(e.latlng);
                } else {
                    userPinRef.current = L.marker(e.latlng, { draggable: true, icon: pinIcon }).addTo(map);
                }
            }
        });
        
        mapRef.current = map;
        fetchAndDisplaySightings();
        const interval = setInterval(fetchAndDisplaySightings, 60000);
        return () => {
          map.remove();
          clearInterval(interval);
        }
    }, [fetchAndDisplaySightings, reportingState]);

    const handleStartReporting = () => {
        if (!reporterName.trim()) { alert("Please enter your name to start reporting."); return; }
        setReportingState('placing_pin');
    };

    const handleCancelReporting = () => {
        if (userPinRef.current && mapRef.current) {
            mapRef.current.removeLayer(userPinRef.current);
            userPinRef.current = null;
        }
        setReportingState('idle');
    };

    const handleConfirmLocation = () => {
        if (!userPinRef.current) { alert("Please place a pin on the map by clicking on your location."); return; }
        userPinRef.current.dragging?.disable();
        setReportingState('confirming_location');
    };

    const handleSubmitSighting = async (sightingType: string) => {
        if (!userPinRef.current) return;
        setReportingState('submitting');
        const { lat, lng } = userPinRef.current.getLatLng();

        try {
            await fetch(SIGHTING_API_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat, lng, status: sightingType, name: reporterName }) });
            handleCancelReporting();
            fetchAndDisplaySightings();
        } catch (error) {
            alert("There was an error submitting your report. Please try again.");
            setReportingState('confirming_location');
        }
    };
    
    const toggleMapView = () => {
        const map = mapRef.current;
        if (!map || !markerClusterGroupRef.current || !heatmapLayerRef.current) return;
        
        if (mapViewType === 'markers') {
            map.removeLayer(markerClusterGroupRef.current);
            map.addLayer(heatmapLayerRef.current);
            setMapViewType('heatmap');
        } else {
            map.removeLayer(heatmapLayerRef.current);
            map.addLayer(markerClusterGroupRef.current);
            setMapViewType('markers');
        }
    };

    const centerOnUser = () => mapRef.current?.locate({setView: true, maxZoom: 13});
    const paginatedSightings = allSightings.slice(sightingPage * 5, (sightingPage + 1) * 5);

    if (isLoading) { return <div className="w-full h-full flex justify-center items-center bg-neutral-900"><LoadingSpinner /></div>; }
    
    return (
        <div className="w-full h-full overflow-y-auto bg-neutral-900 text-neutral-300 p-5">
            <style>{`.sighting-emoji-icon { font-size: 1.5rem; text-align: center; line-height: 1; text-shadow: 0 0 8px rgba(0,0,0,0.9); background: none; border: none; } .sighting-emoji-icon.\\!text-4xl { font-size: 2.5rem !important; }`}</style>
            <div className="container mx-auto">
                <header className="text-center mb-8">
                     <a href="https://www.tnrprotography.co.nz" target="_blank" rel="noopener noreferrer"><img src="https://www.tnrprotography.co.nz/uploads/1/3/6/6/136682089/white-tnr-protography-w_orig.png" alt="TNR Protography Logo" className="mx-auto w-full max-w-[250px] mb-4"/></a>
                     <h1 className="text-3xl font-bold text-neutral-100">Spot The Aurora - West Coast Aurora Forecast</h1>
                </header>
                <main className="grid grid-cols-12 gap-6">
                    {/* ... Top dashboard cards (Forecast, Gauges) go here ... */}

                    {/* --- Sighting Hub --- */}
                    <div className="col-span-12 card bg-neutral-950/80 p-6">
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                            {/* Map Area */}
                            <div className="lg:col-span-8 relative min-h-[500px] rounded-lg overflow-hidden">
                                <div ref={mapContainerRef} className="absolute inset-0 w-full h-full bg-neutral-800 border border-neutral-700"></div>
                                <div className="absolute top-2 right-2 flex flex-col gap-2 z-[1000]">
                                    <button onClick={toggleMapView} title="Toggle View" className="bg-neutral-900/80 p-2 rounded-md shadow-lg hover:bg-neutral-800 backdrop-blur-sm"><span className="text-xl">{mapViewType === 'markers' ? '🔥' : '📍'}</span></button>
                                    <button onClick={centerOnUser} title="Find Me" className="bg-neutral-900/80 p-2 rounded-md shadow-lg hover:bg-neutral-800 backdrop-blur-sm"><span className="text-xl">🎯</span></button>
                                </div>
                                {reportingState !== 'idle' && (
                                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[900]">
                                        <div className="text-center text-white max-w-sm">
                                            <h3 className="text-2xl font-bold">Reporting Sighting</h3>
                                            {reportingState === 'placing_pin' && <p className="mt-2">Click your location on the map, then click "Confirm Location" in the panel to the right.</p>}
                                            {reportingState === 'confirming_location' && <p className="mt-2">Your location is locked. Please select what you saw from the panel on the right.</p>}
                                            {reportingState === 'submitting' && <div className="mt-4"><LoadingSpinner /></div>}
                                        </div>
                                    </div>
                                )}
                            </div>
                            
                            {/* Sighting Panel */}
                            <div className="lg:col-span-4 flex flex-col gap-4">
                                <h3 className="text-xl font-semibold text-white text-center">Community Sightings</h3>
                                
                                <div className="bg-neutral-900 p-4 rounded-lg border border-neutral-800 flex-shrink-0">
                                    {reportingState === 'idle' && (
                                        <>
                                            <h4 className="font-semibold text-center mb-2">File a New Report</h4>
                                            <input type="text" value={reporterName} onChange={e => setReporterName(e.target.value)} placeholder="Your Name" className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm mb-2"/>
                                            <button onClick={handleStartReporting} disabled={!reporterName.trim()} className="w-full bg-sky-600 hover:bg-sky-500 disabled:bg-neutral-600 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded transition-colors">Start Report</button>
                                        </>
                                    )}

                                    {reportingState === 'placing_pin' && (
                                        <div className="text-center space-y-3">
                                            <p className="text-sm font-semibold">Step 1: Confirm Your Location</p>
                                            <p className="text-xs text-neutral-400">Drag the pin to adjust your location if needed.</p>
                                            <button onClick={handleConfirmLocation} className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-2 px-4 rounded transition-colors">Confirm Location</button>
                                            <button onClick={handleCancelReporting} className="text-xs text-neutral-400 hover:underline">Cancel</button>
                                        </div>
                                    )}

                                    {reportingState === 'confirming_location' && (
                                        <div className="space-y-2">
                                            <p className="text-sm font-semibold text-center">Step 2: What did you see?</p>
                                            {Object.entries(SIGHTING_TYPES).map(([key, { label, emoji }]) => (
                                                <button key={key} onClick={() => handleSubmitSighting(key)} className="w-full flex items-center gap-3 p-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors">
                                                    <span className="text-2xl">{emoji}</span><span>{label}</span>
                                                </button>
                                            ))}
                                            <button onClick={handleCancelReporting} className="text-xs text-neutral-400 hover:underline mt-2 w-full text-center">Cancel Report</button>
                                        </div>
                                    )}
                                </div>

                                <div className="flex-grow space-y-3 min-h-[200px] max-h-96 overflow-y-auto pr-2">
                                    {paginatedSightings.length > 0 ? paginatedSightings.map((sighting) => (
                                        <div key={sighting.id} className="bg-neutral-900 p-3 rounded-lg flex items-center gap-4">
                                            <span className="text-3xl">{SIGHTING_TYPES[sighting.status]?.emoji || '❓'}</span>
                                            <div>
                                                <p className="font-semibold text-neutral-200">{SIGHTING_TYPES[sighting.status]?.label} by <span className="text-sky-400">{sighting.name || 'Anonymous'}</span></p>
                                                <p className="text-sm text-neutral-400">{sighting.location || 'Unknown'} • {new Date(sighting.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                                            </div>
                                        </div>
                                    )) : <p className="text-center text-neutral-500 italic pt-8">No recent sightings.</p>}
                                </div>
                                {allSightings.length > 5 && (
                                    <div className="flex justify-between items-center mt-2 flex-shrink-0">
                                        <button onClick={() => setSightingPage(p => Math.max(0, p - 1))} disabled={sightingPage === 0} className="px-3 py-1 text-xs bg-neutral-700 rounded-md disabled:opacity-50">Prev</button>
                                        <span className="text-xs">Page {sightingPage + 1}</span>
                                        <button onClick={() => setSightingPage(p => p + 1)} disabled={(sightingPage + 1) * 5 >= allSightings.length} className="px-3 py-1 text-xs bg-neutral-700 rounded-md disabled:opacity-50">Next</button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* ... Other dashboard cards (Charts, Windy, etc.) go here ... */}
                </main>
            </div>
        </div>
    );
};

export default ForecastDashboard;