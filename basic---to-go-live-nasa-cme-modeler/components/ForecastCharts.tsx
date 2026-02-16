// --- START OF FILE src/components/ForecastCharts.tsx ---

import React, { useState, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import annotationPlugin from 'chartjs-plugin-annotation';
import { ChartOptions, ScriptableContext } from 'chart.js';
import CaretIcon from './icons/CaretIcon';
import ToggleSwitch from './ToggleSwitch';
import { DailyHistoryEntry, OwmDailyForecastEntry } from '../types';
import { NzMagEvent } from '../hooks/useForecastData';

// --- CONSTANTS & HELPERS (from ForecastDashboard) ---
const GAUGE_THRESHOLDS = {
  speed:   { gray: 250, yellow: 350, orange: 500, red: 650, purple: 800, pink: Infinity, maxExpected: 1000 },
  density: { gray: 5,   yellow: 10,  orange: 15,  red: 20,  purple: 50,  pink: Infinity, maxExpected: 70 },
  power:   { gray: 20,  yellow: 40,  orange: 70,  red: 150, purple: 200, pink: Infinity, maxExpected: 250 },
  bt:      { gray: 5,   yellow: 10,  orange: 15,  red: 20,  purple: 50,  pink: Infinity, maxExpected: 60 },
  bz:      { gray: -5,  yellow: -10, orange: -15, red: -20, purple: -50, pink: -50, maxNegativeExpected: -60 }
};

export const GAUGE_COLORS = {
    gray:   { solid: '#808080', semi: 'rgba(128, 128, 128, 0.2)', trans: 'rgba(128, 128, 128, 0)' },
    yellow: { solid: '#FFD700', semi: 'rgba(255, 215, 0, 0.2)', trans: 'rgba(255, 215, 0, 0)' },
    orange: { solid: '#FFA500', semi: 'rgba(255, 165, 0, 0.2)', trans: 'rgba(255, 165, 0, 0)' },
    red:    { solid: '#FF4500', semi: 'rgba(255, 69, 0, 0.2)', trans: 'rgba(255, 69, 0, 0)' },
    purple: { solid: '#800080', semi: 'rgba(128, 0, 128, 0.2)', trans: 'rgba(128, 0, 128, 0)' },
    pink:   { solid: '#FF1493', semi: 'rgba(255, 20, 147, 0.2)', trans: 'rgba(255, 20, 147, 0)' }
};

type GaugeColorKey = keyof typeof GAUGE_COLORS;
type ColorStop = { value: number; color: GaugeColorKey };

const COLOR_RGB: Record<GaugeColorKey, { r: number; g: number; b: number }> = {
    gray: { r: 128, g: 128, b: 128 },
    yellow: { r: 255, g: 215, b: 0 },
    orange: { r: 255, g: 165, b: 0 },
    red: { r: 255, g: 69, b: 0 },
    purple: { r: 128, g: 0, b: 128 },
    pink: { r: 255, g: 20, b: 147 },
};

const toRgba = (color: GaugeColorKey, alpha = 1) => {
    const c = COLOR_RGB[color];
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
};

const interpolateStopsToRgba = (value: number, stops: ColorStop[], alpha = 1) => {
    if (!stops.length) return toRgba('gray', alpha);
    if (value <= stops[0].value) return toRgba(stops[0].color, alpha);
    if (value >= stops[stops.length - 1].value) return toRgba(stops[stops.length - 1].color, alpha);

    for (let i = 1; i < stops.length; i++) {
        const lower = stops[i - 1];
        const upper = stops[i];
        if (value <= upper.value) {
            const span = upper.value - lower.value || 1;
            const t = Math.max(0, Math.min(1, (value - lower.value) / span));
            const a = COLOR_RGB[lower.color];
            const b = COLOR_RGB[upper.color];
            return `rgba(${Math.round(a.r + (b.r - a.r) * t)}, ${Math.round(a.g + (b.g - a.g) * t)}, ${Math.round(a.b + (b.b - a.b) * t)}, ${alpha})`;
        }
    }
    return toRgba('pink', alpha);
};

const positiveStopsCache = new WeakMap<object, ColorStop[]>();
const bzStopsCache = new WeakMap<object, ColorStop[]>();

const getPositiveStops = (thresholds: { [key: string]: number }): ColorStop[] => {
    const cached = positiveStopsCache.get(thresholds);
    if (cached) return cached;
    const maxExpected = Number.isFinite(thresholds.maxExpected) ? thresholds.maxExpected : (thresholds.purple || 100);
    const stops: ColorStop[] = [
        { value: 0, color: 'gray' },
        { value: thresholds.yellow, color: 'yellow' },
        { value: thresholds.orange, color: 'orange' },
        { value: thresholds.red, color: 'red' },
        { value: thresholds.purple, color: 'purple' },
        { value: maxExpected, color: 'pink' },
    ];
    positiveStopsCache.set(thresholds, stops);
    return stops;
};

const getBzStops = (thresholds: { [key: string]: number }): ColorStop[] => {
    const cached = bzStopsCache.get(thresholds);
    if (cached) return cached;
    const stops: ColorStop[] = [
        { value: 0, color: 'gray' },
        { value: Math.abs(thresholds.yellow), color: 'yellow' },
        { value: Math.abs(thresholds.orange), color: 'orange' },
        { value: Math.abs(thresholds.red), color: 'red' },
        { value: Math.abs(thresholds.purple), color: 'purple' },
        { value: Math.abs(thresholds.maxNegativeExpected ?? thresholds.purple), color: 'pink' },
    ];
    bzStopsCache.set(thresholds, stops);
    return stops;
};

const getSmoothPositiveActivityColor = (value: number, thresholds: { [key: string]: number }, alpha = 1) =>
    interpolateStopsToRgba(value, getPositiveStops(thresholds), alpha);

const getSmoothBzActivityColor = (value: number, thresholds: { [key: string]: number }, alpha = 1) =>
    interpolateStopsToRgba(Math.max(0, -value), getBzStops(thresholds), alpha);

const FORECAST_SCORE_STOPS: ColorStop[] = [
    { value: 0, color: 'gray' },
    { value: 10, color: 'yellow' },
    { value: 25, color: 'orange' },
    { value: 40, color: 'red' },
    { value: 50, color: 'purple' },
    { value: 80, color: 'pink' },
];

const getSmoothForecastScoreColor = (score: number, alpha = 1) =>
    interpolateStopsToRgba(score, FORECAST_SCORE_STOPS, alpha);

export const getForecastScoreColorKey = (score: number): keyof typeof GAUGE_COLORS => {
    if (score >= 80) return 'pink'; if (score >= 50) return 'purple'; if (score >= 40) return 'red';
    if (score >= 25) return 'orange'; if (score >= 10) return 'yellow';
    return 'gray';
};

const createVerticalThresholdGradient = (ctx: ScriptableContext<'line'>, thresholds: any, isBz: boolean = false) => {
    const chart = ctx.chart; const { chartArea, scales: { y: yScale } } = chart;
    if (!chartArea || !yScale) return undefined;
    const gradient = chart.ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
    const yScaleRange = yScale.max - yScale.min;
    if (yScaleRange === 0) return GAUGE_COLORS.gray.semi;
    const getYStopPosition = (value: number) => Math.max(0, Math.min(1, 1 - ((value - yScale.min) / yScaleRange)));
    if (isBz) {
        gradient.addColorStop(getYStopPosition(yScale.max), GAUGE_COLORS.gray.trans);
        Object.entries(thresholds).reverse().forEach(([key, value]) => {
            if (typeof value === 'number' && GAUGE_COLORS[key as keyof typeof GAUGE_COLORS]) {
                gradient.addColorStop(getYStopPosition(value), GAUGE_COLORS[key as keyof typeof GAUGE_COLORS].semi);
            }
        });
        gradient.addColorStop(getYStopPosition(yScale.min), GAUGE_COLORS.pink.semi);
    } else {
        gradient.addColorStop(getYStopPosition(yScale.min), GAUGE_COLORS.gray.semi);
        Object.entries(thresholds).forEach(([key, value]) => {
             if (typeof value === 'number' && GAUGE_COLORS[key as keyof typeof GAUGE_COLORS]) {
                gradient.addColorStop(getYStopPosition(value), GAUGE_COLORS[key as keyof typeof GAUGE_COLORS].semi);
            }
        });
        gradient.addColorStop(getYStopPosition(yScale.max), GAUGE_COLORS.pink.trans);
    }
    return gradient;
};

const baseChartOptions: ChartOptions<'line'> = {
    responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false, axis: 'x' },
    plugins: { legend: { display: false, labels: {color: '#a1a1aa'} }, tooltip: { mode: 'index', intersect: false } },
    scales: { 
        x: { type: 'time', ticks: { color: '#71717a', source: 'auto' }, grid: { color: '#3f3f46' } },
        y: { position: 'left', ticks: { color: '#a3a3a3' }, grid: { color: '#3f3f46' }, title: { display: true, color: '#a3a3a3' } }
    }
};

const createDynamicChartOptions = (
    rangeMs: number,
    yLabel: string,
    datasets: { data: { y: number }[] }[],
    scaleConfig: { type: 'speed' | 'density' | 'temp' | 'imf' | 'power' | 'substorm' | 'nzmag' },
    extraAnnotations?: any,
): ChartOptions<'line'> => {
    const now = Date.now();
    const startTime = now - rangeMs;

    const options: ChartOptions<'line'> = JSON.parse(JSON.stringify(baseChartOptions)); // Deep copy
    if (!options.scales || !options.scales.x || !options.scales.y) return options; // Type guard

    options.scales.x.min = startTime;
    options.scales.x.max = now;
    options.scales.y.title!.text = yLabel;
    
    if (extraAnnotations) {
        options.plugins = { ...options.plugins, annotation: { annotations: extraAnnotations } };
    }

    const allYValues = datasets.flatMap(dataset => dataset.data.map(p => p.y)).filter(y => y !== null && !isNaN(y));
    if (allYValues.length === 0) return options;

    let min: number | undefined = undefined;
    let max: number | undefined = undefined;

    switch (scaleConfig.type) {
        case 'speed':
            min = 200;
            max = Math.ceil(Math.max(800, ...allYValues) / 50) * 50;
            break;
        case 'density':
            min = 0;
            max = Math.ceil(Math.max(30, ...allYValues) / 5) * 5;
            break;
        case 'temp':
            min = 0;
            max = Math.ceil(Math.max(600000, ...allYValues) / 100000) * 100000;
            break;
        case 'imf':
            const maxAbs = Math.ceil(Math.max(25, ...allYValues.map(Math.abs)) / 5) * 5;
            min = -maxAbs;
            max = maxAbs;
            break;
        case 'power':
            min = 0;
            max = Math.ceil(Math.max(100, ...allYValues) / 25) * 25;
            break;
        case 'substorm':
            const high = Math.max(...allYValues);
            const low = Math.min(...allYValues);
            if (high > 100) max = high;
            if (low < -20) min = low;
            break;
        case 'nzmag':
            const dataMax = Math.max(...allYValues);
            const dataMin = Math.min(...allYValues);
            const range = dataMax - dataMin;
            const padding = range * 0.1 || 1;
            min = Math.floor(dataMin - padding);
            max = Math.ceil(dataMax + padding);
            break;
    }
    
    if (min !== undefined) options.scales.y.min = min;
    if (max !== undefined) options.scales.y.max = max;
  
    return options;
};

const TimeRangeButtons: React.FC<{ onSelect: (duration: number) => void; selected: number }> = ({ onSelect, selected }) => {
    const timeRanges = [ { label: '1 Hr', hours: 1 }, { label: '2 Hr', hours: 2 }, { label: '3 Hr', hours: 3 }, { label: '6 Hr', hours: 6 }, { label: '12 Hr', hours: 12 }, { label: '24 Hr', hours: 24 } ];
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

// --- CHART COMPONENTS ---

export const SolarWindSpeedChart: React.FC<{ data: any[] }> = ({ data }) => {
    const [timeRange, setTimeRange] = useState(6 * 3600000);
    const latestValue = data.length ? (data[data.length - 1]?.y ?? 0) : 0;
    const lineColor = getSmoothPositiveActivityColor(latestValue, GAUGE_THRESHOLDS.speed);
    const chartData = useMemo(() => ({
        datasets: [{
            label: 'Speed',
            data,
            yAxisID: 'y',
            fill: 'origin',
            borderWidth: 1.6,
            pointRadius: 0,
            tension: 0.2,
            borderColor: lineColor,
            backgroundColor: (ctx: ScriptableContext<'line'>) => createVerticalThresholdGradient(ctx, GAUGE_THRESHOLDS.speed, false),
        }]
    }), [data, lineColor]);
    const chartOptions = useMemo(() => createDynamicChartOptions(timeRange, 'Speed (km/s)', chartData.datasets, { type: 'speed' }), [timeRange, chartData]);

    return (
        <div className="h-full flex flex-col">
            <TimeRangeButtons onSelect={setTimeRange} selected={timeRange} />
            <div className="flex-grow relative mt-2 min-h-[250px]">
                {data.length > 0 ? <Line data={chartData} options={chartOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">Data unavailable.</p>}
            </div>
        </div>
    );
};

export const SolarWindDensityChart: React.FC<{ data: any[] }> = ({ data }) => {
    const [timeRange, setTimeRange] = useState(6 * 3600000);
    const latestValue = data.length ? (data[data.length - 1]?.y ?? 0) : 0;
    const lineColor = getSmoothPositiveActivityColor(latestValue, GAUGE_THRESHOLDS.density);
    const chartData = useMemo(() => ({
        datasets: [{
            label: 'Density',
            data,
            yAxisID: 'y',
            fill: 'origin',
            borderWidth: 1.6,
            pointRadius: 0,
            tension: 0.2,
            borderColor: lineColor,
            backgroundColor: (ctx: ScriptableContext<'line'>) => createVerticalThresholdGradient(ctx, GAUGE_THRESHOLDS.density, false),
        }]
    }), [data, lineColor]);
    const chartOptions = useMemo(() => createDynamicChartOptions(timeRange, 'Density (p/cm³)', chartData.datasets, { type: 'density' }), [timeRange, chartData]);

    return (
        <div className="h-full flex flex-col">
            <TimeRangeButtons onSelect={setTimeRange} selected={timeRange} />
            <div className="flex-grow relative mt-2 min-h-[250px]">
                {data.length > 0 ? <Line data={chartData} options={chartOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">Data unavailable.</p>}
            </div>
        </div>
    );
};

export const SolarWindTemperatureChart: React.FC<{ data: any[] }> = ({ data }) => {
    const [timeRange, setTimeRange] = useState(6 * 3600000);
    const latestValue = data.length ? (data[data.length - 1]?.y ?? 0) : 0;
    const lineColor = latestValue >= 600000 ? '#f97316' : latestValue >= 250000 ? '#38bdf8' : '#a3a3a3';
    const chartData = useMemo(() => ({
        datasets: [{
            label: 'Temperature',
            data,
            yAxisID: 'y',
            fill: 'origin',
            borderWidth: 1.6,
            pointRadius: 0,
            tension: 0.2,
            borderColor: lineColor,
            backgroundColor: 'rgba(56, 189, 248, 0.12)',
        }]
    }), [data, lineColor]);
    const chartOptions = useMemo(() => createDynamicChartOptions(timeRange, 'Temperature (K)', chartData.datasets, { type: 'temp' }), [timeRange, chartData]);

    return (
        <div className="h-full flex flex-col">
            <TimeRangeButtons onSelect={setTimeRange} selected={timeRange} />
            <div className="flex-grow relative mt-2 min-h-[250px]">
                {data.length > 0 ? <Line data={chartData} options={chartOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">Data unavailable.</p>}
            </div>
        </div>
    );
};

export const IMFClockChart: React.FC<{ magneticData: any[]; clockData: any[] }> = ({ magneticData, clockData }) => {
    const latestPoint = magneticData.length ? magneticData[magneticData.length - 1] : null;
    const latestClock = useMemo(() => {
        if (clockData.length) return clockData[clockData.length - 1]?.y ?? null;
        if (!latestPoint) return null;
        if (Number.isFinite(latestPoint?.clock)) return latestPoint.clock as number;
        if (!Number.isFinite(latestPoint?.by) || !Number.isFinite(latestPoint?.bz)) return null;
        return (Math.atan2(latestPoint.by, latestPoint.bz) * 180 / Math.PI + 360) % 360;
    }, [clockData, latestPoint]);

    const [animatedAngle, setAnimatedAngle] = useState<number>(latestClock ?? 0);

    React.useEffect(() => {
        if (latestClock == null) return;
        const id = window.setInterval(() => {
            setAnimatedAngle((prev) => {
                let diff = latestClock - prev;
                if (diff > 180) diff -= 360;
                if (diff < -180) diff += 360;
                return prev + diff * 0.2;
            });
        }, 60);
        return () => window.clearInterval(id);
    }, [latestClock]);

    const bt = Number.isFinite(latestPoint?.bt) ? latestPoint.bt : null;
    const by = Number.isFinite(latestPoint?.by) ? latestPoint.by : null;
    const bz = Number.isFinite(latestPoint?.bz) ? latestPoint.bz : null;

    const status = useMemo(() => {
        if (bz == null || by == null || bt == null) {
            return {
                title: 'IMF status unavailable',
                summary: 'Waiting for live By/Bz vectors from the merged IMF feed.',
                color: 'text-neutral-300'
            };
        }
        if (bz <= -8 && bt >= 10) {
            return {
                title: 'Strongly favorable IMF',
                summary: 'Bz is strongly southward. Expect better aurora potential if skies are dark and clear.',
                color: 'text-emerald-300'
            };
        }
        if (bz > 0 && by < 0) {
            return {
                title: 'Mixed but still supportive',
                summary: 'Bz is northward, but negative By can still help aurora development in some conditions.',
                color: 'text-amber-300'
            };
        }
        if (bz <= -3) {
            return {
                title: 'Moderately favorable IMF',
                summary: 'Bz is southward. If this holds, aurora chances can improve over the next 20–60 minutes.',
                color: 'text-sky-300'
            };
        }
        return {
            title: 'Less favorable IMF',
            summary: 'IMF is mixed to northward. Aurora can still occur, but strong bursts are less likely right now.',
            color: 'text-neutral-300'
        };
    }, [bt, by, bz]);

    return (
        <div className="h-full flex flex-col justify-center">
            <div className="bg-neutral-900/60 border border-neutral-700/60 rounded-lg p-4">
                <div className={`text-sm font-semibold ${status.color}`}>{status.title}</div>
                <p className="text-xs text-neutral-300 mt-1 leading-relaxed">{status.summary}</p>

                <div className="mt-4 flex flex-col md:flex-row items-center gap-4">
                    <div className="relative w-40 h-40 rounded-full border-2 border-neutral-600 bg-neutral-950/80 shadow-inner shadow-sky-500/10 overflow-hidden">
                        <div className="absolute inset-0 rounded-full border border-emerald-400/30 animate-pulse" />
                        <div className="absolute top-1/2 left-0 right-0 border-t border-neutral-700" />
                        <div className="absolute left-1/2 top-0 bottom-0 border-l border-neutral-700" />
                        <div className="absolute left-1/2 top-1/2 w-1 h-14 origin-bottom bg-sky-400 rounded-full shadow-[0_0_10px_rgba(56,189,248,0.7)]" style={{ transform: `translate(-50%, -100%) rotate(${animatedAngle}deg)` }} />
                        <div className="absolute left-1/2 top-1/2 w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-300" />
                        <div className="absolute top-2 left-1/2 -translate-x-1/2 text-[10px] text-neutral-300">North</div>
                        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-emerald-300">South (best)</div>
                    </div>

                    <div className="text-xs text-neutral-300 space-y-1 w-full max-w-xs">
                        <div>Clock angle: <strong>{latestClock != null ? `${latestClock.toFixed(0)}°` : '—'}</strong></div>
                        <div>Bt: <strong>{bt != null ? `${bt.toFixed(1)} nT` : '—'}</strong></div>
                        <div>Bz: <strong>{bz != null ? `${bz.toFixed(1)} nT` : '—'}</strong></div>
                        <div>By: <strong>{by != null ? `${by.toFixed(1)} nT` : '—'}</strong></div>
                        <p className="text-neutral-400 pt-2">
                            Easy read: when the pointer spends more time near the lower half (south), aurora coupling is usually stronger.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export const MagneticFieldChart: React.FC<{ data: any[] }> = ({ data }) => {
    const [timeRange, setTimeRange] = useState(6 * 3600000);
    const [showBxBy, setShowBxBy] = useState(false);
    const latestBt = data.length ? (data[data.length - 1]?.bt ?? 0) : 0;
    const latestBz = data.length ? (data[data.length - 1]?.bz ?? 0) : 0;
    const btColor = getSmoothPositiveActivityColor(latestBt, GAUGE_THRESHOLDS.bt);
    const bzColor = getSmoothBzActivityColor(latestBz, GAUGE_THRESHOLDS.bz);

    const chartData = useMemo(() => ({
        datasets: [
            {
                label: 'Bt',
                data: data.map(p => ({ x: p.time, y: p.bt })),
                order: 1,
                fill: 'origin',
                borderWidth: 1.6,
                pointRadius: 0,
                tension: 0.2,
                borderColor: btColor,
                backgroundColor: (ctx: ScriptableContext<'line'>) => createVerticalThresholdGradient(ctx, GAUGE_THRESHOLDS.bt, false),
            },
            {
                label: 'Bz',
                data: data.map(p => ({ x: p.time, y: p.bz })),
                order: 0,
                fill: 'origin',
                borderWidth: 1.6,
                pointRadius: 0,
                tension: 0.2,
                borderColor: bzColor,
                backgroundColor: (ctx: ScriptableContext<'line'>) => createVerticalThresholdGradient(ctx, GAUGE_THRESHOLDS.bz, true),
            },
            ...(showBxBy ? [{
                label: 'By',
                data: data.map(p => ({ x: p.time, y: p.by })),
                borderColor: '#38bdf8',
                backgroundColor: 'transparent',
                fill: false,
                borderWidth: 1.3,
                pointRadius: 0,
                tension: 0.2,
                borderDash: [4, 4],
            }, {
                label: 'Bx',
                data: data.map(p => ({ x: p.time, y: p.bx })),
                borderColor: '#c084fc',
                backgroundColor: 'transparent',
                fill: false,
                borderWidth: 1.3,
                pointRadius: 0,
                tension: 0.2,
                borderDash: [2, 4],
            }] : [])
        ]
    }), [data, btColor, bzColor, showBxBy]);
    const chartOptions = useMemo(() => createDynamicChartOptions(timeRange, 'Magnetic Field (nT)', chartData.datasets, { type: 'imf' }), [timeRange, chartData]);

    return (
        <div className="h-full flex flex-col">
            <div className="bg-neutral-900/60 border border-neutral-700/60 rounded-lg p-2 mb-2 flex justify-end">
                <ToggleSwitch label="Show Bx/By" checked={showBxBy} onChange={setShowBxBy} />
            </div>
            <TimeRangeButtons onSelect={setTimeRange} selected={timeRange} />
            <div className="flex-grow relative mt-2 min-h-[250px]">
                {data.length > 0 ? <Line data={chartData} options={chartOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">Data unavailable.</p>}
            </div>
        </div>
    );
};

export const HemisphericPowerChart: React.FC<{ data: any[] }> = ({ data }) => {
    const [timeRange, setTimeRange] = useState(6 * 3600000);
    const latestValue = data.length ? (data[data.length - 1]?.y ?? 0) : 0;
    const lineColor = getSmoothPositiveActivityColor(latestValue, GAUGE_THRESHOLDS.power);
    const chartData = useMemo(() => ({
        datasets: [{
            label: 'Hemispheric Power',
            data,
            borderColor: lineColor,
            backgroundColor: (ctx: ScriptableContext<'line'>) => createVerticalThresholdGradient(ctx, GAUGE_THRESHOLDS.power, false),
            fill: 'origin',
            tension: 0.2,
            pointRadius: 0,
            borderWidth: 1.6,
            spanGaps: true,
        }]
    }), [data, lineColor]);
    const chartOptions = useMemo(() => createDynamicChartOptions(timeRange, 'Hemispheric Power (GW)', chartData.datasets, { type: 'power' }), [timeRange, chartData]);

    return (
        <div className="h-full flex flex-col">
            <TimeRangeButtons onSelect={setTimeRange} selected={timeRange} />
            <div className="flex-grow relative mt-2 min-h-[250px]">
                {data.length > 0 ? <Line data={chartData} options={chartOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">Data unavailable.</p>}
            </div>
        </div>
    );
};

export const SubstormChart: React.FC<{ goes18Data: any[], goes19Data: any[], annotations: any, loadingMessage: string | null }> = ({ goes18Data, goes19Data, annotations, loadingMessage }) => {
    const [timeRange, setTimeRange] = useState(3 * 3600000);
    const chartData = useMemo(() => ({ datasets: [ { label: 'GOES-18 (Primary)', data: goes18Data.map(p => ({ x: p.time, y: p.hp })), borderColor: 'rgb(56, 189, 248)', backgroundColor: 'transparent', pointRadius: 0, tension: 0.1, borderWidth: 1.5, fill: false }, { label: 'GOES-19 (Secondary)', data: goes19Data.map(p => ({ x: p.time, y: p.hp })), borderColor: 'rgb(255, 69, 0)', backgroundColor: 'transparent', pointRadius: 0, tension: 0.1, borderWidth: 1.5, fill: false } ] }), [goes18Data, goes19Data]);
    const chartOptions = useMemo(() => createDynamicChartOptions(timeRange, 'Hp (nT)', chartData.datasets, { type: 'substorm' }, annotations), [timeRange, chartData, annotations]);
    
    return (
        <div className="h-full flex flex-col">
            <TimeRangeButtons onSelect={setTimeRange} selected={timeRange} />
            <div className="flex-grow relative mt-2 min-h-[250px]">
                {loadingMessage ? <p className="text-center pt-10 text-neutral-400 italic">{loadingMessage}</p> : <Line data={chartData} options={chartOptions} plugins={[annotationPlugin]} />}
            </div>
        </div>
    );
};

export const NzMagnetometerChart: React.FC<{ data: any[], events: NzMagEvent[], selectedEvent: NzMagEvent | null, loadingMessage: string | null }> = ({ data, events, selectedEvent, loadingMessage }) => {
    const [timeRange, setTimeRange] = useState(3 * 3600000);
    
    const chartData = useMemo(() => {
        const eyrewellData = data.find(d => d.series?.station === 'EY2M')?.data || [];
        return {
            datasets: [{
                label: 'West Melton dH/dt',
                data: eyrewellData,
                borderColor: 'rgb(34, 197, 94)',
                backgroundColor: 'rgba(34, 197, 94, 0.2)',
                fill: false,
                pointRadius: 0,
                tension: 0.1,
                borderWidth: 1.5
            }]
        };
    }, [data]);

    const annotations = useMemo(() => {
        if (!selectedEvent) return {};
        return {
            eventBox: {
                type: 'box',
                xMin: selectedEvent.start,
                xMax: selectedEvent.end,
                backgroundColor: 'rgba(255, 69, 0, 0.25)',
                borderColor: 'rgba(255, 69, 0, 0.6)',
                borderWidth: 2,
            },
            eventLabel: {
                type: 'label',
                xValue: selectedEvent.start + (selectedEvent.end - selectedEvent.start) / 2,
                yValue: '95%',
                yScaleID: 'y',
                content: `Max Delta: ${selectedEvent.maxDelta.toFixed(1)} nT/min`,
                color: 'rgba(255, 255, 255, 0.9)',
                font: { size: 11, weight: 'bold' },
                backgroundColor: 'rgba(255, 69, 0, 0.7)',
                padding: 3,
                borderRadius: 3,
            }
        };
    }, [selectedEvent]);

    const chartOptions = useMemo(() => createDynamicChartOptions(timeRange, 'dH/dt (nT/min)', chartData.datasets, { type: 'nzmag' }, annotations), [timeRange, chartData, annotations]);

    return (
        <div className="h-full flex flex-col">
            <TimeRangeButtons onSelect={setTimeRange} selected={timeRange} />
            <div className="flex-grow relative mt-2 min-h-[250px]">
                {loadingMessage ? <p className="text-center pt-10 text-neutral-400 italic">{loadingMessage}</p> : <Line data={chartData} options={chartOptions} plugins={[annotationPlugin]} />}
            </div>
        </div>
    );
};


export const MoonArcChart: React.FC<{ dailyCelestialHistory: DailyHistoryEntry[], owmDailyForecast: OwmDailyForecastEntry[] }> = ({ dailyCelestialHistory, owmDailyForecast }) => {
    const chartDataAndAnnotations = useMemo(() => {
        const now = Date.now();
        const end = now + 24 * 60 * 60 * 1000;
        const allEvents: { time: number, type: 'rise' | 'set' }[] = [];

        [...dailyCelestialHistory, ...owmDailyForecast].forEach(d => {
            const moon = 'moon_phase' in d ? { rise: d.moonrise * 1000, set: d.moonset * 1000 } : d.moon;
            if (moon?.rise) allEvents.push({ time: moon.rise, type: 'rise' });
            if (moon?.set) allEvents.push({ time: moon.set, type: 'set' });
        });
        
        const uniqueEvents = Array.from(new Map(allEvents.map(e => [e.time, e])).values());
        uniqueEvents.sort((a, b) => a.time - b.time);

        const lastEventBeforeStart = uniqueEvents.slice().reverse().find(e => e.time <= now);
        let isUp = lastEventBeforeStart?.type === 'rise';

        const relevantEvents = uniqueEvents.filter(e => e.time >= now && e.time <= end);
        if (!relevantEvents.length && lastEventBeforeStart) {
            const nextEvent = uniqueEvents.find(e => e.time > lastEventBeforeStart.time);
            if (nextEvent) relevantEvents.unshift(nextEvent);
        }
        if (lastEventBeforeStart) relevantEvents.unshift(lastEventBeforeStart);
        
        const dataPoints = [];
        const annotations: any = {
            horizon: { type: 'line', yMin: 0, yMax: 0, borderColor: 'rgba(100, 116, 139, 0.8)', borderWidth: 2 }
        };

        let lastRise = isUp ? lastEventBeforeStart?.time : uniqueEvents.slice().reverse().find(e => e.type === 'rise' && e.time <= now)?.time;
        let nextSet = uniqueEvents.find(e => e.type === 'set' && e.time >= now)?.time;
        
        for (let t = now; t <= end; t += 15 * 60 * 1000) {
            const currentEvent = uniqueEvents.slice().reverse().find(e => e.time <= t);
            if (currentEvent?.type === 'rise') {
                const riseTime = currentEvent.time;
                const setTime = uniqueEvents.find(e => e.type === 'set' && e.time > riseTime)?.time;
                if (setTime && t <= setTime) {
                    const duration = setTime - riseTime;
                    const progress = (t - riseTime) / duration;
                    dataPoints.push({ x: t, y: Math.sin(progress * Math.PI) * 90 });
                } else {
                    dataPoints.push({ x: t, y: 0 });
                }
            } else { // Moon is down
                dataPoints.push({ x: t, y: 0 });
            }
        }
        
        relevantEvents.forEach(event => {
            if(event.time >= now && event.time <= end) {
                annotations[event.time] = { type: 'line', xMin: event.time, xMax: event.time, borderColor: 'rgba(203, 213, 225, 0.5)', borderWidth: 1, borderDash: [5,5], label: { content: `${event.type === 'rise' ? 'Rise' : 'Set'} @ ${new Date(event.time).toLocaleTimeString('en-NZ', {hour:'2-digit', minute: '2-digit'})}`, display: true, position: 'start', font: {size: 10}, color: '#e2e8f0' }};
            }
        });
        
        const datasets = [{
            label: 'Moon Altitude',
            data: dataPoints,
            borderColor: 'rgb(203, 213, 225)',
            backgroundColor: 'rgba(203, 213, 225, 0.2)',
            fill: { target: 'origin', above: 'rgba(203, 213, 225, 0.2)'},
            pointRadius: 0,
            tension: 0.4
        }];
        
        return { datasets, annotations };

    }, [dailyCelestialHistory, owmDailyForecast]);

    const chartOptions = useMemo((): ChartOptions<'line'> => ({
        responsive: true, maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: { enabled: false },
            annotation: { annotations: chartDataAndAnnotations.annotations }
        },
        scales: {
            x: { type: 'time', min: Date.now(), max: Date.now() + 24 * 60 * 60 * 1000, ticks: { color: '#71717a', source: 'auto', stepSize: 3, unit: 'hour' }, grid: { color: '#3f3f46' } },
            y: { min: 0, max: 100, display: false }
        }
    }), [chartDataAndAnnotations.annotations]);
    
    return (
        <div className="h-full flex flex-col min-h-[150px]">
             <div className="flex-grow relative mt-2">
                 <Line data={chartDataAndAnnotations} options={chartOptions} plugins={[annotationPlugin]} />
             </div>
        </div>
    );
};

// --- NEW SimpleTrendChart component ---
export const SimpleTrendChart: React.FC<{ auroraScoreHistory: { timestamp: number; finalScore: number }[] }> = ({ auroraScoreHistory }) => {
    const timeRange = 3 * 3600 * 1000; // Fixed 3 hours

    const chartData = useMemo(() => {
        if (auroraScoreHistory.length === 0) return { datasets: [] };
        
        const getForecastGradient = (ctx: ScriptableContext<'line'>) => {
            const chart = ctx.chart; const { ctx: chartCtx, chartArea } = chart; if (!chartArea) return undefined;
            const gradient = chartCtx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
            const color0 = getSmoothForecastScoreColor(ctx.p0?.parsed?.y ?? 0, 0.33); const color1 = getSmoothForecastScoreColor(ctx.p1?.parsed?.y ?? 0, 0.33);
            gradient.addColorStop(0, color0); gradient.addColorStop(1, color1); return gradient;
        };

        return {
            datasets: [{
                label: 'Spot The Aurora Forecast',
                data: auroraScoreHistory.map(d => ({ x: d.timestamp, y: d.finalScore })),
                borderColor: getSmoothForecastScoreColor(auroraScoreHistory.at(-1)?.finalScore ?? 0),
                backgroundColor: getForecastGradient,
                fill: 'origin',
                tension: 0.2,
                pointRadius: 0,
                borderWidth: 1.5,
                spanGaps: true,
            }]
        };
    }, [auroraScoreHistory]);

    const chartOptions = useMemo((): ChartOptions<'line'> => ({
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false, axis: 'x' },
        plugins: {
            legend: { display: false },
            tooltip: {
                callbacks: {
                    title: (ctx) => ctx.length > 0 ? `Time: ${new Date(ctx[0].parsed.x).toLocaleTimeString('en-NZ')}` : '',
                    label: (ctx) => `${ctx.dataset.label || ''}: ${ctx.parsed.y.toFixed(1)}%`
                }
            },
        },
        scales: {
            x: {
                type: 'time',
                min: Date.now() - timeRange,
                max: Date.now(),
                ticks: { color: '#71717a', source: 'auto' },
                grid: { color: '#3f3f46' }
            },
            y: {
                type: 'linear',
                min: 0,
                max: 100,
                ticks: { color: '#71717a', callback: (v: any) => `${v}%` },
                grid: { color: '#3f3f46' },
            }
        }
    }), [timeRange]);

    return (
        <div className="col-span-12 card bg-neutral-950/80 p-4 h-[300px] flex flex-col">
            <h2 className="text-xl font-semibold text-white text-center mb-4">Forecast Trend (Last 3 Hours)</h2>
            <div className="flex-grow relative">
                {auroraScoreHistory.length > 0 ? (
                    <Line data={chartData} options={chartOptions} />
                ) : (
                    <p className="text-center pt-10 text-neutral-400 italic">No historical data.</p>
                )}
            </div>
        </div>
    );
};


interface ForecastTrendChartProps {
    auroraScoreHistory: { timestamp: number; baseScore: number; finalScore: number; }[];
    dailyCelestialHistory: DailyHistoryEntry[];
    owmDailyForecast: OwmDailyForecastEntry[];
    onOpenModal: () => void;
}
export const ForecastTrendChart: React.FC<ForecastTrendChartProps> = ({ auroraScoreHistory, dailyCelestialHistory, owmDailyForecast, onOpenModal }) => {
    const [timeRange, setTimeRange] = useState(6 * 3600000);
    const [timeLabel, setTimeLabel] = useState('6 Hr');
    const [showAnnotations, setShowAnnotations] = useState(true);

    const chartAnnotations = useMemo(() => {
        const annotations: any = {}; if (!showAnnotations) return annotations;
        const now = Date.now(); const startTime = now - timeRange;
        const formatTime = (ts: number) => new Date(ts).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
        const addAnnotation = (key: string, ts: number | null | undefined, text: string, emoji: string, color: string, pos: 'start' | 'end') => { if (ts && ts > startTime && ts < now) annotations[`${key}-${ts}`] = { type: 'line', xMin: ts, xMax: ts, borderColor: color.replace(/, 1\)/, ', 0.7)'), borderWidth: 1.5, borderDash: [6, 6], label: { content: `${emoji} ${text}: ${formatTime(ts)}`, display: true, position: pos, color, font: { size: 10, weight: 'bold' }, backgroundColor: 'rgba(10, 10, 10, 0.7)', padding: 3, borderRadius: 3 } }; };
        dailyCelestialHistory.forEach(day => { if (day.sun) { addAnnotation('sunrise', day.sun.rise, 'Sunrise', '☀️', '#fcd34d', 'start'); addAnnotation('sunset', day.sun.set, 'Sunset', '☀️', '#fcd34d', 'end'); } if (day.moon) { addAnnotation('moonrise', day.moon.rise, 'Moonrise', '🌕', '#d1d5db', 'start'); addAnnotation('moonset', day.moon.set, 'Moonset', '🌕', '#d1d5db', 'end'); } });
        owmDailyForecast.forEach(day => { if (day.sunrise) addAnnotation('owm-sr-' + day.dt, day.sunrise * 1000, 'Sunrise', '☀️', '#fcd34d', 'start'); if (day.sunset) addAnnotation('owm-ss-' + day.dt, day.sunset * 1000, 'Sunset', '☀️', '#fcd34d', 'end'); if (day.moonrise) addAnnotation('owm-mr-' + day.dt, day.moonrise * 1000, 'Moonrise', '🌕', '#d1d5db', 'start'); if (day.moonset) addAnnotation('owm-ms-' + day.dt, day.moonset * 1000, 'Moonset', '🌕', '#d1d5db', 'end'); });
        return annotations;
    }, [timeRange, dailyCelestialHistory, owmDailyForecast, showAnnotations]);
    
    const chartOptions = useMemo((): ChartOptions<'line'> => ({ responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false, axis: 'x' }, plugins: { legend: { labels: { color: '#a1a1aa' }}, tooltip: { callbacks: { title: (ctx) => ctx.length > 0 ? `Time: ${new Date(ctx[0].parsed.x).toLocaleTimeString('en-NZ')}` : '', label: (ctx) => `${ctx.dataset.label || ''}: ${ctx.parsed.y.toFixed(1)}%` }}, annotation: { annotations: chartAnnotations, drawTime: 'afterDatasetsDraw' } }, scales: { x: { type: 'time', min: Date.now() - timeRange, max: Date.now(), ticks: { color: '#71717a', source: 'auto' }, grid: { color: '#3f3f46' } }, y: { type: 'linear', min: 0, max: 100, ticks: { color: '#71717a', callback: (v: any) => `${v}%` }, grid: { color: '#3f3f46' }, title: { display: true, text: 'Aurora Score (%)', color: '#a3a3a3' } } } }), [timeRange, chartAnnotations]);
    
    const chartData = useMemo(() => {
        if (auroraScoreHistory.length === 0) return { datasets: [] };
        const getForecastGradient = (ctx: ScriptableContext<'line'>) => {
            const chart = ctx.chart; const { ctx: chartCtx, chartArea } = chart; if (!chartArea) return undefined;
            const gradient = chartCtx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
            const color0 = getSmoothForecastScoreColor(ctx.p0?.parsed?.y ?? 0, 0.33); const color1 = getSmoothForecastScoreColor(ctx.p1?.parsed?.y ?? 0, 0.33);
            gradient.addColorStop(0, color0); gradient.addColorStop(1, color1); return gradient;
        };
        return { datasets: [ { label: 'Spot The Aurora Forecast', data: auroraScoreHistory.map(d => ({ x: d.timestamp, y: d.finalScore })), borderColor: getSmoothForecastScoreColor(auroraScoreHistory.at(-1)?.finalScore ?? 0), backgroundColor: getForecastGradient, fill: 'origin', tension: 0.2, pointRadius: 0, borderWidth: 1.5, spanGaps: true, order: 1 }, { label: 'Base Score', data: auroraScoreHistory.map(d => ({ x: d.timestamp, y: d.baseScore })), borderColor: 'rgba(255, 255, 255, 1)', backgroundColor: 'transparent', fill: false, tension: 0.2, pointRadius: 0, borderWidth: 1, borderDash: [5, 5], spanGaps: true, order: 2 } ] };
    }, [auroraScoreHistory]);

    return (
        <div className="col-span-12 card bg-neutral-950/80 p-4 h-[400px] flex flex-col">
            <div className="flex justify-center items-center gap-2 mb-2">
                <h2 className="text-xl font-semibold text-white text-center">Forecast Trend (Last {timeLabel})</h2>
                <button onClick={onOpenModal} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button>
            </div>
            <div className="flex justify-between items-center mb-2">
                <TimeRangeButtons onSelect={(d, l) => { setTimeRange(d); setTimeLabel(l); }} selected={timeRange} />
                <ToggleSwitch label="Moon/Sun Data" checked={showAnnotations} onChange={setShowAnnotations} />
            </div>
            <div className="flex-grow relative mt-2">
                {auroraScoreHistory.length > 0 ? <Line data={chartData} options={chartOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">No historical data.</p>}
            </div>
        </div>
    );
};
// --- END OF FILE src/components/ForecastCharts.tsx ---
