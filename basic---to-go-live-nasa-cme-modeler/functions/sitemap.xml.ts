// Cloudflare Pages Function: /sitemap.xml
//
// The sitemap, listing the pages on whichever host it was asked for. The app
// answers on both spottheaurora.co.nz and www.spottheaurora.co.nz, and Google
// ignores every address in a sitemap that is not on the sitemap's own host:
// the static file listed spottheaurora.co.nz, so read from www it counted as
// empty. public/sitemap.xml stays as the copy for anywhere this does not run.

interface EventContext { request: Request }

export const SITEMAP_PAGES: { path: string; changefreq: string; priority: string }[] = [
  { path: '/', changefreq: 'daily', priority: '1.0' },
  { path: '/spot-the-aurora-forecast', changefreq: 'always', priority: '0.9' },
  { path: '/solar-dashboard', changefreq: 'always', priority: '0.8' },
  { path: '/cme-visualization', changefreq: 'always', priority: '0.8' },
  { path: '/faq', changefreq: 'monthly', priority: '0.7' },
];

const KNOWN_HOSTS = new Set(['spottheaurora.co.nz', 'www.spottheaurora.co.nz']);

/** The origin to list pages on: the request's own, for the app's domains; otherwise the main one. */
export function siteOrigin(requestUrl: string): string {
  const u = new URL(requestUrl);
  return KNOWN_HOSTS.has(u.hostname) ? `https://${u.hostname}` : 'https://spottheaurora.co.nz';
}

export function buildSitemap(origin: string, lastmod: string): string {
  const rows = SITEMAP_PAGES.map((p) =>
    `  <url>\n    <loc>${origin}${p.path}</loc>\n    <lastmod>${lastmod}</lastmod>\n`
    + `    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows}\n</urlset>\n`;
}

export const onRequestGet = ({ request }: EventContext): Response => {
  // The live pages change all the time; the date says so.
  const lastmod = new Date().toISOString().slice(0, 10);
  return new Response(buildSitemap(siteOrigin(request.url), lastmod), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
};
