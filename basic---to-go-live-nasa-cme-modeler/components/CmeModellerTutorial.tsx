// --- START OF FILE src/components/CmeModellerTutorial.tsx ---

import React, { useState, useEffect, useMemo } from 'react';

interface TutorialStep {
  targetId: string;
  title: string;
  content: string;
  placement: 'bottom' | 'top' | 'left' | 'right';
  widthClass?: string;
}

const STEPS: TutorialStep[] = [
  { 
    targetId: 'simulation-canvas-main', 
    title: 'Welcome to the CME Visualization', 
    content: 'This is a 3D representation of Coronal Mass Ejections. Use your mouse or touch to pan, zoom, and rotate the view.', 
    placement: 'top', 
    widthClass: 'w-80' 
  },
  { 
    targetId: 'mobile-controls-button', 
    title: 'Visualization Settings', 
    content: 'Open this panel to adjust the date range, change the camera view, and toggle visibility for planets, the Moon, and HSS (High Speed Streams).', 
    placement: 'right', 
    widthClass: 'w-72' 
  },
  { 
    targetId: 'mobile-cme-list-button', 
    title: 'CME List', 
    content: 'View all CMEs in the current date range. Tap any CME to model its individual trajectory and see predicted impact times.', 
    placement: 'left', 
    widthClass: 'w-72' 
  },
  { 
    targetId: 'timeline-controls-container', 
    title: 'Timeline Controls', 
    content: 'When "Show All" is selected, use this timeline to animate the CMEs. The red marker indicates the current real-world time.', 
    placement: 'top', 
    widthClass: 'w-96' 
  },
];

interface CmeModellerTutorialProps {
  isOpen: boolean;
  onClose: () => void;
  onStepChange: (id: string | null) => void;
}

const CmeModellerTutorial: React.FC<CmeModellerTutorialProps> = ({ isOpen, onClose, onStepChange }) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const currentStep = STEPS[stepIndex];

  useEffect(() => {
    if (isOpen) {
      setStepIndex(0);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      onStepChange(null);
      return;
    }

    if (!currentStep) {
        onClose();
        return;
    }

    onStepChange(currentStep.targetId);

    const updatePosition = () => {
      const isMobile = window.innerWidth < 1024;
      let finalTargetId = currentStep.targetId;
      
      // Handle mobile vs desktop IDs if needed
      // If a desktop specific ID is missing, fallback to main canvas or specific panel containers
      if (!isMobile && finalTargetId === 'mobile-controls-button') {
          const panel = document.getElementById('controls-panel-container');
          if(panel) {
              setTargetRect(panel.getBoundingClientRect());
              return;
          }
      }

      if (!isMobile && finalTargetId === 'mobile-cme-list-button') {
          const panel = document.getElementById('cme-list-panel-container');
          if(panel) {
              setTargetRect(panel.getBoundingClientRect());
              return;
          }
      }

      const element = document.getElementById(finalTargetId);
      if (element) {
        setTargetRect(element.getBoundingClientRect());
      } else {
        // Fallback for timeline if not visible (e.g., no data loaded yet)
        if (finalTargetId === 'timeline-controls-container') {
             const mainEl = document.getElementById('simulation-canvas-main');
             if (mainEl) {
                 const rect = mainEl.getBoundingClientRect();
                 // Fake a rect at the bottom center
                 setTargetRect({
                     top: rect.bottom - 60,
                     bottom: rect.bottom - 10,
                     left: rect.left + rect.width / 2 - 150,
                     right: rect.left + rect.width / 2 + 150,
                     width: 300,
                     height: 50,
                     x: rect.left + rect.width / 2 - 150,
                     y: rect.bottom - 60,
                     toJSON: () => {}
                 });
                 return;
             }
        }

        if (finalTargetId === 'simulation-canvas-main') {
            const mainEl = document.getElementById('simulation-canvas-main');
            if (mainEl) setTargetRect(mainEl.getBoundingClientRect());
        }
      }
    };

    const timer = setTimeout(updatePosition, 50);
    window.addEventListener('resize', updatePosition);
    
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, stepIndex, onStepChange, onClose, currentStep]);

  const handleNext = () => {
    if (stepIndex < STEPS.length - 1) {
      setStepIndex(stepIndex + 1);
    } else {
      onClose();
    }
  };

  const handlePrevious = () => {
    if (stepIndex > 0) {
      setStepIndex(stepIndex - 1);
    }
  };
  
  const { tooltipStyle, highlightStyle } = useMemo(() => {
    if (!targetRect || !currentStep) {
      return { 
          tooltipStyle: { opacity: 0, visibility: 'hidden' as const }, 
          highlightStyle: { display: 'none' } 
        };
    }

    const tooltipWidth = 320;
    const margin = 12;
    let top = 0, left = 0;

    // Determine position based on preference and screen boundaries
    if (currentStep.placement === 'top') {
        top = targetRect.top - 200; // Approx height above
        left = targetRect.left + (targetRect.width/2) - (tooltipWidth/2);
    } else if (currentStep.placement === 'bottom') {
        top = targetRect.bottom + margin;
        left = targetRect.left + (targetRect.width/2) - (tooltipWidth/2);
    } else if (currentStep.placement === 'right') {
        top = targetRect.top;
        left = targetRect.right + margin;
    } else if (currentStep.placement === 'left') {
        top = targetRect.top;
        left = targetRect.left - tooltipWidth - margin;
    }

    // Clamp to viewport
    left = Math.max(10, Math.min(left, window.innerWidth - tooltipWidth - 10));
    top = Math.max(10, Math.min(top, window.innerHeight - 220));

    const PADDING = 6;
    const hlStyle: React.CSSProperties = {
        position: 'fixed',
        top: `${targetRect.top - PADDING}px`,
        left: `${targetRect.left - PADDING}px`,
        width: `${targetRect.width + PADDING * 2}px`,
        height: `${targetRect.height + PADDING * 2}px`,
        borderRadius: '12px',
        boxShadow: `0 0 0 9999px rgba(0, 0, 0, 0.75)`,
        border: '2px solid rgba(56, 189, 248, 0.5)',
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

    return { tooltipStyle: ttStyle, highlightStyle: hlStyle };
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
            <button onClick={onClose} className="text-xs font-medium text-neutral-500 hover:text-white transition-colors">Skip</button>

            <div className="flex gap-2">
                {stepIndex > 0 && (
                    <button onClick={handlePrevious} className="px-3 py-1.5 rounded-lg text-sm font-medium text-neutral-300 hover:bg-neutral-800 transition-colors">
                        Back
                    </button>
                )}
                <button onClick={handleNext} className="px-4 py-1.5 rounded-lg text-sm font-medium bg-sky-600 text-white hover:bg-sky-500 shadow-lg shadow-sky-900/20 transition-all">
                    {stepIndex === STEPS.length - 1 ? 'Got it!' : 'Next'}
                </button>
            </div>
        </div>
      </div>
    </>
  );
};

export default CmeModellerTutorial;
// --- END OF FILE src/components/CmeModellerTutorial.tsx ---