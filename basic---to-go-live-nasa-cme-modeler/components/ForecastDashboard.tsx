//--- START OF FILE src/components/ForecastDashboard.tsx ---

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import '../utils/chartSetup'; // registers Chart.js scales/plugins — must run before any <Line> renders
import EPAMPanel from './EPAMPanel';
import SolarWindQuickView from './SolarWindQuickView';
import FluxRopeAnalyzer from './FluxRopeAnalyzer';
import KpForecastTimeline from './KpForecastTimeline';
import LoadingSpinner from './icons/LoadingSpinner';
import AuroraSightings from './AuroraSightings';
import { VisibilityForecastPanel } from './VisibilityForecastPanel';
import GuideIcon from './icons/GuideIcon';
import { useForecastData } from '../hooks/useForecastData';
import ForecastChartPanel from './ForecastChartPanel';
import DisturbanceIndexPanel from './DisturbanceIndexPanel';
import { registerDatasetTicker } from '../utils/pollingScheduler';

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
    SubstormIndexChart,
    NewellCouplingChart,
    DynamicPressureChart,
} from './ForecastCharts';
import { SubstormActivity, SubstormForecast, ActivitySummary, InterplanetaryShock } from '../types';

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
  /** Callback to report latest L1 solar wind speed to the propagation engine */
  setMeasuredWindSpeedKms?: (speed: number | undefined) => void;
  navigationTarget: { page: string; elementId: string; expandId?: string; } | null;
  onInitialLoad?: () => void;
  onInitialLoadProgress?: (task: 'forecastApi' | 'solarWindApi' | 'goes18Api' | 'goes19Api' | 'ipsApi' | 'nzMagApi') => void;
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



const ForecastDashboard: React.FC<ForecastDashboardProps> = ({ setViewerMedia, setCurrentAuroraScore, setSubstormActivityStatus, setIpsAlertData, setMeasuredWindSpeedKms, navigationTarget, onInitialLoad, onInitialLoadProgress, viewMode, onViewModeChange, refreshSignal }) => {
    // ... [Original Hooks & State] ...
    const {
        isLoading, auroraScore, lastUpdated, gaugeData, isDaylight, celestialTimes, auroraScoreHistory, dailyCelestialHistory,
        owmDailyForecast, fetchAllData, allSpeedData, allDensityData, allTempData, allImfClockData, allMagneticData, hemisphericPowerHistory,
        substormForecast, substormRiskData, activitySummary, interplanetaryShockData,
        userLatitude, userLongitude, locationFailed, isOutsideNZ
    } = useForecastData(setCurrentAuroraScore, setSubstormActivityStatus, onInitialLoadProgress);
    
    // ... [Original State: modalState, isFaqOpen, etc] ...
    const [modalState, setModalState] = useState<{ isOpen: boolean; title: string; content: string | React.ReactNode } | null>(null);
    const [isFaqOpen, setIsFaqOpen] = useState(false);
    const [outsideNZDismissed, setOutsideNZDismissed] = useState(false);
    const [epamImageUrl, setEpamImageUrl] = useState<string>('/placeholder.png');
    const [selectedCamera, setSelectedCamera] = useState<Camera>(CAMERAS.find(c => c.name === 'Queenstown')!);
    const [cameraImageSrc, setCameraImageSrc] = useState<string>('');
    const [recentSightings, setRecentSightings] = useState<import('../types').SightingReport[]>([]);
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
      return registerDatasetTicker('forecast-core-data', () => fetchAllData(false, getGaugeStyle), 60_000);
    }, [fetchAllData]);

    useEffect(() => {
      if (import.meta.env.DEV) console.info('[polling] forecast manual refresh');
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

    // ── Report measured L1 solar wind speed to the propagation engine ──
    useEffect(() => {
      if (setMeasuredWindSpeedKms) {
        const speedStr = gaugeData.speed.value;
        const speedNum = parseFloat(speedStr);
        setMeasuredWindSpeedKms(Number.isFinite(speedNum) && speedNum > 0 ? speedNum : undefined);
      }
    }, [gaugeData.speed.value, setMeasuredWindSpeedKms]);

    useEffect(() => {
        setEpamImageUrl(`${ACE_EPAM_URL}?_=${Date.now()}`);
        if (selectedCamera.type === 'image') {
            setCameraImageSrc(`${selectedCamera.url}?_=${Date.now()}`);
        }
    }, [lastUpdated, selectedCamera]);

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
            'A compass-style angle showing IMF direction in the By/Bz plane, with an Earth-centered core graphic and a storm-phase estimate (shock/core/wake/ambient/HSS).',
            'When the clock pointer sits in the southward half, aurora chances usually improve. The phase graphic helps show whether we are in a storm front, core, wake, calm, or fast-stream regime.',
            'Phase labels are heuristic, inferred from density/speed/temperature/IMF structure. Use as operational context, not a deterministic CME in-situ classifier.'
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
        ),
        'simple-view': buildStatTooltip(
            'Simple View',
            'A streamlined forecast layout focused on what to expect right now and in the next short window.',
            'Best for quick go/no-go aurora decisions with minimal interpretation overhead.',
            'Prioritises concise decision support over full diagnostic depth; switch to Advanced View for full physics context.'
        ),
        'advanced-view': buildStatTooltip(
            'Advanced View',
            'A full diagnostic layout with IMF, solar wind, coupling, pressure, and substorm context charts.',
            'Helps refine confidence by showing whether favorable upstream conditions are sustained and geoeffective.',
            'Designed for experienced users who want to inspect drivers (Bz/Bt/pressure/Newell) behind the headline forecast.'
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

    // ── Simple view timeline slots ────────────────────────────────────────────
    // 15 / 30 / 60 min — same plain-english phrases as VisibilityForecastPanel
    // 2 hr              — SpotTheAurora score, lower confidence phrasing
    // ─────────────────────────────────────────────────────────────────────────

    const simpleTimelineSlots = useMemo(() => {
        const getPhrase = (score: number, confidence: 'high' | 'medium' | 'low', label: string): { phrase: string; icon: string } => {
            const timeRef = label === 'Now' ? 'right now'
                          : label === '15 min' ? 'in the next 15 minutes'
                          : label === '30 min' ? 'in the next 30 minutes'
                          : label === '1 hour' ? 'over the next hour'
                          : 'over the next two hours';

            if (score >= 80) return {
                icon: '👁️',
                phrase: confidence === 'high' ? 'Go outside now — this could be one of the best displays in years'
                      : confidence === 'medium' ? 'Conditions look exceptional — well worth heading out to have a look'
                      : 'Could turn into something special — keep a close eye on this'
            };
            if (score >= 65) return {
                icon: '👁️',
                phrase: confidence === 'high' ? 'You should be able to see it with your own eyes — look south'
                      : confidence === 'medium' ? 'Good chance of seeing it with your own eyes in a dark spot'
                      : 'Might be visible with your own eyes if conditions stay this way'
            };
            if (score >= 50) return {
                icon: '👁️',
                phrase: confidence === 'high' ? 'A faint green glow should be visible to the south — find somewhere dark'
                      : confidence === 'medium' ? 'A faint glow to the south is possible — get away from street lights'
                      : 'Might just be visible to the eye if you find somewhere dark enough'
            };
            if (score >= 35) return {
                icon: '📱',
                phrase: confidence === 'high' ? 'Your phone camera will pick it up — point it south and take a photo'
                      : confidence === 'medium' ? 'Worth taking a photo to the south — your phone may surprise you'
                      : 'Your phone camera might pick something up if conditions improve'
            };
            if (score >= 20) return {
                icon: '📷',
                phrase: confidence === 'high' ? 'Very faint — only a long-exposure camera shot would show anything'
                      : confidence === 'medium' ? 'Very faint if anything — not worth going out specially'
                      : 'Unlikely to show up even on camera at this stage'
            };
            return {
                icon: '😴',
                phrase: confidence === 'high' ? `Nothing to see — the sky will look completely normal ${timeRef}`
                      : confidence === 'medium' ? `Very quiet ${timeRef} — not worth going out`
                      : `Quiet ${timeRef} — come back later`
            };
        };

        const workerScore = substormRiskData?.current?.score ?? null;
        const workerTrend = substormRiskData?.current?.risk_trend;
        const newellNow   = substormRiskData?.metrics?.solar_wind?.newell_coupling_now ?? 0;
        const newellAvg30 = substormRiskData?.metrics?.solar_wind?.newell_avg_30m ?? 0;
        const base        = workerScore ?? auroraScore ?? 0;
        const spotScore   = auroraScore ?? 0;

        const trendMult =
            workerTrend === 'Rapidly Increasing' ? 1.15 :
            workerTrend === 'Increasing'         ? 1.07 :
            workerTrend === 'Decreasing'         ? 0.90 :
            workerTrend === 'Rapidly Decreasing' ? 0.75 : 1.0;

        const newellBoost = newellNow > 0 && newellAvg30 > 0 && newellNow > newellAvg30 * 1.2 ? 1.08 : 1.0;
        const applyMods = (s: number) => Math.min(100, Math.max(0, s * trendMult * newellBoost));

        const { status, p30, p60 } = substormForecast;
        const boostFromP = (p: number, b: number) => Math.min(100, b + p * (100 - b) * 0.75);

        let raw15: number, raw30: number, raw60: number;
        switch (status) {
            case 'ONSET':      raw15 = Math.min(100, base * 1.05); raw30 = base * 0.90; raw60 = base * 0.65; break;
            case 'IMMINENT_30': raw15 = boostFromP(p30, base); raw30 = boostFromP(p30, base) * 1.05; raw60 = boostFromP(p60, base) * 0.80; break;
            case 'LIKELY_60':  raw15 = base * 1.10; raw30 = boostFromP(p30 * 0.7, base); raw60 = boostFromP(p60, base); break;
            case 'WATCH':      raw15 = base * 1.05; raw30 = base * 1.15; raw60 = boostFromP(p60 * 0.5, base); break;
            default:           raw15 = base * 0.95; raw30 = base * 0.85; raw60 = base * 0.70;
        }

        const slotConf = (slot: '15m' | '30m' | '1h'): 'high' | 'medium' | 'low' => {
            if (status === 'ONSET')       return slot === '15m' ? 'high' : slot === '30m' ? 'medium' : 'low';
            if (status === 'IMMINENT_30') return slot === '1h' ? 'medium' : 'high';
            if (status === 'LIKELY_60')   return slot === '1h' ? 'high' : 'medium';
            if (status === 'WATCH')       return slot === '15m' ? 'medium' : 'low';
            return slot === '15m' ? 'high' : slot === '30m' ? 'medium' : 'low';
        };

        const s15 = Math.round(applyMods(raw15));
        const s30 = Math.round(applyMods(raw30));
        const s60 = Math.round(applyMods(raw60));
        const s2h = Math.round(spotScore);
        const sNow = Math.round(workerScore ?? auroraScore ?? 0);

        return [
            { label: 'Now',     score: sNow, ...getPhrase(sNow, 'high',          'Now'),     isNow: true  },
            { label: '15 min',  score: s15,  ...getPhrase(s15,  slotConf('15m'), '15 min'),  isNow: false },
            { label: '30 min',  score: s30,  ...getPhrase(s30,  slotConf('30m'), '30 min'),  isNow: false },
            { label: '1 hour',  score: s60,  ...getPhrase(s60,  slotConf('1h'),  '1 hour'),  isNow: false },
            { label: '2 hours', score: s2h,  ...getPhrase(s2h,  'low',           '2 hours'), isNow: false },
        ];
    }, [auroraScore, substormForecast, substormRiskData]);

    if (isLoading) return <div className="w-full h-full flex justify-center items-center bg-neutral-900"><LoadingSpinner /></div>;

    const faqContent = `...`; // Keep original FAQ content

    return (
        <div className="w-full h-full bg-neutral-900 text-neutral-300 relative" style={{ backgroundImage: `url('/background-aurora.jpg')`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed' }}>

            {/* Outside NZ warning modal */}
            {isOutsideNZ && !outsideNZDismissed && (
              <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                <div className="bg-neutral-900 border border-amber-500/40 rounded-2xl shadow-2xl max-w-md w-full p-6 text-center">
                  <div className="text-4xl mb-4">🌏</div>
                  <h2 className="text-xl font-bold text-white mb-3">You appear to be outside New Zealand</h2>
                  <p className="text-sm text-neutral-300 leading-relaxed mb-4">
                    Spot The Aurora is a New Zealand aurora and space weather forecasting app. The aurora score, substorm model, and visibility forecasts are all calibrated and optimised for viewing conditions from New Zealand — particularly the South Island.
                  </p>
                  <p className="text-sm text-neutral-400 leading-relaxed mb-6">
                    If you are aurora chasing from another location in the southern hemisphere, the solar wind and space weather data is still accurate and useful — but the visibility score, location adjustment, and notification thresholds will not reflect your actual viewing conditions.
                  </p>
                  <div className="flex gap-3 justify-center">
                    <button
                      onClick={() => window.history.back()}
                      className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-sm text-neutral-300 border border-neutral-700 transition-colors"
                    >
                      Go back
                    </button>
                    <button
                      onClick={() => setOutsideNZDismissed(true)}
                      className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-sm text-white font-semibold transition-colors"
                    >
                      Continue anyway
                    </button>
                  </div>
                </div>
              </div>
            )}
            <div className="absolute inset-0 bg-black/50 z-0"></div>
            <div className="w-full h-full overflow-y-auto p-5 relative z-10 styled-scrollbar">
                 <div className="container mx-auto">
                    <header className="text-center mb-4">
                        <h1 className="text-3xl font-bold text-neutral-100">Spot The Aurora</h1>
                        <p className="text-sm text-neutral-400 mt-1">New Zealand Aurora &amp; Space Weather App</p>
                    </header>
                     <div className="flex justify-center items-center gap-2 mb-6">
                        <div className="inline-flex items-center rounded-full bg-white/5 border border-white/10 shadow-inner p-1 backdrop-blur-md">
                          <button onClick={() => onViewModeChange('simple')} className={`px-4 py-2 rounded-full text-sm font-semibold transition-all active:scale-95 ${viewMode === 'simple' ? 'bg-gradient-to-r from-sky-500/80 to-cyan-500/80 text-white shadow-lg' : 'text-neutral-200 hover:text-white'}`}>Simple View</button>
                          <button onClick={() => onViewModeChange('advanced')} className={`px-4 py-2 rounded-full text-sm font-semibold transition-all active:scale-95 ${viewMode === 'advanced' ? 'bg-gradient-to-r from-purple-500/80 to-fuchsia-500/80 text-white shadow-lg' : 'text-neutral-200 hover:text-white'}`}>Advanced View</button>
                        </div>
                        <button
                          onClick={() => openModal(viewMode === 'simple' ? 'simple-view' : 'advanced-view')}
                          className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700"
                          title={`About ${viewMode === 'simple' ? 'Simple View' : 'Advanced View'}`}
                        >
                          ?
                        </button>
                    </div>

                    {viewMode === 'simple' ? (
                        <main className="grid grid-cols-12 gap-6">
                            {/* GPS banner */}
                            {locationFailed && (
                                <div className="col-span-12 flex items-center gap-3 px-4 py-3 bg-amber-900/30 border border-amber-700/50 rounded-lg">
                                    <span className="text-xl flex-shrink-0">📍</span>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-amber-300">Enable location for an accurate forecast</p>
                                        <p className="text-xs text-amber-400/70 mt-0.5">GPS is required to show aurora visibility from your location. Enable it in your browser or device settings and reload.</p>
                                    </div>
                                </div>
                            )}
                            {/* What to expect — full width */}
                            <div className="col-span-12 grid grid-cols-12 gap-6 items-stretch">
                            <div className="col-span-12 flex flex-col">
                                <VisibilityForecastPanel
                                    auroraScore={auroraScore}
                                    substormForecast={substormForecast}
                                    substormRiskData={substormRiskData}
                                    recentSightings={recentSightings}
                                    isDaylight={isDaylight}
                                    moonIllumination={celestialTimes?.moon?.illumination ?? null}
                                    moonRiseMs={celestialTimes?.moon?.rise ?? null}
                                    moonSetMs={celestialTimes?.moon?.set ?? null}
                                    userLatitude={userLatitude}
                                    userLongitude={userLongitude}
                                />
                            </div>
                            </div>
                            <AuroraSightings isDaylight={isDaylight} refreshSignal={refreshSignal} onSightingsLoaded={setRecentSightings} substormRiskData={substormRiskData} />
                            <KpForecastTimeline
                                moonIllumination={celestialTimes?.moon?.illumination ?? null}
                                userLatitude={userLatitude}
                                sunriseMs={celestialTimes?.sun?.rise ?? null}
                                sunsetMs={celestialTimes?.sun?.set ?? null}
                                moonRiseMs={celestialTimes?.moon?.rise ?? null}
                                moonSetMs={celestialTimes?.moon?.set ?? null}
                                moonWaxing={celestialTimes?.moon?.waxing ?? null}
                            />
                            <SimpleTrendChart auroraScoreHistory={auroraScoreHistory} />
                            {/* ... (Cloud & Cameras) ... */}
                            <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col"><h3 className="text-xl font-semibold text-center text-white mb-4">Live Cloud Cover</h3><div className="relative w-full" style={{paddingBottom: "56.25%"}}><iframe title="Windy.com Cloud Map" className="absolute top-0 left-0 w-full h-full rounded-lg" src="https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=mm&metricTemp=°C&zoom=5&overlay=clouds&product=ecmwf&level=surface&lat=-44.757&lon=169.054" frameBorder="0"></iframe></div></div>
                            <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col"><div className="flex justify-center items-center mb-4"><h3 className="text-xl font-semibold text-center text-white">Live Cameras</h3></div><div className="flex justify-center gap-2 my-2 flex-wrap">{CAMERAS.map((camera) => (<button key={camera.name} onClick={() => setSelectedCamera(camera)} className={`px-3 py-1 text-xs rounded transition-colors ${selectedCamera.name === camera.name ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>{camera.name}</button>))}</div><div className="mt-4"><div className="relative w-full bg-black rounded-lg" style={{ paddingBottom: "56.25%" }}>{selectedCamera.type === 'iframe' ? (<iframe title={`Live View from ${selectedCamera.name}`} className="absolute top-0 left-0 w-full h-full rounded-lg" src={selectedCamera.url} key={selectedCamera.name} />) : (<img src={cameraImageSrc} alt={`Live View from ${selectedCamera.name}`} className="absolute top-0 left-0 w-full h-full rounded-lg object-contain" key={cameraImageSrc} onError={(e) => { e.currentTarget.src = '/placeholder.png'; e.currentTarget.alt = `Could not load camera from ${selectedCamera.name}.`; }} />)}</div><div className="text-center text-xs text-neutral-500 mt-2">Source: <a href={`http://${selectedCamera.sourceUrl}`} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">{selectedCamera.sourceUrl}</a></div></div></div>
                        </main>
                    ) : (
                        <main className="grid grid-cols-12 gap-6">
                            <ActivityAlert isDaylight={isDaylight} celestialTimes={celestialTimes} auroraScoreHistory={auroraScoreHistory} />
                            {/* GPS banner */}
                            {locationFailed && (
                                <div className="col-span-12 flex items-center gap-3 px-4 py-3 bg-amber-900/30 border border-amber-700/50 rounded-lg">
                                    <span className="text-xl flex-shrink-0">📍</span>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-amber-300">Enable location for an accurate forecast</p>
                                        <p className="text-xs text-amber-400/70 mt-0.5">GPS is required to show aurora visibility from your location. Enable it in your browser or device settings and reload.</p>
                                    </div>
                                </div>
                            )}
                            {/* What to expect — full width */}
                            <div className="col-span-12 grid grid-cols-12 gap-6 items-stretch">
                            <div className="col-span-12 flex flex-col">
                                <VisibilityForecastPanel
                                    auroraScore={auroraScore}
                                    substormForecast={substormForecast}
                                    substormRiskData={substormRiskData}
                                    recentSightings={recentSightings}
                                    isDaylight={isDaylight}
                                    moonIllumination={celestialTimes?.moon?.illumination ?? null}
                                    moonRiseMs={celestialTimes?.moon?.rise ?? null}
                                    moonSetMs={celestialTimes?.moon?.set ?? null}
                                    userLatitude={userLatitude}
                                    userLongitude={userLongitude}
                                />
                            </div>
                            </div>
                            <KpForecastTimeline
                                moonIllumination={celestialTimes?.moon?.illumination ?? null}
                                userLatitude={userLatitude}
                                sunriseMs={celestialTimes?.sun?.rise ?? null}
                                sunsetMs={celestialTimes?.sun?.set ?? null}
                                moonRiseMs={celestialTimes?.moon?.rise ?? null}
                                moonSetMs={celestialTimes?.moon?.set ?? null}
                                moonWaxing={celestialTimes?.moon?.waxing ?? null}
                            />
{(() => {
                                // Compute oval boundary for chart visibility probability
                                const _newell60 = substormRiskData?.metrics?.solar_wind?.newell_avg_60m ?? 0;
                                const _newell30 = substormRiskData?.metrics?.solar_wind?.newell_avg_30m ?? 0;
                                const _newell = Math.max(_newell60, _newell30 * 0.85);
                                let _boundary = -( 65.5 - _newell / 1800);
                                _boundary = Math.max(_boundary, -76);
                                _boundary = Math.min(_boundary, -44);
                                if (substormRiskData?.current?.bay_onset_flag) _boundary = Math.min(_boundary, -47.2);
                                return (
                                    <ForecastTrendChart
                                        auroraScoreHistory={auroraScoreHistory}
                                        dailyCelestialHistory={dailyCelestialHistory}
                                        owmDailyForecast={owmDailyForecast}
                                        onOpenModal={() => openModal('forecast')}
                                        userLatitude={userLatitude}
                                        userLongitude={userLongitude}
                                        moonIllumination={gaugeData?.moon?.illumination ?? null}
                                        substormBz={substormRiskData?.metrics?.solar_wind?.bz ?? null}
                                        substormScore={substormRiskData?.current?.score ?? null}
                                        ovalBoundaryGmag={_boundary}
                                        substormHistory={substormRiskData?.history_24h ?? null}
                                    />
                                );
                            })()}
                            <AuroraSightings isDaylight={isDaylight} refreshSignal={refreshSignal} onSightingsLoaded={setRecentSightings} substormRiskData={substormRiskData} />
                            
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
                                <IMFClockChart magneticData={allMagneticData} clockData={allImfClockData} speedData={allSpeedData} densityData={allDensityData} tempData={allTempData} />
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

                            <ForecastChartPanel
                                title="Substorm Index"
                                currentValue={substormRiskData ? `${substormRiskData.current.score} <span class='text-base'>${substormRiskData.current.level}</span><span class='text-xs block text-neutral-400'>${substormRiskData.current.risk_trend}${substormRiskData.current.confidence != null ? ` · ${substormRiskData.current.confidence}% confidence` : ''}</span>` : '—'}
                                emoji={substormRiskData?.current?.bay_onset_flag ? '⚡' : substormRiskData?.current && substormRiskData.current.score >= 50 ? '🌌' : '📊'}
                                onOpenModal={() => openModal('unified-forecast')}
                            >
                                <SubstormIndexChart history={substormRiskData?.history_24h ?? []} />
                            </ForecastChartPanel>

                            <ForecastChartPanel
                                title="Newell Coupling Function"
                                currentValue={substormRiskData ? `${substormRiskData.metrics.solar_wind.newell_coupling_now.toFixed(0)} <span class='text-base'>Wb/s</span><span class='text-xs block text-neutral-400'>30m avg: ${substormRiskData.metrics.solar_wind.newell_avg_30m.toFixed(0)} · 60m avg: ${substormRiskData.metrics.solar_wind.newell_avg_60m.toFixed(0)}</span>` : '—'}
                                emoji="🔗"
                                onOpenModal={() => openModal('bz')}
                            >
                                <NewellCouplingChart history={substormRiskData?.history_24h ?? []} />
                            </ForecastChartPanel>

                            <ForecastChartPanel
                                title="Dynamic Pressure"
                                currentValue={substormRiskData ? `${substormRiskData.metrics.solar_wind.dynamic_pressure_nPa.toFixed(2)} <span class='text-base'>nPa</span><span class='text-xs block text-neutral-400'>30m avg: ${substormRiskData.metrics.solar_wind.avg_30m_pressure_nPa.toFixed(2)} nPa · density ${substormRiskData.metrics.solar_wind.density.toFixed(1)} p/cm³</span>` : '—'}
                                emoji="💨"
                                onOpenModal={() => openModal('speed')}
                            >
                                <DynamicPressureChart history={substormRiskData?.history_24h ?? []} />
                            </ForecastChartPanel>

                            <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col"><h3 className="text-xl font-semibold text-center text-white mb-4">Live Cloud Cover</h3><div className="relative w-full" style={{paddingBottom: "56.25%"}}><iframe title="Windy.com Cloud Map" className="absolute top-0 left-0 w-full h-full rounded-lg" src="https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=mm&metricTemp=°C&zoom=5&overlay=clouds&product=ecmwf&level=surface&lat=-44.757&lon=169.054" frameBorder="0"></iframe></div></div>
                            <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col"><div className="flex justify-center items-center mb-4"><h3 className="text-xl font-semibold text-center text-white">Live Cameras</h3><button onClick={() => openModal('live-cameras')} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button></div><div className="flex justify-center gap-2 my-2 flex-wrap">{CAMERAS.map((camera) => (<button key={camera.name} onClick={() => setSelectedCamera(camera)} className={`px-3 py-1 text-xs rounded transition-colors ${selectedCamera.name === camera.name ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>{camera.name}</button>))}</div><div className="mt-4"><div className="relative w-full bg-black rounded-lg" style={{ paddingBottom: "56.25%" }}>{selectedCamera.type === 'iframe' ? (<iframe title={`Live View from ${selectedCamera.name}`} className="absolute top-0 left-0 w-full h-full rounded-lg" src={selectedCamera.url} key={selectedCamera.name} />) : (<img src={cameraImageSrc} alt={`Live View from ${selectedCamera.name}`} className="absolute top-0 left-0 w-full h-full rounded-lg object-contain" key={cameraImageSrc} onError={(e) => { e.currentTarget.src = '/placeholder.png'; e.currentTarget.alt = `Could not load camera from ${selectedCamera.name}.`; }} />)}</div><div className="text-center text-xs text-neutral-500 mt-2">Source: <a href={`http://${selectedCamera.sourceUrl}`} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">{selectedCamera.sourceUrl}</a></div></div></div>


                            <DisturbanceIndexPanel />

                            <div className="col-span-12 grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <TipsSection />
                                <CameraSettingsSection settings={cameraSettings} />
                            </div>

                            <FluxRopeAnalyzer
                                magneticData={allMagneticData}
                                speedData={allSpeedData}
                                densityData={allDensityData}
                                tempData={allTempData}
                            />

                            <SolarWindQuickView
                                magneticData={allMagneticData}
                                clockData={allImfClockData}
                                speedData={allSpeedData}
                                densityData={allDensityData}
                                tempData={allTempData}
                            />

                            <div className="col-span-12 card bg-neutral-950/80 p-4">
                                <EPAMPanel />
                            </div>

                            
                        </main>
                    )}

                    <footer className="page-footer mt-10 pt-8 border-t border-neutral-700 text-center text-neutral-400 text-sm">
                        <h3 className="text-lg font-semibold text-neutral-200 mb-4">About This Dashboard</h3>
                        <p className="max-w-3xl mx-auto leading-relaxed">This dashboard provides a 2-hour aurora forecast for the whole of New Zealand and specifically for the West Coast of New Zealand. The proprietary "Spot The Aurora Forecast" combines live solar wind data with local factors like astronomical darkness and lunar phase to generate a more nuanced prediction than global models.</p>
                        <p className="max-w-3xl mx-auto leading-relaxed mt-4"><strong>Disclaimer:</strong> The aurora is a natural and unpredictable phenomenon. This forecast is an indication of potential activity, not a guarantee of a visible display. Conditions can change rapidly.</p>
                        <div className="mt-6"><button onClick={() => setIsFaqOpen(true)} className="flex items-center gap-2 mx-auto px-4 py-2 bg-neutral-800/80 border border-neutral-700/60 rounded-lg text-neutral-300 hover:bg-neutral-700/90 transition-colors"><GuideIcon className="w-5 h-5" /><span>Frequently Asked Questions</span></button></div>
                        <div className="mt-8 text-xs text-neutral-500"><p>Data provided by <a href="https://www.swpc.noaa.gov/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">NOAA SWPC</a> & <a href="https://api.nasa.gov/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">NASA</a> | Weather & Cloud data by <a href="https://www.windy.com" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">Windy.com</a></p><p className="mt-2">Forecast algorithm, visualization and development by <a href="https://www.tnrprotography.co.nz" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">TNR Protography</a></p></div>
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
