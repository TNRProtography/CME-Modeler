import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import CloseIcon from './icons/CloseIcon';
import { ChartOptions, ScriptableContext } from 'chart.js';
import { enNZ } from 'date-fns/locale';
import LoadingSpinner from './icons/LoadingSpinner';

// --- Type Definitions ---
interface ForecastDashboardProps {
  setViewerMedia?: (media: { url: string, type: 'image' | 'video' } | null) => void;
}
interface InfoModalProps { isOpen: boolean; onClose: () => void; title: string; content: string; }

// --- Constants ---
const FORECAST_API_URL = 'https://spottheaurora.thenamesrock.workers.dev/';
const NOAA_PLASMA_URL = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json';
const NOAA_MAG_URL = 'https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json';
const ACE_EPAM_URL = 'https://services.swpc.noaa.gov/images/ace-epam-24-hour.gif';

const GAUGE_THRESHOLDS = {
  speed: { gray: 250, yellow: 350, orange: 500, red: 650, purple: 800 },
  density: { gray: 5, yellow: 10, orange: 15, red: 20, purple: 50 },
  power: { gray: 20, yellow: 40, orange: 70, red: 150, purple: 200 },
  bt: { gray: 5, yellow: 10, orange: 15, red: 20, purple: 50 },
  bz: { gray: -5, yellow: -10, orange: -15, red: -20, purple: -50 }
};

const GAUGE_COLORS = {
    gray: { solid: 'rgb(128, 128, 128)', semi: 'rgba(128, 128, 128, 0.5)', trans: 'rgba(128, 128, 128, 0)' },
    yellow: { solid: 'rgb(255, 215, 0)', semi: 'rgba(255, 215, 0, 0.5)', trans: 'rgba(255, 215, 0, 0)' },
    orange: { solid: 'rgb(255, 165, 0)', semi: 'rgba(255, 165, 0, 0.5)', trans: 'rgba(255, 165, 0, 0)' },
    red: { solid: 'rgb(255, 69, 0)', semi: 'rgba(255, 69, 0, 0.5)', trans: 'rgba(255, 69, 0, 0)' },
    purple: { solid: 'rgb(128, 0, 128)', semi: 'rgba(128, 0, 128, 0.5)', trans: 'rgba(128, 0, 128, 0)' },
    pink: { solid: 'rgb(255, 20, 147)', semi: 'rgba(255, 20, 147, 0.5)', trans: 'rgba(255, 20, 147, 0)' }
};

const GAUGE_EMOJIS = { gray: '😐', yellow: '🙂', orange: '😊', red: '😀', purple: '😍', pink: '🤩', error: '❓' };

// --- Helper functions for dynamic graph colors ---
const getPositiveScaleColorKey = (value: number, thresholds: { [key: string]: number }) => {
    if (value >= thresholds.purple) return 'purple';
    if (value >= thresholds.red) return 'red';
    if (value >= thresholds.orange) return 'orange';
    if (value >= thresholds.yellow) return 'yellow';
    return 'gray';
};

const getBzScaleColorKey = (value: number, thresholds: { [key: string]: number }) => {
    if (value <= thresholds.purple) return 'purple';
    if (value <= thresholds.red) return 'red';
    if (value <= thresholds.orange) return 'orange';
    if (value <= thresholds.yellow) return 'yellow';
    return 'gray';
};

const createGradient = (ctx: CanvasRenderingContext2D, chartArea: any, colorKey: keyof typeof GAUGE_COLORS) => {
    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    gradient.addColorStop(0, GAUGE_COLORS[colorKey].semi);
    gradient.addColorStop(1, GAUGE_COLORS[colorKey].trans);
    return gradient;
};


// --- Reusable UI Components ---
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
    
    const [allPlasmaData, setAllPlasmaData] = useState<any[]>([]);
    const [allMagneticData, setAllMagneticData] = useState<any[]>([]);
    
    const [solarWindChartData, setSolarWindChartData] = useState<any>({ datasets: [] });
    const [magneticFieldChartData, setMagneticFieldChartData] = useState<any>({ datasets: [] });
    
    const [timeRange, setTimeRange] = useState<number>(6 * 3600000);
    const [timeLabel, setTimeLabel] = useState<string>('6 Hr');
    const [modalState, setModalState] = useState<{ isOpen: boolean; title: string; content: string } | null>(null);
    const [epamImageUrl, setEpamImageUrl] = useState<string>('/placeholder.png');
    
    // --- Tooltip Content ---
    const tooltipContent = {
        'forecast': { title: 'About The Forecast Score', content: `This is a proprietary TNR Protography forecast that combines live solar wind data with local conditions like lunar phase and astronomical darkness. It is highly accurate for the next 2 hours. Remember, patience is key and always look south! <br><br><strong>What the Percentage Means:</strong><ul><li><strong>< 10% 😞:</strong> Little to no auroral activity.</li><li><strong>10-25% 😐:</strong> Minimal activity; cameras may detect a faint glow.</li><li><strong>25-40% 😊:</strong> Clear activity on camera; a faint naked-eye glow is possible.</li><li><strong>40-50% 🙂:</strong> Faint naked-eye aurora likely, maybe with color.</li><li><strong>50-80% 😀:</strong> Good chance of naked-eye color and structure.</li><li><strong>80%+ 🤩:</strong> High probability of a significant substorm.</li></ul>` },
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
    const formatNZTimestamp = (timestamp: number) => { 
        try { 
            const d = new Date(timestamp); 
            return isNaN(d.getTime()) ? "Invalid Date" : d.toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', dateStyle: 'short', timeStyle: 'short' }); 
        } catch { return "Invalid Date"; } 
    };
    const getAuroraEmoji = (s: number | null) => { if (s === null) return GAUGE_EMOJIS.error; if (s < 10) return '😞'; if (s < 25) return '😐'; if (s < 40) return '😊'; if (s < 50) return '🙂'; if (s < 80) return '😀'; return '🤩'; };
    const getGaugeStyle = useCallback((v: number | null, type: keyof typeof GAUGE_THRESHOLDS) => {
        if (v == null || isNaN(v)) return { color: GAUGE_COLORS.gray.solid, emoji: GAUGE_EMOJIS.error, percentage: 0 };
        let key: keyof typeof GAUGE_COLORS = 'pink';
        if (type === 'bz') {
            key = getBzScaleColorKey(v, GAUGE_THRESHOLDS.bz);
        } else {
            key = getPositiveScaleColorKey(v, GAUGE_THRESHOLDS[type as 'speed' | 'density' | 'bt' | 'power']);
        }
        return { color: GAUGE_COLORS[key].solid, emoji: GAUGE_EMOJIS[key], percentage: 0 };
    }, []);
    
    // --- Data Fetching & Processing Effects ---
    useEffect(() => {
        setIsLoading(true);
        Promise.all([
            fetch(`${FORECAST_API_URL}?_=${Date.now()}`).then(res => res.json()),
            fetch(`${NOAA_PLASMA_URL}?_=${Date.now()}`).then(res => res.json()),
            fetch(`${NOAA_MAG_URL}?_=${Date.now()}`).then(res => res.json()),
        ]).then(([forecastData, plasmaData, magData]) => {
            const { currentForecast, historicalData } = forecastData;
            setAuroraScore(currentForecast.spotTheAuroraForecast);
            setLastUpdated(`Last Updated: ${formatNZTimestamp(currentForecast.lastUpdated)}`);
            setAuroraBlurb(getAuroraBlurb(currentForecast.spotTheAuroraForecast));
            
            const { bt, bz } = currentForecast.inputs.magneticField;
            setGaugeData(prev => ({ ...prev, power: { ...prev.power, value: currentForecast.inputs.hemisphericPower.toFixed(1), ...getGaugeStyle(currentForecast.inputs.hemisphericPower, 'power'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast.lastUpdated)}` }, bt: { ...prev.bt, value: bt.toFixed(1), ...getGaugeStyle(bt, 'bt'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast.lastUpdated)}` }, bz: { ...prev.bz, value: bz.toFixed(1), ...getGaugeStyle(bz, 'bz'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast.lastUpdated)}` }, moon: getMoonData(currentForecast.inputs.moonReduction, currentForecast.inputs.owmDataLastFetched) }));
            
            const plasmaHeaders = plasmaData[0]; const speedIdx = plasmaHeaders.indexOf('speed'); const densityIdx = plasmaHeaders.indexOf('density'); const plasmaTimeIdx = plasmaHeaders.indexOf('time_tag');
            const latestPlasmaRow = plasmaData.slice(1).reverse().find((r: any[]) => parseFloat(r[speedIdx]) > -9999);
            const speedVal = latestPlasmaRow ? parseFloat(latestPlasmaRow[speedIdx]) : null; const densityVal = latestPlasmaRow ? parseFloat(latestPlasmaRow[densityIdx]) : null; 
            const rawPlasmaTime = latestPlasmaRow ? latestPlasmaRow[plasmaTimeIdx] : null;
            const plasmaTimestamp = rawPlasmaTime ? new Date(rawPlasmaTime.replace(' ', 'T') + 'Z').getTime() : Date.now();
            setGaugeData(prev => ({ ...prev, speed: { ...prev.speed, value: speedVal ? speedVal.toFixed(1) : '...', ...getGaugeStyle(speedVal, 'speed'), lastUpdated: `Updated: ${formatNZTimestamp(plasmaTimestamp)}` }, density: { ...prev.density, value: densityVal ? densityVal.toFixed(1) : '...', ...getGaugeStyle(densityVal, 'density'), lastUpdated: `Updated: ${formatNZTimestamp(plasmaTimestamp)}` } }));

            const magHeaders = magData[0]; const magBtIdx = magHeaders.indexOf('bt'); const magBzIdx = magHeaders.indexOf('bz_gsm'); const magTimeIdx = magHeaders.indexOf('time_tag');
            const magPoints = magData.slice(1).map((r: any[]) => {
                const rawTime = r[magTimeIdx];
                const cleanTime = new Date(rawTime.replace(' ', 'T') + 'Z').getTime();
                return {
                    time: cleanTime,
                    bt: parseFloat(r[magBtIdx]) > -9999 ? parseFloat(r[magBtIdx]) : null,
                    bz: parseFloat(r[magBzIdx]) > -9999 ? parseFloat(r[magBzIdx]) : null
                };
            });
            setAllMagneticData(magPoints);

            const plasmaPoints = plasmaData.slice(1).map((r:any[]) => {
                const rawTime = r[plasmaTimeIdx];
                const cleanTime = new Date(rawTime.replace(' ', 'T') + 'Z').getTime();
                return {
                    time: cleanTime,
                    speed: parseFloat(r[speedIdx]) > -9999 ? parseFloat(r[speedIdx]) : null,
                    density: parseFloat(r[densityIdx]) > -9999 ? parseFloat(r[densityIdx]) : null,
                }
            });
            setAllPlasmaData(plasmaPoints);
        
        }).catch(error => { console.error("Dashboard data failed to load:", error); setAuroraBlurb("Could not load forecast data.");
        }).finally(() => { setIsLoading(false); });
        
        setEpamImageUrl(`${ACE_EPAM_URL}?_=${Date.now()}`);
    }, []);

    const getAuroraBlurb = (score: number) => { if (score < 10) return 'Little to no auroral activity.'; if (score < 25) return 'Minimal auroral activity likely.'; if (score < 40) return 'Clear auroral activity visible in cameras.'; if (score < 50) return 'Faint auroral glow potentially visible to the naked eye.'; if (score < 80) return 'Good chance of naked-eye color and structure.'; return 'High probability of a significant substorm.'; };
    const getMoonData = (moonReduction: number, timestamp: number) => { const moonIllumination = Math.max(0, (moonReduction || 0) / 40 * 100); let moonEmoji = '🌑'; if (moonIllumination > 95) moonEmoji = '🌕'; else if (moonIllumination > 55) moonEmoji = '🌖'; else if (moonIllumination > 45) moonEmoji = '🌗'; else if (moonIllumination > 5) moonEmoji = '🌒'; return { value: moonIllumination.toFixed(0), unit: '%', emoji: moonEmoji, percentage: moonIllumination, lastUpdated: `Updated: ${formatNZTimestamp(timestamp)}`, color: '#A9A9A9' }; };
    
    // --- Chart Generation Logic ---
    useEffect(() => {
        if (allPlasmaData.length > 0) {
            setSolarWindChartData({
                datasets: [
                    { 
                        label: 'Speed', data: allPlasmaData.map(p => ({ x: p.time, y: p.speed })), yAxisID: 'y',
                        fill: 'origin', borderWidth: 1.5, pointRadius: 0, tension: 0.3,
                        segment: {
                            borderColor: (ctx: ScriptableContext<'line'>) => GAUGE_COLORS[getPositiveScaleColorKey(ctx.p1.parsed.y, GAUGE_THRESHOLDS.speed)].solid,
                            backgroundColor: (ctx: ScriptableContext<'line'>) => createGradient(ctx.chart.ctx, ctx.chart.chartArea, getPositiveScaleColorKey(ctx.p1.parsed.y, GAUGE_THRESHOLDS.speed)),
                        }
                    },
                    { 
                        label: 'Density', data: allPlasmaData.map(p => ({ x: p.time, y: p.density })), yAxisID: 'y1',
                        fill: 'origin', borderWidth: 1.5, pointRadius: 0, tension: 0.3,
                        segment: {
                            borderColor: (ctx: ScriptableContext<'line'>) => GAUGE_COLORS[getPositiveScaleColorKey(ctx.p1.parsed.y, GAUGE_THRESHOLDS.density)].solid,
                            backgroundColor: (ctx: ScriptableContext<'line'>) => createGradient(ctx.chart.ctx, ctx.chart.chartArea, getPositiveScaleColorKey(ctx.p1.parsed.y, GAUGE_THRESHOLDS.density)),
                        }
                    }
                ]
            });
        }
        if (allMagneticData.length > 0) {
            setMagneticFieldChartData({
                datasets: [
                    { 
                        label: 'Bt', data: allMagneticData.map(p => ({ x: p.time, y: p.bt })), 
                        fill: 'origin', borderWidth: 1.5, pointRadius: 0, tension: 0.3,
                        segment: {
                            borderColor: (ctx: ScriptableContext<'line'>) => GAUGE_COLORS[getPositiveScaleColorKey(ctx.p1.parsed.y, GAUGE_THRESHOLDS.bt)].solid,
                            backgroundColor: (ctx: ScriptableContext<'line'>) => createGradient(ctx.chart.ctx, ctx.chart.chartArea, getPositiveScaleColorKey(ctx.p1.parsed.y, GAUGE_THRESHOLDS.bt)),
                        }
                    },
                    { 
                        label: 'Bz', data: allMagneticData.map(p => ({ x: p.time, y: p.bz })), 
                        fill: 'origin', borderWidth: 1.5, pointRadius: 0, tension: 0.3,
                        segment: {
                            borderColor: (ctx: ScriptableContext<'line'>) => GAUGE_COLORS[getBzScaleColorKey(ctx.p1.parsed.y, GAUGE_THRESHOLDS.bz)].solid,
                            backgroundColor: (ctx: ScriptableContext<'line'>) => createGradient(ctx.chart.ctx, ctx.chart.chartArea, getBzScaleColorKey(ctx.p1.parsed.y, GAUGE_THRESHOLDS.bz)),
                        }
                    }
                ]
            });
        }
    }, [allPlasmaData, allMagneticData]);

    const createChartOptions = useCallback((rangeMs: number, isDualAxis: boolean): ChartOptions<'line'> => {
        const now = Date.now();
        const startTime = now - rangeMs;
        const options: ChartOptions<'line'> = {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false, axis: 'x' },
            plugins: { legend: { labels: { color: '#a1a1aa' }}, tooltip: { mode: 'index', intersect: false } },
            scales: { x: { type: 'time', min: startTime, max: now, ticks: { color: '#71717a', source: 'auto' }, grid: { color: '#3f3f46' } } }
        };

        if (isDualAxis) {
            options.scales = {
                ...options.scales,
                y: { type: 'linear', position: 'left', ticks: { color: '#86efac' }, grid: { color: '#3f3f46' }, title: { display: true, text: 'Speed (km/s)', color: '#86efac' } },
                y1: { type: 'linear', position: 'right', ticks: { color: '#fcd34d' }, grid: { drawOnChartArea: false }, title: { display: true, text: 'Density (p/cm³)', color: '#fcd34d' } }
            };
        } else {
             options.scales = {
                ...options.scales,
                y: { type: 'linear', position: 'left', ticks: { color: '#a3a3a3' }, grid: { color: '#3f3f46' }, title: { display: true, text: 'Magnetic Field (nT)', color: '#a3a3a3' } }
            };
        }
        return options;
    }, []);
    
    const solarWindOptions = useMemo(() => createChartOptions(timeRange, true), [timeRange, createChartOptions]);
    const magneticFieldOptions = useMemo(() => createChartOptions(timeRange, false), [timeRange, createChartOptions]);

    if (isLoading) {
        return <div className="w-full h-full flex justify-center items-center bg-neutral-900"><LoadingSpinner /></div>;
    }

    return (
        <div className="w-full h-full overflow-y-auto bg-neutral-900 text-neutral-300 p-5">
            <style>{`.sighting-emoji-icon { font-size: 1.5rem; text-align: center; line-height: 1; text-shadow: 0 0 8px rgba(0,0,0,0.9); background: none; border: none; } .sighting-emoji-icon.\\!text-4xl { font-size: 2.5rem !important; } .leaflet-popup-content-wrapper, .leaflet-popup-tip { background-color: #262626; color: #fafafa; }`}</style>
            <div className="container mx-auto">
                <header className="text-center mb-8">
                    <a href="https://www.tnrprotography.co.nz" target="_blank" rel="noopener noreferrer"><img src="https://www.tnrprotography.co.nz/uploads/1/3/6/6/136682089/white-tnr-protography-w_orig.png" alt="TNR Protography Logo" className="mx-auto w-full max-w-[250px] mb-4"/></a>
                    <h1 className="text-3xl font-bold text-neutral-100">Spot The Aurora - West Coast Aurora Forecast</h1>
                </header>
                <main className="grid grid-cols-12 gap-6">
                    <div className="col-span-12 card bg-neutral-950/80 p-6 md:grid md:grid-cols-2 md:gap-8 items-center">
                        <div>
                            <div className="flex items-center mb-4"><h2 className="text-lg font-semibold text-white">Spot The Aurora Forecast</h2><button onClick={() => openModal('forecast')} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button></div>
                            <div className="text-6xl font-extrabold text-white">{auroraScore !== null ? `${auroraScore.toFixed(1)}%` : '...'} <span className="text-5xl">{getAuroraEmoji(auroraScore)}</span></div>
                            <div className="w-full bg-neutral-700 rounded-full h-3 mt-4"><div className="h-3 rounded-full" style={{ width: `${auroraScore || 0}%`, backgroundColor: auroraScore !== null ? getGaugeStyle(auroraScore, 'power').color : GAUGE_COLORS.gray.solid }}></div></div>
                            <div className="text-sm text-neutral-400 mt-2">{lastUpdated}</div>
                        </div>
                        <p className="text-neutral-300 mt-4 md:mt-0">{auroraBlurb}</p>
                    </div>

                    <div className="col-span-12 grid grid-cols-6 gap-5">
                        {Object.entries(gaugeData).map(([key, data]) => (
                            <div key={key} className="col-span-3 md:col-span-2 lg:col-span-1 card bg-neutral-950/80 p-4 text-center flex flex-col justify-between">
                                <div className="flex justify-center items-center"><h3 className="text-md font-semibold text-white h-10 flex items-center justify-center">{key === 'moon' ? 'Moon' : key.toUpperCase()}</h3><button onClick={() => openModal(key)} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button></div>
                                <div className="text-3xl font-bold my-2">{data.value} <span className="text-lg">{data.unit}</span></div>
                                <div className="text-3xl my-2">{data.emoji}</div>
                                <div className="w-full bg-neutral-700 rounded-full h-2"><div className="h-2 rounded-full" style={{ width: `${data.percentage}%`, backgroundColor: data.color }}></div></div>
                                <div className="text-xs text-neutral-500 mt-2 truncate" title={data.lastUpdated}>{data.lastUpdated}</div>
                            </div>
                        ))}
                    </div>

                    <div className="col-span-12 lg:col-span-6 card bg-neutral-950/80 p-4 h-[500px] flex flex-col">
                        <h2 className="text-xl font-semibold text-white text-center">Live Solar Wind (Last {timeLabel})</h2>
                        <TimeRangeButtons onSelect={(duration, label) => { setTimeRange(duration); setTimeLabel(label); }} selected={timeRange} />
                        <div className="flex-grow relative mt-2">
                            {solarWindChartData.datasets.length > 0 ? <Line data={solarWindChartData} options={solarWindOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">Loading Chart...</p>}
                        </div>
                    </div>
                    <div className="col-span-12 lg:col-span-6 card bg-neutral-950/80 p-4 h-[500px] flex flex-col">
                        <h2 className="text-xl font-semibold text-white text-center">Live Interplanetary Magnetic Field (Last {timeLabel})</h2>
                        <TimeRangeButtons onSelect={(duration, label) => { setTimeRange(duration); setTimeLabel(label); }} selected={timeRange} />
                         <div className="flex-grow relative mt-2">
                            {magneticFieldChartData.datasets.length > 0 ? <Line data={magneticFieldChartData} options={magneticFieldOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">Loading Chart...</p>}
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
                <footer className="page-footer mt-10 pt-8 border-t border-neutral-700 text-center text-neutral-400 text-sm">
                    <h3 className="text-lg font-semibold text-neutral-200 mb-4">About This Dashboard</h3>
                    <p className="max-w-3xl mx-auto leading-relaxed">This dashboard provides a highly localized, 2-hour aurora forecast specifically for the West Coast of New Zealand. The proprietary "Spot The Aurora Forecast" combines live solar wind data with local factors like astronomical darkness and lunar phase to generate a more nuanced prediction than global models.</p>
                    <p className="max-w-3xl mx-auto leading-relaxed mt-4"><strong>Disclaimer:</strong> The aurora is a natural and unpredictable phenomenon. This forecast is an indication of potential activity, not a guarantee of a visible display. Conditions can change rapidly.</p>
                    <div className="mt-8 text-xs text-neutral-500"><p>Data provided by <a href="https://www.swpc.noaa.gov/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">NOAA SWPC</a> & <a href="https://api.nasa.gov/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">NASA</a> | Weather & Cloud data by <a href="https://www.windy.com" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">Windy.com</a> | Live Camera by <a href="https://queenstown.roundshot.com/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">Roundshot</a></p><p className="mt-2">Forecast Algorithm, Visualization, and Development by TNR Protography</p></div>
                </footer>
             </div>
            {modalState && <InfoModal {...modalState} onClose={closeModal} />}
        </div>
    );
};

export default ForecastDashboard;