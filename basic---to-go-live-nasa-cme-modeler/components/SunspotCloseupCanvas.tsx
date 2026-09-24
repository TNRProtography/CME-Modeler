// The sunspot region close-up, drawn on a canvas so playback is smooth.
//
// It used to be an <img> moved with CSS. On each frame the picture changed at
// once but the move to re-centre the region was animated over the frame, so
// every frame first appeared off-centre and then slid back - the region
// jumped about. Here the frame and the crop that centres it are drawn
// together, in one paint, so the region cannot drift off its mark.
//
// Each new frame also fades in over the one before, both centred on the
// region, for about the time a frame is on screen. The region holds still
// and its changes blend from one frame to the next instead of stepping,
// which is what makes the playback feel continuous.
//
// Nothing blanks while it waits: the last picture stays up until the next is
// decoded, and a frame that arrives after a newer one is dropped.

import React, { useEffect, useRef } from 'react';
import { loadDecodedImage } from '../utils/decodedImages';

interface Props {
  url: string;
  /** Where the region is on the image, as a percentage of its width and height. */
  xPercent: number;
  yPercent: number;
  /**
   * How far in: the box shows 1/zoom of the image across. 6 frames a typical
   * active region with a little of the surface round it; a large one fills
   * the box.
   */
  zoom?: number;
  /** How long a new frame takes to fade in. 0 cuts straight to it. */
  fadeMs: number;
  alt: string;
  className?: string;
  /** Called when the frame asked for is on screen, or has failed. */
  onReady?: () => void;
}

interface Layer { img: HTMLImageElement; url: string; x: number; y: number }

const clampPct = (v: number) => Math.max(0, Math.min(100, v));

/** One layer, centred on its region, as the old CSS placed it: the image fitted in a box `zoom` times the view. */
function drawLayer(ctx: CanvasRenderingContext2D, W: number, H: number, zoom: number, l: Layer) {
  const nw = l.img.naturalWidth, nh = l.img.naturalHeight;
  if (!nw || !nh) return;
  const boxW = W * zoom, boxH = H * zoom;
  const s = Math.min(boxW / nw, boxH / nh);
  const left = W / 2 - (clampPct(l.x) / 100) * boxW + (boxW - nw * s) / 2;
  const top = H / 2 - (clampPct(l.y) / 100) * boxH + (boxH - nh * s) / 2;
  // Only the part of the image that lands on the canvas.
  const sx = Math.max(0, -left / s), sy = Math.max(0, -top / s);
  const ex = Math.min(nw, (W - left) / s), ey = Math.min(nh, (H - top) / s);
  if (ex <= sx || ey <= sy) return;
  ctx.drawImage(l.img, sx, sy, ex - sx, ey - sy, left + sx * s, top + sy * s, (ex - sx) * s, (ey - sy) * s);
}

const SunspotCloseupCanvas: React.FC<Props> = ({ url, xPercent, yPercent, zoom = 6, fadeMs, alt, className, onReady }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // What was on screen when the current frame started to fade in.
  const underRef = useRef<HTMLCanvasElement | null>(null);
  const currentRef = useRef<Layer | null>(null);
  const fadeRef = useRef<{ start: number; ms: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const seqRef = useRef(0);
  const shownSeqRef = useRef(0);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const paint = () => {
    rafRef.current = null;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const fade = fadeRef.current;
    const t = fade ? Math.min(1, (performance.now() - fade.start) / fade.ms) : 1;
    if (t < 1 && underRef.current) ctx.drawImage(underRef.current, 0, 0, W, H);
    if (currentRef.current) {
      ctx.globalAlpha = t;
      drawLayer(ctx, W, H, zoom, currentRef.current);
      ctx.globalAlpha = 1;
    }
    if (t < 1) rafRef.current = requestAnimationFrame(paint);
    else fadeRef.current = null;
  };

  const schedule = () => {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(paint);
  };

  // The canvas matches its box at the screen's pixel density, so the crop is
  // as sharp as the image allows.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        paint();
      }
    };
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    ro?.observe(canvas);
    return () => ro?.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); }, []);

  useEffect(() => {
    const seq = ++seqRef.current;
    const cur = currentRef.current;
    // Same picture, new position - the region moved on the same frame, or
    // another region on it was picked. Nothing to load or fade.
    if (cur && cur.url === url) {
      cur.x = xPercent;
      cur.y = yPercent;
      shownSeqRef.current = seq;
      schedule();
      onReadyRef.current?.();
      return;
    }
    loadDecodedImage(url).then((img) => {
      // A newer frame is already up: this one is late, so skip it.
      if (seq < shownSeqRef.current) return;
      if (!img) { onReadyRef.current?.(); return; }
      const canvas = canvasRef.current;
      if (!canvas) return;
      shownSeqRef.current = seq;
      if (currentRef.current?.url === url) {
        // Asked for twice while it loaded: just the newer position.
        currentRef.current.x = xPercent;
        currentRef.current.y = yPercent;
        schedule();
        return;
      }
      if (fadeMs > 0 && currentRef.current) {
        // Keep what is on screen now, mid-fade or not, as the picture the
        // new frame fades in over - so a frame arriving mid-fade never pops.
        const under = underRef.current ?? document.createElement('canvas');
        under.width = canvas.width;
        under.height = canvas.height;
        under.getContext('2d')?.drawImage(canvas, 0, 0);
        underRef.current = under;
        fadeRef.current = { start: performance.now(), ms: fadeMs };
      } else {
        fadeRef.current = null;
      }
      currentRef.current = { img, url, x: xPercent, y: yPercent };
      schedule();
      onReadyRef.current?.();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, xPercent, yPercent]);

  return <canvas ref={canvasRef} role="img" aria-label={alt} className={className} />;
};

export default SunspotCloseupCanvas;
