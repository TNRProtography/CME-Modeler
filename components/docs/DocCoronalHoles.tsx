// --- START OF FILE src/components/docs/DocCoronalHoles.tsx ---
import React from 'react';
import { Card, CardGrid, Formula, Section, SubHeading, Callout } from './DocPrimitives';

const DocCoronalHoles: React.FC = () => (
  <Section
    id="s07"
    number="07"
    title="Coronal Hole Detection Pipeline"
    subtitle="Coronal holes are regions where the Sun's magnetic field is open to interplanetary space, allowing fast solar wind to escape. The app detects them automatically from the live GOES-19 SUVI 195 Å image, entirely in the browser. Every step runs as plain JavaScript — no server compute, no external detection service."
  >
    <SubHeading color="text-green-400">10-Step Pipeline</SubHeading>
    <CardGrid cols={2}>
      <Card icon="1" title="CORS Proxy Fetch">
        <p>
          SUVI 195 Å image fetched via Cloudflare CORS proxy (<code className="font-mono text-xs bg-neutral-800 px-1 rounded text-purple-300">/api/proxy/image</code>) to
          produce a same-origin blob URL. Required because{' '}
          <code className="font-mono text-xs bg-neutral-800 px-1 rounded text-purple-300">canvas.getImageData()</code> throws a SecurityError on
          cross-origin images. NOAA does not include CORS headers on image responses.
        </p>
      </Card>
      <Card icon="2" title="Off-Screen Canvas">
        <p>
          Drawn to an off-screen <code className="font-mono text-xs bg-neutral-800 px-1 rounded text-purple-300">ANALYSIS_SIZE × ANALYSIS_SIZE = 400×400 px</code> canvas. This
          resolution gives accurate polygon boundaries while keeping analysis time under 200 ms on
          typical mobile devices. A 512 px config option exists for sharper boundaries.
        </p>
      </Card>
      <Card icon="3" title="Gradient-Based Limb Detection">
        <p>
          Scans outward from the disk centre in <code className="font-mono text-xs bg-neutral-800 px-1 rounded text-purple-300">N_LIMB_ANGLES = 360</code> radial
          directions (one per degree). Finds the steepest negative brightness gradient in each
          direction — this locates the sharp photosphere limb boundary rather than the outer faint
          coronal halo.
        </p>
      </Card>
      <Card icon="4" title="Disk Mask">
        <p>
          A boolean per-pixel mask is built using the measured per-angle limb radius. Shrunk by a
          limb exclusion fraction to remove the immediate transition zone at the disk edge, which
          has brightness artefacts from the gradient transition.
        </p>
      </Card>
      <Card icon="5" title="Adaptive Median Luma">
        <p>
          The median brightness (luma = 0.299R + 0.587G + 0.114B) of all pixels inside the disk
          mask. This adaptive baseline normalises for exposure variation, SUVI colour table
          changes, and day-to-day calibration drift. Median rather than mean prevents
          active-region bright pixels from pulling the threshold too high.
        </p>
      </Card>
      <Card icon="6" title="CH Candidate Flagging">
        <p>Every disk pixel below the threshold is a CH candidate:</p>
        <Formula note="Calibrated against a GOES-19 SUVI 195 Å reference image from 2026-03-12. The 0.52 value (raised from an earlier 0.40 default) captures the full extent of real CHs without including bright active regions.">
{`CH_DARK_THRESHOLD_FRAC = 0.52

candidate if: luma < 0.52 × disk_median_luma`}
        </Formula>
      </Card>
      <Card icon="7" title="BFS Flood-Fill">
        <p>
          Breadth-first search flood-fill connects adjacent candidate pixels into discrete regions.
          BFS (queue-based) is used rather than recursive DFS to avoid JavaScript call-stack
          overflow on large CH regions with thousands of pixels. Each connected component is a
          distinct CH candidate.
        </p>
      </Card>
      <Card icon="8" title="Size Filter">
        <Formula note="At 400×400 px with a disk covering ~75% of the canvas, this passes regions larger than ~360 pixels. Sub-threshold regions are instrumental noise or small ephemeral bright-point holes that would not drive meaningful HSS streams.">
{`MIN_CH_PIXEL_FRAC = 0.003

keep if: region_pixels > 0.003 × disk_pixels`}
        </Formula>
      </Card>
      <Card icon="9" title="Heliographic Projection">
        <p>Region centroid and boundary polygon converted from pixel to heliographic (Carrington) coordinates:</p>
        <Formula note="No solar rotation correction is applied because SUVI 195 Å is in disk-centre coordinates — the Carrington system already rotates with the Sun.">
{`x_norm = (px - cx) / r_limb   [−1 to +1]
y_norm = (py - cy) / r_limb   [−1 to +1]

lat = asin(y_norm)           [heliographic lat]
lon = atan2(x_norm, cos(lat))[Carrington lon]`}
        </Formula>
      </Card>
      <Card icon="10" title="Output & Post">
        <p>
          Returns <code className="font-mono text-xs bg-neutral-800 px-1 rounded text-purple-300">CoronalHole[]</code> with id, lat, lon, widthDeg, heightDeg, darkness
          (0–1 luma deficit fraction), estimated HSS speed, and polygon boundary. Empty array if
          no holes detected — no simulated fallback. Result is posted to the CH History Worker
          for the 72 h archive and used to build Parker spiral arms in the 3D scene.
        </p>
      </Card>
    </CardGrid>

    <Callout kind="warn" icon="⚠️">
      <strong>Known detection limitations:</strong> CHs near the solar limb are foreshortened —
      their true area is underestimated. Polar holes are partially obscured by viewing geometry.
      Filament channels (dark elongated structures that are not open-field regions) can
      occasionally trigger false positives. CH boundaries should be treated as approximate
      outlines, not precise maps.
    </Callout>

    <SubHeading color="text-green-400">HSS Speed Estimation & Parker Spiral</SubHeading>
    <Card>
      <p>Each detected CH is assigned an estimated solar wind source speed, used for the DBM ambient wind model and Parker spiral geometry:</p>
      <Formula note="Larger, darker CHs drive faster streams — consistent with empirical studies correlating CH area and peak HSS speed at 1 AU. The 18-hour SIR density lead reflects the known structure of a Stream Interaction Region: compressed slow-wind plasma piles up ahead of the arriving fast stream.">
{`widthDeg  = clamp(CH_angular_width, 5, 60) °
darkness  = clamp(luma_deficit_fraction, 0, 1)

peakSpeed = clamp(
  500 + (widthDeg/60)×200 + darkness×120,
  500, 900
) km/s

Parker spiral arm reach: 1.65 AU (extends beyond Earth orbit)
SIR density peak in impact forecast: 18 h before speed rise`}
      </Formula>
    </Card>
  </Section>
);

export default DocCoronalHoles;