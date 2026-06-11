/**
 * ACE EPAM Worker — Spot The Aurora  (HAPI MULTI-SOURCE UPGRADE)
 *
 * v3 — SWPC HAPI particle/ion sources
 * ------------------------------------
 * The EPAM/particle side now prefers the modern SWPC HAPI 1-minute ion
 * datasets, with the old NOAA ACE EPAM 5-minute JSON kept as a last-resort
 * fallback only:
 *
 *   Default source order: active-ions-pt1m → solar1-ions-pt1m →
 *                         ace-ions-pt1m → legacy NOAA ACE EPAM JSON
 *
 *   imap-ions-pt1m is OPTIONAL — if it fails / 404s / returns nothing, that
 *   source alone reports unavailable and nothing else breaks.
 *
 * Backwards compatibility guarantees (verified):
 *   • /epam/raw, /epam/averaged, /epam/analysis, /epam/goes, /epam/stereo,
 *     /epam/combined, /epam/health all keep their paths and legacy shapes.
 *   • /epam/raw still returns { ok, source, count, channels, data } and
 *     data[0] still carries time_tag, p1, p3, p5, p7, p8, e1, e2.
 *   • /epam/combined still contains cross_validation, ace_epam, goes,
 *     stereo_a (plus a new `particles` object).
 *   • /epam/health keeps ace_epam / goes_seiss / stereo_a and adds
 *     active_ions / solar1_ions / ace_ions / imap_ions.
 *   • The default active source stores into the OLD epam_data_* day buckets
 *     and epam_index, so loadAllEpamPoints() and any previously stored data
 *     keep working unchanged.
 *   • GOES and STEREO fetching/serving is unchanged.
 *   • CORS is unchanged.
 *
 * New optional query support (paths unchanged):
 *   /epam/raw?source=active|solar1|ace|imap   (same for averaged/analysis)
 *   Explicit ?source requests do NOT silently fall back — they return a
 *   graceful per-source JSON error instead.
 *
 * First-run behaviour: if KV is empty for the requested source, the worker
 * fetches the HAPI source live once, normalises it, stores it, and returns
 * it — no "no data" just because cron hasn't run yet.
 *
 * Optional debug endpoints (additive, non-breaking):
 *   /epam/debug/hapi-catalog
 *   /epam/debug/hapi-info?source=solar1
 */

// ─── Legacy NOAA endpoints (GOES + STEREO unchanged; ACE EPAM = fallback) ────
const NOAA_EPAM_URL        = 'https://services.swpc.noaa.gov/json/ace/epam/ace_epam_5m.json';
const NOAA_GOES_PROTON_URL = 'https://services.swpc.noaa.gov/json/goes/primary/integral-protons-1-day.json';
const NOAA_STEREO_URL      = 'https://services.swpc.noaa.gov/json/stereo/stereo_a_1m.json';

// ─── SWPC HAPI (lowercase L in "tlv") ────────────────────────────────────────
const HAPI_BASE = 'https://tlv-swpc.woc.noaa.gov/hapi';
const HAPI_PARAMETERS = 'p1,p2,p3,p4,p5,p6,p7,p8,de1,de2,de3,de4,quality,source,quality_flags,active';

// Per-source storage + labelling. `active` deliberately reuses the legacy
// epam_data_ / epam_index / EPAM_LAST_FETCH keys so all existing loaders and
// previously stored data keep working.
const HAPI_SOURCE_CONFIG = {
  active: {
    id: 'active-ions-pt1m',
    label: 'Active upstream ions',
    prefix: 'epam_data_',
    indexKey: 'epam_index',
    lastFetchKey: 'EPAM_LAST_FETCH',
    statusKey: 'hapi_status_active',
    sourceLabel: 'ACTIVE',
  },
  solar1: {
    id: 'solar1-ions-pt1m',
    label: 'SOLAR-1 ions',
    prefix: 'epam_solar1_data_',
    indexKey: 'epam_solar1_index',
    lastFetchKey: 'EPAM_SOLAR1_LAST_FETCH',
    statusKey: 'hapi_status_solar1',
    sourceLabel: 'SOLAR-1',
  },
  ace: {
    id: 'ace-ions-pt1m',
    label: 'ACE ions',
    prefix: 'epam_ace_hapi_data_',
    indexKey: 'epam_ace_hapi_index',
    lastFetchKey: 'EPAM_ACE_HAPI_LAST_FETCH',
    statusKey: 'hapi_status_ace',
    sourceLabel: 'ACE',
  },
  imap: {
    id: 'imap-ions-pt1m',
    label: 'IMAP ions',
    prefix: 'epam_imap_data_',
    indexKey: 'epam_imap_index',
    lastFetchKey: 'EPAM_IMAP_LAST_FETCH',
    statusKey: 'hapi_status_imap',
    sourceLabel: 'IMAP',
    optional: true,
  },
};

// Fallback order when no explicit ?source= is given.
const DEFAULT_SOURCE_ORDER = ['active', 'solar1', 'ace'];

// ─── KV keys (legacy — unchanged) ────────────────────────────────────────────
const KV_KEY_PREFIX          = 'epam_data_';
const KV_INDEX_KEY           = 'epam_index';
const KV_GOES_PREFIX         = 'goes_data_';
const KV_GOES_INDEX_KEY      = 'goes_index';
const KV_STEREO_PREFIX       = 'stereo_data_';
const KV_STEREO_INDEX_KEY    = 'stereo_index';
const KV_GOES_KEY            = 'goes_latest';
const KV_STEREO_KEY          = 'stereo_latest';

const MAX_DAYS       = 7;
const CACHE_TTL_S    = 4 * 60;
const HAPI_CACHE_TTL = 60;          // 1-minute data — short edge cache

// ─── Channel definitions (legacy keys kept EXACTLY — analysis depends on them) ─
const PROTON_CHANNELS = [
  { key: 'p1', label: 'P1 (47–68 keV)',     energy_mid: 57.5,  color: '#60a5fa' },
  { key: 'p3', label: 'P3 (115–195 keV)',   energy_mid: 155,   color: '#34d399' },
  { key: 'p5', label: 'P5 (310–580 keV)',   energy_mid: 445,   color: '#facc15' },
  { key: 'p7', label: 'P7 (795–1193 keV)',  energy_mid: 994,   color: '#fb923c' },
  { key: 'p8', label: 'P8 (1060–1900 keV)', energy_mid: 1480,  color: '#f87171' },
];

const ELECTRON_CHANNELS = [
  { key: 'e1', label: 'e⁻ (38–53 keV)',    color: '#c084fc' },
  { key: 'e2', label: 'e⁻ (175–315 keV)',  color: '#e879f9' },
];

// Extra metadata for the full HAPI channel set (additive — nothing reads these
// for the legacy analysis, they exist for newer frontends).
const HAPI_ION_CHANNELS      = ['p1','p2','p3','p4','p5','p6','p7','p8'];
const HAPI_ELECTRON_CHANNELS = ['de1','de2','de3','de4'];

const GOES_CHANNELS = [
  { key: 'ge1',   label: '≥1 MeV',   threshold_mev: 1,   color: '#93c5fd' },
  { key: 'ge5',   label: '≥5 MeV',   threshold_mev: 5,   color: '#6ee7b7' },
  { key: 'ge10',  label: '≥10 MeV',  threshold_mev: 10,  color: '#fde047', alert_pfu: 10   },
  { key: 'ge30',  label: '≥30 MeV',  threshold_mev: 30,  color: '#fbbf24' },
  { key: 'ge50',  label: '≥50 MeV',  threshold_mev: 50,  color: '#f97316' },
  { key: 'ge100', label: '≥100 MeV', threshold_mev: 100, color: '#ef4444', alert_pfu: 1    },
  { key: 'ge500', label: '≥500 MeV', threshold_mev: 500, color: '#dc2626' },
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return cors();
    if (url.pathname === '/epam/raw')      return handleRaw(env, url);
    if (url.pathname === '/epam/averaged') return handleAveraged(env, url);
    if (url.pathname === '/epam/analysis') return handleAnalysis(env, url);
    if (url.pathname === '/epam/goes')     return handleGoes(env);
    if (url.pathname === '/epam/stereo')   return handleStereo(env);
    if (url.pathname === '/epam/combined') return handleCombined(env);
    if (url.pathname === '/epam/health')   return handleHealth(env);
    if (url.pathname === '/epam/debug/hapi-catalog') return handleDebugCatalog();
    if (url.pathname === '/epam/debug/hapi-info')    return handleDebugInfo(url);
    return json({ error: 'Not found', endpoints: ['/epam/raw','/epam/averaged','/epam/analysis','/epam/goes','/epam/stereo','/epam/combined','/epam/health'] }, 404);
  },

  async scheduled(_evt, env, ctx) {
    ctx.waitUntil(
      Promise.allSettled([
        runHapiFetch(env, 'active').catch(e => console.error('[HAPI active] fetch failed:', e)),
        runHapiFetch(env, 'solar1').catch(e => console.error('[HAPI solar1] fetch failed:', e)),
        runHapiFetch(env, 'ace').catch(e => console.error('[HAPI ace] fetch failed:', e)),
        runHapiFetch(env, 'imap').catch(e => console.error('[HAPI imap] fetch failed (optional source):', e)),
        runGoesFetch(env).catch(e => console.error('[GOES] fetch failed:', e)),
        runStereoFetch(env).catch(e => console.error('[STEREO] fetch failed:', e)),
      ]).then(() =>
        // After the live fetches: extend history backwards toward the full
        // 7-day window, max 2 chunk requests per run (SOLAR-1/IMAP first).
        runHapiBackfill(env, 2).catch(e => console.error('[HAPI] backfill failed:', e))
      )
    );
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// HAPI: time helpers, CSV parsing, normalisation
// ═════════════════════════════════════════════════════════════════════════════

/** ISO UTC, no milliseconds — the format HAPI expects in time.min/time.max. */
function toHapiTime(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Canonical ISO time tag so dedup-by-time_tag is stable across fetches. */
function canonicalTimeTag(raw) {
  if (!raw) return null;
  const t = new Date(raw).getTime();
  if (!isFinite(t)) return null;
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const ISO_TIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/**
 * Treat HAPI fill / missing values as null. Keeps valid zeroes as zero.
 *   -9999.99, -9999.9, -999.9, anything ≤ -1e30, '', null, NaN → null
 */
function hapiValue(rawStr) {
  if (rawStr === null || rawStr === undefined) return null;
  const s = String(rawStr).trim();
  if (s === '' || s.toLowerCase() === 'null' || s.toLowerCase() === 'nan') return null;
  const n = Number(s);
  if (!isFinite(n)) return null;
  if (n <= -1e30) return null;
  // Common SWPC fill values (with a little float tolerance)
  if (Math.abs(n - (-9999.99)) < 0.05) return null;
  if (Math.abs(n - (-9999.9))  < 0.05) return null;
  if (Math.abs(n - (-999.9))   < 0.05) return null;
  return n;
}

/** Split a single CSV line, handling quoted fields (just in case). */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Parse HAPI CSV into rows of raw column strings.
 *   • First column is time — must look like an ISO timestamp or the line is
 *     skipped (this also drops comment/header lines).
 *   • Remaining columns follow the requested parameter order.
 */
function parseHapiCsv(text) {
  const rows = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const cols = splitCsvLine(line).map(c => c.trim());
    if (!cols.length || !ISO_TIME_RE.test(cols[0].replace(/^"|"$/g, ''))) continue;
    rows.push(cols);
  }
  return rows;
}

/**
 * Normalise one HAPI row (time + ordered parameter values) into the legacy
 * EPAM point shape, preserving every legacy field exactly and adding the new
 * HAPI fields. Parameter order matches HAPI_PARAMETERS.
 */
function normaliseHapiRow(cols, cfg) {
  const time_tag = canonicalTimeTag(cols[0].replace(/^"|"$/g, ''));
  if (!time_tag) return null;
  const v = (i) => hapiValue(cols[i]);
  const p1 = v(1),  p2 = v(2),  p3 = v(3),  p4 = v(4);
  const p5 = v(5),  p6 = v(6),  p7 = v(7),  p8 = v(8);
  const de1 = v(9), de2 = v(10), de3 = v(11), de4 = v(12);
  const quality       = v(13);
  const sourceFlag    = v(14);
  const quality_flags = v(15);
  const active        = v(16);
  return {
    // ── legacy fields (exact) ──
    time_tag,
    p1, p3, p5, p7, p8,
    e1: de1,                       // de1 → e1 for backwards compatibility
    e2: de2,                       // de2 → e2 for backwards compatibility
    anisotropy_index: null,        // not present in HAPI ion datasets
    status: (quality !== null && quality >= 0) ? quality : 0,
    // ── new HAPI fields (additive) ──
    p2, p4, p6,
    de1, de2, de3, de4,
    quality,
    source: sourceFlag,
    quality_flags,
    active,
    hapi_dataset: cfg.id,
    source_label: cfg.sourceLabel,
    spacecraft: cfg.sourceLabel,
  };
}

/**
 * Fetch one HAPI dataset over [timeMinMs, timeMaxMs] and return normalised,
 * deduplicated points (oldest→newest). Throws a clear source-specific error on
 * HTTP failure or unexpected content — callers isolate failures per source.
 */
async function fetchHapiWindow(cfg, timeMinMs, timeMaxMs) {
  const u = `${HAPI_BASE}/data?id=${encodeURIComponent(cfg.id)}` +
            `&parameters=${encodeURIComponent(HAPI_PARAMETERS)}` +
            `&time.min=${encodeURIComponent(toHapiTime(timeMinMs))}` +
            `&time.max=${encodeURIComponent(toHapiTime(timeMaxMs))}` +
            `&format=csv`;
  const res = await fetch(u, { cf: { cacheTtl: HAPI_CACHE_TTL, cacheEverything: false } });
  if (!res.ok) throw new Error(`[${cfg.id}] HAPI HTTP ${res.status}`);

  const contentType = (res.headers.get('Content-Type') || '').toLowerCase();
  let points = [];

  if (contentType.includes('application/json')) {
    // Graceful handling if the server ever returns HAPI JSON instead of CSV.
    let body;
    try { body = await res.json(); } catch (e) { throw new Error(`[${cfg.id}] HAPI returned unparseable JSON: ${e.message}`); }
    const data = Array.isArray(body?.data) ? body.data : null;
    if (!data) throw new Error(`[${cfg.id}] HAPI JSON response missing data array`);
    for (const row of data) {
      if (!Array.isArray(row) || !row.length) continue;
      const cols = row.map(c => (c === null || c === undefined) ? '' : String(c));
      if (!ISO_TIME_RE.test(cols[0])) continue;
      const pt = normaliseHapiRow(cols, cfg);
      if (pt) points.push(pt);
    }
  } else {
    const text = await res.text();
    if (text && text.trimStart().startsWith('{')) {
      // JSON delivered without the right content-type — try to recover.
      try {
        const body = JSON.parse(text);
        const data = Array.isArray(body?.data) ? body.data : [];
        for (const row of data) {
          if (!Array.isArray(row) || !row.length) continue;
          const cols = row.map(c => (c === null || c === undefined) ? '' : String(c));
          if (!ISO_TIME_RE.test(cols[0])) continue;
          const pt = normaliseHapiRow(cols, cfg);
          if (pt) points.push(pt);
        }
      } catch {
        throw new Error(`[${cfg.id}] HAPI returned unexpected non-CSV content`);
      }
    } else {
      for (const cols of parseHapiCsv(text)) {
        const pt = normaliseHapiRow(cols, cfg);
        if (pt) points.push(pt);
      }
    }
  }

  // Keep points where at least one proton channel has real data.
  points = points.filter(p =>
    p.p1 !== null || p.p2 !== null || p.p3 !== null || p.p4 !== null ||
    p.p5 !== null || p.p6 !== null || p.p7 !== null || p.p8 !== null
  );

  // Dedup by time_tag, oldest→newest.
  const seen = new Set();
  const out = [];
  for (const p of points) {
    if (seen.has(p.time_tag)) continue;
    seen.add(p.time_tag);
    out.push(p);
  }
  out.sort((a, b) => new Date(a.time_tag).getTime() - new Date(b.time_tag).getTime());
  return out;
}

/**
 * Fetch a HAPI source using the standard window strategy:
 *   • stored newest_ts present → request newest_ts − 10 min … now − 2 min
 *   • no stored data           → request the full MAX_DAYS (7 days) … now − 2 min,
 *     so a fresh deployment immediately has the whole baseline week
 *   • empty result             → one retry with time.max = now − 5 min
 */
async function fetchHapiWithWindow(cfg, newestStoredTs) {
  const now = Date.now();
  const timeMax1 = now - 2 * 60 * 1000;
  const timeMin = newestStoredTs
    ? newestStoredTs - 10 * 60 * 1000
    : now - MAX_DAYS * 86400 * 1000;
  let points = await fetchHapiWindow(cfg, timeMin, timeMax1);
  if (points.length === 0) {
    const timeMax2 = now - 5 * 60 * 1000;
    if (timeMax2 > timeMin) {
      points = await fetchHapiWindow(cfg, timeMin, timeMax2);
    }
  }
  return points;
}

// ═════════════════════════════════════════════════════════════════════════════
// HAPI: storage (day buckets, same scheme as the legacy EPAM storage)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Merge new points into per-day KV buckets and update the source index.
 * Normal mode keeps the fast path: only points newer than newest_ts are
 * stored. Backfill mode merges OLDER points too (anything within the
 * MAX_DAYS retention window) — day-bucket dedup makes overlap harmless.
 * Both modes maintain index.oldest_ts so the backfill scheduler knows how
 * far back coverage already reaches.
 */
async function storeHapiPoints(kv, cfg, points, { backfill = false } = {}) {
  if (!points.length) return 0;
  let indexRaw = await kv.get(cfg.indexKey);
  let index = indexRaw ? JSON.parse(indexRaw) : { keys: [], newest_ts: null, oldest_ts: null };
  const newestStored = index.newest_ts ? new Date(index.newest_ts).getTime() : 0;
  const retentionCutoff = Date.now() - MAX_DAYS * 86400 * 1000;
  const newPoints = backfill
    ? points.filter(p => new Date(p.time_tag).getTime() >= retentionCutoff)
    : points.filter(p => new Date(p.time_tag).getTime() > newestStored);
  if (newPoints.length === 0) return 0;
  const byDay = {};
  for (const pt of newPoints) {
    const day = pt.time_tag.slice(0, 10);
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(pt);
  }
  for (const [day, pts] of Object.entries(byDay)) {
    const key = `${cfg.prefix}${day}`;
    let existing = [];
    try { const r = await kv.get(key); if (r) existing = JSON.parse(r); } catch {}
    const merged = dedupByTag([...existing, ...pts]);
    await kv.put(key, JSON.stringify(merged), { expirationTtl: MAX_DAYS * 86400 + 3600 });
    if (!index.keys.includes(key)) index.keys.push(key);
  }
  const cutoff = new Date(Date.now() - MAX_DAYS * 86400 * 1000);
  index.keys = index.keys.filter(k => new Date(k.replace(cfg.prefix, '')) >= cutoff);
  const allTs = newPoints.map(p => p.time_tag).sort();
  const incomingNewest = allTs[allTs.length - 1];
  const incomingOldest = allTs[0];
  if (!index.newest_ts || incomingNewest > index.newest_ts) index.newest_ts = incomingNewest;
  if (!index.oldest_ts || incomingOldest < index.oldest_ts) index.oldest_ts = incomingOldest;
  await kv.put(cfg.indexKey, JSON.stringify(index));
  await kv.put(cfg.lastFetchKey, Date.now().toString());
  return newPoints.length;
}

async function setHapiStatus(kv, cfg, ok, error) {
  try {
    await kv.put(cfg.statusKey, JSON.stringify({ ok, error: error ?? null, ts: Date.now() }));
  } catch {}
}

/** Cron worker for one HAPI source. One source failing never affects others. */
async function runHapiFetch(env, sourceKey) {
  const cfg = HAPI_SOURCE_CONFIG[sourceKey];
  const kv = env.EPAM_KV;
  if (!cfg) return;
  if (!kv) { console.error('[HAPI] EPAM_KV binding missing'); return; }
  try {
    const indexRaw = await kv.get(cfg.indexKey);
    const index = indexRaw ? JSON.parse(indexRaw) : null;
    const newestStoredTs = index?.newest_ts ? new Date(index.newest_ts).getTime() : null;
    const points = await fetchHapiWithWindow(cfg, newestStoredTs);
    if (points.length === 0) {
      console.warn(`[HAPI ${sourceKey}] no points returned — preserving existing KV data`);
      await setHapiStatus(kv, cfg, !cfg.optional, 'empty response');
      return;
    }
    const stored = await storeHapiPoints(kv, cfg, points);
    await setHapiStatus(kv, cfg, true, null);
    console.log(`[HAPI ${sourceKey}] stored ${stored} new points (${cfg.id})`);
  } catch (e) {
    await setHapiStatus(kv, cfg, false, e?.message ?? String(e));
    if (cfg.optional) {
      console.warn(`[HAPI ${sourceKey}] optional source unavailable: ${e?.message ?? e}`);
      return; // optional sources fail silently
    }
    throw e;
  }
}

// ── Backfill: extend stored history BACKWARDS to the full 7-day window ───────
// The live fetch only ever moves forward from newest_ts, so a deployment that
// starts today would take a week to accumulate its baseline. Backfill fixes
// that: each cron run, sources whose oldest stored point is younger than
// MAX_DAYS ago fetch one BACKFILL_CHUNK_H-hour chunk of OLDER data and merge
// it in. With 24h chunks the full week is in place after ~6 cron runs.
// Best-effort by design — a backfill failure never throws and never touches
// the live forward-fetch path.

const BACKFILL_CHUNK_H = 24;

/**
 * One backwards chunk for one source. Returns true if a HAPI request was
 * made (used by the scheduler to cap work per cron run), false if the source
 * is already fully covered / has no index yet.
 */
async function backfillHapiSource(env, sourceKey) {
  const cfg = HAPI_SOURCE_CONFIG[sourceKey];
  const kv = env.EPAM_KV;
  if (!cfg || !kv) return false;
  try {
    const indexRaw = await kv.get(cfg.indexKey);
    const index = indexRaw ? JSON.parse(indexRaw) : null;
    // No data at all yet → the first-run path (fetchHapiWithWindow with a
    // null cursor) already requests the full 7 days; nothing to do here.
    if (!index || !index.keys?.length) return false;

    const target = Date.now() - MAX_DAYS * 86400 * 1000;

    // Coverage cursor. Older deployments have no oldest_ts in their index —
    // derive it as the END of the oldest day bucket, so that day gets
    // re-fetched once in full (dedup makes the overlap harmless) in case the
    // bucket was only partial.
    let oldestTs = index.oldest_ts ? new Date(index.oldest_ts).getTime() : null;
    if (oldestTs === null) {
      const days = index.keys.map(k => k.replace(cfg.prefix, '')).sort();
      if (!days.length) return false;
      oldestTs = new Date(days[0] + 'T00:00:00Z').getTime() + 86400 * 1000;
    }

    // Already covering the full window (5 min slack)?
    if (oldestTs <= target + 5 * 60 * 1000) return false;

    const timeMax = Math.min(oldestTs - 60 * 1000, Date.now() - 2 * 60 * 1000);
    const timeMin = Math.max(target, oldestTs - BACKFILL_CHUNK_H * 3600 * 1000);
    if (timeMax <= timeMin) return false;

    const points = await fetchHapiWindow(cfg, timeMin, timeMax);
    if (points.length) {
      await storeHapiPoints(kv, cfg, points, { backfill: true });
      console.log(`[HAPI ${sourceKey}] backfilled ${points.length} points (${toHapiTime(timeMin)} → ${toHapiTime(timeMax)})`);
    } else {
      console.log(`[HAPI ${sourceKey}] backfill window empty (${toHapiTime(timeMin)} → ${toHapiTime(timeMax)}) — archive has no data there`);
    }

    // Advance the cursor to timeMin regardless — an empty window means the
    // archive genuinely has nothing there, and without moving the cursor we
    // would re-request the same empty window every cron run forever.
    const idxRaw2 = await kv.get(cfg.indexKey);
    const idx2 = idxRaw2 ? JSON.parse(idxRaw2) : index;
    const cur = idx2.oldest_ts ? new Date(idx2.oldest_ts).getTime() : null;
    if (cur === null || timeMin < cur) {
      idx2.oldest_ts = toHapiTime(timeMin);
      await kv.put(cfg.indexKey, JSON.stringify(idx2));
    }
    return true;
  } catch (e) {
    console.warn(`[HAPI ${sourceKey}] backfill failed (will retry next cron): ${e?.message ?? e}`);
    return true; // a request was attempted — still counts against the per-run cap
  }
}

/**
 * Run backfill for sources that still need it, capped at maxChunks HAPI
 * requests per cron invocation (keeps each scheduled run well inside
 * Cloudflare's subrequest limits). SOLAR-1 and IMAP first — they feed the
 * cross-spacecraft confirmation baselines.
 */
async function runHapiBackfill(env, maxChunks = 2) {
  const order = ['solar1', 'imap', 'active', 'ace'];
  let done = 0;
  for (const key of order) {
    if (done >= maxChunks) break;
    const worked = await backfillHapiSource(env, key);
    if (worked) done++;
  }
}

/** Load a HAPI source from KV (newest-first). */
async function loadHapiPoints(kv, sourceKey) {
  const cfg = HAPI_SOURCE_CONFIG[sourceKey];
  if (!cfg) return [];
  return loadFromDayBuckets(kv, cfg.indexKey);
}

/**
 * Serve-time resolver with first-run live fetch.
 * Returns { points (newest-first), meta } or throws a source-specific error.
 */
async function getSourcePoints(env, sourceKey) {
  const cfg = HAPI_SOURCE_CONFIG[sourceKey];
  const kv = env.EPAM_KV;
  if (!cfg) throw new Error(`Unknown source '${sourceKey}'`);
  if (!kv) throw new Error('KV unavailable');

  let points = await loadHapiPoints(kv, sourceKey);
  let liveFetched = false;

  if (!points || points.length === 0) {
    // First-run behaviour: KV empty → fetch live once, store, return.
    const fetched = await fetchHapiWithWindow(cfg, null);
    if (!fetched.length) throw new Error(`[${cfg.id}] no data available from HAPI`);
    try { await storeHapiPoints(kv, cfg, fetched); } catch (e) { console.warn(`[HAPI ${sourceKey}] live store failed:`, e?.message); }
    points = [...fetched].sort((a, b) => new Date(b.time_tag).getTime() - new Date(a.time_tag).getTime());
    liveFetched = true;
  }
  if (!points.length) throw new Error(`[${cfg.id}] no data available`);

  return {
    points,
    meta: {
      source_key: sourceKey,
      data_source: 'swpc_hapi',
      hapi_dataset: cfg.id,
      source_label: cfg.sourceLabel,
      spacecraft: cfg.sourceLabel,
      label: cfg.label,
      live_fetched: liveFetched,
    },
  };
}

/** Legacy NOAA ACE EPAM 5-minute JSON — last-resort fallback only. */
async function fetchLegacyAcePoints() {
  const res = await fetch(NOAA_EPAM_URL, { cf: { cacheTtl: CACHE_TTL_S, cacheEverything: false } });
  if (!res.ok) throw new Error(`[legacy ACE EPAM] HTTP ${res.status}`);
  const raw = await res.json();
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('[legacy ACE EPAM] empty response');
  const points = raw.map(normaliseEpam).filter(p => p !== null).filter(p => p.p1 > 0 || p.p3 > 0);
  if (!points.length) throw new Error('[legacy ACE EPAM] no valid points');
  points.sort((a, b) => new Date(b.time_tag).getTime() - new Date(a.time_tag).getTime());
  return points;
}

/**
 * Resolve EPAM points for an endpoint.
 *   • explicit ?source= → that source only; throws a per-source error if it
 *     fails (no silent switching).
 *   • no source → active → solar1 → ace → legacy NOAA ACE EPAM JSON.
 */
async function resolveEpamPoints(env, requestedSource) {
  if (requestedSource) {
    if (!HAPI_SOURCE_CONFIG[requestedSource]) {
      const err = new Error(`Unknown source '${requestedSource}'. Valid: ${Object.keys(HAPI_SOURCE_CONFIG).join(', ')}`);
      err.sourceKey = requestedSource;
      throw err;
    }
    try {
      return await getSourcePoints(env, requestedSource);
    } catch (e) {
      const err = new Error(e?.message ?? String(e));
      err.sourceKey = requestedSource;
      throw err;
    }
  }

  const errors = [];
  for (const key of DEFAULT_SOURCE_ORDER) {
    try {
      const got = await getSourcePoints(env, key);
      got.meta.fallback_used = key !== DEFAULT_SOURCE_ORDER[0];
      got.meta.fallback_chain_errors = errors.length ? errors : undefined;
      return got;
    } catch (e) {
      errors.push(`${key}: ${e?.message ?? e}`);
    }
  }

  // All HAPI default sources failed — legacy NOAA ACE EPAM JSON fallback.
  const legacyPoints = await fetchLegacyAcePoints();
  return {
    points: legacyPoints,
    meta: {
      source_key: 'legacy_ace_epam',
      data_source: 'noaa_ace_epam_5m_json',
      hapi_dataset: null,
      source_label: 'ACE',
      spacecraft: 'ACE',
      label: 'ACE EPAM (legacy NOAA JSON fallback)',
      fallback_used: true,
      fallback_chain_errors: errors,
      live_fetched: true,
    },
  };
}

/** Human-readable `source` string, kept legacy-friendly. */
function sourceString(meta) {
  if (meta.source_key === 'legacy_ace_epam') return 'ACE EPAM';
  return `${meta.label} — ${meta.hapi_dataset} (SWPC HAPI)`;
}

function validSourceParam(url) {
  const s = url.searchParams.get('source');
  if (!s) return null;
  return s.toLowerCase();
}

// ─── Cron: GOES SEISS (UNCHANGED) ────────────────────────────────────────────
async function runGoesFetch(env) {
  const kv = env.EPAM_KV;
  if (!kv) return;
  const res = await fetch(NOAA_GOES_PROTON_URL, { cf: { cacheTtl: CACHE_TTL_S, cacheEverything: false } });
  if (!res.ok) { console.error('[GOES] fetch failed:', res.status); return; }
  const raw = await res.json();
  if (!Array.isArray(raw)) { console.warn('[GOES] unexpected format'); return; }
  const byTime = {};
  for (const entry of raw) {
    if (!entry.time_tag) continue;
    const flux = parseFloat(entry.flux);
    if (!isFinite(flux) || flux < -9e4) continue;
    if (!byTime[entry.time_tag]) byTime[entry.time_tag] = { time_tag: entry.time_tag, satellite: entry.satellite };
    const ch = goesEnergyToKey(entry.energy);
    if (ch) byTime[entry.time_tag][ch] = flux;
  }
  const points = Object.values(byTime);
  if (points.length === 0) { console.warn('[GOES] no valid points after pivot'); return; }
  let indexRaw = await kv.get(KV_GOES_INDEX_KEY);
  let index = indexRaw ? JSON.parse(indexRaw) : { keys: [], newest_ts: null };
  const newestStored = index.newest_ts ? new Date(index.newest_ts).getTime() : 0;
  const newPoints = points.filter(p => new Date(p.time_tag).getTime() > newestStored);
  if (newPoints.length === 0) { console.log('[GOES] no new points'); return; }
  const byDay = {};
  for (const pt of newPoints) {
    const day = pt.time_tag.slice(0, 10);
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(pt);
  }
  for (const [day, pts] of Object.entries(byDay)) {
    const key = `${KV_GOES_PREFIX}${day}`;
    let existing = [];
    try { const r = await kv.get(key); if (r) existing = JSON.parse(r); } catch {}
    const merged = dedupByTag([...existing, ...pts]);
    await kv.put(key, JSON.stringify(merged), { expirationTtl: MAX_DAYS * 86400 + 3600 });
    if (!index.keys.includes(key)) index.keys.push(key);
  }
  const cutoff = new Date(Date.now() - MAX_DAYS * 86400 * 1000);
  index.keys = index.keys.filter(k => new Date(k.replace(KV_GOES_PREFIX, '')) >= cutoff);
  const allTs = newPoints.map(p => p.time_tag).sort();
  index.newest_ts = allTs[allTs.length - 1];
  await kv.put(KV_GOES_INDEX_KEY, JSON.stringify(index));
  await kv.put('GOES_LAST_FETCH', Date.now().toString());
  console.log(`[GOES] stored ${newPoints.length} new points across ${Object.keys(byDay).length} day(s)`);
}

function goesEnergyToKey(energyStr) {
  if (!energyStr) return null;
  const s = String(energyStr).toLowerCase();
  if (s.includes('>=500') || s.includes('>500') || s.includes('500mev')) return 'ge500';
  if (s.includes('>=100') || s.includes('>100') || s.includes('100mev')) return 'ge100';
  if (s.includes('>=50')  || s.includes('>50')  || s.includes('50mev'))  return 'ge50';
  if (s.includes('>=30')  || s.includes('>30')  || s.includes('30mev'))  return 'ge30';
  if (s.includes('>=10')  || s.includes('>10')  || s.includes('10mev'))  return 'ge10';
  if (s.includes('>=5')   || s.includes('>5')   || s.includes('5mev'))   return 'ge5';
  if (s.includes('>=1')   || s.includes('>1')   || s.includes('1mev'))   return 'ge1';
  return null;
}

// ─── Cron: STEREO-A (UNCHANGED) ──────────────────────────────────────────────
async function runStereoFetch(env) {
  const kv = env.EPAM_KV;
  if (!kv) return;
  const TAIL_BYTES = 400 * 1024;
  let recent = [];
  try {
    const res = await fetch(NOAA_STEREO_URL, { cf: { cacheTtl: CACHE_TTL_S, cacheEverything: false } });
    if (!res.ok) { console.error('[STEREO] fetch failed:', res.status); return; }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let tail = '';
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      tail += decoder.decode(value, { stream: true });
      if (tail.length > TAIL_BYTES * 1.5) tail = tail.slice(tail.length - TAIL_BYTES);
    }
    tail += decoder.decode();
    if (tail.length > TAIL_BYTES) tail = tail.slice(tail.length - TAIL_BYTES);
    console.log(`[STEREO] streamed ${Math.round(totalBytes / 1024)} KB, parsing tail ${Math.round(tail.length / 1024)} KB`);
    const cutoff = Date.now() - 86400 * 1000;
    const objRegex = /\{[^{}]+\}/g;
    let match;
    while ((match = objRegex.exec(tail)) !== null) {
      try {
        const raw = JSON.parse(match[0]);
        const ts = raw.timestamp || raw.time_tag;
        if (!ts) continue;
        const t = new Date(ts).getTime();
        if (isNaN(t) || t < cutoff) continue;
        const norm = normaliseStereo(raw);
        if (norm) recent.push(norm);
      } catch {}
    }
    console.log(`[STEREO] extracted ${recent.length} points from tail`);
  } catch (e) {
    console.error('[STEREO] stream error:', e.message);
    return;
  }
  if (recent.length === 0) { console.warn('[STEREO] no valid points — preserving existing KV data'); return; }
  recent.sort((a, b) => new Date(a.time_tag).getTime() - new Date(b.time_tag).getTime());
  let indexRaw = await kv.get(KV_STEREO_INDEX_KEY);
  let index = indexRaw ? JSON.parse(indexRaw) : { keys: [], newest_ts: null };
  const newestStored = index.newest_ts ? new Date(index.newest_ts).getTime() : 0;
  const newPoints = recent.filter(p => new Date(p.time_tag).getTime() > newestStored);
  if (newPoints.length === 0) { console.log('[STEREO] no new points to store'); return; }
  const byDay = {};
  for (const pt of newPoints) {
    const day = pt.time_tag.slice(0, 10);
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(pt);
  }
  for (const [day, pts] of Object.entries(byDay)) {
    const key = `${KV_STEREO_PREFIX}${day}`;
    let existing = [];
    try { const r = await kv.get(key); if (r) existing = JSON.parse(r); } catch {}
    const merged = dedupByTag([...existing, ...pts]);
    await kv.put(key, JSON.stringify(merged), { expirationTtl: MAX_DAYS * 86400 + 3600 });
    if (!index.keys.includes(key)) index.keys.push(key);
  }
  const cutoff = new Date(Date.now() - MAX_DAYS * 86400 * 1000);
  index.keys = index.keys.filter(k => new Date(k.replace(KV_STEREO_PREFIX, '')) >= cutoff);
  const allTs = newPoints.map(p => p.time_tag).sort();
  index.newest_ts = allTs[allTs.length - 1];
  await kv.put(KV_STEREO_INDEX_KEY, JSON.stringify(index));
  await kv.put('STEREO_LAST_FETCH', Date.now().toString());
  console.log(`[STEREO] stored ${newPoints.length} new points across ${Object.keys(byDay).length} day(s)`);
}

// ═════════════════════════════════════════════════════════════════════════════
// Endpoint handlers
// ═════════════════════════════════════════════════════════════════════════════

/** Graceful per-source error response (does not break other sources). */
function sourceErrorJson(sourceKey, message) {
  const cfg = HAPI_SOURCE_CONFIG[sourceKey];
  return json({
    ok: false,
    source_key: sourceKey ?? null,
    hapi_dataset: cfg?.id ?? null,
    error: message,
    available_sources: Object.keys(HAPI_SOURCE_CONFIG),
    note: cfg?.optional ? 'This source is optional — other sources are unaffected.' : undefined,
  });
}

async function handleRaw(env, url) {
  if (!env.EPAM_KV) return json({ ok: false, error: 'KV unavailable' }, 503);
  const requested = validSourceParam(url);
  let resolved;
  try {
    resolved = await resolveEpamPoints(env, requested);
  } catch (e) {
    return sourceErrorJson(e?.sourceKey ?? requested, e?.message ?? String(e));
  }
  const { points, meta } = resolved;
  return json({
    ok: true,
    // legacy fields — shape preserved
    source: sourceString(meta),
    count: points.length,
    channels: {
      protons: PROTON_CHANNELS,
      electrons: ELECTRON_CHANNELS,
      hapi_ions: HAPI_ION_CHANNELS,
      hapi_electrons: HAPI_ELECTRON_CHANNELS,
    },
    data: points,
    // new clearer fields — additive
    data_source: meta.data_source,
    hapi_dataset: meta.hapi_dataset,
    spacecraft: meta.spacecraft,
    source_label: meta.source_label,
    source_key: meta.source_key,
    fallback_used: meta.fallback_used ?? false,
    fallback_chain_errors: meta.fallback_chain_errors,
  });
}

async function handleAveraged(env, url) {
  if (!env.EPAM_KV) return json({ ok: false, error: 'KV unavailable' }, 503);
  const requested = validSourceParam(url);
  let resolved;
  try {
    resolved = await resolveEpamPoints(env, requested);
  } catch (e) {
    return sourceErrorJson(e?.sourceKey ?? requested, e?.message ?? String(e));
  }
  const { points, meta } = resolved;
  if (points.length === 0) return json({ ok: true, hourly: [], daily: [] });
  return json({
    ok: true,
    source: sourceString(meta),
    hourly: aggregateByPeriod(points, 60),
    daily: aggregateByPeriod(points, 1440),
    channels: PROTON_CHANNELS,
    data_source: meta.data_source,
    hapi_dataset: meta.hapi_dataset,
    spacecraft: meta.spacecraft,
    source_label: meta.source_label,
    source_key: meta.source_key,
    fallback_used: meta.fallback_used ?? false,
  });
}

/**
 * Summarise a confirmation source from KV only (no live fetch — confirmation
 * is best-effort and must never slow down or break the main analysis).
 * "Elevated" = ≥2 proton channels above 2× their own 24h median.
 */
async function summariseParticleSource(kv, sourceKey) {
  const cfg = HAPI_SOURCE_CONFIG[sourceKey];
  const out = {
    dataset: cfg?.id ?? null,
    source_label: cfg?.sourceLabel ?? null,
    available: false,
    elevated: null,
    current: null,
    point_count: 0,
    newest: null,
  };
  try {
    const points = await loadHapiPoints(kv, sourceKey);
    if (!points || points.length === 0) return out;
    out.point_count = points.length;
    out.current = points[0] ?? null;
    out.newest = points[0]?.time_tag ?? null;
    // Only count as available if data is reasonably fresh (≤ 3 h old)
    const ageMs = Date.now() - new Date(points[0].time_tag).getTime();
    if (!isFinite(ageMs) || ageMs > 3 * 3600 * 1000) return out;
    out.available = true;
    const last24h = points.filter(p => new Date(p.time_tag).getTime() > Date.now() - 86400000);
    const baseline = {};
    for (const ch of PROTON_CHANNELS) {
      const vals = last24h.map(p => p[ch.key]).filter(v => v !== null && v > 0);
      baseline[ch.key] = vals.length > 0 ? median(vals) : null;
    }
    const current = points[0];
    out.elevated = PROTON_CHANNELS.filter(ch => {
      const b = baseline[ch.key];
      return b && b > 0 && current[ch.key] !== null && current[ch.key] > b * 2;
    }).length >= 2;
  } catch {}
  return out;
}

async function handleAnalysis(env, url) {
  const kv = env.EPAM_KV;
  if (!kv) return json({ ok: false, error: 'KV unavailable' }, 503);
  const requested = validSourceParam(url);
  let resolved;
  try {
    resolved = await resolveEpamPoints(env, requested);
  } catch (e) {
    return sourceErrorJson(e?.sourceKey ?? requested, e?.message ?? String(e));
  }
  const { points: epamPoints, meta } = resolved;
  const goesRaw = await kv.get(KV_GOES_KEY).then(r => r ? JSON.parse(r) : null).catch(() => null);
  const goesPoints = await loadAllGoesPoints(kv);
  const goesData = (goesPoints && goesPoints.length > 0) ? goesPoints : goesRaw;
  if (!epamPoints || epamPoints.length < 12) return json({ ok: true, status: 'INSUFFICIENT_DATA', points_available: epamPoints?.length ?? 0 });
  const analysis = analyseEPAM(epamPoints);
  const goesCurrent = goesData?.[0] ?? null;
  const goesS1      = goesCurrent && (goesCurrent.ge10 ?? 0) >= 10;
  const goesElevated = goesCurrent && (goesCurrent.ge10 ?? 0) >= 1;
  analysis.goes_validation = { available: !!goesCurrent, ge10_mev_flux: goesCurrent?.ge10 ?? null, ge100_mev_flux: goesCurrent?.ge100 ?? null, s1_alert: goesS1, elevated: goesElevated, confidence_note: goesElevated ? 'Second satellite confirms — the reading is more likely real.' : (goesCurrent ? 'Second satellite is quiet — treat this with some caution for now.' : 'Second satellite data unavailable.') };

  // ── NEW: cross-spacecraft particle confirmation (SOLAR-1 / IMAP / others) ──
  // The primary detection is unchanged; this layer reports whether independent
  // L1 particle sources agree with whatever the primary source is showing.
  const confirmKeys = Object.keys(HAPI_SOURCE_CONFIG).filter(k => k !== meta.source_key);
  const confirmEntries = {};
  for (const key of confirmKeys) {
    confirmEntries[key] = await summariseParticleSource(kv, key);
  }
  const confirming = Object.entries(confirmEntries).filter(([, v]) => v.available && v.elevated === true).map(([k]) => HAPI_SOURCE_CONFIG[k].sourceLabel);
  const availableConfirm = Object.values(confirmEntries).filter(v => v.available).length;
  analysis.particle_cross_validation = {
    primary_source: meta.source_key,
    primary_dataset: meta.hapi_dataset,
    sources: confirmEntries,
    confirming_sources: confirming,
    confirmed: confirming.length > 0,
    confidence_note: availableConfirm === 0
      ? 'No independent particle sources available for confirmation right now.'
      : confirming.length > 0
        ? `Independent spacecraft (${confirming.join(', ')}) also show elevated particles — the signal is cross-confirmed.`
        : 'Independent particle sources are quiet — treat a single-spacecraft signal with some caution.',
  };

  return json({
    ok: true,
    ...analysis,
    data_source: meta.data_source,
    hapi_dataset: meta.hapi_dataset,
    spacecraft: meta.spacecraft,
    source_label: meta.source_label,
    source_key: meta.source_key,
    fallback_used: meta.fallback_used ?? false,
  });
}

async function handleGoes(env) {
  const kv = env.EPAM_KV;
  if (!kv) return json({ ok: false, error: 'KV unavailable' }, 503);
  let points = await loadAllGoesPoints(kv);
  if (!points || points.length === 0) {
    const legacy = await kv.get(KV_GOES_KEY);
    if (!legacy) return json({ ok: false, error: 'No GOES data yet — check back after first cron run' });
    points = JSON.parse(legacy);
  }
  const lastFetch = await kv.get('GOES_LAST_FETCH');
  const current = points[0] ?? null;
  const ge10 = current?.ge10 ?? 0;
  let sScale = 0;
  if      (ge10 >= 100000) sScale = 5;
  else if (ge10 >= 10000)  sScale = 4;
  else if (ge10 >= 1000)   sScale = 3;
  else if (ge10 >= 100)    sScale = 2;
  else if (ge10 >= 10)     sScale = 1;
  return json({ ok: true, source: 'GOES SEISS (geostationary)', last_fetch: lastFetch ? new Date(Number(lastFetch)).toISOString() : null, count: points.length, current_flux: current, s_scale: sScale, s_scale_label: sScale > 0 ? `S${sScale} Solar Radiation Storm` : 'Below storm threshold', alert_thresholds: { ge10_mev_pfu: { S1: 10, S2: 100, S3: 1000, S4: 10000, S5: 100000 }, ge100_mev_pfu: { event: 1 } }, channels: GOES_CHANNELS, data: points, caveats: ['GOES is at geostationary orbit — magnetospheric trapping can inflate readings.', 'GOES is excellent for confirming real SEP events seen at L1.', 'GOES does NOT detect CME approach signatures — use the L1 particle data for that.'] });
}

async function handleStereo(env) {
  const kv = env.EPAM_KV;
  if (!kv) return json({ ok: false, error: 'KV unavailable' }, 503);
  let points = await loadAllStereoPoints(kv);
  if (!points || points.length === 0) {
    const legacy = await kv.get(KV_STEREO_KEY);
    if (!legacy) return json({ ok: false, error: 'No STEREO data yet — the worker uses tail-streaming so data appears after the first successful cron run.' });
    points = JSON.parse(legacy);
  }
  const lastFetch = await kv.get('STEREO_LAST_FETCH');
  const current = points[0] ?? null;
  const stereoElevated = current && ((current.sep_hi > 0.01) || (current.sep_lo > 0.1));
  return json({ ok: true, source: 'STEREO-A IMPACT (heliocentric orbit, ~10–15° ahead of Earth)', last_fetch: lastFetch ? new Date(Number(lastFetch)).toISOString() : null, count: points.length, current: current, particle_elevated: stereoElevated, orbital_context: 'STEREO-A is currently ~10–15° ahead of Earth on the Parker spiral. If particles are elevated here but not at L1, the CME may be glancing. If STEREO-A elevated before L1, the CME has already passed STEREO and is heading toward Earth.', data: points, caveats: ['STEREO-A is NOT at L1 — it sees solar wind from a different magnetic connection angle.', 'Elevated particles at STEREO-A do not guarantee Earth impact.', 'STEREO data latency varies with ground station coverage. Data gaps are normal.', 'Worker uses tail-streaming to avoid loading the full ~23MB NOAA file.'] });
}

async function handleCombined(env) {
  const kv = env.EPAM_KV;
  if (!kv) return json({ ok: false, error: 'KV unavailable' }, 503);

  // Default EPAM-like current reading = active HAPI ions (with the standard
  // fallback chain + first-run live fetch). Failure of the particle side must
  // not break GOES/STEREO, so it is isolated.
  let epamPoints = null;
  let epamMeta = null;
  try {
    const resolved = await resolveEpamPoints(env, null);
    epamPoints = resolved.points;
    epamMeta = resolved.meta;
  } catch (e) {
    console.warn('[combined] particle sources unavailable:', e?.message);
  }

  const [goesPoints, stereoPoints] = await Promise.all([loadAllGoesPoints(kv), loadAllStereoPoints(kv)]);
  const goesRaw   = (goesPoints   && goesPoints.length   > 0) ? goesPoints   : await kv.get(KV_GOES_KEY).then(r => r ? JSON.parse(r) : null).catch(() => null);
  const stereoRaw = (stereoPoints && stereoPoints.length > 0) ? stereoPoints : await kv.get(KV_STEREO_KEY).then(r => r ? JSON.parse(r) : null).catch(() => null);
  const epamCurrent   = epamPoints?.[0]  ?? null;
  const goesCurrent   = goesRaw?.[0]     ?? null;
  const stereoCurrent = stereoRaw?.[0]   ?? null;
  const epamLast24h = (epamPoints ?? []).filter(p => new Date(p.time_tag).getTime() > Date.now() - 86400000);
  const epamBaseline = {};
  for (const ch of PROTON_CHANNELS) {
    const vals = epamLast24h.map(p => p[ch.key]).filter(v => v !== null && v > 0);
    epamBaseline[ch.key] = vals.length > 0 ? median(vals) : null;
  }
  const epamElevated = epamCurrent && PROTON_CHANNELS.filter(ch => { const b = epamBaseline[ch.key]; return b && b > 0 && epamCurrent[ch.key] > b * 2; }).length >= 2;
  const goesS1Alert  = goesCurrent && (goesCurrent.ge10 ?? 0) >= 10;
  const goesS2Alert  = goesCurrent && (goesCurrent.ge10 ?? 0) >= 100;
  const stereoElevated = stereoCurrent && ((stereoCurrent.sep_hi ?? 0) > 0.01 || (stereoCurrent.sep_lo ?? 0) > 0.1);

  // ── NEW: per-source particle summaries (KV only; active reuses epamPoints) ──
  const particleSummaries = {};
  for (const key of Object.keys(HAPI_SOURCE_CONFIG)) {
    if (key === epamMeta?.source_key) {
      particleSummaries[key] = {
        dataset: HAPI_SOURCE_CONFIG[key].id,
        source_label: HAPI_SOURCE_CONFIG[key].sourceLabel,
        available: !!epamCurrent,
        elevated: !!epamElevated,
        current: epamCurrent,
        point_count: epamPoints?.length ?? 0,
        newest: epamCurrent?.time_tag ?? null,
      };
    } else {
      particleSummaries[key] = await summariseParticleSource(kv, key);
    }
  }
  const confirmingLabels = Object.entries(particleSummaries)
    .filter(([k, v]) => k !== (epamMeta?.source_key ?? 'active') && v.available && v.elevated === true)
    .map(([k]) => HAPI_SOURCE_CONFIG[k].sourceLabel);
  const particleConfirmed = epamElevated && confirmingLabels.length > 0;

  let confidence, confidenceLabel, summary;
  if (epamElevated && (goesS1Alert || particleConfirmed)) {
    confidence = 'HIGH'; confidenceLabel = '🔴 Confirmed — Multiple satellites agree';
    summary = particleConfirmed && !goesS1Alert
      ? `Multiple independent upstream particle sources (${confirmingLabels.join(', ')}) agree that energetic particles are elevated. This is a cross-confirmed signal — conditions may be developing for potential aurora.`
      : 'Both the L1 upstream particle data and the geostationary GOES satellite are detecting elevated particles. This is a confirmed solar particle event — conditions are likely developing for potential aurora.';
  }
  else if (epamElevated && !goesS1Alert) { confidence = 'MEDIUM'; confidenceLabel = '🟡 Possible — Lead satellite elevated, not yet confirmed'; summary = 'The L1 upstream particle data is elevated, but no second source has confirmed it yet. Check back in 30–60 minutes to see if conditions develop.'; }
  else if (!epamElevated && goesS1Alert) { confidence = 'MEDIUM'; confidenceLabel = '🟡 Mixed reading — satellites disagree'; summary = 'The GOES satellite is detecting elevated particles, but the L1 upstream sensors are quiet. This is sometimes a local effect near Earth rather than a storm on the way. Monitor for the next hour.'; }
  else if (stereoElevated) { confidence = 'LOW_WATCH'; confidenceLabel = '🔵 Watch — Solar activity detected, not yet Earth-directed'; summary = 'A satellite ahead of Earth on the Sun-facing side is detecting elevated particles, but our primary sensors are still quiet. It may not be heading our way, but it is worth monitoring the solar wind data over the next several hours.'; }
  else { confidence = 'QUIET'; confidenceLabel = '✅ All quiet — no activity detected'; summary = 'All satellite sensors are reading normal background levels. No solar storm activity.'; }

  return json({
    ok: true,
    timestamp: new Date().toISOString(),
    cross_validation: {
      confidence, confidenceLabel, summary,
      ace_epam_elevated: !!epamElevated,
      goes_s1_alert: !!goesS1Alert,
      goes_s2_alert: !!goesS2Alert,
      stereo_elevated: !!stereoElevated,
      // additive — cross-spacecraft particle confirmation
      particle_confirmed: !!particleConfirmed,
      particle_confirming_sources: confirmingLabels,
    },
    // legacy field kept — frontend may depend on `ace_epam` even though the
    // default underlying source is now the active HAPI ion dataset
    ace_epam: { current: epamCurrent, channels: PROTON_CHANNELS, point_count: epamPoints?.length ?? 0 },
    goes: { current: goesCurrent, channels: GOES_CHANNELS, point_count: goesRaw?.length ?? 0 },
    stereo_a: { current: stereoCurrent, point_count: stereoRaw?.length ?? 0 },
    // new clearer object — additive
    particles: {
      default_source: epamMeta?.source_key ?? 'active',
      data_source: epamMeta?.data_source ?? null,
      active: particleSummaries.active,
      solar1: particleSummaries.solar1,
      ace: particleSummaries.ace,
      imap: particleSummaries.imap,
    },
  });
}

async function handleHealth(env) {
  const kv = env.EPAM_KV;
  if (!kv) return json({ ok: false, error: 'KV not bound' }, 503);
  const now = Date.now();

  const hapiHealth = {};
  for (const [key, cfg] of Object.entries(HAPI_SOURCE_CONFIG)) {
    const [ts, idxRaw, statusRaw] = await Promise.all([
      kv.get(cfg.lastFetchKey),
      kv.get(cfg.indexKey),
      kv.get(cfg.statusKey),
    ]);
    let idx = null, status = null;
    try { idx = idxRaw ? JSON.parse(idxRaw) : null; } catch {}
    try { status = statusRaw ? JSON.parse(statusRaw) : null; } catch {}
    hapiHealth[key] = {
      dataset: cfg.id,
      last_fetch: ts ? new Date(Number(ts)).toISOString() : null,
      age_min: ts ? Math.round((now - Number(ts)) / 60000) : null,
      days_stored: idx?.keys?.length ?? 0,
      newest: idx?.newest_ts ?? null,
      ok: status ? !!status.ok : null,
      last_error: status?.error ?? null,
      optional: !!cfg.optional,
    };
  }

  const [goesTs, stereoTs, goesIdx, stereoIdx] = await Promise.all([
    kv.get('GOES_LAST_FETCH'),
    kv.get('STEREO_LAST_FETCH'),
    kv.get(KV_GOES_INDEX_KEY).then(r => r ? JSON.parse(r) : null).catch(() => null),
    kv.get(KV_STEREO_INDEX_KEY).then(r => r ? JSON.parse(r) : null).catch(() => null),
  ]);

  // ace_epam (legacy) mirrors the active source — they share the same KV keys.
  const epamTs = await kv.get('EPAM_LAST_FETCH');
  const epamIdx = await kv.get(KV_INDEX_KEY).then(r => r ? JSON.parse(r) : null).catch(() => null);

  return json({
    ok: !!epamTs && (now - Number(epamTs)) < 15 * 60 * 1000,
    sources: {
      // legacy entries — unchanged shape
      ace_epam: {
        last_fetch: epamTs ? new Date(Number(epamTs)).toISOString() : null,
        age_min: epamTs ? Math.round((now - Number(epamTs)) / 60000) : null,
        days_stored: epamIdx?.keys?.length ?? 0,
        newest: epamIdx?.newest_ts ?? null,
        note: 'Legacy entry — now backed by the active HAPI ion dataset (same storage keys).',
      },
      goes_seiss: {
        last_fetch: goesTs ? new Date(Number(goesTs)).toISOString() : null,
        age_min: goesTs ? Math.round((now - Number(goesTs)) / 60000) : null,
        days_stored: goesIdx?.keys?.length ?? 0,
        newest: goesIdx?.newest_ts ?? null,
      },
      stereo_a: {
        last_fetch: stereoTs ? new Date(Number(stereoTs)).toISOString() : null,
        age_min: stereoTs ? Math.round((now - Number(stereoTs)) / 60000) : null,
        days_stored: stereoIdx?.keys?.length ?? 0,
        newest: stereoIdx?.newest_ts ?? null,
      },
      // new HAPI entries — additive
      active_ions: hapiHealth.active,
      solar1_ions: hapiHealth.solar1,
      ace_ions: hapiHealth.ace,
      imap_ions: hapiHealth.imap,
    },
  });
}

// ─── Optional debug endpoints (additive) ─────────────────────────────────────
async function handleDebugCatalog() {
  try {
    const res = await fetch(`${HAPI_BASE}/catalog`, { cf: { cacheTtl: 300 } });
    if (!res.ok) return json({ ok: false, error: `HAPI catalog HTTP ${res.status}` });
    return json({ ok: true, catalog: await res.json() });
  } catch (e) {
    return json({ ok: false, error: e?.message ?? String(e) });
  }
}

async function handleDebugInfo(url) {
  const key = validSourceParam(url) ?? 'active';
  const cfg = HAPI_SOURCE_CONFIG[key];
  if (!cfg) return json({ ok: false, error: `Unknown source '${key}'`, available_sources: Object.keys(HAPI_SOURCE_CONFIG) });
  try {
    const res = await fetch(`${HAPI_BASE}/info?id=${encodeURIComponent(cfg.id)}`, { cf: { cacheTtl: 300 } });
    if (!res.ok) return json({ ok: false, error: `HAPI info HTTP ${res.status}`, dataset: cfg.id });
    return json({ ok: true, dataset: cfg.id, info: await res.json() });
  } catch (e) {
    return json({ ok: false, error: e?.message ?? String(e), dataset: cfg.id });
  }
}

// ─── Core CME analysis engine (UNCHANGED — works on normalised points that
//     expose p1, p3, p5, p7, p8, e1, e2 regardless of underlying source) ─────
//
// [A] VELOCITY DISPERSION — strict onset (4× baseline), 6h lookback,
//     dispersionScore ≥3/4 adjacent pairs, channel must still be elevated now.
// [B] CHANNEL COMPRESSION — ≥0.5 log-unit monotonic spread decrease across the
//     4h window, ≥4 channels >2.5× baseline; mean log-spread across all
//     adjacent channel pairs so one outlier channel can't dominate.
// [C] SUSTAINED RISE — >60% of the 4h window with ≥3 channels >2× baseline,
//     plus ≥4 channels with positive 4h log-slope.
// [D] STATUS THRESHOLDS — CME_WATCH requires compression + dispersion +
//     sustained rise simultaneously.

function analyseEPAM(points) {
  const now     = points[0];
  const last24h = points.filter(p => new Date(p.time_tag).getTime() > Date.now() - 86400000);
  const last4h  = points.filter(p => new Date(p.time_tag).getTime() > Date.now() - 4 * 3600000);
  const last6h  = points.filter(p => new Date(p.time_tag).getTime() > Date.now() - 6 * 3600000);

  // ── 24h median baseline ─────────────────────────────────────────────────────
  const baseline = {};
  for (const ch of PROTON_CHANNELS) {
    const vals = last24h.map(p => p[ch.key]).filter(v => v !== null && v > 0);
    baseline[ch.key] = vals.length > 0 ? median(vals) : null;
  }

  // ── Per-channel elevation ratio vs baseline ─────────────────────────────────
  const elevation = {};
  for (const ch of PROTON_CHANNELS) {
    const b = baseline[ch.key];
    elevation[ch.key] = b && b > 0 && now[ch.key] !== null ? (now[ch.key] / b) : null;
  }

  // [C] SUSTAINED RISE ─────────────────────────────────────────────────────────
  const sustainedRisePoints = last4h.filter(pt => {
    const count = PROTON_CHANNELS.filter(ch => {
      const b = baseline[ch.key];
      return b && b > 0 && pt[ch.key] !== null && pt[ch.key] > b * 2;
    }).length;
    return count >= 3;
  });
  const sustainedRiseFraction = last4h.length > 0
    ? sustainedRisePoints.length / last4h.length
    : 0;
  const sustainedRiseDetected = sustainedRiseFraction > 0.60 && last4h.length >= 24;

  const risingChannelCount = PROTON_CHANNELS.filter(ch => {
    const pts4h = last4h
      .map(p => ({ t: new Date(p.time_tag).getTime(), v: p[ch.key] }))
      .filter(x => x.v !== null && x.v > 0);
    if (pts4h.length < 8) return false;
    const slope = linRegSlope(pts4h.map(x => x.t), pts4h.map(x => Math.log10(x.v)));
    return slope > 0;
  }).length;
  const broadRisingTrend = risingChannelCount >= 4;

  // [A] VELOCITY DISPERSION ───────────────────────────────────────────────────
  const onsetTimes = {};
  for (const ch of PROTON_CHANNELS) {
    const b = baseline[ch.key];
    if (!b) continue;
    const chronological = [...last6h].reverse();
    const onset = chronological.find(p => p[ch.key] !== null && p[ch.key] > b * 4);
    onsetTimes[ch.key] = onset ? new Date(onset.time_tag).getTime() : null;
  }

  let dispersionScore = 0;
  const channelKeys = PROTON_CHANNELS.map(c => c.key);
  for (let i = 0; i < channelKeys.length - 1; i++) {
    const lower  = onsetTimes[channelKeys[i]] ?? null;
    const higher = onsetTimes[channelKeys[i + 1]] ?? null;
    if (lower !== null && higher !== null && higher < lower) dispersionScore++;
  }

  const currentlyElevatedChannels = PROTON_CHANNELS.filter(ch => {
    const b = baseline[ch.key];
    return b && b > 0 && now[ch.key] !== null && now[ch.key] > b * 3;
  }).length;

  const velocityDispersionDetected =
    dispersionScore >= 3 &&
    currentlyElevatedChannels >= 2 &&
    (sustainedRiseDetected || broadRisingTrend);

  // [B] CHANNEL COMPRESSION ────────────────────────────────────────────────────
  function meanLogSpread(pt) {
    const logVals = PROTON_CHANNELS
      .map(ch => pt[ch.key])
      .map(v => (v !== null && v > 0 ? Math.log10(v) : null));
    const validPairs = [];
    for (let i = 0; i < logVals.length - 1; i++) {
      if (logVals[i] !== null && logVals[i + 1] !== null) {
        validPairs.push(logVals[i] - logVals[i + 1]);
      }
    }
    if (validPairs.length === 0) return null;
    return validPairs.reduce((a, b) => a + b, 0) / validPairs.length;
  }

  const spreads4h = last4h
    .map(p => ({ t: new Date(p.time_tag).getTime(), spread: meanLogSpread(p) }))
    .filter(x => x.spread !== null);

  let compressionDetected = false;
  let compressionTrend = null;

  if (spreads4h.length >= 16) {
    const slope = linRegSlope(spreads4h.map(x => x.t), spreads4h.map(x => x.spread));
    compressionTrend = slope;

    const midpoint = Math.floor(spreads4h.length / 2);
    const earlyHalfMean = mean(spreads4h.slice(midpoint).map(x => x.spread));
    const lateHalfMean  = mean(spreads4h.slice(0, midpoint).map(x => x.spread));
    const spreadDecreasing = earlyHalfMean - lateHalfMean > 0.5;

    const channelsStronglyElevated = Object.values(elevation)
      .filter(e => e !== null && e > 2.5).length >= 4;

    compressionDetected = spreadDecreasing && channelsStronglyElevated;
  }

  // ── Shock detection — sustained step-change, not a single spike ─────────────
  const last15min  = points.filter(p => new Date(p.time_tag).getTime() > Date.now() - 15 * 60000);
  const base30_60  = points.filter(p => {
    const age = Date.now() - new Date(p.time_tag).getTime();
    return age >= 30 * 60000 && age <= 60 * 60000;
  });

  const rateOfChange = {};
  let sustainedSpikeChannels = 0;

  if (last15min.length >= 2 && base30_60.length >= 4) {
    for (const ch of PROTON_CHANNELS) {
      const recentVals  = last15min.map(p => p[ch.key]).filter(v => v !== null && v > 0);
      const baselineVals = base30_60.map(p => p[ch.key]).filter(v => v !== null && v > 0);
      if (recentVals.length < 1 || baselineVals.length < 2) continue;

      const recentMed   = median(recentVals);
      const baselineMed = median(baselineVals);
      if (baselineMed <= 0) continue;

      const ratio = recentMed / baselineMed;
      rateOfChange[ch.key] = ratio;

      const last3 = last15min.slice(0, 3).map(p => p[ch.key]).filter(v => v !== null && v > 0);
      const sustainedCount = last3.filter(v => v > baselineMed * 3).length;
      if (ratio > 5 && sustainedCount >= 2) sustainedSpikeChannels++;
    }
  }

  const sharpSpikeDetected = sustainedSpikeChannels >= 4;

  // ── Anisotropy (null for HAPI ion datasets — gate simply won't fire) ────────
  const anisotropy = now.anisotropy_index ?? null;
  const anisotropyElevated = anisotropy !== null && anisotropy > 1.0;

  const elevatedChannels     = Object.values(elevation).filter(e => e !== null && e > 2.5).length;
  const anyElevation         = Object.values(elevation).some(e => e !== null && e > 1.5);

  // [D] STATUS DETERMINATION ───────────────────────────────────────────────────
  let status, statusLabel, description;

  if (sharpSpikeDetected && elevatedChannels >= 4) {
    status = 'SHOCK_PASSAGE'; statusLabel = '💥 Solar Storm Hitting Now — Aurora Likely';
    description = 'A fast-moving shockwave from the Sun just hit the L1 monitoring satellites. It will reach Earth in roughly 45–60 minutes. If the solar wind turns southward on arrival, aurora could be visible tonight — keep a close eye on the Bz reading and get ready to head out.';

  } else if (compressionDetected && velocityDispersionDetected && sustainedRiseDetected) {
    status = 'CME_WATCH'; statusLabel = '🚨 Solar Storm on the Way — Watch Tonight';
    description = 'The particle sensors are showing the classic build-up pattern that happens in the hours before a solar storm arrives — particles rising steadily across all energy levels. This is a credible early warning. Keep watching the Bz reading on the solar wind gauges. If it turns strongly southward when the storm arrives, aurora could be on the cards.';

  } else if (compressionDetected && sustainedRiseDetected) {
    status = 'COMPRESSION'; statusLabel = '⚠️ Storm Building — Aurora Possible in Coming Hours';
    description = 'Particle energy readings are converging and rising steadily — an early sign that a solar disturbance may be approaching. This alone does not mean aurora is guaranteed, but it is worth keeping the forecast open and watching the solar wind data over the next 12–24 hours.';

  } else if (velocityDispersionDetected && sustainedRiseDetected && elevatedChannels >= 3) {
    status = 'DISPERSION'; statusLabel = '⚠️ Early Activity Signal — Worth Watching';
    description = 'Fast-moving particles from a distant solar event are arriving ahead of slower ones — a pattern that can show up hours before a storm, but can also fade without developing further. It is an early and uncertain signal. Check back in a few hours and watch the solar wind data for any change.';

  } else if (anisotropyElevated && anyElevation) {
    status = 'SEP_STREAMING'; statusLabel = '📡 Particles Arriving from the Sun';
    description = `A directed stream of energetic particles is arriving from the Sun. This is associated with solar activity but does not directly mean aurora tonight — the key factor is whether the solar wind turns southward (negative Bz) when any storm arrives at Earth.`;

  } else if (elevatedChannels >= 3) {
    status = 'ELEVATED'; statusLabel = '📈 Particle Levels Above Normal';
    description = `Particle levels are running above their normal background across multiple sensors — but no clear storm pattern has developed yet. Worth keeping an eye on, but nothing to act on right now.`;

  } else if (anyElevation) {
    status = 'SLIGHT_ELEVATION'; statusLabel = '📊 Background Variation — Nothing to Act On';
    description = 'Particle levels are slightly above normal but well within everyday variability. No action needed.';

  } else {
    status = 'QUIET'; statusLabel = '✅ All Quiet';
    description = 'Particle sensors are reading normal background levels. No solar storm activity detected.';
  }

  return {
    status, statusLabel, description,
    timestamp: now.time_tag,
    signatures: {
      velocity_dispersion:  velocityDispersionDetected,
      channel_compression:  compressionDetected,
      sharp_spike:          sharpSpikeDetected,
      anisotropy_elevated:  anisotropyElevated,
      elevated_channels:    elevatedChannels,
      sustained_rise:       sustainedRiseDetected,
      broad_rising_trend:   broadRisingTrend,
      dispersion_score:     dispersionScore,
    },
    metrics: {
      current_flux:          Object.fromEntries(PROTON_CHANNELS.map(c => [c.key, now[c.key] ?? null])),
      elevation_vs_baseline: elevation,
      baseline_24h:          baseline,
      anisotropy_index:      anisotropy,
      log_spread_4h_trend:   compressionTrend,
      sustained_rise_fraction: sustainedRiseFraction,
      rising_channel_count:  risingChannelCount,
    },
    channels: PROTON_CHANNELS,
    caveats: [
      'Rising particle levels are a heads-up, not a guarantee — aurora depends on the solar wind direction (Bz) when the storm actually arrives at Earth.',
      'The L1 satellites sit ~45–60 minutes upstream of Earth, so any storm detected here is roughly an hour away.',
    ],
  };
}

// ─── Normalisation (legacy NOAA JSON + STEREO — unchanged) ───────────────────
function normaliseEpam(raw) {
  if (!raw?.time_tag) return null;
  const get = (...keys) => { for (const k of keys) { const v = raw[k]; if (v !== undefined && v !== null && v > -9e4) return Number(v); } return null; };
  return { time_tag: raw.time_tag, p1: get('p1','P1'), p3: get('p3','P3'), p5: get('p5','P5'), p7: get('p7','P7'), p8: get('p8','P8','p7','P7'), e1: get('e1','E1'), e2: get('e2','E2'), anisotropy_index: get('anisotropy_index','anisotropy','Anis'), status: raw.status ?? 0, data_source: 'noaa_ace_epam_5m_json', source_label: 'ACE', spacecraft: 'ACE', hapi_dataset: null };
}

function normaliseStereo(raw) {
  const timeTag = raw?.timestamp || raw?.time_tag;
  if (!timeTag) return null;
  const get = (...keys) => { for (const k of keys) { const v = raw[k]; if (v !== undefined && v !== null && Number(v) > -9e4) return Number(v); } return null; };
  return { time_tag: timeTag, speed: get('speed_KPS','speed'), density: get('density_cm3','density'), temperature: get('temp_K','temperature'), bt: get('Bt_nT','bt'), bz: get('mag_hgrtn_n_nT','bz'), sep_lo: get('low_energy_protons_75-137_keV','low_energy_protons_137-623_keV'), sep_hi: get('low_energy_protons_623-2224_keV','high_energy_protons_13-21_MeV'), sep_very_hi: get('high_energy_protons_13-21_MeV','high_energy_protons_40-100_MeV'), electrons_lo: get('low_energy_electrons_35-65_keV'), electrons_hi: get('low_energy_electrons_125-255_keV') };
}

// ─── Storage helpers (legacy — unchanged) ────────────────────────────────────
async function loadFromDayBuckets(kv, indexKey) {
  if (!kv) return null;
  const indexRaw = await kv.get(indexKey);
  if (!indexRaw) return [];
  const index = JSON.parse(indexRaw);
  if (!index.keys?.length) return [];
  const all = [];
  await Promise.all(index.keys.map(async key => { try { const r = await kv.get(key); if (r) all.push(...JSON.parse(r)); } catch {} }));
  all.sort((a, b) => new Date(b.time_tag).getTime() - new Date(a.time_tag).getTime());
  return all;
}

// loadAllEpamPoints keeps its name and keeps reading the legacy epam_index —
// which is now where the default ACTIVE HAPI source stores its data, so all
// existing callers keep working unchanged.
async function loadAllEpamPoints(kv)   { return loadFromDayBuckets(kv, KV_INDEX_KEY); }
async function loadAllGoesPoints(kv)   { return loadFromDayBuckets(kv, KV_GOES_INDEX_KEY); }
async function loadAllStereoPoints(kv) { return loadFromDayBuckets(kv, KV_STEREO_INDEX_KEY); }

function aggregateByPeriod(points, periodMinutes) {
  const periodMs = periodMinutes * 60 * 1000;
  const buckets = {};
  for (const pt of points) { const t = new Date(pt.time_tag).getTime(); const bucket = Math.floor(t / periodMs) * periodMs; if (!buckets[bucket]) buckets[bucket] = []; buckets[bucket].push(pt); }
  return Object.entries(buckets).map(([ts, pts]) => {
    const r = { time_tag: new Date(Number(ts)).toISOString(), count: pts.length };
    for (const ch of [...PROTON_CHANNELS, ...ELECTRON_CHANNELS]) { const vals = pts.map(p => p[ch.key]).filter(v => v !== null && v > 0); r[ch.key] = vals.length > 0 ? mean(vals) : null; r[`${ch.key}_min`] = vals.length > 0 ? Math.min(...vals) : null; r[`${ch.key}_max`] = vals.length > 0 ? Math.max(...vals) : null; }
    const anis = pts.map(p => p.anisotropy_index).filter(v => v !== null && v !== undefined && v >= 0);
    r.anisotropy_index = anis.length > 0 ? mean(anis) : null;
    return r;
  }).sort((a, b) => new Date(b.time_tag).getTime() - new Date(a.time_tag).getTime());
}

function dedupByTag(pts) {
  const seen = new Set();
  return pts.filter(p => { if (seen.has(p.time_tag)) return false; seen.add(p.time_tag); return true; })
            .sort((a, b) => new Date(b.time_tag).getTime() - new Date(a.time_tag).getTime());
}

function mean(arr)   { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function median(arr) { const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 === 0 ? (s[m-1] + s[m]) / 2 : s[m]; }
function linRegSlope(xs, ys) {
  const n = xs.length; if (n < 2) return 0;
  const mx = mean(xs), my = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i]-mx)*(ys[i]-my); den += (xs[i]-mx)**2; }
  return den === 0 ? 0 : num / den;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
function cors() {
  return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' } });
}
