/* Cloudflare Pages Function: /api/proxy/image
 *
 * The app's coronal hole detector fetches the SUVI solar image through a
 * same-origin proxy so that canvas getImageData() can read it without tripping
 * CORS. On the app's domain that path is served by its Worker. This site is a
 * different origin, so without this the request 404s and detection has to fall
 * back.
 *
 * Mirrors worker/index.ts proxyImage, including the same host allow list.
 */
const ALLOWED_HOSTS = new Set([
  'sdo.gsfc.nasa.gov',
  'jsoc1.stanford.edu',
  'services.swpc.noaa.gov',
  'stereo-ssc.nascom.nasa.gov'
]);

const BLOCKED_HOST_RE = /(^localhost$)|(^127\.)|(^10\.)|(^192\.168\.)|(^169\.254\.)|(^172\.(1[6-9]|2\d|3[0-1])\.)|(^0\.)/;

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function onRequest({ request }) {
  if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));

  const url = new URL(request.url);
  const raw = url.searchParams.get('url');
  if (!raw) return withCors(new Response('Missing url query parameter', { status: 400 }));

  let target;
  try {
    target = new URL(raw);
  } catch (e) {
    return withCors(new Response('Invalid url', { status: 400 }));
  }
  if (!['http:', 'https:'].includes(target.protocol)) return withCors(new Response('Only http/https URLs are allowed', { status: 400 }));
  if (!ALLOWED_HOSTS.has(target.hostname)) return withCors(new Response('Host is not allow-listed', { status: 400 }));
  if (BLOCKED_HOST_RE.test(target.hostname)) return withCors(new Response('Host is blocked', { status: 400 }));

  const ttlRaw = Number(url.searchParams.get('ttl') || '60');
  const ttl = Number.isFinite(ttlRaw) ? Math.max(30, Math.min(300, ttlRaw)) : 60;
  const isHead = request.method === 'HEAD';

  const upstream = await fetch(target.toString(), {
    method: isHead ? 'HEAD' : 'GET',
    cf: { cacheTtl: ttl, cacheEverything: true },
    headers: { 'User-Agent': 'spot-the-aurora-image-proxy', 'Accept': 'image/*,*/*;q=0.8' }
  });

  if (!upstream.ok) return withCors(new Response(`Upstream fetch failed: ${upstream.status}`, { status: upstream.status }));

  const headers = new Headers(upstream.headers);
  headers.set('Cache-Control', `public, max-age=${ttl}, s-maxage=${ttl}`);
  headers.set('Vary', 'Accept');
  return withCors(new Response(isHead ? null : upstream.body, { status: upstream.status, statusText: upstream.statusText, headers }));
}
