// The next few days: every tracked hole's forecast, and the three-hour
// visibility grid built from them and the CME model. Shared by the
// days card and the 3-day aurora forecast panel, so the two show the same blocks.

import { useEffect, useMemo, useState } from 'react';
import { useForecast } from './useForecast';
import { resolveViewerLocation, type ViewerLocation } from '../utils/viewerLocation';
import { subscribeToChDetections, type ChStoreState } from '../utils/chDetectionStore';
import {
  forecastAllHoles, polarityForTrack, readHolePolarity, streamSourceFor, tracksFromStore,
} from '../utils/holeForecast';
import { buildForecastTimeline, type StreamSource } from '../utils/forecastTimeline';
import { buildOutlook } from '../utils/auroraOutlook';
import type { KpBlock } from '../utils/kpVisibility';
import { cmeEarthArrival, cmeOutlook, type CmeEarthArrival } from '../utils/cmeEarthArrivals';
import { fetchCMEData } from '../services/nasaService';
import { registerDatasetTicker } from '../utils/pollingScheduler';
import { buildThreeDayGrid, type GridInputs } from '../utils/threeDayGrid';

export function useThreeDayOutlook(horizonDays = 3) {
  // useForecast also primes coronal hole detection on this page, so the
  // tracker's store fills even if the tracker has never been opened here.
  const forecast = useForecast();
  const [location, setLocation] = useState<ViewerLocation>(() => resolveViewerLocation());
  useEffect(() => { resolveViewerLocation(setLocation); }, []);
  const [chState, setChState] = useState<ChStoreState | null>(null);
  useEffect(() => subscribeToChDetections(setChState), []);
  // Arrival countdowns and "is it still due" move with the clock.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 5 * 60000);
    return () => clearInterval(id);
  }, []);

  // Every tracked hole, forecast once by the tracker's own function.
  const allHoles = useMemo(() => {
    if (!chState) return [];
    const tracks = tracksFromStore(chState);
    const newest = chState.detections[chState.detections.length - 1]?.atMs ?? 0;
    const shared = readHolePolarity(nowMs);
    return forecastAllHoles(tracks, {
      nowMs, latestFrameMs: newest,
      latitude: location.latitude, longitude: location.longitude,
      polarityOf: (t) => (shared ? polarityForTrack(t, shared.byHoleId, shared.atMs) : null),
    });
  }, [chState, nowMs, location]);

  // No NOAA Kp: the forecast is the app's own, the tracker's streams and the CME model.
  const kpBlocks: KpBlock[] = [];

  // CMEs: the ones the CME Visualization has touching Earth (utils/cmeEarthArrivals).
  const [cmeArrivals, setCmeArrivals] = useState<CmeEarthArrival[]>([]);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const cmes = await fetchCMEData(7, '');
        if (!live) return;
        setCmeArrivals(cmes.map(cmeEarthArrival).filter((a): a is CmeEarthArrival => a != null));
      } catch { /* no CME list: the forecast runs on the coronal hole streams */ }
    };
    void load();
    const unregister = registerDatasetTicker('three-day-cmes', load, 15 * 60 * 1000);
    return () => { live = false; unregister(); };
  }, []);

  // The grid: every stream the tracker has reaching Earth, run hour by hour
  // through the chain, alongside the CME model.
  const gridInputs = useMemo(() => {
    const streams = allHoles
      .map(({ track, forecast }) => streamSourceFor(track, forecast))
      .filter((s): s is StreamSource => s != null);
    const from = Math.floor(nowMs / 3600000) * 3600000 - 3600000;
    const holeOutlook = buildOutlook(buildForecastTimeline([], streams, {
      fromMs: from, toMs: nowMs + (horizonDays + 1) * 86400000, stepMs: 3600000,
    }));
    if (!streams.length && !cmeArrivals.length && !chState) return null;
    return {
      nowMs, latitude: location.latitude, longitude: location.longitude,
      kpBlocks, holeOutlook, days: horizonDays,
      cmeOutlook: cmeOutlook(cmeArrivals, from, nowMs + (horizonDays + 1) * 86400000),
    } satisfies GridInputs;
  }, [allHoles, cmeArrivals, nowMs, location, horizonDays, chState]);
  const grid = useMemo(() => (gridInputs ? buildThreeDayGrid(gridInputs) : []), [gridInputs]);

  return { forecast, location, chState, nowMs, allHoles, grid, gridInputs, cmeArrivals };
}
