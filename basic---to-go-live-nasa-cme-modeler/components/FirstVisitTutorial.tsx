// --- START OF FILE src/components/FirstVisitTutorial.tsx ---

import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom'; // NEW: Import createPortal for robust overlay

interface TutorialStep {
  targetId: string;
  title: string;
  content: string;
  placement: 'bottom' | 'top' | 'left' | 'right';
  widthClass?: string;
}

const STEPS: TutorialStep[] = [
  { targetId: 'nav-forecast', title: 'Aurora Forecast', content: 'This is your go-to page for live aurora forecasts, substorm detection, and sighting maps. Check here to see if an aurora might be visible tonight!', placement: 'bottom', widthClass: 'w-80' },
  { targetId: 'nav-solar-activity', title: 'Solar Activity', content: 'Dive deep into the latest solar data. This dashboard shows real-time solar flares, proton flux, and the latest imagery directly from the Sun.', placement: 'bottom', widthClass: 'w-80' },
  { targetId: 'nav-modeler', title: 'CME Modeler', content: 'The core of the app! This is a 3D simulation where you can see and model Coronal Mass Ejections (CMEs) as they travel through the solar system.', placement: 'bottom', widthClass: 'w-80' },
  { targetId: 'nav-settings', title: 'App Settings', content: 'Finally, here you can configure app settings, manage notifications, and install the app to your device for a better experience.', placement: 'left', widthClass: 'w-72' },
];

interface FirstVisitTutorialProps {
  isOpen: boolean;
  onClose: () => void;
  onStepChange: (id: string | null) => void;
}

const FirstVisitTutorial: React.FC<FirstVisitTutorialProps> = ({ isOpen, onClose, onStepChange }) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  
  // NEW: State to hold the portal container element
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

  const currentStep = STEPS[stepIndex];

  // NEW: Find the portal root once on mount
  useEffect(() => {
    const container = document.getElementById('tutorial-root');
    if (container) {
      setPortalContainer(container);
    } else {
      console.error("Tutorial root element 'tutorial-root' not found in DOM. Portal will not render.");
      // If the portal root isn't found, the tutorial cannot function. Close it.
      onClose(); 
    }
  }, [onClose]); // Depend on onClose if it's called here

  useEffect(() => {
    // If tutorial is closed or current step is invalid, clean up and return
    if (!isOpen || !currentStep) {
      onStepChange(null);
      return () => { /* cleanup */ };
    }

    // Inform parent about the currently targeted element
    onStepChange(currentStep.targetId);

    const updatePosition = () => {
      const element = document.getElementById(currentStep.targetId);
      if (element) {
        setTargetRect(element.getBoundingClientRect());
      } else {
        // If element is not found (e.g., on a different page, or ID changed), skip to the next step.
        handleNext(); 
      }
    };

    // Initial position update on a slight delay to ensure elements are rendered
    const initialPositionTimer = setTimeout(updatePosition, 50);
    
    // FIX: Add an interval to poll for position changes (e.g., from a banner appearing)
    // This is crucial for catching layout shifts that don't trigger a window resize event.
    const positionCheckInterval = setInterval(() => {
        const element = document.getElementById(currentStep.targetId);
        if (element) {
            const newRect = element.getBoundingClientRect();
            // Only update state if the position has actually changed to prevent unnecessary re-renders
            setTargetRect(prevRect => {
                if (!prevRect || newRect.top !== prevRect.top || newRect.left !== prevRect.left || newRect.width !== prevRect.width || newRect.height !== prevRect.height) {
                    return newRect;
                }
                return prevRect;
            });
        }
    }, 150); // Check every 150ms for a balance between responsiveness and performance

    // Also listen for window resize as a standard fallback
    window.addEventListener('resize', updatePosition);
    
    // Cleanup function: important to prevent memory leaks and unexpected behavior
    return () => {
      clearTimeout(initialPositionTimer);
      clearInterval(positionCheckInterval); // Clear the interval
      window.removeEventListener('resize', updatePosition);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, stepIndex, currentStep, onStepChange]); // Dependencies for useEffect

  const handleNext = () => {
    if (stepIndex < STEPS.length - 1) {
      setStepIndex(prevIndex => prevIndex + 1); // Use functional update for safety
    } else {
      onClose(); // Tutorial finished
    }
  };
  
  const handleClose = () => {
    onStepChange(null); // Signal to parent that tutorial target is no longer active
    onClose(); // Close the tutorial
  };

  const { tooltipStyle, arrowStyle } = useMemo(() => {
    // If targetRect is null or no currentStep, the tooltip should be hidden.
    if (!targetRect || !currentStep) return { tooltipStyle: { opacity: 0 }, arrowStyle: {} };

    // Determine tooltip dimensions based on widthClass
    const tooltipWidth = currentStep.widthClass === 'w-80' ? 320 : 288;
    const tooltipHeight = 160; // Approximate height for calculation (adjust if content varies greatly)
    const margin = 16; // Margin between target element and tooltip

    let ttStyle: React.CSSProperties = {};
    let arStyle: React.CSSProperties = {};

    switch (currentStep.placement) {
      case 'bottom': {
        const top = targetRect.bottom + margin;
        let left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
        
        // Clamp left position to keep tooltip within viewport
        left = Math.max(margin, left); // Ensure it doesn't go off the left edge
        left = Math.min(left, window.innerWidth - tooltipWidth - margin); // Ensure it doesn't go off the right edge
        
        ttStyle = { top: `${top}px`, left: `${left}px`, transform: 'none' };
        // Arrow position relative to the tooltip (centered under the target)
        arStyle = { bottom: '100%', left: `${targetRect.left + targetRect.width / 2 - left}px`, transform: 'translateX(-50%)', borderBottom: '8px solid #404040', borderLeft: '8px solid transparent', borderRight: '8px solid transparent' };
        break;
      }
      case 'left': {
        // FIX: Adjust 'top' calculation for 'left' placement for vertical consistency
        // Align the top of the tooltip with the bottom of the target element, like 'bottom' placement
        const top = targetRect.bottom + margin; 
        
        const left = targetRect.left - tooltipWidth - margin;
        
        // Clamp top position to keep tooltip within viewport
        let clampedTop = Math.max(margin, top); // Ensure it doesn't go off the top edge
        clampedTop = Math.min(clampedTop, window.innerHeight - tooltipHeight - margin); // Ensure it doesn't go off the bottom edge
        
        ttStyle = { top: `${clampedTop}px`, left: `${left}px`, transform: 'none' };
        
        // Arrow position relative to the tooltip, pointing at the middle of the target
        // Calculate the relative vertical position of the target's center to the tooltip's top
        const arrowTopRelativeToTooltip = targetRect.top + (targetRect.height / 2) - clampedTop;
        arStyle = { left: '100%', top: `${arrowTopRelativeToTooltip}px`, transform: 'translateY(-50%)', borderLeft: '8px solid #404040', borderTop: '8px solid transparent', borderBottom: '8px solid transparent' };
        break;
      }
      // Add 'top' and 'right' cases if needed by your STEPS configuration
      default: {
        // Fallback for unhandled or invalid placements
        ttStyle = { 
          top: '50%', 
          left: '50%', 
          transform: 'translate(-50%, -50%)',
          visibility: 'hidden' // Hide by default if calculation fails
        };
        arStyle = {};
        console.warn(`Unhandled placement: ${currentStep.placement}. Tooltip might be mispositioned.`);
      }
    }
    // Set opacity based on targetRect presence to control fade-in/out
    return { tooltipStyle: { ...ttStyle, opacity: targetRect ? 1 : 0 }, arrowStyle: arStyle };
  }, [targetRect, currentStep]);


  // Only render the portal if it's open AND we have a container to render into
  if (!isOpen || !portalContainer) {
    return null;
  }

  // Use createPortal to render the tutorial outside the normal DOM hierarchy
  return createPortal(
    // The main overlay element, set to fixed and a very high z-index
    // to ensure it sits on top of all other content in the app.
    <div className="fixed inset-0 z-[999999] bg-black/75 backdrop-blur-sm flex justify-center items-center"> {/* Very high z-index */}
      {/* The actual tooltip content. Its visibility is controlled by 'targetRect' */}
      <div
        // Conditionally apply visibility based on whether targetRect is available
        // This makes the tooltip itself visible only when its position is calculated
        className={`fixed bg-neutral-800 border border-neutral-700 rounded-lg shadow-2xl p-4 text-neutral-200 transition-all duration-300 ease-in-out ${currentStep?.widthClass || ''}`}
        style={tooltipStyle} // Apply calculated style including opacity
      >
        <div className="absolute w-0 h-0" style={arrowStyle} /> {/* Arrow element */}
        <div className="flex justify-between items-start mb-2">
            <h3 className="text-lg font-bold text-sky-400">{currentStep?.title || ''}</h3>
            <span className="text-xs text-neutral-400 font-mono">{stepIndex + 1}/{STEPS.length}</span>
        </div>
        <p className="text-sm text-neutral-300 leading-relaxed mb-4">{currentStep?.content || ''}</p>
        <div className="flex justify-end items-center gap-4">
            <button onClick={handleClose} className="text-xs text-neutral-400 hover:text-white transition-colors">Skip Tutorial</button>
            <button
                onClick={handleNext}
                className="px-4 py-1.5 bg-sky-600 text-white rounded-md text-sm font-semibold hover:bg-sky-500 transition-colors"
            >
                {stepIndex === STEPS.length - 1 ? 'Finish' : 'Next'}
            </button>
        </div>
      </div>
    </div>,
    portalContainer // This is where the magic happens: render into the dedicated #tutorial-root div
  );
};

export default FirstVisitTutorial;
// --- END OF FILE src/components/FirstVisitTutorial.tsx ---