// --- START OF FILE src/components/icons/ThemeIcon.tsx (NEW FILE) ---

import React from 'react';

interface IconProps {
  className?: string;
}

const ThemeIcon: React.FC<IconProps> = ({ className }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343V4.767c0-1.808 1.159-3.593 2.757-3.903C15.556.76 17.5-2.028 17.5 3.5c0 5.426-2.903 5.48-3.903 2.757C12.343 5.841 11 7.343 11 7.343z" />
  </svg>
);

export default ThemeIcon;

// --- END OF FILE src/components/icons/ThemeIcon.tsx (NEW FILE) ---