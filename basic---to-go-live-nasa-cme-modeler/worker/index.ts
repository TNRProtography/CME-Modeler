export interface Env {
  // Real secret, set via `wrangler secret put CARTO_API_KEY` - never exposed to
  // the browser. The client only ever talks to /api/proxy/carto/*, which
  // appends this key server-side before forwarding to CARTO.
  CARTO_API_KEY?: string;
}

const ALLOWED_HOSTS = new Set([
  'sdo.gsfc.nasa.gov',
  'jsoc1.stanford.edu',
  'services.swpc.noaa.gov',
  'stereo-ssc.nascom.nasa.gov',
]);

// Hosts permitted for the generic text/data proxy (/api/proxy/data).
// NMDB (neutron monitor database) provides ground cosmic-ray counts used for
// genuine Forbush-decrease detection in the EPAM early-warning engine; its
// servers do not send CORS headers, so the browser must go through here.
const ALLOWED_DATA_HOSTS = new Set([
  'www.nmdb.eu',
  'nest.nmdb.eu',
  'services.swpc.noaa.gov',
]);

const BLOCKED_HOST_RE = /(^localhost$)|(^127\.)|(^10\.)|(^192\.168\.)|(^169\.254\.)|(^172\.(1[6-9]|2\d|3[0-1])\.)|(^0\.)/;

const withCors = (response: Response): Response => {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

const validateTarget = (raw: string | null): URL => {
  if (!raw) throw new Error('Missing url query parameter');
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http/https URLs are allowed');
  if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error('Host is not allow-listed');
  if (BLOCKED_HOST_RE.test(url.hostname)) throw new Error('Host is blocked');
  return url;
};

const cacheRequestFor = (request: Request, ttlSeconds: number) => {
  const cacheKey = new Request(request.url, request);
  const responseInit = {
    headers: {
      'Cache-Control': `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}`,
    },
  };
  return { cacheKey, responseInit };
};

const proxyImage = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const target = validateTarget(url.searchParams.get('url'));
  const isHead = request.method === 'HEAD';
  const ttl = Number(url.searchParams.get('ttl') || '60');
  const ttlSafe = Number.isFinite(ttl) ? Math.max(30, Math.min(300, ttl)) : 60;
  const { cacheKey } = cacheRequestFor(request, ttlSafe);

  if (!isHead) {
    const cached = await caches.default.match(cacheKey);
    if (cached) return withCors(cached);
  }

  const upstream = await fetch(target.toString(), {
    method: isHead ? 'HEAD' : 'GET',
    cf: { cacheTtl: ttlSafe, cacheEverything: true },
    headers: {
      'User-Agent': 'spot-the-aurora-image-proxy',
      'Accept': 'image/*,*/*;q=0.8',
    },
  });

  if (!upstream.ok) {
    return withCors(new Response(`Upstream fetch failed: ${upstream.status}`, { status: upstream.status }));
  }

  const headers = new Headers(upstream.headers);
  headers.set('Cache-Control', `public, max-age=${ttlSafe}, s-maxage=${ttlSafe}`);
  headers.set('Vary', 'Accept');

  const response = new Response(isHead ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });

  if (!isHead) {
    await caches.default.put(cacheKey, response.clone());
  }

  return withCors(response);
};

// Generic text/data passthrough for allow-listed scientific feeds (e.g. NMDB
// neutron-monitor counts). Cached server-side; CORS-enabled for the browser.
const proxyData = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const raw = url.searchParams.get('url');
  if (!raw) throw new Error('Missing url query parameter');
  const target = new URL(raw);
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Only http/https URLs are allowed');
  if (!ALLOWED_DATA_HOSTS.has(target.hostname)) throw new Error('Host is not allow-listed for data proxy');
  if (BLOCKED_HOST_RE.test(target.hostname)) throw new Error('Host is blocked');

  const ttl = Number(url.searchParams.get('ttl') || '300');
  const ttlSafe = Number.isFinite(ttl) ? Math.max(60, Math.min(900, ttl)) : 300;
  const { cacheKey } = cacheRequestFor(request, ttlSafe);

  const cached = await caches.default.match(cacheKey);
  if (cached) return withCors(cached);

  const upstream = await fetch(target.toString(), {
    method: 'GET',
    cf: { cacheTtl: ttlSafe, cacheEverything: true },
    headers: {
      'User-Agent': 'spot-the-aurora-data-proxy',
      'Accept': 'text/plain,application/json,*/*;q=0.8',
    },
  });

  if (!upstream.ok) {
    return withCors(new Response(`Upstream fetch failed: ${upstream.status}`, { status: upstream.status }));
  }

  const headers = new Headers();
  headers.set('Content-Type', upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8');
  headers.set('Cache-Control', `public, max-age=${ttlSafe}, s-maxage=${ttlSafe}`);

  const response = new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  await caches.default.put(cacheKey, response.clone());
  return withCors(response);
};

// CARTO basemap tiles - proxied so the CARTO API key never reaches the browser.
// Matches CARTO's own tile URL shape: /carto/{style}/{z}/{x}/{y}{@2x}.png
const CARTO_TILE_RE = /^\/api\/proxy\/carto\/([a-zA-Z0-9_]+)\/(\d+)\/(\d+)\/(\d+)(@2x)?\.png$/;

const proxyCartoTile = async (request: Request, env: Env, match: RegExpMatchArray): Promise<Response> => {
  const apiKey = env.CARTO_API_KEY;
  if (!apiKey) {
    return withCors(new Response('CARTO_API_KEY is not configured on this worker', { status: 500 }));
  }

  const [, style, z, x, y, retina] = match;
  const target = `https://basemaps.cartocdn.com/${style}/${z}/${x}/${y}${retina ?? ''}.png?api_key=${encodeURIComponent(apiKey)}`;

  // Tiles for a given z/x/y never change, so cache generously at the edge.
  const ttlSafe = 24 * 60 * 60;
  const cacheKey = new Request(request.url, request);
  const cached = await caches.default.match(cacheKey);
  if (cached) return withCors(cached);

  const upstream = await fetch(target, {
    cf: { cacheTtl: ttlSafe, cacheEverything: true },
    headers: {
      'User-Agent': 'spot-the-aurora-carto-proxy',
      'Accept': 'image/*',
    },
  });

  if (!upstream.ok) {
    return withCors(new Response(`Upstream fetch failed: ${upstream.status}`, { status: upstream.status }));
  }

  const headers = new Headers(upstream.headers);
  headers.set('Cache-Control', `public, max-age=${ttlSafe}, s-maxage=${ttlSafe}`);

  const response = new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });

  await caches.default.put(cacheKey, response.clone());
  return withCors(response);
};

const proxyImageMeta = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const target = validateTarget(url.searchParams.get('url'));
  const upstream = await fetch(target.toString(), { method: 'HEAD' });
  const payload = {
    ok: upstream.ok,
    etag: upstream.headers.get('etag'),
    lastModified: upstream.headers.get('last-modified'),
    contentType: upstream.headers.get('content-type'),
  };
  return withCors(new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60, s-maxage=60' } }));
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);

    const cartoMatch = url.pathname.match(CARTO_TILE_RE);
    if (cartoMatch) {
      try {
        return await proxyCartoTile(request, env, cartoMatch);
      } catch (error) {
        return withCors(new Response((error as Error).message, { status: 400 }));
      }
    }

    if (url.pathname === '/api/proxy/image') {
      try {
        return await proxyImage(request);
      } catch (error) {
        return withCors(new Response((error as Error).message, { status: 400 }));
      }
    }

    if (url.pathname === '/api/proxy/meta') {
      try {
        return await proxyImageMeta(request);
      } catch (error) {
        return withCors(new Response((error as Error).message, { status: 400 }));
      }
    }

    if (url.pathname === '/api/proxy/data') {
      try {
        return await proxyData(request);
      } catch (error) {
        return withCors(new Response((error as Error).message, { status: 400 }));
      }
    }

    return new Response('Not found', { status: 404 });
  },
};