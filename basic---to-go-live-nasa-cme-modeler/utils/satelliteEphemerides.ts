import { AU_IN_KM, SCENE_SCALE } from '../constants';

export const RTSW_EPHEMERIDES_URL = 'https://services.swpc.noaa.gov/json/rtsw/rtsw_ephemerides_1h.json';

export interface SatelliteEphemeris {
  source: string;
  timeTag: string;
  active: boolean;
  xGseKm: number;
  yGseKm: number;
  zGseKm: number;
  vxGseKms: number | null;
  vyGseKms: number | null;
  vzGseKms: number | null;
}

type RawRtswEphemeris = {
  time_tag?: string;
  active?: boolean;
  source?: string;
  x_gse?: number | null;
  y_gse?: number | null;
  z_gse?: number | null;
  vx_gse?: number | null;
  vy_gse?: number | null;
  vz_gse?: number | null;
};

const normalizeSourceKey = (source: string): string => source.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

const toFiniteNumber = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

const toNullableFiniteNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  return toFiniteNumber(value);
};

const parseRtswEphemeris = (row: RawRtswEphemeris): SatelliteEphemeris | null => {
  const source = typeof row.source === 'string' ? row.source.trim() : '';
  if (!source || !row.time_tag) return null;

  const xGseKm = toFiniteNumber(row.x_gse);
  const yGseKm = toFiniteNumber(row.y_gse);
  const zGseKm = toFiniteNumber(row.z_gse);
  const timeMs = Date.parse(row.time_tag);
  if (xGseKm === null || yGseKm === null || zGseKm === null || Number.isNaN(timeMs)) return null;

  return {
    source: normalizeSourceKey(source),
    timeTag: row.time_tag,
    active: row.active === true,
    xGseKm,
    yGseKm,
    zGseKm,
    vxGseKms: toNullableFiniteNumber(row.vx_gse),
    vyGseKms: toNullableFiniteNumber(row.vy_gse),
    vzGseKms: toNullableFiniteNumber(row.vz_gse),
  };
};

export const selectLatestSatelliteEphemerides = (raw: unknown): Record<string, SatelliteEphemeris> => {
  if (!Array.isArray(raw)) return {};

  const latest: Record<string, SatelliteEphemeris> = {};
  for (const row of raw) {
    const parsed = parseRtswEphemeris(row as RawRtswEphemeris);
    if (!parsed) continue;

    const current = latest[parsed.source];
    if (!current) {
      latest[parsed.source] = parsed;
      continue;
    }

    const parsedTime = Date.parse(parsed.timeTag);
    const currentTime = Date.parse(current.timeTag);
    if (parsedTime > currentTime || (parsedTime === currentTime && parsed.active && !current.active)) {
      latest[parsed.source] = parsed;
    }
  }

  return latest;
};

export const fetchLatestSatelliteEphemerides = async (): Promise<Record<string, SatelliteEphemeris>> => {
  const response = await fetch(`${RTSW_EPHEMERIDES_URL}?_=${Date.now()}`);
  if (!response.ok) throw new Error(`NOAA RTSW ephemerides HTTP ${response.status}`);
  return selectLatestSatelliteEphemerides(await response.json());
};

export const getEphemerisForSource = (
  ephemerides: Record<string, SatelliteEphemeris>,
  sourceAliases: string[]
): SatelliteEphemeris | null => {
  for (const alias of sourceAliases) {
    const match = ephemerides[normalizeSourceKey(alias)];
    if (match) return match;
  }
  return null;
};

export const gseKilometresToSceneOffset = (
  ephemeris: SatelliteEphemeris,
  earthLongitudeRad: number
): { dx: number; dy: number; dz: number } => {
  const scale = SCENE_SCALE / AU_IN_KM;
  const xSunward = ephemeris.xGseKm * scale;
  const yDusk = ephemeris.yGseKm * scale;
  const zNorth = ephemeris.zGseKm * scale;

  const earthDirX = Math.sin(earthLongitudeRad);
  const earthDirZ = Math.cos(earthLongitudeRad);
  const sunwardX = -earthDirX;
  const sunwardZ = -earthDirZ;
  const duskX = sunwardZ;
  const duskZ = -sunwardX;

  return {
    dx: sunwardX * xSunward + duskX * yDusk,
    dy: zNorth,
    dz: sunwardZ * xSunward + duskZ * yDusk,
  };
};
