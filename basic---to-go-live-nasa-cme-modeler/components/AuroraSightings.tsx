import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { SightingReport, SightingStatus } from '../types';
import LoadingSpinner from './icons/LoadingSpinner';
import GuideIcon from './icons/GuideIcon'; // For the info button
import CloseIcon from './icons/CloseIcon'; // For the modal close button

// --- CONSTANTS & CONFIG ---
const API_URL = 'https://aurora-sightings.thenamesrock.workers.dev/';
const LOCAL_STORAGE_USERNAME_KEY = 'aurora_sighting_username';
const LOCAL_STORAGE_LAST_REPORT_KEY = 'aurora_sighting_last_report';
const REPORTING_COOLDOWN_MS = 60 * 60 * 1000; // 60 minutes

// NEW: South Island of NZ bounding box for map
const NZ_SOUTH_ISLAND_BOUNDS: L.LatLngBoundsLiteral = [
    [-47.5, 166.0], // South-West corner
    [-40.0, 175.5]  // North-East corner
];
const MAP_ZOOM = 6; // Initial zoom level that fits South Island well

// --- EMOJIS AND LABELS ---
const STATUS_OPTIONS: { status: SightingStatus; emoji: string; label: string; description: string; }[] = [
    { status: 'eye', emoji: '👁️', label: 'Naked Eye', description: 'Visible without a camera. You can see distinct shapes, structure, or even color with your eyes alone.' },
    { status: 'phone', emoji: '📱', label: 'Phone Camera', description: 'Not visible to your eyes, but shows up clearly in a modern smartphone photo (e.g., a 3-second night mode shot).' },
    { status: 'dslr', emoji: '📷', label: 'DSLR/Mirrorless', description: 'Only visible with a dedicated camera (DSLR/Mirrorless) on a tripod using a long exposure (e.g., >5 seconds).' },
    { status: 'cloudy', emoji: '☁️', label: 'Cloudy', description: 'Your view of the sky is mostly or completely obscured by clouds, preventing any possible sighting.' },
    { status: 'nothing', emoji: '❌', label: 'Nothing', description: 'The sky is clear, but no aurora is visible in any form (neither by eye nor by camera). Reporting nothing is very important data!' },
];

const getEmojiForStatus = (status: SightingStatus) => STATUS_OPTIONS.find(opt => opt.status === status)?.emoji || '❓';

// --- HELPER & CHILD COMPONENTS ---

const MapEffect = () => {
    const map = useMap();
    useEffect(() => {
        const timer = setTimeout(() => map.invalidateSize(), 100);
        return () => clearTimeout(timer);
    }, [map]);
    return null;
};

const LocationFinder = ({ onLocationSelect }: { onLocationSelect: (latlng: L.LatLng) => void }) => {
    // MODIFIED: Use useMapEvents for dragging and scrollWheel events to prevent accidental scroll
    const map = useMap();
    useMapEvents({
        click(e) {
            onLocationSelect(e.latlng);
        },
        // Only allow dragging if Shift key is pressed on desktop, or two fingers on touch
        // Leaflet's default `dragging` and `scrollWheelZoom` options handle touch/multi-touch behavior well.
        // For desktop mouse wheel, setting scrollWheelZoom to 'center' or false and relying on modifier key is common.
        // For this specific request, setting them to false and letting `touchZoom` handle multi-touch is key.
        // Mouse interactions for dragging/zooming are now disabled by the MapContainer props below.
        // We only listen for clicks to set location.
    });
    return null;
};

// A simple, local modal component for the guide
const InfoModal: React.FC<{ isOpen: boolean; onClose: () => void; }> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[1000] flex justify-center items-center p-4" onClick={onClose}>
            <div className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] text-neutral-300 flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center p-4 border-b border-neutral-700/80">
                    <h3 className="text-xl font-bold text-neutral-200">How to Report a Sighting</h3>
                    <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"><CloseIcon className="w-6 h-6" /></button>
                </div>
                <div className="overflow-y-auto p-5 styled-scrollbar pr-4 space-y-5 text-sm">
                    <section>
                        <h4 className="font-semibold text-base text-neutral-200 mb-2">Placing Your Pin</h4>
                        <p>The app will try to use your device's GPS for an accurate location. If your pin isn't correct or doesn't appear, simply click or tap anywhere on the map to place it manually. To move the map, use two fingers on touch devices, or hold down the Ctrl/Cmd key while dragging/scrolling with a mouse.</p>
                    </section>
                     <section>
                        <h4 className="font-semibold text-base text-neutral-200 mb-2">What Should I Report?</h4>
                        <p>Honest reports are crucial for everyone! Please use the following guide to choose the best option for your situation.</p>
                        <ul className="mt-3 space-y-3">
                            {STATUS_OPTIONS.map(({ emoji, label, description }) => (
                                <li key={label} className="flex items-start gap-4">
                                    <span className="text-3xl mt-[-4px]">{emoji}</span>
                                    <div>
                                        <strong className="font-semibold text-neutral-200">{label}</strong>
                                        <p className="text-neutral-400">{description}</p>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </section>
                </div>
            </div>
        </div>
    );
};


// The main component for this file
const AuroraSightings: React.FC = () => {
    // --- STATE MANAGEMENT ---
    const [sightings, setSightings] = useState<SightingReport[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);

    const [userName, setUserName] = useState<string>('');
    const [userPosition, setUserPosition] = useState<L.LatLng | null>(null);
    const [selectedStatus, setSelectedStatus] = useState<SightingStatus | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [pendingReport, setPendingReport] = useState<SightingReport | null>(null);
    const [lastReportInfo, setLastReportInfo] = useState<{timestamp: number, key: string} | null>(null);
    
    // --- DATA FETCHING & INITIALIZATION ---

    const fetchSightings = useCallback(async () => {
        try {
            setError(null);
            const response = await fetch(API_URL);
            if (!response.ok) throw new Error('Failed to fetch sightings data.');
            const data: SightingReport[] = await response.json();
            setSightings(data.sort((a, b) => b.timestamp - a.timestamp));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An unknown error occurred.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        setUserName(localStorage.getItem(LOCAL_STORAGE_USERNAME_KEY) || '');
        const lastReportString = localStorage.getItem(LOCAL_STORAGE_LAST_REPORT_KEY);
        if (lastReportString) setLastReportInfo(JSON.parse(lastReportString));

        fetchSightings();

        navigator.geolocation.getCurrentPosition(
            (position) => setUserPosition(new L.LatLng(position.coords.latitude, position.coords.longitude)),
            (err) => console.warn(`Geolocation error: ${err.message}. Please click map to set location.`),
            { timeout: 10000, enableHighAccuracy: false }
        );

        const intervalId = setInterval(fetchSightings, 2 * 60 * 1000);
        return () => clearInterval(intervalId);
    }, [fetchSightings]);

    // --- COMPUTED VALUES & MEMOS ---
    const cooldownRemaining = useMemo(() => {
        if (!lastReportInfo) return 0;
        const timePassed = Date.now() - lastReportInfo.timestamp;
        return Math.max(0, REPORTING_COOLDOWN_MS - timePassed);
    }, [lastReportInfo]);
    
    const canSubmit = !isSubmitting && cooldownRemaining === 0;

    // --- EVENT HANDLERS ---
    const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newName = e.target.value;
        setUserName(newName);
        localStorage.setItem(LOCAL_STORAGE_USERNAME_KEY, newName);
    };

    const handleSubmit = async () => {
        if (!userPosition || !selectedStatus || !userName.trim() || !canSubmit) {
            const alertMsg = [
                !userName.trim() && 'Please enter your name.',
                !userPosition && 'Please set your location by clicking the map or enabling GPS.',
                !selectedStatus && 'Please select your sighting status.',
                !canSubmit && 'You can only report once per hour.'
            ].filter(Boolean).join('\n');
            if (alertMsg) alert(alertMsg);
            return;
        }

        setIsSubmitting(true);
        setError(null);
        const reportData: Omit<SightingReport, 'timestamp'> = { lat: userPosition.lat, lng: userPosition.lng, status: selectedStatus, name: userName.trim() };
        const pendingSighting: SightingReport = { ...reportData, timestamp: Date.now(), isPending: true };
        setPendingReport(pendingSighting);

        try {
            const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reportData) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Submission failed.');
            
            const newReportInfo = { timestamp: Date.now(), key: result.key };
            setLastReportInfo(newReportInfo);
            localStorage.setItem(LOCAL_STORAGE_LAST_REPORT_KEY, JSON.stringify(newReportInfo));
            
            await fetchSightings();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An unknown error occurred.');
        } finally {
            setIsSubmitting(false);
            setPendingReport(null);
        }
    };
    
    // --- RENDER LOGIC ---

    const userMarkerIcon = L.divIcon({
        html: `<div class="relative flex h-5 w-5"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span><span class="relative inline-flex rounded-full h-5 w-5 bg-sky-500 border-2 border-white"></span></div>`,
        className: '',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
    });

    const createSightingIcon = (sighting: SightingReport) => {
        const emoji = getEmojiForStatus(sighting.status);
        const sendingAnimation = sighting.isPending ? `<div class="absolute inset-0 flex items-center justify-center text-white text-xs animate-pulse">sending...</div><div class="absolute inset-0 bg-black rounded-full opacity-60"></div>` : '';
        return L.divIcon({
            html: `<div class="relative">${sendingAnimation}<div>${emoji}</div></div>`,
            className: 'emoji-marker',
            iconSize: [32, 32],
            iconAnchor: [16, 16],
        });
    };
    
    return (
        <div className="col-span-12 card bg-neutral-950/80 p-6 space-y-6">
            <div className="text-center">
                <div className="flex justify-center items-center gap-2">
                     <h2 className="text-2xl font-bold text-white">Spotting The Aurora</h2>
                     <button onClick={() => setIsInfoModalOpen(true)} className="p-1 text-neutral-400 hover:text-neutral-100" title="How to use the sightings map">
                        <GuideIcon className="w-6 h-6" />
                     </button>
                </div>
                <p className="text-neutral-400 mt-1 max-w-2xl mx-auto">Help the community by reporting what you see (or don't see!). Honest reports, including clouds or clear skies with no aurora, are essential for everyone.</p>
            </div>

            {/* Reporting UI */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center bg-neutral-900 p-4 rounded-lg">
                <input type="text" value={userName} onChange={handleNameChange} placeholder="Your Name (required)" className="col-span-1 bg-neutral-800 border border-neutral-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500"/>
                <div className="col-span-1 md:col-span-2 grid grid-cols-2 lg:grid-cols-6 gap-2 items-center">
                    <div className="col-span-2 lg:col-span-5 flex flex-wrap justify-center gap-2">
                        {STATUS_OPTIONS.map(({ status, emoji, label }) => (
                            <button key={status} onClick={() => setSelectedStatus(status)} className={`px-3 py-2 rounded-lg border-2 transition-all text-sm flex items-center gap-2 ${selectedStatus === status ? 'border-sky-400 bg-sky-500/20' : 'border-neutral-700 bg-neutral-800 hover:bg-neutral-700'}`} title={label}>
                                <span className="text-lg">{emoji}</span>
                                <span className="hidden sm:inline">{label}</span>
                            </button>
                        ))}
                    </div>
                     <button onClick={handleSubmit} disabled={!canSubmit || isSubmitting} className="col-span-2 lg:col-span-1 w-full px-4 py-2 rounded-lg text-white font-semibold transition-colors disabled:bg-neutral-600 disabled:cursor-not-allowed flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500">
                        {isSubmitting ? <LoadingSpinner /> : 'Submit'}
                    </button>
                </div>
                {cooldownRemaining > 0 && <p className="col-span-1 md:col-span-3 text-center text-xs text-amber-400 mt-2">You can submit again in {Math.ceil(cooldownRemaining / 60000)} minutes.</p>}
            </div>

            {/* Map and Table Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                 <div className="lg:col-span-2 h-[500px] rounded-lg overflow-hidden border border-neutral-700">
                    <MapContainer 
                        center={[(NZ_SOUTH_ISLAND_BOUNDS[0][0] + NZ_SOUTH_ISLAND_BOUNDS[1][0]) / 2, (NZ_SOUTH_ISLAND_BOUNDS[0][1] + NZ_SOUTH_ISLAND_BOUNDS[1][1]) / 2]} // Center of bounds
                        zoom={MAP_ZOOM} 
                        scrollWheelZoom={false} // Prevent single-finger/accidental scroll zoom
                        dragging={false}       // Prevent single-finger/accidental dragging
                        doubleClickZoom={false} // Disable double-click zoom
                        touchZoom={true}       // Enable two-finger pinch-to-zoom on touch devices
                        boxZoom={false}        // Disable box zoom
                        keyboard={false}       // Disable keyboard pan/zoom
                        zoomControl={true}    // Keep zoom +/- buttons
                        minZoom={MAP_ZOOM} // Ensure it doesn't zoom out too far
                        maxBounds={NZ_SOUTH_ISLAND_BOUNDS} // Restrict panning outside bounds
                        className="h-full w-full bg-neutral-800"
                    >
                        <MapEffect />
                        <TileLayer attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>' url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"/>
                        <LocationFinder onLocationSelect={(latlng) => setUserPosition(latlng)} />

                        {userPosition && <Marker position={userPosition} icon={userMarkerIcon} draggable={true}><Popup>Your selected location. Drag to adjust.</Popup></Marker>}
                        
                        <>
                             {sightings.map(sighting => ( <Marker key={sighting.timestamp + sighting.name} position={[sighting.lat, sighting.lng]} icon={createSightingIcon(sighting)} zIndexOffset={sighting.timestamp}> <Popup> <strong>{sighting.name}</strong> saw: {getEmojiForStatus(sighting.status)} <br/> Reported at {new Date(sighting.timestamp).toLocaleTimeString()} </Popup> </Marker> ))}
                        </>
                        
                        {pendingReport && <Marker position={[pendingReport.lat, pendingReport.lng]} icon={createSightingIcon(pendingReport)} zIndexOffset={99999999999999} />}
                    </MapContainer>
                </div>

                <div className="lg:col-span-1 space-y-3">
                     <h3 className="text-xl font-semibold text-white">Latest 5 Reports</h3>
                     <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left text-neutral-400">
                            <thead className="text-xs text-neutral-300 uppercase bg-neutral-800"><tr><th scope="col" className="px-4 py-2">Time</th><th scope="col" className="px-4 py-2">Name</th><th scope="col" className="px-4 py-2">Report</th></tr></thead>
                            <tbody>
                                {isLoading ? ( <tr><td colSpan={3} className="text-center p-4 italic">Loading reports...</td></tr> ) : sightings.length === 0 ? ( <tr><td colSpan={3} className="text-center p-4 italic">No reports in the last 24 hours.</td></tr> ) : sightings.slice(0, 5).map(s => ( <tr key={s.timestamp + s.name} className="bg-neutral-900 border-b border-neutral-800"> <td className="px-4 py-2">{new Date(s.timestamp).toLocaleTimeString('en-NZ')}</td> <td className="px-4 py-2 font-medium text-neutral-200">{s.name}</td> <td className="px-4 py-2 text-2xl" title={s.status}>{getEmojiForStatus(s.status)}</td> </tr> ))}
                            </tbody>
                        </table>
                        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
                     </div>
                </div>
            </div>
            <InfoModal isOpen={isInfoModalOpen} onClose={() => setIsInfoModalOpen(false)} />
        </div>
    );
};

export default AuroraSightings;