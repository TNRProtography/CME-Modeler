import React, { useMemo, useEffect, useState } from 'react';

/**
 * Moon
 * ----------------------------------------------------------------
 * Decorative moon that reflects the CURRENT lunar phase and
 * illumination percentage. Fully self-contained: computes the phase
 * from Date.now() so it works on any page without needing celestial
 * data plumbed in through props.
 *
 * Rendering: SVG disc with a dark elliptical terminator overlay.
 *   - Full moon:  no dark overlay, full bright disc.
 *   - New moon:   dark overlay covers whole disc, faint disc visible.
 *   - Waxing (illumination growing): dark side on the LEFT.
 *   - Waning (illumination shrinking): dark side on the RIGHT.
 *   - Crescent vs gibbous shape controlled by scaling the dark
 *     ellipse's horizontal radius: >1 for gibbous (bulges outward),
 *     <1 for crescent (bulges inward).
 *
 * Also renders a soft outer glow so the moon feels luminous against
 * the darkened photo, and animates a very gentle brightness pulse.
 *
 * Optional props allow the parent to override the auto-computed
 * illumination/phase (e.g. the ForecastDashboard already fetches
 * this from an API and can pass it through for accuracy).
 */

type Props = {
  /** Rendered diameter in pixels. */
  size?: number;
  /**
   * Illumination percentage 0-100. If omitted, computed from
   * Date.now() using a synodic-month approximation.
   */
  illumination?: number | null;
  /**
   * true = waxing (moon growing toward full), false = waning.
   * If omitted, computed from Date.now().
   */
  waxing?: boolean | null;
  className?: string;
};

/**
 * Approximate lunar phase from a Unix ms timestamp.
 * Uses the synodic month = 29.530588853 days and a known new moon
 * epoch (2000-01-06 18:14 UTC). Accurate to about ~1 day, which is
 * far better than needed for a decorative moon.
 */
function computeMoonPhase(nowMs: number): { illumination: number; waxing: boolean } {
  const SYNODIC_MS = 29.530588853 * 24 * 60 * 60 * 1000;
  const KNOWN_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14, 0);
  const elapsed = nowMs - KNOWN_NEW_MOON_MS;
  // Fractional position in the current cycle: 0 = new, 0.5 = full, 1 = new
  const phase = ((elapsed % SYNODIC_MS) + SYNODIC_MS) % SYNODIC_MS / SYNODIC_MS;
  // Illumination follows a cosine curve from 0 -> 1 -> 0 across the cycle
  const illumination = (1 - Math.cos(phase * 2 * Math.PI)) / 2 * 100;
  const waxing = phase < 0.5;
  return { illumination, waxing };
}

const Moon: React.FC<Props> = ({
  size = 68,
  illumination: illumProp,
  waxing: waxingProp,
  className,
}) => {
  // Re-check every hour so a long-open tab eventually reflects phase drift.
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

  // Geometry: viewBox 100x100, moon disc radius 42 centered at (50,50)
  // so there's room for the outer glow inside the box.
  const R = 42;
  const CX = 50;
  const CY = 50;

  // Illumination fraction 0..1
  const f = Math.max(0, Math.min(1, illumination / 100));

  // Dark side geometry:
  //   - At f=1 (full),   the dark ellipse has 0 horizontal radius (invisible).
  //   - At f=0.5 (half), the dark ellipse has 0 horizontal radius too, and
  //     we instead need to cover exactly one half of the disc via a rect.
  //   - At f=0 (new),    the dark ellipse fills the whole disc.
  // We achieve this with an elliptical mask whose horizontal radius is
  // R * cos(pi * f). Positive value -> gibbous (ellipse bulges toward
  // the bright side). Negative -> crescent (ellipse bulges away).
  //
  // Sign of the dark side depends on waxing/waning:
  //   waxing  -> dark side on the LEFT  (bright side revealing from right)
  //   waning  -> dark side on the RIGHT
  const cosF = Math.cos(Math.PI * f);
  // rx > 0 means the dark ellipse bulges toward the bright side (gibbous
  // phase, showing less dark). rx < 0 means it bulges away (crescent).
  const darkRx = Math.abs(cosF) * R;
  const gibbous = f > 0.5; // more than half illuminated

  // For accurate rendering we compose the dark side as: a half-disc on the
  // dark side, plus a bright-colored ellipse that either eats into it
  // (crescent) or extends it (gibbous). Simplest approach: draw dark disc
  // half, then overlay a light ellipse of appropriate width to reveal the
  // right amount of moon.
  //
  // Bright side x direction:
  //   waxing -> bright grows from right side, so darkSide = left, brightX dir = +1
  //   waning -> bright is on left, darkSide = right, brightX dir = -1
  const darkSideIsLeft = waxing;

  // The "correction" ellipse sits centered on the terminator (x = CX).
  // For gibbous, it's colored bright and extends into the dark half.
  // For crescent, it's colored dark and extends into the bright half.

  return (
    <>
      <style>{`
        @keyframes moon-pulse {
          0%, 100% { filter: drop-shadow(0 0 8px rgba(255,240,210,0.35)); }
          50%      { filter: drop-shadow(0 0 14px rgba(255,240,210,0.55)); }
        }
      `}</style>

      <div
        aria-hidden="true"
        className={className}
        style={{
          width: size,
          height: size,
          display: 'inline-block',
          animation: 'moon-pulse 6s ease-in-out infinite',
          willChange: 'filter',
        }}
        title={`Moon: ${illumination.toFixed(0)}% illuminated · ${waxing ? 'waxing' : 'waning'}`}
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 100 100"
          style={{ overflow: 'visible' }}
        >
          <defs>
            {/* Outer soft glow */}
            <radialGradient id="moon-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%"   stopColor="rgba(255,240,210,0.35)" />
              <stop offset="55%"  stopColor="rgba(255,235,190,0.15)" />
              <stop offset="100%" stopColor="rgba(255,220,160,0)" />
            </radialGradient>
            {/* Bright disc: warm cream toward center, cooler near edge */}
            <radialGradient id="moon-bright" cx="45%" cy="40%" r="60%">
              <stop offset="0%"   stopColor="rgba(255,250,235,1)" />
              <stop offset="70%"  stopColor="rgba(240,232,215,1)" />
              <stop offset="100%" stopColor="rgba(210,200,180,1)" />
            </radialGradient>
            {/* Dark side: not pure black - lets the disc still read as a
                sphere even at new moon */}
            <radialGradient id="moon-dark" cx="55%" cy="60%" r="70%">
              <stop offset="0%"   stopColor="rgba(30,30,45,0.95)" />
              <stop offset="100%" stopColor="rgba(15,15,25,0.98)" />
            </radialGradient>

            {/* Clip so all overlays stay inside the moon disc. */}
            <clipPath id="moon-clip">
              <circle cx={CX} cy={CY} r={R} />
            </clipPath>
          </defs>

          {/* Outer glow (drawn outside the clip so it can bleed) */}
          <circle cx={CX} cy={CY} r={R * 1.6} fill="url(#moon-glow)" />

          {/* Base: the dark side of the moon covers the whole disc. */}
          <circle cx={CX} cy={CY} r={R} fill="url(#moon-dark)" />

          {/* Bright side: a half-disc on the illuminated side. */}
          <g clipPath="url(#moon-clip)">
            <rect
              x={darkSideIsLeft ? CX : CX - R}
              y={CY - R}
              width={R}
              height={R * 2}
              fill="url(#moon-bright)"
            />

            {/* Terminator correction ellipse centered on x=CX.
                - Gibbous (f > 0.5): bright color extending INTO the dark half
                - Crescent (f <= 0.5): dark color eating INTO the bright half */}
            <ellipse
              cx={CX}
              cy={CY}
              rx={darkRx}
              ry={R}
              fill={gibbous ? 'url(#moon-bright)' : 'url(#moon-dark)'}
            />
          </g>

          {/* Subtle rim to define the sphere */}
          <circle
            cx={CX}
            cy={CY}
            r={R}
            fill="none"
            stroke="rgba(255,240,210,0.15)"
            strokeWidth="0.6"
          />
        </svg>
      </div>
    </>
  );
};

export default Moon;
