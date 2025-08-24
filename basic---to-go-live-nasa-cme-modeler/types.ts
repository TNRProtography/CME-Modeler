//--- START OF FILE types.ts ---

// Assuming global THREE is available from CDN
// import * as THREE from 'three';

export interface PlanetData {
  radius: number; // AU for planets, visual orbital radius for moons
  size: number;   // visual size in scene units
  color: number | string;
  angle: number;  // initial orbital angle
  name: string;
  labelElementId: string;
  orbits?: string;            // Name of the celestial body it orbits (e.g., 'EARTH')
  orbitalPeriodDays?: number; // Orbital period in days for moons
}

export interface POIData {
  name: string;
  size: number;
  color: number | string;
  labelElementId: string;
  parent: string;            // The body it's positioned relative to
  distanceFromParent: number; // In scene units, towards the Sun
}

export interface CelestialBody {
  mesh: any;                        // THREE.Mesh
  labelElement?: HTMLElement | null; // For original HTML labels
  labelId?: string;                 // For React-managed labels
  name: string;
  userData?: PlanetData | POIData;  // Store original data for animation
}

export interface CMEAnalysis {
  time21_5: string;
  latitude: number;
  longitude: number;
  halfAngle: number;
  speed: number;
  type: string;
  isMostAccurate: boolean;
  note: string;
  levelOfData: number;
  link: string;
  enlilList: any[] | null;
}

export interface LinkedEvent {
  activityID: string;
}

export interface CMEData {
  activityID: string;
  catalog: string;
  startTime: string;
  sourceLocation: string;
  activeRegionNum: number | null;
  link: string;
  note: string;
  instruments: { displayName: string }[];
  cmeAnalyses: CMEAnalysis[] | null;
  linkedEvents: LinkedEvent[] | null;
}

export interface ProcessedCME {
  id: string;
  startTime: Date;
  speed: number;          // km/s
  longitude: number;      // degrees
  latitude: number;       // degrees
  isEarthDirected: boolean;
  note: string;
  predictedArrivalTime: Date | null;
  simulationStartTime?: number; // For individual modeling, relative to THREE.Clock elapsed time
  mesh?: any;            // THREE.Mesh
  link: string;
  instruments: string;
  sourceLocation: string;
  halfAngle: number;
}

export enum ViewMode {
  TOP = 'top',
  SIDE = 'side',
}

export enum InteractionMode {
  MOVE = 'move',
  SELECT = 'select',
}

export enum FocusTarget {
  SUN = 'sun',
  EARTH = 'earth',
}

export enum TimeRange {
  H24 = 1,
  D3 = 3,
  D7 = 7,
}

export enum CMEFilter {
  ALL = 'all',
  EARTH_DIRECTED = 'earthDirected',
  NOT_EARTH_DIRECTED = 'notEarthDirected',
}

export interface PlanetLabelInfo {
  id: string;
  name: string;
  mesh: any; // THREE.Object3D
}

// --- NEW/MODIFIED TYPE FOR SUBSTORM ACTIVITY ---
export interface SubstormActivity {
  text: string;              // The original text blurb for display inside the dashboard
  color: string;             // The color for the text inside the dashboard
  isStretching: boolean;     // True if the field is stretching (the condition for the banner alert)
  isErupting: boolean;       // True if a substorm signature (jump) is detected
  probability?: number;      // The calculated probability percentage
  predictedStartTime?: number; // The predicted start timestamp of the eruption window
  predictedEndTime?: number;   // The predicted end timestamp of the eruption window
}

// --- NEW TYPE FOR THE PREDICTIVE FORECAST ---
export interface SubstormForecast {
  status: 'QUIET' | 'WATCH' | 'LIKELY_60' | 'IMMINENT_30' | 'ONSET';
  likelihood: number;   // 0-100
  windowLabel: string;  // e.g., "10 – 60 min"
  action: string;       // e.g., "Prepare to go..."
  p30: number;          // raw probability for 30 mins
  p60: number;          // raw probability for 60 mins
}

// MODIFIED: Added resetAnimationTimer to the handle
export interface SimulationCanvasHandle {
  resetView: () => void;
  resetAnimationTimer: () => void;
}

// --- MODIFIED: Updated SightingStatus to include new "nothing" categories ---
export type SightingStatus = 
  | 'eye' 
  | 'phone' 
  | 'dslr' 
  | 'cloudy' 
  | 'nothing-eye' 
  | 'nothing-phone' 
  | 'nothing-dslr';

export interface SightingReport {
  lat: number;
  lng: number;
  status: SightingStatus;
  name: string;
  timestamp: number;
  key?: string;        // a unique key from the KV store
  isPending?: boolean; // For client-side state
}

// --- NEW: Type for the 24-hour activity summary ---
export interface ActivitySummary {
  highestScore: {
    finalScore: number;
    timestamp: number;
  };
  substormEvents: {
    start: number;
    end: number;
    peakProbability: number;
    peakStatus: string;
  }[];
}

/**
 * If you truly need a type representing a Vite config shape in this file,
 * use a valid identifier (no dots) like this. Otherwise, feel free to remove it.
 */
export interface ViteConfig {
  plugins: any[];
}

//--- END OF FILE types.ts ---