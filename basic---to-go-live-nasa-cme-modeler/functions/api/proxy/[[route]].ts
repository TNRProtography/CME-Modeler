// Cloudflare Pages Function - deploys automatically with the rest of the site.
//
// Routes: /api/proxy/image, /api/proxy/meta, /api/proxy/data
//
// This is the same code that has been sitting in worker/index.ts, moved here
// because that Worker does not exist on the Cloudflare account and never did.
// A route pointed at a Worker that was never created does not fail loudly - it
// falls through to the SPA, which answers every request with index.html and a
// 200. So the browser asked for a magnetogram and got a web page, and coronal
// hole polarity has been unreadable ever since.
//
// Why this matters beyond one panel: displaying a cross-origin image needs no
// permission, but READING its pixels does, and no observatory sends the header
// that would allow it. Fetching the bytes from our own origin instead makes
// the blob same-origin, which makes the canvas readable. That is the whole
// mechanism, and it only works if this actually answers on this origin -
// hence a Pages Function rather than a Worker needing a route nobody attached.

const ALLOWED_HOSTS = new Set([
  'sdo.gsfc.nasa.gov',
  'jsoc1.stanford.edu',
  'services.swpc.noaa.gov',
  'stereo-ssc.nascom.nasa.gov',
]);

// Hosts permitted for the generic text/data proxy. NMDB provides ground
// cosmic-ray counts for Forbush-decrease detection and sends no CORS headers.
const ALLOWED_DATA_HOSTS = new Set([
  'www.nmdb.eu',
  'nest.nmdb.eu',
  'services.swpc.noaa.gov',
]);

const BLOCKED_HOST_RE = /(^localhost$)|(^127\.)|(^10\.)|(^192\.168\.)|(^169\.254\.)|(^172\.(1[6-9]|2\d|3[0-1])\.)|(^0\.)/;

interface EventContext {
  request: Request;
  params: Record<string, string | string[] | undefined>;
  waitUntil: (promise: Promise<unknown>) => void;
}

declare const caches: { default: Cache };

const withCors = (response: Response): Response => {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

const validateTarget = (raw: string | null, allowed: Set<string>): URL => {
  if (!raw) throw new Error('Missing url query parameter');
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http/https URLs are allowed');
  if (!allowed.has(url.hostname)) throw new Error('Host is not allow-listed');
  if (BLOCKED_HOST_RE.test(url.hostname)) throw new Error('Host is blocked');
  return url;
};

const clampTtl = (raw: string | null, fallback: number, min: number, max: number): number => {
  const ttl = Number(raw || String(fallback));
  return Number.isFinite(ttl) ? Math.max(min, Math.min(max, ttl)) : fallback;
};

const proxyImage = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const target = validateTarget(url.searchParams.get('url'), ALLOWED_HOSTS);
  const isHead = request.method === 'HEAD';
  const ttl = clampTtl(url.searchParams.get('ttl'), 60, 30, 300);
  const cacheKey = new Request(request.url, request);

  if (!isHead) {
    const cached = await caches.default.match(cacheKey);
    if (cached) return withCors(cached);
  }

  const upstream = await fetch(target.toString(), {
    method: isHead ? 'HEAD' : 'GET',
    cf: { cacheTtl: ttl, cacheEverything: true },
    headers: { 'User-Agent': 'spot-the-aurora-image-proxy', Accept: 'image/*,*/*;q=0.8' },
  } as RequestInit);

  if (!upstream.ok) {
    return withCors(new Response(`Upstream fetch failed: ${upstream.status}`, { status: upstream.status }));
  }

  const headers = new Headers(upstream.headers);
  headers.set('Cache-Control', `public, max-age=${ttl}, s-maxage=${ttl}`);
  headers.set('Vary', 'Accept');

  const response = new Response(isHead ? null : upstream.body, {
    status: upstream.status, statusText: upstream.statusText, headers,
  });
  if (!isHead) await caches.default.put(cacheKey, response.clone());
  return withCors(response);
};

const proxyImageMeta = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const target = validateTarget(url.searchParams.get('url'), ALLOWED_HOSTS);
  const upstream = await fetch(target.toString(), { method: 'HEAD' });
  const payload = {
    ok: upstream.ok,
    etag: upstream.headers.get('etag'),
    lastModified: upstream.headers.get('last-modified'),
    contentType: upstream.headers.get('content-type'),
  };
  return withCors(new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60, s-maxage=60' },
  }));
};

const proxyData = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const target = validateTarget(url.searchParams.get('url'), ALLOWED_DATA_HOSTS);
  const ttl = clampTtl(url.searchParams.get('ttl'), 300, 60, 900);
  const cacheKey = new Request(request.url, request);

  const cached = await caches.default.match(cacheKey);
  if (cached) return withCors(cached);

  const upstream = await fetch(target.toString(), {
    method: 'GET',
    cf: { cacheTtl: ttl, cacheEverything: true },
    headers: { 'User-Agent': 'spot-the-aurora-data-proxy', Accept: 'text/plain,application/json,*/*;q=0.8' },
  } as RequestInit);

  if (!upstream.ok) {
    return withCors(new Response(`Upstream fetch failed: ${upstream.status}`, { status: upstream.status }));
  }

  const headers = new Headers();
  headers.set('Content-Type', upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8');
  headers.set('Cache-Control', `public, max-age=${ttl}, s-maxage=${ttl}`);
  const response = new Response(upstream.body, {
    status: upstream.status, statusText: upstream.statusText, headers,
  });
  await caches.default.put(cacheKey, response.clone());
  return withCors(response);
};

const handle = async (context: EventContext): Promise<Response> => {
  const { request, params } = context;
  if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));

  const raw = params.route;
  const route = Array.isArray(raw) ? raw.join('/') : (raw ?? '');

  try {
    if (route === 'image') return await proxyImage(request);
    if (route === 'meta') return await proxyImageMeta(request);
    if (route === 'data') return await proxyData(request);
  } catch (error) {
    return withCors(new Response((error as Error).message, { status: 400 }));
  }
  return withCors(new Response('Not found', { status: 404 }));
};

export const onRequestGet = handle;
export const onRequestHead = handle;
export const onRequestOptions = handle;
