/* Spot The Aurora, marketing site
   The live visibility forecast: Now, 15 min, 30 min, 1 hour, 2 hours.

   Data comes from the same two Cloudflare Workers the app uses, and the slot
   maths is ported from the app's ForecastDashboard.tsx (simpleTimelineSlots)
   and the documented substorm probability model, so the site says exactly what
   the app says.

   One approximation: the substorm worker exposes 30-minute means rather than
   the 15-minute means the app computes from the raw L1 series, so those are
   used in the probability model. Slot wording is identical.

   If either feed fails, the panel shows a link to the app instead. */
(function () {
  'use strict';

  var FORECAST_API = 'https://spottheaurora.thenamesrock.workers.dev/';
  var SUBSTORM_API = 'https://aurora-index-sta.thenamesrock.workers.dev/api/substorm?resolution=5m';
  var GREYMOUTH_LAT = -42.45;
  var REFRESH_MS = 60000;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* --- wording, copied verbatim from the app --- */
  function phraseFor(score, confidence, label) {
    var timeRef = label === 'Now' ? 'right now'
      : label === '15 min' ? 'in the next 15 minutes'
      : label === '30 min' ? 'in the next 30 minutes'
      : label === '1 hour' ? 'over the next hour'
      : 'over the next two hours';

    if (score >= 80) return { tier: 'Naked eye', c: '#ef4444', phrase:
      confidence === 'high' ? 'Go outside now, this could be one of the best displays in years'
      : confidence === 'medium' ? 'Conditions look exceptional, well worth heading out to have a look'
      : 'Could turn into something special, keep a close eye on this' };
    if (score >= 65) return { tier: 'Naked eye', c: '#f97316', phrase:
      confidence === 'high' ? 'You should be able to see it with your own eyes, look south'
      : confidence === 'medium' ? 'Good chance of seeing it with your own eyes in a dark spot'
      : 'Might be visible with your own eyes if conditions stay this way' };
    if (score >= 50) return { tier: 'Naked eye', c: '#eab308', phrase:
      confidence === 'high' ? 'A faint green glow should be visible to the south, find somewhere dark'
      : confidence === 'medium' ? 'A faint glow to the south is possible, get away from street lights'
      : 'Might just be visible to the eye if you find somewhere dark enough' };
    if (score >= 35) return { tier: 'Phone camera', c: '#84cc16', phrase:
      confidence === 'high' ? 'Your phone camera will pick it up, point it south and take a photo'
      : confidence === 'medium' ? 'Worth taking a photo to the south, your phone may surprise you'
      : 'Your phone camera might pick something up if conditions improve' };
    if (score >= 20) return { tier: 'Camera only', c: '#3ddc97', phrase:
      confidence === 'high' ? 'Very faint, only a long exposure camera shot would show anything'
      : confidence === 'medium' ? 'Very faint if anything, not worth going out specially'
      : 'Unlikely to show up even on camera at this stage' };
    return { tier: 'Nothing', c: '#1d9c68', phrase:
      confidence === 'high' ? 'Nothing to see, the sky will look completely normal ' + timeRef
      : confidence === 'medium' ? 'Very quiet ' + timeRef + ', not worth going out'
      : 'Quiet ' + timeRef + ', come back later' };
  }

  /* --- documented substorm probability model --- */
  function probabilities(dPhiNow, dPhiMean, bzMean) {
    var base = Math.tanh(0.015 * (dPhiMean || 0) + 0.01 * (dPhiNow || 0));
    var bzBoost = bzMean < -3 ? 0.10 : bzMean < -1 ? 0.05 : 0;
    return {
      P30: clamp(0.15 + 0.7 * base + bzBoost, 0.01, 0.90),
      P60: clamp(0.25 + 0.6 * base + bzBoost, 0.01, 0.90)
    };
  }

  /* --- the app's slot derivation --- */
  function buildSlots(auroraScore, risk) {
    var sw = (risk && risk.metrics && risk.metrics.solar_wind) || {};
    var cur = (risk && risk.current) || {};
    var workerScore = typeof cur.score === 'number' ? cur.score : null;
    var base = workerScore != null ? workerScore : (auroraScore || 0);
    var spotScore = auroraScore || 0;

    var p = probabilities(sw.newell_coupling_now, sw.newell_avg_30m, sw.avg_30m_bz);
    var sustained = (sw.southward_minutes_30m || 0) >= 10;

    var status = 'QUIET';
    if (cur.bay_onset_flag) status = 'ONSET';
    else if (sustained && p.P30 >= 0.60 && spotScore >= 25) status = 'IMMINENT_30';
    else if (sustained && p.P60 >= 0.60 && spotScore >= 20) status = 'LIKELY_60';
    else if (sustained && spotScore >= 15) status = 'WATCH';

    var trendMult =
      cur.risk_trend === 'Rapidly Increasing' ? 1.15 :
      cur.risk_trend === 'Increasing' ? 1.07 :
      cur.risk_trend === 'Decreasing' ? 0.90 :
      cur.risk_trend === 'Rapidly Decreasing' ? 0.75 : 1.0;

    var nNow = sw.newell_coupling_now || 0, nAvg = sw.newell_avg_30m || 0;
    var newellBoost = (nNow > 0 && nAvg > 0 && nNow > nAvg * 1.2) ? 1.08 : 1.0;
    var mods = function (s) { return clamp(s * trendMult * newellBoost, 0, 100); };
    var boostFromP = function (pr, b) { return Math.min(100, b + pr * (100 - b) * 0.75); };

    var r15, r30, r60;
    switch (status) {
      case 'ONSET':       r15 = Math.min(100, base * 1.05); r30 = base * 0.90; r60 = base * 0.65; break;
      case 'IMMINENT_30': r15 = boostFromP(p.P30, base); r30 = boostFromP(p.P30, base) * 1.05; r60 = boostFromP(p.P60, base) * 0.80; break;
      case 'LIKELY_60':   r15 = base * 1.10; r30 = boostFromP(p.P30 * 0.7, base); r60 = boostFromP(p.P60, base); break;
      case 'WATCH':       r15 = base * 1.05; r30 = base * 1.15; r60 = boostFromP(p.P60 * 0.5, base); break;
      default:            r15 = base * 0.95; r30 = base * 0.85; r60 = base * 0.70;
    }

    var conf = function (slot) {
      if (status === 'ONSET') return slot === '15m' ? 'high' : slot === '30m' ? 'medium' : 'low';
      if (status === 'IMMINENT_30') return slot === '1h' ? 'medium' : 'high';
      if (status === 'LIKELY_60') return slot === '1h' ? 'high' : 'medium';
      if (status === 'WATCH') return slot === '15m' ? 'medium' : 'low';
      return slot === '15m' ? 'high' : slot === '30m' ? 'medium' : 'low';
    };

    return [
      { label: 'Now',     score: Math.round(base),      conf: 'high' },
      { label: '15 min',  score: Math.round(mods(r15)), conf: conf('15m') },
      { label: '30 min',  score: Math.round(mods(r30)), conf: conf('30m') },
      { label: '1 hour',  score: Math.round(mods(r60)), conf: conf('1h') },
      { label: '2 hours', score: Math.round(spotScore), conf: 'low' }
    ].map(function (s) {
      var pf = phraseFor(s.score, s.conf, s.label);
      return { label: s.label, tier: pf.tier, phrase: pf.phrase, c: pf.c };
    });
  }

  /* --- the app's location adjustment: 0.2% per 10 km from Greymouth --- */
  function adjust(base, lat) {
    var km = Math.abs((lat - GREYMOUTH_LAT) * Math.PI / 180) * 6371;
    var a = Math.floor(km / 10) * 0.2;
    return clamp(lat > GREYMOUTH_LAT ? base - a : base + a, 0, 100);
  }

  function nzTime(ts) {
    try {
      return new Date(ts).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', timeZone: 'Pacific/Auckland' });
    } catch (e) { return ''; }
  }

  var mounts = [], userLat = null, rawScore = null, riskData = null, stamp = '';

  function render() {
    if (rawScore == null) return;
    var score = userLat != null ? adjust(rawScore, userLat) : rawScore;
    var slots = buildSlots(score, riskData);
    mounts.forEach(function (el) {
      el.root.classList.remove('is-down');
      el.root.classList.add('is-live');
      el.status.textContent = stamp ? 'Live, updated ' + stamp + ' NZT' : 'Live';
      el.where.textContent = userLat != null ? 'Adjusted for your location' : 'Referenced to Greymouth, West Coast';
      el.slots.innerHTML = slots.map(function (s, i) {
        return '<div class="fc-slot' + (i === 0 ? ' is-now' : '') + '">' +
          '<span class="fc-when">' + s.label + '</span>' +
          '<span class="fc-tier" style="color:' + s.c + '">' + s.tier + '</span>' +
          '<span class="fc-phrase">' + s.phrase + '</span>' +
        '</div>';
      }).join('');
    });
  }

  function fail() {
    mounts.forEach(function (el) {
      el.root.classList.add('is-down');
      el.status.textContent = 'Live forecast unavailable right now';
      el.where.textContent = '';
      el.slots.innerHTML = '<p class="fc-down">The forecast could not be reached from this page. It is still running in the app.</p>';
    });
  }

  function getJSON(url, ms) {
    var c = new AbortController();
    var t = setTimeout(function () { c.abort(); }, ms || 12000);
    return fetch(url + (url.indexOf('?') > -1 ? '&' : '?') + '_=' + Date.now(), { signal: c.signal })
      .then(function (r) { clearTimeout(t); if (!r.ok) throw new Error(r.status); return r.json(); });
  }

  function load() {
    Promise.allSettled([getJSON(FORECAST_API), getJSON(SUBSTORM_API)]).then(function (res) {
      var f = res[0].status === 'fulfilled' ? res[0].value : null;
      riskData = res[1].status === 'fulfilled' ? res[1].value : null;
      var cf = f && f.currentForecast;
      var s = cf && cf.spotTheAuroraForecast;
      if (typeof s !== 'number' || !isFinite(s)) { fail(); return; }
      rawScore = clamp(s, 0, 100);
      stamp = cf.lastUpdated ? nzTime(cf.lastUpdated) : '';

      var hp = cf.inputs && cf.inputs.hemisphericPower;
      var owm = f.owmDailyForecast;
      var mp = owm && owm[0] && owm[0].moon_phase;
      mounts.forEach(function (el) {
        if (typeof hp === 'number') { el.power.textContent = hp.toFixed(0) + ' GW'; el.powerWrap.hidden = false; }
        if (typeof mp === 'number') {
          el.moon.textContent = Math.round((1 - Math.cos(2 * Math.PI * mp)) / 2 * 100) + '%';
          el.moonWrap.hidden = false;
        }
      });
      render();
    }).catch(fail);
  }

  function locate() {
    if (!navigator.geolocation) return;
    mounts.forEach(function (el) { el.locate.disabled = true; el.locate.textContent = 'Locating'; });
    navigator.geolocation.getCurrentPosition(
      function (pos) { userLat = pos.coords.latitude; mounts.forEach(function (el) { el.locate.hidden = true; }); render(); },
      function () { mounts.forEach(function (el) { el.locate.disabled = false; el.locate.textContent = 'Location unavailable'; }); },
      { timeout: 10000, maximumAge: 300000 }
    );
  }

  function mount(root) {
    var q = function (k) { return root.querySelector('[data-lf="' + k + '"]'); };
    root.innerHTML =
      '<div class="lf-head">' +
        '<span class="lf-status" data-lf="status">Loading the live forecast</span>' +
        '<span class="lf-where" data-lf="where"></span>' +
      '</div>' +
      '<div class="fc-slots" data-lf="slots"></div>' +
      '<div class="lf-meta">' +
        '<span class="lf-stat" data-lf="powerWrap" hidden><b data-lf="power"></b> auroral power</span>' +
        '<span class="lf-stat" data-lf="moonWrap" hidden><b data-lf="moon"></b> moon lit</span>' +
      '</div>' +
      '<div class="lf-actions">' +
        '<a class="btn btn-primary btn-sm" href="https://www.spottheaurora.co.nz" target="_blank" rel="noopener">Open the full forecast</a>' +
        '<button class="btn btn-ghost btn-sm" data-lf="locate" type="button">Use my location</button>' +
      '</div>';
    var el = {
      root: root, status: q('status'), where: q('where'), slots: q('slots'),
      power: q('power'), powerWrap: q('powerWrap'),
      moon: q('moon'), moonWrap: q('moonWrap'), locate: q('locate')
    };
    el.locate.addEventListener('click', locate);
    mounts.push(el);
  }

  function init() {
    var nodes = document.querySelectorAll('.live-forecast');
    if (!nodes.length) return;
    Array.prototype.forEach.call(nodes, mount);
    load();
    setInterval(load, REFRESH_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
