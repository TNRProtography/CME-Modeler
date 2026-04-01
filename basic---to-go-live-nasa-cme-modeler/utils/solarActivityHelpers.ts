export const NOAA_XRAY_FLUX_URLS = [
  'https://services.swpc.noaa.gov/json/goes/primary/xrays-7-day.json',
  'https://services.swpc.noaa.gov/json/goes/xrays-7-day.json',
  'https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json',
];

export const NOAA_PROTON_FLUX_URLS = [
  'https://services.swpc.noaa.gov/json/goes/primary/integral-protons-plot-7-day.json',
  'https://services.swpc.noaa.gov/json/goes/integral-protons-plot-7-day.json',
  'https://services.swpc.noaa.gov/json/goes/primary/integral-protons-plot-1-day.json',
];

export const NOAA_ACTIVE_REGIONS_TEXT_URL = 'https://services.swpc.noaa.gov/text/solar-regions.txt';
export const NOAA_SOLAR_PROBABILITIES_URL = 'https://services.swpc.noaa.gov/json/solar_probabilities.json';
export const NOAA_ACTIVE_REGIONS_URLS = [
  'https://services.swpc.noaa.gov/json/sunspot_report.json',
  'https://services.swpc.noaa.gov/json/solar_regions.json',
  'https://services.swpc.noaa.gov/products/solar-region-summary.json',
];

export const SUVI_131_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/131/latest.png';
export const SUVI_304_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/304/latest.png';
export const SUVI_195_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/195/latest.png';
export const SUVI_131_INDEX_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/131/';
export const SUVI_304_INDEX_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/304/';
export const SUVI_195_INDEX_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/195/';
export const SUVI_FRAME_INTERVAL_MINUTES = 4;
export const CCOR1_VIDEO_URL = 'https://services.swpc.noaa.gov/products/ccor1/mp4s/ccor1_last_24hrs.mp4';

const JSOC_HMI_BASE = 'https://jsoc1.stanford.edu/data/hmi/images/latest';
const NASA_SDO_BASE = 'https://sdo.gsfc.nasa.gov/assets/img/latest';

export const SDO_HMI_BC_1024_URL = `${JSOC_HMI_BASE}/HMI_latest_color_Mag_1024x1024.jpg`;
export const SDO_HMI_B_1024_URL = `${JSOC_HMI_BASE}/HMI_latest_Mag_1024x1024.gif`;
export const SDO_HMI_IF_1024_URL = `${JSOC_HMI_BASE}/HMI_latest_colInt_1024x1024.jpg`;
export const SDO_HMI_BC_4096_URL = `${JSOC_HMI_BASE}/HMI_latest_color_Mag_4096x4096.jpg`;
export const SDO_HMI_B_4096_URL = `${JSOC_HMI_BASE}/HMI_latest_Mag_4096x4096.gif`;
export const SDO_HMI_IF_4096_URL = `${JSOC_HMI_BASE}/HMI_latest_colInt_4096x4096.jpg`;

export const SDO_HMI_BC_1024_FALLBACK = `${NASA_SDO_BASE}/latest_1024_HMIBC.jpg`;
export const SDO_HMI_B_1024_FALLBACK = `${NASA_SDO_BASE}/latest_1024_HMIB.jpg`;
export const SDO_HMI_IF_1024_FALLBACK = `${NASA_SDO_BASE}/latest_1024_HMII.jpg`;
export const SDO_HMI_BC_4096_FALLBACK = `${NASA_SDO_BASE}/latest_4096_HMIBC.jpg`;
export const SDO_HMI_B_4096_FALLBACK = `${NASA_SDO_BASE}/latest_4096_HMIB.jpg`;
export const SDO_HMI_IF_4096_FALLBACK = `${NASA_SDO_BASE}/latest_4096_HMII.jpg`;

export const resolveSdoImageUrl = (rawUrl: string, _forceDirect?: boolean) => rawUrl;
export const REFRESH_INTERVAL_MS = 60 * 1000;
export const HMI_IMAGE_SIZE = 4096;
export const SDO_HMI_NATIVE_CX = 2048;
export const SDO_HMI_NATIVE_CY = 2048;
export const SDO_HMI_NATIVE_RADIUS = 1980;
export const DISK_LABEL_OFFSET_X_PX = 200;
export const DISK_LABEL_OFFSET_Y_PX = -200;
export const CLOSEUP_OFFSET_X_PX = 200;
export const CLOSEUP_OFFSET_Y_PX = -200;
export const ACTIVE_REGION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const ACTIVE_REGION_MIN_AREA_MSH = 0;
export const SOLAR_IMAGE_CACHE_TTL_MS = 60 * 60 * 1000;
export const solarImageCache = new Map<string, { url: string; fetchedAt: number }>();

const FETCH_TIMEOUT_MS = 12000;
const MAX_FETCH_RETRIES = 2;
const IMAGE_CONCURRENCY_LIMIT = 4;
let inFlightImageLoads = 0;
const queuedImageLoads: Array<() => void> = [];

export const devLog = (...args: unknown[]) => {
  if (!import.meta.env.DEV) return;
  console.info('[solar-preload]', ...args);
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class ProxyUnavailableError extends Error {
  constructor(url: string) {
    super(`Proxy unavailable (404) for ${url}`);
    this.name = 'ProxyUnavailableError';
  }
}

export const fetchWithTimeoutAndRetry = async (url: string, parseAs: 'json' | 'text' | 'blob' = 'json') => {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_FETCH_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: 'default' });
      if (!response.ok) {
        if (response.status === 404 && url.includes('/api/proxy/')) {
          throw new ProxyUnavailableError(url);
        }
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      if (parseAs === 'json') return await response.json();
      if (parseAs === 'blob') return await response.blob();
      return await response.text();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown fetch error');
      if (lastError instanceof ProxyUnavailableError) break;
      if (attempt < MAX_FETCH_RETRIES) await wait(350 * (attempt + 1));
    } finally {
      window.clearTimeout(timeout);
    }
  }
  throw lastError ?? new Error(`Failed to fetch ${url}`);
};

export const enqueueImageLoad = (task: () => void) => {
  if (inFlightImageLoads < IMAGE_CONCURRENCY_LIMIT) {
    inFlightImageLoads++;
    task();
    return;
  }
  queuedImageLoads.push(task);
};

export const extractTargetUrlFromProxy = (url: string): string | null => {
  try {
    const parsed = new URL(url, window.location.origin);
    const encoded = parsed.searchParams.get('url');
    return encoded ? decodeURIComponent(encoded) : null;
  } catch {
    return null;
  }
};

export const isLikelySameOriginOrProxy = (url: string): boolean => {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin || parsed.pathname.startsWith('/api/proxy/');
  } catch {
    return false;
  }
};

export const releaseImageLoadSlot = () => {
  inFlightImageLoads = Math.max(0, inFlightImageLoads - 1);
  const next = queuedImageLoads.shift();
  if (next) {
    inFlightImageLoads++;
    next();
  }
};

export const isValidSunspotRegion = (value: any): value is { region: string } & Record<string, unknown> => {
  return Boolean(value && typeof value === 'object' && typeof value.region === 'string' && value.region.length > 0);
};

export const isEarthVisibleCoordinate = (latitude: number | null, longitude: number | null): boolean => {
  if (latitude === null || longitude === null) return false;
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 90;
};

export const isEarthFacingCoordinate = (latitude: number | null, longitude: number | null): boolean => {
  if (latitude === null || longitude === null) return false;
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 80;
};

export const parseNoaaUtcTimestamp = (value: unknown): number | null => {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const normalized = hasExplicitZone ? raw : `${raw}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

export const getNzOffsetMs = (timestamp: number): number => {
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland',
    timeZoneName: 'shortOffset',
    hour: '2-digit',
  }).formatToParts(new Date(timestamp));
  const label = parts.find((part) => part.type === 'timeZoneName')?.value || 'UTC+0';
  const match = label.match(/(?:GMT|UTC)([+-])(\d{1,2})(?::(\d{2}))?/i);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]) || 0;
  const minutes = Number(match[3] || '0');
  return sign * ((hours * 60 + minutes) * 60 * 1000);
};

export const toNzEpochMs = (timestamp: number): number => timestamp + getNzOffsetMs(timestamp);

export const normalizeSolarLongitude = (value: number | null): number | null => {
  if (value === null || !Number.isFinite(value)) return null;
  let normalized = value;
  if (Math.abs(normalized) > 360) return null;
  if (normalized > 180) normalized -= 360;
  if (normalized < -180) normalized += 360;
  return Math.max(-180, Math.min(180, normalized));
};
