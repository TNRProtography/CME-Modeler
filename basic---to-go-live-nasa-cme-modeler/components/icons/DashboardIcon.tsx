// --- START OF FILE src/components/icons/DashboardIcon.tsx (OVERWRITE) ---

import React from 'react';

interface IconProps {
  className?: string;
}

// Ensure it's 'export const'
export const DashboardIcon: React.FC<IconProps> = ({ className }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10 21h7a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2zm2-7v4m0 0l-2-2m2 2l2-2" />
  </svg>
);

// No 'export default' line here

// --- END OF FILE src/components/icons/DashboardIcon.tsx ---