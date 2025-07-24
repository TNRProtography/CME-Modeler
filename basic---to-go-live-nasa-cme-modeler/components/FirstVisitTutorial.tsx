import React, { useState, useEffect, useMemo, useCallback } from 'react';

interface TutorialStep {
  targetId: string;
  title: string;
  content: string;
  placement: 'bottom' | 'top' | 'left' | 'right';
  widthClass?: string;
  disableNext?: boolean; // New prop: if true, "Next" button is disabled for this step
}

const STEPS: TutorialStep[] = [
  { targetId: 'nav-forecast', title: 'Aurora Forecast', content: 'This is your go-to page for live aurora forecasts, substorm detection, and sighting maps. Check here to see if an aurora might be visible tonight!', placement: 'bottom', widthClass: 'w-80' },
  { targetId: 'nav-solar-activity', title: 'Solar Activity', content: 'Dive deep into the latest solar data and active regions. See real-time solar flares and imagery directly from the Sun.', placement: 'bottom', widthClass: 'w-80' },
  // MODIFIED STEP: Instruct user to click the CME Visualization button directly
  { targetId: 'nav-modeler', title: 'CME Visualization', content: 'Explore Coronal Mass Ejections (CMEs) in a 3D simulation! Click the highlighted "CME Visualization" button above to proceed and learn more about this feature.', placement: 'bottom', widthClass: 'w-80', disableNext: true }, 
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

  // Effect for initializing stepIndex when tutorial opens
  useEffect(() => {
    if (isOpen) {
      setStepIndex(0); // Always start from the first step when the modal opens
    }
  }, [isOpen]);

  // Effect for handling step changes and highlighting
  useEffect(() => {
    if (!isOpen) {
      onStepChange(null); // Clear highlight when modal closes
      return;
    }

    // Ensure stepIndex is within bounds and currentStep is valid
    if (stepIndex >= STEPS.length || !STEPS[stepIndex]) {
        onClose(); // Close tutorial if steps are exhausted or invalid
        return;
    }

    const currentStep = STEPS[stepIndex]; // Get the current step based on the state

    onStepChange(currentStep.targetId); // Inform App.tsx to highlight the element

    const updatePosition = () => {
      const element = document.getElementById(currentStep.targetId);
      if (element) {
        setTargetRect(element.getBoundingClientRect());
      } else {
        // Log a warning if element is not found. Do NOT auto-skip to prevent infinite loops.
        console.warn(`FirstVisitTutorial: Target element "${currentStep.targetId}" not found. Cannot highlight.`);
        setTargetRect(null); // Clear targetRect to hide the tooltip if element is missing
      }
    };

    const timer = setTimeout(updatePosition, 50); // Small delay for DOM layout to settle
    window.addEventListener('resize', updatePosition);
    
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, stepIndex, onStepChange, onClose]); // Dependencies for this effect


  const handleNext = () => {
    // Only allow progression if currentStep.disableNext is false
    if (STEPS[stepIndex] && !STEPS[stepIndex].disableNext && stepIndex < STEPS.length - 1) {
      setStepIndex(stepIndex + 1);
    } else if (STEPS[stepIndex] && !STEPS[stepIndex].disableNext && stepIndex === STEPS.length - 1) {
      onClose(); // Call onClose when tutorial finishes
    }
    // If disableNext is true, this button is not rendered, so this logic won't be hit anyway.
    // However, it's good practice to ensure handleNext does nothing if disabled.
  };
  
  const handleClose = () => {
    onStepChange(null); // Ensure target highlight is removed if any
    onClose(); // Call onClose when tutorial is skipped
  };

  const currentStep = STEPS[stepIndex]; // Re-get currentStep for rendering purposes

  const { tooltipStyle, arrowStyle } = useMemo(() => {
    if (!targetRect || !currentStep) {
      return { tooltipStyle: { opacity: 0, visibility: 'hidden' }, arrowStyle: {} };
    }

    const tooltipWidth = currentStep.widthClass === 'w-80' ? 320 : (currentStep.widthClass === 'w-72' ? 288 : 256);
    const tooltipHeight = 160; // Assuming a consistent height for all tooltips for layout calculations
    const margin = 16; 

    let top = 0;
    let left = 0;

    // Calculate initial top and left based on placement
    switch (currentStep.placement) {
      case 'bottom':
        top = targetRect.bottom + margin;
        left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
        break;
      case 'left':
        top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
        left = targetRect.left - tooltipWidth - margin;
        break;
      case 'top': // Not used in current STEPS but good to have
        top = targetRect.top - tooltipHeight - margin;
        left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
        break;
      case 'right': // Not used in current STEPS but good to have
        top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
        left = targetRect.right + margin;
        break;
    }

    // Apply custom offsets before clamping
    top += (currentStep.offsetY || 0);
    left += (currentStep.offsetX || 0);


    // Clamp positions to stay within viewport
    const clampedTop = Math.max(margin, Math.min(top, window.innerHeight - tooltipHeight - margin));
    const clampedLeft = Math.max(margin, Math.min(left, window.innerWidth - tooltipWidth - margin));

    let ttStyle: React.CSSProperties = { top: `${clampedTop}px`, left: `${clampedLeft}px`, transform: 'none', zIndex: 2003 }; // Ensure tooltip is above backdrop
    let arStyle: React.CSSProperties = {};

    // Calculate arrow position relative to the clamped tooltip position
    switch (currentStep.placement) {
        case 'bottom':
            arStyle = { 
                bottom: '100%', 
                left: `${targetRect.left + targetRect.width / 2 - clampedLeft}px`, // Arrow points to target center relative to clamped tooltip left
                transform: 'translateX(-50%)', 
                borderBottom: '8px solid #404040', 
                borderLeft: '8px solid transparent', 
                borderRight: '8px solid transparent' 
            };
            break;
        case 'left':
            arStyle = { 
                right: '100%', 
                top: `${targetRect.top + targetRect.height / 2 - clampedTop}px`, // Arrow points to target center relative to clamped tooltip top
                transform: 'translateY(-50%)', 
                borderRight: '8px solid #404040', 
                borderTop: '8px solid transparent', 
                borderBottom: '8px solid transparent' 
            };
            break;
        case 'top':
            arStyle = { 
                top: '100%', 
                left: `${targetRect.left + targetRect.width / 2 - clampedLeft}px`,
                transform: 'translateX(-50%)', 
                borderTop: '8px solid #404040', 
                borderLeft: '8px solid transparent', 
                borderRight: '8px solid transparent' 
            };
            break;
        case 'right':
            arStyle = { 
                left: '100%', 
                top: `${targetRect.top + targetRect.height / 2 - clampedTop}px`,
                transform: 'translateY(-50%)', 
                borderLeft: '8px solid #404040', 
                borderTop: '8px solid transparent', 
                borderBottom: '8px solid transparent' 
            };
            break;
    }
    
    ttStyle.opacity = 1;
    ttStyle.visibility = 'visible';

    return { tooltipStyle: ttStyle, arrowStyle: arStyle };
  }, [targetRect, stepIndex]); // Removed STEPS from dependencies of useMemo, as it causes re-renders with new step and currentStep is directly from state.

  if (!isOpen || !currentStep) return null;

  // Determine if the current step requires the background to be clear (i.e., the forecast step)
  const isForecastStep = currentStep.targetId === 'nav-forecast';

  // Apply conditional classes to the backdrop
  const backdropClasses = `fixed inset-0 z-[2002] transition-all duration-300 ${
    isForecastStep ? 'bg-black/20 backdrop-filter-none' : 'bg-black/60 backdrop-blur-sm'
  }`;

  return (
    <div className={backdropClasses}>
      <div
        className={`fixed bg-neutral-800 border border-neutral-700 rounded-lg shadow-2xl p-4 text-neutral-200 transition-all duration-300 ease-in-out ${currentStep.widthClass}`}
        style={tooltipStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute w-0 h-0" style={arrowStyle} />
        <div className="flex justify-between items-start mb-2">
            <h3 className="text-lg font-bold text-sky-400">{currentStep.title}</h3>
            <span className="text-xs text-neutral-400 font-mono">{stepIndex + 1}/{STEPS.length}</span>
        </div>
        <p className="text-sm text-neutral-300 leading-relaxed mb-4">{currentStep.content}</p>
        <div className="flex justify-end items-center gap-4">
            <button onClick={handleClose} className="px-3 py-1.5 bg-neutral-700 rounded-md text-neutral-200 hover:bg-neutral-600 transition-colors text-sm font-semibold">Skip Tutorial</button>
            {/* Conditionally render the Next button */}
            {!currentStep.disableNext && (
                <button
                    onClick={handleNext}
                    className="px-4 py-1.5 bg-blue-600 rounded-md text-white hover:bg-blue-700 transition-colors text-sm font-semibold"
                >
                    {stepIndex === STEPS.length - 1 ? 'Finish' : 'Next'}
                </button>
            )}
        </div>
      </div>
    </div>
  );
};

export default FirstVisitTutorial;