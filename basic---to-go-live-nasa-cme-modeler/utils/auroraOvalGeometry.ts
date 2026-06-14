import type { SubstormRiskData } from '../hooks/useForecastData';

// Aurora Oval Overlay — IGRF-13 dipole geomagnetic projection.
// Shared with dashboard visualisations so the same oval geometry is used everywhere.
const POLE_LAT_RAD = 80.65 * Math.PI / 180;
const POLE_LON_RAD = -72.68 * Math.PI / 180;

export type LatLon = [number, number];

export function geoToGmag(latDeg: number, lonDeg: number): number {
  const φ = latDeg * Math.PI / 180;
  const λ = lonDeg * Math.PI / 180;
  const sin = Math.sin(φ) * Math.sin(POLE_LAT_RAD) +
              Math.cos(φ) * Math.cos(POLE_LAT_RAD) * Math.cos(λ - POLE_LON_RAD);
  return Math.asin(Math.max(-1, Math.min(1, sin))) * 180 / Math.PI;
}

export function gmagToGeoLat(gmagLat: number, lonDeg: number): number {
  let lo = -90;
  let hi = 90;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (geoToGmag(mid, lonDeg) < gmagLat) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function buildOvalRing(gmagLat: number, lonStep = 1.5): LatLon[] {
  const pts: LatLon[] = [];
  for (let lon = -180; lon <= 200; lon += lonStep) {
    const normLon = ((lon + 180) % 360) - 180;
    const geoLat = gmagToGeoLat(gmagLat, normLon);
    if (geoLat >= -85 && geoLat <= 85) pts.push([geoLat, lon]);
  }
  return pts;
}

export function buildBandPolygon(gmagInner: number, gmagOuter: number, lonStep = 2): LatLon[] {
  const outer: LatLon[] = [];
  const inner: LatLon[] = [];
  for (let lon = -180; lon <= 200; lon += lonStep) {
    const normLon = ((lon + 180) % 360) - 180;
    outer.push([gmagToGeoLat(gmagOuter, normLon), lon]);
    inner.push([gmagToGeoLat(gmagInner, normLon), lon]);
  }
  inner.reverse();
  return [...outer, ...inner];
}

export function ovalColour(score: number): { line: string; fill: string; fillOpacity: number } {
  if (score >= 80) return { line: '#f87171', fill: '#f87171', fillOpacity: 0.22 };
  if (score >= 65) return { line: '#fb923c', fill: '#fb923c', fillOpacity: 0.20 };
  if (score >= 50) return { line: '#f59e0b', fill: '#f59e0b', fillOpacity: 0.18 };
  if (score >= 35) return { line: '#a3e635', fill: '#a3e635', fillOpacity: 0.15 };
  if (score >= 20) return { line: '#34d399', fill: '#34d399', fillOpacity: 0.12 };
  return { line: '#38bdf8', fill: '#38bdf8', fillOpacity: 0.08 };
}

export function computeOvalParams(metrics: Pick<SubstormRiskData['metrics'], 'solar_wind'>, bayOnset: boolean, _score: number) {
  const newell60 = metrics?.solar_wind?.newell_avg_60m ?? 0;
  const newell30 = metrics?.solar_wind?.newell_avg_30m ?? 0;
  const newell = Math.max(newell60, newell30 * 0.85);

  let equatorward = -(65.5 - newell / 1800);
  equatorward = Math.max(equatorward, -76);
  equatorward = Math.min(equatorward, -44);
  if (bayOnset) equatorward = Math.min(equatorward, -47.2);

  const QUIET_BOUNDARY = -65.5;
  const QUIET_HALFWIDTH = 3.5;
  const poleward = QUIET_BOUNDARY - QUIET_HALFWIDTH;
  const halfWidth = equatorward - poleward;
  const boundary = equatorward;

  return { boundary, halfWidth };
}

export function lerpHex(c1: string, c2: string, t: number): string {
  const h = (hex: string) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const [r1, g1, b1] = h(c1);
  const [r2, g2, b2] = h(c2);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function ovalCoreColour(score: number): string {
  if (score >= 80) return lerpHex('#fb923c', '#f87171', (score - 80) / 20);
  if (score >= 65) return lerpHex('#f59e0b', '#fb923c', (score - 65) / 15);
  if (score >= 50) return lerpHex('#a3e635', '#f59e0b', (score - 50) / 15);
  if (score >= 30) return lerpHex('#34d399', '#a3e635', (score - 30) / 20);
  return '#34d399';
}

export function buildOvalBandLayers(poleward: number, halfWidth: number, score: number, bandLayers = 10) {
  const globalAlpha = Math.min(score / 20, 1);
  const core = ovalCoreColour(score);
  const edge = '#34d399';

  return Array.from({ length: bandLayers }, (_, i) => {
    const t0 = i / bandLayers;
    const t1 = (i + 1) / bandLayers;
    const g0 = poleward + t0 * halfWidth;
    const g1 = poleward + t1 * halfWidth;
    const midT = (t0 + t1) / 2;
    const envelope = Math.exp(-Math.pow((midT - 0.5) / 0.28, 2));
    const coreInfluence = Math.max(0, (score - 20) / 80);
    const distFromCentre = Math.abs(midT - 0.5) * 2;
    const colourT = (1 - distFromCentre) * coreInfluence;

    return {
      g0,
      g1,
      poly: buildBandPolygon(g0, g1, 3),
      colour: lerpHex(edge, core, colourT),
      alpha: envelope * 0.55 * globalAlpha,
    };
  });
}
