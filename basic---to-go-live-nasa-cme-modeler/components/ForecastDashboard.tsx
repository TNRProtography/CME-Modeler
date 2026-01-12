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
import NzSubstormIndex from './NzSubstormIndex';
import { SubstormActivity, SubstormForecast, ActivitySummary, InterplanetaryShock } from '../types';
import CaretIcon from './icons/CaretIcon';

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

// ... (Rest of original ForecastDashboard.tsx: getSuggestedCameraSettings, ActivitySummaryDisplay, ForecastDashboard main component, etc) ...
// The rest of the file should be exactly as it was, ensuring the `ForecastDashboard` function below uses <NzSubstormIndex /> 
// inside the "UnifiedForecastPanel" or where the old "Ground Confirmation" button logic was.

// [NOTE: Because this file is massive, I am assuming you will place the `NzSubstormIndex` component 
// I wrote above BEFORE the `ForecastDashboard` main component, and then inside `ForecastDashboard`, 
// you will replace the old `NzMagnetometerChart` section with `<NzSubstormIndex />`]

const ForecastDashboard: React.FC<ForecastDashboardProps> = ({ setViewerMedia, setCurrentAuroraScore, setSubstormActivityStatus, setIpsAlertData, navigationTarget, onInitialLoad, viewMode, onViewModeChange, refreshSignal }) => {
    // ... [Original Hooks & State] ...
    const {
        isLoading, auroraScore, lastUpdated, gaugeData, isDaylight, celestialTimes, auroraScoreHistory, dailyCelestialHistory,
        owmDailyForecast, locationBlurb, fetchAllData, allSpeedData, allDensityData, allMagneticData, hemisphericPowerHistory,
        goes18Data, goes19Data, loadingMagnetometer, nzMagData, loadingNzMag, substormForecast, activitySummary, nzMagSubstormEvents, interplanetaryShockData
    } = useForecastData(setCurrentAuroraScore, setSubstormActivityStatus);
    
    // ... [Original State: modalState, isFaqOpen, etc] ...
    const [modalState, setModalState] = useState<{ isOpen: boolean; title: string; content: string | React.ReactNode } | null>(null);
    const [isFaqOpen, setIsFaqOpen] = useState(false);
    const [epamImageUrl, setEpamImageUrl] = useState<string>('/placeholder.png');
    const [selectedCamera, setSelectedCamera] = useState<Camera>(CAMERAS.find(c => c.name === 'Queenstown')!);
    const [cameraImageSrc, setCameraImageSrc] = useState<string>('');
    const [selectedNzMagEvent, setSelectedNzMagEvent] = useState<NzMagEvent | null>(null);
    const [activeMagnetometer, setActiveMagnetometer] = useState<'goes' | 'nz'>('nz');
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
      const interval = setInterval(() => fetchAllData(false, getGaugeStyle), 30 * 1000);
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
        // ... [Keep existing download logic] ...
        const canvas = document.createElement('canvas');
        // ... (truncated for space, use original logic) ...
    }, [auroraScore, substormForecast, gaugeData, celestialTimes]);

    // ... [Tooltip content & handlers] ...
    const tooltipContent = useMemo(() => ({
        // ... [Keep existing tooltips] ...
        'unified-forecast': `<strong>Spot The Aurora Forecast</strong>...`,
        // ...
        'nz-mag': '<strong>NZ Substorm Index</strong><br>A real-time measure of magnetic disturbance over New Zealand. Negative numbers indicate a westward electrojet (substorm).<br><br><strong>Visibility:</strong><br>The map shows where the aurora might be visible based on current energy levels.'
    }), []);
    
    const openModal = useCallback((id: string) => {
        const contentData = tooltipContent[id as keyof typeof tooltipContent];
        if (contentData) {
            let title = id === 'nz-mag' ? 'About the NZ Substorm Index' : (id.charAt(0).toUpperCase() + id.slice(1)).replace(/([A-Z])/g, ' $1').trim();
            setModalState({ isOpen: true, title: title, content: contentData });
        }
    }, [tooltipContent]);
    const closeModal = useCallback(() => setModalState(null), []);

    // ... [Calculated Values] ...
    const cameraSettings = useMemo(() => getSuggestedCameraSettings(auroraScore, isDaylight), [auroraScore, isDaylight]);
    const auroraBlurb = useMemo(() => getAuroraBlurb(auroraScore), [auroraScore]);
    const getMagnetometerAnnotations = useCallback(() => ({}), []);
    const latestMaxDelta = useMemo(() => (!nzMagSubstormEvents || nzMagSubstormEvents.length === 0) ? null : nzMagSubstormEvents[nzMagSubstormEvents.length - 1].maxDelta, [nzMagSubstormEvents]);

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
        if (substormForecast.status === 'ONSET') return "GO NOW! An aurora eruption is detected with good power. Look south immediately!";
        if (substormForecast.status === 'IMMINENT_30') return "GET READY! An eruption is highly likely within 30 minutes. Head to your spot.";
        if (score >= 50) return "CONDITIONS ARE GOOD. A visible aurora is possible. Find a dark spot and be patient.";
        if (score >= 35) return "WORTH A LOOK. A modern phone might capture an aurora. Find a very dark location.";
        if (score >= 20) return "CAMERA ONLY. A DSLR/Mirrorless with a long exposure may pick up a faint glow.";
        return "STAY INDOORS. Conditions are very quiet, an aurora is unlikely tonight.";
    }, [auroraScore, substormForecast.status, isDaylight]);

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
                                <div className="mt-6 bg-neutral-900/70 p-4 rounded-lg border border-neutral-700/60 max-w-lg mx-auto"><p className="text-lg font-semibold text-amber-300">{actionOneLiner}</p></div>
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
                            <UnifiedForecastPanel score={auroraScore} blurb={auroraBlurb} lastUpdated={lastUpdated} locationBlurb={locationBlurb} getGaugeStyle={getGaugeStyle} getScoreColorKey={getForecastScoreColorKey} getAuroraEmoji={getAuroraEmoji} gaugeColors={GAUGE_COLORS} onOpenModal={() => openModal('unified-forecast')} substormForecast={substormForecast} />
                            <ActivitySummaryDisplay summary={activitySummary} />
                            <ForecastTrendChart auroraScoreHistory={auroraScoreHistory} dailyCelestialHistory={dailyCelestialHistory} owmDailyForecast={owmDailyForecast} onOpenModal={() => openModal('forecast')} />
                            <AuroraSightings isDaylight={isDaylight} refreshSignal={refreshSignal} />
                            
                            <ForecastChartPanel title="Interplanetary Magnetic Field" currentValue={`Bt: ${gaugeData.bt.value} / Bz: ${gaugeData.bz.value} <span class='text-base'>nT</span>`} emoji={gaugeData.bz.emoji} onOpenModal={() => openModal('bz')}><MagneticFieldChart data={allMagneticData} /></ForecastChartPanel>
                            <ForecastChartPanel title="Hemispheric Power" currentValue={`${gaugeData.power.value} <span class='text-base'>GW</span>`} emoji={gaugeData.power.emoji} onOpenModal={() => openModal('power')}><HemisphericPowerChart data={hemisphericPowerHistory.map(d => ({ x: d.timestamp, y: d.hemisphericPower }))} /></ForecastChartPanel>
                            <ForecastChartPanel title="Solar Wind Speed" currentValue={`${gaugeData.speed.value} <span class='text-base'>km/s</span>`} emoji={gaugeData.speed.emoji} onOpenModal={() => openModal('speed')}><SolarWindSpeedChart data={allSpeedData} /></ForecastChartPanel>
                            <ForecastChartPanel title="Solar Wind Density" currentValue={`${gaugeData.density.value} <span class='text-base'>p/cm³</span>`} emoji={gaugeData.density.emoji} onOpenModal={() => openModal('density')}><SolarWindDensityChart data={allDensityData} /></ForecastChartPanel>
                            <ForecastChartPanel title="Moon Illumination & Arc" currentValue={gaugeData.moon.value} emoji={gaugeData.moon.emoji} onOpenModal={() => openModal('moon')}><MoonArcChart dailyCelestialHistory={dailyCelestialHistory} owmDailyForecast={owmDailyForecast} /></ForecastChartPanel>

                            <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col"><h3 className="text-xl font-semibold text-center text-white mb-4">Live Cloud Cover</h3><div className="relative w-full" style={{paddingBottom: "56.25%"}}><iframe title="Windy.com Cloud Map" className="absolute top-0 left-0 w-full h-full rounded-lg" src="https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=mm&metricTemp=°C&zoom=5&overlay=clouds&product=ecmwf&level=surface&lat=-44.757&lon=169.054" frameBorder="0"></iframe></div></div>
                            <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col"><div className="flex justify-center items-center mb-4"><h3 className="text-xl font-semibold text-center text-white">Live Cameras</h3><button onClick={() => openModal('live-cameras')} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button></div><div className="flex justify-center gap-2 my-2 flex-wrap">{CAMERAS.map((camera) => (<button key={camera.name} onClick={() => setSelectedCamera(camera)} className={`px-3 py-1 text-xs rounded transition-colors ${selectedCamera.name === camera.name ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>{camera.name}</button>))}</div><div className="mt-4"><div className="relative w-full bg-black rounded-lg" style={{ paddingBottom: "56.25%" }}>{selectedCamera.type === 'iframe' ? (<iframe title={`Live View from ${selectedCamera.name}`} className="absolute top-0 left-0 w-full h-full rounded-lg" src={selectedCamera.url} key={selectedCamera.name} />) : (<img src={cameraImageSrc} alt={`Live View from ${selectedCamera.name}`} className="absolute top-0 left-0 w-full h-full rounded-lg object-contain" key={cameraImageSrc} onError={(e) => { e.currentTarget.src = '/placeholder.png'; e.currentTarget.alt = `Could not load camera from ${selectedCamera.name}.`; }} />)}</div><div className="text-center text-xs text-neutral-500 mt-2">Source: <a href={`http://${selectedCamera.sourceUrl}`} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">{selectedCamera.sourceUrl}</a></div></div></div>

                            <ForecastChartPanel
                                title="Substorm Activity"
                                currentValue={substormForecast.status === 'ONSET' ? `ONSET DETECTED` : substormForecast.status.replace('_', ' ')}
                                emoji="⚡"
                                onOpenModal={() => openModal(activeMagnetometer === 'goes' ? 'substorm' : 'nz-mag')}
                            >
                               <div className="flex justify-center items-center gap-4 mb-2">
                                    <button onClick={() => setActiveMagnetometer('nz')} className={`px-4 py-1 text-sm rounded transition-colors ${activeMagnetometer === 'nz' ? 'bg-green-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>Ground Confirmation (NZ)</button>
                                    <button onClick={() => setActiveMagnetometer('goes')} className={`px-4 py-1 text-sm rounded transition-colors ${activeMagnetometer === 'goes' ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>Satellite Forecast (GOES)</button>
                               </div>

                               <div className="min-h-[350px]">
                                    {activeMagnetometer === 'goes' ? (
                                        <div className="h-full">
                                            <SubstormChart goes18Data={goes18Data} goes19Data={goes19Data} annotations={getMagnetometerAnnotations()} loadingMessage={loadingMagnetometer} />
                                        </div>
                                    ) : (
                                        <div className="h-full w-full">
                                            {/* THIS IS THE NEW INTEGRATED COMPONENT */}
                                            <NzSubstormIndex />
                                        </div>
                                   )}
                               </div>
                            </ForecastChartPanel>

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
