// Cloudflare Pages Function: /robots.txt, pointing at the sitemap on the
// same host it was asked for (see functions/sitemap.xml.ts).

import { siteOrigin } from './sitemap.xml';

interface EventContext { request: Request }

export const onRequestGet = ({ request }: EventContext): Response =>
  new Response(`User-agent: *\nAllow: /\n\nSitemap: ${siteOrigin(request.url)}/sitemap.xml\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
