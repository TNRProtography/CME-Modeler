import React, { useMemo, useEffect, useState } from 'react';

/**
 * DriftingMoon
 * ----------------------------------------------------------------
 * A real textured moon that drifts slowly across the fixed viewport
 * (like the star field, but moving). The phase mask reveals only
 * the currently illuminated portion of the moon, so at new moon it
 * fades to a faint dark disc, at first quarter the right half is
 * lit, at full moon the whole disc is lit, and so on.
 *
 * Implementation:
 *  - The moon TEXTURE is a real lunar surface photograph (the same
 *    NASA-derived texture the CME visualization uses for the moon).
 *  - The PHASE is rendered by overlaying a dark disc that has an
 *    elliptical cutout revealing the illuminated portion. The
 *    ellipse's horizontal radius is R * |cos(pi * f)|, which
 *    correctly produces:
 *       f=1.0 (full)         -> whole disc revealed
 *       f=0.75 (waxing gib)  -> mostly revealed, thin dark crescent
 *       f=0.5 (quarter)      -> exactly half revealed
 *       f=0.25 (crescent)    -> thin bright crescent
 *       f=0.0 (new)          -> dark disc
 *  - Waxing/waning flips which side is dark.
 *  - Positioned `fixed` so it stays on-screen as the user scrolls,
 *    matching the star field. Drifts across the viewport on a
 *    long-period animation (~2 minutes) - slow enough not to
 *    distract, fast enough to feel alive.
 *  - `pointer-events: none` so it never blocks UI beneath.
 *  - z-index sits between the star field and content (both are z-0
 *    in fixed layers; the moon is placed just above the stars via
 *    stacking order).
 *
 * Optional props allow a parent to override phase (e.g. from the
 * forecast data hook which fetches real ephemeris values).
 */

// Same NASA-derived lunar surface texture used in the 3D CME sim.
// It's the standard three.js example moon map - a real Clementine
// mission composite showing craters and maria.
const MOON_TEXTURE_URL =
  'https://cs.wellesley.edu/~cs307/threejs/r124/three.js-master/examples/textures/planets/moon_1024.jpg';

type Props = {
  /** Diameter in pixels. */
  size?: number;
  /** Illumination percentage 0-100. Auto-computed if omitted. */
  illumination?: number | null;
  /** true = waxing, false = waning. Auto-computed if omitted. */
  waxing?: boolean | null;
};

/**
 * Approximate lunar phase from a Unix ms timestamp. Uses the
 * synodic month (29.530588853 days) and a known new-moon epoch
 * (2000-01-06 18:14 UTC). Good enough for a decorative moon.
 */
function computeMoonPhase(nowMs: number): { illumination: number; waxing: boolean } {
  const SYNODIC_MS = 29.530588853 * 24 * 60 * 60 * 1000;
  const KNOWN_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14, 0);
  const elapsed = nowMs - KNOWN_NEW_MOON_MS;
  const phase = (((elapsed % SYNODIC_MS) + SYNODIC_MS) % SYNODIC_MS) / SYNODIC_MS;
  const illumination = (1 - Math.cos(phase * 2 * Math.PI)) / 2 * 100;
  const waxing = phase < 0.5;
  return { illumination, waxing };
}

const DriftingMoon: React.FC<Props> = ({
  size = 72,
  illumination: illumProp,
  waxing: waxingProp,
}) => {
  // Re-check the phase every hour so a long-open tab reflects drift.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const { illumination, waxing } = useMemo(() => {
    const computed = computeMoonPhase(nowMs);
    return {
      illumination: illumProp != null ? illumProp : computed.illumination,
      waxing: waxingProp != null ? waxingProp : computed.waxing,
    };
  }, [nowMs, illumProp, waxingProp]);

  // Geometry for the SVG phase mask (viewBox 100x100, disc r=50).
  const R = 50;
  const CX = 50;
  const CY = 50;
  const f = Math.max(0, Math.min(1, illumination / 100));
  const cosF = Math.cos(Math.PI * f);
  const ellipseRx = Math.abs(cosF) * R;
  const gibbous = f > 0.5;

  // Which half of the disc is the illuminated one?
  //   waxing -> bright grows from the RIGHT (dark = left)
  //   waning -> bright is on the LEFT (dark = right)
  const brightHalfX = waxing ? CX : CX - R; // rect x for bright half
  const darkHalfX = waxing ? CX - R : CX;   // rect x for dark half

  // Unique mask id in case multiple moons ever render.
  const maskId = useMemo(
    () => 'moon-phase-mask-' + Math.random().toString(36).slice(2, 9),
    []
  );

  return (
    <>
      <style>{`
        @keyframes moon-drift {
          0%   { transform: translate3d(-10vw, 8vh, 0); }
          25%  { transform: translate3d(20vw, 4vh, 0); }
          50%  { transform: translate3d(55vw, 12vh, 0); }
          75%  { transform: translate3d(80vw, 6vh, 0); }
          100% { transform: translate3d(110vw, 10vh, 0); }
        }
        @keyframes moon-drift-glow {
          0%,100% { filter: drop-shadow(0 0 10px rgba(255,240,210,0.30)); }
          50%     { filter: drop-shadow(0 0 18px rgba(255,240,210,0.55)); }
        }
      `}</style>

      {/* Drift container: positioned fixed, animates horizontally across
          the viewport on a very long period so the movement is subtle. */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: size,
          height: size,
          zIndex: 0,
          pointerEvents: 'none',
          animation: 'moon-drift 180s linear infinite',
          willChange: 'transform',
        }}
        title={`Moon: ${illumination.toFixed(0)}% illuminated · ${waxing ? 'waxing' : 'waning'}`}
      >
        {/* Inner wrapper handles the subtle glow pulse independently. */}
        <div
          style={{
            width: '100%',
            height: '100%',
            animation: 'moon-drift-glow 8s ease-in-out infinite',
            willChange: 'filter',
          }}
        >
          <svg
            width={size}
            height={size}
            viewBox="0 0 100 100"
            style={{ overflow: 'visible' }}
          >
            <defs>
              {/* Phase mask: white = show texture, black = hide.
                  Start with the illuminated half fully white, then either
                  extend or shrink it via an ellipse on the terminator. */}
              <mask id={maskId} maskUnits="userSpaceOnUse">
                {/* Black background = nothing shown by default */}
                <rect x="0" y="0" width="100" height="100" fill="black" />

                {/* Reveal the illuminated half of the disc */}
                <rect
                  x={brightHalfX}
                  y={CY - R}
                  width={R}
                  height={R * 2}
                  fill="white"
                />

                {/* Terminator correction ellipse:
                    - Gibbous: white ellipse extends bright into dark half
                    - Crescent: black ellipse eats into the bright half */}
                <ellipse
                  cx={CX}
                  cy={CY}
                  rx={ellipseRx}
                  ry={R}
                  fill={gibbous ? 'white' : 'black'}
                />
              </mask>

              {/* Dark-side subtle wash: reddish-blue "earthshine" tint
                  so the unlit side isn't pure black. */}
              <radialGradient id="moon-earthshine" cx="50%" cy="50%" r="50%">
                <stop offset="0%"   stopColor="rgba(45,50,70,0.45)" />
                <stop offset="100%" stopColor="rgba(20,25,40,0.65)" />
              </radialGradient>
            </defs>

            {/* Circular clip so nothing bleeds outside the moon disc. */}
            <defs>
              <clipPath id={maskId + '-clip'}>
                <circle cx={CX} cy={CY} r={R} />
              </clipPath>
            </defs>

            {/* Dark side: faint earthshine so the moon still reads as a
                sphere even at new moon. Sits under the lit texture. */}
            <g clipPath={`url(#${maskId}-clip)`}>
              <circle cx={CX} cy={CY} r={R} fill="url(#moon-earthshine)" />

              {/* Lit lunar surface texture, masked to phase */}
              <image
                href={MOON_TEXTURE_URL}
                x="0"
                y="0"
                width="100"
                height="100"
                mask={`url(#${maskId})`}
                preserveAspectRatio="xMidYMid slice"
              />
            </g>

            {/* Subtle rim glow so the disc reads as luminous */}
            <circle
              cx={CX}
              cy={CY}
              r={R}
              fill="none"
              stroke="rgba(255,240,210,0.18)"
              strokeWidth="0.6"
            />
          </svg>
        </div>
      </div>
    </>
  );
};

export default DriftingMoon;
