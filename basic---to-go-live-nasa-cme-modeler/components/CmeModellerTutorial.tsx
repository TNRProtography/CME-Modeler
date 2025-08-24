import React, { useState, useEffect, useMemo, useCallback } from 'react';

interface TutorialStep {
  targetId: string;
  title: string;
  content: string;
  placement: 'bottom' | 'top' | 'left' | 'right';
  widthClass?: string;
}

// Define the steps for the CME Modeler tutorial
const STEPS: TutorialStep[] = [
  { 
    targetId: 'simulation-canvas-main', 
    title: 'Welcome to the CME Visualization', 
    content: 'This is a 3D representation of Coronal Mass Ejections (CMEs) as they leave the Sun. You can use the controls to explore recent events.', 
    placement: 'bottom', 
    widthClass: 'w-80' 
  },
  { 
    targetId: 'simulation-canvas-main', 
    title: 'Important: This is NOT a Forecast', 
    content: "This tool visualizes raw data of a CME's initial speed and direction. It does NOT account for interactions with solar wind or other CMEs, which can significantly alter its path and arrival time.", 
    placement: 'bottom', 
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
      } else {
        // Special case for the main canvas area if it has no specific ID
        if (currentStep.targetId === 'simulation-canvas-main') {
            const mainEl = document.querySelector('main');
            if (mainEl) setTargetRect(mainEl.getBoundingClientRect());
        } else {
            console.warn(`CmeModellerTutorial: Target element "${currentStep.targetId}" not found.`);
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
  }, [isOpen, stepIndex, onStepChange, onClose]);

  const handleNext = () => {
    if (stepIndex < STEPS.length - 1) {
      setStepIndex(stepIndex + 1);
    } else {
      onClose();
    }
  };
  
  const { tooltipStyle, arrowStyle, highlightStyle } = useMemo(() => {
    if (!targetRect || !currentStep) {
      return { 
          tooltipStyle: { opacity: 0, visibility: 'hidden' }, 
          arrowStyle: {},
          highlightStyle: { display: 'none' } 
        };
    }

    const tooltipWidth = currentStep.widthClass === 'w-96' ? 384 : (currentStep.widthClass === 'w-80' ? 320 : 288);
    const tooltipHeight = 180;
    const margin = 16;
    let top = 0, left = 0;

    switch (currentStep.placement) {
      case 'bottom':
        top = targetRect.bottom + margin;
        left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
        break;
      case 'right':
        top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
        left = targetRect.right + margin;
        break;
      default:
        top = targetRect.bottom + margin;
        left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
    }

    const clampedTop = Math.max(margin, Math.min(top, window.innerHeight - tooltipHeight - margin));
    const clampedLeft = Math.max(margin, Math.min(left, window.innerWidth - tooltipWidth - margin));
    
    let ttStyle: React.CSSProperties = { top: `${clampedTop}px`, left: `${clampedLeft}px`, transform: 'none', zIndex: 2006, opacity: 1, visibility: 'visible' };
    
    let arStyle: React.CSSProperties = {};
    switch (currentStep.placement) {
        case 'bottom':
            arStyle = { bottom: '100%', left: `${targetRect.left + targetRect.width / 2 - clampedLeft}px`, transform: 'translateX(-50%)', borderBottom: '8px solid #404040', borderLeft: '8px solid transparent', borderRight: '8px solid transparent' };
            break;
        case 'right':
            arStyle = { left: '100%', top: `${targetRect.top + targetRect.height / 2 - clampedTop}px`, transform: 'translateY(-50%) rotate(180deg)', borderRight: '8px solid #404040', borderTop: '8px solid transparent', borderBottom: '8px solid transparent' };
            break;
        default:
            arStyle = { bottom: '100%', left: `${targetRect.left + targetRect.width / 2 - clampedLeft}px`, transform: 'translateX(-50%)', borderBottom: '8px solid #404040', borderLeft: '8px solid transparent', borderRight: '8px solid transparent' };
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
            <button onClick={handleNext} className="px-4 py-1.5 bg-blue-600 rounded-md text-white hover:bg-blue-700 transition-colors text-sm font-semibold">
                {stepIndex === STEPS.length - 1 ? 'Got It!' : 'Next'}
            </button>
        </div>
      </div>
    </>
  );
};

export default CmeModellerTutorial;