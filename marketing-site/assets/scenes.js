/* Spot The Aurora, marketing site
   Three live scenes lifted from the app, so visitors see the real thing rather
   than a screenshot of it.

   1. cme        Top-down heliosphere. CMEs leave the Sun and decelerate toward
                 the ambient wind speed using the drag-based model
                 (Vrsnak et al. 2013), the same engine the app's 3D scene uses.
                 Colour tracks current speed on the app's exact scale.
   2. coronalhole  The solar disk with a coronal hole rotating across it, and the
                 high speed stream it fires wound into a Parker spiral out past
                 Earth's orbit.
   3. magnetotail  Side-on magnetosphere. Solar wind streams in at the measured
                 speed; northward field deflects around the bow shock, southward
                 slips in and loads the tail until it snaps and fires particles
                 onto the pole, blooming aurora on the globe.

   Canvas 2D, no dependencies. Each scene only animates while on screen, pauses
   when the tab is hidden, and respects prefers-reduced-motion. */
(function () {
  'use strict';

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var TAU = Math.PI * 2;

  /* The app's CME speed colour scale. */
  function speedColour(v) {
    var stops = [
      [350, [128, 128, 128]], [500, [255, 255, 0]], [800, [255, 165, 0]],
      [1000, [255, 69, 0]], [1800, [147, 112, 219]], [2500, [255, 105, 180]]
    ];
    if (v <= stops[0][0]) return 'rgb(128,128,128)';
    for (var i = 1; i < stops.length; i++) {
      if (v <= stops[i][0]) {
        var a = stops[i - 1], b = stops[i];
        var t = (v - a[0]) / (b[0] - a[0]);
        return 'rgb(' + Math.round(a[1][0] + (b[1][0] - a[1][0]) * t) + ',' +
                        Math.round(a[1][1] + (b[1][1] - a[1][1]) * t) + ',' +
                        Math.round(a[1][2] + (b[1][2] - a[1][2]) * t) + ')';
      }
    }
    return 'rgb(255,105,180)';
  }

  /* Drag-based model. A CME faster than the ambient wind is dragged back
     toward it, slower is dragged forward. gamma is the drag parameter. */
  function dbmStep(v, w, gamma, dtSec) {
    var dv = -gamma * (v - w) * Math.abs(v - w) * dtSec;
    return v + dv;
  }

  function fitCanvas(cv) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var r = cv.getBoundingClientRect();
    if (!r.width) return false;
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cv._w = r.width; cv._h = r.height;
    return true;
  }

  /* ============================ 1. CME heliosphere ======================== */
  function sceneCME(cv, ctx) {
    var cmes = [], t0 = performance.now(), nextFire = 300;
    var AMBIENT = 400; // km/s ambient solar wind

    function fire() {
      // A spread of realistic events, weighted toward the slower, common ones.
      var r = Math.random();
      var v = r < 0.45 ? 450 + Math.random() * 250
            : r < 0.78 ? 700 + Math.random() * 400
            : r < 0.94 ? 1100 + Math.random() * 500
            : 1800 + Math.random() * 800;
      var half = (18 + Math.random() * 26) * Math.PI / 180;
      var pts = [];
      for (var q = 0; q < 46; q++) {
        // bunched toward the leading edge, like the app's flux-rope cloud
        pts.push({ u: 1 - Math.pow(Math.random(), 1.7) * 0.34, a: (Math.random() * 2 - 1) });
      }
      cmes.push({
        dir: Math.random() * TAU,
        half: half,
        v: v, v0: v,
        au: 0.02,
        gamma: 0.03e-7 + Math.random() * 0.05e-7,
        pts: pts,
        born: performance.now()
      });
      if (cmes.length > 7) cmes.shift();
    }

    fire(); cmes[0].au = 0.55; fire(); cmes[1].au = 0.95;

    return function draw(now) {
      var w = cv._w, h = cv._h;
      var cx = w * 0.5, cy = h * 0.5;
      var AU = Math.min(w, h) * 0.34;      // pixels per AU
      var dt = 250;                         // simulated seconds per frame,
                                            // tuned so a CME takes ~20s to reach 1 AU

      ctx.clearRect(0, 0, w, h);

      // Earth's orbit
      ctx.strokeStyle = 'rgba(154,147,184,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, AU, 0, TAU); ctx.stroke();

      // Earth
      var eAng = (now - t0) / 22000;
      var ex = cx + Math.cos(eAng) * AU, ey = cy + Math.sin(eAng) * AU;
      ctx.fillStyle = '#6ea8ff';
      ctx.beginPath(); ctx.arc(ex, ey, 3.6, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(110,168,255,0.22)';
      ctx.beginPath(); ctx.arc(ex, ey, 8, 0, TAU); ctx.fill();

      if (now - t0 > nextFire) { fire(); nextFire = (now - t0) + 1500 + Math.random() * 2200; }

      for (var i = cmes.length - 1; i >= 0; i--) {
        var c = cmes[i];
        if (!reduced) {
          c.v = dbmStep(c.v, AMBIENT, c.gamma, dt);
          c.au += (c.v * dt) / 1.496e8;   // km travelled -> AU
        }
        if (c.au > 1.85) { cmes.splice(i, 1); continue; }

        var col = speedColour(c.v);
        var rad = c.au * AU;
        var a0 = c.dir - c.half, a1 = c.dir + c.half;
        var fade = c.au < 0.1 ? c.au / 0.1 : Math.max(0, 1 - (c.au - 1.1) / 0.75);

        // The leading front
        ctx.globalAlpha = 0.9 * fade;
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, rad, a0, a1); ctx.stroke();

        // A faint shell behind it, thin rather than a solid wedge
        ctx.globalAlpha = 0.07 * fade;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, a0, a1);
        ctx.arc(cx, cy, Math.max(0, rad * 0.84), a1, a0, true);
        ctx.closePath(); ctx.fill();

        // The particle cloud itself
        ctx.fillStyle = col;
        for (var q2 = 0; q2 < c.pts.length; q2++) {
          var pt = c.pts[q2];
          var pr = rad * pt.u;
          var pa = c.dir + pt.a * c.half * 0.92;
          ctx.globalAlpha = (0.16 + 0.5 * pt.u) * fade;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(pa) * pr, cy + Math.sin(pa) * pr, 1.25, 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // The Sun, drawn last so it sits over the launch points
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 26);
      g.addColorStop(0, '#fff8e0'); g.addColorStop(0.35, '#ffcc4d');
      g.addColorStop(0.7, 'rgba(255,140,32,0.5)'); g.addColorStop(1, 'rgba(255,120,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, 26, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffd86b';
      ctx.beginPath(); ctx.arc(cx, cy, 8.5, 0, TAU); ctx.fill();
    };
  }

  /* ========================= 2. Coronal hole and HSS ===================== */
  function sceneCH(cv, ctx) {
    var t0 = performance.now();
    var parcels = [];
    for (var i = 0; i < 90; i++) parcels.push({ au: Math.random() * 1.7, born: Math.random() });

    return function draw(now) {
      var w = cv._w, h = cv._h;
      var cx = w * 0.34, cy = h * 0.5;
      var AU = Math.min(w * 0.62, h * 0.44);
      var R = Math.min(w, h) * 0.13;           // solar disk radius
      var t = (now - t0) / 1000;
      var rot = t * 0.09;                      // the hole rotates with the Sun

      ctx.clearRect(0, 0, w, h);

      // Earth's orbit and Earth
      ctx.strokeStyle = 'rgba(154,147,184,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, AU, 0, TAU); ctx.stroke();
      var eAng = -0.35 + t * 0.02;
      var ex = cx + Math.cos(eAng) * AU, ey = cy + Math.sin(eAng) * AU;

      // The Parker spiral: the stream is wound by the Sun's rotation as it
      // travels out, so it reaches Earth as a curve, not a straight line.
      var chAng = rot % TAU;
      var facing = Math.cos(chAng);            // >0 means pointing our way
      var wind = 0.62;                         // winding per AU
      function spiral(offset, alpha) {
        ctx.beginPath();
        for (var a = 0.055; a <= 1.75; a += 0.02) {
          var ang = chAng + offset - a * wind;
          var px = cx + Math.cos(ang) * a * AU, py = cy + Math.sin(ang) * a * AU;
          if (a < 0.06) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.globalAlpha = alpha; ctx.stroke(); ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = '#3ddc97'; ctx.lineWidth = 1.5;
      spiral(-0.16, 0.5); spiral(0, 0.75); spiral(0.16, 0.5);

      // Parcels of fast wind riding the spiral outward
      for (var j = 0; j < parcels.length; j++) {
        var p = parcels[j];
        if (!reduced) p.au += 0.0016;
        if (p.au > 1.75) p.au = 0.06;
        var off = (p.born - 0.5) * 0.3;
        var pa = chAng + off - p.au * wind;
        var px2 = cx + Math.cos(pa) * p.au * AU, py2 = cy + Math.sin(pa) * p.au * AU;
        ctx.globalAlpha = 0.5 * Math.max(0, 1 - p.au / 1.85);
        ctx.fillStyle = '#6df0b8';
        ctx.beginPath(); ctx.arc(px2, py2, 1.5, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Earth, lighting up when the stream is aimed at it
      var hit = Math.max(0, facing);
      ctx.fillStyle = '#6ea8ff';
      ctx.beginPath(); ctx.arc(ex, ey, 4, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.16 + hit * 0.4;
      ctx.fillStyle = '#3ddc97';
      ctx.beginPath(); ctx.arc(ex, ey, 10 + hit * 5, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;

      // The solar disk
      var g = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.2, R * 0.1, cx, cy, R);
      g.addColorStop(0, '#5b4a2c'); g.addColorStop(0.75, '#3a2f1e'); g.addColorStop(1, '#241d14');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,196,92,0.4)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();

      // The coronal hole itself: dark, because there is no hot loop-bound
      // plasma there, and it rotates across the disk over days
      var hx = cx + Math.cos(chAng) * R * 0.52;
      var hy = cy + Math.sin(chAng * 0.6) * R * 0.3;
      var squash = Math.abs(Math.cos(chAng));          // foreshortened at the limb
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R - 1, 0, TAU); ctx.clip();
      ctx.fillStyle = 'rgba(6,5,12,0.93)';
      ctx.beginPath();
      ctx.ellipse(hx, hy, R * 0.34 * (0.25 + squash * 0.75), R * 0.46, chAng * 0.4, 0, TAU);
      ctx.fill();
      ctx.restore();

      ctx.font = '600 9px Montserrat, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(154,147,184,0.85)';
      ctx.letterSpacing = '1.6px';
      ctx.fillText('CORONAL HOLE', cx - R, cy + R + 16);
      ctx.fillStyle = 'rgba(61,220,151,0.85)';
      ctx.fillText('HIGH SPEED STREAM', cx + AU * 0.2, cy - AU * 0.55);
    };
  }

  /* ========================== 3. Magnetotail ============================= */
  function sceneMag(cv, ctx) {
    var t0 = performance.now();
    var parts = [];
    // phase: loading -> stretched -> snap -> afterglow, then round again
    var phase = 'loading', phaseAt = 0, load = 0, flash = 0, curtain = 0;

    for (var i = 0; i < 150; i++) parts.push({ x: Math.random(), y: Math.random(), s: 0.5 + Math.random() * 0.8, captured: false, tail: 0 });

    return function draw(now) {
      var w = cv._w, h = cv._h, t = (now - t0) / 1000;
      var ex = w * 0.34, ey = h * 0.5;              // Earth
      var R = Math.min(w, h) * 0.085;

      // Bz swings south during loading, which is what lets particles in
      var bzSouth = phase !== 'afterglow';

      if (!reduced) {
        if (phase === 'loading') { load += 0.0042; if (load >= 1) { phase = 'stretched'; phaseAt = t; } }
        else if (phase === 'stretched') { if (t - phaseAt > 1.6) { phase = 'snap'; phaseAt = t; flash = 1; } }
        else if (phase === 'snap') { flash *= 0.94; curtain = Math.min(1, curtain + 0.08); if (t - phaseAt > 2.2) { phase = 'afterglow'; phaseAt = t; } }
        else { load *= 0.955; curtain *= 0.975; if (t - phaseAt > 2.4) { phase = 'loading'; load = 0; curtain = 0; } }
      }

      ctx.clearRect(0, 0, w, h);

      // Magnetopause: the bubble the wind cannot get through, compressed on
      // the sunward side and drawn out into a tail downstream
      ctx.strokeStyle = bzSouth ? 'rgba(224,68,122,0.42)' : 'rgba(110,168,255,0.42)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      var first = true;
      for (var a = -Math.PI * 0.82; a <= Math.PI * 0.82; a += 0.04) {
        // a = 0 points sunward, so the nose sits upstream and the flanks
        // sweep back downstream into the tail
        var rr = Math.min(R * 2.0 / (1 + 0.55 * Math.cos(a)), w);
        var px = ex - Math.cos(a) * rr;
        var py = ey + Math.sin(a) * Math.min(rr, h * 0.44);
        if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // The tail, stretching further the more energy is loaded into it
      var stretch = 1 + load * 1.5;
      var pinch = ex + R * 5.6 * stretch;
      ctx.strokeStyle = 'rgba(124,92,214,' + (0.25 + load * 0.45) + ')';
      ctx.lineWidth = 1.2;
      [-1, 1].forEach(function (sgn) {
        ctx.beginPath();
        ctx.moveTo(ex, ey + sgn * R * 1.5);
        ctx.quadraticCurveTo(ex + R * 3 * stretch, ey + sgn * R * (2.5 - load * 0.9), pinch, ey + sgn * R * (0.5 - load * 0.3));
        ctx.stroke();
      });

      // Stored energy glowing in the tail as it loads
      if (load > 0.04) {
        var gx = Math.min(pinch, w * 0.74);
        var lg = ctx.createRadialGradient(gx, ey, 0, gx, ey, R * 2.6);
        lg.addColorStop(0, 'rgba(61,220,151,' + (0.30 * load) + ')');
        lg.addColorStop(1, 'rgba(61,220,151,0)');
        ctx.fillStyle = lg;
        ctx.beginPath(); ctx.arc(gx, ey, R * 2.6, 0, TAU); ctx.fill();
      }

      // The snap
      if (flash > 0.02) {
        var fg = ctx.createRadialGradient(pinch, ey, 0, pinch, ey, R * 2.6 * flash + 6);
        fg.addColorStop(0, 'rgba(255,255,255,' + (0.85 * flash) + ')');
        fg.addColorStop(0.4, 'rgba(109,240,184,' + (0.5 * flash) + ')');
        fg.addColorStop(1, 'rgba(61,220,151,0)');
        ctx.fillStyle = fg;
        ctx.beginPath(); ctx.arc(pinch, ey, R * 2.6 * flash + 6, 0, TAU); ctx.fill();
      }

      // Solar wind streaming in from the left at the measured speed
      for (var k = 0; k < parts.length; k++) {
        var p = parts[k];
        if (!reduced) p.x += 0.0026 * p.s * (bzSouth ? 1.15 : 1);
        if (p.x > 1) { p.x = -0.05; p.y = Math.random(); p.captured = false; p.tail = 0; }

        var X = p.x * w, Y = p.y * h;
        var dx = X - ex, dy = Y - ey;
        var dist = Math.hypot(dx, dy);
        var nose = R * 2.0 / (1 + 0.55 * Math.cos(Math.atan2(dy, -dx)));

        if (dist < nose && X < ex + R * 2) {
          if (bzSouth) {
            // Southward field: reconnection opens the door, the particle slips
            // in and spirals down the tail
            p.captured = true;
          } else {
            // Northward: it visibly deflects around the bubble instead
            var push = (nose - dist) * 0.06;
            Y += (dy / (dist || 1)) * push * 14;
          }
        }
        if (p.captured) {
          Y = ey + (Y - ey) * 0.965;
          p.tail = Math.min(1, p.tail + 0.02);
          X = X + p.tail * R * 1.2;
        }

        ctx.globalAlpha = p.captured ? 0.75 : 0.42;
        ctx.fillStyle = p.captured ? '#6df0b8' : (bzSouth ? '#e0447a' : '#8fb8ff');
        ctx.fillRect(X, Y, 2.2 * p.s, 1.4);
        ctx.globalAlpha = 1;
      }

      // Earth, with aurora blooming at the pole after the snap
      ctx.fillStyle = '#16233a';
      ctx.beginPath(); ctx.arc(ex, ey, R, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(110,168,255,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(ex, ey, R, 0, TAU); ctx.stroke();

      if (curtain > 0.02) {
        ctx.save();
        ctx.beginPath(); ctx.arc(ex, ey, R, 0, TAU); ctx.clip();
        [-1, 1].forEach(function (sgn) {
          var cgy = ey + sgn * R * 0.66;
          var cg = ctx.createRadialGradient(ex, cgy, 0, ex, cgy, R * 0.6);
          cg.addColorStop(0, 'rgba(160,255,214,' + (0.85 * curtain) + ')');
          cg.addColorStop(0.55, 'rgba(61,220,151,' + (0.40 * curtain) + ')');
          cg.addColorStop(1, 'rgba(61,220,151,0)');
          ctx.fillStyle = cg;
          ctx.beginPath(); ctx.ellipse(ex, cgy, R * 0.72, R * 0.3, 0, 0, TAU); ctx.fill();
        });
        ctx.restore();
        // a faint glow just off the limb so it reads as aurora, not paint
        ctx.globalAlpha = 0.5 * curtain;
        ctx.strokeStyle = 'rgba(109,240,184,0.6)';
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(ex, ey, R + 1.5, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Status caption, naming what you are watching
      var caption = phase === 'loading' ? 'ENERGY LOADING INTO THE TAIL'
                  : phase === 'stretched' ? 'TAIL STRETCHED, CLOSE TO ONSET'
                  : phase === 'snap' ? 'SUBSTORM ONSET'
                  : 'AURORA FADING';
      ctx.font = '700 9px Montserrat, system-ui, sans-serif';
      ctx.letterSpacing = '2px';
      ctx.fillStyle = phase === 'snap' ? '#6df0b8' : 'rgba(154,147,184,0.85)';
      ctx.fillText(caption, 14, h - 14);
      ctx.fillStyle = 'rgba(154,147,184,0.6)';
      ctx.fillText(bzSouth ? 'BZ SOUTH' : 'BZ NORTH', w - 86, h - 14);
    };
  }

  /* ============================== runner ================================= */
  var SCENES = { cme: sceneCME, coronalhole: sceneCH, magnetotail: sceneMag };

  function start(host) {
    var kind = host.getAttribute('data-scene');
    var factory = SCENES[kind];
    if (!factory) return;

    var cv = document.createElement('canvas');
    cv.className = 'scene-canvas';
    host.appendChild(cv);
    var ctx = cv.getContext('2d');
    if (!ctx || !fitCanvas(cv)) return;

    var draw = factory(cv, ctx);
    var visible = true, running = false, raf = 0;

    function frame(now) {
      if (!visible || document.hidden) { running = false; return; }
      try { draw(now); } catch (e) { return; }
      raf = requestAnimationFrame(frame);
    }
    function play() { if (!running) { running = true; raf = requestAnimationFrame(frame); } }
    function stop() { running = false; cancelAnimationFrame(raf); }

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible) play(); else stop();
      }, { rootMargin: '120px' }).observe(host);
    } else { visible = true; play(); }

    document.addEventListener('visibilitychange', function () { if (!document.hidden && visible) play(); });

    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { if (fitCanvas(cv)) { if (visible) play(); } }, 180);
    });

    play();
  }

  function init() {
    try {
      Array.prototype.forEach.call(document.querySelectorAll('[data-scene]'), start);
    } catch (e) { /* decorative, never break the page */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
