import React from 'react';

const FlareIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <>
    {/* 
      The CSS animations are embedded directly here to make the component self-contained.
      No need for external stylesheets.
    */}
    <style>{`
      @keyframes sun-pulse {
        0%, 100% {
          transform: scale(1);
        }
        50% {
          transform: scale(1.05);
        }
      }
      @keyframes flare-erupt {
        0% {
          transform: scale(0);
          opacity: 0;
        }
        10% {
          transform: scale(1);
          opacity: 1;
        }
        60% {
            opacity: 0.5;
        }
        100% {
          transform: scale(1.25);
          opacity: 0;
        }
      }
      .sun-body {
        /* Makes the sun pulse gently from its center */
        transform-origin: center;
        animation: sun-pulse 6s infinite ease-in-out;
      }
      .flare-large {
        /* Erupts from the center of the sun over 4 seconds */
        transform-origin: center;
        animation: flare-erupt 4s infinite ease-out;
      }
      .flare-small {
        /* Erupts from the center, but is smaller, faster, and offset in time */
        transform-origin: center;
        animation: flare-erupt 3s infinite ease-out -1.5s; /* 1.5s delay */
      }
    `}</style>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
      <g>
        {/* The main, larger flare that erupts */}
        <path
          className="flare-large"
          d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm3.67 15.47c-3.32-1.45-3.32-7.49 0-8.94 1.5-.65 3.32-.42 4.33.68-.65 1.5-.42 3.32.68 4.33-1.45 3.32-7.49 3.32-8.94 0-.65-1.5-.42-3.32.68-4.33 3.32-1.45 3.32-7.49 0-8.94-1.5.65-3.32.42-4.33-.68.65-1.5.42-3.32-.68-4.33 1.45-3.32 7.49-3.32 8.94 0 .65 1.5.42 3.32-.68 4.33-3.32 1.45-3.32 7.49 0 8.94 1.5-.65 3.32-.42 4.33.68-.65 1.5-.42 3.32.68-4.33-1.45 3.32-7.49 3.32-8.94 0z"
        />
        {/* A smaller, faster, offset flare to add complexity */}
        <path
          className="flare-small"
          transform="scale(0.6) rotate(45)"
          d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm3.67 15.47c-3.32-1.45-3.32-7.49 0-8.94 1.5-.65 3.32-.42 4.33.68-.65 1.5-.42 3.32.68 4.33-1.45 3.32-7.49 3.32-8.94 0-.65-1.5-.42-3.32.68-4.33 3.32-1.45 3.32-7.49 0-8.94-1.5.65-3.32.42-4.33-.68.65-1.5.42-3.32-.68-4.33 1.45-3.32 7.49-3.32 8.94 0 .65 1.5.42 3.32-.68 4.33-3.32 1.45-3.32 7.49 0 8.94 1.5-.65 3.32-.42 4.33.68-.65 1.5-.42 3.32.68-4.33-1.45 3.32-7.49 3.32-8.94 0z"
        />
        {/* The solid body of the sun, which pulses */}
        <circle className="sun-body" cx="12" cy="12" r="6" />
      </g>
    </svg>
  </>
);

export default FlareIcon;