/**
 * Push Notification Worker - Spot The Aurora
 *
 * Source of truth for the live worker at
 * push-notification-worker.thenamesrock.workers.dev
 *
 * ── 2026-09 fixes ──────────────────────────────────────────────────────────
 * Everything except the nightly outlook and the admin broadcast had stopped
 * firing. Four separate causes, each of which failed silently:
 *
 * 1. SHOCKS COULD NEVER FIRE WITHOUT TEMPERATURE.
 *    The RTSW parser stored a missing temperature as 0 (`temp ?? 0`). The
 *    shock classifier then computed tmpRatio from tmp1 > 0, got NaN, and set
 *    both tUp and tDown to false. Every one of ff/sf/fr/sr requires one of
 *    those, and ff is the only type that notifies, so a missing temperature
 *    made shock notifications impossible rather than merely less certain.
 *    Temperature is now kept as null when absent, and the classifier treats
 *    it as corroborating evidence rather than a hard requirement.
 *
 * 2. visibility-dslr COULD NEVER FIRE.
 *    The tiers were tested naked, then phone, then dslr, but phone's
 *    threshold (distToVis <= -1) is looser than dslr's (<= -3). Anything that
 *    satisfied dslr had already matched phone, so the dslr branch was dead
 *    code. A DSLR sees fainter aurora than a phone, so dslr must be the
 *    loosest tier and must be tested last only after the stricter two miss.
 *    Thresholds corrected and the tier picked by strength, not by order.
 *
 * 3. A MISSING CONFIG KEY KILLED SUBSTORM ALERTS SILENTLY.
 *    checkSubstormActivity read substormThresholds.cooldownMinutes. If
 *    CONFIG_THRESHOLDS had no `substorm` key the property access threw, the
 *    function's own catch swallowed it, and nothing was ever sent. It now
 *    defaults instead of throwing.
 *
 * 4. THE SUBSTORM WORKER BEING DOWN TOOK VISIBILITY WITH IT.
 *    checkVisibilityNotifications returned early unless substormData had both
 *    current and metrics. The oval boundary can be computed from the RTSW
 *    data the worker already has, so it now falls back to that and says so in
 *    the logs rather than going quiet.
 *
 * Also added: /diagnostics, which reports for every detector whether it ran,
 * what data it had and why it did not fire, so this is never a guess again.
 * And scheduled broadcasts now chain through ctx.waitUntil, so a run is not
 * torn down after the first batch of 40.
 *
 * Shock topics:
 *   shock-ff   - Fast Forward Shock (CME/SIR front arrival)
 *   shock-sf   - Slow Forward Shock (weaker compression wave)
 *   shock-fr   - Fast Reverse Shock (CME trailing edge)
 *   shock-sr   - Slow Reverse Shock (trailing rarefaction)
 *   shock-imf  - IMF Enhancement / Discontinuity
 */

// --- API Endpoints ---
const NOAA_XRAY_URL    = 'https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json';
const RTSW_PROXY_URL   = 'https://imap-solar-data-test.thenamesrock.workers.dev/rtsw/merged-24h';
const SUBSTORM_URL     = 'https://aurora-index-sta.thenamesrock.workers.dev/api/substorm?resolution=5m';

// --- Constants ---
const BATCH_SIZE   = 40;
const MAX_CHAIN    = 50;
const KV_LIST_LIMIT = 1000;
const HEALTH_CHECK_THRESHOLD_MS = 10 * 60 * 1000;
const GREYMOUTH_LATITUDE = -42.45;

const POLE_LAT_RAD =  80.65 * Math.PI / 180;
const POLE_LON_RAD = -72.68 * Math.PI / 180;

// Every notification topic is strictly opt-in: a subscriber only receives it
// if preferences[topic] === true was explicitly set for that exact key.

const kv = (env) => env.SUBSCRIPTIONS_KV;

// Why each detector did or did not fire on the last scheduled run. Written to
// KV so /diagnostics can show it without anyone reading Cloudflare logs.
const DIAG_KEY = 'STATE_diagnostics';

function reportError(error, env, extra = {}) {
  console.error('Caught exception:', error, extra);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      console.error(`Fetch attempt ${i + 1} for ${url} failed: ${response.status}`);
    } catch (error) {
      console.error(`Fetch attempt ${i + 1} for ${url} error:`, error);
    }
    if (i < retries - 1) await sleep(delay * (i + 1));
  }
  return null;
}

// ── Shared value parser - matches the app's toFiniteNumber ──────────────────
function toFiniteNumber(value) {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function pickValue(entry, key) {
  const top = toFiniteNumber(entry?.[key]);
  if (top !== null) return top;
  const rtsw = toFiniteNumber(entry?.rtsw?.[key]);
  if (rtsw !== null) return rtsw;
  const imap = toFiniteNumber(entry?.imap?.[key]);
  if (imap !== null) return imap;
  return null;
}

// ── RTSW Merged Data Parser ─────────────────────────────────────────────────
// magPoints:    [{ ts, bz, bt, by }]
// plasmaPoints: [{ ts, density, speed, temp, pressure }]  temp is null if absent
async function fetchAndParseRtswData(env) {
  let res;
  try {
    if (env?.rtsw) {
      res = await env.rtsw.fetch(new Request('https://rtsw-binding/rtsw/merged-24h', {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      }));
      if (!res.ok) {
        console.error(`[rtsw-parse] Service binding fetch failed: ${res.status}`);
        res = null;
      }
    } else {
      console.warn('[rtsw-parse] env.rtsw binding not found - falling back to public URL');
      res = await fetchWithRetry(`${RTSW_PROXY_URL}?_=${Date.now()}`);
    }
  } catch (e) {
    console.error('[rtsw-parse] Fetch error:', e.message);
    res = null;
  }
  if (!res) {
    console.error('[rtsw-parse] All fetch attempts failed - returning empty data');
    return { magPoints: [], plasmaPoints: [], tempAvailable: false };
  }
  try {
    const payload = await res.json();
    const rows = Array.isArray(payload)
      ? payload
      : (payload?.ok && Array.isArray(payload.data) ? payload.data : []);

    if (!rows.length) {
      console.warn('[rtsw-parse] RTSW proxy returned ok but data array is empty');
      return { magPoints: [], plasmaPoints: [], tempAvailable: false };
    }

    const magPoints = [];
    const plasmaPoints = [];
    let tempCount = 0;

    for (const entry of rows) {
      const timeValue = entry.time_utc ?? entry.time_nz;
      const ts = timeValue ? new Date(timeValue).getTime() : NaN;
      if (!isFinite(ts)) continue;

      const bz      = pickValue(entry, 'bz');
      const bt      = pickValue(entry, 'bt');
      const by      = pickValue(entry, 'by');
      const speed   = pickValue(entry, 'speed');
      const density = pickValue(entry, 'density');
      const temp    = pickValue(entry, 'temp');

      const computedBt = bt !== null ? bt
        : (by !== null && bz !== null ? Math.sqrt(by * by + bz * bz) : null);

      if (bz !== null && computedBt !== null) {
        magPoints.push({ ts, bz, bt: computedBt, by: by ?? null });
      }

      if (density !== null && speed !== null) {
        const pressure = 1.6726e-6 * density * speed * speed;
        // FIX 1: temperature stays null when the feed does not carry it.
        // Storing 0 here made every shock classification impossible, because
        // the classifier needs tmp1 > 0 to produce a ratio at all.
        if (temp !== null && temp > 0) tempCount++;
        plasmaPoints.push({
          ts,
          density,
          speed,
          temp: (temp !== null && temp > 0) ? temp : null,
          pressure,
        });
      }
    }

    magPoints.sort((a, b) => a.ts - b.ts);
    plasmaPoints.sort((a, b) => a.ts - b.ts);

    const tempAvailable = tempCount >= Math.max(5, plasmaPoints.length * 0.2);

    console.log(`[rtsw-parse] Parsed ${rows.length} rows -> ${magPoints.length} mag, ${plasmaPoints.length} plasma, temp on ${tempCount} (usable=${tempAvailable})`);
    if (magPoints.length) {
      const latest = magPoints[magPoints.length - 1];
      console.log(`[rtsw-parse] Latest mag: bz=${latest.bz} bt=${latest.bt} age=${Math.round((Date.now() - latest.ts) / 60000)}min`);
    } else {
      console.warn('[rtsw-parse] WARNING: 0 mag points after parsing - all bz/bt values were null');
    }
    if (plasmaPoints.length) {
      const latest = plasmaPoints[plasmaPoints.length - 1];
      console.log(`[rtsw-parse] Latest plasma: speed=${Math.round(latest.speed)} density=${latest.density.toFixed(1)} age=${Math.round((Date.now() - latest.ts) / 60000)}min`);
    } else {
      console.warn('[rtsw-parse] WARNING: 0 plasma points after parsing - all speed/density values were null');
    }
    if (!tempAvailable) {
      console.warn('[rtsw-parse] Temperature is largely absent from the feed. Shock detection will run without it.');
    }

    return { magPoints, plasmaPoints, tempAvailable };
  } catch (e) {
    console.error('[rtsw-parse] Failed to parse RTSW merged data:', e.message);
    return { magPoints: [], plasmaPoints: [], tempAvailable: false };
  }
}

// ── Overnight Condition Classifier ───────────────────────────────────────────
// Unchanged. This one works and is left exactly as it was.
function classifyOvernightConditions({ hp, bt, bz, speed, southMin, trend, auroraScore, moonPct }) {
  const hasSolarWind = bt != null && isFinite(bt) && bz != null && isFinite(bz);
  const hasHP        = hp != null && isFinite(hp);

  const fmtBz    = (v) => v == null || !isFinite(v) ? null : `${v >= 0 ? '+' : ''}${v.toFixed(1)} nT`;
  const fmtBt    = (v) => v == null || !isFinite(v) ? null : `${v.toFixed(1)} nT`;
  const fmtSpd   = (v) => v == null || !isFinite(v) ? null : `${Math.round(v)} km/s`;
  const fmtHP    = (v) => v == null || !isFinite(v) ? null : `${Math.round(v)} GW`;

  const bzWord = (v) => {
    if (v == null || !isFinite(v)) return null;
    if (v <= -15) return 'strongly southward';
    if (v <= -8)  return 'firmly southward';
    if (v <= -4)  return 'southward';
    if (v <= -2)  return 'leaning south';
    if (v <  0)   return 'slightly south';
    if (v <  2)   return 'roughly flat';
    return 'pointing north';
  };

  const speedWord = (v) => {
    if (v == null || !isFinite(v)) return null;
    if (v >= 700) return 'very fast';
    if (v >= 550) return 'fast';
    if (v >= 450) return 'moderate';
    if (v >= 350) return 'calm';
    return 'very calm';
  };

  const buildStatsSentence = () => {
    const parts = [];
    if (bz != null && isFinite(bz))           parts.push(`Bz is ${fmtBz(bz)} (${bzWord(bz)})`);
    if (bt != null && isFinite(bt))           parts.push(`Bt is ${fmtBt(bt)}`);
    if (speed != null && isFinite(speed))     parts.push(`wind speed ${fmtSpd(speed)} (${speedWord(speed)})`);
    if (hp != null && isFinite(hp))           parts.push(`hemispheric power ${fmtHP(hp)}`);
    if (!parts.length) return null;
    if (parts.length === 1) return parts[0] + '.';
    const last = parts.pop();
    return parts.join(', ') + ', and ' + last + '.';
  };

  if (!hasSolarWind && !hasHP) {
    return {
      tier: 'unknown',
      label: 'Data Unavailable',
      emoji: '❓',
      buildBody: () => "We couldn't pull fresh solar wind data just now. Pop the app open and take a look at the live forecast to check what's going on.",
    };
  }

  const hpLevel = !hasHP     ? null
    : hp >= 200              ? 5
    : hp >= 120              ? 4
    : hp >= 70               ? 3
    : hp >= 40               ? 2
    : hp >= 20               ? 1
    :                          0;

  const bzLevel = !hasSolarWind ? null
    : bz <= -15              ? 5
    : bz <= -10              ? 4
    : bz <= -6               ? 3
    : bz <= -3               ? 2
    : bz <= -1               ? 1
    :                          0;

  const btLevel = !hasSolarWind ? null
    : bt >= 30               ? 5
    : bt >= 20               ? 4
    : bt >= 15               ? 3
    : bt >= 10               ? 2
    : bt >= 6                ? 1
    :                          0;

  const southBonus = (southMin != null && southMin >= 20) ? 1 : 0;
  const bzAdj      = bzLevel != null ? Math.min(5, bzLevel + southBonus) : null;
  const highSpeed  = speed != null && isFinite(speed) && speed >= 550;

  const scores   = [hpLevel, bzAdj, btLevel].filter(s => s != null);
  const maxScore = scores.length ? Math.max(...scores) : 0;
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const minScore = scores.length ? Math.min(...scores) : 0;
  const isContradictory = scores.length >= 2 && (maxScore - minScore) >= 3;

  let tier;
  if (hpLevel != null) {
    if      (hpLevel >= 5)                                   tier = 'extreme';
    else if (hpLevel >= 4 || (hpLevel >= 3 && bzAdj >= 5))   tier = 'severe';
    else if (hpLevel >= 3 || (hpLevel >= 2 && bzAdj >= 5))   tier = 'high';
    else if (hpLevel >= 2 && bzAdj >= 2)                     tier = 'moderate';
    else if (hpLevel >= 1 || bzAdj >= 3 || isContradictory)  tier = 'ambient';
    else if (avgScore >= 1.5)                                tier = 'ambient';
    else                                                     tier = 'quiet';
    if (tier === 'ambient' && isContradictory)               tier = 'unsettled';
  } else {
    if      (maxScore >= 4 && avgScore >= 3 && bzAdj >= 4) tier = 'high';
    else if (maxScore >= 4 && bzAdj >= 3)                   tier = 'high';
    else if (maxScore >= 3 && avgScore >= 2.5)              tier = 'moderate';
    else if (bzAdj   >= 3 && btLevel >= 2)                  tier = 'moderate';
    else if (isContradictory)                               tier = 'unsettled';
    else if (avgScore >= 1.5)                               tier = 'ambient';
    else                                                    tier = 'quiet';
  }

  const TIER_META = {
    quiet:     { emoji: '😴', label: 'Quiet' },
    ambient:   { emoji: '🌑', label: 'Ambient' },
    unsettled: { emoji: '🌀', label: 'Unsettled' },
    moderate:  { emoji: '🟡', label: 'Moderate' },
    high:      { emoji: '🟠', label: 'High' },
    severe:    { emoji: '🔴', label: 'Severe' },
    extreme:   { emoji: '🔥', label: 'Extreme' },
  };
  const meta = TIER_META[tier];

  const opener = (() => {
    switch (tier) {
      case 'quiet':
        return "Things are pretty quiet up there right now, so you're very unlikely to see any aurora in the next couple of hours.";
      case 'ambient':
        return "There's a little bit of activity up there, but not enough to expect any aurora in the next couple of hours.";
      case 'unsettled':
        return "The solar wind is doing something interesting, but the numbers aren't lining up for aurora in the next couple of hours. Worth keeping an eye on in case things shift.";
      case 'moderate':
        return "Conditions are looking decent for the next couple of hours. A camera with a long exposure should be able to pick up some colour, though your eyes probably won't catch it yet.";
      case 'high':
        return "Conditions are getting pretty good. It's worth heading out to a dark spot with a clear southern horizon in the next couple of hours. A camera should see it easily, and your eyes might too.";
      case 'severe':
        return "This is a proper show in the making. Head to your spot now and get set up before it gets dark, because aurora is looking very likely in the next couple of hours.";
      case 'extreme':
        return "This is a big one. Get outside as soon as you can, because events like this don't come around often.";
      default:
        return '';
    }
  })();

  const trendSentence = (() => {
    if (!trend) return null;
    const t = trend.toLowerCase();
    if (t.includes('rapidly increasing')) return "Conditions are ramping up fast, so things could change in a matter of minutes.";
    if (t.includes('increasing'))         return "Things have been slowly building over the last half hour.";
    if (t.includes('decreasing'))         return "Conditions have been easing off a bit from earlier.";
    return null;
  })();

  const southSentence = (() => {
    if (southMin == null || southMin < 10) return null;
    if (southMin >= 45) return `Bz has been pointing south for ${southMin} minutes straight, which is really feeding the aurora.`;
    if (southMin >= 20) return `Bz has been pointing south for the last ${southMin} minutes, which helps.`;
    return `Bz has been south for about ${southMin} minutes.`;
  })();

  const speedSentence = (() => {
    if (!highSpeed || bzAdj < 2) return null;
    return `The solar wind is barrelling in at ${Math.round(speed)} km/s, which is giving the southward field extra punch.`;
  })();

  const moonSentence = (() => {
    if (moonPct == null) return null;
    if (moonPct >= 80) return `Heads up though, the moon is ${moonPct}% full tonight, so only a strong display is going to cut through all that light.`;
    if (moonPct >= 60) return `The moon is fairly bright tonight at ${moonPct}% full, which will wash out fainter aurora.`;
    if (moonPct >= 30) return `The moon is ${moonPct}% illuminated, so there's a bit of moonlight to contend with but not too bad.`;
    return `Dark skies tonight too, with the moon only ${moonPct}% lit.`;
  })();

  const buildBody = () => {
    const paragraphs = [];
    paragraphs.push(opener);
    const statsSentence = buildStatsSentence();
    if (statsSentence) {
      paragraphs.push(`Right now, ${statsSentence}`);
    } else {
      paragraphs.push("We're missing some live numbers at the moment, so check the app for the latest.");
    }
    const extras = [trendSentence, southSentence, speedSentence].filter(Boolean);
    if (extras.length) paragraphs.push(extras.join(' '));
    if (moonSentence) paragraphs.push(moonSentence);
    return paragraphs.join('\n\n');
  };

  return { tier, label: meta.label, emoji: meta.emoji, buildBody };
}

// --- Main Export ---
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return handleOptions();
    // Learn where we live, in case SELF_URL was never configured.
    await rememberSelfOrigin(env, request);
    if (url.pathname === '/save-subscription'         && request.method === 'POST') return handleSaveSubscription(request, env);
    if (url.pathname === '/update-location'           && request.method === 'POST') return handleUpdateLocation(request, env);
    if (url.pathname === '/check-subscription'        && request.method === 'POST') return handleCheckSubscription(request, env);
    if (url.pathname === '/delete-subscription'       && request.method === 'POST') return handleDeleteSubscription(request, env);
    if (url.pathname === '/send-broadcast'            && request.method === 'POST') return handleSendBroadcast(request, env);
    if (url.pathname === '/migrate-preferences'       && request.method === 'POST') return handleMigratePreferences(request, env);
    if (url.pathname === '/status'                    && request.method === 'GET')  return handleGetStatus(request, env);
    if (url.pathname === '/diagnostics'               && request.method === 'GET')  return handleDiagnostics(request, env);
    if (url.pathname === '/trigger-test-push'         && request.method === 'GET')  return handleTriggerTestPush(request, env);
    if (url.pathname === '/trigger-test-push-for-me'  && request.method === 'POST') return handleTriggerSelfTest(request, env);
    if (url.pathname === '/run-shard'                 && request.method === 'POST') return handleRunShard(request, env);
    if (url.pathname === '/job'                       && request.method === 'GET')  return handleJob(request, env);
    if (url.pathname === '/run-census-shard'          && request.method === 'POST') return handleRunCensusShard(request, env);
    if (url.pathname === '/stats'                     && request.method === 'GET')  return handleStats(request, env);
    if (url.pathname === '/sends'                     && request.method === 'GET')  return handleSends(request, env);
    if (url.pathname === '/migration'                 && request.method === 'GET')  return handleMigrationStatus(request, env);
    if (url.pathname === '/run-migration-shard'       && request.method === 'POST') return handleRunMigrationShard(request, env);
    if (url.pathname === '/notification-clicked'      && request.method === 'POST') return handleNotificationClicked(request, env);
    if (url.pathname === '/health')                                                  return handleHealthCheck(env);
    if (url.pathname === '/')                                                        return handleRoot(env);
    return new Response('Not found', { status: 404 });
  },
  async scheduled(_evt, env, ctx) {
    // FIX 7: broadcasts chain through a fire-and-forget fetch. In a scheduled
    // run nothing keeps that alive once runScheduledTasks resolves, so a
    // broadcast could be torn down after the first batch of 40. Handing the
    // execution context along lets the chain be registered with waitUntil.
    env.__ctx = ctx;
    ctx.waitUntil(runScheduledTasks(env).catch(err => reportError(err, env)));
  },
};

/** Register background work so a scheduled run is not torn down mid-broadcast. */
function keepAlive(env, promise) {
  try {
    if (env?.__ctx?.waitUntil) env.__ctx.waitUntil(promise);
  } catch { /* fetch handler has its own lifetime; nothing to do */ }
  return promise;
}

async function runScheduledTasks(env) {
  const diag = {
    ranAt: Date.now(),
    detectors: {},
  };
  const note = (name, status, detail) => {
    diag.detectors[name] = { status, detail, at: Date.now() };
    console.log(`[diag] ${name}: ${status}${detail ? ' - ' + detail : ''}`);
  };

  const thresholds = await kv(env).get('CONFIG_THRESHOLDS', 'json');
  if (!thresholds) {
    console.error('CRITICAL: Notification thresholds not found in KV.');
    note('all', 'aborted', 'CONFIG_THRESHOLDS missing from KV');
    await kv(env).put(DIAG_KEY, JSON.stringify(diag), { expirationTtl: 86400 });
    return;
  }

  // The daily preference migration used to run from here. It is now
  // maybeRunMigration, called at the end of this function: versioned, sharded
  // so it can finish at 80,000 records, and self-limiting rather than
  // re-walking the whole namespace every day.

  const forecastData = await getFullForecastData(env);
  if (!forecastData) {
    console.warn('Could not retrieve forecast data. Aurora forecast check will be skipped; substorm check will continue independently.');
  }

  const [rtswResult, xrayRes] = await Promise.all([
    fetchAndParseRtswData(env),
    fetchWithRetry(NOAA_XRAY_URL),
  ]);
  const { magPoints, plasmaPoints, tempAvailable } = rtswResult;

  let xrayData = null;
  try {
    if (xrayRes) xrayData = await xrayRes.json();
  } catch (e) {
    console.warn('XRAY data parse failed:', e.message);
  }

  let substormData = null;
  try {
    const sRes = await fetch(SUBSTORM_URL);
    if (sRes.ok) substormData = await sRes.json();
    else console.warn(`[substorm-fetch] ${SUBSTORM_URL} returned ${sRes.status}`);
  } catch (e) {
    console.warn('Substorm worker fetch failed:', e.message);
  }

  diag.sources = {
    forecast:    forecastData ? 'ok' : 'unavailable',
    rtswMag:     magPoints.length,
    rtswPlasma:  plasmaPoints.length,
    temperature: tempAvailable ? 'present' : 'absent (shock detection runs without it)',
    xray:        Array.isArray(xrayData) ? `${xrayData.length} rows` : 'unavailable',
    substorm:    substormData?.current ? 'ok' : 'unavailable',
  };

  const loadingState = await updateTailLoadingState(env, substormData, magPoints, plasmaPoints);

  await Promise.allSettled([
    checkSubstormActivity(env, thresholds.substorm, substormData, loadingState, note),
    checkSolarFlares(env, xrayData, note),
    checkShockDetection(env, magPoints, plasmaPoints, tempAvailable, note),
    checkOvernightWatch(env, forecastData, substormData, magPoints, plasmaPoints, note),
    checkVisibilityNotifications(env, substormData, forecastData, magPoints, plasmaPoints, note),
  ]);

  // The outbox's durability guarantee: pick up anything that was dropped,
  // stalled or is due a retry. Without this a lost dispatch is a lost alert.
  await sweepJobs(env, note);
  await maybeRunCensus(env, note);
  // Runs itself once per version and then costs one KV read a tick.
  await maybeRunMigration(env, note);

  await kv(env).put('LAST_SUCCESSFUL_RUN_TIMESTAMP', Date.now().toString());
  await kv(env).put(DIAG_KEY, JSON.stringify(diag), { expirationTtl: 86400 });
  console.log('Scheduled tasks completed.');
}

// ── Solar Flare Detector ─────────────────────────────────────────────────────
const FLARE_THRESHOLDS = [
  { value: 1e-5, topic: 'flare-M1',  cooldownMinutes: 30 },
  { value: 5e-5, topic: 'flare-M5',  cooldownMinutes: 30 },
  { value: 1e-4, topic: 'flare-X1',  cooldownMinutes: 30 },
  { value: 5e-4, topic: 'flare-X5',  cooldownMinutes: 30 },
  { value: 1e-3, topic: 'flare-X10', cooldownMinutes: 30 },
];
const FLARE_PEAK_COOLDOWN_MINUTES = 15;
const FLARE_M1_THRESHOLD = 1e-5;
const FLARE_DECLINE_MS = 3 * 60 * 1000;
const FLARE_STALE_MS   = 4 * 60 * 60 * 1000;

async function checkSolarFlares(env, allData = null, note = /** @type {(name?: string, status?: string, detail?: string) => void} */ (() => {})) {
  try {
    if (!allData) {
      const response = await fetchWithRetry(NOAA_XRAY_URL);
      if (!response) { note('flare', 'skipped', 'X-ray feed unreachable'); return; }
      allData = await response.json().catch(() => null);
    }
    if (!allData) { note('flare', 'skipped', 'X-ray feed unparseable'); return; }

    const xraySeries = allData
      .filter(d => d.energy === '0.1-0.8nm' && d.flux > 0 && d.time_tag)
      .map(d => ({ t: new Date(d.time_tag).getTime(), flux: d.flux }))
      .sort((a, b) => a.t - b.t);

    if (xraySeries.length < 3) {
      note('flare', 'skipped', 'insufficient X-ray data points');
      return;
    }

    const latest = xraySeries[xraySeries.length - 1];
    const now = Date.now();

    if (now - latest.t > 15 * 60 * 1000) {
      note('flare', 'skipped', `X-ray data stale (${Math.round((now - latest.t) / 60000)} min old)`);
      return;
    }

    const prev = await kv(env).get('STATE_flare', 'json') || {
      status: 'inactive', peakFlux: 0, peakTime: 0,
      notifiedThresholds: [], declineStart: null, stateEnteredAt: 0,
    };

    // FIX 5: the stale guard used to require a truthy stateEnteredAt, so a
    // state saved without one could never be unstuck. Treat a missing value
    // as "unknown age" and reset on it rather than skipping the guard.
    if (prev.status === 'rising' && (!prev.stateEnteredAt || (now - prev.stateEnteredAt > FLARE_STALE_MS))) {
      console.warn(`[flare] Resetting stuck 'rising' state (entered ${prev.stateEnteredAt ? Math.round((now - prev.stateEnteredAt) / 3600000) + 'h ago' : 'unknown'})`);
      await kv(env).put('STATE_flare', JSON.stringify({
        status: 'inactive', peakFlux: 0, peakTime: 0,
        notifiedThresholds: [], declineStart: null, stateEnteredAt: 0,
      }));
      prev.status = 'inactive';
      prev.peakFlux = 0;
      prev.notifiedThresholds = [];
      prev.declineStart = null;
    }

    const cls = getXrayClass(latest.flux);

    if (prev.status === 'inactive') {
      if (latest.flux >= FLARE_M1_THRESHOLD) {
        console.log(`[flare] New flare detected: ${cls} (flux=${latest.flux.toExponential(2)})`);
        const notified = [];
        const blocked = [];
        for (const th of FLARE_THRESHOLDS) {
          if (latest.flux >= th.value) {
            if (await checkAndSetCooldown(th.topic, th.cooldownMinutes, env)) {
              const title = `☀️ ${cls} Solar Flare Detected`;
              const body = `X-ray flux has reached ${cls} class. A solar flare is in progress.`;
              await notifyTopic(th.topic, title, body, env, {
                url: '/?page=solar-activity&section=goes-xray-flux-section',
              });
              notified.push(th.topic);
            } else {
              blocked.push(th.topic);
            }
          }
        }
        note('flare', notified.length ? 'fired' : 'suppressed',
             `${cls}; sent ${notified.join(',') || 'none'}${blocked.length ? `; cooldown blocked ${blocked.join(',')}` : ''}`);

        await kv(env).put('STATE_flare', JSON.stringify({
          status: 'rising', peakFlux: latest.flux, peakTime: latest.t,
          // FIX: record the cooldown-blocked topics too, otherwise the rising
          // branch would try them again on the very next tick and they would
          // stay blocked for the whole flare without ever being retried after
          // the cooldown lapses. Keeping them out of notifiedThresholds means
          // they get another chance once the flux makes a new peak.
          notifiedThresholds: notified,
          declineStart: null, stateEnteredAt: now,
        }));
      } else {
        note('flare', 'quiet', `flux ${cls}, below M1`);
      }

    } else {
      let newState = { ...prev };
      let peaked = false;

      if (latest.flux < FLARE_M1_THRESHOLD) {
        peaked = true;
        console.log('[flare] Flux dropped below M1 - flare ended');
      } else if (latest.flux > prev.peakFlux) {
        newState.peakFlux = latest.flux;
        newState.peakTime = latest.t;
        newState.declineStart = null;
        const alreadyNotified = new Set(prev.notifiedThresholds || []);
        for (const th of FLARE_THRESHOLDS) {
          if (latest.flux >= th.value && !alreadyNotified.has(th.topic)) {
            if (await checkAndSetCooldown(th.topic, th.cooldownMinutes, env)) {
              const title = `☀️ Flare Intensifying: Now ${cls}`;
              const body = `The ongoing solar flare has strengthened to ${cls} class.`;
              await notifyTopic(th.topic, title, body, env, {
                url: '/?page=solar-activity&section=goes-xray-flux-section',
              });
              newState.notifiedThresholds = [...(newState.notifiedThresholds || []), th.topic];
              console.log(`[flare] Fired ${th.topic} (intensifying)`);
            }
          }
        }
        note('flare', 'rising', `${cls}, new peak`);
      } else {
        if (!prev.declineStart) {
          newState.declineStart = latest.t;
        } else if (latest.t - prev.declineStart >= FLARE_DECLINE_MS) {
          peaked = true;
          console.log(`[flare] Flux declining for ${Math.round((latest.t - prev.declineStart) / 60000)} min - peaked`);
        }
        note('flare', 'rising', `${cls}, past peak, waiting for decline confirmation`);
      }

      if (peaked) {
        const peakClass = getXrayClass(prev.peakFlux);
        if (await checkAndSetCooldown('flare-peak', FLARE_PEAK_COOLDOWN_MINUTES, env)) {
          await notifyTopic('flare-peak',
            `📉 Solar Flare Peaked: ${peakClass}`,
            `A solar flare reached a maximum of ${peakClass} around ${formatNzTime(prev.peakTime)} and is now declining.`,
            env, { url: '/?page=solar-activity&section=goes-xray-flux-section' });
        }
        if (await checkAndSetCooldown('flare-event', 15, env)) {
          await notifyTopic('flare-event',
            `☀️ ${peakClass} Solar Flare`,
            `A solar flare peaked at ${peakClass} at ${formatNzTime(prev.peakTime)}.`,
            env, { url: '/?page=solar-activity&section=goes-xray-flux-section' });
        }
        note('flare', 'fired', `peak ${peakClass}`);
        await kv(env).put('STATE_flare', JSON.stringify({
          status: 'inactive', peakFlux: 0, peakTime: 0,
          notifiedThresholds: [], declineStart: null, stateEnteredAt: 0,
        }));
      } else {
        await kv(env).put('STATE_flare', JSON.stringify(newState));
      }
    }
  } catch (e) {
    note('flare', 'error', e.message);
    reportError(e, env, { handler: 'checkSolarFlares' });
  }
}

// ── Magnetotail Loading-Unloading Tracker ────────────────────────────────────
const LOADING_NEWELL_MIN = 2500;
const LOADING_GAP_TOLERANCE_MIN = 10;
const LOADING_WINDOW_TYPICAL_MIN = 45;
const LOADING_WINDOW_LATE_MIN = 90;

function newellCouplingWorker(V, By, Bz) {
  const BT = Math.sqrt((By ?? 0) ** 2 + (Bz ?? 0) ** 2);
  const theta = Math.atan2(By ?? 0, Bz ?? 0);
  const s = Math.sin(theta / 2);
  return Math.pow(V, 4 / 3) * Math.pow(BT, 2 / 3) * Math.pow(Math.abs(s), 8 / 3) / 1000;
}

function buildNewellSeries(magPoints, plasmaPoints) {
  if (!magPoints?.length || !plasmaPoints?.length) return [];
  const speedByMin = new Map();
  for (const p of plasmaPoints) speedByMin.set(Math.round(p.ts / 60000), p.speed);
  const out = [];
  for (const m of magPoints) {
    const V = speedByMin.get(Math.round(m.ts / 60000));
    if (V == null || !Number.isFinite(V)) continue;
    if (m.by == null || !Number.isFinite(m.by)) continue;
    out.push({ x: m.ts, y: newellCouplingWorker(V, m.by, m.bz) * 1000 });
  }
  out.sort((a, b) => a.x - b.x);
  return out;
}

function loadingMinutesFromSeries(points, threshold = LOADING_NEWELL_MIN, gapToleranceMin = LOADING_GAP_TOLERANCE_MIN) {
  if (!points || points.length === 0) return 0;
  const newestTs = points[points.length - 1].x;
  let loadingStart = null;
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (p == null || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.y >= threshold) {
      loadingStart = p.x;
    } else {
      const ref = loadingStart ?? newestTs;
      const dipMin = (ref - p.x) / 60000;
      if (dipMin > gapToleranceMin) break;
    }
  }
  if (loadingStart == null) return 0;
  return Math.max(0, Math.round((newestTs - loadingStart) / 60000));
}

async function updateTailLoadingState(env, substormData, magPoints = [], plasmaPoints = []) {
  try {
    const bayOnset = substormData?.current?.bay_onset_flag ?? false;
    const now = Date.now();
    const prev = await kv(env).get('STATE_tail_loading', 'json') || { lastOnsetTs: 0 };
    const state = { ...prev };
    if (bayOnset) state.lastOnsetTs = now;

    const series = buildNewellSeries(magPoints, plasmaPoints);
    let loadingMinutes = loadingMinutesFromSeries(series);

    if (state.lastOnsetTs) {
      const sinceOnsetMin = (now - state.lastOnsetTs) / 60000;
      loadingMinutes = Math.min(loadingMinutes, Math.max(0, Math.round(sinceOnsetMin)));
    }

    state.loadingMinutes = loadingMinutes;
    state.lastUpdateTs = now;
    await kv(env).put('STATE_tail_loading', JSON.stringify(state));
    console.log(`[tail-loading] loading=${loadingMinutes}min seriesPts=${series.length} bayOnset=${bayOnset}`);
    return state;
  } catch (e) {
    reportError(e, env, { handler: 'updateTailLoadingState' });
    return null;
  }
}

function tailLoadingSentence(loadingState) {
  if (!loadingState) return null;
  const mins = Math.round(loadingState.loadingMinutes || 0);
  if (mins < 20) return null;
  if (mins >= LOADING_WINDOW_LATE_MIN) {
    return `The magnetotail has been loading energy for ${mins} minutes - well into the typical release window. An eruption could happen at any moment.`;
  }
  if (mins >= LOADING_WINDOW_TYPICAL_MIN) {
    return `The magnetotail has been loading for ${mins} minutes, entering the typical substorm release window.`;
  }
  return `The magnetotail has been loading energy for ${mins} minutes.`;
}

// FIX 3: substormThresholds could be undefined if CONFIG_THRESHOLDS had no
// `substorm` key. Reading .cooldownMinutes off it threw, the catch below
// swallowed the error, and substorm alerts silently never sent. Default it.
const SUBSTORM_DEFAULT_COOLDOWN_MIN = 30;

async function checkSubstormActivity(env, substormThresholds, substormData, loadingState = null, note = /** @type {(name?: string, status?: string, detail?: string) => void} */ (() => {})) {
  try {
    if (!substormData?.current) {
      note('substorm', 'skipped', 'substorm worker unavailable');
      return;
    }
    const cooldownMinutes = Number(substormThresholds?.cooldownMinutes) > 0
      ? Number(substormThresholds.cooldownMinutes)
      : SUBSTORM_DEFAULT_COOLDOWN_MIN;
    if (!substormThresholds?.cooldownMinutes) {
      console.warn(`[substorm] CONFIG_THRESHOLDS.substorm.cooldownMinutes missing - defaulting to ${SUBSTORM_DEFAULT_COOLDOWN_MIN} min`);
    }

    const score    = substormData.current.score ?? 0;
    const bayOnset = substormData.current.bay_onset_flag ?? false;

    let currentStatus;
    if (bayOnset || score >= 85)   currentStatus = 'ONSET';
    else if (score >= 70)          currentStatus = 'IMMINENT_30';
    else if (score >= 50)          currentStatus = 'LIKELY_60';
    else if (score >= 30)          currentStatus = 'WATCH';
    else                           currentStatus = 'QUIET';

    const loadingMins = Math.round(loadingState?.loadingMinutes ?? 0);
    if (loadingMins >= LOADING_WINDOW_TYPICAL_MIN) {
      if (currentStatus === 'LIKELY_60')      currentStatus = 'IMMINENT_30';
      else if (currentStatus === 'WATCH')     currentStatus = 'LIKELY_60';
    }

    const prev = await kv(env).get('STATE_substorm', 'json') || { status: 'QUIET' };
    const statusLevels = { 'QUIET': 0, 'WATCH': 1, 'LIKELY_60': 2, 'IMMINENT_30': 3, 'ONSET': 4 };
    const prevLevel = statusLevels[prev.status] ?? 0;
    const nowLevel  = statusLevels[currentStatus] ?? 0;

    if (nowLevel > prevLevel) {
      const topic = 'substorm-forecast';
      if (await checkAndSetCooldown(topic, cooldownMinutes, env)) {
        let title = 'Substorm Forecast Update';
        let body  = substormData.current.summary || 'Substorm activity detected.';
        switch (currentStatus) {
          case 'ONSET':       title = '💥 Substorm Eruption In Progress!';   body = 'A substorm onset has been detected. Aurora may be visible now, look south.'; break;
          case 'IMMINENT_30': title = '⚡ Substorm Alert: Eruption Imminent'; body = `Substorm index ${Math.round(score)}, eruption expected within 30 minutes. Get to your viewing site.`; break;
          case 'LIKELY_60':   title = '⚡ Substorm Watch: Eruption Likely';   body = `Substorm index ${Math.round(score)}, eruption likely within the hour. Prepare to go out.`; break;
          case 'WATCH':       title = '⚡ Substorm Watch: Energy Building';   body = `Substorm index ${Math.round(score)}, magnetospheric energy is loading. Keep an eye on the forecast.`; break;
        }
        if (currentStatus !== 'ONSET') {
          const loadingLine = tailLoadingSentence(loadingState);
          if (loadingLine) body += `\n\n${loadingLine}`;
        }
        await notifyTopic(topic, title, body, env, { url: '/?page=forecast&section=unified-forecast-section' });
        note('substorm', 'fired', `${prev.status} -> ${currentStatus} (index ${Math.round(score)})`);
      } else {
        note('substorm', 'suppressed', `${currentStatus} but within ${cooldownMinutes} min cooldown`);
      }
    } else {
      note('substorm', 'quiet', `status ${currentStatus} (index ${Math.round(score)}), no escalation from ${prev.status}`);
    }
    await kv(env).put('STATE_substorm', JSON.stringify({ status: currentStatus, timestamp: Date.now() }));
  } catch (e) {
    note('substorm', 'error', e.message);
    reportError(e, env, { handler: 'checkSubstormActivity' });
  }
}

// ── Interplanetary Shock Detector ────────────────────────────────────────────
async function checkShockDetection(env, magPoints, plasmaPoints, tempAvailable = true, note = /** @type {(name?: string, status?: string, detail?: string) => void} */ (() => {})) {
  if (magPoints.length < 10 || plasmaPoints.length < 10) {
    note('shock', 'skipped', `insufficient data (mag=${magPoints.length} plasma=${plasmaPoints.length})`);
    return;
  }
  try {
    const PRE_WIN_MS  = 18 * 60 * 1000;
    const POST_WIN_MS = 12 * 60 * 1000;
    const COOLDOWN_MINUTES = 20;
    const COOLDOWN_MS = COOLDOWN_MINUTES * 60 * 1000;
    const now = Date.now();

    const latestPlasmaTs = plasmaPoints[plasmaPoints.length - 1].ts;
    const latestMagTs    = magPoints[magPoints.length - 1].ts;

    if (now - latestPlasmaTs > 15 * 60 * 1000) {
      note('shock', 'skipped', `plasma data stale (${Math.round((now - latestPlasmaTs) / 60000)} min old)`);
      return;
    }
    if (now - latestMagTs > 15 * 60 * 1000) {
      note('shock', 'skipped', `mag data stale (${Math.round((now - latestMagTs) / 60000)} min old)`);
      return;
    }

    const CANDIDATE_STEP = 3 * 60 * 1000;
    // FIX 6: the candidate scan never ran a single iteration.
    //
    // It started at `latest - LOOK_BACK` (5 min) and looped while
    // `t <= latest - POST_WIN_MS + CANDIDATE_STEP` (9 min before latest). The
    // start was already past the end, so the loop body executed zero times on
    // every invocation and no shock could ever be evaluated, whatever the data
    // did. This is the reason shock notifications never arrived; the missing
    // temperature above would have killed them too, but this came first.
    //
    // A candidate needs PRE_WIN_MS of data before it and POST_WIN_MS after, so
    // the most recent one that can be judged is POST_WIN_MS behind the latest
    // sample. Scan back from there. The window is wider than the old intent so
    // a shock is not missed when a scheduled run is skipped; the 20 minute
    // cooldown and STATE_shock guard stop it being reported twice.
    const LOOK_BACK = 25 * 60 * 1000;

    const median = (vals) => {
      if (!vals.length) return NaN;
      const v = [...vals].sort((a, b) => a - b);
      const m = Math.floor(v.length / 2);
      return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
    };
    const samplePlasma = (arr, a, b, key) =>
      arr.filter(p => p.ts >= a && p.ts < b && p[key] != null && isFinite(p[key])).map(p => p[key]);
    const sampleMag = (arr, a, b, key) =>
      arr.filter(p => p.ts >= a && p.ts < b && p[key] != null && isFinite(p[key])).map(p => p[key]);

    let bestEvent = null;
    let bestScore = 0;
    let candidates = 0;

    const tEnd   = latestPlasmaTs - POST_WIN_MS;
    const tStart = Math.max(tEnd - LOOK_BACK, plasmaPoints[0].ts + PRE_WIN_MS);
    for (let t = tStart; t <= tEnd; t += CANDIDATE_STEP) {
      const preSpd  = samplePlasma(plasmaPoints, t - PRE_WIN_MS, t, 'speed');
      const postSpd = samplePlasma(plasmaPoints, t, t + POST_WIN_MS, 'speed');
      const preDen  = samplePlasma(plasmaPoints, t - PRE_WIN_MS, t, 'density');
      const postDen = samplePlasma(plasmaPoints, t, t + POST_WIN_MS, 'density');
      const preTmp  = samplePlasma(plasmaPoints, t - PRE_WIN_MS, t, 'temp');
      const postTmp = samplePlasma(plasmaPoints, t, t + POST_WIN_MS, 'temp');
      const preBt   = sampleMag(magPoints, t - PRE_WIN_MS, t, 'bt');
      const postBt  = sampleMag(magPoints, t, t + POST_WIN_MS, 'bt');
      const preBz   = sampleMag(magPoints, t - PRE_WIN_MS, t, 'bz');
      const postBz  = sampleMag(magPoints, t, t + POST_WIN_MS, 'bz');

      if (preSpd.length < 3 || postSpd.length < 3 ||
          preDen.length < 3 || postDen.length < 3 ||
          preBt.length < 3  || postBt.length < 3) continue;
      candidates++;

      const spd1 = median(preSpd),  spd2 = median(postSpd);
      const den1 = median(preDen),  den2 = median(postDen);
      const tmp1 = median(preTmp),  tmp2 = median(postTmp);
      const bt1  = median(preBt),   bt2  = median(postBt);
      const bz1  = median(preBz),   bz2  = median(postBz);

      if (![spd1, spd2, den1, den2, bt1, bt2].every(Number.isFinite)) continue;

      const pDyn1 = den1 > 0 ? den1 * spd1 * spd1 : NaN;
      const pDyn2 = den2 > 0 ? den2 * spd2 * spd2 : NaN;
      const spdDelta = spd2 - spd1;
      const denRatio = den1 > 0 ? den2 / den1 : NaN;
      const tmpRatio = (isFinite(tmp1) && tmp1 > 0 && isFinite(tmp2)) ? tmp2 / tmp1 : NaN;
      const btDelta  = bt2 - bt1;
      const btRatio  = bt1 > 0 ? bt2 / bt1 : NaN;
      const bzDelta  = (isFinite(bz1) && isFinite(bz2)) ? bz2 - bz1 : 0;
      const pDynRatio = (isFinite(pDyn1) && pDyn1 > 0 && isFinite(pDyn2)) ? pDyn2 / pDyn1 : NaN;

      if (![denRatio, btRatio].every(Number.isFinite)) continue;

      const vUp   = spdDelta >= 12;
      const nUp   = denRatio >= 1.2;
      const nDown = denRatio <= 0.82;
      const bUp   = btRatio >= 1.1  || btDelta >= 1.0;
      const bDown = btRatio <= 0.92 || btDelta <= -1.0;

      // FIX 1 (continued): temperature is corroborating evidence, not a
      // precondition. When the feed carries it, it is used exactly as before.
      // When it does not, the shock is classified on speed, density and field
      // alone and scored slightly lower to reflect the weaker evidence,
      // instead of every classification being impossible.
      const haveTmp = isFinite(tmpRatio);
      const tUp   = haveTmp ? tmpRatio >= 1.1 : null;
      const tDown = haveTmp ? tmpRatio <= 0.9 : null;
      const tUpOk   = haveTmp ? tUp   : true;
      const tDownOk = haveTmp ? tDown : true;

      const ff = vUp && nUp   && tUpOk   && bUp;
      const sf = vUp && nUp   && tUpOk   && bDown;
      const fr = vUp && nDown && tDownOk && bDown;
      const sr = vUp && nDown && tDownOk && bUp;

      const imfEnhancement =
        (Math.abs(btDelta) >= 3 || (isFinite(btRatio) && btRatio >= 1.3) || Math.abs(bzDelta) >= 6) &&
        Math.abs(spdDelta) < 30 &&
        denRatio > 0.7 && denRatio < 1.45 &&
        isFinite(pDynRatio) && pDynRatio > 0.65 && pDynRatio < 1.8;

      // Without temperature the evidence is weaker, so require a clearly
      // stronger jump before calling it. This keeps false positives down
      // rather than trading one failure mode for another.
      const strongEnoughWithoutTemp = spdDelta >= 25 && denRatio >= 1.4 &&
        (isFinite(pDynRatio) ? pDynRatio >= 1.5 : true);

      let shockType = null;
      let score = 0;
      if (ff)                 { shockType = 'ff';  score = 8 + (isFinite(pDynRatio) && pDynRatio >= 1.8 ? 1 : 0) + (btRatio >= 1.3 ? 1 : 0); }
      else if (sf)            { shockType = 'sf';  score = 7 + (isFinite(pDynRatio) && pDynRatio >= 1.6 ? 1 : 0); }
      else if (fr)            { shockType = 'fr';  score = 7 + (isFinite(pDynRatio) && pDynRatio <= 0.75 ? 1 : 0); }
      else if (sr)            { shockType = 'sr';  score = 6 + (isFinite(pDynRatio) && pDynRatio <= 0.8 ? 1 : 0); }
      else if (imfEnhancement){ shockType = 'imf'; score = 3 + (Math.abs(bzDelta) >= 8 ? 1 : 0); }

      if (shockType && !haveTmp && shockType !== 'imf') {
        if (!strongEnoughWithoutTemp) { shockType = null; score = 0; }
        else score -= 1;
      }

      if (shockType && score > bestScore) {
        bestScore = score;
        bestEvent = {
          shockType, t, haveTmp,
          spdDelta: Math.round(spdDelta),
          denRatio: +denRatio.toFixed(2),
          tmpRatio: haveTmp ? +tmpRatio.toFixed(2) : null,
          btDelta:  +btDelta.toFixed(1),
          bzDelta:  +bzDelta.toFixed(1),
        };
      }
    }

    if (!bestEvent) {
      note('shock', 'quiet',
        `no shock above threshold; ${candidates} candidate windows, temperature ${tempAvailable ? 'present' : 'absent'}, latest speed ${Math.round(plasmaPoints.at(-1)?.speed ?? 0)} km/s`);
      return;
    }

    if (bestEvent.shockType !== 'ff') {
      note('shock', 'detected-not-notified', `shock-${bestEvent.shockType} found; only shock-ff sends notifications`);
      return;
    }

    const prevState = await kv(env).get('STATE_shock', 'json') || {};
    const lastShockTs = prevState[`last_${bestEvent.shockType}`] || 0;
    if (Date.now() - lastShockTs < COOLDOWN_MS) {
      note('shock', 'suppressed', `shock-ff detected but last fired ${Math.round((Date.now() - lastShockTs) / 60000)} min ago`);
      return;
    }

    const topic = `shock-${bestEvent.shockType}`;
    if (!(await checkAndSetCooldown(topic, COOLDOWN_MINUTES, env))) {
      note('shock', 'suppressed', `${topic} cooldown key active`);
      return;
    }

    const latestP = plasmaPoints[plasmaPoints.length - 1];
    const prevP   = plasmaPoints[plasmaPoints.length - 2] || latestP;
    const latestM = magPoints[magPoints.length - 1];
    const prevM   = magPoints[magPoints.length - 2] || latestM;

    const SHOCK_LABELS = {
      ff:  { emoji: '💥', title: 'CME Has Hit the Satellites!',   summary: 'A fast forward shock has been detected at the L1 satellites. Speed, density and magnetic field all jumped, which is the classic CME arrival signature.' },
      sf:  { emoji: '💥', title: 'Compression Wave Detected',     summary: 'A slow forward shock has arrived at L1, a compression wave with rising speed and density but dropping magnetic field.' },
      fr:  { emoji: '💥', title: 'CME Trailing Edge Passing',     summary: 'A fast reverse shock detected, the back end of a CME or high-speed stream is sweeping past.' },
      sr:  { emoji: '💥', title: 'Trailing Rarefaction Detected', summary: 'A slow reverse shock at L1, density falling with a magnetic uptick.' },
      imf: { emoji: '🧲', title: 'Sudden IMF Shift Detected',     summary: 'A sharp change in the interplanetary magnetic field was detected without a major plasma shock.' },
    };

    const info = SHOCK_LABELS[bestEvent.shockType];
    const title = `${info.emoji} ${info.title}`;
    const bodyLines = [
      info.summary, '',
      `Speed: ${Math.round(prevP.speed)} → ${Math.round(latestP.speed)} km/s${bestEvent.spdDelta !== 0 ? ` (${bestEvent.spdDelta > 0 ? '+' : ''}${bestEvent.spdDelta})` : ''}`,
      `Density: ${prevP.density.toFixed(1)} → ${latestP.density.toFixed(1)} p/cm³ (×${bestEvent.denRatio})`,
    ];
    if (bestEvent.tmpRatio != null) bodyLines.push(`Temperature: ×${bestEvent.tmpRatio}`);
    bodyLines.push(
      `Bt: ${prevM.bt.toFixed(1)} → ${latestM.bt.toFixed(1)} nT (${bestEvent.btDelta > 0 ? '+' : ''}${bestEvent.btDelta})`,
      `Bz: ${prevM.bz.toFixed(1)} → ${latestM.bz.toFixed(1)} nT`,
    );
    bodyLines.push('', 'L1 satellites sit about 45 to 60 minutes upstream of Earth. This shockwave is likely already reaching us.');

    await notifyTopic(topic, title, bodyLines.join('\n'), env, { url: '/?page=forecast' });
    note('shock', 'fired', `${topic}${bestEvent.haveTmp ? '' : ' (without temperature)'}`);

    await kv(env).put('STATE_shock', JSON.stringify({ ...prevState, [`last_${bestEvent.shockType}`]: Date.now() }));
  } catch (e) {
    note('shock', 'error', e.message);
    reportError(e, env, { handler: 'checkShockDetection' });
  }
}

const OVERNIGHT_MODE_THRESHOLDS = {
  'every-night': 0,
  'camera':      25,
  'phone':       40,
  'eye':         55,
};

async function checkOvernightWatch(env, forecastData, substormData, magPoints = [], plasmaPoints = [], note = /** @type {(name?: string, status?: string, detail?: string) => void} */ (() => {})) {
  if (!forecastData?.currentForecast) { note('overnight', 'skipped', 'forecast unavailable'); return; }

  const sunsetMs = forecastData?.currentForecast?.sun?.set ?? null;
  if (!sunsetMs || !Number.isFinite(sunsetMs)) { note('overnight', 'skipped', 'sunset timestamp missing'); return; }

  const now = Date.now();
  const SUNSET_WINDOW_MS = 12 * 60 * 1000;
  if (now < sunsetMs) { note('overnight', 'waiting', `sunset in ${Math.round((sunsetMs - now) / 60000)} min`); return; }
  if (now > sunsetMs + SUNSET_WINDOW_MS) { note('overnight', 'waiting', `outside the 12 min post-sunset window`); return; }

  try {
    const auroraScore = forecastData?.currentForecast?.spotTheAuroraForecast ?? 0;
    const bz       = magPoints.at(-1)?.bz ?? substormData?.metrics?.solar_wind?.bz ?? null;
    const bt       = magPoints.at(-1)?.bt ?? substormData?.metrics?.solar_wind?.bt ?? null;
    const speed    = plasmaPoints.at(-1)?.speed ?? substormData?.metrics?.solar_wind?.speed ?? null;
    const hp       = substormData?.metrics?.solar_wind?.hemispheric_power
                  ?? substormData?.metrics?.hemispheric_power ?? null;
    const southMin = substormData?.metrics?.solar_wind?.southward_minutes_30m ?? 0;
    const trend    = substormData?.current?.risk_trend ?? null;
    const moonData = forecastData?.currentForecast?.moon;
    const sunsetDate = new Date(sunsetMs).toLocaleDateString('en-NZ', { timeZone: 'Pacific/Auckland' });
    const moonPct = moonData?.illumination != null ? Math.round(moonData.illumination) : null;

    const condition = classifyOvernightConditions({ hp, bt, bz, speed, southMin, trend, auroraScore, moonPct });
    const body = condition.buildBody();

    // Queued rather than sent inline. At this subscriber count a single
    // invocation cannot get through the list, and the per-subscriber checks
    // (mode, score, the three hour cooldown, the once-a-night marker) move
    // into the shard worker unchanged.
    const payload = {
      title: `\uD83C\uDF0C Tonight's aurora outlook: ${condition.label}`,
      body,
      tag: 'overnight-watch',
      data: { url: '/?page=forecast', category: 'overnight-watch' },
      ts: Date.now(),
    };
    const jobId = await enqueueDelivery(env, {
      kind: 'overnight', topic: 'overnight-watch', payload,
      params: { sunsetDate, auroraScore },
    });
    note('overnight', 'queued', `tier ${condition.tier}, job ${jobId}`);
  } catch (e) {
    note('overnight', 'error', e.message);
    reportError(e, env, { handler: 'checkOvernightWatch' });
  }
}

function geoToGmag(latDeg, lonDeg) {
  const phi = latDeg * Math.PI / 180;
  const lam = lonDeg * Math.PI / 180;
  const sin = Math.sin(phi) * Math.sin(POLE_LAT_RAD) +
              Math.cos(phi) * Math.cos(POLE_LAT_RAD) * Math.cos(lam - POLE_LON_RAD);
  return Math.asin(Math.max(-1, Math.min(1, sin))) * 180 / Math.PI;
}

// ── Oval boundary physics (mirrors the app's utils/ovalPhysics.ts) ──────────
const D2R_RM = Math.PI / 180;
const R2D_RM = 180 / Math.PI;

function rmBeta(date) {
  const MJD = date.getTime() / 86400000 + 40587;
  const T0 = (MJD - 51544.5) / 36525.0;
  const H = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const M = (357.528 + 35999.050 * T0 + 0.04107 * H) * D2R_RM;
  const Lam = 280.460 + 36000.772 * T0 + 0.04107 * H;
  const lambdaSun = (Lam + (1.915 - 0.0048 * T0) * Math.sin(M) + 0.020 * Math.sin(2 * M)) * D2R_RM;
  const eps = (23.439 - 0.013 * T0) * D2R_RM;
  const theta = ((100.461 + 36000.770 * T0 + 15.04107 * H) % 360) * D2R_RM;
  const phi = 80.65 * D2R_RM, lam = -72.68 * D2R_RM;
  const Qg = [Math.cos(phi) * Math.cos(lam), Math.cos(phi) * Math.sin(lam), Math.sin(phi)];
  const ct = Math.cos(theta), st = Math.sin(theta);
  const Qei = [ct * Qg[0] - st * Qg[1], st * Qg[0] + ct * Qg[1], Qg[2]];
  const ce = Math.cos(eps), se = Math.sin(eps);
  const a = [Qei[0], ce * Qei[1] + se * Qei[2], -se * Qei[1] + ce * Qei[2]];
  const cl = Math.cos(lambdaSun), sl = Math.sin(lambdaSun);
  const Qgse = [cl * a[0] + sl * a[1], -sl * a[0] + cl * a[1], a[2]];
  const psi = Math.atan2(Qgse[1], Qgse[2]) * R2D_RM;
  const i_s = 7.25 * D2R_RM, Omega = 75.76 * D2R_RM;
  const delta = Math.atan(Math.tan(i_s) * Math.sin(lambdaSun - Omega)) * R2D_RM;
  return psi + delta;
}

function russellMcPherronFactor(date, byGsm, bzGsm) {
  if (byGsm == null || !Number.isFinite(byGsm)) return 1;
  const sinB = Math.sin(rmBeta(date) * D2R_RM);
  const projection = byGsm * sinB;
  const bzMag = Math.abs(bzGsm ?? 0);
  const marginality = 1 / (1 + bzMag / 5);
  const raw = 1 - 0.03 * projection * marginality;
  return Math.min(1.15, Math.max(0.90, raw));
}

function pressureShiftDegrees(pdynNPa) {
  if (pdynNPa == null || !Number.isFinite(pdynNPa) || pdynNPa <= 0) return 0;
  const shift = 0.9 * Math.log2(Math.max(pdynNPa, 0.25) / 2.0);
  return Math.min(3.0, Math.max(-1.0, shift));
}

// FIX 4: when the substorm worker is unavailable, the newell average and the
// dynamic pressure can be computed from the RTSW series this worker already
// has. Previously visibility returned early and went silent for as long as
// that other worker was down, with nothing to say why.
function newellAverageFromSeries(magPoints, plasmaPoints, minutes) {
  const series = buildNewellSeries(magPoints, plasmaPoints);
  if (!series.length) return null;
  const cutoff = Date.now() - minutes * 60 * 1000;
  const vals = series.filter(p => p.x >= cutoff).map(p => p.y);
  if (!vals.length) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

function pressureAverageFromSeries(plasmaPoints, minutes) {
  if (!plasmaPoints?.length) return null;
  const cutoff = Date.now() - minutes * 60 * 1000;
  const vals = plasmaPoints.filter(p => p.ts >= cutoff && Number.isFinite(p.pressure)).map(p => p.pressure);
  if (!vals.length) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

function ovalBoundary(substormData, latestBy = null, fallback = null) {
  const sw = substormData?.metrics?.solar_wind;
  let newell60 = sw?.newell_avg_60m;
  let newell30 = sw?.newell_avg_30m;
  let bzForRm  = sw?.bz;
  let pdyn     = sw?.avg_30m_pressure_nPa ?? sw?.dynamic_pressure_nPa ?? null;

  if (!Number.isFinite(newell60) && !Number.isFinite(newell30) && fallback) {
    newell60 = fallback.newell60;
    newell30 = fallback.newell30;
    bzForRm  = fallback.bz;
    pdyn     = fallback.pdyn;
  }

  let newell = Math.max(Number(newell60) || 0, (Number(newell30) || 0) * 0.85);
  newell *= russellMcPherronFactor(new Date(), latestBy, bzForRm);

  const bayOnset = substormData?.current?.bay_onset_flag ?? false;
  let boundary = -(65.5 - newell / 1800);
  boundary += pressureShiftDegrees(pdyn);
  boundary = Math.max(boundary, -76);
  boundary = Math.min(boundary, -44);
  if (bayOnset) boundary = Math.min(boundary, -47.2);
  return boundary;
}

function visibilityDegrees(score) {
  return 9.0 + (Math.max(0, Math.min(score, 100)) / 100) * 16.0;
}

// FIX 2: the tiers were inverted. These numbers are used as `distToVis <= -X`,
// so a SMALLER number is an easier tier to reach. A DSLR on a tripod picks up
// aurora far fainter than a phone can, and a phone sees fainter than the eye,
// so the order must be dslr (easiest) then phone then naked. It used to be
// dslr 3 / phone 1, meaning phone was easier than dslr, and since the tiers
// were tested naked, phone, dslr in an if/else chain, anything that satisfied
// dslr had already matched phone. visibility-dslr could never fire at all.
function moonAdjustedTriggers(moonIllum, moonUp) {
  const illum = moonUp ? moonIllum : 0;
  // dslr easiest, naked hardest. -999 means that tier is impossible tonight.
  let dslr = 1.0, phone = 3.0, naked = 5.0;
  if (illum >= 80) {
    dslr = 6.0; phone = -999; naked = 12.0;
  } else if (illum >= 60) {
    dslr = 4.0; phone = 8.0; naked = 10.0;
  } else if (illum >= 40) {
    dslr = 3.0; phone = 5.0; naked = 8.0;
  } else if (illum >= 20) {
    dslr = 2.0; phone = 4.0; naked = 7.0;
  }
  return { dslr, phone, naked };
}

function avgBy30m(magPoints) {
  if (!Array.isArray(magPoints) || magPoints.length === 0) return null;
  const cutoff = Date.now() - 30 * 60 * 1000;
  const vals = magPoints.filter(p => p.ts >= cutoff && p.by != null && Number.isFinite(p.by)).map(p => p.by);
  if (!vals.length) {
    const last = magPoints[magPoints.length - 1]?.by;
    return last != null && Number.isFinite(last) ? last : null;
  }
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

/** Pick the best tier a site qualifies for. Strength order, not if/else order. */
function pickVisibilityTier(distToVis, distToBoundary, triggers) {
  if (triggers.naked > 0 && distToBoundary <= triggers.naked && distToBoundary > -20) return 'naked';
  if (triggers.phone > 0 && distToVis <= -triggers.phone) return 'phone';
  if (triggers.dslr  > 0 && distToVis <= -triggers.dslr)  return 'dslr';
  return null;
}

async function checkVisibilityNotifications(env, substormData, forecastData, magPoints = [], plasmaPoints = [], note = /** @type {(name?: string, status?: string, detail?: string) => void} */ (() => {})) {
  try {
    const visLastRun = await kv(env).get('STATE_vis_last_run');
    if (visLastRun && (Date.now() - Number(visLastRun)) < 4.5 * 60 * 1000) {
      note('visibility', 'throttled', 'ran less than 4.5 min ago');
      return;
    }
    await kv(env).put('STATE_vis_last_run', Date.now().toString(), { expirationTtl: 600 });
  } catch { /* non-critical */ }

  try {
    // FIX 4: build a fallback from RTSW rather than bailing out when the
    // substorm worker is unreachable.
    let usingFallback = false;
    let fallback = null;
    if (!substormData?.metrics?.solar_wind) {
      const newell60 = newellAverageFromSeries(magPoints, plasmaPoints, 60);
      const newell30 = newellAverageFromSeries(magPoints, plasmaPoints, 30);
      if (newell60 != null || newell30 != null) {
        usingFallback = true;
        fallback = {
          newell60: newell60 ?? 0,
          newell30: newell30 ?? 0,
          bz: magPoints.at(-1)?.bz ?? null,
          pdyn: pressureAverageFromSeries(plasmaPoints, 30),
        };
        console.warn('[visibility] substorm worker unavailable - computing the oval from RTSW data instead');
      } else {
        note('visibility', 'skipped', 'no substorm data and no RTSW series to fall back on');
        return;
      }
    }

    const auroraScore = forecastData?.currentForecast?.spotTheAuroraForecast ?? 0;
    const latestBy = avgBy30m(magPoints);
    const boundary = ovalBoundary(substormData, latestBy, fallback);
    const visDeg   = visibilityDegrees(auroraScore);
    const bz       = substormData?.metrics?.solar_wind?.bz ?? magPoints.at(-1)?.bz ?? 0;
    const speed    = substormData?.metrics?.solar_wind?.speed ?? plasmaPoints.at(-1)?.speed ?? 0;

    const sunsetMs  = forecastData?.currentForecast?.sun?.set ?? null;
    const sunriseMs = forecastData?.currentForecast?.sun?.rise ?? null;
    const nowMs     = Date.now();
    if (sunsetMs && sunriseMs) {
      if (nowMs > sunriseMs && nowMs < sunsetMs) {
        note('visibility', 'skipped', 'daylight');
        return;
      }
    }

    const moonData        = forecastData?.currentForecast?.moon;
    const moonIllumGlobal = moonData?.illumination ?? 0;
    const moonRiseMs      = moonData?.rise ?? null;
    const moonSetMs       = moonData?.set ?? null;
    const moonUpGlobal    = moonRiseMs && moonSetMs
      ? (moonRiseMs < moonSetMs
          ? (nowMs >= moonRiseMs && nowMs < moonSetMs)
          : (nowMs >= moonRiseMs || nowMs < moonSetMs))
      : true;

    const triggers = moonAdjustedTriggers(moonIllumGlobal, moonUpGlobal);
    const visHorizonGmag = boundary + visDeg;

    // Queued, for the same reason as the nightly outlook. Everything that
    // decides whether a given person hears about it - their location, which
    // tier they reach, whether that is an escalation on last time, their opt
    // in and their two hour cooldown - happens per subscriber in the shard
    // worker, exactly as it did in this loop.
    const statsLine = `Bz ${Number(bz).toFixed(1)} nT \u00b7 Speed ${Math.round(speed)} km/s`;
    const jobId = await enqueueDelivery(env, {
      kind: 'visibility', topic: 'visibility', payload: null,
      params: { boundary, visHorizonGmag, triggers, statsLine },
    });
    note('visibility', 'queued',
      `boundary ${boundary.toFixed(1)} horizon ${visHorizonGmag.toFixed(1)}${usingFallback ? ' (RTSW fallback)' : ''}, job ${jobId}`);
  } catch (e) {
    note('visibility', 'error', e.message);
    reportError(e, env, { handler: 'checkVisibilityNotifications' });
  }
}

// ── Request handlers ────────────────────────────────────────────────────────

/** KV keys that are worker state, not subscribers. */
// Everything in the namespace that is not a subscriber. Job, shard and census
// keys begin with J and S, which are also shard characters, so a shard listing
// will walk straight over them; the `.subscription` guard downstream catches
// them anyway, but naming them here saves the read.
function isReservedKey(name) {
  return name.startsWith('STATE_') || name.startsWith('LATEST_') ||
         name.startsWith('CONFIG_') || name.startsWith('COOLDOWN_') ||
         name.startsWith('LAST_') || name.startsWith('JOB_') ||
         name.startsWith('JOBSHARD_') || name.startsWith('STATSSHARD_') ||
         name.startsWith('SEND_') || name.startsWith('CLK_') ||
         name.startsWith('MIGSHARD_') || name === MIGRATION_KEY ||
         name === STATS_KEY || name === SELF_ORIGIN_KEY || name === SEND_LOG_KEY;
}

async function handleCheckSubscription(request, env) {
  try {
    const { endpoint } = await request.json();
    if (!endpoint) return json({ saved: false, error: 'No endpoint provided' }, 400);
    const id = await createSubscriptionId(endpoint);
    const stored = await kv(env).get(id, 'json');
    if (!stored?.subscription) return json({ saved: false });
    return json({
      saved: true,
      locationSource: stored.location?.locationSource ?? 'unknown',
      latitude: stored.location?.latitude ?? null,
      longitude: stored.location?.longitude ?? null,
      country: stored.location?.country ?? null,
      timezone: stored.location?.timezone ?? null,
      locationUpdatedAt: stored.location?.locationUpdatedAt ?? null,
      preferenceCount: Object.keys(stored.preferences ?? {}).length,
    });
  } catch (e) {
    reportError(e, env, { handler: 'handleCheckSubscription' });
    return json({ saved: false, error: e.message }, 500);
  }
}

// <generated:topics>
// Generated from utils/notificationCategories.ts by `npm run sync:topics`.
// Do not edit by hand - add the topic to the manifest and re-run the script.
// `npm run test:topics` fails if this block and the manifest disagree.
const ALL_TOPICS = [
  // visibility
  'visibility-dslr', 'visibility-phone', 'visibility-naked',
  // forecast
  'overnight-watch',
  // solar
  'flare-M1', 'flare-M5', 'flare-X1',
  'flare-X5', 'flare-X10', 'shock-ff',
  'shock-sf', 'shock-fr', 'shock-sr',
  // announcements
  'admin-broadcast',
  // no group - live but not shown in the app
  'flare-event', 'flare-peak', 'substorm-forecast',
  'shock-imf',
];

// What a subscriber gets for a topic they have never been asked about. This
// has to match the app's own defaults: the settings screen shows a topic the
// user has never touched as on if it is in here, so storing false would mean
// the switch says one thing and the worker does another.
const TOPIC_DEFAULT_ON = new Set([
  'visibility-dslr', 'visibility-phone', 'visibility-naked',
  'overnight-watch', 'flare-M1', 'flare-M5',
  'flare-X1', 'flare-X5', 'flare-X10',
  'admin-broadcast', 'flare-event', 'flare-peak',
  'substorm-forecast',
]);
// </generated:topics>

// ── Subscriber migration ────────────────────────────────────────────────────
//
// Brings every stored subscriber up to the current set of topics without
// anybody having to re-subscribe, re-grant permission, or notice.
//
// It fixes a real disagreement between the two halves of the system. The old
// migration wrote `false` for any topic a subscriber had never been asked
// about, but the app's settings screen shows an untouched topic as ON when it
// is in the default set. So the switch said one thing and the worker did
// another, and the user had no way to tell. Defaults now come from the same
// manifest the app uses, generated into TOPIC_DEFAULT_ON above.
//
// Three properties it has to have, given it runs across 80,000 records:
//
//   sharded     the same 64 prefixes delivery uses, so no invocation has to
//               walk the whole namespace and time out half way
//   idempotent  running it twice changes nothing the second time, so a retry
//               after a failure is always safe
//   additive    a preference a user has actually set is never overwritten.
//               Only keys that are absent get filled in.

const MIGRATION_VERSION = 2;
const MIGRATION_KEY = 'MIGRATION';
const migrationShardKey = (ch) => `MIGSHARD_${ch}`;

/**
 * Bring one shard's subscribers up to date.
 * Returns how many records it changed.
 */
async function runMigrationShard(env, ch) {
  let changedCount = 0, seen = 0, errors = 0;
  let cursor;

  do {
    const res = await kv(env).list({ prefix: ch, cursor, limit: 1000 });
    for (const key of res.keys) {
      if (isReservedKey(key.name)) continue;
      try {
        const stored = await kv(env).get(key.name, 'json');
        if (!stored?.subscription) continue;
        seen++;

        const prefs = { ...(stored.preferences || {}) };
        let changed = false;

        // Anyone who opted into the old catch-all shock topic keeps that
        // choice across the split into per-type shocks.
        if (prefs['shock-detection'] === true || prefs['ips-shock'] === true) {
          for (const st of ['shock-ff', 'shock-sf', 'shock-fr', 'shock-sr', 'shock-imf']) {
            if (prefs[st] === undefined) { prefs[st] = true; changed = true; }
          }
        }

        // Fill in anything they have never been asked about, using the same
        // default the app would show them. Never touch a key they have set.
        for (const topic of ALL_TOPICS) {
          if (prefs[topic] === undefined) {
            prefs[topic] = TOPIC_DEFAULT_ON.has(topic);
            changed = true;
          }
        }

        if (changed) {
          await kv(env).put(key.name, JSON.stringify({ ...stored, preferences: prefs }));
          changedCount++;
        }
      } catch (e) {
        errors++;
        console.error('[migrate] error on', key.name, e.message);
      }
    }
    cursor = res.cursor;
    if (res.list_complete) break;
  } while (cursor);

  await kv(env).put(migrationShardKey(ch), JSON.stringify({
    version: MIGRATION_VERSION, seen, changed: changedCount, errors, at: Date.now(),
  }));
  console.log(`[migrate] shard ${ch}: ${changedCount} of ${seen} updated, ${errors} error(s)`);
  return { seen, changed: changedCount, errors };
}

/**
 * Run the migration once per version, automatically, off the cron.
 *
 * Deploying is pasting a file into a dashboard, so anything that needs a
 * follow-up curl is something that will eventually be forgotten. Bumping
 * MIGRATION_VERSION is all a future change needs.
 */
async function maybeRunMigration(env, note = /** @type {(name?: string, status?: string, detail?: string) => void} */ (() => {})) {
  const state = await kv(env).get(MIGRATION_KEY, 'json');
  if (state?.version >= MIGRATION_VERSION && state?.complete) return;

  const origin = await resolveSelfUrl(env);
  if (!origin) {
    note('migrate', 'skipped', 'no self origin known yet');
    return;
  }

  if (!state || state.version < MIGRATION_VERSION) {
    await kv(env).put(MIGRATION_KEY, JSON.stringify({
      version: MIGRATION_VERSION, startedAt: Date.now(), complete: false,
    }));
    // Clear the previous version's shard markers so this run is judged on its
    // own results rather than inheriting the last one's.
    for (const ch of SHARD_CHARS) await kv(env).delete(migrationShardKey(ch));
    note('migrate', 'started', `version ${MIGRATION_VERSION}`);
  }

  // Dispatch only the shards that have not reported in for this version, so a
  // sweep after a partial run finishes the job rather than redoing it.
  const due = [];
  for (const ch of SHARD_CHARS) {
    const done = await kv(env).get(migrationShardKey(ch), 'json');
    if (done?.version !== MIGRATION_VERSION) due.push(ch);
  }

  if (!due.length) {
    const totals = await migrationTotals(env);
    await kv(env).put(MIGRATION_KEY, JSON.stringify({
      version: MIGRATION_VERSION, complete: true, finishedAt: Date.now(),
      finishedAtNZ: nzTimestamp(Date.now()), ...totals,
    }));
    note('migrate', 'complete', `${totals.changed} of ${totals.seen} records updated`);
    return;
  }

  note('migrate', 'running', `${due.length} shard(s) left`);
  for (const ch of due) {
    keepAlive(env, fetch(new URL('/run-migration-shard', origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.TRIGGER_SECRET, shard: ch }),
    }).catch(e => console.error(`[migrate] dispatch ${ch} failed:`, e.message)));
  }
}

async function migrationTotals(env) {
  let seen = 0, changed = 0, errors = 0, shards = 0;
  for (const ch of SHARD_CHARS) {
    const s = await kv(env).get(migrationShardKey(ch), 'json');
    if (s?.version !== MIGRATION_VERSION) continue;
    shards++; seen += s.seen ?? 0; changed += s.changed ?? 0; errors += s.errors ?? 0;
  }
  return { shards, seen, changed, errors };
}

async function handleRunMigrationShard(request, env) {
  const { secret, shard } = await request.json().catch(() => ({}));
  if (!secret || secret !== env.TRIGGER_SECRET) return new Response('Forbidden', { status: 403 });
  if (!SHARD_CHARS.includes(shard)) return json({ error: 'bad shard' }, 400);
  return json(await runMigrationShard(env, shard));
}

/** GET /migration - how the migration went, without digging through logs. */
async function handleMigrationStatus(request, env) {
  const url = new URL(request.url);
  if (url.searchParams.get('secret') !== env.TRIGGER_SECRET) return new Response('Forbidden', { status: 403 });
  const state = await kv(env).get(MIGRATION_KEY, 'json');
  return json({
    version: MIGRATION_VERSION,
    state: state ?? 'never run',
    progress: await migrationTotals(env),
  });
}

async function handleMigratePreferences(request, env) {
  try {
    const { secret } = await request.json();
    const validSecrets = [env.TRIGGER_SECRET, env.BANNER_AUTH_TOKEN].filter(Boolean);
    if (!secret || !validSecrets.includes(secret)) return json({ error: 'Unauthorized' }, 401);
    // Force a re-run even if this version already completed.
    await kv(env).delete(MIGRATION_KEY);
    for (const ch of SHARD_CHARS) await kv(env).delete(migrationShardKey(ch));
    await maybeRunMigration(env);
    return json({ success: true, started: true, version: MIGRATION_VERSION,
                  watch: '/migration?secret=...' });
  } catch (e) {
    reportError(e, env, { handler: 'handleMigratePreferences' });
    return json({ error: e.message }, 500);
  }
}

/**
 * Why each detector did or did not fire on the last scheduled run, plus a
 * count of who is opted in to what. This exists so a silent detector is
 * visible without reading Cloudflare logs, which is how all four of the
 * bugs above stayed hidden.
 */
async function handleDiagnostics(request, env) {
  const url = new URL(request.url);
  const secret = url.searchParams.get('secret');
  if (!secret || secret !== env.TRIGGER_SECRET) return new Response('Forbidden', { status: 403 });
  try {
    const diag = await kv(env).get(DIAG_KEY, 'json');
    const lastRun = await kv(env).get('LAST_SUCCESSFUL_RUN_TIMESTAMP');

    // Reads the census snapshot rather than walking every subscriber, which
    // at this volume would be 80,000 KV reads per call to /diagnostics.
    const stats = await kv(env).get(STATS_KEY, 'json');

    const cooldowns = {};
    for (const t of [...ALL_TOPICS, 'flare-peak', 'flare-event']) {
      const v = await kv(env).get(`COOLDOWN_${t}`);
      if (v) cooldowns[t] = `${Math.round((Date.now() - Number(v)) / 60000)} min ago`;
    }

    return json({
      lastRun: lastRun ? Number(lastRun) : null,
      lastRunAgo: lastRun ? `${Math.round((Date.now() - Number(lastRun)) / 60000)} min ago` : 'never',
      subscribers: stats ? stats.subscribers : 'no census yet',
      subscribedToSomething: stats ? stats.subscribedToSomething : null,
      withLocation: stats ? stats.withLocation : null,
      optedIn: stats ? stats.byCategory : 'no census yet',
      statsTakenAt: stats ? stats.takenAtNZ : null,
      activeCooldowns: cooldowns,
      outbox: await handleJobSummary(env),
      lastScheduledRun: diag ?? 'no diagnostics recorded yet',
      state: await getCurrentStatus(env),
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

async function handleSendBroadcast(request, env) {
  try {
    const { secret, title, body, url } = await request.json();
    const validSecrets = [env.TRIGGER_SECRET, env.BANNER_AUTH_TOKEN].filter(Boolean);
    if (!secret || !validSecrets.includes(secret)) return json({ error: 'Unauthorized' }, 401);
    if (!title || !body) return json({ error: 'title and body are required' }, 400);
    const topic = 'admin-broadcast';
    const payload = { title, body, tag: topic, data: { url: url || '/', category: topic }, ts: Date.now() };
    await kv(env).put(`LATEST_ALERT_${topic}`, JSON.stringify(payload), { expirationTtl: 86400 });
    // Delivery is now a job rather than a single pass, so this returns
    // immediately with an id. Watch it with /job?id=...&secret=...
    const jobId = await enqueueDelivery(env, { kind: 'topic', topic, payload });
    return json({ success: true, queued: true, jobId, watch: `/job?id=${jobId}` });
  } catch (e) {
    reportError(e, env, { handler: 'handleSendBroadcast' });
    return json({ error: e.message }, 500);
  }
}

async function handleDeleteSubscription(request, env) {
  try {
    const { endpoint } = await request.json();
    if (!endpoint) return json({ deleted: false, error: 'No endpoint provided' }, 400);
    const id = await createSubscriptionId(endpoint);
    const stored = await kv(env).get(id, 'json');
    if (!stored?.subscription) return json({ deleted: false, error: 'Subscription not found' }, 404);
    await kv(env).delete(id);
    return json({ deleted: true });
  } catch (e) {
    reportError(e, env, { handler: 'handleDeleteSubscription' });
    return json({ deleted: false, error: e.message }, 500);
  }
}

async function handleUpdateLocation(request, env) {
  try {
    const { endpoint, latitude, longitude } = await request.json();
    if (!endpoint || latitude == null || longitude == null) return new Response('Invalid', { status: 400 });
    const id = await createSubscriptionId(endpoint);
    const stored = await kv(env).get(id, 'json');
    if (!stored?.subscription) return json({ ok: false, reason: 'no subscription' });
    stored.location = { ...stored.location, latitude, longitude, locationSource: 'gps', locationUpdatedAt: Date.now() };
    await kv(env).put(id, JSON.stringify(stored));
    return json({ ok: true });
  } catch (e) {
    reportError(e, env, { handler: 'handleUpdateLocation' });
    return json({ ok: false, error: e.message }, 500);
  }
}

async function handleSaveSubscription(request, env) {
  if (!kv(env)) return new Response('KV namespace missing.', { status: 500 });
  try {
    const { subscription, preferences, timezone, latitude, longitude, overnight_mode } = await request.json();
    if (!subscription?.endpoint) return new Response('Invalid subscription', { status: 400 });

    const cfLat = request.cf?.latitude != null ? Number(request.cf.latitude) : null;
    const cfLon = request.cf?.longitude != null ? Number(request.cf.longitude) : null;
    const resolvedLat = latitude != null ? latitude : (cfLat != null && isFinite(cfLat) ? cfLat : null);
    const resolvedLon = longitude != null ? longitude : (cfLon != null && isFinite(cfLon) ? cfLon : null);

    const location = {
      timezone:          timezone || request.cf?.timezone || null,
      latitude:          resolvedLat,
      longitude:         resolvedLon,
      country:           request.cf?.country || null,
      locationSource:    latitude != null ? 'gps' : (resolvedLat != null ? 'ip' : 'unknown'),
      locationUpdatedAt: Date.now(),
    };

    if (resolvedLat == null || resolvedLon == null) {
      console.warn('[save-subscription] No coordinates captured - visibility notifications will not fire for this subscriber.');
    }

    const id = await createSubscriptionId(subscription.endpoint);
    const existing = await kv(env).get(id, 'json') || {};
    const record = {
      ...existing,
      subscription,
      preferences,
      location,
      overnight_mode: overnight_mode || existing.overnight_mode || 'phone',
      // Additive. Lets the census report how many subscriptions are still
      // being refreshed by a live app rather than just how many rows exist.
      lastSeenAt: Date.now(),
    };
    await kv(env).put(id, JSON.stringify(record));
    // The app stores this id so a single device can be targeted for testing.
    return json({ message: 'Saved', id }, 201);
  } catch (e) {
    reportError(e, env, { handler: 'handleSaveSubscription' });
    return new Response(`Failed: ${e.message}`, { status: 500 });
  }
}

async function handleGetStatus(request, env) {
  const url = new URL(request.url);
  const secret = url.searchParams.get('secret');
  if (!secret || secret !== env.TRIGGER_SECRET) return new Response('Forbidden', { status: 403 });
  return json({ status: await getCurrentStatus(env) });
}

function buildTestPayloadByType(type, url, snapshot) {
  const base = { ts: Date.now(), data: { url: '/' } };
  const t = (topic, title, body) => ({ ...base, title, body: `${body}\n\n${snapshot}`, tag: topic, topic });
  if (type === 'shock-ff')  return t('shock-ff',  'Test: CME Has Hit the Satellites!',   'Simulated fast forward shock at L1.');
  if (type === 'shock-sf')  return t('shock-sf',  'Test: Compression Wave Detected',     'Simulated slow forward shock at L1.');
  if (type === 'shock-fr')  return t('shock-fr',  'Test: CME Trailing Edge Passing',     'Simulated fast reverse shock.');
  if (type === 'shock-sr')  return t('shock-sr',  'Test: Trailing Rarefaction Detected', 'Simulated slow reverse shock.');
  if (type === 'shock-imf') return t('shock-imf', 'Test: Sudden IMF Shift Detected',     'Simulated IMF enhancement.');
  if (type === 'ips' || type === 'shock') return t('shock-ff', 'Test: CME Has Hit the Satellites!', 'Simulated shock arrival.');
  if (type === 'flare') {
    const raw = (url.searchParams.get('level') || 'M1').toUpperCase();
    const level = ['M1','M5','X1','X5','X10'].includes(raw) ? raw : 'M1';
    return t(`flare-${level}`, `Test: Solar Flare (${level})`, `Simulated ${level} flare.`);
  }
  if (type === 'flare-event') return t('flare-event', 'Test: M4.7 Solar Flare', 'A solar flare peaked at M4.7.');
  if (type === 'peak')        return t('flare-peak', 'Test: Flare Peaked', 'Simulated flare peak.');
  if (type === 'substorm')    return t('substorm-forecast', 'Test: Substorm Expected', 'Simulated substorm window.');
  if (type === 'overnight')   return t('overnight-watch', "Test: Tonight's aurora outlook", 'Simulated nightly outlook.');
  if (type === 'vis-dslr')    return t('visibility-dslr',  'Test: Aurora, DSLR Visible',  'Aurora detectable on a DSLR from your location.');
  if (type === 'vis-phone')   return t('visibility-phone', 'Test: Aurora, Phone Visible', 'Aurora visible on phone camera.');
  if (type === 'vis-naked')   return t('visibility-naked', 'Test: Aurora, Naked Eye',     'Aurora visible to naked eye from your location.');
  return { ...base, title: 'Server Test', body: `${snapshot}\n\nGeneric test push.`, tag: 'test', topic: 'test' };
}

async function handleTriggerTestPush(request, env) {
  try {
    const url = new URL(request.url);
    const secret = url.searchParams.get('secret');
    if (!secret || secret !== env.TRIGGER_SECRET) return new Response('Forbidden', { status: 403 });
    const type = (url.searchParams.get('type') || 'test').toLowerCase();
    const snapshot = await buildStatusSnapshot(env);
    const payload  = buildTestPayloadByType(type, url, snapshot);
    const jobId = await enqueueDelivery(env, { kind: 'topic', topic: payload.topic, payload });
    return json({ message: `Test push queued for topic '${payload.topic}'.`, jobId, watch: `/job?id=${jobId}` });
  } catch (err) {
    reportError(err, env, { handler: 'handleTriggerTestPush' });
    return json({ error: 'Failed.', message: err.message }, 500);
  }
}

async function handleTriggerSelfTest(request, env) {
  try {
    const { subscription, category } = await request.json();
    if (!subscription?.endpoint) return json({ error: 'Invalid subscription.' }, 400);

    const [forecastData, substormData, xrayData, rtswResult] = await Promise.all([
      getFullForecastData(env).catch(() => null),
      fetch(SUBSTORM_URL).then(r => r.ok ? r.json() : null).catch(() => null),
      fetchWithRetry(NOAA_XRAY_URL).then(r => r ? r.json() : null).catch(() => null),
      fetchAndParseRtswData(env),
    ]);

    const { magPoints, plasmaPoints } = rtswResult;
    const auroraScore = forecastData?.currentForecast?.spotTheAuroraForecast ?? 0;
    const bz    = magPoints.at(-1)?.bz ?? substormData?.metrics?.solar_wind?.bz ?? null;
    const speed = plasmaPoints.at(-1)?.speed ?? substormData?.metrics?.solar_wind?.speed ?? null;
    const bt    = magPoints.at(-1)?.bt ?? substormData?.metrics?.solar_wind?.bt ?? null;
    const hp    = substormData?.metrics?.solar_wind?.hemispheric_power ?? substormData?.metrics?.hemispheric_power ?? null;
    const southMin = substormData?.metrics?.solar_wind?.southward_minutes_30m ?? 0;
    const trend    = substormData?.current?.risk_trend ?? 'Stable';
    const moonPct  = forecastData?.currentForecast?.moon?.illumination != null
      ? Math.round(forecastData.currentForecast.moon.illumination) : null;
    const substormScore = substormData?.current?.score ?? 0;
    const substormLevel = substormData?.current?.level ?? 'Unknown';

    const statsLine = [
      bz    != null ? `Bz ${bz.toFixed(1)} nT` : null,
      speed != null ? `Speed ${Math.round(speed)} km/s` : null,
      bt    != null ? `Bt ${bt.toFixed(1)} nT` : null,
    ].filter(Boolean).join(' · ') || 'Solar wind data temporarily unavailable';

    let latestFlareClass = null;
    if (Array.isArray(xrayData)) {
      const series = xrayData
        .filter(d => d.energy === '0.1-0.8nm' && d.flux > 0)
        .sort((a, b) => new Date(b.time_tag).getTime() - new Date(a.time_tag).getTime());
      if (series.length) latestFlareClass = getXrayClass(series[0].flux);
    }

    let title, body, url;
    const SHOCK_TEST_LABELS = {
      'shock-ff':  { emoji: '💥', title: 'CME Has Hit the Satellites!',   summary: 'A fast forward shock has been detected at the L1 satellites.' },
      'shock-sf':  { emoji: '💥', title: 'Compression Wave Detected',     summary: 'A slow forward shock has arrived at L1.' },
      'shock-fr':  { emoji: '💥', title: 'CME Trailing Edge Passing',     summary: 'A fast reverse shock detected.' },
      'shock-sr':  { emoji: '💥', title: 'Trailing Rarefaction Detected', summary: 'A slow reverse shock at L1.' },
      'shock-imf': { emoji: '🧲', title: 'Sudden IMF Shift Detected',     summary: 'A sharp change in the interplanetary magnetic field.' },
    };

    switch (category) {
      case 'overnight-watch': {
        const condition = classifyOvernightConditions({ hp, bt, bz, speed, southMin, trend, auroraScore, moonPct });
        title = `🌌 Tonight's aurora outlook: ${condition.label}`;
        body  = condition.buildBody();
        url   = '/?page=forecast';
        break;
      }
      case 'visibility-naked':
        title = '👁️ Aurora, Naked Eye Visible';
        body  = `Aurora should be visible to the naked eye from your location. Head outside and look south.\n\n${statsLine}`;
        url   = '/?page=forecast'; break;
      case 'visibility-phone':
        title = '📱 Aurora, Phone Camera Visible';
        body  = `Aurora is bright enough for your phone camera. Point it south and try night mode.\n\n${statsLine}`;
        url   = '/?page=forecast'; break;
      case 'visibility-dslr':
        title = '📷 Aurora, DSLR Camera Visible';
        body  = `Aurora is detectable from your location with a camera on a tripod. Point south and try a long exposure.\n\n${statsLine}`;
        url   = '/?page=forecast'; break;
      case 'flare-event': {
        const cls = latestFlareClass ?? 'M1.0';
        title = `☀️ ${cls} Solar Flare`;
        body  = `A solar flare peaked at ${cls} at ${formatNzTime(Date.now())}.`;
        url   = '/?page=solar-activity&section=goes-xray-flux-section'; break;
      }
      case 'shock-ff': case 'shock-sf': case 'shock-fr': case 'shock-sr': case 'shock-imf': {
        const info = SHOCK_TEST_LABELS[category];
        const latestP = plasmaPoints.at(-1), prevP = plasmaPoints.at(-2) ?? latestP;
        const latestM = magPoints.at(-1),    prevM = magPoints.at(-2) ?? latestM;
        title = `${info.emoji} ${info.title}`;
        body  = latestP && prevP && latestM && prevM ? [
          info.summary, '',
          `Speed: ${Math.round(prevP.speed)} → ${Math.round(latestP.speed)} km/s`,
          `Density: ${prevP.density.toFixed(1)} → ${latestP.density.toFixed(1)} p/cm³`,
          `Bt: ${prevM.bt.toFixed(1)} → ${latestM.bt.toFixed(1)} nT  ·  Bz: ${prevM.bz.toFixed(1)} → ${latestM.bz.toFixed(1)} nT`,
        ].join('\n') : `${info.summary}\n\n${statsLine}`;
        url = '/?page=forecast'; break;
      }
      case 'shock-detection': case 'ips-shock': {
        const info = SHOCK_TEST_LABELS['shock-ff'];
        title = `${info.emoji} ${info.title}`;
        body  = `${info.summary}\n\n${statsLine}`;
        url   = '/?page=forecast'; break;
      }
      case 'substorm-forecast':
        title = '⚡ Substorm Watch: Energy Building';
        body  = `Substorm index ${Math.round(substormScore)} (${substormLevel}), magnetospheric energy is loading. Keep an eye on the forecast.\n\n${statsLine}`;
        url   = '/?page=forecast&section=unified-forecast-section'; break;
      default:
        title = 'Spot The Aurora: Test';
        body  = `Test for '${category || 'general'}', real data:\n\n${statsLine}`;
        url   = '/?page=forecast';
    }

    const payload = {
      title, body,
      tag: `test-${category || 'general'}`,
      data: { url: url || '/?page=forecast', category: category || 'general' },
      ts: Date.now(),
    };

    const response = await sendPushWithPayload(subscription, payload, env);
    if (response.ok) return json({ success: true, message: 'Test push sent.' });
    const errorBody = await response.text();
    console.error(`Self-test failed: ${response.status}`, errorBody);
    return json({ success: false, message: `Push service status ${response.status}.` }, 500);
  } catch (err) {
    reportError(err, env, { handler: 'handleTriggerSelfTest' });
    return json({ error: 'Internal error.' }, 500);
  }
}

async function handleRunShard(request, env) {
  const { secret, jobId, shard } = await request.json().catch(() => ({}));
  if (!secret || secret !== env.TRIGGER_SECRET) return new Response('Forbidden', { status: 403 });
  if (!jobId || !shard) return json({ error: 'jobId and shard are required' }, 400);
  const res = await runShard(env, jobId, shard);
  return json({ jobId, shard, ...res });
}

async function handleJobSummary(env) {
  const out = [];
  let cursor;
  do {
    const res = await kv(env).list({ prefix: 'JOB_', cursor, limit: 1000 });
    for (const k of res.keys) {
      const p = await jobProgress(env, k.name.slice(4));
      if (p) out.push({ id: p.id, topic: p.topic ?? p.kind, sent: p.sent, failed: p.failed,
                        shardsDone: `${p.shards.done}/${p.shards.total}`, complete: p.complete });
    }
    cursor = res.cursor;
    if (res.list_complete) break;
  } while (cursor);
  return out.length ? out : 'no jobs in flight';
}

async function handleRunCensusShard(request, env) {
  const { secret, censusId, shard } = await request.json().catch(() => ({}));
  if (!secret || secret !== env.TRIGGER_SECRET) return new Response('Forbidden', { status: 403 });
  if (!censusId || !shard) return json({ error: 'censusId and shard are required' }, 400);
  return json(await runCensusShard(env, censusId, shard));
}

/** The STATS key, served over HTTP. Also readable straight from the KV browser. */
async function handleStats(request, env) {
  const url = new URL(request.url);
  if (url.searchParams.get('secret') !== env.TRIGGER_SECRET) return new Response('Forbidden', { status: 403 });
  const snap = await kv(env).get(STATS_KEY, 'json');

  // Force first. Checking for an existing snapshot before honouring force=1
  // meant that on a fresh deploy - the one time you most want to force one -
  // this replied "no census yet, force it with ?force=1" to a request that
  // was already forcing it.
  if (url.searchParams.get('force') === '1') {
    await kv(env).delete(STATS_KEY);
    await maybeRunCensus(env);
    return json({
      started: true,
      note: snap
        ? 'A fresh census has been started. The numbers below are the previous one; read /stats again in a minute for the new count.'
        : 'First census started. It walks every subscriber across 64 shards - read /stats again in a minute.',
      previous: snap ?? null,
    });
  }

  if (!snap) return json({ error: 'No census has completed yet. One runs within the hour, or force it with ?force=1.' }, 404);
  return json(snap);
}

async function handleJob(request, env) {
  const url = new URL(request.url);
  if (url.searchParams.get('secret') !== env.TRIGGER_SECRET) return new Response('Forbidden', { status: 403 });
  const id = url.searchParams.get('id');
  if (id) {
    const p = await jobProgress(env, id);
    return p ? json(p) : json({ error: 'job not found or expired' }, 404);
  }
  // No id: list every job still in flight.
  const out = [];
  let cursor;
  do {
    const res = await kv(env).list({ prefix: 'JOB_', cursor, limit: 1000 });
    for (const k of res.keys) {
      const p = await jobProgress(env, k.name.slice(4));
      if (p) out.push(p);
    }
    cursor = res.cursor;
    if (res.list_complete) break;
  } while (cursor);
  out.sort((a, b) => b.createdAt - a.createdAt);
  return json({ jobs: out });
}

/**
 * The bare URL. Opening it to check the worker is alive is the obvious thing
 * to do, and a plain 404 answers that badly - it looks identical to a broken
 * deploy. This says what this is and whether the cron is still ticking.
 *
 * Public, so it names no secrets and lists no internal routes.
 */
async function handleRoot(env) {
  let lastRun = null, healthy = false;
  try {
    const ts = Number(await kv(env).get('LAST_SUCCESSFUL_RUN_TIMESTAMP')) || 0;
    if (ts) {
      lastRun = nzTimestamp(ts);
      healthy = (Date.now() - ts) <= HEALTH_CHECK_THRESHOLD_MS;
    }
  } catch { /* the page is still worth serving */ }

  const body = [
    'Spot The Aurora - push notification worker',
    '',
    healthy ? 'Status:   running' : 'Status:   the scheduled run is overdue',
    `Last run: ${lastRun ?? 'never'}`,
    '',
    'This worker has no public pages. /health returns the same as JSON.',
    'Everything else needs a secret.',
    '',
  ].join('\n');

  return new Response(body, {
    status: healthy ? 200 : 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function handleHealthCheck(env) {
  try {
    const tsStr = await kv(env).get('LAST_SUCCESSFUL_RUN_TIMESTAMP');
    const ts    = tsStr ? Number(tsStr) : 0;
    const now   = Date.now();
    const healthy = ts && (now - ts) <= HEALTH_CHECK_THRESHOLD_MS;
    return json({ ok: healthy, lastRun: ts || null, ageMs: ts ? (now - ts) : null }, healthy ? 200 : 503);
  } catch (e) {
    return json({ ok: false, error: 'health check failed' }, 500);
  }
}

function geoToGmagLatAdj(latDeg, lonDeg) {
  const phi = latDeg * Math.PI / 180;
  const lam = lonDeg * Math.PI / 180;
  const sinGmag = Math.sin(phi) * Math.sin(POLE_LAT_RAD) +
                  Math.cos(phi) * Math.cos(POLE_LAT_RAD) * Math.cos(lam - POLE_LON_RAD);
  return Math.asin(Math.max(-1, Math.min(1, sinGmag))) * 180 / Math.PI;
}

const GREYMOUTH_GMAG = geoToGmagLatAdj(GREYMOUTH_LATITUDE, 171.21);

function isUserInPlausibleZone(latitude) {
  const lat = parseFloat(latitude);
  return isNaN(lat) ? true : Math.abs(lat) > 30;
}

// ── Delivery: a durable, sharded, resumable outbox ──────────────────────────
//
// The old fan-out sent 40 and then fire-and-forget fetched the worker's own
// /broadcast-batch to do the next 40, up to 50 links. Three problems, and at
// 80k subscribers the first is fatal on its own:
//
//   1. 50 links x 40 = 2000 recipients. Everyone past that got nothing, ever.
//   2. Nothing awaited or recorded the chain. One dropped link and the rest of
//      the list silently missed the alert, with no way to know it happened.
//   3. Any push failure that was not a 410 or 404 was counted and forgotten.
//
// This replaces it with an outbox. An alert writes a job, and the job is
// carved into 64 shards that drain independently and in parallel.
//
// The sharding is free: subscriber keys are base64url SHA-256 of the endpoint,
// so the first character is uniform over the 64 character alphabet. That means
// kv.list({ prefix }) gives 64 disjoint slices with no cursor coordination
// between them, and each slice can be worked by its own invocation with its
// own subrequest budget.
//
// Durability comes from the cron sweep rather than from the dispatch. Every
// scheduled run looks for shards that are pending, or leased but stale, or
// failed and due a retry, and dispatches them again. So a dropped dispatch, an
// evicted worker or a push service having a bad minute costs a delay, not a
// missed alert. Shard progress is a cursor, so a resumed shard picks up where
// it stopped instead of starting over.
//
// Per-shard state lives in its own key so 64 workers never clobber each other
// by reading and rewriting one shared job object.

const SHARD_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.split('');
// Each push is one subrequest and the paid limit is 1000 per invocation. Leave
// headroom for the KV reads and the self-dispatch calls.
const SEND_BUDGET = 700;
// How long a shard may be claimed before the sweep assumes the worker died.
const SHARD_LEASE_MS = 90 * 1000;
const MAX_SHARD_ATTEMPTS = 8;
const JOB_TTL_SECONDS = 6 * 60 * 60;
// Retry backoff per attempt, capped.
const shardRetryDelayMs = (attempts) => Math.min(15 * 60 * 1000, 30 * 1000 * Math.pow(2, attempts));

const SELF_ORIGIN_KEY = 'SELF_ORIGIN';
const jobKey   = (id) => `JOB_${id}`;
const shardKey = (id, ch) => `JOBSHARD_${id}_${ch}`;

function newJobId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Queue an alert for delivery and kick off the shards.
 *
 * kind decides how each subscriber is judged inside the shard worker:
 *   'topic'      send payload to everyone with preferences[topic] === true
 *   'overnight'  per subscriber, by their overnight mode, score and cooldown
 *   'visibility' per subscriber, by their location and which tier they reach
 */
/**
 * @param {any} env
 * @param {{ kind: string, topic?: string|null, payload?: any, params?: any }} job
 */
async function enqueueDelivery(env, { kind, topic = null, payload = null, params = null }) {
  const id = newJobId();
  const job = {
    id, kind, topic,
    payload: payload ?? null,
    params: params ?? null,
    createdAt: Date.now(),
  };
  await kv(env).put(jobKey(id), JSON.stringify(job), { expirationTtl: JOB_TTL_SECONDS });
  await Promise.all(SHARD_CHARS.map(ch => kv(env).put(
    shardKey(id, ch),
    JSON.stringify({ state: 'pending', cursor: null, sent: 0, failed: 0, attempts: 0, leaseUntil: 0 }),
    { expirationTtl: JOB_TTL_SECONDS },
  )));
  console.log(`[outbox] job ${id} queued: kind=${kind} topic=${topic ?? '-'} across ${SHARD_CHARS.length} shards`);
  await dispatchShards(env, id, SHARD_CHARS);
  return id;
}

/** Fire one invocation per shard. Each gets its own subrequest budget. */
async function dispatchShards(env, jobId, chars) {
  const origin = await resolveSelfUrl(env);
  if (!origin) {
    console.error('[outbox] no self origin known - shards can only be drained by the cron sweep.');
    return;
  }
  for (const ch of chars) {
    keepAlive(env, fetch(new URL('/run-shard', origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.TRIGGER_SECRET, jobId, shard: ch }),
    }).catch(e => console.error(`[outbox] dispatch ${jobId}/${ch} failed:`, e.message)));
  }
}

/**
 * Where to call ourselves to fan a job out.
 *
 * SELF_URL is the supported way to configure this, but it is a plain var that
 * is easy to forget, and forgetting it is silent and total: the September 2026
 * audit found it had never been set in production, which on its own capped
 * every automatic notification at the first forty matching subscribers. So the
 * origin of any inbound request is cached in KV as a fallback. A cron-only
 * invocation has no request to learn from, but by the time one runs the worker
 * has almost certainly served a /save-subscription or a /health.
 */
async function resolveSelfUrl(env) {
  if (env.SELF_URL) return env.SELF_URL;
  try {
    const cached = await kv(env).get(SELF_ORIGIN_KEY);
    if (cached) return cached;
  } catch { /* KV unavailable; the sweep is still the backstop */ }
  return null;
}

/** Remember the origin we were reached on, so dispatch works without SELF_URL. */
async function rememberSelfOrigin(env, request) {
  if (env.SELF_URL) return;
  try {
    const origin = new URL(request.url).origin;
    if (!origin.startsWith('https://')) return;
    const known = await kv(env).get(SELF_ORIGIN_KEY);
    if (known === origin) return;                 // no write on the hot path
    await kv(env).put(SELF_ORIGIN_KEY, origin);
    console.log(`[outbox] learned self origin ${origin} (SELF_URL is not set)`);
  } catch { /* never let this break a request */ }
}

/**
 * Work one shard until its budget is spent or it runs out of subscribers.
 * Safe to call twice: the lease keeps two workers off the same shard, and the
 * cursor means a resumed shard does not start over.
 */
async function runShard(env, jobId, ch) {
  const job = await kv(env).get(jobKey(jobId), 'json');
  if (!job) { console.warn(`[outbox] job ${jobId} is gone; shard ${ch} abandoned`); return { state: 'gone' }; }

  const sKey = shardKey(jobId, ch);
  const shard = await kv(env).get(sKey, 'json');
  if (!shard) return { state: 'gone' };
  if (shard.state === 'done') return shard;

  const now = Date.now();
  if (shard.state === 'running' && shard.leaseUntil > now) {
    return { ...shard, state: 'busy' };
  }

  await kv(env).put(sKey, JSON.stringify({
    ...shard, state: 'running', leaseUntil: now + SHARD_LEASE_MS,
  }), { expirationTtl: JOB_TTL_SECONDS });

  let cursor = shard.cursor ?? undefined;
  let sent = shard.sent ?? 0, failed = shard.failed ?? 0;
  let pruned = shard.pruned ?? 0, budget = SEND_BUDGET;
  let complete = false;
  let lastError = null;

  try {
    while (budget > 0) {
      const listRes = await kv(env).list({ prefix: ch, cursor, limit: 1000 });
      for (const key of listRes.keys) {
        if (budget <= 0) break;
        if (isReservedKey(key.name)) continue;
        const stored = await kv(env).get(key.name, 'json');
        if (!stored?.subscription) continue;

        const decision = await decideForSubscriber(env, job, key.name, stored);
        if (!decision) continue;

        budget--;
        const resp = await sendPushWithPayload(
          stored.subscription, stampSendId(decision.payload, jobId), env);
        if (resp.ok) {
          sent++;
          if (decision.onSent) await decision.onSent();
        } else {
          // A gone subscription is pruned; anything else is left for the next
          // sweep, since a push service returning 500 now may well accept it
          // in a minute.
          if (resp.status === 410 || resp.status === 404) { await kv(env).delete(key.name); pruned++; }
          else failed++;
        }
      }
      if (listRes.list_complete) { complete = true; break; }
      cursor = listRes.cursor;
      if (budget <= 0) break;
    }
  } catch (e) {
    lastError = e.message;
    console.error(`[outbox] shard ${jobId}/${ch} threw:`, e.message);
  }

  const attempts = (shard.attempts ?? 0) + 1;
  const next = complete && !lastError
    ? { state: 'done', cursor: null, sent, failed, pruned, attempts, leaseUntil: 0, finishedAt: Date.now() }
    : { state: 'pending', cursor: cursor ?? null, sent, failed, pruned, attempts,
        leaseUntil: 0, nextAttemptAt: Date.now() + shardRetryDelayMs(attempts), lastError };

  await kv(env).put(sKey, JSON.stringify(next), { expirationTtl: JOB_TTL_SECONDS });
  console.log(`[outbox] shard ${jobId}/${ch}: ${next.state} sent=${sent} failed=${failed} pruned=${pruned} attempt=${attempts}`);

  // More to do and budget left over means the list was long; keep going in a
  // fresh invocation rather than waiting for the sweep.
  if (next.state === 'pending' && !lastError) {
    keepAlive(env, dispatchShards(env, jobId, [ch]).catch(() => {}));
  }
  return next;
}

/**
 * Decide whether this subscriber gets this job, and with what payload.
 * Returns null to skip. This is where the per-user topics keep their logic.
 */
async function decideForSubscriber(env, job, keyName, stored) {
  const prefs = stored.preferences || {};

  if (job.kind === 'topic') {
    if (prefs[job.topic] !== true) return null;
    if (job.topic?.startsWith('substorm-') && !isUserInPlausibleZone(stored.location?.latitude)) return null;
    return { payload: job.payload };
  }

  if (job.kind === 'overnight') {
    if (prefs['overnight-watch'] !== true) return null;
    const p = job.params;
    if (stored.overnightWatchSentDate === p.sunsetDate) return null;
    const mode = stored.overnight_mode || 'phone';
    const threshold = OVERNIGHT_MODE_THRESHOLDS[mode] ?? OVERNIGHT_MODE_THRESHOLDS['phone'];
    if (p.auroraScore < threshold) return null;
    const cooldownKey = `COOLDOWN_overnight_${keyName}`;
    const lastSent = await kv(env).get(cooldownKey);
    if (lastSent && (Date.now() - Number(lastSent)) < 3 * 60 * 60 * 1000) return null;
    return {
      payload: job.payload,
      onSent: async () => {
        await kv(env).put(cooldownKey, Date.now().toString(), { expirationTtl: 3 * 60 * 60 });
        await kv(env).put(keyName, JSON.stringify({ ...stored, overnightWatchSentDate: p.sunsetDate }));
      },
    };
  }

  if (job.kind === 'visibility') {
    const p = job.params;
    const lat = parseFloat(stored.location?.latitude);
    const lon = parseFloat(stored.location?.longitude);
    if (!isFinite(lat) || !isFinite(lon)) return null;

    const gmagLat = geoToGmag(lat, lon);
    const distToVis      = gmagLat - p.visHorizonGmag;
    const distToBoundary = gmagLat - p.boundary;
    const prevTier = stored.visibilityTier ?? null;
    const newTier  = pickVisibilityTier(distToVis, distToBoundary, p.triggers);

    const tierRank = { dslr: 1, phone: 2, naked: 3 };
    const currentRank = tierRank[prevTier] ?? 0;
    const newRank     = tierRank[newTier]  ?? 0;

    if (!newTier && prevTier) {
      await kv(env).put(keyName, JSON.stringify({ ...stored, visibilityTier: null }));
      return null;
    }
    if (newRank <= currentRank) return null;

    const topic = { dslr: 'visibility-dslr', phone: 'visibility-phone', naked: 'visibility-naked' }[newTier];
    if (prefs[topic] !== true) return null;

    const cooldownKey = `COOLDOWN_vis_${newTier}_${keyName}`;
    const lastSent = await kv(env).get(cooldownKey);
    if (lastSent && (Date.now() - Number(lastSent)) < 2 * 60 * 60 * 1000) return null;

    return {
      payload: buildVisibilityPayload(newTier, p.statsLine),
      onSent: async () => {
        await kv(env).put(cooldownKey, Date.now().toString(), { expirationTtl: 2 * 60 * 60 });
        await kv(env).put(keyName, JSON.stringify({ ...stored, visibilityTier: newTier }));
      },
    };
  }

  return null;
}

function buildVisibilityPayload(tier, statsLine) {
  const topic = { dslr: 'visibility-dslr', phone: 'visibility-phone', naked: 'visibility-naked' }[tier];
  let title, body;
  if (tier === 'naked') {
    title = '👁️ Aurora, Naked Eye Visible';
    body  = `Aurora should be visible to the naked eye from your location. Head outside and look south.\n\n${statsLine}`;
  } else if (tier === 'phone') {
    title = '📱 Aurora, Phone Camera Visible';
    body  = `Aurora is bright enough for your phone camera. Point it south and try night mode.\n\n${statsLine}`;
  } else {
    title = '📷 Aurora, DSLR Camera Visible';
    body  = `Aurora is detectable from your location with a camera on a tripod. Point south and try a long exposure.\n\n${statsLine}`;
  }
  return { title, body, tag: topic, data: { url: '/?page=forecast', category: topic }, ts: Date.now() };
}

/**
 * The durability guarantee. Every cron tick, re-dispatch any shard that is
 * pending and due, or that has been leased for longer than a worker could
 * plausibly live. Without this, a dropped dispatch is a permanently missed
 * alert, which is exactly what was happening before.
 */
async function sweepJobs(env, note = /** @type {(name?: string, status?: string, detail?: string) => void} */ (() => {})) {
  const now = Date.now();
  let cursor, jobs = [], revived = 0, stillRunning = 0, exhausted = 0;

  do {
    const res = await kv(env).list({ prefix: 'JOB_', cursor, limit: 1000 });
    for (const k of res.keys) jobs.push(k.name.slice(4));
    cursor = res.cursor;
    if (res.list_complete) break;
  } while (cursor);

  for (const id of jobs) {
    const due = [];
    // The sweep is already reading every shard, so total them here rather than
    // paying for a second pass to build the ledger entry.
    const totals = { sent: 0, failed: 0, pruned: 0 };
    let finished = 0, gaveUp = 0;

    for (const ch of SHARD_CHARS) {
      const shard = await kv(env).get(shardKey(id, ch), 'json');
      if (!shard) continue;
      totals.sent += shard.sent ?? 0;
      totals.failed += shard.failed ?? 0;
      totals.pruned += shard.pruned ?? 0;

      if (shard.state === 'done') { finished++; continue; }
      if (shard.state === 'running' && shard.leaseUntil > now) { stillRunning++; continue; }
      if ((shard.attempts ?? 0) >= MAX_SHARD_ATTEMPTS) { exhausted++; gaveUp++; continue; }
      if (shard.nextAttemptAt && shard.nextAttemptAt > now) continue;
      due.push(ch);
    }

    if (due.length) {
      revived += due.length;
      await dispatchShards(env, id, due);
      continue;
    }

    // Nothing left to do for this job: either every shard finished, or the
    // stragglers have exhausted their attempts and never will. Record what
    // happened either way - a partial send is exactly the thing worth seeing.
    if (finished + gaveUp === SHARD_CHARS.length) {
      const job = await kv(env).get(jobKey(id), 'json');
      if (job) await recordSend(env, job, totals);
    }
  }

  if (jobs.length) {
    note('outbox', revived ? 'resumed' : 'draining',
         `${jobs.length} job(s), ${revived} shard(s) re-dispatched, ${stillRunning} in flight, ${exhausted} gave up`);
  }
  return { jobs: jobs.length, revived, stillRunning, exhausted };
}

/** Roll the per-shard records up into something readable. */
async function jobProgress(env, id) {
  const job = await kv(env).get(jobKey(id), 'json');
  if (!job) return null;
  let sent = 0, failed = 0, pruned = 0, done = 0, pending = 0, running = 0, stuck = 0;
  for (const ch of SHARD_CHARS) {
    const s = await kv(env).get(shardKey(id, ch), 'json');
    if (!s) continue;
    sent += s.sent ?? 0; failed += s.failed ?? 0; pruned += s.pruned ?? 0;
    if (s.state === 'done') done++;
    else if (s.state === 'running') running++;
    else if ((s.attempts ?? 0) >= MAX_SHARD_ATTEMPTS) stuck++;
    else pending++;
  }
  return {
    id, kind: job.kind, topic: job.topic, createdAt: job.createdAt,
    ageMinutes: Math.round((Date.now() - job.createdAt) / 60000),
    sent, failed, pruned,
    shards: { total: SHARD_CHARS.length, done, running, pending, gaveUp: stuck },
    complete: done === SHARD_CHARS.length,
  };
}

// ── Delivery ledger ─────────────────────────────────────────────────────────
//
// What actually happened, every time a notification goes out.
//
// Before this there was no way to answer "did the M5 flare go out, and to how
// many people" after the fact - only Cloudflare logs, which nobody reads and
// which roll off. Each finished job leaves a small record:
//
//   SEND_<jobId>   one send: topic, title, when, accepted, failed, pruned,
//                  clicked, and how long the fan-out took
//   SENDS          a rolling index of the last SEND_LOG_LIMIT job ids, so
//                  /sends is two reads rather than a list of the namespace
//
// "accepted" is the honest word: it means the push service took the message,
// not that a phone displayed it. Nothing short of the device reporting back
// can tell us that, which is what the click count is for.

/**
 * Tag a payload with the send it belongs to, so a click can be attributed.
 *
 * The id rides in the deep link because the service worker is served from
 * outside this project: it opens data.url on click without knowing anything
 * about the ledger, and the app reports the id on the next load. data.sendId
 * is set too, so a future service worker can report the click directly without
 * the round trip through the URL.
 */
function stampSendId(payload, jobId) {
  if (!payload || !jobId) return payload;
  const data = { ...(payload.data ?? {}), sendId: jobId };
  try {
    // data.url is app-relative ('/?page=forecast'), so give URL a base to
    // parse against and hand back only the path it produces.
    const u = new URL(data.url ?? '/', 'https://app.invalid');
    u.searchParams.set('n', jobId);
    data.url = u.pathname + u.search + u.hash;
  } catch {
    // A URL we cannot parse is not worth losing the notification over.
  }
  return { ...payload, data };
}

const SEND_LOG_KEY = 'SENDS';
const SEND_LOG_LIMIT = 60;
const SEND_TTL_SECONDS = 45 * 24 * 60 * 60;
const sendKey = (id) => `SEND_${id}`;

// Clicks are counted as one unique key each rather than by incrementing a
// counter. Two workers incrementing the same KV value will lose an update, and
// a popular alert would lose a lot of them; a unique key per click cannot
// collide, and counting them is a single prefixed list. They expire on their
// own, so nothing has to clean up.
const CLICK_TTL_SECONDS = 40 * 24 * 60 * 60;
const clickPrefix = (id) => `CLK_${id}_`;

/**
 * Roll a finished job's 64 shard records into one ledger entry.
 * Called from the sweep, which has already read every shard.
 */
async function recordSend(env, job, totals) {
  const id = job.id;
  const existing = await kv(env).get(sendKey(id), 'json');
  if (existing?.finishedAt) return existing;          // already recorded

  const entry = {
    id,
    topic: job.topic ?? null,
    kind: job.kind,
    title: job.payload?.title ?? null,
    startedAt: job.createdAt,
    startedAtNZ: nzTimestamp(job.createdAt),
    finishedAt: Date.now(),
    tookSeconds: Math.round((Date.now() - job.createdAt) / 1000),
    accepted: totals.sent,
    failed: totals.failed,
    pruned: totals.pruned,
    clicked: existing?.clicked ?? 0,
    clicksCountedAt: existing?.clicksCountedAt ?? null,
    note: 'accepted = the push service took it. clicked = opened the app from the notification.',
  };

  await kv(env).put(sendKey(id), JSON.stringify(entry), { expirationTtl: SEND_TTL_SECONDS });

  const index = (await kv(env).get(SEND_LOG_KEY, 'json')) ?? [];
  const next = [id, ...index.filter(x => x !== id)].slice(0, SEND_LOG_LIMIT);
  await kv(env).put(SEND_LOG_KEY, JSON.stringify(next));

  console.log(`[ledger] ${job.topic ?? job.kind}: accepted ${totals.sent}, failed ${totals.failed}, pruned ${totals.pruned}, ${entry.tookSeconds}s`);
  return entry;
}

/**
 * Count the click keys for a send and fold the number into its record.
 *
 * Runs off the census rather than per click, so a burst of clicks costs one
 * cheap write each and no contention. Counting the same keys again on a later
 * pass is harmless - the count is recomputed from scratch, never accumulated.
 */
async function foldClicks(env, id) {
  let cursor, clicked = 0;
  do {
    const res = await kv(env).list({ prefix: clickPrefix(id), cursor, limit: 1000 });
    clicked += res.keys.length;
    cursor = res.cursor;
    if (res.list_complete) break;
  } while (cursor);

  const entry = await kv(env).get(sendKey(id), 'json');
  if (!entry) return 0;
  if (entry.clicked === clicked && entry.clicksCountedAt) return clicked;

  entry.clicked = clicked;
  entry.clicksCountedAt = Date.now();
  entry.clickRate = entry.accepted > 0 ? Math.round((clicked / entry.accepted) * 1000) / 10 : null;
  await kv(env).put(sendKey(id), JSON.stringify(entry), { expirationTtl: SEND_TTL_SECONDS });
  return clicked;
}

/**
 * The last few sends, condensed, for the stats snapshot - so opening STATS in
 * the KV browser answers both "how many subscribers" and "is anything actually
 * getting through" without a second lookup.
 */
async function recentSendSummary(env, limit = 5) {
  try {
    const index = (await kv(env).get(SEND_LOG_KEY, 'json')) ?? [];
    const out = [];
    for (const id of index.slice(0, limit)) {
      const e = await kv(env).get(sendKey(id), 'json');
      if (!e) continue;
      out.push({
        topic: e.topic ?? e.kind, at: e.startedAtNZ,
        accepted: e.accepted, failed: e.failed, clicked: e.clicked,
        clickRate: e.clickRate ?? null,
      });
    }
    return out;
  } catch { return []; }
}

/** Fold clicks for every send still in the index. Called from the census. */
async function foldAllClicks(env) {
  const index = (await kv(env).get(SEND_LOG_KEY, 'json')) ?? [];
  let total = 0;
  for (const id of index) total += await foldClicks(env, id);
  return { sends: index.length, clicks: total };
}

/**
 * A device opened the app from a notification.
 *
 * The service worker is served from outside this project and cannot be changed
 * from here, so the click is not reported by the service worker itself. The
 * send id rides in the notification's deep link instead, and the app reports it
 * on the next load. That means this counts "opened the app from the alert",
 * which is the number worth having anyway.
 */
async function handleNotificationClicked(request, env) {
  try {
    const { id, topic } = await request.json().catch(() => ({}));
    if (!id || typeof id !== 'string' || id.length > 64 || !/^[a-z0-9-]+$/i.test(id)) {
      return json({ ok: false, error: 'bad send id' }, 400);
    }
    const nonce = crypto.randomUUID();
    await kv(env).put(`${clickPrefix(id)}${nonce}`, topic ?? '1', { expirationTtl: CLICK_TTL_SECONDS });
    return json({ ok: true });
  } catch (e) {
    // Never let a metric break the app's startup path.
    console.error('[ledger] click record failed:', e.message);
    return json({ ok: false }, 200);
  }
}

/** GET /sends - the ledger, newest first. */
async function handleSends(request, env) {
  const url = new URL(request.url);
  if (url.searchParams.get('secret') !== env.TRIGGER_SECRET) return new Response('Forbidden', { status: 403 });

  const index = (await kv(env).get(SEND_LOG_KEY, 'json')) ?? [];
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '25', 10) || 25, SEND_LOG_LIMIT);

  if (url.searchParams.get('fold') === '1') await foldAllClicks(env);

  const sends = [];
  for (const id of index.slice(0, limit)) {
    const entry = await kv(env).get(sendKey(id), 'json');
    if (entry) sends.push(entry);
  }

  // Per-topic rollup across everything still in the ledger.
  const byTopic = {};
  for (const s of sends) {
    const key = s.topic ?? s.kind;
    const t = byTopic[key] ??= { sends: 0, accepted: 0, failed: 0, clicked: 0 };
    t.sends++; t.accepted += s.accepted ?? 0; t.failed += s.failed ?? 0; t.clicked += s.clicked ?? 0;
  }
  for (const t of Object.values(byTopic)) {
    t.clickRate = t.accepted > 0 ? Math.round((t.clicked / t.accepted) * 1000) / 10 : null;
  }

  return json({
    generatedAt: nzTimestamp(Date.now()),
    counting: sends.length,
    byTopic,
    sends,
    note: 'accepted = the push service took the message. clicked = opened the app from the notification, folded in hourly.',
  });
}

// ── Subscriber census ───────────────────────────────────────────────────────
//
// One KV key, `STATS`, holding how many people are subscribed and to what.
// Open it in the KV browser in the dashboard and it reads as plain JSON.
//
// It is a periodic census rather than live counters because counters in KV
// cannot be incremented safely: two workers reading, adding one and writing
// back will lose an update, and at this volume that drifts badly within days.
// A census walks the real records, so the number is always the truth as of
// when it ran rather than an accumulated guess.
//
// The walk is sharded the same way delivery is, so no single invocation has to
// read all 80,000 records. Each shard writes its own partial, and whichever
// shard finishes last rolls the 64 partials up into STATS.

/** Which push service an endpoint belongs to, for the platform breakdown. */
function pushServiceOf(endpoint) {
  if (!endpoint) return 'unknown';
  try {
    const host = new URL(endpoint).hostname;
    if (host.endsWith('push.apple.com')) return 'apple';
    if (host.includes('googleapis.com') || host.includes('android.com')) return 'google';
    if (host.endsWith('mozilla.com') || host.includes('mozaws')) return 'mozilla';
    if (host.includes('windows.com') || host.includes('microsoft')) return 'microsoft';
    return host;
  } catch { return 'unknown'; }
}

const STATS_KEY = 'STATS';
const statsShardKey = (ch) => `STATSSHARD_${ch}`;
const CENSUS_INTERVAL_MS = 60 * 60 * 1000;
const CENSUS_SHARD_TTL   = 2 * 60 * 60;
// A subscription counts as active if the app has checked in within this long.
// Older ones are still sent to; this is only for reporting.
const ACTIVE_WINDOW_DAYS = 60;

async function maybeRunCensus(env, note = /** @type {(name?: string, status?: string, detail?: string) => void} */ (() => {})) {
  const existing = await kv(env).get(STATS_KEY, 'json');
  const age = existing?.takenAt ? Date.now() - existing.takenAt : Infinity;
  if (age < CENSUS_INTERVAL_MS) return;
  const origin = await resolveSelfUrl(env);
  if (!origin) {
    console.warn('[census] no self origin known - cannot dispatch census shards.');
    return;
  }
  const censusId = Date.now().toString(36);
  note('census', 'started', `previous snapshot ${age === Infinity ? 'never taken' : Math.round(age / 60000) + ' min old'}`);

  // Cheap, and this is the natural place for it: fold the click keys each send
  // has accumulated into its ledger entry.
  try {
    const folded = await foldAllClicks(env);
    note('clicks', 'folded', `${folded.clicks} click(s) across ${folded.sends} send(s)`);
  } catch (e) {
    note('clicks', 'error', e.message);
  }
  for (const ch of SHARD_CHARS) {
    keepAlive(env, fetch(new URL('/run-census-shard', origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.TRIGGER_SECRET, censusId, shard: ch }),
    }).catch(e => console.error(`[census] dispatch ${ch} failed:`, e.message)));
  }
}

async function runCensusShard(env, censusId, ch) {
  const counts = {};
  for (const t of ALL_TOPICS) counts[t] = 0;
  let subscribers = 0, withGps = 0, active = 0, anyTopic = 0;
  const overnightModes = {};
  const services = {};
  const activeCutoff = Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  let cursor;
  do {
    const res = await kv(env).list({ prefix: ch, cursor, limit: 1000 });
    for (const key of res.keys) {
      if (isReservedKey(key.name)) continue;
      const stored = await kv(env).get(key.name, 'json');
      if (!stored?.subscription) continue;
      subscribers++;

      if (isFinite(parseFloat(stored.location?.latitude))) withGps++;
      const seen = Number(stored.lastSeenAt ?? stored.location?.locationUpdatedAt ?? 0);
      if (seen >= activeCutoff) active++;

      const mode = stored.overnight_mode || 'phone';
      overnightModes[mode] = (overnightModes[mode] ?? 0) + 1;

      // Which push service this device uses. Worth having because failures
      // cluster by platform - if a send goes badly, this says whose.
      const svc = pushServiceOf(stored.subscription?.endpoint);
      services[svc] = (services[svc] ?? 0) + 1;

      let on = 0;
      for (const t of ALL_TOPICS) if (stored?.preferences?.[t] === true) { counts[t]++; on++; }
      if (on > 0) anyTopic++;
    }
    cursor = res.cursor;
    if (res.list_complete) break;
  } while (cursor);

  await kv(env).put(statsShardKey(ch), JSON.stringify({
    censusId, shard: ch, subscribers, withGps, active, anyTopic, counts, overnightModes, services,
    at: Date.now(),
  }), { expirationTtl: CENSUS_SHARD_TTL });

  // Whoever finishes last does the roll-up.
  await tryFinishCensus(env, censusId);
  return { shard: ch, subscribers };
}

async function tryFinishCensus(env, censusId) {
  const parts = [];
  for (const ch of SHARD_CHARS) {
    const p = await kv(env).get(statsShardKey(ch), 'json');
    if (!p || p.censusId !== censusId) return false;   // not everyone is in yet
    parts.push(p);
  }

  const counts = {};
  for (const t of ALL_TOPICS) counts[t] = 0;
  let subscribers = 0, withGps = 0, active = 0, anyTopic = 0;
  const overnightModes = {};
  const services = {};
  for (const p of parts) {
    subscribers += p.subscribers; withGps += p.withGps;
    active += p.active; anyTopic += p.anyTopic;
    for (const t of ALL_TOPICS) counts[t] += p.counts[t] ?? 0;
    for (const [m, n] of Object.entries(p.overnightModes ?? {})) {
      overnightModes[m] = (overnightModes[m] ?? 0) + n;
    }
    for (const [svc, n] of Object.entries(p.services ?? {})) {
      services[svc] = (services[svc] ?? 0) + n;
    }
  }

  const byCategory = Object.fromEntries(
    Object.entries(counts).sort((a, b) => b[1] - a[1])
  );

  const snapshot = {
    takenAt: Date.now(),
    takenAtNZ: new Date().toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' }),
    subscribers,
    subscribedToSomething: anyTopic,
    subscribedToNothing: subscribers - anyTopic,
    activeLast60Days: active,
    quietOver60Days: subscribers - active,
    withLocation: withGps,
    withoutLocation: subscribers - withGps,
    byCategory,
    overnightModes,
    byPushService: Object.fromEntries(Object.entries(services).sort((a, b) => b[1] - a[1])),
    recentSends: await recentSendSummary(env),
    note: 'Counted by walking every subscriber record. Refreshed about once an hour. '
        + 'subscribers counts saved push subscriptions; some belong to devices that have '
        + 'since uninstalled - those are pruned when a send to them comes back 410.',
  };
  await kv(env).put(STATS_KEY, JSON.stringify(snapshot, null, 2));
  console.log(`[census] ${subscribers} subscribers, ${anyTopic} with at least one topic on`);
  return true;
}

/** Every detector still calls this; only what happens underneath changed. */
async function notifyTopic(topic, title, body, env, data = { url: '/' }) {
  const payload = { title, body, tag: topic, data: { ...data, category: topic }, ts: Date.now() };
  await kv(env).put(`LATEST_ALERT_${topic}`, JSON.stringify(payload), { expirationTtl: 3600 });
  return enqueueDelivery(env, { kind: 'topic', topic, payload });
}

async function sendPushWithPayload(subscription, payload, env) {
  try {
    const aud      = new URL(subscription.endpoint).origin;
    const vapidJWT = await createVapidJWT(aud, env);
    const { body } = await encryptWebPushPayload(subscription, JSON.stringify(payload));
    return fetch(subscription.endpoint, { method: 'POST', headers: { 'TTL': '86400', 'Authorization': `vapid t=${vapidJWT}, k=${env.VAPID_PUBLIC_KEY}`, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream' }, body });
  } catch (err) {
    reportError(err, env, { handler: 'sendPushWithPayload' });
    return new Response(null, { status: 500, statusText: err.message });
  }
}

async function createVapidJWT(audience, env) {
  const header  = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT };
  const toSign  = new TextEncoder().encode(`${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`);
  const key     = await importVapidPrivateKeyFlexible(env.VAPID_PRIVATE_KEY, env.VAPID_PUBLIC_KEY);
  const sig     = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, toSign);
  return `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}.${b64url(new Uint8Array(sig))}`;
}

async function importVapidPrivateKeyFlexible(privInput, pubInput) {
  const pemDer = maybePemToDer(privInput);
  if (pemDer) return crypto.subtle.importKey('pkcs8', pemDer, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  try { const der = b64urlToBytes(privInput); if (der?.byteLength > 48) return crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']); } catch {}
  const { x, y } = parseUncompressedPublicXY(String(pubInput));
  return crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: String(privInput).trim(), x, y, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

async function encryptWebPushPayload(subscription, jsonString) {
  const uaPubRaw   = b64urlToBytes(subscription.keys?.p256dh);
  const authSecret = b64urlToBytes(subscription.keys?.auth);
  // The editor's TypeScript flags the next few lines. It is wrong about all of
  // them, and this is the code every push has ever been encrypted with, so the
  // casts are there to quieten it rather than to change anything:
  //   generateKey returns CryptoKey | CryptoKeyPair and TS will not narrow it
  //   to the pair, even though an ECDH keypair is the only thing it can be
  //   exportKey('raw', ...) returns ArrayBuffer | JsonWebKey for the same
  //   reason - 'raw' can only ever give an ArrayBuffer
  //   deriveBits wants the peer key under `public`, which is what the WebCrypto
  //   spec calls it; the Workers type definitions name it differently
  const keyPair = /** @type {CryptoKeyPair} */ (
    await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  const serverPublicKey = keyPair.publicKey;
  const serverPrivateKey = keyPair.privateKey;
  const exportedRaw  = /** @type {ArrayBuffer} */ (await crypto.subtle.exportKey('raw', serverPublicKey));
  const serverPubRaw = new Uint8Array(exportedRaw);
  const uaPubKey   = await crypto.subtle.importKey('raw', uaPubRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhBits   = await crypto.subtle.deriveBits(
    /** @type {any} */ ({ name: 'ECDH', public: uaPubKey }), serverPrivateKey, 256);
  const ecdhSecret = new Uint8Array(ecdhBits);
  const prkKey     = await hmac(authSecret, ecdhSecret);
  const keyInfo    = concatBytes(utf8('WebPush: info'), new Uint8Array([0x00]), uaPubRaw, serverPubRaw);
  const IKM        = await hmac(prkKey, concatBytes(keyInfo, new Uint8Array([0x01])));
  const salt       = randomBytes(16);
  const PRK        = await hmac(salt, IKM);
  const CEK        = (await hmac(PRK, concatBytes(utf8('Content-Encoding: aes128gcm'), new Uint8Array([0, 1])))).slice(0, 16);
  const NONCE      = (await hmac(PRK, concatBytes(utf8('Content-Encoding: nonce'),    new Uint8Array([0, 1])))).slice(0, 12);
  const aesKey     = await crypto.subtle.importKey('raw', CEK, { name: 'AES-GCM' }, false, ['encrypt']);
  const plaintext  = concatBytes(utf8(jsonString), new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: NONCE }, aesKey, plaintext));
  const header     = concatBytes(salt, u32be(4096), new Uint8Array([serverPubRaw.length]), serverPubRaw);
  return { body: concatBytes(header, ciphertext) };
}

// ── Binary / Encoding Utilities ─────────────────────────────────────────────
function b64url(input) {
  let str;
  if (input instanceof Uint8Array) {
    str = '';
    for (let i = 0; i < input.length; i++) str += String.fromCharCode(input[i]);
    str = btoa(str);
  } else str = btoa(input);
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(b64urlStr) {
  let s = String(b64urlStr).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function utf8(str) { return new TextEncoder().encode(str); }

function concatBytes(...arrays) {
  let len = 0;
  for (const a of arrays) len += a.length;
  const out = new Uint8Array(len);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

function u32be(n) {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function randomBytes(n) {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}

function getXrayClass(flux) {
  if (flux == null || !isFinite(flux) || flux <= 0) return 'B1.0';
  if (flux >= 1e-4) return `X${(flux / 1e-4).toFixed(1)}`;
  if (flux >= 1e-5) return `M${(flux / 1e-5).toFixed(1)}`;
  if (flux >= 1e-6) return `C${(flux / 1e-6).toFixed(1)}`;
  if (flux >= 1e-7) return `B${(flux / 1e-7).toFixed(1)}`;
  return `A${(flux / 1e-8).toFixed(1)}`;
}

function formatNzTime(timestampMs) {
  try {
    const d = new Date(timestampMs);
    if (isNaN(d.getTime())) return 'unknown time';
    return d.toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit', hour12: true });
  } catch { return 'unknown time'; }
}

/** Full NZ date and time, for records a human reads in the KV browser. */
function nzTimestamp(timestampMs) {
  try {
    return new Date(timestampMs).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' });
  } catch { return 'unknown'; }
}

const FORECAST_API_URL = 'https://spottheaurora.thenamesrock.workers.dev/';

async function getFullForecastData(env) {
  try {
    let res;
    if (env?.FORECAST_SERVICE) {
      res = await env.FORECAST_SERVICE.fetch(new Request('https://forecast-binding/', {
        method: 'GET', headers: { 'Accept': 'application/json' },
      }));
      if (!res.ok) { console.error(`[forecast] Service binding fetch failed: ${res.status}`); return null; }
    } else {
      console.warn('[forecast] FORECAST_SERVICE binding not found - falling back to public URL');
      res = await fetchWithRetry(`${FORECAST_API_URL}?_=${Date.now()}`);
      if (!res) { console.warn('[forecast] Failed to fetch forecast data'); return null; }
    }
    return await res.json();
  } catch (e) {
    console.error('[forecast] Error fetching forecast data:', e.message);
    return null;
  }
}

async function checkAndSetCooldown(topic, cooldownMinutes, env) {
  const key = `COOLDOWN_${topic}`;
  try {
    const existing = await kv(env).get(key);
    if (existing) return false;
    await kv(env).put(key, Date.now().toString(), {
      expirationTtl: Math.max(60, cooldownMinutes * 60),
    });
    return true;
  } catch (e) {
    console.error(`[cooldown] Error checking/setting cooldown for ${topic}:`, e.message);
    return false;
  }
}

async function getCurrentStatus(env) {
  try {
    const lastRun = await kv(env).get('LAST_SUCCESSFUL_RUN_TIMESTAMP');
    return {
      lastRun: lastRun ? Number(lastRun) : null,
      lastRunAgo: lastRun ? `${Math.round((Date.now() - Number(lastRun)) / 60000)} min ago` : 'never',
      substorm: await kv(env).get('STATE_substorm', 'json') || {},
      flare:    await kv(env).get('STATE_flare', 'json') || {},
      shock:    await kv(env).get('STATE_shock', 'json') || {},
      tail:     await kv(env).get('STATE_tail_loading', 'json') || {},
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function buildStatusSnapshot(env) {
  try {
    const status = await getCurrentStatus(env);
    const parts = [`Worker last ran: ${status.lastRunAgo || 'unknown'}`];
    if (status.substorm?.status) parts.push(`Substorm: ${status.substorm.status}`);
    if (status.flare?.status) parts.push(`Flare: ${status.flare.status}${status.flare.peakFlux ? ` (peak ${getXrayClass(status.flare.peakFlux)})` : ''}`);
    return parts.join(' | ');
  } catch { return 'Status snapshot unavailable'; }
}

async function hmac(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, dataBytes));
}

function handleOptions() {
  return new Response(null, { headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  } });
}

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: {
    'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', ...extra,
  } });
}

async function createSubscriptionId(endpoint) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return b64url(new Uint8Array(hash));
}

function maybePemToDer(pem) {
  const m = String(pem).match(/-----BEGIN PRIVATE KEY-----([A-Za-z0-9+/=\s]+)-----END PRIVATE KEY-----/);
  if (!m) return null;
  const bin = atob(m[1].replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function parseUncompressedPublicXY(pubKeyB64Url) {
  const raw = b64urlToBytes(pubKeyB64Url);
  if (raw.length !== 65 || raw[0] !== 0x04) throw new Error('VAPID_PUBLIC_KEY must be 65-byte uncompressed P-256.');
  return { x: b64url(raw.slice(1, 33)), y: b64url(raw.slice(33)) };
}
