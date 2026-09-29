// ============================================================
// Substorm Risk Worker — scientifically revised v2.1
// Unified RTSW Data Integration (Service Binding Enabled)
// CORS enabled for cme-modeler.pages.dev
// ============================================================

const GEONET_API_URL = "https://tilde.geonet.org.nz/v4/data";
const RTSW_MERGED_URL = "https://imap-solar-data-test.thenamesrock.workers.dev/rtsw/merged-24h";

const NZ_MAG_URL =
  `${GEONET_API_URL}/geomag/EY2M/magnetic-field-rate-of-change/50/60s/dH/latest/1d?aggregationPeriod=1m&aggregationFunction=mean`;

const L1_PROPAGATION_MINUTES = 45;

function expectedProtonTemp(speed) {
  const term = 0.031 * speed - 4.39;
  return term > 0 ? term * term * 1000 : 0;
}

export default {
  async fetch(request, env) {
    // ── CORS preflight ────────────────────────────────────────
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        }
      });
    }

    try {
      const url = new URL(request.url);

      if (url.pathname === "/" || url.pathname === "/health") {
        return jsonResponse({
          ok: true,
          service: "substorm-risk-worker",
          version: "2.1.0",
          endpoints: [
            "/api/substorm?resolution=5m",
            "/api/substorm?resolution=1m"
          ],
          l1_propagation_note: `Solar wind data leads ground conditions by ~${L1_PROPAGATION_MINUTES} min`,
          now_utc: new Date().toISOString()
        });
      }

      if (url.pathname === "/api/substorm") {
        const resolution = normaliseResolution(url.searchParams.get("resolution") || "5m");
        const result = await buildSubstormRisk(resolution, env);
        return jsonResponse(result, 200, {
          "Cache-Control": "public, max-age=60, s-maxage=60"
        });
      }

      return jsonResponse({ ok: false, error: "Not found" }, 404);

    } catch (err) {
      return jsonResponse({
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      }, 500);
    }
  }
};

async function buildSubstormRisk(resolution = "5m", env) {
  // MATCHES YOUR DASHBOARD BINDING EXACTLY
  const rtswFetcher = env.RTSW_DATA ? env.RTSW_DATA : globalThis;

  const [geoRes, rtswRes] = await Promise.all([
    fetch(NZ_MAG_URL,   { headers: { Accept: "application/json" } }),
    rtswFetcher.fetch(RTSW_MERGED_URL, { headers: { Accept: "application/json" } })
  ]);

  if (!geoRes.ok)  throw new Error(`GeoNet dH error ${geoRes.status}`);
  if (!rtswRes.ok) throw new Error(`RTSW merged data error ${rtswRes.status}`);

  const [geoJson, rtswJson] = await Promise.all([
    geoRes.json(), rtswRes.json()
  ]);

  const geoSeries = Array.isArray(geoJson) ? geoJson[0] : null;
  const geoData   = Array.isArray(geoSeries?.data) ? geoSeries.data : [];

  if (geoData.length < 60) throw new Error("Not enough GeoNet dH data");

  const dHPoints = geoData
    .map((d) => ({
      ts:     toMinuteMs(d.ts),
      ts_iso: new Date(toMinuteMs(d.ts)).toISOString(),
      val:    Number(d.val)
    }))
    .filter((d) => Number.isFinite(d.val) && Number.isFinite(d.ts))
    .sort((a, b) => a.ts - b.ts);

  const rawCumH = buildRelativeH(dHPoints);

  const rtswData = Array.isArray(rtswJson?.data) ? rtswJson.data : [];

  const magPoints = rtswData
    .map((r) => ({
      ts: toMinuteMs(r.time_utc),
      bz: safeNum(r.bz),
      bt: safeNum(r.bt)
    }))
    .filter((r) => Number.isFinite(r.ts) && Number.isFinite(r.bz) && Number.isFinite(r.bt))
    .sort((a, b) => a.ts - b.ts);

  if (magPoints.length < 60) throw new Error("Not enough RTSW magnetic data");

  const plasmaPoints = rtswData
    .map((r) => ({
      ts:          toMinuteMs(r.time_utc),
      density:     safeNum(r.density),
      speed:       safeNum(r.speed),
      temperature: safeNum(r.temp)
    }))
    .filter((r) => Number.isFinite(r.ts) && Number.isFinite(r.density) && Number.isFinite(r.speed))
    .sort((a, b) => a.ts - b.ts);

  if (plasmaPoints.length < 60) throw new Error("Not enough RTSW plasma data");

  const merged = mergeSeriesToGeoTimeline(dHPoints, rawCumH, magPoints, plasmaPoints);
  if (merged.length < 60) throw new Error("Not enough merged timeline points");

  applySqBaseline(merged);

  const fullHistory = computeScoreHistory(merged);
  if (fullHistory.length < 60) throw new Error("Could not compute score history");

  const current    = fullHistory[fullHistory.length - 1];
  const history24h = downsampleHistory(fullHistory, resolution);

  return {
    ok:          true,
    updated_utc: new Date().toISOString(),
    resolution,
    l1_propagation_minutes: L1_PROPAGATION_MINUTES,
    l1_propagation_note:    `Solar wind data leads ground conditions by ~${L1_PROPAGATION_MINUTES} min`,
    current: {
      score:            current.score,
      level:            current.level,
      confidence:       current.confidence,
      confidence_text:  current.confidence_text,
      risk_increasing:  current.risk_increasing,
      risk_trend:       current.risk_trend,
      bay_onset_flag:   current.bay_onset_flag,
      cme_sheath_flag:  current.cme_sheath_flag,
      summary:          current.summary,
      timestamp_utc:    current.timestamp_utc
    },
    thresholds: {
      confidence_hidden_below_score: 30,
      nz_aurora_kp_threshold:        "Kp 6-7 (geomag lat ~-45°)"
    },
    source_data: {
      geonet_station: geoSeries?.series?.station || "EY2M",
      geonet_series:  geoSeries?.series || null
    },
    metrics:     current.metrics,
    history_24h: history24h
  };
}

function applySqBaseline(merged) {
  for (let i = 0; i < merged.length; i++) {
    const start = Math.max(0, i - 59);
    const window = merged.slice(start, i + 1).map((r) => Math.abs(r.dH_raw));
    window.sort((a, b) => a - b);
    const median = window[Math.floor(window.length / 2)];
    merged[i].dH = Math.max(0, Math.abs(merged[i].dH_raw) - median * 0.5);
  }
}

function computeScoreHistory(merged) {
  const history = [];

  for (let i = 0; i < merged.length; i++) {
    if (i < 59) continue;

    const row = merged[i];

    const dHVals5  = sliceVals(merged, i,  5, "dH");
    const dHVals10 = sliceVals(merged, i, 10, "dH");
    const dHVals15 = sliceVals(merged, i, 15, "dH");
    const hVals30  = sliceVals(merged, i, 30, "H");
    const hVals60  = sliceVals(merged, i, 60, "H");

    const bzVals10 = sliceVals(merged, i, 10, "bz");
    const bzVals30 = sliceVals(merged, i, 30, "bz");
    const bzVals60 = sliceVals(merged, i, 60, "bz");

    const speedVals30 = sliceVals(merged, i, 30, "speed");
    const speedVals60 = sliceVals(merged, i, 60, "speed");

    const densityVals30 = sliceVals(merged, i, 30, "density");

    const rows30 = sliceRows(merged, i, 30);
    const pressureVals30 = rows30.map((p) => dynamicPressure(p.density, p.speed));

    const newellVals30 = rows30.map((p) => newellCoupling(p.bz, p.bt, p.speed));
    const newellVals60 = sliceRows(merged, i, 60).map((p) => newellCoupling(p.bz, p.bt, p.speed));

    const latestDH   = row.dH;
    const avg5DH     = mean(dHVals5);
    const avg10DH    = mean(dHVals10);
    const avg15DH    = mean(dHVals15);
    const max15DH    = max(dHVals15);
    const slope5DH   = lsSlope(dHVals5);
    const slope10DH  = lsSlope(dHVals10);

    const meanH60    = mean(hVals60);
    const minH30     = min(hVals30);
    const hBayDepth  = meanH60 - minH30;
    const bayOnset   = hBayDepth > 30;

    const latestBz    = row.bz;
    const latestBt    = row.bt;
    const latestSpeed = row.speed;
    const latestDens  = row.density;
    const latestTemp  = row.temperature;

    const avg10Bz  = mean(bzVals10);
    const avg30Bz  = mean(bzVals30);
    const avg60Bz  = mean(bzVals60);
    const min30Bz  = min(bzVals30);
    const southMin30 = count(bzVals30, (v) => v < 0);
    const southMin60 = count(bzVals60, (v) => v < 0);

    const avg30Speed = mean(speedVals30);
    const avg60Speed = mean(speedVals60);
    const avg30Dens  = mean(densityVals30);
    const dynP       = dynamicPressure(latestDens, latestSpeed);
    const avg30DynP  = mean(pressureVals30);

    const avgNewell30 = mean(newellVals30);
    const avgNewell60 = mean(newellVals60);
    const latestNewell = newellCoupling(latestBz, latestBt, latestSpeed);

    const tempExp    = expectedProtonTemp(latestSpeed);
    const tempRatio  = tempExp > 0 ? latestTemp / tempExp : 1;
    const cmeSheath  = tempRatio < 0.5 || tempRatio > 4.0;

    const geoLatest  = clamp(scale(latestDH,  0,  80, 0, 100), 0, 100);
    const geoAvg     = clamp(scale(avg15DH,   0,  50, 0, 100), 0, 100);
    const geoBurst   = clamp(scale(max15DH,   0, 100, 0, 100), 0, 100);
    const geoBay     = bayOnset ? 100 : 0;

    const geomagScore =
      geoLatest * 0.35 +
      geoAvg    * 0.30 +
      geoBurst  * 0.20 +
      geoBay    * 0.15;

    const cmeFactor = cmeSheath ? 1.10 : 1.0;

    const newellNow       = clamp(scale(latestNewell, 0, 10000, 0, 100), 0, 100);
    const newellPersist30 = clamp(scale(avgNewell30,  0,  8000, 0, 100), 0, 100);
    const newellPersist60 = clamp(scale(avgNewell60,  0,  6000, 0, 100), 0, 100);

    const bzNow     = clamp(scale(-latestBz,  0, 25, 0, 100), 0, 100);
    const bzPersist = clamp(scale(-avg30Bz,   0, 20, 0, 100), 0, 100);
    const bzMin     = clamp(scale(-min30Bz,   0, 30, 0, 100), 0, 100);
    const southPersist = clamp(scale(southMin30, 0, 30, 0, 100), 0, 100);

    const speedScore = clamp(scale(latestSpeed, 300, 800, 0, 100), 0, 100);
    const pressScore = clamp(scale(dynP, 0.5, 20, 0, 100), 0, 100);
    const btScore    = clamp(scale(latestBt,  3, 25, 0, 100), 0, 100);

    const solarRaw =
      newellNow       * 0.28 +
      newellPersist30 * 0.20 +
      newellPersist60 * 0.12 +
      bzNow           * 0.12 +
      bzPersist       * 0.10 +
      southPersist    * 0.06 +
      speedScore      * 0.06 +
      pressScore      * 0.04 +
      btScore         * 0.02;

    const solarScore = clamp(solarRaw * cmeFactor, 0, 100);

    const scoreRaw = solarScore * 0.70 + geomagScore * 0.30;
    const score    = Math.round(clamp(scoreRaw, 0, 100));
    const level    = scoreToLevel(score);

    let confidence     = null;
    let confidenceText = "Unlikely for noteworthy activity";

    if (score >= 30) {
      const dataAge = Date.now() - row.ts;
      const dataFresh = clamp(scale(dataAge, 0, 10 * 60 * 1000, 100, 0), 0, 100);
      const crossConsistency = geomagScore > 40 && solarScore > 40 ? 100 :
                               geomagScore > 20 && solarScore > 20 ? 60  : 30;
      const persistConf = clamp(scale(southMin60, 0, 60, 0, 100), 0, 100);
      const bayConf = bayOnset ? 100 : 0;
      const newellConsistency = avgNewell60 > 0
        ? clamp(scale(avgNewell30 / avgNewell60, 0.5, 1.5, 0, 100), 0, 100)
        : 0;

      const confRaw =
        dataFresh        * 0.15 +
        crossConsistency * 0.25 +
        persistConf      * 0.20 +
        bayConf          * 0.20 +
        newellConsistency * 0.20;

      confidence     = Math.round(clamp(confRaw, 0, 100));
      confidenceText = confidenceToText(confidence);
    }

    const riskIncreasing = isRiskIncreasing({
      latestDH, avg10DH, slope5DH, slope10DH,
      latestBz, avg10Bz, avg30Bz, latestNewell, avgNewell30,
      latestSpeed, avg30Speed, dynP, avg30DynP
    });

    const riskTrend = getRiskTrend({
      latestDH, avg10DH, slope5DH,
      latestBz, avg10Bz, latestNewell, avgNewell30,
      latestSpeed, avg30Speed, dynP, avg30DynP
    });

    history.push({
      timestamp_utc:   row.ts_iso,
      score,
      level,
      confidence,
      confidence_text: confidenceText,
      risk_increasing: riskIncreasing,
      risk_trend:      riskTrend,
      bay_onset_flag:  bayOnset,
      cme_sheath_flag: cmeSheath,
      summary: buildSummary({ score, level, confidence, increasing: riskIncreasing, bayOnset, cmeSheath }),
      metrics: {
        geomag: {
          latest_dH_corrected:  round2(latestDH),
          avg_5m_dH:            round2(avg5DH),
          avg_10m_dH:           round2(avg10DH),
          avg_15m_dH:           round2(avg15DH),
          max_15m_dH:           round2(max15DH),
          ls_slope_5m_dH:       round2(slope5DH),
          ls_slope_10m_dH:      round2(slope10DH),
          h_bay_depth_nT:       round2(hBayDepth),
          bay_onset_detected:   bayOnset,
          geomag_score:         round2(geomagScore)
        },
        solar_wind: {
          bz:                   round2(latestBz),
          bt:                   round2(latestBt),
          avg_10m_bz:           round2(avg10Bz),
          avg_30m_bz:           round2(avg30Bz),
          avg_60m_bz:           round2(avg60Bz),
          min_30m_bz:           round2(min30Bz),
          southward_minutes_30m: southMin30,
          southward_minutes_60m: southMin60,
          speed:                round2(latestSpeed),
          avg_30m_speed:        round2(avg30Speed),
          avg_60m_speed:        round2(avg60Speed),
          density:              round2(latestDens),
          avg_30m_density:      round2(avg30Dens),
          dynamic_pressure_nPa: round2(dynP),
          avg_30m_pressure_nPa: round2(avg30DynP),
          newell_coupling_now:  round2(latestNewell),
          newell_avg_30m:       round2(avgNewell30),
          newell_avg_60m:       round2(avgNewell60),
          temperature_K:          round2(latestTemp),
          temperature_expected_K: round2(tempExp),
          temperature_ratio:    round2(tempRatio),
          cme_sheath_flag:      cmeSheath,
          solar_loading_score:  round2(solarScore)
        },
        l1_propagation_minutes: L1_PROPAGATION_MINUTES
      }
    });
  }

  return history;
}

function newellCoupling(bz, bt, speed) {
  if (!Number.isFinite(bz) || !Number.isFinite(bt) || !Number.isFinite(speed)) return 0;
  if (bt <= 0) return 0;
  const bzClamped = clamp(bz, -bt, bt);
  const sinHalf   = Math.sqrt((1 - bzClamped / bt) / 2);
  const v43  = Math.pow(Math.max(speed, 0), 4 / 3);
  const bt23 = Math.pow(bt, 2 / 3);
  const sin83 = Math.pow(sinHalf, 8 / 3);
  return v43 * bt23 * sin83;
}

function lsSlope(arr) {
  const n = arr.length;
  if (n < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX  += i; sumY  += arr[i];
    sumXY += i * arr[i]; sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
}

function buildRelativeH(dHPoints) {
  const result = new Map();
  let cumH = 0;
  const values = [];
  for (const p of dHPoints) {
    cumH += p.val;
    values.push(cumH);
    result.set(p.ts, cumH);
  }
  if (values.length > 0) {
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    for (const [ts, v] of result) result.set(ts, v - avg);
  }
  return result;
}

function mergeSeriesToGeoTimeline(dHPoints, relHMap, magPoints, plasmaPoints) {
  const merged = [];
  let magIdx = 0, plasmaIdx = 0;
  let currentMag = null, currentPlasma = null;
  for (const g of dHPoints) {
    while (magIdx < magPoints.length && magPoints[magIdx].ts <= g.ts) currentMag = magPoints[magIdx++];
    while (plasmaIdx < plasmaPoints.length && plasmaPoints[plasmaIdx].ts <= g.ts) currentPlasma = plasmaPoints[plasmaIdx++];
    if (!currentMag || !currentPlasma) continue;
    merged.push({
      ts: g.ts, ts_iso: g.ts_iso,
      dH_raw: g.val, dH: Math.abs(g.val),
      H: relHMap.get(g.ts) ?? 0,
      bz: currentMag.bz, bt: currentMag.bt,
      density: currentPlasma.density, speed: currentPlasma.speed,
      temperature: currentPlasma.temperature
    });
  }
  return merged;
}

function isRiskIncreasing({ latestDH, avg10DH, slope5DH, slope10DH, latestBz, avg10Bz, avg30Bz, latestNewell, avgNewell30, latestSpeed, avg30Speed, dynP, avg30DynP }) {
  let signals = 0;
  if (latestDH > avg10DH * 1.15)        signals++;
  if (slope5DH > 1.0)                    signals++;
  if (latestNewell > avgNewell30 * 1.20) signals++;
  if (latestBz < avg10Bz - 2.0)         signals++;
  if (latestBz < avg30Bz - 3.0)         signals++;
  if (latestSpeed > avg30Speed + 25)     signals++;
  if (dynP > avg30DynP * 1.20)          signals++;
  return signals >= 3;
}

function getRiskTrend({ latestDH, avg10DH, slope5DH, latestBz, avg10Bz, latestNewell, avgNewell30, latestSpeed, avg30Speed, dynP, avg30DynP }) {
  let rising = 0, falling = 0;
  if (latestDH > avg10DH * 1.20)         rising++;
  if (slope5DH > 2.0)                     rising++;
  if (latestNewell > avgNewell30 * 1.30)  rising++;
  if (latestBz < avg10Bz - 2.5)           rising++;
  if (latestSpeed > avg30Speed + 30)      rising++;
  if (dynP > avg30DynP * 1.25)           rising++;
  if (latestDH < avg10DH * 0.80)         falling++;
  if (slope5DH < -1.5)                    falling++;
  if (latestNewell < avgNewell30 * 0.70)  falling++;
  if (latestBz > avg10Bz + 2.5)           falling++;
  if (latestSpeed < avg30Speed - 25)      falling++;
  if (dynP < avg30DynP * 0.80)           falling++;
  if (rising  >= 4) return "Rapidly Increasing";
  if (rising  >= 2) return "Increasing";
  if (falling >= 4) return "Rapidly Decreasing";
  if (falling >= 2) return "Decreasing";
  return "Stable";
}

function scoreToLevel(score) {
  if (score < 10) return "Very Quiet";
  if (score < 20) return "Quiet";
  if (score < 30) return "Unsettled";
  if (score < 40) return "Disturbed";
  if (score < 50) return "Developing";
  if (score < 60) return "Active";
  if (score < 70) return "Strong";
  if (score < 80) return "Severe";
  if (score < 90) return "Intense";
  return "Extreme";
}

function confidenceToText(confidence) {
  if (confidence < 20) return "Very low confidence of a noteworthy substorm";
  if (confidence < 35) return "Low confidence of a noteworthy substorm";
  if (confidence < 50) return "Slight chance of a substorm";
  if (confidence < 65) return "Substorm possible";
  if (confidence < 80) return "Substorm likely";
  if (confidence < 90) return "Substorm highly likely";
  return "Substorm appears imminent";
}

function buildSummary({ score, level, confidence, increasing, bayOnset, cmeSheath }) {
  if (score < 30) return "Quiet — unlikely for noteworthy activity";
  let text = `${level} conditions`;
  if (confidence !== null) text += ` · ${confidence}% confidence of substorm`;
  if (bayOnset)            text += " · Negative bay detected (possible onset)";
  if (cmeSheath)           text += " · CME/sheath interval suspected";
  if (increasing)          text += " · Risk increasing";
  return text;
}

function downsampleHistory(history, resolution) {
  const minutes = resolutionToMinutes(resolution);
  if (minutes <= 1) return history;
  return history.filter((_, idx) => idx % minutes === 0);
}

function normaliseResolution(res) {
  return new Set(["1m", "5m", "10m", "15m"]).has(res) ? res : "5m";
}

function resolutionToMinutes(res) {
  return { "1m": 1, "5m": 5, "10m": 10, "15m": 15 }[res] ?? 5;
}

function sliceVals(arr, endIdx, countBack, key) {
  const start = Math.max(0, endIdx - countBack + 1);
  return arr.slice(start, endIdx + 1).map((r) => r[key]).filter(Number.isFinite);
}

function sliceRows(arr, endIdx, countBack) {
  const start = Math.max(0, endIdx - countBack + 1);
  return arr.slice(start, endIdx + 1);
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function max(arr)  { return arr.length ? Math.max(...arr) : 0; }
function min(arr)  { return arr.length ? Math.min(...arr) : 0; }

function count(arr, fn) {
  let t = 0;
  for (const v of arr) if (fn(v)) t++;
  return t;
}

function dynamicPressure(density, speed) {
  return 1.6726e-6 * density * speed * speed;
}

function scale(value, inMin, inMax, outMin, outMax) {
  if (inMax === inMin) return outMin;
  const t = (value - inMin) / (inMax - inMin);
  return outMin + t * (outMax - outMin);
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function round2(v) { return Math.round(v * 100) / 100; }

function toMinuteMs(ts) {
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? Math.floor(ms / 60000) * 60000 : NaN;
}

// ── CORS headers on every response ───────────────────────────
function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      ...extraHeaders
    }
  });
}

