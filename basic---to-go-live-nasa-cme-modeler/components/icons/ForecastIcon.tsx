// components/icons/ForecastIcon.tsx
import React from 'react';

// This component now contains a completely redesigned and reanimated SVG for the aurora icon.
const ForecastIcon: React.FC<{ className?: string }> = ({ className }) => (
  <>
    {/*
      The CSS animations are embedded here to make the component self-contained.
      This animation works by moving a dash pattern along the SVG path,
      creating a flowing, shimmering effect that looks like a real aurora.
    */}
    <style>{`
      @keyframes aurora-wave {
        0% {
          stroke-dashoffset: 0;
          opacity: 0.6;
        }
        50% {
          opacity: 1;
        }
        100% {
          stroke-dashoffset: -200; /* A large number to ensure the pattern moves significantly */
          opacity: 0.6;
        }
      }

      /* Each path is a "curtain" of the aurora. */
      /* They have different shapes, animation speeds, and delays to look natural. */
      .aurora-curtain-1 {
        animation: aurora-wave 7s infinite linear;
      }
      .aurora-curtain-2 {
        animation: aurora-wave 5s infinite linear -2s; /* Starts 2s into its cycle */
      }
      .aurora-curtain-3 {
        animation: aurora-wave 6s infinite linear -4s; /* Starts 4s into its cycle */
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
      {/* 
        The 'stroke-dasharray' creates a pattern of dashes and gaps.
        The @keyframes animation then moves this pattern along the line.
      */}
      <path
        className="aurora-curtain-1"
        strokeDasharray="10 5 3 5" /* Defines the pattern: [dash, gap, dash, gap] */
        d="M3 19c1.667-1.333 3.333-1.333 5 0c1.667 1.333 3.333 1.333 5 0c1.667-1.333 3.333-1.333 5 0L18 7"
      />
      <path
        className="aurora-curtain-2"
        strokeDasharray="12 4 4 4"
        d="M5 19c1.667-1.333 3.333-1.333 5 0c1.667 1.333 3.333 1.333 5 0c1.667-1.333 3.333-1.333 5 0V9"
      />
      <path
        className="aurora-curtain-3"
        strokeDasharray="8 6 4 6"
        d="M7 19c1.667-1.333 3.333-1.333 5 0c1.667 1.333 3.333 1.333 5 0c1.667-1.333 3.333-1.333 5 0L21 11"
      />
    </svg>
  </>
);

export default ForecastIcon;