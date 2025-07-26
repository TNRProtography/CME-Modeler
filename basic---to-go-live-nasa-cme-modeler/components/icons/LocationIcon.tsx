// --- START OF FILE src/components/icons/LocationIcon.tsx (OVERWRITE) ---

import React from 'react';

interface IconProps {
  className?: string;
}

// Ensure it's 'export const'
export const LocationIcon: React.FC<IconProps> = ({ className }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.727A8 8 0 016.343 4.273M17.657 16.727a8 8 0 01-11.314 0m11.314 0l.547.547A3 3 0 0121 21h-3M17.657 16.727L6.343 4.273m11.314 12.454l-.547.547A3 3 0 0015 21H3v-3.088l.547-.547M6.343 4.273L.546 10.07A3 3 0 003 15h3.088m0-11.727l.547-.547A3 3 0 019 3h3.088" />
  </svg>
);

// No 'export default' line here

// --- END OF FILE src/components/icons/LocationIcon.tsx ---