// The forecast, from the worker if it is there and from this device if not.
//
// The worker is the right place for it: one forecast, computed once, the same
// on every screen, and available to notifications that have no browser tab to
// live in. But it needs deploying, and until it is deployed the feature would
// simply not exist - so the same modules run here as a fallback.
//
// They are literally the same modules. That is the point of the physics being
// plain functions: the fallback cannot drift from the server because there is
// only one copy of the arithmetic. What differs is where it runs and what it
// can see, and the panel says which it got.

import { useEffect, useMemo, useState } from 'react';
import { buildForecastTimeline, type L1State, type StreamSource } from '../utils/forecastTimeline';
import { buildOutlook, type OutlookPoint } from '../utils/auroraOutlook';
import { chEarthConnection, chTiming } from '../utils/coronalHoleDynamics';
import { hssArrivalEnsemble, measurementConfidence } from '../utils/arrivalEnsemble';
import { buildTrackRecord, type ForecastScore, type TrackRecord } from '../utils/forecastScoring';
import { solarDiskOrientation } from '../utils/solarEphemeris';
import { buildChTracks } from '../utils/chTracking';
import {
  ensureChDetections, framesForTracking, getChState, numberTracks, subscribeToChDetections,
  type ChStoreState,
} from '../utils/chDetectionStore';
import { postSnapshotToWorker } from '../utils/coronalHoleHistory';

const FORECAST_WORKER = 'https://spot-the-aurora-forecast-worker.thenamesrock.workers.dev';
const RTSW_URL = 'https://imap-solar-data-test.thenamesrock.workers.dev/rtsw/merged-24h';
const SUVI_WORKER = 'https://suvi-difference-imagery.thenamesrock.workers.dev';

/**
 * Detection is only useful if it has happened, and it used to happen only on
 * the Solar Activity page. Opening the outlook from anywhere else therefore
 * showed nothing and told you to go and open another page first, which is not
 * a forecast - it is homework.
 *
 * So this drives detection itself when the store is empty or stale. The store
 * de-duplicates by frame, so if the dashboard has already done the work this
 * costs nothing.
 */
async function primeCoronalHoles(): Promise<void> {
  try {
    const res = await fetch(`${SUVI_WORKER}/api/state`);
    if (!res.ok) return;
    const json = await res.json();
    const frames = json?.sources?.suvi_195_primary?.frames ?? [];
    const cutoff = Date.now() - 12 * 3600000;
    const refs = frames
      .filter((f: any) => f?.ts && f?.url)
      .map((f: any) => ({
        url: f.url.startsWith('http') ? f.url : `${SUVI_WORKER}${f.url.startsWith('/') ? '' : '/'}${f.url}`,
        atMs: new Date(f.ts).getTime(),
      }))
      .filter((f: { atMs: number }) => f.atMs >= cutoff);
    if (refs.length > 0) await ensureChDetections(refs);
  } catch {
    // No imagery worker, no holes. The panel says so rather than hanging.
  }
}

export interface ForecastState {
  timeline: L1State[];
  outlook: OutlookPoint[];
  streams: StreamSource[];
  trackRecord: TrackRecord | null;
  source: 'worker' | 'device' | 'none';
  generatedAtMs: number | null;
  /** True when the coronal holes behind it are too old to trust. */
  stale: boolean;
  loading: boolean;
  /** True while a server re-run kicked off by this view is still going. */
  refreshing: boolean;
}

interface ObservedSample {
  atMs: number; speedKms: number | null; densityCm3: number | null;
  btNt: number | null; bzNt: number | null;
}

async function fetchObserved(): Promise<ObservedSample[]> {
  try {
    const res = await fetch(RTSW_URL);
    if (!res.ok) return [];
    const data = await res.json();
    const rows = Array.isArray(data) ? data : (data?.data ?? []);
    return rows
      .map((row: any) => ({
        atMs: new Date(row.time_tag ?? row.time_utc ?? row.time).getTime(),
        speedKms: Number(row.speed ?? row.proton_speed) || null,
        densityCm3: Number(row.density ?? row.proton_density) || null,
        btNt: Number(row.bt) || null,
        bzNt: Number(row.bz ?? row.bz_gsm) || null,
      }))
      .filter((s: ObservedSample) => Number.isFinite(s.atMs));
  } catch {
    return [];
  }
}

/** Holes older than this cannot un-stale the server forecast, so do not try. */
const SNAPSHOT_USEFUL_MS = 6 * 3600000;

/**
 * Give the server the holes this device just measured.
 *
 * The forecast is called stale when the coronal holes behind it are more than
 * six hours old, and they go stale because nothing publishes newer ones: the
 * snapshot POST lived only on the Solar Activity page, so the hourly cron kept
 * recomputing the same ageing holes. Detection already runs when this hook
 * mounts - it just had nowhere to send the result.
 *
 * Returns whether anything worth recomputing actually reached the server.
 */
async function publishNewestSnapshot(): Promise<boolean> {
  const { detections } = getChState();
  if (detections.length === 0) return false;

  const newest = detections.reduce((a, b) => (b.atMs > a.atMs ? b : a));
  if (newest.holes.length === 0) return false;
  if (Date.now() - newest.atMs > SNAPSHOT_USEFUL_MS) return false;

  return postSnapshotToWorker(newest.holes, newest.frameUrl, newest.atMs);
}

/**
 * Publish, recompute, read back.
 *
 * Opening the outlook is exactly the moment somebody wants current numbers,
 * so this asks for them rather than explaining why they are old. It runs only
 * when the stored forecast is missing or stale, because a run takes the best
 * part of a minute and there is nothing to gain from repeating a fresh one.
 *
 * It deliberately does not block the first paint: whatever is stored goes up
 * immediately and this swaps in behind it. The worker throttles manual runs to
 * one a minute and answers 429 inside that window - the right answer to two
 * tabs opening at once, since another client is already doing this work, so
 * read the result back rather than treating it as a failure.
 */
async function refreshWorkerForecast(): Promise<any | null> {
  try {
    await publishNewestSnapshot();
    const run = await fetch(`${FORECAST_WORKER}/run`);
    if (!run.ok && run.status !== 429) return null;
    const res = await fetch(`${FORECAST_WORKER}/forecast`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.ok ? data : null;
  } catch {
    // The panel keeps whatever it already had, and still says how old it is.
    return null;
  }
}

export function useForecast(enabled = true): ForecastState {
  const [chState, setChState] = useState<ChStoreState | null>(null);
  const [observed, setObserved] = useState<ObservedSample[]>([]);
  const [worker, setWorker] = useState<any | null>(null);
  const [scores, setScores] = useState<ForecastScore[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => subscribeToChDetections(setChState), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    (async () => {
      // Kick detection off immediately, in parallel with everything else, so
      // the outlook works from a cold start on any page.
      const priming = primeCoronalHoles();

      const [workerResult, observedResult] = await Promise.allSettled([
        fetch(`${FORECAST_WORKER}/forecast`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetchObserved(),
      ]);
      if (cancelled) return;
      if (workerResult.status === 'fulfilled' && workerResult.value?.ok) setWorker(workerResult.value);
      if (observedResult.status === 'fulfilled') setObserved(observedResult.value);

      // Only stop showing a spinner once there is either a server forecast or
      // some holes of our own to build one from.
      const stored = workerResult.status === 'fulfilled' ? workerResult.value : null;
      const haveWorker = !!stored?.ok;
      if (haveWorker) setLoading(false);
      else { await priming; if (!cancelled) setLoading(false); }

      // Nothing stored, or stored holes too old to stand behind: detect, hand
      // the result to the server and have it recompute. Not awaited by the
      // paint above, so the panel is already on screen while this happens.
      if (!haveWorker || stored.stale) {
        setRefreshing(true);
        (async () => {
          try {
            await priming;
            if (cancelled) return;
            const fresh = await refreshWorkerForecast();
            if (!cancelled && fresh) setWorker(fresh);
          } finally {
            if (!cancelled) setRefreshing(false);
          }
        })();
      }

      // The track record is only ever the server's: it needs a history no
      // single device has, and inventing a local one from this browser's few
      // observations would be the sort of number that looks authoritative and
      // means nothing.
      try {
        const res = await fetch(`${FORECAST_WORKER}/track-record`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          if (data?.ok) setScores(data.scores ?? []);
        }
      } catch { /* not deployed yet */ }
    })();

    return () => { cancelled = true; };
  }, [enabled]);

  return useMemo((): ForecastState => {
    const trackRecord = scores ? buildTrackRecord(scores) : null;

    if (worker?.timeline?.length) {
      return {
        timeline: worker.timeline,
        outlook: worker.outlook ?? buildOutlook(worker.timeline),
        streams: worker.streams ?? [],
        trackRecord,
        source: 'worker',
        generatedAtMs: worker.generatedAtMs ?? null,
        stale: !!worker.stale,
        loading: false,
        refreshing,
      };
    }

    if (!chState || chState.detections.length === 0) {
      return { timeline: [], outlook: [], streams: [], trackRecord,
               source: 'none', generatedAtMs: null, stale: true, loading, refreshing };
    }

    // Compute it here instead, from the holes this device has detected.
    const now = Date.now();
    const { b0 } = solarDiskOrientation(new Date(now));
    const tracks = buildChTracks(framesForTracking(chState));
    const numbers = numberTracks(tracks, now);

    const streams: StreamSource[] = [];
    for (const track of tracks) {
      if (!track.live) continue;
      const connection = chEarthConnection(track.latest.lat, b0);
      if (!connection.reachesEarth) continue;

      const timing = chTiming(track.latest.lon, track.lastSeenMs, now);
      const centralMeridianMs = now + timing.daysToCentralMeridian * 86400000;
      const speed = estimateSpeed(track.latest.widthDeg, track.latest.darkness);

      streams.push({
        id: `CH${numbers.get(track.key) ?? '?'}`,
        centralMeridianMs,
        peakSpeedKms: speed,
        widthDeg: track.latest.widthDeg,
        bySign: null,
        earthConnection: connection.factor,
      });
    }

    const timeline = buildForecastTimeline(observed, streams, {
      fromMs: now - 3 * 86400000,
      toMs: now + 7 * 86400000,
      stepMs: 3600000,
    });

    return {
      timeline,
      outlook: buildOutlook(timeline),
      streams,
      trackRecord,
      source: 'device',
      generatedAtMs: now,
      stale: false,
      loading,
      refreshing,
    };
  }, [worker, chState, observed, scores, loading, refreshing]);
}

/** Mirrors the width-and-darkness model the tracker uses. */
function estimateSpeed(widthDeg: number, darkness: number): number {
  const t = Math.max(0, Math.min(1, (widthDeg - 5) / 55));
  return Math.round(338 + Math.sqrt(t) * 337 + 90 * Math.max(0, Math.min(1, darkness)));
}

export { hssArrivalEnsemble, measurementConfidence };
