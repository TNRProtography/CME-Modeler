// src/components/icons/CMEIcon.tsx
import React from 'react';

interface IconProps {
  className?: string;
}

const CMEIcon: React.FC<IconProps> = ({ className }) => (
  <>
    <style>{`
      @keyframes cme-pulse {
        0% {
          transform: scale(0.8);
          opacity: 0.7;
        }
        50% {
          transform: scale(1.1);
          opacity: 1;
        }
        100% {
          transform: scale(0.8);
          opacity: 0.7;
        }
      }
    `}</style>
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
        <radialGradient id="cmeGradient" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffa500" />
          <stop offset="50%" stopColor="#ff4500" />
          <stop offset="100%" stopColor="#ff0000" stopOpacity="0.4" />
        </radialGradient>
      </defs>

      {/* Central Sun */}
      <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />

      {/* Sun Rays */}
      <g stroke="currentColor">
        <line x1="12" y1="2" x2="12" y2="4" />
        <line x1="12" y1="20" x2="12" y2="22" />
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        <line x1="2" y1="12" x2="4" y2="12" />
        <line x1="20" y1="12" x2="22" y2="12" />
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
      </g>

      {/* Animated CME Explosion */}
      <circle
        cx="18"
        cy="12"
        r="2.5"
        fill="url(#cmeGradient)"
        stroke="none"
        style={{
          transformOrigin: '18px 12px',
          animation: 'cme-pulse 2s infinite ease-in-out',
        }}
      />
    </svg>
  </>
);

export default CMEIcon;
