// components/icons/ForecastIcon.tsx
import React from 'react';

const ForecastIcon: React.FC<{ className?: string }> = ({ className }) => (
  <>
    <style>{`
      @keyframes aurora-wave-1 {
        0% { transform: translateX(0); }
        100% { transform: translateX(-15px); }
      }

      @keyframes aurora-wave-2 {
        0% { transform: translateX(0); }
        100% { transform: translateX(15px); }
      }

      .aurora-path {
        fill: none;
        stroke-linecap: round;
      }

      .aurora-layer-1 {
        stroke: url(#auroraGradient);
        stroke-width: 5;
        opacity: 0.8;
        filter: url(#glow);
        animation: aurora-wave-1 4s linear infinite;
      }

      .aurora-layer-2 {
        stroke: url(#auroraGradient);
        stroke-width: 3;
        opacity: 0.5;
        filter: url(#glow);
        animation: aurora-wave-2 6s linear infinite;
      }
    `}</style>
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
    >
      <defs>
        <linearGradient id="auroraGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#8ef2af" />
          <stop offset="50%" stopColor="#5be9e3" />
          <stop offset="100%" stopColor="#8ef2af" />
        </linearGradient>

        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g>
        {/* Simplified smooth mountain silhouette */}
        <path
          fill="currentColor"
          stroke="none"
          d="M2,20 L7,14 L10,17 L13,13 L17,17 L22,13 L22,22 L2,22 Z"
        />

        {/* Animated glowing aurora ribbons */}
        <g transform="translate(0, -1)">
          <path
            className="aurora-path aurora-layer-1"
            d="M2,8 C6,4 10,4 12,8 C14,12 18,12 22,8"
          />
          <path
            className="aurora-path aurora-layer-2"
            d="M2,9 C6.5,5 10,5 12,9 C14,13 18,13 22,9"
          />
        </g>
      </g>
    </svg>
  </>
);

export default ForecastIcon;
