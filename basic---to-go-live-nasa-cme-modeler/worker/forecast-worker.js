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
const LAST_RUN_KEY = 'forecast:last-run';

/** Throttle for the manual /run trigger. */
const MIN_MANUAL_RUN_GAP_MS = 60000;

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

/** What actually came back, so a 404 can be told apart from another 404. */
const describeFailure = async (res) => {
  let body = '';
  try {
    body = (await res.text()).slice(0, 120).replace(/\s+/g, ' ').trim();
  } catch {
    body = '<unreadable>';
  }
  return `HTTP ${res.status} from ${new URL(res.url || 'https://unknown/').hostname}: ${body}`;
};

/** Best effort: a broken binding must not turn one failure into two. */
const recordRun = async (env, entry) => {
  try {
    await env?.FORECAST_KV?.put(LAST_RUN_KEY, JSON.stringify(entry), { expirationTtl: 604800 });
  } catch {
    /* nothing useful to do here */
  }
};

// ── inputs ───────────────────────────────────────────────────────────────

/**
 * Both upstreams are Workers on the same workers.dev subdomain as this one.
 * A subrequest from here to those hostnames does not leave Cloudflare and
 * comes back as this worker's own 404 rather than reaching them - which is
 * why two unrelated feeds failed identically while both answered fine in a
 * browser. A service binding addresses the other Worker directly, so the
 * request never goes near the public hostname.
 *
 * The binding's fetch ignores the host, but still needs a valid absolute URL,
 * hence the placeholder. Falling back to plain fetch keeps this working if a
 * binding is missing, and the note says which path was taken.
 */
const callUpstream = async (binding, url, init) => {
  if (binding && typeof binding.fetch === 'function') {
    return { res: await binding.fetch(new Request(url, init)), via: 'binding' };
  }
  return { res: await fetch(url, init), via: 'public url' };
};

async function fetchCoronalHoles(env) {
  const startedMs = Date.now();
  try {
    // /ch-history, not /history. The app has always called it by that name;
    // this worker guessed, and a guess that 404s looks exactly like a quiet
    // sky, which is the worst way for an input to fail.
    const { res, via } = await callUpstream(
      env?.CH_HISTORY, `${CH_HISTORY_URL}/ch-history`, { cf: { cacheTtl: 300 } });
    lastHolesVia = via;
    // The body, not just the status. Two unrelated upstreams both answering
    // 404 is the signature of a subrequest being routed back to this worker,
    // whose own 404 body is distinctive - and that is a completely different
    // problem from an upstream that is genuinely missing a route.
    if (!res.ok) {
      return { holes: [], asOfMs: null, upstream: await describeFailure(res), ms: Date.now() - startedMs };
    }
    const data = await res.json();
    const snapshots = Array.isArray(data?.snapshots) ? data.snapshots : [];
    if (snapshots.length === 0) {
      return { holes: [], asOfMs: null, upstream: 'no snapshots', ms: Date.now() - startedMs };
    }
    const newest = snapshots.reduce((a, b) => (a.timestampMs >= b.timestampMs ? a : b));
    return {
      holes: newest.coronalHoles ?? [],
      asOfMs: newest.timestampMs ?? null,
      upstream: `ok, ${snapshots.length} snapshots`,
      ms: Date.now() - startedMs,
    };
  } catch (error) {
    return {
      holes: [], asOfMs: null,
      upstream: `failed: ${String(error?.message ?? error)}`,
      ms: Date.now() - startedMs,
    };
  }
}

// Set by the fetch below so a run can report what its input actually did.
// An empty array is returned for a 404, a parse failure and a genuinely quiet
// feed alike, and those are three different problems.
let lastWindNote = 'not fetched';
let lastWindVia = 'unknown';
let lastWindMs = null;
let lastHolesVia = 'unknown';
let lastInputNotes = null;

async function fetchObservedWind(env) {
  lastWindNote = 'not fetched';
  const startedMs = Date.now();
  lastWindMs = null;
  try {
    const { res, via } = await callUpstream(env?.RTSW, RTSW_URL, { cf: { cacheTtl: 120 } });
    lastWindVia = via;
    if (!res.ok) { lastWindNote = await describeFailure(res); return []; }
    const data = await res.json();
    const rows = Array.isArray(data) ? data : (data?.data ?? []);
    const parsed = rows.map((row) => ({
      atMs: new Date(row.time_tag ?? row.time_utc ?? row.time).getTime(),
      speedKms: Number(row.speed ?? row.proton_speed ?? null),
      densityCm3: Number(row.density ?? row.proton_density ?? null),
      btNt: Number(row.bt ?? null),
      bzNt: Number(row.bz ?? row.bz_gsm ?? null),
    })).filter((s) => Number.isFinite(s.atMs));
    lastWindNote = `ok, ${parsed.length} of ${rows.length} rows usable`;
    lastWindMs = Date.now() - startedMs;
    return parsed;
  } catch (error) {
    lastWindNote = `failed: ${String(error?.message ?? error)}`;
    lastWindMs = Date.now() - startedMs;
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

  const modelStartedMs = Date.now();
  const [{ holes, asOfMs, upstream: holesNote, ms: holesMs }, observed] = await Promise.all([
    fetchCoronalHoles(env),
    fetchObservedWind(env),
  ]);
  lastInputNotes = {
    coronalHoles: holesNote ?? 'unknown',
    holeCount: holes.length,
    holesVia: lastHolesVia,
    holesMs,
    wind: lastWindNote,
    windSamples: observed.length,
    windVia: lastWindVia,
    windMs: lastWindMs,
    // Both fetches run in parallel, so the model's own cost is whatever is
    // left after the slower of the two. That is the number to look at before
    // blaming the physics for a slow run.
    fetchMs: Date.now() - modelStartedMs,
  };

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
    inputs: { ...lastInputNotes, modelMs: Date.now() - modelStartedMs - lastInputNotes.fetchMs },
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

  const observed = await fetchObservedWind(env);
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

      // Forcing a run, for when waiting an hour to find out whether a fix
      // worked is the slowest part of fixing it. Deliberately unauthenticated
      // but self-limiting: inside the throttle it reports how long is left
      // and does nothing, so it cannot be used to hammer the upstreams or to
      // burn through the daily KV write allowance.
      if (url.pathname === '/run') {
        if (!env.FORECAST_KV) return json({ ok: false, error: 'FORECAST_KV binding is missing' }, 500);
        const last = await readJson(env.FORECAST_KV, LAST_RUN_KEY, null);
        const sinceMs = last?.startedMs ? Date.now() - last.startedMs : Infinity;
        if (sinceMs < MIN_MANUAL_RUN_GAP_MS) {
          return json({
            ok: false,
            error: 'Ran too recently',
            waitSeconds: Math.ceil((MIN_MANUAL_RUN_GAP_MS - sinceMs) / 1000),
            lastRun: last,
          }, 429);
        }
        const startedMs = Date.now();
        try {
          const payload = await runForecast(env, modules);
          const scoring = await runScoring(env, modules);
          const entry = {
            ok: true, startedMs, finishedMs: Date.now(),
            scored: scoring?.scored ?? 0, inputs: payload.inputs, manual: true,
          };
          await recordRun(env, entry);
          return json({ ok: true, lastRun: entry });
        } catch (error) {
          const entry = {
            ok: false, startedMs, finishedMs: Date.now(),
            error: String(error?.message ?? error), manual: true,
          };
          await recordRun(env, entry);
          return json({ ok: false, lastRun: entry }, 500);
        }
      }

      if (url.pathname === '/health') {
        // readJson swallows every error, including the binding being absent,
        // so asking it whether a forecast exists cannot tell a working worker
        // with no data yet from a worker that cannot reach KV at all. Those
        // need different fixes, so probe the binding directly and say which.
        let kv = 'ok';
        if (!env.FORECAST_KV) {
          kv = 'missing';
        } else {
          try {
            await env.FORECAST_KV.get(TIMELINE_KEY);
          } catch (error) {
            kv = `error: ${String(error?.message ?? error)}`;
          }
        }

        const stored = kv === 'ok' ? await readJson(env.FORECAST_KV, TIMELINE_KEY, null) : null;
        const lastRun = kv === 'ok' ? await readJson(env.FORECAST_KV, LAST_RUN_KEY, null) : null;

        return json({
          ok: kv === 'ok',
          kv,
          hasForecast: !!stored,
          generatedAtMs: stored?.generatedAtMs ?? null,
          ageMinutes: stored ? Math.round((Date.now() - stored.generatedAtMs) / 60000) : null,
          stale: stored?.stale ?? null,
          // null here means the scheduled handler has never completed a run,
          // which points at the trigger rather than at anything inside it.
          lastRun,
        }, kv === 'ok' ? 200 : 500);
      }

      return json({ ok: false, error: 'Not found' }, 404);
    },

    async scheduled(event, env, ctx) {
      // Anything thrown inside waitUntil is lost: no response carries it, and
      // with observability off there is nowhere to read it. A cron that fails
      // every minute then looks exactly like a cron that never fired, which
      // is not a distinction anyone should have to make by guessing. So the
      // outcome of every run is written down, success or failure, and /health
      // reports it.
      ctx.waitUntil((async () => {
        const startedMs = Date.now();
        try {
          if (!env.FORECAST_KV) throw new Error('FORECAST_KV binding is missing');
          await runForecast(env, modules);
          const scoring = await runScoring(env, modules);
          await recordRun(env, {
            ok: true, startedMs, finishedMs: Date.now(), scored: scoring?.scored ?? 0,
            inputs: lastInputNotes,
          });
        } catch (error) {
          console.error('forecast cron failed', error);
          await recordRun(env, {
            ok: false, startedMs, finishedMs: Date.now(),
            error: String(error?.message ?? error),
            stack: String(error?.stack ?? '').split('\n').slice(0, 4).join('\n'),
          });
          throw error; // so the run also shows as errored in the dashboard
        }
      })());
    },
  };
}
