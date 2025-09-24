/**
 * REQUIRED ENV VARS (Workers > Settings > Variables):
 * - TRIGGER_SECRET
 * - VAPID_PUBLIC_KEY
 * - VAPID_PRIVATE_KEY
 * - VAPID_SUBJECT
 * - FORECAST_SERVICE             // service binding
 *
 * OPTIONAL:
 * - SELF_URL
 * - SENTRY_DSN
 */

// --- API Endpoints ---
const NOAA_XRAY_URL = 'https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json';
const DONKI_GST_URL = 'https://nasa-donki-api.thenamesrock.workers.dev/GST';
// --- NEW: Added NOAA plasma and mag URLs ---
const NOAA_PLASMA_URL = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json';
const NOAA_MAG_URL = 'https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json';


// --- Constants ---
const BATCH_SIZE = 40;
const MAX_CHAIN = 50;
const HEALTH_CHECK_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const GREYMOUTH_LATITUDE = -42.45;

// --- KV Namespace Helper ---
const kv = (env) => env.SUBSCRIPTIONS_KV;

// --- Error Reporting Placeholder ---
function reportError(error, env, extra = {}) {
  console.error("Caught exception:", error, extra);
}

// --- Robust Fetch Helper ---
async function fetchWithRetry(url, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, { cf: { cacheTtl: 30, cacheEverything: false } });
      if (response.ok) return response;
      console.error(`Fetch attempt ${i + 1} for ${url} failed with status: ${response.status}`);
    } catch (error) {
      console.error(`Fetch attempt ${i + 1} for ${url} failed with error:`, error);
    }
    if (i < retries - 1) await sleep(delay * (i + 1));
  }
  return null;
}

// --- Main Export ---
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return handleOptions();
    if (url.pathname === '/save-subscription' && request.method === 'POST') return handleSaveSubscription(request, env);
    if (url.pathname === '/status' && request.method === 'GET') return handleGetStatus(request, env);
    if (url.pathname === '/trigger-test-push' && request.method === 'GET') return handleTriggerTestPush(request, env);
    if (url.pathname === '/trigger-test-push-for-me' && request.method === 'POST') return handleTriggerSelfTest(request, env);
    if (url.pathname === '/broadcast-batch' && request.method === 'POST') return handleBroadcastBatch(request, env);
    if (url.pathname === '/health') return handleHealthCheck(env);
    return new Response('Not found', { status: 404 });
  },
  async scheduled(_evt, env, ctx) {
    ctx.waitUntil(
      runScheduledTasks(env).catch(err => reportError(err, env))
    );
  },
};

// --- Scheduled Task Logic ---
async function runScheduledTasks(env) {
  const thresholds = await kv(env).get('CONFIG_THRESHOLDS', 'json');
  if (!thresholds) {
    console.error("CRITICAL: Notification thresholds not found in KV.");
    return;
  }
  const forecastData = await getFullForecastData(env);
  if (!forecastData) {
    console.warn("Could not retrieve forecast data. Skipping aurora and substorm checks.");
  }
  await Promise.allSettled([
    checkAuroraAndSubstorm(env, thresholds, forecastData),
    checkXrayFlux(env, thresholds),
    checkIPS(env, thresholds.ips),
  ]);
  await kv(env).put('LAST_SUCCESSFUL_RUN_TIMESTAMP', Date.now().toString());
  console.log("Scheduled tasks completed successfully.");
}

// --- MODIFIED: Function to check for new Interplanetary Shocks and include solar wind data ---
async function checkIPS(env, ipsThresholds) {
    if (!ipsThresholds) {
        console.warn("IPS notification thresholds are not configured. Skipping check.");
        return;
    }
    try {
        const response = await fetchWithRetry(DONKI_GST_URL);
        if (!response) {
            console.error("checkIPS: Aborting after multiple failed fetch attempts for DONKI GST data.");
            return;
        }
        const shocks = await response.json();
        if (!Array.isArray(shocks) || shocks.length === 0) {
            return;
        }
        shocks.sort((a, b) => new Date(b.eventTime).getTime() - new Date(a.eventTime).getTime());
        const latestShock = shocks[0];
        
        const prevState = await kv(env).get('STATE_ips', 'json') || { lastShockTime: '1970-01-01T00:00:00Z' };

        if (new Date(latestShock.eventTime) > new Date(prevState.lastShockTime)) {
            const topic = 'ips-shock';
            if (await checkAndSetCooldown(topic, ipsThresholds.cooldownMinutes, env)) {
                const title = "💥 Interplanetary Shock Arrived!";
                let solarWindInfo = '';

                try {
                    const [plasmaRes, magRes] = await Promise.all([
                        fetchWithRetry(NOAA_PLASMA_URL),
                        fetchWithRetry(NOAA_MAG_URL)
                    ]);
                    
                    if (plasmaRes && magRes) {
                        const plasmaData = await plasmaRes.json();
                        const magData = await magRes.json();
                        
                        const plasmaHeader = plasmaData[0];
                        const magHeader = magData[0];
                        const latestPlasma = plasmaData[plasmaData.length - 1];
                        const latestMag = magData[magData.length - 1];
                        
                        const speed = Number(latestPlasma[plasmaHeader.indexOf('speed')]).toFixed(0);
                        const bt = Number(latestMag[magHeader.indexOf('bt')]).toFixed(1);
                        const bz = Number(latestMag[magHeader.indexOf('bz_gsm')]).toFixed(1);

                        if (!isNaN(speed) && !isNaN(bt) && !isNaN(bz)) {
                            solarWindInfo = `\n\nPost-shock conditions: Speed ${speed} km/s, Bt ${bt} nT, Bz ${bz} nT.`;
                        }
                    }
                } catch (e) {
                    console.error("checkIPS: Failed to fetch solar wind data post-shock, sending notification without it.", e);
                }
                
                const body = `A shockwave from a solar eruption was detected at ${formatNzTime(latestShock.eventTime)}. Expect solar wind conditions to change rapidly.${solarWindInfo} Aurora potential is now high!`;
                
                await notifyTopic(topic, title, body, env, { url: '/?page=forecast' });
            }
            await kv(env).put('STATE_ips', JSON.stringify({ lastShockTime: latestShock.eventTime }));
        }
    } catch (e) {
        reportError(e, env, { handler: 'checkIPS' });
    }
}


async function checkAuroraAndSubstorm(env, thresholds, forecastData) {
  if (!forecastData) return;
  await Promise.allSettled([
    checkAuroraForecast(env, forecastData, thresholds.aurora),
    checkSubstormActivity(env, forecastData, thresholds.substorm),
  ]);
}

async function checkAuroraForecast(env, forecastData, auroraThresholds) {
  const currentScore = forecastData?.currentForecast?.spotTheAuroraForecast;
  if (currentScore == null) return;
  const prev = await kv(env).get('STATE_aurora', 'json') || { score: 0 };
  for (const th of auroraThresholds) {
    const topic = `aurora-${th.value}percent`;
    if (currentScore >= th.value && prev.score < th.value) {
      if (await checkAndSetCooldown(topic, th.cooldownMinutes, env)) {
        const body = th.body.replace('{SCORE}', Number(currentScore).toFixed(0));
        const data = {
          url: '/?page=forecast&section=unified-forecast-section',
          baseScore: currentScore
        };
        await notifyTopic(topic, th.title, body, env, data);
      }
    }
  }
  await kv(env).put('STATE_aurora', JSON.stringify({ score: currentScore, timestamp: Date.now() }));
}


async function checkXrayFlux(env, thresholds) {
  const M1_THRESHOLD = 1e-5;
  const FIVE_MINUTES_MS = 5 * 60 * 1000;
  const response = await fetchWithRetry(NOAA_XRAY_URL);
  if (!response) { console.error(`checkXrayFlux: Aborting after multiple failed fetch attempts for NOAA data.`); return; }
  const allData = await response.json().catch(() => null);
  if (!allData) { console.error("checkXrayFlux: Failed to parse NOAA JSON data."); return; }
  const xraySeries = allData.filter(d => d.energy === '0.1-0.8nm' && d.flux > 0 && d.time_tag).map(d => ({ t: new Date(d.time_tag).getTime(), flux: d.flux })).sort((a, b) => a.t - b.t);
  if (xraySeries.length < 5) return;
  const currentState = xraySeries[xraySeries.length - 1];
  const prevState = await kv(env).get('STATE_xray', 'json') || { status: 'inactive', peakFlux: 0, peakTime: 0, lastNotifiedThreshold: 0, declineStartTimestamp: null };
  if (prevState.status === 'inactive') {
    if (currentState.flux >= M1_THRESHOLD) {
      const th = [...thresholds.xray].reverse().find(t => currentState.flux >= t.value);
      if (th && await checkAndSetCooldown(th.topic, th.cooldownMinutes, env)) {
        const body = th.body.replace('{CLASS}', getXrayClass(currentState.flux));
        await notifyTopic(th.topic, th.title, body, env, { url: '/?page=solar-activity&section=goes-xray-flux-section' });
      }
      const newState = { status: 'rising', peakFlux: currentState.flux, peakTime: currentState.t, lastNotifiedThreshold: th ? th.value : 0, declineStartTimestamp: null };
      await kv(env).put('STATE_xray', JSON.stringify(newState));
    }
  } else {
    let newState = { ...prevState };
    let flarePeaked = false;
    if (currentState.flux < M1_THRESHOLD) {
      flarePeaked = true;
    } else {
      if (currentState.flux > prevState.peakFlux) {
        newState.peakFlux = currentState.flux;
        newState.peakTime = currentState.t;
        newState.declineStartTimestamp = null;
        const th = [...thresholds.xray].reverse().find(t => newState.peakFlux >= t.value);
        if (th && th.value > prevState.lastNotifiedThreshold) {
          if (await checkAndSetCooldown(th.topic, th.cooldownMinutes, env)) {
            const body = th.body.replace('{CLASS}', getXrayClass(newState.peakFlux));
            await notifyTopic(th.topic, th.title, body, env, { url: '/?page=solar-activity&section=solar-flares-section' });
            newState.lastNotifiedThreshold = th.value;
          }
        }
      } else {
        if (prevState.declineStartTimestamp === null) { newState.declineStartTimestamp = currentState.t; } else { if (currentState.t - prevState.declineStartTimestamp >= FIVE_MINUTES_MS) { flarePeaked = true; } }
      }
    }
    if (flarePeaked) {
      const topic = 'flare-peak';
      if (await checkAndSetCooldown(topic, thresholds.peakFlare.cooldownMinutes, env)) {
        const peakCls = getXrayClass(prevState.peakFlux);
        const peakTimeFormatted = formatNzTime(prevState.peakTime);
        const title = `Solar Flare Peaked: ${peakCls}`;
        const body = `A solar flare reached a maximum of ${peakCls} around ${peakTimeFormatted} and is now declining.`;
        await notifyTopic(topic, title, body, env, { url: '/?page=solar-activity&section=solar-flares-section' });
      }
      await kv(env).put('STATE_xray', JSON.stringify({ status: 'inactive', peakFlux: 0, peakTime: 0, lastNotifiedThreshold: 0, declineStartTimestamp: null }));
    } else {
      await kv(env).put('STATE_xray', JSON.stringify(newState));
    }
  }
}

async function checkSubstormActivity(env, forecastData, substormThresholds) {
  try {
    const currentSubstorm = forecastData.substormForecast;
    if (!currentSubstorm) {
      console.warn('Substorm forecast object missing from forecast data.');
      return;
    }
    const prev = await kv(env).get('STATE_substorm', 'json') || { status: 'QUIET' };
    const statusLevels = { 'QUIET': 0, 'WATCH': 1, 'LIKELY_60': 2, 'IMMINENT_30': 3, 'ONSET': 4 };
    if (statusLevels[currentSubstorm.status] > statusLevels[prev.status]) {
      const topic = 'substorm-forecast';
      if (await checkAndSetCooldown(topic, substormThresholds.cooldownMinutes, env)) {
        let title = 'Substorm Forecast Update';
        switch (currentSubstorm.status) {
          case 'ONSET': title = '💥 Substorm Eruption In Progress!'; break;
          case 'IMMINENT_30': title = 'Substorm Alert: Eruption Imminent!'; break;
          case 'LIKELY_60': title = 'Substorm Watch: Eruption Likely'; break;
          case 'WATCH': title = 'Substorm Watch: Energy is Building'; break;
        }
        const body = currentSubstorm.action;
        await notifyTopic(topic, title, body, env, { url: '/?page=forecast&section=unified-forecast-section' });
      }
    }
    await kv(env).put('STATE_substorm', JSON.stringify({ status: currentSubstorm.status, timestamp: Date.now() }));
  } catch (e) {
    reportError(e, env, { handler: 'checkSubstormActivity' });
  }
}

async function handleSaveSubscription(request, env) {
  if (!kv(env)) return new Response('KV namespace missing.', { status: 500 });
  try {
    const { subscription, preferences, timezone } = await request.json();
    if (!subscription?.endpoint) return new Response('Invalid subscription', { status: 400 });
    const location = {
      timezone: timezone || request.cf?.timezone,
      latitude: request.cf?.latitude,
      longitude: request.cf?.longitude,
      country: request.cf?.country,
    };
    const id = await createSubscriptionId(subscription.endpoint);
    await kv(env).put(id, JSON.stringify({ subscription, preferences, location }));
    return json({ message: 'Saved' }, 201);
  } catch (e) {
    reportError(e, env, { handler: 'handleSaveSubscription' });
    return new Response(`Failed: ${e.message}`, { status: 500 });
  }
}
async function handleGetStatus(request, env) {
  const url = new URL(request.url);
  const secret = url.searchParams.get('secret');
  if (!secret || secret !== env.TRIGGER_SECRET) return new Response('Forbidden', { status: 403 });
  const status = await getCurrentStatus(env);
  return json({ status });
}

function buildTestPayloadByType(type, url, snapshot) {
  const base = { ts: Date.now(), data: { url: '/' } };

  if (type === 'ips') {
    const topic = 'ips-shock';
    return { ...base, title: 'Test: Interplanetary Shock', body: `Simulated shock arrival.\n\n${snapshot}`, tag: topic, topic };
  }
  if (type === 'flare') {
    const level = (url.searchParams.get('level') || 'M1').toUpperCase();
    const valid = new Set(['M1', 'M5', 'X1', 'X5', 'X10']);
    const chosen = valid.has(level) ? level : 'M1';
    const topic = `flare-${chosen}`;
    return { ...base, title: `Test: Solar Flare (${chosen})`, body: `Simulated ${chosen} flare.\n\n${snapshot}`, tag: topic, topic };
  }
  if (type === 'peak') {
      const topic = 'flare-peak';
      return { ...base, title: `Test: Solar Flare Peaked`, body: `Simulated flare peak notification.\n\n${snapshot}`, tag: topic, topic };
  }
  if (type === 'aurora') {
    const pct = parseInt(url.searchParams.get('pct') || '60', 10);
    const allowed = [40, 50, 60, 80];
    const chosen = allowed.includes(pct) ? pct : 60;
    const topic = `aurora-${chosen}percent`;
    return { ...base, title: `Test: Aurora Alert (${chosen}%)`, body: `Simulated forecast hit ${chosen}%.\n\n${snapshot}`, tag: topic, topic, data: { ...base.data, baseScore: chosen } };
  }
  if (type === 'substorm') {
    const topic = 'substorm-forecast';
    return { ...base, title: `Test: Aurora Substorm Expected`, body: `Simulated substorm forecast window.\n\n${snapshot}`, tag: topic, topic };
  }
  return { ...base, title: '🚀 Server Test Notification', body: `${snapshot}\n\nThis is a generic test push from the server.`, tag: 'test', topic: 'test' };
}

async function handleTriggerTestPush(request, env) {
  try {
    const url = new URL(request.url);
    const secret = url.searchParams.get('secret');
    if (!secret || secret !== env.TRIGGER_SECRET) return new Response('Forbidden', { status: 403 });
    const type = (url.searchParams.get('type') || 'test').toLowerCase();
    const snapshot = await buildStatusSnapshot(env);
    const payload = buildTestPayloadByType(type, url, snapshot);
    await startBroadcast({ mode: 'topic', topic: payload.topic, overridePayload: payload }, env);
    return json({ message: `Test push broadcast started for topic '${payload.topic}'.` });
  } catch (err) {
    reportError(err, env, { handler: 'handleTriggerTestPush' });
    return json({ error: 'Failed to trigger test push.', message: err.message }, 500);
  }
}
async function handleTriggerSelfTest(request, env) {
  try {
    const { subscription, category } = await request.json();
    if (!subscription || !subscription.endpoint) { return json({ error: 'Invalid subscription object provided.' }, 400); }
    const payload = { title: `Spot The Aurora: Test`, body: `This is a test notification for the '${category || 'general'}' category.`, tag: `test-${category}-${Date.now()}`, data: { url: '/', category: category || 'general' } };
    const response = await sendPushWithPayload(subscription, payload, env);
    if (response.ok) { return json({ success: true, message: 'Test push sent successfully.' }); }
    else { const errorBody = await response.text(); console.error(`Failed to send self-test push: ${response.status}`, errorBody); return json({ success: false, message: `Push service responded with status ${response.status}.` }, 500); }
  } catch (err) {
    reportError(err, env, { handler: 'handleTriggerSelfTest' });
    return json({ error: 'An internal error occurred.' }, 500);
  }
}
async function handleBroadcastBatch(request, env) {
  const { secret, mode, topic, cursor, chain = 1, overridePayload } = await request.json().catch(() => ({}));
  if (!secret || secret !== env.TRIGGER_SECRET) return new Response('Forbidden', { status: 403 });
  const res = await doBroadcastBatch({ mode, topic, cursor, overridePayload }, env);
  if (!res.list_complete && res.next_cursor && chain < MAX_CHAIN && env.SELF_URL) {
    fetch(new URL('/broadcast-batch', env.SELF_URL), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret, mode, topic, cursor: res.next_cursor, chain: chain + 1, overridePayload }), });
  }
  return json(res);
}
async function notifyTopic(topic, title, body, env, data = { url: '/' }) {
  const payload = { title, body, tag: topic, data: { ...data, category: topic }, ts: Date.now() };
  await kv(env).put(`LATEST_ALERT_${topic}`, JSON.stringify(payload), { expirationTtl: 3600 });
  await startBroadcast({ mode: 'topic', topic, overridePayload: payload }, env);
}
async function startBroadcast(options, env) {
  const res = await doBroadcastBatch({ ...options, cursor: undefined }, env);
  if (!res.list_complete && res.next_cursor && env.SELF_URL) {
    fetch(new URL('/broadcast-batch', env.SELF_URL), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: env.TRIGGER_SECRET, mode: options.mode, topic: options.topic, cursor: res.next_cursor, chain: 2, overridePayload: options.overridePayload, }), });
  }
  return res;
}
const calculateLocationAdjustment = (userLat) => {
  const lat = parseFloat(userLat);
  if (isNaN(lat)) return 0;
  const isNorthOfGreymouth = lat > GREYMOUTH_LATITUDE;
  const R = 6371; // Earth's radius in km
  const dLat = (lat - GREYMOUTH_LATITUDE) * (Math.PI / 180);
  const distanceKm = Math.abs(dLat) * R;
  const numberOfSegments = Math.floor(distanceKm / 10);
  const adjustmentFactor = numberOfSegments * 0.2;
  return isNorthOfGreymouth ? -adjustmentFactor : adjustmentFactor;
};
function isUserInPlausibleZone(latitude) {
  const lat = parseFloat(latitude);
  if (isNaN(lat)) return true; // Fail open for backward compatibility
  return Math.abs(lat) > 30;
}
async function doBroadcastBatch(options, env) {
  const { topic, cursor, overridePayload } = options || {};
  let successCount = 0, failCount = 0, processed = 0;
  const listRes = await kv(env).list({ cursor });
  const keys = listRes.keys || [];

  for (const key of keys) {
    if (processed >= BATCH_SIZE) break;
    if (key.name.startsWith('STATE_') || key.name.startsWith('LATEST_') || key.name.startsWith('CONFIG_') || key.name.startsWith('COOLDOWN_')) continue;

    const stored = await kv(env).get(key.name, 'json');
    if (!stored?.subscription) continue;

    if (stored?.preferences?.[topic] === false) {
      console.log(`Skipping push for ${key.name} because topic '${topic}' is disabled.`);
      continue;
    }
    const userLocation = stored.location || {};
    if (topic.startsWith('aurora-') || topic.startsWith('substorm-')) {
      if (!isUserInPlausibleZone(userLocation.latitude)) {
        console.log(`Skipping push for ${key.name} due to implausible latitude ${userLocation.latitude}.`);
        continue;
      }
    }
    if (topic.startsWith('aurora-')) {
      const baseScore = overridePayload?.data?.baseScore;
      if (baseScore !== null && baseScore !== undefined && userLocation.latitude) {
        const adjustment = calculateLocationAdjustment(userLocation.latitude);
        const adjustedScore = Math.max(0, Math.min(100, baseScore + adjustment));
        const threshold = parseInt(topic.split('-')[1], 10);
        if (isNaN(threshold) || adjustedScore < threshold) {
          console.log(`Skipping push for ${key.name}. Base score: ${baseScore}, Adjusted score: ${adjustedScore.toFixed(1)} is below threshold for topic ${topic}.`);
          continue;
        }
      }
    }
    const payload = overridePayload || { title: 'Spot The Aurora', body: 'New data available.', tag: 'update', ts: Date.now() };
    const resp = await sendPushWithPayload(stored.subscription, payload, env);
    if (!resp.ok) {
      const errorBody = await resp.text();
      console.error(`Push failed for endpoint: ${stored.subscription.endpoint.slice(0, 50)}... Status: ${resp.status}`, errorBody);
      if (resp.status === 410 || resp.status === 404) { console.log(`Deleting expired subscription: ${key.name}`); await kv(env).delete(key.name); }
      failCount++;
    } else {
      successCount++;
    }
    processed++;
  }
  return { successCount, failCount, processed, list_complete: listRes.list_complete, next_cursor: listRes.cursor };
}
async function sendPushWithPayload(subscription, payload, env) {
  try {
    const aud = new URL(subscription.endpoint).origin;
    const vapidJWT = await createVapidJWT(aud, env);
    const { body } = await encryptWebPushPayload(subscription, JSON.stringify(payload));
    return fetch(subscription.endpoint, { method: 'POST', headers: { 'TTL': '86400', 'Authorization': `vapid t=${vapidJWT}, k=${env.VAPID_PUBLIC_KEY}`, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream' }, body, });
  } catch (err) {
    reportError(err, env, { handler: 'sendPushWithPayload', endpoint: subscription.endpoint });
    return new Response(null, { status: 500, statusText: err.message });
  }
}
async function importVapidPrivateKeyFlexible(privInput, pubInput) { const pemDer = maybePemToDer(privInput); if (pemDer) { return crypto.subtle.importKey('pkcs8', pemDer, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']); } try { const der = b64urlToBytes(privInput); if (der?.byteLength > 48) { return crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']); } } catch {} const { x, y } = parseUncompressedPublicXY(String(pubInput)); return crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: String(privInput).trim(), x, y, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'] ); }
async function hmac(keyBytes, dataBytes) { const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return new Uint8Array(await crypto.subtle.sign('HMAC', key, dataBytes)); }
function handleOptions() { return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '86400' }}); }
function json(obj, status = 200, extra = {}) { return new Response(JSON.stringify(obj), { status, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type':'application/json', ...extra } }); }
async function createSubscriptionId(endpoint) { const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)); return b64url(new Uint8Array(hash)); }
function maybePemToDer(pem) { const m = String(pem).match(/-----BEGIN PRIVATE KEY-----([A-Za-z0-9+/=\s]+)-----END PRIVATE KEY-----/); if (!m) return null; const bin = atob(m[1].replace(/\s+/g, '')); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
function parseUncompressedPublicXY(pubKeyB64Url) { const raw = b64urlToBytes(pubKeyB64Url); if (raw.length !== 65 || raw[0] !== 0x04) throw new Error('VAPID_PUBLIC_KEY must be 65-byte uncompressed P-256.'); const x = b64url(raw.slice(1,33)); const y = b64url(raw.slice(33)); return { x, y }; }
function b64url(input) { let s = ''; if (input instanceof ArrayBuffer) input = new Uint8Array(input); if (input instanceof Uint8Array) { for (let i=0;i<input.length;i++) s += String.fromCharCode(input[i]); } else { s = unescape(encodeURIComponent(String(input))); } return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function b64urlToBytes(str) { const s = String(str).replace(/-/g,'+').replace(/_/g,'/'); const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : ''; const bin = atob(s + pad); const out = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i); return out; }
function concatBytes(...arrs) { let len=0; for (const a of arrs) len += a.length; const out = new Uint8Array(len); let o=0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; }
function utf8(s) { return new TextEncoder().encode(s); }
function u32be(n) { return new Uint8Array([(n>>>24)&255, (n>>>16)&255, (n>>>8)&255, n&255]); }
function randomBytes(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function createVapidJWT(audience, env) { const header = { typ: 'JWT', alg: 'ES256' }; const payload = { aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT }; const toSign = new TextEncoder().encode(`${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`); const key = await importVapidPrivateKeyFlexible(env.VAPID_PRIVATE_KEY, env.VAPID_PUBLIC_KEY); const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, toSign); return `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}.${b64url(new Uint8Array(sig))}`; }
async function encryptWebPushPayload(subscription, jsonString) { const uaPubRaw = b64urlToBytes(subscription.keys?.p256dh); const authSecret = b64urlToBytes(subscription.keys?.auth); const serverKeys = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])); const exportedRaw = (await crypto.subtle.exportKey('raw', serverKeys.publicKey)); const serverPubRaw = new Uint8Array(exportedRaw); const uaPubKey = await crypto.subtle.importKey('raw', uaPubRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []); const ecdhParams = { name: 'ECDH', public: uaPubKey }; const ecdhBits = await crypto.subtle.deriveBits(ecdhParams, serverKeys.privateKey, 256); const ecdhSecret = new Uint8Array(ecdhBits); const prkKey = await hmac(authSecret, ecdhSecret); const keyInfo = concatBytes(utf8('WebPush: info'), new Uint8Array([0x00]), uaPubRaw, serverPubRaw); const IKM = await hmac(prkKey, concatBytes(keyInfo, new Uint8Array([0x01]))); const salt = randomBytes(16); const PRK = await hmac(salt, IKM); const CEK = (await hmac(PRK, concatBytes(utf8('Content-Encoding: aes128gcm'), new Uint8Array([0, 1])))).slice(0, 16); const NONCE = (await hmac(PRK, concatBytes(utf8('Content-Encoding: nonce'), new Uint8Array([0, 1])))).slice(0, 12); const aesKey = await crypto.subtle.importKey('raw', CEK, { name: 'AES-GCM' }, false, ['encrypt']); const plaintext = concatBytes(utf8(jsonString), new Uint8Array([2])); const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: NONCE }, aesKey, plaintext)); const header = concatBytes(salt, u32be(4096), new Uint8Array([serverPubRaw.length]), serverPubRaw); return { body: concatBytes(header, ciphertext) }; }
async function checkAndSetCooldown(topic, minutes, env) { if (!minutes) return true; const key = `COOLDOWN_${topic}`; const lastSent = await kv(env).get(key); const now = Date.now(); if (lastSent && (now - Number(lastSent)) < minutes * 60 * 1000) { console.log(`Cooldown active for topic: ${topic}. Skipping notification.`); return false; } await kv(env).put(key, now.toString(), { expirationTtl: minutes * 60 }); return true; }
async function getFullForecastData(env) { try { if (!env.FORECAST_SERVICE?.fetch) { console.error("FORECAST_SERVICE binding is not configured."); return null; } const res = await env.FORECAST_SERVICE.fetch('https://internal-forecast-service/forecast'); if (!res.ok) { console.error(`Forecast service returned non-ok status: ${res.status}`); return null; } return await res.json(); } catch (e) { reportError(e, env, { fn: 'getFullForecastData' }); return null; } }
async function handleHealthCheck(env) { try { const tsStr = await kv(env).get('LAST_SUCCESSFUL_RUN_TIMESTAMP'); const ts = tsStr ? Number(tsStr) : 0; const now = Date.now(); const healthy = ts && (now - ts) <= HEALTH_CHECK_THRESHOLD_MS; return json({ ok: healthy, lastRun: ts || null, ageMs: ts ? (now - ts) : null, thresholdMs: HEALTH_CHECK_THRESHOLD_MS }, healthy ? 200 : 503); } catch (e) { reportError(e, env, { handler: 'handleHealthCheck' }); return json({ ok: false, error: 'health check failed' }, 500); } }
function getXrayClass(flux) { if (!Number.isFinite(flux) || flux <= 0) return '—'; if (flux >= 1e-4) return `X${(flux / 1e-4).toFixed(1)}`; if (flux >= 1e-5) return `M${(flux / 1e-5).toFixed(1)}`; if (flux >= 1e-6) return `C${(flux / 1e-6).toFixed(1)}`; if (flux >= 1e-7) return `B${(flux / 1e-7).toFixed(1)}`; return `A${(flux / 1e-8).toFixed(1)}`; }
function formatNzTime(ts) { try { return new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit', month: 'short', day: '2-digit' }).format(new Date(ts)); } catch { return new Date(ts).toISOString(); } }
async function getCurrentStatus(env) { const [aurora, xray, substorm, lastRun] = await Promise.all([ kv(env).get('STATE_aurora', 'json'), kv(env).get('STATE_xray', 'json'), kv(env).get('STATE_substorm', 'json'), kv(env).get('LAST_SUCCESSFUL_RUN_TIMESTAMP'), ]); return { aurora, xray, substorm, lastRun: lastRun ? Number(lastRun) : null }; }
async function buildStatusSnapshot(env) { const [aurora, xray, substorm] = await Promise.all([ kv(env).get('STATE_aurora', 'json'), kv(env).get('STATE_xray', 'json'), kv(env).get('STATE_substorm', 'json'), ]); const score = aurora?.score ?? 'N/A'; const sub = substorm?.status ? `Status: ${substorm.status}` : 'Status: QUIET'; const vis = (s) => (s === 'N/A' ? '—' : s >= 80 ? 'Clear Eye Visible' : s >= 50 ? 'Faint Eye Visible' : s >= 40 ? 'Phone Camera Visible' : 'Insignificant'); const flare = (v) => (typeof v === 'number' ? (v >= 1e-4 ? `X${(v/1e-4).toFixed(1)}` : v >= 1e-5 ? `M${(v/1e-5).toFixed(1)}` : `C${(v/1e-6).toFixed(1)}`) : '—'); const xrayStatus = xray?.status === 'rising' ? `Rising (${flare(xray.peakFlux)})` : xray?.status === 'peaked' ? `Peaked (${flare(xray.peakFlux)})` : 'Quiet'; return [ `Aurora score: ${score} (${vis(score)})`, `Solar Flare: ${xrayStatus}`, `Substorm: ${sub}` ].join('\n'); }