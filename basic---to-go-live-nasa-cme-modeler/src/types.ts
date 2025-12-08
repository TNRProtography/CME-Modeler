export interface CMEParameters {
  launchTime: string;
  initialSpeed: number; // km/s
  acceleration: number; // km/s^2 (can be negative)
  angularWidth: number; // degrees
  density: number; // protons/cm^3
}

export interface CMEMilestone {
  label: string;
  timeHours: number;
  distanceAU: number;
  speed: number;
}

export interface CMEForecast {
  arrival: Date;
  transitHours: number;
  finalSpeed: number;
  kpEstimate: number;
  milestones: CMEMilestone[];
}

export interface CMEEvent {
  id: string;
  name: string;
  launch: string;
  speed: number;
  density: number;
  kpIndex: number;
  arrival: string;
  notes: string;
}
