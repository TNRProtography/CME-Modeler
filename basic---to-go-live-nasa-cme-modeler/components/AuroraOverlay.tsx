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
 * Design notes:
 *  - Uses `mix-blend-mode: screen` so layers ADD light to the photo
 *    instead of covering it - keeps the photo readable.
 *  - `pointer-events: none` so it never blocks clicks.
 *  - Every layer has a soft-edge mask (radial or linear alpha fade)
 *    on ALL sides so nothing terminates in a hard line - critical
 *    with screen-blend, which amplifies any sharp edge.
 *  - Sized in `vh` so it scales sensibly on tall mobile viewports
 *    instead of collapsing to a thin sliver.
 *  - Only transform/opacity/filter animate, so it stays GPU-only.
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
          0%,100% { filter: blur(34px) hue-rotate(0deg); }
          50%     { filter: blur(44px) hue-rotate(14deg); }
        }

        /* Soft-edge fades used to mask every layer on ALL sides so no
           hard cut ever appears against the photo. */
        .aurora-mask-horizon {
          -webkit-mask-image:
            radial-gradient(ellipse 70% 100% at 50% 60%, #000 40%, transparent 90%);
          mask-image:
            radial-gradient(ellipse 70% 100% at 50% 60%, #000 40%, transparent 90%);
        }
        .aurora-mask-pillars {
          -webkit-mask-image:
            linear-gradient(to right,  transparent 0%, #000 22%, #000 78%, transparent 100%),
            linear-gradient(to top,    #000 0%, rgba(0,0,0,0.85) 40%, rgba(0,0,0,0.35) 75%, transparent 100%);
          -webkit-mask-composite: source-in;
                  mask-image:
            linear-gradient(to right,  transparent 0%, #000 22%, #000 78%, transparent 100%),
            linear-gradient(to top,    #000 0%, rgba(0,0,0,0.85) 40%, rgba(0,0,0,0.35) 75%, transparent 100%);
                  mask-composite: intersect;
        }
        .aurora-mask-glow {
          -webkit-mask-image:
            radial-gradient(ellipse 80% 90% at 50% 60%, #000 30%, transparent 95%);
          mask-image:
            radial-gradient(ellipse 80% 90% at 50% 60%, #000 30%, transparent 95%);
        }
      `}</style>

      <div
        aria-hidden="true"
        className="absolute inset-0 z-0 overflow-hidden pointer-events-none"
      >
        {/* Bright green low band - the main aurora arc, matches horizon of pano. */}
        <div
          className="aurora-mask-horizon"
          style={{
            position: 'absolute',
            left: '-20%',
            right: '-20%',
            bottom: '22%',
            height: 'clamp(180px, 28vh, 360px)',
            background:
              'radial-gradient(ellipse at 50% 100%, rgba(120,255,180,0.9) 0%, rgba(80,220,150,0.6) 25%, rgba(60,180,140,0.25) 55%, rgba(0,0,0,0) 78%)',
            mixBlendMode: 'screen',
            filter: 'blur(30px)',
            animation:
              'aurora-drift-a 14s ease-in-out infinite, aurora-shimmer 9s ease-in-out infinite',
            willChange: 'transform, opacity, filter',
          }}
        />

        {/* Secondary softer green wash slightly higher - adds depth. */}
        <div
          className="aurora-mask-horizon"
          style={{
            position: 'absolute',
            left: '-25%',
            right: '-25%',
            bottom: '32%',
            height: 'clamp(160px, 24vh, 320px)',
            background:
              'radial-gradient(ellipse at 55% 100%, rgba(140,255,200,0.55) 0%, rgba(90,200,150,0.32) 40%, rgba(0,0,0,0) 80%)',
            mixBlendMode: 'screen',
            filter: 'blur(42px)',
            animation: 'aurora-drift-b 22s ease-in-out infinite',
            willChange: 'transform, opacity',
          }}
        />

        {/* Magenta/pink pillars - column beams rising from the green band. */}
        <div
          className="aurora-mask-pillars"
          style={{
            position: 'absolute',
            left: '0%',
            right: '0%',
            bottom: '28%',
            height: 'clamp(260px, 55vh, 700px)',
            background:
              'repeating-linear-gradient(92deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 60px, rgba(230,110,200,0.35) 90px, rgba(180,90,220,0.42) 120px, rgba(0,0,0,0) 180px, rgba(0,0,0,0) 260px, rgba(255,120,190,0.30) 300px, rgba(0,0,0,0) 360px)',
            mixBlendMode: 'screen',
            filter: 'blur(20px)',
            animation: 'aurora-pillars 18s ease-in-out infinite',
            willChange: 'transform, opacity',
          }}
        />

        {/* Broad magenta glow behind pillars - matches the photo's pink sky. */}
        <div
          className="aurora-mask-glow"
          style={{
            position: 'absolute',
            left: '-15%',
            right: '-15%',
            top: '10%',
            height: 'clamp(280px, 55vh, 720px)',
            background:
              'radial-gradient(ellipse at 50% 90%, rgba(220,120,180,0.32) 0%, rgba(160,80,200,0.20) 40%, rgba(0,0,0,0) 80%)',
            mixBlendMode: 'screen',
            filter: 'blur(55px)',
            animation: 'aurora-drift-b 26s ease-in-out infinite',
            willChange: 'transform, opacity',
          }}
        />
      </div>
    </>
  );
};

export default AuroraOverlay;