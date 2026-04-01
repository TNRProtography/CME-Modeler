export interface MagneticPoint {
  time: number;
  bt: number;
  bz: number;
  by: number;
}

export interface SeriesPoint {
  x: number;
  y: number;
}

export interface FluxRopeForecastPoint {
  label: string;
  minutesAhead: number;
  bz: number;
}

export interface FluxRopeAnalysis {
  detectedAt: number;
  entryTime: number;
  confidenceR2: number;
  windowMinutes: number;
  rotationDegPerHour: number;
  orientation: 'SOUTH_LEADING' | 'NORTH_LEADING' | 'AXIAL';
  progressPct: number;
  nowBz: number;
  nowBt: number;
  predictedTurnNorthAt: number | null;
  forecast: FluxRopeForecastPoint[];
  explanation: string;
}

const MIN_WINDOW_POINTS = 15; // ~45 mins at 3-min cadence
const MIN_R2 = 0.75;

const FORECAST_HORIZONS = [
  { label: 'Now', minutesAhead: 0 },
  { label: '+15m', minutesAhead: 15 },
  { label: '+30m', minutesAhead: 30 },
  { label: '+1h', minutesAhead: 60 },
  { label: '+3h', minutesAhead: 180 },
  { label: '+6h', minutesAhead: 360 },
];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const mean = (vals: number[]) => vals.reduce((s, v) => s + v, 0) / vals.length;

const stdDev = (vals: number[]) => {
  if (vals.length < 2) return 0;
  const m = mean(vals);
  return Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / vals.length);
};

const estimateExpectedTemp = (speed: number) => {
  const s = Math.max(200, speed);
  return (0.031 * (s - 259) * (s - 259) + 5.1) * 1000;
};

const linearRegression = (x: number[], y: number[]) => {
  const xMean = mean(x);
  const yMean = mean(y);
  let numer = 0;
  let denom = 0;
  for (let i = 0; i < x.length; i++) {
    numer += (x[i] - xMean) * (y[i] - yMean);
    denom += (x[i] - xMean) ** 2;
  }
  if (denom === 0) return { slope: 0, intercept: yMean, r2: 0 };
  const slope = numer / denom;
  const intercept = yMean - slope * xMean;

  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < x.length; i++) {
    const pred = intercept + slope * x[i];
    ssTot += (y[i] - yMean) ** 2;
    ssRes += (y[i] - pred) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - (ssRes / ssTot) : 0;
  return { slope, intercept, r2 };
};

const unwrapAngles = (angles: number[]) => {
  if (angles.length === 0) return [];
  const out = [angles[0]];
  for (let i = 1; i < angles.length; i++) {
    let a = angles[i];
    const prev = out[i - 1];
    while (a - prev > Math.PI) a -= 2 * Math.PI;
    while (a - prev < -Math.PI) a += 2 * Math.PI;
    out.push(a);
  }
  return out;
};

const percentile = (arr: number[], p: number) => {
  if (!arr.length) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = clamp((sorted.length - 1) * p, 0, sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const ratio = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * ratio;
};

export function analyzeFluxRope(
  magneticData: MagneticPoint[],
  speedData: SeriesPoint[],
  tempData: SeriesPoint[],
  shockEpochMs?: number,
): FluxRopeAnalysis | null {
  const mag = magneticData
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.bt) && Number.isFinite(p.by) && Number.isFinite(p.bz))
    .sort((a, b) => a.time - b.time);

  if (mag.length < MIN_WINDOW_POINTS) return null;

  const speedByBucket = new Map<number, number>();
  const tempByBucket = new Map<number, number>();
  const bucketMs = 3 * 60 * 1000;

  speedData.forEach((p) => speedByBucket.set(Math.round(p.x / bucketMs), p.y));
  tempData.forEach((p) => tempByBucket.set(Math.round(p.x / bucketMs), p.y));

  const now = mag[mag.length - 1].time;
  const earliestAllowed = shockEpochMs ? Math.max(shockEpochMs, now - 24 * 3600_000) : now - 18 * 3600_000;

  let best: { start: number; end: number; slope: number; intercept: number; r2: number; tempRatio: number; btAvg: number; btCv: number } | null = null;

  for (let start = 0; start < mag.length - MIN_WINDOW_POINTS; start++) {
    if (mag[start].time < earliestAllowed) continue;
    const end = mag.length - 1;
    const window = mag.slice(start, end + 1);
    if (window.length < MIN_WINDOW_POINTS) continue;

    const btVals = window.map((p) => p.bt);
    const btAvg = mean(btVals);
    const btCv = btAvg > 0 ? stdDev(btVals) / btAvg : Infinity;
    if (btAvg < 8 || btCv > 0.35) continue;

    const ratios: number[] = [];
    for (const p of window) {
      const k = Math.round(p.time / bucketMs);
      const spd = speedByBucket.get(k);
      const temp = tempByBucket.get(k);
      if (spd && temp && spd > 0 && temp > 0) {
        ratios.push(temp / estimateExpectedTemp(spd));
      }
    }
    if (ratios.length < 8) continue;
    const tempRatio = percentile(ratios, 0.5);
    if (!Number.isFinite(tempRatio) || tempRatio > 0.75) continue;

    const t0 = window[0].time;
    const x = window.map((p) => (p.time - t0) / 3600000);
    const theta = unwrapAngles(window.map((p) => Math.atan2(p.by, p.bz)));
    const fit = linearRegression(x, theta);

    if (Math.abs(fit.slope) < (5 * Math.PI / 180)) continue; // <5 deg/hour is not useful rotation
    if (fit.r2 < MIN_R2) continue;

    if (!best || fit.r2 > best.r2) {
      best = { start, end, slope: fit.slope, intercept: fit.intercept, r2: fit.r2, tempRatio, btAvg, btCv };
    }
  }

  if (!best) return null;

  const ropeWindow = mag.slice(best.start, best.end + 1);
  const entryTime = ropeWindow[0].time;
  const windowHours = (now - entryTime) / 3600000;
  const thetaNow = best.intercept + best.slope * windowHours;
  const btNow = mag[mag.length - 1].bt;
  const bzNow = mag[mag.length - 1].bz;

  const predictBzAt = (minutesAhead: number) => {
    const theta = thetaNow + best.slope * (minutesAhead / 60);
    return btNow * Math.cos(theta);
  };

  const forecast = FORECAST_HORIZONS.map((h) => ({
    label: h.label,
    minutesAhead: h.minutesAhead,
    bz: predictBzAt(h.minutesAhead),
  }));

  const in3h = predictBzAt(180);
  let orientation: FluxRopeAnalysis['orientation'] = 'AXIAL';
  if (bzNow <= -3 && in3h > bzNow) orientation = 'SOUTH_LEADING';
  else if (bzNow >= 3 && in3h < bzNow) orientation = 'NORTH_LEADING';

  let turnNorthAt: number | null = null;
  for (let m = 5; m <= 6 * 60; m += 5) {
    const prev = predictBzAt(m - 5);
    const next = predictBzAt(m);
    if ((prev <= 0 && next >= 0) || (prev >= 0 && next <= 0)) {
      turnNorthAt = now + m * 60_000;
      break;
    }
  }

  const rotationDegPerHour = best.slope * 180 / Math.PI;
  const typicalDurationHours = 18;
  const progressPct = clamp(((now - entryTime) / (typicalDurationHours * 3600_000)) * 100, 5, 100);

  const direction = rotationDegPerHour > 0 ? 'northward' : 'southward';
  const explanation = `Inside a smooth CME flux rope. IMF is rotating ${direction} at ${Math.abs(rotationDegPerHour).toFixed(1)}°/hr with ${(best.r2 * 100).toFixed(0)}% fit confidence.`;

  return {
    detectedAt: now,
    entryTime,
    confidenceR2: best.r2,
    windowMinutes: Math.round((now - entryTime) / 60000),
    rotationDegPerHour,
    orientation,
    progressPct,
    nowBz: bzNow,
    nowBt: btNow,
    predictedTurnNorthAt: turnNorthAt,
    forecast,
    explanation,
  };
}
