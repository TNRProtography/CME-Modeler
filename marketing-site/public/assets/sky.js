/* Spot The Aurora, marketing site
   Live sky backdrop: seeded starfield, drifting aurora curtains, and a moon
   showing the real current phase. Ported from the app's StarField.tsx and
   DriftingMoon.tsx so the two sites behave the same way.

   Everything here is decorative and pointer-events:none. If anything throws,
   the page is unaffected. */
(function () {
  'use strict';

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Deterministic PRNG (mulberry32), same as the app, so the star layout is
     stable between loads instead of jumping around. */
  function mulberry32(seed) {
    return function () {
      var t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var STAR_COUNT = 150;
  var SEED = 0x5aa5;

  function buildStars() {
    var rand = mulberry32(SEED);
    var parts = [];
    for (var i = 0; i < STAR_COUNT; i++) {
      // Bias toward the upper part of the viewport, but never end abruptly.
      var yb = rand();
      var cy = yb < 0.75 ? rand() * 65 : 65 + rand() * 35;
      var cx = rand() * 100;
      var r = rand() < 0.88 ? 0.6 + rand() * 0.7 : 1.4 + rand() * 0.9;
      var op = 0.25 + rand() * 0.55;
      var dur = 2.6 + rand() * 5.2;
      var delay = rand() * 6;
      parts.push(
        '<circle cx="' + cx.toFixed(2) + '%" cy="' + cy.toFixed(2) + '%" r="' + r.toFixed(2) +
        '" fill="#fff" opacity="' + op.toFixed(2) + '">' +
        (reduced ? '' :
          '<animate attributeName="opacity" values="' + op.toFixed(2) + ';' + (op * 0.25).toFixed(2) + ';' + op.toFixed(2) +
          '" dur="' + dur.toFixed(2) + 's" begin="' + delay.toFixed(2) + 's" repeatCount="indefinite"/>') +
        '</circle>'
      );
    }
    return '<svg class="sky-stars" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' + parts.join('') + '</svg>';
  }

  /* Moon phase. Illumination and waxing/waning from a standard synodic
     calculation, the same maths the app falls back to when it has no
     ephemeris from the forecast API. */
  function moonPhase(date) {
    var synodic = 29.53058867;
    var known = Date.UTC(2000, 0, 6, 18, 14); // a known new moon
    var days = (date.getTime() - known) / 86400000;
    var age = ((days % synodic) + synodic) % synodic;
    var f = age / synodic;                        // 0 new, 0.5 full
    var illum = (1 - Math.cos(2 * Math.PI * f)) / 2;
    return { illumination: illum, waxing: f < 0.5 };
  }

  function buildMoon() {
    var ph = moonPhase(new Date());
    var lit = ph.illumination;
    // Below a sliver there is nothing worth drawing.
    if (lit < 0.06) return '';
    var R = 46;
    // Terminator: horizontal radius of the shadow ellipse.
    var rx = (R * Math.abs(Math.cos(Math.PI * lit))).toFixed(2);
    var id = 'moonmask';
    // Shadow sits on the left when waxing, right when waning.
    var shadowCx = ph.waxing ? R - 0.001 : R + 0.001;
    var halfX = ph.waxing ? 0 : R;
    return '' +
      '<div class="sky-moon" aria-hidden="true" style="opacity:' + (0.10 + lit * 0.30).toFixed(3) + '">' +
      '<svg viewBox="0 0 ' + (R * 2) + ' ' + (R * 2) + '" width="100%" height="100%">' +
        '<defs>' +
          '<radialGradient id="mg" cx="38%" cy="34%">' +
            '<stop offset="0%" stop-color="#fdfcf6"/>' +
            '<stop offset="62%" stop-color="#ddd8cc"/>' +
            '<stop offset="100%" stop-color="#9c968a"/>' +
          '</radialGradient>' +
          '<mask id="' + id + '">' +
            '<rect width="100%" height="100%" fill="black"/>' +
            '<circle cx="' + R + '" cy="' + R + '" r="' + R + '" fill="white"/>' +
            '<rect x="' + halfX + '" y="0" width="' + R + '" height="' + (R * 2) + '" fill="black"/>' +
            '<ellipse cx="' + shadowCx + '" cy="' + R + '" rx="' + rx + '" ry="' + R + '" fill="' + (lit < 0.5 ? 'black' : 'white') + '"/>' +
          '</mask>' +
        '</defs>' +
        '<circle cx="' + R + '" cy="' + R + '" r="' + R + '" fill="url(#mg)" mask="url(#' + id + ')"/>' +
      '</svg></div>';
  }

  function build() {
    var host = document.createElement('div');
    host.className = 'sky' + (reduced ? ' sky-still' : '');
    host.setAttribute('aria-hidden', 'true');
    host.innerHTML =
      '<div class="sky-curtain sky-c1"></div>' +
      '<div class="sky-curtain sky-c2"></div>' +
      '<div class="sky-curtain sky-c3"></div>' +
      buildStars() +
      buildMoon();
    document.body.insertBefore(host, document.body.firstChild);
  }

  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
    else build();
  } catch (e) { /* decoration only, never break the page */ }
})();
