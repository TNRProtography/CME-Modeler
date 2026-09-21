// The Coronal Hole Tracker.
//
// The sunspot tracker answers "might this go off". This one answers a
// question that does not need anything to happen: a coronal hole is already
// leaking wind, and a few days after it crosses the middle of the disk that
// wind gets here. So the panel is built around when and how fast, rather than
// around probabilities.
//
// Holes are found in the SUVI 195 frames the difference-imagery worker
// already holds, at roughly two-hour spacing across the window, which is
// enough to watch one open or close without running the detector on every
// four-minute frame. The outlines are drawn over whichever frame is on screen,
// rotated to that frame's moment, so scrubbing the timeline moves the holes
// with the Sun instead of pinning yesterday's shapes to today's image.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CoronalHole } from '../utils/coronalHoleData';
import { detectCoronalHolesFromSuvi195 } from '../utils/suviCoronalHoleDetector';
import { readImagePixels } from '../utils/imagePixels';
import { estimateHssSpeedFromChWidthAndDarkness } from '../utils/solarWindModel';
import {
  chGrowth, chOutlineAt, chSpeedForEarth, chTiming,
  hssArrivalMs, type ChSample,
} from '../utils/coronalHoleDynamics';
import {
  classifyChPolarity, samplePolygonField, sectorSeasonNote,
  type ChPolarityResult,
} from '../utils/coronalHolePolarity';
import {
  containedImageRect, detectSolarDiskGeometry, diskFromFraction,
  heliographicToPixel, longitudeAt,
  type DiskFraction, type SolarDiskGeometry,
} from '../utils/solarDisk';
import { solarDiskOrientation } from '../utils/solarEphemeris';
import { frameSpanHours } from '../utils/framePlayback';

const SUVI_DIFF_WORKER_BASE = 'https://suvi-difference-imagery.thenamesrock.workers.dev';
const HMI_MAG_URL = 'https://jsoc1.stanford.edu/data/hmi/images/latest/HMI_latest_Mag_1024x1024.gif';
const HMI_MAG_FALLBACK = 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_HMIB.jpg';

/**
 * How far apart detections are taken. Running the detector on every frame
 * would be a canvas decode and a flood fill every four minutes of window for
 * no extra information: a hole does not change shape meaningfully inside two
 * hours, and the Sun only turns about a degree in that time.
 */
const DETECT_SPACING_MS = 2 * 3600 * 1000;
const MAX_DETECTIONS = 14;

/** The honest width of the arrival window. */
const ARRIVAL_UNCERTAINTY_HOURS = 7;

const DAY_MS = 86400000;
const WINDOW_OPTIONS = [6, 12, 24] as const;
const SPEED_OPTIONS = [0.5, 1, 2, 5, 10] as const;

const HOLE_COLOURS = ['#38bdf8', '#a78bfa', '#fbbf24', '#34d399', '#fb7185', '#facc15', '#22d3ee', '#f472b6'];

interface WorkerFrame { key: string; ts: string; url: string }

interface Detection {
  atMs: number;
  holes: CoronalHole[];
  /**
   * The disk the detector itself found, as fractions of the frame.
   *
   * Taken from the detection rather than measured again from the displayed
   * image for two reasons. The outlines are in coordinates the detector
   * derived from THIS disk, so measuring it again can only introduce
   * disagreement. And the displayed image is cross-origin: the detector reads
   * it as a blob and can get at the pixels, whereas reading the same bytes
   * back out of the <img> element taints the canvas and throws - which is
   * what left the overlay permanently stuck on "locating the solar disk"
   * while the detection behind it was working perfectly well.
   */
  disk: DiskFraction;
  /**
   * The axis tilt the detector projected with.
   *
   * Drawing has to use this exact value, not one computed independently for
   * the frame on screen. The outlines are the detector's own projection run
   * backwards, so any difference between the two tilts comes out as holes
   * sitting a few degrees away from the dark patches they were traced from.
   */
  b0Deg: number;
}

const fmtNz = (ms: number | null | undefined): string => {
  if (ms == null || !Number.isFinite(ms)) return 'Unknown';
  return new Date(ms).toLocaleString('en-NZ', {
    timeZone: 'Pacific/Auckland', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
};

const fmtRelative = (ms: number): string => {
  const d = ms - Date.now();
  const hours = d / 3600000;
  if (Math.abs(hours) < 1) return 'within the hour';
  if (hours < 0) return `${Math.abs(hours) < 48 ? `${Math.round(-hours)} hours` : `${(-hours / 24).toFixed(1)} days`} ago`;
  return hours < 48 ? `in ${Math.round(hours)} hours` : `in ${(hours / 24).toFixed(1)} days`;
};

/**
 * The bands are the ones the wind itself falls into at 1 AU, not the CME
 * bands. A CME at 500 km/s is slow; a stream at 500 km/s is a decent one.
 * They are different populations and sharing a scale would flatter every
 * hole on the panel.
 */
const speedBand = (kms: number): { label: string; colour: string; note: string } => {
  if (kms < 400) return { label: 'Slow', colour: 'text-neutral-300', note: 'Ordinary background wind. Enough to unsettle the field, rarely enough on its own.' };
  if (kms < 500) return { label: 'Moderate', colour: 'text-yellow-300', note: 'A moderate stream. Worth watching if the field turns south when it arrives.' };
  if (kms < 600) return { label: 'Fast', colour: 'text-orange-300', note: 'A fast stream. These are the ones that produce most coronal hole aurora.' };
  return { label: 'Very fast', colour: 'text-red-400', note: 'A strong stream, capable of a good night by itself if the field cooperates.' };
};

export interface CoronalHoleTrackerProps {
  onOpenModal?: (id: string) => void;
}

const CoronalHoleTracker: React.FC<CoronalHoleTrackerProps> = ({ onOpenModal }) => {
  const [frames, setFrames] = useState<WorkerFrame[]>([]);
  const [windowHours, setWindowHours] = useState<number>(12);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);

  const [detections, setDetections] = useState<Detection[]>([]);
  const [detectProgress, setDetectProgress] = useState<{ done: number; total: number } | null>(null);
  const [detectError, setDetectError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [polarity, setPolarity] = useState<Record<string, ChPolarityResult>>({});
  const [polarityError, setPolarityError] = useState<string | null>(null);

  const [boxSize, setBoxSize] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);

  const boxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const detectRunId = useRef(0);

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
      } catch {
        if (!cancelled) setDetectError('Could not reach the SUVI imagery worker.');
      }
    };
    load();
    const id = setInterval(load, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
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

  const clampedIndex = Math.min(frameIndex, Math.max(0, windowFrames.length - 1));
  const activeFrame = windowFrames[clampedIndex] ?? null;
  const activeFrameMs = activeFrame ? new Date(activeFrame.ts).getTime() : Date.now();
  const activeUrl = resolveUrl(activeFrame?.url);

  // Landing on the newest frame rather than the oldest, so opening the panel
  // shows now and playing runs backwards through the window on purpose only.
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
    // Deliberately keyed on the frame COUNT and not the array: a poll that
    // returns the same frames must not restart playback, which is what used to
    // make the 24 hour window look broken on the imagery panel.
  }, [playing, windowFrames.length, speed]);

  // ── detection across the window ───────────────────────────────────────────
  const detectionTargets = useMemo(() => {
    if (windowFrames.length === 0) return [] as WorkerFrame[];
    const picked: WorkerFrame[] = [];
    let lastMs = -Infinity;
    for (const f of windowFrames) {
      const ms = new Date(f.ts).getTime();
      if (ms - lastMs >= DETECT_SPACING_MS) { picked.push(f); lastMs = ms; }
    }
    const newest = windowFrames[windowFrames.length - 1];
    if (picked[picked.length - 1]?.key !== newest.key) picked.push(newest);
    // Keep the newest end of the window if there are more than we want to run.
    return picked.slice(-MAX_DETECTIONS);
  }, [windowFrames]);

  useEffect(() => {
    if (detectionTargets.length === 0) return;
    const run = ++detectRunId.current;
    let cancelled = false;

    (async () => {
      setDetectError(null);
      setDetectProgress({ done: 0, total: detectionTargets.length });
      const found: Detection[] = [];
      // Newest first, so the outlines and the numbers appear immediately and
      // the history fills in behind them.
      const ordered = [...detectionTargets].reverse();
      for (let i = 0; i < ordered.length; i++) {
        if (cancelled || detectRunId.current !== run) return;
        const f = ordered[i];
        const url = resolveUrl(f.url);
        if (!url) continue;
        try {
          const frameAt = new Date(f.ts);
          const result = await detectCoronalHolesFromSuvi195(url, 0, frameAt);
          if (cancelled || detectRunId.current !== run) return;
          if (result.succeeded && result.diskFraction) {
            found.push({
              atMs: frameAt.getTime(),
              holes: result.coronalHoles,
              disk: result.diskFraction,
              b0Deg: result.b0Deg,
            });
            found.sort((a, b) => a.atMs - b.atMs);
            setDetections([...found]);
          }
        } catch {
          // One unreadable frame is not a reason to abandon the rest.
        }
        setDetectProgress({ done: i + 1, total: ordered.length });
      }
      if (!cancelled && detectRunId.current === run) {
        setDetectProgress(null);
        if (found.length === 0) setDetectError('No coronal holes could be measured in this window.');
      }
    })();

    return () => { cancelled = true; };
  }, [detectionTargets, resolveUrl]);

  const latestDetection = detections.length > 0 ? detections[detections.length - 1] : null;

  /** The detection nearest the frame on screen, which is what gets drawn. */
  const detectionForFrame = useMemo(() => {
    if (detections.length === 0) return null;
    return detections.reduce((a, b) =>
      Math.abs(a.atMs - activeFrameMs) <= Math.abs(b.atMs - activeFrameMs) ? a : b);
  }, [detections, activeFrameMs]);

  // ── the size of the displayed image ───────────────────────────────────────
  // Only its natural size is wanted here. Where the disk sits inside it comes
  // from the detection, which read the same frame through a blob and so could
  // actually get at the pixels.
  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (!img.naturalWidth || !img.naturalHeight) return;
    setNatural({ width: img.naturalWidth, height: img.naturalHeight });
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      setBoxSize({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    setBoxSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  /** Where the letterboxed image actually sits, and the disk inside it. */
  const drawGeometry = useMemo((): { geometry: SolarDiskGeometry; offsetX: number; offsetY: number } | null => {
    if (!detectionForFrame || !natural || boxSize.width === 0 || boxSize.height === 0) return null;
    const rect = containedImageRect(natural, boxSize);
    return {
      geometry: diskFromFraction(detectionForFrame.disk, { width: rect.width, height: rect.height }),
      offsetX: rect.x,
      offsetY: rect.y,
    };
  }, [detectionForFrame, natural, boxSize]);

  // ── drawing the outlines ──────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(boxSize.width * dpr));
    canvas.height = Math.max(1, Math.round(boxSize.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, boxSize.width, boxSize.height);

    if (!drawGeometry || !detectionForFrame) return;
    const { geometry, offsetX, offsetY } = drawGeometry;
    // The detector's own tilt, so this projection is the exact inverse of the
    // one the outlines came out of.
    const b0 = detectionForFrame.b0Deg;
    const p = 0;

    detectionForFrame.holes.forEach((hole, i) => {
      const colour = HOLE_COLOURS[i % HOLE_COLOURS.length];
      const selected = hole.id === selectedId;
      const outline = chOutlineAt(hole, detectionForFrame.atMs, activeFrameMs);

      const pts = outline
        .map((q) => heliographicToPixel(q.lat, q.lon, geometry, b0, p))
        .filter((q) => q.onDisk)
        .map((q) => ({ x: q.x + offsetX, y: q.y + offsetY }));
      if (pts.length < 3) return;

      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
      ctx.closePath();

      ctx.fillStyle = `${colour}${selected ? '44' : '22'}`;
      ctx.fill();
      // Stroked twice: a thin coloured line alone disappears against the
      // bright corona in the 195 channel.
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = selected ? 5 : 3.5;
      ctx.stroke();
      ctx.strokeStyle = colour;
      ctx.lineWidth = selected ? 2.5 : 1.5;
      ctx.stroke();

      // The label goes below the hole with a leader back to it, rather than
      // on top of it. A hole is the thing being looked at; covering it with
      // the name of the thing is the one placement that cannot be right.
      const centre = heliographicToPixel(
        hole.lat, longitudeAt(hole.lon, detectionForFrame.atMs, activeFrameMs), geometry, b0, p);
      if (!centre.onDisk) return;

      const cx = centre.x + offsetX;
      const cy = centre.y + offsetY;
      const bottom = Math.max(...pts.map((q) => q.y));
      const label = `CH${i + 1} · ${hole.widthDeg.toFixed(0)}°`;

      ctx.font = `600 ${selected ? 13 : 12}px system-ui, sans-serif`;
      const textWidth = ctx.measureText(label).width;
      const padX = 6, padY = 4;
      const boxW = textWidth + padX * 2;
      const boxH = (selected ? 13 : 12) + padY * 2;

      // Clamped so a hole near the bottom or the side of the frame still has
      // a readable label rather than one half off the edge.
      const labelX = Math.min(Math.max(cx - boxW / 2, 4), Math.max(4, boxSize.width - boxW - 4));
      const labelY = Math.min(bottom + 10, Math.max(4, boxSize.height - boxH - 4));

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(labelX + boxW / 2, labelY);
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = 'rgba(0,0,0,0.78)';
      ctx.strokeStyle = colour;
      ctx.lineWidth = selected ? 1.5 : 1;
      if (typeof (ctx as any).roundRect === 'function') {
        ctx.beginPath();
        (ctx as any).roundRect(labelX, labelY, boxW, boxH, 4);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(labelX, labelY, boxW, boxH);
        ctx.strokeRect(labelX, labelY, boxW, boxH);
      }

      ctx.fillStyle = colour;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(label, labelX + padX, labelY + padY);
    });
  }, [boxSize, drawGeometry, detectionForFrame, activeFrameMs, selectedId]);

  // ── polarity from the magnetogram ─────────────────────────────────────────
  useEffect(() => {
    if (!latestDetection || latestDetection.holes.length === 0) return;
    let cancelled = false;

    (async () => {
      setPolarityError(null);
      // Through the proxy, at the magnetogram's own resolution. Pointing an
      // <img> at jsoc1.stanford.edu and reading it back does not work: there
      // is no CORS header, so with crossOrigin set the image never loads and
      // without it the canvas is tainted and getImageData throws. Either way
      // the panel sat on "Reading the HMI magnetogram..." forever.
      //
      // Full resolution matters here more than it does elsewhere. Halving a
      // magnetogram averages neighbouring positive and negative network
      // elements into each other, and those cancel - which erodes exactly the
      // signed flux being measured.
      let image = null;
      for (const url of [HMI_MAG_URL, HMI_MAG_FALLBACK]) {
        try {
          image = await readImagePixels(url);
          break;
        } catch {
          // Try the other source before giving up on it.
        }
      }
      if (cancelled) return;
      if (!image) {
        setPolarityError('The HMI magnetogram could not be read, so polarity is unavailable for now.');
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
        // The ring outside is a sanity check on the boundary, not the answer:
        // quiet Sun is balanced, so an outside leaning the same way as the
        // inside means the outline probably is not where the hole ends.
        const surround = samplePolygonField(image, outline, geom, { b0, p, scale: 1.7, exclude: 1.1 });
        next[hole.id] = classifyChPolarity(inside, surround.total > 30 ? surround : null, lon);
      }
      if (!cancelled) setPolarity(next);
    })();

    return () => { cancelled = true; };
  }, [latestDetection]);

  // ── what to say about the selected hole ───────────────────────────────────
  const holes = latestDetection?.holes ?? [];
  const selected = holes.find((h) => h.id === selectedId) ?? holes[0] ?? null;

  const insight = useMemo(() => {
    if (!selected || !latestDetection) return null;
    const now = Date.now();

    // Every measurement of this hole we have, matched by proximity once each
    // older one is carried forward to today's disk.
    const samples: ChSample[] = [];
    for (const det of detections) {
      let best: CoronalHole | null = null;
      let bestDist = 22;
      for (const h of det.holes) {
        const projected = longitudeAt(h.lon, det.atMs, now);
        const selectedNow = longitudeAt(selected.lon, latestDetection.atMs, now);
        const d = Math.hypot(projected - selectedNow, h.lat - selected.lat);
        if (d < bestDist) { bestDist = d; best = h; }
      }
      if (best) {
        samples.push({
          atMs: det.atMs, widthDeg: best.widthDeg, darkness: best.darkness,
          longitude: best.lon,
        });
      }
    }

    const timing = chTiming(selected.lon, latestDetection.atMs, now);
    const choice = chSpeedForEarth(samples, estimateHssSpeedFromChWidthAndDarkness);
    const growth = chGrowth(samples);

    const centralMeridianMs = now + timing.daysToCentralMeridian * DAY_MS;
    const arrival = choice.speedKms != null ? hssArrivalMs(choice.speedKms, centralMeridianMs) : null;

    const pol = polarity[selected.id] ?? null;
    const season = pol ? sectorSeasonNote(pol.sector, new Date()) : null;

    return { timing, choice, growth, centralMeridianMs, arrival, samples, pol, season };
  }, [selected, latestDetection, detections, polarity]);

  const windowSpan = frameSpanHours(windowFrames);

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
        </div>
        <span className="text-xs text-neutral-500">
          {windowFrames.length} frame(s)
          {windowSpan != null && ` · ${windowSpan < 1 ? `${Math.round(windowSpan * 60)} min` : `${windowSpan.toFixed(1)}h`} of data`}
          {detectProgress && ` · measuring ${detectProgress.done}/${detectProgress.total}`}
        </span>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* The imagery, with the holes drawn on it */}
        <div className="lg:w-1/2 flex flex-col">
          <div ref={boxRef} className="relative w-full aspect-square bg-black rounded overflow-hidden">
            {activeUrl ? (
              <img
                ref={imgRef}
                src={activeUrl}
                alt="SUVI 195 with coronal holes outlined"
                className="w-full h-full object-contain"
                onLoad={handleImageLoad}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-neutral-500 text-sm">
                Loading SUVI 195 imagery...
              </div>
            )}
            <canvas
              ref={canvasRef}
              className="absolute inset-0 pointer-events-none"
              style={{ width: '100%', height: '100%' }}
            />
            {!detectionForFrame && activeUrl && (
              <div className="absolute top-2 left-2 text-[11px] text-neutral-300 bg-black/70 px-2 py-1 rounded">
                Measuring coronal holes...
              </div>
            )}
          </div>

          {/* Playback - the same controls, in the same order, as the SUVI
              imagery panel above, so the two do not behave differently. */}
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
                  {SPEED_OPTIONS.map((s) => (
                    <option key={`ch-speed-${s}`} value={s}>{s}x</option>
                  ))}
                </select>
              </label>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(0, windowFrames.length - 1)}
              value={clampedIndex}
              onChange={(e) => {
                setPlaying(false);
                setFrameIndex(Number(e.target.value));
              }}
              className="w-full accent-sky-500"
            />
            <div className="mt-1 text-xs text-neutral-500 text-right">
              {activeFrame ? `Frame: ${fmtNz(activeFrameMs)}` : 'No frame selected'}
              {detectionForFrame && detectionForFrame.atMs !== activeFrameMs && (
                <> · outlines measured {fmtRelative(detectionForFrame.atMs)}, rotated to this frame</>
              )}
            </div>
          </div>
        </div>

        {/* The list and the detail */}
        <div className="lg:w-1/2 flex flex-col gap-3">
          {detectError && holes.length === 0 && (
            <div className="text-sm text-neutral-400 bg-neutral-900/60 rounded p-3">{detectError}</div>
          )}

          <div className="flex flex-wrap gap-2">
            {holes.map((hole, i) => {
              const colour = HOLE_COLOURS[i % HOLE_COLOURS.length];
              const isSel = selected?.id === hole.id;
              return (
                <button
                  key={hole.id}
                  type="button"
                  onClick={() => setSelectedId(hole.id)}
                  className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                    isSel ? 'bg-neutral-700 border-neutral-500 text-white' : 'bg-neutral-800/70 border-neutral-700 hover:bg-neutral-700'}`}
                >
                  <span style={{ color: colour }} className="font-semibold">{i + 1}</span>
                  <span className="ml-2 text-neutral-300">{hole.widthDeg.toFixed(0)}° wide</span>
                </button>
              );
            })}
            {holes.length === 0 && !detectError && (
              <span className="text-sm text-neutral-500">Measuring the latest frame...</span>
            )}
          </div>

          {selected && insight && (() => {
            const { timing, choice, growth, centralMeridianMs, arrival, samples, pol, season } = insight;
            const band = choice.speedKms != null ? speedBand(choice.speedKms) : null;
            return (
              <div className="bg-neutral-900/60 rounded p-3 text-sm flex flex-col gap-3">

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
                      <div className="font-mono text-base text-sky-300">
                        {fmtNz(arrival)} <span className="text-neutral-400">± {ARRIVAL_UNCERTAINTY_HOURS} hours</span>
                      </div>
                      <div className="text-xs text-neutral-400 mt-0.5">
                        NZ time, {fmtRelative(arrival)} · window {fmtNz(arrival - ARRIVAL_UNCERTAINTY_HOURS * 3600000)}
                        {' to '}{fmtNz(arrival + ARRIVAL_UNCERTAINTY_HOURS * 3600000)}
                      </div>
                      <p className="text-xs text-neutral-500 mt-1">
                        Run from the moment the hole {timing.facingEarthOrPast ? 'crossed' : 'crosses'} the middle of the
                        disk ({fmtNz(centralMeridianMs)}), at the speed above. The seven hour window is real: a stream is
                        broadened by the hole's own width and slowed where it runs into slower wind ahead of it.
                      </p>
                    </>
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
                          <span className="ml-2 text-[11px] font-normal text-neutral-500">
                            {pol.confidence} confidence
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-neutral-400 mt-1">{pol.detail}</p>
                      {season?.note && (
                        <p className={`text-xs mt-1 ${
                          season.favourable === true ? 'text-emerald-300'
                            : season.favourable === false ? 'text-neutral-500'
                            : 'text-neutral-500'}`}>{season.note}</p>
                      )}
                    </>
                  ) : polarityError ? (
                    <p className="text-xs text-neutral-500">{polarityError}</p>
                  ) : (
                    <p className="text-xs text-neutral-400">Reading the HMI magnetogram...</p>
                  )}
                </div>

                {/* Where it is, and what it is doing */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div>
                    <div className="text-neutral-500">Position</div>
                    <div className="text-neutral-200 font-mono">
                      {timing.longitude >= 0 ? 'W' : 'E'}{Math.abs(timing.longitude).toFixed(0)}°
                      {' '}{selected.lat >= 0 ? 'N' : 'S'}{Math.abs(selected.lat).toFixed(0)}°
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
                      {selected.widthDeg.toFixed(0)}° × {(selected.heightDeg ?? selected.widthDeg).toFixed(0)}°
                    </div>
                  </div>
                  <div>
                    <div className="text-neutral-500">Trend</div>
                    <div className={`${
                      growth.phase === 'opening fast' ? 'text-orange-300'
                        : growth.phase === 'opening' ? 'text-yellow-300'
                        : growth.phase === 'closing' ? 'text-sky-300'
                        : 'text-neutral-200'}`}>
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
                  {samples.length} measurement{samples.length === 1 ? '' : 's'} of this hole across the window
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

export default CoronalHoleTracker;
