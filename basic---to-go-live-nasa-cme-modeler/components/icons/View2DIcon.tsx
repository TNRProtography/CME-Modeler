// --- START OF FILE src/components/icons/View2DIcon.tsx ---

import React from 'react';

const View2DIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    className={className} 
    fill="none" 
    viewBox="0 0 24 24" 
    stroke="currentColor" 
    strokeWidth={1.5}
  >
    <path 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      d="M6 6h12v12H6V6z" // A simple square to represent 2D
    />
    <path 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      d="M10 10m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" // A dot inside
    />
    <path 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      d="M15 15m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" // A circle inside
    />
  </svg>
);

export default View2DIcon;
// --- END OF FILE src/components/icons/View2DIcon.tsx ---