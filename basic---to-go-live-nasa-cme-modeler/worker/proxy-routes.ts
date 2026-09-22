// The image and data proxy, in one place.
//
// Two things serve these routes: a Pages Function, which answers on the site's
// own origin wherever the site is deployed, and a Worker routed at
// spottheaurora.co.nz/api/proxy/*. Both are wanted - the Function because
// Cloudflare will not route a Worker onto a *.pages.dev hostname, so previews
// need it, and the Worker because it can be called directly by name.
//
// Two copies of an allow-list is how an allow-list goes wrong: a host added to
// fix one deployment, absent from the other, and a failure that depends on
// which URL you happened to test. So neither entry point contains any of this.
// They parse a route name and call handleProxyRoute, and that is all they do.
//
// Why the proxy exists at all: displaying a cross-origin image needs no
// permission, but READING its pixels does, and no observatory sends the header
// that would allow it. Fetching the bytes through our own origin makes the
// blob same-origin, which makes the canvas readable. That is the whole
// mechanism behind coronal hole polarity.

export const ALLOWED_HOSTS = new Set([
  'sdo.gsfc.nasa.gov',
  'jsoc1.stanford.edu',
  'services.swpc.noaa.gov',
  'stereo-ssc.nascom.nasa.gov',
  // Our own imagery workers. These do send CORS headers, so the direct fetch
  // behind the proxy succeeds and nothing looked broken - but every SUVI frame
  // was spending a 400 from the proxy first, on the way to the fallback. The
  // console was full of them and the detector ran anyway, which is the worst
  // combination: a real fault that costs a request per frame and reports
  // itself only to somebody already reading the log.
  'suvi-difference-imagery.thenamesrock.workers.dev',
  'ch-history-worker.thenamesrock.workers.dev',
]);

// Hosts permitted for the generic text/data proxy. NMDB provides ground
// cosmic-ray counts for Forbush-decrease detection and sends no CORS headers.
export const ALLOWED_DATA_HOSTS = new Set([
  'www.nmdb.eu',
  'nest.nmdb.eu',
  'services.swpc.noaa.gov',
  // SDO/HMI SHARP positions for sunspot regions, every twelve minutes. JSOC
  // sends no CORS headers. See utils/sharpPositions.
  'jsoc.stanford.edu',
  // The SDO browse archive's directory listings, for past HMI frames. See
  // utils/hmiArchive.
  'sdo.gsfc.nasa.gov',
]);

const BLOCKED_HOST_RE = /(^localhost$)|(^127\.)|(^10\.)|(^192\.168\.)|(^169\.254\.)|(^172\.(1[6-9]|2\d|3[0-1])\.)|(^0\.)/;

declare const caches: { default: Cache };

export const withCors = (response: Response): Response => {
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

/** The route names both entry points accept, for the index page. */
export const PROXY_ROUTES = ['image', 'meta', 'data'] as const;

/**
 * Serve one proxy route by name, or return null if the name is not one.
 *
 * Returning null rather than a 404 lets the caller decide what an unknown path
 * means - on the Worker it is genuinely not found, and on the Pages Function
 * the request should carry on to the site.
 */
export async function handleProxyRoute(route: string, request: Request): Promise<Response | null> {
  if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));
  try {
    if (route === 'image') return await proxyImage(request);
    if (route === 'meta') return await proxyImageMeta(request);
    if (route === 'data') return await proxyData(request);
  } catch (error) {
    return withCors(new Response((error as Error).message, { status: 400 }));
  }
  return null;
}
