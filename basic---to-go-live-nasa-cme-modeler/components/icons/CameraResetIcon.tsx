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
    <rect x="3" y="7" width="18" height="12" rx="3" ry="3" />
    <path d="M9 7l1.2-2.4A1 1 0 0111.09 4h1.82a1 1 0 01.89.6L15 7" />
    <circle cx="12" cy="13" r="3" />
    <path d="M15.5 9.5a4 4 0 11-1-2.5" />
    <path d="M16.5 10.5h-2v-2" />
  </svg>
);

export default CameraResetIcon;
