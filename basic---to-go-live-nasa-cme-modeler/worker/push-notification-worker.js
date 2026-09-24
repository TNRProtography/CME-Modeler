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

// Every notification topic is strictly opt-in: a subscriber only receives it
// if preferences[topic] === true was explicitly set for that exact key.

const kv = (env) => env.SUBSCRIPTIONS_KV;

// ── Which site a subscriber came from ──────────────────────────────────────
//
// One worker serves two front ends: the live site and the Pages dev/preview
// deploys. A push subscription belongs to the origin that created it - the
// browser scopes the service worker that way - so the same person on both is
// two independent subscriptions that both want alerts. That is fine, and real
// alerts go to both, because someone using the dev site is still someone
// waiting for the aurora.
//
// What is not fine is not knowing which is which. Without it, a test push
// aimed at the dev site reaches every live subscriber, and the census cannot
// say whether a number is real users or a browser tab left open on a preview
// deploy. So the origin is recorded, classified, and can be filtered on.
const SITE_PATTERNS = [
  ['prod', /^https:\/\/(www\.)?spottheaurora\.co\.nz$/],
  // The production Pages project and every preview deploy under it
  // (<hash>.cme-modeler.pages.dev), plus a local dev server.
  ['dev',  /^https:\/\/([a-z0-9-]+\.)?cme-modeler\.pages\.dev$/],
  ['dev',  /^http:\/\/localhost(:\d+)?$/],
  ['dev',  /^http:\/\/127\.0\.0\.1(:\d+)?$/],
];

/** 'prod', 'dev', or 'other' for an origin string. */
function classifySite(origin) {
  if (!origin) return 'unknown';
  for (const [site, re] of SITE_PATTERNS) if (re.test(origin)) return site;
  return 'other';
}

/**
 * The origin a request came from, and what that origin is.
 *
 * Browsers send Origin on cross-origin POSTs, which every call from either
 * front end is - the worker is on its own hostname. Referer is the fallback
 * for the few request shapes that omit Origin; a call with neither (curl, the
 * cron) is 'unknown' rather than being guessed at.
 */
function siteOf(request) {
  let origin = request.headers.get('Origin');
  if (!origin) {
    const ref = request.headers.get('Referer');
    if (ref) { try { origin = new URL(ref).origin; } catch { /* ignore */ } }
  }
  return { origin: origin || null, site: classifySite(origin) };
}

/**
 * Add the origin to a subscriber record, reporting whether anything changed.
 *
 * Only the endpoints that already read a record call this, and it only asks
 * for a write when the answer is new - a device that reappears from the same
 * site costs nothing. Records written before this existed have no origin and
 * read as 'unknown' until their owner next opens the app.
 */
function stampOrigin(stored, request) {
  const { origin, site } = siteOf(request);
  if (!origin || site === 'unknown') return false;
  if (stored.origin === origin && stored.site === site) return false;
  stored.origin = origin;
  stored.site = site;
  return true;
}

/**
 * Read a site filter off a request.
 *
 * Absent means everyone, which is what a real alert wants. 'prod' or 'dev'
 * narrows a test to one front end so rehearsing on the dev site cannot light
 * up live subscribers' phones.
 */
function siteFilterFrom(value) {
  if (value == null || value === '' || value === 'all') return null;
  const v = String(value).toLowerCase();
  if (v === 'prod' || v === 'dev' || v === 'other' || v === 'unknown') return v;
  return undefined;   // invalid - the caller turns this into a 400
}

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
    quiet:     { label: 'Quiet' },
    ambient:   { label: 'Ambient' },
    unsettled: { label: 'Unsettled' },
    moderate:  { label: 'Moderate' },
    high:      { label: 'High' },
    severe:    { label: 'Severe' },
    extreme:   { label: 'Extreme' },
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

  return { tier, label: meta.label, buildBody };
}

// --- Main Export ---
export default {
  async fetch(request, env, ctx) {
    // Without this, anything that fans out from an HTTP request is cancelled
    // the moment the response returns. A Worker only keeps background work
    // alive if it was handed to ctx.waitUntil, and keepAlive reads it from
    // here. This handler had no ctx at all, so a forced census, a broadcast
    // and a forced migration each dispatched 64 shard calls straight into the
    // bin - the cron sweep picked delivery back up minutes later, but a
    // census has no sweep, so it simply never finished.
    env.__ctx = ctx;

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
    if (url.pathname === '/dry-run'                   && request.method === 'GET')  return handleDryRun(request, env);
    if (url.pathname === '/diagnose'                  && request.method === 'GET')  return handleDiagnose(request, env);
    if (url.pathname === '/migration'                 && request.method === 'GET')  return handleMigrationStatus(request, env);
    if (url.pathname === '/run-migration-shard'       && request.method === 'POST') return handleRunMigrationShard(request, env);
    if (url.pathname === '/notification-clicked'      && request.method === 'POST') return handleNotificationClicked(request, env);
    if (url.pathname === '/regions-history'           && request.method === 'GET')  return handleRegionsHistory(request, env);
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
  /** @type {Record<string, any>} */
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

  const detectors = [
    ['substorm',   checkSubstormActivity(env, thresholds.substorm, substormData, loadingState, note)],
    ['flare',      checkSolarFlares(env, xrayData, note)],
    ['shock',      checkShockDetection(env, magPoints, plasmaPoints, tempAvailable, note)],
    ['overnight',  checkOvernightWatch(env, forecastData, substormData, magPoints, plasmaPoints, note)],
    ['visibility', checkVisibilityNotifications(env, substormData, forecastData, magPoints, plasmaPoints, note)],
    ['cme',        checkEarthDirectedCMEs(env, null, note)],
    ['regions',    snapshotSolarRegions(env, note)],
  ];
  const results = await Promise.allSettled(detectors.map(([, p]) => p));

  // allSettled swallows rejections. Each detector catches its own errors, but
  // anything thrown outside that try would otherwise disappear without a
  // trace - which is precisely how this worker used to fail.
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const name = detectors[i][0];
      note(name, 'error', `threw outside its own handler: ${r.reason?.message ?? r.reason}`);
      reportError(r.reason, env, { handler: `detector:${name}` });
    }
  });

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
// How many consecutive falling readings confirm a peak. The GOES feed is
// one-minute cadence, so two in a row is the flux having genuinely turned the
// corner rather than wobbling at the top - and it fires as soon as that is
// true, instead of waiting out a fixed timer that did not care whether the
// flux was still falling or had simply stopped climbing.
const FLARE_DECLINE_SAMPLES = 2;
// There is deliberately no time-based backstop. A flare that never gives two
// clean falls in a row is still closed out when the flux drops below M1, which
// fires the peak notification with the class it actually reached - so nothing
// is lost by waiting, only reported a little later.
const FLARE_STALE_MS   = 4 * 60 * 60 * 1000;

/**
 * How many readings at the end of the series each fell below the one before.
 *
 * Counts backwards from the newest sample and stops at the first rise, so a
 * return of 2 means the flux has dropped twice in succession - the newest
 * reading is below the previous one, and that one is below the one before it.
 * Equal readings do not count as a fall: a plateau is not a decline.
 */
function consecutiveFalls(series) {
  let n = 0;
  for (let i = series.length - 1; i > 0; i--) {
    if (series[i].flux < series[i - 1].flux) n++;
    else break;
  }
  return n;
}

async function checkSolarFlares(env, /** @type {any[]|null} */ allData = null, note = /** @type {(name?: string, status?: string, detail?: string) => void} */ (() => {})) {
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
              const title = `${cls} Solar Flare Detected`;
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
              const title = `Flare Intensifying: Now ${cls}`;
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
        // Off the peak. Confirm it by looking at the feed's own samples rather
        // than at the clock: the last FLARE_DECLINE_SAMPLES readings each have
        // to be below the one before them.
        if (!prev.declineStart) newState.declineStart = latest.t;

        const falls = consecutiveFalls(xraySeries);
        const offPeakMs = latest.t - (prev.declineStart ?? latest.t);

        if (falls >= FLARE_DECLINE_SAMPLES) {
          peaked = true;
          console.log(`[flare] Flux fell for ${falls} readings in a row - peaked`);
        } else {
          note('flare', 'rising',
               `${cls}, past peak ${Math.round(offPeakMs / 60000)} min, `
               + `${falls}/${FLARE_DECLINE_SAMPLES} falling readings`);
        }
      }

      if (peaked) {
        const peakClass = getXrayClass(prev.peakFlux);
        if (await checkAndSetCooldown('flare-peak', FLARE_PEAK_COOLDOWN_MINUTES, env)) {
          await notifyTopic('flare-peak',
            `Solar Flare Peaked: ${peakClass}`,
            `A solar flare reached a maximum of ${peakClass} around ${formatNzTime(prev.peakTime)} and is now declining.`,
            env, { url: '/?page=solar-activity&section=goes-xray-flux-section' });
        }
        if (await checkAndSetCooldown('flare-event', 15, env)) {
          await notifyTopic('flare-event',
            `${peakClass} Solar Flare`,
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

// ── Daily sunspot region snapshots ──────────────────────────────────────────
//
// NOAA publishes the current state of every numbered region and nothing about
// yesterday's. That makes "is this region still growing?" unanswerable from a
// single response, even though rapid growth is one of the few genuinely useful
// flare precursors - a region that doubled overnight is a different
// proposition from one the same size that has sat there all week.
//
// So the cron keeps a snapshot a day. One key per day, a month of them, and
// the app reads them back as a per-region history.
const NOAA_SOLAR_REGIONS_URL = 'https://services.swpc.noaa.gov/json/solar_regions.json';
const REGION_SNAPSHOT_PREFIX = 'REGIONS_';
const REGION_SNAPSHOT_DAYS = 30;
const REGION_SNAPSHOT_TTL = (REGION_SNAPSHOT_DAYS + 2) * 24 * 60 * 60;
// Rewriting today's snapshot on every cron tick would be hundreds of KV writes
// a day for a value that barely changes. A few refreshes a day keeps it
// current without spending the quota.
const REGION_SNAPSHOT_MIN_GAP_MS = 3 * 60 * 60 * 1000;

const regionSnapshotKey = (dayIso) => `${REGION_SNAPSHOT_PREFIX}${dayIso}`;
const utcDayIso = (ms) => new Date(ms).toISOString().slice(0, 10);

function toFiniteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Keep one snapshot of today's regions, if today's is missing or stale. */
async function snapshotSolarRegions(env, note = /** @type {(name?: string, status?: string, detail?: string) => void} */ (() => {})) {
  try {
    const today = utcDayIso(Date.now());
    const key = regionSnapshotKey(today);

    const existing = await kv(env).get(key, 'json');
    if (existing?.at && Date.now() - existing.at < REGION_SNAPSHOT_MIN_GAP_MS) {
      note('regions', 'quiet',
           `today's snapshot is ${Math.round((Date.now() - existing.at) / 60000)} min old`);
      return;
    }

    const response = await fetchWithRetry(NOAA_SOLAR_REGIONS_URL);
    if (!response) { note('regions', 'skipped', 'solar_regions feed unreachable'); return; }
    const raw = await response.json().catch(() => null);
    if (!Array.isArray(raw)) { note('regions', 'skipped', 'solar_regions feed unparseable'); return; }

    // Only the fields the growth read needs. The rest is re-fetched live by
    // the app anyway, and a smaller value is a cheaper daily write.
    const regions = [];
    for (const r of raw) {
      const id = String(r?.region ?? '').trim();
      if (!id) continue;
      regions.push({
        region: id,
        area: toFiniteOrNull(r?.area),
        spotCount: toFiniteOrNull(r?.number_spots ?? r?.spot_count),
        magneticClass: r?.mag_class ?? r?.magnetic_class ?? null,
        classification: r?.spot_class ?? r?.classification ?? null,
        location: r?.location ?? null,
      });
    }
    if (regions.length === 0) { note('regions', 'skipped', 'no numbered regions in the feed'); return; }

    await kv(env).put(key, JSON.stringify({ day: today, at: Date.now(), regions }),
                      { expirationTtl: REGION_SNAPSHOT_TTL });
    note('regions', 'fired', `snapshot for ${today}: ${regions.length} regions`);
  } catch (e) {
    note('regions', 'error', e.message);
    reportError(e, env, { handler: 'snapshotSolarRegions' });
  }
}

/**
 * GET /regions-history?days=10
 *
 * Per-region history, newest last. Public: it is NOAA's own data with nothing
 * about anybody in it, and requiring a secret would mean shipping one in the
 * app just to read a sunspot's area.
 */
async function handleRegionsHistory(request, env) {
  try {
    const url = new URL(request.url);
    const asked = Number(url.searchParams.get('days'));
    const days = Math.max(2, Math.min(REGION_SNAPSHOT_DAYS, Number.isFinite(asked) ? asked : 14));

    const wanted = [];
    for (let i = 0; i < days; i++) wanted.push(utcDayIso(Date.now() - i * 86400000));

    const snapshots = await Promise.all(
      wanted.map((day) => kv(env).get(regionSnapshotKey(day), 'json')),
    );

    /** @type {Record<string, {atMs:number,area:number|null,spotCount:number|null,magneticClass:string|null,classification:string|null}[]>} */
    const history = {};
    let daysWithData = 0;
    for (const snap of snapshots) {
      if (!snap?.regions) continue;
      daysWithData++;
      // Midday UTC, not the write time: these describe a day, and using the
      // write time would make the spacing jitter by hours.
      const atMs = Date.parse(`${snap.day}T12:00:00Z`);
      for (const r of snap.regions) {
        (history[r.region] ??= []).push({
          atMs,
          area: r.area ?? null,
          spotCount: r.spotCount ?? null,
          magneticClass: r.magneticClass ?? null,
          classification: r.classification ?? null,
        });
      }
    }
    for (const list of Object.values(history)) list.sort((a, b) => a.atMs - b.atMs);

    return json({
      days, daysWithData, regions: Object.keys(history).length, history,
      note: daysWithData < 2
        ? 'Not enough days recorded yet for a growth trend. Snapshots start from the day this was deployed.'
        : undefined,
    });
  } catch (e) {
    reportError(e, env, { handler: 'handleRegionsHistory' });
    return json({ error: e.message }, 500);
  }
}

// ── Earth-directed CME launches ─────────────────────────────────────────────
//
// The shock detector says a CME has *arrived*, an hour or so after it passed
// L1. This says one has *left the Sun* pointed at us, which is one to three
// days of warning instead of one hour - the difference between "go outside"
// and "keep the weekend free".
//
// The catalogue and the Earth-directed test are the app's own. It reads the
// same DONKI proxy and applies the same rule (see utils/cmeAnalysis.ts), so a
// CME that produces an alert is a CME the app draws as heading our way.
// `npm run test:cme` fails if the two definitions drift apart.
const DONKI_CME_URL = 'https://nasa-donki-api.thenamesrock.workers.dev/CME';

// Keep in step with EARTH_DIRECTED_MAX_LONGITUDE in utils/cmeAnalysis.ts.
const CME_EARTH_DIRECTED_MAX_LONGITUDE = 45;

// How far back to consider a CME newsworthy. Also the window a CME stays under
// review: DONKI revises its analyses for a while after an event, and a first
// pass often under-reads the speed, so a CME is re-checked on every run until
// it ages out rather than being judged once on a preliminary number.
const CME_LOOKBACK_MS = 48 * 60 * 60 * 1000;

// Ids already notified. Bounded, because this is one KV value and a busy
// fortnight should not grow it without limit.
const CME_SEEN_KEY = 'STATE_cme_seen';
const CME_SEEN_MAX = 300;

// The slowest CME anyone can ask to hear about, and what they get before they
// choose. Must match CME_SPEED_MIN / CME_SPEED_DEFAULT in utils/cmeAnalysis.ts.
const CME_SPEED_FLOOR_MIN = 300;
const CME_SPEED_FLOOR_MAX = 3000;
const CME_SPEED_FLOOR_DEFAULT = 700;

// Plain words for a speed. Boundaries must match CME_SLOW_MAX / CME_MEDIUM_MAX
// in utils/cmeAnalysis.ts, so the notification and the settings screen describe
// the same CME the same way.
const CME_SLOW_MAX = 500;
const CME_MEDIUM_MAX = 800;
const CME_SPEED_BAND_TEXT = {
  slow:   'Slow - below 500 km/s. Usually a glancing effect at most.',
  medium: 'Medium - 500 to 800 km/s. Can still cause a good storm.',
  fast:   'Fast - above 800 km/s. The kind worth clearing an evening for.',
};

function cmeSpeedBand(speed) {
  if (speed < CME_SLOW_MAX) return 'slow';
  if (speed < CME_MEDIUM_MAX) return 'medium';
  return 'fast';
}

// ── Arrival time: the app's own model, not a second opinion ────────────────
// The 3D scene decides where to draw a CME with utils/cmePropagation.ts, and a
// notification that quotes a different arrival time than the picture the user
// then opens is worse than one that quotes none. So the model is duplicated
// here, and test:cme checks the constants and the shape against the original.
//
// A CME leaves at its launch speed and decelerates at a constant rate that
// depends on that speed, a = 1.41 - 0.0035u m/s^2 - a slow one is nudged
// along, a fast one is dragged back hard - until it is down to the ambient
// wind, then it coasts.
const AU_IN_KM = 149597870.7;
const MIN_CME_SPEED_KMS = 300;

// The honest width of the answer. Arrival forecasting is good to about half a
// day at best, and a notification that says "3:40am" without one invites
// somebody to stand outside at 3:40am. Always stated, never tuned per CME.
const CME_ARRIVAL_UNCERTAINTY_HOURS = 12;

function cmeDistanceAU(speedKms, timeSinceEventSeconds) {
  const u_kms = speedKms;
  const t_s = Math.max(0, timeSinceEventSeconds);
  if (u_kms <= MIN_CME_SPEED_KMS) return (u_kms * t_s) / AU_IN_KM;

  const a_kms2 = (1.41 - 0.0035 * u_kms) / 1000.0;
  if (a_kms2 >= 0) return ((u_kms * t_s) + (0.5 * a_kms2 * t_s * t_s)) / AU_IN_KM;

  const time_to_floor_s = (MIN_CME_SPEED_KMS - u_kms) / a_kms2;
  if (t_s < time_to_floor_s) {
    return ((u_kms * t_s) + (0.5 * a_kms2 * t_s * t_s)) / AU_IN_KM;
  }
  const dist_decel = (u_kms * time_to_floor_s) + (0.5 * a_kms2 * time_to_floor_s * time_to_floor_s);
  const dist_coast = MIN_CME_SPEED_KMS * (t_s - time_to_floor_s);
  return (dist_decel + dist_coast) / AU_IN_KM;
}

/** Seconds to reach a distance in AU, or null if it never does in a fortnight. */
function cmeTransitSeconds(speedKms, targetAU) {
  let lo = 0, hi = 14 * 24 * 3600;
  if (cmeDistanceAU(speedKms, hi) < targetAU) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (cmeDistanceAU(speedKms, mid) < targetAU) lo = mid; else hi = mid;
  }
  return hi;
}

/** When this CME reaches Earth, in ms, by the model the scene draws with. */
function cmeArrivalMs(speedKms, startMs) {
  const secs = cmeTransitSeconds(speedKms, 1);
  return secs == null ? null : startMs + secs * 1000;
}

// At most this many alerts from one run. DONKI occasionally publishes a batch
// after an outage, and an outage is not a reason to send somebody six pushes.
const CME_MAX_PER_RUN = 3;

/** The analysis to believe: DONKI's own most-accurate flag, else the first. */
function pickCmeAnalysis(analyses) {
  if (!Array.isArray(analyses) || analyses.length === 0) return null;
  return analyses.find(a => a?.isMostAccurate) ?? analyses[0];
}

function isCmeAnalysisUsable(a) {
  return !!a && a.speed != null && a.longitude != null && a.latitude != null;
}

function isCmeEarthDirected(a) {
  if (!isCmeAnalysisUsable(a)) return false;
  return Math.abs(a.longitude) < CME_EARTH_DIRECTED_MAX_LONGITUDE;
}

/** A subscriber's speed floor, clamped to something we can rely on. */
function cmeSpeedFloorOf(stored) {
  const raw = stored?.cme_speed_min;
  // null, undefined and '' all mean "never chose", which is the default rather
  // than the minimum. Number(null) is 0, so without this an explicit null in a
  // record would quietly opt someone into every CME down to 300 km/s.
  if (raw == null || raw === '') return CME_SPEED_FLOOR_DEFAULT;
  const n = Math.round(Number(raw));
  if (!isFinite(n)) return CME_SPEED_FLOOR_DEFAULT;
  return Math.min(CME_SPEED_FLOOR_MAX, Math.max(CME_SPEED_FLOOR_MIN, n));
}

/**
 * DONKI's predicted arrival for a CME, if it has linked one.
 *
 * Same trick the app uses: a linked -GST event's activityID begins with the
 * predicted timestamp. Returns null when there is no linked geomagnetic storm,
 * which is the common case for a fresh CME.
 */
function cmePredictedArrival(cme) {
  const linked = cme?.linkedEvents;
  if (!Array.isArray(linked)) return null;
  const gst = linked.find(e => typeof e?.activityID === 'string' && e.activityID.includes('-GST'));
  if (!gst) return null;
  const d = gst.activityID.slice(0, 13);
  const parsed = Date.parse(
    `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(9, 11)}:${d.slice(11, 13)}:00Z`);
  return isFinite(parsed) ? parsed : null;
}

async function checkEarthDirectedCMEs(env, cmeData = null, note = /** @type {(name?: string, status?: string, detail?: string) => void} */ (() => {})) {
  try {
    if (!cmeData) {
      const response = await fetchWithRetry(DONKI_CME_URL);
      if (!response) { note('cme', 'skipped', 'DONKI CME feed unreachable'); return; }
      cmeData = await response.json().catch(() => null);
    }
    if (!Array.isArray(cmeData)) { note('cme', 'skipped', 'DONKI CME feed unparseable'); return; }

    const state = await kv(env).get(CME_SEEN_KEY, 'json');
    const seen = new Set(state?.ids ?? []);
    const cutoff = Date.now() - CME_LOOKBACK_MS;

    const fresh = [];
    let earthDirected = 0;
    for (const cme of cmeData) {
      const id = cme?.activityID;
      if (!id || seen.has(id)) continue;
      const startMs = Date.parse(cme.startTime);
      if (!isFinite(startMs) || startMs < cutoff) continue;

      const a = pickCmeAnalysis(cme.cmeAnalyses);
      if (!isCmeEarthDirected(a)) continue;
      earthDirected++;
      fresh.push({
        id, startMs,
        speed: Math.round(a.speed),
        longitude: +Number(a.longitude).toFixed(1),
        latitude: +Number(a.latitude).toFixed(1),
        halfAngle: a.halfAngle ?? 30,
        arrivalMs: cmePredictedArrival(cme),
      });
    }

    // First ever run: adopt the current window as already-known rather than
    // announcing two days of history to everybody at once.
    if (!state) {
      await kv(env).put(CME_SEEN_KEY, JSON.stringify({
        ids: fresh.map(c => c.id).slice(-CME_SEEN_MAX), primedAt: Date.now(),
      }));
      note('cme', 'skipped',
           `first run - adopted ${fresh.length} recent Earth-directed CME(s) as already seen`);
      return;
    }

    if (fresh.length === 0) {
      note('cme', 'quiet',
           `no new Earth-directed CME in the last ${Math.round(CME_LOOKBACK_MS / 3600000)}h `
           + `(${cmeData.length} catalogued)`);
      return;
    }

    // Fastest first, so a capped run reports the one that matters most.
    fresh.sort((a, b) => b.speed - a.speed);
    const toSend = fresh.slice(0, CME_MAX_PER_RUN);

    for (const c of toSend) {
      // Spot The Aurora's own forecast, from the same model the 3D scene uses,
      // so the notification and the picture it links to agree.
      const forecastMs = cmeArrivalMs(c.speed, c.startMs);
      const arrivalLines = [];
      if (forecastMs) {
        arrivalLines.push(
          `Forecast arrival: ${formatNzTime(forecastMs)} (+/- ${CME_ARRIVAL_UNCERTAINTY_HOURS} hours)`);
      } else {
        arrivalLines.push('Too slow to reach us on any useful timescale.');
      }
      // DONKI's own number, when it has linked a geomagnetic storm to this CME.
      // Labelled rather than blended, because they are different models and
      // will not agree.
      if (c.arrivalMs) arrivalLines.push(`NASA estimate: ${formatNzTime(c.arrivalMs)}`);
      const band = cmeSpeedBand(c.speed);
      const payload = {
        title: `Earth-Directed CME - ${c.speed} km/s`,
        body: [
          'A CME has been detected heading toward Earth.',
          '',
          `Speed: ${c.speed} km/s`,
          CME_SPEED_BAND_TEXT[band],
          `Launched: ${formatNzTime(c.startMs)}`,
          `Source: ${c.longitude >= 0 ? 'west' : 'east'} ${Math.abs(c.longitude)}deg, `
            + `${c.latitude >= 0 ? 'north' : 'south'} ${Math.abs(c.latitude)}deg`,
          '',
          ...arrivalLines,
        ].join('\n'),
        tag: 'cme-earth-directed',
        data: { url: '/?page=modeler', category: 'cme-earth-directed' },
        ts: Date.now(),
      };
      await kv(env).put('LATEST_ALERT_cme-earth-directed', JSON.stringify(payload),
                        { expirationTtl: 86400 });
      // Per-subscriber, because the speed floor is each subscriber's own.
      await enqueueDelivery(env, {
        kind: 'cme', topic: 'cme-earth-directed', payload,
        params: { id: c.id, speed: c.speed },
      });
    }

    // Everything examined this run is now known, including the ones the cap
    // skipped - otherwise the next run would send them and the cap would only
    // have delayed the burst.
    const ids = [...seen, ...fresh.map(c => c.id)].slice(-CME_SEEN_MAX);
    await kv(env).put(CME_SEEN_KEY, JSON.stringify({ ids, updatedAt: Date.now() }));

    note('cme', 'fired',
         `${toSend.length} Earth-directed CME(s) queued, fastest ${toSend[0].speed} km/s`
         + (fresh.length > toSend.length ? ` (${fresh.length - toSend.length} more capped)` : ''));
  } catch (e) {
    note('cme', 'error', e.message);
    reportError(e, env, { handler: 'checkEarthDirectedCMEs' });
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

async function checkSubstormActivity(env, substormThresholds, substormData, /** @type {any} */ loadingState = null, note = /** @type {(name?: string, status?: string, detail?: string) => void} */ (() => {})) {
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
          case 'ONSET':       title = 'Substorm Eruption In Progress!';   body = 'A substorm onset has been detected. Aurora may be visible now, look south.'; break;
          case 'IMMINENT_30': title = 'Substorm Alert: Eruption Imminent'; body = `Substorm index ${Math.round(score)}, eruption expected within 30 minutes. Get to your viewing site.`; break;
          case 'LIKELY_60':   title = 'Substorm Watch: Eruption Likely';   body = `Substorm index ${Math.round(score)}, eruption likely within the hour. Prepare to go out.`; break;
          case 'WATCH':       title = 'Substorm Watch: Energy Building';   body = `Substorm index ${Math.round(score)}, magnetospheric energy is loading. Keep an eye on the forecast.`; break;
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
      ff:  { title: 'CME Has Hit the Satellites!',   summary: 'A fast forward shock has been detected at the L1 satellites. Speed, density and magnetic field all jumped, which is the classic CME arrival signature.' },
      sf:  { title: 'Compression Wave Detected',     summary: 'A slow forward shock has arrived at L1, a compression wave with rising speed and density but dropping magnetic field.' },
      fr:  { title: 'CME Trailing Edge Passing',     summary: 'A fast reverse shock detected, the back end of a CME or high-speed stream is sweeping past.' },
      sr:  { title: 'Trailing Rarefaction Detected', summary: 'A slow reverse shock at L1, density falling with a magnetic uptick.' },
      imf: { title: 'Sudden IMF Shift Detected',     summary: 'A sharp change in the interplanetary magnetic field was detected without a major plasma shock.' },
    };

    const info = SHOCK_LABELS[bestEvent.shockType];
    const title = info.title;
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
      title: `Tonight's aurora outlook: ${condition.label}`,
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

// <generated:visibility>
// Generated from utils/auroraVisibility.ts, ovalPhysics.ts, skyConditions.ts
// and aacgmGrid.ts by `npm run sync:visibility`. Do not edit by hand - change
// the app's model and re-run the script. `npm run test:visibility-sync`
// fails if this block and the app disagree.
var AuroraVisibility=(()=>{var __defProp=Object.defineProperty;var __getOwnPropDesc=Object.getOwnPropertyDescriptor;var __getOwnPropNames=Object.getOwnPropertyNames;var __hasOwnProp=Object.prototype.hasOwnProperty;var __export=(target,all)=>{for(var name in all)__defProp(target,name,{get:all[name],enumerable:true})};var __copyProps=(to,from,except,desc)=>{if(from&&typeof from==="object"||typeof from==="function"){for(let key of __getOwnPropNames(from))if(!__hasOwnProp.call(to,key)&&key!==except)__defProp(to,key,{get:()=>from[key],enumerable:!(desc=__getOwnPropDesc(from,key))||desc.enumerable})}return to};var __toCommonJS=mod=>__copyProps(__defProp({},"__esModule",{value:true}),mod);var visibility_entry_exports={};__export(visibility_entry_exports,{auroraGeometryAt:()=>auroraGeometryAt,computeOvalBoundary:()=>computeOvalBoundary,magneticLatitude:()=>magneticLatitude,mergeL1Series:()=>mergeL1Series,realWindBoundary:()=>realWindBoundary,scoreAtLocation:()=>scoreAtLocation,skyConditionsAt:()=>skyConditionsAt,tierForStrength:()=>tierForStrength,viewlineReachDeg:()=>viewlineReachDeg,visibilityOutlook:()=>visibilityOutlook});var AACGM_GRID={lat0:-72,lon0:110,rows:48,cols:81,heightKm:110,epoch:"2026-07-01",values:[-8513,-8537,-8560,-8582,-8604,-8625,-8645,-8663,-8680,-8695,-8708,-8719,-8727,-8733,-8735,-8734,-8731,-8724,-8714,-8702,-8688,-8672,-8654,-8635,-8615,-8594,-8572,-8549,-8526,-8502,-8478,-8453,-8428,-8403,-8378,-8352,-8327,-8301,-8275,-8249,-8223,-8197,-8171,-8145,-8118,-8092,-8066,-8040,-8014,-7988,-7962,-7936,-7910,-7884,-7858,-7832,-7806,-7781,-7755,-7729,-7704,-7679,-7653,-7628,-7603,-7578,-7553,-7528,-7503,-7479,-7454,-7430,-7405,-7381,-7357,-7333,-7309,-7285,-7262,-7238,-7215,-8449,-8470,-8491,-8510,-8529,-8547,-8563,-8578,-8592,-8603,-8613,-8621,-8627,-8630,-8631,-8630,-8626,-8620,-8612,-8602,-8590,-8576,-8561,-8545,-8527,-8508,-8488,-8468,-8446,-8424,-8402,-8379,-8355,-8331,-8307,-8283,-8258,-8233,-8208,-8183,-8157,-8131,-8106,-8080,-8054,-8028,-8002,-7976,-7951,-7925,-7899,-7873,-7847,-7821,-7795,-7769,-7743,-7717,-7692,-7666,-7640,-7615,-7590,-7564,-7539,-7514,-7488,-7463,-7438,-7414,-7389,-7364,-7339,-7315,-7291,-7266,-7242,-7218,-7194,-7170,-7147,-8374,-8393,-8411,-8429,-8445,-8460,-8474,-8486,-8497,-8506,-8514,-8520,-8524,-8526,-8526,-8524,-8521,-8515,-8508,-8499,-8489,-8476,-8463,-8448,-8432,-8415,-8397,-8378,-8359,-8338,-8317,-8296,-8274,-8251,-8228,-8204,-8181,-8157,-8132,-8108,-8083,-8058,-8033,-8008,-7983,-7957,-7932,-7906,-7880,-7855,-7829,-7803,-7777,-7752,-7726,-7700,-7674,-7649,-7623,-7597,-7572,-7546,-7521,-7495,-7470,-7445,-7419,-7394,-7369,-7344,-7319,-7294,-7270,-7245,-7220,-7196,-7172,-7147,-7123,-7099,-7075,-8292,-8309,-8325,-8341,-8355,-8368,-8379,-8390,-8399,-8406,-8412,-8417,-8420,-8421,-8421,-8419,-8415,-8410,-8403,-8395,-8385,-8374,-8362,-8348,-8334,-8318,-8301,-8284,-8266,-8247,-8227,-8206,-8186,-8164,-8142,-8120,-8097,-8074,-8050,-8027,-8003,-7979,-7954,-7930,-7905,-7880,-7855,-7830,-7804,-7779,-7754,-7728,-7703,-7677,-7652,-7626,-7601,-7575,-7549,-7524,-7498,-7473,-7448,-7422,-7397,-7371,-7346,-7321,-7296,-7271,-7246,-7221,-7196,-7171,-7147,-7122,-7098,-7073,-7049,-7025,-7001,-8205,-8220,-8235,-8248,-8261,-8272,-8282,-8291,-8298,-8305,-8309,-8313,-8315,-8316,-8315,-8312,-8309,-8304,-8297,-8289,-8280,-8270,-8258,-8246,-8232,-8218,-8202,-8186,-8169,-8151,-8132,-8113,-8093,-8073,-8052,-8030,-8008,-7986,-7964,-7941,-7917,-7894,-7870,-7846,-7822,-7798,-7773,-7749,-7724,-7699,-7674,-7649,-7624,-7598,-7573,-7548,-7523,-7497,-7472,-7447,-7421,-7396,-7370,-7345,-7320,-7295,-7269,-7244,-7219,-7194,-7169,-7144,-7119,-7095,-7070,-7045,-7021,-6996,-6972,-6948,-6924,-8114,-8128,-8141,-8153,-8164,-8174,-8182,-8190,-8196,-8201,-8205,-8208,-8209,-8209,-8208,-8206,-8202,-8197,-8191,-8183,-8174,-8165,-8154,-8142,-8129,-8115,-8101,-8085,-8069,-8052,-8034,-8016,-7997,-7977,-7957,-7937,-7916,-7895,-7873,-7851,-7828,-7805,-7782,-7759,-7735,-7712,-7688,-7663,-7639,-7615,-7590,-7566,-7541,-7516,-7491,-7466,-7441,-7416,-7391,-7366,-7340,-7315,-7290,-7265,-7240,-7215,-7190,-7165,-7140,-7115,-7090,-7065,-7040,-7015,-6991,-6966,-6941,-6917,-6893,-6868,-6844,-8020,-8032,-8044,-8055,-8065,-8073,-8081,-8088,-8093,-8097,-8100,-8102,-8103,-8103,-8101,-8098,-8095,-8090,-8083,-8076,-8068,-8058,-8048,-8037,-8025,-8012,-7998,-7983,-7967,-7951,-7934,-7917,-7898,-7880,-7861,-7841,-7821,-7800,-7779,-7757,-7736,-7713,-7691,-7668,-7645,-7622,-7599,-7575,-7551,-7527,-7503,-7479,-7455,-7430,-7406,-7381,-7356,-7331,-7307,-7282,-7257,-7232,-7207,-7182,-7157,-7132,-7107,-7082,-7057,-7032,-7008,-6983,-6958,-6933,-6909,-6884,-6860,-6835,-6811,-6787,-6763,-7924,-7935,-7946,-7955,-7964,-7972,-7978,-7984,-7989,-7992,-7995,-7996,-7996,-7996,-7994,-7991,-7987,-7982,-7976,-7969,-7961,-7952,-7942,-7931,-7919,-7906,-7893,-7879,-7864,-7849,-7832,-7815,-7798,-7780,-7761,-7742,-7723,-7703,-7682,-7662,-7641,-7619,-7597,-7575,-7553,-7530,-7507,-7484,-7461,-7437,-7414,-7390,-7366,-7342,-7318,-7293,-7269,-7244,-7220,-7195,-7171,-7146,-7121,-7097,-7072,-7047,-7022,-6998,-6973,-6948,-6923,-6899,-6874,-6850,-6825,-6801,-6776,-6752,-6728,-6703,-6679,-7826,-7836,-7846,-7854,-7862,-7869,-7875,-7880,-7884,-7887,-7888,-7889,-7889,-7888,-7886,-7883,-7879,-7874,-7868,-7861,-7853,-7844,-7834,-7824,-7813,-7801,-7788,-7774,-7760,-7745,-7729,-7713,-7696,-7679,-7661,-7642,-7623,-7604,-7584,-7564,-7543,-7523,-7501,-7480,-7458,-7436,-7413,-7391,-7368,-7345,-7322,-7298,-7275,-7251,-7227,-7203,-7179,-7155,-7131,-7107,-7082,-7058,-7034,-7009,-6985,-6960,-6935,-6911,-6886,-6862,-6837,-6813,-6788,-6764,-6739,-6715,-6691,-6666,-6642,-6618,-6594,-7726,-7736,-7744,-7752,-7759,-7765,-7770,-7774,-7778,-7780,-7782,-7782,-7782,-7780,-7778,-7775,-7770,-7765,-7759,-7752,-7745,-7736,-7727,-7717,-7706,-7694,-7681,-7668,-7654,-7640,-7625,-7609,-7593,-7576,-7559,-7541,-7522,-7504,-7484,-7465,-7445,-7424,-7404,-7383,-7361,-7340,-7318,-7296,-7273,-7251,-7228,-7205,-7182,-7159,-7135,-7112,-7088,-7064,-7040,-7016,-6992,-6968,-6944,-6920,-6895,-6871,-6847,-6822,-6798,-6774,-6749,-6725,-6701,-6676,-6652,-6628,-6604,-6580,-6556,-6532,-6508,-7625,-7634,-7642,-7649,-7655,-7660,-7665,-7669,-7671,-7673,-7674,-7674,-7674,-7672,-7669,-7666,-7662,-7657,-7651,-7644,-7636,-7628,-7619,-7609,-7598,-7586,-7574,-7562,-7548,-7534,-7519,-7504,-7488,-7472,-7455,-7438,-7420,-7402,-7383,-7364,-7345,-7325,-7305,-7284,-7263,-7242,-7221,-7199,-7177,-7155,-7133,-7110,-7087,-7065,-7041,-7018,-6995,-6971,-6948,-6924,-6900,-6877,-6853,-6829,-6805,-6781,-6757,-6732,-6708,-6684,-6660,-6636,-6612,-6588,-6564,-6539,-6515,-6491,-6467,-6444,-6420,-7523,-7531,-7538,-7545,-7550,-7555,-7559,-7562,-7564,-7566,-7566,-7566,-7565,-7563,-7560,-7557,-7553,-7547,-7541,-7535,-7527,-7519,-7510,-7500,-7490,-7479,-7467,-7454,-7441,-7428,-7413,-7399,-7383,-7367,-7351,-7334,-7317,-7299,-7281,-7262,-7243,-7224,-7204,-7184,-7164,-7143,-7122,-7101,-7080,-7058,-7036,-7014,-6992,-6969,-6946,-6923,-6901,-6877,-6854,-6831,-6807,-6784,-6760,-6737,-6713,-6689,-6665,-6641,-6617,-6593,-6569,-6545,-6522,-6498,-6474,-6450,-6426,-6402,-6378,-6354,-6331,-7420,-7428,-7434,-7440,-7445,-7449,-7452,-7455,-7457,-7458,-7458,-7458,-7456,-7454,-7451,-7448,-7443,-7438,-7432,-7425,-7418,-7410,-7401,-7391,-7381,-7370,-7359,-7347,-7334,-7321,-7307,-7292,-7278,-7262,-7246,-7230,-7213,-7196,-7178,-7160,-7141,-7122,-7103,-7083,-7063,-7043,-7023,-7002,-6981,-6960,-6938,-6916,-6894,-6872,-6850,-6828,-6805,-6782,-6759,-6736,-6713,-6690,-6666,-6643,-6620,-6596,-6572,-6549,-6525,-6501,-6478,-6454,-6430,-6406,-6383,-6359,-6335,-6312,-6288,-6264,-6241,-7317,-7323,-7329,-7334,-7339,-7342,-7345,-7347,-7349,-7350,-7350,-7349,-7347,-7345,-7342,-7338,-7334,-7328,-7322,-7316,-7308,-7300,-7292,-7282,-7272,-7262,-7251,-7239,-7226,-7213,-7200,-7186,-7171,-7156,-7141,-7125,-7108,-7091,-7074,-7056,-7038,-7020,-7001,-6982,-6962,-6942,-6922,-6902,-6881,-6860,-6839,-6818,-6796,-6775,-6753,-6731,-6708,-6686,-6663,-6641,-6618,-6595,-6572,-6549,-6525,-6502,-6479,-6455,-6432,-6408,-6385,-6361,-6338,-6314,-6291,-6267,-6244,-6220,-6197,-6173,-6150,-7212,-7218,-7223,-7228,-7232,-7235,-7238,-7239,-7241,-7241,-7241,-7239,-7238,-7235,-7232,-7228,-7224,-7218,-7212,-7206,-7199,-7191,-7182,-7173,-7163,-7153,-7142,-7130,-7118,-7106,-7092,-7079,-7064,-7050,-7035,-7019,-7003,-6986,-6969,-6952,-6935,-6916,-6898,-6879,-6860,-6841,-6821,-6801,-6781,-6761,-6740,-6719,-6698,-6676,-6655,-6633,-6611,-6589,-6567,-6544,-6522,-6499,-6476,-6453,-6430,-6407,-6384,-6361,-6338,-6315,-6291,-6268,-6245,-6221,-6198,-6175,-6151,-6128,-6105,-6081,-6058,-7107,-7112,-7117,-7121,-7125,-7127,-7130,-7131,-7132,-7132,-7131,-7130,-7128,-7125,-7122,-7118,-7113,-7108,-7102,-7096,-7089,-7081,-7072,-7063,-7054,-7044,-7033,-7022,-7010,-6997,-6985,-6971,-6957,-6943,-6928,-6913,-6897,-6881,-6865,-6848,-6830,-6813,-6795,-6776,-6758,-6739,-6719,-6700,-6680,-6660,-6640,-6619,-6598,-6577,-6556,-6534,-6513,-6491,-6469,-6447,-6425,-6402,-6380,-6357,-6335,-6312,-6289,-6266,-6243,-6220,-6197,-6174,-6151,-6128,-6104,-6081,-6058,-6035,-6012,-5989,-5966,-7001,-7006,-7010,-7014,-7017,-7019,-7021,-7022,-7023,-7022,-7022,-7020,-7018,-7015,-7012,-7008,-7003,-6998,-6992,-6985,-6978,-6971,-6962,-6954,-6944,-6934,-6924,-6913,-6901,-6889,-6876,-6863,-6850,-6836,-6821,-6806,-6791,-6775,-6759,-6743,-6726,-6709,-6691,-6673,-6655,-6636,-6617,-6598,-6578,-6559,-6539,-6518,-6498,-6477,-6456,-6435,-6414,-6392,-6371,-6349,-6327,-6305,-6283,-6261,-6238,-6216,-6193,-6170,-6148,-6125,-6102,-6079,-6056,-6033,-6010,-5987,-5964,-5941,-5918,-5895,-5872,-6895,-6899,-6903,-6906,-6909,-6911,-6912,-6913,-6913,-6913,-6912,-6910,-6908,-6905,-6901,-6897,-6893,-6887,-6882,-6875,-6868,-6860,-6852,-6844,-6834,-6825,-6814,-6804,-6792,-6780,-6768,-6755,-6742,-6728,-6714,-6700,-6685,-6669,-6654,-6637,-6621,-6604,-6587,-6569,-6551,-6533,-6514,-6496,-6476,-6457,-6437,-6418,-6397,-6377,-6356,-6336,-6315,-6293,-6272,-6251,-6229,-6207,-6185,-6163,-6141,-6119,-6096,-6074,-6051,-6029,-6006,-5984,-5961,-5938,-5915,-5893,-5870,-5847,-5824,-5801,-5779,-6788,-6792,-6796,-6798,-6801,-6802,-6803,-6804,-6804,-6803,-6802,-6800,-6797,-6794,-6791,-6787,-6782,-6777,-6771,-6764,-6758,-6750,-6742,-6734,-6724,-6715,-6705,-6694,-6683,-6672,-6660,-6647,-6634,-6621,-6607,-6593,-6578,-6563,-6548,-6532,-6516,-6499,-6482,-6465,-6447,-6430,-6411,-6393,-6374,-6355,-6336,-6316,-6296,-6276,-6256,-6236,-6215,-6194,-6173,-6152,-6130,-6109,-6087,-6065,-6043,-6021,-5999,-5977,-5955,-5933,-5910,-5888,-5865,-5843,-5820,-5797,-5775,-5752,-5730,-5707,-5685,-6681,-6684,-6687,-6690,-6692,-6693,-6694,-6694,-6694,-6693,-6691,-6689,-6687,-6684,-6680,-6676,-6671,-6666,-6660,-6654,-6647,-6640,-6632,-6623,-6614,-6605,-6595,-6585,-6574,-6563,-6551,-6539,-6526,-6513,-6500,-6486,-6471,-6457,-6442,-6426,-6410,-6394,-6377,-6361,-6343,-6326,-6308,-6290,-6271,-6253,-6234,-6214,-6195,-6175,-6155,-6135,-6115,-6094,-6073,-6052,-6031,-6010,-5989,-5967,-5945,-5924,-5902,-5880,-5858,-5836,-5813,-5791,-5769,-5747,-5724,-5702,-5679,-5657,-5635,-5612,-5590,-6573,-6576,-6579,-6581,-6583,-6584,-6584,-6584,-6584,-6582,-6581,-6579,-6576,-6573,-6569,-6565,-6560,-6555,-6549,-6543,-6536,-6529,-6521,-6513,-6504,-6495,-6485,-6475,-6465,-6454,-6442,-6430,-6418,-6405,-6392,-6378,-6364,-6350,-6335,-6320,-6305,-6289,-6272,-6256,-6239,-6222,-6204,-6187,-6168,-6150,-6131,-6112,-6093,-6074,-6054,-6034,-6014,-5994,-5973,-5953,-5932,-5911,-5890,-5869,-5847,-5826,-5804,-5782,-5760,-5738,-5716,-5694,-5672,-5650,-5628,-5606,-5584,-5561,-5539,-5517,-5495,-6465,-6468,-6470,-6472,-6473,-6474,-6474,-6474,-6473,-6472,-6470,-6468,-6465,-6462,-6458,-6454,-6449,-6444,-6438,-6432,-6426,-6418,-6411,-6403,-6394,-6385,-6376,-6366,-6355,-6345,-6333,-6322,-6310,-6297,-6284,-6271,-6257,-6243,-6229,-6214,-6199,-6183,-6167,-6151,-6135,-6118,-6101,-6083,-6065,-6047,-6029,-6010,-5991,-5972,-5953,-5933,-5913,-5893,-5873,-5853,-5832,-5812,-5791,-5770,-5748,-5727,-5706,-5684,-5662,-5641,-5619,-5597,-5575,-5553,-5531,-5509,-5487,-5465,-5443,-5421,-5399,-6357,-6359,-6361,-6363,-6363,-6364,-6364,-6363,-6363,-6361,-6359,-6357,-6354,-6351,-6347,-6343,-6338,-6333,-6327,-6321,-6315,-6308,-6300,-6292,-6284,-6275,-6266,-6256,-6246,-6236,-6225,-6213,-6201,-6189,-6177,-6164,-6150,-6136,-6122,-6108,-6093,-6078,-6062,-6046,-6030,-6013,-5997,-5979,-5962,-5944,-5926,-5908,-5889,-5870,-5851,-5832,-5812,-5793,-5773,-5753,-5732,-5712,-5691,-5670,-5649,-5628,-5607,-5586,-5564,-5543,-5521,-5500,-5478,-5456,-5434,-5413,-5391,-5369,-5347,-5325,-5303,-6248,-6250,-6252,-6253,-6254,-6254,-6254,-6253,-6252,-6250,-6248,-6246,-6243,-6240,-6236,-6232,-6227,-6222,-6216,-6210,-6204,-6197,-6190,-6182,-6174,-6165,-6156,-6147,-6137,-6126,-6116,-6105,-6093,-6081,-6069,-6056,-6043,-6030,-6016,-6001,-5987,-5972,-5957,-5941,-5925,-5909,-5892,-5876,-5858,-5841,-5823,-5805,-5787,-5768,-5749,-5730,-5711,-5692,-5672,-5652,-5632,-5612,-5591,-5571,-5550,-5529,-5508,-5487,-5466,-5445,-5423,-5402,-5380,-5359,-5337,-5315,-5294,-5272,-5250,-5229,-5207,-6139,-6141,-6142,-6143,-6143,-6143,-6143,-6142,-6141,-6139,-6137,-6135,-6132,-6128,-6125,-6120,-6116,-6111,-6105,-6099,-6093,-6086,-6079,-6072,-6064,-6055,-6046,-6037,-6027,-6017,-6007,-5996,-5985,-5973,-5961,-5949,-5936,-5923,-5909,-5895,-5881,-5866,-5851,-5836,-5820,-5804,-5788,-5772,-5755,-5738,-5720,-5702,-5684,-5666,-5648,-5629,-5610,-5590,-5571,-5551,-5532,-5511,-5491,-5471,-5450,-5430,-5409,-5388,-5367,-5346,-5325,-5304,-5282,-5261,-5239,-5218,-5197,-5175,-5154,-5132,-5111,-6030,-6031,-6032,-6033,-6033,-6033,-6032,-6031,-6030,-6028,-6026,-6023,-6020,-6017,-6013,-6009,-6004,-5999,-5994,-5988,-5982,-5976,-5969,-5961,-5953,-5945,-5936,-5927,-5918,-5908,-5898,-5887,-5876,-5865,-5853,-5841,-5829,-5816,-5802,-5789,-5775,-5761,-5746,-5731,-5716,-5700,-5684,-5668,-5651,-5634,-5617,-5599,-5582,-5564,-5545,-5527,-5508,-5489,-5470,-5450,-5431,-5411,-5391,-5371,-5351,-5330,-5310,-5289,-5268,-5247,-5226,-5205,-5184,-5163,-5142,-5120,-5099,-5078,-5056,-5035,-5014,-5920,-5921,-5922,-5923,-5922,-5922,-5921,-5920,-5919,-5917,-5914,-5912,-5909,-5905,-5902,-5898,-5893,-5888,-5883,-5877,-5871,-5865,-5858,-5851,-5843,-5835,-5827,-5818,-5809,-5799,-5789,-5779,-5768,-5757,-5745,-5734,-5721,-5709,-5696,-5682,-5669,-5655,-5640,-5626,-5611,-5595,-5580,-5563,-5547,-5531,-5514,-5496,-5479,-5461,-5443,-5425,-5406,-5388,-5369,-5349,-5330,-5310,-5291,-5271,-5251,-5230,-5210,-5189,-5169,-5148,-5127,-5106,-5085,-5064,-5043,-5022,-5001,-4980,-4959,-4938,-4917,-5811,-5811,-5812,-5812,-5812,-5811,-5810,-5809,-5807,-5805,-5803,-5800,-5797,-5794,-5790,-5786,-5782,-5777,-5772,-5766,-5760,-5754,-5747,-5740,-5733,-5725,-5717,-5708,-5699,-5690,-5680,-5670,-5660,-5649,-5638,-5626,-5614,-5602,-5589,-5576,-5563,-5549,-5535,-5520,-5506,-5491,-5475,-5459,-5443,-5427,-5410,-5393,-5376,-5359,-5341,-5323,-5304,-5286,-5267,-5248,-5229,-5209,-5190,-5170,-5150,-5130,-5110,-5090,-5069,-5049,-5028,-5007,-4987,-4966,-4945,-4924,-4903,-4882,-4861,-4840,-4819,-5701,-5701,-5701,-5701,-5701,-5700,-5699,-5698,-5696,-5694,-5691,-5689,-5686,-5682,-5679,-5675,-5670,-5666,-5661,-5655,-5649,-5643,-5637,-5630,-5623,-5615,-5607,-5599,-5590,-5581,-5572,-5562,-5552,-5541,-5530,-5519,-5507,-5495,-5483,-5470,-5457,-5443,-5429,-5415,-5401,-5386,-5371,-5355,-5339,-5323,-5307,-5290,-5273,-5256,-5238,-5220,-5202,-5184,-5165,-5147,-5128,-5108,-5089,-5069,-5050,-5030,-5010,-4990,-4969,-4949,-4929,-4908,-4887,-4867,-4846,-4825,-4805,-4784,-4763,-4742,-4722,-5591,-5591,-5591,-5590,-5590,-5589,-5588,-5586,-5584,-5582,-5580,-5577,-5574,-5571,-5567,-5563,-5559,-5554,-5549,-5544,-5539,-5533,-5526,-5520,-5513,-5505,-5498,-5490,-5481,-5472,-5463,-5453,-5444,-5433,-5422,-5411,-5400,-5388,-5376,-5364,-5351,-5337,-5324,-5310,-5296,-5281,-5266,-5251,-5235,-5219,-5203,-5187,-5170,-5153,-5136,-5118,-5100,-5082,-5064,-5045,-5026,-5007,-4988,-4969,-4949,-4929,-4910,-4890,-4869,-4849,-4829,-4809,-4788,-4768,-4747,-4727,-4706,-4685,-4665,-4644,-4624,-5480,-5480,-5480,-5479,-5479,-5477,-5476,-5475,-5473,-5471,-5468,-5465,-5462,-5459,-5456,-5452,-5448,-5443,-5438,-5433,-5428,-5422,-5416,-5410,-5403,-5396,-5388,-5380,-5372,-5363,-5354,-5345,-5335,-5325,-5315,-5304,-5293,-5281,-5270,-5257,-5245,-5232,-5218,-5205,-5191,-5176,-5162,-5147,-5131,-5116,-5100,-5083,-5067,-5050,-5033,-5015,-4998,-4980,-4962,-4943,-4925,-4906,-4887,-4868,-4848,-4829,-4809,-4789,-4769,-4749,-4729,-4709,-4689,-4668,-4648,-4627,-4607,-4587,-4566,-4546,-4525,-5370,-5369,-5369,-5368,-5367,-5366,-5365,-5363,-5361,-5359,-5356,-5354,-5351,-5347,-5344,-5340,-5336,-5332,-5327,-5322,-5317,-5312,-5306,-5299,-5293,-5286,-5279,-5271,-5263,-5255,-5246,-5237,-5227,-5218,-5208,-5197,-5186,-5175,-5163,-5151,-5139,-5126,-5113,-5100,-5086,-5072,-5057,-5042,-5027,-5012,-4996,-4980,-4964,-4947,-4930,-4913,-4895,-4878,-4860,-4841,-4823,-4804,-4785,-4766,-4747,-4728,-4708,-4689,-4669,-4649,-4629,-4609,-4589,-4569,-4548,-4528,-4508,-4488,-4467,-4447,-4427,-5259,-5258,-5258,-5257,-5256,-5254,-5253,-5251,-5249,-5247,-5245,-5242,-5239,-5236,-5232,-5229,-5225,-5221,-5216,-5211,-5206,-5201,-5195,-5189,-5183,-5176,-5169,-5162,-5154,-5146,-5138,-5129,-5120,-5110,-5100,-5090,-5079,-5068,-5057,-5045,-5033,-5020,-5008,-4994,-4981,-4967,-4953,-4938,-4923,-4908,-4893,-4877,-4860,-4844,-4827,-4810,-4793,-4775,-4757,-4739,-4721,-4703,-4684,-4665,-4646,-4627,-4607,-4588,-4568,-4548,-4529,-4509,-4489,-4469,-4449,-4429,-4408,-4388,-4368,-4348,-4328,-5148,-5147,-5147,-5146,-5144,-5143,-5141,-5139,-5137,-5135,-5133,-5130,-5127,-5124,-5121,-5117,-5114,-5110,-5105,-5101,-5096,-5091,-5085,-5079,-5073,-5067,-5060,-5053,-5045,-5038,-5029,-5021,-5012,-5003,-4993,-4983,-4972,-4962,-4951,-4939,-4927,-4915,-4902,-4889,-4876,-4862,-4848,-4834,-4819,-4804,-4789,-4773,-4757,-4741,-4724,-4707,-4690,-4673,-4655,-4637,-4619,-4601,-4582,-4563,-4544,-4525,-4506,-4487,-4467,-4448,-4428,-4408,-4388,-4368,-4349,-4329,-4309,-4289,-4269,-4249,-4229,-5037,-5036,-5035,-5034,-5033,-5031,-5029,-5027,-5025,-5023,-5021,-5018,-5015,-5012,-5009,-5006,-5002,-4998,-4994,-4990,-4985,-4980,-4975,-4969,-4964,-4957,-4951,-4944,-4937,-4929,-4921,-4913,-4904,-4895,-4886,-4876,-4866,-4855,-4844,-4833,-4821,-4809,-4797,-4784,-4771,-4758,-4744,-4730,-4715,-4700,-4685,-4670,-4654,-4638,-4621,-4605,-4587,-4570,-4553,-4535,-4517,-4499,-4480,-4462,-4443,-4424,-4405,-4385,-4366,-4347,-4327,-4307,-4288,-4268,-4248,-4229,-4209,-4189,-4169,-4150,-4130,-4926,-4925,-4924,-4922,-4921,-4919,-4917,-4916,-4913,-4911,-4909,-4906,-4904,-4901,-4898,-4894,-4891,-4887,-4883,-4879,-4875,-4870,-4865,-4860,-4854,-4848,-4842,-4835,-4828,-4821,-4813,-4805,-4797,-4788,-4779,-4769,-4759,-4749,-4738,-4727,-4716,-4704,-4692,-4679,-4666,-4653,-4639,-4625,-4611,-4596,-4581,-4566,-4550,-4534,-4518,-4502,-4485,-4468,-4450,-4432,-4415,-4396,-4378,-4360,-4341,-4322,-4303,-4284,-4265,-4245,-4226,-4207,-4187,-4167,-4148,-4128,-4109,-4089,-4070,-4050,-4030,-4815,-4814,-4812,-4811,-4809,-4807,-4806,-4804,-4801,-4799,-4797,-4795,-4792,-4789,-4786,-4783,-4780,-4776,-4773,-4769,-4764,-4760,-4755,-4750,-4745,-4739,-4733,-4727,-4720,-4713,-4705,-4698,-4689,-4681,-4672,-4663,-4653,-4643,-4632,-4621,-4610,-4599,-4587,-4574,-4562,-4549,-4535,-4521,-4507,-4493,-4478,-4462,-4447,-4431,-4415,-4399,-4382,-4365,-4347,-4330,-4312,-4294,-4276,-4257,-4239,-4220,-4201,-4182,-4163,-4144,-4125,-4105,-4086,-4067,-4047,-4028,-4008,-3989,-3969,-3950,-3931,-4703,-4702,-4701,-4699,-4697,-4695,-4694,-4692,-4689,-4687,-4685,-4683,-4680,-4677,-4675,-4672,-4669,-4665,-4662,-4658,-4654,-4650,-4645,-4640,-4635,-4630,-4624,-4618,-4612,-4605,-4598,-4590,-4582,-4574,-4565,-4556,-4547,-4537,-4526,-4516,-4505,-4493,-4482,-4469,-4457,-4444,-4431,-4417,-4403,-4389,-4374,-4359,-4343,-4328,-4312,-4295,-4279,-4262,-4245,-4227,-4210,-4192,-4174,-4155,-4137,-4118,-4099,-4080,-4061,-4042,-4023,-4004,-3985,-3965,-3946,-3927,-3908,-3888,-3869,-3850,-3831,-4592,-4591,-4589,-4587,-4585,-4583,-4582,-4580,-4577,-4575,-4573,-4571,-4568,-4566,-4563,-4560,-4558,-4554,-4551,-4548,-4544,-4540,-4536,-4531,-4526,-4521,-4515,-4510,-4503,-4497,-4490,-4483,-4475,-4467,-4459,-4450,-4440,-4431,-4421,-4410,-4400,-4388,-4377,-4365,-4352,-4340,-4326,-4313,-4299,-4285,-4270,-4255,-4240,-4224,-4208,-4192,-4176,-4159,-4142,-4124,-4107,-4089,-4071,-4053,-4034,-4016,-3997,-3978,-3959,-3941,-3921,-3902,-3883,-3864,-3845,-3826,-3807,-3788,-3769,-3750,-3731,-4481,-4479,-4477,-4475,-4473,-4471,-4470,-4468,-4465,-4463,-4461,-4459,-4457,-4454,-4452,-4449,-4447,-4444,-4441,-4437,-4434,-4430,-4426,-4422,-4417,-4412,-4407,-4401,-4395,-4389,-4383,-4376,-4368,-4360,-4352,-4343,-4334,-4325,-4315,-4305,-4294,-4283,-4272,-4260,-4248,-4235,-4222,-4209,-4195,-4181,-4167,-4152,-4137,-4121,-4105,-4089,-4073,-4056,-4039,-4022,-4004,-3986,-3968,-3950,-3932,-3913,-3895,-3876,-3857,-3839,-3820,-3801,-3782,-3763,-3744,-3725,-3706,-3687,-3668,-3649,-3630,-4369,-4367,-4365,-4363,-4361,-4359,-4358,-4356,-4353,-4351,-4349,-4347,-4345,-4343,-4341,-4338,-4336,-4333,-4330,-4327,-4324,-4320,-4317,-4313,-4308,-4304,-4299,-4293,-4288,-4282,-4275,-4269,-4261,-4254,-4246,-4237,-4229,-4219,-4210,-4200,-4189,-4178,-4167,-4155,-4143,-4131,-4118,-4105,-4091,-4077,-4063,-4048,-4033,-4018,-4002,-3986,-3969,-3953,-3936,-3919,-3901,-3884,-3866,-3848,-3829,-3811,-3792,-3774,-3755,-3736,-3717,-3699,-3680,-3661,-3642,-3623,-3604,-3586,-3567,-3548,-3530,-4258,-4256,-4254,-4252,-4250,-4247,-4245,-4244,-4242,-4240,-4238,-4236,-4234,-4231,-4229,-4227,-4225,-4222,-4220,-4217,-4214,-4211,-4207,-4204,-4200,-4195,-4191,-4186,-4180,-4174,-4168,-4162,-4155,-4147,-4140,-4132,-4123,-4114,-4105,-4095,-4084,-4074,-4063,-4051,-4039,-4027,-4014,-4001,-3987,-3973,-3959,-3945,-3930,-3914,-3899,-3883,-3866,-3850,-3833,-3816,-3798,-3781,-3763,-3745,-3727,-3708,-3690,-3671,-3653,-3634,-3615,-3596,-3578,-3559,-3540,-3522,-3503,-3484,-3466,-3447,-3429,-4146,-4144,-4142,-4140,-4138,-4136,-4134,-4132,-4130,-4128,-4126,-4124,-4122,-4120,-4118,-4116,-4114,-4112,-4110,-4107,-4104,-4101,-4098,-4095,-4091,-4087,-4083,-4078,-4073,-4067,-4061,-4055,-4048,-4041,-4034,-4026,-4017,-4009,-3999,-3990,-3980,-3969,-3958,-3947,-3935,-3923,-3910,-3897,-3884,-3870,-3856,-3841,-3826,-3811,-3795,-3779,-3763,-3747,-3730,-3713,-3695,-3678,-3660,-3642,-3624,-3606,-3587,-3569,-3550,-3532,-3513,-3494,-3476,-3457,-3438,-3420,-3401,-3383,-3364,-3346,-3328,-4035,-4032,-4030,-4028,-4026,-4024,-4022,-4020,-4018,-4016,-4014,-4012,-4011,-4009,-4007,-4005,-4004,-4002,-4e3,-3997,-3995,-3992,-3989,-3986,-3983,-3979,-3975,-3970,-3966,-3960,-3955,-3949,-3942,-3935,-3928,-3920,-3912,-3904,-3895,-3885,-3875,-3865,-3854,-3843,-3831,-3819,-3806,-3793,-3780,-3766,-3752,-3738,-3723,-3708,-3692,-3676,-3660,-3643,-3627,-3610,-3592,-3575,-3557,-3539,-3521,-3503,-3484,-3466,-3447,-3429,-3410,-3392,-3373,-3355,-3336,-3318,-3300,-3281,-3263,-3245,-3227,-3923,-3921,-3918,-3916,-3914,-3912,-3910,-3908,-3906,-3904,-3903,-3901,-3899,-3898,-3896,-3895,-3893,-3892,-3890,-3888,-3886,-3883,-3881,-3878,-3875,-3871,-3867,-3863,-3859,-3854,-3848,-3843,-3836,-3830,-3823,-3815,-3807,-3799,-3790,-3781,-3771,-3760,-3750,-3739,-3727,-3715,-3703,-3690,-3676,-3663,-3649,-3634,-3619,-3604,-3589,-3573,-3557,-3540,-3523,-3506,-3489,-3472,-3454,-3436,-3418,-3400,-3382,-3363,-3345,-3326,-3308,-3289,-3271,-3252,-3234,-3216,-3198,-3180,-3162,-3144,-3126,-3812,-3809,-3807,-3804,-3802,-3800,-3798,-3796,-3794,-3793,-3791,-3790,-3788,-3787,-3786,-3784,-3783,-3782,-3780,-3778,-3777,-3774,-3772,-3770,-3767,-3764,-3760,-3756,-3752,-3747,-3742,-3737,-3731,-3724,-3718,-3710,-3702,-3694,-3685,-3676,-3667,-3656,-3646,-3635,-3623,-3611,-3599,-3586,-3573,-3559,-3545,-3531,-3516,-3501,-3486,-3470,-3454,-3437,-3420,-3403,-3386,-3369,-3351,-3333,-3315,-3297,-3279,-3260,-3242,-3224,-3205,-3187,-3168,-3150,-3132,-3114,-3096,-3078,-3060,-3042,-3025,-3700,-3698,-3695,-3693,-3690,-3688,-3686,-3685,-3683,-3681,-3680,-3679,-3677,-3676,-3675,-3674,-3673,-3672,-3671,-3669,-3668,-3666,-3664,-3662,-3659,-3656,-3653,-3650,-3646,-3641,-3636,-3631,-3625,-3619,-3613,-3605,-3598,-3590,-3581,-3572,-3563,-3553,-3542,-3531,-3520,-3508,-3496,-3483,-3470,-3456,-3442,-3428,-3413,-3398,-3383,-3367,-3351,-3334,-3317,-3300,-3283,-3266,-3248,-3230,-3212,-3194,-3176,-3158,-3139,-3121,-3103,-3084,-3066,-3048,-3030,-3012,-2994,-2976,-2958,-2941,-2923,-3589,-3586,-3584,-3581,-3579,-3577,-3575,-3573,-3571,-3570,-3569,-3568,-3567,-3566,-3565,-3564,-3563,-3562,-3561,-3560,-3559,-3558,-3556,-3554,-3552,-3549,-3546,-3543,-3539,-3535,-3531,-3526,-3520,-3514,-3508,-3501,-3494,-3486,-3477,-3468,-3459,-3449,-3439,-3428,-3417,-3405,-3393,-3380,-3367,-3353,-3339,-3325,-3310,-3295,-3280,-3264,-3248,-3231,-3215,-3198,-3180,-3163,-3145,-3127,-3109,-3091,-3073,-3055,-3036,-3018,-3e3,-2982,-2964,-2945,-2927,-2910,-2892,-2874,-2857,-2839,-2822]};var D2R=Math.PI/180;var R2D=180/Math.PI;function rmBeta(date){const MJD=date.getTime()/864e5+40587;const T0=(MJD-51544.5)/36525;const H=date.getUTCHours()+date.getUTCMinutes()/60+date.getUTCSeconds()/3600;const M=(357.528+35999.05*T0+.04107*H)*D2R;const Lam=280.46+36000.772*T0+.04107*H;const lambdaSun=(Lam+(1.915-.0048*T0)*Math.sin(M)+.02*Math.sin(2*M))*D2R;const eps=(23.439-.013*T0)*D2R;const theta=(100.461+36000.77*T0+15.04107*H)%360*D2R;const phi=80.65*D2R,lam=-72.68*D2R;const Qg=[Math.cos(phi)*Math.cos(lam),Math.cos(phi)*Math.sin(lam),Math.sin(phi)];const ct=Math.cos(theta),st=Math.sin(theta);const Qei=[ct*Qg[0]-st*Qg[1],st*Qg[0]+ct*Qg[1],Qg[2]];const ce=Math.cos(eps),se=Math.sin(eps);const a=[Qei[0],ce*Qei[1]+se*Qei[2],-se*Qei[1]+ce*Qei[2]];const cl=Math.cos(lambdaSun),sl=Math.sin(lambdaSun);const Qgse=[cl*a[0]+sl*a[1],-sl*a[0]+cl*a[1],a[2]];const xe=Qgse[0],ye=Qgse[1],ze=Qgse[2];const psi=Math.atan2(ye,ze)*R2D;const i_s=7.25*D2R,Omega=75.76*D2R;const delta=Math.atan(Math.tan(i_s)*Math.sin(lambdaSun-Omega))*R2D;return psi+delta}function russellMcPherronFactor(date,byGsm,bzGsm){if(byGsm==null||!Number.isFinite(byGsm))return 1;const beta=rmBeta(date);const sinB=Math.sin(beta*D2R);const projection=byGsm*sinB;const bzMag=Math.abs(bzGsm??0);const marginality=1/(1+bzMag/5);const raw=1-.03*projection*marginality;return Math.min(1.15,Math.max(.9,raw))}var PDYN_NOMINAL_NPA=2;var PDYN_DEG_PER_DOUBLING=.9;var PDYN_SHIFT_MIN=-1;var PDYN_SHIFT_MAX=3;function pressureShiftDegrees(pdynNPa){if(pdynNPa==null||!Number.isFinite(pdynNPa)||pdynNPa<=0)return 0;const shift=PDYN_DEG_PER_DOUBLING*Math.log2(Math.max(pdynNPa,.25)/PDYN_NOMINAL_NPA);return Math.min(PDYN_SHIFT_MAX,Math.max(PDYN_SHIFT_MIN,shift))}function computeOvalBoundary(inputs,bayOnset,now=new Date){const newell60=inputs.newell_avg_60m??0;const newell30=inputs.newell_avg_30m??0;let newell=Math.max(newell60,newell30*.85);newell*=russellMcPherronFactor(now,inputs.by,inputs.bz);let boundary=-(65.5-newell/1800);const pdyn=inputs.avg_30m_pressure_nPa??inputs.dynamic_pressure_nPa??null;boundary+=pressureShiftDegrees(pdyn);boundary=Math.max(boundary,-76);boundary=Math.min(boundary,-44);if(bayOnset)boundary=Math.min(boundary,-47.2);return boundary}var D2R2=Math.PI/180;var R2D2=180/Math.PI;var norm360=deg=>(deg%360+360)%360;function julianCenturies(date){return(date.getTime()/864e5+24405875e-1-2451545)/36525}function obliquity(T){return 23.439291-.0130042*T}function eclipticToEquatorial(lon,lat,T){const eps=obliquity(T)*D2R2;const l=lon*D2R2;const b=lat*D2R2;const ra=Math.atan2(Math.sin(l)*Math.cos(eps)-Math.tan(b)*Math.sin(eps),Math.cos(l))*R2D2;const dec=Math.asin(Math.sin(b)*Math.cos(eps)+Math.cos(b)*Math.sin(eps)*Math.sin(l))*R2D2;return{ra:norm360(ra),dec,eclipticLon:norm360(lon),eclipticLat:lat}}function sunPosition(date){const T=julianCenturies(date);const L0=280.46646+36000.76983*T;const M=(357.52911+35999.05029*T)*D2R2;const C=1.914602*Math.sin(M)+.019993*Math.sin(2*M)+289e-6*Math.sin(3*M);return eclipticToEquatorial(L0+C,0,T)}function moonPosition(date){const T=julianCenturies(date);const Lp=218.316+481267.8813*T;const Mp=(134.963+477198.8676*T)*D2R2;const M=(357.529+35999.0503*T)*D2R2;const D=(297.85+445267.1115*T)*D2R2;const F=(93.272+483202.0175*T)*D2R2;const lon=Lp+6.289*Math.sin(Mp)+1.274*Math.sin(2*D-Mp)+.658*Math.sin(2*D)+.214*Math.sin(2*Mp)-.186*Math.sin(M)-.114*Math.sin(2*F);const lat=5.128*Math.sin(F)+.281*Math.sin(Mp+F)-.278*Math.sin(F-Mp);return eclipticToEquatorial(lon,lat,T)}function greenwichSiderealDegrees(date){const jd=date.getTime()/864e5+24405875e-1;const T=(jd-2451545)/36525;return norm360(280.46061837+360.98564736629*(jd-2451545)+387933e-9*T*T-T*T*T/3871e4)}function altitudeDegrees(position,latitude,longitude,date){const lst=greenwichSiderealDegrees(date)+longitude;const hourAngle=norm360(lst-position.ra)*D2R2;const phi=latitude*D2R2;const dec=position.dec*D2R2;return Math.asin(Math.sin(phi)*Math.sin(dec)+Math.cos(phi)*Math.cos(dec)*Math.cos(hourAngle))*R2D2}function moonPhase(date){const moon=moonPosition(date);const sun=sunPosition(date);const dLon=(moon.eclipticLon-sun.eclipticLon)*D2R2;const lat=moon.eclipticLat*D2R2;const elongation=Math.acos(Math.cos(lat)*Math.cos(dLon))*R2D2;const illumination=(1-Math.cos(elongation*D2R2))/2;const waxing=Math.sin(dLon)>0;let name="Full moon";if(illumination<.04)name="New moon";else if(illumination<.35)name=waxing?"Waxing crescent":"Waning crescent";else if(illumination<.65)name=waxing?"First quarter":"Last quarter";else if(illumination<.96)name=waxing?"Waxing gibbous":"Waning gibbous";return{illumination,elongation,waxing,name}}function skyConditionsAt(atMs,latitude,longitude){const date=new Date(atMs);const sunAlt=altitudeDegrees(sunPosition(date),latitude,longitude,date);const moonAlt=altitudeDegrees(moonPosition(date),latitude,longitude,date);const phase=moonPhase(date);let darkness="dark";if(sunAlt>-.833)darkness="daylight";else if(sunAlt>-6)darkness="civil twilight";else if(sunAlt>-12)darkness="nautical twilight";else if(sunAlt>-18)darkness="astronomical twilight";const twilight=Math.max(0,Math.min(1,(sunAlt+18)/18));const moonHeight=Math.max(0,Math.sin(moonAlt*D2R2));const moonlight=phase.illumination*moonHeight*.55;return{atMs,sunAltitude:sunAlt,moonAltitude:moonAlt,phase,darkness,washout:Math.min(1,twilight+moonlight*(1-twilight)),twilight,moonlight}}var TIER_CAMERA=20;var TIER_PHONE=35;var TIER_EYE=50;function tierForStrength(strength){if(strength>=TIER_EYE)return"eye";if(strength>=TIER_PHONE)return"phone";if(strength>=TIER_CAMERA)return"camera";return"none"}var FULL_MOON_OVERHEAD_COST=30;function visibilityOutlook(strength0to100,sky){const strength=Math.max(0,Math.min(100,strength0to100));const twilight=sky.twilight??0;const moonlight=sky.moonlight??Math.max(0,sky.washout-twilight);const moonCost=FULL_MOON_OVERHEAD_COST*(moonlight/.55);const effective=Math.max(0,(strength-moonCost)*(1-twilight));if(sky.darkness==="daylight"){return{tier:"none",label:"Daylight",effectiveStrength:0,note:"The Sun is up at this point. Nothing is visible however strong the stream is - though a stream lasts days, so look at the following night."}}const tier=tierForStrength(effective);const moonNote=sky.moonAltitude>0&&sky.phase.illumination>.3?` The Moon is up and ${Math.round(sky.phase.illumination*100)}% lit, which is washing out some of it.`:sky.moonAltitude<=0?" The Moon is below the horizon, so the sky is as dark as it gets.":"";const twilightNote=sky.darkness!=="dark"?` Still ${sky.darkness} at this point.`:"";const label=tier==="eye"?effective>=65?"Visible to the naked eye":"A faint glow to the naked eye":tier==="phone"?"Phone camera should catch it":tier==="camera"?"Long exposure only":"Unlikely to be visible";return{tier,label,effectiveStrength:effective,note:`${label}.${moonNote}${twilightNote}`}}var D2R3=Math.PI/180;var R2D3=180/Math.PI;var POLE_LAT=80.65;var POLE_LON=-72.68;function dipoleLatitude(latitude,longitude){const pl=POLE_LAT*D2R3;const sin=Math.sin(latitude*D2R3)*Math.sin(pl)+Math.cos(latitude*D2R3)*Math.cos(pl)*Math.cos((longitude-POLE_LON)*D2R3);return Math.asin(Math.max(-1,Math.min(1,sin)))*R2D3}var G=AACGM_GRID;var LAT_MAX=G.lat0+G.rows-1;var LON_MAX=G.lon0+G.cols-1;var east=lon=>(lon%360+360)%360;function gridAt(latitude,lonEast){const fi=latitude-G.lat0;const fj=lonEast-G.lon0;const i0=Math.max(0,Math.min(G.rows-2,Math.floor(fi)));const j0=Math.max(0,Math.min(G.cols-2,Math.floor(fj)));const ti=Math.max(0,Math.min(1,fi-i0));const tj=Math.max(0,Math.min(1,fj-j0));const v=(i,j)=>G.values[i*G.cols+j];return((v(i0,j0)*(1-ti)+v(i0+1,j0)*ti)*(1-tj)+(v(i0,j0+1)*(1-ti)+v(i0+1,j0+1)*ti)*tj)/100}function magneticLatitude(latitude,longitude){const lonE=east(longitude);const insideLon=lonE>=G.lon0&&lonE<=LON_MAX;if(insideLon&&latitude>=G.lat0&&latitude<=LAT_MAX)return gridAt(latitude,lonE);const edgeLat=Math.max(G.lat0,Math.min(LAT_MAX,latitude));let edgeLon=lonE;let lonOutside=0;if(!insideLon){const below=(G.lon0-lonE+360)%360;const above=(lonE-LON_MAX+360)%360;if(below<above){edgeLon=G.lon0;lonOutside=below}else{edgeLon=LON_MAX;lonOutside=above}}const latOutside=latitude>LAT_MAX?latitude-LAT_MAX:0;const fade=Math.max(0,1-lonOutside/20)*Math.max(0,1-latOutside/20);const correction=gridAt(edgeLat,edgeLon)-dipoleLatitude(edgeLat,edgeLon);return dipoleLatitude(latitude,longitude)+correction*fade}function dipoleLongitude(latitude,longitude){const pl=POLE_LAT*D2R3;const plo=POLE_LON*D2R3;const z=[Math.cos(pl)*Math.cos(plo),Math.cos(pl)*Math.sin(plo),Math.sin(pl)];const yLen=Math.hypot(z[1],z[0]);const y=[-z[1]/yLen,z[0]/yLen,0];const x=[y[1]*z[2]-y[2]*z[1],y[2]*z[0]-y[0]*z[2],y[0]*z[1]-y[1]*z[0]];const p=[Math.cos(latitude*D2R3)*Math.cos(longitude*D2R3),Math.cos(latitude*D2R3)*Math.sin(longitude*D2R3),Math.sin(latitude*D2R3)];const px=p[0]*x[0]+p[1]*x[1]+p[2]*x[2];const py=p[0]*y[0]+p[1]*y[1]+p[2]*y[2];return Math.atan2(py,px)*R2D3}function magneticLocalTime(atMs,latitude,longitude){const date=new Date(atMs);const sun=sunPosition(date);const subsolarLon=sun.ra-greenwichSiderealDegrees(date);const diff=dipoleLongitude(latitude,longitude)-dipoleLongitude(sun.dec,subsolarLon);return((12+diff/15)%24+24)%24}var MLT_OF_WIDEST_OVAL=23.5;var NOON_POLEWARD_SHIFT_DEG=4;function mltPolewardShiftDeg(mlt){const phase=(mlt-MLT_OF_WIDEST_OVAL)/24*2*Math.PI;return NOON_POLEWARD_SHIFT_DEG*(1-Math.cos(phase))/2}function boundaryAtMlt(boundaryMidnight,mlt){return boundaryMidnight-mltPolewardShiftDeg(mlt)}var QUIET_BOUNDARY=-65.5;var STORM_BOUNDARY=-44;function activityFromBoundary(boundaryMidnight){return Math.max(0,Math.min(1,(Math.abs(QUIET_BOUNDARY)-Math.abs(boundaryMidnight))/(Math.abs(QUIET_BOUNDARY)-Math.abs(STORM_BOUNDARY))))}function viewlineReachDeg(boundaryMidnight){return 9+16*activityFromBoundary(boundaryMidnight)}function strengthFromGeometry(boundaryHere,viewerMlat,reachDeg,activity){const peak=75+15*Math.max(0,Math.min(1,activity));const distance=Math.abs(boundaryHere)-Math.abs(viewerMlat);if(distance<=0)return peak+(100-peak)*Math.min(1,-distance/4);if(distance>=reachDeg)return Math.max(0,20*(1-(distance-reachDeg)/2));const inside=1-distance/reachDeg;return 20+(peak-20)*Math.pow(inside,1.5)}function auroraGeometryAt(boundaryMidnight,atMs,latitude,longitude,viewerMlat=magneticLatitude(latitude,longitude)){const mlt=magneticLocalTime(atMs,latitude,longitude);const boundary=boundaryAtMlt(boundaryMidnight,mlt);const reachDeg=viewlineReachDeg(boundaryMidnight);return{mlt,viewerMlat,boundary,viewline:boundary+reachDeg,reachDeg,strength:strengthFromGeometry(boundary,viewerMlat,reachDeg,activityFromBoundary(boundaryMidnight))}}function scoreAtLocation(score,boundaryMidnight,atMs,latitude,longitude){const g=auroraGeometryAt(boundaryMidnight,atMs,latitude,longitude);const beyond=Math.abs(g.boundary)-Math.abs(g.viewerMlat)-g.reachDeg;if(beyond<=0)return score;return score*Math.max(0,1-beyond/2)}var L1_DISTANCE_KM=15e5;var arrivalMs=s=>s.atMs+L1_DISTANCE_KM/s.speedKms*1e3;function mergeL1Series(series){const byTime=new Map;const get=t=>{let s=byTime.get(t);if(!s){s={atMs:t,speedKms:NaN,newell:null,pressureNPa:null,by:null,bz:null};byTime.set(t,s)}return s};for(const p of series.speed)if(p.y>0)get(p.x).speedKms=p.y;for(const p of series.newell??[])if(Number.isFinite(p.y))get(p.x).newell=p.y;for(const p of series.pressure??[])if(Number.isFinite(p.y))get(p.x).pressureNPa=p.y;for(const p of series.magnetic??[]){const s=get(p.time);if(p.by!=null&&Number.isFinite(p.by))s.by=p.by;if(p.bz!=null&&Number.isFinite(p.bz))s.bz=p.bz}const out=[...byTime.values()].sort((a,b)=>a.atMs-b.atMs);let lastSpeed=NaN;for(const s of out){if(Number.isFinite(s.speedKms))lastSpeed=s.speedKms;else s.speedKms=lastSpeed}return out.filter(s=>Number.isFinite(s.speedKms)&&s.speedKms>0)}var mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;function windAtEarth(samples,atMs){const arrived=samples.map(s=>({s,t:arrivalMs(s)}));const in60=arrived.filter(a=>a.t>atMs-36e5&&a.t<=atMs);const in30=in60.filter(a=>a.t>atMs-18e5);const newell30=mean(in30.map(a=>a.s.newell).filter(v=>v!=null));if(newell30==null)return null;const newell60=mean(in60.map(a=>a.s.newell).filter(v=>v!=null))??newell30;const newestArrival=arrived.reduce((m,a)=>Math.max(m,a.t),-Infinity);const span=newestArrival-(atMs-18e5);const latest=in30.reduce((a,b)=>b.t>a.t?b:a);return{newell60,newell30,pressure30:mean(in30.map(a=>a.s.pressureNPa).filter(v=>v!=null)),by30:mean(in30.map(a=>a.s.by).filter(v=>v!=null)),bz:latest.s.bz,coverage:Math.max(0,Math.min(1,span/18e5))}}function realWindBoundary(samples,atMs,bayOnset=false){const wind=windAtEarth(samples,atMs);if(!wind)return null;const boundary=computeOvalBoundary({newell_avg_60m:wind.newell60,newell_avg_30m:wind.newell30,avg_30m_pressure_nPa:wind.pressure30,by:wind.by30,bz:wind.bz},bayOnset,new Date(atMs));return{boundary,wind}}return __toCommonJS(visibility_entry_exports);})();
// </generated:visibility>

// Magnetic latitude in corrected geomagnetic coordinates (AACGM), from the
// generated block above - the same function the app's forecast cards use.
function geoToGmag(latDeg, lonDeg) {
  return AuroraVisibility.magneticLatitude(latDeg, lonDeg);
}

// ── Oval boundary physics: the app's utils/ovalPhysics.ts, via the generated block ──

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

function ovalBoundary(substormData, latestBy = null, /** @type {any} */ fallback = null) {
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

  const bayOnset = substormData?.current?.bay_onset_flag ?? false;
  return AuroraVisibility.computeOvalBoundary({
    newell_avg_60m: Number(newell60) || 0,
    newell_avg_30m: Number(newell30) || 0,
    avg_30m_pressure_nPa: pdyn,
    by: latestBy,
    bz: bzForRm,
  }, bayOnset, new Date());
}

/**
 * The oval from the real solar wind, as the app's Now slot has it: every L1
 * reading moved forward by its own travel time to Earth, and the hour that
 * has arrived. Null when there is no RTSW series to work from.
 */
function realWindOvalBoundary(magPoints, plasmaPoints, bayOnset, atMs) {
  if (!magPoints?.length || !plasmaPoints?.length) return null;
  const samples = AuroraVisibility.mergeL1Series({
    speed: plasmaPoints.filter(p => Number.isFinite(p.speed)).map(p => ({ x: p.ts, y: p.speed })),
    newell: buildNewellSeries(magPoints, plasmaPoints),
    pressure: plasmaPoints.filter(p => Number.isFinite(p.pressure)).map(p => ({ x: p.ts, y: p.pressure })),
    magnetic: magPoints.map(m => ({ time: m.ts, by: m.by, bz: m.bz })),
  });
  return AuroraVisibility.realWindBoundary(samples, atMs, bayOnset)?.boundary ?? null;
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

/**
 * The tier somebody at (lat, lon) reaches, from the shared model: their
 * corrected magnetic latitude, the oval at their magnetic local time, the
 * viewline for this much activity, and their own sky - the Moon where it
 * actually is for them, and twilight. Null below a long exposure.
 */
function visibilityTierFor(boundary, atMs, lat, lon) {
  const strength = AuroraVisibility.auroraGeometryAt(boundary, atMs, lat, lon).strength;
  const sky = AuroraVisibility.skyConditionsAt(atMs, lat, lon);
  const tier = AuroraVisibility.visibilityOutlook(strength, sky).tier;
  return /** @type {Record<string, string|null>} */ ({ camera: 'dslr', phone: 'phone', eye: 'naked', none: null })[tier] ?? null;
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
    /** @type {any} */
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

    const latestBy = avgBy30m(magPoints);
    const atMs     = Date.now();
    const bayOnsetNow = substormData?.current?.bay_onset_flag ?? false;
    const fromWind = realWindOvalBoundary(magPoints, plasmaPoints, bayOnsetNow, atMs);
    const boundary = fromWind ?? ovalBoundary(substormData, latestBy, fallback);
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

    // Queued, for the same reason as the nightly outlook. Everything that
    // decides whether a given person hears about it - their location, which
    // tier they reach, whether that is an escalation on last time, their opt
    // in and their two hour cooldown - happens per subscriber in the shard
    // worker, exactly as it did in this loop.
    const statsLine = `Bz ${Number(bz).toFixed(1)} nT \u00b7 Speed ${Math.round(speed)} km/s`;
    const jobId = await enqueueDelivery(env, {
      kind: 'visibility', topic: 'visibility', payload: null,
      params: { boundary, atMs, statsLine },
    });
    note('visibility', 'queued',
      `boundary ${boundary.toFixed(1)} (${fromWind != null ? 'L1 wind at Earth' : usingFallback ? 'RTSW fallback' : 'substorm worker'}), job ${jobId}`);
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
         name === DISPATCH_ERROR_KEY ||
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
  'flare-X5', 'flare-X10', 'cme-earth-directed',
  'shock-ff', 'flare-peak', 'shock-sf',
  'shock-fr', 'shock-sr',
  // announcements
  'admin-broadcast',
  // no group - live but not shown in the app
  'flare-event', 'substorm-forecast', 'shock-imf',
];

// What a subscriber gets for a topic they have never been asked about. This
// has to match the app's own defaults: the settings screen shows a topic the
// user has never touched as on if it is in here, so storing false would mean
// the switch says one thing and the worker does another.
const TOPIC_DEFAULT_ON = new Set([
  'visibility-dslr', 'visibility-phone', 'visibility-naked',
  'overnight-watch', 'flare-M1', 'flare-M5',
  'flare-X1', 'flare-X5', 'flare-X10',
  'cme-earth-directed', 'shock-ff', 'admin-broadcast',
  'flare-event', 'flare-peak', 'substorm-forecast',
]);

// The icon a notification shows, by topic. Sent with the payload rather than
// looked up on the device, so changing one here changes it everywhere without
// anyone having to edit the service worker's own copy to match.
const TOPIC_ICONS = {
  'visibility-dslr': '/icons/icon-visibility-dslr.png',
  'visibility-phone': '/icons/icon-visibility-phone.png',
  'visibility-naked': '/icons/icon-visibility-naked.png',
  'overnight-watch': '/icons/icon-overnight-watch.png',
  'flare-M1': '/icons/icon-flare-event.png',
  'flare-M5': '/icons/icon-flare-event.png',
  'flare-X1': '/icons/icon-flare-event.png',
  'flare-X5': '/icons/icon-flare-event.png',
  'flare-X10': '/icons/icon-flare-event.png',
  'cme-earth-directed': '/icons/icon-cme-sheath.png',
  'shock-ff': '/icons/icon-shock-detection.png',
  'admin-broadcast': '/icons/icon-default.png',
  'flare-event': '/icons/icon-flare-event.png',
  'flare-peak': '/icons/icon-flare-peak.png',
  'substorm-forecast': '/icons/icon-substorm.png',
  'shock-imf': '/icons/icon-shock-detection.png',
  'shock-sf': '/icons/icon-shock-detection.png',
  'shock-fr': '/icons/icon-shock-detection.png',
  'shock-sr': '/icons/icon-shock-detection.png',
};
const DEFAULT_ICON = '/icons/icon-default.png';

// The small status-bar icon. Android masks it to a silhouette and ignores
// colour, so it is the app mark for every topic unless one overrides it, and
// it has to be white-on-transparent or it renders as a solid blob.
const DEFAULT_BADGE = '/icons/icon-badge.png';
const TOPIC_BADGES = {
  'visibility-dslr': '/icons/icon-badge-dslr.png',
  'visibility-phone': '/icons/icon-badge-phone.png',
  'visibility-naked': '/icons/icon-badge-naked.png',
  'overnight-watch': '/icons/icon-badge-moon.png',
  'flare-M1': '/icons/icon-badge-flare.png',
  'flare-M5': '/icons/icon-badge-flare.png',
  'flare-X1': '/icons/icon-badge-flare.png',
  'flare-X5': '/icons/icon-badge-flare.png',
  'flare-X10': '/icons/icon-badge-flare.png',
  'cme-earth-directed': '/icons/icon-badge-shock.png',
  'shock-ff': '/icons/icon-badge-shock.png',
  'flare-event': '/icons/icon-badge-flare.png',
  'flare-peak': '/icons/icon-badge-flare.png',
  'substorm-forecast': '/icons/icon-badge-shock.png',
  'shock-imf': '/icons/icon-badge-shock.png',
  'shock-sf': '/icons/icon-badge-shock.png',
  'shock-fr': '/icons/icon-badge-shock.png',
  'shock-sr': '/icons/icon-badge-shock.png',
};
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

// 3: fills in cme-earth-directed for everyone who subscribed before it
//    existed. A new default-on topic reaches nobody until this runs, because
//    the send requires preferences[topic] === true and their record has no
//    such key at all. The pass only ever fills keys that are undefined, so it
//    cannot overwrite a choice somebody made.
const MIGRATION_VERSION = 3;
const MIGRATION_KEY = 'MIGRATION';
const migrationShardKey = (ch) => `MIGSHARD_${ch}`;

/**
 * Bring one shard's subscribers up to date.
 * Returns how many records it changed.
 */
async function runMigrationShard(env, ch) {
  // Same ceiling as everywhere else: a read for every subscriber in the shard,
  // plus a write for each one that changes, is more than one invocation can
  // do. Pick up where the last one stopped.
  const prior = await kv(env).get(migrationShardKey(ch), 'json');
  const resuming = prior?.version === MIGRATION_VERSION && prior.state === 'running';

  let changedCount = resuming ? prior.changed : 0;
  let seen         = resuming ? prior.seen    : 0;
  let errors       = resuming ? prior.errors  : 0;
  let cursor  = resuming ? (prior.cursor ?? undefined) : undefined;
  let lastKey = resuming ? (prior.lastKey ?? null) : null;
  let ops = OP_BUDGET;
  let complete = false;

  outer:
  do {
    const res = await kv(env).list({ prefix: ch, cursor, limit: LIST_PAGE });
    ops--;
    for (const key of res.keys) {
      if (lastKey && key.name <= lastKey) continue;
      if (isReservedKey(key.name)) continue;
      // A read, and possibly a write. Leave room for both.
      if (ops < 3) break outer;
      try {
        const stored = await kv(env).get(key.name, 'json');
        ops--;
        lastKey = key.name;
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
          ops--;
          changedCount++;
        }
      } catch (e) {
        errors++;
        console.error('[migrate] error on', key.name, e.message);
      }
    }
    if (res.list_complete) { complete = true; break; }
    cursor = res.cursor;
    lastKey = null;
  } while (ops > 3);

  // maybeRunMigration only treats a shard as reported once it says 'done', so
  // a shard that ran out of budget is picked up again rather than counted as
  // finished with a fraction of its subscribers migrated.
  const state = complete ? 'done' : 'running';
  await kv(env).put(migrationShardKey(ch), JSON.stringify({
    version: MIGRATION_VERSION, state,
    cursor: complete ? null : (cursor ?? null),
    lastKey: complete ? null : lastKey,
    seen, changed: changedCount, errors, at: Date.now(),
  }));

  if (!complete) {
    if (await canSelfCall(env)) {
      keepAlive(env, selfFetch(env, '/run-migration-shard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: env.TRIGGER_SECRET, shard: ch }),
      }).catch(e => console.error(`[migrate] resume ${ch} failed:`, e.message)));
    }
    console.log(`[migrate] shard ${ch}: ${changedCount} of ${seen} so far, continuing`);
  } else {
    console.log(`[migrate] shard ${ch}: done, ${changedCount} of ${seen} updated, ${errors} error(s)`);
  }
  return { seen, changed: changedCount, errors, state };
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

  if (!(await canSelfCall(env))) {
    note('migrate', 'skipped', 'the worker cannot call itself - add the SELF service binding');
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
    if (done?.version !== MIGRATION_VERSION || done.state !== 'done') due.push(ch);
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
    keepAlive(env, selfFetch(env, '/run-migration-shard', {
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
    if (s?.version !== MIGRATION_VERSION || s.state !== 'done') continue;
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
    const { secret, title, body, url, dryRun = false, site = null } = await request.json();
    const validSecrets = [env.TRIGGER_SECRET, env.BANNER_AUTH_TOKEN].filter(Boolean);
    if (!secret || !validSecrets.includes(secret)) return json({ error: 'Unauthorized' }, 401);
    if (!title || !body) return json({ error: 'title and body are required' }, 400);
    const siteFilter = siteFilterFrom(site);
    if (siteFilter === undefined) {
      return json({ error: `unknown site '${site}'`, sites: ['all', 'prod', 'dev'] }, 400);
    }
    const topic = 'admin-broadcast';
    const payload = { title, body, tag: topic, data: { url: url || '/', category: topic }, ts: Date.now() };
    // A dry run must not leave a trace that looks like a real alert went out.
    if (!dryRun) {
      await kv(env).put(`LATEST_ALERT_${topic}`, JSON.stringify(payload), { expirationTtl: 86400 });
    }
    // Delivery is now a job rather than a single pass, so this returns
    // immediately with an id. Watch it with /job?id=...&secret=...
    const jobId = await enqueueDelivery(env, { kind: 'topic', topic, payload, dryRun: !!dryRun, site: siteFilter });
    return json({
      success: true, queued: true, dryRun, jobId, watch: `/job?id=${jobId}`,
      site: siteFilter ?? 'all',
      note: dryRun
        ? 'DRY RUN - walks every subscriber and counts who would receive this. No notification is sent.'
        : 'Live send. Watch /job for progress.',
    });
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
    // This record is being written anyway, so backfill the origin for anyone
    // who subscribed before it was recorded.
    stampOrigin(stored, request);
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
    const { subscription, preferences, timezone, latitude, longitude, overnight_mode, cme_speed_min } = await request.json();
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
      // The speed floor for Earth-directed CME alerts. Kept beside
      // overnight_mode rather than in preferences, because it is a number the
      // subscriber chose, not an on/off switch.
      cme_speed_min: cme_speed_min != null
        ? Math.min(CME_SPEED_FLOOR_MAX, Math.max(CME_SPEED_FLOOR_MIN, Math.round(Number(cme_speed_min)) || CME_SPEED_FLOOR_DEFAULT))
        : (existing.cme_speed_min ?? CME_SPEED_FLOOR_DEFAULT),
      // Additive. Lets the census report how many subscriptions are still
      // being refreshed by a live app rather than just how many rows exist.
      lastSeenAt: Date.now(),
    };
    // Which front end this subscription belongs to. Set here because this is
    // the one endpoint every subscriber passes through when they opt in.
    const { origin, site } = siteOf(request);
    if (origin && site !== 'unknown') { record.origin = origin; record.site = site; }
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
    // Defaults to the site the request came from, so triggering a test with
    // the dev site open cannot light up live subscribers' phones. Pass
    // ?site=all to mean it.
    const asked = url.searchParams.get('site') ?? siteOf(request).site;
    const siteFilter = siteFilterFrom(asked === 'unknown' ? 'all' : asked);
    if (siteFilter === undefined) {
      return json({ error: `unknown site '${asked}'`, sites: ['all', 'prod', 'dev'] }, 400);
    }
    const snapshot = await buildStatusSnapshot(env);
    const payload  = buildTestPayloadByType(type, url, snapshot);
    const jobId = await enqueueDelivery(env, { kind: 'topic', topic: payload.topic, payload, site: siteFilter });
    return json({
      message: `Test push queued for topic '${payload.topic}'.`,
      site: siteFilter ?? 'all',
      note: siteFilter
        ? `Only ${siteFilter} subscribers will receive this. Pass ?site=all to reach everyone.`
        : 'Every subscriber on both sites will receive this.',
      jobId, watch: `/job?id=${jobId}`,
    });
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
      'shock-ff':  { title: 'CME Has Hit the Satellites!',   summary: 'A fast forward shock has been detected at the L1 satellites.' },
      'shock-sf':  { title: 'Compression Wave Detected',     summary: 'A slow forward shock has arrived at L1.' },
      'shock-fr':  { title: 'CME Trailing Edge Passing',     summary: 'A fast reverse shock detected.' },
      'shock-sr':  { title: 'Trailing Rarefaction Detected', summary: 'A slow reverse shock at L1.' },
      'shock-imf': { title: 'Sudden IMF Shift Detected',     summary: 'A sharp change in the interplanetary magnetic field.' },
    };

    switch (category) {
      case 'overnight-watch': {
        const condition = classifyOvernightConditions({ hp, bt, bz, speed, southMin, trend, auroraScore, moonPct });
        title = `Tonight's aurora outlook: ${condition.label}`;
        body  = condition.buildBody();
        url   = '/?page=forecast';
        break;
      }
      case 'visibility-naked':
        title = 'Aurora, Naked Eye Visible';
        body  = `Aurora should be visible to the naked eye from your location. Head outside and look south.\n\n${statsLine}`;
        url   = '/?page=forecast'; break;
      case 'visibility-phone':
        title = 'Aurora, Phone Camera Visible';
        body  = `Aurora is bright enough for your phone camera. Point it south and try night mode.\n\n${statsLine}`;
        url   = '/?page=forecast'; break;
      case 'visibility-dslr':
        title = 'Aurora, DSLR Camera Visible';
        body  = `Aurora is detectable from your location with a camera on a tripod. Point south and try a long exposure.\n\n${statsLine}`;
        url   = '/?page=forecast'; break;
      case 'flare-event': {
        const cls = latestFlareClass ?? 'M1.0';
        title = `${cls} Solar Flare`;
        body  = `A solar flare peaked at ${cls} at ${formatNzTime(Date.now())}.`;
        url   = '/?page=solar-activity&section=goes-xray-flux-section'; break;
      }
      case 'shock-ff': case 'shock-sf': case 'shock-fr': case 'shock-sr': case 'shock-imf': {
        const info = SHOCK_TEST_LABELS[category];
        const latestP = plasmaPoints.at(-1), prevP = plasmaPoints.at(-2) ?? latestP;
        const latestM = magPoints.at(-1),    prevM = magPoints.at(-2) ?? latestM;
        title = info.title;
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
        title = info.title;
        body  = `${info.summary}\n\n${statsLine}`;
        url   = '/?page=forecast'; break;
      }
      case 'substorm-forecast':
        title = 'Substorm Watch: Energy Building';
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
  // Only a real shard character. An arbitrary prefix here would list and work
  // a slice of the namespace nobody intended, and the migration handler
  // already checks this.
  if (!SHARD_CHARS.includes(shard)) return json({ error: 'bad shard' }, 400);
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

// Corrected geomagnetic latitude, as the app's score adjustment uses.
function geoToGmagLatAdj(latDeg, lonDeg) {
  return AuroraVisibility.magneticLatitude(latDeg, lonDeg);
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
// A Worker gets roughly a thousand subrequests per invocation, and every KV
// read, write and delete counts against that alongside the pushes themselves.
// The old budget only counted sends, so a shard holding 1,250 subscribers
// spent its whole allowance on reads before it had sent anything and threw -
// in the same place, every retry, forever.
//
// Budget the operations instead and stop early with the cursor saved. A shard
// then takes two or three invocations instead of one, which costs nothing: it
// redispatches itself the moment it stops.
const OP_BUDGET = 850;
// Worst case for one subscriber: the record read, a cooldown read inside
// decideForSubscriber, the push, and two writes in onSent.
const OPS_PER_SUBSCRIBER = 6;
const LIST_PAGE = 1000;
// How long a shard may be claimed before the sweep assumes the worker died.
const SHARD_LEASE_MS = 90 * 1000;
// How long the sweep leaves a freshly queued shard alone, so it does not race
// the direct dispatch that is already on its way.
const DISPATCH_GRACE_MS = 75 * 1000;
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
 * @param {{ kind: string, topic?: string|null, payload?: any, params?: any, dryRun?: boolean, site?: string|null }} job
 */
async function enqueueDelivery(env, { kind, topic = null, payload = null, params = null, dryRun = false, site = null }) {
  const id = newJobId();
  const job = {
    id, kind, topic,
    payload: payload ?? null,
    params: params ?? null,
    // null means every subscriber, which is what a real alert wants: someone
    // using the dev site is still waiting for the aurora. Set to 'prod' or
    // 'dev' it narrows the send to one front end, so a test aimed at the dev
    // site cannot reach live subscribers.
    site: site ?? null,
    // A dry run does everything except the push itself: the same sharding, the
    // same walk of every record, the same preference checks. It answers "how
    // many people would this reach" without anybody's phone lighting up, which
    // is the only honest way to rehearse a send to eighty thousand people.
    dryRun: !!dryRun,
    createdAt: Date.now(),
  };
  await kv(env).put(jobKey(id), JSON.stringify(job), { expirationTtl: JOB_TTL_SECONDS });
  await Promise.all(SHARD_CHARS.map(ch => kv(env).put(
    shardKey(id, ch),
    JSON.stringify({
      state: 'pending', cursor: null, sent: 0, failed: 0, attempts: 0, leaseUntil: 0,
      // Hold the sweep off briefly. The direct dispatch below is about to run
      // these; a cron tick landing in the same moment would see them pending
      // and dispatch them too, and two runners on one shard means everybody in
      // it gets the notification twice. The sweep is the backstop for a
      // dispatch that did not happen, so it only needs to care a minute later.
      nextAttemptAt: Date.now() + DISPATCH_GRACE_MS,
    }),
    { expirationTtl: JOB_TTL_SECONDS },
  )));
  console.log(`[outbox] job ${id} queued: kind=${kind} topic=${topic ?? '-'}${site ? ` site=${site}` : ''}${dryRun ? ' (DRY RUN - nothing will be sent)' : ''} across ${SHARD_CHARS.length} shards`);
  await dispatchShards(env, id, SHARD_CHARS);
  return id;
}

/** Fire one invocation per shard. Each gets its own subrequest budget. */
async function dispatchShards(env, jobId, chars) {
  if (!(await canSelfCall(env))) {
    console.error('[outbox] the worker cannot call itself - add the SELF service binding. Shards can only be drained by the cron sweep.');
    return;
  }
  for (const ch of chars) {
    keepAlive(env, selfFetch(env, '/run-shard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.TRIGGER_SECRET, jobId, shard: ch }),
    }).then(async (r) => {
      // A dispatch that is refused used to vanish into a log line. Record the
      // first failure so /job can say why nothing is running, rather than
      // showing 64 pending shards and no reason.
      if (!r.ok) await noteDispatchFailure(env, `${r.status} ${r.statusText}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
    }).catch(e => noteDispatchFailure(env, `fetch threw: ${e.message}`)));
  }
}

const DISPATCH_ERROR_KEY = 'LAST_DISPATCH_ERROR';

async function noteDispatchFailure(env, detail) {
  console.error('[outbox] dispatch failed:', detail);
  try {
    await kv(env).put(DISPATCH_ERROR_KEY, JSON.stringify({ at: nzTimestamp(Date.now()), detail }),
                      { expirationTtl: 86400 });
  } catch { /* a diagnostic is never worth failing over */ }
}

/**
 * GET /diagnose?secret=...
 *
 * Can this worker reach itself? Everything fans out by the worker calling its
 * own /run-shard, so if that is refused nothing is ever delivered and the only
 * symptom is sixty-four shards sitting at pending forever - which is exactly
 * what it looks like when SELF_URL is wrong, when the secret does not match,
 * or when the platform declines to let a worker call itself.
 *
 * This makes one real call of each kind and reports what came back.
 */
async function handleDiagnose(request, env) {
  const url = new URL(request.url);
  if (url.searchParams.get('secret') !== env.TRIGGER_SECRET) return new Response('Forbidden', { status: 403 });

  const out = {
    selfBindingPresent: !!env.SELF?.fetch,
    selfUrlConfigured: env.SELF_URL ?? null,
    requestOrigin: new URL(request.url).origin,
    triggerSecretSet: !!env.TRIGGER_SECRET,
    lastDispatchError: await kv(env).get(DISPATCH_ERROR_KEY, 'json'),
  };

  if (!out.selfBindingPresent) {
    out.verdict = 'No SELF service binding. A Worker cannot fetch its own hostname - '
                + 'Cloudflare refuses it with error 1042 and it looks like a 404 - so nothing '
                + 'will ever fan out. Add a service binding named SELF pointing at this worker.';
    return json(out, 200);
  }

  // The endpoint the fan-out actually uses, with the secret it actually sends.
  // A made-up job id should come back as 'gone'; what matters is that the call
  // arrives at all.
  try {
    const r = await selfFetch(env, '/run-shard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.TRIGGER_SECRET, jobId: 'diagnose-no-such-job', shard: 'A' }),
    });
    out.selfRunShard = { status: r.status, body: (await r.text()).slice(0, 300) };
  } catch (e) {
    out.selfRunShard = { error: e.message };
  }

  out.verdict = out.selfRunShard?.status === 200
    ? 'The worker can call itself through the SELF binding. Fan-out should work.'
    : out.selfRunShard?.status === 403
      ? 'The binding works, but /run-shard refused the secret.'
      : out.selfRunShard?.body?.includes('1042')
        ? 'Still error 1042 - the SELF binding is not being used. Check it is named exactly SELF and points at this worker.'
        : 'The binding did not answer normally. See selfRunShard.';
  return json(out, 200);
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
/**
 * Call this worker's own endpoint.
 *
 * A Worker is not allowed to fetch its own hostname. Cloudflare refuses it
 * with error 1042 - "Worker tried to fetch from another Worker on the same
 * zone" - and the refusal looks like an ordinary 404, so the fan-out simply
 * never happened and sixty-four shards sat at pending forever. That is what
 * was wrong: not the budget, not the secret, not SELF_URL, but the assumption
 * that a worker can call itself over the network at all.
 *
 * The supported route is a service binding pointing at this same worker, which
 * goes through Cloudflare's internal dispatch rather than out and back. SELF
 * is that binding. The plain fetch is kept only as a fallback for a local
 * harness, where there is no binding and no restriction.
 */
/** Can this worker reach itself at all? Nothing fans out if it cannot. */
async function canSelfCall(env) {
  return !!env.SELF?.fetch || !!(await resolveSelfUrl(env));
}

async function selfFetch(env, path, init) {
  const origin = await resolveSelfUrl(env);
  const url = new URL(path, origin ?? 'https://worker.invalid');
  if (env.SELF?.fetch) return env.SELF.fetch(new Request(url, init));
  if (!origin) throw new Error('no SELF binding and no self origin');
  return fetch(url, init);
}

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
  // Where we got to inside the current page. KV list cursors only move a page
  // at a time, so without this a shard that ran out of budget mid-page would
  // resume at the top of that page and send to everyone in it a second time.
  let lastKey = shard.lastKey ?? null;
  let sent = shard.sent ?? 0, failed = shard.failed ?? 0;
  let pruned = shard.pruned ?? 0;
  let ops = OP_BUDGET;
  let complete = false;
  let lastError = null;
  // Subscribers whose push failed for a reason worth trying again. A 429 or a
  // 503 used to be counted and forgotten: the shard finished, and those people
  // simply never got the notification.
  let retry = new Set(shard.retry ?? []);

  try {
    // Anyone left over from a previous attempt goes first, so a push service
    // having a bad minute does not cost them the alert entirely.
    if (retry.size) {
      for (const keyName of [...retry]) {
        if (ops < OPS_PER_SUBSCRIBER) break;
        retry.delete(keyName);
        const stored = await kv(env).get(keyName, 'json');
        ops--;
        if (!stored?.subscription) continue;
        const meter = { ops: 0 };
        const decision = await decideForSubscriber(env, job, keyName, stored, meter);
        ops -= meter.ops;
        if (!decision) continue;
        const resp = await sendPushWithPayload(
          stored.subscription, stampSendId(decision.payload, jobId), env);
        ops--;
        if (resp.ok) {
          sent++;
          if (decision.onSent) { await decision.onSent(); ops -= 2; }
        } else if (resp.status === 410 || resp.status === 404) {
          await kv(env).delete(keyName); ops--; pruned++;
        } else if (isRetryablePushStatus(resp.status)) {
          retry.add(keyName);
        } else failed++;
      }
    }

    outer:
    while (ops > 0) {
      const listRes = await kv(env).list({ prefix: ch, cursor, limit: LIST_PAGE });
      ops--;

      for (const key of listRes.keys) {
        // Resuming: skip everything this shard already got through. Keys come
        // back sorted, so a plain comparison is enough.
        if (lastKey && key.name <= lastKey) continue;
        if (isReservedKey(key.name)) continue;

        // Every read, send and delete below is a subrequest, and a Worker only
        // gets about a thousand per invocation. Stopping before the ceiling and
        // picking up where we left off is the difference between a shard that
        // finishes and one that throws in the same place forever.
        if (ops < OPS_PER_SUBSCRIBER) break outer;

        const stored = await kv(env).get(key.name, 'json');
        ops--;
        lastKey = key.name;
        if (!stored?.subscription) continue;

        const meter = { ops: 0 };
        const decision = await decideForSubscriber(env, job, key.name, stored, meter);
        ops -= meter.ops;
        if (!decision) continue;

        // A dry run stops here: counted as reached, nothing sent, and none of
        // the cooldowns or once-a-night markers are written, so a real send
        // straight afterwards behaves exactly as it would have.
        if (job.dryRun) { sent++; continue; }

        const resp = await sendPushWithPayload(
          stored.subscription, stampSendId(decision.payload, jobId), env);
        ops--;
        if (resp.ok) {
          sent++;
          if (decision.onSent) { await decision.onSent(); ops -= 2; }
        } else {
          // A gone subscription is pruned; anything else is left for the next
          // sweep, since a push service returning 500 now may well accept it
          // in a minute.
          if (resp.status === 410 || resp.status === 404) {
            await kv(env).delete(key.name); ops--; pruned++;
          } else if (isRetryablePushStatus(resp.status)) {
            retry.add(key.name);
          } else failed++;
        }
      }

      if (listRes.list_complete) { complete = true; break; }
      // A whole page is behind us, so the page cursor is now the record of
      // progress and the within-page marker resets.
      cursor = listRes.cursor;
      lastKey = null;
    }
  } catch (e) {
    lastError = e.message;
    console.error(`[outbox] shard ${jobId}/${ch} threw:`, e.message);
  }

  const attempts = (shard.attempts ?? 0) + 1;
  // Out of retries: stop holding the shard open and record them as failed, so
  // the ledger says what really happened rather than the job hanging forever.
  if (attempts >= MAX_SHARD_ATTEMPTS && retry.size) {
    console.warn(`[outbox] shard ${jobId}/${ch}: giving up on ${retry.size} subscriber(s) after ${attempts} attempts`);
    failed += retry.size;
    retry = new Set();
  }

  const finished = complete && !lastError && retry.size === 0;
  const next = finished
    ? { state: 'done', cursor: null, lastKey: null, retry: [], sent, failed, pruned, attempts,
        leaseUntil: 0, finishedAt: Date.now() }
    : { state: 'pending', cursor: cursor ?? null, lastKey, retry: [...retry],
        sent, failed, pruned, attempts, leaseUntil: 0,
        // Running out of budget is normal progress, not a failure, so it goes
        // straight back into the queue. A push service that just rejected us
        // gets a moment before we ask again.
        nextAttemptAt: (lastError || retry.size)
          ? Date.now() + shardRetryDelayMs(attempts)
          : 0,
        lastError };

  await kv(env).put(sKey, JSON.stringify(next), { expirationTtl: JOB_TTL_SECONDS });
  console.log(`[outbox] shard ${jobId}/${ch}: ${next.state} sent=${sent} failed=${failed} pruned=${pruned} attempt=${attempts}`);

  // More to do and budget left over means the list was long; keep going in a
  // fresh invocation rather than waiting for the sweep.
  if (next.state === 'pending' && !lastError && !retry.size) {
    keepAlive(env, dispatchShards(env, jobId, [ch]).catch(() => {}));
  }
  return next;
}

/**
 * Decide whether this subscriber gets this job, and with what payload.
 * Returns null to skip. This is where the per-user topics keep their logic.
 */
async function decideForSubscriber(env, job, keyName, stored, meter = { ops: 0 }) {
  const prefs = stored.preferences || {};

  // A site-scoped job skips everyone else outright, before any preference or
  // location check. Records written before the origin was recorded have no
  // site, so they only match a filter that asks for 'unknown' - a narrowed
  // test should reach the devices it names and nobody else.
  if (job.site && (stored.site ?? 'unknown') !== job.site) return null;

  // Counts the KV calls this makes so the shard can budget honestly. A
  // subscriber who is skipped after a cooldown read still costs a subrequest.
  const count = (n = 1) => { meter.ops += n; };

  if (job.kind === 'topic') {
    if (prefs[job.topic] !== true) return null;
    if (job.topic?.startsWith('substorm-') && !isUserInPlausibleZone(stored.location?.latitude)) return null;
    return { payload: job.payload };
  }

  if (job.kind === 'cme') {
    if (prefs['cme-earth-directed'] !== true) return null;
    // The only alert whose threshold belongs to the subscriber rather than to
    // the detector: everyone gets the same CME judged against their own floor.
    if ((job.params?.speed ?? 0) < cmeSpeedFloorOf(stored)) return null;
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
    count();
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

    const prevTier = stored.visibilityTier ?? null;
    // Jobs queued before the shared model shipped carry no atMs; now is close enough.
    const newTier  = visibilityTierFor(p.boundary, p.atMs ?? Date.now(), lat, lon);

    /** @type {Record<string, number>} */
    const tierRank = { dslr: 1, phone: 2, naked: 3 };
    const currentRank = prevTier ? (tierRank[prevTier] ?? 0) : 0;
    const newRank     = newTier  ? (tierRank[newTier]  ?? 0) : 0;

    if (!newTier && prevTier) {
      await kv(env).put(keyName, JSON.stringify({ ...stored, visibilityTier: null }));
      count();
      return null;
    }
    if (newRank <= currentRank) return null;

    /** @type {Record<string, string>} */
    const topicForTier = { dslr: 'visibility-dslr', phone: 'visibility-phone', naked: 'visibility-naked' };
    const topic = newTier ? topicForTier[newTier] : null;
    if (!topic || prefs[topic] !== true) return null;

    const cooldownKey = `COOLDOWN_vis_${newTier}_${keyName}`;
    const lastSent = await kv(env).get(cooldownKey);
    count();
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
    title = 'Aurora, Naked Eye Visible';
    body  = `Aurora should be visible to the naked eye from your location. Head outside and look south.\n\n${statsLine}`;
  } else if (tier === 'phone') {
    title = 'Aurora, Phone Camera Visible';
    body  = `Aurora is bright enough for your phone camera. Point it south and try night mode.\n\n${statsLine}`;
  } else {
    title = 'Aurora, DSLR Camera Visible';
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
  let cursor, jobs = [], revived = 0, stillRunning = 0, exhausted = 0, retired = 0;

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

      // Retire it. The records carry a six hour TTL, and until now the sweep
      // re-read all sixty-four shards of every finished job on every tick for
      // those six hours - hundreds of KV reads a minute buying nothing, out of
      // the same budget the live jobs need.
      await kv(env).delete(jobKey(id));
      for (const ch of SHARD_CHARS) await kv(env).delete(shardKey(id, ch));
      retired++;
    }
  }

  if (jobs.length) {
    note('outbox', revived ? 'resumed' : 'draining',
         `${jobs.length} job(s), ${revived} shard(s) re-dispatched, ${stillRunning} in flight, ` +
         `${exhausted} gave up, ${retired} finished and cleared`);
  }
  return { jobs: jobs.length, revived, stillRunning, exhausted, retired };
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
  // The icon travels with the notification rather than being looked up on the
  // device. The service worker keeps its own copy of this map, and two maps in
  // two repositories that nothing checks is how shock-imf and flare-event went
  // wrong. Sending it means changing an icon in the manifest changes it
  // everywhere. `icon` is where the Notification API expects it; data.icon is
  // a fallback for a service worker that reads it from there.
  const topic = payload.tag ?? data.category;
  const icon  = (topic && TOPIC_ICONS[topic]) || DEFAULT_ICON;
  const badge = (topic && TOPIC_BADGES[topic]) || DEFAULT_BADGE;
  return { ...payload, icon, badge, data: { ...data, icon, badge } };
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

/**
 * GET /dry-run?secret=...&topic=flare-X1
 *
 * Rehearse any category. Walks every subscriber exactly as a real send would,
 * applies the same preference checks, and reports how many people it would
 * reach - without a single notification going out.
 *
 * This is the pre-flight check for "is anyone actually going to get this",
 * answerable before the sun does something rather than after.
 */
async function handleDryRun(request, env) {
  const url = new URL(request.url);
  if (url.searchParams.get('secret') !== env.TRIGGER_SECRET) return new Response('Forbidden', { status: 403 });

  const topic = url.searchParams.get('topic');
  if (!topic) {
    return json({
      error: 'topic is required',
      topics: ALL_TOPICS,
      example: '/dry-run?secret=...&topic=flare-X1',
    }, 400);
  }
  if (!ALL_TOPICS.includes(topic)) {
    return json({ error: `unknown topic '${topic}'`, topics: ALL_TOPICS }, 400);
  }

  const siteFilter = siteFilterFrom(url.searchParams.get('site'));
  if (siteFilter === undefined) {
    return json({ error: 'unknown site', sites: ['all', 'prod', 'dev'] }, 400);
  }

  const jobId = await enqueueDelivery(env, {
    kind: 'topic', topic, dryRun: true, site: siteFilter,
    payload: { title: 'Dry run', body: 'Nobody receives this.', tag: topic, data: { url: '/' } },
  });

  return json({
    dryRun: true, topic, jobId, site: siteFilter ?? 'all',
    watch: `/job?id=${jobId}&secret=...`,
    note: 'Walking every subscriber now. Nothing is sent. Read /job in a few '
        + 'seconds - "sent" is how many people a real alert on this topic would reach.',
  });
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
  if (!(await canSelfCall(env))) {
    console.warn('[census] the worker cannot call itself - add the SELF service binding.');
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
    keepAlive(env, selfFetch(env, '/run-census-shard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.TRIGGER_SECRET, censusId, shard: ch }),
    }).catch(e => console.error(`[census] dispatch ${ch} failed:`, e.message)));
  }
}

async function runCensusShard(env, censusId, ch) {
  // Resume whatever this shard already counted for this census. Walking a
  // shard takes more than one invocation at any real subscriber count - the
  // same subrequest ceiling the delivery shard has to respect - so the totals
  // live on the shard record and accumulate.
  const prior = await kv(env).get(statsShardKey(ch), 'json');
  const resuming = prior?.censusId === censusId && prior.state === 'counting';

  const counts = resuming ? { ...prior.counts } : {};
  for (const t of ALL_TOPICS) counts[t] ??= 0;
  let subscribers = resuming ? prior.subscribers : 0;
  let withGps     = resuming ? prior.withGps     : 0;
  let active      = resuming ? prior.active      : 0;
  let anyTopic    = resuming ? prior.anyTopic    : 0;
  // Records that are not reserved keys but that nothing can deliver to. Four
  // places in this worker skip these silently, so without counting them here a
  // subscriber whose record has an unexpected shape would simply never receive
  // anything and nothing would ever say so.
  let unreadable = resuming ? prior.unreadable : 0;
  const unreadableShapes = resuming ? { ...prior.unreadableShapes } : {};
  const overnightModes = resuming ? { ...prior.overnightModes } : {};
  // The CME speed floors people chose. Worth knowing before tuning the alert:
  // if everyone sits on the default, the choice is not being used.
  const cmeSpeedFloors = resuming ? { ...prior.cmeSpeedFloors } : {};
  const services = resuming ? { ...prior.services } : {};
  // Which front end each subscription came from, both as a category and as the
  // literal origin. The origin is the one that answers "how many on the live
  // site, how many on the dev one" without anybody having to remember which
  // hostname is which.
  const sites = resuming ? { ...prior.sites } : {};
  const origins = resuming ? { ...prior.origins } : {};
  const activeCutoff = Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  let cursor = resuming ? (prior.cursor ?? undefined) : undefined;
  let lastKey = resuming ? (prior.lastKey ?? null) : null;
  let ops = OP_BUDGET;
  let complete = false;

  outer:
  do {
    const res = await kv(env).list({ prefix: ch, cursor, limit: LIST_PAGE });
    ops--;
    for (const key of res.keys) {
      // Skip what a previous invocation of this shard already counted. The
      // page cursor only moves a page at a time, so without this a resumed
      // shard would count the rest of its page twice.
      if (lastKey && key.name <= lastKey) continue;
      if (isReservedKey(key.name)) continue;
      // One read per subscriber, and a Worker gets about a thousand
      // subrequests. Stop short and come back rather than throwing here -
      // which is what used to happen, leaving the census permanently
      // unfinished and STATS never written.
      if (ops < 2) break outer;

      const stored = await kv(env).get(key.name, 'json');
      ops--;
      lastKey = key.name;

      if (!stored?.subscription?.endpoint || !stored?.subscription?.keys?.p256dh) {
        unreadable++;
        // The field names present, not the values - enough to recognise an old
        // record shape without putting anyone's data in a stats key.
        const shape = stored && typeof stored === 'object'
          ? Object.keys(stored).sort().join(',').slice(0, 80) || '(empty object)'
          : `(${stored === null ? 'unparseable' : typeof stored})`;
        unreadableShapes[shape] = (unreadableShapes[shape] ?? 0) + 1;
        continue;
      }
      subscribers++;

      if (isFinite(parseFloat(stored.location?.latitude))) withGps++;
      const seen = Number(stored.lastSeenAt ?? stored.location?.locationUpdatedAt ?? 0);
      if (seen >= activeCutoff) active++;

      const mode = stored.overnight_mode || 'phone';
      overnightModes[mode] = (overnightModes[mode] ?? 0) + 1;

      const floor = cmeSpeedFloorOf(stored);
      cmeSpeedFloors[floor] = (cmeSpeedFloors[floor] ?? 0) + 1;

      // Which push service this device uses. Worth having because failures
      // cluster by platform - if a send goes badly, this says whose.
      const svc = pushServiceOf(stored.subscription?.endpoint);
      services[svc] = (services[svc] ?? 0) + 1;

      // 'unknown' is a record written before the origin was recorded, not a
      // record that came from nowhere. It shrinks as people reopen the app.
      const site = stored.site ?? 'unknown';
      sites[site] = (sites[site] ?? 0) + 1;
      const origin = stored.origin ?? '(recorded before origins were tracked)';
      origins[origin] = (origins[origin] ?? 0) + 1;

      let on = 0;
      for (const t of ALL_TOPICS) if (stored?.preferences?.[t] === true) { counts[t]++; on++; }
      if (on > 0) anyTopic++;
    }
    if (res.list_complete) { complete = true; break; }
    // A whole page is behind us, so the page cursor is the record of progress
    // and the within-page marker resets.
    cursor = res.cursor;
    lastKey = null;
  } while (ops > 2);

  // 'counting' means there is more of this shard to walk. tryFinishCensus only
  // counts a shard once it says 'done', so a partial pass can no longer be
  // mistaken for a finished one.
  const state = complete ? 'done' : 'counting';
  await kv(env).put(statsShardKey(ch), JSON.stringify({
    censusId, shard: ch, state, cursor: complete ? null : (cursor ?? null),
    lastKey: complete ? null : lastKey,
    subscribers, withGps, active, anyTopic, counts, overnightModes, services,
    sites, origins, cmeSpeedFloors,
    unreadable, unreadableShapes, at: Date.now(),
  }), { expirationTtl: CENSUS_SHARD_TTL });

  if (!complete) {
    // Out of budget, not out of subscribers. Come straight back.
    if (await canSelfCall(env)) {
      keepAlive(env, selfFetch(env, '/run-census-shard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: env.TRIGGER_SECRET, censusId, shard: ch }),
      }).catch(e => console.error(`[census] resume ${ch} failed:`, e.message)));
    }
    console.log(`[census] shard ${ch}: ${subscribers} counted so far, continuing`);
    return { shard: ch, subscribers, state };
  }

  console.log(`[census] shard ${ch}: done, ${subscribers} subscribers`);
  // Whoever finishes last does the roll-up.
  await tryFinishCensus(env, censusId);
  return { shard: ch, subscribers, state };
}

async function tryFinishCensus(env, censusId) {
  const parts = [];
  for (const ch of SHARD_CHARS) {
    const p = await kv(env).get(statsShardKey(ch), 'json');
    // A shard still counting is not a shard that has reported.
    if (!p || p.censusId !== censusId || p.state !== 'done') return false;
    parts.push(p);
  }

  const counts = {};
  for (const t of ALL_TOPICS) counts[t] = 0;
  let subscribers = 0, withGps = 0, active = 0, anyTopic = 0, unreadable = 0;
  const overnightModes = {};
  const services = {};
  const cmeSpeedFloors = {};
  const sites = {};
  const origins = {};
  const unreadableShapes = {};
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
    for (const [floor, n] of Object.entries(p.cmeSpeedFloors ?? {})) {
      cmeSpeedFloors[floor] = (cmeSpeedFloors[floor] ?? 0) + n;
    }
    for (const [site, n] of Object.entries(p.sites ?? {})) {
      sites[site] = (sites[site] ?? 0) + n;
    }
    for (const [origin, n] of Object.entries(p.origins ?? {})) {
      origins[origin] = (origins[origin] ?? 0) + n;
    }
    unreadable += p.unreadable ?? 0;
    for (const [shape, n] of Object.entries(p.unreadableShapes ?? {})) {
      unreadableShapes[shape] = (unreadableShapes[shape] ?? 0) + n;
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
    // Keyed by km/s. Sorted numerically rather than by count, so it reads as a
    // distribution.
    cmeSpeedFloors: Object.fromEntries(
      Object.entries(cmeSpeedFloors).sort((a, b) => Number(a[0]) - Number(b[0]))),
    byPushService: Object.fromEntries(Object.entries(services).sort((a, b) => b[1] - a[1])),
    // Which site each subscription was created on. A push subscription belongs
    // to the origin that made it, so the same person on both sites is two rows
    // here and receives an alert on both - that is the browser's model, not a
    // double-count bug.
    bySite: Object.fromEntries(Object.entries(sites).sort((a, b) => b[1] - a[1])),
    byOrigin: Object.fromEntries(Object.entries(origins).sort((a, b) => b[1] - a[1])),
    // Should be zero. Anything here is somebody who can never be sent to,
    // and the shape says what is wrong with their record.
    undeliverable: unreadable,
    undeliverableShapes: unreadable ? unreadableShapes : undefined,
    recentSends: await recentSendSummary(env),
    note: 'Counted by walking every subscriber record. Refreshed about once an hour. '
        + 'subscribers counts saved push subscriptions; some belong to devices that have '
        + 'since uninstalled - those are pruned when a send to them comes back 410.',
    originsNote: 'byOrigin is the site each subscription was created on. Anyone who '
        + 'subscribed before origins were tracked shows as "(recorded before origins '
        + 'were tracked)" until they next open the app, save a preference or share '
        + 'their location.',
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

// Web push caps the encrypted payload at 4096 bytes. aes128gcm adds a record
// header and a 16 byte tag, so keep the plaintext clear of the ceiling - going
// over earns a 413 that looks like any other failure.
const MAX_PUSH_PAYLOAD_BYTES = 3800;

/**
 * Is this push worth trying again?
 *
 * 429 is the push service asking us to slow down and 5xx is it having a
 * problem - both mean "later", not "never". 400 and 403 mean the request or
 * our VAPID key is wrong, which will be just as wrong next time; 404 and 410
 * mean the subscription is gone and are handled separately by pruning it.
 */
function isRetryablePushStatus(status) {
  return status === 429 || status === 408 || (status >= 500 && status <= 599);
}

async function sendPushWithPayload(subscription, payload, env) {
  try {
    const aud      = new URL(subscription.endpoint).origin;
    const vapidJWT = await getVapidJWT(aud, env);
    const json     = fitPushPayload(payload);
    const { body } = await encryptWebPushPayload(subscription, json);

    // Awaited on purpose. Returning the promise let a network-level rejection
    // escape this try/catch, and the caller then threw on resp.ok - which
    // aborted the rest of that shard's run over one unreachable endpoint.
    return await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'TTL': '86400',
        'Authorization': `vapid t=${vapidJWT}, k=${env.VAPID_PUBLIC_KEY}`,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
      },
      body,
    });
  } catch (err) {
    // 500 rather than a throw, so one broken subscription costs one send
    // instead of everyone after it in the shard. Retryable, so the shard will
    // come back to it.
    console.error('[push] send failed for one subscriber:', err.message);
    return new Response(null, { status: 500, statusText: err.message });
  }
}

/**
 * Keep a notification under the 4KB ceiling.
 *
 * Truncating the body is worse than the full text and much better than the
 * silent 413 that used to happen instead, which was indistinguishable from a
 * push service having a bad minute.
 */
function fitPushPayload(payload) {
  const enc = new TextEncoder();
  let json = JSON.stringify(payload);
  if (enc.encode(json).length <= MAX_PUSH_PAYLOAD_BYTES) return json;

  const trimmed = { ...payload };
  let body = String(trimmed.body ?? '');
  while (body.length > 40 && enc.encode(JSON.stringify({ ...trimmed, body })).length > MAX_PUSH_PAYLOAD_BYTES) {
    body = body.slice(0, Math.floor(body.length * 0.9));
  }
  trimmed.body = body.trimEnd() + '\u2026';
  json = JSON.stringify(trimmed);
  console.warn(`[push] payload for ${payload.tag} was over ${MAX_PUSH_PAYLOAD_BYTES} bytes and was truncated`);
  return json;
}

/**
 * VAPID tokens, cached per push service.
 *
 * The token depends only on the audience - the push service origin, of which
 * there are about three - and is good for hours. Signing one per subscriber
 * meant an ECDSA key import and signature for every single send: at 80,000
 * that is 80,000 of each, for three distinct results.
 */
const vapidTokens = new Map();
const VAPID_TTL_SECONDS = 6 * 3600;

async function getVapidJWT(audience, env) {
  const hit = vapidTokens.get(audience);
  // Re-sign well before expiry; a token that lapses mid-send is a 401 for
  // everyone left in the shard.
  if (hit && hit.expiresAt - Date.now() > 30 * 60 * 1000) return hit.token;

  const token = await createVapidJWT(audience, env);
  vapidTokens.set(audience, { token, expiresAt: Date.now() + VAPID_TTL_SECONDS * 1000 });
  return token;
}

async function createVapidJWT(audience, env) {
  const header  = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud: audience, exp: Math.floor(Date.now() / 1000) + VAPID_TTL_SECONDS, sub: env.VAPID_SUBJECT };
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

function concatBytes(/** @type {Uint8Array[]} */ ...arrays) {
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
