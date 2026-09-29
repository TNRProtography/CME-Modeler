const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
// Frames are kept for a week: the CME orientation analysis goes back through
// several hours of every coronagraph around each CME in the 7-day list, and
// the viewer's full history reaches back as far. What /api/state summarises
// stays at a day, so what every client downloads on load does not grow.
const RETENTION_MS = 7 * TWENTY_FOUR_HOURS_MS;
const STATE_WINDOW_MS = TWENTY_FOUR_HOURS_MS;
// New frames one scheduled run may fetch per listing source. Keeps a run well
// inside the subrequest limit; anything left is picked up by the next run.
const MAX_NEW_FRAMES_PER_RUN = 12;
const FETCH_TIMEOUT_MS = 30000;

// Standard browser User-Agent. NOAA/SWPC (and possibly other space-weather
// image hosts) return HTTP 403 to requests without a recognizable
// User-Agent, which is what Cloudflare Workers send by default. Sending
// this resolves the 403s. Applied to every remote fetch in this worker
// since they all go through fetchWithTimeout.
const REMOTE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const WATERMARK_BASE64 = "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";

const SOURCES = {
  soho_c2: {
    key: "soho_c2",
    label: "SOHO LASCO C2",
    latestUrl: "https://soho.nascom.nasa.gov/data/realtime/c2/512/latest.jpg",
  },
  soho_c3: {
    key: "soho_c3",
    label: "SOHO LASCO C3",
    latestUrl: "https://soho.nascom.nasa.gov/data/realtime/c3/512/latest.jpg",
  },
  stereo_cor2: {
    key: "stereo_cor2",
    label: "STEREO-A COR2",
    latestUrl: "https://stereo-ssc.nascom.nasa.gov/beacon/latest/ahead_cor2_latest.jpg",
  },
  ccor1: {
    key: "ccor1",
    label: "GOES-19 CCOR-1",
    listingUrl: "https://services.swpc.noaa.gov/products/ccor1/jpegs/",
    baseUrl: "https://services.swpc.noaa.gov/products/ccor1/jpegs/",
    namePattern: /href="(\d{8}_\d{4}_ccor1_1024by960\.jpg)"/g,
  },
  // SWFO-L1's coronagraph, from L1. Same file naming as CCOR-1, different
  // directory.
  ccor2: {
    key: "ccor2",
    label: "SWFO-L1 CCOR-2",
    listingUrl: "https://services.swpc.noaa.gov/images/animations/ccor2/",
    baseUrl: "https://services.swpc.noaa.gov/images/animations/ccor2/",
    namePattern: /href="(\d{8}_\d{4}_ccor2_1024by960\.jpg)"/g,
  },
};

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      if (url.pathname === "/watermark-logo") {
        return new Response(
          Uint8Array.from(atob(WATERMARK_BASE64), c => c.charCodeAt(0)),
          {
            headers: {
              "content-type": "image/png",
              "cache-control": "public, max-age=31536000",
            },
          }
        );
      }

      if (url.pathname === "/") {
        return html(renderAppHtml());
      }

      if (url.pathname === "/health") {
        return json({
          ok: true,
          now: new Date().toISOString(),
          bucket_binding: "CORONA_BUCKET",
          bucket_actual_name: "corona-bucket",
        });
      }

      // FIX 2: /api/state is now summary-only — reads one latest.json per source.
      // Full frame history is loaded lazily via /api/frames per source.
      if (url.pathname === "/api/state") {
        // A snapshot written before a source was added does not list it, and
        // serving it would hide that source until the next refresh. Rebuild
        // (and re-save) whenever the snapshot is missing any source.
        const cached = await readStateCache(env);
        const complete = cached && Object.keys(SOURCES).every(k => cached.sources?.[k]);
        let stateData = complete ? cached : null;
        if (!stateData) {
          stateData = await buildState(env);
          try { await env.CORONA_BUCKET.put("meta/state_cache.json", JSON.stringify(stateData), { httpMetadata: { contentType: "application/json" } }); } catch (_) {}
        }
        return jsonCacheable(stateData, 30);
      }

      if (url.pathname === "/api/frames") {
        const source = url.searchParams.get("source");
        if (!source || !SOURCES[source]) {
          return json({ ok: false, error: "Invalid source" }, 400);
        }
        const frames = await listRecent(env, `raw/${source}/`, RETENTION_MS);
        return json({ ok: true, source, frames });
      }

      if (url.pathname === "/api/image") {
        const key = url.searchParams.get("key");
        if (!key) return new Response("Missing key", { status: 400 });

        const obj = await env.CORONA_BUCKET.get(key);
        if (!obj) return new Response("Not found", { status: 404 });

        return new Response(obj.body, {
          headers: {
            "content-type": obj.httpMetadata?.contentType || "image/jpeg",
            "cache-control": "public, max-age=86400, immutable",
            "access-control-allow-origin": "*",
          },
        });
      }

      if (url.pathname === "/api/refresh" && request.method === "POST") {
        return json(await refreshAll(env, { backfill: false }));
      }

      if (url.pathname === "/api/backfill" && request.method === "POST") {
        return json(await refreshAll(env, { backfill: true }));
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      return json(
        { ok: false, error: err?.message || String(err), stack: err?.stack || null },
        500
      );
    }
  },

  async scheduled(event, env, ctx) {
    // FIX 3: pruneOld runs in the background — it never blocks the scheduled
    // ingestion and never eats into the 30s wall-clock limit.
    ctx.waitUntil(
      refreshAll(env, { backfill: false })
        .then(() => pruneOld(env))
    );
  },
};

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

async function refreshAll(env, { backfill }) {
  const started = Date.now();
  const results = {};

  for (const source of Object.values(SOURCES)) {
    try {
      if (backfill) {
        if (source.listingUrl) {
          results[source.key] = await backfillFromListing(env, source);
        } else if (source.key === "stereo_cor2") {
          results[source.key] = await backfillStereoCor2(env, source);
        } else {
          results[source.key] = await ingestLatestForSource(env, source);
        }
      } else if (source.listingUrl) {
        // Every run fills whatever is missing from the listing, newest first,
        // so a run that is skipped or late leaves no gap in the week.
        results[source.key] = await backfillFromListing(env, source, { maxNew: MAX_NEW_FRAMES_PER_RUN });
      } else if (source.key === "stereo_cor2") {
        // The same for STEREO-A, from its daily browse folders. The latest
        // image is still taken if the folders have nothing recent yet.
        const filled = await backfillStereoCor2(env, source, { maxNew: MAX_NEW_FRAMES_PER_RUN });
        results[source.key] = filled.recent
          ? filled
          : { ...filled, latest: await ingestLatestForSource(env, source) };
      } else {
        results[source.key] = await ingestLatestForSource(env, source);
      }
    } catch (err) {
      results[source.key] = { ok: false, error: err?.message || String(err) };
    }
  }

  // NOTE: pruneOld is NOT called here anymore.
  // In the scheduled handler it runs via ctx.waitUntil() after this returns.
  // For manual /api/refresh it's intentionally omitted to keep the response fast.

  // Write state cache so the next /api/state call is instant
  try { await writeStateCache(env); } catch (_) {}

  return {
    ok: true,
    started_utc: new Date(started).toISOString(),
    finished_utc: new Date().toISOString(),
    duration_ms: Date.now() - started,
    results,
  };
}

async function ingestLatestForSource(env, source) {
  if (source.listingUrl) {
    const latest = await getLatestFromListing(source);
    if (!latest) return { ok: false, reason: `No ${source.label} images found` };
    return ingestRemoteFrame(env, source.key, latest.url, latest.ts, latest.name);
  }

  const res = await fetchWithTimeout(source.latestUrl);
  if (!res.ok) throw new Error(`Failed fetch for ${source.key}: ${res.status}`);

  const bytes = await res.arrayBuffer();
  const hash = await sha256Hex(bytes);

  const latestMeta = await getLatestSourceMeta(env, source.key);
  if (latestMeta?.hash && latestMeta.hash === hash) {
    return { ok: true, skipped: true, reason: "duplicate_content_latest", source: source.key };
  }

  const headerTs = parseHttpDateToIso(res.headers.get("last-modified"));
  const ts = headerTs || new Date().toISOString();

  if (latestMeta?.ts && ts && Date.parse(ts) <= Date.parse(latestMeta.ts)) {
    return { ok: true, skipped: true, reason: "stale_timestamp_latest", source: source.key, ts };
  }

  return ingestFrameBytes(env, source.key, ts, bytes, "latest.jpg", hash);
}

// CCOR-1 and CCOR-2: a NOAA directory listing of timestamped frames.
//
// What is already stored is read with one bucket listing, and only frames not
// in it are fetched. The old path went through ingestRemoteFrame, which skips
// anything older than the newest frame stored - so once one refresh had taken
// the latest frame, a backfill could add nothing, and a run that was missed
// left a hole for good.
async function backfillFromListing(env, source, { maxNew = Infinity } = {}) {
  const htmlText = await fetchText(source.listingUrl);
  const cutoff = Date.now() - RETENTION_MS;

  const items = listingNames(source, htmlText)
    .map(name => ({ name, ts: parseListingNameToIso(name) }))
    .map(x => ({ ...x, ms: x.ts ? Date.parse(x.ts) : NaN }))
    .filter(x => x.ts && x.ms >= cutoff)
    .sort((a, b) => b.ms - a.ms);            // newest first

  const have = new Set();
  let cursor;
  do {
    const page = await env.CORONA_BUCKET.list({ prefix: `raw/${source.key}/`, cursor, limit: 1000 });
    for (const o of page.objects) have.add(o.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  let stored = 0, skipped = 0, failed = 0, missing = 0;
  for (const item of items) {
    const key = `raw/${source.key}/${isoToCompact(item.ts)}.jpg`;
    if (have.has(key)) { skipped++; continue; }
    missing++;
    if (stored >= maxNew) continue;
    try {
      const res = await fetchWithTimeout(source.baseUrl + item.name);
      if (!res.ok) { failed++; continue; }
      const bytes = await res.arrayBuffer();
      const out = await ingestFrameBytes(env, source.key, item.ts, bytes, item.name, await sha256Hex(bytes));
      if (out.stored) stored++;
    } catch (_) {
      failed++;
    }
  }

  return { ok: true, listed: items.length, stored, skipped, failed, stillMissing: missing - stored };
}

// STEREO-A COR2 from its daily browse folders, a week back.
//
// Fetches only what is not stored yet, newest first, and stores it directly:
// the old path went through ingestRemoteFrame, which skips anything older than
// the newest frame stored, so a backfill behind the latest image added nothing.
async function backfillStereoCor2(env, source, { maxNew = Infinity } = {}) {
  const now = new Date();
  const days = uniqueUtcDateStringsForLastHours(now, RETENTION_MS / 3600000 + 1);
  const cutoff = Date.now() - RETENTION_MS;
  const candidates = new Map();

  for (const day of days) {
    const [yyyy, mm, dd] = day.split("-");
    const dirUrl = `https://stereo-ssc.nascom.nasa.gov/browse/${yyyy}/${mm}/${dd}/ahead/cor2/512/`;
    try {
      const htmlText = await fetchText(dirUrl);
      const names = [...htmlText.matchAll(/(\d{8}_\d{6}_n\d+c2A\.jpg)/g)].map(m => m[1]);
      for (const name of names) {
        const ts = parseStereoNameToIso(name);
        const ms = ts ? Date.parse(ts) : NaN;
        if (ts && ms >= cutoff) candidates.set(name, { name, ts, ms, url: dirUrl + name });
      }
    } catch (_) {}
  }

  const have = new Set();
  let cursor;
  do {
    const page = await env.CORONA_BUCKET.list({ prefix: `raw/${source.key}/`, cursor, limit: 1000 });
    for (const o of page.objects) have.add(o.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  const items = [...candidates.values()].sort((a, b) => b.ms - a.ms);   // newest first
  // Whether the folders hold anything from the last two hours; if not, the
  // caller also takes the latest image so the viewer does not go stale.
  const recent = items.some(x => Date.now() - x.ms < 2 * 3600000);

  let stored = 0, skipped = 0, failed = 0, missing = 0;
  for (const item of items) {
    const key = `raw/${source.key}/${isoToCompact(item.ts)}.jpg`;
    if (have.has(key)) { skipped++; continue; }
    missing++;
    if (stored >= maxNew) continue;
    try {
      const res = await fetchWithTimeout(item.url);
      if (!res.ok) { failed++; continue; }
      const bytes = await res.arrayBuffer();
      const out = await ingestFrameBytes(env, source.key, item.ts, bytes, item.name, await sha256Hex(bytes));
      if (out.stored) stored++;
    } catch (_) {
      failed++;
    }
  }

  return { ok: true, listed: items.length, stored, skipped, failed, stillMissing: missing - stored, recent };
}

async function ingestRemoteFrame(env, sourceKey, remoteUrl, tsIso, remoteName) {
  const res = await fetchWithTimeout(remoteUrl);
  if (!res.ok) throw new Error(`Failed to fetch ${remoteUrl}: ${res.status}`);

  const bytes = await res.arrayBuffer();
  const hash = await sha256Hex(bytes);
  const latestMeta = await getLatestSourceMeta(env, sourceKey);

  if (latestMeta?.hash && latestMeta.hash === hash) {
    return { ok: true, skipped: true, reason: "duplicate_content", source: sourceKey, ts: tsIso || null };
  }

  const headerTs = parseHttpDateToIso(res.headers.get("last-modified"));
  const effectiveTs = tsIso || headerTs || new Date().toISOString();

  if (latestMeta?.ts && effectiveTs && Date.parse(effectiveTs) <= Date.parse(latestMeta.ts)) {
    return { ok: true, skipped: true, reason: "stale_timestamp", source: sourceKey, ts: effectiveTs };
  }

  return ingestFrameBytes(env, sourceKey, effectiveTs, bytes, remoteName, hash);
}

async function ingestFrameBytes(env, sourceKey, tsIso, bytes, remoteName, hash) {
  const compact = isoToCompact(tsIso);
  const rawKey = `raw/${sourceKey}/${compact}.jpg`;
  const fetchedAt = new Date().toISOString();

  const exists = await env.CORONA_BUCKET.head(rawKey);
  if (exists) return { ok: true, skipped: true, key: rawKey, reason: "already_exists" };

  await env.CORONA_BUCKET.put(rawKey, bytes, {
    httpMetadata: { contentType: "image/jpeg" },
    customMetadata: {
      source: sourceKey,
      ts: tsIso,
      fetched_at: fetchedAt,
      remoteName: remoteName || "",
      type: "raw",
      hash: hash || "",
    },
  });

  // Filling in an older frame must not make it the latest.
  const currentLatest = await getLatestSourceMeta(env, sourceKey);
  if (currentLatest?.ts && Date.parse(currentLatest.ts) >= Date.parse(tsIso)) {
    return { ok: true, stored: true, key: rawKey, ts: tsIso, fetched_at: fetchedAt, hash };
  }

  await env.CORONA_BUCKET.put(
    `meta/${sourceKey}/latest.json`,
    JSON.stringify({
      source: sourceKey,
      ts: tsIso,
      fetched_at: fetchedAt,
      key: rawKey,
      hash: hash || "",
      remoteName: remoteName || "",
      stored_at: fetchedAt,
    }),
    { httpMetadata: { contentType: "application/json" } }
  );

  return { ok: true, stored: true, key: rawKey, ts: tsIso, fetched_at: fetchedAt, hash };
}

async function getLatestSourceMeta(env, sourceKey) {
  const obj = await env.CORONA_BUCKET.get(`meta/${sourceKey}/latest.json`);
  if (!obj) return null;
  try { return await obj.json(); } catch { return null; }
}

// FIX 2: Summary-only state — reads one latest.json per source (one read each).
// Full frames are loaded on-demand via /api/frames.
// Returns all frames in /api/state. Safe now because listRecent uses
// include:["customMetadata"] — one paginated list call, no per-object head() requests.
// All sources fetched in parallel via Promise.all for extra speed.
async function buildState(env) {
  const out = {
    ok: true,
    updated_utc: new Date().toISOString(),
    sources: {},
  };

  await Promise.all(
    Object.values(SOURCES).map(async (source) => {
      const [frames, latestMeta] = await Promise.all([
        listRecent(env, `raw/${source.key}/`, STATE_WINDOW_MS),
        getLatestSourceMeta(env, source.key),
      ]);

      const latest = frames.length ? frames[frames.length - 1] : null;

      out.sources[source.key] = {
        label: source.label,
        frames,
        latest,
        latest_meta: latestMeta || null,
        scrubber_api: `/api/frames?source=${source.key}`,
      };
    })
  );

  return out;
}

// FIX 1: Use R2's include:['customMetadata'] so we get metadata inline from the
// list call instead of issuing a separate head() request per object.
// Before: O(N) head() calls = 10-20s for 200 frames.
// After:  1 list call (paginated) = <100ms.
async function listRecent(env, prefix, windowMs = STATE_WINDOW_MS) {
  let cursor;
  const all = [];

  do {
    const page = await env.CORONA_BUCKET.list({
      prefix,
      cursor,
      limit: 1000,
      include: ["customMetadata"], // <-- eliminates the N head() calls
    });
    all.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  const cutoff = Date.now() - windowMs;
  const out = [];

  for (const o of all) {
    const ts = compactKeyToIso(o.key);
    if (!ts || Date.parse(ts) < cutoff) continue;

    // customMetadata is now available inline — no extra round-trip needed
    const meta = o.customMetadata || {};

    out.push({
      key: o.key,
      ts,
      fetched_at: meta.fetched_at || o.uploaded?.toISOString?.() || null,
      source: meta.source || sourceKeyFromRawKey(o.key),
      remoteName: meta.remoteName || null,
      hash: meta.hash || null,
      uploaded: o.uploaded?.toISOString?.() || null,
      url: `/api/image?key=${encodeURIComponent(o.key)}`,
    });
  }

  out.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  return out;
}

// State cache helpers
async function readStateCache(env) {
  try {
    const obj = await env.CORONA_BUCKET.get("meta/state_cache.json");
    if (!obj) return null;
    return await obj.json();
  } catch { return null; }
}

async function writeStateCache(env) {
  const state = await buildState(env);
  await env.CORONA_BUCKET.put(
    "meta/state_cache.json",
    JSON.stringify(state),
    { httpMetadata: { contentType: "application/json" } }
  );
}

async function pruneOld(env) {
  const cutoff = Date.now() - RETENTION_MS;
  let cursor;
  const toDelete = [];

  do {
    const page = await env.CORONA_BUCKET.list({ limit: 1000, cursor });
    for (const obj of page.objects) {
      if (obj.key.startsWith("meta/")) continue;
      const ts = compactKeyToIso(obj.key);
      if (ts && Date.parse(ts) < cutoff) toDelete.push(obj.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  for (const key of toDelete) await env.CORONA_BUCKET.delete(key);
  return { ok: true, deleted: toDelete.length };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Frame file names in a listing, by the source's own pattern, deduplicated. */
function listingNames(source, htmlText) {
  const pattern = new RegExp(source.namePattern.source, "g");
  return [...new Set([...htmlText.matchAll(pattern)].map(m => m[1]))];
}

async function getLatestFromListing(source) {
  const htmlText = await fetchText(source.listingUrl);
  const names = listingNames(source, htmlText);
  if (!names.length) return null;
  names.sort();
  const name = names[names.length - 1];
  return { name, url: source.baseUrl + name, ts: parseListingNameToIso(name) };
}

/** YYYYMMDD_HHMM_ccorN_... to an ISO time, for either coronagraph. */
function parseListingNameToIso(name) {
  const m = name.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})_ccor\d_/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:00.000Z`;
}

function parseStereoNameToIso(name) {
  const m = name.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
}

function parseHttpDateToIso(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

// FIX: added a browser-like User-Agent header. This is the single shared
// fetch function used for every remote request in this worker (SOHO, STEREO,
// and the NOAA CCOR-1 and CCOR-2 listings + images), so the fix covers all of them at once.
async function fetchWithTimeout(url, init = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      headers: {
        "User-Agent": REMOTE_USER_AGENT,
        ...(init.headers || {}),
      },
      signal: ctrl.signal,
      cf: { cacheTtl: 0, cacheEverything: false },
    });
  } finally {
    clearTimeout(id);
  }
}

async function fetchText(url) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

async function sha256Hex(arrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", arrayBuffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function isoToCompact(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function compactKeyToIso(key) {
  const m = String(key || "").match(/\/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\.jpg$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
}

function sourceKeyFromRawKey(key) {
  const m = String(key || "").match(/^raw\/([^/]+)\//);
  return m ? m[1] : null;
}

function uniqueUtcDateStringsForLastHours(now, hours) {
  const out = new Set();
  for (let i = 0; i <= hours; i++) {
    const d = new Date(now.getTime() - i * 3600000);
    out.add(d.toISOString().slice(0, 10));
  }
  return [...out];
}

function jsonCacheable(data, maxAgeSeconds = 30) {
  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, s-maxage=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds * 2}`,
      "access-control-allow-origin": "*",
    },
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

function html(content, status = 200) {
  return new Response(content, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function renderAppHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Coronagraph Scrubber</title>
<style>
  :root{
    --bg:#07111c;
    --panel:#0c1a2b;
    --panel2:#10233a;
    --text:#e9f2ff;
    --muted:#9ab1cc;
    --accent:#6fd3ff;
    --accent2:#a78bfa;
    --border:rgba(255,255,255,.08);
  }
  *{box-sizing:border-box}
  body{
    margin:0;
    font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;
    color:var(--text);
    background:
      radial-gradient(circle at top, rgba(103,172,255,.16), transparent 35%),
      radial-gradient(circle at right, rgba(167,139,250,.12), transparent 25%),
      linear-gradient(180deg,#060d16,#07111c 45%,#050a12);
  }
  .wrap{max-width:1500px;margin:0 auto;padding:24px}
  .hero{display:flex;justify-content:space-between;gap:16px;align-items:flex-end;margin-bottom:20px;flex-wrap:wrap}
  .title{font-size:clamp(30px,5vw,54px);line-height:1;margin:0 0 8px;letter-spacing:-0.04em}
  .sub{color:var(--muted);max-width:950px;font-size:15px}
  .toolbar{display:flex;gap:10px;flex-wrap:wrap}
  button{
    appearance:none;border:none;border-radius:12px;padding:10px 14px;
    background:var(--panel2);color:var(--text);cursor:pointer;border:1px solid var(--border);
    transition:.15s transform ease,.15s opacity ease;
  }
  button:hover{transform:translateY(-1px)}
  button:disabled{opacity:.5;cursor:not-allowed;transform:none}
  button.primary{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#02111c;font-weight:800}
  .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
  @media (max-width:980px){.grid{grid-template-columns:1fr}.hero{flex-direction:column;align-items:flex-start}}
  .card{
    background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.02));
    border:1px solid var(--border);
    border-radius:26px;
    overflow:hidden;
  }
  .card-head{
    display:flex;justify-content:space-between;align-items:center;
    padding:16px 18px;border-bottom:1px solid var(--border);
    flex-wrap:wrap;gap:10px;
  }
  .card-title{font-size:18px;font-weight:800}
  .head-right{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .pill{
    padding:5px 9px;border-radius:999px;border:1px solid var(--border);
    background:rgba(255,255,255,.04);font-size:11px;color:var(--muted)
  }
  .pill.warn{color:#ffcf84;border-color:rgba(255,207,132,.3)}
  .tabs{display:flex;gap:8px}
  .tab{
    font-size:12px;padding:7px 10px;border-radius:999px;border:1px solid var(--border);
    background:#0c1a2b;color:var(--muted);cursor:pointer;
  }
  .tab.active{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#041019;font-weight:800}
  .viewer{
    position:relative;
    aspect-ratio:1/1;
    background:#000;
    display:flex;
    align-items:center;
    justify-content:center;
  }
  .viewer img,.viewer canvas{
    width:100%;
    height:100%;
    object-fit:contain;
    display:block;
    background:#000;
  }
  .viewer canvas{position:absolute;inset:0}
  .viewer .baseimg{position:absolute;inset:0;width:100%;height:100%}
  .viewer .placeholder{color:var(--muted);font-size:14px;text-align:center;padding:24px}
  .watermark{
    position:absolute;
    right:12px;
    bottom:12px;
    width:min(20%,120px);
    opacity:.7;
    pointer-events:none;
    z-index:5;
    mix-blend-mode:screen;
    filter:drop-shadow(0 2px 8px rgba(0,0,0,.35));
  }
  .meta{padding:14px 18px;color:var(--muted);font-size:13px;border-top:1px solid var(--border)}
  .scrubber{padding:14px 18px 20px;border-top:1px solid var(--border);display:grid;gap:10px}
  .scrubber .row{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
  .scrubber input[type=range]{width:100%}
  .scrubber .button-row{display:flex;gap:8px;flex-wrap:wrap}
  .thumbs{display:flex;gap:8px;overflow:auto;padding:0 18px 18px}
  .thumb{
    min-width:104px;max-width:104px;border-radius:14px;overflow:hidden;border:1px solid var(--border);
    background:#06101a;cursor:pointer
  }
  .thumb img{display:block;width:100%;height:90px;object-fit:cover;background:#000}
  .thumb .t{font-size:11px;padding:8px;color:var(--muted)}
  .diff-controls{
    padding:14px 18px 18px;
    border-top:1px solid var(--border);
    display:grid;
    grid-template-columns:repeat(2,minmax(0,1fr));
    gap:12px 16px;
    background:rgba(255,255,255,.015);
  }
  @media (max-width:700px){.diff-controls{grid-template-columns:1fr}}
  .control-group{display:flex;flex-direction:column;gap:6px}
  .control-label{display:flex;justify-content:space-between;gap:10px;font-size:12px;color:var(--muted)}
  .control-value{color:var(--text);font-weight:700}
  .diff-controls input[type=range]{width:100%}
  .toggle-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .toggle-chip{
    display:inline-flex;align-items:center;gap:8px;
    padding:8px 10px;border-radius:999px;border:1px solid var(--border);
    background:#0c1a2b;font-size:12px;color:var(--muted)
  }
  .toggle-chip input{margin:0}
  .legend{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:0 18px 18px}
  .legend-item{
    display:flex;align-items:center;gap:8px;
    padding:6px 10px;border-radius:999px;border:1px solid var(--border);
    background:#081221;font-size:11px;color:var(--muted)
  }
  .legend-swatch{width:18px;height:10px;border-radius:999px;border:1px solid rgba(255,255,255,.12)}
  .status{
    margin-top:16px;padding:12px 14px;border-radius:16px;border:1px solid var(--border);
    background:rgba(255,255,255,.03);font-size:13px;color:var(--muted)
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="hero">
    <div>
      <h1 class="title">Coronagraph Scrubber</h1>
      <div class="sub">
        7-day rolling archive with duplicate filtering and live browser difference imagery.
        Page loads instantly; full frame history loads per source on demand.
      </div>
    </div>
    <div class="toolbar">
      <button class="primary" id="refreshUi">Refresh UI</button>
      <button id="refreshNow">Refresh sources now</button>
      <button id="backfillNow">Backfill last 7 days</button>
    </div>
  </div>

  <div class="grid" id="grid"></div>
  <div class="status" id="status">Loading…</div>
</div>

<script>
const WATERMARK_URL = "/watermark-logo";
const SOURCE_ORDER = ["ccor2","ccor1","soho_c2","soho_c3","stereo_cor2"];

const state = {
  data: null,
  modeBySource: {},
  indexBySource: {},
  diffSettingsBySource: {},
  framesLoadedBySource: {},
  loadingFramesBySource: {},
};

function defaultDiffSettings() {
  return { gain: 6.0, floor: 6, gamma: 0.75, markThreshold: 150, showContext: true, showMarkers: true, showLegend: true };
}

function getDiffSettings(sourceKey) {
  if (!state.diffSettingsBySource[sourceKey]) {
    state.diffSettingsBySource[sourceKey] = defaultDiffSettings();
  }
  return state.diffSettingsBySource[sourceKey];
}

function clamp(num, min, max) { return Math.max(min, Math.min(max, num)); }

function fmt(ts) {
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

function setStatus(msg) { document.getElementById("status").textContent = msg; }

async function load() {
  const res = await fetch("/api/state", { cache: "no-store" });
  const data = await res.json();
  state.data = data;

  const grid = document.getElementById("grid");
  grid.innerHTML = "";

  for (const key of SOURCE_ORDER) {
    const source = data.sources[key];
    if (!source) continue;
    if (!state.modeBySource[key]) state.modeBySource[key] = "raw";
    if (state.indexBySource[key] == null) {
      state.indexBySource[key] = Math.max(0, (source.frames?.length || 1) - 1);
    }
    grid.appendChild(renderCard(key, source));
  }

  setStatus("Updated: " + fmt(data.updated_utc));
  requestAnimationFrame(() => renderAllDiffs());
}

function renderCard(sourceKey, source) {
  const mode = state.modeBySource[sourceKey] || "raw";
  const items = source.frames || [];
  const idx = Math.min(state.indexBySource[sourceKey] || 0, Math.max(0, items.length - 1));
  const item = items[idx] || null;
  const diff = getDiffSettings(sourceKey);
  const loaded = !!state.framesLoadedBySource[sourceKey];
  const loading = !!state.loadingFramesBySource[sourceKey];

  const el = document.createElement("section");
  el.className = "card";

  el.innerHTML = \`
    <div class="card-head">
      <div class="card-title">\${source.label}</div>
      <div class="head-right">
        \${!loaded ? '<span class="pill warn">latest only</span>' : '<span class="pill">' + items.length + ' frames</span>'}
        <div class="tabs">
          <button class="tab \${mode === "raw" ? "active" : ""}" data-mode="raw">Raw</button>
          <button class="tab \${mode === "diff" ? "active" : ""}" data-mode="diff">Difference</button>
        </div>
      </div>
    </div>

    <div class="viewer">
      \${mode === "raw" && item ? \`<img class="baseimg" src="\${item.url}" alt="">\` : ""}
      \${mode === "diff" ? \`<canvas data-diff-canvas="\${sourceKey}"></canvas>\` : ""}
      \${!item ? '<div class="placeholder">No imagery loaded yet.</div>' : ""}
      <img class="watermark" src="\${WATERMARK_URL}" alt="">
    </div>

    <div class="meta">
      \${item
        ? "Frame: " + fmt(item.ts) +
          " · fetched: " + (item.fetched_at ? fmt(item.fetched_at) : "n/a") +
          " · " + mode.toUpperCase() +
          " · " + items.length + " frame(s)"
        : "Waiting for imagery"}
    </div>

    <div class="scrubber">
      <div class="button-row">
        <button data-load-frames="\${sourceKey}" \${loading ? "disabled" : ""}>
          \${loaded ? "Reload 7 days of frames" : (loading ? "Loading…" : "Load full 7 days")}
        </button>
      </div>
      <div class="row">
        <span>Frame position</span>
        <strong>\${items.length ? (idx + 1) + " / " + items.length : "0 / 0"}</strong>
      </div>
      <input type="range" min="0" max="\${Math.max(0, items.length - 1)}" step="1"
        value="\${Math.min(idx, Math.max(0, items.length - 1))}"
        class="frame-slider" \${items.length <= 1 ? "disabled" : ""}>
    </div>

    \${mode === "diff" ? \`
      <div class="diff-controls">
        <div class="control-group">
          <div class="control-label"><span>Sensitivity / gain</span><span class="control-value">\${diff.gain.toFixed(1)}x</span></div>
          <input type="range" min="1" max="12" step="0.5" value="\${diff.gain}" class="diff-range" data-setting="gain">
        </div>
        <div class="control-group">
          <div class="control-label"><span>Noise floor</span><span class="control-value">\${diff.floor}</span></div>
          <input type="range" min="0" max="30" step="1" value="\${diff.floor}" class="diff-range" data-setting="floor">
        </div>
        <div class="control-group">
          <div class="control-label"><span>Shadow lift / gamma</span><span class="control-value">\${diff.gamma.toFixed(2)}</span></div>
          <input type="range" min="0.4" max="1.4" step="0.05" value="\${diff.gamma}" class="diff-range" data-setting="gamma">
        </div>
        <div class="control-group">
          <div class="control-label"><span>Marker threshold</span><span class="control-value">\${diff.markThreshold}</span></div>
          <input type="range" min="60" max="240" step="5" value="\${diff.markThreshold}" class="diff-range" data-setting="markThreshold">
        </div>
        <div class="toggle-row">
          <label class="toggle-chip">
            <input type="checkbox" class="diff-toggle" data-setting="showContext" \${diff.showContext ? "checked" : ""}>
            <span>Show base frame</span>
          </label>
          <label class="toggle-chip">
            <input type="checkbox" class="diff-toggle" data-setting="showMarkers" \${diff.showMarkers ? "checked" : ""}>
            <span>Show markers</span>
          </label>
          <label class="toggle-chip">
            <input type="checkbox" class="diff-toggle" data-setting="showLegend" \${diff.showLegend ? "checked" : ""}>
            <span>Show legend</span>
          </label>
          <button class="tab diff-reset">Reset diff</button>
        </div>
      </div>
      \${diff.showLegend ? \`
        <div class="legend">
          <div class="legend-item"><span class="legend-swatch" style="background:linear-gradient(90deg,#001428,#00d8ff)"></span><span>Subtle change</span></div>
          <div class="legend-item"><span class="legend-swatch" style="background:linear-gradient(90deg,#00d8ff,#ffe15a)"></span><span>Moderate</span></div>
          <div class="legend-item"><span class="legend-swatch" style="background:linear-gradient(90deg,#ffe15a,#ff4d2d)"></span><span>Strong</span></div>
          <div class="legend-item"><span class="legend-swatch" style="background:linear-gradient(90deg,#ffb7b7,#ffffff)"></span><span>Strongest</span></div>
        </div>
      \` : ""}
    \` : ""}

    \${loaded ? \`
      <div class="thumbs">
        \${items.map((x, i) => \`
          <div class="thumb" data-index="\${i}">
            <img src="\${x.url}" alt="">
            <div class="t">\${new Date(x.ts).toLocaleTimeString()}</div>
          </div>
        \`).join("")}
      </div>
    \` : ""}
  \`;

  // Tabs
  el.querySelectorAll(".tab[data-mode]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.modeBySource[sourceKey] = btn.dataset.mode;
      rerender();
    });
  });

  // Frame slider
  const slider = el.querySelector(".frame-slider");
  if (slider) {
    slider.addEventListener("input", () => {
      state.indexBySource[sourceKey] = Number(slider.value);
      rerender();
    });
  }

  // Load 24h frames button
  const loadBtn = el.querySelector(\`[data-load-frames]\`);
  if (loadBtn) {
    loadBtn.addEventListener("click", async () => {
      await hydrateSourceFrames(sourceKey);
    });
  }

  // Thumbnails
  el.querySelectorAll(".thumb").forEach(thumb => {
    thumb.addEventListener("click", () => {
      state.indexBySource[sourceKey] = Number(thumb.dataset.index);
      rerender();
    });
  });

  // Diff controls
  el.querySelectorAll(".diff-range").forEach(input => {
    input.addEventListener("input", () => {
      getDiffSettings(sourceKey)[input.dataset.setting] = Number(input.value);
      rerender();
    });
  });
  el.querySelectorAll(".diff-toggle").forEach(input => {
    input.addEventListener("change", () => {
      getDiffSettings(sourceKey)[input.dataset.setting] = input.checked;
      rerender();
    });
  });
  const resetBtn = el.querySelector(".diff-reset");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      state.diffSettingsBySource[sourceKey] = defaultDiffSettings();
      rerender();
    });
  }

  return el;
}

function rerender() {
  if (!state.data) return;
  const grid = document.getElementById("grid");
  grid.innerHTML = "";
  for (const key of SOURCE_ORDER) {
    const source = state.data.sources[key];
    if (!source) continue;
    grid.appendChild(renderCard(key, source));
  }
  requestAnimationFrame(() => renderAllDiffs());
}

async function hydrateSourceFrames(sourceKey) {
  if (!state.data?.sources?.[sourceKey]) return;
  state.loadingFramesBySource[sourceKey] = true;
  rerender();

  try {
    const res = await fetch(\`/api/frames?source=\${encodeURIComponent(sourceKey)}\`, { cache: "no-store" });
    const data = await res.json();
    if (!data?.ok) throw new Error(data?.error || "Failed to load frames");

    const frames = data.frames || [];
    state.data.sources[sourceKey].frames = frames;
    state.framesLoadedBySource[sourceKey] = true;
    state.indexBySource[sourceKey] = Math.max(0, frames.length - 1);
    setStatus("Loaded " + frames.length + " frames for " + sourceKey);
  } catch (err) {
    setStatus("Error loading frames: " + (err?.message || String(err)));
  } finally {
    state.loadingFramesBySource[sourceKey] = false;
    rerender();
  }
}

async function renderAllDiffs() {
  if (!state.data) return;
  for (const key of SOURCE_ORDER) {
    if ((state.modeBySource[key] || "raw") !== "diff") continue;
    await renderDiffForSource(key);
  }
}

async function renderDiffForSource(sourceKey) {
  const source = state.data.sources[sourceKey];
  const items = source?.frames || [];
  const idx = Math.min(state.indexBySource[sourceKey] || 0, Math.max(0, items.length - 1));
  const curr = items[idx];
  const prev = items[Math.max(0, idx - 1)];
  const canvas = document.querySelector(\`canvas[data-diff-canvas="\${sourceKey}"]\`);
  if (!canvas || !curr || !prev || curr.url === prev.url) return;

  const settings = getDiffSettings(sourceKey);
  const [imgA, imgB] = await Promise.all([loadImage(prev.url), loadImage(curr.url)]);
  const width = Math.min(imgA.naturalWidth || imgA.width, imgB.naturalWidth || imgB.width);
  const height = Math.min(imgA.naturalHeight || imgA.height, imgB.naturalHeight || imgB.height);

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;

  const tempA = document.createElement("canvas"); tempA.width = width; tempA.height = height;
  const tempB = document.createElement("canvas"); tempB.width = width; tempB.height = height;
  const tctxA = tempA.getContext("2d", { willReadFrequently: true });
  const tctxB = tempB.getContext("2d", { willReadFrequently: true });
  if (!tctxA || !tctxB) return;

  tctxA.drawImage(imgA, 0, 0, width, height);
  tctxB.drawImage(imgB, 0, 0, width, height);
  const dataA = tctxA.getImageData(0, 0, width, height);
  const dataB = tctxB.getImageData(0, 0, width, height);
  const out = ctx.createImageData(width, height);

  const hits = [];
  const sampleStep = 8;
  const gain = clamp(Number(settings.gain) || 6, 1, 20);
  const floor = clamp(Number(settings.floor) || 0, 0, 60);
  const gamma = clamp(Number(settings.gamma) || 0.75, 0.2, 2);
  const markThreshold = clamp(Number(settings.markThreshold) || 150, 0, 255);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const aGray = (dataA.data[i] + dataA.data[i+1] + dataA.data[i+2]) / 3;
      const bGray = (dataB.data[i] + dataB.data[i+1] + dataB.data[i+2]) / 3;
      let delta = Math.abs(bGray - aGray);
      delta = Math.max(0, delta - floor);
      let v = Math.min(255, delta * gain);
      v = 255 * Math.pow(v / 255, gamma);
      let r = 0, g = 0, b = 0;
      if (v <= 0) { r = g = b = 0; }
      else if (v < 64) { r = 0; g = v * 2; b = 80 + v * 2; }
      else if (v < 128) { const t = (v-64)/64; r = 255*t; g = 180+75*t; b = 255*(1-t); }
      else if (v < 200) { const t = (v-128)/72; r = 255; g = 255*(1-t); b = 0; }
      else { const t = (v-200)/55; r = 255; g = 180+75*t; b = 180+75*t; }
      out.data[i] = Math.round(clamp(r, 0, 255));
      out.data[i+1] = Math.round(clamp(g, 0, 255));
      out.data[i+2] = Math.round(clamp(b, 0, 255));
      out.data[i+3] = Math.round(clamp(Math.max(18, v), 0, 255));
      if (settings.showMarkers && v >= markThreshold && x % sampleStep === 0 && y % sampleStep === 0) {
        hits.push({ x, y, v });
      }
    }
  }

  ctx.clearRect(0, 0, width, height);
  if (settings.showContext) {
    ctx.save(); ctx.globalAlpha = 0.22; ctx.drawImage(imgB, 0, 0, width, height); ctx.restore();
  }
  ctx.putImageData(out, 0, 0);

  if (settings.showMarkers && hits.length) {
    hits.sort((a, b) => b.v - a.v);
    const strongest = [];
    const minSep = Math.max(16, Math.round(width / 24));
    for (const hit of hits) {
      const tooClose = strongest.some(e => {
        const dx = e.x - hit.x, dy = e.y - hit.y;
        return (dx*dx + dy*dy) < (minSep*minSep);
      });
      if (!tooClose) strongest.push(hit);
      if (strongest.length >= 20) break;
    }
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.lineWidth = Math.max(1.25, width / 500);
    ctx.fillStyle = "rgba(255,90,90,0.95)";
    for (const point of strongest) {
      const size = Math.max(10, Math.round(width / 32));
      const half = size / 2;
      ctx.strokeRect(point.x - half, point.y - half, size, size);
      ctx.beginPath();
      ctx.moveTo(point.x - 5, point.y); ctx.lineTo(point.x + 5, point.y);
      ctx.moveTo(point.x, point.y - 5); ctx.lineTo(point.x, point.y + 5);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(point.x, point.y, Math.max(1.5, width / 240), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

document.getElementById("refreshUi").addEventListener("click", () => {
  load().catch(err => setStatus(err.message || String(err)));
});

document.getElementById("refreshNow").addEventListener("click", async () => {
  setStatus("Refreshing sources…");
  try {
    await fetch("/api/refresh", { method: "POST" });
    await load();
    setStatus("Refresh complete.");
  } catch (err) { setStatus(err.message || String(err)); }
});

document.getElementById("backfillNow").addEventListener("click", async () => {
  setStatus("Backfilling last 7 days…");
  try {
    await fetch("/api/backfill", { method: "POST" });
    await load();
    setStatus("Backfill complete.");
  } catch (err) { setStatus(err.message || String(err)); }
});

load().catch(err => setStatus("Failed to load: " + (err?.message || err)));
</script>
</body>
</html>`;
}
