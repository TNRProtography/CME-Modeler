import React, { useState, useEffect, useMemo, useCallback } from 'react';

interface TutorialStep {
  targetId: string;
  title: string;
  content: string;
  placement: 'bottom' | 'top' | 'left' | 'right';
  widthClass?: string;
  offsetY?: number; // Optional vertical offset for fine-tuning
  offsetX?: number; // Optional horizontal offset for fine-tuning
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
  // Define your first visit steps here, for now just a dummy entry
  { targetId: 'nav-forecast', title: 'Aurora Forecast (First Visit)', content: 'This is the first visit tutorial content for the Forecast page.', placement: 'bottom', widthClass: 'w-80' },
  { targetId: 'nav-solar-activity', title: 'Solar Activity (First Visit)', content: 'This is the first visit tutorial content for Solar Activity.', placement: 'bottom', widthClass: 'w-80' },
  { targetId: 'nav-modeler', title: 'CME Visualization (First Visit)', content: 'This is the first visit tutorial content for CME Viz.', placement: 'bottom', widthClass: 'w-80' },
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
    if (tutorialType === 'firstVisit') {
      return FIRST_VISIT_STEPS;
    }
    return CME_VISUALIZATION_STEPS;
  }, [tutorialType]);

  const currentStep = stepsToUse[stepIndex];

  // Callback to inform the parent about which element to highlight
  const informParentAboutHighlight = useCallback((id: string | null) => {
    onStepChange(id);
  }, [onStepChange]);


  useEffect(() => {
    if (!isOpen) {
      informParentAboutHighlight(null); // Clear highlight when modal closes
      return;
    }

    // Reset step index when opened or if it's a new tutorial type
    if (stepIndex !== 0 && tutorialType === 'cmeViz') { // Only reset for CME Viz if not already at step 0
        setStepIndex(0);
    } else if (tutorialType === 'firstVisit' && stepIndex !== 0) {
        setStepIndex(0); // Always start FirstVisit from 0
    }

    if (!currentStep) return;

    // Trigger highlighting in the parent (App.tsx)
    informParentAboutHighlight(currentStep.targetId);

    const updatePosition = () => {
      const element = document.getElementById(currentStep.targetId);
      if (element) {
        setTargetRect(element.getBoundingClientRect());
      } else {
        console.warn(`Tutorial target element not found: ${currentStep.targetId}. Skipping step.`);
        handleNext(); // Skip to next step if element not found
      }
    };

    const timer = setTimeout(updatePosition, 50); // Small delay for DOM layout
    window.addEventListener('resize', updatePosition);
    
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, stepIndex, currentStep, informParentAboutHighlight, stepsToUse, tutorialType]);

  const handleNext = () => {
    if (stepIndex < stepsToUse.length - 1) {
      setStepIndex(stepIndex + 1);
    } else {
      onClose(); // End of tutorial
    }
  };
  
  const handleClose = () => {
    informParentAboutHighlight(null); // Ensure target highlight is removed
    onClose(); // Close the modal
  };

  const { tooltipStyle, arrowStyle } = useMemo(() => {
    if (!targetRect || !currentStep) {
      return { tooltipStyle: { opacity: 0, visibility: 'hidden' }, arrowStyle: {} };
    }

    const tooltipWidth = currentStep.widthClass === 'w-80' ? 320 : (currentStep.widthClass === 'w-72' ? 288 : 256); // Default 256 if no class
    const tooltipHeight = 160; // Approximate height for tooltip content
    const margin = 16; // Space from target and screen edges

    let ttStyle: React.CSSProperties = { zIndex: 2003 }; // Ensure tooltip is above backdrop
    let arStyle: React.CSSProperties = {};

    let top = 0, left = 0;

    switch (currentStep.placement) {
      case 'bottom':
        top = targetRect.bottom + margin + (currentStep.offsetY || 0);
        left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2 + (currentStep.offsetX || 0);
        arStyle = { 
            bottom: '100%', left: '50%', transform: 'translateX(-50%)',
            borderBottom: '8px solid #404040', borderLeft: '8px solid transparent', borderRight: '8px solid transparent' 
        };
        break;
      case 'top':
        top = targetRect.top - tooltipHeight - margin + (currentStep.offsetY || 0);
        left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2 + (currentStep.offsetX || 0);
        arStyle = { 
            top: '100%', left: '50%', transform: 'translateX(-50%)',
            borderTop: '8px solid #404040', borderLeft: '8px solid transparent', borderRight: '8px solid transparent' 
        };
        break;
      case 'left':
        top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2 + (currentStep.offsetY || 0);
        left = targetRect.left - tooltipWidth - margin + (currentStep.offsetX || 0);
        arStyle = { 
            right: '100%', top: '50%', transform: 'translateY(-50%)',
            borderRight: '8px solid #404040', borderTop: '8px solid transparent', borderBottom: '8px solid transparent' 
        };
        break;
      case 'right':
        top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2 + (currentStep.offsetY || 0);
        left = targetRect.right + margin + (currentStep.offsetX || 0);
        arStyle = { 
            left: '100%', top: '50%', transform: 'translateY(-50%)',
            borderLeft: '8px solid #404040', borderTop: '8px solid transparent', borderBottom: '8px solid transparent' 
        };
        break;
    }

    // Clamp positions to stay within viewport
    ttStyle.top = Math.max(margin, Math.min(top, window.innerHeight - tooltipHeight - margin));
    ttStyle.left = Math.max(margin, Math.min(left, window.innerWidth - tooltipWidth - margin));

    // For horizontal arrows, adjust left of arrow based on clamped top/left
    if (currentStep.placement === 'top' || currentStep.placement === 'bottom') {
        // Arrow's left should be relative to tooltip's top-left origin
        arStyle.left = `${targetRect.left + targetRect.width / 2 - (ttStyle.left as number)}px`;
    }
    // For vertical arrows, adjust top of arrow based on clamped top/left
    if (currentStep.placement === 'left' || currentStep.placement === 'right') {
        // Arrow's top should be relative to tooltip's top-left origin
        arStyle.top = `${targetRect.top + targetRect.height / 2 - (ttStyle.top as number)}px`;
    }


    ttStyle.opacity = 1;
    ttStyle.visibility = 'visible';

    return { tooltipStyle: ttStyle, arrowStyle: arStyle };
  }, [targetRect, currentStep]);


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