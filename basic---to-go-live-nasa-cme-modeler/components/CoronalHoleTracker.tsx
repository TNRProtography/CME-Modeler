// The Coronal Hole Tracker.
//
// The sunspot tracker answers "might this go off". This one answers a question
// that does not need anything to happen: a coronal hole is already leaking
// wind, and a few days after it crosses the middle of the disk that wind gets
// here. So the panel is built around when and how fast, rather than around
// probabilities.
//
// Holes come from the shared detection store, which runs the detector once per
// frame at roughly two-hour spacing and keeps a week of compact records. The
// week matters: a hole takes a fortnight to cross the disk and its stream is
// still arriving days after it has turned out of sight, so a hole that rotated
// off on Tuesday is still listed on Friday with the reason it is no longer
// visible - rather than vanishing from the app as though it never existed.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readImagePixels } from '../utils/imagePixels';
import { estimateHssSpeedFromChWidthAndDarkness } from '../utils/solarWindModel';
import {
  chEarthConnection, chGrowth, chOutlineAt, chSpeedForEarth, chTiming,
  hssArrivalMs, type ChSample,
} from '../utils/coronalHoleDynamics';
import {
  classifyChPolarity, samplePolygonField, sectorSeasonNote,
  type ChPolarityResult,
} from '../utils/coronalHolePolarity';
import { buildChTracks, chDisappearance, type ChTrack, type TrackedHole } from '../utils/chTracking';
import {
  detectionNear, drawableHoles, framesForTracking, numberTracks,
  type ChDetection, type FrameRef,
} from '../utils/chDetectionStore';
import { useCoronalHoleDetections } from '../hooks/useCoronalHoleDetections';
import CoronalHoleOverlay, { holeColour } from './CoronalHoleOverlay';
import SunspotLabelOverlay from './SunspotLabelOverlay';
import { buildRegionLabels, type RegionInput } from '../utils/regionLabels';
import { detectSolarDiskGeometry, diskFromFraction, longitudeAt } from '../utils/solarDisk';
import { solarDiskOrientation } from '../utils/solarEphemeris';
import { frameSpanHours } from '../utils/framePlayback';
import { bestSkyWithin, skyConditionsAt, visibilityOutlook } from '../utils/skyConditions';
import { describeSpread, hssArrivalEnsemble, measurementConfidence } from '../utils/arrivalEnsemble';
import { bySignForPolarity, rmWindows, windowsDuring } from '../utils/rmWindows';
import { locationLabel, resolveViewerLocation, type ViewerLocation } from '../utils/viewerLocation';

const SUVI_DIFF_WORKER_BASE = 'https://suvi-difference-imagery.thenamesrock.workers.dev';
/**
 * Where to get a line-of-sight magnetogram, best first.
 *
 * Greyscale only: mid-grey is zero field, white is toward us, black is away.
 * That convention is unambiguous and has not changed, whereas a colour map is
 * a rendering choice that can be retuned upstream - and reading it backwards
 * would invert every conclusion while still looking entirely plausible.
 */
const MAGNETOGRAM_SOURCES = [
  { label: 'JSOC 1024', url: 'https://jsoc1.stanford.edu/data/hmi/images/latest/HMI_latest_Mag_1024x1024.gif' },
  { label: 'SDO 1024', url: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_HMIB.jpg' },
  { label: 'SDO 512', url: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_HMIB.jpg' },
] as const;

const DAY_MS = 86400000;
const WINDOW_OPTIONS = [6, 12, 24] as const;
const SPEED_OPTIONS = [0.5, 1, 2, 5, 10] as const;

interface WorkerFrame { key: string; ts: string; url: string }

const fmtNz = (ms: number | null | undefined): string => {
  if (ms == null || !Number.isFinite(ms)) return 'Unknown';
  return new Date(ms).toLocaleString('en-NZ', {
    timeZone: 'Pacific/Auckland', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
};

const fmtRelative = (ms: number): string => {
  const hours = (ms - Date.now()) / 3600000;
  if (Math.abs(hours) < 1) return 'within the hour';
  if (hours < 0) return `${-hours < 48 ? `${Math.round(-hours)} hours` : `${(-hours / 24).toFixed(1)} days`} ago`;
  return hours < 48 ? `in ${Math.round(hours)} hours` : `in ${(hours / 24).toFixed(1)} days`;
};

/** A live countdown, which is the one number people actually watch. */
const fmtCountdown = (targetMs: number, nowMs: number): string => {
  const left = targetMs - nowMs;
  if (left <= 0) return 'Arriving now';
  const days = Math.floor(left / DAY_MS);
  const hours = Math.floor((left % DAY_MS) / 3600000);
  const mins = Math.floor((left % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  return `${hours}h ${mins}m`;
};

/**
 * The bands are the ones the wind itself falls into at 1 AU, not the CME
 * bands. A CME at 500 km/s is slow; a stream at 500 km/s is a decent one.
 * They are different populations and sharing a scale would flatter every hole.
 */
const speedBand = (kms: number): { label: string; colour: string; note: string } => {
  if (kms < 400) return { label: 'Slow', colour: 'text-neutral-300', note: 'Ordinary background wind. Enough to unsettle the field, rarely enough on its own.' };
  if (kms < 500) return { label: 'Moderate', colour: 'text-yellow-300', note: 'A moderate stream. Worth watching if the field turns south when it arrives.' };
  if (kms < 600) return { label: 'Fast', colour: 'text-orange-300', note: 'A fast stream. These are the ones that produce most coronal hole aurora.' };
  return { label: 'Very fast', colour: 'text-red-400', note: 'A strong stream, capable of a good night by itself if the field cooperates.' };
};

export interface CoronalHoleTrackerProps {
  onOpenModal?: (id: string) => void;
  /** NOAA sunspot regions, for the optional overlay. */
  regions?: RegionInput[];
  /** Opens the 3D visualisation with the coronal hole and HSS layer on. */
  onViewInVisualisation?: () => void;
}

const CoronalHoleTracker: React.FC<CoronalHoleTrackerProps> = ({
  onOpenModal, regions = [], onViewInVisualisation,
}) => {
  const [frames, setFrames] = useState<WorkerFrame[]>([]);
  const [framesError, setFramesError] = useState<string | null>(null);
  const [windowHours, setWindowHours] = useState<number>(12);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Off by default. The holes are the subject here, and a disk covered in
  // region labels the moment the panel opens is noise until it is asked for.
  const [showSunspots, setShowSunspots] = useState(false);

  const [polarity, setPolarity] = useState<Record<string, ChPolarityResult>>({});
  const [polarityError, setPolarityError] = useState<string | null>(null);
  const [polarityAttempt, setPolarityAttempt] = useState(0);

  const [boxSize, setBoxSize] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [location, setLocation] = useState<ViewerLocation>(() => resolveViewerLocation());

  // Asked for once and remembered, so the forecast page and this one do not
  // each prompt for the same position.
  useEffect(() => { resolveViewerLocation(setLocation); }, []);

  const boxRef = useRef<HTMLDivElement | null>(null);

  const resolveUrl = useCallback((url: string | null | undefined): string | null => {
    if (!url) return null;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `${SUVI_DIFF_WORKER_BASE}${url.startsWith('/') ? '' : '/'}${url}`;
  }, []);

  // ── frames ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${SUVI_DIFF_WORKER_BASE}/api/state`);
        const json = await res.json();
        if (cancelled) return;
        const all: WorkerFrame[] = json?.sources?.suvi_195_primary?.frames ?? [];
        setFrames(all.filter((f) => f?.ts && f?.url));
        setFramesError(null);
      } catch {
        if (!cancelled) setFramesError('Could not reach the SUVI imagery worker.');
      }
    };
    load();
    const id = setInterval(load, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // A ticking clock for the countdown, once a minute. Anything faster would
  // re-render the panel for a number that only changes every sixty seconds.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  const windowFrames = useMemo(() => {
    const cutoff = Date.now() - windowHours * 3600 * 1000;
    const within = frames.filter((f) => new Date(f.ts).getTime() >= cutoff);
    // Same rule the imagery panel uses: if clock skew filters everything out,
    // showing frames beats showing an empty box.
    return (within.length >= 2 ? within : frames)
      .slice()
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  }, [frames, windowHours]);

  const frameRefs = useMemo((): FrameRef[] => windowFrames
    .map((f) => ({ url: resolveUrl(f.url) ?? '', atMs: new Date(f.ts).getTime() }))
    .filter((f) => f.url), [windowFrames, resolveUrl]);

  const store = useCoronalHoleDetections(frameRefs);

  const clampedIndex = Math.min(frameIndex, Math.max(0, windowFrames.length - 1));
  const activeFrame = windowFrames[clampedIndex] ?? null;
  const activeFrameMs = activeFrame ? new Date(activeFrame.ts).getTime() : Date.now();
  const activeUrl = resolveUrl(activeFrame?.url);

  // Land on the newest frame, so opening the panel shows now.
  const lastWindowKey = useRef<string>('');
  useEffect(() => {
    const key = `${windowHours}:${windowFrames.length}`;
    if (key === lastWindowKey.current || windowFrames.length === 0) return;
    lastWindowKey.current = key;
    setFrameIndex(windowFrames.length - 1);
  }, [windowHours, windowFrames.length]);

  // ── playback ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing || windowFrames.length < 2) return;
    const interval = Math.max(40, Math.round(220 / speed));
    const id = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % windowFrames.length);
    }, interval);
    return () => clearInterval(id);
    // Keyed on the frame COUNT, not the array: a poll returning the same
    // frames must not restart playback.
  }, [playing, windowFrames.length, speed]);

  // ── tracks ────────────────────────────────────────────────────────────────
  const tracks = useMemo(
    () => buildChTracks(framesForTracking(store)),
    [store.history, store.detections],
  );

  // Numbers come from the persistent registry, not from position in a list.
  // A hole keeps the same number across reloads, across window changes, and
  // across the frames where the detector missed it.
  const chNumbers = useMemo(() => numberTracks(tracks), [tracks]);
  const numberOf = useCallback((trackKey: string) => chNumbers.get(trackKey), [chNumbers]);
  const labelFor = useCallback(
    (track: { key: string }) => `CH${chNumbers.get(track.key) ?? '?'}`, [chNumbers]);

  const latestFrameMs = store.detections.length > 0
    ? store.detections[store.detections.length - 1].atMs
    : 0;

  const selectedTrack: ChTrack<TrackedHole> | null = useMemo(() => {
    if (tracks.length === 0) return null;
    return tracks.find((t) => t.key === selectedKey) ?? tracks[0];
  }, [tracks, selectedKey]);

  const detectionForFrame: ChDetection | null = useMemo(
    () => detectionNear(store.detections, activeFrameMs),
    [store.detections, activeFrameMs],
  );

  const drawables = useMemo(
    () => drawableHoles(store, tracks, activeFrameMs),
    [store, tracks, activeFrameMs],
  );

  // ── the displayed image ───────────────────────────────────────────────────
  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (!img.naturalWidth || !img.naturalHeight) return;
    setNatural({ width: img.naturalWidth, height: img.naturalHeight });
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setBoxSize({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    setBoxSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Sunspot regions, using the detector's disk so they line up with the holes.
  //
  // The geometry has to be in the image's OWN pixels, not the displayed ones.
  // buildRegionLabels does the letterboxing itself - it multiplies by
  // rect.scale and adds the rect offset - so handing it a geometry already
  // scaled to the display applies that shrink twice and piles every label into
  // the top-left corner, well off the disk.
  const regionLabels = useMemo(() => {
    if (!showSunspots || !detectionForFrame || !natural || !boxSize.width) return [];
    return buildRegionLabels(regions, {
      geometry: diskFromFraction(detectionForFrame.disk, natural),
      imageNatural: natural,
      box: boxSize,
      atMs: activeFrameMs,
    });
  }, [showSunspots, regions, detectionForFrame, natural, boxSize, activeFrameMs]);

  // ── polarity from the magnetogram ─────────────────────────────────────────
  const latestDetection = store.detections.length > 0
    ? store.detections[store.detections.length - 1]
    : null;

  useEffect(() => {
    if (!latestDetection || latestDetection.holes.length === 0) return;
    let cancelled = false;

    (async () => {
      setPolarityError(null);
      // Through the proxy, at full resolution. Halving a magnetogram averages
      // neighbouring positive and negative network elements into each other,
      // and those cancel - which erodes the exact signal being measured.
      //
      // Several sources, because this is the one input with no CORS headers
      // anywhere in the chain, so there is no fallback path that works when
      // the proxy does not. The reasons are kept and shown: "could not be
      // read" on its own is not something anybody can act on.
      let image = null;
      const failures: string[] = [];
      for (const source of MAGNETOGRAM_SOURCES) {
        try { image = await readImagePixels(source.url); break; }
        catch (err) {
          failures.push(`${source.label}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (cancelled) return;
      if (!image) {
        // Every source failing the same way is worth naming, because there is
        // exactly one cause and one fix. Displaying an image needs no CORS;
        // reading its pixels does, and no observatory sends those headers. So
        // this depends entirely on the app's own image proxy, and if that is
        // not answering there is no fallback to have.
        const proxyDown = failures.every((f) => /not deployed at that address|text\/html/.test(f));
        setPolarityError(proxyDown
          ? 'Polarity needs to read the magnetogram\u2019s pixels, and every route to them answered with a web page '
            + 'instead of an image \u2013 which means the image proxy is not deployed at this address. Showing an '
            + 'image needs no permission; reading it does, and no observatory sends the header that would allow it '
            + 'directly. Deploying worker/index.ts (it already allows both HMI hosts) is the whole fix.'
          : `The HMI magnetogram could not be read, so polarity is unavailable. ${failures.join(' | ')}`);
        return;
      }

      const geom = detectSolarDiskGeometry(image.data, image.width, image.height);
      if (cancelled) return;
      if (!geom) {
        setPolarityError('The solar disk could not be found in the magnetogram.');
        return;
      }
      const { b0, p } = solarDiskOrientation(new Date());

      const next: Record<string, ChPolarityResult> = {};
      for (const hole of latestDetection.holes) {
        const outline = chOutlineAt(hole, latestDetection.atMs, Date.now());
        const lon = longitudeAt(hole.lon, latestDetection.atMs, Date.now());
        const inside = samplePolygonField(image, outline, geom, { b0, p });
        // The ring outside is a check on the boundary, not the answer: quiet
        // Sun is balanced, so an outside leaning the same way as the inside
        // means the outline probably is not where the hole ends.
        const surround = samplePolygonField(image, outline, geom, { b0, p, scale: 1.7, exclude: 1.1 });
        next[hole.id] = classifyChPolarity(inside, surround.total > 30 ? surround : null, lon);
      }
      if (!cancelled) setPolarity(next);
    })();

    return () => { cancelled = true; };
  }, [latestDetection, polarityAttempt]);

  // ── what to say about the selected hole ───────────────────────────────────
  const insight = useMemo(() => {
    if (!selectedTrack) return null;
    const now = Date.now();
    const latest = selectedTrack.latest;

    const samples: ChSample[] = selectedTrack.points.map((p) => ({
      atMs: p.atMs, widthDeg: p.hole.widthDeg, darkness: p.hole.darkness, longitude: p.hole.lon,
    }));

    const timing = chTiming(latest.lon, selectedTrack.lastSeenMs, now);
    const choice = chSpeedForEarth(samples, estimateHssSpeedFromChWidthAndDarkness);
    const growth = chGrowth(samples);

    const centralMeridianMs = now + timing.daysToCentralMeridian * DAY_MS;

    // How well this hole is actually measured, which is what the spread
    // should respond to. A hole seen fifty times while it crossed the middle
    // of the disk is a different proposition from one glimpsed once near the
    // limb, and a fixed plus-or-minus cannot say so.
    const closestToMeridian = samples.length > 0
      ? samples.reduce((a, b) => (Math.abs(a) <= Math.abs(b.longitude) ? a : b.longitude), 180)
      : 90;
    const spanHours = samples.length > 1
      ? (samples[samples.length - 1].atMs - samples[0].atMs) / 3600000
      : 0;
    const confidence = measurementConfidence(samples.length, spanHours, closestToMeridian);

    // Whether the stream can reach Earth at all. A hole over a pole crosses
    // the middle of the disk exactly like an equatorial one and sends its wind
    // straight over the top of us; forecasting an arrival for it would mean a
    // near-permanent stream that never comes, since polar holes are the Sun's
    // normal state for most of the cycle.
    const { b0 } = solarDiskOrientation(new Date(now));
    const connection = chEarthConnection(latest.lat, b0);

    const ensemble = choice.speedKms != null && connection.reachesEarth
      ? hssArrivalEnsemble({ centralMeridianMs, speedKms: choice.speedKms, confidence })
      : null;
    const arrival = !connection.reachesEarth ? null
      : ensemble ? ensemble.medianMs
      : (choice.speedKms != null ? hssArrivalMs(choice.speedKms, centralMeridianMs) : null);

    const pol = polarity[latest.id] ?? null;
    const season = pol ? sectorSeasonNote(pol.sector, new Date()) : null;
    const gone = chDisappearance(selectedTrack, now, latestFrameMs || selectedTrack.lastSeenMs);

    // A stream arrives into a sky, and the sky costs more than the difference
    // between a moderate stream and a fast one. A full Moon overhead, or the
    // Sun already up, and there is nothing to see however good the wind is.
    let arrivalSky = null;
    let outlook = null;
    let windows: ReturnType<typeof rmWindows> = [];
    if (arrival != null) {
      // The whole arrival window, not the nominal moment: the Moon sets and
      // twilight ends inside seven hours, so the best part of it is often not
      // the middle.
      const from = ensemble ? ensemble.p10Ms : arrival - 7 * 3600000;
      const to = ensemble ? ensemble.p90Ms : arrival + 7 * 3600000;
      arrivalSky = bestSkyWithin(from, to, location.latitude, location.longitude)
        ?? skyConditionsAt(arrival, location.latitude, location.longitude);

      // Strength from the speed, then whatever the field geometry adds. This
      // is an expectation, not a measurement, and the panel says so.
      const speed = choice.speedKms ?? 0;
      let strength = Math.max(0, Math.min(100, (speed - 330) / 3.2)) * connection.factor;
      const bySign = pol ? bySignForPolarity(pol.polarity) : null;
      if (bySign) {
        windows = windowsDuring(
          rmWindows(bySign, from - 12 * 3600000, to + 2 * DAY_MS, { byMagnitudeNt: 6 }),
          from, to + 2 * DAY_MS,
        );
        if (season?.favourable === true) strength *= 1.25;
        else if (season?.favourable === false) strength *= 0.8;
      }
      outlook = visibilityOutlook(strength, arrivalSky);
    }

    return { timing, choice, growth, centralMeridianMs, arrival, samples, pol, season, gone, latest,
             arrivalSky, outlook, windows, ensemble, confidence, connection };
  }, [selectedTrack, polarity, latestFrameMs, location]);

  const windowSpan = frameSpanHours(windowFrames);
  const historyDays = store.history.length > 1
    ? (store.history[store.history.length - 1].atMs - store.history[0].atMs) / DAY_MS
    : 0;

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div id="coronal-hole-tracker-section" className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col">
      <div className="flex justify-center items-center gap-2">
        <h2 className="text-xl font-semibold text-white mb-2">Coronal Hole Tracker</h2>
        {onOpenModal && (
          <button
            onClick={() => onOpenModal('coronal-holes')}
            className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700"
            title="About coronal holes and high speed streams"
          >?</button>
        )}
      </div>
      <p className="text-xs text-neutral-400 text-center mb-3 max-w-3xl mx-auto">
        Dark patches in SUVI 195 where the Sun's field is open and the wind escapes. The stream from one
        reaches Earth two to four days after the hole crosses the middle of the disk.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <div className="flex flex-wrap items-center gap-2">
          {WINDOW_OPTIONS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setWindowHours(h)}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                windowHours === h ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}
            >{h}h</button>
          ))}
          <button
            type="button"
            onClick={() => setShowSunspots((v) => !v)}
            aria-pressed={showSunspots}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              showSunspots ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}
            title="Overlay NOAA sunspot regions, positioned for the frame being shown"
          >
            View sunspot regions
          </button>
          {onViewInVisualisation && (
            <button
              type="button"
              onClick={onViewInVisualisation}
              className="px-3 py-1 text-xs rounded bg-purple-700 hover:bg-purple-600 text-white transition-colors"
              title="Open the 3D visualisation with coronal holes and their streams turned on"
            >
              Watch in 3D
            </button>
          )}
        </div>
        <span className="text-xs text-neutral-500">
          {windowFrames.length} frame(s)
          {windowSpan != null && ` · ${windowSpan < 1 ? `${Math.round(windowSpan * 60)} min` : `${windowSpan.toFixed(1)}h`} shown`}
          {historyDays >= 0.5 && ` · ${historyDays.toFixed(1)} days tracked`}
          {store.progress && ` · measuring ${store.progress.done}/${store.progress.total}`}
        </span>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* The imagery, with the holes drawn on it */}
        <div className="lg:w-1/2 flex flex-col">
          <div ref={boxRef} className="relative w-full aspect-square bg-black rounded overflow-hidden">
            {activeUrl ? (
              <img
                src={activeUrl}
                alt="SUVI 195 with coronal holes outlined"
                className="w-full h-full object-contain"
                onLoad={handleImageLoad}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-neutral-500 text-sm">
                {framesError ?? 'Loading SUVI 195 imagery...'}
              </div>
            )}
            <CoronalHoleOverlay
              holes={drawables}
              atMs={activeFrameMs}
              natural={natural}
              box={boxSize}
              numberOf={numberOf}
              selectedId={selectedTrack?.key ?? null}
              onSelect={setSelectedKey}
            />
            {showSunspots && (
              <SunspotLabelOverlay
                labels={regionLabels}
                boxSize={boxSize}
                idPrefix="ch-tracker-region"
              />
            )}
            {!detectionForFrame && activeUrl && (
              <div className="absolute top-2 left-2 text-[11px] text-neutral-300 bg-black/70 px-2 py-1 rounded">
                Measuring coronal holes...
              </div>
            )}
          </div>

          {/* Playback - the same controls, in the same order, as the SUVI
              imagery panel, so the two do not behave differently. */}
          <div className="mt-3 space-y-2 flex-shrink-0">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => { setPlaying(false); setFrameIndex((i) => (i - 1 + windowFrames.length) % windowFrames.length); }}
                disabled={windowFrames.length < 2}
                className="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Previous frame"
              >
                ◀ Prev
              </button>
              <button
                onClick={() => setPlaying((prev) => !prev)}
                disabled={windowFrames.length < 2}
                className="px-3 py-1.5 text-xs rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold transition-colors"
                title={playing ? 'Pause' : 'Play'}
              >
                {playing ? '⏸ Pause' : '▶ Play'}
              </button>
              <button
                onClick={() => { setPlaying(false); setFrameIndex((i) => (i + 1) % windowFrames.length); }}
                disabled={windowFrames.length < 2}
                className="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Next frame"
              >
                Next ▶
              </button>
              <label className="ml-auto flex items-center gap-2 text-xs text-neutral-300">
                Speed
                <select
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                  className="rounded bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs text-neutral-200"
                  title="Playback speed"
                >
                  {SPEED_OPTIONS.map((s) => <option key={`ch-speed-${s}`} value={s}>{s}x</option>)}
                </select>
              </label>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(0, windowFrames.length - 1)}
              value={clampedIndex}
              onChange={(e) => { setPlaying(false); setFrameIndex(Number(e.target.value)); }}
              className="w-full accent-sky-500"
            />
            <div className="mt-1 text-xs text-neutral-500 text-right">
              {activeFrame ? `Frame: ${fmtNz(activeFrameMs)}` : 'No frame selected'}
              {detectionForFrame && Math.abs(detectionForFrame.atMs - activeFrameMs) > 60000 && (
                <> · outlines measured {fmtRelative(detectionForFrame.atMs)}, rotated to this frame</>
              )}
            </div>
          </div>
        </div>

        {/* The list and the detail */}
        <div className="lg:w-1/2 flex flex-col gap-3">
          {store.error && tracks.length === 0 && (
            <div className="text-sm text-neutral-400 bg-neutral-900/60 rounded p-3">{store.error}</div>
          )}

          <div className="flex flex-wrap gap-2">
            {tracks.map((track) => {
              const isSel = selectedTrack?.key === track.key;
              const number = chNumbers.get(track.key);
              return (
                <button
                  key={track.key}
                  type="button"
                  onClick={() => setSelectedKey(track.key)}
                  className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                    isSel ? 'bg-neutral-700 border-neutral-500 text-white'
                          : 'bg-neutral-800/70 border-neutral-700 hover:bg-neutral-700'} ${
                    track.live ? '' : 'opacity-60'}`}
                  title={track.live ? undefined : `Last seen ${fmtRelative(track.lastSeenMs)}`}
                >
                  <span style={{ color: holeColour(number ?? 0) }} className="font-semibold">CH{number ?? '?'}</span>
                  <span className="ml-2 text-neutral-300">{track.latest.widthDeg.toFixed(0)}°</span>
                  {!track.live && <span className="ml-1.5 text-neutral-500">gone</span>}
                </button>
              );
            })}
            {tracks.length === 0 && !store.error && (
              <span className="text-sm text-neutral-500">Measuring the latest frame...</span>
            )}
          </div>

          {selectedTrack && insight && (() => {
            const { timing, choice, growth, centralMeridianMs, arrival, samples, pol, season, gone, latest,
                    arrivalSky, outlook, windows, ensemble, confidence, connection } = insight;
            const band = choice.speedKms != null ? speedBand(choice.speedKms) : null;
            return (
              <div className="bg-neutral-900/60 rounded p-3 text-sm flex flex-col gap-3">

                {/* Whether it is still there. A hole that has rotated off is
                    still sending wind, so this cannot just be an absence. */}
                {gone.gone && !selectedTrack.live && (
                  <div className="rounded bg-neutral-800/70 border border-neutral-700 p-2">
                    <div className="text-xs font-semibold text-amber-300">
                      {labelFor(selectedTrack)} · {gone.label} · last seen {fmtRelative(selectedTrack.lastSeenMs)}
                    </div>
                    <p className="text-xs text-neutral-400 mt-1">{gone.note}</p>
                  </div>
                )}

                {/* Speed */}
                <div>
                  <div className="text-neutral-400 text-xs uppercase tracking-wide mb-1">Estimated speed at Earth</div>
                  {choice.speedKms != null ? (
                    <>
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-2xl text-white">{choice.speedKms}</span>
                        <span className="text-neutral-400 text-xs">km/s</span>
                        {band && <span className={`text-xs font-semibold ${band.colour}`}>{band.label}</span>}
                      </div>
                      {band && <p className="text-xs text-neutral-400 mt-1">{band.note}</p>}
                      <p className="text-xs text-neutral-500 mt-1">{choice.note}</p>
                      {connection.factor < 1 && (
                        <p className={`text-xs mt-1 ${connection.reachesEarth ? 'text-yellow-300' : 'text-neutral-400'}`}>
                          {connection.note}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-neutral-400">{choice.note}</p>
                  )}
                </div>

                {/* Arrival */}
                <div>
                  <div className="text-neutral-400 text-xs uppercase tracking-wide mb-1">Stream arrives at Earth</div>
                  {arrival != null ? (
                    <>
                      <div className="flex items-baseline gap-3 flex-wrap">
                        <span className="font-mono text-base text-sky-300">{fmtNz(arrival)}</span>
                        {ensemble && (
                          <span className="text-xs text-neutral-400">{describeSpread(ensemble)}</span>
                        )}
                        {arrival > nowMs && (
                          <span className="font-mono text-sm text-emerald-300">{fmtCountdown(arrival, nowMs)}</span>
                        )}
                      </div>
                      {ensemble && (
                        <div className="text-xs text-neutral-400 mt-0.5">
                          NZ time · 8 in 10 land between {fmtNz(ensemble.p10Ms)} and {fmtNz(ensemble.p90Ms)}
                        </div>
                      )}
                      {/* Where we are in the arrival window, as a bar. */}
                      <ArrivalBar arrivalMs={arrival} nowMs={nowMs} centralMeridianMs={centralMeridianMs} />
                      <p className="text-xs text-neutral-500 mt-1">
                        Run from the moment the hole {timing.facingEarthOrPast ? 'crossed' : 'crosses'} the middle of the
                        disk ({fmtNz(centralMeridianMs)}), at the speed above.
                        {ensemble && (
                          <> The window is not asserted: {ensemble.members} runs with the speed, the crossing time and
                          the chance of being held up by slower wind all varied by as much as they are actually
                          uncertain. It is lopsided because the physics is - a stream can be delayed by slower wind
                          ahead of it, but nothing makes it arrive early. This hole is
                          {confidence > 0.66 ? ' well measured, so the band is as tight as it gets'
                            : confidence > 0.33 ? ' reasonably measured'
                            : ' barely measured yet, so the band is wide'}.</>
                        )}
                      </p>

                      {/* What the sky will be doing, which decides whether any
                          of the above is worth going outside for. */}
                      {arrivalSky && outlook && (
                        <div className="mt-2 rounded bg-neutral-800/60 border border-neutral-700 p-2">
                          <div className={`text-sm font-semibold ${
                            outlook.tier === 'eye' ? 'text-emerald-300'
                              : outlook.tier === 'phone' ? 'text-sky-300'
                              : outlook.tier === 'camera' ? 'text-yellow-300'
                              : 'text-neutral-400'}`}>
                            {outlook.label}
                          </div>
                          <p className="text-xs text-neutral-400 mt-0.5">{outlook.note}</p>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-neutral-500 mt-1.5">
                            <div>
                              Moon: <span className="text-neutral-300">
                                {arrivalSky.phase.name}, {Math.round(arrivalSky.phase.illumination * 100)}% lit
                              </span>
                            </div>
                            <div>
                              {arrivalSky.moonAltitude > 0
                                ? <>Moon is <span className="text-neutral-300">{arrivalSky.moonAltitude.toFixed(0)}° up</span></>
                                : <>Moon is <span className="text-neutral-300">below the horizon</span></>}
                            </div>
                            <div>Sky: <span className="text-neutral-300">{arrivalSky.darkness}</span></div>
                            <div>Best moment: <span className="text-neutral-300">{fmtNz(arrivalSky.atMs)}</span></div>
                          </div>
                          <p className="text-[10px] text-neutral-600 mt-1">
                            For {locationLabel(location)}. The best moment is the darkest point inside the arrival
                            window, which is usually not its middle - the Moon sets and twilight ends inside seven hours.
                          </p>
                        </div>
                      )}

                      {/* The hours the field geometry actually favours. */}
                      {windows.length > 0 && (
                        <div className="mt-2">
                          <div className="text-neutral-400 text-xs uppercase tracking-wide mb-1">
                            Best hours for this sector
                          </div>
                          <ul className="text-xs text-neutral-300 space-y-0.5">
                            {windows.slice(0, 4).map((w) => (
                              <li key={w.startMs} className="font-mono">
                                {fmtNz(w.startMs)} → {new Date(w.endMs).toLocaleTimeString('en-NZ', {
                                  timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit', hour12: true })}
                                <span className="text-neutral-500 ml-2 font-sans">
                                  peak {new Date(w.peakMs).toLocaleTimeString('en-NZ', {
                                    timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit', hour12: true })}
                                </span>
                              </li>
                            ))}
                          </ul>
                          <p className="text-[10px] text-neutral-600 mt-1">
                            Earth's field is tilted, and that tilt turns once a day, so a {pol?.sector} sector only
                            projects southward for part of each night. These are those hours - they recur every night
                            the stream lasts, which is why the good nights can be named without knowing the arrival
                            to the hour.
                          </p>
                        </div>
                      )}
                    </>
                  ) : !connection.reachesEarth ? (
                    <div>
                      <div className="text-sm font-semibold text-neutral-400">No arrival forecast</div>
                      <p className="text-xs text-neutral-400 mt-1">{connection.note}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-neutral-400">Not enough of this hole has been measured to time its stream.</p>
                  )}
                </div>

                {/* Polarity */}
                <div>
                  <div className="text-neutral-400 text-xs uppercase tracking-wide mb-1">Magnetic polarity</div>
                  {pol ? (
                    <>
                      <div className={`text-sm font-semibold ${
                        pol.polarity === 'positive' ? 'text-amber-300'
                          : pol.polarity === 'negative' ? 'text-indigo-300'
                          : 'text-neutral-400'}`}>
                        {pol.summary}
                        {pol.confidence !== 'none' && pol.polarity !== 'unknown' && (
                          <span className="ml-2 text-[11px] font-normal text-neutral-500">{pol.confidence} confidence</span>
                        )}
                      </div>
                      <p className="text-xs text-neutral-400 mt-1">{pol.detail}</p>
                      {season?.note && (
                        <p className={`text-xs mt-1 ${season.favourable === true ? 'text-emerald-300' : 'text-neutral-500'}`}>
                          {season.note}
                        </p>
                      )}
                    </>
                  ) : polarityError ? (
                    <div>
                      <p className="text-xs text-neutral-500 break-words">{polarityError}</p>
                      <button
                        type="button"
                        onClick={() => setPolarityAttempt((n) => n + 1)}
                        className="mt-1 px-2 py-0.5 text-[11px] rounded bg-neutral-700 hover:bg-neutral-600"
                      >Try again</button>
                    </div>
                  ) : gone.gone && !selectedTrack.live ? (
                    <p className="text-xs text-neutral-500">
                      Polarity is read from the current magnetogram, so it is only available while the hole is visible.
                    </p>
                  ) : (
                    <p className="text-xs text-neutral-400">Reading the HMI magnetogram...</p>
                  )}
                </div>

                {/* How it has changed */}
                <div>
                  <div className="text-neutral-400 text-xs uppercase tracking-wide mb-1">Width over time</div>
                  <WidthSparkline samples={samples} />
                </div>

                {/* Where it is, and what it is doing */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div>
                    <div className="text-neutral-500">Position</div>
                    <div className="text-neutral-200 font-mono">
                      {timing.longitude >= 0 ? 'W' : 'E'}{Math.abs(timing.longitude).toFixed(0)}°
                      {' '}{latest.lat >= 0 ? 'N' : 'S'}{Math.abs(latest.lat).toFixed(0)}°
                    </div>
                  </div>
                  <div>
                    <div className="text-neutral-500">Faces Earth</div>
                    <div className="text-neutral-200">
                      {timing.facingEarthOrPast
                        ? `${Math.abs(timing.daysToCentralMeridian).toFixed(1)} days ago`
                        : `in ${timing.daysToCentralMeridian.toFixed(1)} days`}
                    </div>
                  </div>
                  <div>
                    <div className="text-neutral-500">Size</div>
                    <div className="text-neutral-200 font-mono">
                      {latest.widthDeg.toFixed(0)}° × {(latest.heightDeg ?? latest.widthDeg).toFixed(0)}°
                    </div>
                  </div>
                  <div>
                    <div className="text-neutral-500">Trend</div>
                    <div className={
                      growth.phase === 'opening fast' ? 'text-orange-300'
                        : growth.phase === 'opening' ? 'text-yellow-300'
                        : growth.phase === 'closing' ? 'text-sky-300'
                        : 'text-neutral-200'}>
                      {growth.label}
                      {growth.widthPerDay != null && Math.abs(growth.widthPerDay) >= 0.5 && (
                        <span className="text-neutral-500 font-mono ml-1">
                          {growth.widthPerDay > 0 ? '+' : ''}{growth.widthPerDay.toFixed(1)}°/day
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-neutral-600">
                  {samples.length} measurement{samples.length === 1 ? '' : 's'} of this hole
                  {growth.days > 0 && `, spanning ${growth.days < 1 ? `${Math.round(growth.days * 24)} hours` : `${growth.days.toFixed(1)} days`}`}
                  . Speeds come from the hole's width and darkness, which is an estimate, not a measurement of the wind.
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
};

/** Where now sits between the hole facing Earth and its stream arriving. */
const ArrivalBar: React.FC<{ arrivalMs: number; nowMs: number; centralMeridianMs: number }> = ({
  arrivalMs, nowMs, centralMeridianMs,
}) => {
  const span = arrivalMs - centralMeridianMs;
  if (!(span > 0)) return null;
  const progress = Math.max(0, Math.min(1, (nowMs - centralMeridianMs) / span));
  return (
    <div className="mt-2">
      <div className="h-1.5 rounded bg-neutral-800 overflow-hidden">
        <div className="h-full bg-gradient-to-r from-sky-600 to-emerald-400" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-neutral-600 mt-0.5">
        <span>Faced Earth</span>
        <span>{(progress * 100).toFixed(0)}% of the way here</span>
        <span>Arrives</span>
      </div>
    </div>
  );
};

/**
 * The hole's width over the measurements we have.
 *
 * A number and a trend word say what is happening; the shape says whether it
 * has been steady for a day or is bouncing around, which is the difference
 * between a trend worth believing and one measured through patchy frames.
 */
const WidthSparkline: React.FC<{ samples: ChSample[] }> = ({ samples }) => {
  const points = [...samples].sort((a, b) => a.atMs - b.atMs);
  if (points.length < 2) {
    return <p className="text-xs text-neutral-500">Only one measurement so far, so there is no trend to draw yet.</p>;
  }

  const W = 260, H = 44, PAD = 3;
  const t0 = points[0].atMs, t1 = points[points.length - 1].atMs;
  const widths = points.map((p) => p.widthDeg);
  const lo = Math.min(...widths), hi = Math.max(...widths);
  const span = Math.max(1, hi - lo);
  const x = (ms: number) => PAD + ((ms - t0) / Math.max(1, t1 - t0)) * (W - PAD * 2);
  const y = (w: number) => H - PAD - ((w - lo) / span) * (H - PAD * 2);

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.atMs).toFixed(1)},${y(p.widthDeg).toFixed(1)}`).join(' ');
  const area = `${path} L${x(t1).toFixed(1)},${H} L${x(t0).toFixed(1)},${H} Z`;
  const hours = (t1 - t0) / 3600000;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-11" preserveAspectRatio="none" role="img"
           aria-label={`Width from ${lo.toFixed(0)} to ${hi.toFixed(0)} degrees`}>
        <path d={area} fill="rgba(56,189,248,0.15)" />
        <path d={path} fill="none" stroke="#38bdf8" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <circle cx={x(t1)} cy={y(points[points.length - 1].widthDeg)} r="2.5" fill="#38bdf8" />
      </svg>
      <div className="flex justify-between text-[10px] text-neutral-600">
        <span>{lo.toFixed(0)}° min</span>
        <span>{hours < 48 ? `${hours.toFixed(0)} hours` : `${(hours / 24).toFixed(1)} days`}</span>
        <span>{hi.toFixed(0)}° max</span>
      </div>
    </div>
  );
};

export default CoronalHoleTracker;
