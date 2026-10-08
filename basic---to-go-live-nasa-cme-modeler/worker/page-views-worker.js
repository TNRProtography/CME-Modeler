// Page-view counter, on a Durable Object.
//
//   POST /page-views  { id, seed? }   count one view for this visitor
//   GET  /page-views?id=<visitor>     the numbers, without counting
//
// Both answer { daily, weekly, yearly, lifetime, visitors, yours }: views
// today and this week (UTC days), this year, all time (starting from where
// the count stood when this began), how many different visitors there have
// been, and the asking visitor's own count.
//
// One object holds everything in its own SQLite database. Its code runs one
// request at a time, start to finish, so two views arriving together are two
// increments, never one lost - which a read-then-write on KV cannot promise.
//
// Every time the app is opened and used is a view, so a visitor who closes it
// and comes back counts again. The app sends one per open; the short gap here
// only swallows an accidental double send.
//
// The all-time count is the views counted here plus a base. SET_LIFETIME sets
// it by hand: the first time this code runs, the base is chosen so the count
// reads exactly that number at that moment, whatever has been counted by then,
// and it carries on from there. Applied once (meta 'set:<id>'), so a restart
// never sets it back. To set it again, give SET_LIFETIME a new id.

/** Where the count stood before any setting: 491,473 when this began. */
const BASE_LIFETIME = 491473;
const SET_LIFETIME = { id: '2026-10-08', value: 513514 };
const DOUBLE_SEND_MS = 5000;
const DAY_MS = 86400000;
const ID_RE = /^[A-Za-z0-9-]{16,64}$/;
const MAX_SEED = 100000;
const MILLION = 1000000;

const ALLOWED_ORIGINS = [
  'https://cme-modeler.pages.dev',
  'https://spottheaurora.co.nz',
  'https://www.spottheaurora.co.nz',
];
const ALLOWED_ORIGIN_RE = /^https:\/\/[a-z0-9-]+\.cme-modeler\.pages\.dev$/;
const isAllowedOrigin = (o) => ALLOWED_ORIGINS.includes(o) || ALLOWED_ORIGIN_RE.test(o);

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

export class PageViews {
  constructor(state) {
    this.sql = state.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS days (day TEXT PRIMARY KEY, n INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS visitors (id TEXT PRIMARY KEY, n INTEGER NOT NULL, last INTEGER NOT NULL)');
    // When the count reached a million, so the whole app can celebrate it
    // (the app celebrates the round hundred thousands only for whoever's view
    // made them, which `lifetime` in their own answer already says).
    this.sql.exec('CREATE TABLE IF NOT EXISTS milestones (n INTEGER PRIMARY KEY, at INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL)');
    const setKey = `set:${SET_LIFETIME.id}`;
    if (!this.one('SELECT v FROM meta WHERE k = ?', setKey)) {
      this.sql.exec('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
        'base', SET_LIFETIME.value - this.counted());
      this.sql.exec('INSERT INTO meta (k, v) VALUES (?, 1)', setKey);
    }
  }

  one(query, ...args) { return this.sql.exec(query, ...args).toArray()[0]; }

  /** Views counted here, all time. */
  counted() { return this.one('SELECT COALESCE(SUM(n), 0) AS s FROM days').s; }

  /** The all-time count. */
  lifetime() { return (this.one('SELECT v FROM meta WHERE k = ?', 'base')?.v ?? BASE_LIFETIME) + this.counted(); }

  totals(id, now) {
    const today = dayOf(now);
    const sum = (since) => this.one('SELECT COALESCE(SUM(n), 0) AS s FROM days WHERE day >= ?', since).s;
    const mine = ID_RE.test(id) ? this.one('SELECT n FROM visitors WHERE id = ?', id) : null;
    return {
      daily: sum(today),
      weekly: sum(dayOf(now - 6 * DAY_MS)),
      yearly: sum(dayOf(now - 364 * DAY_MS)),
      lifetime: this.lifetime(),
      visitors: this.one('SELECT COUNT(*) AS c FROM visitors').c,
      yours: mine ? mine.n : 0,
      millionAt: this.one('SELECT at FROM milestones WHERE n = ?', MILLION)?.at ?? null,
    };
  }

  count(id, seed, now) {
    const row = this.one('SELECT n, last FROM visitors WHERE id = ?', id);
    let n = row ? row.n : Math.min(Math.max(0, Math.floor(seed) || 0), MAX_SEED);
    if (!row || now - row.last >= DOUBLE_SEND_MS) {
      n += 1;
      this.sql.exec('INSERT INTO visitors (id, n, last) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET n = excluded.n, last = excluded.last', id, n, now);
      this.sql.exec('INSERT INTO days (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1', dayOf(now));
      if (this.lifetime() >= MILLION) {
        this.sql.exec('INSERT OR IGNORE INTO milestones (n, at) VALUES (?, ?)', MILLION, now);
      }
    }
    return this.totals(id, now);
  }

  async fetch(request) {
    const { op, id, seed } = await request.json();
    const now = Date.now();
    const out = op === 'count' ? this.count(id, Number(seed), now) : this.totals(id, now);
    return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json' } });
  }
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
    if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

    let op = 'read', id = url.searchParams.get('id') || '', seed = 0;
    if (request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch { /* no body: refused below */ }
      id = String(body?.id ?? '');
      seed = Number(body?.seed) || 0;
      if (!ID_RE.test(id)) return json({ error: 'a visitor id of 16-64 letters, digits or dashes is needed' }, 400);
      op = 'count';
    }

    try {
      const stub = env.PAGE_VIEWS.get(env.PAGE_VIEWS.idFromName('main'));
      const res = await stub.fetch('https://page-views.internal/', { method: 'POST', body: JSON.stringify({ op, id, seed }) });
      return json(await res.json());
    } catch (e) {
      return json({ error: 'counter unavailable', detail: String(e?.message ?? e) }, 503);
    }
  },
};
