import React from 'react';

const RefreshIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 4L15 9A8.96 8.96 0 0012 5C7.58 5 4 8.58 4 13s3.58 8 8 8 8-3.58 8-8" />
    </svg>
);

export default RefreshIcon;