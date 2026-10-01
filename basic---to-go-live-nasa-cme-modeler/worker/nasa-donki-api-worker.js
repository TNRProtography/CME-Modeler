// The key used inside the KV store.
const CACHE_KEY = 'nasa_donki_data';
// Whether NASA is answering, written every run whatever happened.
const STATUS_KEY = 'nasa_donki_status';
// How long the last good data is kept if NASA stops answering. It used to be
// a day, so an outage longer than that emptied the cache and the app had
// nothing at all; a week rides out NASA's longer outages.
const KEEP_SECONDS = 7 * 86400;
// NASA counts as offline after this long without a good fetch (the cron runs
// every minute).
const OFFLINE_AFTER_MS = 30 * 60000;

// All known categories (uppercase, matching KV keys)
const CATEGORIES = ["CME", "GST", "FLR", "SEP", "MPC", "RBE", "HSS", "WSAENLILSIMULATIONS", "NOTIFICATIONS", "IPS"];

export default {
  /**
   * 1. SCHEDULED EVENT (The Poller)
   * Runs on cron. Fetches NASA data -> Only writes to KV if new data is non-empty.
   */
  async scheduled(event, env, context) {
    console.log("Cron Triggered: Starting scheduled NASA data update...");

    try {
      const fetched = await fetchAllDonkiData(env);

      // --- PER-CATEGORY FAILURE PROTECTION ---
      // A category whose fetch failed (HTTP error, rate limit, bad shape) comes
      // back null and keeps its last good data. It used to come back as an
      // empty list and was saved as one, blanking e.g. the CME list until the
      // next good fetch. An empty list NASA actually returned is kept as is:
      // it means no events.
      const failed = CATEGORIES.filter(cat => fetched[cat] == null);
      const sources = [...new Set(Object.values(fetched._sources || {}))];
      await writeStatus(env, failed.length < CATEGORIES.length, failed, sources);
      if (failed.length === CATEGORIES.length) {
        console.warn("Skipping cache write: every category failed. Existing cache preserved.");
        return;
      }
      let previous = {};
      if (failed.length) {
        try { previous = JSON.parse(await env.NASA_DONKI_CACHE.get(CACHE_KEY)) || {}; } catch { previous = {}; }
        console.warn(`Kept previous data for: ${failed.join(', ')}`);
      }
      const allData = {};
      for (const cat of CATEGORIES) allData[cat] = fetched[cat] ?? previous[cat] ?? [];

      // Add metadata only when we have real data worth caching
      allData._metadata = {
        last_updated: new Date().toISOString(),
        source: "NASA DONKI API",
        status: failed.length ? "partial" : "fresh",
        kept_previous: failed,
        sources,
      };

      // Kept a week, as a safety net if the cron stops running altogether.
      await env.NASA_DONKI_CACHE.put(CACHE_KEY, JSON.stringify(allData), {
        expirationTtl: KEEP_SECONDS
      });

      console.log("Success: Cache updated with fresh data.");
    } catch (error) {
      // On any exception we intentionally do NOT touch the cache,
      // so the last good data remains available.
      console.error("Failure: Could not update NASA data. Cache preserved.", error);
      try { await writeStatus(env, false, CATEGORIES, [], String(error && error.message || error)); } catch { /* ignore */ }
    }
  },

  /**
   * 2. FETCH EVENT (The Proxy)
   * Runs on user visit. READ-ONLY from Cache.
   */
  async fetch(request, env, context) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Is NASA answering, and how old is what is cached? For the app's
    // "NASA offline" badge.
    if (new URL(request.url).pathname.toLowerCase().replace(/\/+$/, '') === '/status') {
      const status = await readStatus(env);
      return new Response(JSON.stringify(status), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', ...corsHeaders },
      });
    }

    try {
      const cachedDataString = await env.NASA_DONKI_CACHE.get(CACHE_KEY);

      if (!cachedDataString) {
        return new Response(JSON.stringify({
          error: "Service Initializing. Data not yet available. Please wait for the next scheduled update."
        }), {
          status: 503,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      const data = JSON.parse(cachedDataString);
      return processRequestWithData(data, request, corsHeaders);

    } catch (error) {
      return new Response(JSON.stringify({ error: "Internal Worker Error", details: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }
};

// ---------------------------------------------------------------------------
// LOGIC & HTML GENERATION
// ---------------------------------------------------------------------------

function processRequestWithData(data, request, corsHeaders) {
  const { pathname } = new URL(request.url);
  const category = pathname.substring(1).toUpperCase();

  // 1. API: Serve specific category JSON
  if (category && data[category]) {
    return new Response(JSON.stringify(data[category], null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        // When this was last fetched from NASA, so the app can say how old
        // it is when NASA is down.
        'X-Donki-Updated': data._metadata?.last_updated || '',
        'Access-Control-Expose-Headers': 'X-Donki-Updated',
        ...corsHeaders,
      },
    });
  } else if (category) {
    return new Response('Category not found.', { status: 404, headers: corsHeaders });
  }

  // 2. Dashboard: Serve HTML
  const html = generateDashboardHtml(data);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      ...corsHeaders,
    },
  });
}

function generateDashboardHtml(allData) {
  // Explicit order for consistent display
  const categories = ["CME", "GST", "FLR", "SEP", "MPC", "RBE", "HSS", "WSAEnlilSimulations", "Notifications", "IPS"];

  let summaryRows = '';
  let detailsHtml = '';

  categories.forEach(cat => {
    // Normalise key lookup — KV stores uppercase but display uses mixed case
    const dataKey = cat.toUpperCase();
    const items = allData[dataKey] || [];
    const hasData = Array.isArray(items) && items.length > 0;

    let latestTime = "No Data (Last 7 Days)";
    let displayItem = null;

    if (hasData) {
      const latest = items.reduce((prev, curr) =>
        new Date(curr.sortableTime) > new Date(prev.sortableTime) ? curr : prev
      );

      displayItem = { ...latest };
      delete displayItem.sortableTime;

      const dateObj = new Date(latest.sortableTime);
      latestTime = dateObj.toLocaleString('en-US', { timeZone: 'UTC' }) + ' UTC';
    }

    summaryRows += `
      <tr>
        <td><strong>${cat}</strong></td>
        <td class="${hasData ? 'active' : 'inactive'}">${latestTime}</td>
        <td><a href="/${dataKey}">JSON (${items.length})</a></td>
        <td>${hasData ? '<a href="#' + dataKey + '">View Details</a>' : '-'}</td>
      </tr>
    `;

    if (hasData && displayItem) {
      detailsHtml += `
        <div id="${dataKey}" class="category-block">
          <div class="category-header">
            <h2>${cat}</h2>
            <span class="timestamp">Latest: ${latestTime}</span>
          </div>
          <pre>${JSON.stringify(displayItem, null, 2)}</pre>
          <a href="#top" class="back-to-top">↑ Back to Summary</a>
        </div>
      `;
    }
  });

  const lastUpdated = allData._metadata ? allData._metadata.last_updated : 'Unknown';

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>NASA DONKI Dashboard</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f0f2f5; color: #1c1e21; margin: 0; padding: 20px; }
        .container { max-width: 1000px; margin: 0 auto; }
        header { text-align: center; margin-bottom: 30px; }
        h1 { color: #0b3d91; margin-bottom: 5px; }
        .meta { font-size: 0.9em; color: #606770; }
        .panel { background: #fff; border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.1); padding: 20px; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { text-align: left; padding: 12px; border-bottom: 1px solid #eee; }
        th { background: #f7f8fa; font-weight: 600; color: #444; }
        .active { color: #008000; font-weight: 500; }
        .inactive { color: #999; font-style: italic; }
        a { color: #1877f2; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .category-block { background: #fff; border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.1); margin-bottom: 20px; overflow: hidden; }
        .category-header { background: #0b3d91; color: #fff; padding: 15px 20px; display: flex; justify-content: space-between; align-items: center; }
        .category-header h2 { margin: 0; font-size: 1.2em; }
        .timestamp { font-size: 0.9em; opacity: 0.9; }
        pre { margin: 0; padding: 20px; background: #282c34; color: #abb2bf; white-space: pre-wrap; word-wrap: break-word; font-size: 0.9em; font-family: 'Consolas', 'Monaco', monospace; }
        .back-to-top { display: block; padding: 10px 20px; background: #f7f8fa; text-align: right; font-size: 0.85em; border-top: 1px solid #eee; }
      </style>
    </head>
    <body>
      <div class="container" id="top">
        <header>
          <h1>NASA DONKI Dashboard</h1>
          <div class="meta">Data cached from NASA. Last Updated: ${lastUpdated}</div>
        </header>

        <div class="panel">
          <h3>Overview (Last 7 Days)</h3>
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Latest Event Time (UTC)</th>
                <th>Raw Data</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              ${summaryRows}
            </tbody>
          </table>
        </div>

        <h3>Latest Entries by Category</h3>
        ${detailsHtml || '<p style="text-align:center">No detailed data available.</p>'}
      </div>
    </body>
    </html>
  `;
}

// ---------------------------------------------------------------------------
// DATA FETCHING & PROCESSING UTILS
// ---------------------------------------------------------------------------

async function fetchAllDonkiData(env) {
  if (!env.NASA_API_KEY) throw new Error("Configuration Error: NASA_API_KEY not set.");

  const apiKey = env.NASA_API_KEY;
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7);

  const formatDateForApi = (date) => date.toISOString().split('T')[0];
  const apiStartDate = formatDateForApi(startDate);
  const apiEndDate = formatDateForApi(endDate);

  const donkiEndpoints = [
    { name: "CME",                  url: `https://api.nasa.gov/DONKI/CME?startDate=${apiStartDate}&endDate=${apiEndDate}&api_key=${apiKey}` },
    { name: "GST",                  url: `https://api.nasa.gov/DONKI/GST?startDate=${apiStartDate}&endDate=${apiEndDate}&api_key=${apiKey}` },
    { name: "FLR",                  url: `https://api.nasa.gov/DONKI/FLR?startDate=${apiStartDate}&endDate=${apiEndDate}&api_key=${apiKey}` },
    { name: "SEP",                  url: `https://api.nasa.gov/DONKI/SEP?startDate=${apiStartDate}&endDate=${apiEndDate}&api_key=${apiKey}` },
    { name: "MPC",                  url: `https://api.nasa.gov/DONKI/MPC?startDate=${apiStartDate}&endDate=${apiEndDate}&api_key=${apiKey}` },
    { name: "RBE",                  url: `https://api.nasa.gov/DONKI/RBE?startDate=${apiStartDate}&endDate=${apiEndDate}&api_key=${apiKey}` },
    { name: "HSS",                  url: `https://api.nasa.gov/DONKI/HSS?startDate=${apiStartDate}&endDate=${apiEndDate}&api_key=${apiKey}` },
    { name: "WSAEnlilSimulations",  url: `https://api.nasa.gov/DONKI/WSAEnlilSimulations?startDate=${apiStartDate}&endDate=${apiEndDate}&api_key=${apiKey}` },
    { name: "Notifications",        url: `https://api.nasa.gov/DONKI/notifications?startDate=${apiStartDate}&endDate=${apiEndDate}&type=all&api_key=${apiKey}` },
    // Interplanetary shocks at Earth only: the app announces the newest as
    // "arrived", which a shock at STEREO-A has not.
    { name: "IPS",                  url: `https://api.nasa.gov/DONKI/IPS?startDate=${apiStartDate}&endDate=${apiEndDate}&location=Earth&catalog=ALL&api_key=${apiKey}` }
  ];

  // NASA's public API (api.nasa.gov) is a gateway in front of CCMC's own
  // DONKI web service. When the gateway is down - it can be for days - the
  // service behind it usually is not, and needs no key.
  const ccmcUrl = (url) => {
    const u = new URL(url);
    u.searchParams.delete('api_key');
    return `https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/${u.pathname.replace(/^\/DONKI\//, '')}${u.search}`;
  };

  const getJson = async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };

  const fetchAndProcessData = async ({ name, url }) => {
    const upperName = name.toUpperCase();
    try {
      let data, source = 'api.nasa.gov';
      try {
        data = await getJson(url);
      } catch (primary) {
        console.warn(`api.nasa.gov failed for ${name} (${primary.message}); trying CCMC`);
        data = await getJson(ccmcUrl(url));
        source = 'ccmc';
      }
      sources[upperName] = source;
      if (Array.isArray(data)) {
        data.forEach(processDataItem);
      } else {
        // Unexpected response shape — treat as empty rather than caching garbage
        console.warn(`Unexpected response shape for ${name}:`, typeof data);
        return { [upperName]: null };
      }
      // Newest first for shocks: the app reads the first as the latest.
      if (upperName === "IPS") data.sort((a, b) => String(b.eventTime).localeCompare(String(a.eventTime)));
      return { [upperName]: data };
    } catch (err) {
      console.error(`Exception fetching ${name}:`, err);
      return { [upperName]: null };
    }
  };

  const sources = {};
  const results = await Promise.all(donkiEndpoints.map(fetchAndProcessData));
  return { ...results.reduce((acc, current) => ({ ...acc, ...current }), {}), _sources: sources };
}

function processDataItem(item) {
  const parseApiDate = (dateString) => {
    if (!dateString || typeof dateString !== 'string') return null;
    const slashParts = dateString.split(' ');
    if (slashParts.length === 2 && slashParts[0].includes('/')) {
      const dateParts = slashParts[0].split('/');
      if (dateParts.length === 3) {
        const isoString = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}T${slashParts[1]}`;
        try { return new Date(isoString); } catch (e) { return null; }
      }
    }
    try {
      const date = new Date(dateString.replace(' ', 'T'));
      if (!isNaN(date.getTime())) return date;
    } catch (e) { /* Fallthrough */ }
    return null;
  };

  const getPrimaryTime = (it) => {
    return it.startTime || it.eventTime || it.peakTime || it.issueTime || it.messageIssueTime || null;
  };

  const originalPrimaryTimeString = getPrimaryTime(item);
  const parsedPrimaryDate = parseApiDate(originalPrimaryTimeString);
  item.sortableTime = parsedPrimaryDate ? parsedPrimaryDate.toISOString() : new Date().toISOString();

  (function formatAllDates(obj) {
    for (const key in obj) {
      if (obj[key] === null || typeof obj[key] === 'undefined') continue;
      if (typeof obj[key] === 'string') {
        const parsedDate = parseApiDate(obj[key]);
        if (parsedDate) obj[key] = parsedDate.toISOString();
      } else if (typeof obj[key] === 'object') {
        formatAllDates(obj[key]);
      }
    }
  })(item);
}


// ---------------------------------------------------------------------------
// NASA STATUS
// ---------------------------------------------------------------------------

async function writeStatus(env, ok, failed, sources, error = null) {
  let prev = {};
  try { prev = JSON.parse(await env.NASA_DONKI_CACHE.get(STATUS_KEY)) || {}; } catch { prev = {}; }
  const now = new Date().toISOString();
  const status = {
    last_attempt: now,
    last_success: ok ? now : (prev.last_success || null),
    failed_categories: failed,
    sources,
    last_error: ok ? null : (error || (failed.length ? `No answer for ${failed.join(', ')}` : null)),
  };
  await env.NASA_DONKI_CACHE.put(STATUS_KEY, JSON.stringify(status));
}

async function readStatus(env) {
  let status = {};
  try { status = JSON.parse(await env.NASA_DONKI_CACHE.get(STATUS_KEY)) || {}; } catch { status = {}; }
  let cachedAt = null;
  try { cachedAt = JSON.parse(await env.NASA_DONKI_CACHE.get(CACHE_KEY))?._metadata?.last_updated || null; } catch { cachedAt = null; }
  const lastSuccess = status.last_success || cachedAt;
  const ageMs = lastSuccess ? Date.now() - Date.parse(lastSuccess) : null;
  return {
    online: ageMs != null && ageMs < OFFLINE_AFTER_MS,
    last_success: lastSuccess,
    cached_at: cachedAt,
    age_minutes: ageMs != null ? Math.round(ageMs / 60000) : null,
    via: (status.sources || []).includes('ccmc') ? 'ccmc' : (status.sources?.length ? 'api.nasa.gov' : null),
    last_attempt: status.last_attempt || null,
    last_error: status.last_error || null,
  };
}
