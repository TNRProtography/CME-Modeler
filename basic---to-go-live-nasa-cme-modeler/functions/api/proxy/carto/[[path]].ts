// Cloudflare Pages Function - deploys automatically with the rest of the site
// (no separate Worker to manage). Proxies CARTO basemap tiles so the real
// CARTO_API_KEY never reaches the browser: set it in the Pages project's
// Variables and secrets panel (Settings > Variables and secrets) as a
// "Secret" - Pages Functions can read secrets at request time even though
// the Vite build step cannot.
//
// Route: /api/proxy/carto/{style}/{z}/{x}/{y}{@2x}.png

interface Env {
  CARTO_API_KEY?: string;
}

interface EventContext<E> {
  request: Request;
  env: E;
  params: Record<string, string | string[] | undefined>;
  waitUntil: (promise: Promise<unknown>) => void;
}

// Style is one or two path segments - CARTO serves some styles at the root
// (dark_all) and others under a prefix (rastertiles/voyager).
const CARTO_TILE_RE = /^([a-zA-Z0-9_]+(?:\/[a-zA-Z0-9_]+)?)\/(\d+)\/(\d+)\/(\d+)(@2x)?\.png$/;

export const onRequestGet = async (context: EventContext<Env>): Promise<Response> => {
  const { request, env, params } = context;

  const rawPath = params.path;
  const path = Array.isArray(rawPath) ? rawPath.join('/') : (rawPath ?? '');
  const match = path.match(CARTO_TILE_RE);
  if (!match) {
    return new Response('Not found', { status: 404 });
  }

  const apiKey = env.CARTO_API_KEY;
  if (!apiKey) {
    return new Response('CARTO_API_KEY is not configured for this Pages project', { status: 500 });
  }

  const [, style, z, x, y, retina] = match;
  const target = `https://basemaps.cartocdn.com/${style}/${z}/${x}/${y}${retina ?? ''}.png?key=${encodeURIComponent(apiKey)}`;

  // Tiles for a given z/x/y never change, so cache generously at the edge.
  // Bump CACHE_VERSION to orphan previously cached tiles - the run with the
  // wrong auth param cached CARTO's "API KEY REQUIRED" placeholders, which
  // came back as a perfectly cacheable 200.
  const CACHE_VERSION = '2';
  const ttlSeconds = 24 * 60 * 60;
  const cache = caches.default;
  const cacheKey = new Request(`${request.url}${request.url.includes('?') ? '&' : '?'}__v=${CACHE_VERSION}`, request);

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const upstream = await fetch(target, {
    cf: { cacheTtl: ttlSeconds, cacheEverything: true },
    headers: {
      'User-Agent': 'spot-the-aurora-carto-proxy',
      'Accept': 'image/*',
    },
  });

  if (!upstream.ok) {
    return new Response(`Upstream fetch failed: ${upstream.status}`, { status: upstream.status });
  }

  const headers = new Headers(upstream.headers);
  headers.set('Cache-Control', `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}`);

  const response = new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });

  context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
};
