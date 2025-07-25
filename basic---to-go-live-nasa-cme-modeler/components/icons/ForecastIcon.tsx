// components/icons/ForecastIcon.tsx
import React from 'react';

// This component is a recreation of the provided image, with an animated aurora.
const ForecastIcon: React.FC<{ className?: string }> = ({ className }) => (
  <>
    {/*
      The CSS animation is embedded here to make the component self-contained.
      It works by sliding a dash pattern along the aurora path, making the rays "flow".
    */}
    <style>{`
      @keyframes aurora-flow {
        /*
          The 'to' value is a multiple of the stroke-dasharray's total length (1+6=7),
          which ensures the animation loops perfectly and smoothly.
        */
        to {
          stroke-dashoffset: -14;
        }
      }

      .aurora-rays {
        /*
          This is the core trick:
          - stroke-dasharray: "1 6" means draw 1px, then have a 6px gap.
          - stroke-width: 4 makes that 1px line a 4px tall rectangle.
          - stroke-linecap: square gives it the sharp edges from the image.
          The result is a series of small vertical lines along the main path.
        */
        stroke-dasharray: 1 6;
        animation: aurora-flow 1.5s infinite linear;
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
        {/*
          The static mountain range, traced from your image.
          It's filled with the current text color.
        */}
        <path
          fill="currentColor"
          stroke="none"
          d="M17.42,14.76c-0.3-0.02-0.58,0.08-0.81,0.28l-2.88,2.44l-2.7-4.23c-0.19-0.3-0.51-0.49-0.86-0.49s-0.67,0.19-0.86,0.49l-2.43,3.81L4.6,15.04c-0.24-0.17-0.54-0.24-0.83-0.18c-0.47,0.1-0.81,0.5-0.81,0.98v3.4c0,0.41,0.25,0.78,0.62,0.93L3,22h18l-0.56-1.84c0.37-0.15,0.62-0.52,0.62-0.93v-3.4C21.06,15.35,20.61,14.81,20,14.76z M11.99,10.33l1.88,2.94l2.1-1.78l3.03,2.56V18h-3v-1.58L14.1,15.1c-0.19-0.16-0.46-0.18-0.67-0.05l-2.31,1.45l2.08,3.28h-2.5L9.6,17.92l2.39-3.75L11.99,10.33z"
        />

        {/*
          The animated aurora path. The 'aurora-rays' class applies the
          flowing animation to the stroke of this path.
        */}
        <path
          className="aurora-rays"
          strokeWidth="4"
          strokeLinecap="square"
          d="M3.5,9.5 C6,4.5 10,4.5 12,9.5 S18,14.5 20.5,9.5"
        />
      </g>
    </svg>
  </>
);

export default ForecastIcon;