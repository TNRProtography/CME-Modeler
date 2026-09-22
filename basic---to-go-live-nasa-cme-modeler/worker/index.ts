// The image and data proxy, as a standalone Worker.
//
// Routed at spottheaurora.co.nz/api/proxy/* and reachable directly on
// workers.dev. It holds no logic of its own: every route lives in
// proxy-routes.ts, which the Pages Function at functions/api/proxy/[[route]].ts
// serves from as well, so the two cannot disagree about an allow-list.
//
// Paths are accepted both with and without the /api/proxy prefix. The prefix
// is what the custom-domain route matches, and the bare form is what anyone
// poking at the workers.dev hostname will type.

import { handleProxyRoute, PROXY_ROUTES, withCors, ALLOWED_HOSTS, ALLOWED_DATA_HOSTS } from './proxy-routes';

export interface Env {}

/**
 * What the hostname says when you visit it.
 *
 * It used to say nothing at all: the root fell through to a bare 404 with an
 * empty body, which looks identical to a worker that is down. Listing the
 * routes and the allow-lists makes one request enough to tell whether this is
 * deployed, which is the only question anyone opens the root to ask.
 */
const index = (origin: string): Response => withCors(new Response(JSON.stringify({
  ok: true,
  service: 'spot-the-aurora-image-proxy',
  routes: PROXY_ROUTES.map((r) => `${origin}/api/proxy/${r}?url=...`),
  allowedImageHosts: [...ALLOWED_HOSTS],
  allowedDataHosts: [...ALLOWED_DATA_HOSTS],
  note: 'Also served by the Pages Function on the site origin, from the same module.',
}, null, 2), { headers: { 'Content-Type': 'application/json' } }));

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/proxy\/?/, '').replace(/^\//, '');

    if (path === '') {
      if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));
      return index(url.origin);
    }

    const served = await handleProxyRoute(path, request);
    if (served) return served;

    return withCors(new Response(
      `Not found: ${url.pathname}. Try one of ${PROXY_ROUTES.join(', ')} - see ${url.origin}/ for the full list.`,
      { status: 404 },
    ));
  },
};
