import React from 'react';

/**
 * SouthernCross
 * ----------------------------------------------------------------
 * Decorative Crux constellation rendered as an SVG. The five stars
 * are placed and sized to match their real relative positions and
 * apparent magnitudes:
 *   - Acrux (alpha)   - brightest, bottom of the kite
 *   - Mimosa (beta)   - left arm
 *   - Gacrux (gamma)  - top of the kite
 *   - Delta Crucis    - right arm, dimmer
 *   - Epsilon Crucis  - smallest, offset near Acrux
 *
 * Each star has a soft outer glow (larger blurred circle) plus a
 * bright core, and a staggered twinkle so they don't pulse in unison.
 * Purely decorative - `aria-hidden`.
 */
type Props = {
  /** Rendered width in pixels. Height auto-scales to match aspect. */
  size?: number;
  className?: string;
};

const SouthernCross: React.FC<Props> = ({ size = 68, className }) => {
  // ViewBox is 100 wide x 130 tall (kite is slightly taller than wide).
  // Star positions in viewBox units:
  const stars = [
    // { cx, cy, r (core), glow (outer soft), delay (seconds) }
    { name: 'Gacrux',  cx: 50, cy: 12,  r: 3.0, glow: 9,  delay: 0   },  // top
    { name: 'Mimosa',  cx: 22, cy: 62,  r: 2.8, glow: 8,  delay: 1.3 },  // left arm
    { name: 'Delta',   cx: 78, cy: 55,  r: 2.2, glow: 7,  delay: 2.7 },  // right arm (dimmer)
    { name: 'Acrux',   cx: 52, cy: 112, r: 3.4, glow: 11, delay: 0.8 },  // bottom (brightest)
    { name: 'Epsilon', cx: 40, cy: 96,  r: 1.6, glow: 5,  delay: 2.0 },  // small, off-center
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
        style={{ overflow: 'visible' }}
      >
        <defs>
          <radialGradient id="crux-star-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%"  stopColor="rgba(255,255,255,1)" />
            <stop offset="60%" stopColor="rgba(220,235,255,0.9)" />
            <stop offset="100%" stopColor="rgba(180,210,255,0)" />
          </radialGradient>
          <radialGradient id="crux-star-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%"  stopColor="rgba(200,225,255,0.55)" />
            <stop offset="45%" stopColor="rgba(160,200,255,0.20)" />
            <stop offset="100%" stopColor="rgba(120,180,255,0)" />
          </radialGradient>
        </defs>

        {stars.map((s) => (
          <g key={s.name} style={{ transformOrigin: `${s.cx}px ${s.cy}px` }}>
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
