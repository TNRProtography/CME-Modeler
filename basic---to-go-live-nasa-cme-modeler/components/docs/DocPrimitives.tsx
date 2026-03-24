// --- START OF FILE src/components/docs/DocPrimitives.tsx ---
// Shared layout primitives for the documentation sections.
// All section files import from here — update styling once, reflects everywhere.

import React from 'react';

// ── Section wrapper ───────────────────────────────────────────────────────────
export const Section: React.FC<{
  id: string;
  number: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}> = ({ id, number, title, subtitle, children }) => (
  <div id={id} className="mb-20 scroll-mt-20">
    <div className="flex items-baseline gap-3 mb-2">
      <span className="font-mono text-[10px] font-semibold text-neutral-500 bg-neutral-800/60 border border-neutral-700/50 px-2 py-0.5 rounded">
        {number}
      </span>
      <h2 className="text-2xl font-bold text-white tracking-tight">{title}</h2>
    </div>
    {subtitle && (
      <p className="text-sm text-neutral-400 leading-relaxed mb-8 max-w-3xl">{subtitle}</p>
    )}
    <div className="space-y-5">{children}</div>
  </div>
);

// ── Sub-heading ───────────────────────────────────────────────────────────────
export const SubHeading: React.FC<{ children: React.ReactNode; color?: string }> = ({
  children,
  color = 'text-sky-400',
}) => (
  <h3 className={`text-sm font-semibold ${color} mb-3 flex items-center gap-2`}>
    <span className="block w-4 h-px bg-current opacity-50" />
    {children}
  </h3>
);

// ── Card ──────────────────────────────────────────────────────────────────────
export const Card: React.FC<{
  title?: string;
  icon?: string;
  children: React.ReactNode;
  className?: string;
}> = ({ title, icon, children, className = '' }) => (
  <div className={`bg-neutral-900/70 border border-neutral-700/50 rounded-xl p-5 ${className}`}>
    {(title || icon) && (
      <div className="flex items-center gap-2 mb-3">
        {icon && <span className="text-base">{icon}</span>}
        {title && <p className="text-sm font-semibold text-neutral-100">{title}</p>}
      </div>
    )}
    <div className="text-sm text-neutral-400 leading-relaxed space-y-2">{children}</div>
  </div>
);

// ── Card grid ─────────────────────────────────────────────────────────────────
export const CardGrid: React.FC<{ cols?: 2 | 3; children: React.ReactNode }> = ({
  cols = 2,
  children,
}) => (
  <div
    className={`grid gap-4 ${
      cols === 3
        ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
        : 'grid-cols-1 sm:grid-cols-2'
    }`}
  >
    {children}
  </div>
);

// ── Formula block ─────────────────────────────────────────────────────────────
export const Formula: React.FC<{ children: string; note?: string }> = ({ children, note }) => (
  <div className="my-3">
    <pre className="font-mono text-xs bg-black/50 border border-purple-500/20 border-l-2 border-l-purple-500/60 rounded-lg px-4 py-3 text-purple-200 leading-relaxed overflow-x-auto whitespace-pre-wrap">
      {children}
    </pre>
    {note && <p className="text-xs text-neutral-500 mt-2 leading-relaxed">{note}</p>}
  </div>
);

// ── Callout ───────────────────────────────────────────────────────────────────
type CalloutKind = 'info' | 'warn' | 'ok' | 'red';
const calloutStyles: Record<CalloutKind, string> = {
  info: 'bg-sky-500/8 border-sky-500/25 text-sky-200',
  warn: 'bg-amber-500/8 border-amber-500/25 text-amber-200',
  ok:   'bg-green-500/8 border-green-500/25 text-green-200',
  red:  'bg-red-500/8  border-red-500/25  text-red-200',
};
export const Callout: React.FC<{
  kind?: CalloutKind;
  icon?: string;
  children: React.ReactNode;
}> = ({ kind = 'info', icon, children }) => (
  <div className={`rounded-xl border px-4 py-3 text-sm leading-relaxed flex gap-3 ${calloutStyles[kind]}`}>
    {icon && <span className="flex-shrink-0 text-base mt-0.5">{icon}</span>}
    <div>{children}</div>
  </div>
);

// ── Data table ────────────────────────────────────────────────────────────────
export const DataTable: React.FC<{
  headers: string[];
  rows: (string | React.ReactNode)[][];
}> = ({ headers, rows }) => (
  <div className="overflow-x-auto rounded-xl border border-neutral-700/50">
    <table className="w-full text-xs">
      <thead>
        <tr className="bg-neutral-800/60 border-b border-neutral-700/50">
          {headers.map((h, i) => (
            <th key={i} className="text-left px-4 py-2.5 text-neutral-400 font-semibold uppercase tracking-wide text-[10px]">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri} className="border-b border-neutral-800/50 last:border-0 hover:bg-neutral-800/20 transition-colors">
            {row.map((cell, ci) => (
              <td key={ci} className={`px-4 py-2.5 text-neutral-300 align-top leading-relaxed ${ci === 0 ? 'font-mono text-sky-400 text-[11px] whitespace-nowrap' : ''}`}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// ── Pill / badge ──────────────────────────────────────────────────────────────
type PillColor = 'blue' | 'green' | 'amber' | 'purple' | 'red' | 'neutral';
const pillStyles: Record<PillColor, string> = {
  blue:    'bg-sky-500/15 text-sky-300 border-sky-500/30',
  green:   'bg-green-500/15 text-green-300 border-green-500/30',
  amber:   'bg-amber-500/15 text-amber-300 border-amber-500/30',
  purple:  'bg-purple-500/15 text-purple-300 border-purple-500/30',
  red:     'bg-red-500/15 text-red-300 border-red-500/30',
  neutral: 'bg-neutral-700/40 text-neutral-400 border-neutral-600/40',
};
export const Pill: React.FC<{ color?: PillColor; children: React.ReactNode }> = ({
  color = 'neutral',
  children,
}) => (
  <span className={`inline-flex items-center font-mono text-[10px] font-semibold px-2 py-0.5 rounded-full border ${pillStyles[color]}`}>
    {children}
  </span>
);

// ── Score bar row ─────────────────────────────────────────────────────────────
export const ScoreBar: React.FC<{
  range: string;
  label: string;
  color: string;
  width: number;
}> = ({ range, label, color, width }) => (
  <div className="flex items-center gap-3 py-1">
    <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: color }} />
    <span className="font-mono text-xs text-neutral-300 w-16 flex-shrink-0">{range}</span>
    <div className="flex-1 bg-neutral-800 rounded-full h-1.5 overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${width}%`, background: color }} />
    </div>
    <span className="text-xs text-neutral-400 flex-1 min-w-0">{label}</span>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// END OF FILE
// ─────────────────────────────────────────────────────────────────────────────