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
        // If the target element is not found, skip to the next step
        handleNext(); 
      }
    };

    // Add a small delay to allow the DOM to fully render,
    // especially useful when navigating or on initial load.
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
      onClose();
    }
  };
  
  const handleClose = () => {
    onStepChange(null); // Ensure target highlight is removed
    onClose();
  };

  const { tooltipStyle, arrowStyle } = useMemo(() => {
    if (!targetRect || !currentStep) return { tooltipStyle: { opacity: 0 }, arrowStyle: {} };

    const tooltipWidth = currentStep.widthClass === 'w-80' ? 320 : 288;
    const tooltipHeight = 160; // Assuming a consistent height for all tooltips
    const margin = 16; // Margin between target and tooltip, and screen edges

    let ttStyle: React.CSSProperties = {};
    let arStyle: React.CSSProperties = {};

    switch (currentStep.placement) {
      case 'bottom': {
        const top = targetRect.bottom + margin;
        // Center horizontally relative to target, then clamp to screen edges
        let left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
        left = Math.max(margin, left);
        left = Math.min(left, window.innerWidth - tooltipWidth - margin);
        
        ttStyle = { top: `${top}px`, left: `${left}px`, transform: 'none' };
        // Arrow points up from the top of the tooltip, centered horizontally
        arStyle = { 
            bottom: '100%', 
            left: `${targetRect.left + targetRect.width / 2 - left}px`, 
            transform: 'translateX(-50%)', 
            borderBottom: '8px solid #404040', 
            borderLeft: '8px solid transparent', 
            borderRight: '8px solid transparent' 
        };
        break;
      }
      case 'left': {
        // *** MODIFICATION START ***
        // To align with 'bottom' placed tooltips, set the desired top position
        // to be the same as 'bottom' placements: targetRect.bottom + margin.
        const desiredTop = targetRect.bottom + margin;

        // Ensure the tooltip stays within vertical screen bounds
        const clampedTop = Math.max(margin, Math.min(desiredTop, window.innerHeight - tooltipHeight - margin));
        // *** MODIFICATION END ***
        
        // Position to the left of the target element
        const left = targetRect.left - tooltipWidth - margin;
        
        ttStyle = { top: `${clampedTop}px`, left: `${left}px`, transform: 'none' };
        // Arrow points right from the right of the tooltip,
        // its vertical position is calculated relative to the clamped tooltip top.
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
      // 'top' and 'right' placement cases are not defined but would follow similar logic
    }
    return { tooltipStyle: ttStyle, arrowStyle: arStyle };
  }, [targetRect, currentStep]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[2000] bg-black/75 backdrop-blur-sm">
      <div
        className={`fixed bg-neutral-800 border border-neutral-700 rounded-lg shadow-2xl p-4 text-neutral-200 transition-all duration-300 ease-in-out ${currentStep.widthClass}`}
        style={{ ...tooltipStyle, visibility: targetRect ? 'visible' : 'hidden' }} // Hide until targetRect is calculated
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