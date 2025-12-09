//--- START OF FILE src/components/ForecastDashboard.tsx ---

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import LoadingSpinner from './icons/LoadingSpinner';
import AuroraSightings from './AuroraSightings';
import GuideIcon from './icons/GuideIcon';
import { useForecastData, NzMagEvent } from '../hooks/useForecastData';
import { UnifiedForecastPanel } from './UnifiedForecastPanel';
import ForecastChartPanel from './ForecastChartPanel';

import {
    TipsSection,
    CameraSettingsSection,
    InfoModal,
    ActivityAlert
} from './ForecastComponents';

import {
    SimpleTrendChart,
    ForecastTrendChart,
    SolarWindSpeedChart,
    SolarWindDensityChart,
    MagneticFieldChart,
    HemisphericPowerChart,
    SubstormChart,
    MoonArcChart,
    NzMagnetometerChart,
} from './ForecastCharts';
import { SubstormActivity, SubstormForecast, ActivitySummary, InterplanetaryShock } from '../types';
import CaretIcon from './icons/CaretIcon';

const DownloadIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
);

// --- Type Definitions ---
interface ForecastDashboardProps {
  setViewerMedia?: (media: { url: string, type: 'image' | 'video' } | null) => void;
  setCurrentAuroraScore: (score: number | null) => void;
  setSubstormActivityStatus: (status: SubstormActivity | null) => void;
  setIpsAlertData: (data: { shock: InterplanetaryShock; solarWind: { speed: string; bt: string; bz: string; } } | null) => void;
  navigationTarget: { page: string; elementId: string; expandId?: string; } | null;
  onInitialLoad?: () => void;
  viewMode: 'simple' | 'advanced';
  onViewModeChange: (mode: 'simple' | 'advanced') => void;
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
    purple: '\u{1F60D}', pink:   '\u{1F929}', error:  '\u{2753}'
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

const getAuroraBlurb = (score: number | null) => {
    if (score === null) return 'Loading forecast data...';
    if (score < 10) return 'Little to no auroral activity is expected.';
    if (score < 25) return 'Minimal auroral activity likely. A faint glow may be detectable by cameras under dark skies.';
    if (score < 40) return 'Clear auroral activity should be visible in photos. It may be faintly visible to the naked eye in ideal, dark locations.';
    if (score < 50) return 'A faint auroral glow could be visible to the naked eye, potentially with some color if conditions are very good.';
    if (score < 80) return 'There is a good chance of seeing auroral color with the naked eye. Look for movement and brightening in the southern sky.';
    return 'There is a high probability of a significant aurora display, potentially with a wide range of colors and dynamic activity overhead.';
};

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
    if (isDaylight) {
        return {
            overall: "The sun is currently up. It is not possible to photograph the aurora during daylight hours.",
            phone: { android: { iso: "N/A", shutter: "N/A", aperture: "N/A", focus: "N/A", wb: "N/A" }, apple: { iso: "N/A", shutter: "N/A", aperture: "N/A", focus: "N/A", wb: "N/A" } },
            dslr: { iso: "N/A", shutter: "N/A", aperture: "N/A", focus: "N/A", wb: "N/A" }
        };
    }
    return {
         overall: "Minimal activity expected. A DSLR/Mirrorless camera might capture a faint glow, but phones will likely struggle.",
         phone: { android: { iso: "3200-6400 (Max)", shutter: "15-30s", aperture: "Lowest f-number", focus: "Infinity", wb: "Auto or 3500K-4000K" }, apple: { iso: "Auto (max Night Mode)", shutter: "Longest Night Mode (10-30s)", aperture: "N/A (fixed)", focus: "Infinity", wb: "Auto or 3500K-4000K" } },
         dslr: { iso: "3200-6400", shutter: "15-25s", aperture: "f/2.8-f/4 (widest)", focus: "Manual to Infinity", wb: "3500K-4500K" }
     };
};

const ActivitySummaryDisplay: React.FC<{ summary: ActivitySummary | null }> = ({ summary }) => {
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
            <h2 className="text-2xl font-bold text-white text-center">24-Hour Activity Summary</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-neutral-900/70 p-4 rounded-lg border border-neutral-700/60 text-center">
                    <h3 className="text-lg font-semibold text-neutral-200 mb-2">Highest Forecast Score</h3>
                    <p className="text-5xl font-bold" style={{ color: GAUGE_COLORS[getForecastScoreColorKey(summary.highestScore.finalScore)].solid }}>
                        {summary.highestScore.finalScore.toFixed(1)}%
                    </p>
                    <p className="text-sm text-neutral-400 mt-1">
                        at {formatTime(summary.highestScore.timestamp)}
                    </p>
                </div>

                <div className="bg-neutral-900/70 p-4 rounded-lg border border-neutral-700/60">
                    <h3 className="text-lg font-semibold text-neutral-200 mb-3 text-center">Substorm Watch Periods</h3>
                    {summary.substormEvents.length > 0 ? (
                        <ul className="space-y-2 text-sm">
                            {summary.substormEvents.map((event, index) => (
                                <li key={index} className="bg-neutral-800/50 p-2 rounded-md text-center">
                                    <span className="font-semibold text-neutral-300">
                                        {formatTime(event.start)} - {formatTime(event.end)}
                                    </span>
                                    <span className="text-neutral-400 text-xs block">
                                        (Duration: {Math.round((event.end - event.start) / 60000)} mins)
                                    </span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-center text-neutral-400 italic mt-4">No significant substorm watch periods were detected.</p>
                    )}
                </div>
            </div>
        </div>
    );
};


const ForecastDashboard: React.FC<ForecastDashboardProps> = ({ setViewerMedia, setCurrentAuroraScore, setSubstormActivityStatus, setIpsAlertData, navigationTarget, onInitialLoad, viewMode, onViewModeChange }) => {
    const {
        isLoading, auroraScore, lastUpdated, gaugeData, isDaylight, celestialTimes, auroraScoreHistory, dailyCelestialHistory,
        owmDailyForecast, locationBlurb, fetchAllData, allSpeedData, allDensityData, allMagneticData, hemisphericPowerHistory,
        goes18Data, goes19Data, loadingMagnetometer, nzMagData, loadingNzMag, substormForecast, activitySummary, nzMagSubstormEvents, interplanetaryShockData
    } = useForecastData(setCurrentAuroraScore, setSubstormActivityStatus);
    
    const [modalState, setModalState] = useState<{ isOpen: boolean; title: string; content: string | React.ReactNode } | null>(null);
    const [isFaqOpen, setIsFaqOpen] = useState(false);
    const [epamImageUrl, setEpamImageUrl] = useState<string>('/placeholder.png');
    const [selectedCamera, setSelectedCamera] = useState<Camera>(CAMERAS.find(c => c.name === 'Queenstown')!);
    const [cameraImageSrc, setCameraImageSrc] = useState<string>('');
    const [selectedNzMagEvent, setSelectedNzMagEvent] = useState<NzMagEvent | null>(null);
    const [activeMagnetometer, setActiveMagnetometer] = useState<'goes' | 'nz'>('nz');
    const initialLoadCalled = useRef(false);

    useEffect(() => {
        if (!isLoading && onInitialLoad && !initialLoadCalled.current) {
            onInitialLoad();
            initialLoadCalled.current = true;
        }
    }, [isLoading, onInitialLoad]);

    useEffect(() => {
      fetchAllData(true, getGaugeStyle);
      const interval = setInterval(() => fetchAllData(false, getGaugeStyle), 30 * 1000);
      return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const latestShock = interplanetaryShockData?.[0];
        if (latestShock && (Date.now() - new Date(latestShock.eventTime).getTime()) < 3 * 3600 * 1000) {
            setIpsAlertData({
                shock: latestShock,
                solarWind: {
                    speed: gaugeData.speed.value,
                    bt: gaugeData.bt.value,
                    bz: gaugeData.bz.value,
                }
            });
        } else {
            setIpsAlertData(null);
        }
    }, [interplanetaryShockData, gaugeData, setIpsAlertData]);

    useEffect(() => {
        setEpamImageUrl(`${ACE_EPAM_URL}?_=${Date.now()}`);
        if (selectedCamera.type === 'image') {
            setCameraImageSrc(`${selectedCamera.url}?_=${Date.now()}`);
        }
    }, [lastUpdated, selectedCamera]);

    const handleDownloadForecastImage = useCallback(async () => {
        const canvas = document.createElement('canvas');
        const width = 900;
        const height = 1200; // 3:4 aspect ratio
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const bgImage = new Image();
        bgImage.crossOrigin = 'anonymous';
        const logoImage = new Image();
        logoImage.crossOrigin = 'anonymous';

        const bgPromise = new Promise(resolve => { bgImage.onload = resolve; bgImage.src = '/background-aurora.jpg'; });
        const logoPromise = new Promise(resolve => { logoImage.onload = resolve; logoImage.src = '/icons/android-chrome-192x192.png'; });
        
        await Promise.all([bgPromise, logoPromise]);

        ctx.drawImage(bgImage, 0, 0, width, height);
        ctx.fillStyle = 'rgba(10, 10, 10, 0.7)';
        ctx.fillRect(0, 0, width, height);

        let currentY = 40;

        const logoHeight = 100;
        const logoWidth = 100;
        ctx.drawImage(logoImage, (width - logoWidth) / 2, currentY, logoWidth, logoHeight);
        currentY += logoHeight + 40;

        ctx.textAlign = 'center';
        ctx.fillStyle = GAUGE_COLORS[getForecastScoreColorKey(auroraScore ?? 0)].solid;
        ctx.font = 'bold 140px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(`${(auroraScore ?? 0).toFixed(1)}%`, width / 2, currentY + 100);
        currentY += 100;
        
        ctx.fillStyle = '#E5E5E5';
        ctx.font = '36px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('Spot The Aurora Forecast Score', width / 2, currentY + 50);
        currentY += 50;

        currentY += 50;
        ctx.fillStyle = '#FBBF24';
        ctx.font = 'bold 42px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('Substorm Forecast', width / 2, currentY);
        currentY += 45;

        const getVisibilityTextForImage = (score: number | null): string => {
            if (score === null) return 'N/A';
            if (score >= 80) return 'High probability of a significant, dynamic display.';
            if (score >= 50) return 'Good chance of visible color and movement.';
            if (score >= 40) return 'Faint naked-eye glow possible.';
            if (score >= 25) return 'Visible in photos, maybe faint to the naked eye.';
            if (score >= 10) return 'Minimal activity, likely camera-only.';
            return 'Little to no auroral activity.';
        };
        const visibilityText = getVisibilityTextForImage(auroraScore);

        ctx.fillStyle = '#E5E5E5';
        ctx.font = '30px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(`Likelihood: ~${substormForecast.likelihood}%`, width / 2, currentY);
        currentY += 40;
        ctx.fillText(`Window: ${substormForecast.windowLabel}`, width / 2, currentY);
        currentY += 40;
        ctx.fillText(`Expected Visibility: ${visibilityText}`, width / 2, currentY);
        
        currentY += 70;
        const dividerY = currentY;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(80, dividerY);
        ctx.lineTo(width - 80, dividerY);
        ctx.stroke();

        const statBlockHeight = 160;
        const gapSize = 20;
        const statsStartY = dividerY + 80; // Increased gap
        const colWidth = width / 3;

        const drawStat = (col: number, row: number, emoji: string, value: string, label: string, color: string) => {
            const x = colWidth / 2 + colWidth * col;
            const y = statsStartY + (statBlockHeight + gapSize) * row;
            ctx.font = '54px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            ctx.fillText(emoji, x, y);
            ctx.fillStyle = color;
            ctx.font = 'bold 54px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            ctx.fillText(value, x, y + 65);
            ctx.fillStyle = '#A3A3A3';
            ctx.font = '28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            ctx.fillText(label, x, y + 105);
        };
        
        const bzValue = parseFloat(gaugeData.bz.value);
        const speedValue = parseFloat(gaugeData.speed.value);
        const densityValue = parseFloat(gaugeData.density.value);
        const btValue = parseFloat(gaugeData.bt.value);
        const powerValue = parseFloat(gaugeData.power.value);
        const moonValue = gaugeData.moon.percentage;

        drawStat(0, 0, getGaugeStyle(bzValue, 'bz').emoji, gaugeData.bz.value, 'Bz (nT)', getGaugeStyle(bzValue, 'bz').color);
        drawStat(1, 0, getGaugeStyle(speedValue, 'speed').emoji, gaugeData.speed.value, 'Speed (km/s)', getGaugeStyle(speedValue, 'speed').color);
        drawStat(2, 0, getGaugeStyle(densityValue, 'density').emoji, gaugeData.density.value, 'Density (p/cm³)', getGaugeStyle(densityValue, 'density').color);
        
        drawStat(0, 1, getGaugeStyle(btValue, 'bt').emoji, gaugeData.bt.value, 'Bt (nT)', getGaugeStyle(btValue, 'bt').color);
        drawStat(1, 1, getGaugeStyle(powerValue, 'power').emoji, gaugeData.power.value, 'Power (GW)', getGaugeStyle(powerValue, 'power').color);
        
        const moonX = colWidth / 2 + colWidth * 2;
        const moonY = statsStartY + (statBlockHeight + gapSize) * 1;
        ctx.font = '54px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(gaugeData.moon.emoji, moonX, moonY);
        ctx.fillStyle = GAUGE_COLORS.gray.solid;
        ctx.font = 'bold 54px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(`${moonValue.toFixed(0)}%`, moonX, moonY + 65);
        ctx.fillStyle = '#A3A3A3';
        ctx.font = '28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('Moon Illum.', moonX, moonY + 105);
        
        const moonRiseSetText = celestialTimes.moon?.rise && celestialTimes.moon?.set 
            ? `Rise: ${new Date(celestialTimes.moon.rise).toLocaleTimeString('en-NZ', {hour: '2-digit', minute:'2-digit'})} | Set: ${new Date(celestialTimes.moon.set).toLocaleTimeString('en-NZ', {hour: '2-digit', minute:'2-digit'})}`
            : 'Rise/Set N/A';
        ctx.font = '22px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(moonRiseSetText, moonX, moonY + 140);

        const footerY = height - 30;
        const disclaimerY = footerY - 80;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.font = 'italic 26px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText("This is a forecast for potential activity over the next two hours.", width / 2, disclaimerY);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.font = '28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        const now = new Date();
        const timeString = now.toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', dateStyle: 'medium', timeStyle: 'long' });
        ctx.fillText(timeString, width / 2, footerY - 40);
        ctx.font = 'bold 32px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('SpotTheAurora.co.nz', width / 2, footerY);

        const link = document.createElement('a');
        link.download = `spottheaurora-forecast-${now.toISOString()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();

    }, [auroraScore, substormForecast, gaugeData, celestialTimes]);

    const tooltipContent = useMemo(() => ({
        'unified-forecast': `<strong>Spot The Aurora Forecast</strong><br>This panel blends the overall aurora chance with a short-term substorm outlook.<br><br>
            <strong>Spot The Aurora Score</strong><br>This percentage is calculated from live space-weather data. Higher numbers mean better odds of seeing the aurora from New Zealand.<br><ul class='space-y-2 mt-2'>
                <li><strong>Under 10%:</strong> Very little activity expected.</li>
                <li><strong>10% - 25%:</strong> Mostly camera-only chances.</li>
                <li><strong>25% - 40%:</strong> Usually visible in photos; faint to the eye.</li>
                <li><strong>40% - 80%:</strong> Good chance of visible glow and colour.</li>
                <li><strong>80%+:</strong> Strong, dynamic displays likely.</li>
            </ul><br>
            <strong>Substorm Forecast</strong><br>Shows the likelihood and timing of a short, bright burst. Check the status, action note, and time window for the next likely eruption.`,
        'power': `<strong>Total power into the aurora.</strong><br>This sums up how much energy is flowing into Earth's atmosphere. Rising power usually means brighter, wider auroras are possible.`,
        'speed': `<strong>Solar wind speed.</strong><br>How fast the solar wind is moving. Faster wind delivers more energy and can make aurora curtains move quickly.`,
        'density': `<strong>Solar wind density.</strong><br>How many particles are in the solar wind. Higher density can make the aurora brighter because more particles hit our atmosphere at once.`,
        'bt': `<strong>IMF strength (Bt).</strong><br>The total strength of the interplanetary magnetic field carried by the solar wind. Strong Bt means more energy is available, especially when Bz turns south.`,
        'bz': `<strong>IMF direction (Bz).</strong><br>The north/south direction of that field. Negative (south) Bz opens Earth's magnetic shield so energy can flow in. The more negative, the better for aurora.`,
        'epam': `<strong>ACE EPAM alert.</strong><br>Counts fast particles ahead of a solar shock. A sharp spike often means a CME shockwave is minutes to hours away.`,
        'moon': `<strong>Moon light and path.</strong><br>Shows how bright the moon is and when it rises or sets. A dim or below-horizon moon keeps the sky dark for easier aurora viewing.`,
        'ips': `<strong>Interplanetary shocks.</strong><br>Records recent solar wind shock arrivals at satellites. A fresh shock can rapidly change speed, density, and Bz and often kick off strong aurora.`,
        'live-cameras': `<strong>Live cameras.</strong><br>Quick reality check from around New Zealand. Use them to see cloud cover and spot early aurora glows before you head out.`,
        'substorm': '<strong>GOES magnetometer.</strong><br>The Hp line shows how the magnetic field near Earth is stretching and snapping back. A sudden jump is a classic substorm signature and often lines up with bright aurora.',
        'nz-mag': '<strong>NZ magnetometer.</strong><br>Local ground data from West Melton. Rapid spikes mean the magnetic field above New Zealand is being disturbed right now—a strong confirmation that aurora is overhead.'
    }), []);
    
    const openModal = useCallback((id: string) => {
        const contentData = tooltipContent[id as keyof typeof tooltipContent];
        if (contentData) {
            let title = '';
            if (id === 'unified-forecast') title = 'About The Spot the Aurora Forecast';
            else if (id === 'ips') title = 'About Interplanetary Shocks';
            else if (id === 'live-cameras') title = 'About Live Cameras';
            else if (id === 'substorm') title = 'About GOES Magnetometer (Substorm Watch)';
            else if (id === 'nz-mag') title = 'About the NZ Magnetometer';
            else title = (id.charAt(0).toUpperCase() + id.slice(1)).replace(/([A-Z])/g, ' $1').trim();
            setModalState({ isOpen: true, title: title, content: contentData });
        }
    }, [tooltipContent]);
    const closeModal = useCallback(() => setModalState(null), []);

    const cameraSettings = useMemo(() => getSuggestedCameraSettings(auroraScore, isDaylight), [auroraScore, isDaylight]);
    const auroraBlurb = useMemo(() => getAuroraBlurb(auroraScore), [auroraScore]);
    
    const getMagnetometerAnnotations = useCallback(() => {
        return {};
    }, []);

    const latestMaxDelta = useMemo(() => {
        if (!nzMagSubstormEvents || nzMagSubstormEvents.length === 0) return null;
        return nzMagSubstormEvents[nzMagSubstormEvents.length - 1].maxDelta;
    }, [nzMagSubstormEvents]);

    const simpleViewStatus = useMemo(() => {
        const score = auroraScore ?? 0;
        if (score >= 80) return { text: 'Huge Aurora Visible', emoji: '🤩' };
        if (score >= 50) return { text: 'Eye Visibility Possible', emoji: '👁️' };
        if (score >= 35) return { text: 'Phone Visibility Possible', emoji: '📱' };
        if (score >= 20) return { text: 'Camera Visibility Possible', emoji: '📷' };
        if (score >= 10) return { text: 'Minimal Activity', emoji: '😐' };
        return { text: 'No Aurora Expected', emoji: '😞' };
    }, [auroraScore]);

    const actionOneLiner = useMemo(() => {
        const score = auroraScore ?? 0;

        if (isDaylight) return "It's daytime. Check back after sunset for the nighttime forecast.";
        
        if (substormForecast.status === 'ONSET') {
            if (score < 20) return "An eruption is underway, but needs more power. Currently not worth heading out for.";
            if (score < 30) return "An eruption has started and is heading in the right direction, but needs a little more power.";
            if (score < 50) return "An eruption is underway! Cameras should start to pick up good activity. Find a dark spot.";
            return "GO NOW! An aurora eruption is detected with good power. Look south immediately!";
        }

        if (substormForecast.status === 'IMMINENT_30') return "GET READY! An eruption is highly likely within 30 minutes. Head to your spot.";
        
        if (score >= 50) return "CONDITIONS ARE GOOD. A visible aurora is possible. Find a dark spot and be patient.";
        if (score >= 35) return "WORTH A LOOK. A modern phone might capture an aurora. Find a very dark location.";
        if (score >= 20) return "CAMERA ONLY. A DSLR/Mirrorless with a long exposure may pick up a faint glow.";
        
        return "STAY INDOORS. Conditions are very quiet, an aurora is unlikely tonight.";
    }, [auroraScore, substormForecast.status, isDaylight]);

    if (isLoading) {
        return <div className="w-full h-full flex justify-center items-center bg-neutral-900"><LoadingSpinner /></div>;
    }

    const faqContent = `<div class="space-y-4"><div><h4 class="font-bold text-neutral-200">Why don't you use the Kp-index?</h4><p>The Kp-index is a fantastic tool for measuring global geomagnetic activity, but it's not real-time. It is an "average" calculated every 3 hours, so it often describes what *has already happened*. For a live forecast, we need data that's updated every minute. Relying on the Kp-index would be like reading yesterday's weather report to decide if you need an umbrella right now.</p></div><div><h4 class="font-bold text-neutral-200">What data SHOULD I look at then?</h4><p>The most critical live data points for aurora nowcasting are:</p><ul class="list-disc list-inside pl-2 mt-1"><li><strong>IMF Bz:</strong> The "gatekeeper". A strong negative (southward) value opens the door for the aurora.</li><li><strong>Solar Wind Speed:</strong> The "power". Faster speeds lead to more energetic and dynamic displays.</li><li><strong>Solar Wind Density:</strong> The "thickness". Higher density can result in a brighter, more widespread aurora.</li></ul></div><div><h4 class="font-bold text-neutral-200">The forecast is high but I can't see anything. Why?</h4><p>This can happen for several reasons! The most common are:</p><ul class="list-disc list-inside pl-2 mt-1"><li><strong>Clouds:</strong> The number one enemy of aurora spotting. Use the cloud map on this dashboard to check for clear skies.</li><li><strong>Light Pollution:</strong> You must be far away from town and urban area lights.</li><li><strong>The Moon:</strong> A bright moon can wash out all but the most intense auroras.</li><li><strong>Eye Adaptation:</strong> It takes at least 15-20 minutes in total darkness for your eyes to become sensitive enough to see faint glows.</li><li><strong>Patience:</strong> Auroral activity happens in waves (substorms). A quiet period can be followed by an intense outburst. Don't give up after just a few minutes.</li></ul></div><div><h4 class="font-bold text-neutral-200">Where does your data from?</h4><p>All our live solar wind and magnetic field data comes directly from NASA and NOAA, sourced from satellites positioned 1.5 million km from Earth, like the DSCOVR and ACE spacecraft. This dashboard fetches new data every minute. The "Spot The Aurora Forecast" score is then calculated using a proprietary algorithm that combines this live data with local factors for the West Coast of NZ, but is still applicable for the entire New Zealand with some modification.</p></div></div>`;

    return (
        <div className="w-full h-full bg-neutral-900 text-neutral-300 relative" style={{ backgroundImage: `url('/background-aurora.jpg')`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed' }}>
            <div className="absolute inset-0 bg-black/50 z-0"></div>
            <div className="w-full h-full overflow-y-auto p-5 relative z-10 styled-scrollbar">
                 <div className="container mx-auto">
                    <header className="text-center mb-4">
                        <a href="https://www.tnrprotography.co.nz" target="_blank" rel="noopener noreferrer"><img src="https://www.tnrprotography.co.nz/uploads/1/3/6/6/136682089/white-tnr-protography-w_orig.png" alt="TNR Protography Logo" className="mx-auto w-full max-w-[250px] mb-4"/></a>
                        <h1 className="text-3xl font-bold text-neutral-100">Spot The Aurora - New Zealand Aurora Forecast</h1>
                    </header>
                     <div className="flex justify-center items-center gap-4 mb-6">
                        <button onClick={() => onViewModeChange('simple')} className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${viewMode === 'simple' ? 'bg-sky-500/30 border border-sky-400 text-white' : 'bg-neutral-800/80 border border-neutral-700/60 text-neutral-300 hover:bg-neutral-700'}`}>
                            Simple View
                        </button>
                        <button onClick={() => onViewModeChange('advanced')} className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${viewMode === 'advanced' ? 'bg-purple-500/30 border border-purple-400 text-white' : 'bg-neutral-800/80 border border-neutral-700/60 text-neutral-300 hover:bg-neutral-700'}`}>
                            Advanced View
                        </button>
                    </div>

                    {viewMode === 'simple' ? (
                        <main className="grid grid-cols-12 gap-6">
                            <div className="col-span-12 card bg-neutral-950/80 p-6 text-center">
                                <div className="text-7xl font-extrabold" style={{color: GAUGE_COLORS[getForecastScoreColorKey(auroraScore ?? 0)].solid}}>
                                    {(auroraScore ?? 0).toFixed(1)}%
                                </div>
                                <div className="text-2xl mt-2 font-semibold">
                                    {simpleViewStatus.emoji} {simpleViewStatus.text}
                                </div>
                                
                                {auroraScore !== null && auroraScore >= 10 && (
                                    <div className="mt-6">
                                        <div className="text-sm font-semibold text-neutral-300 mb-1">Confidence</div>
                                        <div className="w-full bg-neutral-700 rounded-full h-2.5 max-w-sm mx-auto">
                                            <div className="bg-sky-500 h-2.5 rounded-full" style={{width: `${substormForecast.likelihood}%`}}></div>
                                        </div>
                                        <div className="text-xs text-neutral-400 mt-1">{substormForecast.likelihood}% chance of substorm activity</div>
                                    </div>
                                )}

                                <div className="mt-6 bg-neutral-900/70 p-4 rounded-lg border border-neutral-700/60 max-w-lg mx-auto">
                                    <p className="text-lg font-semibold text-amber-300">{actionOneLiner}</p>
                                </div>
                            </div>
                            
                            <AuroraSightings isDaylight={isDaylight} refreshSignal={refreshSignal} />

                            <ActivitySummaryDisplay summary={activitySummary} />

                            <SimpleTrendChart auroraScoreHistory={auroraScoreHistory} />

                            <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col">
                                <h3 className="text-xl font-semibold text-center text-white mb-4">Live Cloud Cover</h3>
                                <div className="relative w-full" style={{paddingBottom: "56.25%"}}><iframe title="Windy.com Cloud Map" className="absolute top-0 left-0 w-full h-full rounded-lg" src="https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=mm&metricTemp=°C&zoom=5&overlay=clouds&product=ecmwf&level=surface&lat=-44.757&lon=169.054" frameBorder="0"></iframe></div>
                            </div>

                            <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col">
                                <div className="flex justify-center items-center mb-4">
                                    <h3 className="text-xl font-semibold text-center text-white">Live Cameras</h3>
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
                        </main>
                    ) : (
                        <main className="grid grid-cols-12 gap-6">
                            <ActivityAlert isDaylight={isDaylight} celestialTimes={celestialTimes} auroraScoreHistory={auroraScoreHistory} />

                            <UnifiedForecastPanel
                              score={auroraScore}
                              blurb={auroraBlurb}
                              lastUpdated={lastUpdated}
                              locationBlurb={locationBlurb}
                              getGaugeStyle={getGaugeStyle}
                              getScoreColorKey={getForecastScoreColorKey}
                              getAuroraEmoji={getAuroraEmoji}
                              gaugeColors={GAUGE_COLORS}
                              onOpenModal={() => openModal('unified-forecast')}
                              substormForecast={substormForecast}
                            />

                            <ActivitySummaryDisplay summary={activitySummary} />

                            <ForecastTrendChart
                                auroraScoreHistory={auroraScoreHistory}
                                dailyCelestialHistory={dailyCelestialHistory}
                                owmDailyForecast={owmDailyForecast}
                                onOpenModal={() => openModal('forecast')}
                            />

                            <AuroraSightings isDaylight={isDaylight} refreshSignal={refreshSignal} />

                            <ForecastChartPanel title="Interplanetary Magnetic Field" currentValue={`Bt: ${gaugeData.bt.value} / Bz: ${gaugeData.bz.value} <span class='text-base'>nT</span>`} emoji={gaugeData.bz.emoji} onOpenModal={() => openModal('bz')}>
                                <MagneticFieldChart data={allMagneticData} />
                            </ForecastChartPanel>

                            <ForecastChartPanel title="Hemispheric Power" currentValue={`${gaugeData.power.value} <span class='text-base'>GW</span>`} emoji={gaugeData.power.emoji} onOpenModal={() => openModal('power')}>
                                <HemisphericPowerChart data={hemisphericPowerHistory.map(d => ({ x: d.timestamp, y: d.hemisphericPower }))} />
                            </ForecastChartPanel>

                            <ForecastChartPanel title="Solar Wind Speed" currentValue={`${gaugeData.speed.value} <span class='text-base'>km/s</span>`} emoji={gaugeData.speed.emoji} onOpenModal={() => openModal('speed')}>
                                <SolarWindSpeedChart data={allSpeedData} />
                            </ForecastChartPanel>

                            <ForecastChartPanel title="Solar Wind Density" currentValue={`${gaugeData.density.value} <span class='text-base'>p/cm³</span>`} emoji={gaugeData.density.emoji} onOpenModal={() => openModal('density')}>
                                <SolarWindDensityChart data={allDensityData} />
                            </ForecastChartPanel>

                            <ForecastChartPanel title="Moon Illumination & Arc" currentValue={gaugeData.moon.value} emoji={gaugeData.moon.emoji} onOpenModal={() => openModal('moon')}>
                                <MoonArcChart dailyCelestialHistory={dailyCelestialHistory} owmDailyForecast={owmDailyForecast} />
                            </ForecastChartPanel>

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

                            <ForecastChartPanel
                                title="Substorm Activity"
                                currentValue={
                                    substormForecast.status === 'ONSET'
                                        ? `ONSET DETECTED`
                                        : substormForecast.status.replace('_', ' ')
                                }
                                emoji="⚡"
                                onOpenModal={() => openModal(activeMagnetometer === 'goes' ? 'substorm' : 'nz-mag')}
                            >
                               <div className="flex justify-center items-center gap-4 mb-2">
                                    <button
                                        onClick={() => setActiveMagnetometer('nz')}
                                        className={`px-4 py-1 text-sm rounded transition-colors ${activeMagnetometer === 'nz' ? 'bg-green-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}
                                    >
                                        Ground Confirmation (NZ)
                                    </button>
                                    <button
                                        onClick={() => setActiveMagnetometer('goes')}
                                        className={`px-4 py-1 text-sm rounded transition-colors ${activeMagnetometer === 'goes' ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}
                                    >
                                        Satellite Forecast (GOES)
                                    </button>
                               </div>

                               <div className="min-h-[350px]">
                                    {activeMagnetometer === 'goes' ? (
                                        <div className="h-full">
                                            <SubstormChart
                                                goes18Data={goes18Data}
                                                goes19Data={goes19Data}
                                                annotations={getMagnetometerAnnotations()}
                                                loadingMessage={loadingMagnetometer}
                                            />
                                        </div>
                                    ) : (
                                        <div className={`flex flex-col md:flex-row gap-4 h-full transition-all duration-300 rounded-lg ${substormForecast.status === 'ONSET' ? 'border-2 border-red-500/80 shadow-[0_0_15px_rgba(239,68,68,0.6)] p-2' : 'border-2 border-transparent p-2'}`}>
                                            <div className="w-full md:w-2/3 h-full">
                                                <NzMagnetometerChart
                                                    data={nzMagData}
                                                    events={nzMagSubstormEvents}
                                                    selectedEvent={selectedNzMagEvent}
                                                    loadingMessage={loadingNzMag}
                                                />
                                            </div>
                                            <div className="w-full md:w-1/3 h-full flex flex-col mt-4 md:mt-0 bg-neutral-900/50 p-3 rounded-lg">
                                                <h4 className="text-sm font-semibold text-neutral-300 mb-2 text-center flex-shrink-0">Past 24h Events</h4>
                                                <div className="flex-grow overflow-y-auto styled-scrollbar pr-2 min-h-[100px]">
                                                    {nzMagSubstormEvents.length > 0 ? (
                                                        nzMagSubstormEvents.slice().reverse().map((event, index) => (
                                                            <div
                                                                key={index}
                                                                onClick={() => setSelectedNzMagEvent(event)}
                                                                className={`p-2 rounded-md text-xs cursor-pointer transition-colors mb-2 ${selectedNzMagEvent?.start === event.start ? 'bg-sky-700/50' : 'bg-neutral-800/70 hover:bg-neutral-700/70'}`}
                                                            >
                                                                <p><strong>Time:</strong> {new Date(event.start).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - {new Date(event.end).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                                                                <p><strong>Max Delta:</strong> {event.maxDelta.toFixed(1)} nT/min</p>
                                                            </div>
                                                        ))
                                                    ) : (
                                                        <p className="text-xs text-neutral-500 italic text-center pt-4">No significant local events detected in the past 24 hours.</p>
                                                    )}
                                                </div>
                                            </div>
                                       </div>
                                   )}
                               </div>
                            </ForecastChartPanel>

                            <div className="col-span-12 grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <TipsSection />
                                <CameraSettingsSection settings={cameraSettings} />
                            </div>

                            <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col">
                                <div className="flex justify-center items-center"><h2 className="text-xl font-semibold text-center text-white">ACE EPAM (Last 3 Days)</h2><button onClick={() => openModal('epam')} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button></div>
                                 <div onClick={() => setViewerMedia && epamImageUrl !== '/placeholder.png' && setViewerMedia({ url: epamImageUrl, type: 'image' })} className="flex-grow relative mt-2 cursor-pointer min-h-[300px]"><img src={epamImageUrl} alt="ACE EPAM Data" className="w-full h-full object-contain" /></div>
                            </div>

                            <div className="col-span-12">
                                <button
                                    onClick={handleDownloadForecastImage}
                                    className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-neutral-900/80 border border-neutral-700/60 rounded-lg text-neutral-300 hover:bg-neutral-800 transition-colors font-semibold"
                                >
                                    <DownloadIcon className="w-6 h-6" />
                                    <span>Download The Aurora Forecast For The Next Two Hours!</span>
                                </button>
                            </div>
                        </main>
                    )}

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

            {modalState && <InfoModal isOpen={modalState.isOpen} onClose={closeModal} title={modalState.title} content={modalState.content} />}
            <InfoModal isOpen={isFaqOpen} onClose={() => setIsFaqOpen(false)} title="Frequently Asked Questions" content={faqContent} />
        </div>
    );
};

export default ForecastDashboard;
//--- END OF FILE src/components/ForecastDashboard.tsx ---