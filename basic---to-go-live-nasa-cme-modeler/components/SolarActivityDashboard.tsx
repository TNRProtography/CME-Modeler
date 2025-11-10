// --- START OF FILE src/components/SolarActivityDashboard.tsx ---

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Line } from 'react-chartjs-2';
import { ChartOptions } from 'chart.js';
import { enNZ } from 'date-fns/locale';
import CloseIcon from './icons/CloseIcon';
// --- MODIFICATION: Import only flare functions/types ---
import { 
    fetchFlareData, 
    SolarFlare
} from '../services/nasaService';

interface SolarActivityDashboardProps {
  // --- MODIFICATION: apiKey is no longer needed here ---
  // apiKey: string; 
  setViewerMedia: (media: { url: string, type: 'image' | 'video' | 'animation' } | null) => void;
  setLatestXrayFlux: (flux: number | null) => void;
  onViewCMEInVisualization: (cmeId: string) => void;
  navigationTarget: { page: string; elementId: string; expandId?: string; } | null;
}

interface SolarActivitySummary {
  highestXray: {
    flux: number;
    class: string;
    timestamp: number;
  };
  highestProton: {
    flux: number;
    class: string;
    timestamp: number;
  };
  flareCounts: {
    x: number;
    m: number;
    c: number;
  };
}


// --- CONSTANTS ---
const NOAA_XRAY_FLUX_URL = 'https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json';
const NOAA_PROTON_FLUX_URL = 'https://services.swpc.noaa.gov/json/goes/primary/integral-protons-plot-1-day.json';
const SUVI_131_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/131/latest.png';
const SUVI_304_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/304/latest.png';
// --- REMOVED: No longer need direct NASA_DONKI_BASE_URL ---
// const NASA_DONKI_BASE_URL = 'https://api.nasa.gov/DONKI/'; 
const CCOR1_VIDEO_URL = 'https://services.swpc.noaa.gov/products/ccor1/mp4s/ccor1_last_24hrs.mp4';
const SDO_PROXY_BASE_URL = 'https://sdo-imagery-proxy.thenamesrock.workers.dev';
const SDO_HMI_BC_1024_URL = `${SDO_PROXY_BASE_URL}/sdo-hmibc-1024`;
const SDO_HMI_IF_1024_URL = `${SDO_PROXY_BASE_URL}/sdo-hmiif-1024`;
const SDO_AIA_193_2048_URL = `${SDO_PROXY_BASE_URL}/sdo-aia193-2048`;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

// --- HELPERS (Unchanged) ---
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

// --- REUSABLE COMPONENTS (Unchanged) ---
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
                    <p className="text-5xl font-bold" style={{ color: getColorForFlux(summary.highestXray.flux) }}>
                        {summary.highestXray.class}
                    </p>
                    <p className="text-sm text-neutral-400 mt-1">
                        at {formatTime(summary.highestXray.timestamp)}
                    </p>
                </div>

                <div className="bg-neutral-900/70 p-4 rounded-lg border border-neutral-700/60 text-center">
                    <h3 className="text-lg font-semibold text-neutral-200 mb-2">Solar Flares</h3>
                    <div className="flex justify-center items-center gap-4 text-2xl font-bold">
                        <div>
                            <p style={{ color: `rgba(${getCssVar('--solar-flare-x-rgb')})` }}>{summary.flareCounts.x}</p>
                            <p className="text-sm font-normal">X-Class</p>
                        </div>
                        <div>
                            <p style={{ color: `rgba(${getCssVar('--solar-flare-m-rgb')})` }}>{summary.flareCounts.m}</p>
                            <p className="text-sm font-normal">M-Class</p>
                        </div>
                        <div>
                            <p style={{ color: `rgba(${getCssVar('--solar-flare-c-rgb')})` }}>{summary.flareCounts.c}</p>
                            <p className="text-sm font-normal">C-Class</p>
                        </div>
                    </div>
                </div>

                <div className="bg-neutral-900/70 p-4 rounded-lg border border-neutral-700/60 text-center">
                    <h3 className="text-lg font-semibold text-neutral-200 mb-2">Peak Proton Flux</h3>
                    <p className="text-5xl font-bold" style={{ color: getColorForProtonFlux(summary.highestProton.flux) }}>
                        {summary.highestProton.class}
                    </p>
                    <p className="text-sm text-neutral-400 mt-1">
                        at {formatTime(summary.highestProton.timestamp)}
                    </p>
                </div>
            </div>
        </div>
    );
};


const SolarActivityDashboard: React.FC<SolarActivityDashboardProps> = ({ setViewerMedia, setLatestXrayFlux, onViewCMEInVisualization, navigationTarget }) => {
    // State for imagery (unchanged)
    const [suvi131, setSuvi131] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
    const [suvi304, setSuvi304] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
    const [sdoHmiBc1024, setSdoHmiBc1024] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
    const [sdoHmiIf1024, setSdoHmiIf1024] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
    const [sdoAia193_2048, setSdoAia193_2048] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
    const [ccor1Video, setCcor1Video] = useState({ url: '', loading: 'Loading video...' });
    const [activeSunImage, setActiveSunImage] = useState<string>('SUVI_131');
    
    // State for chart data (unchanged)
    const [allXrayData, setAllXrayData] = useState<any[]>([]);
    const [loadingXray, setLoadingXray] = useState<string | null>('Loading X-ray flux data...');
    const [xrayTimeRange, setXrayTimeRange] = useState<number>(24 * 60 * 60 * 1000);
    const [allProtonData, setAllProtonData] = useState<any[]>([]);
    const [loadingProton, setLoadingProton] = useState<string | null>('Loading proton flux data...');
    const [protonTimeRange, setProtonTimeRange] = useState<number>(24 * 60 * 60 * 1000);
    
    // --- MODIFICATION: Flares only ---
    const [solarFlares, setSolarFlares] = useState<SolarFlare[]>([]);
    const [loadingFlares, setLoadingFlares] = useState<string | null>('Loading solar flares...');
    const [selectedFlare, setSelectedFlare] = useState<SolarFlare | null>(null);

    // General state (unchanged)
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

    // --- MODIFICATION: Remove IPS tooltip; keep others ---
    const tooltipContent = useMemo(() => ({
        'xray-flux': 'The GOES X-ray Flux measures X-ray radiation from the Sun. Sudden, sharp increases indicate solar flares. Flares are classified by their peak X-ray flux: B, C, M, and X, with X being the most intense. Higher class flares (M and X) can cause radio blackouts and enhanced aurora.',
        'proton-flux': '<strong>GOES Proton Flux (>=10 MeV):</strong> Measures the flux of solar protons with energies of 10 MeV or greater. Proton events (Solar Radiation Storms) are classified on an S-scale from S1 to S5 based on the peak flux. These events can cause radiation hazards for astronauts and satellite operations, and can contribute to auroral displays.',
        'suvi-131': '<strong>SUVI 131Å (Angstrom):</strong> This Extreme Ultraviolet (EUV) wavelength shows the hot, flaring regions of the Sun\'s corona, highlighting solar flares and active regions. It\'s good for seeing intense bursts of energy, especially bursts from solar flares. **Best for: Monitoring solar flares and active regions.**',
        'suvi-304': '<strong>SUVI 304Å (Angstrom):</strong> This EUV wavelength reveals the cooler, denser plasma in the Sun\'s chromosphere and transition region. It\'s excellent for observing prominences (loops of plasma extending from the Sun\'s limb) and filaments (prominences seen against the solar disk). **Best for: Observing prominences and filaments, tracking large-scale solar activity.**',
        'sdo-hmibc-1024': '<strong>SDO HMI (Helioseismic and Magnetic Imager) Continuum (1024px):</strong> Provides a visible light view of the Sun\'s surface, primarily showing sunspots and granulation. It\'s like a high-resolution "photograph" of the Sun. **Best for: Detailed observation of sunspot structure and active region morphology.**',
        'sdo-hmiif-1024': '<strong>SDO HMI (Helioseismic and Magnetic Imager) Intensitygram (1024px):</strong> Offers a higher resolution view of sunspots and active regions, highlighting magnetic field concentrations. **Best for: Tracking the evolution of sunspots and identifying potential flare source regions.**',
        'sdo-aia193-2048': '<strong>SDO AIA 193Å (Angstrom) (2048px) - Coronal Holes:</strong> A very high-resolution view of the hot corona, excellent for observing large-scale coronal holes which are sources of fast solar wind. These dark regions are crucial for predicting geomagnetic storm potential. **Best for: Identifying and monitoring coronal holes, understanding solar wind origins.**',
        'ccor1-video': '<strong>CCOR1 (Coronal Coronagraph Observation by Optical Reconnaissance) Video:</strong> This coronagraph imagery captures the faint outer atmosphere of the Sun (the corona) by blocking out the bright solar disk. It is primarily used to detect and track Coronal Mass Ejections (CMEs) as they erupt and propagate away from the Sun. **Best for: Detecting and tracking Coronal Mass Ejections (CMEs) as they leave the Sun.**',
        'solar-flares': 'A list of the latest detected solar flares. Flares are sudden bursts of radiation from the Sun. Pay attention to the class type (M or X) as these are stronger events. A "CME Event" tag means a Coronal Mass Ejection was also observed with the flare, potentially leading to Earth impacts.',
        'solar-imagery': `<p><strong>SUVI 131Å (Angstrom):</strong> Shows hot, flaring regions. Best for: Monitoring solar flares and active regions.</p><br><p><strong>SUVI 304Å (Angstrom):</strong> Reveals cooler, denser plasma. Best for: Observing prominences and filaments, tracking large-scale solar activity.</p><br><p><strong>SDO AIA 193Å (Angstrom) (2048px) - Coronal Holes:</strong> High-resolution view of the hot corona. Best for: Identifying and monitoring coronal holes, understanding solar wind origins.</p><br><p><strong>SDO HMI (Helioseismic and Magnetic Imager) Continuum (1024px):</strong> Visible light view of the Sun\'s surface, primarily showing sunspots and granulation. Best for: Detailed observation of sunspot structure and active region morphology.</p><br><p><strong>SDO HMI (Helioseismic and Magnetic Imager) Intensitygram (1024px):</strong> Higher resolution view of sunspots and magnetic fields. Best for: Tracking the evolution of sunspots and identifying potential flare source regions.</p>`
    }), []);

    // ... (openModal, closeModal, and fetchImage helpers are unchanged) ...
    const openModal = useCallback((id: string) => {
        const contentData = tooltipContent[id as keyof typeof tooltipContent];
        if (contentData) {
            let title = '';
            if (id === 'xray-flux') title = 'About GOES X-ray Flux';
            else if (id === 'proton-flux') title = 'About GOES Proton Flux (>=10 MeV)';
            else if (id === 'suvi-131') title = 'About SUVI 131Å Imagery';
            else if (id === 'suvi-304') title = 'About SUVI 304Å Imagery';
            else if (id === 'sdo-hmibc-1024') title = 'About SDO HMI Continuum Imagery';
            else if (id === 'sdo-hmiif-1024') title = 'About SDO HMI Intensitygram Imagery';
            else if (id === 'sdo-aia193-2048') title = 'About SDO AIA 193Å Imagery (Coronal Holes)';
            else if (id === 'ccor1-video') title = 'About CCOR1 Coronagraph Video';
            else if (id === 'solar-flares') title = 'About Solar Flares';
            else if (id === 'solar-imagery') title = 'About Solar Imagery Types';
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
    // --- Data fetching functions (fetchXrayFlux and fetchProtonFlux are unchanged) ---
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
                    setCurrentXraySummary({ flux: null, class: 'N/A' });
                    setLastXrayUpdate(new Date().toLocaleTimeString('en-NZ'));
                    return;
                }
                setAllXrayData(processedData);
                setLoadingXray(null);
                const latestFluxValue = processedData[processedData.length - 1].short;
                setLatestXrayFlux(latestFluxValue);
                setCurrentXraySummary({ flux: latestFluxValue, class: getXrayClass(latestFluxValue) });
                setLastXrayUpdate(new Date().toLocaleTimeString('en-NZ'));
            }).catch(e => {
                console.error('Error fetching X-ray flux:', e);
                setLoadingXray(`Error: ${e.message}`);
                setLatestXrayFlux(null);
                setCurrentXraySummary({ flux: null, class: 'N/A' });
                setLastXrayUpdate(new Date().toLocaleTimeString('en-NZ'));
            });
    }, [setLatestXrayFlux]);

    const fetchProtonFlux = useCallback(() => {
        setLoadingProton('Loading proton flux data...');
        fetch(`${NOAA_PROTON_FLUX_URL}?_=${new Date().getTime()}`).then(res => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
            .then(rawData => {
                const processedData = rawData
                    .filter((d: any) => d.energy === ">=10 MeV" && d.flux !== null && !isNaN(d.flux))
                    .map((d: any) => ({ time: new Date(d.time_tag).getTime(), flux: parseFloat(d.flux) }))
                    .sort((a: any, b: any) => a.time - b.time);
                if (!processedData.length) {
                    setLoadingProton('No valid >=10 MeV proton data.');
                    setAllProtonData([]);
                    setCurrentProtonSummary({ flux: null, class: 'N/A' });
                    setLastProtonUpdate(new Date().toLocaleTimeString('en-NZ'));
                    return;
                }
                setAllProtonData(processedData);
                setLoadingProton(null);
                const latestFluxValue = processedData[processedData.length - 1].flux;
                setCurrentProtonSummary({ flux: latestFluxValue, class: getProtonClass(latestFluxValue) });
                setLastProtonUpdate(new Date().toLocaleTimeString('en-NZ'));
            }).catch(e => {
                console.error('Error fetching proton flux:', e);
                setLoadingProton(`Error: ${e.message}`);
                setCurrentProtonSummary({ flux: null, class: 'N/A' });
                setLastProtonUpdate(new Date().toLocaleTimeString('en-NZ'));
            });
    }, []);
    // --- MODIFICATION: Updated fetchFlares function ---
    const fetchFlares = useCallback(async () => {
        setLoadingFlares('Loading solar flares...');
        try {
            const data = await fetchFlareData(); // Use new service function
            if (!data || data.length === 0) {
                setSolarFlares([]);
                setLoadingFlares(null);
                setLastFlaresUpdate(new Date().toLocaleTimeString('en-NZ'));
                return;
            }
            const processedData = data.map((flare: SolarFlare) => ({
                ...flare,
                hasCME: flare.linkedEvents?.some((e: any) => e.activityID.includes('CME')) ?? false,
            }));
            setSolarFlares(processedData);
            setLoadingFlares(null);
            setLastFlaresUpdate(new Date().toLocaleTimeString('en-NZ'));
        } catch (error) {
            console.error('Error fetching flares:', error);
            setLoadingFlares(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            setLastFlaresUpdate(new Date().toLocaleTimeString('en-NZ'));
        }
    }, []);
    
    // --- MODIFICATION: Removed IPS fetching & calls ---

    useEffect(() => {
        const runAllUpdates = () => {
            fetchImage(SUVI_131_URL, setSuvi131);
            fetchImage(SUVI_304_URL, setSuvi304);
            fetchImage(SDO_HMI_BC_1024_URL, setSdoHmiBc1024);
            fetchImage(SDO_HMI_IF_1024_URL, setSdoHmiIf1024);
            fetchImage(SDO_AIA_193_2048_URL, setSdoAia193_2048);
            fetchImage(CCOR1_VIDEO_URL, setCcor1Video, true);
            fetchXrayFlux();
            fetchProtonFlux();
            fetchFlares();
            // REMOVED: fetchIPS();
        };
        runAllUpdates();
        const interval = setInterval(runAllUpdates, REFRESH_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [fetchImage, fetchXrayFlux, fetchProtonFlux, fetchFlares]); // REMOVED: fetchIPS from deps

    // ... (All chart options, chart data, and other useMemo/useEffect hooks are unchanged) ...
    // --- Main useEffect for updates ---
    useEffect(() => {
        setOverallActivityStatus(getOverallActivityStatus(currentXraySummary.class || 'N/A', currentProtonSummary.class || 'N/A'));
    }, [currentXraySummary, currentProtonSummary]);
    const xrayChartOptions = useMemo((): ChartOptions<'line'> => {
        const now = Date.now();
        const startTime = now - xrayTimeRange;
        const midnightAnnotations: any = {};
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
                x: { type: 'time', adapters: { date: { locale: enNZ } }, time: { unit: 'hour', tooltipFormat: 'HH:mm', displayFormats: { hour: 'HH:mm' } }, min: startTime, max: now, ticks: { color: '#71717a', source: 'auto' }, grid: { color: '#3f3f46' } },
                y: { type: 'logarithmic', min: 1e-9, max: 1e-3, ticks: { color: '#71717a', callback: (v: any) => { if(v===1e-4) return 'X'; if(v===1e-5) return 'M'; if(v===1e-6) return 'C'; if(v===1e-7) return 'B'; if(v===1e-8) return 'A'; return null; } }, grid: { color: '#3f3f46' } }
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
    const protonChartOptions = useMemo((): ChartOptions<'line'> => {
        const now = Date.now();
        const startTime = now - protonTimeRange;
        const midnightAnnotations: any = {};
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
                    label: (c: any) => {
                        const flux = c.parsed.y;
                        let sClass = 'S0';
                        if (flux >= 100000) sClass = 'S5'; else if (flux >= 10000) sClass = 'S4'; else if (flux >= 1000) sClass = 'S3'; else if (flux >= 100) sClass = 'S2'; else if (flux >= 10) sClass = 'S1';
                        return `Flux: ${flux.toFixed(2)} pfu (${sClass}-class)`;
                    }
                }},
                annotation: { annotations: midnightAnnotations }
            },
            scales: {
                x: { type: 'time', adapters: { date: { locale: enNZ } }, time: { unit: 'hour', tooltipFormat: 'HH:mm', displayFormats: { hour: 'HH:mm' } }, min: startTime, max: now, ticks: { color: '#71717a', source: 'auto' }, grid: { color: '#3f3f46' } },
                y: { type: 'logarithmic', min: 1e-4, max: 1000000, ticks: { color: '#71717a', callback: (value: any) => { if (value === 100000) return 'S5'; if (value === 10000) return 'S4'; if (value === 1000) return 'S3'; if (value === 100) return 'S2'; if (value === 10) return 'S1'; if (value === 1) return 'S0'; if (value === 0.1 || value === 0.01 || value === 0.001 || value === 0.0001) return value.toString(); return null; } }, grid: { color: '#3f3f46' } }
            }
        };
    }, [protonTimeRange]);
    const protonChartData = useMemo(() => {
        if (allProtonData.length === 0) return { datasets: [] };
        return {
            datasets: [{
                label: 'Proton Flux (>=10 MeV)',
                data: allProtonData.map(d => ({x: d.time, y: d.flux})),
                pointRadius: 0, tension: 0.1, spanGaps: true, fill: 'origin', borderWidth: 2,
                segment: { borderColor: (ctx: any) => getColorForProtonFlux(ctx.p1.parsed.y, 1), backgroundColor: (ctx: any) => getColorForProtonFlux(ctx.p1.parsed.y, 0.2), }
            }],
        };
    }, [allProtonData]);
    useMemo(() => {
        if (allXrayData.length === 0 && allProtonData.length === 0 && solarFlares.length === 0) {
            setActivitySummary(null);
            return;
        }
        const highestXray = allXrayData.reduce((max, current) => {
            return current.short > max.short ? current : max;
        }, { short: 0, time: 0 });
        const highestProton = allProtonData.reduce((max, current) => {
            return current.flux > max.flux ? current : max;
        }, { flux: 0, time: 0 });
        const flareCounts = { x: 0, m: 0, c: 0 };
        solarFlares.forEach(flare => {
            const type = flare.classType?.[0]?.toUpperCase();
            if (type === 'X') flareCounts.x++;
            else if (type === 'M') flareCounts.m++;
            else if (type === 'C') flareCounts.c++;
        });
        setActivitySummary({
            highestXray: { flux: highestXray.short, class: getXrayClass(highestXray.short), timestamp: highestXray.time, },
            highestProton: { flux: highestProton.flux, class: getProtonClass(highestProton.flux), timestamp: highestProton.time, },
            flareCounts,
        });
    }, [allXrayData, allProtonData, solarFlares]);
    
    // --- Render logic ---
    return (
        <div
            className="w-full h-full bg-neutral-900 text-neutral-300 relative"
            style={{ backgroundImage: `url('/background-solar.jpg')`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed', }}
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
                        <div className="col-span-12 card bg-neutral-950/80 p-4 mb-4 flex flex-col sm:flex-row justify-between items-center text-sm">
                            <div className="flex-1 text-center sm:text-left mb-2 sm:mb-0">
                                <h3 className="text-neutral-200 font-semibold mb-1">Current Status: <span className={`font-bold ${overallActivityStatus === 'Quiet' ? 'text-green-400' : overallActivityStatus === 'Moderate' ? 'text-yellow-400' : overallActivityStatus === 'High' ? 'text-orange-400' : 'text-red-500'}`}>{overallActivityStatus}</span></h3>
                                <p>X-ray Flux: <span className="font-mono text-cyan-300">{currentXraySummary.flux !== null ? currentXraySummary.flux.toExponential(2) : 'N/A'}</span> ({currentXraySummary.class || 'N/A'})</p>
                                <p>Proton Flux: <span className="font-mono text-yellow-400">{currentProtonSummary.flux !== null ? currentProtonSummary.flux.toFixed(2) : 'N/A'}</span> pfu ({currentProtonSummary.class || 'N/A'})</p>
                            </div>
                            <div className="flex-1 text-center sm:text-right">
                                <h3 className="text-neutral-200 font-semibold mb-1">Latest Event:</h3>
                                <p className="text-orange-300 italic">{latestRelevantEvent || 'No significant events recently.'}</p>
                            </div>
                        </div>
                        
                        <SolarActivitySummaryDisplay summary={activitySummary} />

                        <div className="col-span-12 lg:col-span-6 card bg-neutral-950/80 p-4 h-[550px] flex flex-col">
                            <div className="flex justify-center items-center gap-2">
                                <h2 className="text-xl font-semibold text-white mb-2">Solar Imagery</h2>
                                <button onClick={() => openModal('solar-imagery')} className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700" title="Information about Solar Imagery types.">?</button>
                            </div>
                            <div className="flex justify-center gap-2 my-2 flex-wrap mb-4">
                                <button onClick={() => setActiveSunImage('SUVI_131')} className={`px-3 py-1 text-xs rounded transition-colors ${activeSunImage === 'SUVI_131' ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>SUVI 131Å</button>
                                <button onClick={() => setActiveSunImage('SUVI_304')} className={`px-3 py-1 text-xs rounded transition-colors ${activeSunImage === 'SUVI_304' ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>SUVI 304Å</button>
                                <button onClick={() => setActiveSunImage('SDO_AIA193_2048')} className={`px-3 py-1 text-xs rounded transition-colors ${activeSunImage === 'SDO_AIA193_2048' ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>SDO AIA 193Å</button>
                                <button onClick={() => setActiveSunImage('SDO_HMIBC_1024')} className={`px-3 py-1 text-xs rounded transition-colors ${activeSunImage === 'SDO_HMIBC_1024' ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>SDO HMI Cont.</button>
                                <button onClick={() => setActiveSunImage('SDO_HMIIF_1024')} className={`px-3 py-1 text-xs rounded transition-colors ${activeSunImage === 'SDO_HMIIF_1024' ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>SDO HMI Int.</button>
                            </div>
                            <div className="flex-grow flex justify-center items-center relative min-h-0">
                                {activeSunImage === 'SUVI_131' && (<div onClick={() => suvi131.url !== '/placeholder.png' && suvi131.url !== '/error.png' && setViewerMedia({ url: suvi131.url, type: 'image' })} className="flex-grow flex justify-center items-center cursor-pointer relative min-h-0 w-full h-full" title={tooltipContent['suvi-131']}><img src={suvi131.url} alt="SUVI 131Å" className="max-w-full max-h-full object-contain rounded-lg"/>{suvi131.loading && <LoadingSpinner message={suvi131.loading} />}</div>)}
                                {activeSunImage === 'SUVI_304' && (<div onClick={() => suvi304.url !== '/placeholder.png' && suvi304.url !== '/error.png' && setViewerMedia({ url: suvi304.url, type: 'image' })} className="flex-grow flex justify-center items-center cursor-pointer relative min-h-0 w-full h-full" title={tooltipContent['suvi-304']}><img src={suvi304.url} alt="SUVI 304Å" className="max-w-full max-h-full object-contain rounded-lg"/>{suvi304.loading && <LoadingSpinner message={suvi304.loading} />}</div>)}
                                {activeSunImage === 'SDO_AIA193_2048' && (<div onClick={() => sdoAia193_2048.url !== '/placeholder.png' && sdoAia193_2048.url !== '/error.png' && setViewerMedia({ url: sdoAia193_2048.url, type: 'image' })} className="flex-grow flex justify-center items-center cursor-pointer relative min-h-0 w-full h-full" title={tooltipContent['sdo-aia193-2048']}><img src={sdoAia193_2048.url} alt="SDO AIA 193Å (Coronal Holes)" className="max-w-full max-h-full object-contain rounded-lg"/>{sdoAia193_2048.loading && <LoadingSpinner message={sdoAia193_2048.loading} />}</div>)}
                                {activeSunImage === 'SDO_HMIBC_1024' && (<div onClick={() => sdoHmiBc1024.url !== '/placeholder.png' && sdoHmiBc1024.url !== '/error.png' && setViewerMedia({ url: sdoHmiBc1024.url, type: 'image' })} className="flex-grow flex justify-center items-center cursor-pointer relative min-h-0 w-full h-full" title={tooltipContent['sdo-hmibc-1024']}><img src={sdoHmiBc1024.url} alt="SDO HMI Continuum" className="max-w-full max-h-full object-contain rounded-lg"/>{sdoHmiBc1024.loading && <LoadingSpinner message={sdoHmiBc1024.loading} />}</div>)}
                                {activeSunImage === 'SDO_HMIIF_1024' && (<div onClick={() => sdoHmiIf1024.url !== '/placeholder.png' && sdoHmiIf1024.url !== '/error.png' && setViewerMedia({ url: sdoHmiIf1024.url, type: 'image' })} className="flex-grow flex justify-center items-center cursor-pointer relative min-h-0 w-full h-full" title={tooltipContent['sdo-hmiif-1024']}><img src={sdoHmiIf1024.url} alt="SDO HMI Intensitygram" className="max-w-full max-h-full object-contain rounded-lg"/>{sdoHmiIf1024.loading && <LoadingSpinner message={sdoHmiIf1024.loading} />}</div>)}
                            </div>
                            <div className="text-right text-xs text-neutral-500 mt-2">Last updated: {lastImagesUpdate || 'N/A'}</div>
                        </div>

                        {/* --- REMOVED: Interplanetary Shocks Panel --- */}

                        <div id="goes-xray-flux-section" className="col-span-12 card bg-neutral-950/80 p-4 h-[500px] flex flex-col">
                            <div className="flex justify-center items-center gap-2"><h2 className="text-xl font-semibold text-white mb-2">GOES X-ray Flux</h2><button onClick={() => openModal('xray-flux')} className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700" title="Information about X-ray Flux.">?</button></div>
                            <TimeRangeButtons onSelect={setXrayTimeRange} selected={xrayTimeRange} />
                            <div className="flex-grow relative mt-2" title={tooltipContent['xray-flux']}>{xrayChartData.datasets[0]?.data.length > 0 ? <Line data={xrayChartData} options={xrayChartOptions} /> : <LoadingSpinner message={loadingXray} />}</div>
                            <div className="text-right text-xs text-neutral-500 mt-2">Last updated: {lastXrayUpdate || 'N/A'}</div>
                        </div>
                        <div id="solar-flares-section" className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col min-h-[400px]">
                            <div className="flex justify-center items-center gap-2"><h2 className="text-xl font-semibold text-white text-center mb-4">Latest Solar Flares (Last 7 Days)</h2><button onClick={() => openModal('solar-flares')} className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700" title="Information about Solar Flares.">?</button></div>
                            <div className="flex-grow overflow-y-auto max-h-96 styled-scrollbar pr-2">
                                {loadingFlares ? (
                                    <LoadingSpinner message={loadingFlares} />
                                ) : solarFlares.length > 0 ? (
                                    <ul className="space-y-2">
                                        {solarFlares.map((flare) => {
                                            const { background, text } = getColorForFlareClass(flare.classType);
                                            const cmeHighlight = flare.hasCME ? 'border-sky-400 shadow-lg shadow-sky-500/10' : 'border-transparent';
                                            return (
                                                <li key={flare.flrID} onClick={() => setSelectedFlare(flare)} className={`bg-neutral-800 p-2 rounded text-sm cursor-pointer transition-all hover:bg-neutral-700 border-2 ${cmeHighlight}`}>
                                                    <div className="flex justify-between items-center">
                                                        <span>
                                                            <strong className={`px-2 py-0.5 rounded ${text}`} style={{ backgroundColor: background }}>{flare.classType}</strong>
                                                            <span className="ml-2">at {formatNZTimestamp(flare.peakTime)}</span>
                                                        </span>
                                                        {flare.hasCME && <span className="text-xs font-bold text-sky-400 animate-pulse">CME Event</span>}
                                                    </div>
                                                </li>
                                            )
                                        })}
                                    </ul>
                                ) : (
                                    <div className="flex items-center justify-center h-full">
                                        <p className="text-center text-neutral-400 italic">No solar flares detected recently.</p>
                                    </div>
                                )}
                            </div>
                            <div className="text-right text-xs text-neutral-500 mt-2">Last updated: {lastFlaresUpdate || 'N/A'}</div>
                        </div>
                        <div className="col-span-12 card bg-neutral-950/80 p-4 h-[400px] flex flex-col">
                            <div className="flex justify-center items-center gap-2"><h2 className="text-xl font-semibold text-white text-center mb-4">CCOR1 Coronagraph Video</h2><button onClick={() => openModal('ccor1-video')} className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700" title="Information about CCOR1 Coronagraph Video.">?</button></div>
                            <div onClick={() => ccor1Video.url && setViewerMedia({ url: ccor1Video.url, type: 'video' })} className="flex-grow flex justify-center items-center cursor-pointer relative min-h-0 w-full h-full" title={tooltipContent['ccor1-video']}>{ccor1Video.loading && <LoadingSpinner message={ccor1Video.loading} />}{ccor1Video.url && !ccor1Video.loading ? (<video controls muted loop className="max-w-full max-h-full object-contain rounded-lg"><source src={ccor1Video.url} type="video/mp4" />Your browser does not support the video tag.</video>) : (!ccor1Video.loading && <p className="text-neutral-400 italic">Video not available.</p>)}</div>
                        </div>
                        <div className="col-span-12 card bg-neutral-950/80 p-4 h-[500px] flex flex-col">
                            <div className="flex justify-center items-center gap-2"><h2 className="text-xl font-semibold text-white mb-2">GOES Proton Flux ({'>'}=10 MeV)</h2><button onClick={() => openModal('proton-flux')} className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700" title="Information about Proton Flux.">?</button></div>
                            <TimeRangeButtons onSelect={setProtonTimeRange} selected={protonTimeRange} />
                            <div className="flex-grow relative mt-2" title={tooltipContent['proton-flux']}>{protonChartData.datasets[0]?.data.length > 0 ? <Line data={protonChartData} options={protonChartOptions} /> : <LoadingSpinner message={loadingProton} />}</div>
                            <div className="text-right text-xs text-neutral-500 mt-2">Last updated: {lastProtonUpdate || 'N/A'}</div>
                        </div>
                    </main>
                    <footer className="page-footer mt-10 pt-8 border-t border-neutral-700 text-center text-neutral-400 text-sm">
                        <h3 className="text-lg font-semibold text-neutral-200 mb-4">About This Dashboard</h3>
                        <p className="max-w-3xl mx-auto leading-relaxed">This dashboard provides real-time information on solar X-ray flux, proton flux, solar flares, and related space weather phenomena. Data is sourced directly from official NASA and NOAA APIs.</p>
                        <p className="max-w-3xl mx-auto leading-relaxed mt-4"><strong>Disclaimer:</strong> Solar activity can be highly unpredictable. While this dashboard provides the latest available data, interpretations are for informational purposes only.</p>
                        <div className="mt-8 text-xs text-neutral-500"><p>Data provided by <a href="https://www.swpc.noaa.gov/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">NOAA SWPC</a> & <a href="https://api.nasa.gov/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">NASA</a></p><p className="mt-2">Visualization and Development by TNR Protography</p></div>
                    </footer>
                 </div>
            </div>
            {/* Flare Modal */}
            <InfoModal
              isOpen={!!selectedFlare}
              onClose={() => setSelectedFlare(null)}
              title={`Flare Details: ${selectedFlare?.flrID || ''}`}
              content={
                selectedFlare && (
                  <div className="space-y-2">
                    <p><strong>Class:</strong> {selectedFlare.classType}</p>
                    <p><strong>Begin Time (NZT):</strong> {formatNZTimestamp(selectedFlare.beginTime)}</p>
                    <p><strong>Peak Time (NZT):</strong> {formatNZTimestamp(selectedFlare.peakTime)}</p>
                    <p><strong>End Time (NZT):</strong> {formatNZTimestamp(selectedFlare.endTime)}</p>
                    <p><strong>Source Location:</strong> {selectedFlare.sourceLocation}</p>
                    <p><strong>Active Region:</strong> {selectedFlare.activeRegionNum || 'N/A'}</p>
                    <p><strong>CME Associated:</strong> {selectedFlare.hasCME ? 'Yes' : 'No'}</p>
                    <p><a href={selectedFlare.link} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">View on NASA DONKI</a></p>
                    {selectedFlare.hasCME && (
                      <button
                        onClick={() => {
                          onViewCMEInVisualization(selectedFlare.linkedEvents.find((e: any) => e.activityID.includes('CME'))?.activityID);
                          setSelectedFlare(null);
                        }}
                        className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-semibold hover:bg-indigo-500 transition-colors"
                      >
                        View in CME Visualization
                      </button>
                    )}
                  </div>
                )
              }
            />

            {/* REMOVED: IPS Modal */}

            {modalState && (<InfoModal isOpen={modalState.isOpen} onClose={closeModal} title={modalState.title} content={modalState.content} />)}
        </div>
    );
};

export default SolarActivityDashboard;
// --- END OF FILE src/components/SolarActivityDashboard.tsx ---
