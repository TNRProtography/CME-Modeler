import React from 'react';

interface IconProps {
  className?: string;
}

const CameraResetIcon: React.FC<IconProps> = ({ className }) => (
  <svg
    className={className}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="7" width="13" height="10" rx="2.5" ry="2.5" />
    <path d="M6.5 7l1.1-2.2A1 1 0 018.4 4h2.2a1 1 0 01.9.6L12.5 7" />
    <circle cx="8.5" cy="12" r="2.6" />
  </svg>
);

export default CameraResetIcon;
