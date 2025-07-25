// src/components/icons/CMEIcon.tsx
import React from 'react';

interface IconProps {
  className?: string;
}

const CMEIcon: React.FC<IconProps> = ({ className }) => (
  <>
    <style>{`
      @keyframes cme-wave {
        0% {
          transform: scale(0.9) translateX(0);
          opacity: 1;
        }
        100% {
          transform: scale(1.3) translateX(2px);
          opacity: 0;
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
    >
      <g>
        {/* Sun body */}
        <circle cx="7" cy="12" r="2.5" fill="currentColor" stroke="none" />

        {/* Sun rays */}
        <line x1="7" y1="8.5" x2="7" y2="6.5" stroke="currentColor" />
        <line x1="7" y1="15.5" x2="7" y2="17.5" stroke="currentColor" />
        <line x1="4.5" y1="12" x2="2.5" y2="12" stroke="currentColor" />
        <line x1="9.5" y1="12" x2="11.5" y2="12" stroke="currentColor" />

        {/* Animated CME arc */}
        <path
          d="M7,12 C10,10 14,10 17,12"
          stroke="currentColor"
          strokeWidth="1.8"
          fill="none"
          style={{
            transformOrigin: '7px 12px',
            animation: 'cme-wave 2s ease-out infinite',
          }}
        />
      </g>
    </svg>
  </>
);

export default CMEIcon;
