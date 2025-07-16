import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { ChartOptions } from 'chart.js';
import { enNZ } from 'date-fns/locale';
import CloseIcon from './icons/CloseIcon';

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

    const fetchXrayFlux = useCallback(() => {
        setLoadingXray('Loading X-ray flux data...');
        fetch(`${NOAA_XRAY_FLUX_URL}?_=${new Date().getTime()}`).then(res => res.ok ? res.json() : Promise.reject(`HTTP ${res.status}`))
            .then(rawData => {
                const groupedData = new Map();
                rawData.forEach((d: any) => { const time = new Date(d.time_tag).getTime(); if (!groupedData.has(time)) groupedData.set(time, { time, short: null }); if (d.energy === "0.1-0.8nm") groupedData.get(time).short = parseFloat(d.flux); });
                const processedData = Array.from(groupedData.values()).filter(d => d.short !== null && !isNaN(d.short)).sort((a,b) => a.time - b.time);
                if (!processedData.length) throw new Error('No valid X-ray data.');
                setAllXrayData(processedData);
                setLoadingXray(null);
            }).catch(e => { console.error('Error fetching X-ray flux:', e); setLoadingXray(`Error: ${e.message}`); });
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

    useEffect(() => {
        const runAllUpdates = () => {
            fetchImage(SUVI_131_URL, setSuvi131);
            fetchImage(SUVI_304_URL, setSuvi304);
            fetchXrayFlux();
            fetchFlares();
            fetchSunspots();
        };
        runAllUpdates(); // Initial fetch
        const interval = setInterval(runAllUpdates, REFRESH_INTERVAL_MS); // Refresh every minute
        return () => clearInterval(interval); // Cleanup on unmount
    }, [fetchImage, fetchXrayFlux, fetchFlares, fetchSunspots]);

    const xrayChartOptions = useMemo((): ChartOptions<'line'> => {
        const now = Date.now();
        const startTime = now - xrayTimeRange;
        
        const midnightAnnotations: any = {};
        const nzOffset = 12 * 3600000;
        const startDayNZ = new Date(startTime - nzOffset).setUTCHours(0,0,0,0) + nzOffset;
        for (let d = startDayNZ; d < now + 24 * 3600000; d += 24 * 3600000) {
            const midnight = new Date(d).setUTCHours(12,0,0,0);
            if (midnight > startTime && midnight < now) {
                midnightAnnotations[`midnight-${midnight}`] = { type: 'line', xMin: midnight, xMax: midnight, borderColor: 'rgba(156, 163, 175, 0.5)', borderWidth: 1, borderDash: [5, 5], label: { content: 'Midnight', display: true, position: 'start', color: 'rgba(156, 163, 175, 0.7)', font: { size: 10 } } };
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
                segment: { borderColor: (ctx: any) => getColorForFlux(ctx.p1.parsed.y, 1), backgroundColor: (ctx: any) => getColorForFlux(ctx.p1.parsed.y, 0.2), }
            }],
        };
    }, [allXrayData]);
    
    return (
        <div
            className="w-full h-full overflow-y-auto bg-neutral-900 text-neutral-300 p-5 relative"
            style={{
                backgroundImage: `url('/background-solar.jpg')`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundAttachment: 'fixed',
            }}
        >
            <div className="absolute inset-0 bg-black/50 z-0"></div>
            <style>{`body { overflow-y: auto !important; } .styled-scrollbar::-webkit-scrollbar { width: 8px; } .styled-scrollbar::-webkit-scrollbar-track { background: #262626; } .styled-scrollbar::-webkit-scrollbar-thumb { background: #525252; }`}</style>
            <div className="container mx-auto relative z-10">
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