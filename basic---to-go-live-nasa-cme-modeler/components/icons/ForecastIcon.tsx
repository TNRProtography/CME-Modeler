// components/icons/ForecastIcon.tsx
import React from 'react';

const ForecastIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    className={className}
    viewBox="0 0 24 24" 
    strokeWidth="2" 
    stroke="currentColor" 
    fill="none" 
    strokeLinecap="round" 
    strokeLinejoin="round"
  >
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M4 18h16" />
    <path d="M4 12h16" />
    <path d="M4 6h16" />
    <path d="M7 20v-2" />
    <path d="M12 20v-4" />
    <path d="M17 20v-6" />
    <path d="M4 12v-6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v6" />
  </svg>
);

// This is the crucial line that was missing.
export default ForecastIcon;