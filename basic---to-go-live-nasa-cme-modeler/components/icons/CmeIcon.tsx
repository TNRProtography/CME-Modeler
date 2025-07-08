// components/icons/CmeIcon.tsx
import React from 'react';

const CmeIcon: React.FC<{ className?: string }> = ({ className }) => (
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
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v-2" />
    <path d="M12 21v2" />
    <path d="M3 12h-2" />
    <path d="M21 12h2" />
    <path d="M5.6 5.6l-1.4 -1.4" />
    <path d="M18.4 5.6l1.4 -1.4" />
    <path d="M5.6 18.4l-1.4 1.4" />
    <path d="M18.4 18.4l1.4 1.4" />
  </svg>
);

export default CmeIcon;