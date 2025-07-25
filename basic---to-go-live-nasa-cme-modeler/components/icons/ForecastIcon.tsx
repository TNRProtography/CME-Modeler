// components/icons/ForecastIcon.tsx
import React from 'react';

const ForecastIcon: React.FC<{ className?: string }> = ({ className }) => (
  <>
    <style>{`
      @keyframes aurora-wave-1 {
        0% { transform: translateX(0); }
        100% { transform: translateX(-20px); }
      }
      @keyframes aurora-wave-2 {
        0% { transform: translateX(0); }
        100% { transform: translateX(20px); }
      }
      .aurora-path {
        fill: none;
        stroke-linecap: round;
        stroke-width: 2;
      }
      .aurora-layer-1 {
        stroke: url(#auroraGradient);
        stroke-width: 4;
        opacity: 0.8;
        animation: aurora-wave-1 4s linear infinite;
      }
      .aurora-layer-2 {
        stroke: url(#auroraGradient);
        stroke-width: 3;
        opacity: 0.5;
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
          <stop offset="0%" stopColor="#a0f0a0" />
          <stop offset="50%" stopColor="#50e0d0" />
          <stop offset="100%" stopColor="#a0f0a0" />
        </linearGradient>
      </defs>
      <g>
        {/* Mountain base - original static path */}
        <path
          fill="currentColor"
          stroke="none"
          d="M17.42,14.76c-0.3-0.02-0.58,0.08-0.81,0.28l-2.88,2.44l-2.7-4.23c-0.19-0.3-0.51-0.49-0.86-0.49s-0.67,0.19-0.86,0.49l-2.43,3.81L4.6,15.04c-0.24-0.17-0.54-0.24-0.83-0.18c-0.47,0.1-0.81,0.5-0.81,0.98v3.4c0,0.41,0.25,0.78,0.62,0.93L3,22h18l-0.56-1.84c0.37-0.15,0.62-0.52,0.62-0.93v-3.4C21.06,15.35,20.61,14.81,20,14.76z M11.99,10.33l1.88,2.94l2.1-1.78l3.03,2.56V18h-3v-1.58L14.1,15.1c-0.19-0.16-0.46-0.18-0.67-0.05l-2.31,1.45l2.08,3.28h-2.5L9.6,17.92l2.39-3.75L11.99,10.33z"
        />

        {/* Animated aurora layers */}
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
