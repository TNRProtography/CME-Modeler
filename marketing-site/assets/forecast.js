/* Spot The Aurora, marketing site
   Live aurora forecast, pulled from the same Cloudflare Worker the app uses.
   This is the real current score, not a screenshot.

   Score bands and wording are copied from the app (ForecastDashboard.tsx) so
   the site never says something different from the app itself.

   If the request fails for any reason, the widget shows a plain link to the
   app instead of a broken panel. */
(function () {
  'use strict';

  var API = 'https://spottheaurora.thenamesrock.workers.dev/';
  var GREYMOUTH_LAT = -42.45;
  var REFRESH_MS = 60000;

  // Same bands the app uses.
  function band(score) {
    if (score >= 80) return { tier: 'Naked eye',    phrase: 'Go outside now, this could be one of the best displays in years.', c: '#ef4444' };
    if (score >= 65) return { tier: 'Naked eye',    phrase: 'You should be able to see it with your own eyes. Look south.',      c: '#f97316' };
    if (score >= 50) return { tier: 'Naked eye',    phrase: 'A faint green glow should be visible to the south. Find somewhere dark.', c: '#eab308' };
    if (score >= 35) return { tier: 'Phone camera', phrase: 'Your phone camera will pick it up. Point it south and take a photo.', c: '#84cc16' };
    if (score >= 20) return { tier: 'Camera only',  phrase: 'Very faint. Only a long exposure would show anything.',             c: '#3ddc97' };
    return               { tier: 'Nothing',      phrase: 'Nothing to see, the sky will look completely normal right now.',    c: '#1d9c68' };
  }

  // Same latitude adjustment as the app: 0.2% per 10 km from Greymouth.
  function adjust(base, lat) {
    var km = Math.abs((lat - GREYMOUTH_LAT) * Math.PI / 180) * 6371;
    var adj = Math.floor(km / 10) * 0.2;
    var v = lat > GREYMOUTH_LAT ? base - adj : base + adj;
    return Math.max(0, Math.min(100, v));
  }

  function nzTime(ts) {
    try {
      return new Date(ts).toLocaleTimeString('en-NZ', {
        hour: 'numeric', minute: '2-digit', timeZone: 'Pacific/Auckland'
      });
    } catch (e) { return ''; }
  }

  var mounts = [], userLat = null, baseScore = null;

  function paint() {
    if (baseScore == null) return;
    mounts.forEach(paintOne);
  }

  function paintOne(el) {
    var score = userLat != null ? adjust(baseScore, userLat) : baseScore;
    var b = band(score);
    el.score.textContent = Math.round(score) + '%';
    el.score.style.color = b.c;
    el.bar.style.width = Math.max(2, score) + '%';
    el.bar.style.background = b.c;
    el.tier.textContent = b.tier;
    el.phrase.textContent = b.phrase;
    el.where.textContent = userLat != null
      ? 'Adjusted for your location'
      : 'Referenced to Greymouth, West Coast';
  }

  function fail() {
    mounts.forEach(function (el) {
      el.root.classList.add('is-down');
      el.status.textContent = 'Live score unavailable right now';
      el.phrase.textContent = 'The forecast could not be reached from this page. It is still running in the app.';
    });
  }

  function load() {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 12000);
    fetch(API + '?_=' + Date.now(), { signal: ctrl.signal })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        clearTimeout(timer);
        var cf = d && d.currentForecast;
        var s = cf && cf.spotTheAuroraForecast;
        if (typeof s !== 'number' || !isFinite(s)) throw new Error('no score');
        baseScore = Math.max(0, Math.min(100, s));
        var t = cf.lastUpdated ? nzTime(cf.lastUpdated) : '';
        var hp = cf.inputs && cf.inputs.hemisphericPower;
        var owm = d.owmDailyForecast;
        var mp = owm && owm[0] && owm[0].moon_phase;
        mounts.forEach(function (el) {
          el.root.classList.remove('is-down');
          el.root.classList.add('is-live');
          el.status.textContent = t ? 'Live, updated ' + t + ' NZT' : 'Live';
          if (typeof hp === 'number') {
            el.power.textContent = hp.toFixed(0) + ' GW';
            el.powerWrap.hidden = false;
          }
          if (typeof mp === 'number') {
            el.moon.textContent = Math.round((1 - Math.cos(2 * Math.PI * mp)) / 2 * 100) + '%';
            el.moonWrap.hidden = false;
          }
        });
        paint();
      })
      .catch(function () { clearTimeout(timer); fail(); });
  }

  function locate() {
    if (!navigator.geolocation) return;
    mounts.forEach(function (el) { el.locate.disabled = true; el.locate.textContent = 'Locating'; });
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        userLat = pos.coords.latitude;
        mounts.forEach(function (el) { el.locate.hidden = true; });
        paint();
      },
      function () {
        mounts.forEach(function (el) { el.locate.disabled = false; el.locate.textContent = 'Location unavailable'; });
      },
      { timeout: 10000, maximumAge: 300000 }
    );
  }

  var seq = 0;

  function mount(root) {
    var n = ++seq;
    var q = function (k) { return root.querySelector('[data-lf="' + k + '"]'); };
    root.innerHTML =
      '<div class="lf-head">' +
        '<span class="lf-status" data-lf="status">Loading the live forecast</span>' +
        '<span class="lf-where" data-lf="where"></span>' +
      '</div>' +
      '<div class="lf-score" data-lf="score"></div>' +
      '<div class="lf-track"><div class="lf-bar" data-lf="bar"></div></div>' +
      '<div class="lf-tier" data-lf="tier"></div>' +
      '<p class="lf-phrase" data-lf="phrase">Fetching the current conditions over New Zealand.</p>' +
      '<div class="lf-meta">' +
        '<span class="lf-stat" data-lf="powerWrap" hidden><b data-lf="power"></b> auroral power</span>' +
        '<span class="lf-stat" data-lf="moonWrap" hidden><b data-lf="moon"></b> moon lit</span>' +
      '</div>' +
      '<div class="lf-actions">' +
        '<a class="btn btn-primary btn-sm" href="https://www.spottheaurora.co.nz" target="_blank" rel="noopener">Open the full forecast</a>' +
        '<button class="btn btn-ghost btn-sm" data-lf="locate" type="button">Use my location</button>' +
      '</div>';
    var el = {
      root: root, status: q('status'), where: q('where'), score: q('score'),
      bar: q('bar'), tier: q('tier'), phrase: q('phrase'),
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
