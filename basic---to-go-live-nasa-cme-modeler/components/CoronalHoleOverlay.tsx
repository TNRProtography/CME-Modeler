// Coronal hole outlines drawn over solar imagery.
//
// Shared by the Coronal Hole Tracker, the SUVI imagery panel and the sunspot
// tracker, so a hole is the same shape in the same place whichever one you are
// looking at. That is not just tidiness: three copies of a projection is three
// chances for one of them to drift, and a drifted one looks plausible.
//
// The disk comes from the detection rather than being measured from the image
// on screen. The outlines are the detector's own projection run backwards, so
// using its disk and its axis tilt makes the round trip exact; measuring the
// image again can only introduce disagreement, and the displayed image is
// cross-origin anyway, so reading its pixels throws.

import React, { useCallback, useEffect, useRef } from 'react';
import type { DrawableHole } from '../utils/chDetectionStore';
import { chOutlineAt } from '../utils/coronalHoleDynamics';
import {
  containedImageRect, diskFromFraction, heliographicToPixel, longitudeAt,
  type DiskFraction,
} from '../utils/solarDisk';

export const HOLE_COLOURS = ['#38bdf8', '#a78bfa', '#fbbf24', '#34d399', '#fb7185', '#facc15', '#22d3ee', '#f472b6'];

export const holeColour = (index: number): string => HOLE_COLOURS[index % HOLE_COLOURS.length];

export interface CoronalHoleOverlayProps {
  /**
   * What to draw, one entry per hole.
   *
   * Tracks rather than a single frame's detections, so a hole the detector
   * missed in this particular frame keeps its outline instead of blinking
   * out. Each entry carries the moment it was measured and gets rotated to
   * the frame's moment like any other.
   */
  holes: DrawableHole[];
  /** The moment the frame underneath was taken. Outlines rotate to it. */
  atMs: number;
  natural: { width: number; height: number } | null;
  box: { width: number; height: number };
  /** The number to show for a track, from the persistent registry. */
  numberOf?: (trackKey: string) => number | undefined;
  selectedId?: string | null;
  onSelect?: (holeId: string) => void;
  labels?: boolean;
  /** Dim everything, for panels where the holes are context rather than subject. */
  subdued?: boolean;
  /**
   * The disk of the image underneath, when it is not the one the holes were
   * detected in.
   *
   * Heliographic coordinates do not belong to any particular picture, so the
   * same holes can be drawn over HMI as easily as over SUVI - but only against
   * that image's own disk. SUVI and HMI do not frame the Sun identically, so
   * reusing the detection's disk over an HMI frame would put every hole in
   * slightly the wrong place.
   */
  diskOverride?: DiskFraction | null;
}

interface Shape {
  trackKey: string;
  points: { x: number; y: number }[];
  centre: { x: number; y: number } | null;
  colour: string;
  label: string;
}

const CoronalHoleOverlay: React.FC<CoronalHoleOverlayProps> = ({
  holes, atMs, natural, box, numberOf, selectedId, onSelect,
  labels = true, subdued = false, diskOverride = null,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shapesRef = useRef<Shape[]>([]);

  const buildShapes = useCallback((): Shape[] => {
    if (holes.length === 0 || !natural || box.width === 0 || box.height === 0) return [];
    const rect = containedImageRect(natural, box);

    return holes.flatMap((entry, i): Shape[] => {
      const { hole, observedAtMs } = entry;
      // Each outline is drawn against the disk of the frame it was measured
      // in, because that is the disk its coordinates came out of.
      const geometry = diskFromFraction(diskOverride ?? entry.disk, { width: rect.width, height: rect.height });
      const b0 = entry.b0Deg;

      const outline = chOutlineAt(hole, observedAtMs, atMs);
      const points = outline
        .map((q) => heliographicToPixel(q.lat, q.lon, geometry, b0, 0))
        .filter((q) => q.onDisk)
        .map((q) => ({ x: q.x + rect.x, y: q.y + rect.y }));
      if (points.length < 3) return [];

      const projected = heliographicToPixel(
        hole.lat, longitudeAt(hole.lon, observedAtMs, atMs), geometry, b0, 0);
      const number = numberOf?.(entry.trackKey);
      return [{
        trackKey: entry.trackKey,
        points,
        centre: projected.onDisk ? { x: projected.x + rect.x, y: projected.y + rect.y } : null,
        colour: holeColour(number != null ? number : i),
        label: `CH${number ?? i + 1} \u00b7 ${hole.widthDeg.toFixed(0)}\u00b0`,
      }];
    });
  }, [holes, natural, box.width, box.height, atMs, numberOf, diskOverride]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(box.width * dpr));
    canvas.height = Math.max(1, Math.round(box.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.width, box.height);

    const shapes = buildShapes();
    shapesRef.current = shapes;

    for (const shape of shapes) {
      const selected = shape.trackKey === selectedId;
      ctx.beginPath();
      ctx.moveTo(shape.points[0].x, shape.points[0].y);
      for (let k = 1; k < shape.points.length; k++) ctx.lineTo(shape.points[k].x, shape.points[k].y);
      ctx.closePath();

      ctx.globalAlpha = subdued ? 0.75 : 1;
      ctx.fillStyle = `${shape.colour}${selected ? '44' : subdued ? '14' : '22'}`;
      ctx.fill();
      // Stroked twice. A thin coloured line on its own vanishes against the
      // bright corona in the 195 channel.
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = selected ? 5 : 3.5;
      ctx.stroke();
      ctx.strokeStyle = shape.colour;
      ctx.lineWidth = selected ? 2.5 : 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (!labels || !shape.centre) continue;

      // Below the hole with a leader back to it, never on top of it. The hole
      // is the thing being looked at; covering it with its own name is the one
      // placement that cannot be right.
      const bottom = Math.max(...shape.points.map((q) => q.y));
      const size = selected ? 13 : 12;
      ctx.font = `600 ${size}px system-ui, sans-serif`;
      const boxW = ctx.measureText(shape.label).width + 12;
      const boxH = size + 8;
      const labelX = Math.min(Math.max(shape.centre.x - boxW / 2, 4), Math.max(4, box.width - boxW - 4));
      const labelY = Math.min(bottom + 10, Math.max(4, box.height - boxH - 4));

      ctx.beginPath();
      ctx.moveTo(shape.centre.x, shape.centre.y);
      ctx.lineTo(labelX + boxW / 2, labelY);
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = shape.colour;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = 'rgba(0,0,0,0.78)';
      ctx.strokeStyle = shape.colour;
      ctx.lineWidth = selected ? 1.5 : 1;
      if (typeof (ctx as any).roundRect === 'function') {
        ctx.beginPath();
        (ctx as any).roundRect(labelX, labelY, boxW, boxH, 4);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(labelX, labelY, boxW, boxH);
        ctx.strokeRect(labelX, labelY, boxW, boxH);
      }

      ctx.fillStyle = shape.colour;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(shape.label, labelX + 6, labelY + 4);
    }
  }, [buildShapes, box.width, box.height, selectedId, labels, subdued]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSelect) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // Smallest hole containing the point, so a small hole sitting inside a
    // large one's bounding area is still reachable.
    let best: { id: string; area: number } | null = null;
    for (const shape of shapesRef.current) {
      if (!pointInPolygon(x, y, shape.points)) continue;
      const area = polygonArea(shape.points);
      if (!best || area < best.area) best = { id: shape.trackKey, area };
    }
    if (best) onSelect(best.id);
  }, [onSelect]);

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      className={`absolute inset-0 ${onSelect ? 'cursor-pointer' : 'pointer-events-none'}`}
      style={{ width: '100%', height: '100%' }}
    />
  );
};

function pointInPolygon(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function polygonArea(poly: { x: number; y: number }[]): number {
  let sum = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    sum += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  }
  return Math.abs(sum / 2);
}

export default CoronalHoleOverlay;
