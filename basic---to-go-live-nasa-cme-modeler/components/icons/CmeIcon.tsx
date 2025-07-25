// src/components/icons/CMEIcon.tsx
import React from 'react';

interface IconProps {
  className?: string;
}

const CMEIcon: React.FC<IconProps> = ({ className }) => (
  <svg
    className={className}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <defs>
      <radialGradient id="cmeGradient" cx="0.3" cy="0.5" r="0.7">
        <stop offset="0%" stopColor="#ffa500" />
        <stop offset="60%" stopColor="#ff4500" />
        <stop offset="100%" stopColor="#ff0000" stopOpacity="0.6" />
      </radialGradient>
    </defs>

    {/* Sun: larger and centered */}
    <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />

    {/* Rays (optional, light) */}
    <g stroke="currentColor">
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
    </g>

    {/* CME Burst */}
    <path
      d="M16,10 C19,10 21,12 21,14 C21,16 19,17 17,16 C19,15 19,12.5 16,12"
      fill="url(#cmeGradient)"
      stroke="none"
    />
  </svg>
);

export default CMEIcon;
