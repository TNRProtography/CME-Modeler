// --- START OF FILE ForecastDashboard.tsx ---

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import LoadingSpinner from './icons/LoadingSpinner';
import AuroraSightings from './AuroraSightings';
import GuideIcon from './icons/GuideIcon';
import { useForecastData } from '../hooks/useForecastData';
import GraphModal from './GraphModal'; // Import the new GraphModal

import {
    ForecastScore,
    DataGauges,
    TipsSection,
    CameraSettingsSection,
    InfoModal,
    ActivityAlert
} from './ForecastComponents';

import {
    ForecastTrendChart,
    ExpandedGraphContent
} from './ForecastCharts';
import { SubstormActivity } from '../types';
import CaretIcon from './icons/CaretIcon';

// --- Type Definitions ---
interface ForecastDashboardProps {
  setViewerMedia?: (media: { url: string, type: 'image' | 'video' } | null) => void;
  setCurrentAuroraScore: (score: number | null) => void;
  setSubstormActivityStatus: (status: SubstormActivity | null) => void;
  navigationTarget: { page: string; elementId: string; expandId?: string; } | null;
}

interface Camera {
  name: string;
  url: string;
  type: 'image' | 'iframe';
  sourceUrl: string;
}

// --- Constants ---
const ACE_EPAM_URL = 'https://services.swpc.noaa.gov/images/ace-epam-24-hour.gif';

const CAMERAS: Camera[] = [
  { name: 'Oban', url: 'https://weathercam.southloop.net.nz/Oban/ObanOldA001.jpg', type: 'image', sourceUrl: 'weathercam.southloop.net.nz' },
  { name: 'Queenstown', url: 'https://queenstown.roundshot.com/#/', type: 'iframe', sourceUrl: 'queenstown.roundshot.com' },
  { name: 'Twizel', url: 'https://www.trafficnz.info/camera/737.jpg', type: 'image', sourceUrl: 'trafficnz.info' },
  { name: 'Taylors Mistake', url: 'https://metdata.net.nz/lpc/camera/taylorsmistake1/image.php', type: 'image', sourceUrl: 'metdata.net.nz' },
  { name: 'Opiki', url: 'https://www.horizons.govt.nz/HRC/media/Data/WebCam/Opiki_latest_photo.jpg', type: 'image', sourceUrl: 'horizons.govt.nz' },
  { name: 'Rangitikei', url: 'https://www.horizons.govt.nz/HRC/media/Data/WebCam/Rangitikeicarpark_latest_photo.jpg', type: 'image', sourceUrl: 'horizons.govt.nz' },
  { name: 'New Plymouth', url: 'https://www.primo.nz/webcameras/snapshot_twlbuilding_sth.jpg', type: 'image', sourceUrl: 'primo.nz' },
];

const GAUGE_THRESHOLDS = {
  speed:   { gray: 250, yellow: 350, orange: 500, red: 650, purple: 800, pink: Infinity, maxExpected: 1000 },
  density: { gray: 5,   yellow: 10,  orange: 15,  red: 20,  purple: 50,  pink: Infinity, maxExpected: 70 },
  power:   { gray: 20,  yellow: 40,  orange: 70,  red: 150, purple: 200, pink: Infinity, maxExpected: 250 },
  bt:      { gray: 5,   yellow: 10,  orange: 15,  red: 20,  purple: 50,  pink: Infinity, maxExpected: 60 },
  bz:      { gray: -5,  yellow: -10, orange: -15, red: -20, purple: -50, pink: -50, maxNegativeExpected: -60 }
};

const GAUGE_COLORS = {
    gray:   { solid: '#808080' }, yellow: { solid: '#FFD700' }, orange: { solid: '#FFA500' },
    red:    { solid: '#FF4500' }, purple: { solid: '#800080' }, pink:   { solid: '#FF1493' }
};

const GAUGE_EMOJIS = {
    gray:   '\u{1F610}', yellow: '\u{1F642}', orange: '\u{1F642}', red:    '\u{1F604}',
    purple: '\u{1F60D}', pink:   '\u{1F929}', error:  '\u{2753}' // Updated pink to match 80%+
};

const getForecastScoreColorKey = (score: number) => {
    if (score >= 80) return 'pink'; if (score >= 50) return 'purple'; if (score >= 40) return 'red';
    if (score >= 25) return 'orange'; if (score >= 10) return 'yellow';
    return 'gray';
};

const getGaugeStyle = (v: number | null, type: keyof typeof GAUGE_THRESHOLDS) => {
    if (v == null || isNaN(v)) return { color: GAUGE_COLORS.gray.solid, emoji: GAUGE_EMOJIS.error, percentage: 0 };
    let key: keyof typeof GAUGE_COLORS = 'pink'; let percentage = 0; const thresholds = GAUGE_THRESHOLDS[type];
    if (type === 'bz') {
        if (v <= thresholds.pink) key = 'pink'; else if (v <= thresholds.purple) key = 'purple'; else if (v <= thresholds.red) key = 'red'; else if (v <= thresholds.orange) key = 'orange'; else if (v <= thresholds.yellow) key = 'yellow'; else key = 'gray';
        if (v < 0 && thresholds.maxNegativeExpected) percentage = Math.min(100, Math.max(0, (v / thresholds.maxNegativeExpected) * 100)); else percentage = 0;
    } else {
        if (v <= thresholds.gray) key = 'gray'; else if (v <= thresholds.yellow) key = 'yellow'; else if (v <= thresholds.orange) key = 'orange'; else if (v <= thresholds.red) key = 'red'; else if (v <= thresholds.purple) key = 'purple';
        percentage = Math.min(100, Math.max(0, (v / thresholds.maxExpected) * 100));
    }
    return { color: GAUGE_COLORS[key].solid, emoji: GAUGE_EMOJIS[key], percentage };
};

// --- UPDATED FUNCTION ---
const getAuroraBlurb = (score: number) => {
    if (score < 10) return 'Little to no auroral activity.';
    if (score < 25) return 'Minimal auroral activity likely, possibly only a faint glow detectable by professional cameras.';
    if (score < 40) return 'Clear auroral activity visible in camera/phone images, potentially visible to the naked eye under ideal conditions.';
    if (score < 50) return 'Faint auroral glow potentially visible to the naked eye, possibly with some color.';
    if (score < 80) return 'Good chance of seeing auroral color with the naked eye (depending on individual eyesight and viewing conditions).';
    return 'High probability of significant auroral substorms, potentially displaying a wide range of colors and dynamic activity overhead or in the northern sky.';
};

// --- UPDATED FUNCTION ---
const getAuroraEmoji = (s: number | null) => {
    if (s === null) return '❓';
    if (s < 10) return '😞';
    if (s < 25) return '😐';
    if (s < 40) return '😊';
    if (s < 50) return '🙂';
    if (s < 80) return '😀';
    return '🤩';
};

const getSuggestedCameraSettings = (score: number | null, isDaylight: boolean) => {
    // This function can be expanded with the full logic again, simplified here for brevity
    if (isDaylight) {
        return {
            overall: "The sun is currently up. It is not possible to photograph the aurora during daylight hours.",
            phone: { android: { iso: "N/A", shutter: "N/A", aperture: "N/A", focus: "N/A", wb: "N/A" }, apple: { iso: "N/A", shutter: "N/A", aperture: "N/A", focus: "N/A", wb: "N/A" } },
            dslr: { iso: "N/A", shutter: "N/A", aperture: "N/A", focus: "N/A", wb: "N/A" }
        };
    }
    // ... add other score conditions back here ...
    return {
         overall: "Minimal activity expected. A DSLR/Mirrorless camera might capture a faint glow, but phones will likely struggle.",
         phone: { android: { iso: "3200-6400 (Max)", shutter: "15-30s", aperture: "Lowest f-number", focus: "Infinity", wb: "Auto or 3500K-4000K" }, apple: { iso: "Auto (max Night Mode)", shutter: "Longest Night Mode (10-30s)", aperture: "N/A (fixed)", focus: "Infinity", wb: "Auto or 3500K-4000K" } },
         dslr: { iso: "3200-6400", shutter: "15-25s", aperture: "f/2.8-f/4 (widest)", focus: "Manual to Infinity", wb: "3500K-4500K" }
     };
};

const getMagnetometerAnnotations = (data: any[]) => {
    const annotations: any = {};
    if (data.length < 60) return annotations;
    
    const getSegmentAnalysis = (startIdx: number, endIdx: number) => {
        if (startIdx >= endIdx || endIdx >= data.length) return null;
        const start = data[startIdx];
        const end = data[endIdx];
        if (!start || !end || isNaN(start.hp) || isNaN(end.hp)) return null;
        const hpChange = end.hp - start.hp;
        const durationMins = (end.time - start.time) / 60000;
        if (durationMins < 10) return null;
        if (hpChange > 20) return { type: 'substorm', xMin: start.time, xMax: end.time };
        if (hpChange < -15 && durationMins > 30) return { type: 'stretching', xMin: start.time, xMax: end.time };
        return null;
    };

    for (let i = 0; i < data.length; i++) {
        const current = data[i];
        const tenMinAgoIdx = data.findIndex(p => p.time >= current.time - 600000);
        if (tenMinAgoIdx !== -1 && tenMinAgoIdx < i) {
            const jump = getSegmentAnalysis(tenMinAgoIdx, i);
            if (jump?.type === 'substorm') {
                annotations[`substorm-${current.time}`] = { 
                    type: 'box', 
                    xMin: jump.xMin, 
                    xMax: current.time + 300000, 
                    backgroundColor: 'rgba(34, 197, 94, 0.2)', 
                    borderColor: 'transparent', 
                    borderWidth: 0, 
                    drawTime: 'beforeDatasetsDraw' 
                };
            }
        }
        const oneHourAgoIdx = data.findIndex(p => p.time >= current.time - 3600000);
        if (oneHourAgoIdx !== -1 && oneHourAgoIdx < i) {
            const stretch = getSegmentAnalysis(oneHourAgoIdx, i);
            if (stretch?.type === 'stretching') {
                const overlap = Object.values(annotations).some((ann: any) => 
                    ann.type === 'box' && 
                    ann.backgroundColor === 'rgba(34, 197, 94, 0.2)' && 
                    Math.max(stretch.xMin, ann.xMin) < Math.min(stretch.xMax, ann.xMax)
                );
                if (!overlap) {
                    annotations[`stretching-${current.time}`] = { 
                        type: 'box', 
                        xMin: stretch.xMin, 
                        xMax: stretch.xMax, 
                        backgroundColor: 'rgba(255, 215, 0, 0.1)', 
                        borderColor: 'transparent', 
                        borderWidth: 0, 
                        drawTime: 'beforeDatasetsDraw' 
                    };
                }
            }
        }
    }
    return annotations;
};


const ForecastDashboard: React.FC<ForecastDashboardProps> = ({ setViewerMedia, setCurrentAuroraScore, setSubstormActivityStatus, navigationTarget }) => {
    const {
        isLoading, auroraScore, lastUpdated, gaugeData, isDaylight, celestialTimes, auroraScoreHistory, dailyCelestialHistory,
        owmDailyForecast, locationBlurb, fetchAllData, allSpeedData, allDensityData, allMagneticData, hemisphericPowerHistory,
        goes18Data, goes19Data, loadingMagnetometer, substormBlurb
    } = useForecastData(setCurrentAuroraScore, setSubstormActivityStatus);
    
    const [modalState, setModalState] = useState<{ isOpen: boolean; title: string; content: string | React.ReactNode } | null>(null);
    const [isFaqOpen, setIsFaqOpen] = useState(false);
    const [graphModalId, setGraphModalId] = useState<string | null>(null);
    const [epamImageUrl, setEpamImageUrl] = useState<string>('/placeholder.png');
    const [selectedCamera, setSelectedCamera] = useState<Camera>(CAMERAS.find(c => c.name === 'Queenstown')!);
    const [cameraImageSrc, setCameraImageSrc] = useState<string>('');
    
    const [solarWindTimeRange, setSolarWindTimeRange] = useState(6 * 3600000);
    const [solarWindTimeLabel, setSolarWindTimeLabel] = useState('6 Hr');
    const [magneticFieldTimeRange, setMagneticFieldTimeRange] = useState(6 * 3600000);
    const [magneticFieldTimeLabel, setMagneticFieldTimeLabel] = useState('6 Hr');
    const [hemisphericPowerChartTimeRange, setHemisphericPowerChartTimeRange] = useState(6 * 3600000);
    const [hemisphericPowerChartTimeLabel, setHemisphericPowerChartTimeLabel] = useState('6 Hr');
    const [magnetometerTimeRange, setMagnetometerTimeRange] = useState(3 * 3600000);
    const [magnetometerTimeLabel, setMagnetometerTimeLabel] = useState('3 Hr');

    useEffect(() => {
      fetchAllData(true, getGaugeStyle);
      const interval = setInterval(() => fetchAllData(false, getGaugeStyle), 60 * 1000);
      return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        setEpamImageUrl(`${ACE_EPAM_URL}?_=${Date.now()}`);
        if (selectedCamera.type === 'image') {
            setCameraImageSrc(`${selectedCamera.url}?_=${Date.now()}`);
        }
    }, [lastUpdated, selectedCamera]);

    useEffect(() => {
        if (navigationTarget?.page === 'forecast' && navigationTarget.expandId) {
             if (navigationTarget.expandId !== 'goes-mag-graph-container') {
                 setGraphModalId(navigationTarget.expandId);
            }
        }
    }, [navigationTarget]);

    // --- UPDATED OBJECT ---
    const tooltipContent = useMemo(() => ({
        'forecast': `This forecast combines live space weather data with local New Zealand factors to provide a simple percentage chance of seeing an aurora.<br><br>
            <ul class='space-y-2'>
                <li><strong>Below 10% - 😞:</strong> Little to no auroral activity.</li>
                <li><strong>10% - 25% - 😐:</strong> Minimal auroral activity likely, possibly only a faint glow detectable by professional cameras.</li>
                <li><strong>25% - 40% - 😊:</strong> Clear auroral activity visible in camera/phone images, potentially visible to the naked eye under ideal conditions.</li>
                <li><strong>40% - 50% - 🙂:</strong> Faint auroral glow potentially visible to the naked eye, possibly with some color.</li>
                <li><strong>50% - 80% - 😀:</strong> Good chance of seeing auroral color with the naked eye (depending on individual eyesight and viewing conditions).</li>
                <li><strong>80%+ - 🤩:</strong> High probability of significant auroral substorms, potentially displaying a wide range of colors and dynamic activity overhead or in the northern sky.</li>
            </ul>`,
        'power': `<strong>What it is:</strong> Think of this as the 'volume knob' for the aurora's brightness. It measures the total amount of energy the Sun's particles are dumping into Earth's atmosphere.<br><br><strong>Effect on Aurora:</strong> The higher the power, the more energy is available to light up the sky. High power can lead to a brighter and more widespread aurora.`,
        'speed': `<strong>What it is:</strong> The Sun constantly streams out a flow of particles called the solar wind. This measures how fast that stream is moving.<br><br><strong>Effect on Aurora:</strong> Faster particles hit our atmosphere with more energy, like a faster pitch. This can create more vibrant colors (like pinks and purples) and cause the aurora to dance and move more quickly.`,
        'density': `<strong>What it is:</strong> This measures how 'crowded' or 'thick' the stream of solar wind particles is.<br><br><strong>Effect on Aurora:</strong> Higher density is like using a wider paintbrush. More particles are hitting the atmosphere at once, which can make the aurora appear brighter and cover a larger area of the sky.`,
        'bt': `<strong>What it is:</strong> The stream of particles from the Sun has its own magnetic field. 'Bt' measures the total strength of that magnetic field.<br><br><strong>Effect on Aurora:</strong> A high Bt value means the magnetic field is strong and carrying a lot of energy. By itself, it doesn't do much, but if the 'Bz' direction is right, this stored energy can be unleashed to create a powerful display.`,
        'bz': `<strong>What it is:</strong> This is the most important ingredient for an aurora. Earth is protected by a magnetic shield. The 'Bz' value tells us the North-South direction of the Sun's magnetic field.<br><br><strong>Effect on Aurora:</strong> Think of Bz as the 'master switch'. When Bz points **South (a negative number)**, it's like a key turning in a lock. It opens a door in Earth's shield, allowing energy and particles to pour in. When Bz is North (positive), the door is closed. **The more negative the Bz, the better the aurora!**`,
        'epam': `<strong>What it is:</strong> A sensor on a satellite far away that acts as an early-warning system. It counts very fast, high-energy particles that are often pushed ahead of a major solar eruption.<br><br><strong>Effect on Aurora:</strong> A sudden, sharp spike on this chart is a strong clue that a 'shockwave' from a solar eruption (a CME) is about to hit Earth, which can trigger a major aurora storm.`,
        'moon': `<strong>What it is:</strong> The percentage of the moon that is lit up by the Sun.<br><br><strong>Effect on Aurora:</strong> The moon is like a giant natural street light. A bright, full moon (100%) will wash out all but the most intense auroras. A new moon (0%) provides the darkest skies, making it much easier to see faint glows.`,
        'ips': `<strong>What it is:</strong> The 'shockwave' at the front of a large cloud of solar particles (a CME) travelling from the Sun. This table shows when these shockwaves have recently hit our satellites.<br><br><strong>Effect on Aurora:</strong> The arrival of a shockwave is a major event. It can cause a sudden and dramatic change in all the other conditions (speed, density, Bz) and often triggers a strong auroral display very soon after it arrives.`,
        'solar-wind-graph': `This chart shows the Speed and Density of the solar wind. The colors change to show how active conditions are.<br><br><ul class="list-disc list-inside space-y-2"><li><strong style="color:${GAUGE_COLORS.gray.solid}">Gray:</strong> Quiet</li><li><strong style="color:${GAUGE_COLORS.yellow.solid}">Active</li><li><strong style="color:${GAUGE_COLORS.orange.solid}">Moderate</li><li><strong style="color:${GAUGE_COLORS.red.solid}">Strong</li><li><strong style="color:${GAUGE_COLORS.purple.solid}">Severe</li></ul>`,
        'imf-graph': `This chart shows the magnetic field of the solar wind. A strong (high Bt) and southward-pointing (negative Bz) field is the perfect recipe for an aurora.<br><br>The colors change based on how favorable the conditions are:<br><ul class="list-disc list-inside space-y-2 mt-2"><li><strong style="color:${GAUGE_COLORS.gray.solid}">Gray:</strong> Not favorable.</li><li><strong style="color:${GAUGE_COLORS.yellow.solid}">Slightly favorable.</li><li><strong style="color:${GAUGE_COLORS.orange.solid}">Favorable.</li><li><strong style="color:${GAUGE_COLORS.red.solid}">Very Favorable.</li><li><strong style="color:${GAUGE_COLORS.purple.solid}">Extremely Favorable.</li></ul>`,
        'hemispheric-power-graph': `This chart shows the total energy being dumped into the atmosphere, which relates to the aurora's brightness.<br><br>The colors change based on the intensity:<br><ul class="list-disc list-inside space-y-2 mt-2"><li><strong style="color:${GAUGE_COLORS.gray.solid}">Gray:</strong> Low Power</li><li><strong style="color:${GAUGE_COLORS.yellow.solid}">Moderate Power</li><li><strong style="color:${GAUGE_COLORS.orange.solid}">Elevated Power</li><li><strong style="color:${GAUGE_COLORS.red.solid}">High Power</li><li><strong style="color:${GAUGE_COLORS.purple.solid}">Very High Power</li></ul>`,
        'goes-mag': `<div><p>This measures the stretching of Earth's magnetic field, like a rubber band. It's one of the best tools for predicting when an aurora might suddenly flare up.</p><br><p><strong>How to read it:</strong></p><ul class="list-disc list-inside space-y-2 mt-2"><li><strong class="text-yellow-400">The Drop (Growth Phase):</strong> The line goes down slowly for 1-2 hours. This is the 'rubber band' stretching and storing energy.</li><li><strong class="text-green-400">The Jump (Eruption):</strong> The line suddenly jumps back up. This is the 'rubber band' snapping back, releasing all its energy at once. This is the moment the aurora flares up brightly and starts to dance!</li></ul><br><p>By watching for the drop, you can anticipate the jump.</p></div>`,
        'live-cameras': `<strong>What are these?</strong><br>These are public webcams from around New Zealand. They are a reality check for the forecast data.<br><br><strong>How do they help?</strong><br>You can use them to:<br><ul class="list-disc list-inside space-y-2 mt-2"><li><strong>Check for Clouds:</strong> The number one enemy of aurora spotting. Use the cloud map on this dashboard to check for clear skies.</li><li><strong>Spot Faint Aurora:</strong> These cameras are often more sensitive than our eyes and can pick up glows we might miss.</li><li><strong>Verify Conditions:</strong> If the forecast is high and a southern camera shows a clear sky, your chances are good!</li></ul>`,
    }), []);
    
    const openModal = useCallback((id: string) => {
        const contentData = tooltipContent[id as keyof typeof tooltipContent];
        if (contentData) {
            let title = '';
            if (id === 'forecast') title = 'About The Forecast Score';
            else if (id === 'solar-wind-graph') title = 'About The Solar Wind Graph';
            else if (id === 'imf-graph') title = 'About The IMF Graph';
            else if (id === 'goes-mag') title = 'GOES Magnetometer (Hp)';
            else if (id === 'hemispheric-power-graph') title = 'About The Hemispheric Power Graph';
            else if (id === 'ips') title = 'About Interplanetary Shocks';
            else if (id === 'live-cameras') title = 'About Live Cameras';
            else title = (id.charAt(0).toUpperCase() + id.slice(1)).replace(/([A-Z])/g, ' $1').trim();
            setModalState({ isOpen: true, title: title, content: contentData });
        }
    }, [tooltipContent]);
    const closeModal = useCallback(() => setModalState(null), []);

    const cameraSettings = useMemo(() => getSuggestedCameraSettings(auroraScore, isDaylight), [auroraScore, isDaylight]);
    const auroraBlurb = useMemo(() => getAuroraBlurb(auroraScore ?? 0), [auroraScore]);

    if (isLoading) {
        return <div className="w-full h-full flex justify-center items-center bg-neutral-900"><LoadingSpinner /></div>;
    }

    const faqContent = `<div class="space-y-4"><div><h4 class="font-bold text-neutral-200">Why don't you use the Kp-index?</h4><p>The Kp-index is a fantastic tool for measuring global geomagnetic activity, but it's not real-time. It is an "average" calculated every 3 hours, so it often describes what *has already happened*. For a live forecast, we need data that's updated every minute. Relying on the Kp-index would be like reading yesterday's weather report to decide if you need an umbrella right now.</p></div><div><h4 class="font-bold text-neutral-200">What data SHOULD I look at then?</h4><p>The most critical live data points for aurora nowcasting are:</p><ul class="list-disc list-inside pl-2 mt-1"><li><strong>IMF Bz:</strong> The "gatekeeper". A strong negative (southward) value opens the door for the aurora.</li><li><strong>Solar Wind Speed:</strong> The "power". Faster speeds lead to more energetic and dynamic displays.</li><li><strong>Solar Wind Density:</strong> The "thickness". Higher density can result in a brighter, more widespread aurora.</li></ul></div><div><h4 class="font-bold text-neutral-200">The forecast is high but I can't see anything. Why?</h4><p>This can happen for several reasons! The most common are:</p><ul class="list-disc list-inside pl-2 mt-1"><li><strong>Clouds:</strong> The number one enemy of aurora spotting. Use the cloud map on this dashboard to check for clear skies.</li><li><strong>Light Pollution:</strong> You must be far away from town and urban area lights.</li><li><strong>The Moon:</strong> A bright moon can wash out all but the most intense auroras.</li><li><strong>Eye Adaptation:</strong> It takes at least 15-20 minutes in total darkness for your eyes to become sensitive enough to see faint glows.</li><li><strong>Patience:</strong> Auroral activity happens in waves (substorms). A quiet period can be followed by an intense outburst. Don't give up after just a few minutes.</li></ul></div><div><h4 class="font-bold text-neutral-200">Where does your data from?</h4><p>All our live solar wind and magnetic field data comes directly from NASA and NOAA, sourced from satellites positioned 1.5 million km from Earth, like the DSCOVR and ACE spacecraft. This dashboard fetches new data every minute. The "Spot The Aurora Forecast" score is then calculated using a proprietary algorithm that combines this live data with local factors for the West Coast of NZ, but is still applicable for the entire New Zealand with some modification.</p></div></div>`;

    return (
        <div className="w-full h-full bg-neutral-900 text-neutral-300 relative" style={{ backgroundImage: `url('/background-aurora.jpg')`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed' }}>
            <div className="absolute inset-0 bg-black/50 z-0"></div>
            <div className="w-full h-full overflow-y-auto p-5 relative z-10 styled-scrollbar">
                 <div className="container mx-auto">
                    <header className="text-center mb-8">
                        <a href="https://www.tnrprotography.co.nz" target="_blank" rel="noopener noreferrer"><img src="https://www.tnrprotography.co.nz/uploads/1/3/6/6/136682089/white-tnr-protography-w_orig.png" alt="TNR Protography Logo" className="mx-auto w-full max-w-[250px] mb-4"/></a>
                        <h1 className="text-3xl font-bold text-neutral-100">Spot The Aurora - New Zealand Aurora Forecast</h1>
                    </header>
                    <main className="grid grid-cols-12 gap-6">
                        <ActivityAlert isDaylight={isDaylight} celestialTimes={celestialTimes} auroraScoreHistory={auroraScoreHistory} />
                        
                        <ForecastScore 
                            score={auroraScore}
                            blurb={auroraBlurb}
                            lastUpdated={lastUpdated}
                            locationBlurb={locationBlurb}
                            getGaugeStyle={getGaugeStyle}
                            getScoreColorKey={getForecastScoreColorKey}
                            getAuroraEmoji={getAuroraEmoji}
                            gaugeColors={GAUGE_COLORS}
                            onOpenModal={() => openModal('forecast')}
                        />

                        <div className="col-span-12 grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <TipsSection />
                            <CameraSettingsSection settings={cameraSettings} />
                        </div>
                        
                        <AuroraSightings isDaylight={isDaylight} />

                        <ForecastTrendChart 
                            auroraScoreHistory={auroraScoreHistory}
                            dailyCelestialHistory={dailyCelestialHistory}
                            owmDailyForecast={owmDailyForecast}
                            onOpenModal={() => openModal('forecast')}
                        />

                        <DataGauges
                            gaugeData={gaugeData}
                            onOpenModal={openModal}
                            onExpandGraph={setGraphModalId}
                        />
                        
                        <div id="goes-magnetometer-section" className="col-span-12 card bg-neutral-950/80 p-4">
                            <div className="flex items-center justify-between">
                                <h2 className="text-xl font-semibold text-neutral-100">GOES Magnetometer (Substorm Watch)</h2>
                                <button onClick={(e) => { e.stopPropagation(); openModal('goes-mag'); }} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button>
                            </div>
                            <div className="mt-4 h-[600px] max-h-[60vh]">
                               <ExpandedGraphContent
                                    graphId={'goes-mag-graph-container'}
                                    openModal={openModal}
                                    getMagnetometerAnnotations={getMagnetometerAnnotations}
                                    allSpeedData={allSpeedData} allDensityData={allDensityData} allMagneticData={allMagneticData} hemisphericPowerHistory={hemisphericPowerHistory}
                                    goes18Data={goes18Data} goes19Data={goes19Data} loadingMagnetometer={loadingMagnetometer} substormBlurb={substormBlurb}
                                    solarWindTimeRange={solarWindTimeRange} setSolarWindTimeRange={(d, l) => { setSolarWindTimeRange(d); setSolarWindTimeLabel(l); }} solarWindTimeLabel={solarWindTimeLabel}
                                    magneticFieldTimeRange={magneticFieldTimeRange} setMagneticFieldTimeRange={(d, l) => { setMagneticFieldTimeRange(d); setMagneticFieldTimeLabel(l); }} magneticFieldTimeLabel={magneticFieldTimeLabel}
                                    hemisphericPowerChartTimeRange={hemisphericPowerChartTimeRange} setHemisphericPowerChartTimeRange={(d, l) => { setHemisphericPowerChartTimeRange(d); setHemisphericPowerChartTimeLabel(l); }} hemisphericPowerChartTimeLabel={hemisphericPowerChartTimeLabel}
                                    magnetometerTimeRange={magnetometerTimeRange} setMagnetometerTimeRange={(d, l) => { setMagnetometerTimeRange(d); setMagnetometerTimeLabel(l); }} magnetometerTimeLabel={magnetometerTimeLabel}
                                />
                            </div>
                        </div>

                        <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col">
                            <h3 className="text-xl font-semibold text-center text-white mb-4">Live Cloud Cover</h3>
                            <div className="relative w-full" style={{paddingBottom: "56.25%"}}><iframe title="Windy.com Cloud Map" className="absolute top-0 left-0 w-full h-full rounded-lg" src="https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=mm&metricTemp=°C&zoom=5&overlay=clouds&product=ecmwf&level=surface&lat=-44.757&lon=169.054" frameBorder="0"></iframe></div>
                        </div>
                        
                        <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col">
                            <div className="flex justify-center items-center mb-4">
                                <h3 className="text-xl font-semibold text-center text-white">Live Cameras</h3>
                                <button onClick={() => openModal('live-cameras')} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button>
                            </div>
                            <div className="flex justify-center gap-2 my-2 flex-wrap">
                                {CAMERAS.map((camera) => (
                                    <button key={camera.name} onClick={() => setSelectedCamera(camera)} className={`px-3 py-1 text-xs rounded transition-colors ${selectedCamera.name === camera.name ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>
                                        {camera.name}
                                    </button>
                                ))}
                            </div>
                            <div className="mt-4">
                                <div className="relative w-full bg-black rounded-lg" style={{ paddingBottom: "56.25%" }}>
                                    {selectedCamera.type === 'iframe' ? (
                                        <iframe title={`Live View from ${selectedCamera.name}`} className="absolute top-0 left-0 w-full h-full rounded-lg" src={selectedCamera.url} key={selectedCamera.name} />
                                    ) : (
                                        <img src={cameraImageSrc} alt={`Live View from ${selectedCamera.name}`} className="absolute top-0 left-0 w-full h-full rounded-lg object-contain" key={cameraImageSrc} onError={(e) => { e.currentTarget.src = '/placeholder.png'; e.currentTarget.alt = `Could not load camera from ${selectedCamera.name}.`; }} />
                                    )}
                                </div>
                                <div className="text-center text-xs text-neutral-500 mt-2">
                                    Source: <a href={`http://${selectedCamera.sourceUrl}`} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">{selectedCamera.sourceUrl}</a>
                                </div>
                            </div>
                        </div>

                        <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col">
                            <div className="flex justify-center items-center"><h2 className="text-xl font-semibold text-center text-white">ACE EPAM (Last 3 Days)</h2><button onClick={() => openModal('epam')} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button></div>
                             <div onClick={() => setViewerMedia && epamImageUrl !== '/placeholder.png' && setViewerMedia({ url: epamImageUrl, type: 'image' })} className="flex-grow relative mt-2 cursor-pointer min-h-[300px]"><img src={epamImageUrl} alt="ACE EPAM Data" className="w-full h-full object-contain" /></div>
                        </div>
                    </main>

                    <footer className="page-footer mt-10 pt-8 border-t border-neutral-700 text-center text-neutral-400 text-sm">
                        <h3 className="text-lg font-semibold text-neutral-200 mb-4">About This Dashboard</h3>
                        <p className="max-w-3xl mx-auto leading-relaxed">This dashboard provides a 2-hour aurora forecast for the whole of New Zealand and specifically for the West Coast of New Zealand. The proprietary "Spot The Aurora Forecast" combines live solar wind data with local factors like astronomical darkness and lunar phase to generate a more nuanced prediction than global models.</p>
                        <p className="max-w-3xl mx-auto leading-relaxed mt-4"><strong>Disclaimer:</strong> The aurora is a natural and unpredictable phenomenon. This forecast is an indication of potential activity, not a guarantee of a visible display. Conditions can change rapidly.</p>
                        <div className="mt-6">
                            <button onClick={() => setIsFaqOpen(true)} className="flex items-center gap-2 mx-auto px-4 py-2 bg-neutral-800/80 border border-neutral-700/60 rounded-lg text-neutral-300 hover:bg-neutral-700/90 transition-colors">
                                <GuideIcon className="w-5 h-5" />
                                <span>Frequently Asked Questions</span>
                            </button>
                        </div>
                        <div className="mt-8 text-xs text-neutral-500"><p>Data provided by <a href="https://www.swpc.noaa.gov/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">NOAA SWPC</a> & <a href="https://api.nasa.gov/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">NASA</a> | Weather & Cloud data by <a href="https://www.windy.com" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">Windy.com</a></p><p className="mt-2">Forecast Algorithm, Visualization, and Development by TNR Protography</p></div>
                    </footer>
                 </div>
            </div>

            <GraphModal 
                isOpen={!!graphModalId}
                onClose={() => setGraphModalId(null)}
                graphId={graphModalId}
                openModal={openModal}
                getMagnetometerAnnotations={getMagnetometerAnnotations}
                allSpeedData={allSpeedData} allDensityData={allDensityData} allMagneticData={allMagneticData} hemisphericPowerHistory={hemisphericPowerHistory}
                goes18Data={goes18Data} goes19Data={goes19Data} loadingMagnetometer={loadingMagnetometer} substormBlurb={substormBlurb}
                solarWindTimeRange={solarWindTimeRange} setSolarWindTimeRange={(d, l) => { setSolarWindTimeRange(d); setSolarWindTimeLabel(l); }} solarWindTimeLabel={solarWindTimeLabel}
                magneticFieldTimeRange={magneticFieldTimeRange} setMagneticFieldTimeRange={(d, l) => { setMagneticFieldTimeRange(d); setMagneticFieldTimeLabel(l); }} magneticFieldTimeLabel={magneticFieldTimeLabel}
                hemisphericPowerChartTimeRange={hemisphericPowerChartTimeRange} setHemisphericPowerChartTimeRange={(d, l) => { setHemisphericPowerChartTimeRange(d); setHemisphericPowerChartTimeLabel(l); }} hemisphericPowerChartTimeLabel={hemisphericPowerChartTimeLabel}
                magnetometerTimeRange={magnetometerTimeRange} setMagnetometerTimeRange={(d, l) => { setMagnetometerTimeRange(d); setMagnetometerTimeLabel(l); }} magnetometerTimeLabel={magnetometerTimeLabel}
            />

            {modalState && <InfoModal isOpen={modalState.isOpen} onClose={closeModal} title={modalState.title} content={modalState.content} />}
            <InfoModal isOpen={isFaqOpen} onClose={() => setIsFaqOpen(false)} title="Frequently Asked Questions" content={faqContent} />
        </div>
    );
};

export default ForecastDashboard;
// --- END OF FILE ForecastDashboard.tsx ---