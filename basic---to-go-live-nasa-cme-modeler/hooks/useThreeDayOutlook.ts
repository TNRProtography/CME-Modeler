// The next few days: every tracked hole's forecast, and the three-hour
// visibility grid built from them, NOAA's Kp and the CME model. Shared by the
// days card and the NOAA 3-day panel, so the two show the same blocks.

import { useEffect, useMemo, useState } from 'react';
import { useForecast } from './useForecast';
import { resolveViewerLocation, type ViewerLocation } from '../utils/viewerLocation';
import { subscribeToChDetections, type ChStoreState } from '../utils/chDetectionStore';
import {
  forecastAllHoles, polarityForTrack, readHolePolarity, streamSourceFor, tracksFromStore,
} from '../utils/holeForecast';
import { buildForecastTimeline, type StreamSource } from '../utils/forecastTimeline';
import { buildOutlook } from '../utils/auroraOutlook';
import { parseNoaaKpForecast, type KpBlock } from '../utils/kpVisibility';
import { buildThreeDayGrid, type GridInputs } from '../utils/threeDayGrid';
import { sharedFetchJson } from '../utils/sharedFetch';
import { registerDatasetTicker } from '../utils/pollingScheduler';

/** The same feed the NOAA 3-day panel reads, shared with it. */
const NOAA_KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';

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

  // NOAA's Kp forecast, for the grid.
  const [kpBlocks, setKpBlocks] = useState<KpBlock[]>([]);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const blocks = parseNoaaKpForecast(await sharedFetchJson(NOAA_KP_URL, { maxAgeMs: 60000 }));
        if (live && blocks.length) setKpBlocks(blocks);
      } catch { /* the grid runs on the other two forecasts */ }
    };
    void load();
    const unregister = registerDatasetTicker('three-day-grid-kp', load, 5 * 60 * 1000);
    return () => { live = false; unregister(); };
  }, []);

  // The grid: every stream the tracker has reaching Earth, run hour by hour
  // through the chain, alongside NOAA and the CME model.
  const gridInputs = useMemo(() => {
    const streams = allHoles
      .map(({ track, forecast }) => streamSourceFor(track, forecast))
      .filter((s): s is StreamSource => s != null);
    const from = Math.floor(nowMs / 3600000) * 3600000 - 3600000;
    const holeOutlook = buildOutlook(buildForecastTimeline([], streams, {
      fromMs: from, toMs: nowMs + (horizonDays + 1) * 86400000, stepMs: 3600000,
    }));
    if (!kpBlocks.length && !streams.length && !forecast.outlook.length) return null;
    return {
      nowMs, latitude: location.latitude, longitude: location.longitude,
      kpBlocks, holeOutlook, cmeOutlook: forecast.outlook, days: horizonDays,
    } satisfies GridInputs;
  }, [allHoles, kpBlocks, forecast.outlook, nowMs, location, horizonDays]);
  const grid = useMemo(() => (gridInputs ? buildThreeDayGrid(gridInputs) : []), [gridInputs]);

  return { forecast, location, chState, nowMs, allHoles, grid, gridInputs };
}
