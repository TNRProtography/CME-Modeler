// components/icons/ForecastIcon.tsx
import React from 'react';

// This component now contains an animated SVG for the aurora icon.
const ForecastIcon: React.FC<{ className?: string }> = ({ className }) => (
  <>
    {/* 
      The CSS animations are embedded here to make the component self-contained.
      They create a gentle, asynchronous shimmering and fading effect.
    */}
    <style>{`
      @keyframes shimmer-and-fade {
        0%, 100% {
          transform: translateX(0px);
          opacity: 0.7;
        }
        50% {
          /* The paths will drift slightly to the right and become brighter */
          transform: translateX(8px);
          opacity: 1;
        }
      }

      /* Each path has a slightly different duration and delay to look more natural */
      .aurora-path-1 {
        animation: shimmer-and-fade 5s infinite ease-in-out;
      }
      .aurora-path-2 {
        animation: shimmer-and-fade 4s infinite ease-in-out -1s; /* Starts 1s into the animation */
      }
      .aurora-path-3 {
        animation: shimmer-and-fade 5.5s infinite ease-in-out -2s; /* Starts 2s into the animation */
      }
    `}</style>
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      strokeWidth="1.5"
      stroke="currentColor"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      {/* Each path is given a unique class to apply its own animation timing */}
      <path className="aurora-path-1" d="M3 17c3.333 -2 6.667 -2 10 0s6.667 2 10 0" />
      <path className="aurora-path-2" d="M3 14c3.333 -2 6.667 -2 10 0s6.667 2 10 0" />
      <path className="aurora-path-3" d="M3 11c3.333 -2 6.667 -2 10 0s6.667 2 10 0" />
    </svg>
  </>
);

export default ForecastIcon;