import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { ChartOptions, ScriptableContext } from 'chart.js';
import { enNZ } from 'date-fns/locale';
import CloseIcon from './icons/CloseIcon';
import LoadingSpinner from './icons/LoadingSpinner'; // Assuming this is imported for other loading states

interface SolarActivityDashboardProps {
  apiKey: string;
  setViewerMedia: (media: { url: string, type: 'image' | 'video' } | null) => void;
}

// --- CONSTANTS ---
const NOAA_XRAY_FLUX_URL = 'https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json';
const SUVI_131_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/131/latest.png';
const SUVI_304_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/304/latest.png';
const NASA_DONKI_BASE_URL = 'https://api.nasa.gov/DONKI/';
const NOAA_SOLAR_REGIONS_URL = 'https://services.swpc.noaa.gov/json/solar_regions.json';
const NOAA_PROTON_FLUX_URL = 'https://services.swpc.noaa.gov/json/goes/primary/integral-protons-plot-3-day.json'; // NEW
const REFRESH_INTERVAL_MS = 60 * 1000; // 1 minute

// NEW: Proton S-Scale thresholds and labels
const PROTON_THRESHOLDS = {
    S0: { min: 0.0, max: 10, rgb_var: '--proton-s0-rgb', label: 'S0' }, // Changed min to 0.0 for consistency
    S1: { min: 10.0, max: 100, rgb_var: '--proton-s1-rgb', label: 'S1' },
    S2: { min: 100.0, max: 1000, rgb_var: '--proton-s2-rgb', label: 'S2' },
    S3: { min: 1000.0, max: 10000, rgb_var: '--proton-s3-rgb', label: 'S3' },
    S4: { min: 10000.0, max: 100000, rgb_var: '--proton-s4-rgb', label: 'S4' },
    S5: { min: 100000.0, max: Infinity, rgb_var: '--proton-s5-rgb', label: 'S5' },
};

// --- HELPERS ---
// Modified getCssVar to return a fallback color string if the variable is not found or invalid
const getCssVar = (name: string, fallback: string = '128,128,128'): string => {
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  } catch (e) {
    return fallback;
  }
};

const getColorForFlux = (value: number, opacity: number = 1): string => {
    let rgb = getCssVar('--solar-flare-ab-rgb', '34, 197, 94'); // Default to Green
    if (value >= 5e-4) rgb = getCssVar('--solar-flare-x5plus-rgb', '255, 105, 180');
    else if (value >= 1e-4) rgb = getCssVar('--solar-flare-x-rgb', '147, 112, 219');
    else if (value >= 1e-5) rgb = getCssVar('--solar-flare-m-rgb', '255, 69, 0');
    else if (value >= 1e-6) rgb = getCssVar('--solar-flare-c-rgb', '245, 158, 11');
    return `rgba(${rgb}, ${opacity})`;
};

// NEW: Get color for proton flux based on S-scale
const getProtonColor = (flux: number, opacity: number = 1): string => {
    let rgb_var = PROTON_THRESHOLDS.S0.rgb_var; // Default to S0 (Green)
    if (flux >= PROTON_THRESHOLDS.S5.min) rgb_var = PROTON_THRESHOLDS.S5.rgb_var;
    else if (flux >= PROTON_THRESHOLDS.S4.min) rgb_var = PROTON_THRESHOLDS.S4.rgb_var;
    else if (flux >= PROTON_THRESHOLDS.S3.min) rgb_var = PROTON_THRESHOLDS.S3.rgb_var;
    else if (flux >= PROTON_THRESHOLDS.S2.min) rgb_var = PROTON_THRESHOLDS.S2.rgb_var;
    else if (flux >= PROTON_THRESHOLDS.S1.min) rgb_var = PROTON_THRESHOLDS.S1.rgb_var;
    
    return `rgba(${getCssVar(rgb_var, '34, 197, 94')}, ${opacity})`; // Default fallback for proton colors
};

const getColorForFlareClass = (classType: string): { background: string, text: string } => {
    const type = classType ? classType[0].toUpperCase() : 'U';
    const magnitude = parseFloat(classType.substring(1));

    if (type === 'X') {
        if (magnitude >= 5) {
            return { background: `rgba(${getCssVar('--solar-flare-x5plus-rgb', '255, 105, 180')}, 1)`, text: 'text-white' };
        }
        return { background: `rgba(${getCssVar('--solar-flare-x-rgb', '147, 112, 219')}, 1)`, text: 'text-white' };
    }
    if (type === 'M') {
        return { background: `rgba(${getCssVar('--solar-flare-m-rgb', '255, 69, 0')}, 1)`, text: 'text-white' };
    }
    if (type === 'C') {
        return { background: `rgba(${getCssVar('--solar-flare-c-rgb', '245, 158, 11')}, 1)`, text: 'text-black' };
    }
    return { background: `rgba(${getCssVar('--solar-flare-ab-rgb', '34, 197, 94')}, 1)`, text: 'text-white' };
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
                <button key={hours} onClick={() => onSelect(hours * 3600000)} className={`px-3 py-1 text-xs rounded transition-colors ${selected === hours * 3600000 ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>
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

const SolarActivityDashboard: React.FC<SolarActivityDashboardProps> = ({ apiKey, setViewerMedia }) => {
    const [suvi131, setSuvi131] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
    const [suvi304, setSuvi304] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
    const [allXrayData, setAllXrayData] = useState<any[]>([]);
    const [loadingXray, setLoadingXray] = useState<string | null>('Loading X-ray flux data...');
    const [xrayTimeRange, setXrayTimeRange] = useState<number>(2 * 60 * 60 * 1000);
    const [solarFlares, setSolarFlares] = useState<any[]>([]);
    const [loadingFlares, setLoadingFlares] = useState<string | null>('Loading solar flares...');
    const [sunspots, setSunspots] = useState<any[]>([]);
    const [loadingSunspots, setLoadingSunspots] = useState<string | null>('Loading active regions...');
    const [selectedFlare, setSelectedFlare] = useState<any | null>(null);

    // NEW: Proton Data States
    const [allProtonData, setAllProtonData] = useState<Record<string, { time: number; flux: number; }[]>>({});
    const [loadingProtons, setLoadingProtons] = useState<string | null>('Loading proton flux data...');
    const [protonTimeRange, setProtonTimeRange] = useState<number>(24 * 60 * 60 * 1000); // Default to 24 hours

    const fetchImage = useCallback(async (url: string, setState: React.Dispatch<React.SetStateAction<{url: string, loading: string | null}>>) => {
        setState({ url: '/placeholder.png', loading: 'Loading image...' });
        try {
            const res = await fetch(`${url}?_=${new Date().getTime()}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            const objectURL = URL.createObjectURL(blob);
            setState({ url: objectURL, loading: null });
        } catch (error) {
            console.error(`Error fetching ${url}:`, error);
            setState({ url: '/error.png', loading: 'Image failed to load.' });
        }
    }, []);

    const fetchXrayFlux = useCallback(async () => {
        setLoadingXray('Loading X-ray flux data...');
        try {
            const res = await fetch(`${NOAA_XRAY_FLUX_URL}?_=${new Date().getTime()}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const rawData = await res.json();
            const groupedData = new Map();
            rawData.forEach((d: any) => {
                const time = new Date(d.time_tag).getTime();
                if (!groupedData.has(time)) groupedData.set(time, { time, short: null });
                if (d.energy === "0.1-0.8nm") groupedData.get(time).short = parseFloat(d.flux);
            });
            const processedData = Array.from(groupedData.values()).filter(d => d.short !== null && !isNaN(d.short)).sort((a,b) => a.time - b.time);
            if (!processedData.length) throw new Error('No valid X-ray data.');
            setAllXrayData(processedData);
            setLoadingXray(null);
        } catch (e: any) {
            console.error('Error fetching X-ray flux:', e);
            setLoadingXray(`Error: ${e.message}`);
            setAllXrayData([]); // Clear previous data on error
        }
    }, []);
    
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
        } catch (error: any) {
            console.error('Error fetching flares:', error);
            setLoadingFlares(`Error: ${error.message}`);
            setSolarFlares([]); // Clear previous data on error
        }
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
        } catch (error: any) {
            console.error('Error fetching sunspots:', error);
            setLoadingSunspots(`Error: ${error.message}`);
            setSunspots([]); // Clear previous data on error
        }
    }, []);

    // NEW: Fetch Proton Data
    const fetchProtonData = useCallback(async () => {
        setLoadingProtons('Loading proton flux data...');
        try {
            const response = await fetch(`${NOAA_PROTON_FLUX_URL}?_=${new Date().getTime()}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const rawData = await response.json();

            const groupedData: Record<string, { time: number; flux: number; }[]> = {};
            rawData.forEach((d: any) => {
                const energy = d.energy;
                const time = new Date(d.time_tag).getTime();
                const flux = parseFloat(d.flux);

                // Filter out invalid or placeholder flux values (-1.00e+05 or less)
                if (isNaN(flux) || flux < -1e4) { // NOAA uses -1.00e+05 for missing data
                    return; 
                }

                if (!groupedData[energy]) {
                    groupedData[energy] = [];
                }
                groupedData[energy].push({ time, flux });
            });

            // Sort data points by time for each energy channel
            Object.keys(groupedData).forEach(energy => {
                groupedData[energy].sort((a, b) => a.time - b.time);
            });

            setAllProtonData(groupedData);
            setLoadingProtons(null);
        } catch (e: any) {
            console.error('Error fetching proton flux:', e);
            setLoadingProtons(`Error: ${e.message}`);
            setAllProtonData({}); // Clear previous data on error
        }
    }, []);

    useEffect(() => {
        const runAllUpdates = () => {
            fetchImage(SUVI_131_URL, setSuvi131);
            fetchImage(SUVI_304_URL, setSuvi304);
            fetchXrayFlux();
            fetchFlares();
            fetchSunspots();
            fetchProtonData(); // NEW: Fetch proton data
        };
        runAllUpdates(); // Initial fetch
        const interval = setInterval(runAllUpdates, REFRESH_INTERVAL_MS); // Refresh every minute
        return () => clearInterval(interval); // Cleanup on unmount
    }, [fetchImage, fetchXrayFlux, fetchFlares, fetchSunspots, fetchProtonData]);

    const xrayChartOptions = useMemo((): ChartOptions<'line'> => {
        const now = Date.now();
        const startTime = now - xrayTimeRange;
        
        const midnightAnnotations: any = {};
        // NZ is UTC+12, so local midnight is 12:00 UTC of the next day.
        // We want to find midnight *in NZ local time* and plot a line there.
        // Get the current date in NZT, then find its midnight, then convert back to UTC timestamp.
        const currentNZDate = new Date(); // Gets current time in local timezone of browser
        const nzOffsetHours = -currentNZDate.getTimezoneOffset() / 60 + 12; // Calculate difference from UTC to NZST/NZDT (12 or 13)
        
        const startOfNZDayUTC = new Date(currentNZDate.getFullYear(), currentNZDate.getMonth(), currentNZDate.getDate(), 0, 0, 0).getTime() - (nzOffsetHours * 3600000);

        for (let d = startOfNZDayUTC; d < now + (24 * 3600000); d += (24 * 3600000)) {
            if (d > startTime && d < now + (24 * 3600000)) { // Ensure within extended range for labels
                midnightAnnotations[`midnight-${d}`] = { 
                    type: 'line', xMin: d, xMax: d, 
                    borderColor: 'rgba(156, 163, 175, 0.5)', borderWidth: 1, borderDash: [5, 5], 
                    label: { 
                        content: new Date(d).toLocaleDateString('en-NZ', { day: '2-digit', month: 'short' }), // Just date for midnight
                        display: true, position: 'start', color: 'rgba(156, 163, 175, 0.7)', font: { size: 10 },
                        xAdjust: 0, yAdjust: 0,
                    } 
                };
            }
        }
        
        return {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: any) => `Flux: ${c.parsed.y.toExponential(2)} (${c.parsed.y >= 1e-4 ? 'X' : c.parsed.y >= 1e-5 ? 'M' : c.parsed.y >= 1e-6 ? 'C' : c.parsed.y >= 1e-7 ? 'B' : 'A'}-class)` } }, annotation: { annotations: midnightAnnotations } },
            scales: { x: { type: 'time', adapters: { date: { locale: enNZ } }, time: { unit: 'hour', tooltipFormat: 'HH:mm', displayFormats: { hour: 'HH:mm' } }, min: startTime, max: now, ticks: { color: '#71717a', source: 'auto' }, grid: { color: '#3f3f46' } }, y: { type: 'logarithmic', min: 1e-9, max: 1e-3, ticks: { color: '#71717a', callback: (v: any) => { if(v===1e-4) return 'X'; if(v===1e-5) return 'M'; if(v===1e-6) return 'C'; if(v===1e-7) return 'B'; if(v===1e-8) return 'A'; return null; } }, grid: { color: '#3f3f46' } } }
        };
    }, [xrayTimeRange]);
    
    const xrayChartData = useMemo(() => {
        if (allXrayData.length === 0) return { datasets: [] };
        return {
            datasets: [{
                label: 'Short Flux (0.1-0.8 nm)', 
                data: allXrayData.map(d => ({x: d.time, y: d.short})),
                pointRadius: 0, tension: 0.1, spanGaps: true, fill: 'origin', borderWidth: 2,
                segment: { borderColor: (ctx: any) => getColorForFlux(ctx.p1.parsed.y, 1), backgroundColor: (ctx: any) => {
                    const chart = ctx.chart;
                    const { ctx: chartCtx, chartArea } = chart;
                    if (!chartArea) return undefined;
                    const gradient = chartCtx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
                    // Safely access p0 and p1 parsed values for color, provide defaults if needed
                    const flux0 = ctx.p0?.parsed?.y ?? 1e-9; 
                    const flux1 = ctx.p1?.parsed?.y ?? 1e-9;
                    gradient.addColorStop(0, getColorForFlux(flux0, 0.1)); // Adjusted to p0 for gradient start
                    gradient.addColorStop(1, getColorForFlux(flux1, 0.4)); // Adjusted to p1 for gradient end
                    return gradient;
                }},
            }],
        };
    }, [allXrayData]);

    // NEW: Proton Chart Options
    const protonChartOptions = useMemo((): ChartOptions<'line'> => {
        const now = Date.now();
        const startTime = now - protonTimeRange;

        // Define S-level annotations
        const sLevelAnnotations: any = {};
        Object.values(PROTON_THRESHOLDS).forEach((threshold) => {
            if (threshold.min !== 0.0 && threshold.min !== Infinity) { // Skip S0 min (0) and Infinity
                 sLevelAnnotations[`s-level-${threshold.label}`] = {
                    type: 'line',
                    yMin: threshold.min,
                    yMax: threshold.min,
                    borderColor: getProtonColor(threshold.min, 0.6), // Use flux value for color
                    borderWidth: 1,
                    borderDash: [6, 4],
                    label: {
                        content: threshold.label,
                        display: true,
                        position: 'start',
                        color: getProtonColor(threshold.min, 1), // Use flux value for color
                        font: { size: 10, weight: 'bold' },
                        xAdjust: 10,
                        yAdjust: -5,
                    }
                };
            }
        });

        return {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { color: '#a1a1aa' }},
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: (context) => {
                            let label = context.dataset.label || '';
                            if (label) { label += ': '; }
                            if (context.parsed.y !== null) { label += context.parsed.y.toExponential(2); }
                            if (context.dataset.label === '>=10 MeV') {
                                const flux = context.parsed.y;
                                let sClass = 'S0';
                                if (flux >= PROTON_THRESHOLDS.S5.min) sClass = 'S5';
                                else if (flux >= PROTON_THRESHOLDS.S4.min) sClass = 'S4';
                                else if (flux >= PROTON_THRESHOLDS.S3.min) sClass = 'S3';
                                else if (flux >= PROTON_THRESHOLDS.S2.min) sClass = 'S2';
                                else if (flux >= PROTON_THRESHOLDS.S1.min) sClass = 'S1';
                                label += ` (${sClass})`;
                            }
                            return label;
                        }
                    }
                },
                annotation: {
                    annotations: sLevelAnnotations
                }
            },
            scales: {
                x: {
                    type: 'time',
                    adapters: { date: { locale: enNZ } },
                    time: { unit: 'hour', tooltipFormat: 'HH:mm', displayFormats: { hour: 'HH:mm' } },
                    min: startTime,
                    max: now,
                    ticks: { color: '#71717a', source: 'auto' },
                    grid: { color: '#3f3f46' }
                },
                y: {
                    type: 'logarithmic',
                    min: 0.1, // Minimum flux for S0
                    max: 200000, // Slightly above S5 (10^5) for better top padding
                    ticks: {
                        color: '#71717a',
                        callback: (value: any) => {
                            // Only label major S-levels that align with powers of 10
                            if (value === PROTON_THRESHOLDS.S1.min) return 'S1';
                            if (value === PROTON_THRESHOLDS.S2.min) return 'S2';
                            if (value === PROTON_THRESHOLDS.S3.min) return 'S3';
                            if (value === PROTON_THRESHOLDS.S4.min) return 'S4';
                            if (value === PROTON_THRESHOLDS.S5.min) return 'S5';
                            // Custom label for the very bottom of the graph to indicate S0
                            if (value === 0.1) return 'S0'; 
                            return null;
                        }
                    },
                    grid: { color: '#3f3f46' },
                    title: { display: true, text: 'Flux (p/cm²/s/sr)', color: '#a3a3a3' }
                }
            }
        };
    }, [protonTimeRange]);

    // NEW: Proton Chart Data
    const protonChartData = useMemo(() => {
        if (Object.keys(allProtonData).length === 0) return { datasets: [] };

        const datasets = [];
        const energyLevels = ['>=10 MeV', '>=50 MeV', '>=100 MeV', '>=500 MeV']; // Consistent order for plotting

        energyLevels.forEach((energy) => {
            // Safely get dataPoints, default to empty array if undefined/null
            const dataPoints = allProtonData[energy] || []; 
            if (dataPoints.length === 0) return;

            if (energy === '>=10 MeV') {
                datasets.push({
                    label: energy,
                    data: dataPoints.map(d => ({ x: d.time, y: d.flux })),
                    borderColor: (ctx: ScriptableContext<'line'>) => {
                         // Safely get flux for color, defaulting to S0 min if data is not available
                         const flux = ctx.p1?.parsed?.y ?? PROTON_THRESHOLDS.S0.min;
                         return getProtonColor(flux, 1);
                    },
                    backgroundColor: (ctx: ScriptableContext<'line'>) => {
                        const chart = ctx.chart;
                        const { ctx: chartCtx, chartArea } = chart;
                        // Ensure chartArea is available before creating gradient
                        if (!chartArea) return undefined;
                        const gradient = chartCtx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
                        // Safely access p0 and p1 parsed values for color, provide defaults if needed
                        const flux0 = ctx.p0?.parsed?.y ?? PROTON_THRESHOLDS.S0.min; 
                        const flux1 = ctx.p1?.parsed?.y ?? PROTON_THRESHOLDS.S0.min;
                        gradient.addColorStop(0, getProtonColor(flux0, 0.1));
                        gradient.addColorStop(1, getProtonColor(flux1, 0.4));
                        return gradient;
                    },
                    fill: 'origin',
                    tension: 0.1,
                    pointRadius: 0,
                    borderWidth: 2,
                    spanGaps: true,
                });
            } else {
                datasets.push({
                    label: energy,
                    data: dataPoints.map(d => ({ x: d.time, y: d.flux })),
                    // Fixed colors for other lines
                    borderColor: energy === '>=50 MeV' ? 'rgba(100, 149, 237, 0.8)' : // CornflowerBlue
                                 energy === '>=100 MeV' ? 'rgba(152, 251, 152, 0.8)' : // PaleGreen
                                 'rgba(255, 192, 203, 0.8)', // Pink (for 500 MeV)
                    borderWidth: 1, // Thin line
                    fill: false,
                    tension: 0.1,
                    pointRadius: 0,
                    spanGaps: true,
                });
            }
        });
        return { datasets };
    }, [allProtonData]);


    return (
        <div className="w-full h-full overflow-y-auto bg-neutral-900 text-neutral-300 p-5">
            <style>{`
                /* Ensure CSS variables for solar flare and proton colors are defined here for direct access by Chart.js */
                /* This block can typically be moved to a global CSS file (e.g., index.css or App.css) if you have one, 
                   to avoid inline <style> tags and ensure variables are loaded early.
                   However, for self-contained component updates, keeping it here ensures all context is provided. */
                :root { 
                    --solar-flare-ab-rgb: ${getCssVar('--solar-flare-ab-rgb', '34, 197, 94')};
                    --solar-flare-c-rgb: ${getCssVar('--solar-flare-c-rgb', '245, 158, 11')};
                    --solar-flare-m-rgb: ${getCssVar('--solar-flare-m-rgb', '255, 69, 0')};
                    --solar-flare-x-rgb: ${getCssVar('--solar-flare-x-rgb', '147, 112, 219')};
                    --solar-flare-x5plus-rgb: ${getCssVar('--solar-flare-x5plus-rgb', '255, 105, 180')};
                    
                    --proton-s0-rgb: ${getCssVar('--proton-s0-rgb', '34, 197, 94')};
                    --proton-s1-rgb: ${getCssVar('--proton-s1-rgb', '255, 215, 0')};
                    --proton-s2-rgb: ${getCssVar('--proton-s2-rgb', '255, 165, 0')};
                    --proton-s3-rgb: ${getCssVar('--proton-s3-rgb', '255, 69, 0')};
                    --proton-s4-rgb: ${getCssVar('--proton-s4-rgb', '128, 0, 128')};
                    --proton-s5-rgb: ${getCssVar('--proton-s5-rgb', '255, 20, 147')};
                }
                body { overflow-y: auto !important; } /* This might be better handled globally or moved to index.css if exists */
                .styled-scrollbar::-webkit-scrollbar { width: 8px; }
                .styled-scrollbar::-webkit-scrollbar-track { background: #262626; border-radius: 10px; }
                .styled-scrollbar::-webkit-scrollbar-thumb { background: #525252; border-radius: 10px; }
            `}</style>
            <div className="container mx-auto">
                <header className="text-center mb-8">
                    <a href="https://www.tnrprotography.co.nz" target="_blank" rel="noopener noreferrer"><img src="https://www.tnrprotography.co.nz/uploads/1/3/6/6/136682089/white-tnr-protography-w_orig.png" alt="TNR Protography Logo" className="mx-auto w-full max-w-[250px] mb-4"/></a>
                    <h1 className="text-3xl font-bold text-neutral-100">Solar Activity Dashboard</h1>
                </header>
                <main className="grid grid-cols-12 gap-5">
                    <div className="col-span-12 lg:col-span-6 card bg-neutral-950/80 p-4 h-[450px] flex flex-col">
                        <h2 className="text-xl font-semibold text-center text-white mb-2 flex-shrink-0">SUVI 131Å</h2>
                        <div onClick={() => suvi131.url !== '/placeholder.png' && suvi131.url !== '/error.png' && setViewerMedia({ url: suvi131.url, type: 'image' })} className="flex-grow flex justify-center items-center cursor-pointer relative min-h-0">
                            <img src={suvi131.url} alt="SUVI 131Å" className="max-w-full max-h-full object-contain rounded-lg"/>
                            {suvi131.loading && <p className="absolute text-neutral-400 italic">{suvi131.loading}</p>}
                        </div>
                    </div>
                    <div className="col-span-12 lg:col-span-6 card bg-neutral-950/80 p-4 h-[450px] flex flex-col">
                        <h2 className="text-xl font-semibold text-center text-white mb-2 flex-shrink-0">SUVI 304Å</h2>
                        <div onClick={() => suvi304.url !== '/placeholder.png' && suvi304.url !== '/error.png' && setViewerMedia({ url: suvi304.url, type: 'image' })} className="flex-grow flex justify-center items-center cursor-pointer relative min-h-0">
                            <img src={suvi304.url} alt="SUVI 304Å" className="max-w-full max-h-full object-contain rounded-lg"/>
                            {suvi304.loading && <p className="absolute text-neutral-400 italic">{suvi304.loading}</p>}
                        </div>
                    </div>
                    <div className="col-span-12 card bg-neutral-950/80 p-4 h-[500px] flex flex-col">
                        <h2 className="text-xl font-semibold text-white mb-2">GOES X-ray Flux</h2>
                        <TimeRangeButtons onSelect={setXrayTimeRange} selected={xrayTimeRange} />
                        <div className="flex-grow relative mt-2">
                            {xrayChartData.datasets[0]?.data.length > 0 ? <Line data={xrayChartData} options={xrayChartOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">{loadingXray}</p>}
                        </div>
                    </div>
                    <div className="col-span-12 lg:col-span-6 card bg-neutral-950/80 p-4 flex flex-col min-h-[400px]">
                        <h2 className="text-xl font-semibold text-white text-center mb-4">Latest Solar Flares (24 Hrs)</h2>
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
                        <h2 className="text-xl font-semibold text-white text-center mb-4">Active Regions</h2>
                        <ul className="space-y-2 overflow-y-auto max-h-96 styled-scrollbar pr-2">
                           {loadingSunspots ? <li className="text-center text-neutral-400 italic">{loadingSunspots}</li> : sunspots.length > 0 ? sunspots.map((spot) => <li key={spot.region} className="bg-neutral-800 p-2 rounded text-sm"><strong>Region {spot.region}</strong> ({spot.location}) - Mag Class: {spot.mag_class}</li>) : <li className="text-center text-neutral-400 italic">No Earth-facing regions found.</li>}
                        </ul>
                    </div>
                    {/* NEW: Proton Flux Graph */}
                    <div className="col-span-12 card bg-neutral-950/80 p-4 h-[500px] flex flex-col">
                        <h2 className="text-xl font-semibold text-white mb-2">GOES Proton Flux</h2>
                        <TimeRangeButtons onSelect={setProtonTimeRange} selected={protonTimeRange} />
                        <div className="flex-grow relative mt-2">
                            {protonChartData.datasets.length > 0 ? <Line data={protonChartData} options={protonChartOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">{loadingProtons}</p>}
                        </div>
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
            </div>
            
            <InfoModal
                isOpen={!!selectedFlare}
                onClose={() => setSelectedFlare(null)}
                title={`Flare Details: ${selectedFlare?.flareID || ''}`}
                content={ selectedFlare && ( <div className="space-y-2"> <p><strong>Class:</strong> {selectedFlare.classType}</p> <p><strong>Begin Time (NZT):</strong> {formatNZTimestamp(selectedFlare.beginTime)}</p> <p><strong>Peak Time (NZT):</strong> {formatNZTimestamp(selectedFlare.peakTime)}</p> <p><strong>End Time (NZT):</strong> {formatNZTimestamp(selectedFlare.endTime)}</p> <p><strong>Source Location:</strong> {selectedFlare.sourceLocation}</p> <p><strong>Active Region:</strong> {selectedFlare.activeRegionNum || 'N/A'}</p> <p><strong>CME Associated:</strong> {selectedFlare.hasCME ? 'Yes' : 'No'}</p> <p><a href={selectedFlare.link} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">View on NASA DONKI</a></p> </div> )}
            />
        </div>
    );
};

export default SolarActivityDashboard;