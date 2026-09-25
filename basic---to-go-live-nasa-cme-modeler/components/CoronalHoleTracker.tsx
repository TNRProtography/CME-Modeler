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
import { chOutlineAt, type ChSample } from '../utils/coronalHoleDynamics';
import {
  classifyChPolarity, samplePolygonField,
  type ChPolarityResult,
} from '../utils/coronalHolePolarity';
import { buildChTracks, type ChTrack, type TrackedHole } from '../utils/chTracking';
import {
  detectionNear, drawableHoles, framesForTracking, holeForTrackIn, numberTracks,
  type ChDetection, type DrawableHole, type FrameRef,
} from '../utils/chDetectionStore';
import { useCoronalHoleDetections } from '../hooks/useCoronalHoleDetections';
import CoronalHoleOverlay, { holeColour } from './CoronalHoleOverlay';
import SunspotLabelOverlay from './SunspotLabelOverlay';
import { buildRegionLabels, type RegionInput } from '../utils/regionLabels';
import { detectSolarDiskGeometry, diskFromFraction, longitudeAt } from '../utils/solarDisk';
import { solarDiskOrientation } from '../utils/solarEphemeris';
import { frameSpanHours } from '../utils/framePlayback';
import { describeSpread } from '../utils/arrivalEnsemble';
import { locationLabel, resolveViewerLocation, type ViewerLocation } from '../utils/viewerLocation';
import { forecastHole, polarityForTrack, publishHolePolarity } from '../utils/holeForecast';
import { isLifecycleTrack, lifeSummary, STATUS_WORDS, type ChLife, type ChLifecycle } from '../utils/chLifecycle';
import { startChLifecycleSync } from '../utils/chLifecycleSync';

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
/**
 * How far back the timeline can look.
 *
 * The imagery worker keeps a week, so these go to a week. What it will
 * actually show is whatever has been ingested - the archive fills forward
 * from when retention was widened, so asking for seven days a day later
 * honestly returns one.
 */
const WINDOW_OPTIONS = [6, 12, 24, 72, 168] as const;

const windowLabel = (hours: number): string => (hours < 48 ? `${hours}h` : `${hours / 24}d`);
const SPEED_OPTIONS = [0.5, 1, 2, 5, 10] as const;

interface WorkerFrame { key: string; ts: string; url: string }

/** A frame from the timeline, with one hole's outline ready to draw on it. */
interface SparkPreview {
  url: string;
  frameMs: number;
  holes: DrawableHole[];
}

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
const speedBand = (kms: number): { label: string; note: string } => {
  if (kms < 400) return { label: 'Slow', note: 'Ordinary background wind. Enough to unsettle the field, rarely enough on its own.' };
  if (kms < 500) return { label: 'Moderate', note: 'A moderate stream. Worth watching if the field turns south when it arrives.' };
  if (kms < 600) return { label: 'Fast', note: 'A fast stream. These are the ones that produce most coronal hole aurora.' };
  return { label: 'Very fast', note: 'A strong stream, capable of a good night by itself if the field cooperates.' };
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
  // The detection the polarity was read for: hole ids are per frame.
  const [polarityAtMs, setPolarityAtMs] = useState<number | null>(null);
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
        // /api/frames rather than /api/state: state is a summary of all four
        // sources over a fixed day, and this panel wants one source over
        // whatever window is selected. That is smaller at every window up to
        // a day and the only thing that can return more than one.
        const res = await fetch(
          `${SUVI_DIFF_WORKER_BASE}/api/frames?source=suvi_195_primary&hours=${windowHours}`);
        const json = await res.json();
        if (cancelled) return;
        const all: WorkerFrame[] = json?.frames ?? [];
        setFrames(all.filter((f) => f?.ts && f?.url));
        setFramesError(null);
      } catch {
        if (!cancelled) setFramesError('Could not reach the SUVI imagery worker.');
      }
    };
    load();
    const id = setInterval(load, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
    // Keyed on the window, because that is now part of the request.
  }, [windowHours]);

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
  // The shared 90-day record lives on the forecast worker; keep in step with it.
  useEffect(() => { startChLifecycleSync(); }, []);
  const [showHistory, setShowHistory] = useState(false);

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
    () => store.tracks ?? buildChTracks(framesForTracking(store)),
    [store.tracks, store.history, store.detections],
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

  /**
   * The frame behind a moment on the width chart, with this hole outlined.
   *
   * A width chart answers "it narrowed on Sunday" and immediately raises "did
   * it, though, or did the detector lose half of it behind a flare?" - which
   * the number cannot settle and the picture can. So each point on the line
   * can show the frame it was measured from.
   *
   * The imagery and the measurements are two different series on two different
   * cadences, so both are matched by nearest time rather than by index. The
   * outline comes from the measurement and the disk from the detection that
   * produced it, which is what lets the overlay rotate it onto whichever frame
   * is shown underneath.
   */
  const previewAt = useCallback((atMs: number): SparkPreview | null => {
    if (!selectedTrack || windowFrames.length === 0) return null;

    const frame = windowFrames.reduce((a, b) =>
      Math.abs(new Date(a.ts).getTime() - atMs) <= Math.abs(new Date(b.ts).getTime() - atMs) ? a : b);
    const url = resolveUrl(frame.url);
    if (!url) return null;

    const point = selectedTrack.points.reduce((a, b) =>
      Math.abs(a.atMs - atMs) <= Math.abs(b.atMs - atMs) ? a : b, selectedTrack.points[0]);
    // This session's detection nearest the measurement, and the track's hole in it.
    // No outline rather than a wrong one: only from a detection close in time.
    const near = point ? detectionNear(store.detections, point.atMs) : null;
    const detection = near && Math.abs(near.atMs - point.atMs) <= 3 * 3600000 ? near : null;
    const hole = detection ? holeForTrackIn(selectedTrack, detection) : null;

    const frameMs = new Date(frame.ts).getTime();
    return {
      url,
      frameMs,
      // No outline rather than a wrong one: the measurement can come from this
      // session's detections only, and a week-old remembered record has no
      // polygon to draw.
      holes: hole && detection ? [{
        trackKey: selectedTrack.key,
        hole,
        observedAtMs: detection.atMs,
        disk: detection.disk,
        b0Deg: detection.b0Deg,
        carriedForward: detection.atMs !== frameMs,
      }] : [],
    };
  }, [selectedTrack, windowFrames, resolveUrl, store.detections]);

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
      //
      // A source counts as working only if the disk can be found in it. That
      // used to be two separate steps - take the first image that loads, then
      // find the disk in it - which meant a source that downloaded fine but
      // was unreadable ended the search, and the two that would have worked
      // were never tried. Loading is not the thing being tested.
      let image = null;
      let geom = null;
      const failures: string[] = [];
      for (const source of MAGNETOGRAM_SOURCES) {
        try {
          const candidate = await readImagePixels(source.url);
          if (cancelled) return;
          const candidateGeom = detectSolarDiskGeometry(candidate.data, candidate.width, candidate.height);
          if (!candidateGeom) {
            failures.push(`${source.label}: loaded ${candidate.width}\u00d7${candidate.height} but no solar disk `
              + 'could be found in it');
            continue;
          }
          image = candidate;
          geom = candidateGeom;
          break;
        } catch (err) {
          failures.push(`${source.label}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (cancelled) return;
      if (!image || !geom) {
        // Every source failing the same way is worth naming, because there is
        // exactly one cause and one fix. Displaying an image needs no CORS;
        // reading its pixels does, and no observatory sends those headers. So
        // this depends entirely on the app's own image proxy, and if that is
        // not answering there is no fallback to have.
        const proxyDown = failures.every((f) => /not deployed at that address|text\/html/.test(f));
        setPolarityError(proxyDown
          ? 'Polarity needs to read the magnetogram\u2019s pixels, and every route to them answered with a web page '
            + 'instead of an image \u2013 which means the image proxy is not answering at this address. Showing an '
            + 'image needs no permission; reading it does, and no observatory sends the header that would allow it '
            + 'directly. The proxy is the Pages Function at functions/api/proxy, which ships with the site, so a '
            + 'deployment that is missing it is the whole fault.'
          : `The HMI magnetogram could not be read, so polarity is unavailable. ${failures.join(' | ')}`);
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
      if (!cancelled) {
        setPolarity(next);
        setPolarityAtMs(latestDetection.atMs);
        // Shared with the days card, which lists the same holes and should
        // grade them the same way.
        publishHolePolarity(latestDetection.atMs, next);
      }
    })();

    return () => { cancelled = true; };
  }, [latestDetection, polarityAttempt]);

  // ── what to say about the selected hole ───────────────────────────────────
  // The same forecast "What to expect in the next couple of days" lists
  // (utils/holeForecast), so the two cannot disagree about what is coming.
  const insight = useMemo(() => {
    if (!selectedTrack) return null;
    return forecastHole(selectedTrack, {
      nowMs: Date.now(),
      latestFrameMs,
      polarity: polarityForTrack(selectedTrack, polarity, polarityAtMs, store.detections),
      latitude: location.latitude,
      longitude: location.longitude,
    });
  }, [selectedTrack, polarity, polarityAtMs, store.detections, latestFrameMs, location]);

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
            >{windowLabel(h)}</button>
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
                    arrivalSky, outlook, bestCaseOutlook, windows, ensemble, confidence, connection } = insight;
            const band = choice.speedKms != null ? speedBand(choice.speedKms) : null;
            return (
              <div className="bg-neutral-900/60 rounded p-3 text-sm flex flex-col gap-3">

                {isLifecycleTrack(selectedTrack) && (
                  <LifeLine life={selectedTrack.life} lifecycle={store.lifecycle} />
                )}

                {/* Whether it is still there. A hole that has rotated off is
                    still sending wind, so this cannot just be an absence. */}
                {gone.gone && !selectedTrack.live && (
                  <div className="rounded bg-neutral-800/70 border border-neutral-700 p-2">
                    <div className="text-xs font-semibold text-neutral-200">
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
                        {band && <span className="text-xs font-semibold text-neutral-300">{band.label}</span>}
                      </div>
                      {band && <p className="text-xs text-neutral-400 mt-1">{band.note}</p>}
                      <p className="text-xs text-neutral-500 mt-1">{choice.note}</p>
                      {connection.factor < 1 && (
                        <p className="text-xs mt-1 text-neutral-400">
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
                        <span className="font-mono text-base text-neutral-100">{fmtNz(arrival)}</span>
                        {ensemble && (
                          <span className="text-xs text-neutral-400">{describeSpread(ensemble)}</span>
                        )}
                        {arrival > nowMs && (
                          <span className="font-mono text-sm text-neutral-400">{fmtCountdown(arrival, nowMs)}</span>
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
                          of the above is worth going outside for.

                          This is the one thing on the panel that is coloured,
                          and the hole chips are the other. Colour here means
                          exactly two things: which hole, and how good the
                          night is. Everything else - speed band, polarity
                          sign, trend, countdown - used to have a colour of its
                          own, which left nothing to draw the eye because
                          everything was drawing it. Size and weight do that
                          work now. */}
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
                          {bestCaseOutlook && bestCaseOutlook.tier !== outlook.tier && (
                            <p className="text-xs text-neutral-400 mt-0.5">
                              If the field swings south at the right moment, up to{' '}
                              <span className="text-neutral-200">{bestCaseOutlook.label.toLowerCase()}</span>.
                            </p>
                          )}
                          {!pol && (
                            // The honest caveat. Without polarity there is no
                            // sector, so the chain runs with no guaranteed
                            // southward field and what comes out is a floor.
                            <p className="text-xs text-neutral-400 mt-1">
                              This assumes the field stays neutral, because the hole's polarity could not be
                              measured. Polarity is what decides whether the stream drags southward field past
                              Earth, so this is a floor rather than a forecast - the real night could be
                              considerably better, and nothing here can tell you which.
                            </p>
                          )}
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
                      <div className="text-sm font-semibold text-neutral-100">
                        {pol.summary}
                        {pol.confidence !== 'none' && pol.polarity !== 'unknown' && (
                          <span className="ml-2 text-[11px] font-normal text-neutral-500">{pol.confidence} confidence</span>
                        )}
                      </div>
                      <p className="text-xs text-neutral-400 mt-1">{pol.detail}</p>
                      {season?.note && (
                        <p className="text-xs mt-1 text-neutral-500">
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
                  <WidthSparkline samples={samples} preview={previewAt} numberOf={numberOf} />
                </div>
                {isLifecycleTrack(selectedTrack) && selectedTrack.life.sightings.length >= 2 && (
                  <div>
                    <div className="text-neutral-400 text-xs uppercase tracking-wide mb-1">Stream speed over time</div>
                    <ValueSparkline
                      points={selectedTrack.life.sightings.map((x) => ({ atMs: x.atMs, value: x.speedKms }))}
                      unit=" km/s"
                      colour="#7dd3fc"
                    />
                    <p className="text-[11px] text-neutral-600 mt-0.5">
                      The speed each measurement of its size and darkness gives. The forecast uses the one taken
                      nearest the middle of the disk.
                    </p>
                  </div>
                )}

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
                    <div className="text-neutral-200">
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

          {store.lifecycle && store.lifecycle.lives.length > 0 && (
            <div className="bg-neutral-900/60 rounded p-3">
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                className="w-full flex items-center justify-between text-xs text-neutral-300"
                aria-expanded={showHistory}
              >
                <span className="uppercase tracking-wide text-neutral-400">
                  Every hole, last {recordDays(store.lifecycle)} days ({store.lifecycle.lives.length})
                </span>
                <span className="text-neutral-500">{showHistory ? 'Hide' : 'Show'}</span>
              </button>
              {showHistory && (
                <HoleHistoryTable
                  lifecycle={store.lifecycle}
                  selectable={new Set(tracks.map((t) => t.key))}
                  onSelect={(key) => setSelectedKey(key)}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const fmtDay = (ms: number) => new Date(ms).toLocaleDateString('en-NZ', {
  timeZone: 'Pacific/Auckland', day: 'numeric', month: 'short',
});

const fmtSpan = (ms: number) => {
  const hours = ms / 3600000;
  return hours < 48 ? `${Math.max(1, Math.round(hours))} hours` : `${(hours / 24).toFixed(1)} days`;
};

const recordDays = (lc: ChLifecycle) =>
  Math.max(1, Math.min(90, Math.ceil((lc.lastFrameMs - (lc.startedMs || lc.lastFrameMs)) / DAY_MS)));

const goneWords = (life: ChLife): string =>
  life.status === 'merged' && life.mergedInto != null ? `Merged into CH${life.mergedInto}` : STATUS_WORDS[life.status];

/** When a hole first appeared and when it went, and why. */
const LifeLine: React.FC<{ life: ChLife; lifecycle: ChLifecycle }> = ({ life, lifecycle }) => {
  const recordBegan = life.firstSeenMs <= lifecycle.startedMs;
  const endMs = life.endedMs ?? life.lastSeenMs;
  const { maxWidthDeg, maxSpeedKms, sightings } = lifeSummary(life);
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
      <div>
        <div className="text-neutral-500">First appeared</div>
        <div className="text-neutral-200">
          {fmtNz(life.firstSeenMs)}
          {recordBegan && <span className="text-neutral-500"> (when the record began)</span>}
        </div>
      </div>
      <div>
        <div className="text-neutral-500">{life.status === 'live' ? 'On the disk' : 'Disappeared'}</div>
        <div className="text-neutral-200">
          {life.status === 'live'
            ? `for ${fmtSpan(endMs - life.firstSeenMs)}`
            : <>{fmtNz(endMs)} · {goneWords(life)}</>}
        </div>
      </div>
      <div className="col-span-2 text-[11px] text-neutral-500">
        Largest {maxWidthDeg.toFixed(0)}° across, fastest stream {maxSpeedKms} km/s, measured {sightings} time{sightings === 1 ? '' : 's'}.
        {life.returnOf != null && <> Back round the east limb: this is CH{life.returnOf} from last rotation.</>}
      </div>
    </div>
  );
};

/** Every hole on record, newest first. */
const HoleHistoryTable: React.FC<{
  lifecycle: ChLifecycle;
  selectable: Set<string>;
  onSelect: (key: string) => void;
}> = ({ lifecycle, selectable, onSelect }) => {
  const lives = [...lifecycle.lives].sort((a, b) => b.firstSeenMs - a.firstSeenMs);
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-neutral-500 text-left">
            <th className="font-normal pr-2">Hole</th>
            <th className="font-normal pr-2">Appeared</th>
            <th className="font-normal pr-2">Gone</th>
            <th className="font-normal pr-2 text-right">Max size</th>
            <th className="font-normal text-right">Max speed</th>
          </tr>
        </thead>
        <tbody>
          {lives.map((life) => {
            const key = `CH${life.number}`;
            const canSelect = selectable.has(key);
            const { maxWidthDeg, maxSpeedKms } = lifeSummary(life);
            return (
              <tr key={life.number} className="border-t border-neutral-800">
                <td className="pr-2 py-1">
                  {canSelect ? (
                    <button type="button" onClick={() => onSelect(key)} className="font-semibold hover:underline"
                            style={{ color: holeColour(life.number) }}>{key}</button>
                  ) : (
                    <span className="font-semibold text-neutral-400">{key}</span>
                  )}
                  {life.returnOf != null && <span className="text-neutral-500"> (was CH{life.returnOf})</span>}
                </td>
                <td className="pr-2 py-1 text-neutral-300 whitespace-nowrap">{fmtDay(life.firstSeenMs)}</td>
                <td className="pr-2 py-1 text-neutral-300">
                  {life.status === 'live'
                    ? <span className="text-emerald-300">On the disk</span>
                    : <>{fmtDay(life.endedMs ?? life.lastSeenMs)} <span className="text-neutral-500">{goneWords(life)}</span></>}
                </td>
                <td className="pr-2 py-1 text-right font-mono text-neutral-300">{maxWidthDeg.toFixed(0)}°</td>
                <td className="py-1 text-right font-mono text-neutral-300">{maxSpeedKms}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-[10px] text-neutral-600 mt-1">
        Kept for 90 days and shared by everyone using the app. Speeds are km/s, from each hole's size and darkness.
      </p>
    </div>
  );
};

/** A small line of one value over time. */
const ValueSparkline: React.FC<{ points: { atMs: number; value: number }[]; unit: string; colour: string }> = ({
  points, unit, colour,
}) => {
  const pts = [...points].sort((a, b) => a.atMs - b.atMs);
  const W = 260, H = 44, PAD = 3;
  const t0 = pts[0].atMs, t1 = pts[pts.length - 1].atMs;
  const vals = pts.map((p) => p.value);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = Math.max(1, hi - lo);
  const x = (ms: number) => PAD + ((ms - t0) / Math.max(1, t1 - t0)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - lo) / span) * (H - PAD * 2);
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.atMs).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-11" preserveAspectRatio="none" role="img"
           aria-label={`From ${lo}${unit} to ${hi}${unit}`}>
        <path d={`${path} L${x(t1).toFixed(1)},${H} L${x(t0).toFixed(1)},${H} Z`} fill={colour} fillOpacity={0.12} />
        <path d={path} fill="none" stroke={colour} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <circle cx={x(last.atMs)} cy={y(last.value)} r="2.5" fill="#e5e5e5" />
      </svg>
      <div className="flex justify-between text-[10px] text-neutral-600">
        <span>{lo}{unit} min</span>
        <span>{fmtSpan(t1 - t0)}</span>
        <span>{hi}{unit} max</span>
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
/**
 * One frame from the timeline, with a single hole outlined on it.
 *
 * Deliberately not interactive: it is a read-out of a moment on the chart,
 * and giving it its own controls would make it a second timeline competing
 * with the real one above.
 */
const SparkPreviewCard: React.FC<{
  preview: SparkPreview;
  widthDeg: number;
  atMs: number;
  numberOf?: (trackKey: string) => number | undefined;
}> = ({ preview, widthDeg, atMs, numberOf }) => {
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const SIDE = 168;

  return (
    <div className="flex gap-3 items-start">
      <div className="relative shrink-0 rounded overflow-hidden bg-black border border-neutral-700"
           style={{ width: SIDE, height: SIDE }}>
        <img
          src={preview.url}
          alt=""
          className="w-full h-full object-contain"
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth && img.naturalHeight) {
              setNatural({ width: img.naturalWidth, height: img.naturalHeight });
            }
          }}
        />
        {/* The overlay needs the image's own dimensions to place anything, so
            it waits for the load rather than guessing and drawing it wrong. */}
        {natural && preview.holes.length > 0 && (
          <CoronalHoleOverlay
            holes={preview.holes}
            atMs={preview.frameMs}
            natural={natural}
            box={{ width: SIDE, height: SIDE }}
            numberOf={numberOf}
            labels={false}
          />
        )}
      </div>
      <div className="text-xs min-w-0">
        <div className="font-mono text-neutral-200">{widthDeg.toFixed(0)}°</div>
        <div className="text-neutral-500 mt-0.5">{fmtNz(atMs)}</div>
        {preview.holes.length === 0 ? (
          <p className="text-neutral-600 mt-1.5 leading-snug">
            The outline for this moment is not in this session's measurements, so only the frame is shown.
          </p>
        ) : preview.holes[0].carriedForward ? (
          <p className="text-neutral-600 mt-1.5 leading-snug">
            The nearest measurement is from {fmtNz(preview.holes[0].observedAtMs)}, rotated onto this frame.
          </p>
        ) : null}
      </div>
    </div>
  );
};

const WidthSparkline: React.FC<{
  samples: ChSample[];
  preview?: (atMs: number) => SparkPreview | null;
  numberOf?: (trackKey: string) => number | undefined;
}> = ({ samples, preview, numberOf }) => {
  const points = [...samples].sort((a, b) => a.atMs - b.atMs);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

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

  // Nearest point to the pointer, in time rather than in pixels: the samples
  // are not evenly spaced, and picking by index would put the marker on a
  // different measurement from the one under the cursor.
  const pick = (clientX: number, target: SVGSVGElement) => {
    const rect = target.getBoundingClientRect();
    if (rect.width === 0) return;
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const wanted = t0 + fraction * (t1 - t0);
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(points[i].atMs - wanted) < Math.abs(points[best].atMs - wanted)) best = i;
    }
    setHoverIndex(best);
  };

  const hovered = hoverIndex != null ? points[hoverIndex] : null;
  const card = hovered && preview ? preview(hovered.atMs) : null;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className={`w-full h-11 ${preview ? 'cursor-crosshair' : ''}`}
           preserveAspectRatio="none" role="img"
           aria-label={`Width from ${lo.toFixed(0)} to ${hi.toFixed(0)} degrees`}
           onPointerMove={(e) => preview && pick(e.clientX, e.currentTarget)}
           onPointerLeave={() => setHoverIndex(null)}>
        <path d={area} fill="rgba(163,163,163,0.12)" />
        <path d={path} fill="none" stroke="#a3a3a3" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        {hovered && (
          <line x1={x(hovered.atMs)} y1={0} x2={x(hovered.atMs)} y2={H}
                stroke="#e5e5e5" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        )}
        <circle cx={x(hovered ? hovered.atMs : t1)}
                cy={y(hovered ? hovered.widthDeg : points[points.length - 1].widthDeg)}
                r="2.5" fill="#e5e5e5" />
      </svg>
      <div className="flex justify-between text-[10px] text-neutral-600">
        <span>{lo.toFixed(0)}° min</span>
        <span>{hours < 48 ? `${hours.toFixed(0)} hours` : `${(hours / 24).toFixed(1)} days`}</span>
        <span>{hi.toFixed(0)}° max</span>
      </div>
      {preview && (
        <div className="mt-2">
          {card && hovered ? (
            <SparkPreviewCard preview={card} widthDeg={hovered.widthDeg} atMs={hovered.atMs} numberOf={numberOf} />
          ) : (
            <p className="text-[11px] text-neutral-600">
              Hover the line to see the frame each measurement was taken from.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default CoronalHoleTracker;
