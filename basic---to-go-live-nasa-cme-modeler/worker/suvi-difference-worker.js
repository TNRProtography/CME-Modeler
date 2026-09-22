// GOES SUVI imagery archive.
//
// Deployed from the Cloudflare dashboard as suvi-difference-imagery. This
// copy is here so the source is under version control - edit it here, paste
// it there.
//
// Retention is a week. That is deliberately three constants rather than one:
// how long frames are KEPT, how many the summary RETURNS, and how far a
// backfill LOOKS are different questions, and a single constant answering all
// three is how a retention change quietly turns the summary into a 3.7 MB
// download for every client.

const HOUR_MS = 60 * 60 * 1000;

/** How long frames are kept in R2. */
const RETENTION_MS = 7 * 24 * HOUR_MS;

/**
 * How much /api/state carries.
 *
 * A week across four sources is roughly 9,200 objects. Every one becomes an
 * entry in the summary, which every client downloads on load and which
 * writeStateCache re-writes to R2 on every cron run - 3.7 MB against 0.53 MB
 * for a day. The summary stays a day; the full week is one request away on
 * /api/frames, which is what that endpoint is for.
 */
const STATE_WINDOW_MS = 24 * HOUR_MS;

/**
 * The furthest back a backfill looks.
 *
 * NOAA's directory listing only holds about a day, so raising this would
 * re-scan the same listing for nothing. The archive fills forward: a week of
 * history exists a week after retention was widened, not before.
 */
const BACKFILL_WINDOW_MS = 24 * HOUR_MS;

const FETCH_TIMEOUT_MS = 30000;

const STORAGE_FORMAT = "jpg";
const STORAGE_CONTENT_TYPE = "image/jpeg";
const JPEG_QUALITY = 82;

// Standard browser User-Agent. NOAA/SWPC's bot protection was returning
// HTTP 403 to requests without a recognizable User-Agent (which is what
// Cloudflare Workers send by default). Sending this resolves the 403s.
const NOAA_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// ─────────────────────────────────────────────────────────────────────────
//  PASTE YOUR EXISTING WATERMARK LINE HERE
//
//  In your current worker, find the line that starts with
//      const WATERMARK_BASE64 = "iVBORw0KGgo...
//  and copy that whole line over this one. It is a few thousand characters
//  of encoded PNG; retyping it corrupts it silently, so it is the one thing
//  in this file that has to come from your copy rather than from me.
//
//  If you forget, nothing breaks except the logo in the corner of the
//  viewer, and /watermark-logo answers 404 instead of serving nonsense.
// ─────────────────────────────────────────────────────────────────────────
const WATERMARK_BASE64 = "";

const DEFAULT_DIFF_CONFIG = {
  gain: 8.5,
  floor: 8,
  gamma: 0.45,
  markThreshold: 65,
  showContext: false,
  showMarkers: false,
  showLegend: true,
};

const SOURCES = {
  suvi_195_primary: {
    key: "suvi_195_primary",
    label: "GOES-19 SUVI 195 Å",
    latestUrl: "https://services.swpc.noaa.gov/images/animations/suvi/primary/195/latest.png",
    listingUrl: "https://services.swpc.noaa.gov/images/animations/suvi/primary/195/",
    baseUrl: "https://services.swpc.noaa.gov/images/animations/suvi/primary/195/",
  },
  suvi_304_secondary: {
    key: "suvi_304_secondary",
    label: "GOES-18 SUVI 304 Å",
    latestUrl: "https://services.swpc.noaa.gov/images/animations/suvi/secondary/304/latest.png",
    listingUrl: "https://services.swpc.noaa.gov/images/animations/suvi/secondary/304/",
    baseUrl: "https://services.swpc.noaa.gov/images/animations/suvi/secondary/304/",
  },
  suvi_131_secondary: {
    key: "suvi_131_secondary",
    label: "GOES-18 SUVI 131 Å",
    latestUrl: "https://services.swpc.noaa.gov/images/animations/suvi/secondary/131/latest.png",
    listingUrl: "https://services.swpc.noaa.gov/images/animations/suvi/secondary/131/",
    baseUrl: "https://services.swpc.noaa.gov/images/animations/suvi/secondary/131/",
  },
  suvi_284_primary: {
    key: "suvi_284_primary",
    label: "GOES-19 SUVI 284 Å",
    latestUrl: "https://services.swpc.noaa.gov/images/animations/suvi/primary/284/latest.png",
    listingUrl: "https://services.swpc.noaa.gov/images/animations/suvi/primary/284/",
    baseUrl: "https://services.swpc.noaa.gov/images/animations/suvi/primary/284/",
  },
};

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders() });
      }

      if (url.pathname === "/watermark-logo") {
        if (!WATERMARK_BASE64) {
          // Better a clear 404 than a broken image: atob on a truncated
          // string returns bytes rather than throwing, so a corrupted
          // watermark would otherwise serve as a valid-looking PNG that
          // simply does not render.
          return new Response("No watermark configured", {
            status: 404,
            headers: corsHeaders(),
          });
        }
        return new Response(
          Uint8Array.from(atob(WATERMARK_BASE64), (c) => c.charCodeAt(0)),
          {
            headers: {
              "content-type": "image/png",
              "cache-control": "public, max-age=31536000",
              ...corsHeaders(),
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
          bucket_binding: "SUVI_BUCKET",
          storage_format: STORAGE_FORMAT,
          storage_content_type: STORAGE_CONTENT_TYPE,
          jpeg_quality: JPEG_QUALITY,
          retention_hours: RETENTION_MS / HOUR_MS,
          state_window_hours: STATE_WINDOW_MS / HOUR_MS,
          backfill_window_hours: BACKFILL_WINDOW_MS / HOUR_MS,
        });
      }

      if (url.pathname === "/api/defaults") {
        return json({
          ok: true,
          diff_defaults: DEFAULT_DIFF_CONFIG,
          sources: Object.keys(SOURCES),
          storage_format: STORAGE_FORMAT,
          storage_content_type: STORAGE_CONTENT_TYPE,
          jpeg_quality: JPEG_QUALITY,
          retention_hours: RETENTION_MS / HOUR_MS,
        });
      }

      if (url.pathname === "/api/state") {
        const windowMs = windowFromQuery(url, STATE_WINDOW_MS);
        // The cache holds the default window only. Caching every window
        // somebody might ask for is how a cache turns into the slow path.
        const stateData = windowMs === STATE_WINDOW_MS
          ? (await readStateCache(env)) || (await buildStateFast(env, windowMs))
          : await buildStateFast(env, windowMs);
        return jsonCacheable(stateData, 30);
      }

      if (url.pathname === "/api/frames") {
        const source = url.searchParams.get("source");
        if (!source || !SOURCES[source]) {
          return json({ ok: false, error: "Invalid source" }, 400);
        }

        // Defaults to everything kept. This is the endpoint that serves the
        // full week; /api/state is the summary that deliberately does not.
        const windowMs = windowFromQuery(url, RETENTION_MS);
        const frames = await listRecent(env, `raw/${source}/`, windowMs);
        return json({
          ok: true,
          source,
          window_hours: Math.round(windowMs / HOUR_MS),
          retention_hours: RETENTION_MS / HOUR_MS,
          diff_defaults: DEFAULT_DIFF_CONFIG,
          storage_format: STORAGE_FORMAT,
          frames,
        });
      }

      if (url.pathname === "/api/image") {
        const key = url.searchParams.get("key");
        if (!key) {
          return new Response("Missing key", { status: 400, headers: corsHeaders() });
        }

        const obj = await env.SUVI_BUCKET.get(key);
        if (!obj) {
          return new Response("Not found", { status: 404, headers: corsHeaders() });
        }

        return new Response(obj.body, {
          headers: {
            "content-type": obj.httpMetadata?.contentType || guessContentTypeFromKey(key),
            "cache-control": "public, max-age=86400, immutable",
            ...corsHeaders(),
          },
        });
      }

      if (url.pathname === "/api/refresh" && request.method === "POST") {
        return json(await refreshAll(env, { backfill: false }));
      }

      if (url.pathname === "/api/backfill" && request.method === "POST") {
        return json(await refreshAll(env, { backfill: true }));
      }

      if (url.pathname === "/api/migrate-to-jpg" && request.method === "POST") {
        return json(await migrateExistingToJpg(env));
      }

      return new Response("Not found", { status: 404, headers: corsHeaders() });
    } catch (err) {
      return json(
        {
          ok: false,
          error: err?.message || String(err),
          stack: err?.stack || null,
        },
        500
      );
    }
  },

  async scheduled(event, env, ctx) {
    // pruneOld runs via waitUntil so it never eats into the 30s CPU limit or
    // blocks the scheduled ingestion from completing.
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
      results[source.key] = backfill
        ? await backfillSuvi(env, source)
        : await ingestLatestForSource(env, source);
    } catch (err) {
      results[source.key] = { ok: false, error: err?.message || String(err) };
    }
  }

  // NOTE: pruneOld no longer called here — it runs via ctx.waitUntil() in the
  // scheduled handler so it never blocks manual /api/refresh responses either.

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
  const converted = await fetchImageAsJpeg(source.latestUrl);
  const hash = await sha256Hex(converted.bytes);

  const latestMeta = await getLatestSourceMeta(env, source.key);
  if (latestMeta?.hash && latestMeta.hash === hash) {
    return {
      ok: true,
      skipped: true,
      reason: "duplicate_content_latest",
      source: source.key,
    };
  }

  const headerTs = parseHttpDateToIso(converted.headers.get("last-modified"));
  const ts = headerTs || new Date().toISOString();

  if (latestMeta?.ts && ts && Date.parse(ts) <= Date.parse(latestMeta.ts)) {
    return {
      ok: true,
      skipped: true,
      reason: "stale_timestamp_latest",
      source: source.key,
      ts,
    };
  }

  return ingestFrameBytes(
    env,
    source.key,
    ts,
    converted.bytes,
    "latest.jpg",
    hash,
    STORAGE_CONTENT_TYPE,
    {
      original_remote_name: "latest.png",
      original_remote_url: source.latestUrl,
      original_content_type: converted.originalContentType || "",
    }
  );
}

async function backfillSuvi(env, source) {
  const htmlText = await fetchText(source.listingUrl);
  // BACKFILL_WINDOW_MS, not RETENTION_MS: NOAA's listing only holds about a
  // day, so looking further back re-scans the same page for nothing.
  const cutoff = Date.now() - BACKFILL_WINDOW_MS;

  const regex = /href="(or_suvi-l2-[^"]+\.(png|jpg|jpeg))"/gi;
  const names = [...htmlText.matchAll(regex)].map((m) => m[1]);

  const items = names
    .map((name) => {
      const ts = parseSuviNameToIso(name);
      return { name, ts, ms: ts ? Date.parse(ts) : NaN };
    })
    .filter((x) => x.ts && x.ms >= cutoff)
    .sort((a, b) => a.ms - b.ms);

  let stored = 0;
  let skipped = 0;

  for (const item of items) {
    const out = await ingestRemoteFrame(
      env,
      source.key,
      source.baseUrl + item.name,
      item.ts,
      item.name
    );
    if (out.stored) stored++;
    if (out.skipped) skipped++;
  }

  return {
    ok: true,
    attempted: items.length,
    stored,
    skipped,
    storage_format: STORAGE_FORMAT,
  };
}

async function ingestRemoteFrame(env, sourceKey, remoteUrl, tsIso, remoteName) {
  const effectiveTs = tsIso || new Date().toISOString();
  const compact = isoToCompact(effectiveTs);
  const targetKey = `raw/${sourceKey}/${compact}.${STORAGE_FORMAT}`;

  const targetExists = await env.SUVI_BUCKET.head(targetKey);
  if (targetExists) {
    return {
      ok: true,
      skipped: true,
      reason: "already_exists_jpg",
      source: sourceKey,
      key: targetKey,
    };
  }

  const converted = await fetchImageAsJpeg(remoteUrl);
  const hash = await sha256Hex(converted.bytes);

  return ingestFrameBytes(
    env,
    sourceKey,
    effectiveTs,
    converted.bytes,
    `${stripExtension(remoteName || "frame")}.${STORAGE_FORMAT}`,
    hash,
    STORAGE_CONTENT_TYPE,
    {
      original_remote_name: remoteName || "",
      original_remote_url: remoteUrl || "",
      original_content_type: converted.originalContentType || "",
    }
  );
}

async function ingestFrameBytes(
  env,
  sourceKey,
  tsIso,
  bytes,
  remoteName,
  hash,
  contentType,
  extraMeta = {}
) {
  const compact = isoToCompact(tsIso);
  const rawKey = `raw/${sourceKey}/${compact}.${STORAGE_FORMAT}`;
  const fetchedAt = new Date().toISOString();

  const exists = await env.SUVI_BUCKET.head(rawKey);
  if (exists) {
    return { ok: true, skipped: true, key: rawKey, reason: "already_exists" };
  }

  await env.SUVI_BUCKET.put(rawKey, bytes, {
    httpMetadata: { contentType: STORAGE_CONTENT_TYPE },
    customMetadata: {
      source: sourceKey,
      ts: tsIso,
      fetched_at: fetchedAt,
      remoteName: remoteName || "",
      type: "raw",
      hash: hash || "",
      storage_format: STORAGE_FORMAT,
      ...extraMeta,
    },
  });

  await env.SUVI_BUCKET.put(
    `meta/${sourceKey}/latest.json`,
    JSON.stringify({
      source: sourceKey,
      ts: tsIso,
      fetched_at: fetchedAt,
      key: rawKey,
      hash: hash || "",
      remoteName: remoteName || "",
      stored_at: fetchedAt,
      storage_format: STORAGE_FORMAT,
      storage_content_type: STORAGE_CONTENT_TYPE,
      jpeg_quality: JPEG_QUALITY,
    }),
    { httpMetadata: { contentType: "application/json" } }
  );

  return {
    ok: true,
    stored: true,
    key: rawKey,
    ts: tsIso,
    fetched_at: fetchedAt,
    hash,
    storage_format: STORAGE_FORMAT,
  };
}

async function migrateExistingToJpg(env) {
  // Follows retention, so a week of PNGs can still be converted rather than
  // skipped as "outside window".
  const cutoff = Date.now() - RETENTION_MS;
  const latestBySource = {};
  const results = {
    ok: true,
    started_utc: new Date().toISOString(),
    scanned: 0,
    attempted: 0,
    converted: 0,
    already_jpg: 0,
    deleted_old: 0,
    skipped_no_remote_name: 0,
    skipped_missing_source: 0,
    skipped_outside_window: 0,
    skipped_existing_target: 0,
    errors: [],
  };

  let cursor;
  do {
    // include customMetadata inline so we don't need a separate head() per object
    const page = await env.SUVI_BUCKET.list({
      prefix: "raw/",
      cursor,
      limit: 1000,
      include: ["customMetadata"],
    });

    for (const obj of page.objects) {
      results.scanned++;

      const ts = compactKeyToIso(obj.key);
      if (!ts || Date.parse(ts) < cutoff) {
        results.skipped_outside_window++;
        continue;
      }

      const ext = extensionFromName(obj.key);
      if (ext === "jpg" || ext === "jpeg") {
        results.already_jpg++;
        continue;
      }

      const meta = obj.customMetadata || {};
      const sourceKey = meta.source || sourceKeyFromRawKey(obj.key);
      const remoteName = meta.original_remote_name || meta.remoteName || "";

      if (!sourceKey || !SOURCES[sourceKey]) {
        results.skipped_missing_source++;
        continue;
      }

      if (!remoteName) {
        results.skipped_no_remote_name++;
        continue;
      }

      const targetKey = obj.key.replace(/\.(png|webp)$/i, `.${STORAGE_FORMAT}`);
      const targetExists = await env.SUVI_BUCKET.head(targetKey);
      if (targetExists) {
        results.skipped_existing_target++;
        await env.SUVI_BUCKET.delete(obj.key);
        results.deleted_old++;
        continue;
      }

      results.attempted++;

      try {
        const remoteUrl = SOURCES[sourceKey].baseUrl + remoteName;
        const converted = await fetchImageAsJpeg(remoteUrl);
        const bytes = converted.bytes;
        const hash = await sha256Hex(bytes);

        await env.SUVI_BUCKET.put(targetKey, bytes, {
          httpMetadata: { contentType: STORAGE_CONTENT_TYPE },
          customMetadata: {
            ...meta,
            source: sourceKey,
            ts,
            fetched_at:
              meta.fetched_at ||
              obj.uploaded?.toISOString?.() ||
              new Date().toISOString(),
            remoteName,
            original_remote_name: remoteName,
            original_remote_url: remoteUrl,
            original_content_type:
              converted.originalContentType || meta.original_content_type || "",
            type: "raw",
            hash,
            storage_format: STORAGE_FORMAT,
          },
        });

        await env.SUVI_BUCKET.delete(obj.key);
        results.converted++;
        results.deleted_old++;

        const currentLatest = latestBySource[sourceKey];
        if (!currentLatest || Date.parse(ts) > Date.parse(currentLatest.ts)) {
          latestBySource[sourceKey] = { source: sourceKey, ts, key: targetKey, hash, remoteName };
        }
      } catch (err) {
        results.errors.push({ key: obj.key, error: err?.message || String(err) });
      }
    }

    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  for (const [sourceKey, latest] of Object.entries(latestBySource)) {
    const now = new Date().toISOString();
    await env.SUVI_BUCKET.put(
      `meta/${sourceKey}/latest.json`,
      JSON.stringify({
        source: sourceKey,
        ts: latest.ts,
        fetched_at: now,
        key: latest.key,
        hash: latest.hash,
        remoteName: latest.remoteName,
        stored_at: now,
        storage_format: STORAGE_FORMAT,
        storage_content_type: STORAGE_CONTENT_TYPE,
        jpeg_quality: JPEG_QUALITY,
      }),
      { httpMetadata: { contentType: "application/json" } }
    );
  }

  results.finished_utc = new Date().toISOString();
  return results;
}

// ---------------------------------------------------------------------------
// State / listing
// ---------------------------------------------------------------------------

async function getLatestSourceMeta(env, sourceKey) {
  const obj = await env.SUVI_BUCKET.get(`meta/${sourceKey}/latest.json`);
  if (!obj) return null;
  try { return await obj.json(); } catch { return null; }
}

// listRecent uses include:["customMetadata"] — one paginated list call, no
// per-object head() requests. All sources fetched in parallel via Promise.all.
async function buildStateFast(env, windowMs = STATE_WINDOW_MS) {
  const out = {
    ok: true,
    updated_utc: new Date().toISOString(),
    diff_defaults: DEFAULT_DIFF_CONFIG,
    storage_format: STORAGE_FORMAT,
    storage_content_type: STORAGE_CONTENT_TYPE,
    jpeg_quality: JPEG_QUALITY,
    window_hours: Math.round(windowMs / HOUR_MS),
    retention_hours: RETENTION_MS / HOUR_MS,
    sources: {},
  };

  await Promise.all(
    Object.values(SOURCES).map(async (source) => {
      const [frames, latestMeta] = await Promise.all([
        listRecent(env, `raw/${source.key}/`, windowMs),
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

// Uses R2's include:['customMetadata'] to get metadata inline from the list
// call, which eliminates all per-object head() calls.
//
// Note the window only trims the RESULT: the list still pages through every
// object under the prefix, because R2 cannot filter by time. So a narrow
// window costs the same to compute and only saves bandwidth.
async function listRecent(env, prefix, windowMs = STATE_WINDOW_MS) {
  let cursor;
  const all = [];

  do {
    const page = await env.SUVI_BUCKET.list({
      prefix,
      cursor,
      limit: 1000,
      include: ["customMetadata"], // metadata available inline, no extra round-trips
    });
    all.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  const cutoff = Date.now() - windowMs;
  const out = [];

  for (const o of all) {
    const ts = compactKeyToIso(o.key);
    if (!ts || Date.parse(ts) < cutoff) continue;

    const meta = o.customMetadata || {};

    out.push({
      key: o.key,
      ts,
      fetched_at: meta.fetched_at || o.uploaded?.toISOString?.() || null,
      source: meta.source || sourceKeyFromRawKey(o.key),
      remoteName: meta.remoteName || meta.original_remote_name || null,
      hash: meta.hash || null,
      storage_format: meta.storage_format || STORAGE_FORMAT,
      uploaded: o.uploaded?.toISOString?.() || null,
      url: `/api/image?key=${encodeURIComponent(o.key)}`,
      default_diff_config: DEFAULT_DIFF_CONFIG,
    });
  }

  out.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  return out;
}

// State cache helpers
async function readStateCache(env) {
  try {
    const obj = await env.SUVI_BUCKET.get("meta/state_cache.json");
    if (!obj) return null;
    return await obj.json();
  } catch { return null; }
}

async function writeStateCache(env) {
  // The default window only. That is the one /api/state serves from cache.
  const state = await buildStateFast(env, STATE_WINDOW_MS);
  await env.SUVI_BUCKET.put(
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
    const page = await env.SUVI_BUCKET.list({ limit: 1000, cursor });
    for (const obj of page.objects) {
      if (obj.key.startsWith("meta/")) continue;
      const ts = compactKeyToIso(obj.key);
      if (ts && Date.parse(ts) < cutoff) toDelete.push(obj.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  // R2 takes up to 1000 keys per delete. One at a time was fine against a day
  // of frames; against a week it is a thousand round trips inside a waitUntil
  // that can be cut off, which would silently leave the bucket growing.
  for (let i = 0; i < toDelete.length; i += 1000) {
    await env.SUVI_BUCKET.delete(toDelete.slice(i, i + 1000));
  }

  return {
    ok: true,
    deleted: toDelete.length,
    retention_hours: RETENTION_MS / HOUR_MS,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A window in hours from the query string, clamped to what is actually kept.
 *
 * Unclamped, ?hours=100000 would be accepted and list the whole bucket.
 */
function windowFromQuery(url, fallbackMs) {
  const raw = url.searchParams.get("hours");
  if (!raw) return fallbackMs;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) return fallbackMs;
  return Math.min(hours * HOUR_MS, RETENTION_MS);
}

function parseSuviNameToIso(name) {
  const m = String(name || "").match(/_s(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z_/);
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

// Browser-like User-Agent: NOAA/SWPC's bot protection returns HTTP 403 to
// requests without a recognizable one, which is what Workers send by default.
async function fetchWithTimeout(url, init = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      headers: {
        Accept: "text/html",
        "User-Agent": NOAA_USER_AGENT,
        ...(init.headers || {}),
      },
      signal: ctrl.signal,
      cf: { cacheTtl: 0, cacheEverything: false },
    });
  } finally {
    clearTimeout(id);
  }
}

async function fetchImageAsJpeg(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": NOAA_USER_AGENT,
      },
      cf: {
        cacheTtl: 0,
        cacheEverything: false,
        image: { format: "jpeg", quality: JPEG_QUALITY, width: 1024 },
      },
    });
    if (!res.ok) throw new Error(`Failed image fetch/convert for ${url}: ${res.status}`);
    return {
      bytes: await res.arrayBuffer(),
      headers: res.headers,
      originalContentType: res.headers.get("content-type") || "",
    };
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
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function compactKeyToIso(key) {
  const m = String(key || "").match(/\/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\.(png|jpg|jpeg|webp)$/i);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
}

function extensionFromName(name) {
  const m = String(name || "").match(/\.([a-z0-9]+)(?:$|\?)/i);
  return m ? m[1].toLowerCase() : null;
}

function stripExtension(name) {
  return String(name || "").replace(/\.[^.]+$/i, "");
}

function sourceKeyFromRawKey(key) {
  const m = String(key || "").match(/^raw\/([^/]+)\//);
  return m ? m[1] : null;
}

function guessContentTypeFromName(name) {
  const ext = extensionFromName(name);
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "application/octet-stream";
}

function guessContentTypeFromKey(key) {
  return guessContentTypeFromName(key);
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "Content-Type",
  };
}

function jsonCacheable(data, maxAgeSeconds = 30) {
  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, s-maxage=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds * 2}`,
      ...corsHeaders(),
    },
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(),
    },
  });
}

function html(content, status = 200) {
  return new Response(content, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(),
    },
  });
}

function renderAppHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GOES SUVI Scrubber</title>
<style>
  :root{
    --bg:#07111c;
    --panel:#0c1a2b;
    --panel2:#10233a;
    --text:#e9f2ff;
    --muted:#9ab1cc;
    --accent:#6fd3ff;
    --accent2:#a78bfa;
    --danger:#ff7b7b;
    --border:rgba(255,255,255,.08);
    --card-shadow:0 20px 40px rgba(0,0,0,.25);
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{
    font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;
    color:var(--text);
    background:
      radial-gradient(circle at top, rgba(103,172,255,.16), transparent 35%),
      radial-gradient(circle at right, rgba(167,139,250,.12), transparent 25%),
      linear-gradient(180deg,#060d16,#07111c 45%,#050a12);
  }
  .wrap{max-width:1600px;margin:0 auto;padding:24px}
  .hero{display:flex;justify-content:space-between;gap:16px;align-items:flex-end;margin-bottom:20px;flex-wrap:wrap}
  .title{font-size:clamp(30px,5vw,54px);line-height:1;margin:0 0 8px;letter-spacing:-0.04em}
  .sub{color:var(--muted);max-width:980px;font-size:15px;line-height:1.5}
  .toolbar{display:flex;gap:10px;flex-wrap:wrap}
  button{
    appearance:none;border:none;border-radius:12px;padding:10px 14px;
    background:var(--panel2);color:var(--text);cursor:pointer;border:1px solid var(--border);
    transition:.15s transform ease,.15s opacity ease,.15s background ease;
  }
  button:hover{transform:translateY(-1px)}
  button:disabled{opacity:.6;cursor:not-allowed;transform:none}
  button.primary{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#04111f;font-weight:700}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:16px}
  .card{
    background:rgba(12,26,43,.86);
    border:1px solid var(--border);
    border-radius:22px;
    overflow:hidden;
    backdrop-filter:blur(8px);
    box-shadow:var(--card-shadow);
    min-width:0;
  }
  .card-head{
    display:flex;justify-content:space-between;gap:12px;align-items:center;
    padding:18px 18px 10px;
    flex-wrap:wrap;
  }
  .card-title{font-size:18px;font-weight:800;letter-spacing:-0.02em}
  .head-meta{display:flex;gap:8px;flex-wrap:wrap}
  .pill{
    padding:6px 10px;border-radius:999px;border:1px solid var(--border);
    background:rgba(255,255,255,.04);font-size:11px;color:var(--muted)
  }
  .pill.warn{color:#ffcf84;border-color:rgba(255,207,132,.3)}
  .tabs{display:flex;gap:8px}
  .tab{
    padding:8px 12px;border-radius:999px;background:#0d1b2c;border:1px solid var(--border);
    color:var(--muted);font-size:12px
  }
  .tab.active{
    background:linear-gradient(135deg,var(--accent),var(--accent2));
    color:#04111f;
    font-weight:800;
  }
  .viewer{
    position:relative;
    background:#000;
    margin:0 18px;
    border:1px solid var(--border);
    border-radius:18px;
    min-height:260px;
    display:flex;
    align-items:center;
    justify-content:center;
    overflow:hidden;
  }
  .viewer img.baseimg,
  .viewer canvas{
    display:block;
    width:100%;
    height:auto;
    max-height:70vh;
    object-fit:contain;
  }
  .viewer .placeholder{
    color:var(--muted);
    padding:32px;
    text-align:center;
    font-size:14px;
  }
  .viewer .watermark{
    position:absolute;
    right:12px;
    bottom:12px;
    width:88px;
    opacity:.82;
    pointer-events:none;
    user-select:none;
    filter:drop-shadow(0 2px 8px rgba(0,0,0,.5));
  }
  .meta{
    padding:12px 18px 10px;
    font-size:12px;
    color:var(--muted);
    line-height:1.5;
    word-break:break-word;
  }
  .scrubber{
    padding:0 18px 18px;
    display:grid;
    gap:10px;
  }
  .scrubber .row{
    display:flex;
    justify-content:space-between;
    align-items:center;
    gap:10px;
    flex-wrap:wrap;
  }
  .scrubber input[type=range]{width:100%}
  .scrubber .button-row{
    display:flex;gap:8px;flex-wrap:wrap;
  }
  .diff-controls{
    padding:0 18px 18px;
    display:grid;
    gap:12px;
  }
  @media (max-width:720px){ .diff-controls{grid-template-columns:1fr} }
  .control-group{display:flex;flex-direction:column;gap:6px}
  .control-label{
    display:flex;justify-content:space-between;gap:10px;
    font-size:12px;color:var(--muted)
  }
  .control-value{color:var(--text);font-weight:700}
  .diff-controls input[type=range]{width:100%}
  .toggle-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .toggle-chip{
    display:inline-flex;align-items:center;gap:8px;
    padding:8px 10px;border-radius:999px;border:1px solid var(--border);
    background:#0c1a2b;font-size:12px;color:var(--muted)
  }
  .toggle-chip input{margin:0}
  .legend{
    display:flex;gap:8px;flex-wrap:wrap;align-items:center;
    padding:0 18px 18px;
  }
  .legend-item{
    display:flex;align-items:center;gap:8px;
    padding:6px 10px;border-radius:999px;border:1px solid var(--border);
    background:#081221;font-size:11px;color:var(--muted)
  }
  .legend-swatch{
    width:18px;height:10px;border-radius:999px;border:1px solid rgba(255,255,255,.12)
  }
  .status{
    margin-top:16px;padding:12px 14px;border-radius:16px;border:1px solid var(--border);
    background:rgba(255,255,255,.03);font-size:13px;color:var(--muted)
  }
  .warning{color:#ffcf84}
</style>
</head>
<body>
<div class="wrap">
  <div class="hero">
    <div>
      <h1 class="title">GOES SUVI Scrubber</h1>
      <div class="sub">
        7-day rolling archive of official NOAA SWPC SUVI imagery with duplicate filtering.
        Difference imagery is generated live in the browser.
        Fast summary-only <code>/api/state</code> covers the last day; the full week is loaded
        on demand per source from <code>/api/frames</code>.
        Storage is forced to JPG for new ingests.
      </div>
    </div>
    <div class="toolbar">
      <button class="primary" id="refreshUi">Refresh UI</button>
      <button id="refreshNow">Refresh sources now</button>
      <button id="backfillNow">Backfill last 24 hours</button>
      <button id="migrateNow">Migrate PNG &rarr; JPG</button>
    </div>
  </div>

  <div class="grid" id="grid"></div>
  <div class="status" id="status">Loading…</div>
</div>

<script>
const WATERMARK_URL = "/watermark-logo";
const SOURCE_ORDER = ["suvi_195_primary","suvi_304_secondary","suvi_131_secondary","suvi_284_primary"];
const DEFAULT_DIFF_CONFIG = ${JSON.stringify(DEFAULT_DIFF_CONFIG)};
const RETENTION_HOURS = ${RETENTION_MS / HOUR_MS};

const state = {
  data: null,
  modeBySource: {},
  indexBySource: {},
  diffSettingsBySource: {},
  framesLoadedBySource: {},
  loadingFramesBySource: {},
};

function defaultDiffSettings() {
  return JSON.parse(JSON.stringify(DEFAULT_DIFF_CONFIG));
}

function getDiffSettings(sourceKey) {
  if (!state.diffSettingsBySource[sourceKey]) {
    state.diffSettingsBySource[sourceKey] = defaultDiffSettings();
  }
  return state.diffSettingsBySource[sourceKey];
}

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function fmt(ts){
  try { return new Date(ts).toLocaleString(); }
  catch { return ts || ""; }
}

function setStatus(msg) {
  document.getElementById("status").textContent = msg;
}

async function load(){
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

function getCurrentItem(sourceKey, source) {
  const items = source.frames || [];
  const idx = Math.min(state.indexBySource[sourceKey] || 0, Math.max(0, items.length - 1));
  return { idx, items, item: items[idx] || null };
}

function renderCard(sourceKey, source){
  const mode = state.modeBySource[sourceKey] || "raw";
  const { idx, items, item } = getCurrentItem(sourceKey, source);
  const diff = getDiffSettings(sourceKey);
  const loaded = !!state.framesLoadedBySource[sourceKey];
  const loading = !!state.loadingFramesBySource[sourceKey];

  const el = document.createElement("section");
  el.className = "card";

  el.innerHTML = \`
    <div class="card-head">
      <div>
        <div class="card-title">\${source.label}</div>
      </div>
      <div class="head-meta">
        <div class="pill">\${source.state_mode || "summary"}</div>
        <div class="pill">stored: JPG</div>
        \${loaded
          ? '<div class="pill">' + items.length + ' frame(s)</div>'
          : '<div class="pill warn">last 24h only</div>'
        }
      </div>
      <div class="tabs">
        <button class="tab \${mode === "raw" ? "active" : ""}" data-source="\${sourceKey}" data-mode="raw">Raw</button>
        <button class="tab \${mode === "diff" ? "active" : ""}" data-source="\${sourceKey}" data-mode="diff">Difference</button>
      </div>
    </div>

    <div class="viewer">
      \${mode === "raw" && item ? \`<img class="baseimg" src="\${item.url}" alt="">\` : ""}
      \${mode === "diff" ? \`<canvas data-diff-canvas="\${sourceKey}"></canvas>\` : ""}
      \${!item ? \`<div class="placeholder">No imagery loaded yet.</div>\` : ""}
      <img class="watermark" src="\${WATERMARK_URL}" alt="">
    </div>

    <div class="meta">
      \${item
        ? "Frame: " + fmt(item.ts) +
          " · fetched: " + (item.fetched_at ? fmt(item.fetched_at) : "n/a") +
          " · " + mode.toUpperCase() +
          " · " + items.length + " frame(s)"
        : "Waiting for imagery"}
      <br>
      \${loaded ? "" : '<span class="warning">Full history not loaded yet. Click button below.</span>'}
    </div>

    <div class="scrubber">
      <div class="button-row">
        <button data-load-frames="\${sourceKey}" \${loading ? "disabled" : ""}>
          \${loaded ? "Reload full history" : (loading ? "Loading…" : "Load full history")}
        </button>
      </div>
      <div class="row">
        <span>Frame position</span>
        <strong>\${items.length ? (idx + 1) + " / " + items.length : "0 / 0"}</strong>
      </div>
      <input type="range" min="0" max="\${Math.max(0, items.length - 1)}" step="1" value="\${Math.min(idx, Math.max(0, items.length - 1))}" data-source="\${sourceKey}" data-role="frame-slider" \${items.length <= 1 ? "disabled" : ""}>
    </div>

    \${mode === "diff" ? \`
      <div class="diff-controls">
        <div class="control-group">
          <div class="control-label">
            <span>Sensitivity / gain</span>
            <span class="control-value">\${diff.gain.toFixed(1)}x</span>
          </div>
          <input type="range" min="1" max="16" step="0.5" value="\${diff.gain}" class="diff-range" data-source="\${sourceKey}" data-setting="gain">
        </div>

        <div class="control-group">
          <div class="control-label">
            <span>Noise floor</span>
            <span class="control-value">\${diff.floor}</span>
          </div>
          <input type="range" min="0" max="30" step="1" value="\${diff.floor}" class="diff-range" data-source="\${sourceKey}" data-setting="floor">
        </div>

        <div class="control-group">
          <div class="control-label">
            <span>Shadow lift / gamma</span>
            <span class="control-value">\${diff.gamma.toFixed(2)}</span>
          </div>
          <input type="range" min="0.2" max="1.6" step="0.05" value="\${diff.gamma}" class="diff-range" data-source="\${sourceKey}" data-setting="gamma">
        </div>

        <div class="control-group">
          <div class="control-label">
            <span>Marker threshold</span>
            <span class="control-value">\${diff.markThreshold}</span>
          </div>
          <input type="range" min="30" max="220" step="5" value="\${diff.markThreshold}" class="diff-range" data-source="\${sourceKey}" data-setting="markThreshold">
        </div>

        <div class="toggle-row">
          <label class="toggle-chip">
            <input type="checkbox" class="diff-toggle" data-source="\${sourceKey}" data-setting="showContext" \${diff.showContext ? "checked" : ""}>
            <span>Show base frame</span>
          </label>

          <label class="toggle-chip">
            <input type="checkbox" class="diff-toggle" data-source="\${sourceKey}" data-setting="showMarkers" \${diff.showMarkers ? "checked" : ""}>
            <span>Show markers</span>
          </label>

          <label class="toggle-chip">
            <input type="checkbox" class="diff-toggle" data-source="\${sourceKey}" data-setting="showLegend" \${diff.showLegend ? "checked" : ""}>
            <span>Show legend</span>
          </label>

          <button data-diff-reset="\${sourceKey}">Reset diff</button>
        </div>
      </div>
      \${diff.showLegend ? renderLegendHtml() : ""}
    \` : ""}
  \`;

  el.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.modeBySource[sourceKey] = btn.dataset.mode;
      rerender();
    });
  });

  const slider = el.querySelector('input[data-role="frame-slider"]');
  if (slider) {
    slider.addEventListener("input", (e) => {
      state.indexBySource[sourceKey] = Number(e.target.value) || 0;
      rerender();
    });
  }

  const loadFramesBtn = el.querySelector(\`button[data-load-frames="\${sourceKey}"]\`);
  if (loadFramesBtn) {
    loadFramesBtn.addEventListener("click", async () => {
      await hydrateSourceFrames(sourceKey);
    });
  }

  el.querySelectorAll(".diff-range").forEach((input) => {
    input.addEventListener("input", () => {
      getDiffSettings(sourceKey)[input.dataset.setting] = Number(input.value);
      rerender();
    });
  });

  el.querySelectorAll(".diff-toggle").forEach((input) => {
    input.addEventListener("change", () => {
      getDiffSettings(sourceKey)[input.dataset.setting] = !!input.checked;
      rerender();
    });
  });

  const resetBtn = el.querySelector(\`button[data-diff-reset="\${sourceKey}"]\`);
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      state.diffSettingsBySource[sourceKey] = defaultDiffSettings();
      rerender();
    });
  }

  return el;
}

function renderLegendHtml() {
  return \`
    <div class="legend">
      <div class="legend-item"><span class="legend-swatch" style="background:#ffe36e"></span>Positive change</div>
      <div class="legend-item"><span class="legend-swatch" style="background:#5ed4ff"></span>Negative change</div>
      <div class="legend-item"><span class="legend-swatch" style="background:#ff6b6b"></span>Marker hits</div>
    </div>
  \`;
}

function rerender(){
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
    const res = await fetch(
      \`/api/frames?source=\${encodeURIComponent(sourceKey)}&hours=\${RETENTION_HOURS}\`,
      { cache: "no-store" }
    );
    const data = await res.json();
    if (!data?.ok && data?.frames == null) throw new Error(data?.error || "Failed to load frames");

    const frames = data.frames || [];
    state.data.sources[sourceKey].frames = frames;
    state.framesLoadedBySource[sourceKey] = true;
    state.indexBySource[sourceKey] = Math.min(
      state.indexBySource[sourceKey] || Math.max(0, frames.length - 1),
      Math.max(0, frames.length - 1)
    );
    setStatus("Loaded " + frames.length + " frames for " + sourceKey);
  } catch (err) {
    setStatus(err.message || String(err));
  } finally {
    state.loadingFramesBySource[sourceKey] = false;
    rerender();
  }
}

async function renderAllDiffs(){
  if (!state.data) return;
  for (const key of SOURCE_ORDER) {
    if ((state.modeBySource[key] || "raw") !== "diff") continue;
    await renderDiffForSource(key);
  }
}

async function renderDiffForSource(sourceKey){
  const source = state.data.sources[sourceKey];
  const items = source?.frames || [];
  const idx = Math.min(state.indexBySource[sourceKey] || 0, Math.max(0, items.length - 1));
  const curr = items[idx];
  const prev = items[Math.max(0, idx - 1)];
  const canvas = document.querySelector(\`canvas[data-diff-canvas="\${sourceKey}"]\`);
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;

  if (!curr || !prev || curr.url === prev.url) {
    canvas.width = 1200;
    canvas.height = 600;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#050b14";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#9ab1cc";
    ctx.font = "16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Load more than one frame to view difference imagery.", canvas.width / 2, canvas.height / 2);
    return;
  }

  const settings = getDiffSettings(sourceKey);

  const [imgA, imgB] = await Promise.all([loadImage(prev.url), loadImage(curr.url)]);
  const width = Math.min(imgA.naturalWidth || imgA.width, imgB.naturalWidth || imgB.width);
  const height = Math.min(imgA.naturalHeight || imgA.height, imgB.naturalHeight || imgB.height);

  canvas.width = width;
  canvas.height = height;

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
      const r1 = dataA.data[i], g1 = dataA.data[i+1], b1 = dataA.data[i+2];
      const r2 = dataB.data[i], g2 = dataB.data[i+1], b2 = dataB.data[i+2];
      const l1 = 0.2126*r1 + 0.7152*g1 + 0.0722*b1;
      const l2 = 0.2126*r2 + 0.7152*g2 + 0.0722*b2;
      let d = (l2 - l1) * gain;
      const ad = Math.abs(d);

      if (settings.showContext) {
        const base = Math.pow(l2 / 255, gamma) * 255;
        out.data[i] = base * 0.25; out.data[i+1] = base * 0.25; out.data[i+2] = base * 0.25;
      } else {
        out.data[i] = 0; out.data[i+1] = 0; out.data[i+2] = 0;
      }
      out.data[i+3] = 255;

      if (ad <= floor) continue;

      const mag = clamp(Math.pow((ad - floor) / (255 - floor), gamma) * 255, 0, 255);

      if (d >= 0) {
        out.data[i] = clamp(out.data[i] + mag, 0, 255);
        out.data[i+1] = clamp(out.data[i+1] + mag * 0.88, 0, 255);
        out.data[i+2] = clamp(out.data[i+2] + mag * 0.30, 0, 255);
      } else {
        out.data[i] = clamp(out.data[i] + mag * 0.18, 0, 255);
        out.data[i+1] = clamp(out.data[i+1] + mag * 0.72, 0, 255);
        out.data[i+2] = clamp(out.data[i+2] + mag, 0, 255);
      }

      if (settings.showMarkers && x % sampleStep === 0 && y % sampleStep === 0 && mag >= markThreshold) {
        hits.push({ x, y, score: mag });
      }
    }
  }

  ctx.putImageData(out, 0, 0);

  if (settings.showMarkers && hits.length) {
    const reduced = clusterHits(hits, 36).slice(0, 30);
    ctx.save();
    for (const hit of reduced) {
      const radius = 9;
      ctx.beginPath();
      ctx.arc(hit.x, hit.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,107,107,0.95)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(hit.x - 14, hit.y); ctx.lineTo(hit.x + 14, hit.y);
      ctx.moveTo(hit.x, hit.y - 14); ctx.lineTo(hit.x, hit.y + 14);
      ctx.strokeStyle = "rgba(255,107,107,0.75)";
      ctx.lineWidth = 1.25;
      ctx.stroke();
    }
    ctx.restore();
  }

  if (settings.showLegend) {
    drawCanvasLegend(ctx, width, height, { prevTs: prev.ts, currTs: curr.ts, hits: hits.length });
  }
}

function clusterHits(hits, minDistance) {
  const out = [];
  const sorted = [...hits].sort((a, b) => b.score - a.score);
  for (const hit of sorted) {
    let tooClose = false;
    for (const kept of out) {
      const dx = kept.x - hit.x, dy = kept.y - hit.y;
      if (Math.sqrt(dx*dx + dy*dy) < minDistance) { tooClose = true; break; }
    }
    if (!tooClose) out.push(hit);
  }
  return out;
}

function drawCanvasLegend(ctx, width, height, meta) {
  const pad = 14;
  const boxW = Math.min(360, width - pad * 2);
  const boxH = 64;
  ctx.save();
  ctx.fillStyle = "rgba(5,10,18,0.72)";
  roundRect(ctx, pad, pad, boxW, boxH, 12);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  roundRect(ctx, pad, pad, boxW, boxH, 12);
  ctx.stroke();
  ctx.fillStyle = "#e9f2ff";
  ctx.font = "bold 12px sans-serif";
  ctx.fillText("Difference imagery", pad + 12, pad + 18);
  ctx.font = "11px sans-serif";
  ctx.fillStyle = "#9ab1cc";
  ctx.fillText("Prev: " + safeShortTime(meta.prevTs), pad + 12, pad + 36);
  ctx.fillText("Curr: " + safeShortTime(meta.currTs), pad + 12, pad + 52);
  const swY = pad + 20, swX = pad + 180;
  drawSwatch(ctx, swX, swY, "#ffe36e", "positive");
  drawSwatch(ctx, swX, swY + 16, "#5ed4ff", "negative");
  drawSwatch(ctx, swX, swY + 32, "#ff6b6b", "hits: " + meta.hits);
  ctx.restore();
}

function drawSwatch(ctx, x, y, color, label) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y - 8, 18, 8);
  ctx.fillStyle = "#9ab1cc";
  ctx.font = "11px sans-serif";
  ctx.fillText(label, x + 26, y);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function safeShortTime(ts) {
  try { return new Date(ts).toLocaleString(); } catch { return ts || "n/a"; }
}

const imageCache = new Map();

async function loadImage(url) {
  if (imageCache.has(url)) return imageCache.get(url);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image: " + url));
    img.src = url;
  });
  imageCache.set(url, p);
  return p;
}

document.getElementById("refreshUi").addEventListener("click", () => {
  load().catch(err => setStatus(err.message || String(err)));
});

document.getElementById("refreshNow").addEventListener("click", async () => {
  try {
    setStatus("Refreshing latest source images…");
    const res = await fetch("/api/refresh", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Refresh failed");
    setStatus("Refresh complete.");
    await load();
    console.log(data);
  } catch (err) { setStatus(err.message || String(err)); }
});

document.getElementById("backfillNow").addEventListener("click", async () => {
  try {
    setStatus("Backfilling last 24 hours…");
    const res = await fetch("/api/backfill", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Backfill failed");
    setStatus("Backfill complete.");
    await load();
    console.log(data);
  } catch (err) { setStatus(err.message || String(err)); }
});

document.getElementById("migrateNow").addEventListener("click", async () => {
  try {
    setStatus("Migrating existing PNGs to JPG…");
    const res = await fetch("/api/migrate-to-jpg", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Migration failed");
    setStatus("Migration complete.");
    await load();
    console.log(data);
  } catch (err) { setStatus(err.message || String(err)); }
});

load().catch(err => { setStatus(err.message || String(err)); });
</script>
</body>
</html>`;
}
