// --- START OF FILE src/components/AppDocumentation.tsx ---
import React, { useState, useEffect, useRef, useCallback } from 'react';
import DocExecutiveSummary from './docs/DocExecutiveSummary';
import DocOverview from './docs/DocOverview';
import DocDataSources from './docs/DocDataSources';
import DocAuroraScore from './docs/DocAuroraScore';
import DocSubstormModel from './docs/DocSubstormModel';
import DocPages from './docs/DocPages';
import DocCMEPhysics from './docs/DocCMEPhysics';
import DocCoronalHoles from './docs/DocCoronalHoles';
import DocNotifications from './docs/DocNotifications';
import { DocWorkers, DocSightings, DocTransparency } from './docs/DocWorkersSightingsTransparency';

interface AppDocumentationProps {
  onClose: () => void;
}

const NAV_ITEMS = [
  { id: 'exec', label: 'Summary',         short: '00' },
  { id: 's01',  label: 'Overview',         short: '01' },
  { id: 's02',  label: 'Data Sources',     short: '02' },
  { id: 's03',  label: 'Aurora Score',     short: '03' },
  { id: 's04',  label: 'Substorm Model',   short: '04' },
  { id: 's05',  label: 'Pages',            short: '05' },
  { id: 's06',  label: 'CME Physics',      short: '06' },
  { id: 's07',  label: 'Coronal Holes',    short: '07' },
  { id: 's08',  label: 'Notifications',    short: '08' },
  { id: 's09',  label: 'Workers',          short: '09' },
  { id: 's10',  label: 'Sightings',        short: '10' },
  { id: 's11',  label: 'Transparency',     short: '11' },
];

const AppDocumentation: React.FC<AppDocumentationProps> = ({ onClose }) => {
  const [activeSection, setActiveSection] = useState('exec');
  const scrollRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Intersection observer for nav highlight
  useEffect(() => {
    observerRef.current?.disconnect();
    observerRef.current = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      {
        root: scrollRef.current,
        threshold: 0.15,
        rootMargin: '-80px 0px -60% 0px',
      }
    );
    NAV_ITEMS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observerRef.current?.observe(el);
    });
    return () => observerRef.current?.disconnect();
  }, []);

  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el && scrollRef.current) {
      const top = el.offsetTop - 72; // account for sticky nav
      scrollRef.current.scrollTo({ top, behavior: 'smooth' });
    }
  }, []);

  return (
    <div
      className="fixed inset-0 z-[1500] flex flex-col"
      style={{
        backgroundImage: `url('/background-aurora.jpg')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed',
      }}
    >
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Content */}
      <div className="relative z-10 flex flex-col h-full">

        {/* ── Top header ─────────────────────────────────────────── */}
        <div className="flex-shrink-0 bg-neutral-950/90 backdrop-blur-xl border-b border-neutral-800/80 px-4 sm:px-6 py-3 flex items-center gap-4">
          <button
            onClick={onClose}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/8 hover:bg-white/15 border border-white/10 text-white text-xs font-semibold transition-colors flex-shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            <span className="hidden sm:inline">Back to app</span>
            <span className="sm:hidden">Back</span>
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2.5">
              <span className="text-base font-bold text-white tracking-tight truncate">
                Spot The Aurora — How It Works
              </span>
              <span className="hidden sm:inline text-xs text-neutral-500 flex-shrink-0">
                Technical Architecture
              </span>
            </div>
          </div>

          {/* Quick stats */}
          <div className="hidden md:flex items-center gap-4 text-xs text-neutral-500 flex-shrink-0">
            <span>600+ hours</span>
            <span>11 sections</span>
            <span>V1.6</span>
          </div>
        </div>

        {/* ── Sticky section nav ──────────────────────────────────── */}
        <div className="flex-shrink-0 bg-neutral-950/85 backdrop-blur-xl border-b border-neutral-800/60 px-2 sm:px-4 overflow-x-auto">
          <div className="flex items-center gap-0.5 min-w-max py-1">
            {NAV_ITEMS.map(({ id, label, short }) => (
              <button
                key={id}
                onClick={() => scrollTo(id)}
                className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                  activeSection === id
                    ? 'text-sky-300 bg-sky-500/10'
                    : 'text-neutral-500 hover:text-neutral-300 hover:bg-white/5'
                }`}
              >
                <span className={`font-mono text-[9px] ${activeSection === id ? 'text-sky-500' : 'text-neutral-600'}`}>
                  {short}
                </span>
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Scrollable content ──────────────────────────────────── */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto styled-scrollbar"
          style={{ scrollBehavior: 'smooth' }}
        >
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-24">

            {/* Page intro */}
            <div className="mb-10 pb-8 border-b border-neutral-800/60">
              <p className="text-xs font-mono text-sky-500 mb-1 uppercase tracking-widest">Technical Architecture</p>
              <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-3">
                How Spot The Aurora works
              </h1>
              <p className="text-neutral-400 text-sm leading-relaxed max-w-2xl">
                A fully transparent account of every layer of this app — from raw NOAA and NASA data
                through scoring algorithms, propagation physics, notification cryptography, and backend
                workers. No hand-waving.
              </p>
            </div>

            {/* All sections */}
            <DocExecutiveSummary />
            <DocOverview />
            <DocDataSources />
            <DocAuroraScore />
            <DocSubstormModel />
            <DocPages />
            <DocCMEPhysics />
            <DocCoronalHoles />
            <DocNotifications />
            <DocWorkers />
            <DocSightings />
            <DocTransparency />

          </div>
        </div>

      </div>
    </div>
  );
};

export default AppDocumentation;