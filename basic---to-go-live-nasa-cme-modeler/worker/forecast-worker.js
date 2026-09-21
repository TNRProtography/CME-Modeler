/**
 * Spot The Aurora - Solar Wind Forecast Worker
 *
 * Computes one forecast on a cron and serves it to everybody, then scores it
 * against what the spacecraft at L1 actually measured.
 *
 * WHY SERVER-SIDE
 * ───────────────
 * Three reasons, and the third is the one that matters.
 *
 *  1. Phones do no physics. The ensemble is a few hundred runs.
 *  2. Every device shows the same numbers. Two people comparing screens is a
 *     support problem that simply does not arise if there is one forecast.
 *  3. Notifications can use it. A forecast that only exists inside an open
 *     browser tab cannot tell anybody a stream is arriving tonight, and that
 *     is most of the value.
 *
 * WHAT IT CANNOT DO
 * ─────────────────
 * Detect coronal holes. That needs a canvas and pixel access, which a Worker
 * does not have, so detection stays in the browser and the results are posted
 * to ch-history-worker. This reads them back. If no client has opened the app
 * recently there is nothing fresh to read, and the forecast says so rather
 * than quietly serving stale holes as current.
 *
 * DEPLOYING
 * ─────────
 *   wrangler kv namespace create FORECAST_KV
 *   # put the returned id into wrangler-forecast.toml
 *   wrangler deploy --config wrangler-forecast.toml
 */

const CH_HISTORY_URL = 'https://ch-history-worker.thenamesrock.workers.dev';
const RTSW_URL = 'https://imap-solar-data-test.thenamesrock.workers.dev/rtsw/merged-24h';

const TIMELINE_KEY = 'forecast:timeline:current';
const FORECASTS_KEY = 'forecast:pending';
const SCORES_KEY = 'forecast:scores';

/** Keep a rolling window rather than growing without limit. */
const MAX_PENDING = 60;
const MAX_SCORES = 200;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300',
  },
});

const readJson = async (kv, key, fallback) => {
  try {
    const raw = await kv.get(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

// ── inputs ───────────────────────────────────────────────────────────────

async function fetchCoronalHoles() {
  try {
    const res = await fetch(`${CH_HISTORY_URL}/history`, { cf: { cacheTtl: 300 } });
    if (!res.ok) return { holes: [], asOfMs: null };
    const data = await res.json();
    const snapshots = Array.isArray(data?.snapshots) ? data.snapshots : [];
    if (snapshots.length === 0) return { holes: [], asOfMs: null };
    const newest = snapshots.reduce((a, b) => (a.timestampMs >= b.timestampMs ? a : b));
    return { holes: newest.coronalHoles ?? [], asOfMs: newest.timestampMs ?? null };
  } catch {
    return { holes: [], asOfMs: null };
  }
}

async function fetchObservedWind() {
  try {
    const res = await fetch(RTSW_URL, { cf: { cacheTtl: 120 } });
    if (!res.ok) return [];
    const data = await res.json();
    const rows = Array.isArray(data) ? data : (data?.data ?? []);
    return rows.map((row) => ({
      atMs: new Date(row.time_tag ?? row.time_utc ?? row.time).getTime(),
      speedKms: Number(row.speed ?? row.proton_speed ?? null),
      densityCm3: Number(row.density ?? row.proton_density ?? null),
      btNt: Number(row.bt ?? null),
      bzNt: Number(row.bz ?? row.bz_gsm ?? null),
    })).filter((s) => Number.isFinite(s.atMs));
  } catch {
    return [];
  }
}

// ── the forecast ─────────────────────────────────────────────────────────

/**
 * Build and store a forecast.
 *
 * The heavy lifting lives in the app's own modules, which are plain functions
 * with no browser dependencies precisely so this can share them. Rather than
 * duplicate the physics here - a second copy is a second thing to drift - the
 * bundled build is imported. See wrangler-forecast.toml for the build step.
 */
export async function runForecast(env, modules) {
  const { buildForecastTimeline, chEarthConnection, hssArrivalEnsemble,
          measurementConfidence, buildOutlook, solarDiskOrientation } = modules;

  const [{ holes, asOfMs }, observed] = await Promise.all([
    fetchCoronalHoles(),
    fetchObservedWind(),
  ]);

  const now = Date.now();
  const { b0 } = solarDiskOrientation(new Date(now));

  const streams = [];
  const issued = [];

  for (const hole of holes) {
    const connection = chEarthConnection(hole.lat, b0);
    // A polar hole crosses the middle of the disk exactly like an equatorial
    // one and sends its wind over the top of us. No forecast for it.
    if (!connection.reachesEarth) continue;

    const daysToMeridian = (0 - hole.lon) / (360 / 27.2753);
    const centralMeridianMs = now + daysToMeridian * 86400000;
    const speedKms = hole.estimatedSpeedKms ?? 500;

    streams.push({
      id: hole.id,
      centralMeridianMs,
      peakSpeedKms: speedKms,
      widthDeg: hole.widthDeg ?? 20,
      bySign: hole.bySign ?? null,
      earthConnection: connection.factor,
    });

    const confidence = measurementConfidence(
      hole.sampleCount ?? 6, hole.spanHours ?? 12, hole.lon ?? 0);
    const ensemble = hssArrivalEnsemble({ centralMeridianMs, speedKms, confidence });
    if (ensemble && ensemble.medianMs > now) {
      issued.push({
        id: `${hole.id}-${Math.round(centralMeridianMs / 3600000)}`,
        issuedAtMs: now,
        sourceId: hole.id,
        kind: 'HSS',
        predictedArrivalMs: ensemble.medianMs,
        p10Ms: ensemble.p10Ms,
        p90Ms: ensemble.p90Ms,
        predictedSpeedKms: ensemble.medianSpeedKms,
      });
    }
  }

  const timeline = buildForecastTimeline(observed, streams, {
    fromMs: now - 3 * 86400000,
    toMs: now + 7 * 86400000,
    stepMs: 3600000,
  });

  const payload = {
    generatedAtMs: now,
    coronalHolesAsOfMs: asOfMs,
    // Said out loud rather than implied. Nobody can tell stale holes from
    // fresh ones by looking at a forecast.
    stale: asOfMs == null || now - asOfMs > 6 * 3600000,
    streams,
    timeline,
    outlook: buildOutlook(timeline),
  };

  await env.FORECAST_KV.put(TIMELINE_KEY, JSON.stringify(payload), { expirationTtl: 86400 });

  // Remember what was promised, so it can be marked later. Keyed by id so a
  // re-run does not store the same forecast twice.
  if (issued.length > 0) {
    const pending = await readJson(env.FORECAST_KV, FORECASTS_KEY, []);
    const byId = new Map(pending.map((f) => [f.id, f]));
    for (const forecast of issued) if (!byId.has(forecast.id)) byId.set(forecast.id, forecast);
    const kept = [...byId.values()].sort((a, b) => b.issuedAtMs - a.issuedAtMs).slice(0, MAX_PENDING);
    await env.FORECAST_KV.put(FORECASTS_KEY, JSON.stringify(kept));
  }

  return payload;
}

/** Mark any forecast whose window has closed against what actually arrived. */
export async function runScoring(env, modules) {
  const { detectArrival, scoreForecast, dueForScoring } = modules;

  const pending = await readJson(env.FORECAST_KV, FORECASTS_KEY, []);
  const due = dueForScoring(pending);
  if (due.length === 0) return { scored: 0 };

  const observed = await fetchObservedWind();
  if (observed.length < 8) return { scored: 0, reason: 'no L1 data' };

  const scores = await readJson(env.FORECAST_KV, SCORES_KEY, []);
  const alreadyScored = new Set(scores.map((s) => s.forecastId));
  let scored = 0;

  for (const forecast of due) {
    if (alreadyScored.has(forecast.id)) continue;
    const arrival = detectArrival(
      observed,
      forecast.p10Ms - 12 * 3600000,
      forecast.p90Ms + 24 * 3600000,
    );
    // No arrival found is not a zero score - it is no data point. Scoring a
    // forecast against a stream that never came would corrupt the record,
    // and a corrupted record is worse than none because it gets believed.
    if (!arrival) continue;
    scores.push(scoreForecast(forecast, arrival));
    scored++;
  }

  if (scored > 0) {
    const kept = scores.slice(-MAX_SCORES);
    await env.FORECAST_KV.put(SCORES_KEY, JSON.stringify(kept));
  }

  // Drop anything too old to ever be scored, so the list does not grow.
  const stillPending = pending.filter((f) => Date.now() < f.p90Ms + 7 * 86400000);
  if (stillPending.length !== pending.length) {
    await env.FORECAST_KV.put(FORECASTS_KEY, JSON.stringify(stillPending));
  }

  return { scored };
}

export function makeHandler(modules) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);

      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,OPTIONS',
          },
        });
      }

      if (url.pathname === '/forecast') {
        const stored = await readJson(env.FORECAST_KV, TIMELINE_KEY, null);
        if (!stored) return json({ ok: false, error: 'No forecast computed yet' }, 503);
        return json({ ok: true, ...stored });
      }

      if (url.pathname === '/track-record') {
        const scores = await readJson(env.FORECAST_KV, SCORES_KEY, []);
        return json({ ok: true, ...modules.buildTrackRecord(scores), scores: scores.slice(-20) });
      }

      if (url.pathname === '/health') {
        const stored = await readJson(env.FORECAST_KV, TIMELINE_KEY, null);
        return json({
          ok: true,
          hasForecast: !!stored,
          generatedAtMs: stored?.generatedAtMs ?? null,
          ageMinutes: stored ? Math.round((Date.now() - stored.generatedAtMs) / 60000) : null,
          stale: stored?.stale ?? null,
        });
      }

      return json({ ok: false, error: 'Not found' }, 404);
    },

    async scheduled(event, env, ctx) {
      ctx.waitUntil((async () => {
        await runForecast(env, modules);
        await runScoring(env, modules);
      })());
    },
  };
}
