import React, { lazy } from 'react';

const CHUNK_RELOAD_KEY = 'sta_chunk_reload_attempted';

export function retryLazyLoad<T extends React.ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return lazy(() =>
    importFn().catch((err: unknown) => {
      const isChunkError =
        err instanceof Error &&
        (err.message.includes('Failed to fetch dynamically imported module') ||
          err.message.includes('Importing a module script failed') ||
          err.message.includes('error loading dynamically imported module'));

      if (isChunkError && !sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
        window.location.reload();
        return new Promise<{ default: T }>(() => {});
      }

      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      throw err;
    }),
  );
}

export type InitialLoadTaskKey =
  | 'forecastData'
  | 'forecastApi'
  | 'solarWindApi'
  | 'goes18Api'
  | 'goes19Api'
  | 'ipsApi'
  | 'nzMagApi'
  | 'solarData'
  | 'solarXray'
  | 'solarProton'
  | 'solarFlares'
  | 'solarRegions'
  | 'modelerCmeData';

export const FORECAST_INITIAL_TASKS: InitialLoadTaskKey[] = [
  'forecastApi',
  'solarWindApi',
  'goes18Api',
  'goes19Api',
];

export const SOLAR_INITIAL_TASKS: InitialLoadTaskKey[] = [
  'solarData',
  'solarXray',
  'solarProton',
  'solarFlares',
  'solarRegions',
];

export const MODELER_INITIAL_TASKS: InitialLoadTaskKey[] = ['modelerCmeData'];

export const getInitialRequiredTasks = (page: 'forecast' | 'modeler' | 'solar-activity'): Set<InitialLoadTaskKey> => {
  switch (page) {
    case 'forecast':
      return new Set(FORECAST_INITIAL_TASKS);
    case 'solar-activity':
      return new Set(SOLAR_INITIAL_TASKS);
    case 'modeler':
    default:
      return new Set(MODELER_INITIAL_TASKS);
  }
};

export const logDev = (...args: unknown[]) => {
  if (!import.meta.env.DEV) return;
  console.info('[preload]', ...args);
};

export const BANNER_XRAY_URLS = [
  'https://services.swpc.noaa.gov/json/goes/primary/xrays-7-day.json',
  'https://services.swpc.noaa.gov/json/goes/xrays-7-day.json',
  'https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json',
];

export const parseLatestShortBandFlux = (raw: any[]): number | null => {
  if (!Array.isArray(raw)) return null;

  const latestByTimestamp = new Map<number, number>();
  raw.forEach((row: any) => {
    if (row?.energy !== '0.1-0.8nm') return;
    const t = new Date(row.time_tag).getTime();
    const flux = Number.parseFloat(row.flux);
    if (!Number.isFinite(t) || !Number.isFinite(flux)) return;
    latestByTimestamp.set(t, flux);
  });

  if (!latestByTimestamp.size) return null;
  const latestTs = Math.max(...latestByTimestamp.keys());
  return latestByTimestamp.get(latestTs) ?? null;
};
