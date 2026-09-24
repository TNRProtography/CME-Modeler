// The GOES series the app charts, each kept for as long as it is shown and
// topped up from NOAA's shortest file that covers what is missing (see
// utils/incrementalSeries). Every panel that wants one of these asks here,
// so the whole app makes one small request per refresh instead of each
// panel downloading the full file.

import { fetchIncrementalSeries, goesVariants } from './incrementalSeries';

const GOES = 'https://services.swpc.noaa.gov/json/goes';
const DAY = 86400000;

export interface GoesRow {
  time_tag: string;
  energy: string;
  flux: number;
  satellite?: number;
}

const slim = (r: any): GoesRow => ({
  time_tag: r.time_tag, energy: r.energy, flux: r.flux,
  ...(typeof r.satellite === 'number' ? { satellite: r.satellite } : {}),
});

async function fetchRows(url: string): Promise<GoesRow[]> {
  const res = await fetch(`${url}?_=${Date.now()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`Not a series: ${url}`);
  return data.map(slim);
}

const goesSeries = (sat: 'primary' | 'secondary', name: string, days: 1 | 7) =>
  fetchIncrementalSeries<GoesRow>({
    key: `goes:${sat}:${name}`,
    variants: goesVariants(`${GOES}/${sat}`, name, days === 7 ? '7-day' : '1-day'),
    retentionMs: days * DAY,
    timeOf: (r) => Date.parse(r.time_tag),
    idOf: (r) => `${r.time_tag}|${r.energy}|${r.satellite ?? ''}`,
    fetchRows,
  });

/** A week of GOES X-ray flux, both bands. */
export const fetchGoesXrays = (sat: 'primary' | 'secondary' = 'primary') => goesSeries(sat, 'xrays', 7);

/** A week of GOES integral proton flux, every energy. */
export const fetchGoesProtons = (sat: 'primary' | 'secondary' = 'primary') => goesSeries(sat, 'integral-protons-plot', 7);

export interface GoesMagRow { time_tag: string; Hp: number | null }

/** A day of GOES magnetometer Hp, for the substorm read. */
export const fetchGoesMagnetometer = (sat: 'primary' | 'secondary' = 'primary') =>
  fetchIncrementalSeries<GoesMagRow>({
    key: `goes:${sat}:magnetometers`,
    variants: goesVariants(`${GOES}/${sat}`, 'magnetometers', '1-day'),
    retentionMs: DAY,
    timeOf: (r) => Date.parse(r.time_tag),
    idOf: (r) => r.time_tag,
    fetchRows: async (url) => {
      const res = await fetch(`${url}?_=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error(`Not a series: ${url}`);
      return data.map((r: any) => ({ time_tag: r.time_tag, Hp: r.Hp ?? null }));
    },
  });
