/**
 * Solar Orbiter Worker — Spot The Aurora
 *
 * Endpoints:
 *   GET /solo/imagery        — Latest EUI FSI 174 & 304 image metadata + tile URLs
 *   GET /solo/tile           — Proxy a Helioviewer PNG tile (adds CORS, caches)
 *   GET /solo/position       — Heliocentric XYZ positions of SolO, STEREO-A, Earth
 *   GET /solo/health         — Worker health check
 *
 * KV namespace: SOLO_KV
 * Scheduled cron: every hour (imagery refresh), every 6 hours (position refresh)
 *
 * ─── DATA SOURCES ────────────────────────────────────────────────────────────
 * Imagery: ESA/NASA Helioviewer Project (api.helioviewer.org)
 *   - Solar Orbiter EUI Full Sun Imager (FSI) at 174 Å and 304 Å
 *   - Images available but NOT real-time — latency of hours to days depending
 *     on ground contact schedule and downlink bandwidth
 *   - Tiles served as PNG via Helioviewer getTile API
 *
 * Positions: NASA JPL Horizons REST API (ssd.jpl.nasa.gov)
 *   - Heliocentric ecliptic XYZ in AU, referred to J2000
 *   - Spacecraft IDs: SolO = -144, STEREO-A = -234
 *   - Earth (geocenter) = 399
 *   - Updated 6-hourly; Horizons ephemerides are accurate to sub-km
 *
 * ─── ANGULAR ALIGNMENT NOTE ──────────────────────────────────────────────────
 * SolO crosses the Sun-Earth line approximately once per year for a ~3-4 week
 * window. When the longitudinal separation between SolO and Earth (as seen from
 * the Sun) is < 15°, SolO's MAG data can serve as a 4-15 hour upstream warning.
 * This worker computes and exposes that angle so the frontend can alert users.
 */

const HV_BASE        = 'https://api.helioviewer.org/v2';
const HORIZONS_BASE  = 'https://ssd.jpl.nasa.gov/api/horizons.api';

const KV_IMAGERY_KEY  = 'solo_imagery_latest';
const KV_POSITION_KEY = 'solo_position_latest';

// Helioviewer image channels for SolO EUI FSI
const EUI_CHANNELS = [
  { observatory: 'Solar Orbiter', instrument: 'EUI', detector: 'FSI', measurement: '174', label: 'FSI 174 Å', color: '#f97316', wavelength: 174 },
  { observatory: 'Solar Orbiter', instrument: 'EUI', detector: 'FSI', measurement: '304', label: 'FSI 304 Å', color: '#ef4444', wavelength: 304 },
];

// JPL Horizons spacecraft IDs
// L1 fleet (ACE, DSCOVR, IMAP, SWFO-L1) all orbit the Sun-Earth L1 point ~0.01 AU sunward of Earth.
// At heliocentric scale they're indistinguishable but named individually for the fleet panel.
// IMAP and SWFO-L1 are new (launched Sept 2025) — Horizons name-lookup used as ID fallback.
const SPACECRAFT = {
  solo:    { command: '-144',    name: 'Solar Orbiter', color: '#f97316', group: 'heliocentric' },
  stereoA: { command: '-234',    name: 'STEREO-A',      color: '#a78bfa', group: 'heliocentric' },
  earth:   { command: '399',     name: 'Earth',         color: '#60a5fa', group: 'planet' },
  // L1 fleet — all orbit ~0.01 AU sunward of Earth
  ace:     { command: '-92',     name: 'ACE',           color: '#34d399', group: 'l1fleet', desc: 'Advanced Composition Explorer (1997, NASA)' },
  dscovr:  { command: '-197',    name: 'DSCOVR',        color: '#67e8f9', group: 'l1fleet', desc: 'Deep Space Climate Observatory (2015, NOAA/NASA)' },
  imap:    { command: 'IMAP',    name: 'IMAP',          color: '#f0abfc', group: 'l1fleet', desc: 'Interstellar Mapping & Acceleration Probe (2025, NASA)' },
  swfoL1:  { command: 'SWFO-L1', name: 'SWFO-L1',       color: '#fbbf24', group: 'l1fleet', desc: 'Space Weather Follow-On L1 (2025, NOAA)' },
};

// ─── Main export ──────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return cors();

    if (url.pathname === '/solo/imagery')  return handleImagery(env);
    if (url.pathname === '/solo/tile')     return handleTile(request, env);
    if (url.pathname === '/solo/position') return handlePosition(env);
    if (url.pathname === '/solo/health')   return handleHealth(env);

    return json({ error: 'Not found', endpoints: ['/solo/imagery', '/solo/tile', '/solo/position', '/solo/health'] }, 404);
  },

  async scheduled(evt, env, ctx) {
    const trigger = evt.cron;
    ctx.waitUntil(
      Promise.allSettled([
        runImageryFetch(env).catch(e => console.error('[SOLO-IMG] failed:', e.message)),
        // Positions update every 6h — check if it's time
        shouldRefreshPositions(env).then(yes => yes
          ? runPositionFetch(env).catch(e => console.error('[SOLO-POS] failed:', e.message))
          : Promise.resolve()
        ),
      ])
    );
  },
};

// ─── Should we refresh positions? (every 6h) ─────────────────────────────────
async function shouldRefreshPositions(env) {
  const kv = env.SOLO_KV;
  if (!kv) return true;
  try {
    const ts = await kv.get('SOLO_POSITION_FETCH_TS');
    if (!ts) return true;
    return (Date.now() - Number(ts)) > 6 * 3600 * 1000;
  } catch { return true; }
}

// ─── Cron: Fetch EUI imagery metadata ────────────────────────────────────────
async function runImageryFetch(env) {
  const kv = env.SOLO_KV;
  if (!kv) { console.error('[SOLO-IMG] SOLO_KV not bound'); return; }

  const results = [];

  for (const ch of EUI_CHANNELS) {
    try {
      // Query closest available image to now
      const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
      const params = new URLSearchParams({
        date:        new Date().toISOString(),
        observatory: ch.observatory,
        instrument:  ch.instrument,
        detector:    ch.detector,
        measurement: ch.measurement,
      });

      const res = await fetch(`${HV_BASE}/getClosestImage/?${params}`, {
        cf: { cacheTtl: 300, cacheEverything: true },
      });

      if (!res.ok) {
        console.warn(`[SOLO-IMG] getClosestImage failed for ${ch.label}: ${res.status}`);
        continue;
      }

      const meta = await res.json();

      if (!meta?.id) {
        console.warn(`[SOLO-IMG] No image ID returned for ${ch.label}`);
        continue;
      }

      results.push({
        ...ch,
        imageId:     meta.id,
        date:        meta.date,       // UTC string from Helioviewer
        scale:       meta.scale,      // arcsec/px
        width:       meta.width,
        height:      meta.height,
        // Tile URL pattern (proxied through this worker for CORS)
        // x=0, y=0, zoom=10 gives the full-disk tile at native resolution
        tileUrl:     `/solo/tile?id=${meta.id}&x=0&y=0&zoom=10`,
        helioviewerUrl: `https://helioviewer.org/?date=${encodeURIComponent(meta.date)}&imageLayers=[Solar+Orbiter,EUI,FSI,${ch.measurement},1,100]`,
        fetchedAt:   new Date().toISOString(),
      });

      console.log(`[SOLO-IMG] ${ch.label}: id=${meta.id} date=${meta.date}`);
    } catch (e) {
      console.error(`[SOLO-IMG] error fetching ${ch.label}:`, e.message);
    }
  }

  if (results.length > 0) {
    await kv.put(KV_IMAGERY_KEY, JSON.stringify(results));
    await kv.put('SOLO_IMAGERY_FETCH_TS', Date.now().toString());
    console.log(`[SOLO-IMG] stored ${results.length} channels`);
  } else {
    console.warn('[SOLO-IMG] no imagery fetched - preserving existing KV data');
  }
}

// ─── Cron: Fetch spacecraft positions from JPL Horizons ──────────────────────
async function runPositionFetch(env) {
  const kv = env.SOLO_KV;
  if (!kv) return;

  const positions = {};

  for (const [key, sc] of Object.entries(SPACECRAFT)) {
    try {
      const pos = await fetchHorizonsPosition(sc.command);
      if (pos) {
        positions[key] = { ...sc, ...pos, fetchedAt: new Date().toISOString() };
        console.log(`[SOLO-POS] ${sc.name}: r=${pos.r_au?.toFixed(3)} AU, lon=${pos.lon_deg?.toFixed(1)}°`);
      } else if (sc.group === 'l1fleet' && positions.earth) {
        // L1 fleet fallback: if Horizons doesn't have this new spacecraft yet,
        // place it at the computed L1 point (0.01 AU sunward of Earth)
        const r = positions.earth.r_au;
        const scale = (r - 0.01) / r;
        positions[key] = {
          ...sc,
          x: positions.earth.x * scale,
          y: positions.earth.y * scale,
          z: positions.earth.z * scale,
          r_au: +(r - 0.01).toFixed(6),
          lon_deg: positions.earth.lon_deg,
          lat_deg: positions.earth.lat_deg,
          fetchedAt: new Date().toISOString(),
          positionSource: 'l1_computed',
        };
        console.log(`[SOLO-POS] ${sc.name}: L1 computed fallback`);
      }
    } catch (e) {
      console.error(`[SOLO-POS] error fetching ${sc.name}:`, e.message);
      // L1 fleet fallback on error too
      if (sc.group === 'l1fleet' && positions.earth) {
        const r = positions.earth.r_au;
        const scale = (r - 0.01) / r;
        positions[key] = {
          ...sc,
          x: positions.earth.x * scale, y: positions.earth.y * scale, z: positions.earth.z * scale,
          r_au: +(r - 0.01).toFixed(6),
          lon_deg: positions.earth.lon_deg, lat_deg: positions.earth.lat_deg,
          fetchedAt: new Date().toISOString(),
          positionSource: 'l1_computed_fallback',
        };
      }
    }
  }

  if (Object.keys(positions).length === 0) {
    console.warn('[SOLO-POS] no positions fetched - preserving existing KV data');
    return;
  }

  // Compute derived metrics
  if (positions.solo && positions.earth) {
    // Heliocentric longitude of each body (ecliptic plane projection)
    const soloLon  = Math.atan2(positions.solo.y,  positions.solo.x)  * 180 / Math.PI;
    const earthLon = Math.atan2(positions.earth.y, positions.earth.x) * 180 / Math.PI;

    // Angular separation from Sun-Earth line (absolute longitudinal difference)
    let sep = Math.abs(soloLon - earthLon);
    if (sep > 180) sep = 360 - sep;

    positions.derived = {
      solo_earth_lon_sep_deg:   +sep.toFixed(2),
      solo_is_upstream:         sep < 15,                       // < 15° → useful upstream monitor
      solo_upstream_quality:    sep < 5  ? 'excellent'
                              : sep < 10 ? 'good'
                              : sep < 15 ? 'marginal'
                              : sep < 30 ? 'watch'
                              : 'off-axis',
      solo_warning_lead_hours:  sep < 15 ? estimateLeadTime(positions.solo.r_au) : null,
      note: sep < 15
        ? `SolO is within ${sep.toFixed(1)}° of the Sun-Earth line - magnetic field data may provide ${estimateLeadTime(positions.solo.r_au)}h advance warning of conditions at Earth.`
        : `SolO is ${sep.toFixed(1)}° off the Sun-Earth line - in-situ data not directly predictive for Earth conditions at this separation.`,
    };
  }

  if (positions.stereoA && positions.earth) {
    const stereoLon = Math.atan2(positions.stereoA.y, positions.stereoA.x) * 180 / Math.PI;
    const earthLon  = Math.atan2(positions.earth.y,   positions.earth.x)   * 180 / Math.PI;
    let sep = Math.abs(stereoLon - earthLon);
    if (sep > 180) sep = 360 - sep;
    positions.derived = positions.derived ?? {};
    positions.derived.stereo_earth_lon_sep_deg = +sep.toFixed(2);
  }

  // L1 point — approximately 0.01 AU sunward of Earth along Sun-Earth line
  if (positions.earth) {
    const r = positions.earth.r_au;
    const scale = (r - 0.01) / r;
    positions.l1 = {
      name:  'L1 (Lagrange Point 1)',
      x:     positions.earth.x * scale,
      y:     positions.earth.y * scale,
      z:     positions.earth.z * scale,
      r_au:  +(r - 0.01).toFixed(6),
      color: '#34d399',
    };
  }

  // L1 fleet summary — list all spacecraft confirmed at L1 for the frontend panel
  positions.l1Fleet = Object.entries(SPACECRAFT)
    .filter(([, sc]) => sc.group === 'l1fleet')
    .map(([key]) => ({
      key,
      name:    positions[key]?.name  ?? SPACECRAFT[key].name,
      color:   positions[key]?.color ?? SPACECRAFT[key].color,
      desc:    SPACECRAFT[key].desc,
      r_au:    positions[key]?.r_au  ?? null,
      lon_deg: positions[key]?.lon_deg ?? null,
      positionSource: positions[key]?.positionSource ?? 'horizons',
    }));

  const payload = { positions, fetchedAt: new Date().toISOString() };
  await kv.put(KV_POSITION_KEY, JSON.stringify(payload));
  await kv.put('SOLO_POSITION_FETCH_TS', Date.now().toString());
  console.log('[SOLO-POS] positions stored');
}

// ─── Fetch a single spacecraft position from JPL Horizons ────────────────────
async function fetchHorizonsPosition(command) {
  const now    = new Date();
  const start  = now.toISOString().slice(0, 10);
  const stop   = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);

  const params = new URLSearchParams({
    format:     'json',
    COMMAND:    `'${command}'`,
    OBJ_DATA:   "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'VECTORS'",
    CENTER:     "'500@10'",     // Sun centre
    START_TIME: `'${start}'`,
    STOP_TIME:  `'${stop}'`,
    STEP_SIZE:  "'1d'",
    VEC_TABLE:  "'1'",          // XYZ only (no velocities)
    OUT_UNITS:  "'AU-D'",
    REF_PLANE:  "'ECLIPTIC'",
    REF_SYSTEM: "'J2000'",
  });

  const res = await fetch(`${HORIZONS_BASE}?${params}`, {
    cf: { cacheTtl: 3600, cacheEverything: true },
  });

  if (!res.ok) throw new Error(`Horizons HTTP ${res.status}`);

  const data = await res.json();
  if (data.signature?.source !== 'NASA/JPL Horizons API') {
    throw new Error('Unexpected Horizons response format');
  }

  const result = data.result ?? '';

  // Extract XYZ from the $$SOE / $$EOE block
  // Format: " X = 5.266E-01 Y =-8.149E-01 Z = 2.813E-02"
  const soe = result.indexOf('$$SOE');
  const eoe = result.indexOf('$$EOE');
  if (soe < 0 || eoe < 0) throw new Error('No SOE/EOE markers in Horizons response');

  const block = result.slice(soe, eoe);

  const xMatch = block.match(/X\s*=\s*([-+]?\d+\.\d+E[-+]?\d+)/i);
  const yMatch = block.match(/Y\s*=\s*([-+]?\d+\.\d+E[-+]?\d+)/i);
  const zMatch = block.match(/Z\s*=\s*([-+]?\d+\.\d+E[-+]?\d+)/i);

  if (!xMatch || !yMatch || !zMatch) throw new Error('Could not parse XYZ from Horizons block');

  const x = parseFloat(xMatch[1]);
  const y = parseFloat(yMatch[1]);
  const z = parseFloat(zMatch[1]);
  const r = Math.sqrt(x * x + y * y + z * z);

  // Heliocentric ecliptic longitude in degrees
  const lon_deg = Math.atan2(y, x) * 180 / Math.PI;
  const lat_deg = Math.asin(z / r) * 180 / Math.PI;

  return { x, y, z, r_au: +r.toFixed(6), lon_deg: +lon_deg.toFixed(3), lat_deg: +lat_deg.toFixed(3) };
}

// Estimate warning lead time in hours based on SolO's distance from Sun
// CME travel time from SolO to Earth ≈ CME speed / radial separation
// Approximate: at 0.5 AU separation, ~15h at 700 km/s average CME speed
function estimateLeadTime(soloR) {
  if (!soloR) return null;
  const earthR = 1.0;
  const separationAU = Math.abs(earthR - soloR);
  const separationKm = separationAU * 1.496e8;
  const avgCmeSpeedKmS = 700; // typical CME speed
  const seconds = separationKm / avgCmeSpeedKmS;
  return +(seconds / 3600).toFixed(1);
}

// ─── Endpoint handlers ────────────────────────────────────────────────────────
async function handleImagery(env) {
  const kv = env.SOLO_KV;
  if (!kv) return json({ ok: false, error: 'SOLO_KV not bound' }, 503);

  const raw = await kv.get(KV_IMAGERY_KEY);
  const fetchTs = await kv.get('SOLO_IMAGERY_FETCH_TS');

  if (!raw) {
    return json({
      ok: false,
      error: 'No imagery data yet - check back after first cron run.',
      note: 'SolO EUI imagery is not real-time. Images may be hours to days old depending on ground contact schedule.',
    });
  }

  const channels = JSON.parse(raw);
  return json({
    ok: true,
    source: 'Solar Orbiter EUI (via ESA/NASA Helioviewer Project)',
    last_fetch: fetchTs ? new Date(Number(fetchTs)).toISOString() : null,
    latency_note: 'EUI images are downlinked during scheduled ground station passes. Images are typically hours to ~1 day behind real-time.',
    channels,
  });
}

async function handleTile(request, env) {
  const url = new URL(request.url);
  const id   = url.searchParams.get('id');
  const x    = url.searchParams.get('x') ?? '0';
  const y    = url.searchParams.get('y') ?? '0';
  const zoom = url.searchParams.get('zoom') ?? '10';

  if (!id || !/^\d+$/.test(id)) {
    return new Response('Invalid tile request - id required', { status: 400 });
  }

  const kv = env.SOLO_KV;
  const cacheKey = `tile_${id}_${x}_${y}_${zoom}`;

  // Check KV cache first (tiles are immutable — same id always = same image)
  if (kv) {
    try {
      const cached = await kv.get(cacheKey, { type: 'arrayBuffer' });
      if (cached) {
        return new Response(cached, {
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=86400, immutable',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
    } catch {}
  }

  // Fetch from Helioviewer
  const tileUrl = `${HV_BASE}/getTile/?id=${id}&x=${x}&y=${y}&zoom=${zoom}`;
  const res = await fetch(tileUrl, { cf: { cacheTtl: 86400, cacheEverything: true } });

  if (!res.ok) {
    return new Response(`Helioviewer tile error: ${res.status}`, { status: 502 });
  }

  const buf = await res.arrayBuffer();

  // Cache in KV — tiles are immutable so we can cache indefinitely
  if (kv && buf.byteLength > 0) {
    kv.put(cacheKey, buf, { expirationTtl: 7 * 86400 }).catch(() => {});
  }

  return new Response(buf, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400, immutable',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

async function handlePosition(env) {
  const kv = env.SOLO_KV;
  if (!kv) return json({ ok: false, error: 'SOLO_KV not bound' }, 503);

  const raw = await kv.get(KV_POSITION_KEY);
  if (!raw) {
    return json({
      ok: false,
      error: 'No position data yet - check back after first cron run.',
    });
  }

  const data = JSON.parse(raw);
  return json({ ok: true, ...data });
}

async function handleHealth(env) {
  const kv = env.SOLO_KV;
  if (!kv) return json({ ok: false, error: 'SOLO_KV not bound' }, 503);

  const [imgTs, posTs] = await Promise.all([
    kv.get('SOLO_IMAGERY_FETCH_TS'),
    kv.get('SOLO_POSITION_FETCH_TS'),
  ]);

  const now = Date.now();
  return json({
    ok: true,
    sources: {
      imagery:  { last_fetch: imgTs ? new Date(Number(imgTs)).toISOString() : null, age_min: imgTs ? Math.round((now - Number(imgTs)) / 60000) : null },
      position: { last_fetch: posTs ? new Date(Number(posTs)).toISOString() : null, age_min: posTs ? Math.round((now - Number(posTs)) / 60000) : null },
    },
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function cors() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

