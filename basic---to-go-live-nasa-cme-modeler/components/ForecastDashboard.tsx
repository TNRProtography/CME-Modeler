// --- START OF FILE ForecastDashboard.tsx ---

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Line } from 'react-chartjs-2';
import CloseIcon from './icons/CloseIcon';
import CaretIcon from './icons/CaretIcon';
import { ChartOptions, ScriptableContext } from 'chart.js';
import { enNZ } from 'date-fns/locale';
import LoadingSpinner from './icons/LoadingSpinner';
import AuroraSightings from './AuroraSightings';
import GuideIcon from './icons/GuideIcon';
import annotationPlugin from 'chartjs-plugin-annotation';
import { sendNotification, canSendNotification, clearNotificationCooldown } from '../utils/notifications.ts';
import ToggleSwitch from './ToggleSwitch';
import { SubstormPrediction } from '../types';

// --- Type Definitions ---
interface ForecastDashboardProps {
  setViewerMedia?: (media: { url: string, type: 'image' | 'video' } | null) => void;
  setCurrentAuroraScore: (score: number | null) => void;
  setSubstormActivityStatus: (status: { text: string; color: string } | null) => void;
  navigationTarget: { page: string; elementId: string; expandId?: string; } | null;
  setSubstormPrediction: (prediction: SubstormPrediction | null) => void;
}
interface InfoModalProps { isOpen: boolean; onClose: () => void; title: string; content: string; }

interface CelestialTimeData {
    moon?: { rise: number | null, set: number | null, illumination?: number };
    sun?: { rise: number | null, set: number | null };
}

interface DailyHistoryEntry {
    date: string;
    sun?: { rise: number | null, set: number | null };
    moon?: { rise: number | null, set: number | null, illumination?: number };
}

interface OwmDailyForecastEntry {
  dt: number;
  sunrise: number;
  sunset: number;
  moonrise: number;
  moonset: number;
  moon_phase: number;
}

interface RawHistoryRecord {
  timestamp: number;
  baseScore: number;
  finalScore: number;
  hemisphericPower: number;
}

interface InterplanetaryShock {
    activityID: string;
    catalog: string;
    eventTime: string;
    instruments: { displayName: string }[];
    location: string;
    link: string;
}

interface Camera {
  name: string;
  url: string;
  type: 'image' | 'iframe';
  sourceUrl: string;
}

// --- Constants ---
const FORECAST_API_URL = 'https://spottheaurora.thenamesrock.workers.dev/';
const NOAA_PLASMA_URL = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json';
const NOAA_MAG_URL = 'https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json';
const NOAA_GOES18_MAG_URL = 'https://services.swpc.noaa.gov/json/goes/primary/magnetometers-1-day.json';
const NOAA_GOES19_MAG_URL = 'https://services.swpc.noaa.gov/json/goes/secondary/magnetometers-1-day.json';
const ACE_EPAM_URL = 'https://services.swpc.noaa.gov/images/ace-epam-24-hour.gif';
const NASA_IPS_URL = 'https://spottheaurora.thenamesrock.workers.dev/ips';
const REFRESH_INTERVAL_MS = 60 * 1000;
const GREYMOUTH_LATITUDE = -42.45;

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
    gray:   { solid: '#808080', semi: 'rgba(128, 128, 128, 0.2)', trans: 'rgba(128, 128, 128, 0)' },
    yellow: { solid: '#FFD700', semi: 'rgba(255, 215, 0, 0.2)', trans: 'rgba(255, 215, 0, 0)' },
    orange: { solid: '#FFA500', semi: 'rgba(255, 165, 0, 0.2)', trans: 'rgba(255, 165, 0, 0)' },
    red:    { solid: '#FF4500', semi: 'rgba(255, 69, 0, 0.2)', trans: 'rgba(255, 69, 0, 0)' },
    purple: { solid: '#800080', semi: 'rgba(128, 0, 128, 0.2)', trans: 'rgba(128, 0, 128, 0)' },
    pink:   { solid: '#FF1493', semi: 'rgba(255, 20, 147, 0.2)', trans: 'rgba(255, 20, 147, 0)' }
};

const GAUGE_EMOJIS = {
    gray:   '\u{1F610}', yellow: '\u{1F642}', orange: '\u{1F642}', red:    '\u{1F604}',
    purple: '\u{1F60D}', pink:   '\u{1F60D}', error:  '\u{2753}'
};

// --- HELPER FUNCTIONS ---

const getForecastScoreColorKey = (score: number): keyof typeof GAUGE_COLORS => {
    if (score >= 80) return 'pink';
    if (score >= 50) return 'purple';
    if (score >= 40) return 'red';
    if (score >= 25) return 'orange';
    if (score >= 10) return 'yellow';
    return 'gray';
};

const getAuroraEmoji = (s: number | null): string => {
    if (s === null) return GAUGE_EMOJIS.error;
    const colorKey = getForecastScoreColorKey(s);
    return GAUGE_EMOJIS[colorKey];
};

const calculateLocationAdjustment = (userLat: number): number => {
    const isNorthOfGreymouth = userLat > GREYMOUTH_LATITUDE;
    const R = 6371;
    const dLat = (userLat - GREYMOUTH_LATITUDE) * (Math.PI / 180);
    const distanceKm = Math.abs(dLat) * R;
    const numberOfSegments = Math.floor(distanceKm / 10);
    const adjustmentFactor = numberOfSegments * 0.2;
    return isNorthOfGreymouth ? -adjustmentFactor : adjustmentFactor;
};

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

const createVerticalThresholdGradient = (
    ctx: ScriptableContext<'line'>,
    thresholds: { [key: string]: number, maxExpected?: number, maxNegativeExpected?: number },
    isBz: boolean = false
) => {
    const chart = ctx.chart;
    const { chartArea, scales: { y: yScale } } = chart;
    if (!chartArea || !yScale) return undefined;

    const gradient = chart.ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
    const yScaleRange = yScale.max - yScale.min;
    if (yScaleRange === 0) {
        const fallback = chart.ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
        fallback.addColorStop(0, GAUGE_COLORS.gray.semi);
        fallback.addColorStop(1, GAUGE_COLORS.gray.trans);
        return fallback;
    }

    const getYStopPosition = (value: number) => Math.max(0, Math.min(1, 1 - ((value - yScale.min) / yScaleRange)));

    if (isBz) {
        gradient.addColorStop(getYStopPosition(yScale.max), GAUGE_COLORS.gray.trans);
        gradient.addColorStop(getYStopPosition(thresholds.gray), GAUGE_COLORS.gray.semi);
        gradient.addColorStop(getYStopPosition(thresholds.yellow), GAUGE_COLORS.yellow.semi);
        gradient.addColorStop(getYStopPosition(thresholds.orange), GAUGE_COLORS.orange.semi);
        gradient.addColorStop(getYStopPosition(thresholds.red), GAUGE_COLORS.red.semi);
        gradient.addColorStop(getYStopPosition(thresholds.purple), GAUGE_COLORS.purple.semi);
        if (thresholds.pink !== Infinity) gradient.addColorStop(getYStopPosition(thresholds.pink), GAUGE_COLORS.pink.semi);
        gradient.addColorStop(getYStopPosition(yScale.min), GAUGE_COLORS.pink.semi);
    } else {
        gradient.addColorStop(getYStopPosition(yScale.min), GAUGE_COLORS.gray.semi);
        gradient.addColorStop(getYStopPosition(thresholds.gray), GAUGE_COLORS.gray.semi);
        gradient.addColorStop(getYStopPosition(thresholds.yellow), GAUGE_COLORS.yellow.semi);
        gradient.addColorStop(getYStopPosition(thresholds.orange), GAUGE_COLORS.orange.semi);
        gradient.addColorStop(getYStopPosition(thresholds.red), GAUGE_COLORS.red.semi);
        gradient.addColorStop(getYStopPosition(thresholds.purple), GAUGE_COLORS.purple.semi);
        if (thresholds.pink !== Infinity) gradient.addColorStop(getYStopPosition(thresholds.pink), GAUGE_COLORS.pink.semi);
        gradient.addColorStop(getYStopPosition(yScale.max), GAUGE_COLORS.pink.trans);
    }
    return gradient;
};

const createChartOptions = (rangeMs: number, isDualAxis: boolean, yLabel: string, showLegend: boolean = false, extraAnnotations?: any): ChartOptions<'line'> => {
    const now = Date.now();
    const startTime = now - rangeMs;
    const options: ChartOptions<'line'> = {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false, axis: 'x' },
        plugins: { legend: { display: showLegend, labels: {color: '#a1a1aa'} }, tooltip: { mode: 'index', intersect: false } },
        scales: { x: { type: 'time', min: startTime, max: now, ticks: { color: '#71717a', source: 'auto' }, grid: { color: '#3f3f46' } } }
    };
    if (isDualAxis) {
        options.scales = { ...options.scales, y: { type: 'linear', position: 'left', ticks: { color: '#a3a3a3' }, grid: { color: '#3f3f46' }, title: { display: true, text: 'Speed (km/s)', color: '#a3a3a3' } }, y1: { type: 'linear', position: 'right', ticks: { color: '#a3a3a3' }, grid: { drawOnChartArea: false }, title: { display: true, text: 'Density (p/cm³)', color: '#a3a3a3' } } } as any;
    } else {
        options.scales = { ...options.scales, y: { type: 'linear', position: 'left', ticks: { color: '#a3a3a3' }, grid: { color: '#3f3f46' }, title: { display: true, text: yLabel, color: '#a3a3a3' } } };
    }
    if (extraAnnotations) {
        options.plugins = { ...options.plugins, annotation: { annotations: extraAnnotations } };
    }
    return options;
};

const getAuroraBlurb = (score: number) => {
    if (score < 10) return 'Little to no auroral activity.';
    if (score < 25) return 'Minimal auroral activity likely.';
    if (score < 40) return 'Clear auroral activity visible in cameras.';
    if (score < 50) return 'Faint naked-eye aurora likely, maybe with color.';
    if (score < 80) return 'Good chance of naked-eye color and structure.';
    return 'High probability of a significant substorm.';
};

const getSuggestedCameraSettings = (score: number | null, isDaylight: boolean) => {
    if (isDaylight) {
        return {
            overall: "The sun is currently up. It is not possible to photograph the aurora during daylight hours.",
            phone: { android: { iso: "N/A", shutter: "N/A", aperture: "N/A", focus: "N/A", wb: "N/A" }, apple: { iso: "N/A", shutter: "N/A", aperture: "N/A", focus: "N/A", wb: "N/A" } },
            dslr: { iso: "N/A", shutter: "N/A", aperture: "N/A", focus: "N/A", wb: "N/A" }
        };
    }
    if (score === null || score < 10) {
        return {
            overall: "Very low activity expected. It's highly unlikely to capture the aurora with any camera. These settings are for extreme attempts.",
            phone: { android: { iso: "3200-6400 (Max)", shutter: "20-30s", aperture: "Lowest f-number", focus: "Infinity", wb: "Auto or 3500K-4000K" }, apple: { iso: "Auto (max Night Mode)", shutter: "Longest Night Mode (10-30s)", aperture: "N/A (fixed)", focus: "Infinity", wb: "Auto or 3500K-4000K" } },
            dslr: { iso: "6400-12800", shutter: "20-30s", aperture: "f/2.8-f/4 (widest)", focus: "Manual to Infinity", wb: "3500K-4500K" }
        };
    }
    if (score >= 80) {
        return {
            overall: "High probability of a bright, active aurora! Aim for shorter exposures to capture detail and movement.",
            phone: { android: { iso: "400-800", shutter: "1-5s", aperture: "Lowest f-number", focus: "Infinity", wb: "Auto or 3500K-4000K" }, apple: { iso: "Auto or 500-1500 (app)", shutter: "1-3s", aperture: "N/A (fixed)", focus: "Infinity", wb: "Auto or 3500K-4000K" } },
            dslr: { iso: "800-1600", shutter: "1-5s", aperture: "f/2.8 (or widest)", focus: "Manual to Infinity", wb: "3500K-4500K" }
        };
    }
    if (score >= 60) {
        return {
            overall: "Good chance for visible aurora. Shorter exposures may be needed to capture details.",
            phone: { android: { iso: "800-1600", shutter: "5-10s", aperture: "Lowest f-number", focus: "Infinity", wb: "Auto or 3500K-4000K" }, apple: { iso: "Auto or 1000-2000 (app)", shutter: "3-7s", aperture: "N/A (fixed)", focus: "Infinity", wb: "Auto or 3500K-4000K" } },
            dslr: { iso: "1600-3200", shutter: "2-8s", aperture: "f/2.8-f/4 (widest)", focus: "Manual to Infinity", wb: "3500K-4500K" }
        };
    }
    if (score >= 50) {
        return {
            overall: "Moderate activity expected. Good chance for visible aurora. Balance light capture with motion.",
            phone: { android: { iso: "800-1600", shutter: "5-10s", aperture: "Lowest f-number", focus: "Infinity", wb: "Auto or 3500K-4000K" }, apple: { iso: "Auto or 1000-2000 (app)", shutter: "3-7s", aperture: "N/A (fixed)", focus: "Infinity", wb: "Auto or 3500K-4000K" } },
            dslr: { iso: "1600-3200", shutter: "3-10s", aperture: "f/2.8-f/4 (widest)", focus: "Manual to Infinity", wb: "3500K-4500K" }
        };
    }
    if (score >= 40) {
        return {
            overall: "Clear auroral activity visible in cameras. Balance light capture with motion.",
            phone: { android: { iso: "800-1600", shutter: "5-10s", aperture: "Lowest f-number", focus: "Infinity", wb: "Auto or 3500K-4000K" }, apple: { iso: "Auto or 1000-2000 (app)", shutter: "3-7s", aperture: "N/A (fixed)", focus: "Infinity", wb: "Auto or 3500K-4000K" } },
            dslr: { iso: "1600-3200", shutter: "5-15s", aperture: "f/2.8-f/4 (widest)", focus: "Manual to Infinity", wb: "3500K-4500K" }
        };
    }
    return {
         overall: "Minimal activity expected. A DSLR/Mirrorless camera might capture a faint glow, but phones will likely struggle.",
         phone: { android: { iso: "3200-6400 (Max)", shutter: "15-30s", aperture: "Lowest f-number", focus: "Infinity", wb: "Auto or 3500K-4000K" }, apple: { iso: "Auto (max Night Mode)", shutter: "Longest Night Mode (10-30s)", aperture: "N/A (fixed)", focus: "Infinity", wb: "Auto or 3500K-4000K" } },
         dslr: { iso: "3200-6400", shutter: "15-25s", aperture: "f/2.8-f/4 (widest)", focus: "Manual to Infinity", wb: "3500K-4500K" }
     };
};

// --- CHILD COMPONENTS ---

const InfoModal: React.FC<InfoModalProps> = ({ isOpen, onClose, title, content }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[2100] flex justify-center items-center p-4" onClick={onClose}>
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

interface ExpandedGraphContentProps { graphId: string; solarWindTimeRange: number; setSolarWindTimeRange: (duration: number, label: string) => void; solarWindTimeLabel: string; magneticFieldTimeRange: number; setMagneticFieldTimeRange: (duration: number, label: string) => void; magneticFieldTimeLabel: string; hemisphericPowerChartTimeRange: number; setHemisphericPowerChartTimeRange: (duration: number, label: string) => void; hemisphericPowerChartTimeLabel: string; magnetometerTimeRange: number; setMagnetometerTimeRange: (duration: number, label: string) => void; magnetometerTimeLabel: string; openModal: (id: string) => void; allSpeedData: any[]; speedChartData: any; speedChartOptions: ChartOptions<'line'>; allDensityData: any[]; densityChartData: any; densityChartOptions: ChartOptions<'line'>; allMagneticData: any[]; magneticFieldChartData: any; magneticFieldOptions: ChartOptions<'line'>; hemisphericPowerHistory: any[]; hemisphericPowerChartData: any; hemisphericPowerChartOptions: ChartOptions<'line'>; goes18Data: any[]; goes19Data: any[]; magnetometerChartData: any; magnetometerOptions: ChartOptions<'line'>; loadingMagnetometer: string | null; substormBlurb: { text: string; color: string }; }
const ExpandedGraphContent: React.FC<ExpandedGraphContentProps> = React.memo(({ graphId, solarWindTimeRange, setSolarWindTimeRange, solarWindTimeLabel, magneticFieldTimeRange, setMagneticFieldTimeRange, magneticFieldTimeLabel, hemisphericPowerChartTimeRange, setHemisphericPowerChartTimeRange, hemisphericPowerChartTimeLabel, magnetometerTimeRange, setMagnetometerTimeRange, magnetometerTimeLabel, openModal, allSpeedData, speedChartData, speedChartOptions, allDensityData, densityChartData, densityChartOptions, allMagneticData, magneticFieldChartData, magneticFieldOptions, hemisphericPowerHistory, hemisphericPowerChartData, hemisphericPowerChartOptions, goes18Data, goes19Data, magnetometerChartData, magnetometerOptions, loadingMagnetometer, substormBlurb }) => {
    const CHART_HEIGHT = 'h-[calc(100%-100px)]';
    switch (graphId) {
        case 'speed-graph-container': return ( <> <div className="flex justify-center items-center gap-2"> <h2 className="text-xl font-semibold text-white text-center">Live Solar Wind Speed</h2> <button onClick={(e) => { e.stopPropagation(); openModal('solar-wind-graph'); }} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button> </div> <TimeRangeButtons onSelect={(d, l) => { setSolarWindTimeRange(d); setSolarWindTimeLabel(l); }} selected={solarWindTimeRange} /> <div className={`flex-grow relative mt-2 ${CHART_HEIGHT}`}> {allSpeedData.length > 0 ? <Line data={speedChartData} options={speedChartOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">Data unavailable.</p>} </div> </> );
        case 'density-graph-container': return ( <> <div className="flex justify-center items-center gap-2"> <h2 className="text-xl font-semibold text-white text-center">Live Solar Wind Density</h2> <button onClick={(e) => { e.stopPropagation(); openModal('solar-wind-graph'); }} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button> </div> <TimeRangeButtons onSelect={(d, l) => { setSolarWindTimeRange(d); setSolarWindTimeLabel(l); }} selected={solarWindTimeRange} /> <div className={`flex-grow relative mt-2 ${CHART_HEIGHT}`}> {allDensityData.length > 0 ? <Line data={densityChartData} options={densityChartOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">Data unavailable.</p>} </div> </> );
        case 'imf-graph-container': return ( <> <div className="flex justify-center items-center gap-2"> <h2 className="text-xl font-semibold text-white text-center">Live Interplanetary Magnetic Field</h2> <button onClick={(e) => { e.stopPropagation(); openModal('imf-graph'); }} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button> </div> <TimeRangeButtons onSelect={(d, l) => { setMagneticFieldTimeRange(d); setMagneticFieldTimeLabel(l); }} selected={magneticFieldTimeRange} /> <div className={`flex-grow relative mt-2 ${CHART_HEIGHT}`}> {allMagneticData.length > 0 ? <Line data={magneticFieldChartData} options={magneticFieldOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">Data unavailable.</p>} </div> </> );
        case 'hemispheric-power-graph-container': return ( <> <div className="flex justify-center items-center gap-2"> <h2 className="text-xl font-semibold text-white text-center">Hemispheric Power Trend</h2> <button onClick={(e) => { e.stopPropagation(); openModal('hemispheric-power-graph'); }} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button> </div> <TimeRangeButtons onSelect={(d, l) => { setHemisphericPowerChartTimeRange(d); setHemisphericPowerChartTimeLabel(l); }} selected={hemisphericPowerChartTimeRange} /> <div className={`flex-grow relative mt-2 ${CHART_HEIGHT}`}> {hemisphericPowerHistory.length > 0 ? <Line data={hemisphericPowerChartData} options={hemisphericPowerChartOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">Data unavailable.</p>} </div> </> );
        case 'goes-mag-graph-container': return ( <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full"> <div className="lg:col-span-2 h-full flex flex-col"> <div className="flex justify-center items-center gap-2"> <h2 className="text-xl font-semibold text-white text-center">GOES Magnetometer (Substorm Watch)</h2> <button onClick={(e) => { e.stopPropagation(); openModal('goes-mag'); }} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button> </div> <TimeRangeButtons onSelect={(d, l) => { setMagnetometerTimeRange(d); setMagnetometerTimeLabel(l); }} selected={magnetometerTimeRange} /> <div className={`flex-grow relative mt-2 ${CHART_HEIGHT}`}> {loadingMagnetometer ? <p className="text-center pt-10 text-neutral-400 italic">{loadingMagnetometer}</p> : <Line data={magnetometerChartData} options={magnetometerOptions} plugins={[annotationPlugin]} />} </div> </div> <div className="lg:col-span-1 flex flex-col justify-center items-center bg-neutral-900/50 p-4 rounded-lg h-full"> <h3 className="text-lg font-semibold text-neutral-200 mb-2">Magnetic Field Analysis</h3> <p className={`text-center text-lg ${substormBlurb.color}`}>{substormBlurb.text}</p> </div> </div> );
        default: return null;
    }
});

// --- MAIN COMPONENT ---

const ForecastDashboard: React.FC<ForecastDashboardProps> = ({ setViewerMedia, setCurrentAuroraScore, setSubstormActivityStatus, navigationTarget, setSubstormPrediction }) => {
    const [isLoading, setIsLoading] = useState(true);
    const [auroraScore, setAuroraScore] = useState<number | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string>('Loading...');
    const [auroraBlurb, setAuroraBlurb] = useState<string>('Loading forecast...');
    const [gaugeData, setGaugeData] = useState<Record<string, { value: string; unit: string; emoji: string; percentage: number; lastUpdated: string; color: string }>>({ power: { value: '...', unit: 'GW', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' }, speed: { value: '...', unit: 'km/s', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' }, density: { value: '...', unit: 'p/cm³', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' }, bt: { value: '...', unit: 'nT', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' }, bz: { value: '...', unit: 'nT', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' }, moon: { value: '...', unit: '%', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' }, });
    const [celestialTimes, setCelestialTimes] = useState<CelestialTimeData>({});
    const [isDaylight, setIsDaylight] = useState(false);
    const [allSpeedData, setAllSpeedData] = useState<any[]>([]);
    const [allDensityData, setAllDensityData] = useState<any[]>([]);
    const [allMagneticData, setAllMagneticData] = useState<any[]>([]);
    const [goes18Data, setGoes18Data] = useState<any[]>([]);
    const [goes19Data, setGoes19Data] = useState<any[]>([]);
    const [loadingMagnetometer, setLoadingMagnetometer] = useState<string | null>('Loading data...');
    const [substormBlurb, setSubstormBlurb] = useState<{ text: string; color: string }>({ text: 'Analyzing magnetic field stability...', color: 'text-neutral-400' });
    const [solarWindTimeRange, setSolarWindTimeRange] = useState<number>(6 * 3600000);
    const [solarWindTimeLabel, setSolarWindTimeLabel] = useState<string>('6 Hr');
    const [magneticFieldTimeRange, setMagneticFieldTimeRange] = useState<number>(6 * 3600000);
    const [magneticFieldTimeLabel, setMagneticFieldTimeLabel] = useState<string>('6 Hr');
    const [magnetometerTimeRange, setMagnetometerTimeRange] = useState<number>(3 * 3600000);
    const [magnetometerTimeLabel, setMagnetometerTimeLabel] = useState<string>('3 Hr');
    const [modalState, setModalState] = useState<{ isOpen: boolean; title: string; content: string } | null>(null);
    const [isFaqOpen, setIsFaqOpen] = useState(false);
    const [epamImageUrl, setEpamImageUrl] = useState<string>('/placeholder.png');
    const [isCameraSettingsOpen, setIsCameraSettingsOpen] = useState(false);
    const [isTipsOpen, setIsTipsOpen] = useState(false);
    const [auroraScoreHistory, setAuroraScoreHistory] = useState<{ timestamp: number; baseScore: number; finalScore: number; }[]>([]);
    const [auroraScoreChartTimeRange, setAuroraScoreChartTimeRange] = useState<number>(6 * 3600000);
    const [auroraScoreChartTimeLabel, setAuroraScoreChartTimeLabel] = useState<string>('6 Hr');
    const [hemisphericPowerHistory, setHemisphericPowerHistory] = useState<{ timestamp: number; hemisphericPower: number; }[]>([]);
    const [hemisphericPowerChartTimeRange, setHemisphericPowerChartTimeRange] = useState<number>(6 * 3600000);
    const [hemisphericPowerChartTimeLabel, setHemisphericPowerChartTimeLabel] = useState<string>('6 Hr');
    const [expandedGraph, setExpandedGraph] = useState<string | null>(null);
    const [dailyCelestialHistory, setDailyCelestialHistory] = useState<DailyHistoryEntry[]>([]);
    const [owmDailyForecast, setOwmDailyForecast] = useState<OwmDailyForecastEntry[]>([]);
    const [interplanetaryShockData, setInterplanetaryShockData] = useState<InterplanetaryShock[]>([]);
    const [isIpsOpen, setIsIpsOpen] = useState(false);
    const previousAuroraScoreRef = useRef<number | null>(null);
    const previousSubstormStatusRef = useRef<string | null>(null);
    const [showCelestialAnnotations, setShowCelestialAnnotations] = useState<boolean>(true);
    const [locationAdjustment, setLocationAdjustment] = useState<number>(0);
    const [locationBlurb, setLocationBlurb] = useState<string>('Getting location for a more accurate forecast...');
    const [selectedCamera, setSelectedCamera] = useState<Camera>(CAMERAS.find(c => c.name === 'Queenstown')!);
    const [cameraImageSrc, setCameraImageSrc] = useState<string>('');
    const [stretchingPhaseStartTime, setStretchingPhaseStartTime] = useState<number | null>(null);

    useEffect(() => {
        if (navigationTarget && navigationTarget.page === 'forecast' && navigationTarget.expandId) {
            setExpandedGraph(navigationTarget.expandId);
        }
    }, [navigationTarget]);

    const activityAlertMessage = useMemo(() => {
        if (!isDaylight || !celestialTimes.sun?.set || auroraScoreHistory.length === 0) {
            return null;
        }

        const now = Date.now();
        const sunsetTime = celestialTimes.sun.set;
        const oneHourBeforeSunset = sunsetTime - (60 * 60 * 1000);
        
        if (now >= oneHourBeforeSunset && now < sunsetTime) {
            const latestHistoryPoint = auroraScoreHistory[auroraScoreHistory.length - 1];
            const latestBaseScore = latestHistoryPoint?.baseScore ?? 0;

            if (latestBaseScore >= 50) {
                let message = "Aurora activity is currently high! Good potential for a display as soon as it's dark.";

                const moonRise = celestialTimes.moon?.rise;
                const moonSet = celestialTimes.moon?.set;
                const moonIllumination = celestialTimes.moon?.illumination;

                if (moonRise && moonSet && moonIllumination !== undefined) {
                    const moonIsUpAtSunset = (sunsetTime > moonRise && sunsetTime < moonSet) || 
                                             (moonSet < moonRise && (sunsetTime > moonRise || sunsetTime < moonSet));

                    if (moonIsUpAtSunset) {
                        message += ` Note: The ${moonIllumination.toFixed(0)}% illuminated moon will be up, which may wash out fainter details.`;
                    }
                }
                return message;
            }
        }

        return null;
    }, [isDaylight, celestialTimes, auroraScoreHistory]);

    const tooltipContent = useMemo(() => ({
        'forecast': `This percentage is a simple forecast for your chances of seeing an aurora. It combines live data from space with local factors for New Zealand.<br><br><strong>What the Percentage Means:</strong><ul><li><strong>&lt; 25%:</strong> Very unlikely to see anything with the naked eye. A good camera might pick up a faint glow on the horizon.</li><li><strong>25-50%:</strong> A good chance for cameras to capture clear color and structure. A faint white glow may be visible to the naked eye in very dark locations.</li><li><strong>50-80%:</strong> A strong display is likely. You should be able to see colors and movement with your own eyes.</li><li><strong>80%+:</strong> A major aurora storm is possible. Expect bright, fast-moving curtains of color across the sky!</li></ul>`,
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
        'live-cameras': `<strong>What are these?</strong><br>These are public webcams from around New Zealand. They are a reality check for the forecast data.<br><br><strong>How do they help?</strong><br>You can use them to:<br><ul class="list-disc list-inside space-y-2 mt-2"><li><strong>Check for Clouds:</strong> The number one obstacle to aurora spotting. See if the sky is clear before you go.</li><li><strong>Spot Faint Aurora:</strong> These cameras are often more sensitive than our eyes and can pick up glows we might miss.</li><li><strong>Verify Conditions:</strong> If the forecast is high and a southern camera shows a clear sky, your chances are good!</li></ul>`,
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
    const formatNZTimestamp = useCallback((timestamp: number | string) => { try { const d = new Date(timestamp); return isNaN(d.getTime()) ? "Invalid Date" : d.toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', dateStyle: 'short', timeStyle: 'short' }); } catch { return "Invalid Date"; } }, []);
    
    const analyzeMagnetometerData = useCallback((data: any[], currentAdjustedScore: number | null) => {
        const prevSubstormStatusText = previousSubstormStatusRef.current;
        if (data.length < 30) {
            const status = { text: 'Awaiting more magnetic field data...', color: 'text-neutral-500' };
            setSubstormBlurb(status);
            setSubstormActivityStatus(status);
            setStretchingPhaseStartTime(null);
            setSubstormPrediction(null);
            return;
        }

        const latestPoint = data[data.length - 1];
        const tenMinAgoPoint = data.find((p: any) => p.time >= latestPoint.time - 600000);
        const oneHourAgoPoint = data.find((p: any) => p.time >= latestPoint.time - 3600000);

        if (!latestPoint || !tenMinAgoPoint || !oneHourAgoPoint || isNaN(latestPoint.hp) || isNaN(tenMinAgoPoint.hp) || isNaN(oneHourAgoPoint.hp)) {
            const status = { text: 'Analyzing magnetic field stability...', color: 'text-neutral-400' };
            setSubstormBlurb(status);
            setSubstormActivityStatus(status);
            setSubstormPrediction(null);
            return;
        }

        const jump = latestPoint.hp - tenMinAgoPoint.hp;
        const drop = latestPoint.hp - oneHourAgoPoint.hp;
        const isErupting = jump > 20;
        const isStretching = drop < -15;

        let newStatusText: string, newStatusColor: string, shouldNotify = false;
        let newStretchingStartTime = stretchingPhaseStartTime;

        if (isErupting) {
            const eruptionTime = new Date(latestPoint.time).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
            newStatusText = `Substorm signature detected at ${eruptionTime}! A sharp field increase suggests a recent or ongoing eruption. Look south!`;
            newStatusColor = 'text-green-400 font-bold animate-pulse';
            newStretchingStartTime = null;
            setSubstormPrediction(null);
            if (currentAdjustedScore !== null && currentAdjustedScore > 40 && prevSubstormStatusText !== newStatusText && canSendNotification('substorm-eruption', 300000)) {
                shouldNotify = true;
            }
        } else if (isStretching) {
            let probability = 0;
            if (stretchingPhaseStartTime === null) {
                newStretchingStartTime = latestPoint.time;
                newStatusText = 'The magnetic field has begun stretching, storing energy for a potential substorm.';
                setSubstormPrediction(null);
            } else {
                const durationMinutes = (latestPoint.time - stretchingPhaseStartTime) / 60000;
                const baseProbability = Math.min(80, Math.max(20, 20 + (durationMinutes - 30) * (60 / 90)));
                const dropBonus = Math.min(15, Math.max(0, (Math.abs(drop) - 15)));
                const auroraScoreMultiplier = currentAdjustedScore ? Math.min(1.25, Math.max(1.0, 1 + (currentAdjustedScore - 40) * (0.25 / 40))) : 1.0;
                probability = Math.min(95, (baseProbability + dropBonus) * auroraScoreMultiplier);
                
                const predictedStart = new Date(stretchingPhaseStartTime + 60 * 60 * 1000);
                const predictedEnd = new Date(stretchingPhaseStartTime + 90 * 60 * 1000);
                const formatTime = (d: Date) => d.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
                
                newStatusText = `The magnetic field is stretching. There is a ~${probability.toFixed(0)}% chance of a substorm predicted between ${formatTime(predictedStart)} and ${formatTime(predictedEnd)}.`;
                
                setSubstormPrediction({
                    chance: probability,
                    startTime: predictedStart.getTime(),
                    endTime: predictedEnd.getTime(),
                });
            }
            newStatusColor = 'text-yellow-400';
            clearNotificationCooldown('substorm-eruption');
        } else {
            newStatusText = 'The magnetic field appears stable. No immediate signs of substorm development.';
            newStatusColor = 'text-neutral-400';
            newStretchingStartTime = null;
            setSubstormPrediction(null);
            clearNotificationCooldown('substorm-eruption');
        }

        if (newStretchingStartTime !== stretchingPhaseStartTime) {
            setStretchingPhaseStartTime(newStretchingStartTime);
        }

        const status = { text: newStatusText, color: newStatusColor };
        setSubstormBlurb(status);
        setSubstormActivityStatus(status);
        previousSubstormStatusRef.current = newStatusText;

        if (shouldNotify) {
            sendNotification('Substorm Eruption Alert!', `A magnetic substorm signature has been detected! Aurora activity is likely increasing. Current forecast: ${currentAdjustedScore?.toFixed(1)}%.`);
        }
    }, [setSubstormActivityStatus, stretchingPhaseStartTime, setSubstormPrediction]);

    // ... (The rest of the component remains the same) ...
    
    return (
        <div className="w-full h-full bg-neutral-900 text-neutral-300 relative" style={{ backgroundImage: `url('/background-aurora.jpg')`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed' }}>
            <div className="absolute inset-0 bg-black/50 z-0"></div>
            <div className="w-full h-full overflow-y-auto p-5 relative z-10 styled-scrollbar">
                <style>{`body { overflow-y: auto !important; } .styled-scrollbar::-webkit-scrollbar { width: 8px; } .styled-scrollbar::-webkit-scrollbar-track { background: #262626; } .styled-scrollbar::-webkit-scrollbar-thumb { background: #525252; }`}</style>
                <div className="container mx-auto">
                    <header className="text-center mb-8">
                        <a href="https://www.tnrprotography.co.nz" target="_blank" rel="noopener noreferrer"><img src="https://www.tnrprotography.co.nz/uploads/1/3/6/6/136682089/white-tnr-protography-w_orig.png" alt="TNR Protography Logo" className="mx-auto w-full max-w-[250px] mb-4"/></a>
                        <h1 className="text-3xl font-bold text-neutral-100">Spot The Aurora - New Zealand Aurora Forecast</h1>
                    </header>
                    <main className="grid grid-cols-12 gap-6">
                        {activityAlertMessage && (
                            <div className="col-span-12 card bg-yellow-900/50 border border-yellow-400/30 text-yellow-200 p-4 text-center text-sm rounded-lg">
                                {activityAlertMessage}
                            </div>
                        )}
                        <div id="forecast-score-section" className="col-span-12 card bg-neutral-950/80 p-6 md:grid md:grid-cols-2 md:gap-8 items-center">
                            <div>
                                <div className="flex justify-center items-center mb-4"><h2 className="text-lg font-semibold text-white">Spot The Aurora Forecast</h2><button onClick={() => openModal('forecast')} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button></div>
                                <div className="text-6xl font-extrabold text-white">{auroraScore !== null ? `${auroraScore.toFixed(1)}%` : '...'} <span className="text-5xl">{getAuroraEmoji(auroraScore)}</span></div>
                                <div className="w-full bg-neutral-700 rounded-full h-3 mt-4"><div className="h-3 rounded-full" style={{ width: `${auroraScore !== null ? getGaugeStyle(auroraScore, 'power').percentage : 0}%`, backgroundColor: auroraScore !== null ? GAUGE_COLORS[getForecastScoreColorKey(auroraScore)].solid : GAUGE_COLORS.gray.solid }}></div></div>
                                <div className="text-sm text-neutral-400 mt-2">{lastUpdated}</div>
                                <div className="text-xs text-neutral-500 mt-1 italic h-4">{locationBlurb}</div>
                            </div>
                            <p className="text-neutral-300 mt-4 md:mt-0">{isDaylight ? "The sun is currently up. Aurora visibility is not possible until after sunset. Check back later for an updated forecast!" : auroraBlurb}</p>
                        </div>

                        <div className="col-span-12 grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div className="card bg-neutral-950/80 p-4">
                                <div className="flex items-center justify-between cursor-pointer" onClick={() => setIsTipsOpen(!isTipsOpen)}><h2 className="text-xl font-bold text-neutral-100">Tips for Spotting the Aurora</h2><button className="p-2 rounded-full text-neutral-300 hover:bg-neutral-700/60 transition-colors"><CaretIcon className={`w-6 h-6 transform transition-transform duration-300 ${isTipsOpen ? 'rotate-180' : 'rotate-0'}`} /></button></div>
                                <div className={`transition-all duration-500 ease-in-out overflow-hidden ${isTipsOpen ? 'max-h-[150vh] opacity-100 mt-4' : 'max-h-0 opacity-0'}`}><ul className="list-disc list-inside space-y-3 text-neutral-300 text-sm pl-2"><li><strong>Look South:</strong> The aurora will always appear in the southern sky from New Zealand. Find a location with an unobstructed view to the south, away from mountains or hills.</li><li><strong>Escape Light Pollution:</strong> Get as far away from town and urban area lights as possible. The darker the sky, the more sensitive your eyes become.</li><li><strong>Check the Cloud Cover:</strong> Use the live cloud map on this dashboard to check for clear skies. A clear sky is non-negotiable. Weather changes fast, so check the map before and during your session.</li><li><strong>Let Your Eyes Adapt:</strong> Turn off all lights, including your phone screen (use red light mode if possible), for at least 15-20 minutes. Your night vision is crucial for spotting faint glows.</li><li><strong>The Camera Sees More:</strong> Your phone or DSLR camera is much more sensitive to light than your eyes. Take a long exposure shot (5-15 seconds) even if you can't see anything. You might be surprised!</li><li><strong>New Moon is Best:</strong> Check the moon illumination gauge. A bright moon acts like a giant street light, washing out the aurora. The lower the percentage, the better your chances.</li><li><strong>Be Patient & Persistent:</strong> Auroral activity ebbs and flows. A quiet period can be followed by a sudden, bright substorm. Don't give up after just a few minutes.</li></ul></div>
                            </div>
                            <div className="card bg-neutral-950/80 p-4">
                                <div className="flex items-center justify-between cursor-pointer" onClick={() => setIsCameraSettingsOpen(!isCameraSettingsOpen)}><h2 className="text-xl font-bold text-neutral-100">Suggested Camera Settings</h2><button className="p-2 rounded-full text-neutral-300 hover:bg-neutral-700/60 transition-colors"><CaretIcon className={`w-6 h-6 transform transition-transform duration-300 ${isCameraSettingsOpen ? 'rotate-180' : 'rotate-0'}`} /></button></div>
                                <div className={`transition-all duration-500 ease-in-out overflow-hidden ${isCameraSettingsOpen ? 'max-h-[150vh] opacity-100 mt-4' : 'max-h-0 opacity-0'}`}>
                                    <p className="text-neutral-400 text-center mb-6">{cameraSettings.overall}</p>
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                        <div className="bg-neutral-900/70 p-4 rounded-lg border border-neutral-700/60">
                                            <h3 className="text-lg font-semibold text-neutral-200 mb-3">📱 Phone Camera</h3>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div className="bg-neutral-800/50 p-3 rounded-md border border-neutral-700/50"><h4 className="font-semibold text-neutral-300 mb-2">Android (Pro Mode)</h4><ul className="text-xs space-y-1.5 text-neutral-400"><li>**ISO:** {cameraSettings.phone.android.iso}</li><li>**Shutter:** {cameraSettings.phone.android.shutter}</li><li>**Aperture:** {cameraSettings.phone.android.aperture}</li><li>**Focus:** {cameraSettings.phone.android.focus}</li><li>**WB:** {cameraSettings.phone.android.wb}</li></ul></div>
                                                <div className="bg-neutral-800/50 p-3 rounded-md border border-neutral-700/50"><h4 className="font-semibold text-neutral-300 mb-2">Apple (Night Mode)</h4><ul className="text-xs space-y-1.5 text-neutral-400"><li>**ISO:** {cameraSettings.phone.apple.iso}</li><li>**Shutter:** {cameraSettings.phone.apple.shutter}</li><li>**Aperture:** {cameraSettings.phone.apple.aperture}</li><li>**Focus:** {cameraSettings.phone.apple.focus}</li><li>**WB:** {cameraSettings.phone.apple.wb}</li></ul></div>
                                            </div>
                                        </div>
                                        <div className="bg-neutral-900/70 p-4 rounded-lg border border-neutral-700/60">
                                            <h3 className="text-lg font-semibold text-neutral-200 mb-3">📷 DSLR / Mirrorless</h3>
                                            <div className="bg-neutral-800/50 p-3 rounded-md border border-neutral-700/50"><h4 className="font-semibold text-neutral-300 mb-2">Recommended Settings</h4><ul className="text-xs space-y-1.5 text-neutral-400"><li>**ISO:** {cameraSettings.dslr.iso}</li><li>**Shutter:** {cameraSettings.dslr.shutter}</li><li>**Aperture:** {cameraSettings.dslr.aperture}</li><li>**Focus:** {cameraSettings.dslr.focus}</li><li>**WB:** {cameraSettings.dslr.wb}</li></ul></div>
                                        </div>
                                    </div>
                                    <p className="text-neutral-500 text-xs italic mt-6 text-center">**Disclaimer:** These are starting points. Experimentation is key!</p>
                                </div>
                            </div>
                        </div>

                        <AuroraSightings isDaylight={isDaylight} />

                        <div className="col-span-12 card bg-neutral-950/80 p-4 h-[400px] flex flex-col">
                            <div className="flex justify-center items-center gap-2 mb-2"><h2 className="text-xl font-semibold text-white text-center">Forecast Trend (Last {auroraScoreChartTimeLabel})</h2><button onClick={() => openModal('forecast')} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button></div>
                            <div className="flex justify-between items-center mb-2"><TimeRangeButtons onSelect={(d, l) => { setAuroraScoreChartTimeRange(d); setAuroraScoreChartTimeLabel(l); }} selected={auroraScoreChartTimeRange} /><ToggleSwitch label="Moon/Sun Data" checked={showCelestialAnnotations} onChange={setShowCelestialAnnotations} /></div>
                            <div className="flex-grow relative mt-2">{auroraScoreHistory.length > 0 ? <Line data={auroraScoreChartData} options={auroraScoreChartOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">No historical data.</p>}</div>
                        </div>

                        <div className="col-span-12 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-5">
                            {Object.entries(gaugeData).map(([key, data]) => {
                                const isGraphable = !['moon'].includes(key);
                                let graphId: string | null = null;
                                if (key === 'speed') graphId = 'speed-graph-container'; else if (key === 'density') graphId = 'density-graph-container'; else if (key === 'power') graphId = 'hemispheric-power-graph-container'; else if (key === 'bt' || key === 'bz') graphId = 'imf-graph-container';
                                const isCurrentlyExpanded = expandedGraph === graphId;
                                const shouldRenderGraphContent = isCurrentlyExpanded && graphId && ((graphId === 'imf-graph-container' && key === 'bt') || (graphId !== 'imf-graph-container'));
                                return (
                                    <React.Fragment key={key}>
                                        <div className="col-span-1 card bg-neutral-950/80 p-1 text-center flex flex-col justify-between">
                                            <button onClick={() => isGraphable && setExpandedGraph(isCurrentlyExpanded ? null : graphId)} className={`flex flex-col justify-between items-center w-full h-full p-2 rounded-lg transition-colors ${isGraphable ? 'hover:bg-neutral-800/50 cursor-pointer' : ''} ${isCurrentlyExpanded ? 'bg-neutral-800/70' : ''}`} disabled={!isGraphable}>
                                                <div className="flex justify-center items-center"><h3 className="text-md font-semibold text-white h-10 flex items-center justify-center">{key === 'moon' ? 'Moon' : key.toUpperCase()}</h3><button onClick={(e) => { e.stopPropagation(); openModal(key); }} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button></div>
                                                <div className="font-bold my-2" dangerouslySetInnerHTML={{ __html: data.value }}></div>
                                                <div className="text-3xl my-2">{data.emoji}</div>
                                                <div className="w-full bg-neutral-700 rounded-full h-3 mt-4"><div className="h-3 rounded-full" style={{ width: `${data.percentage}%`, backgroundColor: data.color }}></div></div>
                                                <div className="text-xs text-neutral-500 mt-2 truncate" title={data.lastUpdated}>{data.lastUpdated}</div>
                                                {isGraphable && ( <CaretIcon className={`w-5 h-5 mt-2 text-neutral-400 transform transition-transform duration-300 ${isCurrentlyExpanded ? 'rotate-180' : 'rotate-0'}`} /> )}
                                            </button>
                                        </div>
                                        {shouldRenderGraphContent && <div className="col-span-full card bg-neutral-950/80 p-4 flex flex-col transition-all duration-500 ease-in-out max-h-[700px] opacity-100"><ExpandedGraphContent graphId={graphId!} {...{ solarWindTimeRange, setSolarWindTimeRange, solarWindTimeLabel, magneticFieldTimeRange, setMagneticFieldTimeRange, magneticFieldTimeLabel, hemisphericPowerChartTimeRange, setHemisphericPowerChartTimeRange, hemisphericPowerChartTimeLabel, magnetometerTimeRange, setMagnetometerTimeRange, magnetometerTimeLabel, openModal, allSpeedData, speedChartData, speedChartOptions, allDensityData, densityChartData, densityChartOptions, allMagneticData, magneticFieldChartData, magneticFieldOptions, hemisphericPowerHistory, hemisphericPowerChartData, hemisphericPowerChartOptions, goes18Data, goes19Data, magnetometerChartData, magnetometerOptions, loadingMagnetometer, substormBlurb }} /></div>}
                                    </React.Fragment>
                                );
                            })}
                        </div>

                        <div id="goes-magnetometer-section" className="col-span-12 card bg-neutral-950/80 p-4">
                            <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpandedGraph(expandedGraph === 'goes-mag-graph-container' ? null : 'goes-mag-graph-container')}>
                                <h2 className="text-xl font-semibold text-neutral-100">GOES Magnetometer (Substorm Watch)</h2>
                                <button onClick={(e) => { e.stopPropagation(); openModal('goes-mag'); }} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button>
                                <button className="p-2 rounded-full text-neutral-300 hover:bg-neutral-700/60 transition-colors"> <CaretIcon className={`w-6 h-6 transform transition-transform duration-300 ${expandedGraph === 'goes-mag-graph-container' ? 'rotate-180' : 'rotate-0'}`} /> </button>
                            </div>
                            <div className={`transition-all duration-500 ease-in-out overflow-hidden ${expandedGraph === 'goes-mag-graph-container' ? 'max-h-[750px] opacity-100 mt-4' : 'max-h-0 opacity-0'}`}><ExpandedGraphContent graphId={'goes-mag-graph-container'} {...{ solarWindTimeRange, setSolarWindTimeRange, solarWindTimeLabel, magneticFieldTimeRange, setMagneticFieldTimeRange, magneticFieldTimeLabel, hemisphericPowerChartTimeRange, setHemisphericPowerChartTimeRange, hemisphericPowerChartTimeLabel, magnetometerTimeRange, setMagnetometerTimeRange, magnetometerTimeLabel, openModal, allSpeedData, speedChartData, speedChartOptions, allDensityData, densityChartData, densityChartOptions, allMagneticData, magneticFieldChartData, magneticFieldOptions, hemisphericPowerHistory, hemisphericPowerChartData, hemisphericPowerChartOptions, goes18Data, goes19Data, magnetometerChartData, magnetometerOptions, loadingMagnetometer, substormBlurb }} /></div>
                        </div>
                        
                        <div className="col-span-12 card bg-neutral-950/80 p-4">
                            <div className="flex items-center justify-between cursor-pointer" onClick={() => setIsIpsOpen(!isIpsOpen)}>
                                <div className="flex items-center"><h2 className="text-xl font-semibold text-neutral-100">Interplanetary Shock Events</h2><button onClick={(e) => { e.stopPropagation(); openModal('ips'); }} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button></div>
                                <button className="p-2 rounded-full text-neutral-300 hover:bg-neutral-700/60 transition-colors"><CaretIcon className={`w-6 h-6 transform transition-transform duration-300 ${isIpsOpen ? 'rotate-180' : 'rotate-0'}`} /></button>
                            </div>
                            <div className={`transition-all duration-500 ease-in-out overflow-hidden ${isIpsOpen ? 'max-h-[150vh] opacity-100 mt-4' : 'max-h-0 opacity-0'}`}>
                                {interplanetaryShockData.length > 0 ? <div className="space-y-4 text-sm">{interplanetaryShockData.slice(0, 5).map((shock) => (<div key={shock.activityID} className="bg-neutral-900/70 p-3 rounded-lg border border-neutral-700/60"><p><strong className="text-neutral-300">Shock Time:</strong> <span className="text-yellow-400 font-mono">{formatNZTimestamp(shock.eventTime)}</span></p><p><strong className="text-neutral-300">Location:</strong> {shock.location}</p><p><strong className="text-neutral-300">Source:</strong> {shock.instruments.map(inst => inst.displayName).join(', ')}</p><p><strong className="text-neutral-300">Activity ID:</strong> <a href={shock.link} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">{shock.activityID}</a></p></div>))}</div> : <p className="text-center pt-5 text-neutral-400 italic">No recent interplanetary shock data available from NASA.</p>}
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
            {modalState && <InfoModal isOpen={modalState.isOpen} onClose={closeModal} title={modalState.title} content={modalState.content} />}
            <InfoModal isOpen={isFaqOpen} onClose={() => setIsFaqOpen(false)} title="Frequently Asked Questions" content={faqContent} />
        </div>
    );
};

export default ForecastDashboard;
// --- END OF FILE ForecastDashboard.tsx ---