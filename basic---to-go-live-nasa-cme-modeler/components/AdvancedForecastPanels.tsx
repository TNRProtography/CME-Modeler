// The Advanced View's chart panels, one component each, so the forecast
// dashboard and the marketing site's live embeds render the same thing from
// the same code. Each takes the forecast data straight from useForecastData.

import React, { useMemo } from 'react';
import '../utils/chartSetup'; // registers Chart.js scales/plugins - must run before any <Line> renders
import ForecastChartPanel from './ForecastChartPanel';
import {
    SolarWindSpeedChart,
    SolarWindDensityChart,
    MagneticFieldChart,
    HemisphericPowerChart,
    MoonArcChart,
    SubstormIndexChart,
} from './ForecastCharts';
import type { useForecastData } from '../hooks/useForecastData';

export type ForecastData = ReturnType<typeof useForecastData>;

interface PanelProps {
    fc: ForecastData;
    openModal: (id: string) => void;
}

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

export const getGaugeStyle = (
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

export const getSatelliteSource = (source?: string) => source && source !== ' - ' ? source : undefined;

export const formatTimeHHMM = (timestamp: number | null | undefined): string => {
    if (!timestamp || !Number.isFinite(timestamp)) return ' - ';
    return new Date(timestamp).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false });
};

export const getLatestPointTime = (series: Array<{ x?: number; time?: number; timestamp?: number }>): number | null => {
    let latest: number | null = null;
    for (const point of series) {
        const t = point?.x ?? point?.time ?? point?.timestamp;
        if (typeof t === 'number' && Number.isFinite(t) && (latest === null || t > latest)) {
            latest = t;
        }
    }
    return latest;
};

export const ImfPanel: React.FC<PanelProps> = ({ fc, openModal }) => {
    const { gaugeData, allMagneticData } = fc;
    const lastReceived = useMemo(() => formatTimeHHMM(getLatestPointTime(allMagneticData.map((p: any) => ({ time: p.time })))), [allMagneticData]);
    return (
        <ForecastChartPanel
            title="Interplanetary Magnetic Field"
            currentValue={`Bt: ${gaugeData.bt.value} / Bz: ${gaugeData.bz.value} <span class='text-base'>nT</span><span class='text-xs block text-neutral-400'>Toggle Bx/By inside chart · Bt source: ${gaugeData.bt.source} · Bz source: ${gaugeData.bz.source}</span>`}
            emoji={gaugeData.bz.emoji}
            onOpenModal={() => openModal('bz')}
            satellite={getSatelliteSource(gaugeData.bt.source) || getSatelliteSource(gaugeData.bz.source)}
            lastDataReceived={lastReceived}
        >
            <MagneticFieldChart data={allMagneticData} />
        </ForecastChartPanel>
    );
};

export const HemisphericPowerPanel: React.FC<PanelProps> = ({ fc, openModal }) => {
    const { gaugeData, hemisphericPowerHistory } = fc;
    const lastReceived = useMemo(() => formatTimeHHMM(getLatestPointTime(hemisphericPowerHistory.map((p) => ({ timestamp: p.timestamp })))), [hemisphericPowerHistory]);
    return (
        <ForecastChartPanel title="Hemispheric Power" currentValue={`${gaugeData.power.value} <span class='text-base'>GW</span>`} emoji={gaugeData.power.emoji} onOpenModal={() => openModal('power')} lastDataReceived={lastReceived}>
            <HemisphericPowerChart data={hemisphericPowerHistory.map(d => ({ x: d.timestamp, y: d.hemisphericPower }))} />
        </ForecastChartPanel>
    );
};

export const SolarWindSpeedPanel: React.FC<PanelProps> = ({ fc, openModal }) => {
    const { gaugeData, allSpeedData } = fc;
    const lastReceived = useMemo(() => formatTimeHHMM(getLatestPointTime(allSpeedData)), [allSpeedData]);
    return (
        <ForecastChartPanel
            title="Solar Wind Speed"
            currentValue={`${gaugeData.speed.value} <span class='text-base'>km/s</span><span class='text-xs block text-neutral-400'>Source: ${gaugeData.speed.source}</span>`}
            emoji={gaugeData.speed.emoji}
            onOpenModal={() => openModal('speed')}
            satellite={getSatelliteSource(gaugeData.speed.source)}
            lastDataReceived={lastReceived}
        >
            <SolarWindSpeedChart data={allSpeedData} />
        </ForecastChartPanel>
    );
};

export const SolarWindDensityPanel: React.FC<PanelProps> = ({ fc, openModal }) => {
    const { gaugeData, allDensityData } = fc;
    const lastReceived = useMemo(() => formatTimeHHMM(getLatestPointTime(allDensityData)), [allDensityData]);
    return (
        <ForecastChartPanel
            title="Solar Wind Density"
            currentValue={`${gaugeData.density.value} <span class='text-base'>p/cm³</span><span class='text-xs block text-neutral-400'>Source: ${gaugeData.density.source}</span>`}
            emoji={gaugeData.density.emoji}
            onOpenModal={() => openModal('density')}
            satellite={getSatelliteSource(gaugeData.density.source)}
            lastDataReceived={lastReceived}
        >
            <SolarWindDensityChart data={allDensityData} />
        </ForecastChartPanel>
    );
};

export const MoonArcPanel: React.FC<PanelProps> = ({ fc, openModal }) => (
    <ForecastChartPanel title="Moon Illumination & Arc" currentValue={fc.gaugeData.moon.value} emoji={fc.gaugeData.moon.emoji} onOpenModal={() => openModal('moon')}>
        <MoonArcChart dailyCelestialHistory={fc.dailyCelestialHistory} owmDailyForecast={fc.owmDailyForecast} />
    </ForecastChartPanel>
);

export const SubstormIndexPanel: React.FC<PanelProps> = ({ fc, openModal }) => {
    const { substormRiskData } = fc;
    return (
        <ForecastChartPanel
            title="Substorm Index"
            currentValue={substormRiskData ? `${substormRiskData.current.score} <span class='text-base'>${substormRiskData.current.level}</span><span class='text-xs block text-neutral-400'>${substormRiskData.current.risk_trend}${substormRiskData.current.confidence != null ? ` · ${substormRiskData.current.confidence}% confidence` : ''}</span>` : ' - '}
            emoji={substormRiskData?.current?.bay_onset_flag ? '⚡' : substormRiskData?.current && substormRiskData.current.score >= 50 ? '🌌' : '📊'}
            onOpenModal={() => openModal('substorm-index')}
        >
            <SubstormIndexChart history={substormRiskData?.history_24h ?? []} />
        </ForecastChartPanel>
    );
};
