// What changed in this version, once, for people who used the one before
// (utils/whatsNew shouldShowReleaseNotes). The change log condensed to the
// handful of things worth knowing, then an offer of a guided tour of them
// using what is happening right now (utils/releaseTour).

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { aboutLink } from '../utils/aboutSite';

interface Props {
  isOpen: boolean;
  onTakeTour: () => void;
  onClose: () => void;
}

const HIGHLIGHTS: { title: string; detail: string }[] = [
  { title: 'Notifications that work', detail: 'They reach everyone, each has its own icon, and tapping one opens the app at what it is about.' },
  { title: 'A three day forecast of its own', detail: 'Every hour for three days, naked eye, phone or camera, allowing for daylight and the Moon.' },
  { title: 'Coronal Hole Tracker', detail: 'Every hole found live, with its stream speed and arrival time, and 90 days of history.' },
  { title: 'A sunspot tracker that remembers', detail: 'Two weeks of every region, with charts of its flare chances, size and magnetic field.' },
  { title: 'The 3D view grew up', detail: 'Coronal holes and their streams, sunspots, and every CME tilted the way it left the Sun.' },
  { title: 'Substorms, stage by stage', detail: 'Four alert stages, a live magnetotail, and 3D explainers of how aurora forms.' },
];

const ReleaseNotesModal: React.FC<Props> = ({ isOpen, onTakeTour, onClose }) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9000] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
      role="dialog" aria-modal="true" aria-labelledby="release-notes-title"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto styled-scrollbar bg-neutral-950 border border-neutral-700/80 rounded-t-2xl sm:rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative px-5 pt-6 pb-4 overflow-hidden">
          <div
            className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 w-[140%] h-48 opacity-50 blur-3xl"
            style={{ background: 'radial-gradient(ellipse at center, rgba(52,211,153,0.45), rgba(167,139,250,0.3) 45%, transparent 70%)' }}
            aria-hidden="true"
          />
          <p className="relative text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-300">What&rsquo;s new</p>
          <h2 id="release-notes-title" className="relative mt-1 text-2xl font-bold text-white">Spot The Aurora 2.0</h2>
          <p className="relative mt-1 text-sm text-neutral-400">The biggest update yet. Here are the highlights.</p>
        </div>

        <ul className="px-5 space-y-3">
          {HIGHLIGHTS.map((h) => (
            <li key={h.title} className="flex gap-3">
              <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-neutral-100">{h.title}</p>
                <p className="text-xs text-neutral-400 leading-relaxed">{h.detail}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="px-5 pt-5 pb-5 space-y-2.5" style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}>
          <button
            type="button" onClick={onTakeTour} autoFocus
            className="w-full min-h-[48px] rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold transition-colors"
          >
            Take the tour
          </button>
          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={onClose} className="min-h-[40px] px-2 text-sm text-neutral-400 hover:text-white transition-colors">
              Maybe later
            </button>
            <a
              href={aboutLink('changelog')} target="_blank" rel="noopener noreferrer"
              className="text-sm text-sky-400 hover:text-sky-300 hover:underline"
            >
              Read the full change log
            </a>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ReleaseNotesModal;
