// --- START OF FILE RefreshIcon.tsx ---
import React from 'react';

interface IconProps {
  className?: string;
}

// Changed to a named export instead of default export
export const RefreshIcon: React.FC<IconProps> = ({ className }) => (
  <svg
    className={className}
    xmlns="http://www.w3.org/2000/svg"
    fill="none" // Changed fill to none for consistency with other icons
    viewBox="0 0 24 24"
    stroke="currentColor" // Use currentColor to allow styling via Tailwind's text-color
    strokeWidth={1.5} // Consistent stroke width
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.023 9.348h4.928c.404 0 .782.16.943.419.16.26.126.588-.083.844l-2.585 3.195a1.125 1.125 0 01-1.789.097L9.932 9.073M17.023 9.348l1.011-.115M8.411 4.398L4.01 7.234a3.375 3.375 0 00-.735 2.01l.73 3.65c.015.074-.01.15-.07.2l-.213.142c-.085.056-.188.083-.292.083H1.932a.75.75 0 01-.75-.75V7.498a.75.75 0 01.75-.75h2.247c.27-.894.673-1.724 1.188-2.463L8.411 4.398zM17.977 14.652L22.38 11.816a3.375 3.375 0 00.735-2.01l-.73-3.65c-.015-.074.01-.15.07-.2l.213-.142c.085-.056.188-.083.292-.083h2.247c.27.894.673 1.724 1.188 2.463L17.977 14.652zM12 21.75a9.75 9.75 0 100-19.5 9.75 9.75 0 000 19.5z"
    />
  </svg>
);
// --- END OF FILE RefreshIcon.tsx ---