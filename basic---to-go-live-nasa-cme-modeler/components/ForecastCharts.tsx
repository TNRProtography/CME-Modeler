// --- START OF FILE src/components/ForecastCharts.tsx ---

import React, { useState, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import annotationPlugin from 'chartjs-plugin-annotation';
import { ChartOptions, ScriptableContext } from 'chart.js';
import CaretIcon from './icons/CaretIcon';
import ToggleSwitch from './ToggleSwitch';
import { DailyHistoryEntry, OwmDailyForecastEntry } from '../types';

// --- CONSTANTS & HELPERS (from ForecastDashboard) ---
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

const getForecastScoreColorKey = (score: number): keyof typeof GAUGE_COLORS => {
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

const createChartOptions = (rangeMs: number, yLabel: string, showLegend: boolean = false, extraAnnotations?: any, isLog: boolean = false): ChartOptions<'line'> => {
    const now = Date.now();
    const startTime = now - rangeMs;
    const options: ChartOptions<'line'> = {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false, axis: 'x' },
        plugins: { legend: { display: showLegend, labels: {color: '#a1a1aa'} }, tooltip: { mode: 'index', intersect: false } },
        scales: { 
            x: { type: 'time', min: startTime, max: now, ticks: { color: '#71717a', source: 'auto' }, grid: { color: '#3f3f46' } },
            y: { type: isLog ? 'logarithmic' : 'linear', position: 'left', ticks: { color: '#a3a3a3' }, grid: { color: '#3f3f46' }, title: { display: true, text: yLabel, color: '#a3a3a3' } }
        }
    };
    if (extraAnnotations) {
        options.plugins = { ...options.plugins, annotation: { annotations: extraAnnotations } };
    }
    return options;
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

// --- CHART COMPONENTS ---

interface ExpandedGraphContentProps {
    graphId: string;
    solarWindTimeRange: number; setSolarWindTimeRange: (d: number, l: string) => void; solarWindTimeLabel: string;
    magneticFieldTimeRange: number; setMagneticFieldTimeRange: (d: number, l: string) => void; magneticFieldTimeLabel: string;
    hemisphericPowerChartTimeRange: number; setHemisphericPowerChartTimeRange: (d: number, l: string) => void; hemisphericPowerChartTimeLabel: string;
    magnetometerTimeRange: number; setMagnetometerTimeRange: (d: number, l: string) => void; magnetometerTimeLabel: string;
    openModal: (id: string) => void;
    allSpeedData: any[]; allDensityData: any[]; allMagneticData: any[]; hemisphericPowerHistory: any[];
    goes18Data: any[]; goes19Data: any[]; loadingMagnetometer: string | null; substormBlurb: { text: string; color: string };
    getMagnetometerAnnotations: (data: any[]) => any;
}

export const ExpandedGraphContent: React.FC<ExpandedGraphContentProps> = React.memo(({
    graphId,
    solarWindTimeRange, setSolarWindTimeRange,
    magneticFieldTimeRange, setMagneticFieldTimeRange,
    hemisphericPowerChartTimeRange, setHemisphericPowerChartTimeRange,
    magnetometerTimeRange, setMagnetometerTimeRange,
    openModal,
    allSpeedData, allDensityData, allMagneticData, hemisphericPowerHistory,
    goes18Data, goes19Data, loadingMagnetometer, substormBlurb, getMagnetometerAnnotations
}) => {
    const CHART_HEIGHT = 'h-[calc(100%-100px)]';

    const speedChartData = useMemo(() => ({ datasets: [{ label: 'Speed', data: allSpeedData, yAxisID: 'y', order: 1, fill: 'origin', borderWidth: 1.5, pointRadius: 0, tension: 0.2, segment: { borderColor: (ctx: ScriptableContext<'line'>) => GAUGE_COLORS[getPositiveScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.speed)].solid }, backgroundColor: (ctx: ScriptableContext<'line'>) => createVerticalThresholdGradient(ctx, GAUGE_THRESHOLDS.speed, false) }] }), [allSpeedData]);
    const densityChartData = useMemo(() => ({ datasets: [{ label: 'Density', data: allDensityData, yAxisID: 'y', order: 0, fill: 'origin', borderWidth: 1.5, pointRadius: 0, tension: 0.2, segment: { borderColor: (ctx: ScriptableContext<'line'>) => GAUGE_COLORS[getPositiveScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.density)].solid }, backgroundColor: (ctx: ScriptableContext<'line'>) => createVerticalThresholdGradient(ctx, GAUGE_THRESHOLDS.density, false) }] }), [allDensityData]);
    const magneticFieldChartData = useMemo(() => ({ datasets: [ { label: 'Bt', data: allMagneticData.map(p => ({ x: p.time, y: p.bt })), order: 1, fill: 'origin', borderWidth: 1.5, pointRadius: 0, tension: 0.2, segment: { borderColor: (ctx: ScriptableContext<'line'>) => GAUGE_COLORS[getPositiveScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.bt)].solid }, backgroundColor: (ctx: ScriptableContext<'line'>) => createVerticalThresholdGradient(ctx, GAUGE_THRESHOLDS.bt, false) }, { label: 'Bz', data: allMagneticData.map(p => ({ x: p.time, y: p.bz })), order: 0, fill: 'origin', borderWidth: 1.5, pointRadius: 0, tension: 0.2, segment: { borderColor: (ctx: ScriptableContext<'line'>) => GAUGE_COLORS[getBzScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.bz)].solid }, backgroundColor: (ctx: ScriptableContext<'line'>) => createVerticalThresholdGradient(ctx, GAUGE_THRESHOLDS.bz, true) } ] }), [allMagneticData]);
    const hemisphericPowerChartData = useMemo(() => ({ datasets: [{ label: 'Hemispheric Power', data: hemisphericPowerHistory.map(d => ({ x: d.timestamp, y: d.hemisphericPower })), borderColor: (ctx: ScriptableContext<'line'>) => GAUGE_COLORS[getPositiveScaleColorKey(ctx.p1?.parsed?.y ?? 0, GAUGE_THRESHOLDS.power)].solid, backgroundColor: (ctx: ScriptableContext<'line'>) => createVerticalThresholdGradient(ctx, GAUGE_THRESHOLDS.power, false), fill: 'origin', tension: 0.2, pointRadius: 0, borderWidth: 1.5, spanGaps: true, order: 1 }] }), [hemisphericPowerHistory]);
    const magnetometerChartData = useMemo(() => ({ datasets: [ { label: 'GOES-18 (Primary)', data: goes18Data.map(p => ({ x: p.time, y: p.hp })), borderColor: 'rgb(56, 189, 248)', backgroundColor: 'transparent', pointRadius: 0, tension: 0.1, borderWidth: 1.5, fill: false }, { label: 'GOES-19 (Secondary)', data: goes19Data.map(p => ({ x: p.time, y: p.hp })), borderColor: 'rgb(255, 69, 0)', backgroundColor: 'transparent', pointRadius: 0, tension: 0.1, borderWidth: 1.5, fill: false } ] }), [goes18Data, goes19Data]);
    
    const speedChartOptions = useMemo(() => createChartOptions(solarWindTimeRange, 'Speed (km/s)'), [solarWindTimeRange]);
    const densityChartOptions = useMemo(() => createChartOptions(solarWindTimeRange, 'Density (p/cm³)'), [solarWindTimeRange]);
    const magneticFieldOptions = useMemo(() => createChartOptions(magneticFieldTimeRange, 'Magnetic Field (nT)'), [magneticFieldTimeRange]);
    const hemisphericPowerChartOptions = useMemo(() => createChartOptions(hemisphericPowerChartTimeRange, 'Hemispheric Power (GW)'), [hemisphericPowerChartTimeRange]);
    
    // --- THIS IS THE FIX ---
    const magnetometerAnnotations = useMemo(() => getMagnetometerAnnotations(goes18Data), [goes18Data, getMagnetometerAnnotations]);
    const magnetometerOptions = useMemo(() => createChartOptions(magnetometerTimeRange, 'Hp (nT)', true, magnetometerAnnotations), [magnetometerTimeRange, magnetometerAnnotations]);

    switch (graphId) {
        case 'speed-graph-container': return ( <> <div className="flex justify-center items-center gap-2"> <h2 className="text-xl font-semibold text-white text-center">Live Solar Wind Speed</h2> <button onClick={(e) => { e.stopPropagation(); openModal('solar-wind-graph'); }} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button> </div> <TimeRangeButtons onSelect={setSolarWindTimeRange} selected={solarWindTimeRange} /> <div className={`flex-grow relative mt-2 ${CHART_HEIGHT}`}> {allSpeedData.length > 0 ? <Line data={speedChartData} options={speedChartOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">Data unavailable.</p>} </div> </> );
        case 'density-graph-container': return ( <> <div className="flex justify-center items-center gap-2"> <h2 className="text-xl font-semibold text-white text-center">Live Solar Wind Density</h2> <button onClick={(e) => { e.stopPropagation(); openModal('solar-wind-graph'); }} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button> </div> <TimeRangeButtons onSelect={setSolarWindTimeRange} selected={solarWindTimeRange} /> <div className={`flex-grow relative mt-2 ${CHART_HEIGHT}`}> {allDensityData.length > 0 ? <Line data={densityChartData} options={densityChartOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">Data unavailable.</p>} </div> </> );
        case 'imf-graph-container': return ( <> <div className="flex justify-center items-center gap-2"> <h2 className="text-xl font-semibold text-white text-center">Live Interplanetary Magnetic Field</h2> <button onClick={(e) => { e.stopPropagation(); openModal('imf-graph'); }} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button> </div> <TimeRangeButtons onSelect={setMagneticFieldTimeRange} selected={magneticFieldTimeRange} /> <div className={`flex-grow relative mt-2 ${CHART_HEIGHT}`}> {allMagneticData.length > 0 ? <Line data={magneticFieldChartData} options={magneticFieldOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">Data unavailable.</p>} </div> </> );
        case 'hemispheric-power-graph-container': return ( <> <div className="flex justify-center items-center gap-2"> <h2 className="text-xl font-semibold text-white text-center">Hemispheric Power Trend</h2> <button onClick={(e) => { e.stopPropagation(); openModal('hemispheric-power-graph'); }} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button> </div> <TimeRangeButtons onSelect={setHemisphericPowerChartTimeRange} selected={hemisphericPowerChartTimeRange} /> <div className={`flex-grow relative mt-2 ${CHART_HEIGHT}`}> {hemisphericPowerHistory.length > 0 ? <Line data={hemisphericPowerChartData} options={hemisphericPowerChartOptions} /> : <p className="text-center pt-10 text-neutral-400 italic">Data unavailable.</p>} </div> </> );
        case 'goes-mag-graph-container': return ( <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full"> <div className="lg:col-span-2 h-full flex flex-col"> <div className="flex justify-center items-center gap-2"> <h2 className="text-xl font-semibold text-white text-center">GOES Magnetometer (Substorm Watch)</h2> <button onClick={(e) => { e.stopPropagation(); openModal('goes-mag'); }} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button> </div> <TimeRangeButtons onSelect={setMagnetometerTimeRange} selected={magnetometerTimeRange} /> <div className={`flex-grow relative mt-2 ${CHART_HEIGHT}`}> {loadingMagnetometer ? <p className="text-center pt-10 text-neutral-400 italic">{loadingMagnetometer}</p> : <Line data={magnetometerChartData} options={magnetometerOptions} plugins={[annotationPlugin]} />} </div> </div> <div className="lg:col-span-1 flex flex-col justify-center items-center bg-neutral-900/50 p-4 rounded-lg h-full"> <h3 className="text-lg font-semibold text-neutral-200 mb-2">Magnetic Field Analysis</h3> <p className={`text-center text-lg ${substormBlurb.color}`}>{substormBlurb.text}</p> </div> </div> );
        default: return null;
    }
});

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