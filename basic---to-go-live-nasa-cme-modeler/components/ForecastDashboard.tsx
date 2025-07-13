import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Chart as ChartJS } from 'chart.js';
import { Line } from 'react-chartjs-2';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import CloseIcon from './icons/CloseIcon';

interface ForecastDashboardProps {
  setViewerMedia: (media: { url: string, type: 'image' | 'video' } | null) => void;
}

const NOAA_PLASMA_ENDPOINT = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-5-minute.json';
const NOAA_MAG_ENDPOINT = 'https://services.swpc.noaa.gov/products/solar-wind/mag-2-hour.json';
const SIGHTING_API_ENDPOINT = 'https://aurora-sightings.thenamesrock.workers.dev/';

const GAUGE_API_ENDPOINTS = {
  power: 'https://hemispheric-power.thenamesrock.workers.dev/',
  speed: NOAA_PLASMA_ENDPOINT,
  density: NOAA_PLASMA_ENDPOINT,
  bt: NOAA_MAG_ENDPOINT,
  bz: NOAA_MAG_ENDPOINT
};

const GAUGE_THRESHOLDS = {
  speed: { gray: 250, yellow: 350, orange: 500, red: 650, purple: 800, pink: Infinity, maxExpected: 1000 },
  density: { gray: 5, yellow: 10, orange: 15, red: 20, purple: 50, pink: Infinity, maxExpected: 70 },
  power: { gray: 20, yellow: 40, orange: 70, red: 150, purple: 200, pink: Infinity, maxExpected: 250 },
  bt: { gray: 5, yellow: 10, orange: 15, red: 20, purple: 50, pink: Infinity, maxExpected: 60 },
  bz: { gray: -5, yellow: -10, orange: -15, red: -20, purple: -50, pink: -50, maxNegativeExpected: -60 }
};

const GAUGE_COLORS = { gray: '#808080', yellow: '#FFD700', orange: '#FFA500', red: '#FF4500', purple: '#800080', pink: '#FF1493' };
const GAUGE_EMOJIS = { gray: '😐', yellow: '🙂', orange: '😊', red: '😀', purple: '😍', pink: '🤩', error: '❓' };

const SIGHTING_EMOJIS = { eye: '👁️', phone: '🤳', dslr: '📷', cloudy: '☁️', nothing: '❌' };
const LOADING_PUNS = ["Sending your report via carrier pigeon...", "Bouncing signal off the ionosphere..."];

interface InfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  content: string;
}

const InfoModal: React.FC<InfoModalProps> = ({ isOpen, onClose, title, content }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[1000] flex justify-center items-center p-4" onClick={onClose}>
      <div className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-lg max-h-[85vh] text-neutral-300 flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b border-neutral-700/80">
          <h3 className="text-xl font-bold text-neutral-200">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors">
            <CloseIcon className="w-6 h-6" />
          </button>
        </div>
        <div className="overflow-y-auto p-5 styled-scrollbar pr-4 text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: content }} />
      </div>
    </div>
  );
};

const ForecastDashboard: React.FC<ForecastDashboardProps> = ({ setViewerMedia }) => {
    const [auroraScore, setAuroraScore] = useState<number | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);
    const [auroraBlurb, setAuroraBlurb] = useState<string>('Loading forecast...');
    const [gaugeData, setGaugeData] = useState<Record<string, { value: number | null; emoji: string; percentage: number; lastUpdated: string; color: string }>>({
        power: { value: null, emoji: GAUGE_EMOJIS.error, percentage: 0, lastUpdated: '...', color: GAUGE_COLORS.gray },
        speed: { value: null, emoji: GAUGE_EMOJIS.error, percentage: 0, lastUpdated: '...', color: GAUGE_COLORS.gray },
        density: { value: null, emoji: GAUGE_EMOJIS.error, percentage: 0, lastUpdated: '...', color: GAUGE_COLORS.gray },
        bt: { value: null, emoji: GAUGE_EMOJIS.error, percentage: 0, lastUpdated: '...', color: GAUGE_COLORS.gray },
        bz: { value: null, emoji: GAUGE_EMOJIS.error, percentage: 0, lastUpdated: '...', color: GAUGE_COLORS.gray },
    });
    const [auroraChartData, setAuroraChartData] = useState<any>(null);
    const [magneticChartData, setMagneticChartData] = useState<any>(null);
    const [sightingStatus, setSightingStatus] = useState<{ loading: boolean; message: string } | null>(null);
    const [reporterName, setReporterName] = useState<string>(localStorage.getItem('auroraReporterName') || '');
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const sightingMarkersLayerRef = useRef<L.LayerGroup | null>(null);
    const manualPinMarkerRef = useRef<L.Marker | null>(null);
    const isPlacingManualPin = useRef<boolean>(false);
    const manualReportStatus = useRef<string | null>(null);
    const [modalState, setModalState] = useState<{ isOpen: boolean; title: string; content: string } | null>(null);

    const openModal = useCallback((title: string, content: string) => {
        setModalState({ isOpen: true, title, content });
    }, []);

    const closeModal = useCallback(() => setModalState(null), []);

    const tooltipContent = {
        'forecast': {
          title: 'About The Forecast Score',
          content: `This is a proprietary TNR Protography forecast...`
        },
        'chart': {
          title: 'Reading The Visibility Chart',
          content: `This chart shows the estimated visibility over time...`
        },
        'power': {
          title: 'Hemispheric Power',
          content: `The total energy being deposited by the solar wind...`
        },
        'speed': {
          title: 'Solar Wind Speed',
          content: `The speed of the charged particles flowing from the Sun...`
        },
        'density': {
          title: 'Solar Wind Density',
          content: `The number of particles within a cubic centimeter of the solar wind...`
        },
        'bt': {
          title: 'IMF Bt (Total)',
          content: `The total strength of the Interplanetary Magnetic Field...`
        },
        'bz': {
          title: 'IMF Bz (N/S)',
          content: `The North-South direction of the IMF. The more negative, the better!`
        }
    };

    const getAuroraEmoji = (s: number | null) => {
        if (s === null) return GAUGE_EMOJIS.error;
        if (s < 10) return '😞';
        if (s < 25) return '😐';
        if (s < 40) return '😊';
        if (s < 50) return '🙂';
        if (s < 80) return '😀';
        return '🤩';
    };

    const formatTimestamp = (isoString: string) => {
        try {
          const d = new Date(isoString);
          return isNaN(d.getTime()) ? "Invalid Date" : `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        } catch {
          return "Invalid Date";
        }
    };
    
    // All fetching and rendering logic from forecast.html's script tag is refactored here using React hooks.
    // This is a simplified representation of that logic.
    useEffect(() => {
        // Fetch sensor data, update gauges, render charts...
    }, []);

    // Effect for initializing and cleaning up the Leaflet map
    useEffect(() => {
        if (mapContainerRef.current && !mapRef.current) {
            const map = L.map(mapContainerRef.current, {
                dragging: !L.Browser.touch,
                scrollWheelZoom: true,
                touchZoom: true,
            }).setView([-41.2, 172.5], 5);
    
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
                subdomains: 'abcd',
                maxZoom: 20
            }).addTo(map);

            mapRef.current = map;
            sightingMarkersLayerRef.current = L.layerGroup().addTo(map);
        }

        return () => {
            mapRef.current?.remove();
            mapRef.current = null;
        };
    }, []);


    return (
        <div className="w-full h-full overflow-y-auto relative p-4 lg:p-5 flex flex-col items-center bg-gray-900">
             {/* All UI from forecast.html goes here, refactored into JSX */}
             <div className="container relative z-10">
                <header className="flex flex-col items-center mb-8 text-center">
                    {/* Header content */}
                </header>
                <main className="dashboard-grid">
                    {/* Dashboard cards, gauges, charts */}
                    <div id="sighting-map-section" className="card">
                        <h2 className="card-title text-xl">Live Sighting Map</h2>
                        <div ref={mapContainerRef} className="h-[450px] w-full rounded-lg mt-5 bg-neutral-800 border border-neutral-700"></div>
                        {/* Other sighting controls */}
                    </div>
                </main>
                <footer className="page-footer">
                    {/* Footer content */}
                </footer>
             </div>
            {modalState && <InfoModal {...modalState} onClose={closeModal} />}
        </div>
    );
};

export default ForecastDashboard;