import React from 'react';

// The three animated badges on the nav buttons.
//
// They used to move with SVG <animate> elements. Those run on the main
// thread: every frame, on every page, for as long as the app was open, the
// browser recalculated style, laid the page out and repainted to move a few
// pixels of a 12px icon - the one thing keeping the app from ever being idle,
// and work every scroll frame had to share the thread with.
//
// Now each badge is a few stacked SVG layers, and each moving layer is moved
// by a CSS transform or opacity animation (the nav-badge-* classes in
// index.html), which the GPU runs off the main thread. A shape that changed
// its outline sways instead, which at this size reads the same.

const Layer: React.FC<{ anim?: string; children: React.ReactNode }> = ({ anim, children }) => (
  <svg
    className={`absolute inset-0 w-full h-full overflow-visible${anim ? ` nav-badge-anim ${anim}` : ''}`}
    viewBox="0 0 64 64"
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
  >
    {children}
  </svg>
);

const Badge: React.FC<{ className?: string; children: React.ReactNode }> = ({ className, children }) => (
  <span className={`relative inline-block ${className ?? ''}`} role="img" aria-hidden="true">
    {children}
  </span>
);

const AuroraBadgeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <Badge className={className}>
    <Layer anim="nav-badge-glow">
      <defs>
        <radialGradient id="auroraGlow" cx="50%" cy="20%" r="70%">
          <stop offset="0%" stopColor="#a5f3fc" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#312e81" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="6" y="6" width="52" height="52" rx="18" fill="url(#auroraGlow)" />
    </Layer>
    <Layer anim="nav-badge-aurora">
      <defs>
        <linearGradient id="auroraGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6ee7ff" />
          <stop offset="50%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <path
        d="M10 40c6-6 12-10 18-10 8 0 10 6 18 6 5 0 10-2 14-6-3 10-12 18-22 18-8 0-17-4-28-8z"
        fill="url(#auroraGradient)"
        opacity="0.8"
      />
    </Layer>
    <Layer anim="nav-badge-moon">
      <circle cx="20" cy="24" r="6" fill="#fef3c7" />
    </Layer>
    <Layer anim="nav-badge-star">
      <circle cx="42" cy="18" r="3" fill="#fbbf24" opacity="0.8" />
    </Layer>
  </Badge>
);

const SolarBadgeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <Badge className={className}>
    <Layer anim="nav-badge-sun">
      <defs>
        <radialGradient id="solarCore" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fffbeb" />
          <stop offset="50%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#f97316" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="14" fill="url(#solarCore)" />
    </Layer>
    <Layer anim="nav-badge-rays">
      <g strokeLinecap="round" strokeWidth="3" stroke="#fdba74">
        {[...Array(8)].map((_, i) => {
          const angle = (i * Math.PI) / 4;
          const x1 = 32 + Math.cos(angle) * 18;
          const y1 = 32 + Math.sin(angle) * 18;
          const x2 = 32 + Math.cos(angle) * 26;
          const y2 = 32 + Math.sin(angle) * 26;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />;
        })}
      </g>
    </Layer>
    <Layer anim="nav-badge-flare">
      <path
        d="M18 44c6-2 10-3 14-3 5 0 10 1 15 4"
        stroke="#f59e0b"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
        opacity="0.6"
      />
    </Layer>
  </Badge>
);

const ModelerBadgeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <Badge className={className}>
    {/* A plain disc: it used to spin, which a disc does not show. */}
    <Layer>
      <circle cx="32" cy="32" r="10" fill="#0ea5e9" opacity="0.9" />
    </Layer>
    <Layer anim="nav-badge-orbit">
      <defs>
        <linearGradient id="orbitGlow" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#c084fc" />
          <stop offset="50%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <ellipse cx="32" cy="32" rx="22" ry="10" fill="none" stroke="url(#orbitGlow)" strokeWidth="3" opacity="0.9" />
    </Layer>
    <Layer anim="nav-badge-planet">
      <circle cx="50" cy="28" r="5" fill="#f472b6" opacity="0.95" />
    </Layer>
    <Layer anim="nav-badge-moonlet">
      <circle cx="18" cy="36" r="3" fill="#a855f7" opacity="0.8" />
    </Layer>
  </Badge>
);

export { AuroraBadgeIcon, SolarBadgeIcon, ModelerBadgeIcon };
