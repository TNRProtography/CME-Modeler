// Page-view counter.
//
//   POST /page-views  { id, seed? }   count one view for this visitor
//   GET  /page-views?id=<visitor>     the numbers, without counting
//
// Both answer { daily, weekly, lifetime, yours } - the same shape the app's
// settings screen already reads, with `yours` the visitor's own number.
//
// Storage is the banner worker's KV namespace under the PV: prefix (nothing
// else lists that namespace, so the keys cannot clash):
//
//   PV:t:<0-7>        the all-time count, spread over eight keys
//   PV:d:<YYYY-MM-DD> views that UTC day (kept 10 days; today + the last six
//                     make "this week")
//   PV:u:<visitor>    { n, last } - that visitor's views and when the last was
//
// KV has no atomic increment. Two views landing on the same key in the same
// instant can lose one. Spreading the all-time count over eight keys, and
// counting a visitor at most once per half hour, keeps that rare enough for a
// counter that is for show. If it ever has to be exact, move it to a Durable
// Object.

const BASE_LIFETIME = 84382; // where the count stood when this began
const SHARDS = 8;
const SESSION_GAP_MS = 30 * 60 * 1000;
const DAY_TTL = 10 * 86400;
const DAY_MS = 86400000;
const ID_RE = /^[A-Za-z0-9-]{16,64}$/;
const MAX_SEED = 100000;

const ALLOWED_ORIGINS = [
  'https://cme-modeler.pages.dev',
  'https://spottheaurora.co.nz',
  'https://www.spottheaurora.co.nz',
];
const ALLOWED_ORIGIN_RE = /^https:\/\/[a-z0-9-]+\.cme-modeler\.pages\.dev$/;
const isAllowedOrigin = (o) => ALLOWED_ORIGINS.includes(o) || ALLOWED_ORIGIN_RE.test(o);

const dayKey = (ms) => `PV:d:${new Date(ms).toISOString().slice(0, 10)}`;
const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };

async function readTotals(kv, now, cacheTtl) {
  const weekKeys = Array.from({ length: 7 }, (_, i) => dayKey(now - i * DAY_MS));
  const shardKeys = Array.from({ length: SHARDS }, (_, i) => `PV:t:${i}`);
  const all = await Promise.all([...shardKeys, ...weekKeys].map((k) => kv.get(k, cacheTtl ? { cacheTtl } : undefined)));
  const shards = all.slice(0, SHARDS).reduce((s, v) => s + num(v), 0);
  const days = all.slice(SHARDS).map(num);
  return { daily: days[0], weekly: days.reduce((s, n) => s + n, 0), lifetime: BASE_LIFETIME + shards };
}

async function bump(kv, key, ttl) {
  const next = num(await kv.get(key)) + 1;
  await kv.put(key, String(next), ttl ? { expirationTtl: ttl } : undefined);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const cors = {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };
    if (origin && isAllowedOrigin(origin)) { cors['Access-Control-Allow-Origin'] = origin; cors['Vary'] = 'Origin'; }
    const json = (data, status = 200) => new Response(JSON.stringify(data), {
      status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors },
    });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    if (url.pathname.replace(/\/+$/, '').toLowerCase() !== '/page-views') return json({ error: 'not found' }, 404);

    const kv = env.PAGE_VIEWS_KV;
    const now = Date.now();
    try {
      if (request.method === 'GET') {
        const id = url.searchParams.get('id') || '';
        const mine = ID_RE.test(id) ? JSON.parse((await kv.get(`PV:u:${id}`)) || 'null') : null;
        return json({ ...(await readTotals(kv, now, 60)), yours: num(mine?.n) });
      }
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

      let body = {};
      try { body = await request.json(); } catch { /* an empty POST still counts nothing */ }
      const id = String(body?.id ?? '');
      if (!ID_RE.test(id)) return json({ error: 'a visitor id of 16-64 letters, digits or dashes is needed' }, 400);

      const key = `PV:u:${id}`;
      const mine = JSON.parse((await kv.get(key)) || 'null');
      let n = num(mine?.n);
      // A visitor's first time here carries over what this device counted
      // before the count moved to the server.
      if (!mine) n = Math.min(num(body?.seed), MAX_SEED);

      const counts = !mine || now - num(mine.last) >= SESSION_GAP_MS;
      if (counts) {
        n += 1;
        await kv.put(key, JSON.stringify({ n, last: now }));
        await Promise.all([
          bump(kv, `PV:t:${Math.floor(Math.random() * SHARDS)}`),
          bump(kv, dayKey(now), DAY_TTL),
        ]);
      }
      // Uncached, so the view just counted is in the answer.
      return json({ ...(await readTotals(kv, now)), yours: n });
    } catch (e) {
      return json({ error: 'counter unavailable', detail: String(e?.message ?? e) }, 503);
    }
  },
};
