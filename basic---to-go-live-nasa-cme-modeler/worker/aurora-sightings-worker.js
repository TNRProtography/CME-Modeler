// The single key we will use to store all sightings
const SIGHTINGS_KEY = 'all_sightings_v1';
const TWENTY_FOUR_HOURS_IN_MS = 24 * 60 * 60 * 1000;

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
      
      // --- NEW KV LOGIC: 1 READ OPERATION ---
      const allSightings = await env.SIGHTINGS_KV.get(SIGHTINGS_KEY, { type: 'json' }) || [];
      
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
        
        // --- NEW READ-MODIFY-WRITE LOGIC ---

        // 1. READ the existing array
        let currentSightings = await env.SIGHTINGS_KV.get(SIGHTINGS_KEY, { type: 'json' }) || [];

        // 2. ADD the new sighting
        const newSighting = { lat, lng, status, name: sanitizedName, timestamp };
        currentSightings.push(newSighting);
        
        // 3. PRUNE old sightings from the array
        const cutoffTimestamp = Date.now() - TWENTY_FOUR_HOURS_IN_MS;
        const updatedSightings = currentSightings.filter(sighting => sighting.timestamp > cutoffTimestamp);

        // 4. WRITE the updated array back to the KV (as a background task)
        ctx.waitUntil(env.SIGHTINGS_KV.put(SIGHTINGS_KEY, JSON.stringify(updatedSightings)));

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
    // Just write an empty array to the single key. (1 write operation)
    await env.SIGHTINGS_KV.put(SIGHTINGS_KEY, JSON.stringify([]));
    console.log(`Successfully cleared sightings.`);
  }
};

