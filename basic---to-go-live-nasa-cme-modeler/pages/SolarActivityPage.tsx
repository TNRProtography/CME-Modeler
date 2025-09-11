// --- START OF FILE src/pages/SolarActivityPage.tsx ---

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Line } from 'react-chartjs-2';
import { ChartOptions } from 'chart.js';
import { enNZ } from 'date-fns/locale';
import CloseIcon from '../components/icons/CloseIcon';

interface SolarActivityPageProps {
  setViewerMedia: (media: { url: string, type: 'image' | 'video' | 'animation' } | null) => void;
  setLatestXrayFlux: (flux: number | null) => void;
}

interface SolarActivitySummary {
  highestXray: { flux: number; class: string; timestamp: number; };
  highestProton: { flux: number; class: string; timestamp: number; };
  flareCounts: { x: number; m: number; c: number; };
}

// --- CONSTANTS ---
const NOAA_XRAY_FLUX_URL = 'https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json';
const NOAA_PROTON_FLUX_URL = 'https://services.swpc.noaa.gov/json/goes/primary/integral-protons-plot-1-day.json';
const SUVI_131_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/131/latest.png';
const SUVI_304_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/304/latest.png';
const NASA_DONKI_BASE_URL = 'https://api.nasa.gov/DONKI/';
const CCOR1_VIDEO_URL = 'https://services.swpc.noaa.gov/products/ccor1/mp4s/ccor1_last_24hrs.mp4';
const SDO_PROXY_BASE_URL = 'https://sdo-imagery-proxy.thenamesrock.workers.dev';
const SDO_HMI_BC_1024_URL = `${SDO_PROXY_BASE_URL}/sdo-hmibc-1024`;
const SDO_HMI_IF_1024_URL = `${SDO_PROXY_BASE_URL}/sdo-hmiif-1024`;
const SDO_AIA_193_2048_URL = `${SDO_PROXY_BASE_URL}/sdo-aia193-2048`;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

// --- HELPERS ---
const getCssVar = (name: string): string => {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch (e) { return ''; }
};
const getColorForFlux = (value: number, opacity: number = 1): string => {
    let rgb = getCssVar('--solar-flare-ab-rgb') || '34, 197, 94';
    if (value >= 5e-4) rgb = getCssVar('--solar-flare-x5plus-rgb') || '255, 105, 180';
    else if (value >= 1e-4) rgb = getCssVar('--solar-flare-x-rgb') || '147, 112, 219';
    else if (value >= 1e-5) rgb = getCssVar('--solar-flare-m-rgb') || '255, 69, 0';
    else if (value >= 1e-6) rgb = getCssVar('--solar-flare-c-rgb') || '245, 158, 11';
    return `rgba(${rgb}, ${opacity})`;
};
const getColorForProtonFlux = (value: number, opacity: number = 1): string => {
    let rgb = getCssVar('--solar-flare-ab-rgb') || '34, 197, 94';
    if (value >= 10) rgb = getCssVar('--solar-flare-c-rgb') || '245, 158, 11';
    if (value >= 100) rgb = getCssVar('--solar-flare-m-rgb') || '255, 69, 0';
    if (value >= 1000) rgb = getCssVar('--solar-flare-x-rgb') || '147, 112, 219';
    if (value >= 10000) rgb = getCssVar('--solar-flare-x5plus-rgb') || '255, 105, 180';
    if (value >= 100000) rgb = getCssVar('--solar-flare-x5plus-rgb') || '255, 20, 147';
    return `rgba(${rgb}, ${opacity})`;
};
const getColorForFlareClass = (classType: string): { background: string, text: string } => {
    const type = classType ? classType[0].toUpperCase() : 'U';
    const magnitude = parseFloat(classType.substring(1));
    if (type === 'X') {
        if (magnitude >= 5) return { background: `rgba(${getCssVar('--solar-flare-x5plus-rgb') || '255, 105, 180'}, 1)`, text: 'text-white' };
        return { background: `rgba(${getCssVar('--solar-flare-x-rgb') || '147, 112, 219'}, 1)`, text: 'text-white' };
    }
    if (type === 'M') return { background: `rgba(${getCssVar('--solar-flare-m-rgb') || '255, 69, 0'}, 1)`, text: 'text-white' };
    if (type === 'C') return { background: `rgba(${getCssVar('--solar-flare-c-rgb') || '245, 158, 11'}, 1)`, text: 'text-black' };
    return { background: `rgba(${getCssVar('--solar-flare-ab-rgb') || '34, 197, 94'}, 1)`, text: 'text-white' };
};
const formatNZTimestamp = (isoString: string | null | number) => {
    if (!isoString) return 'N/A';
    try { const d = new Date(isoString); return isNaN(d.getTime()) ? "Invalid Date" : d.toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', dateStyle: 'short', timeStyle: 'short' }); } catch { return "Invalid Date"; }
};
const getXrayClass = (value: number | null): string => {
    if (value === null) return 'N/A';
    if (value >= 1e-4) return `X${(value / 1e-4).toFixed(1)}`;
    if (value >= 1e-5) return `M${(value / 1e-5).toFixed(1)}`;
    if (value >= 1e-6) return `C${(value / 1e-6).toFixed(1)}`;
    if (value >= 1e-7) return `B${(value / 1e-7).toFixed(1)}`;
    return `A${(value / 1e-8).toFixed(1)}`;
};
const getProtonClass = (value: number | null): string => {
    if (value === null) return 'N/A';
    if (value >= 100000) return 'S5';
    if (value >= 10000) return 'S4';
    if (value >= 1000) return 'S3';
    if (value >= 100) return 'S2';
    if (value >= 10) return 'S1';
    return 'S0';
};
const getOverallActivityStatus = (xrayClass: string, protonClass: string): 'Quiet' | 'Moderate' | 'High' | 'Very High' | 'N/A' => {
    if (xrayClass === 'N/A' && protonClass === 'N/A') return 'N/A';
    let activityLevel: 'Quiet' | 'Moderate' | 'High' | 'Very High' = 'Quiet';
    if (xrayClass.startsWith('X')) activityLevel = 'Very High';
    else if (xrayClass.startsWith('M')) activityLevel = 'High';
    else if (xrayClass.startsWith('C')) activityLevel = 'Moderate';
    if (protonClass === 'S5' || protonClass === 'S4') activityLevel = 'Very High';
    else if (protonClass === 'S3' || protonClass === 'S2') { if (activityLevel !== 'Very High') activityLevel = 'High'; }
    else if (protonClass === 'S1') { if (activityLevel === 'Quiet') activityLevel = 'Moderate'; }
    return activityLevel;
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
interface InfoModalProps { isOpen: boolean; onClose: () => void; title: string; content: string | React.ReactNode; }
const InfoModal: React.FC<InfoModalProps> = ({ isOpen, onClose, title, content }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[2100] flex justify-center items-center p-4" onClick={onClose}>
      <div className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-lg max-h-[85vh] text-neutral-300 flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b border-neutral-700/80">
          <h3 className="text-xl font-bold text-neutral-200">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"><CloseIcon className="w-6 h-6" /></button>
        </div>
        <div className="overflow-y-auto p-5 styled-scrollbar pr-4 text-sm leading-relaxed">
          {typeof content === 'string' ? (<div dangerouslySetInnerHTML={{ __html: content }} />) : (content)}
        </div>
      </div>
    </div>
  );
};
const LoadingSpinner: React.FC<{ message?: string }> = ({ message }) => (
    <div className="flex flex-col items-center justify-center h-full min-h-[150px] text-neutral-400 italic">
        <svg className="animate-spin h-8 w-8 text-neutral-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        {message && <p className="mt-2 text-sm">{message}</p>}
    </div>
);
const SolarActivitySummaryDisplay: React.FC<{ summary: SolarActivitySummary | null }> = ({ summary }) => {
    if (!summary) {
        return (
            <div className="col-span-12 card bg-neutral-950/80 p-6 text-center text-neutral-400 italic">
                Calculating 24-hour summary...
            </div>
        );
    }
    const formatTime = (ts: number) => new Date(ts).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' });
    return (
        <div className="col-span-12 card bg-neutral-950/80 p-6 space-y-4">
            <h2 className="text-2xl font-bold text-white text-center">24-Hour Solar Summary</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-neutral-900/70 p-4 rounded-lg border border-neutral-700/60 text-center">
                    <h3 className="text-lg font-semibold text-neutral-200 mb-2">Peak X-ray Flux</h3>
                    <p className="text-5xl font-bold" style={{ color: getColorForFlux(summary.highestXray.flux) }}>{summary.highestXray.class}</p>
                    <p className="text-sm text-neutral-400 mt-1">at {formatTime(summary.highestXray.timestamp)}</p>
                </div>
                <div className="bg-neutral-900/70 p-4 rounded-lg border border-neutral-700/60 text-center">
                    <h3 className="text-lg font-semibold text-neutral-200 mb-2">Solar Flares</h3>
                    <div className="flex justify-center items-center gap-4 text-2xl font-bold">
                        <div><p style={{ color: `rgba(${getCssVar('--solar-flare-x-rgb')})` }}>{summary.flareCounts.x}</p><p className="text-sm font-normal">X-Class</p></div>
                        <div><p style={{ color: `rgba(${getCssVar('--solar-flare-m-rgb')})` }}>{summary.flareCounts.m}</p><p className="text-sm font-normal">M-Class</p></div>
                        <div><p style={{ color: `rgba(${getCssVar('--solar-flare-c-rgb')})` }}>{summary.flareCounts.c}</p><p className="text-sm font-normal">C-Class</p></div>
                    </div>
                </div>
                <div className="bg-neutral-900/70 p-4 rounded-lg border border-neutral-700/60 text-center">
                    <h3 className="text-lg font-semibold text-neutral-200 mb-2">Peak Proton Flux</h3>
                    <p className="text-5xl font-bold" style={{ color: getColorForProtonFlux(summary.highestProton.flux) }}>{summary.highestProton.class}</p>
                    <p className="text-sm text-neutral-400 mt-1">at {formatTime(summary.highestProton.timestamp)}</p>
                </div>
            </div>
        </div>
    );
};

const SolarActivityPage: React.FC<SolarActivityPageProps> = ({ setViewerMedia, setLatestXrayFlux }) => {
    const [suvi131, setSuvi131] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
    const [suvi304, setSuvi304] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
    const [sdoHmiBc1024, setSdoHmiBc1024] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
    const [sdoHmiIf1024, setSdoHmiIf1024] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
    const [sdoAia193_2048, setSdoAia193_2048] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
    const [ccor1Video, setCcor1Video] = useState({ url: '', loading: 'Loading video...' });
    const [activeSunImage, setActiveSunImage] = useState<string>('SUVI_131');
    const [allXrayData, setAllXrayData] = useState<any[]>([]);
    const [loadingXray, setLoadingXray] = useState<string | null>('Loading X-ray flux data...');
    const [xrayTimeRange, setXrayTimeRange] = useState<number>(24 * 60 * 60 * 1000);
    const [allProtonData, setAllProtonData] = useState<any[]>([]);
    const [loadingProton, setLoadingProton] = useState<string | null>('Loading proton flux data...');
    const [protonTimeRange, setProtonTimeRange] = useState<number>(24 * 60 * 60 * 1000);
    const [solarFlares, setSolarFlares] = useState<any[]>([]);
    const [loadingFlares, setLoadingFlares] = useState<string | null>('Loading solar flares...');
    const [selectedFlare, setSelectedFlare] = useState<any | null>(null);
    const [modalState, setModalState] = useState<{isOpen: boolean; title: string; content: string | React.ReactNode} | null>(null);
    const [currentXraySummary, setCurrentXraySummary] = useState<{ flux: number | null, class: string | null }>({ flux: null, class: null });
    const [currentProtonSummary, setCurrentProtonSummary] = useState<{ flux: number | null, class: string | null }>({ flux: null, class: null });
    const [latestRelevantEvent, setLatestRelevantEvent] = useState<string | null>(null);
    const [overallActivityStatus, setOverallActivityStatus] = useState<'Quiet' | 'Moderate' | 'High' | 'Very High' | 'N/A'>('N/A');
    const [lastXrayUpdate, setLastXrayUpdate] = useState<string | null>(null);
    const [lastProtonUpdate, setLastProtonUpdate] = useState<string | null>(null);
    const [lastFlaresUpdate, setLastFlaresUpdate] = useState<string | null>(null);
    const [lastImagesUpdate, setLastImagesUpdate] = useState<string | null>(null);
    const [activitySummary, setActivitySummary] = useState<SolarActivitySummary | null>(null);

    const navigate = useNavigate();
    const location = useLocation();
    const apiKey = import.meta.env.VITE_NASA_API_KEY || 'DEMO_KEY';

    useEffect(() => {
        if (location.state?.targetId) {
            const timer = setTimeout(() => {
                const element = document.getElementById(location.state.targetId);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [location.state]);

    const handleViewCMEInVisualization = useCallback((cmeId: string) => {
        navigate('/3d-cme-visualization', { state: { cmeIdToModel: cmeId } });
    }, [navigate]);

    useMemo(() => {
        if (allXrayData.length === 0 && allProtonData.length === 0 && solarFlares.length === 0) { setActivitySummary(null); return; }
        const highestXray = allXrayData.reduce((max, current) => { return current.short > max.short ? current : max; }, { short: 0, time: 0 });
        const highestProton = allProtonData.reduce((max, current) => { return current.flux > max.flux ? current : max; }, { flux: 0, time: 0 });
        const flareCounts = { x: 0, m: 0, c: 0 };
        solarFlares.forEach(flare => {
            const type = flare.classType?.[0]?.toUpperCase();
            if (type === 'X') flareCounts.x++; else if (type === 'M') flareCounts.m++; else if (type === 'C') flareCounts.c++;
        });
        setActivitySummary({
            highestXray: { flux: highestXray.short, class: getXrayClass(highestXray.short), timestamp: highestXray.time, },
            highestProton: { flux: highestProton.flux, class: getProtonClass(highestProton.flux), timestamp: highestProton.time, },
            flareCounts,
        });
    }, [allXrayData, allProtonData, solarFlares]);

    const tooltipContent = useMemo(() => ({ /* ... content truncated ... */ }), []);
    const openModal = useCallback((id: string) => { /* ... content truncated ... */ }, [tooltipContent]);
    const closeModal = useCallback(() => setModalState(null), []);

    const fetchImage = useCallback(async (url: string, setState: React.Dispatch<React.SetStateAction<{url: string, loading: string | null}>>, isVideo: boolean = false, addCacheBuster: boolean = true) => {
        setState({ url: isVideo ? '' : '/placeholder.png', loading: `Loading ${isVideo ? 'video' : 'image'}...` });
        try {
            const fetchUrl = addCacheBuster ? `${url}?_=${new Date().getTime()}` : url;
            const res = await fetch(fetchUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
            if (isVideo) {
                setState({ url: url, loading: null });
            } else {
                const blob = await res.blob();
                const objectURL = URL.createObjectURL(blob);
                setState({ url: objectURL, loading: null });
            }
            setLastImagesUpdate(new Date().toLocaleTimeString('en-NZ'));
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
                if (!processedData.length) { setLoadingXray('No valid X-ray data.'); setAllXrayData([]); setLatestXrayFlux(null); setCurrentXraySummary({ flux: null, class: 'N/A' }); setLastXrayUpdate(new Date().toLocaleTimeString('en-NZ')); return; }
                setAllXrayData(processedData); setLoadingXray(null);
                const latestFluxValue = processedData[processedData.length - 1].short;
                setLatestXrayFlux(latestFluxValue);
                setCurrentXraySummary({ flux: latestFluxValue, class: getXrayClass(latestFluxValue) });
                setLastXrayUpdate(new Date().toLocaleTimeString('en-NZ'));
            }).catch(e => { console.error('Error fetching X-ray flux:', e); setLoadingXray(`Error: ${e.message}`); setLatestXrayFlux(null); setCurrentXraySummary({ flux: null, class: 'N/A' }); setLastXrayUpdate(new Date().toLocaleTimeString('en-NZ')); });
    }, [setLatestXrayFlux]);

    const fetchProtonFlux = useCallback(() => { /* ... content truncated ... */ }, []);
    const fetchFlares = useCallback(async () => { /* ... content truncated ... */ }, [apiKey, latestRelevantEvent]);
    
    useEffect(() => { setOverallActivityStatus(getOverallActivityStatus(currentXraySummary.class || 'N/A', currentProtonSummary.class || 'N/A')); }, [currentXraySummary, currentProtonSummary]);
    
    useEffect(() => {
        const runAllUpdates = () => { fetchImage(SUVI_131_URL, setSuvi131); fetchImage(SUVI_304_URL, setSuvi304); fetchImage(SDO_HMI_BC_1024_URL, setSdoHmiBc1024); fetchImage(SDO_HMI_IF_1024_URL, setSdoHmiIf1024); fetchImage(SDO_AIA_193_2048_URL, setSdoAia193_2048); fetchImage(CCOR1_VIDEO_URL, setCcor1Video, true); fetchXrayFlux(); fetchProtonFlux(); fetchFlares(); };
        runAllUpdates();
        const interval = setInterval(runAllUpdates, REFRESH_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [fetchImage, fetchXrayFlux, fetchProtonFlux, fetchFlares]);

    const xrayChartOptions = useMemo((): ChartOptions<'line'> => { /* ... content truncated ... */ }, [xrayTimeRange]);
    const xrayChartData = useMemo(() => { /* ... content truncated ... */ }, [allXrayData]);
    const protonChartOptions = useMemo((): ChartOptions<'line'> => { /* ... content truncated ... */ }, [protonTimeRange]);
    const protonChartData = useMemo(() => { /* ... content truncated ... */ }, [allProtonData]);

    return (
        <div className="w-full h-full bg-neutral-900 text-neutral-300 relative" style={{ backgroundImage: `url('/background-solar.jpg')`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed', }}>
            <div className="absolute inset-0 bg-black/50 z-0"></div>
            <div className="w-full h-full overflow-y-auto p-5 relative z-10 styled-scrollbar">
                <style>{`body { overflow-y: auto !important; } .styled-scrollbar::-webkit-scrollbar { width: 8px; } .styled-scrollbar::-webkit-scrollbar-track { background: #262626; } .styled-scrollbar::-webkit-scrollbar-thumb { background: #525252; }`}</style>
                <div className="container mx-auto">
                    <header className="text-center mb-8">
                        <a href="https://www.tnrprotography.co.nz" target="_blank" rel="noopener noreferrer"><img src="https://www.tnrprotography.co.nz/uploads/1/3/6/6/136682089/white-tnr-protography-w_orig.png" alt="TNR Protography Logo" className="mx-auto w-full max-w-[250px] mb-4"/></a>
                        <h1 className="text-3xl font-bold text-neutral-100">Solar Activity Dashboard</h1>
                    </header>
                    <main className="grid grid-cols-12 gap-5">
                        <div className="col-span-12 card bg-neutral-950/80 p-4 mb-4 flex flex-col sm:flex-row justify-between items-center text-sm">
                           {/* ... Status content ... */}
                        </div>
                        <SolarActivitySummaryDisplay summary={activitySummary} />
                        <div className="col-span-12 card bg-neutral-950/80 p-4 h-[550px] flex flex-col">
                           {/* ... Solar Imagery content ... */}
                        </div>
                        <div id="goes-xray-flux-section" className="col-span-12 card bg-neutral-950/80 p-4 h-[500px] flex flex-col">
                           {/* ... Xray chart content ... */}
                        </div>
                        <div id="solar-flares-section" className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col min-h-[400px]">
                            <div className="flex justify-center items-center gap-2"><h2 className="text-xl font-semibold text-white text-center mb-4">Latest Solar Flares (24 Hrs)</h2><button onClick={() => openModal('solar-flares')} className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700" title="Information about Solar Flares.">?</button></div>
                            <div className="flex-grow overflow-y-auto max-h-96 styled-scrollbar pr-2">
                                {loadingFlares ? ( <LoadingSpinner message={loadingFlares} /> ) : solarFlares.length > 0 ? (
                                    <ul className="space-y-2">
                                        {solarFlares.map((flare) => {
                                            const { background, text } = getColorForFlareClass(flare.classType);
                                            const cmeHighlight = flare.hasCME ? 'border-sky-400 shadow-lg shadow-sky-500/10' : 'border-transparent';
                                            return (
                                                <li key={flare.flareID} onClick={() => setSelectedFlare(flare)} className={`bg-neutral-800 p-2 rounded text-sm cursor-pointer transition-all hover:bg-neutral-700 border-2 ${cmeHighlight}`}>
                                                    <div className="flex justify-between items-center">
                                                        <span><strong className={`px-2 py-0.5 rounded ${text}`} style={{ backgroundColor: background }}>{flare.classType}</strong><span className="ml-2">at {formatNZTimestamp(flare.peakTime)}</span></span>
                                                        {flare.hasCME && <span className="text-xs font-bold text-sky-400 animate-pulse">CME Event</span>}
                                                    </div>
                                                </li>
                                            )
                                        })}
                                    </ul>
                                ) : ( <div className="flex items-center justify-center h-full"><p className="text-center text-neutral-400 italic">No solar flares detected in the past 24 hours.</p></div> )}
                            </div>
                            <div className="text-right text-xs text-neutral-500 mt-2">Last updated: {lastFlaresUpdate || 'N/A'}</div>
                        </div>
                        <div className="col-span-12 card bg-neutral-950/80 p-4 h-[400px] flex flex-col">
                           {/* ... CCOR1 Video content ... */}
                        </div>
                        <div className="col-span-12 card bg-neutral-950/80 p-4 h-[500px] flex flex-col">
                            {/* ... Proton chart content ... */}
                        </div>
                    </main>
                    <footer className="page-footer mt-10 pt-8 border-t border-neutral-700 text-center text-neutral-400 text-sm">
                        {/* ... Footer content ... */}
                    </footer>
                 </div>
            </div>
            <InfoModal isOpen={!!selectedFlare} onClose={() => setSelectedFlare(null)} title={`Flare Details: ${selectedFlare?.flareID || ''}`} content={ selectedFlare && ( <div className="space-y-2"> <p><strong>Class:</strong> {selectedFlare.classType}</p> <p><strong>Begin Time (NZT):</strong> {formatNZTimestamp(selectedFlare.beginTime)}</p> <p><strong>Peak Time (NZT):</strong> {formatNZTimestamp(selectedFlare.peakTime)}</p> <p><strong>End Time (NZT):</strong> {formatNZTimestamp(selectedFlare.endTime)}</p> <p><strong>Source Location:</strong> {selectedFlare.sourceLocation}</p> <p><strong>Active Region:</strong> {selectedFlare.activeRegionNum || 'N/A'}</p> <p><strong>CME Associated:</strong> {selectedFlare.hasCME ? 'Yes' : 'No'}</p> <p><a href={selectedFlare.link} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">View on NASA DONKI</a></p> {selectedFlare.hasCME && (<button onClick={() => { handleViewCMEInVisualization(selectedFlare.linkedEvents.find((e: any) => e.activityID.includes('CME'))?.activityID); setSelectedFlare(null); }} className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-semibold hover:bg-indigo-500 transition-colors">View in CME Visualization</button>)}</div> )} />
            {modalState && (<InfoModal isOpen={modalState.isOpen} onClose={closeModal} title={modalState.title} content={modalState.content} />)}
        </div>
    );
};

export default SolarActivityPage;
// --- END OF FILE src/pages/SolarActivityPage.tsx ---