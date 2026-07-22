import React from 'react';

/**
 * AuroraOverlay
 * ----------------------------------------------------------------
 * A purely-decorative animated aurora effect intended to sit BETWEEN
 * the background photo and the foreground UI. It adds a live shimmer
 * of green low-band + magenta/pink pillars that align with the
 * Rapahoe pano's aurora, so the static photo feels alive.
 *
 * Design notes:
 *  - Uses `mix-blend-mode: screen` so the layers ADD light to the
 *    photo instead of covering it - keeps the photo readable.
 *  - `pointer-events: none` so it never blocks clicks on UI beneath.
 *  - Fully CSS-driven: no canvas, no rAF, minimal CPU. Animations
 *    are transform/opacity/filter only so they stay on the GPU.
 *  - Positioned with `absolute inset-0` so the parent must be
 *    `relative` (both dashboards already are).
 *  - Sits at z-0. Foreground content should be at z-10 or higher.
 *  - Uses `background-attachment: fixed`-style behavior via
 *    `position: fixed` layers inside so the effect follows the
 *    viewport, matching the fixed-attachment background photo.
 */
const AuroraOverlay: React.FC = () => {
  return (
    <>
      <style>{`
        @keyframes aurora-drift-a {
          0%   { transform: translate3d(-4%, 0, 0) scaleY(1);   opacity: 0.55; }
          50%  { transform: translate3d( 4%, -1%, 0) scaleY(1.08); opacity: 0.85; }
          100% { transform: translate3d(-4%, 0, 0) scaleY(1);   opacity: 0.55; }
        }
        @keyframes aurora-drift-b {
          0%   { transform: translate3d( 3%, 0, 0) scaleY(1.05); opacity: 0.4; }
          50%  { transform: translate3d(-3%, 1%, 0) scaleY(1);    opacity: 0.7; }
          100% { transform: translate3d( 3%, 0, 0) scaleY(1.05); opacity: 0.4; }
        }
        @keyframes aurora-pillars {
          0%   { transform: translate3d(-2%, 0, 0) skewX(-2deg); opacity: 0.5; }
          40%  { transform: translate3d( 2%, 0, 0) skewX( 2deg); opacity: 0.85; }
          70%  { transform: translate3d( 0%, 0, 0) skewX(-1deg); opacity: 0.65; }
          100% { transform: translate3d(-2%, 0, 0) skewX(-2deg); opacity: 0.5; }
        }
        @keyframes aurora-shimmer {
          0%,100% { filter: blur(30px) hue-rotate(0deg); }
          50%     { filter: blur(38px) hue-rotate(12deg); }
        }
      `}</style>

      <div
        aria-hidden="true"
        className="absolute inset-0 z-0 overflow-hidden pointer-events-none"
      >
        {/* Green low band - hugs the horizon of the pano. */}
        <div
          style={{
            position: 'absolute',
            left: '-10%',
            right: '-10%',
            bottom: '28%',
            height: '22%',
            background:
              'radial-gradient(ellipse at 50% 100%, rgba(120,255,180,0.55) 0%, rgba(80,220,150,0.35) 30%, rgba(60,180,140,0.15) 55%, rgba(0,0,0,0) 75%)',
            mixBlendMode: 'screen',
            filter: 'blur(28px)',
            animation: 'aurora-drift-a 14s ease-in-out infinite, aurora-shimmer 9s ease-in-out infinite',
            willChange: 'transform, opacity, filter',
          }}
        />

        {/* Secondary softer green wash slightly higher - adds depth. */}
        <div
          style={{
            position: 'absolute',
            left: '-15%',
            right: '-15%',
            bottom: '38%',
            height: '18%',
            background:
              'radial-gradient(ellipse at 55% 100%, rgba(140,255,200,0.35) 0%, rgba(90,200,150,0.20) 40%, rgba(0,0,0,0) 75%)',
            mixBlendMode: 'screen',
            filter: 'blur(40px)',
            animation: 'aurora-drift-b 22s ease-in-out infinite',
            willChange: 'transform, opacity',
          }}
        />

        {/* Magenta/pink pillars - column-like beams rising from the green band. */}
        <div
          style={{
            position: 'absolute',
            left: '5%',
            right: '5%',
            bottom: '35%',
            height: '55%',
            background:
              'repeating-linear-gradient(92deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 60px, rgba(230,110,200,0.22) 90px, rgba(180,90,220,0.28) 120px, rgba(0,0,0,0) 180px, rgba(0,0,0,0) 260px, rgba(255,120,190,0.18) 300px, rgba(0,0,0,0) 360px)',
            maskImage: 'linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,0.9) 30%, rgba(0,0,0,0.5) 65%, rgba(0,0,0,0) 100%)',
            WebkitMaskImage: 'linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,0.9) 30%, rgba(0,0,0,0.5) 65%, rgba(0,0,0,0) 100%)',
            mixBlendMode: 'screen',
            filter: 'blur(18px)',
            animation: 'aurora-pillars 18s ease-in-out infinite',
            willChange: 'transform, opacity',
          }}
        />

        {/* Broad magenta glow behind pillars - matches the photo's sky. */}
        <div
          style={{
            position: 'absolute',
            left: '-10%',
            right: '-10%',
            top: '18%',
            height: '50%',
            background:
              'radial-gradient(ellipse at 50% 90%, rgba(220,120,180,0.18) 0%, rgba(160,80,200,0.12) 40%, rgba(0,0,0,0) 75%)',
            mixBlendMode: 'screen',
            filter: 'blur(50px)',
            animation: 'aurora-drift-b 26s ease-in-out infinite',
            willChange: 'transform, opacity',
          }}
        />
      </div>
    </>
  );
};

export default AuroraOverlay;
