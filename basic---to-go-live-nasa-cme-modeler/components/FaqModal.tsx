// --- START OF FILE src/components/FaqModal.tsx ---

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import CloseIcon from './icons/CloseIcon';

interface FaqItem {
  question: string;
  answer: string;
}

const FAQ_ITEMS: FaqItem[] = [
  {
    question: 'Can I see the aurora from Auckland?',
    answer: 'If you allow GPS (the app will prompt you for it), head to the aurora forecast page and the app will tell you what visibility to expect from your exact location. It covers now, the next 15 minutes, 30 minutes, 1 hour and 2 hours. The forecast is personalised to where you are, so it works whether you are in Auckland, Christchurch, or anywhere else in New Zealand.',
  },
  {
    question: 'What does the Spot The Aurora score mean?',
    answer: 'The score is based on real time solar wind data from ACE, DSCOVR and/or IMAP to work out how well the solar wind is connecting with Earth. This is compared with real time magnetometer data from Eyrewell in Canterbury to find out exactly what the aurora is doing right now. We combine this with solar wind trends to forecast what the aurora should be doing in the next 15 and 30 minutes. The 1 hour and 2 hour forecasts are based on current IMF and hemispheric power. These are less accurate and should be used as a guide, not a guarantee. The further out from now we get, the less certainty there is. This is shown by the colour of the confidence dots next to each score.',
  },
  {
    question: 'When is the best time of year to see aurora in New Zealand?',
    answer: 'Around spring and autumn. The Earth is better aligned with the solar wind for good magnetic connection, known as the Russell McPherron effect. That said, you can see aurora at any time of year, but many things have to line up. A solar storm or coronal hole with a high speed stream has to be headed towards Earth, the storming needs to happen during our night time, the local weather has to be clear, and most of the time the moon has to be dim or below the horizon. Autumn and spring tend to be more active, winter gives you more darkness, and summer often has better weather. There is no "aurora season" as such, other than the 11 year solar cycle where there is generally more activity from the sun.',
  },
  {
    question: 'What does "phone visibility" mean?',
    answer: 'This means you can use your phone camera in night mode and pick up aurora, whether it is a coloured glow on the horizon or beams and structure in the sky. Your eyes might not see much, but your phone will.',
  },
  {
    question: 'How far in advance can you predict aurora?',
    answer: 'Typically no more than about an hour in advance, based on solar wind speed and how long it takes to travel from the monitoring satellites to Earth. Our 2 hour forecast uses an algorithm we developed based on solar wind data and hemispheric power. It is important to note this is not guaranteed to happen, just a guide for what might be coming.',
  },
  {
    question: 'What is a CME and how does it affect aurora?',
    answer: 'A CME (Coronal Mass Ejection) is charged matter being released from the sun. These can be very explosive or reasonably tame. CMEs have their own magnetic field, density and speed. Due to limited visibility on CMEs near the sun, they are very difficult to forecast. We often cannot say for certain if or when one will arrive at Earth, because they can twist and warp during their journey through space. It gets even more complex when there are nearby coronal holes on the sun, or other CMEs nearby with their own magnetic fields. They can interfere with each other, sometimes deflecting, twisting or warping each other. In some rare cases, multiple nearby CMEs can compress each other causing major storming at Earth, like the May 2024 Gannon storm.',
  },
  {
    question: 'What is a coronal hole high speed stream?',
    answer: 'Coronal holes are holes in the sun\'s corona which allow fast solar wind to escape. The solar wind that comes out is called a High Speed Stream (HSS). When a HSS hits Earth, it can cause aurora depending on the orientation of the interplanetary magnetic field (IMF). These are one of the most common drivers of aurora activity in New Zealand.',
  },
  {
    question: 'Do I need to go to the South Island to see aurora?',
    answer: 'Most of the time, yes. The South Island is closer to the auroral oval and sees aurora more frequently. However, there are many strong storms that will easily push aurora to be visible in the North Island. It is not a must, but you will need to be more patient if you are watching from the North Island.',
  },
  {
    question: 'What is the Kp index and do I need to understand it?',
    answer: 'We don\'t use the Kp index in Spot The Aurora, with the exception of NOAA\'s long range forecast. Kp measures activity over a 3 hour window based on the last 3 hours of data. A lot can change in 3 hours, so we don\'t even show the current Kp index because it is not relevant to current conditions or what might happen soon. Our forecast uses real time solar wind data instead, which gives a much more up to date picture.',
  },
  {
    question: 'How do I photograph the aurora with my phone?',
    answer: 'Use night mode, or pro mode if your phone has it. Stay as still as possible. In night mode, the camera will try to expose everything automatically. If you use pro mode, set the exposure to anything longer than 4 seconds and make it longer if the scene is too dark. The most important thing is keeping your phone still. Use a tripod or rest your phone on something solid so it does not move during the exposure.',
  },
  {
    question: 'Does cloud cover affect aurora visibility?',
    answer: 'Absolutely. If you can\'t see stars looking south, you won\'t be seeing aurora. Clear skies are essential.',
  },
  {
    question: 'Does the moon affect aurora viewing?',
    answer: 'Yes, aurora is a dim glow in the sky. The brighter the moon, the brighter the aurora needs to be to stand out against it. Unless there is a big storm, if the moon is up and bright it is probably not worth travelling for. Our forecast takes moon brightness and rise and set times into consideration so you don\'t have to think about it. If the forecast is saying phone camera visibility, you should still get phone visibility regardless of the moon.',
  },
  {
    question: 'What is the aurora oval shown on the map?',
    answer: 'The aurora oval shows where the actual aurora is in relation to a map of New Zealand. Aurora occurs very high up in the atmosphere, so even if the oval on the map does not reach your town, you may still see aurora with your phone or camera by looking south. This is because of the height of the aurora. We include a view line (the blue dashed line) which shows where aurora should be visible to if you have a clear southern horizon. If the blue dashed line is over or above your town on the map, you should be able to see aurora on camera. The higher up the line reaches, the more chance of seeing it with your eyes. Use the aurora oval and the forecast together.',
  },
  {
    question: 'How does the app know what I\'ll see from my location?',
    answer: 'The app uses your device\'s GPS location. Your coordinates are converted to geomagnetic latitude using the IGRF-13 magnetic field model, which tells us how close you are to the aurora oval. This adjusts the score and visibility forecast to be accurate for exactly where you are standing. Someone in Invercargill will get a very different forecast to someone in Auckland for the same solar conditions.',
  },
  {
    question: 'Is the aurora visible every night in New Zealand?',
    answer: 'No. Unlike parts of Iceland, Norway or Alaska, the aurora oval is not directly over New Zealand during normal conditions. There has to be a high speed stream or a solar storm hitting Earth for New Zealand to see aurora. Even then, it is usually just the South Island. Stronger storms and high speed streams can push it to the North Island.',
  },
  {
    question: 'What is a substorm and why does it matter?',
    answer: 'A substorm is what most people would think of as an aurora display. This is when beams show up in the sky and move around. These are the jaw droppers. When the aurora is not in substorm, it is usually just a steady glow on the southern horizon. The app tracks substorm risk so you know when the conditions are right for something impressive to happen.',
  },
  {
    question: 'Is the app free to use?',
    answer: 'Yes, the app is completely free, ad free, and will always be free. Spot The Aurora is a passion project from Dean French at TNR Protography. He wanted an all in one place to view what the sun was doing and get an aurora forecast. He found existing aurora apps were not particularly useful because they required you to know what the moon was doing, understand Kp numbers, and do your own research to figure out if it was worth going out. Spot The Aurora does all of that for you.',
  },
  {
    question: 'How do I get notifications when aurora is likely?',
    answer: 'Go to Settings and you can choose one of the notification templates based on your gear. If you only want to know when aurora is visible with your eyes, select that level. If you only have a phone to take photos with, select that template. If you want notifications for when it is visible with a DSLR or mirrorless camera, select that. You can also choose to receive all notifications or customise completely and pick only the specific alerts you want.',
  },
];

interface FaqModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const FaqModal: React.FC<FaqModalProps> = ({ isOpen, onClose }) => {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;

  const toggle = (index: number) => {
    setExpandedIndex(prev => prev === index ? null : index);
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-md z-[9999] flex justify-center items-center p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] text-neutral-300 flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-neutral-700/80">
          <h3 className="text-xl font-bold text-neutral-200">Frequently Asked Questions</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <CloseIcon className="w-6 h-6" />
          </button>
        </div>

        {/* Questions */}
        <div className="overflow-y-auto styled-scrollbar flex-1">
          {FAQ_ITEMS.map((item, index) => (
            <div key={index} className="border-b border-neutral-800/60 last:border-b-0">
              <button
                onClick={() => toggle(index)}
                className="w-full text-left px-5 py-4 flex items-start justify-between gap-3 hover:bg-neutral-900/50 transition-colors"
              >
                <span className="text-sm font-medium text-neutral-200 leading-snug">
                  {item.question}
                </span>
                <span className="text-neutral-500 flex-shrink-0 mt-0.5 text-lg leading-none">
                  {expandedIndex === index ? '−' : '+'}
                </span>
              </button>
              {expandedIndex === index && (
                <div className="px-5 pb-4 -mt-1">
                  <p className="text-sm text-neutral-400 leading-relaxed">
                    {item.answer}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default FaqModal;
// --- END OF FILE src/components/FaqModal.tsx ---
