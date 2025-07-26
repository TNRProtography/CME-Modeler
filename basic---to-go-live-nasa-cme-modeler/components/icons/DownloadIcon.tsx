// --- START OF FILE src/components/icons/DownloadIcon.tsx (MODIFIED - NAMED EXPORT) ---

import React from 'react';

interface IconProps {
  className?: string;
}

// Change this line from 'const DownloadIcon' to 'export const DownloadIcon'
export const DownloadIcon: React.FC<IconProps> = ({ className }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

// REMOVE the 'export default DownloadIcon;' line entirely, as it's now a named export
// export default DownloadIcon; // <-- DELETE THIS LINE

// --- END OF FILE src/components/icons/DownloadIcon.tsx (MODIFIED - NAMED EXPORT) ---