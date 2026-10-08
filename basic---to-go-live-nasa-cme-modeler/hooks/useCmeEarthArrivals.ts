// The CMEs the CME Visualization has reaching Earth (utils/cmeEarthArrivals),
// from the same CME list the visualization draws.
//
// One load and one refresh for every panel that asks - the 3-day forecast
// and the STEREO J-plot - so the two cannot disagree about which CMEs are
// coming or when.

import { useEffect, useState } from 'react';
import { cmeEarthArrival, type CmeEarthArrival } from '../utils/cmeEarthArrivals';
import { fetchCMEData } from '../services/nasaService';
import { registerDatasetTicker } from '../utils/pollingScheduler';

let current: CmeEarthArrival[] = [];
const listeners = new Set<(arrivals: CmeEarthArrival[]) => void>();

const load = async () => {
  try {
    const cmes = await fetchCMEData(7, '');
    current = cmes.map(cmeEarthArrival).filter((a): a is CmeEarthArrival => a != null);
    listeners.forEach((listener) => listener(current));
  } catch { /* no CME list: keep what there was */ }
};

export function useCmeEarthArrivals(): CmeEarthArrival[] {
  const [arrivals, setArrivals] = useState<CmeEarthArrival[]>(current);
  useEffect(() => {
    listeners.add(setArrivals);
    // The first panel to ask loads the list; the rest share it.
    if (listeners.size === 1) void load();
    else setArrivals(current);
    const unregister = registerDatasetTicker('three-day-cmes', load, 15 * 60 * 1000);
    return () => { listeners.delete(setArrivals); unregister(); };
  }, []);
  return arrivals;
}
