import React, { useEffect, useRef } from 'react';

/**
 * AuroraOverlay
 * ----------------------------------------------------------------
 * A purely-decorative animated aurora effect intended to sit BETWEEN
 * the background photo and the foreground UI. It adds a live shimmer
 * of green low-band + magenta/pink pillars so the static photo
 * feels alive.
 *
 * Layering (bottom to top on the page):
 *   photo -> bg-black/50 darkener -> THIS overlay -> content (z-10+)
 *
 * Design principles for eliminating hard edges:
 *  - Every gradient fades to zero alpha well BEFORE its own boundary
 *    (target: gradient stops carry the alpha to 0 by ~70% radius).
 *  - Every layer overshoots the viewport by 40-60% on the axes where
 *    its light is meant to bleed offscreen, so its zero-alpha tail
 *    ends outside what the user can see.
 *  - Large blurs (45-90px) further smear any residual boundary.
 *  - `mix-blend-mode: screen` so layers add light rather than paint
 *    over the photo.
 *  - `pointer-events: none` so nothing under is blocked.
 *
 * Performance: the blur is baked in, not a CSS filter.
 *  These layers used to be CSS gradients with `filter: blur(45-90px)`,
 *  drifting forever. A filter on a moving layer is run again on every
 *  frame, and four blurs that wide over layers twice the screen's width
 *  were most of what a phone's GPU did on these pages - at rest and,
 *  worse, while scrolling. Now each layer is painted once, small (an
 *  eighth of its size), blurred once in JavaScript, and drawn into a
 *  canvas the browser scales up. A blurred picture holds no detail an
 *  eighth of the size would lose, so it looks the same; and moving it
 *  is now only a transform and an opacity, which the GPU does for free.
 *  It is repainted only when the layer's size changes.
 */

/** The fraction of its CSS size each layer is painted at. */
const SCALE = 1 / 8;

type Stop = [number, string];

/**
 * A CSS `radial-gradient(ellipse ...)`: centred at (cx, cy) with radii
 * (rx, ry), its stops along the radius.
 */
function paintEllipse(ctx: CanvasRenderingContext2D, w: number, h: number,
  cx: number, cy: number, rx: number, ry: number, stops: Stop[]) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(rx, ry);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  for (const [at, colour] of stops) g.addColorStop(at, colour);
  ctx.fillStyle = g;
  ctx.fillRect(-cx / rx, -cy / ry, w / rx, h / ry);
  ctx.restore();
}

/**
 * `ellipse at X Y` with no size is CSS's farthest-corner: the farthest
 * sides' proportions, grown until it passes through the farthest corner.
 */
function paintFarthestCorner(ctx: CanvasRenderingContext2D, w: number, h: number,
  xFrac: number, yFrac: number, stops: Stop[]) {
  const cx = w * xFrac, cy = h * yFrac;
  const fx = Math.max(cx, w - cx), fy = Math.max(cy, h - cy);
  paintEllipse(ctx, w, h, cx, cy, fx * Math.SQRT2, fy * Math.SQRT2, stops);
}

/** A CSS `repeating-linear-gradient(<deg>, ...)`, stops in px. */
function paintRepeatingLinear(ctx: CanvasRenderingContext2D, w: number, h: number,
  deg: number, period: number, stops: Stop[]) {
  const a = (deg * Math.PI) / 180;
  const dx = Math.sin(a), dy = -Math.cos(a);
  const len = Math.abs(w * dx) + Math.abs(h * dy);
  const x0 = w / 2 - (dx * len) / 2, y0 = h / 2 - (dy * len) / 2;
  const g = ctx.createLinearGradient(x0, y0, x0 + dx * len, y0 + dy * len);
  for (let base = 0; base < len; base += period) {
    for (const [at, colour] of stops) {
      const t = (base + at) / len;
      if (t >= 0 && t <= 1) g.addColorStop(t, colour);
    }
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/**
 * A Gaussian blur of standard deviation `sigma` pixels, as three box blurs,
 * on premultiplied colour so transparent pixels do not darken what they
 * blur into. Outside the canvas counts as transparent, as it does for a
 * CSS blur at an element's edge.
 */
function blurInPlace(img: ImageData, sigma: number) {
  const r = Math.max(1, Math.round(sigma));
  const { width: w, height: h, data } = img;
  const n = w * h;
  const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    const al = data[i * 4 + 3] / 255;
    ch[0][i] = data[i * 4] * al;
    ch[1][i] = data[i * 4 + 1] * al;
    ch[2][i] = data[i * 4 + 2] * al;
    ch[3][i] = al;
  }
  const tmp = new Float32Array(n);
  const box = (src: Float32Array, horizontal: boolean) => {
    const lines = horizontal ? h : w, span = horizontal ? w : h;
    const at = horizontal ? (l: number, k: number) => l * w + k : (l: number, k: number) => k * w + l;
    const norm = 1 / (2 * r + 1);
    for (let l = 0; l < lines; l++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) if (k >= 0 && k < span) sum += src[at(l, k)];
      for (let k = 0; k < span; k++) {
        tmp[at(l, k)] = sum * norm;
        const out = k - r, inn = k + r + 1;
        if (out >= 0) sum -= src[at(l, out)];
        if (inn < span) sum += src[at(l, inn)];
      }
    }
    src.set(tmp);
  };
  for (const c of ch) {
    for (let pass = 0; pass < 3; pass++) { box(c, true); box(c, false); }
  }
  for (let i = 0; i < n; i++) {
    const al = ch[3][i];
    data[i * 4 + 3] = Math.round(al * 255);
    if (al > 0) {
      data[i * 4] = Math.min(255, Math.round(ch[0][i] / al));
      data[i * 4 + 1] = Math.min(255, Math.round(ch[1][i] / al));
      data[i * 4 + 2] = Math.min(255, Math.round(ch[2][i] / al));
    }
  }
}

interface LayerProps {
  /** Where the layer sits, as the CSS layer did. */
  place: React.CSSProperties;
  /** How wide the CSS blur was, in px. */
  blur: number;
  animation: string;
  /**
   * A second animation, run on the canvas inside rather than on the layer.
   * Two animations of one property on one element cannot both run on the
   * GPU, so Chrome runs them on the main thread, every frame.
   */
  innerAnimation?: string;
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

const AuroraLayer: React.FC<LayerProps> = ({ place, blur, animation, innerAnimation, paint }) => {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const box = boxRef.current, canvas = canvasRef.current;
    if (!box || !canvas) return;
    let drawnW = -1, drawnH = -1;
    // A CSS blur spreads past its box - which matters here, where a layer is
    // brightest right on its own edge - so the canvas is larger than the box
    // by three blur widths all round, the gradient painted in the box only,
    // as a CSS background is, and the blur left to spread into the margin.
    const pad = blur * 3;
    const draw = () => {
      const boxW = box.clientWidth, boxH = box.clientHeight;
      if (!boxW || !boxH) return;
      const cssW = boxW + 2 * pad, cssH = boxH + 2 * pad;
      const w = Math.max(2, Math.ceil(cssW * SCALE)), h = Math.max(2, Math.ceil(cssH * SCALE));
      // The mobile address bar showing and hiding changes the height by a
      // few px; nothing worth repainting for.
      if (Math.abs(w - drawnW) < 2 && Math.abs(h - drawnH) < 2) return;
      drawnW = w; drawnH = h;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(w / cssW, 0, 0, h / cssH, 0, 0);
      ctx.translate(pad, pad);
      ctx.beginPath();
      ctx.rect(0, 0, boxW, boxH);
      ctx.clip();
      paint(ctx, boxW, boxH);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      try {
        const img = ctx.getImageData(0, 0, w, h);
        blurInPlace(img, blur * SCALE);
        ctx.putImageData(img, 0, 0);
      } catch { /* unblurred is still soft at this scale */ }
    };
    draw();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(draw) : null;
    ro?.observe(box);
    return () => ro?.disconnect();
  }, [paint, blur]);

  return (
    <div
      ref={boxRef}
      className="aurora-layer"
      style={{ position: 'absolute', ...place, mixBlendMode: 'screen', animation, willChange: 'transform, opacity' }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute', display: 'block',
          left: -blur * 3, top: -blur * 3,
          width: `calc(100% + ${blur * 6}px)`, height: `calc(100% + ${blur * 6}px)`,
          ...(innerAnimation ? { animation: innerAnimation, willChange: 'opacity' } : null),
        }}
        className={innerAnimation ? 'aurora-layer' : undefined}
      />
    </div>
  );
};

// The four layers, with the gradients the CSS version had. Where a stop
// faded to transparent black it fades to its own colour at zero alpha,
// which is how CSS blends it and stops the fade dimming through grey.

const paintLowBand = (ctx: CanvasRenderingContext2D, w: number, h: number) =>
  paintFarthestCorner(ctx, w, h, 0.5, 1, [
    [0, 'rgba(120,255,180,0.9)'], [0.18, 'rgba(100,240,170,0.55)'], [0.34, 'rgba(80,220,150,0.28)'],
    [0.5, 'rgba(60,180,140,0.10)'], [0.68, 'rgba(60,180,140,0)'],
  ]);

const paintHighWash = (ctx: CanvasRenderingContext2D, w: number, h: number) =>
  paintFarthestCorner(ctx, w, h, 0.55, 1, [
    [0, 'rgba(140,255,200,0.55)'], [0.22, 'rgba(110,230,180,0.30)'], [0.42, 'rgba(90,200,150,0.14)'],
    [0.65, 'rgba(90,200,150,0)'],
  ]);

const paintPillars = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
  paintRepeatingLinear(ctx, w, h, 92, 420, [
    [0, 'rgba(230,110,200,0)'], [80, 'rgba(230,110,200,0)'], [110, 'rgba(230,110,200,0.10)'],
    [150, 'rgba(180,90,220,0.14)'], [220, 'rgba(180,90,220,0)'], [320, 'rgba(255,120,190,0)'],
    [360, 'rgba(255,120,190,0.09)'], [420, 'rgba(255,120,190,0)'],
  ]);
  ctx.globalCompositeOperation = 'screen';
  paintEllipse(ctx, w, h, w * 0.5, h * 0.9, w * 0.55, h * 0.8, [
    [0, 'rgba(230,110,200,0.42)'], [0.25, 'rgba(200,100,220,0.24)'], [0.5, 'rgba(180,90,220,0.10)'],
    [0.72, 'rgba(180,90,220,0)'],
  ]);
  ctx.globalCompositeOperation = 'source-over';
};

const paintSkyGlow = (ctx: CanvasRenderingContext2D, w: number, h: number) =>
  paintFarthestCorner(ctx, w, h, 0.5, 0.9, [
    [0, 'rgba(220,120,180,0.32)'], [0.25, 'rgba(190,100,200,0.16)'], [0.5, 'rgba(160,80,200,0.06)'],
    [0.72, 'rgba(160,80,200,0)'],
  ]);

const AuroraOverlay: React.FC = () => {
  return (
    <>
      <style>{`
        /* Movement only: the low band's brightness is the shimmer's. */
        @keyframes aurora-drift-a {
          0%   { transform: translate3d(-3%, 0, 0) scaleY(1); }
          50%  { transform: translate3d( 3%, -1%, 0) scaleY(1.1); }
          100% { transform: translate3d(-3%, 0, 0) scaleY(1); }
        }
        @keyframes aurora-drift-b {
          0%   { transform: translate3d( 2%, 0, 0) scaleY(1.05); opacity: 0.55; }
          50%  { transform: translate3d(-2%, 1%, 0) scaleY(1);    opacity: 0.9;  }
          100% { transform: translate3d( 2%, 0, 0) scaleY(1.05); opacity: 0.55; }
        }
        @keyframes aurora-pillars {
          0%   { transform: translate3d(-1.5%, 0, 0) skewX(-2deg); opacity: 0.7;  }
          40%  { transform: translate3d( 1.5%, 0, 0) skewX( 2deg); opacity: 1;    }
          70%  { transform: translate3d( 0%, 0, 0) skewX(-1deg);   opacity: 0.85; }
          100% { transform: translate3d(-1.5%, 0, 0) skewX(-2deg); opacity: 0.7;  }
        }
        @keyframes aurora-shimmer {
          0%,100% { opacity: 0.82; }
          50%     { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .aurora-layer { animation: none !important; }
        }
      `}</style>

      <div
        aria-hidden="true"
        className="absolute inset-0 z-0 overflow-hidden pointer-events-none"
      >
        {/* Bright green low band. Its brightness breathes on its own,
            slower period, on the canvas inside; the layer drifts. (Both on
            the one element, the shimmer won the opacity anyway.) */}
        <AuroraLayer
          place={{ left: '-60%', right: '-60%', bottom: '18%', height: 'clamp(220px, 34vh, 420px)' }}
          blur={60}
          animation="aurora-drift-a 14s ease-in-out infinite"
          innerAnimation="aurora-shimmer 9s ease-in-out infinite"
          paint={paintLowBand}
        />
        {/* Secondary softer green wash slightly higher - adds depth. */}
        <AuroraLayer
          place={{ left: '-70%', right: '-70%', bottom: '30%', height: 'clamp(200px, 30vh, 400px)' }}
          blur={75}
          animation="aurora-drift-b 22s ease-in-out infinite"
          paint={paintHighWash}
        />
        {/* Magenta/pink pillar wash: a broad diffuse wash with faint
            column texture, faded on every axis by its own gradient. */}
        <AuroraLayer
          place={{ left: '-40%', right: '-40%', bottom: '25%', height: 'clamp(320px, 62vh, 780px)' }}
          blur={45}
          animation="aurora-pillars 18s ease-in-out infinite"
          paint={paintPillars}
        />
        {/* Broad magenta sky glow - matches the photo's pink upper sky. */}
        <AuroraLayer
          place={{ left: '-50%', right: '-50%', top: '0%', height: 'clamp(340px, 65vh, 820px)' }}
          blur={90}
          animation="aurora-drift-b 26s ease-in-out infinite"
          paint={paintSkyGlow}
        />
      </div>
    </>
  );
};

export default AuroraOverlay;
