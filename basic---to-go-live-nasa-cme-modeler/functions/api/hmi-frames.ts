// Cloudflare Pages Function: /api/hmi-frames?mode=intensity&from=<ms>&to=<ms>
//
// The sunspot scrubber's frame list. SDO's archive is a directory per day and
// each day's listing is close to a megabyte of HTML - every AIA channel at
// every size, with the HMI frames a small fraction of it. A week of that is
// several megabytes a phone should not download to learn a hundred file
// names. So the listings are read here, next to SDO, and only the frames go
// back: a few kilobytes.
//
// Past days never change, so their listings are cached for a day; today's for
// ten minutes. The parsing is utils/hmiArchive, the same code the browser
// falls back to when this route is not deployed.

import { browseDirUrl, daysCovering, framesFromListings, HMI_MODES, type HmiMode } from '../../utils/hmiArchive';

interface EventContext {
  request: Request;
}

const MAX_WINDOW_MS = 8 * 86400000;

const json = (body: unknown, status = 200, maxAge = 300) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': status === 200 ? `public, max-age=${maxAge}, s-maxage=${maxAge * 2}` : 'no-store',
  },
});

async function listing(dir: string, isToday: boolean): Promise<string | null> {
  try {
    const res = await fetch(dir, {
      headers: { 'User-Agent': 'spot-the-aurora-hmi-frames', Accept: 'text/html' },
      cf: { cacheTtl: isToday ? 600 : 86400, cacheEverything: true },
    } as RequestInit);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

export const onRequestGet = async ({ request }: EventContext): Promise<Response> => {
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') as HmiMode;
  const from = Number(url.searchParams.get('from'));
  const to = Number(url.searchParams.get('to'));

  if (!HMI_MODES.includes(mode)) return json({ error: 'mode must be colorized, magnetogram or intensity' }, 400);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return json({ error: 'from and to are epoch ms, from < to' }, 400);
  // Bounded, or ?from=0 would fetch every listing since 2010.
  if (to - from > MAX_WINDOW_MS) return json({ error: 'window is at most eight days' }, 400);
  if (to > Date.now() + 86400000) return json({ error: 'to is in the future' }, 400);

  const todayDir = browseDirUrl(Date.now());
  const listings = await Promise.all(daysCovering(from, to).map(async (d) => {
    const dir = browseDirUrl(d);
    return { dir, html: await listing(dir, dir === todayDir) };
  }));

  const { product, frames } = framesFromListings(listings, mode, from, to);
  // A window entirely in the past is fixed forever; one that reaches today
  // grows every few minutes.
  const maxAge = to < Date.now() - 86400000 ? 86400 : 300;
  return json({ mode, product, frames }, 200, maxAge);
};

export const onRequestOptions = async (): Promise<Response> => new Response(null, {
  status: 204,
  headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS' },
});
