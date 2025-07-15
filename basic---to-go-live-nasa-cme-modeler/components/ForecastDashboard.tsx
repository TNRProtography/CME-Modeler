import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import CloseIcon from './icons/CloseIcon';
import CaretIcon from './icons/CaretIcon';
import { ChartOptions, ScriptableContext } from 'chart.js';
import { enNZ } from 'date-fns/locale';
import LoadingSpinner from './icons/LoadingSpinner';
import AuroraSightings from './AuroraSightings';
import GuideIcon from './icons/GuideIcon';

// --- Type Definitions ---
interface ForecastDashboardProps {
  setViewerMedia?: (media: { url: string, type: 'image' | 'video' } | null) => void;
}
interface InfoModalProps { isOpen: boolean; onClose: () => void; title: string; content: React.ReactNode; }

interface CelestialTimeData {
    moon?: { rise: number | null, set: number | null, illumination?: number };
    sun?: { rise: number | null, set: number | null };
}

// --- Constants ---
const FORECAST_API_URL = 'https://spottheaurora.thenamesrock.workers.dev/';
const NOAA_PLASMA_URL = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json';
const NOAA_MAG_URL = 'https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json';
const NOAA_GOES_MAG_URL = 'https://services.swpc.noaa.gov/json/goes/primary/magnetometers-1-day.json';
const ACE_EPAM_URL = 'https://services.swpc.noaa.gov/images/ace-epam-24-hour.gif';
const REFRESH_INTERVAL_MS = 60 * 1000;

const GAUGE_THRESHOLDS = {
  speed: { gray: 250, yellow: 350, orange: 500, red: 650, purple: 800, maxExpected: 1000 },
  density: { gray: 5, yellow: 10, orange: 15, red: 20, purple: 50, maxExpected: 70 },
  power: { gray: 20, yellow: 40, orange: 70, red: 150, purple: 200, maxExpected: 250 },
  bt: { gray: 5, yellow: 10, orange: 15, red: 20, purple: 50, maxExpected: 60 },
  bz: { gray: -5, yellow: -10, orange: -15, red: -20, purple: -50, maxNegativeExpected: -60 }
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

const getPositiveScaleColorKey = (value: number, thresholds: { [key: string]: number }) => {
    if (value >= thresholds.purple) return 'purple';
    if (value >= thresholds.red) return 'red';
    if (value >= thresholds.orange) return 'orange';
    if (value >= thresholds.yellow) return 'yellow';
    return 'gray';
};

const getForecastScoreColorKey = (score: number): keyof typeof GAUGE_COLORS => {
    if (score >= 80) return 'pink';
    if (score >= 50) return 'red';
    if (score >= 40) return 'orange';
    if (score >= 25) return 'yellow';
    if (score >= 10) return 'gray';
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
    if (!chartArea) return;
    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    gradient.addColorStop(0, GAUGE_COLORS[colorKey].semi);
    gradient.addColorStop(1, GAUGE_COLORS[colorKey].trans);
    return gradient;
};

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

const TimeRangeButtons: React.FC<{ onSelect: (duration: number, label: string) => void; selected: number }> = ({ onSelect, selected }) => {
    const timeRanges = [ { label: '1 Hr', hours: 1 }, { label: '2 Hr', hours: 2 }, { label: '3 Hr', hours: 3 }, { label: '6 Hr', hours: 6 }, { label: '12 Hr', hours: 12 }, { label: '24 Hr', hours: 24 } ];
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

const getSuggestedCameraSettings = (score: number | null, isDaylight: boolean) => {
    if (isDaylight) {
        return {
            overall: "The sun is currently up. It is not possible to photograph the aurora during daylight hours.",
            phone: { android: { iso: "N/A", shutter: "N/A", aperture: "N/A", focus: "N/A", wb: "N/A", pros: ["Enjoy the sunshine!"], cons: ["Aurora is not visible."] }, apple: { iso: "N/A", shutter: "N/A", aperture: "N/A", focus: "N/A", wb: "N/A", pros: ["Enjoy the sunshine!"], cons: ["Aurora is not visible."] } },
            dslr: { iso: "N/A", shutter: "N/A", aperture: "N/A", focus: "N/A", wb: "N/A", pros: ["A great time for landscape photos."], cons: ["Aurora is not visible."] }
        };
    }
    let baseSettings: any;
    if (score === null || score < 10) { 
        baseSettings = { overall: "Very low activity expected. It's highly unlikely to capture the aurora with any camera.", phone: { android: { iso: "3200-6400 (Max)", shutter: "20-30s", pros: ["Might pick up a faint glow."] }, apple: { iso: "Auto (max Night Mode)", shutter: "10-30s", pros: ["Simple to try."] } }, dslr: { iso: "6400-12800", shutter: "20-30s", pros: ["Maximizes light gathering."] } };
    } else if (score < 20) {
         baseSettings = { overall: "Minimal activity. A DSLR/Mirrorless camera might capture a faint glow.", phone: { android: { iso: "3200-6400 (Max)", shutter: "15-30s", pros: ["Might detect faint light."] }, apple: { iso: "Auto (max Night Mode)", shutter: "10-30s", pros: ["Easy to attempt."] } }, dslr: { iso: "3200-6400", shutter: "15-25s", pros: ["Good chance for faint detection."] } };
    } else if (score >= 80) {
        baseSettings = { overall: "High probability of a bright, active aurora! Aim for shorter exposures.", phone: { android: { iso: "400-800", shutter: "1-5s", pros: ["Captures dynamic movement."] }, apple: { iso: "Auto", shutter: "1-3s", pros: ["Quick results."] } }, dslr: { iso: "800-1600", shutter: "1-5s", pros: ["Stunning detail, minimal noise."] } };
    } else {
        baseSettings = { overall: "Moderate activity expected. Good chance for visible aurora.", phone: { android: { iso: "800-1600", shutter: "5-10s", pros: ["Better detail and color."] }, apple: { iso: "Auto", shutter: "3-7s", pros: ["Good balance."] } }, dslr: { iso: "1600-3200", shutter: "5-15s", pros: ["Excellent detail, less noise."] } };
    }
    // Add consistent settings to all tiers
    const sharedSettings = { aperture: "Lowest f-number", focus: "Infinity", wb: "Auto or 3500K-4000K" };
    baseSettings.phone.android = {...baseSettings.phone.android, ...sharedSettings};
    baseSettings.phone.apple = {...baseSettings.phone.apple, ...sharedSettings};
    baseSettings.dslr = {...baseSettings.dslr, ...sharedSettings};
    return baseSettings;
};


const ForecastDashboard: React.FC<ForecastDashboardProps> = ({ setViewerMedia }) => {
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
    
    const [celestialTimes, setCelestialTimes] = useState<CelestialTimeData>({});
    const [isDaylight, setIsDaylight] = useState(false);
    const [allPlasmaData, setAllPlasmaData] = useState<any[]>([]);
    const [allMagneticData, setAllMagneticData] = useState<any[]>([]);
    const [magnetometerData, setMagnetometerData] = useState<any[]>([]);
    const [loadingMagnetometer, setLoadingMagnetometer] = useState<string | null>('Loading data...');
    const [substormBlurb, setSubstormBlurb] = useState<{ text: string; color: string }>({ text: 'Analyzing magnetic field stability...', color: 'text-neutral-400' });
    
    const [solarWindChartData, setSolarWindChartData] = useState<any>({ datasets: [] });
    const [magneticFieldChartData, setMagneticFieldChartData] = useState<any>({ datasets: [] });
    
    const [solarWindTimeRange, setSolarWindTimeRange] = useState<number>(6 * 3600000);
    const [solarWindTimeLabel, setSolarWindTimeLabel] = useState<string>('6 Hr');
    const [magneticFieldTimeRange, setMagneticFieldTimeRange] = useState<number>(6 * 3600000);
    const [magneticFieldTimeLabel, setMagneticFieldTimeLabel] = useState<string>('6 Hr');
    const [magnetometerTimeRange, setMagnetometerTimeRange] = useState<number>(3 * 3600000);
    const [magnetometerTimeLabel, setMagnetometerTimeLabel] = useState<string>('3 Hr');
    
    const [modalState, setModalState] = useState<{ isOpen: boolean; title: string; content: React.ReactNode } | null>(null);
    const [isFaqOpen, setIsFaqOpen] = useState(false);
    const [epamImageUrl, setEpamImageUrl] = useState<string>('/placeholder.png');

    const [isCameraSettingsOpen, setIsCameraSettingsOpen] = useState(false);
    const [isTipsOpen, setIsTipsOpen] = useState(false);
    const [auroraScoreHistory, setAuroraScoreHistory] = useState<{ timestamp: number; baseScore: number; finalScore: number; }[]>([]);
    const [auroraScoreChartTimeRange, setAuroraScoreChartTimeRange] = useState<number>(6 * 3600000);
    const [auroraScoreChartTimeLabel, setAuroraScoreChartTimeLabel] = useState<string>('6 Hr');

    const tooltipContent = {
        'forecast': { title: 'About The Forecast Score', content: `This is a proprietary TNR Protography forecast...` },
        'power': { title: 'Hemispheric Power', content: `<strong>What it is:</strong> ...` },
        'speed': { title: 'Solar Wind Speed', content: `<strong>What it is:</strong> ...` },
        'density': { title: 'Solar Wind Density', content: `<strong>What it is:</strong> ...` },
        'bt': { title: 'IMF Bt (Total)', content: `<strong>What it is:</strong> ...` },
        'bz': { title: 'IMF Bz (N/S)', content: `<strong>What it is:</strong> ...` },
        'epam': { title: 'ACE EPAM', content: `<strong>What it is:</strong> ...` },
        'moon': { title: 'Moon Illumination', content: `<strong>What it is:</strong> ...` },
        'goes-mag': { title: 'GOES Magnetometer (Hp)', content: `<div><p>This graph shows the <strong>Hp component</strong> of the magnetic field, measured by a GOES satellite in geosynchronous orbit. It's one of the best indicators for an imminent substorm.</p><br><p><strong>How to read it:</strong></p><ul class="list-disc list-inside space-y-2 mt-2"><li><strong class="text-yellow-400">Growth Phase:</strong> When energy is building up, the magnetic field stretches out like a rubber band. This causes a slow, steady <strong>drop</strong> in the Hp value over 1-2 hours.</li><li><strong class="text-green-400">Substorm Eruption:</strong> When the field snaps back, it causes a sharp, sudden <strong>jump</strong> in the Hp value (called a "dipolarization"). This is the aurora flaring up brightly!</li></ul><br><p>By watching for the drop, you can anticipate the jump.</p></div>` },
    };
    
    const openModal = useCallback((id: string) => { const content = tooltipContent[id as keyof typeof tooltipContent]; if (content) setModalState({ isOpen: true, title: content.title, content: content.content }); }, []);
    const closeModal = useCallback(() => setModalState(null), []);
    const formatNZTimestamp = (timestamp: number) => { try { const d = new Date(timestamp); return isNaN(d.getTime()) ? "Invalid Date" : d.toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', dateStyle: 'short', timeStyle: 'short' }); } catch { return "Invalid Date"; } };
    const getAuroraEmoji = (s: number | null) => { if (s === null) return GAUGE_EMOJIS.error; if (s < 10) return '😞'; if (s < 25) return '😐'; if (s < 40) return '😊'; if (s < 50) return '🙂'; if (s < 80) return '😀'; return '🤩'; };
    
    const getGaugeStyle = useCallback((v: number | null, type: keyof typeof GAUGE_THRESHOLDS) => {
        if (v == null || isNaN(v)) return { color: GAUGE_COLORS.gray.solid, emoji: GAUGE_EMOJIS.error, percentage: 0 };
        let key: keyof typeof GAUGE_COLORS = 'gray';
        let percentage = 0;
        if (type === 'bz') {
            key = getBzScaleColorKey(v, GAUGE_THRESHOLDS.bz);
            percentage = v < 0 ? Math.min(100, Math.abs(v / GAUGE_THRESHOLDS.bz.maxNegativeExpected) * 100) : 0;
        } else {
            const thresholds = GAUGE_THRESHOLDS[type as 'speed' | 'density' | 'bt' | 'power'];
            key = getPositiveScaleColorKey(v, thresholds);
            percentage = Math.min(100, (v / thresholds.maxExpected) * 100);
        }
        return { color: GAUGE_COLORS[key].solid, emoji: GAUGE_EMOJIS[key], percentage };
    }, []);

    const analyzeMagnetometerData = (data: any[]) => {
        if (data.length < 30) { // Need at least 30 minutes of data
            setSubstormBlurb({ text: 'Awaiting more magnetic field data...', color: 'text-neutral-500' });
            return;
        }

        const latestPoint = data[data.length - 1];
        const tenMinAgoPoint = data.find(p => p.time >= latestPoint.time - 10 * 60 * 1000);
        const oneHourAgoPoint = data.find(p => p.time >= latestPoint.time - 60 * 60 * 1000);

        if (!latestPoint || !tenMinAgoPoint || !oneHourAgoPoint) {
            setSubstormBlurb({ text: 'Analyzing magnetic field stability...', color: 'text-neutral-400' });
            return;
        }

        const jump = latestPoint.hp - tenMinAgoPoint.hp;
        const drop = latestPoint.hp - oneHourAgoPoint.hp;

        if (jump > 20) {
            setSubstormBlurb({ text: 'Substorm signature detected! A sharp field increase suggests a recent or ongoing eruption. Look south!', color: 'text-green-400 font-bold animate-pulse' });
        } else if (drop < -15) {
            setSubstormBlurb({ text: 'The magnetic field is stretching, storing energy. Conditions are favorable for a potential substorm.', color: 'text-yellow-400' });
        } else {
            setSubstormBlurb({ text: 'The magnetic field appears stable. No immediate signs of substorm development.', color: 'text-neutral-400' });
        }
    };
    
    const fetchAllData = useCallback(async (isInitialLoad = false) => {
        if (isInitialLoad) setIsLoading(true);
        const results = await Promise.allSettled([
            fetch(`${FORECAST_API_URL}?_=${Date.now()}`).then(res => res.json()),
            fetch(`${NOAA_PLASMA_URL}?_=${Date.now()}`).then(res => res.json()),
            fetch(`${NOAA_MAG_URL}?_=${Date.now()}`).then(res => res.json()),
            fetch(`${NOAA_GOES_MAG_URL}?_=${Date.now()}`).then(res => res.json()),
        ]);
        const [forecastResult, plasmaResult, magResult, goesMagResult] = results;

        if (forecastResult.status === 'fulfilled' && forecastResult.value) {
            const { currentForecast, historicalData } = forecastResult.value;
            setCelestialTimes({ moon: currentForecast?.moon, sun: currentForecast?.sun });
            const currentScore = currentForecast?.spotTheAuroraForecast ?? null;
            setAuroraScore(currentScore);
            setLastUpdated(`Last Updated: ${formatNZTimestamp(currentForecast?.lastUpdated ?? 0)}`);
            setAuroraBlurb(getAuroraBlurb(currentScore ?? 0));
            const { bt, bz } = currentForecast?.inputs?.magneticField ?? {};
            setGaugeData(prev => ({...prev, power: { ...prev.power, value: currentForecast?.inputs?.hemisphericPower?.toFixed(1) ?? 'N/A', ...getGaugeStyle(currentForecast?.inputs?.hemisphericPower ?? null, 'power'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast?.lastUpdated ?? 0)}`}, bt: { ...prev.bt, value: bt?.toFixed(1) ?? 'N/A', ...getGaugeStyle(bt ?? null, 'bt'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast?.lastUpdated ?? 0)}`}, bz: { ...prev.bz, value: bz?.toFixed(1) ?? 'N/A', ...getGaugeStyle(bz ?? null, 'bz'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast?.lastUpdated ?? 0)}`}, moon: getMoonData(currentForecast?.moon?.illumination ?? null, currentForecast?.moon?.rise ?? null, currentForecast?.moon?.set ?? null) }));
            if (Array.isArray(historicalData)) {
                setAuroraScoreHistory(historicalData.filter((d: any) => typeof d.timestamp === 'number' && typeof d.baseScore === 'number' && typeof d.finalScore === 'number').sort((a, b) => a.timestamp - b.timestamp));
            } else { setAuroraScoreHistory([]); }
        } else { setAuroraBlurb("Could not load forecast data."); setAuroraScoreHistory([]); }

        if (plasmaResult.status === 'fulfilled' && Array.isArray(plasmaResult.value) && plasmaResult.value.length > 1) {
            const plasmaData = plasmaResult.value; const plasmaHeaders = plasmaData[0]; const speedIdx = plasmaHeaders.indexOf('speed'); const densityIdx = plasmaHeaders.indexOf('density'); const plasmaTimeIdx = plasmaHeaders.indexOf('time_tag');
            const latestPlasmaRow = plasmaData.slice(1).reverse().find((r: any[]) => parseFloat(r?.[speedIdx]) > -9999); const speedVal = latestPlasmaRow ? parseFloat(latestPlasmaRow[speedIdx]) : null; const densityVal = latestPlasmaRow ? parseFloat(latestPlasmaRow[densityIdx]) : null; const rawPlasmaTime = latestPlasmaRow?.[plasmaTimeIdx]; const plasmaTimestamp = rawPlasmaTime ? new Date(rawPlasmaTime.replace(' ', 'T') + 'Z').getTime() : Date.now();
            setGaugeData(prev => ({...prev, speed: {...prev.speed, value: speedVal?.toFixed(1) ?? 'N/A', ...getGaugeStyle(speedVal, 'speed'), lastUpdated: `Updated: ${formatNZTimestamp(plasmaTimestamp)}`}, density: {...prev.density, value: densityVal?.toFixed(1) ?? 'N/A', ...getGaugeStyle(densityVal, 'density'), lastUpdated: `Updated: ${formatNZTimestamp(plasmaTimestamp)}`}}));
            setAllPlasmaData(plasmaData.slice(1).map((r:any[]) => { const rawTime = r[plasmaTimeIdx]; const cleanTime = new Date(rawTime.replace(' ', 'T') + 'Z').getTime(); return { time: cleanTime, speed: parseFloat(r[speedIdx]) > -9999 ? parseFloat(r[speedIdx]) : null, density: parseFloat(r[densityIdx]) > -9999 ? parseFloat(r[densityIdx]) : null }}));
        } else { setAllPlasmaData([]); }

        if (magResult.status === 'fulfilled' && Array.isArray(magResult.value) && magResult.value.length > 1) {
            const magData = magResult.value; const magHeaders = magData[0]; const magBtIdx = magHeaders.indexOf('bt'); const magBzIdx = magHeaders.indexOf('bz_gsm'); const magTimeIdx = magHeaders.indexOf('time_tag');
            setAllMagneticData(magData.slice(1).map((r: any[]) => { const rawTime = r[magTimeIdx]; const cleanTime = new Date(rawTime.replace(' ', 'T') + 'Z').getTime(); return { time: cleanTime, bt: parseFloat(r[magBtIdx]) > -9999 ? parseFloat(r[magBtIdx]) : null, bz: parseFloat(r[magBzIdx]) > -9999 ? parseFloat(r[magBzIdx]) : null }; }));
        } else { setAllMagneticData([]); }

        if (goesMagResult.status === 'fulfilled' && Array.isArray(goesMagResult.value)) {
            const processedData = goesMagResult.value.filter(d => d.hp != null && d.hp > -99999).map(d => ({ time: new Date(d.time_tag).getTime(), hp: d.hp })).sort((a,b) => a.time - b.time);
            setMagnetometerData(processedData);
            analyzeMagnetometerData(processedData);
            setLoadingMagnetometer(null);
        } else { setLoadingMagnetometer('Magnetometer data unavailable.'); setMagnetometerData([]); }
        
        setEpamImageUrl(`${ACE_EPAM_URL}?_=${Date.now()}`);
        if (isInitialLoad) setIsLoading(false);
    }, [getGaugeStyle]);

    useEffect(() => { fetchAllData(true); const interval = setInterval(() => fetchAllData(false), REFRESH_INTERVAL_MS); return () => clearInterval(interval); }, [fetchAllData]);

    useEffect(() => { const now = Date.now(); const sunrise = celestialTimes.sun?.rise; const sunset = celestialTimes.sun?.set; if (sunrise && sunset) { if (sunrise < sunset) setIsDaylight(now > sunrise && now < sunset); else setIsDaylight(now > sunrise || now < sunset); } else setIsDaylight(false); }, [celestialTimes, lastUpdated]);

    const getAuroraBlurb = (score: number) => { if (score < 10) return 'Little to no auroral activity.'; if (score < 25) return 'Minimal auroral activity likely.'; if (score < 40) return 'Clear auroral activity visible in cameras.'; if (score < 50) return 'Faint auroral glow potentially visible to the naked eye.'; if (score < 80) return 'Good chance of naked-eye color and structure.'; return 'High probability of a significant substorm.'; };
    const getMoonData = (illumination: number | null, riseTime: number | null, setTime: number | null) => { const moonIllumination = Math.max(0, (illumination ?? 0) ); let moonEmoji = '🌑'; if (moonIllumination > 95) moonEmoji = '🌕'; else if (moonIllumination > 55) moonEmoji = '🌖'; else if (moonIllumination > 45) moonEmoji = '🌗'; else if (moonIllumination > 5) moonEmoji = '🌒'; const riseStr = riseTime ? new Date(riseTime).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' }) : 'N/A'; const setStr = setTime ? new Date(setTime).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' }) : 'N/A'; const caretSvgPath = `M19.5 8.25l-7.5 7.5-7.5-7.5`; const CaretUpSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" class="w-3 h-3 inline-block align-middle" style="transform: rotate(180deg);"><path stroke-linecap="round" stroke-linejoin="round" d="${caretSvgPath}" /></svg>`; const CaretDownSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" class="w-3 h-3 inline-block align-middle"><path stroke-linecap="round" stroke-linejoin="round" d="${caretSvgPath}" /></svg>`; const displayValue = `<span class="text-xl">${moonIllumination.toFixed(0)}%</span><br/><span class='text-xs'>${CaretUpSvg} ${riseStr}   ${CaretDownSvg} ${setStr}</span>`; return { value: displayValue, unit: '', emoji: moonEmoji, percentage: moonIllumination, lastUpdated: `Updated: ${formatNZTimestamp(Date.now())}`, color: '#A9A9A9' }; };
    
    useEffect(() => { const lineTension = (range: number) => range >= (12 * 3600000) ? 0.1 : 0.3; if (allPlasmaData.length > 0) { setSolarWindChartData({ datasets: [ { label: 'Speed', data: allPlasmaData.map(p => ({ x: p.time, y: p.speed })), yAxisID: 'y', order: 1, fill: 'origin', borderWidth: 1.5, pointRadius: 0, tension: lineTension(solarWindTimeRange), segment: { borderColor: (ctx: ScriptableContext<'line'>) => GAUGE_COLORS[getPositiveScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.speed)].solid, backgroundColor: (ctx: ScriptableContext<'line'>) => createGradient(ctx.chart.ctx, ctx.chart.chartArea, getPositiveScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.speed)), } }, { label: 'Density', data: allPlasmaData.map(p => ({ x: p.time, y: p.density })), yAxisID: 'y1', order: 0, fill: 'origin', borderWidth: 1.5, pointRadius: 0, tension: lineTension(solarWindTimeRange), segment: { borderColor: (ctx: ScriptableContext<'line'>) => GAUGE_COLORS[getPositiveScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.density)].solid, backgroundColor: (ctx: ScriptableContext<'line'>) => createGradient(ctx.chart.ctx, ctx.chart.chartArea, getPositiveScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.density)), } } ] }); } if (allMagneticData.length > 0) { setMagneticFieldChartData({ datasets: [ { label: 'Bt', data: allMagneticData.map(p => ({ x: p.time, y: p.bt })), order: 1, fill: 'origin', borderWidth: 1.5, pointRadius: 0, tension: lineTension(magneticFieldTimeRange), segment: { borderColor: (ctx: ScriptableContext<'line'>) => GAUGE_COLORS[getPositiveScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.bt)].solid, backgroundColor: (ctx: ScriptableContext<'line'>) => createGradient(ctx.chart.ctx, ctx.chart.chartArea, getPositiveScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.bt)), } }, { label: 'Bz', data: allMagneticData.map(p => ({ x: p.time, y: p.bz })), order: 0, fill: 'origin', borderWidth: 1.5, pointRadius: 0, tension: lineTension(magneticFieldTimeRange), segment: { borderColor: (ctx: ScriptableContext<'line'>) => GAUGE_COLORS[getBzScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.bz)].solid, backgroundColor: (ctx: ScriptableContext<'line'>) => createGradient(ctx.chart.ctx, ctx.chart.chartArea, getBzScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.bz)), } } ] }); } }, [allPlasmaData, allMagneticData, solarWindTimeRange, magneticFieldTimeRange]);

    const createChartOptions = useCallback((rangeMs: number, isDualAxis: boolean, yLabel: string): ChartOptions<'line'> => {
        const now = Date.now(); const startTime = now - rangeMs; const options: ChartOptions<'line'> = { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false, axis: 'x' }, plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } }, scales: { x: { type: 'time', min: startTime, max: now, ticks: { color: '#71717a', source: 'auto' }, grid: { color: '#3f3f46' } } } };
        if (isDualAxis) options.scales = { ...options.scales, y: { type: 'linear', position: 'left', ticks: { color: '#a3a3a3' }, grid: { color: '#3f3f46' }, title: { display: true, text: 'Speed (km/s)', color: '#a3a3a3' } }, y1: { type: 'linear', position: 'right', ticks: { color: '#a3a3a3' }, grid: { drawOnChartArea: false }, title: { display: true, text: 'Density (p/cm³)', color: '#a3a3a3' } } };
        else options.scales = { ...options.scales, y: { type: 'linear', position: 'left', ticks: { color: '#a3a3a3' }, grid: { color: '#3f3f46' }, title: { display: true, text: yLabel, color: '#a3a3a3' } } };
        return options;
    }, []);
    
    const solarWindOptions = useMemo(() => createChartOptions(solarWindTimeRange, true, ''), [solarWindTimeRange, createChartOptions]);
    const magneticFieldOptions = useMemo(() => createChartOptions(magneticFieldTimeRange, false, 'Magnetic Field (nT)'), [magneticFieldTimeRange, createChartOptions]);
    const magnetometerOptions = useMemo(() => createChartOptions(magnetometerTimeRange, false, 'Hp (nT)'), [magnetometerTimeRange, createChartOptions]);

    const magnetometerChartData = useMemo(() => {
        if (magnetometerData.length === 0) return { datasets: [] };
        return { datasets: [{ label: 'Hp', data: magnetometerData.map(p => ({ x: p.time, y: p.hp })), borderColor: 'rgb(56, 189, 248)', backgroundColor: 'rgba(56, 189, 248, 0.2)', pointRadius: 0, tension: 0.1, borderWidth: 1.5, fill: 'origin' }] };
    }, [magnetometerData]);
    
    const cameraSettings = useMemo(() => getSuggestedCameraSettings(auroraScore, isDaylight), [auroraScore, isDaylight]);

    const auroraScoreChartOptions = useMemo((): ChartOptions<'line'> => {
        const now = Date.now(); const startTime = now - auroraScoreChartTimeRange; const annotations: any = {}; const formatTime = (timestamp: number) => new Date(timestamp).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
        const addAnnotation = (key: string, timestamp: number | null | undefined, text: string, emoji: string, color: string, position: 'start' | 'end') => { if (timestamp && timestamp > startTime && timestamp < now) { annotations[key] = { type: 'line', xMin: timestamp, xMax: timestamp, borderColor: color.replace(/, 1\)/, ', 0.7)'), borderWidth: 1.5, borderDash: [6, 6], label: { content: `${emoji} ${text}: ${formatTime(timestamp)}`, display: true, position, color, font: { size: 10, weight: 'bold' }, backgroundColor: 'rgba(10, 10, 10, 0.7)', padding: 3, borderRadius: 3 }, enter(ctx, event) { ctx.element.label.options.display = true; ctx.chart.draw(); }, leave(ctx, event) { ctx.element.label.options.display = true; ctx.chart.draw(); } }; } };
        addAnnotation('sunrise', celestialTimes.sun?.rise, 'Sunrise', '☀️', '#fcd34d', 'start'); addAnnotation('sunset', celestialTimes.sun?.set, 'Sunset', '☀️', '#fcd34d', 'end'); addAnnotation('moonrise', celestialTimes.moon?.rise, 'Moonrise', '🌕', '#d1d5db', 'start'); addAnnotation('moonset', celestialTimes.moon?.set, 'Moonset', '🌕', '#d1d5db', 'end');
        return { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false, axis: 'x' }, plugins: { legend: { labels: { color: '#a1a1aa' }}, tooltip: { callbacks: { title: (context) => context.length > 0 ? `Time: ${new Date(context[0].parsed.x).toLocaleTimeString('en-NZ')}` : '', label: (context) => { let label = context.dataset.label || ''; if (label) label += ': '; if (context.parsed.y !== null) label += `${context.parsed.y.toFixed(1)}%`; if (context.dataset.label === 'Spot The Aurora Forecast') label += ' (Final Score)'; else if (context.dataset.label === 'Base Score') label += ' (Raw Calculation)'; return label; } } }, annotation: { annotations, drawTime: 'afterDatasetsDraw' } }, scales: { x: { type: 'time', min: startTime, max: now, ticks: { color: '#71717a', source: 'auto' }, grid: { color: '#3f3f46' } }, y: { type: 'linear', min: 0, max: 100, ticks: { color: '#71717a', callback: (value: any) => `${value}%` }, grid: { color: '#3f3f46' }, title: { display: true, text: 'Aurora Score (%)', color: '#a3a3a3' } } } };
    }, [auroraScoreChartTimeRange, celestialTimes]);

    const auroraScoreChartData = useMemo(() => { if (auroraScoreHistory.length === 0) return { datasets: [] }; const getForecastGradient = (ctx: ScriptableContext<'line'>) => { const chart = ctx.chart; const { ctx: chartCtx, chartArea } = chart; if (!chartArea) return undefined; const gradient = chartCtx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top); const score0 = ctx.p0?.parsed?.y ?? 0; const score1 = ctx.p1?.parsed?.y ?? 0; const colorKey0 = getForecastScoreColorKey(score0); const colorKey1 = getForecastScoreColorKey(score1); gradient.addColorStop(0, GAUGE_COLORS[colorKey0].semi); gradient.addColorStop(1, GAUGE_COLORS[colorKey1].semi); return gradient; }; return { datasets: [ { label: 'Spot The Aurora Forecast', data: auroraScoreHistory.map(d => ({ x: d.timestamp, y: d.finalScore })), borderColor: 'transparent', backgroundColor: getForecastGradient, fill: 'origin', tension: 0.2, pointRadius: 0, borderWidth: 0, spanGaps: true, order: 1, }, { label: 'Base Score', data: auroraScoreHistory.map(d => ({ x: d.timestamp, y: d.baseScore })), borderColor: 'rgba(255, 255, 255, 1)', backgroundColor: 'transparent', fill: false, tension: 0.2, pointRadius: 0, borderWidth: 1, borderDash: [5, 5], spanGaps: true, order: 2, } ], }; }, [auroraScoreHistory]);

    if (isLoading) { return <div className="w-full h-full flex justify-center items-center bg-neutral-900"><LoadingSpinner /></div>; }

    const faqContent = ( <div className="space-y-4"> <div><h4 className="font-bold text-neutral-200">Why don't you use the Kp-index?</h4><p>The Kp-index is a fantastic tool for measuring global geomagnetic activity, but it's not real-time. It is an average calculated every 3 hours, so it often describes what *has already happened*. For a live forecast, we need data that's updated every minute. Relying on the Kp-index would be like reading yesterday's weather report to decide if you need an umbrella right now.</p></div><div><h4 className="font-bold text-neutral-200">What data SHOULD I look at then?</h4><p>The most critical live data points for aurora nowcasting are:</p><ul className="list-disc list-inside pl-2 mt-1"><li><strong>IMF Bz:</strong> The "gatekeeper". A strong negative (southward) value opens the door for the aurora.</li><li><strong>Solar Wind Speed:</strong> The "power". Faster speeds lead to more energetic and dynamic displays.</li><li><strong>Solar Wind Density:</strong> The "thickness". Higher density can result in a brighter, more widespread aurora.</li></ul></div><div><h4 className="font-bold text-neutral-200">The forecast is high but I can't see anything. Why?</h4><p>This can happen for several reasons! The most common are:</p><ul className="list-disc list-inside pl-2 mt-1"><li><strong>Clouds:</strong> The number one enemy of aurora spotting. Use the cloud map on this dashboard to check for clear skies.</li><li><strong>Light Pollution:</strong> You must be far away from city and town lights.</li><li><strong>The Moon:</strong> A bright moon can wash out all but the most intense auroras.</li><li><strong>Eye Adaptation:</strong> It takes at least 15-20 minutes in total darkness for your eyes to become sensitive enough to see faint glows.</li><li><strong>Patience:</strong> Auroral activity happens in waves (substorms). A quiet period can be followed by an intense outburst.</li></ul></div><div><h4 className="font-bold text-neutral-200">Where does your data come from?</h4><p>All our live solar wind and magnetic field data comes directly from NASA and NOAA, sourced from satellites positioned 1.5 million km from Earth, like the DSCOVR and ACE spacecraft. This dashboard fetches new data every minute. The "Spot The Aurora Forecast" score is then calculated using a proprietary algorithm that combines this live data with local factors for the West Coast of NZ.</p></div></div> );

    return (
        <div className="w-full h-full bg-neutral-900 text-neutral-300 p-5 overflow-y-auto relative" style={{ backgroundImage: `url('/background-aurora.jpg')`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed' }}>
            <div className="absolute inset-0 bg-black/50 z-0"></div>
            <div className="container mx-auto relative z-10">
                <header className="text-center mb-8">
                    <a href="https://www.tnrprotography.co.nz" target="_blank" rel="noopener noreferrer"><img src="https://www.tnrprotography.co.nz/uploads/1/3/6/6/136682089/white-tnr-protography-w_orig.png" alt="TNR Protography Logo" className="mx-auto w-full max-w-[250px] mb-4"/></a>
                    <h1 className="text-3xl font-bold text-neutral-100">Spot The Aurora - West Coast Aurora Forecast</h1>
                </header>
                <main className="grid grid-cols-12 gap-6">
                    <div className="col-span-12 card bg-neutral-950/80 p-6 md:grid md:grid-cols-2 md:gap-8 items-center">
                        <div>
                            <div className="flex items-center mb-4"><h2 className="text-lg font-semibold text-white">Spot The Aurora Forecast</h2><button onClick={() => openModal('forecast')} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button></div>
                            <div className="text-6xl font-extrabold text-white">{auroraScore !== null ? `${auroraScore.toFixed(1)}%` : '...'} <span className="text-5xl">{getAuroraEmoji(auroraScore)}</span></div>
                            <div className="w-full bg-neutral-700 rounded-full h-3 mt-4"><div className="h-3 rounded-full" style={{ width: `${auroraScore !== null ? getGaugeStyle(auroraScore, 'power').percentage : 0}%`, backgroundColor: auroraScore !== null ? getGaugeStyle(auroraScore, 'power').color : GAUGE_COLORS.gray.solid }}></div></div>
                            <div className="text-sm text-neutral-400 mt-2">{lastUpdated}</div>
                        </div>
                        <p className="text-neutral-300 mt-4 md:mt-0">{isDaylight ? "The sun is currently up. Aurora visibility is not possible until after sunset. Check back later for an updated forecast!" : auroraBlurb}</p>
                    </div>

                    <div className="col-span-12 grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="card bg-neutral-950/80 p-4">
                            <div className="flex items-center justify-between cursor-pointer" onClick={() => setIsTipsOpen(!isTipsOpen)}><h2 className="text-xl font-bold text-neutral-100">Tips for West Coast Spotting</h2><button className="p-2 rounded-full text-neutral-300 hover:bg-neutral-700/60 transition-colors"><CaretIcon className={`w-6 h-6 transform transition-transform duration-300 ${isTipsOpen ? 'rotate-180' : 'rotate-0'}`} /></button></div>
                            <div className={`transition-all duration-500 ease-in-out overflow-hidden ${isTipsOpen ? 'max-h-[150vh] opacity-100 mt-4' : 'max-h-0 opacity-0'}`}><ul className="space-y-3 text-neutral-300 text-sm list-disc list-inside pl-2"><li><strong>Look South:</strong> The aurora will always appear in the southern sky from New Zealand.</li><li><strong>Escape Light Pollution:</strong> Get as far away from city lights as possible.</li><li><strong>Check the Cloud Cover:</strong> Use the live cloud map on this dashboard.</li><li><strong>Let Your Eyes Adapt:</strong> Turn off all lights for at least 15-20 minutes.</li><li><strong>The Camera Sees More:</strong> Your camera is much more sensitive than your eyes.</li><li><strong>New Moon is Best:</strong> Check the moon illumination gauge.</li><li><strong>Be Patient & Persistent:</strong> Auroral activity ebbs and flows.</li></ul></div>
                        </div>
                        <div className="card bg-neutral-950/80 p-4">
                            <div className="flex items-center justify-between cursor-pointer" onClick={() => setIsCameraSettingsOpen(!isCameraSettingsOpen)}><h2 className="text-xl font-bold text-neutral-100">Suggested Camera Settings</h2><button className="p-2 rounded-full text-neutral-300 hover:bg-neutral-700/60 transition-colors"><CaretIcon className={`w-6 h-6 transform transition-transform duration-300 ${isCameraSettingsOpen ? 'rotate-180' : 'rotate-0'}`} /></button></div>
                            <div className={`transition-all duration-500 ease-in-out overflow-hidden ${isCameraSettingsOpen ? 'max-h-[150vh] opacity-100 mt-4' : 'max-h-0 opacity-0'}`}><p className="text-neutral-400 text-center mb-6">{cameraSettings.overall}</p></div>
                        </div>
                    </div>

                    <AuroraSightings isDaylight={isDaylight} />

                    <div className="col-span-12 card bg-neutral-950/80 p-4">
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <div className="lg:col-span-2 h-[450px] flex flex-col">
                                <div className="flex justify-center items-center gap-2"><h2 className="text-xl font-semibold text-white text-center">GOES Magnetometer (Substorm-watch)</h2><button onClick={() => openModal('goes-mag')} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button></div>
                                <TimeRangeButtons onSelect={(duration, label) => { setMagnetometerTimeRange(duration); setMagnetometerTimeLabel(label); }} selected={magnetometerTimeRange} />
                                <div className="flex-grow relative mt-2">
                                    {loadingMagnetometer ? <p className="text-center pt-10 text-neutral-400 italic">{loadingMagnetometer}</p> : <Line data={magnetometerChartData} options={magnetometerOptions} />}
                                </div>
                            </div>
                            <div className="lg:col-span-1 flex flex-col justify-center items-center bg-neutral-900/50 p-4 rounded-lg">
                                <h3 className="text-lg font-semibold text-neutral-200 mb-2">Magnetic Field Analysis</h3>
                                <p className={`text-center text-lg ${substormBlurb.color}`}>{substormBlurb.text}</p>
                            </div>
                        </div>
                    </div>
                    
                    <div className="col-span-12 card bg-neutral-950/80 p-4 h-[400px] flex flex-col">
                        <h2 className="text-xl font-semibold text-white text-center">Spot The Aurora Forecast Trend (Last {auroraScoreChartTimeLabel})</h2>
                        <TimeRangeButtons onSelect={(duration, label) => { setAuroraScoreChartTimeRange(duration); setAuroraScoreChartTimeLabel(label); }} selected={auroraScoreChartTimeRange} />
                        <div className="flex-grow relative mt-2">
                            {auroraScoreHistory.length > 0 ? ( <Line data={auroraScoreChartData} options={auroraScoreChartOptions} /> ) : ( <p className="text-center pt-10 text-neutral-400 italic">No historical forecast data available.</p> )}
                        </div>
                    </div>

                    <div className="col-span-12 grid grid-cols-6 gap-5">
                        {Object.entries(gaugeData).map(([key, data]) => (
                            <div key={key} className="col-span-3 md:col-span-2 lg:col-span-1 card bg-neutral-950/80 p-4 text-center flex flex-col justify-between">
                                <div className="flex justify-center items-center"><h3 className="text-md font-semibold text-white h-10 flex items-center justify-center">{key === 'moon' ? 'Moon' : key.toUpperCase()}</h3><button onClick={() => openModal(key)} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button></div>
                                <div className="font-bold my-2" dangerouslySetInnerHTML={{ __html: data.value }}></div>
                                <div className="text-3xl my-2">{data.emoji}</div>
                                <div className="w-full bg-neutral-700 rounded-full h-3 mt-4"><div className="h-3 rounded-full" style={{ width: `${data.percentage}%`, backgroundColor: data.color }}></div></div>
                                <div className="text-xs text-neutral-500 mt-2 truncate" title={data.lastUpdated}>{data.lastUpdated}</div>
                            </div>
                        ))}
                    </div>

                    <div className="col-span-12 lg:col-span-6 card bg-neutral-950/80 p-4 h-[500px] flex flex-col">
                        <h2 className="text-xl font-semibold text-white text-center">Live Solar Wind (Last {solarWindTimeLabel})</h2>
                        <TimeRangeButtons onSelect={(duration, label) => { setSolarWindTimeRange(duration); setSolarWindTimeLabel(label); }} selected={solarWindTimeRange} />
                        <div className="flex-grow relative mt-2">
                            {allPlasmaData.length > 0 ? <Line data={solarWindChartData} options={solarWindOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">Solar wind data unavailable.</p>}
                        </div>
                    </div>
                    <div className="col-span-12 lg:col-span-6 card bg-neutral-950/80 p-4 h-[500px] flex flex-col">
                        <h2 className="text-xl font-semibold text-white text-center">Live Interplanetary Magnetic Field (Last {magneticFieldTimeLabel})</h2>
                        <TimeRangeButtons onSelect={(duration, label) => { setMagneticFieldTimeRange(duration); setMagneticFieldTimeLabel(label); }} selected={magneticFieldTimeRange} />
                         <div className="flex-grow relative mt-2">
                            {allMagneticData.length > 0 ? <Line data={magneticFieldChartData} options={magneticFieldOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">IMF data unavailable.</p>}
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
                    <p className="max-w-3xl mx-auto leading-relaxed">This dashboard provides a highly localized, 2-hour aurora forecast specifically for the West Coast of New Zealand...</p>
                    <div className="mt-6">
                        <button onClick={() => setIsFaqOpen(true)} className="flex items-center gap-2 mx-auto px-4 py-2 bg-neutral-800/80 border border-neutral-700/60 rounded-lg text-neutral-300 hover:bg-neutral-700/90 transition-colors">
                            <GuideIcon className="w-5 h-5" />
                            <span>Frequently Asked Questions</span>
                        </button>
                    </div>
                    <div className="mt-8 text-xs text-neutral-500"><p>Data provided by NOAA SWPC & NASA | Weather by Windy.com | Camera by Roundshot</p><p className="mt-2">Forecast Algorithm, Visualization, and Development by TNR Protography</p></div>
                </footer>
             </div>
            {modalState && <InfoModal isOpen={modalState.isOpen} onClose={closeModal} title={modalState.title} content={modalState.content} />}
            <InfoModal isOpen={isFaqOpen} onClose={() => setIsFaqOpen(false)} title="Frequently Asked Questions" content={faqContent} />
        </div>
    );
};

export default ForecastDashboard;