// --- START OF FILE src/utils/gifEncoder.ts ---
//
// Dependency-free animated GIF (GIF89a) encoder.
//
// Built for the SUVI / coronagraph timeline exports: takes full-frame RGBA
// buffers (all the same size), builds ONE global 256-colour palette across
// every frame via median-cut quantisation (a shared palette keeps the
// animation temporally stable and the file small), maps pixels with an
// exact-colour cache (solar imagery has a small set of distinct colours, so
// the cache hit rate is ~100%), LZW-compresses each frame per the GIF spec,
// and loops forever via the NETSCAPE2.0 application extension.
//
// The encode is async and yields to the event loop between frames so a long
// export never freezes the UI; pass shouldAbort to support cancellation.

export interface GifFrame {
  /** RGBA pixel data, width*height*4 bytes */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

// ── Growable byte sink ────────────────────────────────────────────────────────

class ByteSink {
  private buf = new Uint8Array(1 << 16);
  private len = 0;

  private ensure(extra: number) {
    if (this.len + extra <= this.buf.length) return;
    let next = this.buf.length * 2;
    while (next < this.len + extra) next *= 2;
    const grown = new Uint8Array(next);
    grown.set(this.buf.subarray(0, this.len));
    this.buf = grown;
  }

  byte(b: number) { this.ensure(1); this.buf[this.len++] = b & 0xff; }
  bytes(arr: ArrayLike<number>) { this.ensure(arr.length); this.buf.set(arr as Uint8Array, this.len); this.len += arr.length; }
  /** little-endian uint16 */
  u16(v: number) { this.byte(v & 0xff); this.byte((v >> 8) & 0xff); }
  ascii(s: string) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); }
  result(): Uint8Array { return this.buf.slice(0, this.len); }
}

// ── Median-cut palette quantisation ──────────────────────────────────────────

interface Box { pixels: number[]; rMin: number; rMax: number; gMin: number; gMax: number; bMin: number; bMax: number; }

function boxFromPixels(pixels: number[]): Box {
  let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
  for (const p of pixels) {
    const r = (p >> 16) & 0xff, g = (p >> 8) & 0xff, b = p & 0xff;
    if (r < rMin) rMin = r; if (r > rMax) rMax = r;
    if (g < gMin) gMin = g; if (g > gMax) gMax = g;
    if (b < bMin) bMin = b; if (b > bMax) bMax = b;
  }
  return { pixels, rMin, rMax, gMin, gMax, bMin, bMax };
}

/**
 * Build a ≤256-colour palette from sampled pixels across all frames.
 * Returns a flat [r,g,b, r,g,b, …] array, always exactly 256 entries
 * (padded with black) because the GIF global colour table must be 2^n.
 */
function buildPalette(frames: GifFrame[]): Uint8Array {
  // Sample up to ~60k pixels spread evenly over all frames.
  const TARGET_SAMPLES = 60_000;
  let totalPixels = 0;
  for (const f of frames) totalPixels += f.width * f.height;
  const stride = Math.max(1, Math.floor(totalPixels / TARGET_SAMPLES));

  const seen = new Set<number>();
  const samples: number[] = [];
  let counter = 0;
  for (const f of frames) {
    const d = f.data;
    for (let i = 0; i < d.length; i += 4) {
      if (counter++ % stride !== 0) continue;
      const c = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      samples.push(c);
      seen.add(c);
    }
  }

  // Trivial case: few distinct colours → use them directly.
  if (seen.size <= 256) {
    const palette = new Uint8Array(256 * 3);
    let idx = 0;
    for (const c of seen) {
      palette[idx * 3] = (c >> 16) & 0xff;
      palette[idx * 3 + 1] = (c >> 8) & 0xff;
      palette[idx * 3 + 2] = c & 0xff;
      idx++;
    }
    return palette;
  }

  // Median cut: split the box with the largest channel range until 256 boxes.
  let boxes: Box[] = [boxFromPixels(samples)];
  while (boxes.length < 256) {
    let bestIdx = -1, bestRange = -1;
    for (let i = 0; i < boxes.length; i++) {
      const bx = boxes[i];
      if (bx.pixels.length < 2) continue;
      const range = Math.max(bx.rMax - bx.rMin, bx.gMax - bx.gMin, bx.bMax - bx.bMin);
      if (range > bestRange) { bestRange = range; bestIdx = i; }
    }
    if (bestIdx === -1 || bestRange === 0) break;

    const bx = boxes[bestIdx];
    const rRange = bx.rMax - bx.rMin, gRange = bx.gMax - bx.gMin, bRange = bx.bMax - bx.bMin;
    const shift = (rRange >= gRange && rRange >= bRange) ? 16 : (gRange >= bRange ? 8 : 0);
    bx.pixels.sort((a, b) => ((a >> shift) & 0xff) - ((b >> shift) & 0xff));
    const mid = bx.pixels.length >> 1;
    boxes.splice(bestIdx, 1, boxFromPixels(bx.pixels.slice(0, mid)), boxFromPixels(bx.pixels.slice(mid)));
  }

  const palette = new Uint8Array(256 * 3);
  boxes.forEach((box, i) => {
    let r = 0, g = 0, b = 0;
    for (const p of box.pixels) { r += (p >> 16) & 0xff; g += (p >> 8) & 0xff; b += p & 0xff; }
    const n = Math.max(1, box.pixels.length);
    palette[i * 3] = Math.round(r / n);
    palette[i * 3 + 1] = Math.round(g / n);
    palette[i * 3 + 2] = Math.round(b / n);
  });
  return palette;
}

/** Map one frame's RGBA pixels to palette indices, with an exact-colour cache. */
function indexFrame(frame: GifFrame, palette: Uint8Array, cache: Map<number, number>): Uint8Array {
  const { data, width, height } = frame;
  const out = new Uint8Array(width * height);
  for (let p = 0, i = 0; p < out.length; p++, i += 4) {
    const c = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    let idx = cache.get(c);
    if (idx === undefined) {
      const r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff;
      let best = 0, bestDist = Infinity;
      for (let k = 0; k < 256; k++) {
        const dr = r - palette[k * 3], dg = g - palette[k * 3 + 1], db = b - palette[k * 3 + 2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) { bestDist = dist; best = k; if (dist === 0) break; }
      }
      idx = best;
      cache.set(c, idx);
    }
    out[p] = idx;
  }
  return out;
}

// ── LZW compression (GIF variant) ────────────────────────────────────────────

function lzwEncode(indices: Uint8Array, minCodeSize: number, sink: ByteSink) {
  sink.byte(minCodeSize);

  const CLEAR = 1 << minCodeSize;
  const EOI = CLEAR + 1;
  const MAX_CODE = 4095;

  // Sub-block buffering
  const block = new Uint8Array(255);
  let blockLen = 0;
  let bitBuf = 0, bitCnt = 0;

  const flushBlock = () => {
    if (!blockLen) return;
    sink.byte(blockLen);
    sink.bytes(block.subarray(0, blockLen));
    blockLen = 0;
  };
  const writeCode = (code: number, size: number) => {
    bitBuf |= code << bitCnt;
    bitCnt += size;
    while (bitCnt >= 8) {
      block[blockLen++] = bitBuf & 0xff;
      if (blockLen === 255) flushBlock();
      bitBuf >>= 8;
      bitCnt -= 8;
    }
  };

  let dict = new Map<number, number>();
  let nextCode = EOI + 1;
  let codeSize = minCodeSize + 1;
  const resetDict = () => { dict = new Map(); nextCode = EOI + 1; codeSize = minCodeSize + 1; };

  writeCode(CLEAR, codeSize);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    writeCode(prefix, codeSize);
    if (nextCode <= MAX_CODE) {
      dict.set(key, nextCode);
      if (nextCode === (1 << codeSize) && codeSize < 12) codeSize++;
      nextCode++;
    } else {
      writeCode(CLEAR, codeSize);
      resetDict();
    }
    prefix = k;
  }
  writeCode(prefix, codeSize);
  writeCode(EOI, codeSize);
  // Flush remaining bits
  while (bitCnt > 0) {
    block[blockLen++] = bitBuf & 0xff;
    if (blockLen === 255) flushBlock();
    bitBuf >>= 8;
    bitCnt -= 8;
  }
  flushBlock();
  sink.byte(0); // block terminator
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Encode RGBA frames into a looping animated GIF.
 *
 * @param frames    Equal-sized RGBA frames.
 * @param delaysCs  Per-frame delay in centiseconds (GIF native unit). Values
 *                  <2cs are clamped to 2 — browsers treat smaller delays as
 *                  10cs, which would IGNORE the requested speed.
 * @param onProgress  Called after each frame is encoded (done, total).
 * @param shouldAbort Return true to cancel; encode resolves null.
 */
export async function encodeGif(
  frames: GifFrame[],
  delaysCs: number[],
  onProgress?: (done: number, total: number) => void,
  shouldAbort?: () => boolean,
): Promise<Uint8Array | null> {
  if (!frames.length) return null;
  const { width, height } = frames[0];
  if (!width || !height) return null;

  const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

  const palette = buildPalette(frames);
  if (shouldAbort?.()) return null;
  await yieldToUi();

  const sink = new ByteSink();

  // Header + Logical Screen Descriptor (global colour table: 256 entries)
  sink.ascii('GIF89a');
  sink.u16(width);
  sink.u16(height);
  sink.byte(0xf7); // GCT present, 8-bit colour resolution, GCT size 2^8
  sink.byte(0);    // background colour index
  sink.byte(0);    // pixel aspect ratio
  sink.bytes(palette);

  // NETSCAPE2.0 — loop forever
  sink.byte(0x21); sink.byte(0xff); sink.byte(11);
  sink.ascii('NETSCAPE2.0');
  sink.byte(3); sink.byte(1); sink.u16(0); sink.byte(0);

  const cache = new Map<number, number>();
  for (let f = 0; f < frames.length; f++) {
    if (shouldAbort?.()) return null;

    const delay = Math.max(2, Math.round(delaysCs[f] ?? delaysCs[delaysCs.length - 1] ?? 10));

    // Graphic Control Extension
    sink.byte(0x21); sink.byte(0xf9); sink.byte(4);
    sink.byte(0x04); // disposal method 1 (do not dispose), no transparency
    sink.u16(delay);
    sink.byte(0);    // transparent colour index (unused)
    sink.byte(0);    // terminator

    // Image Descriptor — full frame, global palette, not interlaced
    sink.byte(0x2c);
    sink.u16(0); sink.u16(0);
    sink.u16(width); sink.u16(height);
    sink.byte(0);

    const indices = indexFrame(frames[f], palette, cache);
    lzwEncode(indices, 8, sink);

    onProgress?.(f + 1, frames.length);
    await yieldToUi();
  }

  sink.byte(0x3b); // trailer
  return sink.result();
}

/** Convenience: trigger a browser download of an encoded GIF. */
export function downloadGif(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'image/gif' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
// --- END OF FILE src/utils/gifEncoder.ts ---
