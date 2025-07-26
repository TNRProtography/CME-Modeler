// --- START OF FILE src/components/DonationButton.tsx (NEW FILE) ---

import React from 'react';

interface DonationButtonProps {
  paypalEmail: string;
  className?: string;
}

const DonationButton: React.FC<DonationButtonProps> = ({ paypalEmail, className }) => {
  const paypalUrl = `https://www.paypal.com/cgi-bin/webscr?cmd=_donations&business=${paypalEmail}&no_note=0&cn=&currency_code=NZD`;

  return (
    <a
      href={paypalUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center justify-center px-4 py-2 bg-purple-800/80 border border-purple-700/60 rounded-lg text-white font-semibold text-sm shadow-md hover:bg-purple-700/90 transition-colors
                  ${className || ''}`}
      title="Support this project by donating via PayPal"
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
      </svg>
      Donate to Support Us
    </a>
  );
};

export default DonationButton;

// --- END OF FILE src/components/DonationButton.tsx (NEW FILE) ---