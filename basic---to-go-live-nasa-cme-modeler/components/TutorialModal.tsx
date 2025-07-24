import React, { useState, useEffect, useMemo, useCallback } from 'react';

type PanelType = 'controls' | 'cmeList' | 'none';

interface TutorialStep {
  targetId: string;
  title: string;
  content: string;
  placement: 'bottom' | 'top' | 'left' | 'right';
  widthClass?: string;
  offsetY?: number; 
  offsetX?: number; 
  panel?: PanelType;
  disableNext?: boolean;
}

const CME_VISUALIZATION_STEPS: TutorialStep[] = [
  { targetId: 'mobile-controls-button', title: 'CME Controls Panel (Mobile)', content: 'On smaller screens, tap here to open the main controls. On desktop, the panel is on the left.', placement: 'right', widthClass: 'w-72', offsetY: 0, offsetX: 10, panel: 'controls' },
  { targetId: 'controls-panel-container', title: 'CME Controls Panel', content: 'This panel lets you configure the simulation: adjust the time range of CMEs, change your view, focus on celestial bodies, and toggle display options.', placement: 'right', widthClass: 'w-80', offsetY: 0, offsetX: 10, panel: 'controls' },
  { targetId: 'time-range-3d-button', title: 'Time Range Selection', content: 'Choose between 24 hours, 3 days, or 7 days of historical CME data to load into the simulation.', placement: 'bottom', widthClass: 'w-72', panel: 'controls' },
  { targetId: 'view-top-button', title: 'View Modes', content: 'Switch between Top-Down and Side views of the solar system to observe CMEs from different perspectives.', placement: 'bottom', widthClass: 'w-72', panel: 'controls' },
  { targetId: 'focus-earth-button', title: 'Focus Target', content: 'Direct the camera to focus on the Sun or Earth, bringing the selected body to the center of your view.', placement: 'bottom', widthClass: 'w-72', panel: 'controls' },
  { targetId: 'show-labels-toggle', title: 'Display Options', content: 'Toggle visibility of planet labels, other planets, and the Earth\'s Moon/L1 point for a cleaner or more detailed view.', placement: 'bottom', widthClass: 'w-80', panel: 'controls' },
  { targetId: 'cme-filter-all-button', title: 'CME Filter', content: 'Filter the displayed CMEs by all, Earth-directed, or non-Earth-directed events to quickly find what you\'re looking for.', placement: 'bottom', widthClass: 'w-72', panel: 'controls' },
  { targetId: 'controls-panel-guide-button', title: 'Re-open Guide', content: 'You can always click this button in the controls panel to revisit this guide for help.', placement: 'bottom', widthClass: 'w-72', panel: 'controls' },
  { targetId: 'reset-view-button', title: 'Reset View', content: 'Instantly snap the camera back to a default top-down view, focused on Earth.', placement: 'right', widthClass: 'w-64', offsetY: 0, offsetX: 10, panel: 'none' },
  { targetId: 'interaction-mode-button', title: 'Interaction Mode', content: 'Toggle between "Move" (default camera control) and "Select" mode to click on CMEs in the simulation for more information.', placement: 'left', widthClass: 'w-72', offsetY: 0, offsetX: 10, panel: 'none' },
  { targetId: 'mobile-cme-list-button', title: 'CME List (Mobile)', content: 'On smaller screens, tap here to open the list of all loaded CMEs. On desktop, this list is on the right.', placement: 'left', widthClass: 'w-72', offsetY: 0, offsetX: 10, panel: 'cmeList' },
  { targetId: 'cme-list-panel-container', title: 'CME List Panel', content: 'This panel displays a list of Coronal Mass Ejections. Click on a CME here, or directly in the simulation, to see its details.', placement: 'left', widthClass: 'w-80', offsetY: 0, offsetX: 10, panel: 'cmeList' },
  { targetId: 'timeline-play-pause-button', title: 'Timeline Playback Controls', content: 'These buttons allow you to play/pause the simulation, and step forward or backward by one hour.', placement: 'top', widthClass: 'w-72', panel: 'none' },
];

interface TutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStepChange: (id: string | null) => void;
  onRequestPanelStateChange: (panel: PanelType) => void;
}

const PANEL_TRANSITION_DURATION = 350;

const TutorialModal: React.FC<TutorialModalProps> = ({ 
  isOpen, 
  onClose, 
  onStepChange,
  onRequestPanelStateChange
}) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const stepsToUse = CME_VISUALIZATION_STEPS;

  useEffect(() => {
    if (isOpen) {
      setStepIndex(0);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const currentStep = stepsToUse[stepIndex];
    if (!currentStep) {
      onClose();
      return;
    }

    onRequestPanelStateChange(currentStep.panel || 'none');

    const timer = setTimeout(() => {
      onStepChange(currentStep.targetId);
      const element = document.getElementById(currentStep.targetId);
      if (element) {
        setTargetRect(element.getBoundingClientRect());
      } else {
        console.warn(`TutorialModal: Target element "${currentStep.targetId}" not found.`);
        setTargetRect(null);
      }
    }, PANEL_TRANSITION_DURATION);

    const handleResize = () => {
      const element = document.getElementById(currentStep.targetId);
      if (element) setTargetRect(element.getBoundingClientRect());
    };
    window.addEventListener('resize', handleResize);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
    };
  }, [isOpen, stepIndex, stepsToUse, onStepChange, onClose, onRequestPanelStateChange]);

  const handleNext = () => {
    if (stepIndex < stepsToUse.length - 1) {
      onStepChange(null);
      setTargetRect(null);
      setStepIndex(stepIndex + 1);
    } else {
      onClose();
    }
  };
  
  const handleClose = () => {
    onClose();
  };

  const currentStep = stepsToUse[stepIndex];

  const { tooltipStyle, arrowStyle } = useMemo(() => {
    if (!targetRect || !currentStep) {
      return { tooltipStyle: { opacity: 0, visibility: 'hidden' }, arrowStyle: {} };
    }

    const tooltipWidth = currentStep.widthClass === 'w-80' ? 320 : (currentStep.widthClass === 'w-72' ? 288 : 256);
    const tooltipHeight = 160; 
    const margin = 16; 

    let top = 0, left = 0;

    switch (currentStep.placement) {
      case 'bottom':
        top = targetRect.bottom + margin;
        left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
        break;
      case 'top':
        top = targetRect.top - tooltipHeight - margin;
        left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
        break;
      case 'left':
        top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
        left = targetRect.left - tooltipWidth - margin;
        break;
      case 'right':
        top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
        left = targetRect.right + margin;
        break;
    }

    top += (currentStep.offsetY || 0);
    left += (currentStep.offsetX || 0);

    const clampedTop = Math.max(margin, Math.min(top, window.innerHeight - tooltipHeight - margin));
    const clampedLeft = Math.max(margin, Math.min(left, window.innerWidth - tooltipWidth - margin));
    
    // Z-INDEX FIX: Set a high z-index to ensure it's above panels (z-[2005])
    let ttStyle: React.CSSProperties = { top: `${clampedTop}px`, left: `${clampedLeft}px`, transform: 'none', zIndex: 2006 };
    let arStyle: React.CSSProperties = {};

    switch (currentStep.placement) {
        case 'bottom':
            arStyle = { bottom: '100%', left: `${targetRect.left + targetRect.width / 2 - clampedLeft}px`, transform: 'translateX(-50%)', borderBottom: '8px solid #404040', borderLeft: '8px solid transparent', borderRight: '8px solid transparent' };
            break;
        case 'top':
            arStyle = { top: '100%', left: `${targetRect.left + targetRect.width / 2 - clampedLeft}px`, transform: 'translateX(-50%)', borderTop: '8px solid #404040', borderLeft: '8px solid transparent', borderRight: '8px solid transparent' };
            break;
        case 'left':
            arStyle = { right: '100%', top: `${targetRect.top + targetRect.height / 2 - clampedTop}px`, transform: 'translateY(-50%)', borderRight: '8px solid #404040', borderTop: '8px solid transparent', borderBottom: '8px solid transparent' };
            break;
        case 'right':
            arStyle = { left: '100%', top: `${targetRect.top + targetRect.height / 2 - clampedTop}px`, transform: 'translateY(-50%)', borderLeft: '8px solid #404040', borderTop: '8px solid transparent', borderBottom: '8px solid transparent' };
            break;
    }
    
    ttStyle.opacity = 1;
    ttStyle.visibility = 'visible';
    return { tooltipStyle: ttStyle, arrowStyle: arStyle };
  }, [targetRect, currentStep]);

  if (!isOpen || !currentStep) return null;
  
  const backdropClasses = `fixed inset-0 z-[2002] transition-all duration-300 bg-black/20 backdrop-filter-none`;

  return (
    <div className={backdropClasses}>
      <div className={`fixed bg-neutral-800 border border-neutral-700 rounded-lg shadow-2xl p-4 text-neutral-200 transition-all duration-300 ease-in-out ${currentStep.widthClass || 'w-64'}`} style={tooltipStyle} onClick={(e) => e.stopPropagation()}>
        <div className="absolute w-0 h-0" style={arrowStyle} />
        <div className="flex justify-between items-start mb-2">
            <h3 className="text-lg font-bold text-sky-400">{currentStep.title}</h3>
            <span className="text-xs text-neutral-400 font-mono">{stepIndex + 1}/{stepsToUse.length}</span>
        </div>
        <p className="text-sm text-neutral-300 leading-relaxed mb-4">{currentStep.content}</p>
        <div className="flex justify-end items-center gap-4">
            <button onClick={handleClose} className="px-3 py-1.5 bg-neutral-700 rounded-md text-neutral-200 hover:bg-neutral-600 transition-colors text-sm font-semibold">Skip Guide</button>
            <button onClick={handleNext} className="px-4 py-1.5 bg-sky-600 text-white rounded-md text-sm font-semibold hover:bg-sky-500 transition-colors">
                {stepIndex === stepsToUse.length - 1 ? 'Finish' : 'Next'}
            </button>
        </div>
      </div>
    </div>
  );
};

export default TutorialModal;