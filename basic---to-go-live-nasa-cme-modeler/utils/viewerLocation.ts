// Where the person actually is.
//
// The forecast page asks the browser for a position every time it mounts. That
// is fine there, but the sky calculations need a position on the solar
// activity page too, and prompting twice for the same thing - or silently
// getting nothing because the second prompt was dismissed - is not.
//
// So a position is remembered once and shared. The fallback is the latitude
// the rest of the app already calibrates its aurora score against, so a
// visitor who declines location still gets a sensible answer rather than a
// blank, and the answer says which it is.

/** What the aurora score is calibrated to, so it is the right thing to fall back to. */
export const DEFAULT_LATITUDE = -42.45;
export const DEFAULT_LONGITUDE = 171.21;

const STORAGE_KEY = 'sta-viewer-location-v1';
/** A position older than this is worth refreshing, though still usable meanwhile. */
const STALE_MS = 7 * 86400000;

export interface ViewerLocation {
  latitude: number;
  longitude: number;
  source: 'gps' | 'remembered' | 'default';
  atMs: number;
}

export const defaultLocation = (): ViewerLocation => ({
  latitude: DEFAULT_LATITUDE,
  longitude: DEFAULT_LONGITUDE,
  source: 'default',
  atMs: 0,
});

export function readCachedLocation(): ViewerLocation {
  try {
    if (typeof localStorage === 'undefined') return defaultLocation();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultLocation();
    const parsed = JSON.parse(raw);
    if (!Number.isFinite(parsed?.latitude) || !Number.isFinite(parsed?.longitude)) return defaultLocation();
    if (Math.abs(parsed.latitude) > 90 || Math.abs(parsed.longitude) > 180) return defaultLocation();
    return {
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      source: 'remembered',
      atMs: Number(parsed.atMs) || 0,
    };
  } catch {
    return defaultLocation();
  }
}

export function rememberLocation(latitude: number, longitude: number): ViewerLocation {
  const location: ViewerLocation = { latitude, longitude, source: 'gps', atMs: Date.now() };
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(location));
    }
  } catch { /* storage disabled */ }
  return location;
}

export const isStale = (location: ViewerLocation): boolean =>
  location.source === 'default' || Date.now() - location.atMs > STALE_MS;

/**
 * The remembered position, refreshed in the background if it is old.
 *
 * Never blocks and never throws: a declined or unavailable position leaves
 * whatever was already known, which is the point of remembering it.
 */
export function resolveViewerLocation(onUpdate?: (location: ViewerLocation) => void): ViewerLocation {
  const cached = readCachedLocation();

  if (isStale(cached) && typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const fresh = rememberLocation(position.coords.latitude, position.coords.longitude);
        onUpdate?.(fresh);
      },
      () => { /* declined or unavailable; the cached or default position stands */ },
      { maximumAge: 3600000, timeout: 8000, enableHighAccuracy: false },
    );
  }

  return cached;
}

/** How to describe where the numbers were worked out for. */
export function locationLabel(location: ViewerLocation): string {
  if (location.source === 'default') return 'the West Coast (no location set)';
  return `${Math.abs(location.latitude).toFixed(1)}°${location.latitude < 0 ? 'S' : 'N'}, `
       + `${Math.abs(location.longitude).toFixed(1)}°${location.longitude < 0 ? 'W' : 'E'}`;
}
