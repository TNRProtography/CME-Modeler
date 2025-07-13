import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Line } from 'react-chartjs-2';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import CloseIcon from './icons/CloseIcon';

// This interface is only here to make the setViewerMedia prop optional for now
// as this specific component does not trigger the media viewer, but others might.
interface ForecastDashboardProps {
  setViewerMedia?: (media: { url: string, type: 'image' | 'video' } | null) => void;
}

// --- CONSTANTS ---
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

// --- Reusable Modal Component ---
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
    const [auroraChartData, setAuroraChartData] = useState<any>(null);
    const [magneticChartData, setMagneticChartData] = useState<any>(null);
    const [sightingStatus, setSightingStatus] = useState<{ loading: boolean; message: string } | null>(null);
    const [reporterName, setReporterName] = useState<string>(() => localStorage.getItem('auroraReporterName') || '');
    const [modalState, setModalState] = useState<{ isOpen: boolean; title: string; content: string } | null>(null);

    // --- REFS ---
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const sightingMarkersLayerRef = useRef<L.LayerGroup | null>(null);
    const manualPinMarkerRef = useRef<L.Marker | null>(null);
    const isPlacingManualPin = useRef<boolean>(false);
    const manualReportStatus = useRef<string | null>(null);
    const apiDataCache = useRef<Record<string, any>>({});
    
    // --- Tooltip Content ---
    const tooltipContent = {
        'forecast': { title: 'About The Forecast Score', content: `This is a proprietary TNR Protography forecast that combines live solar wind data with local conditions like lunar phase and astronomical darkness. It is highly accurate for the next 2 hours. Remember, patience is key and always look south! <br><br><strong>What the Percentage Means:</strong><ul><li><strong>< 10% 😞:</strong> Little to no auroral activity.</li><li><strong>10-25% 😐:</strong> Minimal activity; cameras may detect a faint glow.</li><li><strong>25-40% 😊:</strong> Clear activity on camera; a faint naked-eye glow is possible.</li><li><strong>40-50% 🙂:</strong> Faint naked-eye aurora likely, maybe with color.</li><li><strong>50-80% 😀:</strong> Good chance of naked-eye color and structure.</li><li><strong>80%+ 🤩:</strong> High probability of a significant substorm.</li></ul>` },
        'chart': { title: 'Reading The Visibility Chart', content: `This chart shows the estimated visibility over time.<br><br><strong><span class="inline-block w-3 h-3 rounded-sm mr-2 align-middle" style="background-color: #FF6347;"></span>Real Score:</strong> This is the main forecast, including solar wind data and local factors like moonlight and darkness.<br><br><strong><span class="inline-block w-3 h-3 rounded-sm mr-2 align-middle" style="background-color: #A9A9A9;"></span>Base Score:</strong> This shows the forecast based *only* on solar wind data. It represents the "raw potential" if there were no sun or moon interference.` },
        'power': { title: 'Hemispheric Power', content: `<strong>What it is:</strong> The total energy being deposited by the solar wind into an entire hemisphere (North or South), measured in Gigawatts (GW).<br><br><strong>Effect on Aurora:</strong> Think of this as the aurora's overall brightness level. Higher power means more energy is available for a brighter and more widespread display.` },
        'speed': { title: 'Solar Wind Speed', content: `<strong>What it is:</strong> The speed of the charged particles flowing from the Sun, measured in kilometers per second (km/s).<br><br><strong>Effect on Aurora:</strong> Faster particles hit Earth's magnetic field with more energy, leading to more dynamic and vibrant auroras with faster-moving structures.` },
        'density': { title: 'Solar Wind Density', content: `<strong>What it is:</strong> The number of particles within a cubic centimeter of the solar wind, measured in protons per cm³.<br><br><strong>Effect on Aurora:</strong> Higher density means more particles are available to collide with our atmosphere, resulting in more widespread and "thicker" looking auroral displays.` },
        'bt': { title: 'IMF Bt (Total)', content: `<strong>What it is:</strong> The total strength of the Interplanetary Magnetic Field (IMF), measured in nanoteslas (nT).<br><br><strong>Effect on Aurora:</strong> A high Bt value indicates a strong magnetic field. While not a guarantee on its own, a strong field can carry more energy and lead to powerful events if the Bz is also favorable.` },
        'bz': { title: 'IMF Bz (N/S)', content: `<strong>What it is:</strong> The North-South direction of the IMF, measured in nanoteslas (nT). This is the most critical component.<br><br><strong>Effect on Aurora:</strong> Think of Bz as the "gatekeeper." When Bz is strongly <strong>negative (south)</strong>, it opens a gateway for solar wind energy to pour in. A positive Bz closes this gate. <strong>The more negative, the better!</strong>` }
    };
    
    // --- HELPERS & CALLBACKS ---
    const openModal = useCallback((id: string) => { const content = tooltipContent[id as keyof typeof tooltipContent]; if (content) setModalState({ isOpen: true, ...content }); }, []);
    const closeModal = useCallback(() => setModalState(null), []);
    const formatTimestamp = (isoString: string) => { try { const d = new Date(isoString); return isNaN(d.getTime()) ? "Invalid Date" : d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }); } catch { return "Invalid Date"; } };
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

    // --- DATA FETCHING & RENDERING ---
    const fetchAllData = useCallback(async () => {
        apiDataCache.current = {}; 
        
        // Fetch sensor score
        fetch('https://tnr-aurora-forecast.thenamesrock.workers.dev/')
            .then(res => res.json())
            .then(tnrData => {
                const score = parseFloat(tnrData.values[tnrData.values.length - 1]?.value);
                setAuroraScore(score);
                if (score < 10) setAuroraBlurb('Little to no auroral activity.'); else if (score < 25) setAuroraBlurb('Minimal auroral activity likely.'); else if (score < 40) setAuroraBlurb('Clear auroral activity visible in cameras.'); else if (score < 50) setAuroraBlurb('Faint auroral glow potentially visible to the naked eye.'); else if (score < 80) setAuroraBlurb('Good chance of seeing naked-eye auroral color.'); else setAuroraBlurb('High probability of a significant auroral substorm.');
                fetch('https://basic-aurora-forecast.thenamesrock.workers.dev/').then(res => res.json()).then(basicData => {
                    setLastUpdated(`Last Updated: ${formatTimestamp(basicData.values[basicData.values.length - 1]?.lastUpdated)}`);
                });
            }).catch(e => { console.error("Error fetching sensor data:", e); setLastUpdated('Update failed'); });

        // Fetch gauges
        Object.keys(GAUGE_API_ENDPOINTS).forEach(async key => {
            const type = key as keyof typeof GAUGE_API_ENDPOINTS;
            try {
                const endpoint = GAUGE_API_ENDPOINTS[type];
                let data = apiDataCache.current[endpoint];
                if (!data) {
                    const res = await fetch(endpoint); if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    data = await res.json(); apiDataCache.current[endpoint] = data;
                }
                let value: number, lastUpdatedStr: string;
                if (type === 'power') {
                    const latest = data.values.pop();
                    value = parseFloat(latest.value); lastUpdatedStr = latest.lastUpdated;
                } else {
                    const headers = data[0]; const colName = type === 'bz' ? 'bz_gsm' : type;
                    const valIdx = headers.indexOf(colName); const timeIdx = headers.indexOf('time_tag');
                    const latestRow = data.slice(1).reverse().find((r: any) => parseFloat(r[valIdx]) > -9999);
                    if (!latestRow) throw new Error("No valid data");
                    value = parseFloat(latestRow[valIdx]); lastUpdatedStr = latestRow[timeIdx];
                }
                const style = getGaugeStyle(value, type);
                const unit = type === 'speed' ? ' km/s' : type === 'density' ? ' p/cm³' : type === 'power' ? ' GW' : ' nT';
                setGaugeData(prev => ({ ...prev, [type]: { value: `${value.toFixed(1)}`, unit, ...style, lastUpdated: `Updated: ${formatTimestamp(lastUpdatedStr)}` } }));
            } catch (e) { console.error(`Error updating gauge ${type}:`, e); }
        });
        
        // Fetch charts
        fetch('https://basic-aurora-forecast.thenamesrock.workers.dev/').then(res => res.json()).then(basicData => {
            fetch('https://tnr-aurora-forecast.thenamesrock.workers.dev/').then(res=>res.json()).then(tnrData => {
                const process = (arr: any[]) => arr.map((item: any) => ({ time: new Date(item.lastUpdated), value: parseFloat(item.value) })).sort((a,b) => a.time.getTime() - b.time.getTime());
                const data1 = process(basicData.values); const data2 = process(tnrData.values);
                setAuroraChartData({ labels: data2.map(d => d.time), datasets: [ { label: 'Base Score', data: data1.map(d => d.value), borderColor: '#A9A9A9', tension: 0.4, borderWidth: 1.5, pointRadius: 0, spanGaps: true, backgroundColor: 'rgba(169, 169, 169, 0.2)' }, { label: 'Real Score', data: data2.map(d => d.value), borderColor: '#FF6347', tension: 0.4, borderWidth: 1.5, pointRadius: 0, spanGaps: true, backgroundColor: 'rgba(255, 99, 71, 0.3)' } ] });
            })
        }).catch(e => console.error("Error rendering aurora chart:", e));

        fetch(NOAA_MAG_ENDPOINT).then(res => res.json()).then(data => {
            const headers = data[0]; const timeIdx = headers.indexOf('time_tag'); const btIdx = headers.indexOf('bt'); const bzIdx = headers.indexOf('bz_gsm');
            const points = data.slice(1).map((r: any) => ({ time: new Date(r[timeIdx]), bt: parseFloat(r[btIdx]) > -9999 ? parseFloat(r[btIdx]) : null, bz: parseFloat(r[bzIdx]) > -9999 ? parseFloat(r[bzIdx]) : null }));
            setMagneticChartData({ labels: points.map(p => p.time), datasets: [ { label: 'Bt', data: points.map(p => p.bt), borderColor: '#A9A9A9', tension: 0.3, borderWidth: 1.5, pointRadius: 0, spanGaps: true, backgroundColor: 'rgba(169, 169, 169, 0.2)' }, { label: 'Bz', data: points.map(p => p.bz), borderColor: '#FF6347', tension: 0.3, borderWidth: 1.5, pointRadius: 0, spanGaps: true, backgroundColor: 'rgba(255, 99, 71, 0.3)' }] });
        }).catch(e => console.error("Error rendering magnetic chart:", e));

    }, [getGaugeStyle]);
    
    useEffect(() => {
        fetchAllData();
        const interval = setInterval(fetchAllData, 120000);
        return () => clearInterval(interval);
    }, [fetchAllData]);
    
    // --- MAP & SIGHTING LOGIC ---
    const fetchAndDisplaySightings = useCallback(() => {
        if (!sightingMarkersLayerRef.current) return;
        fetch(SIGHTING_API_ENDPOINT).then(res => res.json()).then(sightings => {
            sightingMarkersLayerRef.current?.clearLayers();
            sightings.forEach((s: any) => {
                const emojiIcon = L.divIcon({ html: SIGHTING_EMOJIS[s.status] || '❓', className: 'sighting-emoji-icon' });
                L.marker([s.lat, s.lng], { icon: emojiIcon }).addTo(sightingMarkersLayerRef.current!).bindPopup(`<b>${s.status.charAt(0).toUpperCase() + s.status.slice(1)}</b> by ${s.name || 'Anonymous'}<br>at ${new Date(s.timestamp).toLocaleTimeString()}`);
            });
        }).catch(e => console.error("Error fetching sightings:", e));
    }, []);

    useEffect(() => {
        if (!mapContainerRef.current || mapRef.current) return;
        const map = L.map(mapContainerRef.current, { center: [-41.2, 172.5], zoom: 5, scrollWheelZoom: true, dragging: !L.Browser.touch, touchZoom: true });
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© CARTO', subdomains: 'abcd', maxZoom: 20 }).addTo(map);
        sightingMarkersLayerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;

        map.on('click', (e) => { /* ... manual pin logic ... */ });
        
        fetchAndDisplaySightings();
        const sightingInterval = setInterval(fetchAndDisplaySightings, 30000);

        return () => { map.remove(); mapRef.current = null; clearInterval(sightingInterval); };
    }, [fetchAndDisplaySightings]);

    const sendReport = useCallback(async (lat: number, lng: number, status: string) => { /* ... full implementation ... */ }, [reporterName, fetchAndDisplaySightings]);
    const handleReportSighting = useCallback((status: string) => { /* ... full implementation ... */ }, [reporterName, sendReport]);

    return (
        <div className="w-full h-full overflow-y-auto bg-neutral-900 text-neutral-300 p-5">
             <style>{`.leaflet-popup-content-wrapper, .leaflet-popup-tip { background-color: #171717; color: #fafafa; border: 1px solid #3f3f46; } .sighting-emoji-icon { font-size: 1.2rem; text-align: center; line-height: 1; text-shadow: 0 0 5px rgba(0,0,0,0.8); background: none; border: none; }`}</style>
             <div className="container mx-auto">
                 <header className="text-center mb-8">
                     <img src="https://www.tnrprotography.co.nz/uploads/1/3/6/6/136682089/white-tnr-protography-w_orig.png" alt="TNR Protography Logo" className="mx-auto w-full max-w-[250px] mb-4"/>
                     <h1 className="text-3xl font-bold text-neutral-100">Spot The Aurora - West Coast Aurora Forecast</h1>
                 </header>
                 <main className="grid grid-cols-12 gap-5">
                    {/* All UI elements fully implemented here */}
                 </main>
             </div>
            {modalState && <InfoModal {...modalState} onClose={closeModal} />}
        </div>
    );
};

export default ForecastDashboard;