// components/icons/ForecastIcon.tsx
import React from 'react';

// A high-fidelity, animated recreation of the provided icon.
const ForecastIcon: React.FC<{ className?: string }> = ({ className }) => (
  <>
    {/*
      This embedded CSS creates a more sophisticated, layered aurora animation.
    */}
    <style>{`
      @keyframes aurora-shimmer {
        0% {
          stroke-dashoffset: 0;
          opacity: 0.5;
        }
        50% {
          opacity: 1;
        }
        100% {
          stroke-dashoffset: -200; /* A large value to ensure smooth looping */
          opacity: 0.5;
        }
      }

      /* Each layer has a different speed and delay for a natural, non-repeating feel. */
      .aurora-layer-1 {
        animation: aurora-shimmer 6s infinite ease-in-out;
      }
      .aurora-layer-2 {
        animation: aurora-shimmer 4.5s infinite ease-in-out -1.5s; /* Faster and delayed */
      }
    `}</style>
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
    >
      <g>
        {/* Layer 1: The solid mountain base, filled with the current text color. */}
        <path
          fill="currentColor"
          stroke="none"
          d="M17.42 14.76c-.3-.02-.58.08-.81.28l-2.88 2.44-2.7-4.23a1.14 1.14 0 00-1.72 0l-2.43 3.81-2.28-1.82c-.24-.17-.54-.24-.83-.18-.47.1-.81.5-.81.98v3.4c0 .41.25.78.62.93L3 22h18l-.56-1.84c.37-.15.62-.52.62-.93v-3.4c0-.55-.45-1.09-1-1.03z"
        />

        {/* Layer 2: The snow-cap on the main peak. */ }
        <path
          fill="currentColor"
          stroke="none"
          d="M12.01 10.33l1.88 2.94.7-.58-2.58-4.06-2.58 4.06.7.58 1.88-2.94z"
        />

        {/*
          This group contains the two animated aurora layers.
          The linecap and linejoin are set for the whole group.
        */}
        <g strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          {/*
            The back layer of the aurora. The dash-array creates the "rays".
            The pattern is [visible ray, gap, slightly longer ray, gap]
          */}
          <path
            className="aurora-layer-1"
            strokeDasharray="2 8 3 8"
            d="M4.5 9C6 5 9 5 11 9s5 4 7-1"
          />
          {/*
            The front layer of the aurora. It has a slightly different path and
            animation timing to create a parallax effect.
          */}
          <path
            className="aurora-layer-2"
            strokeDasharray="2 6 2 6"
            d="M3 10c2-4 5-4 7 0s5 5 7.5 0"
          />
        </g>
      </g>
    </svg>
  </>
);

export default ForecastIcon;