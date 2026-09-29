// The combined list the app reads: one KV read per request.
const SIGHTINGS_KEY = 'all_sightings_v1';
const TWENTY_FOUR_HOURS_IN_MS = 24 * 60 * 60 * 1000;

// Each sighting is also its own key, with the sighting in the key's metadata
// so one list call returns them all. Adding to the combined list directly
// (read it, push, write it back) lost sightings: two posts close together
// each wrote back a list without the other's, and KV takes up to a minute to
// show a write in other locations. A post now writes only its own key and
// rebuilds the combined list from all of them; any rebuild picks up whatever
// an earlier one missed, and a read rebuilds it if it is over 5 minutes old.
const SIGHTING_PREFIX = 's:';
const SIGHTING_TTL_S = 2 * 24 * 3600;
const REBUILD_AFTER_MS = 5 * 60 * 1000;
const FORMAT = 2;

async function listSightings(kv) {
  const out = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: SIGHTING_PREFIX, cursor });
    for (const k of page.keys) if (k.metadata) out.push({ key: k.name, sighting: k.metadata });
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

const sightingKey = (s) => `${SIGHTING_PREFIX}${s.timestamp}:${Math.random().toString(36).slice(2, 10)}`;
// Fixed for a given sighting, so carrying the old list over twice (two
// requests at once) writes the same keys rather than duplicates.
const carriedKey = (s) => `${SIGHTING_PREFIX}${s.timestamp}:m${Math.abs(
  [...`${s.name}|${s.lat}|${s.lng}|${s.status}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7),
).toString(36)}`;
const sameSighting = (a, b) => a.timestamp === b.timestamp && a.name === b.name && a.lat === b.lat && a.lng === b.lng;

/** Rebuilds the combined list from the per-sighting keys; returns it. */
async function rebuild(kv, justAdded = []) {
  const { value: current, metadata } = await kv.getWithMetadata(SIGHTINGS_KEY, { type: 'json' });
  const extra = [...justAdded];

  // A list written before per-sighting keys existed: give each of its
  // sightings a key, once, so the first rebuild does not drop them.
  if (metadata?.format !== FORMAT && Array.isArray(current)) {
    for (const s of current) {
      await kv.put(carriedKey(s), '', { metadata: s, expirationTtl: SIGHTING_TTL_S });
      extra.push(s);
    }
  }

  const cutoff = Date.now() - TWENTY_FOUR_HOURS_IN_MS;
  const all = [];
  // Keys written moments ago may not be listed yet, hence the extras.
  for (const s of [...(await listSightings(kv)).map((x) => x.sighting), ...extra]) {
    if (!all.some((a) => sameSighting(a, s))) all.push(s);
  }
  const sightings = all.filter((s) => s.timestamp > cutoff).sort((a, b) => a.timestamp - b.timestamp);

  await kv.put(SIGHTINGS_KEY, JSON.stringify(sightings), { metadata: { format: FORMAT, builtAt: Date.now() } });
  return sightings;
}

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method === 'GET') {
      // --- START: CACHING LOGIC (Still valuable for traffic spikes) ---
      const cache = caches.default;
      const cacheKey = request.url;
      let response = await cache.match(cacheKey);

      if (response) {
        console.log(`Cache hit for ${cacheKey}`);
        response = new Response(response.body, response);
        response.headers.set('Access-Control-Allow-Origin', '*');
        return response;
      }
      
      console.log(`Cache miss for ${cacheKey}. Fetching from KV.`);
      
      // --- 1 READ OPERATION, plus a rebuild at most every 5 minutes ---
      const { value, metadata } = await env.SIGHTINGS_KV.getWithMetadata(SIGHTINGS_KEY, { type: 'json' });
      let allSightings = value || [];
      if (metadata?.format !== FORMAT || Date.now() - (metadata.builtAt || 0) > REBUILD_AFTER_MS) {
        allSightings = await rebuild(env.SIGHTINGS_KV).catch(() => allSightings);
      }
      
      response = new Response(JSON.stringify(allSightings), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });

      response.headers.set('Cache-Control', 'public, max-age=60');
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      
      return response;
    }

    if (request.method === 'POST') {
      try {
        const body = await request.json();
        const { lat, lng, status, name } = body;

        // MODIFIED: Added the new "nothing-*" statuses to the list of valid options
        const validStatuses = [
          'eye', 'phone', 'dslr', 'cloudy', 'nothing',
          'nothing-eye', 'nothing-phone', 'nothing-dslr'
        ];

        if (
          typeof lat !== 'number' || 
          typeof lng !== 'number' || 
          typeof name !== 'string' ||
          name.trim() === '' ||
          !validStatuses.includes(status) // Use the new list for validation
        ) {
          return new Response(JSON.stringify({ error: 'Invalid or missing data provided.' }), { status: 400, headers: corsHeaders });
        }

        const sanitizedName = name.trim().slice(0, 50).replace(/<[^>]*>?/gm, '');
        const timestamp = Date.now();
        
        // 1. Its own key, which nothing else writes to.
        const newSighting = { lat, lng, status, name: sanitizedName, timestamp };
        await env.SIGHTINGS_KV.put(sightingKey(newSighting), '', { metadata: newSighting, expirationTtl: SIGHTING_TTL_S });

        // 2. The combined list, rebuilt from every sighting's key.
        await rebuild(env.SIGHTINGS_KV, [newSighting]);

        // --- Invalidate the cache after a successful POST ---
        // This ensures the next GET request will see the new data immediately.
        const cache = caches.default;
        // The GET request URL is different from the POST request URL.
        // We need to construct the cache key for the GET endpoint.
        const getUrl = new URL(request.url);
        getUrl.pathname = '/'; // Assuming the GET endpoint is at the root. Adjust if needed.
        const getCacheKey = getUrl.toString();
        ctx.waitUntil(cache.delete(getCacheKey));
        
        console.log(`Cache invalidated for ${getCacheKey}`);


        return new Response(JSON.stringify({ success: true }), {
          status: 201,
          headers: corsHeaders,
        });

      } catch (e) {
        return new Response(JSON.stringify({ error: 'Could not parse request body.' }), { status: 400, headers: corsHeaders });
      }
    }

    return new Response('Not found.', { status: 404, headers: corsHeaders });
  },

  // The scheduled handler is now simpler and much more efficient.
  async scheduled(controller, env, ctx) {
    console.log("Cron trigger running: Clearing all user sightings...");
    for (const { key } of await listSightings(env.SIGHTINGS_KV)) await env.SIGHTINGS_KV.delete(key);
    await env.SIGHTINGS_KV.put(SIGHTINGS_KEY, JSON.stringify([]), { metadata: { format: FORMAT, builtAt: Date.now() } });
    console.log(`Successfully cleared sightings.`);
  }
};

