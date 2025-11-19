import React, { useState, useEffect, useMemo } from 'react';

interface TutorialStep {
  targetId: string;
  title: string;
  content: string;
  placement: 'bottom' | 'top' | 'left' | 'right';
  widthClass?: string;
  disableNext?: boolean;
}

const STEPS: TutorialStep[] = [
  { 
    targetId: 'nav-forecast', 
    title: 'Your Forecast Hub', 
    content: 'Start here. This dashboard combines real-time solar wind data with local conditions to give you a live "Spot The Aurora" score.', 
    placement: 'bottom', 
    widthClass: 'w-80' 
  },
  { 
    targetId: 'nav-solar-activity', 
    title: 'Solar Source', 
    content: 'Track the sun directly. View live X-ray flux charts, proton levels, and the latest images from NASA/NOAA satellites.', 
    placement: 'bottom', 
    widthClass: 'w-80' 
  },
  { 
    targetId: 'nav-modeler', 
    title: '3D Visualization', 
    content: 'Visualize space weather in 3D. Watch Coronal Mass Ejections (CMEs) travel through the solar system relative to Earth.', 
    placement: 'bottom', 
    widthClass: 'w-80' 
  }, 
  { 
    targetId: 'nav-settings', 
    title: 'Customize', 
    content: 'Set up push notifications for flares and aurora alerts, configure your location settings, or install the app to your home screen.', 
    placement: 'left', 
    widthClass: 'w-72' 
  },
];

interface FirstVisitTutorialProps {
  isOpen: boolean;
  onClose: () => void;
  onStepChange: (id: string | null) => void;
}

const FirstVisitTutorial: React.FC<FirstVisitTutorialProps> = ({ isOpen, onClose, onStepChange }) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (isOpen) setStepIndex(0);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      onStepChange(null);
      return;
    }

    const currentStep = STEPS[stepIndex];
    if (!currentStep) {
        onClose();
        return;
    }

    onStepChange(currentStep.targetId);

    const updatePosition = () => {
      const element = document.getElementById(currentStep.targetId);
      if (element) {
        setTargetRect(element.getBoundingClientRect());
      }
    };

    // Small delay to allow UI to settle
    const timer = setTimeout(updatePosition, 100);
    window.addEventListener('resize', updatePosition);
    
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, stepIndex, onStepChange, onClose]);

  const handlePrevious = () => {
    if (stepIndex > 0) setStepIndex(stepIndex - 1);
  };

  const handleNext = () => {
    if (stepIndex < STEPS.length - 1) {
      setStepIndex(stepIndex + 1);
    } else {
      onClose();
    }
  };
  
  const currentStep = STEPS[stepIndex];

  const { tooltipStyle, arrowStyle, highlightStyle } = useMemo(() => {
    if (!targetRect || !currentStep) {
      return { 
          tooltipStyle: { opacity: 0, visibility: 'hidden' as const }, 
          arrowStyle: {},
          highlightStyle: { display: 'none' } 
        };
    }

    const tooltipWidth = 320;
    const margin = 12;
    let top = 0, left = 0;

    // Simple placement logic
    if (currentStep.placement === 'bottom') {
        top = targetRect.bottom + margin;
        left = targetRect.left + (targetRect.width / 2) - (tooltipWidth / 2);
    } else if (currentStep.placement === 'left') {
        top = targetRect.top;
        left = targetRect.left - tooltipWidth - margin;
    }

    // Clamp to viewport
    left = Math.max(10, Math.min(left, window.innerWidth - tooltipWidth - 10));

    const PADDING = 6;
    const hlStyle: React.CSSProperties = {
        position: 'fixed',
        top: `${targetRect.top - PADDING}px`,
        left: `${targetRect.left - PADDING}px`,
        width: `${targetRect.width + PADDING * 2}px`,
        height: `${targetRect.height + PADDING * 2}px`,
        borderRadius: '12px',
        boxShadow: `0 0 0 9999px rgba(0, 0, 0, 0.75)`,
        border: '2px solid rgba(56, 189, 248, 0.5)', // Sky blue border
        zIndex: 2002,
        pointerEvents: 'none',
        transition: 'all 0.3s ease-in-out',
    };
    
    const ttStyle: React.CSSProperties = { 
        top: `${top}px`, 
        left: `${left}px`, 
        position: 'fixed',
        zIndex: 2003, 
        width: `${tooltipWidth}px`
    };

    return { tooltipStyle: ttStyle, arrowStyle: {}, highlightStyle: hlStyle };
  }, [targetRect, currentStep]);

  if (!isOpen || !currentStep) return null;

  return (
    <>
      <div style={highlightStyle} />

      <div className="bg-neutral-900/95 backdrop-blur-md border border-neutral-700 rounded-xl shadow-2xl p-5 text-neutral-200 transition-all duration-300 ease-in-out" style={tooltipStyle}>
        <div className="flex justify-between items-start mb-3">
            <h3 className="text-lg font-bold text-white">{currentStep.title}</h3>
            <span className="text-xs font-bold bg-neutral-800 text-neutral-400 px-2 py-1 rounded-full">{stepIndex + 1} / {STEPS.length}</span>
        </div>
        
        <p className="text-sm text-neutral-300 leading-relaxed mb-6">{currentStep.content}</p>
        
        <div className="flex justify-between items-center pt-2 border-t border-neutral-800">
            <button onClick={onClose} className="text-xs font-medium text-neutral-500 hover:text-white transition-colors">Skip Tour</button>

            <div className="flex gap-2">
                {stepIndex > 0 && (
                    <button onClick={handlePrevious} className="px-3 py-1.5 rounded-lg text-sm font-medium text-neutral-300 hover:bg-neutral-800 transition-colors">
                        Back
                    </button>
                )}
                <button onClick={handleNext} className="px-4 py-1.5 rounded-lg text-sm font-medium bg-sky-600 text-white hover:bg-sky-500 shadow-lg shadow-sky-900/20 transition-all">
                    {stepIndex === STEPS.length - 1 ? 'Get Started' : 'Next'}
                </button>
            </div>
        </div>
      </div>
    </>
  );
};

export default FirstVisitTutorial;