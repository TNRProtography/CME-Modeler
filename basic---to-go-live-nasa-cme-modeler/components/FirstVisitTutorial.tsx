// --- START OF FILE src/components/FirstVisitTutorial.tsx ---

import React, { useState, useEffect, useMemo } from 'react';
import CloseIcon from './icons/CloseIcon';

interface TutorialStep {
  targetId: string;
  title: string;
  content: string;
  placement: 'bottom' | 'top' | 'left' | 'right';
}

const STEPS: TutorialStep[] = [
  {
    targetId: 'nav-forecast',
    title: 'Aurora Forecast',
    content: 'This is your go-to page for live aurora forecasts, substorm detection, and sighting maps. Check here to see if an aurora might be visible tonight!',
    placement: 'bottom',
  },
  {
    targetId: 'nav-solar-activity',
    title: 'Solar Activity',
    content: 'Dive deep into the latest solar data. This dashboard shows real-time solar flares, proton flux, and the latest imagery directly from the Sun.',
    placement: 'bottom',
  },
  {
    targetId: 'nav-modeler',
    title: 'CME Modeler',
    content: 'The core of the app! This is a 3D simulation where you can see and model Coronal Mass Ejections (CMEs) as they travel through the solar system.',
    placement: 'bottom',
  },
  {
    targetId: 'nav-settings',
    title: 'App Settings',
    content: 'Finally, here you can configure app settings, manage notifications, and install the app to your device for a better experience.',
    placement: 'left',
  },
];

const FirstVisitTutorial: React.FC<{ isOpen: boolean; onClose: () => void; }> = ({ isOpen, onClose }) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const currentStep = STEPS[stepIndex];

  useEffect(() => {
    if (!isOpen || !currentStep) return;

    const updatePosition = () => {
      const element = document.getElementById(currentStep.targetId);
      if (element) {
        setTargetRect(element.getBoundingClientRect());
      }
    };

    // Update position immediately and also on resize
    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);

  }, [isOpen, currentStep]);

  const handleNext = () => {
    if (stepIndex < STEPS.length - 1) {
      setStepIndex(stepIndex + 1);
    } else {
      onClose(); // Finish tutorial on last step
    }
  };

  const tooltipPosition = useMemo(() => {
    if (!targetRect) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };

    switch (currentStep.placement) {
      case 'bottom':
        return { top: `${targetRect.bottom + 12}px`, left: `${targetRect.left + targetRect.width / 2}px`, transform: 'translateX(-50%)' };
      case 'left':
        return { top: `${targetRect.top + targetRect.height / 2}px`, right: `${window.innerWidth - targetRect.left + 12}px`, transform: 'translateY(-50%)' };
      // Add 'top' and 'right' cases if needed
      default:
        return { top: `${targetRect.bottom + 12}px`, left: `${targetRect.left}px` };
    }
  }, [targetRect, currentStep]);

  if (!isOpen || !targetRect) return null;

  return (
    <div className="fixed inset-0 z-[2000]">
      {/* Spotlight overlay */}
      <div
        className="fixed inset-0 transition-all duration-300"
        style={{
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.6)',
          clipPath: `inset(${targetRect.top - 8}px ${window.innerWidth - targetRect.right - 8}px ${window.innerHeight - targetRect.bottom - 8}px ${targetRect.left - 8}px round 12px)`,
        }}
      />
      
      {/* Tooltip box */}
      <div
        className="fixed bg-neutral-800 border border-neutral-600 rounded-lg shadow-2xl p-4 w-72 text-neutral-200 transition-all duration-300"
        style={tooltipPosition}
      >
        <div className="flex justify-between items-start mb-2">
            <h3 className="text-lg font-bold text-sky-400">{currentStep.title}</h3>
            <span className="text-xs text-neutral-400 font-mono">{stepIndex + 1}/{STEPS.length}</span>
        </div>
        <p className="text-sm text-neutral-300 leading-relaxed mb-4">{currentStep.content}</p>
        <div className="flex justify-end items-center gap-4">
            <button onClick={onClose} className="text-xs text-neutral-400 hover:text-white">Skip Tutorial</button>
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