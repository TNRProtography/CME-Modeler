import React, { useMemo } from 'react';

/**
 * StarField
 * ----------------------------------------------------------------
 * A layer of randomly-scattered twinkling stars intended to sit
 * BETWEEN the background photo/aurora and the foreground content.
 *
 * Positioned `fixed` so it stays put with the viewport as the user
 * scrolls, matching the `background-attachment: fixed` behavior of
 * the pano photo. This way every part of the page has starry sky
 * without needing to render thousands of stars for the whole
 * scrollable area.
 *
 * Design notes:
 *  - Positions/sizes/delays are generated once from a fixed seed so
 *    they don't jump around between renders.
 *  - Pure CSS animation on `opacity` and `transform: scale()` for
 *    twinkle - all GPU, no rAF.
 *  - `pointer-events: none` so nothing beneath is blocked.
 *  - Concentrates stars slightly toward the upper 65% of the viewport
 *    (where sky is in the pano) but keeps some further down so the
 *    field never abruptly ends.
 *  - Sized so we render ~120 stars: enough to feel dense without
 *    tanking paint performance.
 */

type Star = {
  cx: number;    // percentage across viewport
  cy: number;    // percentage down viewport
  r: number;    // radius in px
  opacity: number;
  duration: number; // twinkle period in seconds
  delay: number;    // twinkle start offset
};

// Deterministic PRNG (mulberry32) so the star layout is stable
// across renders without needing to store it in state.
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STAR_COUNT = 140;
const SEED = 0x5aa5;

const generateStars = (): Star[] => {
  const rand = mulberry32(SEED);
  const out: Star[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    // Bias slightly toward upper 65% for the sky region, but keep
    // some in the lower area so the field never has a hard edge.
    const yBias = rand();
    const cy = yBias < 0.75 ? rand() * 65 : 65 + rand() * 35;

    // Most stars small, occasional bigger one for depth.
    const sizeRoll = rand();
    let r: number;
    if (sizeRoll < 0.75) r = 0.6 + rand() * 0.7;      // small
    else if (sizeRoll < 0.95) r = 1.2 + rand() * 0.8;  // medium
    else r = 1.8 + rand() * 1.2;                        // big/prominent

    out.push({
      cx: rand() * 100,
      cy,
      r,
      opacity: 0.35 + rand() * 0.55,
      duration: 2.5 + rand() * 4,     // 2.5 - 6.5s
      delay: rand() * 5,               // 0 - 5s stagger
    });
  }
  return out;
};

const StarField: React.FC = () => {
  const stars = useMemo(generateStars, []);

  return (
    <>
      <style>{`
        @keyframes star-twinkle {
          0%, 100% { opacity: var(--star-op-min);  transform: scale(0.85); }
          50%      { opacity: var(--star-op-max);  transform: scale(1.15); }
        }
      `}</style>

      <div
        aria-hidden="true"
        className="pointer-events-none"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          overflow: 'hidden',
        }}
      >
        {stars.map((s, i) => {
          const opMin = Math.max(0.15, s.opacity - 0.3);
          const opMax = Math.min(1, s.opacity + 0.15);
          return (
            <span
              key={i}
              style={{
                position: 'absolute',
                left: `${s.cx}%`,
                top: `${s.cy}%`,
                width: `${s.r * 2}px`,
                height: `${s.r * 2}px`,
                borderRadius: '50%',
                background:
                  'radial-gradient(circle, rgba(255,255,255,1) 0%, rgba(220,235,255,0.9) 45%, rgba(180,210,255,0) 100%)',
                boxShadow: `0 0 ${s.r * 3}px rgba(200,225,255,0.35)`,
                animation: `star-twinkle ${s.duration}s ease-in-out ${s.delay}s infinite`,
                // CSS vars consumed by the keyframes so each star has its own range
                ['--star-op-min' as any]: opMin,
                ['--star-op-max' as any]: opMax,
                willChange: 'opacity, transform',
              }}
            />
          );
        })}
      </div>
    </>
  );
};

export default StarField;
