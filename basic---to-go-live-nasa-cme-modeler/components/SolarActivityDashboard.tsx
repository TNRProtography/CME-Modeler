import React, { useState, useEffect, useCallback } from 'react';
import { Line } from 'react-chartjs-2';
import { ChartOptions } from 'chart.js';

interface SolarActivityDashboardProps {
  apiKey: string;
  setViewerMedia: (media: { url: string, type: 'image' | 'video' } | null) => void;
}

const NOAA_XRAY_FLUX_URL = 'https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json';
const SUVI_131_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/131/latest.png';
const SUVI_304_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/304/latest.png';
const NASA_DONKI_BASE_URL = 'https://api.nasa.gov/DONKI/';
const NOAA_SOLAR_REGIONS_URL = 'https://services.swpc.noaa.gov/json/solar_regions.json';

const getCssVar = (name: string): string => {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  catch(e) { return '' }
};

const getColorForFlux = (value: number, opacity: number = 1): string => {
    let rgb = getCssVar('--solar-flare-ab-rgb') || '34, 197, 94';
    if (value >= 5e-4) rgb = getCssVar('--solar-flare-x5plus-rgb') || '147, 112, 219';
    else if (value >= 1e-4) rgb = getCssVar('--solar-flare-x-rgb') || '239, 68, 68';
    else if (value >= 1e-5) rgb = getCssVar('--solar-flare-m-rgb') || '255, 69, 0';
    else if (value >= 1e-6) rgb = getCssVar('--solar-flare-c-rgb') || '245, 158, 11';
    return `rgba(${rgb}, ${opacity})`;
};

const formatTimestamp = (isoString: string) => {
    try { const d = new Date(isoString); return isNaN(d.getTime()) ? "Invalid Date" : d.toLocaleString(); } catch { return "Invalid Date"; }
};

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

const SolarActivityDashboard: React.FC<SolarActivityDashboardProps> = ({ apiKey, setViewerMedia }) => {
    const [suvi131, setSuvi131] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
    const [suvi304, setSuvi304] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
    const [allXrayData, setAllXrayData] = useState<any[]>([]);
    const [xrayChartData, setXrayChartData] = useState<any>({ labels: [], datasets: [] });
    const [loadingXray, setLoadingXray] = useState<string | null>('Loading X-ray flux data...');
    const [xrayTimeRange, setXrayTimeRange] = useState<number>(2 * 60 * 60 * 1000);
    const [solarFlares, setSolarFlares] = useState<any[]>([]);
    const [loadingFlares, setLoadingFlares] = useState<string | null>('Loading solar flares...');
    const [sunspots, setSunspots] = useState<any[]>([]);
    const [loadingSunspots, setLoadingSunspots] = useState<string | null>('Loading active regions...');

    const fetchImage = useCallback(async (url: string, setState: React.Dispatch<React.SetStateAction<{url: string, loading: string | null}>>) => {
        setState({ url: '/placeholder.png', loading: 'Loading image...' });
        try {
            const preloader = new Image();
            preloader.src = url;
            await new Promise((resolve, reject) => { preloader.onload = resolve; preloader.onerror = reject; });
            setState({ url: url, loading: null });
        } catch (error) {
            console.error(`Error fetching ${url}:`, error);
            setState({ url: '/error.png', loading: 'Image failed to load.' });
        }
    }, []);

    const fetchXrayFlux = useCallback(() => {
        setLoadingXray('Loading X-ray flux data...');
        fetch(NOAA_XRAY_FLUX_URL).then(res => res.ok ? res.json() : Promise.reject(`HTTP ${res.status}`))
            .then(rawData => {
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
            }).catch(e => { console.error('Error fetching X-ray flux:', e); setLoadingXray(`Error: ${e.message}`); });
    }, []);
    
    useEffect(() => {
        if (allXrayData.length > 0) {
            const now = Date.now();
            const startTime = now - xrayTimeRange;
            const filteredData = allXrayData.filter(d => d.time >= startTime);
            
            const midnightAnnotations: any = {};
            const uniqueDays = [...new Set(filteredData.map(d => new Date(d.time).setUTCHours(0,0,0,0)))];
            uniqueDays.forEach((day, index) => {
                const midnight = new Date(day).setUTCHours(24,0,0,0);
                if (midnight > startTime && midnight < now) {
                    midnightAnnotations[`line-${index}`] = {
                        type: 'line', xMin: midnight, xMax: midnight,
                        borderColor: 'rgba(156, 163, 175, 0.5)', borderWidth: 1, borderDash: [5, 5],
                        label: { content: 'Midnight UTC', display: true, position: 'start', color: 'rgba(156, 163, 175, 0.7)', font: { size: 10 } }
                    };
                }
            });

            setXrayChartData({
                labels: filteredData.map(d => d.time),
                datasets: [{
                    label: 'Short Flux (0.1-0.8 nm)', data: filteredData.map(d => d.short),
                    pointRadius: 0, tension: 0.1, spanGaps: true, fill: 'origin', borderWidth: 2,
                    segment: {
                        borderColor: (ctx: any) => getColorForFlux(ctx.p1.parsed.y, 1),
                        backgroundColor: (ctx: any) => getColorForFlux(ctx.p1.parsed.y, 0.2),
                    }
                }],
                annotations: midnightAnnotations
            });
        }
    }, [allXrayData, xrayTimeRange]);

    const fetchFlares = useCallback(async () => {
        setLoadingFlares('Loading solar flares...');
        const { startDate, endDate } = { startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], endDate: new Date().toISOString().split('T')[0] };
        try {
            const response = await fetch(`${NASA_DONKI_BASE_URL}FLR?startDate=${startDate}&endDate=${endDate}&api_key=${apiKey}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (!data || data.length === 0) { setLoadingFlares('No solar flares reported recently.'); return; }
            setSolarFlares(data.sort((a: any, b: any) => new Date(b.peakTime).getTime() - new Date(a.peakTime).getTime()));
            setLoadingFlares(null);
        } catch (error) { console.error('Error fetching flares:', error); setLoadingFlares(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`); }
    }, [apiKey]);

    const fetchSunspots = useCallback(async () => {
        setLoadingSunspots('Loading active regions...');
        try {
            const response = await fetch(NOAA_SOLAR_REGIONS_URL);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
            const earthFacingRegions = data.filter((region: any) => new Date(region.observed_date) >= twoWeeksAgo && Math.abs(parseFloat(region.longitude)) <= 90);
            if (earthFacingRegions.length === 0) { setLoadingSunspots('No Earth-facing active regions found.'); return; }
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
        runAllUpdates();
        const interval = setInterval(runAllUpdates, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, [fetchImage, fetchXrayFlux, fetchFlares, fetchSunspots]);

    const xrayChartOptions: ChartOptions<'line'> = {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: any) => {
            let fluxClass = '';
            if (c.parsed.y >= 1e-4) fluxClass = 'X'; else if (c.parsed.y >= 1e-5) fluxClass = 'M'; else if (c.parsed.y >= 1e-6) fluxClass = 'C'; else if (c.parsed.y >= 1e-7) return 'B'; else fluxClass = 'A';
            return `Flux: ${c.parsed.y.toExponential(2)} (${fluxClass}-class)`;
        }}}, annotation: { annotations: (xrayChartData as any)?.annotations || {} } },
        scales: { 
            x: { type: 'time', time: { unit: 'hour', tooltipFormat: 'HH:mm', displayFormats: { hour: 'HH:mm' } }, ticks: { color: '#71717a', source: 'auto' }, grid: { color: '#3f3f46' } },
            y: { type: 'logarithmic', min: 1e-9, max: 1e-3, ticks: { color: '#71717a', callback: (v: any) => { if(v===1e-4) return 'X'; if(v===1e-5) return 'M'; if(v===1e-6) return 'C'; if(v===1e-7) return 'B'; if(v===1e-8) return 'A'; return null; } }, grid: { color: '#3f3f46' } } 
        }
    };
    
    return (
        <div className="w-full h-full overflow-y-auto bg-neutral-900 text-neutral-300 p-5">
            <style>{`:root { --solar-flare-ab-rgb: 34, 197, 94; --solar-flare-c-rgb: 245, 158, 11; --solar-flare-m-rgb: 255, 69, 0; --solar-flare-x-rgb: 239, 68, 68; --solar-flare-x5plus-rgb: 147, 112, 219; } body { overflow-y: auto !important; } .styled-scrollbar::-webkit-scrollbar { width: 8px; } .styled-scrollbar::-webkit-scrollbar-track { background: #262626; } .styled-scrollbar::-webkit-scrollbar-thumb { background: #525252; }`}</style>
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
                            {xrayChartData.labels.length > 0 ? <Line data={xrayChartData} options={xrayChartOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">{loadingXray}</p>}
                        </div>
                    </div>
                    <div className="col-span-12 lg:col-span-6 card bg-neutral-950/80 p-4 flex flex-col min-h-[400px]">
                        <h2 className="text-xl font-semibold text-white text-center mb-4">Latest Solar Flares</h2>
                        <ul className="space-y-2 overflow-y-auto max-h-96 styled-scrollbar pr-2">
                            {loadingFlares ? <li className="text-center text-neutral-400 italic">{loadingFlares}</li> : solarFlares.length > 0 ? solarFlares.map((flare) => <li key={flare.flareID} className="bg-neutral-800 p-2 rounded text-sm"><strong className={`px-2 py-0.5 rounded text-black class-${flare.classType[0]}`}>{flare.classType}</strong> at {formatTimestamp(flare.peakTime)}</li>) : <li className="text-center text-neutral-400 italic">No recent flares found.</li>}
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
        </div>
    );
};

export default SolarActivityDashboard;