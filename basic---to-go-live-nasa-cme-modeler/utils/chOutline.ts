// A coronal hole's outline, small enough to keep one for every sighting.
//
// The detector's polygon is up to a couple of hundred vertices, each an
// offset in degrees from the hole's centre. Kept as JSON that is about 5 KB a
// hole a frame; ninety days of it would not fit anywhere sensible. Packed as
// tenths of a degree in 16-bit integers and base64, it is about 1 KB, with no
// visible loss: a tenth of a degree is under a pixel on any view of the Sun.
//
// Plain functions, no browser APIs: the forecast worker validates these.

export type OutlinePoint = { lat: number; lon: number };

/** More vertices than this are thinned evenly; the shape does not need them. */
export const MAX_OUTLINE_POINTS = 200;
/** An encoded outline longer than this is refused (MAX_OUTLINE_POINTS at 4 bytes, base64). */
export const MAX_OUTLINE_CHARS = Math.ceil((MAX_OUTLINE_POINTS * 4) / 3) * 4 + 4;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
      + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=')
      + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
}

function fromBase64(text: string): Uint8Array | null {
  if (text.length % 4 !== 0) return null;
  const pad = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const ch = text[i + k];
      const v = ch === '=' ? 0 : B64.indexOf(ch);
      if (v < 0) return null;
      n = (n << 6) | v;
    }
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

const clampTenths = (deg: number) => Math.max(-32768, Math.min(32767, Math.round(deg * 10)));

/** A polygon packed for storage, or undefined when there is none worth keeping. */
export function encodeOutline(points: OutlinePoint[] | undefined | null): string | undefined {
  if (!Array.isArray(points) || points.length < 3) return undefined;
  const usable = points.filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon));
  if (usable.length < 3) return undefined;
  const step = usable.length > MAX_OUTLINE_POINTS ? usable.length / MAX_OUTLINE_POINTS : 1;
  const kept: OutlinePoint[] = [];
  for (let i = 0; i < usable.length && kept.length < MAX_OUTLINE_POINTS; i += step) kept.push(usable[Math.floor(i)]);
  const bytes = new Uint8Array(kept.length * 4);
  const view = new DataView(bytes.buffer);
  kept.forEach((p, i) => {
    view.setInt16(i * 4, clampTenths(p.lat), true);
    view.setInt16(i * 4 + 2, clampTenths(p.lon), true);
  });
  return toBase64(bytes);
}

/** The polygon back, or null for anything that is not a valid outline. */
export function decodeOutline(text: unknown): OutlinePoint[] | null {
  if (!isOutline(text)) return null;
  const bytes = fromBase64(text);
  if (!bytes || bytes.length % 4 !== 0 || bytes.length < 12) return null;
  const view = new DataView(bytes.buffer);
  const out: OutlinePoint[] = [];
  for (let i = 0; i < bytes.length; i += 4) {
    out.push({ lat: view.getInt16(i, true) / 10, lon: view.getInt16(i + 2, true) / 10 });
  }
  return out;
}

/** Whether a value looks like an encoded outline: base64, and not too long. */
export function isOutline(text: unknown): text is string {
  return typeof text === 'string' && text.length >= 16 && text.length <= MAX_OUTLINE_CHARS
    && /^[A-Za-z0-9+/]+={0,2}$/.test(text);
}
