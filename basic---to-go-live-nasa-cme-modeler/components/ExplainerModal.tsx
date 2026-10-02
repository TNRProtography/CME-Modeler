// Full-screen 3D explainer (magnetotail, equinox boost, solar wind structure).
//
// The scenes are self-contained pages in public/explainers/, loaded in an
// iframe so their three.js loop, textures and WebGL context live and die with
// the modal and never touch the main SimulationCanvas context.
//
// Rendered into document.body, so a panel deep in the page can open it and it
// still covers the whole screen. ExplainerButton is the launch button each
// panel uses.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export type ExplainerId = 'magnetotail' | 'equinox-boost' | 'solar-wind-structure';

const SRC: Record<ExplainerId, string> = {
  'magnetotail': '/explainers/magnetotail.html',
  'equinox-boost': '/explainers/equinox-boost.html',
  'solar-wind-structure': '/explainers/solar-wind-structure.html',
};

const TITLE: Record<ExplainerId, string> = {
  'magnetotail': 'Magnetotail - how aurora forms',
  'equinox-boost': 'Equinox Boost - the Russell-McPherron effect',
  'solar-wind-structure': 'Solar wind structure',
};

interface Props {
  id: ExplainerId | null;
  onClose: () => void;
}

const ExplainerModal: React.FC<Props> = ({ id, onClose }) => {
  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [id, onClose]);

  if (!id) return null;
  return createPortal((
    <div className="fixed inset-0 z-[5000] bg-black" role="dialog" aria-modal="true" aria-label={TITLE[id]}>
      <iframe
        key={id}
        src={SRC[id]}
        title={TITLE[id]}
        className="absolute inset-0 w-full h-full border-0"
        allow="fullscreen"
      />
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute z-10 right-3 w-11 h-11 rounded-full bg-neutral-950/80 border border-neutral-700 text-neutral-300 hover:text-white hover:border-neutral-500 flex items-center justify-center backdrop-blur"
        style={{ top: 'max(64px, calc(env(safe-area-inset-top) + 56px))' }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  ), document.body);
};

/**
 * "▶ How aurora forms" and friends: opens the explainer full-screen. Emerald
 * until it has been opened once, then quiet - the same hint the old tour
 * button gave new visitors.
 */
export const ExplainerButton: React.FC<{ id: ExplainerId; label: string; title?: string }> = ({ id, label, title }) => {
  const [open, setOpen] = useState(false);
  const key = `explainer-seen-${id}`;
  const [seen, setSeen] = useState(true);
  useEffect(() => { try { setSeen(localStorage.getItem(key) === '1'); } catch { /* ignore */ } }, [key]);
  const launch = () => {
    setOpen(true);
    setSeen(true);
    try { localStorage.setItem(key, '1'); } catch { /* ignore */ }
  };
  return (
    <>
      <button
        type="button"
        onClick={launch}
        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors whitespace-nowrap ${seen
          ? 'text-neutral-400 border-neutral-700 hover:text-white hover:border-neutral-500'
          : 'text-emerald-300 border-emerald-500/50 bg-emerald-500/10'}`}
        title={title ?? TITLE[id]}
      >
        ▶ {label}
      </button>
      <ExplainerModal id={open ? id : null} onClose={() => setOpen(false)} />
    </>
  );
};

export default ExplainerModal;
