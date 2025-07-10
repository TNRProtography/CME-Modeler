import React from 'react';

const FlareIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM8.547 4.505a8.25 8.25 0 1010.334 10.334.75.75 0 00-1.06-1.06 6.75 6.75 0 01-8.214-8.214.75.75 0 00-1.06-1.06z" clipRule="evenodd" />
  </svg>
);

// THIS IS THE CRUCIAL LINE THAT WAS MISSING
export default FlareIcon;