import React, { useState, useEffect, useMemo, useCallback } from 'react';

interface TutorialStep {
  targetId: string;
  title: string;
  content: string;
  placement: 'bottom' | 'top' | 'left' | 'right';
  widthClass?: string;
  disableNext?: boolean;
}

const STEPS: TutorialStep[] = [
  { targetId: 'nav-forecast', title: 'Aurora Forecast', content: 'This is your go-to page for live aurora forecasts, substorm detection, and sighting maps. Check here to see if an aurora might be visible tonight!', placement: 'bottom', widthClass: 'w-80' },
  { targetId: 'nav-solar-activity', title: 'Solar Activity', content: 'Dive deep into the latest solar data and active regions. See real-time solar flares and imagery directly from the Sun.', placement: 'bottom', widthClass: 'w-80' },
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

  // Effect to reset the tutorial to the first step whenever it's opened.
  useEffect(() => {
    if (isOpen) {
      setStepIndex(0);
    }
  }, [isOpen]);

  // Effect to handle positioning and highlighting for the current step.
  useEffect(() => {
    if (!isOpen) {
      onStepChange(null); // Clear highlight when modal is not open
      return;
    }

    const currentStep = STEPS[stepIndex];
    if (!currentStep) {
        onClose(); // Close if we've run out of steps
        return;
    }

    // This callback is kept in case the parent component needs to know the current step
    onStepChange(currentStep.targetId);

    // Function to calculate and set the position of the tooltip
    const updatePosition = () => {
      const element = document.getElementById(currentStep.targetId);
      if (element) {
        setTargetRect(element.getBoundingClientRect());
      } else {
        console.warn(`FirstVisitTutorial: Target element "${currentStep.targetId}" not found.`);
        setTargetRect(null);
      }
    };

    // Use a small delay to ensure the DOM is ready
    const timer = setTimeout(updatePosition, 50);
    window.addEventListener('resize', updatePosition);
    
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, stepIndex, onStepChange, onClose]);


  const handleNext = () => {
    const currentStep = STEPS[stepIndex];
    if (currentStep && !currentStep.disableNext && stepIndex < STEPS.length - 1) {
      setStepIndex(stepIndex + 1);
    } else if (currentStep && !currentStep.disableNext) {
      onClose(); // Finish tutorial on the last step
    }
  };
  
  const handleClose = () => {
    onClose();
  };

  const currentStep = STEPS[stepIndex];

  const { tooltipStyle, arrowStyle, highlightStyle } = useMemo(() => {
    if (!targetRect || !currentStep) {
      return { 
          tooltipStyle: { opacity: 0, visibility: 'hidden' }, 
          arrowStyle: {},
          highlightStyle: { display: 'none' } 
        };
    }

    // --- Tooltip Position Calculation ---
    const tooltipWidth = currentStep.widthClass === 'w-80' ? 320 : (currentStep.widthClass === 'w-72' ? 288 : 256);
    const tooltipHeight = 160; 
    const margin = 16;
    let top = 0, left = 0;

    switch (currentStep.placement) {
      case 'bottom':
        top = targetRect.bottom + margin;
        left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
        break;
      case 'left':
        top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
        left = targetRect.left - tooltipWidth - margin;
        break;
      default:
        top = targetRect.bottom + margin;
        left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
    }

    const clampedTop = Math.max(margin, Math.min(top, window.innerHeight - tooltipHeight - margin));
    const clampedLeft = Math.max(margin, Math.min(left, window.innerWidth - tooltipWidth - margin));
    
    // --- Style Definitions ---
    // Tooltip Style (z-index: 2006)
    let ttStyle: React.CSSProperties = { top: `${clampedTop}px`, left: `${clampedLeft}px`, transform: 'none', zIndex: 2006, opacity: 1, visibility: 'visible' };
    
    // Arrow Style
    let arStyle: React.CSSProperties = {};
    switch (currentStep.placement) {
        case 'bottom':
            arStyle = { bottom: '100%', left: `${targetRect.left + targetRect.width / 2 - clampedLeft}px`, transform: 'translateX(-50%)', borderBottom: '8px solid #404040', borderLeft: '8px solid transparent', borderRight: '8px solid transparent' };
            break;
        case 'left':
            arStyle = { right: '100%', top: `${targetRect.top + targetRect.height / 2 - clampedTop}px`, transform: 'translateY(-50%)', borderRight: '8px solid #404040', borderTop: '8px solid transparent', borderBottom: '8px solid transparent' };
            break;
        default:
            arStyle = { bottom: '100%', left: `${targetRect.left + targetRect.width / 2 - clampedLeft}px`, transform: 'translateX(-50%)', borderBottom: '8px solid #404040', borderLeft: '8px solid transparent', borderRight: '8px solid transparent' };
    }
    
    // Highlight and Backdrop Style (z-index: 2002)
    const isForecastStep = currentStep.targetId === 'nav-forecast';
    const backdropColor = isForecastStep ? 'rgba(0, 0, 0, 0.2)' : 'rgba(0, 0, 0, 0.6)';
    const PADDING = 4;

    const hlStyle: React.CSSProperties = {
        position: 'fixed',
        top: `${targetRect.top - PADDING}px`,
        left: `${targetRect.left - PADDING}px`,
        width: `${targetRect.width + PADDING * 2}px`,
        height: `${targetRect.height + PADDING * 2}px`,
        borderRadius: '8px',
        boxShadow: `0 0 0 9999px ${backdropColor}`,
        zIndex: 2002,
        pointerEvents: 'none',
        transition: 'top 0.3s, left 0.3s, width 0.3s, height 0.3s',
    };

    return { tooltipStyle: ttStyle, arrowStyle: arStyle, highlightStyle: hlStyle };
  }, [targetRect, currentStep]);

  if (!isOpen || !currentStep) return null;

  return (
    <>
      {/* This single div creates both the backdrop and the highlight "hole" */}
      <div style={highlightStyle} />

      {/* The tooltip itself, which appears above the highlight overlay */}
      <div className={`fixed bg-neutral-800 border border-neutral-700 rounded-lg shadow-2xl p-4 text-neutral-200 transition-all duration-300 ease-in-out ${currentStep.widthClass}`} style={tooltipStyle} onClick={(e) => e.stopPropagation()}>
        <div className="absolute w-0 h-0" style={arrowStyle} />
        <div className="flex justify-between items-start mb-2">
            <h3 className="text-lg font-bold text-sky-400">{currentStep.title}</h3>
            <span className="text-xs text-neutral-400 font-mono">{stepIndex + 1}/{STEPS.length}</span>
        </div>
        <p className="text-sm text-neutral-300 leading-relaxed mb-4">{currentStep.content}</p>
        <div className="flex justify-end items-center gap-4">
            <button onClick={handleClose} className="px-3 py-1.5 bg-neutral-700 rounded-md text-neutral-200 hover:bg-neutral-600 transition-colors text-sm font-semibold">Skip Tutorial</button>
            {!currentStep.disableNext && (
                <button onClick={handleNext} className="px-4 py-1.5 bg-blue-600 rounded-md text-white hover:bg-blue-700 transition-colors text-sm font-semibold">
                    {stepIndex === STEPS.length - 1 ? 'Finish' : 'Next'}
                </button>
            )}
        </div>
      </div>
    </>
  );
};

export default FirstVisitTutorial;