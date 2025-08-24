import React, { useState, useEffect, useMemo, useCallback } from 'react';

interface TutorialStep {
  targetId: string;
  title: string;
  content: string;
  placement: 'bottom' | 'top' | 'left' | 'right';
  widthClass?: string;
}

// MODIFIED: Expanded tutorial steps to be more comprehensive
const STEPS: TutorialStep[] = [
  { 
    targetId: 'simulation-canvas-main', 
    title: 'Welcome to the CME Visualization', 
    content: 'This is a 3D representation of Coronal Mass Ejections. Use your mouse/touch to pan, zoom, and rotate the view.', 
    placement: 'top', 
    widthClass: 'w-80' 
  },
  { 
    targetId: 'simulation-canvas-main', 
    title: 'Important: This is NOT a Forecast', 
    content: "This tool visualizes raw data of a CME's initial speed and direction. It does NOT account for interactions with solar wind, which can significantly alter its path and arrival time.", 
    placement: 'top', 
    widthClass: 'w-96' 
  },
  { 
    targetId: 'mobile-controls-button', 
    title: 'Visualization Settings', 
    content: 'Use this button to open the settings panel. Here you can change the date range, camera view, and toggle the visibility of planets and labels.', 
    placement: 'right', 
    widthClass: 'w-72' 
  },
  { 
    targetId: 'mobile-cme-list-button', 
    title: 'CME List', 
    content: 'This button opens a list of all available CMEs for the selected date range. Select any CME from the list to model it individually.', 
    placement: 'left', 
    widthClass: 'w-72' 
  },
  { 
    targetId: 'timeline-controls-container', 
    title: 'Timeline Controls', 
    content: 'When viewing "Show All", use these controls to play, pause, and scrub through the simulation over time. The red marker indicates the current real-world time.', 
    placement: 'top', 
    widthClass: 'w-96' 
  },
  { 
    targetId: 'forecast-models-button', 
    title: 'View Actual Forecasts Here', 
    content: 'For real, predictive CME forecasts that model solar wind and potential Earth impact, please use the professional models (like HUXT and WSA-ENLIL) found here.', 
    placement: 'right', 
    widthClass: 'w-72' 
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
      // Use a more robust check for mobile-specific IDs
      const isMobile = window.innerWidth < 1024;
      let finalTargetId = currentStep.targetId;
      if (isMobile) {
        if (finalTargetId === 'controls-panel-container') finalTargetId = 'mobile-controls-button';
        if (finalTargetId === 'cme-list-panel-container') finalTargetId = 'mobile-cme-list-button';
      }

      const element = document.getElementById(finalTargetId);
      if (element) {
        setTargetRect(element.getBoundingClientRect());
      } else {
        if (finalTargetId === 'simulation-canvas-main') {
            const mainEl = document.getElementById('simulation-canvas-main');
            if (mainEl) setTargetRect(mainEl.getBoundingClientRect());
        } else {
            console.warn(`CmeModellerTutorial: Target element "${finalTargetId}" not found.`);
            setTargetRect(null);
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
  
  const { tooltipStyle, arrowStyle, highlightStyle } = useMemo(() => {
    if (!targetRect || !currentStep) {
      return { 
          tooltipStyle: { opacity: 0, visibility: 'hidden', pointerEvents: 'none' }, 
          arrowStyle: {},
          highlightStyle: { display: 'none' } 
        };
    }

    const isMobile = window.innerWidth < 768;
    const tooltipWidth = currentStep.widthClass === 'w-96' ? 384 : (currentStep.widthClass === 'w-80' ? 320 : 288);
    const tooltipHeight = 200; // Adjusted for potentially more content
    const margin = 16;
    let top = 0, left = 0;
    let placement = currentStep.placement;

    // On mobile, force placement to top/bottom and center it
    if (isMobile) {
        placement = targetRect.top < window.innerHeight / 2 ? 'bottom' : 'top';
        left = window.innerWidth / 2 - tooltipWidth / 2;
        if (placement === 'top') {
            top = targetRect.top - tooltipHeight - margin;
        } else {
            top = targetRect.bottom + margin;
        }
    } else {
        // Desktop placement logic
        switch (placement) {
            case 'top':
                top = targetRect.top - tooltipHeight - margin;
                left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
                break;
            case 'bottom':
                top = targetRect.bottom + margin;
                left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
                break;
            case 'right':
                top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
                left = targetRect.right + margin;
                break;
            case 'left':
                top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
                left = targetRect.left - tooltipWidth - margin;
                break;
        }
    }

    // Clamp the position to stay within the viewport
    const clampedTop = Math.max(margin, Math.min(top, window.innerHeight - tooltipHeight - margin));
    const clampedLeft = Math.max(margin, Math.min(left, window.innerWidth - tooltipWidth - margin));
    
    let ttStyle: React.CSSProperties = { top: `${clampedTop}px`, left: `${clampedLeft}px`, transform: 'none', zIndex: 2006, opacity: 1, visibility: 'visible' };
    
    let arStyle: React.CSSProperties = {};
    switch (placement) {
        case 'top':
            arStyle = { top: '100%', left: `${targetRect.left + targetRect.width / 2 - clampedLeft}px`, transform: 'translateX(-50%)', borderTop: '8px solid #404040', borderLeft: '8px solid transparent', borderRight: '8px solid transparent' };
            break;
        case 'bottom':
            arStyle = { bottom: '100%', left: `${targetRect.left + targetRect.width / 2 - clampedLeft}px`, transform: 'translateX(-50%)', borderBottom: '8px solid #404040', borderLeft: '8px solid transparent', borderRight: '8px solid transparent' };
            break;
        case 'right':
            arStyle = { left: '100%', top: `${targetRect.top + targetRect.height / 2 - clampedTop}px`, transform: 'translateY(-50%) rotate(180deg)', borderRight: '8px solid #404040', borderTop: '8px solid transparent', borderBottom: '8px solid transparent' };
            break;
        case 'left':
            arStyle = { right: '100%', top: `${targetRect.top + targetRect.height / 2 - clampedTop}px`, transform: 'translateY(-50%)', borderLeft: '8px solid #404040', borderTop: '8px solid transparent', borderBottom: '8px solid transparent' };
            break;
    }
    
    const PADDING = 4;
    const hlStyle: React.CSSProperties = {
        position: 'fixed',
        top: `${targetRect.top - PADDING}px`,
        left: `${targetRect.left - PADDING}px`,
        width: `${targetRect.width + PADDING * 2}px`,
        height: `${targetRect.height + PADDING * 2}px`,
        borderRadius: '8px',
        boxShadow: `0 0 0 9999px rgba(0, 0, 0, 0.6)`,
        zIndex: 2002,
        pointerEvents: 'none',
        transition: 'top 0.3s, left 0.3s, width 0.3s, height 0.3s',
    };

    return { tooltipStyle: ttStyle, arrowStyle: arStyle, highlightStyle: hlStyle };
  }, [targetRect, currentStep]);

  if (!isOpen || !currentStep) return null;

  return (
    <>
      <div style={highlightStyle} />

      <div className={`fixed bg-neutral-800 border border-neutral-700 rounded-lg shadow-2xl p-4 text-neutral-200 transition-all duration-300 ease-in-out ${currentStep.widthClass}`} style={tooltipStyle} onClick={(e) => e.stopPropagation()}>
        <div className="absolute w-0 h-0" style={arrowStyle} />
        <div className="flex justify-between items-start mb-2">
            <h3 className="text-lg font-bold text-indigo-400">{currentStep.title}</h3>
            <span className="text-xs text-neutral-400 font-mono">{stepIndex + 1}/{STEPS.length}</span>
        </div>
        <p className="text-sm text-neutral-300 leading-relaxed mb-4" dangerouslySetInnerHTML={{ __html: currentStep.content }} />
        
        <div className="flex justify-between items-center">
            <button onClick={onClose} className="px-3 py-1.5 bg-neutral-700 rounded-md text-neutral-200 hover:bg-neutral-600 transition-colors text-sm font-semibold">Skip</button>
            <div className="flex items-center gap-4">
                {stepIndex > 0 && (
                    <button onClick={handlePrevious} className="px-4 py-1.5 bg-neutral-700 rounded-md text-neutral-200 hover:bg-neutral-600 transition-colors text-sm font-semibold">
                        Previous
                    </button>
                )}
                <button onClick={handleNext} className="px-4 py-1.5 bg-blue-600 rounded-md text-white hover:bg-blue-700 transition-colors text-sm font-semibold">
                    {stepIndex === STEPS.length - 1 ? 'Got It!' : 'Next'}
                </button>
            </div>
        </div>
      </div>
    </>
  );
};

export default CmeModellerTutorial;