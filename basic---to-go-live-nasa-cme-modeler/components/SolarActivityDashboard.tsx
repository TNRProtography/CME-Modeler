import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Line } from 'react-chartjs-2';
import { ChartOptions } from 'chart.js';
import { enNZ } from 'date-fns/locale';
import CloseIcon from './icons/CloseIcon';
import { sendNotification, canSendNotification, clearNotificationCooldown } from '../utils/notifications.ts'; // Corrected import path: added .ts extension

interface SolarActivityDashboardProps {
  apiKey: string;
  setViewerMedia: (media: { url: string, type: 'image' | 'video' | 'animation' } | null) => void;
  setLatestXrayFlux: (flux: number | null) => void;
}

// --- CONSTANTS ---
const NOAA_XRAY_FLUX_URL = 'https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json';
const SUVI_131_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/131/latest.png';
const SUVI_304_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/304/latest.png';
const NASA_DONKI_BASE_URL = 'https://api.nasa.gov/DONKI/';
const NOAA_SOLAR_REGIONS_URL = 'https://services.swpc.noaa.gov/json/solar_regions.json';
const CCOR1_VIDEO_URL = 'https://services.swpc.noaa.gov/products/ccor1/mp4s/ccor1_last_24hrs.mp4';
const SDO_HMI_URL = 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_HMIIF.jpg';
const SDO_AIA_193_URL = 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0193.jpg';
const NASA_IPS_URL = 'https://spottheaurora.thenamesrock.workers.dev/ips'; // Proxied through worker

const REFRESH_INTERVAL_MS = 60 * 1000; // 1 minute

// --- HELPERS ---
const getCssVar = (name: string): string => {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch (e) { return ''; }
};

const getColorForFlux = (value: number, opacity: number = 1): string => {
    let rgb = getCssVar('--solar-flare-ab-rgb') || '34, 197, 94'; // Green
    if (value >= 5e-4) rgb = getCssVar('--solar-flare-x5plus-rgb') || '255, 105, 180'; // Hot Pink for X5+
    else if (value >= 1e-4) rgb = getCssVar('--solar-flare-x-rgb') || '147, 112, 219';    // Purple for X1-X4.9
    else if (value >= 1e-5) rgb = getCssVar('--solar-flare-m-rgb') || '255, 69, 0';    // OrangeRed for M
    else if (value >= 1e-6) rgb = getCssVar('--solar-flare-c-rgb') || '245, 158, 11'; // Yellow
    return `rgba(${rgb}, ${opacity})`;
};

const getColorForFlareClass = (classType: string): { background: string, text: string } => {
    const type = classType ? classType[0].toUpperCase() : 'U';
    const magnitude = parseFloat(classType.substring(1));

    if (type === 'X') {
        if (magnitude >= 5) {
            return { background: `rgba(${getCssVar('--solar-flare-x5plus-rgb') || '255, 105, 180'}, 1)`, text: 'text-white' }; // Hot Pink
        }
        return { background: `rgba(${getCssVar('--solar-flare-x-rgb') || '147, 112, 219'}, 1)`, text: 'text-white' }; // Purple
    }
    if (type === 'M') {
        return { background: `rgba(${getCssVar('--solar-flare-m-rgb') || '255, 69, 0'}, 1)`, text: 'text-white' }; // OrangeRed
    }
    if (type === 'C') {
        return { background: `rgba(${getCssVar('--solar-flare-c-rgb') || '245, 158, 11'}, 1)`, text: 'text-black' }; // Yellow
    }
    return { background: `rgba(${getCssVar('--solar-flare-ab-rgb') || '34, 197, 94'}, 1)`, text: 'text-white' }; // Green for A/B/Unknown
};


const formatNZTimestamp = (isoString: string | null) => {
    if (!isoString) return 'N/A';
    try { const d = new Date(isoString); return isNaN(d.getTime()) ? "Invalid Date" : d.toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', dateStyle: 'short', timeStyle: 'short' }); } catch { return "Invalid Date"; }
};

// --- REUSABLE COMPONENTS ---
const TimeRangeButtons: React.FC<{ onSelect: (duration: number) => void; selected: number }> = ({ onSelect, selected }) => {
    const timeRanges = [ { label: '1 Hr', hours: 1 }, { label: '2 Hr', hours: 2 }, { label: '4 Hr', hours: 4 }, { label: '6 Hr', hours: 6 }, { label: '12 Hr', hours: 12 }, { label: '24 Hr', hours: 24 } ];
    return (
        <div className="flex justify-center gap-2 my-2 flex-wrap">
            {timeRanges.map(({ label, hours }) => (
                <button key={hours} onClick={() => onSelect(hours * 3600000)} className={`px-3 py-1 text-xs rounded transition-colors ${selected === hours * 3600000 ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`} title={`Show data for the last ${hours} hours`}>
                    {label}
                </button>
            ))}
        </div>
    );
};

interface InfoModalProps { isOpen: boolean; onClose: () => void; title: string; content: React.ReactNode; }
const InfoModal: React.FC<InfoModalProps> = ({ isOpen, onClose, title, content }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[1000] flex justify-center items-center p-4" onClick={onClose}>
      <div className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-lg max-h-[85vh] text-neutral-300 flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b border-neutral-700/80">
          <h3 className="text-xl font-bold text-neutral-200">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"><CloseIcon className="w-6 h-6" /></button>
        </div>
        <div className="overflow-y-auto p-5 styled-scrollbar pr-4 text-sm leading-relaxed">{content}</div>
      </div>
    </div>
  );
};

// Define type for NASA Interplanetary Shock (IPS) record (moved here as it's used only in this file now)
interface InterplanetaryShock {
    activityID: string;
    catalog: string;
    eventTime: string;
    instruments: { displayName: string }[];
    location: string;
    link: string;
}


const SolarActivityDashboard: React.FC<SolarActivityDashboardProps> = ({ apiKey, setViewerMedia, setLatestXrayFlux }) => {
    const [suvi131, setSuvi131] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
    const [suvi304, setSuvi304] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
    const [sdoHmi, setSdoHmi] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
    const [sdoAia193, setSdoAia193] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
    const [ccor1Video, setCcor1Video] = useState({ url: '', loading: 'Loading video...' });

    const [activeSunImage, setActiveSunImage] = useState<string>('SUVI_131'); // Default to SUVI 131Å

    const [allXrayData, setAllXrayData] = useState<any[]>([]);
    const [loadingXray, setLoadingXray] = useState<string | null>('Loading X-ray flux data...');
    const [xrayTimeRange, setXrayTimeRange] = useState<number>(24 * 60 * 60 * 1000); // DEFAULT TO 24 HOURS
    const [solarFlares, setSolarFlares] = useState<any[]>([]);
    const [loadingFlares, setLoadingFlares] = useState<string | null>('Loading solar flares...');
    const [sunspots, setSunspots] = useState<any[]>([]);
    const [loadingSunspots, setLoadingSunspots] = useState<string | null>('Loading active regions...');
    const [selectedFlare, setSelectedFlare] = useState<any | null>(null);

    const [interplanetaryShockData, setInterplanetaryShockData] = useState<InterplanetaryShock[]>([]);
    const [isIpsOpen, setIsIpsOpen] = useState(false);

    // NEW: Ref for previous X-ray flux to trigger notifications
    const previousLatestXrayFluxRef = useRef<number | null>(null);

    // State for the InfoModal
    const [modalState, setModalState] = useState<{isOpen: boolean; title: string; content: React.ReactNode} | null>(null);


    const tooltipContent = useMemo(() => ({
        'xray-flux': 'The GOES X-ray Flux measures X-ray radiation from the Sun. Sudden, sharp increases indicate solar flares. Flares are classified by their peak X-ray flux: B, C, M, and X, with X being the most intense. Higher class flares (M and X) can cause radio blackouts and enhanced aurora.',
        'suvi-131': '<strong>SUVI 131Å (Angstrom):</strong> This Extreme Ultraviolet (EUV) wavelength shows the hot, flaring regions of the Sun\'s corona, highlighting solar flares and active regions. It\'s good for seeing intense bursts of energy.',
        'suvi-304': '<strong>SUVI 304Å (Angstrom):</strong> This EUV wavelength reveals the cooler, denser plasma in the Sun\'s chromosphere and transition region. It\'s excellent for observing prominences (loops of plasma extending from the Sun\'s limb) and filaments (prominences seen against the solar disk).',
        'sdo-hmi': '<strong>SDO HMI (Helioseismic and Magnetic Imager) Intensitygram:</strong> This instrument captures images of the Sun\'s photosphere in visible light. It primarily shows sunspots as dark regions, which are areas of concentrated, strong magnetic fields. These active regions are often the source of flares and CMEs.',
        'sdo-aia-193': '<strong>SDO AIA 193Å (Angstrom):</strong> Another EUV wavelength from the SDO Atmospheric Imaging Assembly. This view shows regions of the Sun\'s corona that are hot, including coronal holes (which appear as dark, open magnetic field regions from which fast solar wind streams) and hot flare plasma.',
        'ccor1-video': '<strong>CCOR1 (Coronal Coronal Observation by Optical Reconnaissance) Video:</strong> This coronagraph imagery captures the faint outer atmosphere of the Sun (the corona) by blocking out the bright solar disk. It is primarily used to detect and track Coronal Mass Ejections (CMEs) as they erupt and propagate away from the Sun.',
        'solar-flares': 'A list of the latest detected solar flares. Flares are sudden bursts of radiation from the Sun. Pay attention to the class type (M or X) as these are stronger events. A "CME Event" tag means a Coronal Mass Ejection was also observed with the flare, potentially leading to Earth impacts.',
        'active-regions': 'A list of currently active regions or sunspots on the Sun. These are areas of strong magnetic fields that can be the source of solar flares and CMEs. "Earth-facing" means they are currently oriented towards Earth, making them more relevant for space weather effects on our planet.',
        'ips': `<strong>What it is:</strong> An Interplanetary Shock (IPS) is the boundary of a disturbance, like a Coronal Mass Ejection (CME), moving through the solar system. The arrival of a shock front at Earth is detected by satellites like DSCOVR or ACE.<br><br><strong>Effect on Aurora:</strong> The arrival of an IPS can cause a sudden and dramatic shift in solar wind parameters (speed, density, and magnetic field). This can trigger intense auroral displays shortly after impact. This table shows the most recent shock events detected by NASA.`,
    }), []);

    const openModal = useCallback((id: string) => {
        const contentData = tooltipContent[id as keyof typeof tooltipContent];
        if (contentData) {
            let title = '';
            if (id === 'xray-flux') title = 'About GOES X-ray Flux';
            else if (id === 'suvi-131') title = 'About SUVI 131Å Imagery';
            else if (id === 'suvi-304') title = 'About SUVI 304Å Imagery';
            else if (id === 'sdo-hmi') title = 'About SDO HMI Intensitygram';
            else if (id === 'sdo-aia-193') title = 'About SDO AIA 193Å Imagery';
            else if (id === 'ccor1-video') title = 'About CCOR1 Coronagraph Video';
            else if (id === 'solar-flares') title = 'About Solar Flares';
            else if (id === 'active-regions') title = 'About Active Regions / Sunspots';
            else if (id === 'ips') title = 'About Interplanetary Shocks';
            else title = (id.charAt(0).toUpperCase() + id.slice(1)).replace(/([A-Z])/g, ' $1').trim();

            setModalState({ isOpen: true, title: title, content: contentData });
        }
    }, [tooltipContent]);

    const closeModal = useCallback(() => setModalState(null), []);

    const fetchImage = useCallback(async (url: string, setState: React.Dispatch<React.SetStateAction<{url: string, loading: string | null}>>, isVideo: boolean = false, addCacheBuster: boolean = true) => {
        setState({ url: isVideo ? '' : '/placeholder.png', loading: `Loading ${isVideo ? 'video' : 'image'}...` });
        try {
            const fetchUrl = addCacheBuster ? `${url}?_=${new Date().getTime()}` : url;
            const res = await fetch(fetchUrl);
            if (!res.ok) {
                console.error(`Failed to fetch ${fetchUrl}: HTTP ${res.status} ${res.statusText}`);
                throw new Error(`HTTP ${res.status} for ${url}`);
            }
            if (isVideo) {
                setState({ url: url, loading: null });
            } else {
                const blob = await res.blob();
                const objectURL = URL.createObjectURL(blob);
                setState({ url: objectURL, loading: null });
            }
        } catch (error) {
            console.error(`Error fetching ${url}:`, error);
            setState({ url: isVideo ? '' : '/error.png', loading: `${isVideo ? 'Video' : 'Image'} failed to load.` });
        }
    }, []);

    const fetchXrayFlux = useCallback(() => {
        setLoadingXray('Loading X-ray flux data...');
        fetch(`${NOAA_XRAY_FLUX_URL}?_=${new Date().getTime()}`).then(res => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
            .then(rawData => {
                const groupedData = new Map();
                rawData.forEach((d: any) => { const time = new Date(d.time_tag).getTime(); if (!groupedData.has(time)) groupedData.set(time, { time, short: null }); if (d.energy === "0.1-0.8nm") groupedData.get(time).short = parseFloat(d.flux); });
                const processedData = Array.from(groupedData.values()).filter(d => d.short !== null && !isNaN(d.short)).sort((a,b) => a.time - b.time);
                
                if (!processedData.length) {
                    setLoadingXray('No valid X-ray data.');
                    setAllXrayData([]);
                    setLatestXrayFlux(null);
                    previousLatestXrayFluxRef.current = null;
                    return;
                }

                setAllXrayData(processedData);
                setLoadingXray(null);
                const latestFluxValue = processedData[processedData.length - 1].short;
                setLatestXrayFlux(latestFluxValue);

                // --- Notification Logic for X-ray Flux ---
                const prevFlux = previousLatestXrayFluxRef.current;
                
                if (latestFluxValue !== null && prevFlux !== null) {
                    // M5+ Flare notification (5e-6 is M0.5, 5e-5 is M5)
                    if (latestFluxValue >= 5e-6 && prevFlux < 5e-6 && canSendNotification('flare-M5', 15 * 60 * 1000)) { // 15 min cooldown
                        sendNotification('Solar Flare Alert: M-Class!', `X-ray flux has reached M-class (>=M0.5)! Current flux: ${latestFluxValue.toExponential(2)}`);
                    } else if (latestFluxValue < 5e-6) {
                        clearNotificationCooldown('flare-M5');
                    }

                    // X1+ Flare notification
                    if (latestFluxValue >= 1e-4 && prevFlux < 1e-4 && canSendNotification('flare-X1', 30 * 60 * 1000)) { // 30 min cooldown
                        sendNotification('Solar Flare Alert: X-Class!', `X-ray flux has reached X-class (>=X1)! Current flux: ${latestFluxValue.toExponential(2)}`);
                    } else if (latestFluxValue < 1e-4) {
                        clearNotificationCooldown('flare-X1');
                    }
                }
                previousLatestXrayFluxRef.current = latestFluxValue;

            }).catch(e => {
                console.error('Error fetching X-ray flux:', e);
                setLoadingXray(`Error: ${e.message}`);
                setLatestXrayFlux(null);
                previousLatestXrayFluxRef.current = null;
            });
    }, [setLatestXrayFlux]);
    
    const fetchFlares = useCallback(async () => {
        setLoadingFlares('Loading solar flares...');
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const startDate = yesterday.toISOString().split('T')[0];
        const endDate = new Date().toISOString().split('T')[0];
        
        try {
            const response = await fetch(`${NASA_DONKI_BASE_URL}FLR?startDate=${startDate}&endDate=${endDate}&api_key=${apiKey}&_=${new Date().getTime()}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (!data || data.length === 0) { setLoadingFlares('No solar flares in the last 24 hours.'); setSolarFlares([]); return; }
            const processedData = data.map((flare: any) => ({ ...flare, hasCME: flare.linkedEvents?.some((e: any) => e.activityID.includes('CME')) ?? false, }));
            setSolarFlares(processedData.sort((a: any, b: any) => new Date(b.peakTime).getTime() - new Date(a.peakTime).getTime()));
            setLoadingFlares(null);
        } catch (error) { console.error('Error fetching flares:', error); setLoadingFlares(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`); }
    }, [apiKey]);

    const fetchSunspots = useCallback(async () => {
        setLoadingSunspots('Loading active regions...');
        try {
            const response = await fetch(`${NOAA_SOLAR_REGIONS_URL}?_=${new Date().getTime()}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            const earthFacingRegions = data.filter((region: any) => Math.abs(parseFloat(region.longitude)) <= 90);
            if (earthFacingRegions.length === 0) { setLoadingSunspots('No Earth-facing active regions found.'); setSunspots([]); return; }
            setSunspots(earthFacingRegions.sort((a: any, b: any) => parseInt(b.region) - parseInt(a.region)));
            setLoadingSunspots(null);
        } catch (error) { console.error('Error fetching sunspots:', error); setLoadingSunspots(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`); }
    }, []);

    const fetchInterplanetaryShockData = useCallback(async () => {
        try {
            const response = await fetch(`${NASA_IPS_URL}?_=${new Date().getTime()}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data: InterplanetaryShock[] = await response.json();
            setInterplanetaryShockData(data);
        } catch (error) {
            console.error('NASA IPS Fetch Failed:', error);
            setInterplanetaryShockData([]);
        }
    }, []);

    useEffect(() => {
        const runAllUpdates = () => {
            fetchImage(SUVI_131_URL, setSuvi131);
            fetchImage(SUVI_304_URL, setSuvi304);
            fetchImage(SDO_HMI_URL, setSdoHmi, false, false);
            fetchImage(SDO_AIA_193_URL, setSdoAia193, false, false);
            fetchImage(CCOR1_VIDEO_URL, setCcor1Video, true); // This call remains here
            fetchXrayFlux();
            fetchFlares();
            fetchSunspots();
            fetchInterplanetaryShockData(); // Fetch IPS data here
        };
        runAllUpdates();
        const interval = setInterval(runAllUpdates, REFRESH_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [fetchImage, fetchXrayFlux, fetchFlares, fetchSunspots, fetchInterplanetaryShockData]);

    const xrayChartOptions = useMemo((): ChartOptions<'line'> => {
        const now = Date.now();
        const startTime = now - xrayTimeRange;
        
        const midnightAnnotations: any = {};
        // Assuming NZ offset for "Midnight" labels. If not, this could be simplified/removed.
        const nzOffset = 12 * 3600000; 
        const startDayNZ = new Date(startTime - nzOffset).setUTCHours(0,0,0,0) + nzOffset;
        for (let d = startDayNZ; d < now + 24 * 3600000; d += 24 * 3600000) {
            const midnight = new Date(d).setUTCHours(12,0,0,0);
            if (midnight > startTime && midnight < now) {
                midnightAnnotations[`midnight-${midnight}`] = { 
                    type: 'line', xMin: midnight, xMax: midnight, 
                    borderColor: 'rgba(156, 163, 175, 0.5)', borderWidth: 1, borderDash: [5, 5], 
                    label: { content: 'Midnight', display: true, position: 'start', color: 'rgba(156, 163, 175, 0.7)', font: { size: 10 } } 
                };
            }
        }
        
        return {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: { 
                legend: { display: false }, 
                tooltip: { callbacks: { 
                    label: (c: any) => `Flux: ${c.parsed.y.toExponential(2)} (${c.parsed.y >= 1e-4 ? 'X' : c.parsed.y >= 1e-5 ? 'M' : c.parsed.y >= 1e-6 ? 'C' : c.parsed.y >= 1e-7 ? 'B' : 'A'}-class)` 
                }}, 
                annotation: { annotations: midnightAnnotations } 
            },
            scales: { 
                x: { 
                    type: 'time', adapters: { date: { locale: enNZ } }, 
                    time: { unit: 'hour', tooltipFormat: 'HH:mm', displayFormats: { hour: 'HH:mm' } }, 
                    min: startTime, max: now, ticks: { color: '#71717a', source: 'auto' }, 
                    grid: { color: '#3f3f46' } 
                }, 
                y: { 
                    type: 'logarithmic', min: 1e-9, max: 1e-3, 
                    ticks: { 
                        color: '#71717a', 
                        callback: (v: any) => { if(v===1e-4) return 'X'; if(v===1e-5) return 'M'; if(v===1e-6) return 'C'; if(v===1e-7) return 'B'; if(v===1e-8) return 'A'; return null; } 
                    }, 
                    grid: { color: '#3f3f46' } 
                } 
            }
        };
    }, [xrayTimeRange]);
    
    const xrayChartData = useMemo(() => {
        if (allXrayData.length === 0) return { datasets: [] };
        return {
            datasets: [{
                label: 'Short Flux (0.1-0.8 nm)', 
                data: allXrayData.map(d => ({x: d.time, y: d.short})),
                pointRadius: 0, tension: 0.1, spanGaps: true, fill: 'origin', borderWidth: 2,
                segment: { borderColor: (ctx: any) => getColorForFlux(ctx.p1.parsed.y, 1), backgroundColor: (ctx: any) => getColorForFlux(ctx.p1.parsed.y, 0.2), }
            }],
        };
    }, [allXrayData]);
    
    return (
        <div
            className="w-full h-full bg-neutral-900 text-neutral-300 relative"
            style={{
                backgroundImage: `url('/background-solar.jpg')`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundAttachment: 'fixed',
            }}
        >
            <div className="absolute inset-0 bg-black/50 z-0"></div>
            
            <div className="w-full h-full overflow-y-auto p-5 relative z-10 styled-scrollbar">
                <style>{`body { overflow-y: auto !important; } .styled-scrollbar::-webkit-scrollbar { width: 8px; } .styled-scrollbar::-webkit-scrollbar-track { background: #262626; } .styled-scrollbar::-webkit-scrollbar-thumb { background: #525252; }`}</style>
                <div className="container mx-auto">
                    <header className="text-center mb-8">
                        <a href="https://www.tnrprotography.co.nz" target="_blank" rel="noopener noreferrer"><img src="https://www.tnrprotography.co.nz/uploads/1/3/6/6/136682089/white-tnr-protography-w_orig.png" alt="TNR Protography Logo" className="mx-auto w-full max-w-[250px] mb-4"/></a>
                        <h1 className="text-3xl font-bold text-neutral-100">Solar Activity Dashboard</h1>
                    </header>
                    <main className="grid grid-cols-12 gap-5">
                        {/* Consolidated Solar Imagers Panel */}
                        <div className="col-span-12 card bg-neutral-950/80 p-4 h-[550px] flex flex-col">
                            <h2 className="text-xl font-semibold text-center text-white mb-2 flex-shrink-0">Solar Imagery</h2>
                            <div className="flex justify-center gap-2 my-2 flex-wrap mb-4">
                                <button
                                    onClick={() => setActiveSunImage('SUVI_131')}
                                    className={`px-3 py-1 text-xs rounded transition-colors ${activeSunImage === 'SUVI_131' ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}
                                    title="Displays the Sun in 131 Angstroms, highlighting hot, flaring regions. (SUVI)"
                                >
                                    SUVI 131Å
                                </button>
                                <button
                                    onClick={() => setActiveSunImage('SUVI_304')}
                                    className={`px-3 py-1 text-xs rounded transition-colors ${activeSunImage === 'SUVI_304' ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}
                                    title="Displays the Sun in 304 Angstroms, showing cooler plasma, prominences, and filaments. (SUVI)"
                                >
                                    SUVI 304Å
                                </button>
                                <button
                                    onClick={() => setActiveSunImage('SDO_HMI')}
                                    className={`px-3 py-1 text-xs rounded transition-colors ${activeSunImage === 'SDO_HMI' ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}
                                    title="Displays a visible light image of the Sun's surface, showing sunspots. (SDO HMI)"
                                >
                                    SDO HMI
                                </button>
                                <button
                                    onClick={() => setActiveSunImage('SDO_AIA_193')}
                                    className={`px-3 py-1 text-xs rounded transition-colors ${activeSunImage === 'SDO_AIA_193' ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}
                                    title="Displays the Sun in 193 Angstroms, showing the hot corona and coronal holes. (SDO AIA)"
                                >
                                    SDO AIA 193Å
                                </button>
                                {/* REMOVED CCOR1_VIDEO BUTTON FROM HERE */}
                            </div>

                            {/* Conditional Rendering of the selected image */}
                            <div className="flex-grow flex justify-center items-center relative min-h-0">
                                {activeSunImage === 'SUVI_131' && (
                                    <div
                                        onClick={() => suvi131.url !== '/placeholder.png' && suvi131.url !== '/error.png' && setViewerMedia({ url: suvi131.url, type: 'image' })}
                                        className="flex-grow flex justify-center items-center cursor-pointer relative min-h-0 w-full h-full"
                                        title={tooltipContent['suvi-131']}
                                    >
                                        <img src={suvi131.url} alt="SUVI 131Å" className="max-w-full max-h-full object-contain rounded-lg"/>
                                        {suvi131.loading && <p className="absolute text-neutral-400 italic">{suvi131.loading}</p>}
                                    </div>
                                )}
                                {activeSunImage === 'SUVI_304' && (
                                    <div
                                        onClick={() => suvi304.url !== '/placeholder.png' && suvi304.url !== '/error.png' && setViewerMedia({ url: suvi304.url, type: 'image' })}
                                        className="flex-grow flex justify-center items-center cursor-pointer relative min-h-0 w-full h-full"
                                        title={tooltipContent['suvi-304']}
                                    >
                                        <img src={suvi304.url} alt="SUVI 304Å" className="max-w-full max-h-full object-contain rounded-lg"/>
                                        {suvi304.loading && <p className="absolute text-neutral-400 italic">{suvi304.loading}</p>}
                                    </div>
                                )}
                                {activeSunImage === 'SDO_HMI' && (
                                    <div
                                        onClick={() => sdoHmi.url !== '/placeholder.png' && sdoHmi.url !== '/error.png' && setViewerMedia({ url: sdoHmi.url, type: 'image' })}
                                        className="flex-grow flex justify-center items-center cursor-pointer relative min-h-0 w-full h-full"
                                        title={tooltipContent['sdo-hmi']}
                                    >
                                        <img src={sdoHmi.url} alt="SDO HMI Intensitygram" className="max-w-full max-h-full object-contain rounded-lg"/>
                                        {sdoHmi.loading && <p className="absolute text-neutral-400 italic">{sdoHmi.loading}</p>}
                                    </div>
                                )}
                                {activeSunImage === 'SDO_AIA_193' && (
                                    <div
                                        onClick={() => sdoAia193.url !== '/placeholder.png' && sdoAia193.url !== '/error.png' && setViewerMedia({ url: sdoAia193.url, type: 'image' })}
                                        className="flex-grow flex justify-center items-center cursor-pointer relative min-h-0 w-full h-full"
                                        title={tooltipContent['sdo-aia-193']}
                                    >
                                        <img src={sdoAia193.url} alt="SDO AIA 193Å" className="max-w-full max-h-full object-contain rounded-lg"/>
                                        {sdoAia193.loading && <p className="absolute text-neutral-400 italic">{sdoAia193.loading}</p>}
                                    </div>
                                )}
                                {/* REMOVED CCOR1_VIDEO RENDERING FROM HERE */}
                            </div>
                        </div>

                        {/* GOES X-ray Flux Graph */}
                        <div className="col-span-12 card bg-neutral-950/80 p-4 h-[500px] flex flex-col">
                            <div className="flex justify-center items-center gap-2">
                                <h2 className="text-xl font-semibold text-white mb-2">GOES X-ray Flux</h2>
                                {/* Changed to openModal for information, linking to the relevant tooltipContent */}
                                <button onClick={() => openModal('xray-flux')} className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700" title="Information about X-ray Flux.">?</button>
                            </div>
                            <TimeRangeButtons onSelect={setXrayTimeRange} selected={xrayTimeRange} />
                            <div className="flex-grow relative mt-2" title={tooltipContent['xray-flux']}>
                                {xrayChartData.datasets[0]?.data.length > 0 ? <Line data={xrayChartData} options={xrayChartOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">{loadingXray}</p>}
                            </div>
                        </div>

                        {/* Solar Flares & Active Regions */}
                        <div className="col-span-12 lg:col-span-6 card bg-neutral-950/80 p-4 flex flex-col min-h-[400px]">
                            <div className="flex justify-center items-center gap-2">
                                <h2 className="text-xl font-semibold text-white text-center mb-4">Latest Solar Flares (24 Hrs)</h2>
                                <button onClick={() => openModal('solar-flares')} className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700" title="Information about Solar Flares.">?</button>
                            </div>
                            <ul className="space-y-2 overflow-y-auto max-h-96 styled-scrollbar pr-2">
                                {loadingFlares ? <li className="text-center text-neutral-400 italic">{loadingFlares}</li> 
                                : solarFlares.length > 0 ? solarFlares.map((flare) => {
                                    const { background, text } = getColorForFlareClass(flare.classType);
                                    const cmeHighlight = flare.hasCME ? 'border-sky-400 shadow-lg shadow-sky-500/10' : 'border-transparent';
                                    return ( <li key={flare.flareID} onClick={() => setSelectedFlare(flare)} className={`bg-neutral-800 p-2 rounded text-sm cursor-pointer transition-all hover:bg-neutral-700 border-2 ${cmeHighlight}`}> <div className="flex justify-between items-center"> <span> <strong className={`px-2 py-0.5 rounded ${text}`} style={{ backgroundColor: background }}>{flare.classType}</strong> <span className="ml-2">at {formatNZTimestamp(flare.peakTime)}</span> </span> {flare.hasCME && <span className="text-xs font-bold text-sky-400 animate-pulse">CME Event</span>} </div> </li> )}) 
                                : <li className="text-center text-neutral-400 italic">No recent flares found.</li>}
                            </ul>
                        </div>
                        <div className="col-span-12 lg:col-span-6 card bg-neutral-950/80 p-4 flex flex-col min-h-[400px]">
                            <div className="flex justify-center items-center gap-2">
                                <h2 className="text-xl font-semibold text-white text-center mb-4">Active Regions</h2>
                                <button onClick={() => openModal('active-regions')} className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700" title="Information about Active Regions/Sunspots.">?</button>
                            </div>
                            <ul className="space-y-2 overflow-y-auto max-h-96 styled-scrollbar pr-2">
                            {loadingSunspots ? <li className="text-center text-neutral-400 italic">{loadingSunspots}</li> : sunspots.length > 0 ? sunspots.map((spot) => <li key={spot.region} className="bg-neutral-800 p-2 rounded text-sm"><strong>Region {spot.region}</strong> ({spot.location}) - Mag Class: {spot.mag_class}</li>) : <li className="text-center text-neutral-400 italic">No Earth-facing regions found.</li>}
                            </ul>
                        </div>

                        {/* NEW: CCOR1 Video Panel (Moved here) */}
                        <div className="col-span-12 card bg-neutral-950/80 p-4 h-[400px] flex flex-col">
                            <div className="flex justify-center items-center gap-2">
                                <h2 className="text-xl font-semibold text-white text-center mb-4">CCOR1 Coronagraph Video</h2>
                                <button onClick={() => openModal('ccor1-video')} className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700" title="Information about CCOR1 Coronagraph Video.">?</button>
                            </div>
                            <div
                                onClick={() => ccor1Video.url && setViewerMedia({ url: ccor1Video.url, type: 'video' })}
                                className="flex-grow flex justify-center items-center cursor-pointer relative min-h-0 w-full h-full"
                                title={tooltipContent['ccor1-video']}
                            >
                                {ccor1Video.loading && <p className="absolute text-neutral-400 italic">{ccor1Video.loading}</p>}
                                {ccor1Video.url && !ccor1Video.loading ? (
                                    <video controls muted loop className="max-w-full max-h-full object-contain rounded-lg">
                                        <source src={ccor1Video.url} type="video/mp4" />
                                        Your browser does not support the video tag.
                                    </video>
                                ) : (
                                    !ccor1Video.loading && <p className="text-neutral-400 italic">Video not available.</p>
                                )}
                            </div>
                        </div>

                        {/* Interplanetary Shock Events Card (KEEPING THIS AS IT'S RELEVANT TO SOLAR ACTIVITY) */}
                        <div className="col-span-12 card bg-neutral-950/80 p-4">
                            <div className="flex items-center justify-between cursor-pointer" onClick={() => setIsIpsOpen(!isIpsOpen)}>
                                <div className="flex items-center">
                                    <h2 className="text-xl font-semibold text-neutral-100">Interplanetary Shock Events</h2>
                                    <button onClick={(e) => { e.stopPropagation(); openModal('ips'); }} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button>
                                </div>
                                <button className="p-2 rounded-full text-neutral-300 hover:bg-neutral-700/60 transition-colors">
                                    {/* CaretIcon is removed from here if it's not imported/needed globally */}
                                    <svg xmlns="http://www.w3.org/2000/svg" className={`w-6 h-6 transform transition-transform duration-300 ${isIpsOpen ? 'rotate-180' : 'rotate-0'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                                </button>
                            </div>
                            <div className={`transition-all duration-500 ease-in-out overflow-hidden ${isIpsOpen ? 'max-h-[150vh] opacity-100 mt-4' : 'max-h-0 opacity-0'}`}>
                                {interplanetaryShockData.length > 0 ? (
                                    <div className="space-y-4 text-sm">
                                        {interplanetaryShockData.slice(0, 5).map((shock) => (
                                            <div key={shock.activityID} className="bg-neutral-900/70 p-3 rounded-lg border border-neutral-700/60">
                                                <p><strong className="text-neutral-300">Shock Time:</strong> <span className="text-yellow-400 font-mono">{formatNZTimestamp(shock.eventTime)}</span></p>
                                                <p><strong className="text-neutral-300">Location:</strong> {shock.location}</p>
                                                <p><strong className="text-neutral-300">Source:</strong> {shock.instruments.map(inst => inst.displayName).join(', ')}</p>
                                                <p><strong className="text-neutral-300">Activity ID:</strong> <a href={shock.link} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">{shock.activityID}</a></p>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-center pt-5 text-neutral-400 italic">No recent interplanetary shock data available from NASA.</p>
                                )}
                            </div>
                        </div>

                    </main>
                    <footer className="page-footer mt-10 pt-8 border-t border-neutral-700 text-center text-neutral-400 text-sm">
                        <h3 className="text-lg font-semibold text-neutral-200 mb-4">About This Dashboard</h3>
                        <p className="max-w-3xl mx-auto leading-relaxed">This dashboard provides real-time information on solar X-ray flux, solar flares, active regions (sunspots), and related space weather phenomena. Data is sourced directly from official NASA and NOAA APIs.</p>
                        <p className="max-w-3xl mx-auto leading-relaxed mt-4"><strong>Disclaimer:</strong> Solar activity can be highly unpredictable. While this dashboard provides the latest available data, interpretations are for informational purposes only.</p>
                        <div className="mt-8 text-xs text-neutral-500"><p>Data provided by <a href="https://www.swpc.noaa.gov/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">NOAA SWPC</a> & <a href="https://api.nasa.gov/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">NASA</a></p><p className="mt-2">Visualization and Development by TNR Protography</p></div>
                    </footer>
                 </div>
            </div>
            
            <InfoModal
                isOpen={!!selectedFlare}
                onClose={() => setSelectedFlare(null)}
                title={`Flare Details: ${selectedFlare?.flareID || ''}`}
                content={ selectedFlare && ( <div className="space-y-2"> <p><strong>Class:</strong> {selectedFlare.classType}</p> <p><strong>Begin Time (NZT):</strong> {formatNZTimestamp(selectedFlare.beginTime)}</p> <p><strong>Peak Time (NZT):</strong> {formatNZTimestamp(selectedFlare.peakTime)}</p> <p><strong>End Time (NZT):</strong> {formatNZTimestamp(selectedFlare.endTime)}</p> <p><strong>Source Location:</strong> {selectedFlare.sourceLocation}</p> <p><strong>Active Region:</strong> {selectedFlare.activeRegionNum || 'N/A'}</p> <p><strong>CME Associated:</strong> {selectedFlare.hasCME ? 'Yes' : 'No'}</p> <p><a href={selectedFlare.link} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">View on NASA DONKI</a></p> </div> )}
            />
            {modalState && (
                <InfoModal
                    isOpen={modalState.isOpen}
                    onClose={closeModal}
                    title={modalState.title}
                    content={modalState.content}
                />
            )}
        </div>
    );
};

export default SolarActivityDashboard;