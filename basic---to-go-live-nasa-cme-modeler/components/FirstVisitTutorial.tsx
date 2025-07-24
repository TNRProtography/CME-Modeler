// --- START OF FILE src/components/FirstVisitTutorial.tsx ---

import React, { useState, useEffect, useMemo } from 'react';

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
  { targetId: 'nav-modeler', title: 'CME Visualization', content: 'The core of the app! This is a 3D simulation where you can see and model Coronal Mass Ejections (CMEs) as they travel through the solar system.', placement: 'bottom', widthClass: 'w-80' }, // Changed title and content
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

  const currentStep = STEPS[stepIndex];

  useEffect(() => {
    if (!isOpen) {
      onStepChange(null);
      return;
    }

    if (!currentStep) return;

    onStepChange(currentStep.targetId);

    const updatePosition = () => {
      const element = document.getElementById(currentStep.targetId);
      if (element) {
        setTargetRect(element.getBoundingClientRect());
      } else {
        // If the target element is not found, skip to the next step.
        // This handles cases where an element might not be in the DOM yet or has been removed.
        console.warn(`Tutorial target element not found: ${currentStep.targetId}. Skipping step.`);
        handleNext(); 
      }
    };

    // Add a small delay to allow the DOM to fully render and the browser to compute the layout,
    // especially important when dynamic content (like banners) affects element positions.
    const timer = setTimeout(updatePosition, 50);
    window.addEventListener('resize', updatePosition);
    
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, stepIndex, currentStep, onStepChange]);

  const handleNext = () => {
    if (stepIndex < STEPS.length - 1) {
      setStepIndex(stepIndex + 1);
    } else {
      onClose(); // Call onClose when tutorial finishes
    }
  };
  
  const handleClose = () => {
    onStepChange(null); // Ensure target highlight is removed if any
    onClose(); // Call onClose when tutorial is skipped
  };

  const { tooltipStyle, arrowStyle } = useMemo(() => {
    if (!targetRect || !currentStep) {
      // Return a hidden style until targetRect is available
      return { tooltipStyle: { opacity: 0, visibility: 'hidden' }, arrowStyle: {} };
    }

    const tooltipWidth = currentStep.widthClass === 'w-80' ? 320 : 288;
    const tooltipHeight = 160; // Assuming a consistent height for all tooltips for layout calculations
    const margin = 16; // Margin between target and tooltip, and screen edges

    let ttStyle: React.CSSProperties = {};
    let arStyle: React.CSSProperties = {};

    // Calculate a consistent desired top position for all tooltips.
    // This aligns the top edge of the tooltip with `margin` pixels below the target's bottom edge.
    const desiredTop = targetRect.bottom + margin;
    // Clamp the 'top' position to ensure the tooltip stays within the viewport.
    const clampedTop = Math.max(margin, Math.min(desiredTop, window.innerHeight - tooltipHeight - margin));

    // Calculate a common 'left' position that would center the tooltip horizontally if it were
    // placed directly below the target. This helps with horizontal positioning consistency.
    let commonLeft = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
    // Clamp the 'left' position to ensure the tooltip stays within the viewport.
    commonLeft = Math.max(margin, commonLeft);
    commonLeft = Math.min(commonLeft, window.innerWidth - tooltipWidth - margin);

    switch (currentStep.placement) {
      case 'bottom': {
        ttStyle = { top: `${clampedTop}px`, left: `${commonLeft}px`, transform: 'none' };
        // Arrow points up from the top of the tooltip, horizontally centered relative to target.
        arStyle = { 
            bottom: '100%', 
            left: `${targetRect.left + targetRect.width / 2 - commonLeft}px`, // position relative to tooltip's left edge
            transform: 'translateX(-50%)', 
            borderBottom: '8px solid #404040', 
            borderLeft: '8px solid transparent', 
            borderRight: '8px solid transparent' 
        };
        break;
      }
      case 'left': {
        // Place tooltip to the left of the target element
        const left = targetRect.left - tooltipWidth - margin;
        
        ttStyle = { top: `${clampedTop}px`, left: `${left}px`, transform: 'none' };
        
        // Since the 'left' tooltip is now vertically aligned (its top is 'clampedTop')
        // similar to 'bottom' placed tooltips, its arrow should also come from its top.
        // The 'left' position of the arrow is calculated relative to the tooltip's 'left' property,
        // so it points towards the target's horizontal center.
        arStyle = { 
            bottom: '100%', // Arrow points upwards from the tooltip's top edge
            left: `${targetRect.left + targetRect.width / 2 - left}px`, // Horizontally center on target relative to tooltip's left edge
            transform: 'translateX(-50%)', // Ensure the arrow is visually centered
            borderBottom: '8px solid #404040', 
            borderLeft: '8px solid transparent', 
            borderRight: '8px solid transparent' 
        };
        break;
      }
      // 'top' and 'right' placement cases would need similar adjustments if introduced,
      // ensuring their vertical alignment is consistent if desired to be "in line".
    }
    
    // Ensure the tooltip is visible once targetRect is calculated
    ttStyle.opacity = 1;
    ttStyle.visibility = 'visible';

    return { tooltipStyle: ttStyle, arrowStyle: arStyle };
  }, [targetRect, currentStep]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[2000] bg-black/75 backdrop-blur-sm">
      <div
        className={`fixed bg-neutral-800 border border-neutral-700 rounded-lg shadow-2xl p-4 text-neutral-200 transition-all duration-300 ease-in-out ${currentStep.widthClass}`}
        style={tooltipStyle} // Apply the calculated style directly
      >
        <div className="absolute w-0 h-0" style={arrowStyle} />
        <div className="flex justify-between items-start mb-2">
            <h3 className="text-lg font-bold text-sky-400">{currentStep.title}</h3>
            <span className="text-xs text-neutral-400 font-mono">{stepIndex + 1}/{STEPS.length}</span>
        </div>
        <p className="text-sm text-neutral-300 leading-relaxed mb-4">{currentStep.content}</p>
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
    </div>
  );
};

export default FirstVisitTutorial;
// --- END OF FILE src/components/FirstVisitTutorial.tsx ---