import React from 'react';

const AuroraBadgeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 64 64"
    role="img"
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id="auroraGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#6ee7ff" />
        <stop offset="50%" stopColor="#7c3aed" />
        <stop offset="100%" stopColor="#22d3ee" />
      </linearGradient>
      <radialGradient id="auroraGlow" cx="50%" cy="20%" r="70%">
        <stop offset="0%" stopColor="#a5f3fc" stopOpacity="0.9" />
        <stop offset="100%" stopColor="#312e81" stopOpacity="0" />
      </radialGradient>
    </defs>
    <rect x="6" y="6" width="52" height="52" rx="18" fill="url(#auroraGlow)">
      <animate
        attributeName="opacity"
        values="0.4;0.8;0.4"
        dur="4s"
        repeatCount="indefinite"
      />
    </rect>
    <path
      d="M10 40c6-6 12-10 18-10 8 0 10 6 18 6 5 0 10-2 14-6-3 10-12 18-22 18-8 0-17-4-28-8z"
      fill="url(#auroraGradient)"
      opacity="0.8"
    >
      <animate
        attributeName="d"
        dur="6s"
        repeatCount="indefinite"
        values="M10 40c6-6 12-10 18-10 8 0 10 6 18 6 5 0 10-2 14-6-3 10-12 18-22 18-8 0-17-4-28-8z;M10 38c7-4 14-9 20-9 7 0 9 6 17 6 6 0 11-3 15-7-3 11-12 19-22 19-9 0-17-3-30-9z;M10 40c6-6 12-10 18-10 8 0 10 6 18 6 5 0 10-2 14-6-3 10-12 18-22 18-8 0-17-4-28-8z"
      />
    </path>
    <circle cx="20" cy="24" r="6" fill="#fef3c7">
      <animate
        attributeName="r"
        values="5;6.5;5"
        dur="3s"
        repeatCount="indefinite"
      />
    </circle>
    <circle cx="42" cy="18" r="3" fill="#fbbf24" opacity="0.8">
      <animateTransform
        attributeName="transform"
        type="translate"
        dur="5s"
        values="0 0; 2 -1; 0 0"
        repeatCount="indefinite"
      />
    </circle>
  </svg>
);

const SolarBadgeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 64 64"
    role="img"
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <radialGradient id="solarCore" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#fffbeb" />
        <stop offset="50%" stopColor="#fbbf24" />
        <stop offset="100%" stopColor="#f97316" />
      </radialGradient>
    </defs>
    <circle cx="32" cy="32" r="14" fill="url(#solarCore)">
      <animateTransform
        attributeName="transform"
        attributeType="XML"
        type="scale"
        values="1;1.06;1"
        dur="3s"
        repeatCount="indefinite"
      />
    </circle>
    <g strokeLinecap="round" strokeWidth="3" stroke="#fdba74" opacity="0.9">
      {[...Array(8)].map((_, i) => {
        const angle = (i * Math.PI) / 4;
        const x1 = 32 + Math.cos(angle) * 18;
        const y1 = 32 + Math.sin(angle) * 18;
        const x2 = 32 + Math.cos(angle) * 26;
        const y2 = 32 + Math.sin(angle) * 26;
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />;
      })}
      <animate
        attributeName="opacity"
        values="0.7;1;0.7"
        dur="2.4s"
        repeatCount="indefinite"
      />
    </g>
    <path
      d="M18 44c6-2 10-3 14-3 5 0 10 1 15 4"
      stroke="#f59e0b"
      strokeWidth="3"
      strokeLinecap="round"
      fill="none"
      opacity="0.6"
    >
      <animate
        attributeName="d"
        dur="4s"
        repeatCount="indefinite"
        values="M18 44c6-2 10-3 14-3 5 0 10 1 15 4;M18 42c6-1 10-3 14-3 5 0 10 2 15 5;M18 44c6-2 10-3 14-3 5 0 10 1 15 4"
      />
    </path>
  </svg>
);

const ModelerBadgeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 64 64"
    role="img"
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id="orbitGlow" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#c084fc" />
        <stop offset="50%" stopColor="#8b5cf6" />
        <stop offset="100%" stopColor="#22d3ee" />
      </linearGradient>
    </defs>
    <circle cx="32" cy="32" r="10" fill="#0ea5e9" opacity="0.9">
      <animateTransform
        attributeName="transform"
        type="rotate"
        from="0 32 32"
        to="360 32 32"
        dur="12s"
        repeatCount="indefinite"
      />
    </circle>
    <ellipse
      cx="32"
      cy="32"
      rx="22"
      ry="10"
      fill="none"
      stroke="url(#orbitGlow)"
      strokeWidth="3"
      opacity="0.9"
    >
      <animateTransform
        attributeName="transform"
        type="rotate"
        from="0 32 32"
        to="-360 32 32"
        dur="9s"
        repeatCount="indefinite"
      />
    </ellipse>
    <circle cx="50" cy="28" r="5" fill="#f472b6" opacity="0.95">
      <animate
        attributeName="r"
        values="4.5;6;4.5"
        dur="5s"
        repeatCount="indefinite"
      />
    </circle>
    <circle cx="18" cy="36" r="3" fill="#a855f7" opacity="0.8">
      <animateTransform
        attributeName="transform"
        type="translate"
        dur="6s"
        values="0 0; 1 -2; 0 0"
        repeatCount="indefinite"
      />
    </circle>
  </svg>
);

export { AuroraBadgeIcon, SolarBadgeIcon, ModelerBadgeIcon };
