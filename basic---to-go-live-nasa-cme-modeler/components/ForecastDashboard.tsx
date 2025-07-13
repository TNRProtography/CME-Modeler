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
    const [gaugeData, setGaugeData] = useState<Record<string, { value: string; emoji: string; percentage: number; lastUpdated: string; color: string }>>({
        power: { value: '...', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' },
        speed: { value: '...', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' },
        density: { value: '...', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' },
        bt: { value: '...', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' },
        bz: { value: '...', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' },
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

    // --- HELPERS & CALLBACKS ---
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
        return { color: GAUGE_COLORS[key], emoji: GAUGE_EMOJIS[key], percentage };
    }, []);

    const openModal = useCallback((id: string) => {
        const content = tooltipContent[id as keyof typeof tooltipContent];
        if (content) setModalState({ isOpen: true, ...content });
    }, []);

    const closeModal = useCallback(() => setModalState(null), []);

    // --- DATA FETCHING & RENDERING ---
    const fetchAllData = useCallback(async () => {
        apiDataCache.current = {}; // Clear cache on each full update

        // Fetch sensor score
        try {
            const [tnrRes, basicRes] = await Promise.all([fetch('https://tnr-aurora-forecast.thenamesrock.workers.dev/'), fetch('https://basic-aurora-forecast.thenamesrock.workers.dev/')]);
            if (!tnrRes.ok || !basicRes.ok) throw new Error('Forecast fetch failed');
            const tnrData = await tnrRes.json(); const basicData = await basicRes.json();
            const score = parseFloat(tnrData.values[tnrData.values.length - 1]?.value);
            setAuroraScore(score); setLastUpdated(`Last Updated: ${formatTimestamp(basicData.values[basicData.values.length - 1]?.lastUpdated)}`);
            if (score < 10) setAuroraBlurb('Little to no auroral activity.'); else if (score < 25) setAuroraBlurb('Minimal auroral activity likely.'); else if (score < 40) setAuroraBlurb('Clear auroral activity visible in cameras.'); else if (score < 50) setAuroraBlurb('Faint auroral glow potentially visible to the naked eye.'); else if (score < 80) setAuroraBlurb('Good chance of seeing naked-eye auroral color.'); else setAuroraBlurb('High probability of a significant auroral substorm.');
        } catch (e) { console.error("Error fetching sensor data:", e); setLastUpdated('Update failed'); }

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
                    const latest = data.values[data.values.length - 1];
                    value = parseFloat(latest.value); lastUpdatedStr = latest.lastUpdated;
                } else {
                    const headers = data[0]; const colName = type === 'bz' ? 'bz_gsm' : type;
                    const valIdx = headers.indexOf(colName); const timeIdx = headers.indexOf('time_tag');
                    const latestRow = data.slice(1).reverse().find((r: any) => parseFloat(r[valIdx]) > -9999);
                    if (!latestRow) throw new Error("No valid data found");
                    value = parseFloat(latestRow[valIdx]); lastUpdatedStr = latestRow[timeIdx];
                }
                const style = getGaugeStyle(value, type);
                const unit = type === 'speed' ? ' km/s' : type === 'density' ? ' p/cm³' : type === 'power' ? ' GW' : ' nT';
                setGaugeData(prev => ({ ...prev, [type]: { value: `${value.toFixed(1)}${unit}`, ...style, lastUpdated: `Last Updated: ${formatTimestamp(lastUpdatedStr)}` } }));
            } catch (e) { console.error(`Error updating gauge ${type}:`, e); }
        });

        // Fetch charts
        // Aurora Chart
        try {
            const [basicRes, tnrRes] = await Promise.all([fetch('https://basic-aurora-forecast.thenamesrock.workers.dev/'), fetch('https://tnr-aurora-forecast.thenamesrock.workers.dev/')]);
            const basicData = await basicRes.json(); const tnrData = await tnrRes.json();
            const process = (arr: any[]) => arr.map((item: any) => ({ time: new Date(item.lastUpdated), value: parseFloat(item.value) })).sort((a,b) => a.time.getTime() - b.time.getTime());
            const data1 = process(basicData.values); const data2 = process(tnrData.values);
            // ... chart data interpolation logic here if needed ...
            setAuroraChartData({ labels: data2.map(d => d.time), datasets: [ { label: 'Base Score', data: data1.map(d => d.value), borderColor: '#A9A9A9', tension: 0.4 }, { label: 'Real Score', data: data2.map(d => d.value), borderColor: '#FF6347', tension: 0.4 } ] });
        } catch(e) { console.error("Error rendering aurora chart:", e); }

        // Magnetic Chart
        try {
            const res = await fetch(NOAA_MAG_ENDPOINT); const data = await res.json();
            const headers = data[0]; const timeIdx = headers.indexOf('time_tag'); const btIdx = headers.indexOf('bt'); const bzIdx = headers.indexOf('bz_gsm');
            const points = data.slice(1).map((r: any) => ({ time: new Date(r[timeIdx]), bt: parseFloat(r[btIdx]) > -9999 ? r[btIdx] : null, bz: parseFloat(r[bzIdx]) > -9999 ? r[bzIdx] : null }));
            setMagneticChartData({ labels: points.map(p => p.time), datasets: [ { label: 'Bt', data: points.map(p => p.bt), borderColor: '#A9A9A9' }, { label: 'Bz', data: points.map(p => p.bz), borderColor: '#FF6347' }] });
        } catch(e) { console.error("Error rendering magnetic chart:", e); }

    }, [getGaugeStyle]);
    
    useEffect(() => {
        fetchAndRenderAllData();
        const interval = setInterval(fetchAndRenderAllData, 120000);
        return () => clearInterval(interval);
    }, [fetchAndRenderAllData]);

    // --- MAP & SIGHTING LOGIC ---
    useEffect(() => {
        if (!mapContainerRef.current || mapRef.current) return;
        const map = L.map(mapContainerRef.current, { center: [-41.2, 172.5], zoom: 5, scrollWheelZoom: true, dragging: !L.Browser.touch, touchZoom: true });
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© CARTO' }).addTo(map);
        sightingMarkersLayerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;

        map.on('click', (e) => {
            if (isPlacingManualPin.current) {
                if (manualPinMarkerRef.current) map.removeLayer(manualPinMarkerRef.current);
                manualPinMarkerRef.current = L.marker(e.latlng, { draggable: true }).addTo(map);
                const popupNode = document.createElement('div');
                popupNode.innerHTML = `<p class="text-neutral-300">Confirm & Send Report?</p><button id="confirm-pin-btn" class="sighting-button bg-green-700 w-full mt-2">Confirm</button>`;
                manualPinMarkerRef.current.bindPopup(popupNode).openPopup();
                document.getElementById('confirm-pin-btn')?.addEventListener('click', () => {
                    const finalLatLng = manualPinMarkerRef.current!.getLatLng();
                    sendReport(finalLatLng.lat, finalLatLng.lng, manualReportStatus.current!);
                });
            }
        });
        
        return () => { map.remove(); mapRef.current = null; };
    }, []);

    const sendReport = useCallback(async (lat, lng, status) => {
        setSightingStatus({ loading: true, message: LOADING_PUNS[Math.floor(Math.random() * LOADING_PUNS.length)] });
        try {
            const res = await fetch(SIGHTING_API_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat, lng, status, name: reporterName }) });
            if (!res.ok) throw new Error('Failed to submit report.');
            localStorage.setItem('lastReportTimestamp', Date.now().toString());
            setSightingStatus({ loading: false, message: "Report sent!" });
            fetchAndDisplaySightings();
        } catch(e) { setSightingStatus({ loading: false, message: "Could not send report." }); }
        finally {
            setTimeout(() => { setSightingStatus(null); isPlacingManualPin.current = false; if(manualPinMarkerRef.current) mapRef.current?.removeLayer(manualPinMarkerRef.current); }, 4000);
        }
    }, [reporterName]);

    const handleReportSighting = useCallback((status: string) => {
        if (Date.now() - parseInt(localStorage.getItem('lastReportTimestamp') || '0') < 60 * 60 * 1000) { alert("You've reported recently. Please wait a bit."); return; }
        if (!reporterName.trim()) { alert('Please enter your name.'); return; }
        setSightingStatus({ loading: true, message: "Getting location..." });
        navigator.geolocation.getCurrentPosition(
            (pos) => sendReport(pos.coords.latitude, pos.coords.longitude, status),
            () => { alert('Could not get location. Please click on the map to place a pin.'); setSightingStatus(null); isPlacingManualPin.current = true; manualReportStatus.current = status; }
        );
    }, [reporterName, sendReport]);

    const fetchAndDisplaySightings = useCallback(() => {
        fetch(SIGHTING_API_ENDPOINT).then(res => res.json()).then(sightings => {
            sightingMarkersLayerRef.current?.clearLayers();
            sightings.forEach((s: any) => {
                const emojiIcon = L.divIcon({ html: SIGHTING_EMOJIS[s.status] || '❓', className: 'sighting-emoji-icon', iconSize: [20, 20] });
                L.marker([s.lat, s.lng], { icon: emojiIcon }).addTo(sightingMarkersLayerRef.current!).bindPopup(`<b>${s.status}</b> by ${s.name || 'Anonymous'}<br>at ${new Date(s.timestamp).toLocaleTimeString()}`);
            });
        }).catch(e => console.error("Error fetching sightings:", e));
    }, []);

    useEffect(() => {
        fetchAndDisplaySightings();
        const interval = setInterval(fetchAndDisplaySightings, 30000);
        return () => clearInterval(interval);
    }, [fetchAndDisplaySightings]);

    return (
        <div className="w-full h-full overflow-y-auto bg-neutral-900 text-neutral-300 p-5">
            <style>{`.leaflet-popup-content-wrapper, .leaflet-popup-tip { background-color: #171717; color: #fafafa; border: 1px solid #3f3f46; } .sighting-emoji-icon { font-size: 1.2rem; text-align: center; line-height: 1; text-shadow: 0 0 5px rgba(0,0,0,0.8); background: none; border: none; }`}</style>
            <div className="container mx-auto">
                <header className="text-center mb-8">
                    {/* Header */}
                </header>
                <main className="grid grid-cols-12 gap-5">
                    {/* All UI elements go here, using state variables for data */}
                </main>
            </div>
            {modalState && <InfoModal {...modalState} onClose={closeModal} />}
        </div>
    );
};

export default ForecastDashboard;