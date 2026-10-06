// How sharp to draw the 3D scene, adjusted to what the device can keep up.
//
// Rendering at the screen's full pixel density is what made playback a
// slideshow on phones and Retina laptops: a density of 3 is nine times the
// pixels of 1, and every CME is thousands of overlapping glowing sprites, so
// the GPU spends each frame filling pixels nobody can tell apart. Starting
// capped, and stepping down whenever frames run long, keeps the motion
// smooth; stepping back up once there is headroom keeps it sharp where the
// device can afford it. Pure, so it can be tested without a GPU.

export interface QualityOptions {
  /** Never sharper than this, whatever the screen. */
  maxRatio: number;
  /** Never softer than this. */
  minRatio: number;
  /** A step up or down. */
  step: number;
  /** Frames this long on average and the scene steps down (ms). */
  slowFrameMs: number;
  /** Frames this quick on average, for long enough, and it steps up (ms). */
  fastFrameMs: number;
  /** How long a window each decision averages over (ms). */
  windowMs: number;
  /** Good windows in a row before stepping up, so it does not oscillate. */
  windowsBeforeUp: number;
}

export const DEFAULT_QUALITY: QualityOptions = {
  maxRatio: 2,
  minRatio: 0.75,
  step: 0.25,
  slowFrameMs: 24,
  fastFrameMs: 18,
  windowMs: 1000,
  windowsBeforeUp: 4,
};

/**
 * The most pixels the scene draws per frame at the start: about a 1080p
 * screen at 1.6x. A big Retina window at full density is far more - a 16"
 * MacBook Pro full screen is 7.7 million, a 5K iMac 14.7 million - every one
 * of them filled each frame for glows nobody can tell apart from slightly
 * softer ones, and a strong GPU never runs slow enough for the adaptive step
 * down below to notice. It just runs flat out.
 */
export const MAX_START_PIXELS = 5_000_000;

/**
 * Where to start: the screen's own density, capped, a little lower on small
 * screens, and - when the height is given - lowered until the whole canvas
 * fits within MAX_START_PIXELS.
 */
export function initialPixelRatio(devicePixelRatio: number, widthCss: number, o: QualityOptions = DEFAULT_QUALITY, heightCss?: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  // Phones have the densest screens and the weakest GPUs.
  let cap = widthCss < 768 ? Math.min(o.maxRatio, 1.5) : o.maxRatio;
  if (heightCss && heightCss > 0 && widthCss > 0) {
    const fit = Math.sqrt(MAX_START_PIXELS / (widthCss * heightCss));
    // To the nearest step, so it lands on the same ratios the adaptive steps use.
    cap = Math.min(cap, Math.round(fit / o.step) * o.step);
  }
  return Math.max(o.minRatio, Math.min(dpr, cap));
}

export class AdaptivePixelRatio {
  ratio: number;
  private readonly ceiling: number;
  private windowStart = -1;
  private frames = 0;
  private total = 0;
  private goodWindows = 0;

  constructor(start: number, private readonly o: QualityOptions = DEFAULT_QUALITY) {
    this.ratio = start;
    this.ceiling = start;
  }

  /**
   * One frame took `frameMs`. Returns the new ratio when it should change,
   * otherwise null. Frames longer than a quarter second are the tab being in
   * the background or the page busy with something else, and are ignored.
   */
  frame(nowMs: number, frameMs: number): number | null {
    if (!(frameMs > 0) || frameMs > 250) return null;
    if (this.windowStart < 0) this.windowStart = nowMs;
    this.frames++;
    this.total += frameMs;
    if (nowMs - this.windowStart < this.o.windowMs) return null;

    const average = this.total / this.frames;
    this.windowStart = nowMs;
    this.frames = 0;
    this.total = 0;

    if (average > this.o.slowFrameMs && this.ratio > this.o.minRatio) {
      this.goodWindows = 0;
      this.ratio = Math.max(this.o.minRatio, this.ratio - this.o.step);
      return this.ratio;
    }
    if (average < this.o.fastFrameMs) {
      this.goodWindows++;
      if (this.goodWindows >= this.o.windowsBeforeUp && this.ratio < this.ceiling) {
        this.goodWindows = 0;
        this.ratio = Math.min(this.ceiling, this.ratio + this.o.step);
        return this.ratio;
      }
    } else {
      this.goodWindows = 0;
    }
    return null;
  }
}
