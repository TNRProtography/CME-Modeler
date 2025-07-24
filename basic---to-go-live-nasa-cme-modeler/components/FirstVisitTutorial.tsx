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
    if (!isOpen || !currentStep) {
      onStepChange(null);
      return;
    }

    onStepChange(currentStep.targetId);

    const updatePosition = () => {
      const element = document.getElementById(currentStep.targetId);
      if (element) {
        setTargetRect(element.getBoundingClientRect());
      } else {
        // If element isn't found (e.g., on a different page), skip to the next step.
        handleNext();
      }
    };

    // Initial position update
    const timer = setTimeout(updatePosition, 50);
    
    // **FIX: Add an interval to poll for position changes (e.g., from a banner appearing)**
    // This is more robust for catching layout shifts that don't trigger a resize event.
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
    }, 100); // Check every 100ms

    // Also listen for window resize as a fallback
    window.addEventListener('resize', updatePosition);
    
    // Cleanup function to remove listeners and intervals
    return () => {
      clearTimeout(timer);
      clearInterval(positionCheckInterval); // **FIX: Clear the interval**
      window.removeEventListener('resize', updatePosition);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, stepIndex, currentStep, onStepChange]);

  const handleNext = () => {
    if (stepIndex < STEPS.length - 1) {
      setStepIndex(stepIndex + 1);
    } else {
      onClose();
    }
  };
  
  const handleClose = () => {
    onStepChange(null);
    onClose();
  };

  const { tooltipStyle, arrowStyle } = useMemo(() => {
    if (!targetRect || !currentStep) return { tooltipStyle: { opacity: 0 }, arrowStyle: {} };

    const tooltipWidth = currentStep.widthClass === 'w-80' ? 320 : 288;
    const tooltipHeight = 160; // Approximate height for calculation
    const margin = 16;
    let ttStyle: React.CSSProperties = {};
    let arStyle: React.CSSProperties = {};

    switch (currentStep.placement) {
      case 'bottom': {
        const top = targetRect.bottom + margin;
        let left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
        // Clamp left position to stay within the viewport
        left = Math.max(margin, left);
        left = Math.min(left, window.innerWidth - tooltipWidth - margin);
        
        ttStyle = { top: `${top}px`, left: `${left}px`, transform: 'none' };
        arStyle = { bottom: '100%', left: `${targetRect.left + targetRect.width / 2 - left}px`, transform: 'translateX(-50%)', borderBottom: '8px solid #404040', borderLeft: '8px solid transparent', borderRight: '8px solid transparent' };
        break;
      }
      case 'left': {
        const left = targetRect.left - tooltipWidth - margin;
        let top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
        // Clamp top position to stay within the viewport
        top = Math.max(margin, top);
        top = Math.min(top, window.innerHeight - tooltipHeight - margin);
        
        ttStyle = { top: `${top}px`, left: `${left}px`, transform: 'none' };
        arStyle = { left: '100%', top: `${targetRect.top + targetRect.height / 2 - top}px`, transform: 'translateY(-50%)', borderLeft: '8px solid #404040', borderTop: '8px solid transparent', borderBottom: '8px solid transparent' };
        break;
      }
    }
    return { tooltipStyle: ttStyle, arrowStyle: arStyle };
  }, [targetRect, currentStep]);

  if (!isOpen || !currentStep) return null;

  return (
    <div className="fixed inset-0 z-[2000] bg-black/75 backdrop-blur-sm">
      <div
        className={`fixed bg-neutral-800 border border-neutral-700 rounded-lg shadow-2xl p-4 text-neutral-200 transition-all duration-300 ease-in-out ${currentStep.widthClass}`}
        style={{ ...tooltipStyle, visibility: targetRect ? 'visible' : 'hidden' }}
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