// src/components/icons/HomeIcon.tsx
import React from 'react';

interface IconProps {
  className?: string;
}

const HomeIcon: React.FC<IconProps> = ({ className }) => (
  <svg 
    className={className} 
    xmlns="http://www.w3.org/2000/svg" 
    fill="none" 
    viewBox="0 0 24 24" 
    strokeWidth={1.5} 
    stroke="currentColor"
  >
    <path 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      d="M21 7.5l-2.25-1.313M21 7.5v2.25m0-2.25l-2.25 1.313M3 7.5l2.25-1.313M3 7.5l2.25 1.313M3 7.5v2.25m9 3l2.25-1.313M12 12.75l-2.25-1.313M12 12.75V15m0-2.25l2.25 1.313M4.5 15.75l2.25-1.313M4.5 15.75l2.25 1.313M4.5 15.75V18m15-2.25l-2.25-1.313M19.5 15.75l-2.25 1.313M19.5 15.75V18" 
    />
  </svg>
);

export default HomeIcon;