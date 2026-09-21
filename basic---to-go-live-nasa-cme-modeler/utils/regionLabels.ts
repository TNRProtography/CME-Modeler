// Turning NOAA active regions into positioned labels for a picture of the Sun.
//
// Five places draw these now - the sunspot tracker's overview, the raw SUVI
// frame, the difference view, and the fullscreen viewer for each - and they
// were growing their own copies of the same four steps: rotate the region to
// the moment being shown, project it with B0, map image pixels into the panel,
// then place the label so it does not cover the spot. Copies drift, and a
// label that is right in one panel and wrong in another is worse than one that
// is wrong everywhere, because nobody knows which to believe.

import {
  heliographicToPixel,
  containedImageRect,
  longitudeAt,
  type SolarDiskGeometry,
} from './solarDisk';
import { solarDiskOrientation } from './solarEphemeris';
import { layoutLabels, leaderEndpoint, type PlacedLabel } from './labelLayout';

export interface RegionInput {
  id: string;
  latitude: number;
  longitude: number;
  /** When NOAA measured it. Null means "treat the report as current". */
  observedAtMs: number | null;
  magneticClass?: string | null;
  spotCount?: number | null;
  area?: number | null;
  /** Whatever the caller wants the label and leader drawn in. */
  color: string;
}

export interface RegionLabel {
  id: string;
  title: string;
  detail: string;
  color: string;
  label: PlacedLabel;
  leader: { x: number; y: number };
}

export interface BuildRegionLabelsOptions {
  /** The disk as measured in the image's own pixels. */
  geometry: SolarDiskGeometry;
  /** The image's natural size, for the object-contain mapping. */
  imageNatural: { width: number; height: number };
  /** The element the labels will be positioned inside. */
  box: { width: number; height: number };
  /** The moment the frame on screen was taken. */
  atMs: number;
  /** Below this width the second line is dropped. */
  detailMinWidth?: number;
}

/** Roughly how wide the two lines render at the sizes the overlay uses. */
const TITLE_CHAR_PX = 6.2;
const DETAIL_CHAR_PX = 5.1;

export function buildRegionLabels(
  regions: RegionInput[],
  options: BuildRegionLabelsOptions,
): RegionLabel[] {
  const { geometry, imageNatural, box, atMs } = options;
  if (!box.width || !box.height || regions.length === 0) return [];

  const { b0 } = solarDiskOrientation(new Date(atMs));
  const rect = containedImageRect(imageNatural, box);
  const showDetail = box.width >= (options.detailMinWidth ?? 420);

  const entries = regions
    .map((region) => {
      // Carry the region to the moment being shown. When NOAA did not say when
      // it measured, assume the report is current rather than assuming it was
      // taken at the frame's time - the latter leaves a full day of rotation
      // uncorrected at the far end of a 24 hour window.
      const observed = region.observedAtMs ?? Date.now();
      const lon = longitudeAt(region.longitude, observed, atMs);
      const pos = heliographicToPixel(region.latitude, lon, geometry, b0);
      if (!pos.onDisk) return null;

      const title = `AR ${region.id}`;
      const detailParts = [
        region.magneticClass ? String(region.magneticClass).toUpperCase() : null,
        region.spotCount != null
          ? `${region.spotCount} spot${region.spotCount === 1 ? '' : 's'}`
          : null,
      ].filter(Boolean) as string[];
      const detail = showDetail ? detailParts.join(' · ') : '';

      return {
        id: region.id,
        title,
        detail,
        color: region.color,
        anchor: {
          id: region.id,
          x: rect.x + pos.x * rect.scale,
          y: rect.y + pos.y * rect.scale,
          width: Math.max(title.length * TITLE_CHAR_PX, detail.length * DETAIL_CHAR_PX) + 12,
          height: detail ? 28 : 19,
          // The regions most worth reading get the clearest positions.
          priority: (region.area ?? 0) + (region.spotCount ?? 0) * 2,
        },
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  if (entries.length === 0) return [];

  const placed = layoutLabels(entries.map((e) => e.anchor), box, {
    // Scaled off the disk rather than the panel, so the gap looks the same
    // whether this is a 300px thumbnail or a fullscreen view.
    minDistance: Math.max(14, Math.min(26, rect.width * 0.035)),
    padding: 3,
    anchorClearance: Math.max(5, rect.width * 0.012),
  });
  const byId = new Map(placed.map((p) => [p.id, p]));

  return entries
    .map((e) => {
      const label = byId.get(e.id);
      if (!label) return null;
      return { id: e.id, title: e.title, detail: e.detail, color: e.color, label, leader: leaderEndpoint(label) };
    })
    .filter((e): e is RegionLabel => e !== null);
}
