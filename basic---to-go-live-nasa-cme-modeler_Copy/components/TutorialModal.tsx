import React from 'react';
import CloseIcon from './icons/CloseIcon';
import MoveIcon from './icons/MoveIcon';
import SelectIcon from './icons/SelectIcon';

interface TutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const TutorialModal: React.FC<TutorialModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex justify-center items-center p-4"
      onClick={onClose}
    >
      <div 
        className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] text-neutral-300 flex flex-col"
        onClick={e => e.stopPropagation()} // Prevent click from closing modal
      >
        <div className="flex justify-between items-center p-4 border-b border-neutral-700/80">
          <h2 className={`text-2xl font-bold text-neutral-200`}>App Guide & Glossary</h2>
          <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors">
            <CloseIcon className="w-6 h-6" />
          </button>
        </div>
        
        <div className="overflow-y-auto p-5 styled-scrollbar pr-4 space-y-6">
          <Section title="What is this?">
            <p>This application visualizes Coronal Mass Ejections (CMEs), massive bursts of solar wind and magnetic fields that stream out from the Sun. You can explore recent CME events, model their trajectory, and see their potential interaction with Earth in a 3D model of the inner solar system.</p>
          </Section>

          <Section title="How to Use the App">
            <SubSection title="1. Control Panel (Left)">
              <p>This panel lets you configure the main simulation view.</p>
              <ul className="list-disc list-inside space-y-1 mt-2 pl-2">
                <li><strong>Date Range:</strong> Load CME data from the last 24 hours, 3 days, or 7 days.</li>
                <li><strong>View:</strong> Switch between a Top-Down (ecliptic North) and a Side View.</li>
                <li><strong>Focus:</strong> Lock the camera's focus on either the Sun or the Earth.</li>
              </ul>
              
              <h5 className="font-semibold text-neutral-300 mt-4">Display Options</h5>
              <p>Use these toggles to reduce clutter in the 3D view.</p>
               <ul className="list-disc list-inside space-y-1 mt-2 pl-2">
                <li><strong>Show Labels:</strong> Turn the text labels for planets on or off.</li>
                <li><strong>Show Other Planets:</strong> Show or hide Mercury, Venus, and Mars to focus on the Sun-Earth system.</li>
                <li><strong>Show Moon & L1:</strong> Show or hide Earth's moon and the L1 satellite point.</li>
              </ul>

              <h5 className="font-semibold text-neutral-300 mt-4">Filter CMEs</h5>
              <p>Refine the list of CMEs shown in the simulation and in the list panel.</p>
               <ul className="list-disc list-inside space-y-1 mt-2 pl-2">
                <li><strong>All:</strong> Shows all available CMEs.</li>
                <li><strong>Earth-Directed:</strong> Shows only CMEs that are likely on a path toward Earth.</li>
                <li><strong>Not Earth-Directed:</strong> Shows only CMEs that are not on a path toward Earth.</li>
              </ul>
            </SubSection>
            
            <SubSection title="2. CME List (Right)">
               <p>This panel lists all CMEs available for the selected date range and filter.</p>
               <ul className="list-disc list-inside space-y-1 mt-2 pl-2">
                 <li><strong>Show All (Live Simulation):</strong> Simulates all listed CMEs based on their actual start times. This mode is best used with the Timeline Controls.</li>
                 <li><strong>Select a specific CME:</strong> Click on any CME in the list to isolate it and model its journey from the Sun. This is useful for studying a single event.</li>
               </ul>
            </SubSection>

            <SubSection title="3. Timeline Controls (Bottom)">
              <p>When viewing "Show All", these controls appear, allowing you to manipulate time.</p>
              <p className="mt-2 p-2 bg-neutral-800/50 border-l-4 border-neutral-600 rounded text-neutral-300">
                <strong>Forecast Period:</strong> The timeline extends 3 days into the future. A <span className="text-red-400 font-semibold">red marker</span> on the slider indicates the current time, separating past events from the future forecast.
              </p>
              <ul className="list-disc list-inside space-y-1 mt-2 pl-2">
                <li><strong>Play/Pause/Step:</strong> Control the flow of time for the simulation.</li>
                <li><strong>Scrubber:</strong> Drag the slider to quickly jump to any point in time within the loaded range.</li>
                <li><strong>Speed:</strong> Adjust the playback speed of the simulation.</li>
              </ul>
            </SubSection>
            
            <SubSection title="4. Interacting with the 3D View">
              <p>The top-right corner of the screen features a mode toggle button to switch how you interact with the 3D space.</p>
              <ul className="list-disc list-inside space-y-3 mt-2 pl-2">
                <li>
                  <div className="flex items-center gap-2">
                    <strong>Move Mode</strong> <MoveIcon className="w-5 h-5 inline-block"/>
                  </div>
                   This is the default mode. Left-click and drag to rotate the camera. Right-click and drag (or use two fingers on a trackpad) to pan. Use the scroll wheel to zoom in and out. The cursor will appear as a hand.
                </li>
                <li>
                  <div className="flex items-center gap-2">
                    <strong>Select Mode</strong> <SelectIcon className="w-5 h-5 inline-block"/>
                  </div>
                  In this mode, camera movement via left-click is paused. This allows you to precisely click on a specific CME particle cloud in the simulation to select it and view its details in the right-hand panel. The cursor will appear as a pointer.
                </li>
              </ul>
            </SubSection>
          </Section>

          <Section title="Glossary of Terms">
             <Definition term="CME (Coronal Mass Ejection)" definition="A significant release of plasma and accompanying magnetic field from the Sun's corona. They can eject billions of tons of coronal material." />
             <Definition term="Speed (km/s)" definition="The propagation speed of the CME front. The color of the CME in the simulation corresponds to its speed, with hotter colors indicating faster, more energetic events." />
             <Definition term="Longitude / Latitude" definition="The coordinates on the Sun's surface where the CME originated. A longitude near 0° means the CME source was facing Earth at the time of eruption." />
             <Definition term="Earth-Directed" definition="Indicates that the CME's trajectory is likely to bring it into contact with Earth's magnetosphere." />
             <Definition term="Predicted Arrival Time" definition="For Earth-directed CMEs, this is NASA's forecast for when the shockwave front is expected to reach our planet." />
             <Definition term="L1 (Lagrange Point 1)" definition="A point in space about 1.5 million km from Earth towards the Sun. At this point, the gravitational pull of the Sun and Earth are equal, making it an excellent location for solar-monitoring spacecraft like DSCOVR and SOHO." />
          </Section>

        </div>
      </div>
    </div>
  );
};

const Section: React.FC<{title: string, children: React.ReactNode}> = ({title, children}) => (
  <section>
    <h3 className="text-xl font-semibold text-neutral-300 mb-2">{title}</h3>
    <div className="space-y-3 text-sm text-neutral-300 leading-relaxed">
      {children}
    </div>
  </section>
);

const SubSection: React.FC<{title: string, children: React.ReactNode}> = ({title, children}) => (
   <div className="mt-4">
      <h4 className="font-semibold text-neutral-400">{title}</h4>
      {children}
   </div>
);

const Definition: React.FC<{term: string, definition: string}> = ({term, definition}) => (
  <div className="mt-2">
    <p><strong>{term}:</strong> {definition}</p>
  </div>
);


export default TutorialModal;