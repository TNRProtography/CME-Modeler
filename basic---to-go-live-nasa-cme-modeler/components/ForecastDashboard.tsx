import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Line } from 'react-chartjs-2';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import CloseIcon from './icons/CloseIcon';

// This interface is needed to make setViewerMedia optional, as it is not used in this component yet
interface ForecastDashboardProps {
  setViewerMedia?: (media: { url: string, type: 'image' | 'video' } | null) => void;
}

const NOAA_PLASMA_ENDPOINT = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-5-minute.json';
const NOAA_MAG_ENDPOINT = 'https://services.swpc.noaa.gov/products/solar-wind/mag-2-hour.json';
const SIGHTING_API_ENDPOINT = 'https://aurora-sightings.thenamesrock.workers.dev/';

const GAUGE_API_ENDPOINTS = {
  power: 'https://hemispheric-power.thenamesrock.workers.dev/',
  speed: NOAA_PLASMA_ENDPOINT,
  density: NOAA_PLASMA_ENDPOINT,
  bt: NOAA_MAG_ENDPOINT,
  bz: NOAA_MAG_ENDPOINT
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

const ForecastDashboard: React.FC<ForecastDashboardProps> = () => {
    const [auroraScore, setAuroraScore] = useState<number | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);
    const [auroraBlurb, setAuroraBlurb] = useState<string>('Loading forecast...');
    const [gaugeData, setGaugeData] = useState<Record<string, { value: string; emoji: string; percentage: number; lastUpdated: string; color: string }>>({
        power: { value: '...', emoji: GAUGE_EMOJIS.error, percentage: 0, lastUpdated: '...', color: GAUGE_COLORS.gray },
        speed: { value: '...', emoji: GAUGE_EMOJIS.error, percentage: 0, lastUpdated: '...', color: GAUGE_COLORS.gray },
        density: { value: '...', emoji: GAUGE_EMOJIS.error, percentage: 0, lastUpdated: '...', color: GAUGE_COLORS.gray },
        bt: { value: '...', emoji: GAUGE_EMOJIS.error, percentage: 0, lastUpdated: '...', color: GAUGE_COLORS.gray },
        bz: { value: '...', emoji: GAUGE_EMOJIS.error, percentage: 0, lastUpdated: '...', color: GAUGE_COLORS.gray },
    });

    const [auroraChartData, setAuroraChartData] = useState<any>(null);
    const [magneticChartData, setMagneticChartData] = useState<any>(null);
    const [sightingStatus, setSightingStatus] = useState<{ loading: boolean; message: string } | null>(null);
    const [reporterName, setReporterName] = useState<string>(localStorage.getItem('auroraReporterName') || '');
    
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const sightingMarkersLayerRef = useRef<L.LayerGroup | null>(null);
    const manualPinMarkerRef = useRef<L.Marker | null>(null);
    const isPlacingManualPin = useRef<boolean>(false);
    const manualReportStatus = useRef<string | null>(null);
    
    const apiDataCache = useRef<Record<string, any>>({});
    const [modalState, setModalState] = useState<{ isOpen: boolean; title: string; content: string } | null>(null);

    const openModal = useCallback((id: string) => {
        const content = tooltipContent[id as keyof typeof tooltipContent];
        if (content) setModalState({ isOpen: true, ...content });
    }, []);

    const closeModal = useCallback(() => setModalState(null), []);

    const tooltipContent = {
        'forecast': { title: 'About The Forecast Score', content: `This is a proprietary TNR Protography forecast that combines live solar wind data with local conditions like lunar phase and astronomical darkness. It is highly accurate for the next 2 hours. Remember, patience is key and always look south!
                          <br><br><strong>What the Percentage Means:</strong>
                          <ul>
                            <li><strong>< 10% 😞:</strong> Little to no auroral activity.</li>
                            <li><strong>10-25% 😐:</strong> Minimal activity; cameras may detect a faint glow.</li>
                            <li><strong>25-40% 😊:</strong> Clear activity on camera; a faint naked-eye glow is possible.</li>
                            <li><strong>40-50% 🙂:</strong> Faint naked-eye aurora likely, maybe with color.</li>
                            <li><strong>50-80% 😀:</strong> Good chance of naked-eye color and structure.</li>
                            <li><strong>80%+ 🤩:</strong> High probability of a significant substorm.</li>
                          </ul>` },
        'chart': { title: 'Reading The Visibility Chart', content: `This chart shows the estimated visibility over time.<br><br>
                          <strong><span class="inline-block w-3 h-3 rounded-sm mr-2 align-middle" style="background-color: #FF6347;"></span>Real Score:</strong> This is the main forecast, including solar wind data and local factors like moonlight and darkness.<br><br>
                          <strong><span class="inline-block w-3 h-3 rounded-sm mr-2 align-middle" style="background-color: #A9A9A9;"></span>Base Score:</strong> This shows the forecast based *only* on solar wind data. It represents the "raw potential" if there were no sun or moon interference.` },
        'power': { title: 'Hemispheric Power', content: `<strong>What it is:</strong> The total energy being deposited by the solar wind into an entire hemisphere (North or South), measured in Gigawatts (GW).<br><br>
                         <strong>Effect on Aurora:</strong> Think of this as the aurora's overall brightness level. Higher power means more energy is available for a brighter and more widespread display.` },
        'speed': { title: 'Solar Wind Speed', content: `<strong>What it is:</strong> The speed of the charged particles flowing from the Sun, measured in kilometers per second (km/s).<br><br>
                         <strong>Effect on Aurora:</strong> Faster particles hit Earth's magnetic field with more energy, leading to more dynamic and vibrant auroras with faster-moving structures.` },
        'density': { title: 'Solar Wind Density', content: `<strong>What it is:</strong> The number of particles within a cubic centimeter of the solar wind, measured in protons per cm³.<br><br>
                          <strong>Effect on Aurora:</strong> Higher density means more particles are available to collide with our atmosphere, resulting in more widespread and "thicker" looking auroral displays.` },
        'bt': { title: 'IMF Bt (Total)', content: `<strong>What it is:</strong> The total strength of the Interplanetary Magnetic Field (IMF), measured in nanoteslas (nT).<br><br>
                          <strong>Effect on Aurora:</strong> A high Bt value indicates a strong magnetic field. While not a guarantee on its own, a strong field can carry more energy and lead to powerful events if the Bz is also favorable.` },
        'bz': { title: 'IMF Bz (N/S)', content: `<strong>What it is:</strong> The North-South direction of the IMF, measured in nanoteslas (nT). This is the most critical component.<br><br>
                          <strong>Effect on Aurora:</strong> Think of Bz as the "gatekeeper." When Bz is strongly <strong>negative (south)</strong>, it opens a gateway for solar wind energy to pour in. A positive Bz closes this gate. <strong>The more negative, the better!</strong>` }
    };

    const getAuroraEmoji = (s: number | null) => {
        if (s === null) return GAUGE_EMOJIS.error;
        if (s < 10) return '😞'; if (s < 25) return '😐'; if (s < 40) return '😊';
        if (s < 50) return '🙂'; if (s < 80) return '😀'; return '🤩';
    };
    
    const formatTimestamp = (isoString: string) => {
        try {
            const d = new Date(isoString);
            return isNaN(d.getTime()) ? "Invalid Date" : `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        } catch { return "Invalid Date"; }
    };
    
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
        return { color: GAUGE_COLORS[key], emoji: GAUGE_EMOJIS[key], percentage: percentage };
    }, []);

    const fetchAndRenderAllData = useCallback(async () => {
        apiDataCache.current = {}; // Clear cache

        // Fetch sensor data
        try {
            const [tnrResponse, basicResponse] = await Promise.all([ fetch('https://tnr-aurora-forecast.thenamesrock.workers.dev/'), fetch('https://basic-aurora-forecast.thenamesrock.workers.dev/') ]);
            if (!tnrResponse.ok || !basicResponse.ok) throw new Error(`Forecast fetch failed`);
            const tnrData = await tnrResponse.json(); const basicData = await basicResponse.json();
            const scoreValue = parseFloat(tnrData.values.pop().value);
            setAuroraScore(scoreValue); setLastUpdated(formatTimestamp(basicData.values.pop().lastUpdated));
            if (scoreValue < 10) setAuroraBlurb('Little to no auroral activity.'); else if (scoreValue < 25) setAuroraBlurb('Minimal auroral activity likely.'); else if (scoreValue < 40) setAuroraBlurb('Clear auroral activity visible in cameras.'); else if (scoreValue < 50) setAuroraBlurb('Faint auroral glow potentially visible to the naked eye.'); else if (scoreValue < 80) setAuroraBlurb('Good chance of seeing naked-eye auroral color.'); else setAuroraBlurb('High probability of significant auroral substorms.');
        } catch (error) { console.error("Error fetching NZ sensor data:", error); }

        // Fetch gauges
        Object.keys(GAUGE_API_ENDPOINTS).forEach(async (key) => { /* ... full gauge logic ... */ });
        
        // Fetch charts
        try {
            const [resp1, resp2] = await Promise.all([fetch('https://basic-aurora-forecast.thenamesrock.workers.dev/'), fetch('https://tnr-aurora-forecast.thenamesrock.workers.dev/')]);
            const json1 = await resp1.json(); const json2 = await resp2.json();
            // ... full chart data processing logic ...
            // setAuroraChartData(...);
        } catch(e) { console.error("Error rendering aurora chart:", e); }

        try {
            const resp = await fetch(NOAA_MAG_ENDPOINT);
            const data = await resp.json();
            // ... full magnetic chart data processing logic ...
            // setMagneticChartData(...);
        } catch(e) { console.error("Error rendering magnetic chart:", e); }

    }, [getGaugeStyle]);

    useEffect(() => {
        fetchAndRenderAllData();
        const interval = setInterval(fetchAndRenderAllData, 120000);
        return () => clearInterval(interval);
    }, [fetchAndRenderAllData]);

    useEffect(() => {
        if (!mapContainerRef.current || mapRef.current) return;
        const map = L.map(mapContainerRef.current, { center: [-41.2, 172.5], zoom: 5, scrollWheelZoom: true, dragging: !L.Browser.touch, touchZoom: true });
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© CARTO' }).addTo(map);
        sightingMarkersLayerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;
    }, []);

    return (
        <div className="w-full h-full overflow-y-auto bg-neutral-900 text-neutral-300 p-5">
            <style>{`.leaflet-popup-content-wrapper, .leaflet-popup-tip { background-color: #171717; color: #fafafa; border: 1px solid #3f3f46; } .sighting-emoji-icon { font-size: 1.2rem; text-align: center; line-height: 1; text-shadow: 0px 0px 5px rgba(0,0,0,0.8); background: none; border: none; }`}</style>
            <div className="container mx-auto">
                <header className="text-center mb-8">
                    <img src="https://www.tnrprotography.co.nz/uploads/1/3/6/6/136682089/white-tnr-protography-w_orig.png" alt="TNR Protography Logo" className="mx-auto w-full max-w-[250px] mb-4"/>
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
                            <div className="w-full bg-neutral-700 rounded-full h-3 mt-4"><div className="bg-green-500 h-3 rounded-full" style={{ width: `${auroraScore || 0}%`, backgroundColor: getGaugeStyle(auroraScore, 'power').color }}></div></div>
                            <div className="text-sm text-neutral-400 mt-2">Last Updated: {lastUpdated || '...'}</div>
                        </div>
                        <p className="text-neutral-300 mt-4 md:mt-0">{auroraBlurb}</p>
                    </div>

                    <div className="col-span-12 card bg-neutral-950/80 p-6">
                        <h2 className="text-xl font-semibold text-center text-white mb-4">Live Sighting Map</h2>
                        <div ref={mapContainerRef} className="h-[450px] w-full rounded-lg bg-neutral-800 border border-neutral-700"></div>
                        {/* Sighting controls and logic would be fully implemented here */}
                    </div>

                    {Object.entries(gaugeData).map(([key, data]) => (
                        <div key={key} className="col-span-6 md:col-span-4 lg:col-span-2 card bg-neutral-950/80 p-4 text-center">
                            <h3 className="text-md font-semibold text-white h-10 flex items-center justify-center">{key.replace('_', ' ').toUpperCase()}</h3>
                            <div className="text-3xl font-bold my-2">{data.value}</div>
                            <div className="text-3xl my-2">{data.emoji}</div>
                            <div className="w-full bg-neutral-700 rounded-full h-2"><div className="h-2 rounded-full" style={{ width: `${data.percentage}%`, backgroundColor: data.color }}></div></div>
                            <div className="text-xs text-neutral-500 mt-2 truncate" title={data.lastUpdated}>{data.lastUpdated}</div>
                        </div>
                    ))}
                    
                    <div className="col-span-12 lg:col-span-6 card bg-neutral-950/80 p-4 h-96 flex flex-col">
                        <h2 className="text-xl font-semibold text-white text-center">Aurora Visibility (Past 6 Hours)</h2>
                        <div className="flex-grow relative mt-4">
                            {auroraChartData ? <Line data={auroraChartData} options={{ responsive: true, maintainAspectRatio: false }} /> : <p className="text-center pt-10 text-neutral-400 italic">Loading Chart...</p>}
                        </div>
                    </div>
                    <div className="col-span-12 lg:col-span-6 card bg-neutral-950/80 p-4 h-96 flex flex-col">
                        <h2 className="text-xl font-semibold text-white text-center">Magnetic Field (Past 2 Hours)</h2>
                         <div className="flex-grow relative mt-4">
                            {magneticChartData ? <Line data={magneticChartData} options={{ responsive: true, maintainAspectRatio: false }} /> : <p className="text-center pt-10 text-neutral-400 italic">Loading Chart...</p>}
                        </div>
                    </div>
                </main>
            </div>
            {modalState && <InfoModal {...modalState} onClose={closeModal} />}
        </div>
    );
};

export default ForecastDashboard;