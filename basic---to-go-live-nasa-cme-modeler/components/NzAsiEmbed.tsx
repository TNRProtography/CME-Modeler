import React, { useMemo } from 'react';

const buildNzAsiHtml = () => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Spot The Aurora | NZ Substorm Index</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root { --bg: #171717; --text: #e5e5e5; --muted: #a3a3a3; --card-bg: rgba(10, 10, 10, 0.8); --border: rgba(64, 64, 64, 0.6); --chart-h: clamp(220px, 38vh, 320px); }
    *, *::before, *::after { box-sizing: border-box; }
    html, body { height: 100%; overflow: hidden; }
    body { margin: 0; padding: 0; font-family: 'Inter', 'SF Pro Display', 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif; background-color: var(--bg); background-image: url('https://spottheaurora.thenamesrock.workers.dev/background-aurora.jpg'); background-size: cover; background-attachment: fixed; color: var(--text); line-height: 1.5; }
    .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: -1; }
    .container { max-width: 100%; margin: 0 auto; padding: 12px; height: 100%; }
    .grid { display: grid; grid-template-columns: 1fr; gap: 12px; height: 100%; align-content: start; }
    @media (min-width: 768px) { .grid { grid-template-columns: 1fr 1fr; } .col-span-2 { grid-column: span 2; } }
    .card { background-color: var(--card-bg); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid var(--border); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; }
    .card-header { display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px; }
    .card-title { font-size: 0.8rem; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 8px;}
    .hero-val { font-size: 4.5rem; font-weight: 900; line-height: 1; text-shadow: 0 0 20px #ffffff40; transition: color 0.3s; }
    .badges { margin-top: 15px; display: flex; gap: 10px; flex-wrap: wrap; }
    .badge { padding: 4px 12px; border-radius: 9999px; font-size: 0.8rem; font-weight: 700; text-transform: uppercase; }
    .badge-phase { background: #262626; border: 1px solid #404040; color: #fff; }
    .badge-alert { border: 1px solid transparent; transition: all 0.3s; }
    .desc { margin-top: 15px; font-size: 0.95rem; color: #d4d4d4; }
    .stat-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.1); }
    .stat-row:last-child { border-bottom: none; }
    .stat-val { font-weight: 700; font-family: monospace; font-size: 1.1rem; }
    .town-group { margin-bottom: 20px; }
    .town-group-title { font-size:0.75rem; text-transform:uppercase; color:var(--muted); margin-bottom:8px; display:flex; align-items:center; gap:6px; font-weight:700;}
    .town-list { display:flex; flex-wrap:wrap; gap:8px; }
    .pill { font-size: 0.8rem; padding: 4px 10px; border-radius: 6px; font-weight: 600; transition: all 0.3s; }
    .pill-red { background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; }
    .pill-yellow { background: rgba(234, 179, 8, 0.15); border: 1px solid rgba(234, 179, 8, 0.3); color: #facc15; }
    .pill-green { background: rgba(34, 197, 94, 0.15); border: 1px solid rgba(34, 197, 94, 0.3); color: #4ade80; }
    .empty-msg { font-size:0.8rem; color:#525252; font-style:italic; }
    .chart-controls { display: flex; gap: 5px; }
    .btn-time { background: #262626; border: 1px solid #3f3f46; color: #a3a3a3; padding: 4px 10px; border-radius: 4px; font-size: 0.75rem; cursor: pointer; font-weight: 600; transition: all 0.2s; }
    .btn-time:hover { background: #404040; color: #e5e5e5; }
    .btn-time.active { background: #0284c7; color: #fff; border-color: #0284c7; }
    .chart-box { width: 100%; height: var(--chart-h); background: rgba(0,0,0,0.2); border-radius: 8px; padding: 0; overflow:hidden; position: relative; cursor:crosshair; }
    #chart-tooltip { position: absolute; pointer-events: none; background: rgba(0,0,0,0.9); border: 1px solid #444; border-radius: 6px; padding: 8px; font-size: 0.8rem; color: #fff; z-index: 10; display: none; box-shadow: 0 4px 6px rgba(0,0,0,0.3); }
    #chart-cursor { position: absolute; top: 0; bottom: 0; width: 1px; background: rgba(255,255,255,0.3); pointer-events: none; display: none; z-index: 5; }
    .vis-warning { margin-top: auto; padding: 12px; background: rgba(234, 179, 8, 0.1); border-left: 3px solid #eab308; color: #fef08a; font-size: 0.85rem; border-radius: 0 4px 4px 0; }
    .outlook-box { background: rgba(14, 165, 233, 0.1); padding: 15px; border-radius: 8px; border: 1px solid rgba(14, 165, 233, 0.3); color: #e0f2fe; font-size: 0.95rem; line-height: 1.6; }
    .legend-row { display: flex; justify-content: center; gap: 15px; margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1); }
    .legend-item { display: flex; align-items: center; gap: 6px; font-size: 0.75rem; color: var(--muted); text-transform: uppercase; font-weight: 700; }
    .dot { width: 10px; height: 10px; border-radius: 50%; }
    .dot-green { background: #4ade80; box-shadow: 0 0 5px #4ade80; }
    .dot-yellow { background: #facc15; box-shadow: 0 0 5px #facc15; }
    .dot-red { background: #f87171; box-shadow: 0 0 5px #f87171; }
    code { font-family: monospace; background: rgba(255,255,255,0.1); padding: 2px 4px; rounded: 4px; }
  </style>
</head>
<body>
  <div class="overlay"></div>
  <div class="container">
    <div class="grid">
      <div class="card">
        <div class="card-title">Current Activity</div>
        <div class="hero-val" id="hero-value">-</div>
        <div class="badges">
          <span class="badge badge-phase" id="hero-phase">-</span>
          <span class="badge badge-alert" id="hero-alert">-</span>
        </div>
        <div class="desc">
          Live deviation from <strong id="station-name">-</strong> baseline.<br/>
          <strong>Slope:</strong> <span id="hero-slope">-</span> /min
        </div>
      </div>

      <div class="card">
        <div class="card-title">Active Visibility Zones</div>
        <div class="town-group">
            <div class="town-group-title">📷 Camera (Long Exposure)</div>
            <div class="town-list" id="towns-cam"></div>
        </div>
        <div class="town-group">
            <div class="town-group-title">📱 Phone (Night Mode)</div>
            <div class="town-list" id="towns-phone"></div>
        </div>
        <div class="town-group">
            <div class="town-group-title">👁️ Naked Eye</div>
            <div class="town-list" id="towns-eye"></div>
        </div>
        <div class="legend-row">
            <div class="legend-item"><div class="dot dot-red"></div> Possible</div>
            <div class="legend-item"><div class="dot dot-yellow"></div> Good</div>
            <div class="legend-item"><div class="dot dot-green"></div> Great</div>
        </div>
        <div class="vis-warning">
          ⚠️ <strong>Requirements:</strong> Clear skies & locations away from city light pollution.
        </div>
      </div>

      <div class="card">
        <div class="card-title">Short-Term Outlook (Next 2 Hours)</div>
        <div class="outlook-box" id="outlook-box"></div>
        <div style="margin-top:12px; font-size:0.8rem; color:var(--muted)">
          Hybrid prediction using real-time Satellite (L1) & Ground data.
        </div>
      </div>

      <div class="card">
        <div class="card-title">Trends (Avg Strength)</div>
        <div class="stat-row"><span class="stat-label">5 min avg</span><span class="stat-val" id="trend-m5">-</span></div>
        <div class="stat-row"><span class="stat-label">30 min avg</span><span class="stat-val" id="trend-m30">-</span></div>
        <div class="stat-row"><span class="stat-label">1 hour avg</span><span class="stat-val" id="trend-h1">-</span></div>
        <div class="stat-row"><span class="stat-label">24h Peak</span><span class="stat-val" id="trend-peak">-</span></div>
      </div>

      <div class="card col-span-2">
        <div class="card-header">
            <div class="card-title" style="margin:0">24 Hour History</div>
            <div class="chart-controls">
                <button class="btn-time" onclick="setChartRange(1)">1H</button>
                <button class="btn-time" onclick="setChartRange(3)">3H</button>
                <button class="btn-time" onclick="setChartRange(6)">6H</button>
                <button class="btn-time" onclick="setChartRange(12)">12H</button>
                <button class="btn-time active" onclick="setChartRange(24)">24H</button>
            </div>
        </div>
        <div class="chart-box" id="chart-container">
            <div id="chart-cursor"></div>
            <div id="chart-tooltip"></div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const TILDE_BASE = "https://tilde.geonet.org.nz/v4";
    const NOAA_MAG = "https://services.swpc.noaa.gov/products/solar-wind/mag-5-minute.json";
    const NOAA_PLASMA = "https://services.swpc.noaa.gov/products/solar-wind/plasma-5-minute.json";
    const DOMAIN = "geomag";
    const DEFAULT_STATION = "EYWM";
    const SCALE_FACTOR = 100;
    const OBAN_LAT = -46.90;
    const AKL_LAT = -36.85;
    const LAT_DELTA = AKL_LAT - OBAN_LAT;
    const REQ_CAM = { start: -300, end: -800 };
    const REQ_PHN = { start: -350, end: -900 };
    const REQ_EYE = { start: -500, end: -1200 };
    const NZ_TOWNS = [
      { name: "Oban", lat: -46.90 },
      { name: "Invercargill", lat: -46.41 },
      { name: "Dunedin", lat: -45.87 },
      { name: "Queenstown", lat: -45.03 },
      { name: "Wānaka", lat: -44.70 },
      { name: "Twizel/Tekapo", lat: -44.26 },
      { name: "Timaru", lat: -44.39 },
      { name: "Christchurch", lat: -43.53 },
      { name: "Kaikōura", lat: -42.40 },
      { name: "Greymouth", lat: -42.45 },
      { name: "Nelson", lat: -41.27 },
      { name: "Wellington", lat: -41.29 },
      { name: "Palmerston Nth", lat: -40.35 },
      { name: "Napier", lat: -39.49 },
      { name: "Taupō", lat: -38.68 },
      { name: "Tauranga", lat: -37.68 },
      { name: "Auckland", lat: -36.85 },
      { name: "Whangārei", lat: -35.72 }
    ];
    const BASELINE_WINDOW_MIN = 180;
    const EXCLUDE_RECENT_MIN = 5;
    const RECOVERY_SLOPE_NT_PER_MIN = 1.5 * SCALE_FACTOR;
    const EXPANSION_SLOPE_NT_PER_MIN = -4.0 * SCALE_FACTOR;
    const DEFAULT_THRESHOLDS = {
      watch: -100, active: -250, strong: -450, severe: -700, extreme: -1000,
    };
    const COLORS = {
      gray: "#525252", green: "#22c55e", yellow: "#eab308", orange: "#f97316", red: "#ef4444", purple: "#a855f7"
    };
    const LEVEL_COLORS = {
      NONE: COLORS.gray, WATCH: COLORS.green, ACTIVE: COLORS.yellow,
      STRONG: COLORS.orange, SEVERE: COLORS.red, EXTREME: COLORS.purple
    };

    const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
    const parseIso = (ts) => { const t = new Date(ts).getTime(); return Number.isFinite(t) ? t : null; };

    const getRequirementForLat = (lat, category) => {
      let reqs = REQ_CAM;
      if (category === 'phone') reqs = REQ_PHN;
      if (category === 'eye') reqs = REQ_EYE;
      const slope = (reqs.end - reqs.start) / LAT_DELTA;
      return reqs.start + (lat - OBAN_LAT) * slope;
    };

    const getTownStatus = (town, currentStrength, category) => {
      if (currentStrength >= 0) return null;
      const required = getRequirementForLat(town.lat, category);
      if (currentStrength <= required) {
        const excess = Math.abs(currentStrength) - Math.abs(required);
        const bufferRed = 50;
        const bufferYellow = 100;
        if (excess < bufferRed) return 'red';
        if (excess < bufferYellow) return 'yellow';
        return 'green';
      }
      return null;
    };

    const getVisibleTowns = (strength) => NZ_TOWNS.map(town => ({
      name: town.name,
      cam: getTownStatus(town, strength, 'camera'),
      phone: getTownStatus(town, strength, 'phone'),
      eye: getTownStatus(town, strength, 'eye')
    }));

    const generateOutlook = (strength, slope, phase, solarWind) => {
      if (solarWind && solarWind.bz !== null && solarWind.speed !== null) {
        const bz = solarWind.bz;
        const speed = solarWind.speed;
        if (bz < -15 && speed > 500) {
          return "⚠️ <strong>WARNING (Satellite):</strong> Severe solar wind shock detected at L1. A major storm is likely to impact NZ within 30-60 minutes. Prepare for eye-visibility conditions.";
        }
        if (bz < -10) {
          return "🚨 <strong>Incoming (Satellite):</strong> Strong negative magnetic field detected upstream. Expect conditions to deteriorate rapidly in the next hour.";
        }
        if (bz < -5) {
          return "📡 <strong>Satellite Watch:</strong> Favorable solar wind conditions detected. A substorm is likely building up for arrival soon.";
        }
        if (bz > 5 && strength > -100) {
          return "🔒 <strong>Locked (Satellite):</strong> Interplanetary magnetic field is North. It is currently blocking energy from entering the atmosphere. Expect quiet conditions.";
        }
      }
      const absSlope = Math.abs(slope || 0);
      if (phase === "Expansion") {
        if (absSlope > (10 * SCALE_FACTOR)) return "🚨 <strong>Rapid Onset:</strong> Intense energy release underway locally. Peak activity expected within 15-30 minutes.";
        return "📉 <strong>Substorm Growth:</strong> Magnetic field is dropping. Expect brightening auroras.";
      }
      if (phase === "Recovery") {
        return "🔄 <strong>Recovery Phase:</strong> Peak has passed. Pulsating patches likely. Cycles often reload every 2-4 hours.";
      }
      if (phase === "Substorm") {
        return "🔥 <strong>Sustained Activity:</strong> Substorm peaking. Good viewing conditions expected to continue.";
      }
      if (strength > (-200 * SCALE_FACTOR) && absSlope < (1 * SCALE_FACTOR)) return "🌙 <strong>Quiet:</strong> Ground sensors are quiet. Waiting for solar wind arrival.";
      if (slope < (-1.0 * SCALE_FACTOR)) return "⚡ <strong>Loading:</strong> Energy is building slowly. A substorm expansion is possible within 60 minutes.";
      return "👀 <strong>Unsettled:</strong> Minor fluctuations. Camera activity possible in Deep South.";
    };

    const fetchNoaaData = async () => {
      try {
        const [magRes, plasmaRes] = await Promise.all([
          fetch(NOAA_MAG).then(r => r.ok ? r.json() : null),
          fetch(NOAA_PLASMA).then(r => r.ok ? r.json() : null)
        ]);
        if (!magRes || !plasmaRes) return null;
        const magHeader = magRes[0];
        const bzIndex = magHeader.indexOf("bz_gsm");
        const lastMag = magRes[magRes.length - 1];
        const bz = parseFloat(lastMag[bzIndex]);
        const plasmaHeader = plasmaRes[0];
        const speedIndex = plasmaHeader.indexOf("speed");
        const lastPlasma = plasmaRes[plasmaRes.length - 1];
        const speed = parseFloat(lastPlasma[speedIndex]);
        return { bz, speed };
      } catch (e) {
        return null;
      }
    };

    const tildeFetch = async (path) => {
      const url = \`\${TILDE_BASE}\${path}\`;
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(\`GeoNet API Error: \${res.status}\`);
      return res.json();
    };

    const discoverSeries = async (station) => {
      const summary = await tildeFetch(\`/dataSummary/\${DOMAIN}?station=\${encodeURIComponent(station)}\`);
      const stationObj = summary?.domain?.[DOMAIN]?.stations?.[station];
      if (!stationObj) throw new Error(\`Station \${station} not found.\`);
      const series = [];
      for (const [sensor, sObj] of Object.entries(stationObj.sensorCodes || {})) {
        for (const [name, nObj] of Object.entries(sObj.names || {})) {
          for (const [method, mObj] of Object.entries(nObj.methods || {})) {
            for (const [aspect, aObj] of Object.entries(mObj.aspects || {})) {
              series.push({ station, sensor, name, method, aspect });
            }
          }
        }
      }
      const score = (s) => {
        let pts = 0; const n = s.name.toLowerCase(); const m = s.method.toLowerCase();
        if (n.includes("north") || n === "x") pts += 20; else if (n.includes("horizontal") || n === "h") pts += 15;
        if (m.includes("1m") || m.includes("60s")) pts += 5;
        return pts;
      };
      series.sort((a, b) => score(b) - score(a));
      if (!series.length) throw new Error("No data found");
      const best = series[0];
      return { key: \`\${best.station}/\${best.name}/\${best.sensor}/\${best.method}/\${best.aspect}\`, ...best };
    };

    const fetchSeriesData = async (key, period) => {
      const data = await tildeFetch(\`/data/\${DOMAIN}/\${key}/latest/\${encodeURIComponent(period)}\`);
      if (!Array.isArray(data) || !data.length) throw new Error("No data returned.");
      const raw = data[0];
      const samples = (raw.data || []).map(d => ({ ts: d.ts, t: parseIso(d.ts), val: d.val })).filter(s => s.t && s.val != null).sort((a, b) => a.t - b.t);
      return { meta: raw.series, samples };
    };

    const getProjectedBaseline = (samples, targetTime, windowMin = 180, excludeMin = 5) => {
      const endWindow = targetTime - excludeMin * 60000;
      const startWindow = targetTime - (windowMin + excludeMin) * 60000;
      const windowPoints = [];
      for (let i = samples.length - 1; i >= 0; i--) {
        const t = samples[i].t;
        if (t > endWindow) continue;
        if (t < startWindow) break;
        windowPoints.push(samples[i]);
      }
      if (windowPoints.length < 10) return null;
      let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
      const n = windowPoints.length;
      for (let i = 0; i < n; i++) {
        const x = (windowPoints[i].t - startWindow) / 60000;
        const y = windowPoints[i].val;
        sumX += x; sumY += y; sumXY += x * y; sumXX += x * x;
      }
      const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
      const intercept = (sumY - slope * sumX) / n;
      const targetX = (targetTime - startWindow) / 60000;
      return slope * targetX + intercept;
    };

    const getAlertLevel = (val, th) => {
      if (val <= th.extreme) return "EXTREME";
      if (val <= th.severe) return "SEVERE";
      if (val <= th.strong) return "STRONG";
      if (val <= th.active) return "ACTIVE";
      if (val <= th.watch) return "WATCH";
      return "NONE";
    };

    const process24h = (samples, thresholds, flip) => {
      if (!samples.length) return { ok: false, points: [] };
      const lastT = samples[samples.length - 1].t;
      const cutoff = lastT - 24 * 3600 * 1000;
      const points = [];
      let minStrength = 0; let minPoint = null;
      for (let i = 0; i < samples.length; i++) {
        if (samples[i].t < cutoff) continue;
        const base = getProjectedBaseline(samples, samples[i].t);
        if (base == null) continue;
        let strength = (samples[i].val - base) * SCALE_FACTOR;
        if (flip) strength = -strength;
        if (strength > 0 && strength < (15 * SCALE_FACTOR)) strength = strength * 0.1;
        strength = clamp(strength, -250000, 250000);
        const level = getAlertLevel(strength, thresholds);
        const p = { t: samples[i].t, ts: samples[i].ts, v: strength, l: level };
        points.push(p);
        if (!minPoint || strength < minStrength) { minStrength = strength; minPoint = p; }
      }
      return { ok: points.length > 0, points, stats: minPoint ? { val: minStrength, at: minPoint.ts, level: minPoint.l } : null };
    };

    const processNow = (samples, thresholds, flip, solarWind) => {
      const last = samples[samples.length - 1];
      const nowT = last.t;
      const baseline = getProjectedBaseline(samples, nowT);
      const safeBaseline = baseline ?? last.val;
      let strength = (last.val - safeBaseline) * SCALE_FACTOR;
      if (flip) strength = -strength;
      const strengthClamped = clamp(strength, -250000, 250000);
      const slopeStart = nowT - 10 * 60000;
      const slopeSet = samples.filter(s => s.t >= slopeStart);
      let slope = null;
      if (slopeSet.length > 1) {
        const first = slopeSet[0];
        const dt = (last.t - first.t) / 60000;
        if (dt > 0) {
            const valNow = last.val * SCALE_FACTOR; const valThen = first.val * SCALE_FACTOR;
            slope = (valNow - valThen) / dt;
            if (flip) slope = -slope;
        }
      }
      let phase = "Growth";
      const absSlope = slope ? Math.abs(slope) : 0;
      if (strengthClamped > thresholds.watch) phase = "Ambient";
      else if (slope != null && slope >= RECOVERY_SLOPE_NT_PER_MIN) phase = "Recovery";
      else if (slope != null && slope <= EXPANSION_SLOPE_NT_PER_MIN) phase = "Expansion";
      else if (strengthClamped <= thresholds.strong && absSlope < (1.0 * SCALE_FACTOR)) phase = "Substorm";

      const avg = (min) => {
        const cut = nowT - min * 60000;
        const subset = samples.filter(s => s.t >= cut);
        if (!subset.length) return 0;
        let sum = 0;
        subset.forEach(s => { let v = (s.val - safeBaseline) * SCALE_FACTOR; if (flip) v = -v; sum += v; });
        return sum / subset.length;
      };

      const visibility = getVisibleTowns(strengthClamped);
      const outlook = generateOutlook(strengthClamped, slope, phase, solarWind);
      return {
        ts: last.ts, baseline: safeBaseline, current: last.val, strength: strengthClamped,
        slope, phase, visibility, outlook,
        alert: getAlertLevel(strengthClamped, thresholds),
        trends: { m5: avg(5), m30: avg(30), h1: avg(60), h3: avg(180) }
      };
    };

    const updateTownList = (id, towns, mode) => {
      const list = towns.filter(t => t[mode] !== null);
      const container = document.getElementById(id);
      if (!container) return;
      if (!list.length) {
        container.innerHTML = '<span class="empty-msg">No towns currently in range</span>';
        return;
      }
      container.innerHTML = list.map(t => \`<span class="pill pill-\${t[mode]}">\${t.name}</span>\`).join('');
    };

    const updateDashboard = (payload) => {
      const alertColor = LEVEL_COLORS[payload.alert] || '#e5e5e5';
      document.getElementById('hero-value').innerHTML = \`\${Math.round(payload.strength)}\`;
      document.getElementById('hero-value').style.color = alertColor;
      document.getElementById('hero-phase').innerText = payload.phase;
      const alertEl = document.getElementById('hero-alert');
      alertEl.innerText = payload.alert;
      alertEl.style.borderColor = alertColor;
      alertEl.style.color = alertColor;
      alertEl.style.backgroundColor = alertColor + '20';
      document.getElementById('hero-slope').innerText = payload.slope != null ? payload.slope.toFixed(1) : '-';
      document.getElementById('outlook-box').innerHTML = payload.outlook;
      document.getElementById('trend-m5').innerText = payload.trends.m5.toFixed(0);
      document.getElementById('trend-m30').innerText = payload.trends.m30.toFixed(0);
      document.getElementById('trend-h1').innerText = payload.trends.h1.toFixed(0);
      const peakEl = document.getElementById('trend-peak');
      if (payload.stats24h) {
        peakEl.innerText = payload.stats24h.val.toFixed(0);
        peakEl.style.color = LEVEL_COLORS[payload.stats24h.level] || '#fff';
      }
      updateTownList('towns-cam', payload.visibility, 'cam');
      updateTownList('towns-phone', payload.visibility, 'phone');
      updateTownList('towns-eye', payload.visibility, 'eye');
    };

    let RAW_DATA = [];
    let currentHours = 24;

    function setChartRange(hours) {
      currentHours = hours;
      document.querySelectorAll('.btn-time').forEach(b => { b.classList.toggle('active', b.innerText === hours + 'H'); });
      const now = RAW_DATA[RAW_DATA.length - 1]?.t;
      if (!now) return;
      const cutoff = now - (hours * 60 * 60 * 1000);
      const points = RAW_DATA.filter(p => p.t >= cutoff);
      if(points.length === 0) {
          document.getElementById('chart-container').innerHTML = '<div style="padding:20px;text-align:center;color:#666">No data for this period</div>';
          return;
      }
      const w = 1000, h = 320;
      const padL = 60, padR = 20, padT = 18, padB = 36;
      const tMin = points[0].t; const tMax = points[points.length - 1].t;
      const vals = points.map(p => p.v);
      let vMin = Math.min(...vals); let vMax = Math.max(...vals);
      if (vMax < 1000) vMax = 1000; if (vMin > -1000) vMin = -1000;
      const range = vMax - vMin; vMax += range * 0.1; vMin -= range * 0.1;
      const X = t => padL + ((t - tMin) / (tMax - tMin)) * (w - padL - padR);
      const Y = v => h - padB - ((v - vMin) / (vMax - vMin)) * (h - padB - padT);
      let gridHtml = ''; const steps = 5;
      for(let i=0; i<=steps; i++) {
          const val = vMin + (i/steps) * (vMax - vMin); const y = Y(val);
          const isZero = Math.abs(val) < (range/20);
          const col = isZero ? '#9ca3af' : '#2a2a2a'; const width = isZero ? 1.5 : 1;
          gridHtml += \`<line x1="\${padL}" y1="\${y}" x2="\${w-padR}" y2="\${y}" stroke="\${col}" stroke-width="\${width}" />\`;
          gridHtml += \`<text x="\${padL-8}" y="\${y+4}" fill="#6b7280" text-anchor="end" font-size="10" font-family="Inter, sans-serif">\${Math.round(val)}</text>\`;
      }
      const vSteps = 8;
      for(let i=0; i<=vSteps; i++) {
          const x = padL + (i / vSteps) * (w - padL - padR);
          gridHtml += \`<line x1="\${x}" y1="\${padT}" x2="\${x}" y2="\${h-padB}" stroke="#1f1f1f" stroke-width="1" />\`;
      }
      const threshLabels = { WATCH: DEFAULT_THRESHOLDS.watch, ACTIVE: DEFAULT_THRESHOLDS.active, STRONG: DEFAULT_THRESHOLDS.strong, SEVERE: DEFAULT_THRESHOLDS.severe };
      let threshHtml = '';
      for(const [k, v] of Object.entries(threshLabels)) {
          if(v < vMin || v > vMax) continue; const y = Y(v);
          threshHtml += \`<line x1="\${padL}" y1="\${y}" x2="\${w-padR}" y2="\${y}" stroke="#404040" stroke-dasharray="4,4" />\`;
          threshHtml += \`<text x="\${w-padR}" y="\${y-4}" fill="#525252" text-anchor="end" font-size="9" font-family="sans-serif">\${k}</text>\`;
      }
      let pathHtml = '';
      const linePoints = points.map(pt => \`\${X(pt.t).toFixed(1)},\${Y(pt.v).toFixed(1)}\`).join(' ');
      pathHtml = \`<polyline points="\${linePoints}" fill="none" stroke="#e5e7eb" stroke-width="1.6" stroke-linejoin="round" />\`;
      let labelsHtml = ''; const labelSteps = 6;
      for(let i=0; i<=labelSteps; i++) {
          const t = tMin + (i/labelSteps) * (tMax - tMin); const x = X(t);
          const date = new Date(t);
          const label = date.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12:false });
          labelsHtml += \`<text x="\${x}" y="\${h-10}" fill="#6b7280" text-anchor="middle" font-size="9" font-family="Inter, sans-serif">\${label}</text>\`;
      }
      const container = document.getElementById('chart-container');
      const oldSvg = container.querySelector('svg');
      if(oldSvg) oldSvg.remove();
      const svgNS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(svgNS, "svg");
      svg.setAttribute("viewBox", \`0 0 \${w} \${h}\`);
      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "100%");
      svg.setAttribute("preserveAspectRatio", "none");
      svg.innerHTML = gridHtml + threshHtml + pathHtml + labelsHtml;
      container.appendChild(svg);
      container.dataset.tMin = tMin; container.dataset.tMax = tMax;
      container.dataset.padL = padL; container.dataset.padR = padR; container.dataset.chartW = w;
    }

    const container = document.getElementById('chart-container');
    const cursor = document.getElementById('chart-cursor');
    const tooltip = document.getElementById('chart-tooltip');

    function handleInput(clientX) {
      if(!container.dataset.tMin) return;
      const rect = container.getBoundingClientRect();
      const x = clientX - rect.left;
      const w = rect.width;
      const padL = parseFloat(container.dataset.padL);
      const padR = parseFloat(container.dataset.padR);
      const chartW = parseFloat(container.dataset.chartW);
      const plotX = (x / w) * chartW;
      if(plotX < padL || plotX > (chartW - padR)) return;
      const tMin = parseFloat(container.dataset.tMin);
      const tMax = parseFloat(container.dataset.tMax);
      const pct = (plotX - padL) / (chartW - padL - padR);
      const timeAtCursor = tMin + pct * (tMax - tMin);
      const activePoints = RAW_DATA.filter(p => p.t >= tMin);
      let closest = activePoints[0];
      let minDiff = Math.abs(timeAtCursor - closest.t);
      for(let i=1; i<activePoints.length; i++) {
          const diff = Math.abs(timeAtCursor - activePoints[i].t);
          if(diff < minDiff) { minDiff = diff; closest = activePoints[i]; }
      }
      cursor.style.display = 'block';
      cursor.style.left = x + 'px';
      tooltip.style.display = 'block';
      const d = new Date(closest.t);
      tooltip.innerHTML = \`<div style="font-weight:700;margin-bottom:2px">\${d.toLocaleTimeString()}</div><div style="color:\${LEVEL_COLORS[closest.l]}">\${Math.round(closest.v)}</div><div style="font-size:0.7em;opacity:0.8">\${closest.l}</div>\`;
      if(x > w/2) tooltip.style.left = (x - 100) + 'px'; else tooltip.style.left = (x + 10) + 'px';
      tooltip.style.top = '20px';
    }

    container.addEventListener('mousemove', e => handleInput(e.clientX));
    container.addEventListener('touchmove', e => { e.preventDefault(); handleInput(e.touches[0].clientX); }, {passive: false});
    container.addEventListener('mouseleave', () => { cursor.style.display = 'none'; tooltip.style.display = 'none'; });
    container.addEventListener('touchend', () => { setTimeout(() => { cursor.style.display = 'none'; tooltip.style.display = 'none'; }, 1000); });

    const init = async () => {
      try {
      const station = DEFAULT_STATION;
      document.getElementById('station-name').innerText = station;
        const [seriesInfo, solarWind] = await Promise.all([discoverSeries(station), fetchNoaaData()]);
        const { samples } = await fetchSeriesData(seriesInfo.key, "2d");
        const nowResult = processNow(samples, DEFAULT_THRESHOLDS, false, solarWind);
        const dailyResult = process24h(samples, DEFAULT_THRESHOLDS, false);
        RAW_DATA = dailyResult.points;
        updateDashboard({ ...nowResult, stats24h: dailyResult.stats });
        setChartRange(24);
      } catch (error) {
        document.getElementById('outlook-box').innerText = 'Unable to load NZ Substorm Index data.';
      }
    };

    init();
  </script>
</body>
</html>
`;

const NzAsiEmbed: React.FC = () => {
  const srcDoc = useMemo(() => buildNzAsiHtml(), []);

  return (
    <iframe
      title="NZ Substorm Index"
      className="absolute top-0 left-0 w-full h-full"
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-same-origin"
    />
  );
};

export default NzAsiEmbed;
