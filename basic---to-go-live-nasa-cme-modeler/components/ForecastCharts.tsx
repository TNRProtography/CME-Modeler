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

const getPositiveScaleColorKey = (value: number, thresholds: { [key: string]: number }) => {
    if (value >= thresholds.purple) return 'purple'; if (value >= thresholds.red) return 'red';
    if (value >= thresholds.orange) return 'orange'; if (value >= thresholds.yellow) return 'yellow';
    return 'gray';
};

const getBzScaleColorKey = (value: number, thresholds: { [key: string]: number }) => {
    if (value <= thresholds.purple) return 'purple'; if (value <= thresholds.red) return 'red';
    if (value <= thresholds.orange) return 'orange'; if (value <= thresholds.yellow) return 'yellow';
    return 'gray';
};

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
    scaleConfig: { type: 'speed' | 'density' | 'imf' | 'power' | 'substorm' | 'nzmag' },
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
    const chartData = useMemo(() => ({ datasets: [{ label: 'Speed', data: data, yAxisID: 'y', fill: 'origin', borderWidth: 1.5, pointRadius: 0, tension: 0.2, segment: { borderColor: (ctx: ScriptableContext<'line'>) => GAUGE_COLORS[getPositiveScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.speed)].solid }, backgroundColor: (ctx: ScriptableContext<'line'>) => createVerticalThresholdGradient(ctx, GAUGE_THRESHOLDS.speed, false) }] }), [data]);
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
    const chartData = useMemo(() => ({ datasets: [{ label: 'Density', data: data, yAxisID: 'y', fill: 'origin', borderWidth: 1.5, pointRadius: 0, tension: 0.2, segment: { borderColor: (ctx: ScriptableContext<'line'>) => GAUGE_COLORS[getPositiveScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.density)].solid }, backgroundColor: (ctx: ScriptableContext<'line'>) => createVerticalThresholdGradient(ctx, GAUGE_THRESHOLDS.density, false) }] }), [data]);
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

export const MagneticFieldChart: React.FC<{ data: any[] }> = ({ data }) => {
    const [timeRange, setTimeRange] = useState(6 * 3600000);
    const chartData = useMemo(() => ({ datasets: [ { label: 'Bt', data: data.map(p => ({ x: p.time, y: p.bt })), order: 1, fill: 'origin', borderWidth: 1.5, pointRadius: 0, tension: 0.2, segment: { borderColor: (ctx: ScriptableContext<'line'>) => GAUGE_COLORS[getPositiveScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.bt)].solid }, backgroundColor: (ctx: ScriptableContext<'line'>) => createVerticalThresholdGradient(ctx, GAUGE_THRESHOLDS.bt, false) }, { label: 'Bz', data: data.map(p => ({ x: p.time, y: p.bz })), order: 0, fill: 'origin', borderWidth: 1.5, pointRadius: 0, tension: 0.2, segment: { borderColor: (ctx: ScriptableContext<'line'>) => GAUGE_COLORS[getBzScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.bz)].solid }, backgroundColor: (ctx: ScriptableContext<'line'>) => createVerticalThresholdGradient(ctx, GAUGE_THRESHOLDS.bz, true) } ] }), [data]);
    const chartOptions = useMemo(() => createDynamicChartOptions(timeRange, 'Magnetic Field (nT)', chartData.datasets, { type: 'imf' }), [timeRange, chartData]);

    return (
        <div className="h-full flex flex-col">
            <TimeRangeButtons onSelect={setTimeRange} selected={timeRange} />
            <div className="flex-grow relative mt-2 min-h-[250px]">
                {data.length > 0 ? <Line data={chartData} options={chartOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">Data unavailable.</p>}
            </div>
        </div>
    );
};

export const HemisphericPowerChart: React.FC<{ data: any[] }> = ({ data }) => {
    const [timeRange, setTimeRange] = useState(6 * 3600000);
    const chartData = useMemo(() => ({ datasets: [{ label: 'Hemispheric Power', data: data, borderColor: (ctx: ScriptableContext<'line'>) => GAUGE_COLORS[getPositiveScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.power)].solid, backgroundColor: (ctx: ScriptableContext<'line'>) => createVerticalThresholdGradient(ctx, GAUGE_THRESHOLDS.power, false), fill: 'origin', tension: 0.2, pointRadius: 0, borderWidth: 1.5, spanGaps: true }] }), [data]);
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
            const colorKey0 = getForecastScoreColorKey(ctx.p0?.parsed?.y ?? 0); const colorKey1 = getForecastScoreColorKey(ctx.p1?.parsed?.y ?? 0);
            gradient.addColorStop(0, GAUGE_COLORS[colorKey0].semi); gradient.addColorStop(1, GAUGE_COLORS[colorKey1].semi); return gradient;
        };

        return {
            datasets: [{
                label: 'Spot The Aurora Forecast',
                data: auroraScoreHistory.map(d => ({ x: d.timestamp, y: d.finalScore })),
                borderColor: (ctx: ScriptableContext<'line'>) => GAUGE_COLORS[getForecastScoreColorKey(ctx.p1?.parsed?.y ?? 0)].solid,
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
            const colorKey0 = getForecastScoreColorKey(ctx.p0?.parsed?.y ?? 0); const colorKey1 = getForecastScoreColorKey(ctx.p1?.parsed?.y ?? 0);
            gradient.addColorStop(0, GAUGE_COLORS[colorKey0].semi); gradient.addColorStop(1, GAUGE_COLORS[colorKey1].semi); return gradient;
        };
        return { datasets: [ { label: 'Spot The Aurora Forecast', data: auroraScoreHistory.map(d => ({ x: d.timestamp, y: d.finalScore })), borderColor: (ctx: ScriptableContext<'line'>) => GAUGE_COLORS[getForecastScoreColorKey(ctx.p1?.parsed?.y ?? 0)].solid, backgroundColor: getForecastGradient, fill: 'origin', tension: 0.2, pointRadius: 0, borderWidth: 1.5, spanGaps: true, order: 1 }, { label: 'Base Score', data: auroraScoreHistory.map(d => ({ x: d.timestamp, y: d.baseScore })), borderColor: 'rgba(255, 255, 255, 1)', backgroundColor: 'transparent', fill: false, tension: 0.2, pointRadius: 0, borderWidth: 1, borderDash: [5, 5], spanGaps: true, order: 2 } ] };
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