//--- START OF FILE src/components/ForecastComponents.tsx ---

import React, { useState, useMemo } from 'react';
import CloseIcon from './icons/CloseIcon';
import CaretIcon from './icons/CaretIcon';
import GuideIcon from './icons/GuideIcon';

// --- TYPE DEFINITIONS ---
interface ForecastScoreProps {
  score: number | null;
  blurb: string;
  lastUpdated: string;
  locationBlurb: string;
  getGaugeStyle: (v: number | null, type: 'power' | 'speed' | 'density' | 'bt' | 'bz') => { color: string; emoji: string; percentage: number };
  getScoreColorKey: (score: number) => 'gray' | 'yellow' | 'orange' | 'red' | 'purple' | 'pink';
  getAuroraEmoji: (score: number | null) => string;
  gaugeColors: Record<string, { solid: string }>;
  onOpenModal: () => void;
}

interface CollapsibleSectionProps {
    title: string;
    children: React.ReactNode;
}

interface CameraSettings {
    overall: string;
    phone: { android: Record<string, string>; apple: Record<string, string>; };
    dslr: Record<string, string>;
}

interface CameraSettingsSectionProps {
    settings: CameraSettings;
}

interface InfoModalProps { 
    isOpen: boolean; 
    onClose: () => void; 
    title: string; 
    content: string | React.ReactNode; 
}

interface ActivityAlertProps {
    isDaylight: boolean;
    celestialTimes: any;
    auroraScoreHistory: any[];
}


// --- COMPONENTS ---

export const ForecastScore: React.FC<ForecastScoreProps> = ({
  score, blurb, lastUpdated, locationBlurb, getGaugeStyle, getScoreColorKey, getAuroraEmoji, gaugeColors, onOpenModal
}) => {
  const isDaylight = blurb.includes("The sun is currently up");
  return (
    <div id="forecast-score-section" className="col-span-12 card bg-neutral-950/80 p-6 md:grid md:grid-cols-2 md:gap-8 items-center">
      <div>
        <div className="flex justify-center items-center mb-4">
          <h2 className="text-lg font-semibold text-white">Spot The Aurora Forecast</h2>
          <button onClick={onOpenModal} className="ml-2 p-1 rounded-full text-neutral-400 hover:bg-neutral-700">?</button>
        </div>
        <div className="text-6xl font-extrabold text-white">
          {score !== null ? `${score.toFixed(1)}%` : '...'} <span className="text-5xl">{getAuroraEmoji(score)}</span>
        </div>
        <div className="w-full bg-neutral-700 rounded-full h-3 mt-4">
          <div
            className="h-3 rounded-full"
            style={{
              width: `${score !== null ? getGaugeStyle(score, 'power').percentage : 0}%`,
              backgroundColor: score !== null ? gaugeColors[getScoreColorKey(score)].solid : gaugeColors.gray.solid,
            }}
          ></div>
        </div>
        <div className="text-sm text-neutral-400 mt-2">{lastUpdated}</div>
        <div className="text-xs text-neutral-500 mt-1 italic h-4">{locationBlurb}</div>
      </div>
      <p className="text-neutral-300 mt-4 md:mt-0">
        {isDaylight ? "The sun is currently up. Aurora visibility is not possible until after sunset. Check back later for an updated forecast!" : blurb}
      </p>
    </div>
  );
};

// --- REMOVED DataGauges component as it is now replaced by ForecastChartPanel ---

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({ title, children }) => {
    const [isOpen, setIsOpen] = useState(false);
    return (
        <div className="card bg-neutral-950/80 p-4">
            <div className="flex items-center justify-between cursor-pointer" onClick={() => setIsOpen(!isOpen)}>
                <h2 className="text-xl font-bold text-neutral-100">{title}</h2>
                <button className="p-2 rounded-full text-neutral-300 hover:bg-neutral-700/60 transition-colors">
                    <CaretIcon className={`w-6 h-6 transform transition-transform duration-300 ${isOpen ? 'rotate-180' : 'rotate-0'}`} />
                </button>
            </div>
            <div className={`transition-all duration-500 ease-in-out overflow-hidden ${isOpen ? 'max-h-[150vh] opacity-100 mt-4' : 'max-h-0 opacity-0'}`}>
                {children}
            </div>
        </div>
    );
};

export const TipsSection: React.FC = () => (
    <CollapsibleSection title="Tips for Spotting the Aurora">
        <ul className="list-disc list-inside space-y-3 text-neutral-300 text-sm pl-2">
            <li><strong>Look South:</strong> The aurora will always appear in the southern sky from New Zealand. Find a location with an unobstructed view to the south, away from mountains or hills.</li>
            {/* --- START OF MODIFICATION --- */}
            <li>
                <strong>Find a Good Spot:</strong> Can't find a dark location with a clear southern view? Check out this list of spots curated by TNR Protography specifically for the West Coast.
                <a 
                    href="https://maps.app.goo.gl/sNqpq1nGDN4Uso5k7" 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 hover:underline ml-2 font-semibold"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 20l-4.95-5.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                    </svg>
                    <span>View Locations Map</span>
                </a>
            </li>
            {/* --- END OF MODIFICATION --- */}
            <li><strong>Escape Light Pollution:</strong> Get as far away from town and urban area lights as possible. The darker the sky, the more sensitive your eyes become.</li>
            <li><strong>Check the Cloud Cover:</strong> Use the live cloud map on this dashboard to check for clear skies. A clear sky is non-negotiable. Weather changes fast, so check the map before and during your session.</li>
            <li><strong>Let Your Eyes Adapt:</strong> Turn off all lights, including your phone screen (use red light mode if possible), for at least 15-20 minutes. Your night vision is crucial for spotting faint glows.</li>
            <li><strong>The Camera Sees More:</strong> Your phone or DSLR camera is much more sensitive to light than your eyes. Take a long exposure shot (5-15 seconds) even if you can't see anything. You might be surprised!</li>
            <li><strong>New Moon is Best:</strong> Check the moon illumination gauge. A bright moon acts like a giant street light, washing out the aurora. The lower the percentage, the better your chances.</li>
            <li><strong>Be Patient & Persistent:</strong> Auroral activity ebbs and flows. A quiet period can be followed by a sudden, bright substorm. Don't give up after just a few minutes.</li>
        </ul>
    </CollapsibleSection>
);

export const CameraSettingsSection: React.FC<CameraSettingsSectionProps> = ({ settings }) => (
    <CollapsibleSection title="Suggested Camera Settings">
        <p className="text-neutral-400 text-center mb-6">{settings.overall}</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-neutral-900/70 p-4 rounded-lg border border-neutral-700/60">
                <h3 className="text-lg font-semibold text-neutral-200 mb-3">📱 Phone Camera</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-neutral-800/50 p-3 rounded-md border border-neutral-700/50">
                        <h4 className="font-semibold text-neutral-300 mb-2">Android (Pro Mode)</h4>
                        <ul className="text-xs space-y-1.5 text-neutral-400">
                            <li>**ISO:** {settings.phone.android.iso}</li>
                            <li>**Shutter:** {settings.phone.android.shutter}</li>
                            <li>**Aperture:** {settings.phone.android.aperture}</li>
                            <li>**Focus:** {settings.phone.android.focus}</li>
                            <li>**WB:** {settings.phone.android.wb}</li>
                        </ul>
                    </div>
                    <div className="bg-neutral-800/50 p-3 rounded-md border border-neutral-700/50">
                        <h4 className="font-semibold text-neutral-300 mb-2">Apple (Night Mode)</h4>
                        <ul className="text-xs space-y-1.5 text-neutral-400">
                            <li>**ISO:** {settings.phone.apple.iso}</li>
                            <li>**Shutter:** {settings.phone.apple.shutter}</li>
                            <li>**Aperture:** {settings.phone.apple.aperture}</li>
                            <li>**Focus:** {settings.phone.apple.focus}</li>
                            <li>**WB:** {settings.phone.apple.wb}</li>
                        </ul>
                    </div>
                </div>
            </div>
            <div className="bg-neutral-900/70 p-4 rounded-lg border border-neutral-700/60">
                <h3 className="text-lg font-semibold text-neutral-200 mb-3">📷 DSLR / Mirrorless</h3>
                <div className="bg-neutral-800/50 p-3 rounded-md border border-neutral-700/50">
                    <h4 className="font-semibold text-neutral-300 mb-2">Recommended Settings</h4>
                    <ul className="text-xs space-y-1.5 text-neutral-400">
                        <li>**ISO:** {settings.dslr.iso}</li>
                        <li>**Shutter:** {settings.dslr.shutter}</li>
                        <li>**Aperture:** {settings.dslr.aperture}</li>
                        <li>**Focus:** {settings.dslr.focus}</li>
                        <li>**WB:** {settings.dslr.wb}</li>
                    </ul>
                </div>
            </div>
        </div>
        <p className="text-neutral-500 text-xs italic mt-6 text-center">**Disclaimer:** These are starting points. Experimentation is key!</p>
    </CollapsibleSection>
);

export const InfoModal: React.FC<InfoModalProps> = ({ isOpen, onClose, title, content }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[2100] flex justify-center items-center p-4" onClick={onClose}>
      <div className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-lg max-h-[85vh] text-neutral-300 flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b border-neutral-700/80">
          <h3 className="text-xl font-bold text-neutral-200">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"><CloseIcon className="w-6 h-6" /></button>
        </div>
        <div className="overflow-y-auto p-5 styled-scrollbar pr-4 text-sm leading-relaxed">
          {typeof content === 'string' ? <div dangerouslySetInnerHTML={{ __html: content }} /> : content}
        </div>
      </div>
    </div>
  );
};

export const ActivityAlert: React.FC<ActivityAlertProps> = ({ isDaylight, celestialTimes, auroraScoreHistory }) => {
    const message = useMemo(() => {
        if (!isDaylight || !celestialTimes.sun?.set || auroraScoreHistory.length === 0) return null;
        const now = Date.now();
        const sunsetTime = celestialTimes.sun.set;
        const oneHourBeforeSunset = sunsetTime - (60 * 60 * 1000);
        
        if (now >= oneHourBeforeSunset && now < sunsetTime) {
            const latestHistoryPoint = auroraScoreHistory[auroraScoreHistory.length - 1];
            const latestBaseScore = latestHistoryPoint?.baseScore ?? 0;

            if (latestBaseScore >= 50) {
                let msg = "Aurora activity is currently high! Good potential for a display as soon as it's dark.";
                const { moon } = celestialTimes;
                if (moon?.rise && moon?.set && moon?.illumination !== undefined) {
                    const moonIsUpAtSunset = (sunsetTime > moon.rise && sunsetTime < moon.set) || (moon.set < moon.rise && (sunsetTime > moon.rise || sunsetTime < moon.set));
                    if (moonIsUpAtSunset) {
                        msg += ` Note: The ${moon.illumination.toFixed(0)}% illuminated moon will be up, which may wash out fainter details.`;
                    }
                }
                return msg;
            }
        }
        return null;
    }, [isDaylight, celestialTimes, auroraScoreHistory]);

    if (!message) return null;

    return (
        <div className="col-span-12 card bg-yellow-900/50 border border-yellow-400/30 text-yellow-200 p-4 text-center text-sm rounded-lg">
            {message}
        </div>
    );
};
//--- END OF FILE src/components/ForecastComponents.tsx ---