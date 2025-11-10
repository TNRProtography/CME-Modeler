import React from 'react';
import CloseIcon from './icons/CloseIcon';

interface TutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const TutorialSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="mb-4">
    <h4 className="text-lg font-bold text-sky-400 mb-1">{title}</h4>
    <div className="text-sm text-neutral-300 space-y-1">{children}</div>
  </div>
);

const TutorialModal: React.FC<TutorialModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) {
    return null;
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[2050]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-11/12 max-w-2xl max-h-[80vh] bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl z-[2051] flex flex-col">
        <header className="flex justify-between items-center p-4 border-b border-neutral-700">
          <h3 className="text-xl font-bold text-neutral-100">CME Visualization Guide</h3>
          <button onClick={onClose} className="p-1 text-neutral-400 hover:text-white rounded-full transition-colors">
            <CloseIcon className="w-6 h-6" />
          </button>
        </header>
        
        <div className="p-6 overflow-y-auto">
          <TutorialSection title="Main Viewport">
            <p>This is the 3D simulation area. You can pan, zoom, and rotate the camera using your mouse or touch gestures.</p>
            <ul className="list-disc list-inside pl-2">
              <li><strong>Reset View:</strong> The button with the CME icon in the top-left resets the camera to a default top-down view of Earth.</li>
              <li><strong>Interaction Mode:</strong> The button in the top-right toggles between "Move Mode" (camera control) and "Select Mode" (clicking on CMEs for info).</li>
            </ul>
          </TutorialSection>

          <TutorialSection title="Controls Panel (Left)">
            <p>This panel allows you to configure the simulation settings.</p>
            <ul className="list-disc list-inside pl-2">
              <li><strong>Date Range:</strong> Load CME data from the last 24 hours, 3 days, or 7 days.</li>
              <li><strong>View:</strong> Change the camera angle between a top-down and side view of the solar system.</li>
              <li><strong>Focus:</strong> Center the camera's view on either the Sun or Earth.</li>
              <li><strong>Display Options:</strong> Toggle the visibility of planet labels, other planets (Mercury, Venus, Mars), and the Moon/L1 point.</li>
              <li><strong>Filter CMEs:</strong> Show all CMEs, only those directed towards Earth, or only those not directed towards Earth.</li>
            </ul>
          </TutorialSection>
          
          <TutorialSection title="CME List (Right)">
            <p>This panel lists all CMEs loaded based on the selected date range. Click on any CME in this list to model it individually in the simulation and view its details.</p>
          </TutorialSection>

          <TutorialSection title="Timeline Controls (Bottom)">
            <p>This appears when CME data is loaded and allows you to animate all CMEs over time.</p>
             <ul className="list-disc list-inside pl-2">
              <li><strong>Play/Pause:</strong> Start or stop the time-based animation of all CMEs.</li>
              <li><strong>Step Buttons:</strong> Move the simulation forward or backward by a set time interval (e.g., one hour).</li>
              <li><strong>Scrubber:</strong> Drag the slider to manually control the simulation time. A red marker indicates the current real-world time in relation to the timeline.</li>
              <li><strong>Speed Controls:</strong> Adjust the playback speed of the animation.</li>
            </ul>
          </TutorialSection>
        </div>
      </div>
    </>
  );
};

export default TutorialModal;