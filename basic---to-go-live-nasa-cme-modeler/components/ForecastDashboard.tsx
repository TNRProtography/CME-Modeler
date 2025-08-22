//--- START OF FILE src/components/ForecastDashboard.tsx ---

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import LoadingSpinner from './icons/LoadingSpinner';
import AuroraSightings from './AuroraSightings';
import GuideIcon from './icons/GuideIcon';
import { useForecastData } from '../hooks/useForecastData';
import GraphModal from './GraphModal'; // Import the new GraphModal
import { CombinedForecastPanel } from './CombinedForecastPanel';


import {
    DataGauges,
    TipsSection,
    CameraSettingsSection,
    InfoModal,
    ActivityAlert
} from './ForecastComponents';

import {
    ForecastTrendChart,
    ExpandedGraphContent
} from './ForecastCharts';
import { SubstormActivity, SubstormForecast } from '../types';

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
  { name: 'Oban', url: 'https://weathercam.southloop.net.nz/Oban/ObanLatest.jpg', type: 'image', sourceUrl: 'weathercam.southloop.net.nz' },
  { name: 'Queenstown', url: 'https://queenstown.roundshot.com/#/', type: 'iframe', sourceUrl: 'queenstown.roundshot.com' },
  { name: 'Twizel', url: 'https://www.trafficnz.info/camera/737.jpg', type: 'image', sourceUrl: 'trafficnz.info' },
  { name: 'Taylors Mistake', url: 'https://metdata.net.nz/lpc/cameras/taylorsmistake1/image.php', type: 'image', sourceUrl: 'metdata.net.nz' },
  { name: 'Opiki', url: 'https://www.horizons.govt.nz/HRC/media/Default/TCAmImages/OPKI-lastest_photo.jpg', type: 'image', sourceUrl: 'horizons.govt.nz' },
  { name: 'Rangitikei', url: 'https://www.horizons.govt.nz/HRC/media/Default/TCAmImages/RANG-lastest_photo.jpg', type: 'image', sourceUrl: 'horizons.govt.nz' },
  { name: 'New Plymouth', url: 'https://www.primo.nz/webcameras/fotor/waterfront/waterfront_twlbuilding_sth.jpg', type: 'image', sourceUrl: 'primo.nz' },
];

const GAUGE_THRESHOLDS = {
  speed:   { gray: 250, yellow: 350, orange: 500, red: 650, purple: 800, pink: Infinity, maxExpected: 1000 },
  density: { gray: 5,   yellow: 10,  orange: 15,  red: 20,  purple: 50,  pink: Infinity, maxExpected: 70 },
  power:   { gray: 20,  yellow: 40,  orange: 70,  red: 150, purple: 200, pink: Infinity, maxExpected: 250 },
  bt:      { gray: 5,   yellow: 10,  orange: 15,  red: 20,  purple: 50,  pink: Infinity, maxExpected: 80 },
  bz:      { gray: 1,   yellow: -2,  orange: -5,  red: -10, purple: -15, pink: -20,      maxExpected: -25 },
};

const GAUGE_COLORS = {
  gray:   { solid: '#9CA3AF' },
  yellow: { solid: '#FACC15' },
  orange: { solid: '#F97316' },
  red:    { solid: '#EF4444' },
  purple: { solid: '#A855F7' },
  pink:   { solid: '#EC4899' },
};

const GAUGE_EMOJIS = {
  gray:   '\u{1F610}', yellow: '\u{1F642}', orange: '\u{1F642}', red: '\u{1F604}',
  purple: '\u{1F60D}', pink: '\u{1F929}', error: '\u{2753}'
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
        percentage = Math.max(0, Math.min(100, Math.round((Math.abs(v) / Math.abs(thresholds.maxExpected)) * 100)));
    } else {
        if (v >= thresholds.pink) key = 'pink'; else if (v >= thresholds.purple) key = 'purple'; else if (v >= thresholds.red) key = 'red'; else if (v >= thresholds.orange) key = 'orange'; else if (v >= thresholds.yellow) key = 'yellow'; else key = 'gray';
        percentage = Math.max(0, Math.min(100, Math.round((v / thresholds.maxExpected) * 100)));
    }
    return { color: GAUGE_COLORS[key].solid, emoji: GAUGE_EMOJIS[key], percentage };
};

const getAuroraEmoji = (score: number | null) => {
    if (score == null) return '❓';
    if (score >= 80) return '🤩'; if (score >= 50) return '😍'; if (score >= 40) return '😄';
    if (score >= 25) return '🙂'; if (score >= 10) return '🙂';
    return '😐';
};

const CAMERA_SETTINGS_TEXT: Record<string, { iso: string; aperture: string; shutter: string; wb: string; }> = {
    'Smartphone (wide-field)': { iso: '800-1600', aperture: 'f/1.5-f/2.4', shutter: '5s-15s', wb: '3500K-4500K' },
    'Crop-sensor DSLR/Mirrorless + 18-55mm': { iso: '1600-3200', aperture: 'f/2.8-f/4', shutter: '5s-15s', wb: '3500K-4500K' },
    'Full-frame DSLR/Mirrorless + 24mm f/1.4-f/2.8': { iso: '1600-3200', aperture: 'f/1.4-f/2.8', shutter: '2s-10s', wb: '3500K-4500K' },
    'Advanced (fast lens + dark skies)': { iso: '800-1600', aperture: 'f/1.4-f/2.0', shutter: '1s-5s', wb: '3500K-4500K' }
};

const ForecastDashboard: React.FC<ForecastDashboardProps> = ({ setViewerMedia, setCurrentAuroraScore, setSubstormActivityStatus, navigationTarget }) => {
    const {
        isLoading, auroraScore, lastUpdated, gaugeData, isDaylight, celestialTimes, auroraScoreHistory, dailyCelestialHistory,
        owmDailyForecast, locationBlurb, fetchAllData, allSpeedData, allDensityData, allMagneticData, hemispherePlotUrl, substormForecast
    } = useForecastData();

    const [cameraSettings, setCameraSettings] = useState(CAMERA_SETTINGS_TEXT['Smartphone (wide-field)']);
    const [infoModalOpen, setInfoModalOpen] = useState(false);
    const [infoModalContent, setInfoModalContent] = useState('');
    const [graphModalId, setGraphModalId] = useState<string | null>(null);

    useEffect(() => {
        setCurrentAuroraScore(auroraScore);
        setSubstormActivityStatus(substormForecast?.status ?? null);
    }, [auroraScore, setCurrentAuroraScore, setSubstormActivityStatus, substormForecast]);

    const openModal = useCallback((id: string) => {
        const contentMap: Record<string, string> = {
            'forecast': `<strong>How do I read the score?</strong><br>Higher % means a stronger chance of visible aurora in NZ. The bar and emoji roughly map to expected visibility levels.<br><br>
            <ul class='list-disc space-y-1 ml-5'>
                <li><strong>0–9% - 😞:</strong> Little to no auroral activity expected.</li>
                <li><strong>10–24% - 😐:</strong> Minimal activity likely; camera may capture faint glow.</li>
                <li><strong>25–39% - 😊:</strong> Camera-clear; sometimes naked-eye from very dark sites.</li>
                <li><strong>40–49% - 🙂:</strong> Faint naked-eye glow possible. Watch the southern horizon.</li>
                <li><strong>50–79% - 😀:</strong> Good chance of visible colour and motion.</li>
                <li><strong>80%+ - 🤩:</strong> High probability of significant displays; look higher in the sky.</li>
            </ul>`,
            'power': `<strong>What it is:</strong> Think of this as the "overall juice" in the solar wind. Higher = more energy to light up the aurora.<br><strong>Why it matters:</strong> High power can lead to a brighter and more widespread aurora.`,
            'speed': `<strong>What it is:</strong> The Sun constantly blows particles at us. Faster wind tends to drive stronger aurora.<br><strong>Why it matters:</strong> High speed can help sustain activity and cause the aurora to dance more quickly.`,
            'density': `<strong>What it is:</strong> How many particles per cm³ are arriving. More particles can enhance brightness.<br><strong>Why it matters:</strong> High density can make the aurora appear brighter and cover a larger area of the sky.`,
            'bt': `<strong>What it is:</strong> Total strength of the interplanetary magnetic field (IMF).<br><strong>Why it matters:</strong> Strong fields store energy that can be unleashed in substorms.`,
            'bz': `<strong>What it is:</strong> North–South component of the IMF. Negative (southward) Bz opens Earth’s magnetic field to energy transfer.<br><strong>Why it matters:</strong> The more negative the Bz, the better the chance of aurora!`,
            'epam': `<strong>What it is:</strong> ACE/EPAM measures energetic protons near Earth. Spikes can warn that a CME shock is near.<br><strong>Why it matters:</strong> A sharp rise can foreshadow sudden activity.`,
            'moon': `<strong>What it is:</strong> % of the Moon illuminated.<br><strong>Why it matters:</strong> Less moonlight = darker skies, easier to see faint aurora.`,
            'ips': `<strong>What it is:</strong> Sudden storm commencement indicator from IPS.<br><strong>Why it matters:</strong> A strong SSC can trigger an auroral display soon after it arrives.`,
            'substorm-forecast': `<strong>What is this?</strong><br>Short-term (now/next hours) model estimate of substorm status and timing.<br><br>
            <ul class='space-y-2'>
                <li><strong>Status:</strong> From QUIET/RECOVERY (settling) to LOADING (energy building) to ONSET (eruption happening now).</li>
                <li><strong>Suggested Action:</strong> A plain-English recommendation based on the current status.</li>
                <li><strong>Expected Window:</strong> Model’s best estimate for when the substorm may peak.</li>
                <li><strong>Likelihood:</strong> % chance of a substorm in the next hour.</li>
            </ul>`
        };
        setInfoModalContent(contentMap[id] || '');
        setInfoModalOpen(true);
    }, []);

    useEffect(() => {
        if (!navigationTarget) return;
        const { elementId, expandId } = navigationTarget;
        if (expandId) setGraphModalId(expandId);
        const el = document.getElementById(elementId);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [navigationTarget]);

    const heroImage = useMemo(() => ({ url: '/images/hero-aurora-nz.jpg', authorUrl: 'https://www.tnrprotography.com/' }), []);

    return (
        <section className="min-h-screen text-neutral-200">
            <div className="relative">
                <img src={heroImage.url} alt="Aurora over NZ" className="absolute inset-0 w-full h-[300px] object-cover opacity-30"/>
                <div className="relative z-10 max-w-6xl mx-auto px-4 py-6">
                    <header className="text-center mb-4">
                        <a href="https://www.tnrprotography.com/" target="_blank" rel="noreferrer"><img src="/images/tnr-protography-w_orig.png" alt="TNR Protography Logo" className="mx-auto w-full max-w-[250px] mb-4"/></a>
                        <h1 className="text-3xl font-bold text-neutral-100">Spot The Aurora - New Zealand Aurora Forecast</h1>
                    </header>
                    <main className="grid grid-cols-12 gap-6">
                        <ActivityAlert isDaylight={isDaylight} celestialTimes={celestialTimes} auroraScoreHistory={auroraScoreHistory} />
                        
                        <CombinedForecastPanel
                            score={auroraScore}
                            blurb={useMemo(() => {
                                if (isDaylight) return 'The sun is currently up. Aurora visibility is not possible until after sunset.';
                                return owmDailyForecast?.summary || 'Forecast updates hourly based on real-time space weather.';
                            }, [isDaylight, owmDailyForecast]) as unknown as string}
                            lastUpdated={lastUpdated}
                            locationBlurb={locationBlurb}
                            getGaugeStyle={getGaugeStyle}
                            getScoreColorKey={getForecastScoreColorKey}
                            getAuroraEmoji={getAuroraEmoji}
                            gaugeColors={GAUGE_COLORS}
                            forecast={substormForecast as SubstormForecast}
                            onOpenModal={openModal}
                        />

                        <div className="col-span-12 grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <TipsSection />
                            <CameraSettingsSection settings={cameraSettings} />
                        </div>
                        
                        <AuroraSightings isDaylight={isDaylight} />

                        <ForecastTrendChart 
                            className="col-span-12"
                            auroraScoreHistory={auroraScoreHistory}
                            dailyCelestialHistory={dailyCelestialHistory}
                            owmDailyForecast={owmDailyForecast}
                            onOpenModal={() => openModal('forecast')}
                        />

                        <DataGauges
                            gaugeData={gaugeData}
                            onOpenModal={openModal}
                            onExpandGraph={setGraphModalId}
                        />

                        <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col">
                            <h3 className="text-xl font-semibold text-center text-white mb-4">Live Cloud Cover</h3>
                            <div className="relative w-full" style={{
                                paddingBottom: '56.25%'
                            }}>
                                <iframe
                                    title="Ventusky Cloud Cover"
                                    src="https://www.ventusky.com/?p=-43.5;170.5;6&l=clouds&t=20211007/1800&play=0&wind=off"
                                    className="absolute top-0 left-0 w-full h-full border-0 rounded-xl"
                                    loading="lazy"
                                />
                            </div>
                            <p className="text-xs text-neutral-400 text-center mt-2">Data courtesy of Ventusky</p>
                        </div>

                        <div className="col-span-12 card bg-neutral-950/80 p-4">
                            <h3 className="text-xl font-semibold text-center text-white mb-4">Southern Hemisphere IPM (Aurora Oval)</h3>
                            <div className="flex justify-center">
                                {hemispherePlotUrl ? (
                                    <img src={hemispherePlotUrl} alt="Southern Hemisphere Aurora Oval" className="rounded-xl border border-neutral-700/30" />
                                ) : (
                                    <div className="py-8 flex items-center justify-center"><LoadingSpinner /></div>
                                )}
                            </div>
                        </div>

                        <div className="col-span-12 card bg-neutral-950/80 p-6">
                            <h3 className="text-xl font-semibold text-white mb-4 text-center">ACE EPAM (CME Shockwatch)</h3>
                            <div className="flex justify-center">
                                <img src={ACE_EPAM_URL} alt="ACE EPAM 24-hour" className="rounded-lg border border-neutral-700/30" />
                            </div>
                        </div>

                        <div className="col-span-12 card bg-neutral-950/80 p-6">
                            <h3 className="text-xl font-semibold text-white mb-4 text-center">Live Cameras (South Island)</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {CAMERAS.map((cam) => (
                                    <div key={cam.name} className="rounded-xl bg-black/30 border border-neutral-700/30 overflow-hidden">
                                        <div className="text-center text-sm text-neutral-300 font-medium px-3 py-2 bg-black/30">{cam.name}</div>
                                        {cam.type === 'image' ? (
                                            <img src={cam.url} alt={`${cam.name} camera`} className="w-full h-48 object-cover"/>
                                        ) : (
                                            <iframe title={cam.name} src={cam.url} className="w-full h-48 border-0" loading="lazy" />
                                        )}
                                        <div className="px-3 py-2 text-xs text-neutral-500">Source: {cam.sourceUrl}</div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="col-span-12 flex flex-col items-center text-center py-6">
                            <GuideIcon className="w-10 h-10 text-neutral-400 mb-2" />
                            <p className="text-sm text-neutral-400">Tip: Tap the <strong>?</strong> buttons on cards to learn what each metric means.</p>
                        </div>
                    </main>
                </div>
            </div>

            <InfoModal isOpen={infoModalOpen} onClose={() => setInfoModalOpen(false)}>
                <div className="prose prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: infoModalContent }} />
            </InfoModal>

            <GraphModal
                graphId={graphModalId}
                onClose={() => setGraphModalId(null)}
                renderContent={(id) => (
                    <ExpandedGraphContent
                        id={id}
                        allSpeedData={allSpeedData}
                        allDensityData={allDensityData}
                        allMagneticData={allMagneticData}
                    />
                )}
            />
        </section>
    );
};

export default ForecastDashboard;

//--- END OF FILE src/components/ForecastDashboard.tsx ---
