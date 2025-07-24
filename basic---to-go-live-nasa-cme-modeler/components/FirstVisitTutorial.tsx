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
  { targetId: 'nav-solar-activity', title: 'Solar Activity', content: 'Dive deep into the latest solar data. This dashboard shows real-time solar flares, proton flux, and the latest imagery directly from the Sun.', placement: 'bottom', widthClass: 'w-80' },
  // MODIFIED STEP: Instruct user to click the CME Visualization button directly
  { targetId: 'nav-modeler', title: 'CME Visualization', content: 'Explore Coronal Mass Ejections (CMEs) in a 3D simulation! Click the "CME Visualization" button above to proceed and learn more about this feature.', placement: 'bottom', widthClass: 'w-80', disableNext: true }, 
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

    // Always reset to first step when opened/re-opened to ensure consistent flow
    if (stepIndex !== 0) { // Only reset if not already at the first step
        setStepIndex(0);
    }
    
    // Ensure the highlight is applied for the *current* (potentially reset) step
    const initialTargetId = STEPS[0]?.targetId || null;
    onStepChange(currentStep?.targetId || initialTargetId);


    const updatePosition = () => {
      const element = document.getElementById(currentStep.targetId);
      if (element) {
        setTargetRect(element.getBoundingClientRect());
      } else {
        console.warn(`Tutorial target element not found: ${currentStep.targetId}. Skipping step.`);
        handleNext(); 
      }
    };

    const timer = setTimeout(updatePosition, 50);
    window.addEventListener('resize', updatePosition);
    
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, stepIndex, currentStep, onStepChange]); // Re-evaluate on isOpen/stepIndex/currentStep changes

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
      return { tooltipStyle: { opacity: 0, visibility: 'hidden' }, arrowStyle: {} };
    }

    const tooltipWidth = currentStep.widthClass === 'w-80' ? 320 : (currentStep.widthClass === 'w-72' ? 288 : 256);
    const tooltipHeight = 160; 
    const margin = 16; 

    let ttStyle: React.CSSProperties = {};
    let arStyle: React.CSSProperties = {};

    const desiredTop = targetRect.bottom + margin;
    const clampedTop = Math.max(margin, Math.min(desiredTop, window.innerHeight - tooltipHeight - margin));

    let commonLeft = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
    commonLeft = Math.max(margin, commonLeft);
    commonLeft = Math.min(commonLeft, window.innerWidth - tooltipWidth - margin);

    switch (currentStep.placement) {
      case 'bottom': {
        ttStyle = { top: `${clampedTop}px`, left: `${commonLeft}px`, transform: 'none' };
        arStyle = { 
            bottom: '100%', 
            left: `${targetRect.left + targetRect.width / 2 - commonLeft}px`, 
            transform: 'translateX(-50%)', 
            borderBottom: '8px solid #404040', 
            borderLeft: '8px solid transparent', 
            borderRight: '8px solid transparent' 
        };
        break;
      }
      case 'left': {
        const left = targetRect.left - tooltipWidth - margin;
        
        ttStyle = { top: `${clampedTop}px`, left: `${left}px`, transform: 'none' };
        
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
    }
    
    ttStyle.opacity = 1;
    ttStyle.visibility = 'visible';

    return { tooltipStyle: ttStyle, arrowStyle: arStyle };
  }, [targetRect, currentStep]);

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