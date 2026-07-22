import React from 'react';

/**
 * AuroraOverlay
 * ----------------------------------------------------------------
 * A purely-decorative animated aurora effect intended to sit BETWEEN
 * the background photo and the foreground UI. It adds a live shimmer
 * of green low-band + magenta/pink pillars so the static photo
 * feels alive.
 *
 * Layering (bottom to top on the page):
 *   photo -> bg-black/50 darkener -> THIS overlay -> content (z-10+)
 *
 * Design principles for eliminating hard edges:
 *  - Every gradient fades to zero alpha well BEFORE its own boundary
 *    (target: gradient stops carry the alpha to 0 by ~70% radius).
 *    A radial gradient in a box always has an elliptical iso-alpha
 *    contour; if we let ANY alpha reach the container edge, screen
 *    blend will show it as a shape.
 *  - Every layer overshoots the viewport by 40-60% on the axes where
 *    its light is meant to bleed offscreen, so its zero-alpha tail
 *    ends outside what the user can see.
 *  - Large blurs (60-90px) further smear any residual boundary.
 *  - No CSS masks - they were creating a second visible falloff
 *    curve that stacked with the gradient's own. The gradient IS
 *    the mask.
 *  - `mix-blend-mode: screen` so layers add light rather than paint
 *    over the photo.
 *  - `pointer-events: none` so nothing under is blocked.
 *  - Only transform/opacity/filter animate - GPU only.
 */
const AuroraOverlay: React.FC = () => {
  return (
    <>
      <style>{`
        @keyframes aurora-drift-a {
          0%   { transform: translate3d(-3%, 0, 0) scaleY(1);    opacity: 0.75; }
          50%  { transform: translate3d( 3%, -1%, 0) scaleY(1.1); opacity: 1;    }
          100% { transform: translate3d(-3%, 0, 0) scaleY(1);    opacity: 0.75; }
        }
        @keyframes aurora-drift-b {
          0%   { transform: translate3d( 2%, 0, 0) scaleY(1.05); opacity: 0.55; }
          50%  { transform: translate3d(-2%, 1%, 0) scaleY(1);    opacity: 0.9;  }
          100% { transform: translate3d( 2%, 0, 0) scaleY(1.05); opacity: 0.55; }
        }
        @keyframes aurora-pillars {
          0%   { transform: translate3d(-1.5%, 0, 0) skewX(-2deg); opacity: 0.7;  }
          40%  { transform: translate3d( 1.5%, 0, 0) skewX( 2deg); opacity: 1;    }
          70%  { transform: translate3d( 0%, 0, 0) skewX(-1deg);   opacity: 0.85; }
          100% { transform: translate3d(-1.5%, 0, 0) skewX(-2deg); opacity: 0.7;  }
        }
        @keyframes aurora-shimmer {
          0%,100% { filter: blur(60px) hue-rotate(0deg); }
          50%     { filter: blur(78px) hue-rotate(14deg); }
        }
      `}</style>

      <div
        aria-hidden="true"
        className="absolute inset-0 z-0 overflow-hidden pointer-events-none"
      >
        {/* Bright green low band. Overshoots viewport by 60% each side;
            gradient fades to 0 alpha by 68% of its radius so no edge
            contour ever reaches an actual boundary. */}
        <div
          style={{
            position: 'absolute',
            left: '-60%',
            right: '-60%',
            bottom: '18%',
            height: 'clamp(220px, 34vh, 420px)',
            background:
              'radial-gradient(ellipse at 50% 100%, rgba(120,255,180,0.9) 0%, rgba(100,240,170,0.55) 18%, rgba(80,220,150,0.28) 34%, rgba(60,180,140,0.10) 50%, rgba(0,0,0,0) 68%)',
            mixBlendMode: 'screen',
            filter: 'blur(60px)',
            animation:
              'aurora-drift-a 14s ease-in-out infinite, aurora-shimmer 9s ease-in-out infinite',
            willChange: 'transform, opacity, filter',
          }}
        />

        {/* Secondary softer green wash slightly higher - adds depth. */}
        <div
          style={{
            position: 'absolute',
            left: '-70%',
            right: '-70%',
            bottom: '30%',
            height: 'clamp(200px, 30vh, 400px)',
            background:
              'radial-gradient(ellipse at 55% 100%, rgba(140,255,200,0.55) 0%, rgba(110,230,180,0.30) 22%, rgba(90,200,150,0.14) 42%, rgba(0,0,0,0) 65%)',
            mixBlendMode: 'screen',
            filter: 'blur(75px)',
            animation: 'aurora-drift-b 22s ease-in-out infinite',
            willChange: 'transform, opacity',
          }}
        />

        {/* Magenta/pink pillar wash. Instead of hard column beams that
            need masking on top/bottom/sides, this is a broad diffuse
            wash with faint column texture. The whole layer fades on
            every axis via its own gradient, so no mask required. */}
        <div
          style={{
            position: 'absolute',
            left: '-40%',
            right: '-40%',
            bottom: '25%',
            height: 'clamp(320px, 62vh, 780px)',
            background: `
              radial-gradient(ellipse 55% 80% at 50% 90%, rgba(230,110,200,0.42) 0%, rgba(200,100,220,0.24) 25%, rgba(180,90,220,0.10) 50%, rgba(0,0,0,0) 72%),
              repeating-linear-gradient(92deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 80px, rgba(230,110,200,0.10) 110px, rgba(180,90,220,0.14) 150px, rgba(0,0,0,0) 220px, rgba(0,0,0,0) 320px, rgba(255,120,190,0.09) 360px, rgba(0,0,0,0) 420px)
            `,
            backgroundBlendMode: 'screen',
            mixBlendMode: 'screen',
            filter: 'blur(45px)',
            animation: 'aurora-pillars 18s ease-in-out infinite',
            willChange: 'transform, opacity',
          }}
        />

        {/* Broad magenta sky glow - matches the photo's pink upper sky. */}
        <div
          style={{
            position: 'absolute',
            left: '-50%',
            right: '-50%',
            top: '0%',
            height: 'clamp(340px, 65vh, 820px)',
            background:
              'radial-gradient(ellipse at 50% 90%, rgba(220,120,180,0.32) 0%, rgba(190,100,200,0.16) 25%, rgba(160,80,200,0.06) 50%, rgba(0,0,0,0) 72%)',
            mixBlendMode: 'screen',
            filter: 'blur(90px)',
            animation: 'aurora-drift-b 26s ease-in-out infinite',
            willChange: 'transform, opacity',
          }}
        />
      </div>
    </>
  );
};

export default AuroraOverlay;
