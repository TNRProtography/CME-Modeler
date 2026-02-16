//--- START OF FILE src/components/ForecastDashboard.tsx ---

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import LoadingSpinner from './icons/LoadingSpinner';
import AuroraSightings from './AuroraSightings';
import GuideIcon from './icons/GuideIcon';
import { useForecastData } from '../hooks/useForecastData';
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
    SolarWindTemperatureChart,
    IMFClockChart,
    MagneticFieldChart,
    HemisphericPowerChart,
    MoonArcChart,
} from './ForecastCharts';
import { SubstormActivity, SubstormForecast, ActivitySummary, InterplanetaryShock } from '../types';

// --- ICONS ---
const DownloadIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
);

// --- ORIGINAL CONSTANTS (Moved to top to fix ReferenceError) ---
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

// --- TYPES ---
interface ForecastDashboardProps {
  setViewerMedia?: (media: { url: string, type: 'image' | 'video' } | null) => void;
  setCurrentAuroraScore: (score: number | null) => void;
  setSubstormActivityStatus: (status: SubstormActivity | null) => void;
  setIpsAlertData: (data: { shock: InterplanetaryShock; solarWind: { speed: string; bt: string; bz: string; } } | null) => void;
  navigationTarget: { page: string; elementId: string; expandId?: string; } | null;
  onInitialLoad?: () => void;
  viewMode: 'simple' | 'advanced';
  onViewModeChange: (mode: 'simple' | 'advanced') => void;
  refreshSignal: number;
}

interface Camera {
  name: string;
  url: string;
  type: 'image' | 'iframe';
  sourceUrl: string;
}

// --- HELPER FUNCTIONS ---
const getForecastScoreColorKey = (score: number) => {
    if (score >= 80) return 'pink'; if (score >= 50) return 'purple'; if (score >= 40) return 'red';
    if (score >= 25) return 'orange'; if (score >= 10) return 'yellow';
    return 'gray';
};

const getGaugeStyle = (
    value: number | null,
    type: 'power' | 'speed' | 'density' | 'bt' | 'bz'
) => {
    if (value === null || !Number.isFinite(value)) {
        return { color: GAUGE_COLORS.gray.solid, emoji: GAUGE_EMOJIS.gray, percentage: 0 };
    }

    const thresholds = GAUGE_THRESHOLDS[type];
    let key: keyof typeof GAUGE_COLORS = 'gray';

    if (type === 'bz') {
        if (value <= thresholds.pink) key = 'pink';
        else if (value <= thresholds.purple) key = 'purple';
        else if (value <= thresholds.red) key = 'red';
        else if (value <= thresholds.orange) key = 'orange';
        else if (value <= thresholds.yellow) key = 'yellow';
    } else {
        if (value >= thresholds.pink) key = 'pink';
        else if (value >= thresholds.purple) key = 'purple';
        else if (value >= thresholds.red) key = 'red';
        else if (value >= thresholds.orange) key = 'orange';
        else if (value >= thresholds.yellow) key = 'yellow';
    }

    const maxExpected =
        type === 'bz'
            ? Math.abs(thresholds.maxNegativeExpected ?? thresholds.pink)
            : thresholds.maxExpected ?? Math.abs(thresholds.pink);
    const percentage = Math.max(0, Math.min(100, (Math.abs(value) / maxExpected) * 100));

    return { color: GAUGE_COLORS[key].solid, emoji: GAUGE_EMOJIS[key], percentage };
};

const getAuroraEmoji = (score: number | null) => {
    if (score === null) return '❓';
    if (score >= 80) return '🤩';
    if (score >= 50) return '🌌';
    if (score >= 35) return '📱';
    if (score >= 20) return '📷';
    if (score >= 10) return '😐';
    return '😴';
};

const getSuggestedCameraSettings = (score: number | null, isDaylight: boolean) => {
    if (isDaylight) {
        return {
            overall: 'It is currently daylight. Camera settings are not applicable until after sunset.',
            phone: {
                android: { iso: 'Auto', shutter: 'Auto', aperture: 'Auto', focus: 'Auto', wb: 'Auto' },
                apple: { iso: 'Auto', shutter: 'Auto', aperture: 'Auto', focus: 'Auto', wb: 'Auto' },
            },
            dslr: { iso: 'Auto', shutter: 'Auto', aperture: 'Auto', focus: 'Auto', wb: 'Auto' },
        };
    }

    const strength = score ?? 0;
    const strong = strength >= 50;
    const moderate = strength >= 25;

    return {
        overall: strong
            ? 'Strong activity expected. Shorter exposures reduce blowout.'
            : moderate
            ? 'Moderate activity. Start with a balanced exposure and adjust as needed.'
            : 'Low activity. Longer exposures and higher ISO may be required.',
        phone: {
            android: {
                iso: strong ? '800-1600' : moderate ? '1600-3200' : '3200-6400',
                shutter: strong ? '3-6s' : moderate ? '6-10s' : '10-15s',
                aperture: 'Wide open',
                focus: 'Infinity',
                wb: '3500-4200K',
            },
            apple: {
                iso: strong ? 'Auto' : moderate ? 'Auto' : 'Auto',
                shutter: strong ? '3-6s' : moderate ? '6-10s' : '10-15s',
                aperture: 'Wide open',
                focus: 'Infinity',
                wb: '3500-4200K',
            },
        },
        dslr: {
            iso: strong ? '1600-3200' : moderate ? '3200-6400' : '6400+',
            shutter: strong ? '3-6s' : moderate ? '6-10s' : '10-15s',
            aperture: 'f/1.4 – f/2.8',
            focus: 'Infinity',
            wb: '3500-4200K',
        },
    };
};


const isImapSource = (source?: string) => source === 'IMAP';

const formatTimeHHMM = (timestamp: number | null | undefined): string => {
    if (!timestamp || !Number.isFinite(timestamp)) return '—';
    return new Date(timestamp).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false });
};

const getLatestPointTime = (series: Array<{ x?: number; time?: number; timestamp?: number }>): number | null => {
    let latest: number | null = null;
    for (const point of series) {
        const t = point?.x ?? point?.time ?? point?.timestamp;
        if (typeof t === 'number' && Number.isFinite(t) && (latest === null || t > latest)) {
            latest = t;
        }
    }
    return latest;
};

const ActivitySummaryDisplay: React.FC<{ summary: ActivitySummary }> = ({ summary }) => {
    if (!summary) return null;
    const latestEvent = summary.substormEvents?.[summary.substormEvents.length - 1];
    return (
        <div className="col-span-12 card bg-neutral-950/80 p-4">
            <h3 className="text-xl font-semibold text-white mb-2">Recent Activity Summary</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-neutral-300">
                <div className="bg-neutral-900/70 p-3 rounded-lg border border-neutral-700/60">
                    <div className="text-neutral-400 text-xs uppercase">Peak Score</div>
                    <div className="text-lg font-semibold text-white">
                        {summary.highestScore?.finalScore?.toFixed(1) ?? 'N/A'}%
                    </div>
                    <div className="text-xs text-neutral-500">
                        {summary.highestScore?.timestamp ? new Date(summary.highestScore.timestamp).toLocaleString() : '—'}
                    </div>
                </div>
                <div className="bg-neutral-900/70 p-3 rounded-lg border border-neutral-700/60">
                    <div className="text-neutral-400 text-xs uppercase">Latest Substorm Window</div>
                    {latestEvent ? (
                        <>
                            <div className="text-lg font-semibold text-white">{latestEvent.peakStatus}</div>
                            <div className="text-xs text-neutral-500">
                                {new Date(latestEvent.start).toLocaleTimeString()} – {new Date(latestEvent.end).toLocaleTimeString()}
                            </div>
                            <div className="text-xs text-neutral-400">Peak probability: {latestEvent.peakProbability}%</div>
                        </>
                    ) : (
                        <div className="text-neutral-500 text-sm">No substorm events recorded.</div>
                    )}
                </div>
            </div>
        </div>
    );
};

const ForecastDashboard: React.FC<ForecastDashboardProps> = ({ setViewerMedia, setCurrentAuroraScore, setSubstormActivityStatus, setIpsAlertData, navigationTarget, onInitialLoad, viewMode, onViewModeChange, refreshSignal }) => {
    // ... [Original Hooks & State] ...
    const {
        isLoading, auroraScore, lastUpdated, gaugeData, isDaylight, celestialTimes, auroraScoreHistory, dailyCelestialHistory,
        owmDailyForecast, locationBlurb, fetchAllData, allSpeedData, allDensityData, allTempData, allImfClockData, allMagneticData, hemisphericPowerHistory,
        substormForecast, activitySummary, interplanetaryShockData
    } = useForecastData(setCurrentAuroraScore, setSubstormActivityStatus);
    
    // ... [Original State: modalState, isFaqOpen, etc] ...
    const [modalState, setModalState] = useState<{ isOpen: boolean; title: string; content: string | React.ReactNode } | null>(null);
    const [isFaqOpen, setIsFaqOpen] = useState(false);
    const [epamImageUrl, setEpamImageUrl] = useState<string>('/placeholder.png');
    const [selectedCamera, setSelectedCamera] = useState<Camera>(CAMERAS.find(c => c.name === 'Queenstown')!);
    const [cameraImageSrc, setCameraImageSrc] = useState<string>('');
    const initialLoadCalled = useRef(false);

    // ... [Original UseEffects & Handlers] ...
    useEffect(() => {
        if (!isLoading && onInitialLoad && !initialLoadCalled.current) {
            onInitialLoad();
            initialLoadCalled.current = true;
        }
    }, [isLoading, onInitialLoad]);

    useEffect(() => {
      fetchAllData(true, getGaugeStyle);
      const interval = setInterval(() => fetchAllData(false, getGaugeStyle), 60 * 1000);
      return () => clearInterval(interval);
    }, []);

    useEffect(() => {
      fetchAllData(false, getGaugeStyle);
    }, [fetchAllData, refreshSignal]);

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
        const width = 1600;
        const height = 2000;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const parseGaugeValue = (value?: string) => {
            if (!value) return null;
            const parsed = parseFloat(value);
            return Number.isFinite(parsed) ? parsed : null;
        };

        const score = Math.round(auroraScore ?? 0);
        const speed = parseGaugeValue(gaugeData?.speed?.value);
        const density = parseGaugeValue(gaugeData?.density?.value);
        const bt = parseGaugeValue(gaugeData?.bt?.value);
        const bz = parseGaugeValue(gaugeData?.bz?.value);
        const hp = parseGaugeValue(gaugeData?.power?.value);

        const now = new Date();
        const generatedAt = now.toLocaleString('en-NZ', {
            timeZone: 'Pacific/Auckland',
            dateStyle: 'medium',
            timeStyle: 'short',
        });

        const chanceNow = Math.round(substormForecast?.likelihood ?? 0);
        const chance30 = Math.round(substormForecast?.p30 ?? chanceNow);
        const chance60 = Math.round(substormForecast?.p60 ?? chanceNow);
        const substormWindow = substormForecast?.windowLabel || 'Monitoring for the next 60 minutes';

        const substormSize = chanceNow >= 75 ? 'Large' : chanceNow >= 45 ? 'Moderate' : 'Small';
        const substormEta = substormForecast?.status === 'ONSET'
            ? 'Now'
            : substormForecast?.status === 'IMMINENT_30'
            ? 'Within ~30 min'
            : substormForecast?.status === 'LIKELY_60'
            ? 'Within ~60 min'
            : substormWindow;

        const visibility = isDaylight
            ? 'Daylight now — next dark period is best.'
            : score >= 50
            ? 'Naked-eye visibility possible.'
            : score >= 35
            ? 'Phone and camera visibility possible.'
            : score >= 20
            ? 'Camera-first visibility likely.'
            : 'Low visibility — monitor for change.';

        const wrapText = (text: string, x: number, y: number, maxWidth: number, lineHeight: number) => {
            const words = text.split(' ');
            let line = '';
            let currentY = y;
            for (let i = 0; i < words.length; i += 1) {
                const testLine = `${line}${words[i]} `;
                const testWidth = ctx.measureText(testLine).width;
                if (testWidth > maxWidth && i > 0) {
                    ctx.fillText(line, x, currentY);
                    line = `${words[i]} `;
                    currentY += lineHeight;
                } else {
                    line = testLine;
                }
            }
            ctx.fillText(line.trimEnd(), x, currentY);
            return currentY;
        };

        const forecastBackdrop = new Image();
        const backdropLoaded = await new Promise<boolean>((resolve) => {
            forecastBackdrop.onload = () => resolve(true);
            forecastBackdrop.onerror = () => resolve(false);
            forecastBackdrop.src = '/background-aurora.jpg';
        });

        if (backdropLoaded && forecastBackdrop.width > 0 && forecastBackdrop.height > 0) {
            const imageAspect = forecastBackdrop.width / forecastBackdrop.height;
            const canvasAspect = width / height;
            let drawWidth = width;
            let drawHeight = height;
            let drawX = 0;
            let drawY = 0;

            if (imageAspect > canvasAspect) {
                drawHeight = height;
                drawWidth = height * imageAspect;
                drawX = (width - drawWidth) / 2;
            } else {
                drawWidth = width;
                drawHeight = width / imageAspect;
                drawY = (height - drawHeight) / 2;
            }

            ctx.drawImage(forecastBackdrop, drawX, drawY, drawWidth, drawHeight);
        } else {
            const bgGradient = ctx.createLinearGradient(0, 0, width, height);
            bgGradient.addColorStop(0, '#050816');
            bgGradient.addColorStop(0.45, '#112248');
            bgGradient.addColorStop(1, '#031124');
            ctx.fillStyle = bgGradient;
            ctx.fillRect(0, 0, width, height);
        }

        const topShade = ctx.createLinearGradient(0, 0, 0, height);
        topShade.addColorStop(0, 'rgba(3, 11, 25, 0.72)');
        topShade.addColorStop(0.35, 'rgba(5, 16, 36, 0.64)');
        topShade.addColorStop(1, 'rgba(1, 8, 20, 0.82)');
        ctx.fillStyle = topShade;
        ctx.fillRect(0, 0, width, height);

        const glow = ctx.createRadialGradient(width * 0.78, height * 0.18, 80, width * 0.78, height * 0.18, 760);
        glow.addColorStop(0, 'rgba(76, 224, 255, 0.24)');
        glow.addColorStop(1, 'rgba(70, 220, 255, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, width, height);

        const card = (x: number, y: number, w: number, h: number) => {
            ctx.save();
            ctx.fillStyle = 'rgba(6, 14, 30, 0.82)';
            ctx.strokeStyle = 'rgba(147, 224, 255, 0.36)';
            ctx.lineWidth = 2;
            const r = 24;
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.arcTo(x + w, y, x + w, y + h, r);
            ctx.arcTo(x + w, y + h, x, y + h, r);
            ctx.arcTo(x, y + h, x, y, r);
            ctx.arcTo(x, y, x + w, y, r);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        };

        ctx.fillStyle = '#d9f6ff';
        ctx.font = '700 72px Inter, Segoe UI, Arial, sans-serif';
        ctx.fillText('Aurora Forecast Snapshot', 90, 120);

        ctx.font = '500 34px Inter, Segoe UI, Arial, sans-serif';
        ctx.fillStyle = '#9ad8ff';
        ctx.fillText(`New Zealand · Generated ${generatedAt}`, 90, 174);

        ctx.beginPath();
        ctx.fillStyle = '#1cd8ff';
        ctx.arc(width - 130, 130, 54, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#041325';
        ctx.font = '800 42px Inter, Segoe UI, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('SA', width - 130, 145);
        ctx.textAlign = 'left';

        card(70, 230, width - 140, 300);
        const scoreGrad = ctx.createLinearGradient(0, 230, width, 530);
        scoreGrad.addColorStop(0, 'rgba(46, 198, 255, 0.18)');
        scoreGrad.addColorStop(1, 'rgba(176, 98, 255, 0.18)');
        ctx.fillStyle = scoreGrad;
        ctx.fillRect(70, 230, width - 140, 300);

        ctx.fillStyle = '#b5edff';
        ctx.font = '600 34px Inter, Segoe UI, Arial, sans-serif';
        ctx.fillText('Aurora Chance Score', 110, 300);

        ctx.fillStyle = '#ffffff';
        ctx.font = '800 132px Inter, Segoe UI, Arial, sans-serif';
        ctx.fillText(`${score}%`, 110, 430);

        ctx.font = '600 34px Inter, Segoe UI, Arial, sans-serif';
        ctx.fillStyle = '#d9f6ff';
        wrapText(visibility, 560, 355, 880, 46);

        card(70, 570, width - 140, 360);
        ctx.fillStyle = '#b5edff';
        ctx.font = '700 38px Inter, Segoe UI, Arial, sans-serif';
        ctx.fillText('Substorm Outlook', 110, 640);

        ctx.font = '600 30px Inter, Segoe UI, Arial, sans-serif';
        ctx.fillStyle = '#d9f6ff';
        ctx.fillText(`Status: ${substormForecast?.status ?? 'QUIET'}`, 110, 705);
        ctx.fillText(`Estimated Size: ${substormSize}`, 110, 755);
        ctx.fillText(`Most Likely Timing: ${substormEta}`, 110, 805);

        ctx.fillStyle = '#91f2bc';
        ctx.font = '700 30px Inter, Segoe UI, Arial, sans-serif';
        ctx.fillText(`Chance in 30 min: ${chance30}%`, 820, 705);
        ctx.fillText(`Chance in 60 min: ${chance60}%`, 820, 755);
        ctx.fillText(`Current chance: ${chanceNow}%`, 820, 805);

        ctx.fillStyle = '#9ad8ff';
        ctx.font = '500 24px Inter, Segoe UI, Arial, sans-serif';
        wrapText(substormWindow, 110, 865, width - 220, 34);

        card(70, 970, width - 140, 610);
        ctx.fillStyle = '#b5edff';
        ctx.font = '700 38px Inter, Segoe UI, Arial, sans-serif';
        ctx.fillText('Live Space Weather Stats', 110, 1040);

        const statItems = [
            ['Solar Wind Speed', speed !== null ? `${speed.toFixed(0)} km/s` : '—'],
            ['Solar Wind Density', density !== null ? `${density.toFixed(1)} p/cm³` : '—'],
            ['Solar Wind Temp', gaugeData?.temp?.value !== 'N/A' ? `${gaugeData.temp.value} K` : '—'],
            ['Magnetic Field Bt', bt !== null ? `${bt.toFixed(1)} nT` : '—'],
            ['Magnetic Field Bz', bz !== null ? `${bz.toFixed(1)} nT` : '—'],
            ['Hemispheric Power', hp !== null ? `${hp.toFixed(0)} GW` : '—'],
            ['Last Forecast Update', lastUpdated || '—'],
        ] as const;

        const colX = [110, 820];
        statItems.forEach(([label, value], index) => {
            const col = index % 2;
            const row = Math.floor(index / 2);
            const x = colX[col];
            const y = 1120 + row * 145;
            ctx.fillStyle = 'rgba(66, 154, 220, 0.22)';
            ctx.fillRect(x, y, 670, 110);
            ctx.strokeStyle = 'rgba(170, 228, 255, 0.30)';
            ctx.strokeRect(x, y, 670, 110);

            ctx.fillStyle = '#8fd5ff';
            ctx.font = '600 24px Inter, Segoe UI, Arial, sans-serif';
            ctx.fillText(label, x + 24, y + 38);
            ctx.fillStyle = '#ffffff';
            ctx.font = '700 36px Inter, Segoe UI, Arial, sans-serif';
            ctx.fillText(value, x + 24, y + 86);
        });

        ctx.fillStyle = '#89c4e5';
        ctx.font = '500 24px Inter, Segoe UI, Arial, sans-serif';
        wrapText(
            'Forecast guidance for New Zealand. Conditions can change quickly — use this snapshot with real-time sky and cloud checks.',
            110,
            1640,
            width - 220,
            34
        );

        ctx.font = '700 34px Inter, Segoe UI, Arial, sans-serif';
        ctx.fillStyle = '#d8f6ff';
        ctx.fillText('www.spottheaurora.co.nz', 110, 1880);

        const link = document.createElement('a');
        link.download = `spottheaurora-forecast-snapshot-${now.toISOString().replace(/:/g, '-')}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    }, [auroraScore, gaugeData, isDaylight, substormForecast, lastUpdated]);

    const buildStatTooltip = (title: string, whatItIs: string, auroraEffect: string, advanced: string) => `
        <div class='space-y-3 text-left'>
            <p><strong>${title}</strong></p>
            <p><strong>What this is:</strong> ${whatItIs}</p>
            <p><strong>Why it matters for aurora:</strong> ${auroraEffect}</p>
            <p class='text-xs text-neutral-400'><strong>Advanced:</strong> ${advanced}</p>
        </div>
    `;

    const tooltipContent = useMemo(() => ({
        'unified-forecast': buildStatTooltip(
            'Spot The Aurora Forecast',
            'A combined score from space-weather inputs plus local viewing conditions (darkness, moonlight, cloud context).',
            'Higher scores mean better overall chance of seeing aurora from New Zealand.',
            'This is a weighted composite signal, not a single sensor, blending solar-wind coupling proxies with local visibility constraints.'
        ),
        'forecast': buildStatTooltip(
            'Forecast Trend',
            'A timeline of forecast scores over recent hours.',
            'A rising trend means aurora potential is building; a falling trend means activity is easing.',
            'Trend direction reflects short-term changes in modeled geomagnetic forcing and local visibility weighting.'
        ),
        'bz': buildStatTooltip(
            'Interplanetary Magnetic Field (Bt/Bz and optional Bx/By)',
            'Bt is total field strength. Bz is north-south. Bx/By are extra vector components you can toggle on for advanced analysis.',
            'Negative (southward) Bz is the strongest helper for aurora. Also, if Bz is positive but By is negative, aurora can still get support in some situations.',
            'Coupling is strongest for sustained southward IMF, but vector geometry matters: negative By can modulate convection patterns and partially offset less-favorable Bz windows.'
        ),
        'power': buildStatTooltip(
            'Hemispheric Power (GW)',
            'Estimated total auroral energy being deposited into one hemisphere.',
            'Higher GW usually means brighter and wider auroral ovals, improving visibility farther north.',
            'GW is an inferred integrated precipitation power proxy and should be interpreted with timing/IMF context.'
        ),
        'speed': buildStatTooltip(
            'Solar Wind Speed',
            'How fast solar plasma is flowing past monitoring spacecraft.',
            'Faster wind can deliver energy more effectively and support stronger aurora when magnetic conditions are favorable.',
            'Speed contributes to coupling functions (e.g., Newell-like scaling); speed alone is not sufficient without favorable IMF orientation.'
        ),
        'density': buildStatTooltip(
            'Solar Wind Density',
            'How many particles are in the solar wind stream.',
            'Higher density can increase pressure on Earth’s magnetic field and trigger sharper responses, especially during shocks.',
            'Density spikes raise dynamic pressure (with speed), causing magnetopause compression and transient geomagnetic enhancements.'
        ),
        'temp': buildStatTooltip(
            'Solar Wind Temperature',
            'How hot the solar wind plasma is, measured in Kelvin.',
            'Hotter streams often come with faster, more turbulent flow that can support active aurora when Bz turns south.',
            'Temperature helps identify stream regime/structure (e.g., shock-heated or high-speed stream plasma) and adds context to speed-density changes.'
        ),
        'imf-clock': buildStatTooltip(
            'IMF Clock',
            'A compass-style angle showing IMF direction in the By/Bz plane.',
            'When the clock pointer sits in the southward half, aurora chances usually improve. If Bz is positive but By turns negative, conditions can still be somewhat supportive.',
            'Clock angle condenses By/Bz orientation into a single phase metric; energy coupling still depends on |B|, flow speed, and the persistence of that orientation.'
        ),
        'moon': buildStatTooltip(
            'Moon Illumination & Arc',
            'Current moon brightness and rise/set timing.',
            'Brighter moonlight can wash out faint aurora, so darker moon conditions help visual detection.',
            'Lunar phase and altitude change sky background luminance and practical camera SNR for faint structures.'
        ),
        'live-cameras': buildStatTooltip(
            'Live Cameras',
            'Real-time sky views from selected locations.',
            'Useful for confirming active aurora in near-real-time and checking cloud conditions before driving out.',
            'Camera exposure pipelines vary; treat feeds as situational confirmation rather than calibrated photometric instruments.'
        ),
        'epam': buildStatTooltip(
            'ACE EPAM',
            'Energetic particle monitor data from ACE spacecraft.',
            'Particle increases can indicate disturbed solar-wind conditions that may support elevated geomagnetic activity.',
            'EPAM channels are energetic particle proxies and can provide contextual lead/association signals, not deterministic aurora forecasts.'
        ),
        'substorm': buildStatTooltip(
            'Substorm Activity',
            'Short-lived magnetic energy releases in Earth’s magnetosphere.',
            'Substorms often cause sudden aurora brightening, expansion, and faster movement in the sky.',
            'Substorm onset is tied to nightside current-sheet instability and unloading after magnetotail energy storage.'
        )
    }), []);
    
    const openModal = useCallback((id: string) => {
        const contentData = tooltipContent[id as keyof typeof tooltipContent];
        if (contentData) {
            let title = (id.charAt(0).toUpperCase() + id.slice(1)).replace(/([A-Z])/g, ' $1').trim();
            setModalState({ isOpen: true, title: title, content: contentData });
        }
    }, [tooltipContent]);
    const closeModal = useCallback(() => setModalState(null), []);

    // ... [Calculated Values] ...
    const cameraSettings = useMemo(() => getSuggestedCameraSettings(auroraScore, isDaylight), [auroraScore, isDaylight]);


    const imfLastReceived = useMemo(() => formatTimeHHMM(getLatestPointTime(allMagneticData.map((p: any) => ({ time: p.time })))), [allMagneticData]);
    const powerLastReceived = useMemo(() => formatTimeHHMM(getLatestPointTime(hemisphericPowerHistory.map((p) => ({ timestamp: p.timestamp })))), [hemisphericPowerHistory]);
    const speedLastReceived = useMemo(() => formatTimeHHMM(getLatestPointTime(allSpeedData)), [allSpeedData]);
    const densityLastReceived = useMemo(() => formatTimeHHMM(getLatestPointTime(allDensityData)), [allDensityData]);
    const tempLastReceived = useMemo(() => formatTimeHHMM(getLatestPointTime(allTempData)), [allTempData]);

    const simpleViewStatus = useMemo(() => {
        const score = auroraScore ?? 0;
        if (score >= 80) return { text: 'Huge Aurora Visible', emoji: '🤩' };
        if (score >= 50) return { text: 'Eye Visibility Possible', emoji: '👁️' };
        if (score >= 35) return { text: 'Phone Visibility Possible', emoji: '📱' };
        if (score >= 20) return { text: 'Camera Visibility Possible', emoji: '📷' };
        if (score >= 10) return { text: 'Minimal Activity', emoji: '😐' };
        return { text: 'No Aurora Expected', emoji: '😞' };
    }, [auroraScore]);

    const forecastLines = useMemo(() => {
        const now = Date.now();
        const sunrise = celestialTimes?.sun?.rise ?? null;
        const sunset = celestialTimes?.sun?.set ?? null;
        const moonrise = celestialTimes?.moon?.rise ?? null;
        const moonset = celestialTimes?.moon?.set ?? null;
        const darkBufferMs = 90 * 60 * 1000;
        const sunUp = sunrise && sunset ? now >= sunrise && now <= sunset : isDaylight;
        const formatTime = (ts: number | null) =>
            ts ? new Date(ts).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' }) : '—';
        const sunriseText = formatTime(sunrise);
        const sunsetText = formatTime(sunset);
        const darkStart = sunset ? sunset + darkBufferMs : null;
        const darkEnd = sunrise ? sunrise - darkBufferMs : null;
        const darkText = darkStart && darkEnd
            ? `Dark enough ~${formatTime(darkStart)}–${formatTime(darkEnd)}`
            : 'Darkness window unavailable';

        const score = auroraScore ?? 0;
        let actionLine = 'Low odds tonight—stay home unless you are already outside.';
        if (sunUp) {
            actionLine = 'The sun is up—stay home for now and check back after dark.';
        } else if (substormForecast.status === 'ONSET') {
            actionLine = 'Aurora is happening now—get outside and look south immediately.';
        } else if (substormForecast.status === 'IMMINENT_30') {
            actionLine = 'Substorm is about to happen—go to your viewing spot and be ready.';
        } else if (substormForecast.status === 'LIKELY_60') {
            actionLine = 'Be on alert—substorm activity is likely within the next hour.';
        } else if (score >= 50) {
            actionLine = 'Good conditions—go to your viewing spot and stay ready.';
        } else if (score >= 35) {
            actionLine = 'Phone/camera chances—be on alert in a dark location.';
        } else if (score >= 20) {
            actionLine = 'Camera-only chances—consider a quick check if you are nearby.';
        }

        const sunLine = sunrise && sunset
            ? `Sunrise ${sunriseText} · Sunset ${sunsetText}`
            : 'Sunrise/Sunset times unavailable';

        const moonIllumination = celestialTimes?.moon?.illumination;
        const moonTimes = moonrise && moonset
            ? `Moonrise ${formatTime(moonrise)} · Moonset ${formatTime(moonset)}`
            : 'Moonrise/Moonset times unavailable';
        const moonLine = moonIllumination !== undefined
            ? `${moonTimes} · Illumination ${Math.round(moonIllumination)}%`
            : `${moonTimes} · Illumination unavailable`;

        return [
            sunUp ? 'The sun is up right now.' : 'The sun is down right now.',
            actionLine,
            sunLine,
            darkText,
            moonLine
        ];
    }, [auroraScore, celestialTimes, isDaylight, substormForecast.status]);

    if (isLoading) return <div className="w-full h-full flex justify-center items-center bg-neutral-900"><LoadingSpinner /></div>;

    const faqContent = `...`; // Keep original FAQ content

    return (
        <div className="w-full h-full bg-neutral-900 text-neutral-300 relative" style={{ backgroundImage: `url('/background-aurora.jpg')`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed' }}>
            <div className="absolute inset-0 bg-black/50 z-0"></div>
            <div className="w-full h-full overflow-y-auto p-5 relative z-10 styled-scrollbar">
                 <div className="container mx-auto">
                    <header className="text-center mb-4">
                        <a href="https://www.tnrprotography.co.nz" target="_blank" rel="noopener noreferrer"><img src="https://www.tnrprotography.co.nz/uploads/1/3/6/6/136682089/white-tnr-protography-w_orig.png" alt="TNR Protography Logo" className="mx-auto w-full max-w-[250px] mb-4"/></a>
                        <h1 className="text-3xl font-bold text-neutral-100">Spot The Aurora - New Zealand Aurora Forecast</h1>
                    </header>
                     <div className="flex justify-center items-center gap-2 mb-6">
                        <div className="inline-flex items-center rounded-full bg-white/5 border border-white/10 shadow-inner p-1 backdrop-blur-md">
                          <button onClick={() => onViewModeChange('simple')} className={`px-4 py-2 rounded-full text-sm font-semibold transition-all active:scale-95 ${viewMode === 'simple' ? 'bg-gradient-to-r from-sky-500/80 to-cyan-500/80 text-white shadow-lg' : 'text-neutral-200 hover:text-white'}`}>Simple View</button>
                          <button onClick={() => onViewModeChange('advanced')} className={`px-4 py-2 rounded-full text-sm font-semibold transition-all active:scale-95 ${viewMode === 'advanced' ? 'bg-gradient-to-r from-purple-500/80 to-fuchsia-500/80 text-white shadow-lg' : 'text-neutral-200 hover:text-white'}`}>Advanced View</button>
                        </div>
                    </div>

                    {viewMode === 'simple' ? (
                        <main className="grid grid-cols-12 gap-6">
                            {/* Simple View Components (Unchanged) */}
                            <div className="col-span-12 card bg-neutral-950/80 p-6 text-center">
                                <div className="text-7xl font-extrabold" style={{color: GAUGE_COLORS[getForecastScoreColorKey(auroraScore ?? 0)].solid}}>{(auroraScore ?? 0).toFixed(1)}%</div>
                                <div className="text-2xl mt-2 font-semibold">{simpleViewStatus.emoji} {simpleViewStatus.text}</div>
                                <div className="mt-6 bg-neutral-900/70 p-4 rounded-lg border border-neutral-700/60 max-w-lg mx-auto text-left">
                                    <div className="text-sm font-semibold text-amber-300 mb-2">Tonight's Forecast</div>
                                    <div className="space-y-2 text-sm text-neutral-200">
                                        {forecastLines.map((line) => (
                                            <p key={line} className="leading-relaxed">{line}</p>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            <AuroraSightings isDaylight={isDaylight} refreshSignal={refreshSignal} />
                            <ActivitySummaryDisplay summary={activitySummary} />
                            <SimpleTrendChart auroraScoreHistory={auroraScoreHistory} />
                            {/* ... (Cloud & Cameras) ... */}
                            <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col"><h3 className="text-xl font-semibold text-center text-white mb-4">Live Cloud Cover</h3><div className="relative w-full" style={{paddingBottom: "56.25%"}}><iframe title="Windy.com Cloud Map" className="absolute top-0 left-0 w-full h-full rounded-lg" src="https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=mm&metricTemp=°C&zoom=5&overlay=clouds&product=ecmwf&level=surface&lat=-44.757&lon=169.054" frameBorder="0"></iframe></div></div>
                            <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col"><div className="flex justify-center items-center mb-4"><h3 className="text-xl font-semibold text-center text-white">Live Cameras</h3></div><div className="flex justify-center gap-2 my-2 flex-wrap">{CAMERAS.map((camera) => (<button key={camera.name} onClick={() => setSelectedCamera(camera)} className={`px-3 py-1 text-xs rounded transition-colors ${selectedCamera.name === camera.name ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>{camera.name}</button>))}</div><div className="mt-4"><div className="relative w-full bg-black rounded-lg" style={{ paddingBottom: "56.25%" }}>{selectedCamera.type === 'iframe' ? (<iframe title={`Live View from ${selectedCamera.name}`} className="absolute top-0 left-0 w-full h-full rounded-lg" src={selectedCamera.url} key={selectedCamera.name} />) : (<img src={cameraImageSrc} alt={`Live View from ${selectedCamera.name}`} className="absolute top-0 left-0 w-full h-full rounded-lg object-contain" key={cameraImageSrc} onError={(e) => { e.currentTarget.src = '/placeholder.png'; e.currentTarget.alt = `Could not load camera from ${selectedCamera.name}.`; }} />)}</div><div className="text-center text-xs text-neutral-500 mt-2">Source: <a href={`http://${selectedCamera.sourceUrl}`} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">{selectedCamera.sourceUrl}</a></div></div></div>
                        </main>
                    ) : (
                        <main className="grid grid-cols-12 gap-6">
                            <ActivityAlert isDaylight={isDaylight} celestialTimes={celestialTimes} auroraScoreHistory={auroraScoreHistory} />
                            <UnifiedForecastPanel score={auroraScore} isDaylight={isDaylight} forecastLines={forecastLines} lastUpdated={lastUpdated} locationBlurb={locationBlurb} getGaugeStyle={getGaugeStyle} getScoreColorKey={getForecastScoreColorKey} getAuroraEmoji={getAuroraEmoji} gaugeColors={GAUGE_COLORS} onOpenModal={() => openModal('unified-forecast')} substormForecast={substormForecast} />
                            <ActivitySummaryDisplay summary={activitySummary} />
                            <ForecastTrendChart auroraScoreHistory={auroraScoreHistory} dailyCelestialHistory={dailyCelestialHistory} owmDailyForecast={owmDailyForecast} onOpenModal={() => openModal('forecast')} />
                            <AuroraSightings isDaylight={isDaylight} refreshSignal={refreshSignal} />
                            
                            <ForecastChartPanel
                                title="Interplanetary Magnetic Field"
                                currentValue={`Bt: ${gaugeData.bt.value} / Bz: ${gaugeData.bz.value} <span class='text-base'>nT</span><span class='text-xs block text-neutral-400'>Toggle Bx/By inside chart · Bt source: ${gaugeData.bt.source} · Bz source: ${gaugeData.bz.source}</span>`}
                                emoji={gaugeData.bz.emoji}
                                onOpenModal={() => openModal('bz')}
                                isImap={isImapSource(gaugeData.bt.source) || isImapSource(gaugeData.bz.source)}
                                lastDataReceived={imfLastReceived}
                            >
                                <MagneticFieldChart data={allMagneticData} />
                            </ForecastChartPanel>
                            <ForecastChartPanel
                                title="IMF Clock & Status"
                                currentValue={`${allImfClockData.length ? `${allImfClockData[allImfClockData.length - 1].y.toFixed(0)}°` : 'N/A'} <span class='text-base'>clock</span><span class='text-xs block text-neutral-400'>Advanced IMF orientation aid</span>`}
                                emoji="🧭"
                                onOpenModal={() => openModal('imf-clock')}
                                isImap={isImapSource(gaugeData.bt.source) || isImapSource(gaugeData.bz.source)}
                                lastDataReceived={imfLastReceived}
                            >
                                <IMFClockChart magneticData={allMagneticData} clockData={allImfClockData} />
                            </ForecastChartPanel>
                            <ForecastChartPanel title="Hemispheric Power" currentValue={`${gaugeData.power.value} <span class='text-base'>GW</span>`} emoji={gaugeData.power.emoji} onOpenModal={() => openModal('power')} lastDataReceived={powerLastReceived}><HemisphericPowerChart data={hemisphericPowerHistory.map(d => ({ x: d.timestamp, y: d.hemisphericPower }))} /></ForecastChartPanel>
                            <ForecastChartPanel
                                title="Solar Wind Speed"
                                currentValue={`${gaugeData.speed.value} <span class='text-base'>km/s</span><span class='text-xs block text-neutral-400'>Source: ${gaugeData.speed.source}</span>`}
                                emoji={gaugeData.speed.emoji}
                                onOpenModal={() => openModal('speed')}
                                isImap={isImapSource(gaugeData.speed.source)}
                                lastDataReceived={speedLastReceived}
                            >
                                <SolarWindSpeedChart data={allSpeedData} />
                            </ForecastChartPanel>
                            <ForecastChartPanel
                                title="Solar Wind Density"
                                currentValue={`${gaugeData.density.value} <span class='text-base'>p/cm³</span><span class='text-xs block text-neutral-400'>Source: ${gaugeData.density.source}</span>`}
                                emoji={gaugeData.density.emoji}
                                onOpenModal={() => openModal('density')}
                                isImap={isImapSource(gaugeData.density.source)}
                                lastDataReceived={densityLastReceived}
                            >
                                <SolarWindDensityChart data={allDensityData} />
                            </ForecastChartPanel>
                            <ForecastChartPanel
                                title="Solar Wind Temperature"
                                currentValue={`${gaugeData.temp?.value ?? 'N/A'} <span class='text-base'>K</span><span class='text-xs block text-neutral-400'>Source: ${gaugeData.temp?.source ?? '—'}</span>`}
                                emoji={gaugeData.temp?.emoji ?? '❓'}
                                onOpenModal={() => openModal('temp')}
                                isImap={isImapSource(gaugeData.temp?.source)}
                                lastDataReceived={tempLastReceived}
                            >
                                <SolarWindTemperatureChart data={allTempData} />
                            </ForecastChartPanel>
                            <ForecastChartPanel title="Moon Illumination & Arc" currentValue={gaugeData.moon.value} emoji={gaugeData.moon.emoji} onOpenModal={() => openModal('moon')}><MoonArcChart dailyCelestialHistory={dailyCelestialHistory} owmDailyForecast={owmDailyForecast} /></ForecastChartPanel>

                            <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col"><h3 className="text-xl font-semibold text-center text-white mb-4">Live Cloud Cover</h3><div className="relative w-full" style={{paddingBottom: "56.25%"}}><iframe title="Windy.com Cloud Map" className="absolute top-0 left-0 w-full h-full rounded-lg" src="https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=mm&metricTemp=°C&zoom=5&overlay=clouds&product=ecmwf&level=surface&lat=-44.757&lon=169.054" frameBorder="0"></iframe></div></div>
                            <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col"><div className="flex justify-center items-center mb-4"><h3 className="text-xl font-semibold text-center text-white">Live Cameras</h3><button onClick={() => openModal('live-cameras')} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button></div><div className="flex justify-center gap-2 my-2 flex-wrap">{CAMERAS.map((camera) => (<button key={camera.name} onClick={() => setSelectedCamera(camera)} className={`px-3 py-1 text-xs rounded transition-colors ${selectedCamera.name === camera.name ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>{camera.name}</button>))}</div><div className="mt-4"><div className="relative w-full bg-black rounded-lg" style={{ paddingBottom: "56.25%" }}>{selectedCamera.type === 'iframe' ? (<iframe title={`Live View from ${selectedCamera.name}`} className="absolute top-0 left-0 w-full h-full rounded-lg" src={selectedCamera.url} key={selectedCamera.name} />) : (<img src={cameraImageSrc} alt={`Live View from ${selectedCamera.name}`} className="absolute top-0 left-0 w-full h-full rounded-lg object-contain" key={cameraImageSrc} onError={(e) => { e.currentTarget.src = '/placeholder.png'; e.currentTarget.alt = `Could not load camera from ${selectedCamera.name}.`; }} />)}</div><div className="text-center text-xs text-neutral-500 mt-2">Source: <a href={`http://${selectedCamera.sourceUrl}`} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">{selectedCamera.sourceUrl}</a></div></div></div>


                            <div className="col-span-12 grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <TipsSection />
                                <CameraSettingsSection settings={cameraSettings} />
                            </div>

                            <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col"><div className="flex justify-center items-center"><h2 className="text-xl font-semibold text-center text-white">ACE EPAM (Last 3 Days)</h2><button onClick={() => openModal('epam')} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button></div><div onClick={() => setViewerMedia && epamImageUrl !== '/placeholder.png' && setViewerMedia({ url: epamImageUrl, type: 'image' })} className="flex-grow relative mt-2 cursor-pointer min-h-[300px]"><img src={epamImageUrl} alt="ACE EPAM Data" className="w-full h-full object-contain" /></div></div>
                            <div className="col-span-12"><button onClick={handleDownloadForecastImage} className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-neutral-900/80 border border-neutral-700/60 rounded-lg text-neutral-300 hover:bg-neutral-800 transition-colors font-semibold"><DownloadIcon className="w-6 h-6" /><span>Download The Aurora Forecast For The Next Two Hours!</span></button></div>
                        </main>
                    )}

                    <footer className="page-footer mt-10 pt-8 border-t border-neutral-700 text-center text-neutral-400 text-sm">
                        <h3 className="text-lg font-semibold text-neutral-200 mb-4">About This Dashboard</h3>
                        <p className="max-w-3xl mx-auto leading-relaxed">This dashboard provides a 2-hour aurora forecast for the whole of New Zealand and specifically for the West Coast of New Zealand. The proprietary "Spot The Aurora Forecast" combines live solar wind data with local factors like astronomical darkness and lunar phase to generate a more nuanced prediction than global models.</p>
                        <p className="max-w-3xl mx-auto leading-relaxed mt-4"><strong>Disclaimer:</strong> The aurora is a natural and unpredictable phenomenon. This forecast is an indication of potential activity, not a guarantee of a visible display. Conditions can change rapidly.</p>
                        <div className="mt-6"><button onClick={() => setIsFaqOpen(true)} className="flex items-center gap-2 mx-auto px-4 py-2 bg-neutral-800/80 border border-neutral-700/60 rounded-lg text-neutral-300 hover:bg-neutral-700/90 transition-colors"><GuideIcon className="w-5 h-5" /><span>Frequently Asked Questions</span></button></div>
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
