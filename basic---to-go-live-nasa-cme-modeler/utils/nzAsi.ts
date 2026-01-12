export interface NzTown {
  name: string;
  lat: number;
  lon?: number;
  cam?: string;
  phone?: string;
  eye?: string;
}

export const SCALE_FACTOR = 100;
export const OBAN_LAT = -46.9;
export const AKL_LAT = -36.85;
export const LAT_DELTA = AKL_LAT - OBAN_LAT;

export const REQ_CAM = { start: -300, end: -800 };
export const REQ_PHN = { start: -350, end: -900 };
export const REQ_EYE = { start: -500, end: -1200 };

export const NZ_TOWNS: NzTown[] = [
  { name: 'Oban', lat: -46.9, lon: 168.12 },
  { name: 'Invercargill', lat: -46.41, lon: 168.35 },
  { name: 'Dunedin', lat: -45.87, lon: 170.5 },
  { name: 'Queenstown', lat: -45.03, lon: 168.66 },
  { name: 'Wānaka', lat: -44.7, lon: 169.12 },
  { name: 'Twizel/Tekapo', lat: -44.26, lon: 170.1 },
  { name: 'Timaru', lat: -44.39, lon: 171.25 },
  { name: 'Christchurch', lat: -43.53, lon: 172.63 },
  { name: 'Kaikōura', lat: -42.4, lon: 173.68 },
  { name: 'Greymouth', lat: -42.45, lon: 171.2 },
  { name: 'Nelson', lat: -41.27, lon: 173.28 },
  { name: 'Wellington', lat: -41.29, lon: 174.77 },
  { name: 'Palmerston Nth', lat: -40.35, lon: 175.6 },
  { name: 'Napier', lat: -39.49, lon: 176.91 },
  { name: 'Taupō', lat: -38.68, lon: 176.07 },
  { name: 'Tauranga', lat: -37.68, lon: 176.16 },
  { name: 'Auckland', lat: -36.85, lon: 174.76 },
  { name: 'Whangārei', lat: -35.72, lon: 174.32 },
];

export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export const parseIso = (ts: string | number) => {
  const t = new Date(ts).getTime();
  return Number.isFinite(t) ? t : null;
};

export const getProjectedBaseline = (samples: { t: number; val: number }[], targetTime: number) => {
  const endWindow = targetTime - 5 * 60000;
  const startWindow = targetTime - 185 * 60000;
  const windowPoints: { t: number; val: number }[] = [];
  for (let i = samples.length - 1; i >= 0; i--) {
    const t = samples[i].t;
    if (t > endWindow) continue;
    if (t < startWindow) break;
    windowPoints.push(samples[i]);
  }
  if (windowPoints.length < 10) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  const n = windowPoints.length;
  for (let i = 0; i < n; i++) {
    const x = (windowPoints[i].t - startWindow) / 60000;
    const y = windowPoints[i].val;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  const targetX = (targetTime - startWindow) / 60000;
  return slope * targetX + intercept;
};

export const getTownStatus = (
  town: { lat: number },
  currentStrength: number,
  category: 'camera' | 'phone' | 'eye',
) => {
  if (currentStrength >= 0) return undefined;
  const reqs = category === 'phone' ? REQ_PHN : category === 'eye' ? REQ_EYE : REQ_CAM;
  const slope = (reqs.end - reqs.start) / LAT_DELTA;
  const required = reqs.start + (town.lat - OBAN_LAT) * slope;

  if (currentStrength <= required) {
    const excess = Math.abs(currentStrength) - Math.abs(required);
    if (excess < 50) return 'red';
    if (excess < 100) return 'yellow';
    return 'green';
  }
  return undefined;
};

export const getVisibleTowns = (strength: number): NzTown[] => {
  return NZ_TOWNS.map((town) => ({
    ...town,
    cam: getTownStatus(town, strength, 'camera'),
    phone: getTownStatus(town, strength, 'phone'),
    eye: getTownStatus(town, strength, 'eye'),
  }));
};
