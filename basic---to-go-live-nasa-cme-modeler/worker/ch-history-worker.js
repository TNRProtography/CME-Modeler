// CH History Worker v2 — paste this into the Cloudflare dashboard editor
// KV binding name: CH_HISTORY
//
// Changes from v1:
//   - MAX_SNAPSHOTS increased from 36 to 144 (72h at 30-min intervals)
//   - Deduplication: won't store a snapshot if one exists within 10 minutes
//   - Status endpoint shows config values for debugging

const SWPC_ANIM_DIR = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/195/';
const MAX_HISTORY_HOURS = 72;
const MAX_SNAPSHOTS = 144;
const DEDUP_WINDOW_MS = 10 * 60 * 1000;  // 10 minutes
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=120, s-maxage=120',
      ...CORS_HEADERS,
    },
  });
}

function corsResponse(status = 204) {
  return new Response(null, { status, headers: CORS_HEADERS });
}

async function scrapeSuviFrameUrls() {
  try {
    const resp = await fetch(SWPC_ANIM_DIR, {
      headers: { 'User-Agent': 'cme-modeler-ch-history/1.0' },
    });
    if (!resp.ok) return [];
    const html = await resp.text();

    const frameRegex = /href="(or_suvi-l2-ci195_g\d+_s(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z_[^"]+\.png)"/g;
    const frames = [];
    let match;

    while ((match = frameRegex.exec(html)) !== null) {
      const [, filename, yr, mo, dy, hr, mi, sc] = match;
      const isoStr = `${yr}-${mo}-${dy}T${hr}:${mi}:${sc}Z`;
      const timestamp = new Date(isoStr);
      if (!isNaN(timestamp.getTime())) {
        frames.push({
          url: SWPC_ANIM_DIR + filename,
          timestamp: isoStr,
          timestampMs: timestamp.getTime(),
        });
      }
    }

    frames.sort((a, b) => b.timestampMs - a.timestampMs);
    return frames;
  } catch (err) {
    console.error('[CH Worker] Failed to scrape SUVI directory:', err);
    return [];
  }
}

function pickFramesEvery2Hours(frames) {
  if (frames.length === 0) return [];
  const picked = [frames[0]];
  const INTERVAL_MS = 2 * 3600 * 1000;
  let lastPickedMs = frames[0].timestampMs;

  for (let i = 1; i < frames.length; i++) {
    if (lastPickedMs - frames[i].timestampMs >= INTERVAL_MS * 0.8) {
      picked.push(frames[i]);
      lastPickedMs = frames[i].timestampMs;
    }
  }
  return picked;
}

async function getSnapshotIndex(kv) {
  const raw = await kv.get('ch-snapshot-index');
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

async function saveSnapshot(kv, record) {
  const key = `ch-snapshot:${record.timestamp}`;
  const newMs = record.timestampMs;

  // Dedup: don't store if we already have a snapshot within 10 minutes
  const index = await getSnapshotIndex(kv);
  for (const existingKey of index) {
    const existingTs = existingKey.replace('ch-snapshot:', '');
    const existingMs = new Date(existingTs).getTime();
    if (!isNaN(existingMs) && Math.abs(existingMs - newMs) < DEDUP_WINDOW_MS) {
      return;  // Already have a snapshot near this time
    }
  }

  // Store with 96h TTL (buffer beyond 72h)
  await kv.put(key, JSON.stringify(record), { expirationTtl: 4 * 24 * 3600 });

  if (!index.includes(key)) {
    index.push(key);
    index.sort();

    // Evict oldest if over limit
    while (index.length > MAX_SNAPSHOTS) {
      const oldKey = index.shift();
      await kv.delete(oldKey);
    }

    await kv.put('ch-snapshot-index', JSON.stringify(index), { expirationTtl: 4 * 24 * 3600 });
  }
}

async function getAllSnapshots(kv) {
  const index = await getSnapshotIndex(kv);
  const cutoff = Date.now() - MAX_HISTORY_HOURS * 3600 * 1000;
  const snapshots = [];

  for (const key of index) {
    const raw = await kv.get(key);
    if (!raw) continue;
    try {
      const record = JSON.parse(raw);
      if (record.timestampMs >= cutoff) snapshots.push(record);
    } catch { /* skip corrupt */ }
  }

  snapshots.sort((a, b) => a.timestampMs - b.timestampMs);
  return snapshots;
}

// ─── Route handlers ──────────────────────────────────────────────────

async function handleGetHistory(env) {
  const snapshots = await getAllSnapshots(env.CH_HISTORY);
  return jsonResponse({
    snapshots,
    count: snapshots.length,
    oldestMs: snapshots[0]?.timestampMs ?? null,
    newestMs: snapshots[snapshots.length - 1]?.timestampMs ?? null,
    maxHours: MAX_HISTORY_HOURS,
  });
}

async function handlePostSnapshot(request, env) {
  try {
    const body = await request.json();
    if (!body.timestamp || !body.coronalHoles || !Array.isArray(body.coronalHoles)) {
      return jsonResponse({ error: 'Invalid snapshot format' }, 400);
    }
    if (!body.timestampMs) {
      body.timestampMs = new Date(body.timestamp).getTime();
    }
    await saveSnapshot(env.CH_HISTORY, body);
    return jsonResponse({ ok: true, stored: body.timestamp });
  } catch (err) {
    return jsonResponse({ error: 'Failed to store snapshot', detail: String(err) }, 500);
  }
}

async function handleGetFrames(env) {
  const cached = await env.CH_HISTORY.get('suvi-frame-urls');
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed._cachedAt && Date.now() - parsed._cachedAt < 30 * 60 * 1000) {
        return jsonResponse(parsed);
      }
    } catch { /* fall through */ }
  }

  const allFrames = await scrapeSuviFrameUrls();
  const picked = pickFramesEvery2Hours(allFrames);

  const result = {
    frames: picked,
    totalAvailable: allFrames.length,
    pickedCount: picked.length,
    _cachedAt: Date.now(),
  };

  await env.CH_HISTORY.put('suvi-frame-urls', JSON.stringify(result), { expirationTtl: 1800 });
  return jsonResponse(result);
}

async function handleGetStatus(env) {
  const index = await getSnapshotIndex(env.CH_HISTORY);
  const snapshots = await getAllSnapshots(env.CH_HISTORY);

  return jsonResponse({
    totalKeysInIndex: index.length,
    snapshotsInRange: snapshots.length,
    oldestSnapshot: snapshots[0]?.timestamp ?? null,
    newestSnapshot: snapshots[snapshots.length - 1]?.timestamp ?? null,
    coverageHours: snapshots.length > 1
      ? ((snapshots[snapshots.length - 1].timestampMs - snapshots[0].timestampMs) / 3600000).toFixed(1)
      : '0',
    config: {
      maxSnapshots: MAX_SNAPSHOTS,
      maxHistoryHours: MAX_HISTORY_HOURS,
      dedupWindowMinutes: DEDUP_WINDOW_MS / 60000,
    },
  });
}

async function handleCron(env) {
  console.log('[CH Worker] Cron triggered - refreshing SUVI frame index');
  try {
    const allFrames = await scrapeSuviFrameUrls();
    const picked = pickFramesEvery2Hours(allFrames);
    const result = {
      frames: picked,
      totalAvailable: allFrames.length,
      pickedCount: picked.length,
      _cachedAt: Date.now(),
    };
    await env.CH_HISTORY.put('suvi-frame-urls', JSON.stringify(result), { expirationTtl: 3600 });
    console.log(`[CH Worker] Indexed ${picked.length} frames (${allFrames.length} total)`);
  } catch (err) {
    console.error('[CH Worker] Cron failed:', err);
  }
}

// ─── Worker export ───────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return corsResponse();

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/ch-history' && request.method === 'GET') return handleGetHistory(env);
    if (path === '/ch-history' && request.method === 'POST') return handlePostSnapshot(request, env);
    if (path === '/ch-history/frames' && request.method === 'GET') return handleGetFrames(env);
    if (path === '/ch-history/status' && request.method === 'GET') return handleGetStatus(env);

    return new Response('Not found', { status: 404, headers: CORS_HEADERS });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleCron(env));
  },
};

