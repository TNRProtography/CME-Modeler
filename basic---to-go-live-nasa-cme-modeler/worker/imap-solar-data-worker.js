// =====================================================
// RTSW 24h worker - rtsw_wind_1m.json + rtsw_mag_1m.json
// Stateless: fetches both files live on each request.
//
// NEW: Ballistic L1 -> Earth propagation. Each row now carries
//   lag_minutes     - travel time from L1 to the magnetopause at this
//                     row's measured speed (null if speed missing)
//   time_earth_utc  - time_utc + lag_minutes (when this parcel reaches Earth)
// and meta.propagation reports the current lag and which L1 timestamp
// is arriving at Earth right now.
//
// Per-minute redundancy:
//   1. Prefer the satellite flagged active=true at that minute.
//   2. If the active row is missing a value (or no active row
//      exists for that minute), fall back per-field to any other
//      satellite that reported that minute, in priority order
//      SOLAR1 -> IMAP -> ACE -> DSCOVR.
//
// src reports, per field, which satellite supplied the value.
//
// FIX (2026-07-22): NOAA/SWPC was returning HTTP 403 to this Worker's
// fetch() calls while a normal browser request to the same URL worked
// fine. This is a bot-protection/User-Agent check on NOAA's side, not
// a Cloudflare outage. Sending a standard browser User-Agent resolves it.
//
// FIX (2026-08-13): Two issues resolved:
//   1. Cloudflare edge cache was holding a stale response containing
//      NaN values for days. Added cf: { cacheTtl: 0 } to bypass the
//      edge cache and always fetch from NOAA origin.
//   2. NOAA/SWPC occasionally emits bare NaN or Infinity in JSON
//      responses (not valid JSON). fetchJson now reads the response as
//      text and sanitizes NaN/Infinity to null before JSON.parse, so
//      one bad row no longer poisons the entire 24h wind dataset.
// =====================================================

const NZ_TZ = "Pacific/Auckland";

const WIND_URL = "https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json";
const MAG_URL  = "https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json";

const RESPONSE_CACHE_SECONDS = 60;
const FALLBACK_END_BUFFER_MINUTES = 5;

const SAT_PRIORITY = ["SOLAR1", "IMAP", "ACE", "DSCOVR"];

const WIND_FIELDS = ["speed", "density", "temp"];
const MAG_FIELDS  = ["bx", "by", "bz", "bt", "angle"];

// Ballistic propagation from L1 to the dayside magnetopause.
// L1 sits ~1.5 million km sunward; the magnetopause ~10 Re (~64,000 km)
// from Earth, so the effective travel distance is ~1.44M km.
const L1_TO_MAGNETOPAUSE_KM = 1_440_000;

function lagMinutesForSpeed(speedKmS) {
  if (speedKmS == null || !Number.isFinite(speedKmS) || speedKmS < 200) return null;
  return Math.round((L1_TO_MAGNETOPAUSE_KM / speedKmS) / 60 * 10) / 10;
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = (url.pathname || "/").replace(/\/+$/, "") || "/";

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }

      if (path === "/health") {
        return json({ ok: true, service: "rtsw-24h" }, 200, { "Cache-Control": "no-store" });
      }

      if (path !== "/rtsw/merged-24h" && path !== "/") {
        return new Response("Not Found", { status: 404, headers: corsHeaders() });
      }

      const [windResult, magResult] = await Promise.allSettled([
        fetchJson(WIND_URL),
        fetchJson(MAG_URL),
      ]);

      const errors = [];

      if (windResult.status !== "fulfilled") {
        errors.push({ source: "RTSW_WIND_1M", error: windResult.reason?.message || String(windResult.reason) });
      }

      if (magResult.status !== "fulfilled") {
        errors.push({ source: "RTSW_MAG_1M", error: magResult.reason?.message || String(magResult.reason) });
      }

      const now = new Date();

      const windRows = windResult.status === "fulfilled" ? windResult.value : null;
      const magRows  = magResult.status === "fulfilled" ? magResult.value : null;

      const end = chooseSafeWindowEnd(now, windRows, magRows);
      const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);

      const window = {
        start_utc: isoNoMs(start),
        end_utc: isoNoMs(end),
        start_nz: toNzIsoMinute(start),
        end_nz: toNzIsoMinute(end),
        tz: NZ_TZ,
      };

      let windMap = new Map();
      let currentWindSource = null;
      if (windResult.status === "fulfilled") {
        const parsed = parseRows(windResult.value, start, end, extractWindFields);
        windMap = parsed.map;
        currentWindSource = parsed.currentActiveSource;
      }

      let magMap = new Map();
      let currentMagSource = null;
      if (magResult.status === "fulfilled") {
        const parsed = parseRows(magResult.value, start, end, extractMagFields);
        magMap = parsed.map;
        currentMagSource = parsed.currentActiveSource;
      }

      const minutes = buildMinuteGrid(start, end);
      const data = [];

      for (const t of minutes) {
        const keyUtc = minuteKey(t);

        const wind = resolveFields(windMap.get(keyUtc), WIND_FIELDS);
        const mag  = resolveFields(magMap.get(keyUtc), MAG_FIELDS);

        const speed   = wind.values.speed;
        const density = wind.values.density;
        const temp    = wind.values.temp;
        const bx      = mag.values.bx;
        const by      = mag.values.by;
        const bz      = mag.values.bz;
        const bt      = mag.values.bt;
        const angle   = mag.values.angle;

        const clock = computeClockDeg(by, bz);

        // Ballistic propagation: when does this parcel reach Earth?
        const lagMin = lagMinutesForSpeed(speed);
        const timeEarthUtc = lagMin != null
          ? isoNoMs(new Date(t.getTime() + lagMin * 60 * 1000))
          : null;

        const src = {
          speed:   wind.src.speed,
          density: wind.src.density,
          temp:    wind.src.temp,
          bx:      mag.src.bx,
          by:      mag.src.by,
          bz:      mag.src.bz,
          bt:      mag.src.bt,
          angle:   mag.src.angle,
          clock:   clock == null ? null : deriveClockSrc(mag.src.by, mag.src.bz),
        };

        data.push({
          time_utc: keyUtc,
          time_nz: toNzIsoMinute(t),
          lag_minutes: lagMin,
          time_earth_utc: timeEarthUtc,
          speed,
          density,
          temp,
          angle,
          clock,
          bt,
          by,
          bx,
          bz,
          src,
        });
      }

      // Current propagation state: lag at the newest row that has speed,
      // and which L1 timestamp is arriving at Earth right now.
      let currentLagMin = null;
      for (let i = data.length - 1; i >= 0; i--) {
        if (data[i].lag_minutes != null) { currentLagMin = data[i].lag_minutes; break; }
      }
      let arrivingNowUtc = null;
      if (currentLagMin != null) {
        arrivingNowUtc = isoNoMs(new Date(now.getTime() - currentLagMin * 60 * 1000));
      }

      return json(
        {
          ok: true,
          window,
          meta: {
            tz: NZ_TZ,
            priority: ["ACTIVE", ...SAT_PRIORITY],
            current_satellite: {
              wind: currentWindSource,
              mag: currentMagSource,
            },
            propagation: {
              l1_distance_km: L1_TO_MAGNETOPAUSE_KM,
              current_lag_minutes: currentLagMin,
              arriving_now_utc: arrivingNowUtc,
            },
            notes: [
              "Data comes from SWPC rtsw_wind_1m.json and rtsw_mag_1m.json only, fetched live on each request.",
              "Per minute and per field, the satellite flagged active=true is preferred; if it has no value, any other satellite reporting that minute is used in priority order SOLAR1 > IMAP > ACE > DSCOVR.",
              "src reflects, per field, which satellite supplied the value.",
              "lag_minutes/time_earth_utc give ballistic L1->magnetopause propagation at each row's measured speed. Data measured at time_utc affects Earth at time_earth_utc.",
              "meta.propagation.arriving_now_utc is the L1 timestamp whose solar wind is reaching Earth right now.",
              "Wind (speed/density/temp) and mag (bx/by/bz/bt/angle) are independent - a gap in one does not affect the other.",
              "Minutes inside the 24h window that no satellite covers are returned as nulls.",
              "Missing/sentinel values are treated as null.",
              "time_nz is rendered in Pacific/Auckland with automatic DST handling via Intl.DateTimeFormat.",
            ],
            sources_ok: {
              rtsw_wind: windResult.status === "fulfilled",
              rtsw_mag: magResult.status === "fulfilled",
            },
            errors,
          },
          data,
        },
        200,
        { "Cache-Control": `public, max-age=${RESPONSE_CACHE_SECONDS}` }
      );
    } catch (err) {
      return json(
        {
          ok: false,
          error: "Worker exception",
          detail: err?.message || String(err),
          stack: (err?.stack || "").slice(0, 2000),
        },
        500,
        { "Cache-Control": "no-store" }
      );
    }
  },
};

// =====================================================
// Field extractors
// =====================================================
function extractWindFields(r) {
  return {
    speed:   sanitize(toNumOrNull(r.proton_speed)),
    density: sanitize(toNumOrNull(r.proton_density)),
    temp:    sanitize(toNumOrNull(r.proton_temperature)),
  };
}

function extractMagFields(r) {
  return {
    bx:    sanitize(toNumOrNull(r.bx_gsm)),
    by:    sanitize(toNumOrNull(r.by_gsm)),
    bz:    sanitize(toNumOrNull(r.bz_gsm)),
    bt:    sanitize(toNumOrNull(r.bt)),
    angle: sanitize(toNumOrNull(r.phi_gsm)),
  };
}

// =====================================================
// Safe window ending
// =====================================================
function chooseSafeWindowEnd(now, windRows, magRows) {
  const fallbackEnd = new Date(now.getTime() - FALLBACK_END_BUFFER_MINUTES * 60 * 1000);

  const windSet = usableMinuteSet(windRows, extractWindFields);
  const magSet  = usableMinuteSet(magRows, extractMagFields);

  let latestKey = null;

  if (windSet.size > 0 && magSet.size > 0) {
    latestKey = latestCommonMinuteKey(windSet, magSet);
  }

  if (!latestKey && windSet.size > 0 && magSet.size > 0) {
    const latestWind = latestMinuteKey(windSet);
    const latestMag  = latestMinuteKey(magSet);

    if (latestWind && latestMag) {
      latestKey = latestWind < latestMag ? latestWind : latestMag;
    }
  }

  if (!latestKey && windSet.size > 0) {
    latestKey = latestMinuteKey(windSet);
  }

  if (!latestKey && magSet.size > 0) {
    latestKey = latestMinuteKey(magSet);
  }

  if (!latestKey) {
    return fallbackEnd;
  }

  const latestDataMinute = parseSwpcTime(latestKey);
  if (!latestDataMinute) {
    return fallbackEnd;
  }

  return new Date(latestDataMinute.getTime() + 60 * 1000);
}

function usableMinuteSet(rows, extractFields) {
  const set = new Set();

  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== "object") continue;

    const t = parseSwpcTime(r.time_tag);
    if (!t) continue;

    const fields = extractFields(r);
    const hasAnyValue = Object.values(fields).some((v) => v != null);

    if (hasAnyValue) {
      set.add(minuteKey(t));
    }
  }

  return set;
}

function latestMinuteKey(set) {
  let latest = null;

  for (const key of set) {
    if (!latest || key > latest) {
      latest = key;
    }
  }

  return latest;
}

function latestCommonMinuteKey(a, b) {
  let latest = null;

  for (const key of a) {
    if (b.has(key) && (!latest || key > latest)) {
      latest = key;
    }
  }

  return latest;
}

// =====================================================
// Parsing - keep ALL satellites per minute as candidates
// =====================================================
function parseRows(rows, start, end, extractFields) {
  const map = new Map();
  let latestActive = null;

  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== "object") continue;
    const t = parseSwpcTime(r.time_tag);
    if (!t) continue;

    if (r.active === true && (!latestActive || t > latestActive.t)) {
      latestActive = { t, source: r.source || null };
    }

    if (t < start || t >= end) continue;

    const k = minuteKey(t);
    const cand = {
      src: r.source || null,
      active: r.active === true,
      fields: extractFields(r),
    };

    addCandidate(map, k, cand);
  }

  return { map, currentActiveSource: latestActive?.source || null };
}

function addCandidate(map, key, cand) {
  const list = map.get(key);
  if (!list) {
    map.set(key, [cand]);
    return;
  }

  const existing = list.find((c) => c.src === cand.src);
  if (!existing) {
    list.push(cand);
    return;
  }

  existing.active = existing.active || cand.active;

  for (const [f, v] of Object.entries(cand.fields)) {
    if (existing.fields[f] == null && v != null) {
      existing.fields[f] = v;
    }
  }
}

function resolveFields(candidates, fieldNames) {
  const values = {};
  const src = {};

  for (const f of fieldNames) {
    values[f] = null;
    src[f] = null;
  }

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { values, src };
  }

  const sorted = [...candidates].sort((a, b) => candidateRank(a) - candidateRank(b));

  for (const f of fieldNames) {
    for (const c of sorted) {
      const v = c.fields[f];
      if (v != null) {
        values[f] = v;
        src[f] = c.src;
        break;
      }
    }
  }

  return { values, src };
}

function candidateRank(c) {
  const pri = SAT_PRIORITY.indexOf(c.src);
  const priRank = pri === -1 ? SAT_PRIORITY.length : pri;
  return (c.active ? 0 : 100) + priRank;
}

function deriveClockSrc(srcBy, srcBz) {
  if (!srcBy && !srcBz) return null;
  if (srcBy === srcBz) return srcBy;
  return `${srcBy || "?"}+${srcBz || "?"}`;
}

// =====================================================
// FIX (2026-08-13):
//   1. cf: { cacheTtl: 0 } bypasses Cloudflare's edge cache so the
//      Worker always fetches from NOAA origin. Prevents stale/poisoned
//      responses from being served for days.
//   2. Response is read as text and sanitized before JSON.parse.
//      NOAA/SWPC occasionally emits bare NaN or Infinity which are
//      valid JavaScript but NOT valid JSON. This converts them to null
//      so one bad row doesn't blow up the entire dataset.
//
// FIX (2026-07-22): added a browser-like User-Agent header.
// NOAA/SWPC's bot protection was returning HTTP 403 to requests
// without a recognizable User-Agent (which is what Cloudflare
// Workers send by default). This resolves the 403s.
// =====================================================
async function fetchJson(url) {
  const resp = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    },
    cf: { cacheTtl: 0 },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);

  // Read as text first so we can sanitize non-standard JSON values.
  // NOAA occasionally emits bare NaN or Infinity which break JSON.parse.
  const text = await resp.text();
  const sanitized = text
    .replace(/:\s*NaN\b/g, ": null")
    .replace(/:\s*-?Infinity\b/g, ": null");
  return JSON.parse(sanitized);
}

function parseSwpcTime(timeTag) {
  if (!timeTag) return null;
  const cleaned = String(timeTag).replace(" ", "T").replace(/\.\d+$/, "");
  const d = new Date(cleaned.endsWith("Z") ? cleaned : cleaned + "Z");
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function sanitize(n) {
  if (n == null) return null;
  if (n <= -1e30) return null;
  if (Math.abs(n - -9999.9) < 1e-6) return null;
  if (Math.abs(n - -999.9) < 1e-6) return null;
  if (Math.abs(n - -1.0e5) < 1e-3) return null;
  return n;
}

// =====================================================
// NZ time formatting, DST safe: Pacific/Auckland
// =====================================================
const NZ_PARTS_FMT = new Intl.DateTimeFormat("en-NZ", {
  timeZone: NZ_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const NZ_OFFSET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: NZ_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function toNzIsoMinute(dateUtc) {
  const parts = NZ_PARTS_FMT.formatToParts(dateUtc);
  const obj = {};

  for (const p of parts) {
    if (p.type !== "literal") {
      obj[p.type] = p.value;
    }
  }

  const offMin = tzOffsetMinutes(dateUtc, NZ_OFFSET_FMT);
  const sign = offMin >= 0 ? "+" : "-";
  const abs = Math.abs(offMin);
  const offH = String(Math.floor(abs / 60)).padStart(2, "0");
  const offM = String(abs % 60).padStart(2, "0");
  const offset = `${sign}${offH}:${offM}`;

  return `${obj.year}-${obj.month}-${obj.day}T${obj.hour}:${obj.minute}:00${offset}`;
}

function tzOffsetMinutes(dateUtc, formatter) {
  const parts = formatter.formatToParts(dateUtc);
  const vals = {};

  for (const p of parts) {
    if (p.type !== "literal") {
      vals[p.type] = p.value;
    }
  }

  const asIfUtc = Date.UTC(
    Number(vals.year),
    Number(vals.month) - 1,
    Number(vals.day),
    Number(vals.hour),
    Number(vals.minute),
    Number(vals.second)
  );

  return Math.round((asIfUtc - dateUtc.getTime()) / 60000);
}

// =====================================================
// Shared utilities
// =====================================================
function buildMinuteGrid(start, end) {
  const out = [];
  const t0 = new Date(Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate(),
    start.getUTCHours(),
    start.getUTCMinutes(),
    0
  ));

  let t = t0;

  while (t < end) {
    out.push(t);
    t = new Date(t.getTime() + 60 * 1000);
  }

  return out;
}

function minuteKey(d) {
  const y  = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");

  return `${y}-${mo}-${da}T${hh}:${mm}:00Z`;
}

function isoNoMs(d) {
  return d.toISOString().split(".")[0] + "Z";
}

function computeClockDeg(by, bz) {
  if (by == null || bz == null) return null;

  let deg = Math.atan2(by, bz) * (180 / Math.PI);

  if (deg < 0) {
    deg += 360;
  }

  return Math.round(deg * 100) / 100;
}

function toNumOrNull(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;

  const s = String(v).trim();

  if (!s || s.toLowerCase() === "null") {
    return null;
  }

  const n = Number(s);

  return Number.isFinite(n) ? n : null;
}

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    ...extra,
  };
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(extraHeaders),
    },
  });
}

