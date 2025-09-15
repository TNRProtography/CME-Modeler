//--- START OF FILE src/components/ForecastDashboard.tsx ---

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import LoadingSpinner from './icons/LoadingSpinner';
import AuroraSightings from './AuroraSightings';
import GuideIcon from './icons/GuideIcon';
import { useForecastData } from '../hooks/useForecastData';
import { UnifiedForecastPanel } from './UnifiedForecastPanel';
import ForecastChartPanel from './ForecastChartPanel'; // Import the new panel component

import {
    TipsSection,
    CameraSettingsSection,
    InfoModal,
    ActivityAlert
} from './ForecastComponents';

import {
    ForecastTrendChart,
    SolarWindSpeedChart,
    SolarWindDensityChart,
    MagneticFieldChart,
    HemisphericPowerChart,
    SubstormChart,
    MoonArcChart,
    NzMagnetometerChart,
} from './ForecastCharts';
import { SubstormActivity, SubstormForecast, ActivitySummary } from '../types';
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


const ForecastDashboard: React.FC<ForecastDashboardProps> = ({ setViewerMedia, setCurrentAuroraScore, setSubstormActivityStatus, navigationTarget }) => {
    const {
        isLoading, auroraScore, lastUpdated, gaugeData, isDaylight, celestialTimes, auroraScoreHistory, dailyCelestialHistory,
        owmDailyForecast, locationBlurb, fetchAllData, allSpeedData, allDensityData, allMagneticData, hemisphericPowerHistory,
        goes18Data, goes19Data, loadingMagnetometer, nzMagData, loadingNzMag, substormForecast, activitySummary
    } = useForecastData(setCurrentAuroraScore, setSubstormActivityStatus);
    
    const [modalState, setModalState] = useState<{ isOpen: boolean; title: string; content: string | React.ReactNode } | null>(null);
    const [isFaqOpen, setIsFaqOpen] = useState(false);
    const [epamImageUrl, setEpamImageUrl] = useState<string>('/placeholder.png');
    const [selectedCamera, setSelectedCamera] = useState<Camera>(CAMERAS.find(c => c.name === 'Queenstown')!);
    const [cameraImageSrc, setCameraImageSrc] = useState<string>('');

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
        'unified-forecast': `<strong>About the Spot The Aurora Forecast</strong><br>This panel is your primary guide, combining the general aurora visibility potential with a specific, short-term forecast for intense bursts of activity called substorms.<br><br>
            <strong>Spot The Aurora Score (Left Side)</strong><br>
            This percentage score indicates the general likelihood of seeing an aurora based on live space weather data.
            <ul class='space-y-2 mt-2'>
                <li><strong>Below 10% (😞):</strong> Little to no auroral activity.</li>
                <li><strong>10% - 25% (😐):</strong> Minimal activity, likely camera-only.</li>
                <li><strong>25% - 40% (😊):</strong> Visible in photos, maybe faint to the naked eye.</li>
                <li><strong>40% - 50% (🙂):</strong> Faint naked-eye glow possible.</li>
                <li><strong>50% - 80% (😀):</strong> Good chance of visible color and movement.</li>
                <li><strong>80%+ (🤩):</strong> High probability of a significant, dynamic display.</li>
            </ul>
            <br>
            <strong>Substorm Forecast (Right Side)</strong><br>
            This section activates when conditions are right for a substorm. It's a predictive model for short, powerful bursts of aurora.
            <ul class='space-y-2 mt-2'>
                <li><strong>Status:</strong> Shows the current phase, from QUIET (low energy) to WATCH (building energy) to ONSET (erupting now).</li>
                <li><strong>Recommended Action:</strong> Plain-English advice on what to do. This is your key takeaway.</li>
                <li><strong>Window & Likelihood:</strong> The model's best guess for when a substorm might begin and its probability in the next hour.</li>
            </ul>
            <br>
            The <strong>Overall Status</strong> at the top-right summarizes the most important current condition.`,
        'power': `<strong>What it is:</strong> Think of this as the 'volume knob' for the aurora's brightness. It measures the total amount of energy the Sun's particles are dumping into Earth's atmosphere.<br><br><strong>Effect on Aurora:</strong> The higher the power, the more energy is available to light up the sky. High power can lead to a brighter and more widespread aurora.`,
        'speed': `<strong>What it is:</strong> The Sun constantly streams out a flow of particles called the solar wind. This measures how fast that stream is moving.<br><br><strong>Effect on Aurora:</strong> Faster particles hit our atmosphere with more energy, like a faster pitch. This can create more vibrant colors (like pinks and purples) and cause the aurora to dance and move more quickly.`,
        'density': `<strong>What it is:</strong> This measures how 'crowded' or 'thick' the stream of solar wind particles is.<br><br><strong>Effect on Aurora:</strong> Higher density is like using a wider paintbrush. More particles are hitting the atmosphere at once, which can make the aurora appear brighter and cover a larger area of the sky.`,
        'bt': `<strong>What it is:</strong> The stream of particles from the Sun has its own magnetic field. 'Bt' measures the total strength of that magnetic field.<br><br><strong>Effect on Aurora:</strong> A high Bt value means the magnetic field is strong and carrying a lot of energy. By itself, it doesn't do much, but if the 'Bz' direction is right, this stored energy can be unleashed to create a powerful display.`,
        'bz': `<strong>What it is:</strong> This is the most important ingredient for an aurora. Earth is protected by a magnetic shield. The 'Bz' value tells us the North-South direction of the Sun's magnetic field.<br><br><strong>Effect on Aurora:</strong> Think of Bz as the 'master switch'. When Bz points **South (a negative number)**, it's like a key turning in a lock. It opens a door in Earth's shield, allowing energy and particles to pour in. When Bz is North (positive), the door is closed. **The more negative the Bz, the better the aurora!**`,
        'epam': `<strong>What it is:</strong> A sensor on a satellite far away that acts as an early-warning system. It counts very fast, high-energy particles that are often pushed ahead of a major solar eruption.<br><br><strong>Effect on Aurora:</strong> A sudden, sharp spike on this chart is a strong clue that a 'shockwave' from a solar eruption (a CME) is about to hit Earth, which can trigger a major aurora storm.`,
        'moon': `<strong>What it is:</strong> The percentage of the moon that is lit up by the Sun, and its projected path in the sky for the next 24 hours.<br><br><strong>Effect on Aurora:</strong> The moon is like a giant natural street light. A bright, full moon (100%) will wash out all but the most intense auroras. A new moon (0%) provides the darkest skies, making it much easier to see faint glows. The chart helps you plan around when the moon will be below the horizon.`,
        'ips': `<strong>What it is:</strong> The 'shockwave' at the front of a large cloud of solar particles (a CME) travelling from the Sun. This table shows when these shockwaves have recently hit our satellites.<br><br><strong>Effect on Aurora:</strong> The arrival of a shockwave is a major event. It can cause a sudden and dramatic change in all the other conditions (speed, density, Bz) and often triggers a strong auroral display very soon after it arrives.`,
        'live-cameras': `<strong>What are these?</strong><br>These are public webcams from around New Zealand. They are a reality check for the forecast data.<br><br><strong>How do they help?</strong><br>You can use them to:<br><ul class="list-disc list-inside space-y-2 mt-2"><li><strong>Check for Clouds:</strong> The number one enemy of aurora spotting. Use the cloud map on this dashboard to check for clear skies.</li><li><strong>Spot Faint Aurora:</strong> These cameras are often more sensitive than our eyes and can pick up glows we might miss.</li><li><strong>Verify Conditions:</strong> If the forecast is high and a southern camera shows a clear sky, your chances are good!</li></ul>`,
        'substorm': 'This chart shows data from the GOES satellite in geostationary orbit. The "Hp" component measures the magnetic field parallel to Earth\'s rotation axis. A slow decrease ("stretching phase") followed by a sharp increase ("dipolarization" or "jump") is a classic signature of a substorm onset, which often corresponds with a bright auroral display.',
        'nz-mag': '<strong>What it is:</strong> This chart displays real-time data from a ground-based magnetometer located at West Melton, New Zealand. It measures the rate of change of the horizontal component (dH/dt) of Earth\'s magnetic field.<br><br><strong>Effect on Aurora:</strong> During a substorm, the reconfiguration of the magnetic field causes rapid fluctuations, seen as high volatility (large spikes) on this chart. This is the most definitive, localized proof that an auroral event is happening directly over our region. It serves as a high-confidence confirmation of the forecasts from satellite data.'
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

                        <div className="col-span-12">
                            <button 
                                onClick={handleDownloadForecastImage}
                                className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-neutral-900/80 border border-neutral-700/60 rounded-lg text-neutral-300 hover:bg-neutral-800 transition-colors font-semibold"
                            >
                                <DownloadIcon className="w-6 h-6" />
                                <span>Download The Aurora Forecast For The Next Two Hours!</span>
                            </button>
                        </div>
                        
                        <AuroraSightings isDaylight={isDaylight} />
                        
                        <ActivitySummaryDisplay summary={activitySummary} />

                        {/* --- CHART PANELS --- */}
                        <ForecastChartPanel title="Solar Wind Speed" currentValue={`${gaugeData.speed.value} <span class='text-base'>km/s</span>`} emoji={gaugeData.speed.emoji} onOpenModal={() => openModal('speed')}>
                            <SolarWindSpeedChart data={allSpeedData} />
                        </ForecastChartPanel>

                        <ForecastChartPanel title="Solar Wind Density" currentValue={`${gaugeData.density.value} <span class='text-base'>p/cm³</span>`} emoji={gaugeData.density.emoji} onOpenModal={() => openModal('density')}>
                            <SolarWindDensityChart data={allDensityData} />
                        </ForecastChartPanel>

                        <ForecastChartPanel title="Interplanetary Magnetic Field" currentValue={`Bt: ${gaugeData.bt.value} / Bz: ${gaugeData.bz.value} <span class='text-base'>nT</span>`} emoji={gaugeData.bz.emoji} onOpenModal={() => openModal('bz')}>
                            <MagneticFieldChart data={allMagneticData} />
                        </ForecastChartPanel>

                        <ForecastChartPanel title="Hemispheric Power" currentValue={`${gaugeData.power.value} <span class='text-base'>GW</span>`} emoji={gaugeData.power.emoji} onOpenModal={() => openModal('power')}>
                            <HemisphericPowerChart data={hemisphericPowerHistory.map(d => ({ x: d.timestamp, y: d.hemisphericPower }))} />
                        </ForecastChartPanel>

                        <ForecastChartPanel title="Substorm Watch (GOES)" currentValue={substormForecast.status.replace('_', ' ')} emoji="⚡" onOpenModal={() => openModal('substorm')}>
                           <SubstormChart goes18Data={goes18Data} goes19Data={goes19Data} annotations={getMagnetometerAnnotations()} loadingMessage={loadingMagnetometer} />
                        </ForecastChartPanel>
                        
                        <ForecastChartPanel title="Substorm Watch (West Melton)" currentValue={substormForecast.status === 'ONSET' && nzMagData.length > 0 ? "ONSET DETECTED" : "Monitoring..."} emoji="📡" onOpenModal={() => openModal('nz-mag')}>
                           <NzMagnetometerChart data={nzMagData} loadingMessage={loadingNzMag} />
                        </ForecastChartPanel>

                        <ForecastChartPanel title="Moon Illumination & Arc" currentValue={gaugeData.moon.value} emoji={gaugeData.moon.emoji} onOpenModal={() => openModal('moon')}>
                            <MoonArcChart dailyCelestialHistory={dailyCelestialHistory} owmDailyForecast={owmDailyForecast} />
                        </ForecastChartPanel>


                        <div className="col-span-12 grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <TipsSection />
                            <CameraSettingsSection settings={cameraSettings} />
                        </div>
                        
                        <ForecastTrendChart 
                            auroraScoreHistory={auroraScoreHistory}
                            dailyCelestialHistory={dailyCelestialHistory}
                            owmDailyForecast={owmDailyForecast}
                            onOpenModal={() => openModal('forecast')}
                        />

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

            {modalState && <InfoModal isOpen={modalState.isOpen} onClose={closeModal} title={modalState.title} content={modalState.content} />}
            <InfoModal isOpen={isFaqOpen} onClose={() => setIsFaqOpen(false)} title="Frequently Asked Questions" content={faqContent} />
        </div>
    );
};

export default ForecastDashboard;
//--- END OF FILE src/components/ForecastDashboard.tsx ---