import React, { useState, useEffect, useMemo, useCallback } from 'react';

interface TutorialStep {
  targetId: string;
  title: string;
  content: string;
  placement: 'bottom' | 'top' | 'left' | 'right';
  widthClass?: string;
  offsetY?: number; // Optional vertical offset for fine-tuning
  offsetX?: number; // Optional horizontal offset for fine-tuning
  disableNext?: boolean; // Added for consistency, though currently not used in CME_VISUALIZATION_STEPS
}

// --- DEFINE CME VISUALIZATION TUTORIAL STEPS ---
const CME_VISUALIZATION_STEPS: TutorialStep[] = [
  {
    targetId: 'mobile-controls-button',
    title: 'CME Controls Panel (Mobile)',
    content: 'On smaller screens, tap here to open the main controls for time range, view, focus, and display options. On desktop, the panel is always visible on the left.',
    placement: 'right',
    widthClass: 'w-72',
    offsetY: 0, 
    offsetX: 10,
  },
  {
    targetId: 'controls-panel-container', 
    title: 'CME Controls Panel',
    content: 'This panel lets you configure the simulation: adjust the time range of CMEs, change your view, focus on specific celestial bodies, and toggle display options.',
    placement: 'right',
    widthClass: 'w-80',
    offsetY: 0, 
    offsetX: 10,
  },
  {
    targetId: 'time-range-3d-button', // Using 3-day button as example for range selection
    title: 'Time Range Selection',
    content: 'Choose between 24 hours, 3 days, or 7 days of historical CME data to load into the simulation.',
    placement: 'bottom',
    widthClass: 'w-72',
  },
  {
    targetId: 'view-top-button', // Using Top-Down button as example for view selection
    title: 'View Modes',
    content: 'Switch between Top-Down and Side views of the solar system to observe CMEs from different perspectives.',
    placement: 'bottom',
    widthClass: 'w-72',
  },
  {
    targetId: 'focus-earth-button', // Using Earth button as example for focus selection
    title: 'Focus Target',
    content: 'Direct the camera to focus on the Sun or Earth, bringing the selected body to the center of your view.',
    placement: 'bottom',
    widthClass: 'w-72',
  },
  {
    targetId: 'show-labels-toggle',
    title: 'Display Options',
    content: 'Toggle visibility of planet labels, show/hide Mercury, Venus, Mars, and the Earth\'s Moon/L1 point for a cleaner or more detailed view.',
    placement: 'bottom',
    widthClass: 'w-80',
  },
  {
    targetId: 'cme-filter-all-button', // Using All button as example for filter
    title: 'CME Filter',
    content: 'Filter the displayed CMEs by all, Earth-directed, or non-Earth-directed events to quickly find what you\'re looking for.',
    placement: 'bottom',
    widthClass: 'w-72',
  },
  {
    targetId: 'controls-panel-guide-button',
    title: 'Re-open Guide',
    content: 'You can always click this button in the controls panel to revisit this guide for help.',
    placement: 'bottom',
    widthClass: 'w-72',
  },
  {
    targetId: 'reset-view-button',
    title: 'Reset View',
    content: 'Instantly snap the camera back to a default top-down view, focused on Earth.',
    placement: 'right', 
    widthClass: 'w-64',
    offsetY: 0, 
    offsetX: 10,
  },
  {
    targetId: 'forecast-models-button',
    title: 'Other Forecast Models',
    content: 'Access external resources and different CME forecast models for comparative analysis and further insights.',
    placement: 'right', 
    widthClass: 'w-72',
    offsetY: 0, 
    offsetX: 10,
  },
  {
    targetId: 'interaction-mode-button',
    title: 'Interaction Mode',
    content: 'Toggle between "Move" (default camera control) and "Select" mode to click on CMEs in the simulation for more information.',
    placement: 'left', 
    widthClass: 'w-72',
    offsetY: 0, 
    offsetX: 10,
  },
  {
    targetId: 'mobile-cme-list-button', 
    title: 'CME List (Mobile)',
    content: 'On smaller screens, tap here to open the list of all loaded CMEs and their detailed information. On desktop, the list is on the right.',
    placement: 'left',
    widthClass: 'w-72',
    offsetY: 0, 
    offsetX: 10,
  },
  {
    targetId: 'timeline-play-pause-button',
    title: 'Timeline Playback Controls',
    content: 'These buttons allow you to play/pause the simulation, and step forward or backward by one hour.',
    placement: 'top',
    widthClass: 'w-72',
  },
  {
    targetId: 'timeline-scrubber',
    title: 'Timeline Scrubber',
    content: 'Drag this slider to manually scrub through the simulation time and observe CME propagation at any specific point.',
    placement: 'top',
    widthClass: 'w-80',
  },
  {
    targetId: 'timeline-speed-1x-button', // Corrected target ID for speed select
    title: 'Playback Speed',
    content: 'Adjust the speed of the timeline animation to fast-forward or slow down the simulation playback.',
    placement: 'top',
    widthClass: 'w-72',
  },
];

// Placeholder for other tutorial types if they were defined elsewhere (e.g., in a constants file)
const FIRST_VISIT_STEPS: TutorialStep[] = [
  // This will be replaced by the actual STEPS from FirstVisitTutorial.tsx if needed
  // For now, it's consistent with App.tsx's FirstVisitTutorial state management.
  { targetId: 'nav-forecast', title: 'Aurora Forecast (First Visit)', content: 'This is the first visit tutorial content for the Forecast page.', placement: 'bottom', widthClass: 'w-80' },
  { targetId: 'nav-solar-activity', title: 'Solar Activity (First Visit)', content: 'This is the first visit tutorial content for Solar Activity.', placement: 'bottom', widthClass: 'w-80' },
  { targetId: 'nav-modeler', title: 'CME Visualization (First Visit)', content: 'This is the first visit tutorial content for CME Viz.', placement: 'bottom', widthClass: 'w-80', disableNext: true }, 
  { targetId: 'nav-settings', title: 'App Settings (First Visit)', content: 'This is the first visit tutorial content for App Settings.', placement: 'left', widthClass: 'w-72' },
];


interface TutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
  tutorialType: 'cmeViz' | 'firstVisit'; // New prop to differentiate tutorial content
  onStepChange: (id: string | null) => void; // Prop from App.tsx to update highlighted element
}

const TutorialModal: React.FC<TutorialModalProps> = ({ isOpen, onClose, tutorialType, onStepChange }) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  // Select steps based on tutorialType
  const stepsToUse = useMemo(() => {
    // In a production app, you might import FIRST_VISIT_STEPS from a shared constants file
    if (tutorialType === 'firstVisit') {
      return FIRST_VISIT_STEPS;
    }
    return CME_VISUALIZATION_STEPS;
  }, [tutorialType]); // Re-calculate if tutorialType changes

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
    if (stepIndex >= stepsToUse.length || !stepsToUse[stepIndex]) {
        onClose(); // Close tutorial if steps are exhausted or invalid
        return;
    }

    const currentStep = stepsToUse[stepIndex]; // Get the current step based on the state

    onStepChange(currentStep.targetId); // Inform App.tsx to highlight the element

    const updatePosition = () => {
      const element = document.getElementById(currentStep.targetId);
      if (element) {
        setTargetRect(element.getBoundingClientRect());
      } else {
        // Log a warning if element is not found. Do NOT auto-skip to prevent infinite loops.
        console.warn(`TutorialModal: Target element "${currentStep.targetId}" not found. Cannot highlight.`);
        setTargetRect(null); // Clear targetRect to hide the tooltip if element is missing
      }
    };

    const timer = setTimeout(updatePosition, 50); // Small delay for DOM layout to settle
    window.addEventListener('resize', updatePosition);
    
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, stepIndex, onStepChange, onClose, stepsToUse]); // Dependencies for this effect


  const handleNext = () => {
    // Only allow progression if currentStep.disableNext is false (or undefined)
    if (currentStep && !currentStep.disableNext && stepIndex < stepsToUse.length - 1) {
      setStepIndex(stepIndex + 1);
    } else if (currentStep && !currentStep.disableNext && stepIndex === stepsToUse.length - 1) {
      onClose(); // End of tutorial
    }
  };
  
  const handleClose = () => {
    onStepChange(null); // Ensure target highlight is removed
    onClose(); // Close the modal
  };

  const currentStep = stepsToUse[stepIndex]; // Re-get currentStep for rendering purposes

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
      case 'top':
        top = targetRect.top - tooltipHeight - margin;
        left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
        break;
      case 'left':
        top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
        left = targetRect.left - tooltipWidth - margin;
        break;
      case 'right':
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
  }, [targetRect, stepIndex, stepsToUse]); // Added stepsToUse to dependencies of useMemo


  if (!isOpen || !currentStep) {
    return null;
  }

  // Determine if the background should be less blurred/opaque.
  // This applies to the first visit's forecast step, AND all steps of the CME Viz tutorial.
  const shouldUnblurBackground = 
    (tutorialType === 'firstVisit' && currentStep?.targetId === 'nav-forecast') ||
    (tutorialType === 'cmeViz'); // <--- Key change: Unblur for all CME Viz tutorial steps

  // Conditionally apply classes to the backdrop div
  const backdropClasses = `fixed inset-0 z-[2002] transition-all duration-300 ${
    shouldUnblurBackground ? 'bg-black/20 backdrop-filter-none' : 'bg-black/75 backdrop-blur-sm'
  }`;


  return (
    <div 
      className={backdropClasses}
      // No onClick on backdrop, as the tutorial logic will manage steps and closing.
      // Clicks should go through to the highlighted element.
    >
      <div
        className={`fixed bg-neutral-800 border border-neutral-700 rounded-lg shadow-2xl p-4 text-neutral-200 transition-all duration-300 ease-in-out ${currentStep.widthClass || 'w-64'}`}
        style={tooltipStyle}
        // Prevent event propagation from tooltip content to background
        onClick={(e) => e.stopPropagation()} 
      >
        <div className="absolute w-0 h-0" style={arrowStyle} />
        <div className="flex justify-between items-start mb-2">
            <h3 className="text-lg font-bold text-sky-400">{currentStep.title}</h3>
            <span className="text-xs text-neutral-400 font-mono">{stepIndex + 1}/{stepsToUse.length}</span>
        </div>
        <p className="text-sm text-neutral-300 leading-relaxed mb-4">{currentStep.content}</p>
        <div className="flex justify-end items-center gap-4">
            <button onClick={handleClose} className="px-3 py-1.5 bg-neutral-700 rounded-md text-neutral-200 hover:bg-neutral-600 transition-colors text-sm font-semibold">Skip Guide</button>
            <button
                onClick={handleNext}
                className="px-4 py-1.5 bg-sky-600 text-white rounded-md text-sm font-semibold hover:bg-sky-500 transition-colors"
            >
                {stepIndex === stepsToUse.length - 1 ? 'Finish' : 'Next'}
            </button>
        </div>
      </div>
    </div>
  );
};

export default TutorialModal;