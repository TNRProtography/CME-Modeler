export interface Env {}

const ALLOWED_HOSTS = new Set([
  'sdo.gsfc.nasa.gov',
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
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);
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

    return new Response('Not found', { status: 404 });
  },
};
