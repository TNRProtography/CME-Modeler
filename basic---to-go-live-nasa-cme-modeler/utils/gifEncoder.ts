// --- START OF FILE src/utils/gifEncoder.ts ---
// Animated-GIF encoder.  No external dependencies.
// Uses per-frame local colour tables (median-cut quantisation) for high quality.

/* ------------------------------------------------------------------ */
/*  Median-cut colour quantiser → 256-entry palette                   */
/* ------------------------------------------------------------------ */

function quantise(pixels: Uint8ClampedArray, maxColors: number): { palette: Uint8Array; indices: Uint8Array } {
  const len = pixels.length / 4;

  // Build a list of unique colours (sampled if >100k pixels for speed)
  const step = len > 100_000 ? Math.ceil(len / 80_000) : 1;
  const colorMap = new Map<number, number>(); // r<<16|g<<8|b → count
  for (let i = 0; i < len; i += step) {
    const off = i * 4;
    const key = (pixels[off] << 16) | (pixels[off + 1] << 8) | pixels[off + 2];
    colorMap.set(key, (colorMap.get(key) ?? 0) + 1);
  }

  // Collect into buckets for median-cut
  interface Box { colors: { r: number; g: number; b: number; count: number }[]; volume: number; }
  const allColors: Box['colors'] = [];
  for (const [key, count] of colorMap) {
    allColors.push({ r: (key >> 16) & 0xff, g: (key >> 8) & 0xff, b: key & 0xff, count });
  }

  if (allColors.length <= maxColors) {
    // Fewer unique colours than the palette - use them directly
    const palette = new Uint8Array(maxColors * 3);
    for (let i = 0; i < allColors.length; i++) {
      palette[i * 3] = allColors[i].r;
      palette[i * 3 + 1] = allColors[i].g;
      palette[i * 3 + 2] = allColors[i].b;
    }
    // Build index map
    const pMap = new Map<number, number>();
    for (let i = 0; i < allColors.length; i++) {
      const c = allColors[i];
      pMap.set((c.r << 16) | (c.g << 8) | c.b, i);
    }
    const indices = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      const off = i * 4;
      const key = (pixels[off] << 16) | (pixels[off + 1] << 8) | pixels[off + 2];
      indices[i] = pMap.get(key) ?? 0;
    }
    return { palette, indices };
  }

  const computeVolume = (box: Box): number => {
    let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
    for (const c of box.colors) {
      if (c.r < rMin) rMin = c.r; if (c.r > rMax) rMax = c.r;
      if (c.g < gMin) gMin = c.g; if (c.g > gMax) gMax = c.g;
      if (c.b < bMin) bMin = c.b; if (c.b > bMax) bMax = c.b;
    }
    return (rMax - rMin) * (gMax - gMin + 1) + (gMax - gMin) * (bMax - bMin + 1) + (bMax - bMin);
  };

  const splitBox = (box: Box): [Box, Box] => {
    let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
    for (const c of box.colors) {
      if (c.r < rMin) rMin = c.r; if (c.r > rMax) rMax = c.r;
      if (c.g < gMin) gMin = c.g; if (c.g > gMax) gMax = c.g;
      if (c.b < bMin) bMin = c.b; if (c.b > bMax) bMax = c.b;
    }
    const rRange = rMax - rMin, gRange = gMax - gMin, bRange = bMax - bMin;
    const channel = rRange >= gRange && rRange >= bRange ? 'r' : gRange >= bRange ? 'g' : 'b';
    box.colors.sort((a, b) => a[channel] - b[channel]);
    const mid = Math.max(1, box.colors.length >> 1);
    const a: Box = { colors: box.colors.slice(0, mid), volume: 0 };
    const b: Box = { colors: box.colors.slice(mid), volume: 0 };
    a.volume = computeVolume(a);
    b.volume = computeVolume(b);
    return [a, b];
  };

  let boxes: Box[] = [{ colors: allColors, volume: computeVolume({ colors: allColors, volume: 0 }) }];
  while (boxes.length < maxColors) {
    // Find box with largest volume to split
    let bestIdx = 0;
    for (let i = 1; i < boxes.length; i++) {
      if (boxes[i].volume > boxes[bestIdx].volume && boxes[i].colors.length > 1) bestIdx = i;
    }
    if (boxes[bestIdx].colors.length <= 1) break;
    const [a, b] = splitBox(boxes[bestIdx]);
    boxes.splice(bestIdx, 1, a, b);
  }

  // Compute average colour per box → palette
  const palette = new Uint8Array(maxColors * 3);
  const palRgb: [number, number, number][] = [];
  for (let i = 0; i < boxes.length && i < maxColors; i++) {
    let rSum = 0, gSum = 0, bSum = 0, total = 0;
    for (const c of boxes[i].colors) {
      rSum += c.r * c.count; gSum += c.g * c.count; bSum += c.b * c.count; total += c.count;
    }
    const r = Math.round(rSum / total), g = Math.round(gSum / total), b = Math.round(bSum / total);
    palette[i * 3] = r; palette[i * 3 + 1] = g; palette[i * 3 + 2] = b;
    palRgb.push([r, g, b]);
  }
  // Fill remaining slots
  for (let i = boxes.length; i < maxColors; i++) palRgb.push([0, 0, 0]);

  // Map every pixel to nearest palette entry
  const indices = new Uint8Array(len);
  // Build a small cache for speed (key → palette index)
  const cache = new Map<number, number>();
  for (let i = 0; i < len; i++) {
    const off = i * 4;
    const key = (pixels[off] << 16) | (pixels[off + 1] << 8) | pixels[off + 2];
    let idx = cache.get(key);
    if (idx === undefined) {
      const r = pixels[off], g = pixels[off + 1], b = pixels[off + 2];
      let bestDist = Infinity;
      idx = 0;
      for (let p = 0; p < palRgb.length; p++) {
        const dr = r - palRgb[p][0], dg = g - palRgb[p][1], db = b - palRgb[p][2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) { bestDist = dist; idx = p; }
        if (dist === 0) break;
      }
      cache.set(key, idx);
    }
    indices[i] = idx;
  }

  return { palette, indices };
}

/* ------------------------------------------------------------------ */
/*  LZW compressor (variable-width codes, GIF flavour)                */
/* ------------------------------------------------------------------ */

function lzwCompress(indexStream: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;

  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  const MAX_CODE = 4095;

  // Trie stored as Map<string, number> for correctness (no key collisions)
  let table = new Map<string, number>();
  const trieKey = (prefix: number, k: number) => `${prefix},${k}`;

  const resetTable = () => {
    table.clear();
    codeSize = minCodeSize + 1;
    nextCode = eoiCode + 1;
  };

  // Bit-packing buffer
  const output: number[] = [];
  let bitBuf = 0;
  let bitPos = 0;
  const emit = (code: number) => {
    bitBuf |= code << bitPos;
    bitPos += codeSize;
    while (bitPos >= 8) {
      output.push(bitBuf & 0xff);
      bitBuf >>= 8;
      bitPos -= 8;
    }
  };

  resetTable();
  emit(clearCode);

  if (indexStream.length === 0) {
    emit(eoiCode);
    if (bitPos > 0) output.push(bitBuf & 0xff);
    return new Uint8Array(output);
  }

  let prefix = indexStream[0]; // single-byte codes 0-255 are implicit
  for (let i = 1; i < indexStream.length; i++) {
    const k = indexStream[i];
    const key = trieKey(prefix, k);
    const existing = table.get(key);
    if (existing !== undefined) {
      prefix = existing;
    } else {
      emit(prefix);
      if (nextCode <= MAX_CODE) {
        table.set(key, nextCode++);
        if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
      } else {
        emit(clearCode);
        resetTable();
      }
      prefix = k;
    }
  }
  emit(prefix);
  emit(eoiCode);
  if (bitPos > 0) output.push(bitBuf & 0xff);
  return new Uint8Array(output);
}

/* ------------------------------------------------------------------ */
/*  Sub-block writer (GIF wraps LZW data in ≤255-byte chunks)        */
/* ------------------------------------------------------------------ */

function subBlocks(data: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let offset = 0;
  while (offset < data.length) {
    const size = Math.min(255, data.length - offset);
    const chunk = new Uint8Array(size + 1);
    chunk[0] = size;
    chunk.set(data.subarray(offset, offset + size), 1);
    parts.push(chunk);
    offset += size;
  }
  const total = parts.reduce((s, p) => s + p.length, 0) + 1;
  const result = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { result.set(p, pos); pos += p.length; }
  result[pos] = 0; // block terminator
  return result;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

export interface GifFrame {
  /** RGBA pixel data (same width×height as the GIF). */
  data: ImageData;
  /** Frame delay in milliseconds. */
  delayMs: number;
}

/**
 * Encode an animated GIF from an array of RGBA frames.
 * Uses per-frame local colour tables (median-cut quantisation) for high quality.
 */
export function encodeGif(
  width: number,
  height: number,
  frames: GifFrame[],
  onProgress?: (done: number, total: number) => void,
): Blob {
  const parts: Uint8Array[] = [];

  // ── Header ──
  parts.push(strBytes('GIF89a'));

  // ── Logical Screen Descriptor ──
  // We use local colour tables per frame, so no global colour table.
  const lsd = new Uint8Array(7);
  lsd[0] = width & 0xff;  lsd[1] = (width >> 8) & 0xff;
  lsd[2] = height & 0xff; lsd[3] = (height >> 8) & 0xff;
  lsd[4] = 0x70; // no GCT, colour-res=7 (8 bits per channel)
  lsd[5] = 0;    // bg colour index
  lsd[6] = 0;    // pixel aspect ratio
  parts.push(lsd);

  // ── NETSCAPE2.0 Application Extension (infinite loop) ──
  parts.push(new Uint8Array([
    0x21, 0xff, 0x0b,
    0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, // "NETSCAPE"
    0x32, 0x2e, 0x30,                                 // "2.0"
    0x03, 0x01,
    0x00, 0x00, // loop count = 0 (infinite)
    0x00,       // block terminator
  ]));

  const minCodeSize = 8;

  for (let fi = 0; fi < frames.length; fi++) {
    const frame = frames[fi];
    const delay = Math.max(2, Math.round(frame.delayMs / 10)); // centiseconds, min 20ms

    // Quantise this frame's pixels to 256 colours
    const { palette, indices } = quantise(frame.data.data, 256);

    // ── Graphics Control Extension ──
    parts.push(new Uint8Array([
      0x21, 0xf9, 0x04,
      0x00,                            // disposal=0, no transparency
      delay & 0xff, (delay >> 8) & 0xff,
      0x00,                            // transparent colour index (unused)
      0x00,                            // terminator
    ]));

    // ── Image Descriptor (with local colour table) ──
    const imgDesc = new Uint8Array(10);
    imgDesc[0] = 0x2c;
    // left, top = 0,0
    imgDesc[5] = width & 0xff;  imgDesc[6] = (width >> 8) & 0xff;
    imgDesc[7] = height & 0xff; imgDesc[8] = (height >> 8) & 0xff;
    imgDesc[9] = 0x87; // local colour table flag=1, size=7 (256 entries)
    parts.push(imgDesc);

    // ── Local Colour Table (256 × 3 bytes) ──
    parts.push(palette);

    // ── LZW-encode and sub-block ──
    parts.push(new Uint8Array([minCodeSize]));
    const compressed = lzwCompress(indices, minCodeSize);
    parts.push(subBlocks(compressed));

    onProgress?.(fi + 1, frames.length);
  }

  // ── Trailer ──
  parts.push(new Uint8Array([0x3b]));

  return new Blob(parts, { type: 'image/gif' });
}

function strBytes(s: string): Uint8Array {
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
}
// --- END OF FILE src/utils/gifEncoder.ts ---
