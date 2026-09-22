// Cloudflare Pages Function - deploys automatically with the rest of the site.
//
// Routes: /api/proxy/image, /api/proxy/meta, /api/proxy/data
//
// This is the entry point that matters most, because it answers on whatever
// origin the site is served from. Cloudflare will not route a Worker onto a
// *.pages.dev hostname - that zone belongs to Cloudflare, not to us - so on
// preview deployments this is the only thing that can answer, and a request
// that finds nothing here falls through to the SPA and comes back as
// index.html with a 200, which is how polarity was broken without anything
// ever logging an error.
//
// The routes themselves live in worker/proxy-routes.ts, shared with the
// standalone Worker.

import { handleProxyRoute } from '../../../worker/proxy-routes';

interface EventContext {
  request: Request;
  params: Record<string, string | string[] | undefined>;
  waitUntil: (promise: Promise<unknown>) => void;
}

const handle = async (context: EventContext): Promise<Response> => {
  const { request, params } = context;
  const raw = params.route;
  const route = Array.isArray(raw) ? raw.join('/') : (raw ?? '');

  const served = await handleProxyRoute(route, request);
  if (served) return served;

  return new Response(`Not found: /api/proxy/${route}`, {
    status: 404,
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
};

export const onRequestGet = handle;
export const onRequestHead = handle;
export const onRequestOptions = handle;
