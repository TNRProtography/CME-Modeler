import React from 'react';
import type { RegionLabel } from '../utils/regionLabels';

/**
 * Active-region labels drawn over a picture of the Sun.
 *
 * Every surface that shows the disk uses this: the sunspot tracker's overview,
 * the raw SUVI frame, the difference view, and the fullscreen viewer for each.
 * Positions arrive already laid out by buildRegionLabels; this only draws.
 *
 * Leaders and rings are stroked twice, dark underneath and colour on top. A
 * single thin coloured line vanishes against a near-white continuum disk and
 * again against a mid-grey magnetogram, which is how the first version of this
 * shipped looking like it had no leader lines at all.
 */
const SunspotLabelOverlay: React.FC<{
  labels: RegionLabel[];
  boxSize: { width: number; height: number };
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Keys have to be unique when two panels are on screen at once. */
  idPrefix: string;
  /** Titles for the buttons, by region id. */
  titleFor?: (id: string) => string;
}> = ({ labels, boxSize, selectedId, onSelect, idPrefix, titleFor }) => {
  if (labels.length === 0 || !boxSize.width || !boxSize.height) return null;

  return (
    <>
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox={`0 0 ${boxSize.width} ${boxSize.height}`}
        aria-hidden="true"
      >
        {labels.map(({ id, color, label, leader }) => {
          const isSelected = selectedId === id;
          return (
            <g key={`${idPrefix}-leader-${id}`} opacity={isSelected ? 1 : 0.9}>
              <line x1={leader.x} y1={leader.y} x2={label.anchorX} y2={label.anchorY}
                stroke="rgba(0,0,0,0.85)" strokeWidth={isSelected ? 4 : 3.2} strokeLinecap="round" />
              <line x1={leader.x} y1={leader.y} x2={label.anchorX} y2={label.anchorY}
                stroke={color} strokeWidth={isSelected ? 2 : 1.5} strokeLinecap="round" />
              {/* A ring rather than a dot: it says exactly where the region is
                  without hiding what is there. */}
              <circle cx={label.anchorX} cy={label.anchorY} r={isSelected ? 7 : 5.5}
                fill="none" stroke="rgba(0,0,0,0.85)" strokeWidth={isSelected ? 4 : 3.2} />
              <circle cx={label.anchorX} cy={label.anchorY} r={isSelected ? 7 : 5.5}
                fill="none" stroke={color} strokeWidth={isSelected ? 2 : 1.5} />
            </g>
          );
        })}
      </svg>

      {labels.map(({ id, title, detail, color, label }) => {
        const isSelected = selectedId === id;
        const content = (
          <span
            className="relative z-10 flex flex-col items-center px-1.5 py-0.5 rounded whitespace-nowrap bg-black/85 leading-tight"
            style={{
              color,
              border: `1px solid ${color}40`,
              boxShadow: isSelected ? `0 0 8px ${color}60` : 'none',
            }}
          >
            <span className="text-[10px] font-bold">{title}</span>
            {detail && <span className="text-[9px] font-medium text-neutral-300">{detail}</span>}
          </span>
        );

        // In the fullscreen viewer there is nothing to select, so the labels
        // are plain marks rather than buttons that swallow the drag gesture.
        if (!onSelect) {
          return (
            <div
              key={`${idPrefix}-label-${id}`}
              className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              style={{ left: `${label.x}px`, top: `${label.y}px` }}
            >
              {content}
            </div>
          );
        }

        return (
          <button
            key={`${idPrefix}-label-${id}`}
            onClick={(e) => { e.stopPropagation(); onSelect(id); }}
            className="absolute -translate-x-1/2 -translate-y-1/2 group opacity-90 hover:opacity-100 transition-opacity"
            style={{ left: `${label.x}px`, top: `${label.y}px` }}
            title={titleFor?.(id)}
          >
            {content}
          </button>
        );
      })}
    </>
  );
};

export default SunspotLabelOverlay;
