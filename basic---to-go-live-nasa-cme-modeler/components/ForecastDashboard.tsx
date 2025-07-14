import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import CloseIcon from './icons/CloseIcon';
import CaretIcon from './icons/CaretIcon';
import { ChartOptions, ScriptableContext } from 'chart.js';
import { enNZ } from 'date-fns/locale';
import LoadingSpinner from './icons/LoadingSpinner';
import AuroraSightings from './AuroraSightings';
import AuroraBackground from './AuroraBackground'; // Import the background

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
const REFRESH_INTERVAL_MS = 60 * 1000; // 1 minute

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

// --- Helper functions for dynamic graph colors ---
const getPositiveScaleColorKey = (value: number, thresholds: { [key: string]: number }) => {
    if (value >= thresholds.purple) return 'purple';
    if (value >= thresholds.red) return 'red';
    if (value >= thresholds.orange) return 'orange';
    if (value >= thresholds.yellow) return 'yellow';
    return 'gray';
};

// Get Forecast Score Color Key based on the score description tiers
const getForecastScoreColorKey = (score: number): keyof typeof GAUGE_COLORS => {
    if (score >= 80) return 'pink'; // 80%+ 🤩
    if (score >= 50) return 'red';  // 50-80% 😀
    if (score >= 40) return 'orange'; // 40-50% 🙂
    if (score >= 25) return 'yellow'; // 25-40% 😊
    if (score >= 10) return 'gray'; // 10-25% 😐 (Using gray for minimal, as yellow is for 25-40)
    return 'gray'; // < 10% 😞 (Default gray)
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

// Camera Settings Helper Function - MODIFIED LOGIC
const getSuggestedCameraSettings = (score: number | null) => {
    // Determine the base settings based on score tiers
    let baseSettings: any;
    if (score === null || score < 10) { // Unlikely to get any visibility on camera
        baseSettings = {
            overall: "Very low activity expected. It's highly unlikely to capture the aurora with any camera. These settings are for extreme attempts.",
            phone: {
                android: {
                    iso: "3200-6400 (Max)",
                    shutter: "20-30s",
                    aperture: "Lowest f-number",
                    focus: "Infinity",
                    wb: "Auto or 3500K-4000K",
                    pros: ["Might pick up an extremely faint, indiscernible glow."],
                    cons: ["Very high noise, significant star trails, motion blur, unlikely to see anything substantial. Results may just be faint light pollution."],
                },
                apple: {
                    iso: "Auto (max Night Mode)",
                    shutter: "Longest Night Mode auto-exposure (10-30s)",
                    aperture: "N/A (fixed)",
                    focus: "Infinity",
                    wb: "Auto or 3500K-4000K",
                    pros: ["Simple to try with Night Mode."],
                    cons: ["Limited control, very high noise, very unlikely to yield any recognizable aurora."],
                },
            },
            dslr: {
                iso: "6400-12800", // Pushing ISO higher for faint conditions
                shutter: "20-30s",
                aperture: "f/2.8-f/4 (widest)",
                focus: "Manual to Infinity",
                wb: "3500K-4500K",
                pros: ["Maximizes light gathering for extremely faint conditions."],
                cons: ["Extremely high ISO noise will be very apparent.", "Long exposure causes star trails."],
            },
        };
    } else if (score < 20) { // Below 20% - phone unlikely to get photos
         baseSettings = {
            overall: "Minimal activity expected. A DSLR/Mirrorless camera might capture a faint glow, but phones will likely struggle to show anything.",
            phone: {
                android: {
                    iso: "3200-6400 (Max)",
                    shutter: "15-30s",
                    aperture: "Lowest f-number",
                    focus: "Infinity",
                    wb: "Auto or 3500K-4000K",
                    pros: ["Might detect very faint light not visible to the eye."],
                    cons: ["High noise, long exposures lead to star trails. Aurora may be indiscernible."],
                },
                apple: {
                    iso: "Auto (max Night Mode)",
                    shutter: "Longest Night Mode auto-exposure (10-30s)",
                    aperture: "N/A (fixed)",
                    focus: "Infinity",
                    wb: "Auto or 3500K-4000K",
                    pros: ["Simple to attempt using Night Mode."],
                    cons: ["Limited manual control. Photos will be very noisy and may not show discernible aurora."],
                },
            },
            dslr: {
                iso: "3200-6400",
                shutter: "15-25s",
                aperture: "f/2.8-f/4 (widest)",
                focus: "Manual to Infinity",
                wb: "3500K-4500K",
                pros: ["Better light gathering than phones, higher chance for a faint detection."],
                cons: ["High ISO can introduce significant noise.", "Long exposure causes star trails."],
            },
        };
    } else if (score >= 80) { // High probability of a significant substorm (80%+)
        baseSettings = {
            overall: "High probability of a bright, active aurora! Aim for shorter exposures to capture detail and movement.",
            phone: {
                android: {
                    iso: "400-800",
                    shutter: "1-5s",
                    aperture: "Lowest f-number",
                    focus: "Infinity",
                    wb: "Auto or 3500K-4000K",
                    pros: ["Captures dynamic movement with less blur.", "Lower noise.", "Vibrant colors."],
                    cons: ["May still struggle with extreme brightness or very fast movement."],
                },
                apple: {
                    iso: "Auto or 500-1500 (in third-party app)",
                    shutter: "1-3s (or what auto-selects)",
                    aperture: "N/A (fixed)",
                    focus: "Infinity",
                    wb: "Auto or 3500K-4000K",
                    pros: ["Quick results, good for dynamic displays.", "Built-in processing handles noise well."],
                    cons: ["Less manual control than Android Pro mode for precise settings."],
                },
            },
            dslr: {
                iso: "800-1600",
                shutter: "1-5s",
                aperture: "f/2.8 (or your widest)",
                focus: "Manual to Infinity",
                wb: "3500K-4500K",
                pros: ["Stunning detail, vibrant colors.", "Can capture movement without blur.", "Minimal noise."],
                cons: ["May need quick adjustments for fluctuating brightness."],
            },
        };
    } else { // All other cases (20-80%) - general activity, phones likely can capture
        baseSettings = {
            overall: "Moderate activity expected. Good chance for visible aurora. Balance light capture with motion.",
            phone: {
                android: {
                    iso: "800-1600",
                    shutter: "5-10s",
                    aperture: "Lowest f-number",
                    focus: "Infinity",
                    wb: "Auto or 3500K-4000K",
                    pros: ["Better detail and color than faint conditions.", "Less motion blur than very long exposures."],
                    cons: ["Still limited dynamic range compared to DSLR."],
                },
                apple: {
                    iso: "Auto (let it choose), or 1000-2000 (in manual app)",
                    shutter: "3-7s (or what auto selects)",
                    aperture: "N/A (fixed)",
                    focus: "Infinity",
                    wb: "Auto or 3500K-4000K",
                    pros: ["Good balance, easier to get usable shots.", "Built-in processing helps with noise."],
                    cons: ["Less control over very fast-moving aurora."],
                },
            },
            dslr: {
                iso: "1600-3200",
                shutter: "5-15s",
                aperture: "f/2.8-f/4 (widest)",
                focus: "Manual to Infinity",
                wb: "3500K-4500K",
                pros: ["Excellent detail, good color, less noise than faint settings.", "Good for capturing movement."],
                cons: ["Can still get light pollution if exposure is too long."],
            },
        };
    }
    return baseSettings;
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
        moon: { value: '...', unit: '%', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' }, // Initial default for moon
    });
    
    const [allPlasmaData, setAllPlasmaData] = useState<any[]>([]);
    const [allMagneticData, setAllMagneticData] = useState<any[]>([]);
    
    const [solarWindChartData, setSolarWindChartData] = useState<any>({ datasets: [] });
    const [magneticFieldChartData, setMagneticFieldChartData] = useState<any>({ datasets: [] });
    
    // MODIFIED: Decoupled time range state for each graph
    const [solarWindTimeRange, setSolarWindTimeRange] = useState<number>(6 * 3600000);
    const [solarWindTimeLabel, setSolarWindTimeLabel] = useState<string>('6 Hr');
    const [magneticFieldTimeRange, setMagneticFieldTimeRange] = useState<number>(6 * 3600000);
    const [magneticFieldTimeLabel, setMagneticFieldTimeLabel] = useState<string>('6 Hr');
    
    const [modalState, setModalState] = useState<{ isOpen: boolean; title: string; content: string } | null>(null);
    const [epamImageUrl, setEpamImageUrl] = useState<string>('/placeholder.png');

    // NEW: State for camera settings visibility
    const [isCameraSettingsOpen, setIsCameraSettingsOpen] = useState(false);
    // NEW: State for Aurora Score Historical Data
    const [auroraScoreHistory, setAuroraScoreHistory] = useState<{ timestamp: number; baseScore: number; finalScore: number; }[]>([]);
    const [auroraScoreChartTimeRange, setAuroraScoreChartTimeRange] = useState<number>(6 * 3600000);
    const [auroraScoreChartTimeLabel, setAuroraScoreChartTimeLabel] = useState<string>('6 Hr');

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
        if (v == null || isNaN(v)) {
            return { color: GAUGE_COLORS.gray.solid, emoji: GAUGE_EMOJIS.error, percentage: 0 };
        }

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
    
    // --- Data Fetching & Processing Effects ---
    const fetchAllData = useCallback(async (isInitialLoad = false) => {
        if (isInitialLoad) setIsLoading(true);

        const results = await Promise.allSettled([
            fetch(`${FORECAST_API_URL}?_=${Date.now()}`).then(res => res.json()),
            fetch(`${NOAA_PLASMA_URL}?_=${Date.now()}`).then(res => res.json()),
            fetch(`${NOAA_MAG_URL}?_=${Date.now()}`).then(res => res.json()),
        ]);

        const [forecastResult, plasmaResult, magResult] = results;

        // --- Process Forecast Data ---
        if (forecastResult.status === 'fulfilled' && forecastResult.value) { // Check for value existence
            const { currentForecast, historicalData } = forecastResult.value;

            const currentScore = currentForecast?.spotTheAuroraForecast ?? null;
            setAuroraScore(currentScore);
            setLastUpdated(`Last Updated: ${formatNZTimestamp(currentForecast?.lastUpdated ?? 0)}`);
            setAuroraBlurb(getAuroraBlurb(currentScore ?? 0));
            const { bt, bz } = currentForecast?.inputs?.magneticField ?? {};
            setGaugeData(prev => ({
                ...prev,
                power: { ...prev.power, value: currentForecast?.inputs?.hemisphericPower?.toFixed(1) ?? 'N/A', ...getGaugeStyle(currentForecast?.inputs?.hemisphericPower ?? null, 'power'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast?.lastUpdated ?? 0)}` },
                bt: { ...prev.bt, value: bt?.toFixed(1) ?? 'N/A', ...getGaugeStyle(bt ?? null, 'bt'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast?.lastUpdated ?? 0)}` },
                bz: { ...prev.bz, value: bz?.toFixed(1) ?? 'N/A', ...getGaugeStyle(bz ?? null, 'bz'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast?.lastUpdated ?? 0)}` },
                // MODIFIED: Use moon object from currentForecast
                moon: getMoonData(currentForecast?.moon?.illumination ?? null, currentForecast?.moon?.rise ?? null, currentForecast?.moon?.set ?? null)
            }));

            // NEW: Set historical data for graph
            if (Array.isArray(historicalData)) {
                // Ensure historical data is sorted by timestamp and filtered for valid numbers
                const cleanedHistoricalData = historicalData
                    .filter((d: any) => typeof d.timestamp === 'number' && !isNaN(d.timestamp) &&
                                        typeof d.baseScore === 'number' && !isNaN(d.baseScore) &&
                                        typeof d.finalScore === 'number' && !isNaN(d.finalScore))
                    .sort((a: any, b: any) => a.timestamp - b.timestamp);
                setAuroraScoreHistory(cleanedHistoricalData);
            } else {
                setAuroraScoreHistory([]); // Clear if data is not an array
            }

        } else {
            console.error("Forecast data failed to load:", forecastResult.reason);
            setAuroraBlurb("Could not load forecast data.");
            setAuroraScoreHistory([]); // Clear history on error
        }

        // --- Process Plasma Data ---
        if (plasmaResult.status === 'fulfilled' && Array.isArray(plasmaResult.value) && plasmaResult.value.length > 1) {
            const plasmaData = plasmaResult.value;
            const plasmaHeaders = plasmaData[0];
            const speedIdx = plasmaHeaders.indexOf('speed');
            const densityIdx = plasmaHeaders.indexOf('density');
            const plasmaTimeIdx = plasmaHeaders.indexOf('time_tag');
            
            const latestPlasmaRow = plasmaData.slice(1).reverse().find((r: any[]) => parseFloat(r?.[speedIdx]) > -9999);
            const speedVal = latestPlasmaRow ? parseFloat(latestPlasmaRow[speedIdx]) : null;
            const densityVal = latestPlasmaRow ? parseFloat(latestPlasmaRow[densityIdx]) : null;
            const rawPlasmaTime = latestPlasmaRow?.[plasmaTimeIdx];
            const plasmaTimestamp = rawPlasmaTime ? new Date(rawPlasmaTime.replace(' ', 'T') + 'Z').getTime() : Date.now();
            setGaugeData(prev => ({
                ...prev,
                speed: { ...prev.speed, value: speedVal?.toFixed(1) ?? 'N/A', ...getGaugeStyle(speedVal, 'speed'), lastUpdated: `Updated: ${formatNZTimestamp(plasmaTimestamp)}` },
                density: { ...prev.density, value: densityVal?.toFixed(1) ?? 'N/A', ...getGaugeStyle(densityVal, 'density'), lastUpdated: `Updated: ${formatNZTimestamp(plasmaTimestamp)}` }
            }));
            const plasmaPoints = plasmaData.slice(1).map((r:any[]) => { const rawTime = r[plasmaTimeIdx]; const cleanTime = new Date(rawTime.replace(' ', 'T') + 'Z').getTime(); return { time: cleanTime, speed: parseFloat(r[speedIdx]) > -9999 ? parseFloat(r[speedIdx]) : null, density: parseFloat(r[densityIdx]) > -9999 ? parseFloat(r[densityIdx]) : null, } });
            setAllPlasmaData(plasmaPoints);
        } else {
             console.error("Plasma data failed to load:", plasmaResult.reason);
             setAllPlasmaData([]); // Clear old data
        }

        // --- Process Magnetic Field Data ---
        if (magResult.status === 'fulfilled' && Array.isArray(magResult.value) && magResult.value.length > 1) {
            const magData = magResult.value;
            const magHeaders = magData[0];
            const magBtIdx = magHeaders.indexOf('bt');
            const magBzIdx = magHeaders.indexOf('bz_gsm');
            const magTimeIdx = magHeaders.indexOf('time_tag');
            const magPoints = magData.slice(1).map((r: any[]) => { const rawTime = r[magTimeIdx]; const cleanTime = new Date(rawTime.replace(' ', 'T') + 'Z').getTime(); return { time: cleanTime, bt: parseFloat(r[magBtIdx]) > -9999 ? parseFloat(r[magBtIdx]) : null, bz: parseFloat(r[magBzIdx]) > -9999 ? parseFloat(r[magBzIdx]) : null }; });
            setAllMagneticData(magPoints);
        } else {
            console.error("Magnetic data failed to load:", magResult.reason);
            setAllMagneticData([]); // Clear old data
        }
        
        setEpamImageUrl(`${ACE_EPAM_URL}?_=${Date.now()}`);
        if (isInitialLoad) setIsLoading(false);
    }, [getGaugeStyle]);

    useEffect(() => {
        fetchAllData(true);
        const interval = setInterval(() => fetchAllData(false), REFRESH_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [fetchAllData]);

    const getAuroraBlurb = (score: number) => { if (score < 10) return 'Little to no auroral activity.'; if (score < 25) return 'Minimal auroral activity likely.'; if (score < 40) return 'Clear auroral activity visible in cameras.'; if (score < 50) return 'Faint auroral glow potentially visible to the naked eye.'; if (score < 80) return 'Good chance of naked-eye color and structure.'; return 'High probability of a significant substorm.'; };
    
    // MODIFIED: Updated to accept rise, set, illumination and format with carets
    const getMoonData = (illumination: number | null, riseTime: number | null, setTime: number | null) => { 
        const moonIllumination = Math.max(0, (illumination ?? 0) ); // Direct illumination value
        let moonEmoji = '🌑'; 
        if (moonIllumination > 95) moonEmoji = '🌕'; 
        else if (moonIllumination > 55) moonEmoji = '🌖'; 
        else if (moonIllumination > 45) moonEmoji = '🌗'; 
        else if (moonIllumination > 5) moonEmoji = '🌒'; 
        
        const riseStr = riseTime ? new Date(riseTime).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' }) : 'N/A';
        const setStr = setTime ? new Date(setTime).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' }) : 'N/A';
        
        // Extract the path from CaretIcon.tsx for embedding as a string
        const caretSvgPath = `M19.5 8.25l-7.5 7.5-7.5-7.5`; // Path for a downward caret

        const CaretUpSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" class="w-3 h-3 inline-block align-middle" style="transform: rotate(180deg);"><path stroke-linecap="round" stroke-linejoin="round" d="${caretSvgPath}" /></svg>`;
        const CaretDownSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" class="w-3 h-3 inline-block align-middle"><path stroke-linecap="round" stroke-linejoin="round" d="${caretSvgPath}" /></svg>`;

        // NEW: Smaller font size and no text for rise/set
        const displayValue = `<span class="text-xl">${moonIllumination.toFixed(0)}%</span><br/><span class='text-xs'>${CaretUpSvg} ${riseStr}   ${CaretDownSvg} ${setStr}</span>`;
        const lastUpdated = `Updated: ${formatNZTimestamp(Date.now())}`;

        return { value: displayValue, unit: '', emoji: moonEmoji, percentage: moonIllumination, lastUpdated: lastUpdated, color: '#A9A9A9' }; 
    };
    
    useEffect(() => {
        // NEW: Conditional tension based on timeRange
        const lineTension = (range: number) => range >= (12 * 3600000) ? 0.1 : 0.3; // Lower tension for 12hr+ ranges

        if (allPlasmaData.length > 0) { 
            setSolarWindChartData({ 
                datasets: [ 
                    { 
                        label: 'Speed', 
                        data: allPlasmaData.map(p => ({ x: p.time, y: p.speed })), 
                        yAxisID: 'y', order: 1, fill: 'origin', 
                        borderWidth: 1.5, pointRadius: 0, 
                        tension: lineTension(solarWindTimeRange), // Use specific time range
                        segment: { borderColor: (ctx: ScriptableContext<'line'>) => GAUGE_COLORS[getPositiveScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.speed)].solid, backgroundColor: (ctx: ScriptableContext<'line'>) => createGradient(ctx.chart.ctx, ctx.chart.chartArea, getPositiveScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.speed)), } 
                    }, 
                    { 
                        label: 'Density', 
                        data: allPlasmaData.map(p => ({ x: p.time, y: p.density })), 
                        yAxisID: 'y1', order: 0, fill: 'origin', 
                        borderWidth: 1.5, pointRadius: 0, 
                        tension: lineTension(solarWindTimeRange), // Use specific time range
                        segment: { borderColor: (ctx: ScriptableContext<'line'>) => GAUGE_COLORS[getPositiveScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.density)].solid, backgroundColor: (ctx: ScriptableContext<'line'>) => createGradient(ctx.chart.ctx, ctx.chart.chartArea, getPositiveScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.density)), } 
                    } 
                ] 
            }); 
        }
        if (allMagneticData.length > 0) { 
            setMagneticFieldChartData({ 
                datasets: [ 
                    { 
                        label: 'Bt', 
                        data: allMagneticData.map(p => ({ x: p.time, y: p.bt })), 
                        order: 1, fill: 'origin', 
                        borderWidth: 1.5, pointRadius: 0, 
                        tension: lineTension(magneticFieldTimeRange), // Use specific time range
                        segment: { borderColor: (ctx: ScriptableContext<'line'>) => GAUGE_COLORS[getPositiveScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.bt)].solid, backgroundColor: (ctx: ScriptableContext<'line'>) => createGradient(ctx.chart.ctx, ctx.chart.chartArea, getPositiveScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.bt)), } 
                    }, 
                    { 
                        label: 'Bz', 
                        data: allMagneticData.map(p => ({ x: p.time, y: p.bz })), 
                        order: 0, fill: 'origin', 
                        borderWidth: 1.5, pointRadius: 0, 
                        tension: lineTension(magneticFieldTimeRange), // Use specific time range
                        segment: { borderColor: (ctx: ScriptableContext<'line'>) => GAUGE_COLORS[getBzScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.bz)].solid, backgroundColor: (ctx: ScriptableContext<'line'>) => createGradient(ctx.chart.ctx, ctx.chart.chartArea, getBzScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.bz)), } 
                    } 
                ] 
            }); 
        }
    }, [allPlasmaData, allMagneticData, solarWindTimeRange, magneticFieldTimeRange]); // Update dependency array

    const createChartOptions = useCallback((rangeMs: number, isDualAxis: boolean): ChartOptions<'line'> => {
        const now = Date.now();
        const startTime = now - rangeMs;
        const options: ChartOptions<'line'> = {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false, axis: 'x' },
            plugins: { legend: { labels: { color: '#a1a1aa' }}, tooltip: { mode: 'index', intersect: false } },
            scales: { x: { type: 'time', min: startTime, max: now, ticks: { color: '#71717a', source: 'auto' }, grid: { color: '#3f3f46' } } }
        };

        if (isDualAxis) {
            options.scales = { ...options.scales, y: { type: 'linear', position: 'left', ticks: { color: '#a3a3a3' }, grid: { color: '#3f3f46' }, title: { display: true, text: 'Speed (km/s)', color: '#a3a3a3' } }, y1: { type: 'linear', position: 'right', ticks: { color: '#a3a3a3' }, grid: { drawOnChartArea: false }, title: { display: true, text: 'Density (p/cm³)', color: '#a3a3a3' } } };
        } else {
             options.scales = { ...options.scales, y: { type: 'linear', position: 'left', ticks: { color: '#a3a3a3' }, grid: { color: '#3f3f46' }, title: { display: true, text: 'Magnetic Field (nT)', color: '#a3a3a3' } } };
        }
        return options;
    }, []);
    
    const solarWindOptions = useMemo(() => createChartOptions(solarWindTimeRange, true), [solarWindTimeRange, createChartOptions]);
    const magneticFieldOptions = useMemo(() => createChartOptions(magneticFieldTimeRange, false), [magneticFieldTimeRange, createChartOptions]);

    const cameraSettings = useMemo(() => getSuggestedCameraSettings(auroraScore), [auroraScore]);

    // NEW: Aurora Score Chart Options
    const auroraScoreChartOptions = useMemo((): ChartOptions<'line'> => {
        const now = Date.now();
        const startTime = now - auroraScoreChartTimeRange;
        return {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false, axis: 'x' },
            plugins: {
                legend: { labels: { color: '#a1a1aa' }}, // Enable legend for both lines
                tooltip: {
                    callbacks: {
                        title: (context) => {
                            if (context.length > 0) {
                                return `Time: ${new Date(context[0].parsed.x).toLocaleTimeString('en-NZ')}`;
                            }
                            return '';
                        },
                        label: (context) => {
                            let label = context.dataset.label || '';
                            if (label) { label += ': '; }
                            if (context.parsed.y !== null) { label += `${context.parsed.y.toFixed(1)}%`; }
                            // Add distinction for the tooltip
                            if (context.dataset.label === 'Spot The Aurora Forecast') {
                                label += ' (Final Score)';
                            } else if (context.dataset.label === 'Base Score') {
                                label += ' (Raw Calculation)';
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    min: startTime,
                    max: now,
                    ticks: { color: '#71717a', source: 'auto' },
                    grid: { color: '#3f3f46' }
                },
                y: {
                    type: 'linear',
                    min: 0,
                    max: 100,
                    ticks: { color: '#71717a', callback: (value: any) => `${value}%` },
                    grid: { color: '#3f3f46' },
                    title: { display: true, text: 'Aurora Score (%)', color: '#a3a3a3' }
                }
            }
        };
    }, [auroraScoreChartTimeRange]);

    // NEW: Aurora Score Chart Data
    const auroraScoreChartData = useMemo(() => {
        if (auroraScoreHistory.length === 0) return { datasets: [] };

        const getForecastGradient = (ctx: ScriptableContext<'line'>) => {
            const chart = ctx.chart;
            const { ctx: chartCtx, chartArea } = chart;
            if (!chartArea) return undefined;

            const gradient = chartCtx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
            // Safely get scores, default to 0 if not available
            const score0 = ctx.p0?.parsed?.y ?? 0;
            const score1 = ctx.p1?.parsed?.y ?? 0;

            const colorKey0 = getForecastScoreColorKey(score0);
            const colorKey1 = getForecastScoreColorKey(score1);

            // Add color stops for segment
            // This is a simplified linear interpolation between two point colors
            gradient.addColorStop(0, GAUGE_COLORS[colorKey0].semi); // Start color of the segment
            gradient.addColorStop(1, GAUGE_COLORS[colorKey1].semi); // End color of the segment

            return gradient;
        };


        return {
            datasets: [
                {
                    label: 'Spot The Aurora Forecast', // Corresponds to finalScore
                    data: auroraScoreHistory.map(d => ({ x: d.timestamp, y: d.finalScore })),
                    borderColor: 'transparent', // No line for the main forecast
                    backgroundColor: getForecastGradient, // Dynamic gradient fill
                    fill: 'origin',
                    tension: 0.2,
                    pointRadius: 0,
                    borderWidth: 0, // Ensure no border line
                    spanGaps: true,
                    order: 1, // Ensure this is on top
                },
                {
                    label: 'Base Score',
                    data: auroraScoreHistory.map(d => ({ x: d.timestamp, y: d.baseScore })),
                    borderColor: 'rgba(255, 255, 255, 1)', // Opaque white
                    backgroundColor: 'transparent',
                    fill: false,
                    tension: 0.2,
                    pointRadius: 0,
                    borderWidth: 1, // Thin line
                    borderDash: [5, 5], // Dotted line
                    spanGaps: true,
                    order: 2, // Behind forecast score
                }
            ],
        };
    }, [auroraScoreHistory]);


    if (isLoading) {
        return <div className="w-full h-full flex justify-center items-center bg-neutral-900"><LoadingSpinner /></div>;
    }

    return (
        <div className="w-full h-full bg-transparent text-neutral-300 p-5">
            <AuroraBackground />
            <div className="container mx-auto bg-neutral-950/50 backdrop-blur-sm p-4 rounded-lg">
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
                        <p className="text-neutral-300 mt-4 md:mt-0">{auroraBlurb}</p>
                    </div>

                    {/* NEW: Collapsible Camera Settings Section */}
                    <div className="col-span-12 card bg-neutral-950/80 p-4">
                        <div className="flex items-center justify-between cursor-pointer" onClick={() => setIsCameraSettingsOpen(!isCameraSettingsOpen)}>
                            <h2 className="text-xl font-bold text-neutral-100">Suggested Camera Settings</h2>
                            <div className="flex items-center gap-2">
                                {!isCameraSettingsOpen && (
                                    <p className="text-neutral-400 text-sm italic pr-2 max-w-sm overflow-hidden text-ellipsis whitespace-nowrap hidden sm:block">
                                        {cameraSettings.overall}
                                    </p>
                                )}
                                <button className="p-2 rounded-full text-neutral-300 hover:bg-neutral-700/60 transition-colors">
                                    <CaretIcon className={`w-6 h-6 transform transition-transform duration-300 ${isCameraSettingsOpen ? 'rotate-180' : 'rotate-0'}`} />
                                </button>
                            </div>
                        </div>
                        
                        <div className={`transition-all duration-500 ease-in-out overflow-hidden ${isCameraSettingsOpen ? 'max-h-[150vh] opacity-100 mt-4' : 'max-h-0 opacity-0'}`}>
                            <p className="text-neutral-400 text-center mb-6">{cameraSettings.overall}</p>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* Phone Settings */}
                                <div className="bg-neutral-900/70 p-4 rounded-lg border border-neutral-700/60">
                                    <h3 className="text-lg font-semibold text-neutral-200 mb-3">📱 Phone Camera</h3>
                                    <p className="text-neutral-400 text-sm mb-4">
                                        **General Phone Tips:** Use a tripod! Manual focus to infinity (look for a "mountain" or "star" icon in Pro/Night mode). Turn off flash.
                                    </p>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {/* Android */}
                                        <div className="bg-neutral-800/50 p-3 rounded-md border border-neutral-700/50">
                                            <h4 className="font-semibold text-neutral-300 mb-2">Android (Pro Mode)</h4>
                                            <ul className="text-xs space-y-1.5 text-neutral-400">
                                                <li>**ISO:** {cameraSettings.phone.android.iso}</li>
                                                <li>**Shutter Speed:** {cameraSettings.phone.android.shutter}</li>
                                                <li>**Aperture:** {cameraSettings.phone.android.aperture}</li>
                                                <li>**Focus:** {cameraSettings.phone.android.focus}</li>
                                                <li>**White Balance:** {cameraSettings.phone.android.wb}</li>
                                            </ul>
                                            <div className="mt-2 text-xs">
                                                <p className="text-green-400">**Pros:** {cameraSettings.phone.android.pros.join(' ')}</p>
                                                <p className="text-red-400">**Cons:** {cameraSettings.phone.android.cons.join(' ')}</p>
                                            </div>
                                        </div>
                                        {/* Apple */}
                                        <div className="bg-neutral-800/50 p-3 rounded-md border border-neutral-700/50">
                                            <h4 className="font-semibold text-neutral-300 mb-2">Apple (Night Mode / Third-Party Apps)</h4>
                                            <ul className="text-xs space-y-1.5 text-neutral-400">
                                                <li>**ISO:** {cameraSettings.phone.apple.iso}</li>
                                                <li>**Shutter Speed:** {cameraSettings.phone.apple.shutter}</li>
                                                <li>**Aperture:** {cameraSettings.phone.apple.aperture}</li>
                                                <li>**Focus:** {cameraSettings.phone.apple.focus}</li>
                                                <li>**White Balance:** {cameraSettings.phone.apple.wb}</li>
                                            </ul>
                                            <div className="mt-2 text-xs">
                                                <p className="text-green-400">**Pros:** {cameraSettings.phone.apple.pros.join(' ')}</p>
                                                <p className="text-red-400">**Cons:** {cameraSettings.phone.apple.cons.join(' ')}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                {/* DSLR/Mirrorless Settings */}
                                <div className="bg-neutral-900/70 p-4 rounded-lg border border-neutral-700/60">
                                    <h3 className="text-lg font-semibold text-neutral-200 mb-3">📷 DSLR / Mirrorless</h3>
                                    <p className="text-neutral-400 text-sm mb-4">
                                        **General DSLR Tips:** Use a sturdy tripod. Manual focus to infinity (use live view and magnify a distant star). Shoot in RAW for best quality.
                                    </p>
                                    <div className="bg-neutral-800/50 p-3 rounded-md border border-neutral-700/50">
                                        <h4 className="font-semibold text-neutral-300 mb-2">Recommended Settings</h4>
                                        <ul className="text-xs space-y-1.5 text-neutral-400">
                                            <li>**ISO:** {cameraSettings.dslr.iso}</li>
                                            <li>**Shutter Speed:** {cameraSettings.dslr.shutter}</li>
                                            <li>**Aperture:** {cameraSettings.dslr.aperture} (as wide as your lens allows)</li>
                                            <li>**Focus:** {cameraSettings.dslr.focus}</li>
                                            <li>**White Balance:** {cameraSettings.dslr.wb}</li>
                                        </ul>
                                        <div className="mt-2 text-xs">
                                            <p className="text-green-400">**Pros:** {cameraSettings.dslr.pros.join(' ')}</p>
                                            <p className="text-red-400">**Cons:** {cameraSettings.dslr.cons.join(' ')}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <p className="text-neutral-500 text-xs italic mt-6 text-center">
                                **Disclaimer:** These are starting points. Aurora activity, light pollution, moon phase, and your specific camera/lens will influence optimal settings. Experimentation is key!
                            </p>
                        </div>
                    </div>
                    {/* END NEW COLLAPSIBLE SECTION */}

                    {/* NEW: Aurora Score Trend Graph */}
                    <div className="col-span-12 card bg-neutral-950/80 p-4 h-[400px] flex flex-col">
                        <h2 className="text-xl font-semibold text-white text-center">Spot The Aurora Forecast Trend (Last {auroraScoreChartTimeLabel})</h2>
                        <TimeRangeButtons onSelect={(duration, label) => { setAuroraScoreChartTimeRange(duration); setAuroraScoreChartTimeLabel(label); }} selected={auroraScoreChartTimeRange} />
                        <div className="flex-grow relative mt-2">
                            {auroraScoreHistory.length > 0 ? (
                                <Line data={auroraScoreChartData} options={auroraScoreChartOptions} />
                            ) : (
                                <p className="text-center pt-10 text-neutral-400 italic">
                                    No historical forecast data available for the selected period.
                                </p>
                            )}
                        </div>
                    </div>
                    {/* END NEW GRAPH SECTION */}

                    <AuroraSightings />

                    <div className="col-span-12 grid grid-cols-6 gap-5">
                        {Object.entries(gaugeData).map(([key, data]) => (
                            <div key={key} className="col-span-3 md:col-span-2 lg:col-span-1 card bg-neutral-950/80 p-4 text-center flex flex-col justify-between">
                                <div className="flex justify-center items-center"><h3 className="text-md font-semibold text-white h-10 flex items-center justify-center">{key === 'moon' ? 'Moon' : key.toUpperCase()}</h3><button onClick={() => openModal(key)} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button></div>
                                {/* Moon value uses dangerouslySetInnerHTML because it contains <br/> tags */}
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
                            {solarWindChartData.datasets.length > 0 ? <Line data={solarWindChartData} options={solarWindOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">Solar wind data unavailable.</p>}
                        </div>
                    </div>
                    <div className="col-span-12 lg:col-span-6 card bg-neutral-950/80 p-4 h-[500px] flex flex-col">
                        <h2 className="text-xl font-semibold text-white text-center">Live Interplanetary Magnetic Field (Last {magneticFieldTimeLabel})</h2>
                        <TimeRangeButtons onSelect={(duration, label) => { setMagneticFieldTimeRange(duration); setMagneticFieldTimeLabel(label); }} selected={magneticFieldTimeRange} />
                         <div className="flex-grow relative mt-2">
                            {magneticFieldChartData.datasets.length > 0 ? <Line data={magneticFieldChartData} options={magneticFieldOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">IMF data unavailable.</p>}
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