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

/** Where to start: the screen's own density, capped, and a little lower on small screens. */
export function initialPixelRatio(devicePixelRatio: number, widthCss: number, o: QualityOptions = DEFAULT_QUALITY): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  // Phones have the densest screens and the weakest GPUs.
  const cap = widthCss < 768 ? Math.min(o.maxRatio, 1.5) : o.maxRatio;
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
