export interface Env {}

const ALLOWED_HOSTS = new Set([
  'sdo.gsfc.nasa.gov',
  'jsoc1.stanford.edu',
  'services.swpc.noaa.gov',
  'stereo-ssc.nascom.nasa.gov',
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


const STEREO_WHERE_URL = 'https://stereo-ssc.nascom.nasa.gov/where.shtml';

interface StereoPositionResponse {
  available: boolean;
  rAu: number | null;
  heeLongitudeDeg: number | null;
  heeLatitudeDeg: number | null;
  separationFromEarthDeg: number | null;
  updatedAt: string | null;
  sourceUrl: string;
}

const cleanHtmlText = (html: string): string => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<br\s*\/?\s*>/gi, '\n')
  .replace(/<\/tr>/gi, '\n')
  .replace(/<\/p>/gi, '\n')
  .replace(/<\/pre>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&deg;/g, '°')
  .replace(/&minus;/g, '-')
  .replace(/&#8722;/g, '-')
  .replace(/\r/g, '\n')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n\s+/g, '\n')
  .trim();

const extractRowNumbers = (text: string, label: string): number[] => {
  const normalized = cleanHtmlText(text);
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lineMatch = normalized.match(new RegExp(`${escapedLabel}[^\n]*`, 'i'));
  const row = lineMatch?.[0] ?? '';
  return [...row.matchAll(/[-+]?\d+(?:\.\d+)?/g)]
    .map((match) => Number(match[0]))
    .filter(Number.isFinite);
};

const getStereoAColumnValue = (values: number[]): number | null => (
  Number.isFinite(values[2]) ? values[2] : null
);

const parseLastRevised = (text: string): string | null => {
  const normalized = cleanHtmlText(text);
  return normalized.match(/Last Revised:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
};

export const parseStereoPositionText = (text: string): StereoPositionResponse => {
  const rAu = getStereoAColumnValue(extractRowNumbers(text, 'Heliocentric distance (AU)'));
  const heeLongitudeDeg = getStereoAColumnValue(extractRowNumbers(text, 'Earth Ecliptic (HEE) longitude'));
  const heeLatitudeDeg = getStereoAColumnValue(extractRowNumbers(text, 'Earth Ecliptic (HEE) latitude'));
  const separationValues = extractRowNumbers(text, 'Separation angle with Earth');
  const parsedSeparation = separationValues.length >= 6 && Number.isFinite(separationValues[2])
    ? separationValues[2]
    : separationValues.length >= 5 && Number.isFinite(separationValues[1])
      ? separationValues[1]
      : Number.isFinite(separationValues[2])
        ? separationValues[2]
        : null;
  const separationFromEarthDeg = parsedSeparation ?? (heeLongitudeDeg != null ? Math.abs(heeLongitudeDeg) : null);
  const available = rAu != null || heeLongitudeDeg != null || separationFromEarthDeg != null;

  return {
    available,
    rAu,
    heeLongitudeDeg,
    heeLatitudeDeg,
    separationFromEarthDeg,
    updatedAt: parseLastRevised(text),
    sourceUrl: STEREO_WHERE_URL,
  };
};

const fetchStereoPosition = async (request: Request): Promise<Response> => {
  const ttlSafe = 300;
  const cacheKey = new Request(new URL('/api/stereo/position', request.url).toString(), request);
  const cached = await caches.default.match(cacheKey);
  if (cached) return withCors(cached);

  const upstream = await fetch(STEREO_WHERE_URL, {
    method: 'GET',
    cf: { cacheTtl: ttlSafe, cacheEverything: true },
    headers: {
      'User-Agent': 'spot-the-aurora-stereo-position',
      'Accept': 'text/html,text/plain,*/*;q=0.8',
    },
  });

  if (!upstream.ok) {
    return withCors(new Response(JSON.stringify({
      available: false,
      rAu: null,
      heeLongitudeDeg: null,
      heeLatitudeDeg: null,
      separationFromEarthDeg: null,
      updatedAt: null,
      sourceUrl: STEREO_WHERE_URL,
      error: `Upstream fetch failed: ${upstream.status}`,
    }), { status: upstream.status, headers: { 'Content-Type': 'application/json' } }));
  }

  const parsed = parseStereoPositionText(await upstream.text());
  const response = new Response(JSON.stringify(parsed), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${ttlSafe}, s-maxage=${ttlSafe}`,
    },
  });
  await caches.default.put(cacheKey, response.clone());
  return withCors(response);
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

const proxyText = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const target = validateTarget(url.searchParams.get('url'));
  const ttl = Number(url.searchParams.get('ttl') || '300');
  const ttlSafe = Number.isFinite(ttl) ? Math.max(60, Math.min(900, ttl)) : 300;
  const { cacheKey } = cacheRequestFor(request, ttlSafe);

  const cached = await caches.default.match(cacheKey);
  if (cached) return withCors(cached);

  const upstream = await fetch(target.toString(), {
    method: 'GET',
    cf: { cacheTtl: ttlSafe, cacheEverything: true },
    headers: {
      'User-Agent': 'spot-the-aurora-text-proxy',
      'Accept': 'text/html,text/plain,*/*;q=0.8',
    },
  });

  if (!upstream.ok) {
    return withCors(new Response(`Upstream fetch failed: ${upstream.status}`, { status: upstream.status }));
  }

  const headers = new Headers(upstream.headers);
  headers.set('Cache-Control', `public, max-age=${ttlSafe}, s-maxage=${ttlSafe}`);
  headers.set('Content-Type', headers.get('content-type') || 'text/html; charset=utf-8');
  headers.set('Vary', 'Accept');

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
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);
    if (url.pathname === '/api/stereo/position') {
      try {
        return await fetchStereoPosition(request);
      } catch (error) {
        return withCors(new Response((error as Error).message, { status: 500 }));
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

    if (url.pathname === '/api/proxy/text') {
      try {
        return await proxyText(request);
      } catch (error) {
        return withCors(new Response((error as Error).message, { status: 400 }));
      }
    }

    return new Response('Not found', { status: 404 });
  },
};
