// components/icons/ForecastIcon.tsx
import React from 'react';

// This component now contains the SVG for the aurora icon.
const ForecastIcon: React.FC<{ className?: string }> = ({ className }) => (
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
    <path d="M3 17c3.333 -2 6.667 -2 10 0s6.667 2 10 0" />
    <path d="M3 14c3.333 -2 6.667 -2 10 0s6.667 2 10 0" />
    <path d="M3 11c3.333 -2 6.667 -2 10 0s6.667 2 10 0" />
  </svg>
);

export default ForecastIcon;