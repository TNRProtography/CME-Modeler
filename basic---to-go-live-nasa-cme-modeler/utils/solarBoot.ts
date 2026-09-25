// The solar page's core feeds, started as soon as the app's code runs when
// that is the page being opened.
//
// The solar dashboard is a large page, and its data requests used to go out
// from its mount effects - after its code had downloaded, and after its
// first render and paint, which on a phone is well over a second in. Started
// here instead, they run while the page's code downloads and renders, and
// the dashboard takes them over when it asks (utils/sharedFetch, and the
// incremental series' own sharing).
//
// index.html does the same for the forecast page, before any of the app's
// code has arrived; these cannot go there because the X-ray and proton
// series top up what this device already holds, which only the app can read.

import { fetchGoesProtons, fetchGoesXrays } from './goesSeries';
import { fetchSharpByRegion } from './sharpPositions';
import { sharedFetchText } from './sharedFetch';
import { fetchFlareData } from '../services/nasaService';

export const SOLAR_BOOT_URLS = {
  regionsText: 'https://services.swpc.noaa.gov/text/solar-regions.txt',
  sunspotReport: 'https://services.swpc.noaa.gov/json/sunspot_report.json',
  regionsJson: 'https://services.swpc.noaa.gov/json/solar_regions.json',
  probabilities: 'https://services.swpc.noaa.gov/json/solar_probabilities.json',
} as const;

let started = false;

export function startSolarBoot(): void {
  if (started) return;
  started = true;
  const quiet = (p: Promise<unknown>) => { p.catch(() => {}); };
  // The latest hours of each series: what the page opens on (see
  // SolarActivityDashboard's runAllUpdates).
  quiet(fetchGoesXrays('primary', { recentOnly: true }));
  quiet(fetchGoesXrays('secondary', { recentOnly: true }));
  quiet(fetchGoesProtons('primary', { recentOnly: true }));
  quiet(fetchFlareData());
  quiet(fetchSharpByRegion());
  for (const url of Object.values(SOLAR_BOOT_URLS)) quiet(sharedFetchText(url, { timeoutMs: 15000 }));
}
