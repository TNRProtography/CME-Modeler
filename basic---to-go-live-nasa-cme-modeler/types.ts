// Assuming global THREE is available from CDN
// import * as THREE from 'three'; 

export interface PlanetData {
  radius: number; // AU for planets, visual orbital radius for moons
  size: number; // visual size in scene units
  color: number | string;
  angle: number; // initial orbital angle
  name: string;
  labelElementId: string;
  orbits?: string; // Name of the celestial body it orbits (e.g., 'EARTH')
  orbitalPeriodDays?: number; // Orbital period in days for moons
}

export interface POIData {
  name: string;
  size: number;
  color: number | string;
  labelElementId: string;
  parent: string; // The body it's positioned relative to
  distanceFromParent: number; // In scene units, towards the Sun
}


export interface CelestialBody {
  mesh: any; // THREE.Mesh
  labelElement?: HTMLElement | null; // For original HTML labels
  labelId?: string; // For React-managed labels
  name: string;
  userData?: PlanetData | POIData; // Store original data for animation
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
  speed: number; // km/s
  longitude: number; // degrees
  latitude:number; // degrees
  isEarthDirected: boolean;
  note: string;
  predictedArrivalTime: Date | null;
  simulationStartTime?: number; // For individual modeling, relative to THREE.Clock elapsed time
  mesh?: any; // THREE.Mesh
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

export interface SimulationCanvasHandle {
  resetView: () => void;
}
