import React from 'react';

/**
 * SouthernCross
 * ----------------------------------------------------------------
 * The Crux constellation as it appears on the "Spot The Aurora"
 * logo - a four-star kite (with a small fifth star offset near the
 * bottom), the same layout used on the NZ flag.
 *
 *   - Gacrux (top)         - top of the kite, high up
 *   - Delta Crucis (right) - right arm, slightly lower than left
 *   - Mimosa (left)        - left arm
 *   - Acrux (bottom)       - brightest, at the bottom
 *   - Epsilon Crucis       - small fifth star tucked next to Acrux
 *
 * Each star has a bright core and a soft outer glow, with staggered
 * twinkle so they don't pulse in unison. Decorative only.
 */
type Props = {
  /** Rendered width in pixels. Height auto-scales to match aspect. */
  size?: number;
  className?: string;
};

const SouthernCross: React.FC<Props> = ({ size = 80, className }) => {
  // ViewBox 100 wide x 130 tall. Positions to match the logo layout:
  //   top-of-cross star sits near the top-center, slightly right
  //   left arm sits mid-height on the left
  //   right arm sits slightly lower on the right
  //   bottom star (brightest) sits low-center
  //   fifth small star tucked in below-left of the bottom star
  const stars = [
    // { cx, cy, r (core), glow, delay }
    { name: 'Gacrux',   cx: 55, cy: 18,  r: 6.6, glow: 20, delay: 0   },
    { name: 'Mimosa',   cx: 22, cy: 58,  r: 6.0, glow: 19, delay: 1.3 },
    { name: 'Delta',    cx: 82, cy: 68,  r: 5.0, glow: 16, delay: 2.7 },
    { name: 'Acrux',    cx: 52, cy: 108, r: 7.4, glow: 23, delay: 0.8 },
    { name: 'Epsilon',  cx: 34, cy: 92,  r: 3.4, glow: 11, delay: 2.0 },
  ];

  return (
    <>
      <style>{`
        @keyframes crux-twinkle {
          0%, 100% { opacity: 0.85; }
          50%      { opacity: 1;    }
        }
        @keyframes crux-glow {
          0%, 100% { opacity: 0.55; transform: scale(1);    }
          50%      { opacity: 0.9;  transform: scale(1.15); }
        }
      `}</style>

      <svg
        aria-hidden="true"
        className={className}
        width={size}
        height={size * 1.3}
        viewBox="0 0 100 130"
        style={{ overflow: 'visible', transform: 'rotate(180deg)' }}
      >
        <defs>
          <radialGradient id="crux-star-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="rgba(255,255,255,1)" />
            <stop offset="60%"  stopColor="rgba(220,235,255,0.9)" />
            <stop offset="100%" stopColor="rgba(180,210,255,0)" />
          </radialGradient>
          <radialGradient id="crux-star-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="rgba(200,225,255,0.55)" />
            <stop offset="45%"  stopColor="rgba(160,200,255,0.20)" />
            <stop offset="100%" stopColor="rgba(120,180,255,0)" />
          </radialGradient>
        </defs>

        {stars.map((s) => (
          <g key={s.name}>
            {/* Outer soft glow */}
            <circle
              cx={s.cx}
              cy={s.cy}
              r={s.glow}
              fill="url(#crux-star-glow)"
              style={{
                transformOrigin: `${s.cx}px ${s.cy}px`,
                animation: `crux-glow 4s ease-in-out ${s.delay}s infinite`,
                willChange: 'opacity, transform',
              }}
            />
            {/* Bright star core */}
            <circle
              cx={s.cx}
              cy={s.cy}
              r={s.r}
              fill="url(#crux-star-core)"
              style={{
                animation: `crux-twinkle 3.2s ease-in-out ${s.delay}s infinite`,
                willChange: 'opacity',
              }}
            />
          </g>
        ))}
      </svg>
    </>
  );
};

export default SouthernCross;