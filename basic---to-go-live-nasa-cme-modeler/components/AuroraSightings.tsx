import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { SightingReport, SightingStatus } from '../types';
import LoadingSpinner from './icons/LoadingSpinner';

// --- CONSTANTS & CONFIG ---
const API_URL = 'https://aurora-sightings.thenamesrock.workers.dev/';
const LOCAL_STORAGE_USERNAME_KEY = 'aurora_sighting_username';
const LOCAL_STORAGE_LAST_REPORT_KEY = 'aurora_sighting_last_report';
const REPORTING_COOLDOWN_MS = 60 * 60 * 1000; // 60 minutes
const NZ_SOUTH_ISLAND_CENTER: [number, number] = [-43.5321, 172.6362];
const MAP_ZOOM = 6;

// --- EMOJIS AND LABELS ---
const STATUS_OPTIONS: { status: SightingStatus; emoji: string; label: string }[] = [
    { status: 'eye', emoji: '👁️', label: 'Naked Eye' },
    { status: 'phone', emoji: '📱', label: 'Phone Camera' },
    { status: 'dslr', emoji: '📷', label: 'DSLR/Mirrorless' },
    { status: 'cloudy', emoji: '☁️', label: 'Cloudy' },
    { status: 'nothing', emoji: '❌', label: 'Nothing' },
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
    useMapEvents({
        click(e) {
            onLocationSelect(e.latlng);
        },
    });
    return null;
};

// The main component for this file
const AuroraSightings: React.FC = () => {
    // --- STATE MANAGEMENT ---
    const [sightings, setSightings] = useState<SightingReport[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

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
                <h2 className="text-2xl font-bold text-white">Live Aurora Sightings</h2>
                <p className="text-neutral-400">See what others are reporting and add your own sighting.</p>
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
                    <MapContainer center={NZ_SOUTH_ISLAND_CENTER} zoom={MAP_ZOOM} scrollWheelZoom={true} className="h-full w-full bg-neutral-800">
                        <MapEffect />
                        <TileLayer attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>' url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"/>
                        <LocationFinder onLocationSelect={(latlng) => setUserPosition(latlng)} />

                        {userPosition && <Marker position={userPosition} icon={userMarkerIcon}><Popup>Your selected location. Drag to adjust.</Popup></Marker>}
                        
                        <>
                             {sightings.map(sighting => ( 
                                 <Marker 
                                     key={sighting.timestamp + sighting.name} 
                                     position={[sighting.lat, sighting.lng]} 
                                     icon={createSightingIcon(sighting)}
                                     zIndexOffset={sighting.timestamp} // Higher value is on top
                                 >
                                     <Popup> 
                                         <strong>{sighting.name}</strong> saw: {getEmojiForStatus(sighting.status)} <br/> 
                                         Reported at {new Date(sighting.timestamp).toLocaleTimeString()} 
                                     </Popup>
                                 </Marker> 
                             ))}
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
        </div>
    );
};

export default AuroraSightings;