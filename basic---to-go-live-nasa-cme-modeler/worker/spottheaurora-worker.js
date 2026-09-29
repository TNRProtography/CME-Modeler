/*
 * Welcome to the SpotTheAurora Cloudflare Worker!
 *
 * This worker provides a sophisticated aurora forecast. It is designed to be
 * executed every 5 minutes by a Cloudflare Cron Trigger.
 *
 * V17 UPDATE: Solved the "Midnight Problem". The worker now intelligently
 * selects the correct daily forecast (today's or tomorrow's) based on the
 * current time relative to sunset, ensuring accurate moon and sun calculations
 * immediately after midnight.
 *
 * V18 FIX: Implemented robust error handling for NOAA magnetic field data fetches.
 * Prevents NaN values by defaulting bt and bz to 0 when data is unavailable,
 * resolving erratic score calculations.
 *
 * V19 FIX: Added data sanitization to filter out common NOAA placeholder
 * values (e.g., -9999.9) to prevent sporadic, incorrect score spikes.
 *
 * V20 FIX: Moon reduction is now strictly linear: 0.75 GW per 1% illumination,
 * applied only when the Moon is up, with 600 s rise/set ramping. Guarantees:
 * 1%→0.75 GW, 25%→18.75 GW, 50%→37.5 GW, 100%→75 GW.
 *
 * V22 FIX: MAG ingestion is order-agnostic. We select the newest row by time_tag
 * (not by array index), scan newest→older, skip sentinel rows (±9999, etc.),
 * then sanitize & clamp (Bt 0–100 nT, Bz −60–60 nT). This eliminates “current”
 * spikes and works no matter how NOAA orders the array.
 *
 * V23 FIX: Corrected moon reduction logic to ONLY apply the penalty when the
 * moon is verifiably up, based on valid moonrise/moonset data. Removed the
 * inaccurate fallback that assumed the moon was up at night.
 *
 * V24 NEW: Added a score boost for southward Bz (Interplanetary Magnetic Field).
 * The score is boosted linearly as Bz trends towards -20 nT, with a maximum
 * possible score addition of 40 points. This helps the score react more
 * strongly to favorable solar wind conditions.
 *
 * V25 NEW: Location-aware scoring near the start of the pipeline.
 * - Adjusts the "HP needed for 100" based on latitude (threshold shift, not a cap).
 * - Preserves ability for locations north of Greymouth to still hit 100 in extreme storms.
 * - Ensures south of Greymouth clamps to 0 during bright-moon conditions (when moon is up),
 *   while still respecting daytime zeroing via applyTimeOfDayRamp.
 *
 * V26 FIX: NOAA/SWPC returns HTTP 403 to requests without a recognizable
 * User-Agent (which is what Cloudflare Workers send by default). Every fetch
 * to services.swpc.noaa.gov now sends a browser-style User-Agent, restoring
 * hemispheric power and magnetic field ingestion. Non-NOAA fetches (OWM) are
 * unaffected.
 */

// Standard browser User-Agent. NOAA/SWPC blocks requests without a
// recognizable UA. Applied to every services.swpc.noaa.gov fetch below.
const NOAA_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export default {
  /**
   * This function is triggered by a GET request to the worker's URL.
   * IT IS NOW HIGHLY EFFICIENT AND CACHED.
   */
  async fetch(request, env, ctx) {
    const cache = caches.default;
    const cacheUrl = new URL(request.url);
    const cacheKey = new Request(cacheUrl.origin, request);
    let response = await cache.match(cacheKey);

    if (!response) {
      console.log(`Cache miss. Fetching new data from KV.`);
      const apiPayload = await env.AURORA_DATA.get('v1_api_payload', { type: 'json' });

      if (!apiPayload) {
        const initializingPayload = {
          status: "Initializing",
          message: "No forecast data available yet. Check Cron Trigger settings and wait for the next 5-minute interval."
        };
        return new Response(JSON.stringify(initializingPayload, null, 2), {
          status: 503,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      response = new Response(JSON.stringify(apiPayload, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=240'
        },
      });
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    } else {
      console.log(`Cache hit.`);
    }
    return response;
  },

  /**
   * This function is triggered by the cron schedule (e.g., every 5 minutes).
   */
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(this.updateAndStoreData(env));
  },

  /**
   * The main logic function to update and store all data.
   */
  async updateAndStoreData(env) {
    const { hemisphericPower, magData, owmData } = await this.fetchAllData(env);
    if (!owmData?.daily?.[0]) {
      console.error("Halting execution: OpenWeatherMap data is unavailable.");
      return;
    }

    const now = Date.now();
    const now_s = now / 1000;
    const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);

    // --- Select today's vs tomorrow's forecast based on sunset ---
    let relevantForecast = owmData.daily[0];
    if (owmData.daily[1] && now_s > owmData.daily[0].sunset) {
      relevantForecast = owmData.daily[1];
    }

    // Perform all calculations
    const { bt, bz_gsm: bz } = magData;

    // =================================================================
    // --- START: NEW BZ BOOST CALCULATION ---
    // =================================================================
    const MAX_BZ_BOOST_SCORE = 40.0; // The max score bonus when Bz is strong and southward.
    const BZ_FOR_MAX_BOOST = -20.0;  // The Bz value that provides the maximum boost.

    const calculateBzBoost = (currentBz) => {
      // No boost for northward (positive) or zero Bz.
      if (currentBz >= 0) {
        return 0;
      }
      // Clamp the effective Bz so anything more negative than BZ_FOR_MAX_BOOST is treated as the max.
      const effectiveBz = Math.max(currentBz, BZ_FOR_MAX_BOOST);

      // Linearly scale the boost.
      // Example: If Bz is -10 (halfway to max), boost is 20 (half of MAX_BZ_BOOST_SCORE).
      return (effectiveBz / BZ_FOR_MAX_BOOST) * MAX_BZ_BOOST_SCORE;
    };

    const bzScoreBoost = calculateBzBoost(bz);
    // =================================================================
    // --- END: NEW BZ BOOST CALCULATION ---
    // =================================================================

    // =================================================================
    // --- START: LOCATION-AWARE SCORE THRESHOLD (EARLY IN PIPELINE) ---
    // =================================================================
    // Greymouth reference latitude (approx). This is the "baseline" that your
    // original score behavior was effectively tuned around.
    const GREYMOUTH_LAT = -42.45;

    // How many GW (in "HP needed for 100") change per 1 degree of latitude.
    // - North of Greymouth (less negative latitude): requires MORE power for 100.
    // - South of Greymouth (more negative latitude): requires LESS power for 100.
    // This preserves the ability to still reach 100 anywhere (threshold shift, not a cap).
    const GW_PER_DEGREE_LAT = 35.0;

    // Keep the threshold sane and prevent extreme lat configs from exploding the math.
    const MIN_HP_FOR_100 = 120.0; // Very far south bound
    const MAX_HP_FOR_100 = 450.0; // Very far north bound

    const userLat = Number(env.LATITUDE);
    const safeUserLat = Number.isFinite(userLat) ? userLat : GREYMOUTH_LAT;
    const latDelta = safeUserLat - GREYMOUTH_LAT; // + = north, - = south

    // Baseline was "200 GW -> 100 score". Now it's latitude-adjusted.
    let hpFor100 = 200.0 + (latDelta * GW_PER_DEGREE_LAT);
    hpFor100 = Math.max(MIN_HP_FOR_100, Math.min(MAX_HP_FOR_100, hpFor100));
    // =================================================================
    // --- END: LOCATION-AWARE SCORE THRESHOLD ---
    // =================================================================

    // -- MODIFICATION (location-aware): The impact of Hemispheric Power on the score is scaled.
    // It now takes hpFor100 GW of power to reach a score of 100.
    const powerScore = (hemisphericPower / hpFor100) * 100;

    // The base score is now derived from hemispheric power PLUS the Bz boost, clamped between 0 and 100.
    const trueBaseScore = Math.max(0, Math.min(100, powerScore + bzScoreBoost));

    // =================================================================
    // --- START: BRIGHT-MOON SOUTH CLAMP (VISIBILITY GATE) ---
    // =================================================================
    // We compute moon up + illumination once here (no output schema changes),
    // and use it as a final visibility clamp ONLY for locations south of Greymouth.
    const moonVis = this.getMoonVisibility(now_s, relevantForecast);

    // If the user is south of Greymouth and the moon is up and bright enough,
    // clamp the score to 0. This ensures "doesn't show higher than 0" in the
    // bright moon washout case you described.
    //
    // Tune this threshold if desired.
    const SOUTH_BRIGHT_MOON_CUTOFF = 60.0; // % illumination
    const isSouthOfGreymouth = safeUserLat < GREYMOUTH_LAT;
    const isBrightMoonWashout = moonVis.moon_is_up && moonVis.illumination_percent >= SOUTH_BRIGHT_MOON_CUTOFF;
    // =================================================================
    // --- END: BRIGHT-MOON SOUTH CLAMP ---
    // =================================================================

    // Moon reduction (linear) and time-of-day ramping
    const moonReductionGW = this.calculateMoonPowerReduction(now_s, relevantForecast);
    const moonScoreReduction = moonReductionGW * 0.5;
    const moonAdjustedScore = Math.max(0, trueBaseScore - moonScoreReduction);

    let finalScore = this.applyTimeOfDayRamp(moonAdjustedScore, now_s, relevantForecast);

    // Apply the south bright-moon visibility clamp AFTER time-of-day ramping.
    // (Daytime is already zeroed by applyTimeOfDayRamp.)
    if (isSouthOfGreymouth && isBrightMoonWashout) {
      finalScore = 0;
    }

    // Update and store historical data (raw)
    let rawHistory = await env.AURORA_DATA.get('raw_history', { type: 'json' }) || [];
    rawHistory.push({ timestamp: now, baseScore: trueBaseScore, finalScore, hemisphericPower, bz });
    rawHistory = rawHistory.filter(record => record.timestamp > twentyFourHoursAgo);
    await env.AURORA_DATA.put('raw_history', JSON.stringify(rawHistory));

    // Rolling 30-min average
    const thirtyMinutesAgo = now - (30 * 60 * 1000);
    const recentRawHistory = rawHistory.filter(record => record.timestamp > thirtyMinutesAgo);
    const baseSum = recentRawHistory.reduce((sum, r) => sum + r.baseScore, 0);
    const finalSum = recentRawHistory.reduce((sum, r) => sum + r.finalScore, 0);
    const avgBaseScore = recentRawHistory.length ? baseSum / recentRawHistory.length : trueBaseScore;
    const avgFinalScore = recentRawHistory.length ? finalSum / recentRawHistory.length : finalScore;
    const newAveragedRecord = {
      timestamp: now,
      baseScore: parseFloat(avgBaseScore.toFixed(2)),
      finalScore: parseFloat(avgFinalScore.toFixed(2))
    };

    // Update and store historical data (averaged)
    let averagedHistory = await env.AURORA_DATA.get('averaged_history', { type: 'json' }) || [];
    averagedHistory.push(newAveragedRecord);
    averagedHistory = averagedHistory.filter(record => record.timestamp > twentyFourHoursAgo);
    await env.AURORA_DATA.put('averaged_history', JSON.stringify(averagedHistory));

    // Use the relevant forecast to populate sun and moon data
    const { moonrise, moonset, moon_phase, sunrise, sunset } = relevantForecast;
    const illumination_percent = (1 - Math.abs(moon_phase - 0.5) * 2) * 100;
    const moonData = {
      rise: moonrise * 1000,
      set: moonset * 1000,
      illumination: parseFloat(Math.max(0, Math.min(100, illumination_percent)).toFixed(2))
    };
    const sunData = { rise: sunrise * 1000, set: sunset * 1000 };

    const dailyHistory = await this.updateDailyHistory(env, owmData, sunData, moonData);

    const latestScores = {
      spotTheAuroraForecast: newAveragedRecord.finalScore,
      baseScore: newAveragedRecord.baseScore,
      lastUpdated: now,
      inputs: {
        hemisphericPower,
        magneticField: { bt, bz },
        bzScoreBoost: parseFloat(bzScoreBoost.toFixed(2)),
        moonReduction: parseFloat(moonReductionGW.toFixed(2)),
        owmDataLastFetched: owmData.cacheTimestamp
      },
      moon: moonData,
      sun: sunData,
    };

    const last3DaysOfHistory = (dailyHistory || []).reverse().slice(1, 4);

    const finalApiPayload = {
      currentForecast: latestScores,
      historicalData: averagedHistory,
      rawHistory: rawHistory,
      dailyHistory: last3DaysOfHistory,
      owmDailyForecast: owmData?.daily || []
    };

    await env.AURORA_DATA.put('v1_api_payload', JSON.stringify(finalApiPayload));
    await env.AURORA_DATA.put('latest_scores', JSON.stringify(latestScores));
  },

  // --- HELPER FUNCTIONS ---

  async updateDailyHistory(env, owmData, sunData, moonData) {
    if (!owmData?.daily?.[0]?.dt) return [];
    const dailyHistoryKey = 'daily_sun_moon_history';
    let dailyHistory = await env.AURORA_DATA.get(dailyHistoryKey, { type: 'json' }) || [];
    const todayDate = new Date(owmData.daily[0].dt * 1000).toISOString().split('T')[0];
    const lastRecordDate = dailyHistory.length > 0 ? dailyHistory[dailyHistory.length - 1].date : null;

    if (lastRecordDate !== todayDate) {
      dailyHistory.push({ date: todayDate, sun: sunData, moon: moonData });
      if (dailyHistory.length > 4) {
        dailyHistory = dailyHistory.slice(-4);
      }
      await env.AURORA_DATA.put(dailyHistoryKey, JSON.stringify(dailyHistory));
    }
    return dailyHistory;
  },

  // Applies score ramping around dusk/dawn to zero out daytime
  applyTimeOfDayRamp(score, now_ts, dayForecast) {
    if (!dayForecast) return 0;
    const { sunrise, sunset } = dayForecast;

    const duskRampDuration = 1800; // 30 min
    const duskRampStart = sunset - duskRampDuration;
    const duskRampEnd = sunset;

    const dawnRampStart = sunrise - 3600;  // start 60 min before sunrise
    const dawnRampDuration = 2400;         // 40 min ramp window
    const dawnRampEnd = dawnRampStart + dawnRampDuration;

    if (now_ts >= duskRampStart && now_ts < duskRampEnd) {
      return score * ((now_ts - duskRampStart) / duskRampDuration);
    }
    if (now_ts >= dawnRampStart && now_ts < dawnRampEnd) {
      return score * ((dawnRampEnd - now_ts) / dawnRampDuration);
    }
    if (now_ts >= dawnRampEnd && now_ts < duskRampStart) {
      return 0; // Daytime
    }

    return score;
  },

  // NEW: Determine if the moon is up and compute illumination percent (internal use only).
  // This does NOT change your API output schema; it's only used for logic gates.
  getMoonVisibility(now_ts, dayForecast) {
    if (!dayForecast) return { moon_is_up: false, illumination_percent: 0 };

    const { moonrise, moonset, moon_phase } = dayForecast;

    let illumination_percent = (1 - Math.abs(moon_phase - 0.5) * 2) * 100;
    illumination_percent = Math.max(0, Math.min(100, illumination_percent));

    const validRise = typeof moonrise === 'number' && moonrise > 0;
    const validSet  = typeof moonset  === 'number' && moonset > 0;
    let moon_is_up = false;

    if (validRise && validSet) {
      if (moonrise < moonset) {
        moon_is_up = (now_ts >= moonrise && now_ts < moonset);
      } else {
        moon_is_up = (now_ts >= moonrise || now_ts < moonset);
      }
    }

    return { moon_is_up, illumination_percent };
  },

  // Calculates a score reduction based on the moon's illumination and position.
  calculateMoonPowerReduction(now_ts, dayForecast) {
    if (!dayForecast) return 0;

    const { moonrise, moonset, moon_phase } = dayForecast;
    let illumination_percent = (1 - Math.abs(moon_phase - 0.5) * 2) * 100;
    illumination_percent = Math.max(0, Math.min(100, illumination_percent));
    const potential_reduction = illumination_percent * 0.75;

    const validRise = typeof moonrise === 'number' && moonrise > 0;
    const validSet  = typeof moonset  === 'number' && moonset > 0;
    let moon_is_up = false;

    if (validRise && validSet) {
      if (moonrise < moonset) {
        moon_is_up = (now_ts >= moonrise && now_ts < moonset);
      } else {
        moon_is_up = (now_ts >= moonrise || now_ts < moonset);
      }
    }

    if (!moon_is_up) {
      return 0.0;
    }

    const ramp_duration = 600.0; // 10 minutes
    if (now_ts >= moonrise && now_ts < (moonrise + ramp_duration)) {
      return potential_reduction * ((now_ts - moonrise) / ramp_duration);
    }
    if (now_ts > (moonset - ramp_duration) && now_ts < moonset) {
      return potential_reduction * ((moonset - now_ts) / ramp_duration);
    }

    return potential_reduction;
  },

  async getOwmData(env) {
    const CACHE_KEY = `cached_owm_data_v1`;
    const SIX_HOURS_IN_MS = 6 * 60 * 60 * 1000;
    const cached = await env.AURORA_DATA.get(CACHE_KEY, { type: 'json' });
    if (cached && (Date.now() - cached.timestamp < SIX_HOURS_IN_MS)) {
      return { ...cached.data, cacheTimestamp: cached.timestamp };
    }
    const owmUrl = `https://api.openweathermap.org/data/3.0/onecall?lat=${env.LATITUDE}&lon=${env.LONGITUDE}&exclude=current,minutely,hourly,alerts&units=metric&appid=${env.OWM_API_KEY}`;
    try {
      const response = await fetch(owmUrl);
      if (!response.ok) throw new Error(`OWM API request failed: ${response.status}`);
      const newData = await response.json();
      const timestamp = Date.now();
      await env.AURORA_DATA.put(CACHE_KEY, JSON.stringify({ timestamp, data: newData }));
      return { ...newData, cacheTimestamp: timestamp };
    } catch (error) {
      console.error("Failed to fetch new OWM data:", error.message);
      return cached ? { ...cached.data, cacheTimestamp: cached.timestamp } : null;
    }
  },

  async fetchAllData(env) {
    // FIX: NOAA/SWPC returns HTTP 403 to requests without a recognizable
    // User-Agent. Every NOAA fetch below now sends a browser-style UA.
    // The Accept headers are hints to NOAA about what we expect back but
    // aren't strictly required.
    const noaaHeaders = {
      "User-Agent": NOAA_USER_AGENT,
    };

    const hemisphericPowerPromise = fetch(
      "https://services.swpc.noaa.gov/text/ovation_latest_aurora_s.txt",
      { headers: { ...noaaHeaders, Accept: "text/plain" } }
    )
      .then(res => res.ok ? res.text() : "0")
      .then(text => parseFloat(text.match(/Hemispheric Power:\s*([\d\.]+)/)?.[1] || '0'))
      .catch(() => 0);

    const magPromise = fetch(
      "https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json",
      { headers: { ...noaaHeaders, Accept: "application/json" } }
    )
      .then(res => res.ok ? res.json() : [])
      .then(rows => {
        if (!Array.isArray(rows) || rows.length === 0) return {};
        const stamped = rows
          .map(r => ({ r, t: Date.parse(r?.time_tag ?? "") }))
          .filter(item => Number.isFinite(item.t))
          .sort((a, b) => b.t - a.t);
        const sane = stamped.find(({ r }) => {
          const bt = Number(r?.bt);
          const bz = Number(r?.bz_gsm);
          return Number.isFinite(bt) && Number.isFinite(bz) && Math.abs(bt) < 1e3 && Math.abs(bz) < 1e3;
        });
        return (sane ?? stamped[0])?.r || {};
      })
      .catch(() => ({}));

    const owmPromise = this.getOwmData(env);
    const [hemisphericPower, magRow, owmData] = await Promise.all([hemisphericPowerPromise, magPromise, owmPromise]);

    function sanitize(v, { min = -100, max = 100, fallback = 0, absKill = 1e3 } = {}) {
      const n = Number(v);
      if (!Number.isFinite(n) || Math.abs(n) >= absKill) return fallback;
      return Math.min(max, Math.max(min, n));
    }

    const bt     = sanitize(magRow?.bt,     { min: 0,   max: 100, fallback: 0 });
    const bz_gsm = sanitize(magRow?.bz_gsm, { min: -60, max: 60,  fallback: 0 });

    return {
      hemisphericPower: Number.isFinite(hemisphericPower) ? hemisphericPower : 0,
      magData: { bt, bz_gsm },
      owmData
    };
  }
};

