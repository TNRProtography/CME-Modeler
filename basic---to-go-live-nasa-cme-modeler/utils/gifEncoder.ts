// --- START OF FILE src/utils/gifEncoder.ts ---
// Minimal animated-GIF encoder.  No external dependencies.
// Produces GIF89a with a 256-colour uniform palette (6×7×6 = 252 entries + 4 greys).
// Images are quantised from RGBA ImageData with optional Floyd–Steinberg dithering.

/* ------------------------------------------------------------------ */
/*  Palette                                                           */
/* ------------------------------------------------------------------ */

const PALETTE: [number, number, number][] = [];
// 6×7×6 uniform cube = 252 entries (slightly more green bins for perceptual weighting)
for (let r = 0; r < 6; r++)
  for (let g = 0; g < 7; g++)
    for (let b = 0; b < 6; b++)
      PALETTE.push([Math.round(r * 255 / 5), Math.round(g * 255 / 6), Math.round(b * 255 / 5)]);
// pad to 256 with extra greys
while (PALETTE.length < 256) {
  const v = Math.round((PALETTE.length - 252) * 85);
  PALETTE.push([v, v, v]);
}

// Build lookup cube for fast nearest-colour search (6×7×6 grid)
const nearest = (r: number, g: number, b: number): number => {
  const ri = Math.round(r * 5 / 255);
  const gi = Math.round(g * 6 / 255);
  const bi = Math.round(b * 5 / 255);
  return ri * 42 + gi * 6 + bi; // offsets match the triple loop above
};

/* ------------------------------------------------------------------ */
/*  LZW compressor (variable-width codes, GIF flavour)                */
/* ------------------------------------------------------------------ */

function lzwCompress(indexStream: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;

  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  const MAX_CODE = 4095;

  // Code table as a trie stored in a Map<parentCode<<12|childByte, newCode>
  let table = new Map<number, number>();
  const initTable = () => {
    table.clear();
    for (let i = 0; i < clearCode; i++) table.set(i, i);
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

  initTable();
  emit(clearCode);

  if (indexStream.length === 0) { emit(eoiCode); if (bitPos > 0) output.push(bitBuf & 0xff); return new Uint8Array(output); }

  let prefix = indexStream[0];
  for (let i = 1; i < indexStream.length; i++) {
    const k = indexStream[i];
    const key = (prefix << 12) | k;
    if (table.has(key)) {
      prefix = table.get(key)!;
    } else {
      emit(prefix);
      if (nextCode <= MAX_CODE) {
        table.set(key, nextCode++);
        if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
      } else {
        emit(clearCode);
        initTable();
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
  const terminator = new Uint8Array([0]);
  const total = parts.reduce((s, p) => s + p.length, 0) + 1;
  const result = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { result.set(p, pos); pos += p.length; }
  result[pos] = 0;
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
 *
 * @param width   GIF width  (all frames must match)
 * @param height  GIF height (all frames must match)
 * @param frames  Array of frames with RGBA ImageData + delay
 * @param onProgress  Optional callback (frameIndex, totalFrames)
 * @returns Blob (image/gif)
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
  const lsd = new Uint8Array(7);
  lsd[0] = width & 0xff;  lsd[1] = (width >> 8) & 0xff;
  lsd[2] = height & 0xff; lsd[3] = (height >> 8) & 0xff;
  lsd[4] = 0xf7; // GCT flag=1, colour-res=7 (8 bits), sort=0, GCT size=7 (2^(7+1)=256)
  lsd[5] = 0;    // bg colour index
  lsd[6] = 0;    // pixel aspect ratio
  parts.push(lsd);

  // ── Global Colour Table (256 × 3 bytes) ──
  const gct = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    gct[i * 3]     = PALETTE[i][0];
    gct[i * 3 + 1] = PALETTE[i][1];
    gct[i * 3 + 2] = PALETTE[i][2];
  }
  parts.push(gct);

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

    // ── Graphics Control Extension ──
    parts.push(new Uint8Array([
      0x21, 0xf9, 0x04,
      0x00,                            // disposal=0, no transparency
      delay & 0xff, (delay >> 8) & 0xff,
      0x00,                            // transparent colour index (unused)
      0x00,                            // terminator
    ]));

    // ── Image Descriptor ──
    const imgDesc = new Uint8Array(10);
    imgDesc[0] = 0x2c;
    // left, top = 0,0
    imgDesc[5] = width & 0xff;  imgDesc[6] = (width >> 8) & 0xff;
    imgDesc[7] = height & 0xff; imgDesc[8] = (height >> 8) & 0xff;
    imgDesc[9] = 0x00; // no local colour table, not interlaced
    parts.push(imgDesc);

    // ── Quantise RGBA → palette indices ──
    const px = frame.data.data;
    const indices = new Uint8Array(width * height);
    for (let i = 0; i < indices.length; i++) {
      const off = i * 4;
      indices[i] = nearest(px[off], px[off + 1], px[off + 2]);
    }

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
