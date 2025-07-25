import React from 'react';

const FlareIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
    {/* The group ensures both parts are treated as one icon */}
    <g>
      {/* The main body of the Sun */}
      <circle cx="10" cy="12" r="8"/>
      
      {/* 
        The erupting flare. This is a single closed path that creates a swoosh shape.
        It starts on the sun's edge, curves out dramatically, and then curves back,
        with the inner edge following the sun's circumference perfectly.
      */}
      <path d="M16,5.34 C19,-1, 29,6, 22,12 C29,18, 19,25, 16,18.66 A8,8 0 0 1 16,5.34 Z" />
    </g>
  </svg>
);

export default FlareIcon;