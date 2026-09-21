// Placing labels near things without covering them.
//
// The sunspot overview draws a label per active region, and the labels used to
// sit directly on top of their own spots. On a quiet disk that is only untidy;
// on a busy one the labels cover the very things somebody opened the page to
// look at, and two regions a few degrees apart produce two boxes on top of
// each other with neither readable.
//
// So a label is offset from its region and joined to it by a leader line, and
// the offset is chosen to avoid the other labels and, more importantly, every
// other region's position. The result is deterministic: same inputs, same
// layout, no jitter between renders.

export interface LabelAnchor {
  id: string;
  /** Where the thing actually is. */
  x: number;
  y: number;
  /** How big the label will be. */
  width: number;
  height: number;
  /** Bigger gets first pick of the good positions. Defaults to 0. */
  priority?: number;
}

export interface PlacedLabel {
  id: string;
  /** Centre of the label. */
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
  width: number;
  height: number;
}

export interface LayoutBounds {
  width: number;
  height: number;
}

export interface LayoutOptions {
  /**
   * The clear gap to keep between a region and the nearest edge of its label.
   *
   * Measured to the edge, not to the label's centre: a label is far wider than
   * it is tall, so a distance measured to its centre leaves a generous gap
   * above and almost none to the side, which is exactly how labels ended up
   * sitting on the spots they were naming.
   */
  minDistance?: number;
  /** Keep labels this far inside the edges. */
  padding?: number;
  /** How far a label must stay from any anchor that is not its own. */
  anchorClearance?: number;
}

interface Rect { x: number; y: number; w: number; h: number }

const overlapArea = (a: Rect, b: Rect): number => {
  const dx = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const dy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
  return dx > 0 && dy > 0 ? dx * dy : 0;
};

const rectContains = (r: Rect, px: number, py: number, pad = 0): boolean =>
  px >= r.x - r.w / 2 - pad && px <= r.x + r.w / 2 + pad
  && py >= r.y - r.h / 2 - pad && py <= r.y + r.h / 2 + pad;

/**
 * Work out where each label should sit.
 *
 * Labels are placed one at a time, most important first, each taking the best
 * position still available. That is greedy rather than globally optimal, but
 * with a handful of regions it produces a clean layout and, unlike an
 * iterative relaxation, it cannot oscillate or drift between frames.
 */
export function layoutLabels(
  anchors: LabelAnchor[],
  bounds: LayoutBounds,
  options: LayoutOptions = {},
): PlacedLabel[] {
  const minDistance = options.minDistance ?? 16;
  const padding = options.padding ?? 4;
  const anchorClearance = options.anchorClearance ?? 7;

  const centreX = bounds.width / 2;
  const centreY = bounds.height / 2;

  const ordered = [...anchors].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const placed: PlacedLabel[] = [];

  for (const anchor of ordered) {
    const others = anchors.filter(a => a.id !== anchor.id);

    // Outward from the disk centre reads best: the leader points away from the
    // crowd rather than back across it. Everything else is tried too.
    const outward = Math.atan2(anchor.y - centreY, anchor.x - centreX);
    const angles: number[] = [];
    for (let i = 0; i < 16; i++) angles.push(outward + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 8));

    let best: { x: number; y: number; score: number } | null = null;

    // Push out far enough that the box's nearest corner clears the gap, then
    // try progressively further rings if everything close is taken.
    const reach = minDistance + Math.hypot(anchor.width, anchor.height) / 2;
    for (const ring of [0, 1, 2, 3]) {
      const distance = reach + ring * (minDistance * 0.9);
      for (let ai = 0; ai < angles.length; ai++) {
        const angle = angles[ai];
        const x = anchor.x + Math.cos(angle) * distance;
        const y = anchor.y + Math.sin(angle) * distance;
        const rect: Rect = { x, y, w: anchor.width, h: anchor.height };

        let score = 0;

        // Off the edge is worse than anything else; the label would be clipped.
        const halfW = anchor.width / 2;
        const halfH = anchor.height / 2;
        const outX = Math.max(0, padding + halfW - x) + Math.max(0, x + halfW + padding - bounds.width);
        const outY = Math.max(0, padding + halfH - y) + Math.max(0, y + halfH + padding - bounds.height);
        score += (outX + outY) * 400;

        // Covering another region is the thing this exists to prevent.
        for (const other of others) {
          if (rectContains(rect, other.x, other.y, anchorClearance)) score += 1600;
        }
        // And its own, which would defeat the whole exercise. Held to the same
        // clearance as everyone else's: a label touching the spot it names is
        // no more readable than one touching its neighbour.
        if (rectContains(rect, anchor.x, anchor.y, anchorClearance)) score += 2400;

        // Overlapping another label is bad but recoverable - it is only text.
        for (const p of placed) {
          score += overlapArea(rect, { x: p.x, y: p.y, w: p.width, h: p.height }) * 2.5;
        }
        // Crossing another label's leader is untidy, so prefer not to sit on
        // one of their anchors either.
        for (const p of placed) {
          if (rectContains(rect, p.anchorX, p.anchorY, anchorClearance)) score += 900;
        }

        // Among equals, take the shortest leader and the earliest angle, which
        // is the one closest to straight outward.
        score += (distance - minDistance) * 3;
        score += ai * 1.5;

        if (!best || score < best.score) best = { x, y, score };
      }
      // A clean spot on an inner ring beats anything further out.
      if (best && best.score < 1) break;
    }

    const chosen = best ?? { x: anchor.x, y: anchor.y - (minDistance + anchor.height), score: 0 };
    // Clamp as a last resort, so a label near a corner is still readable even
    // if every candidate was partly outside.
    const x = Math.min(bounds.width - anchor.width / 2 - padding,
                       Math.max(anchor.width / 2 + padding, chosen.x));
    const y = Math.min(bounds.height - anchor.height / 2 - padding,
                       Math.max(anchor.height / 2 + padding, chosen.y));

    placed.push({
      id: anchor.id,
      x, y,
      anchorX: anchor.x,
      anchorY: anchor.y,
      width: anchor.width,
      height: anchor.height,
    });
  }

  // Back into the caller's order, so rendering is stable.
  const byId = new Map(placed.map(p => [p.id, p]));
  return anchors.map(a => byId.get(a.id)!).filter(Boolean);
}

/**
 * Where a leader line should meet its label: the point on the label's edge
 * facing the anchor, so the line stops at the box instead of running under it.
 */
export function leaderEndpoint(label: PlacedLabel): { x: number; y: number } {
  const dx = label.anchorX - label.x;
  const dy = label.anchorY - label.y;
  if (dx === 0 && dy === 0) return { x: label.x, y: label.y };

  const halfW = label.width / 2;
  const halfH = label.height / 2;
  // Scale the direction until it first crosses one of the box's sides.
  const tx = dx === 0 ? Infinity : halfW / Math.abs(dx);
  const ty = dy === 0 ? Infinity : halfH / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: label.x + dx * t, y: label.y + dy * t };
}
