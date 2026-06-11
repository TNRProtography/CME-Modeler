// --- START OF FILE src/components/docs/DocPages.tsx ---
import React from 'react';
import { Card, CardGrid, Section, SubHeading } from './DocPrimitives';

const DocPages: React.FC = () => (
  <Section
    id="s05"
    number="05"
    title="Pages & Features"
    subtitle="Three main pages targeting different user expertise levels. All navigation is URL-based and shareable — deep links work, including specific CME IDs. Last-visited page and view mode persist in localStorage and in the URL."
  >
    <SubHeading color="text-sky-400">Forecast Page — Primary Page</SubHeading>
    <CardGrid cols={2}>
      <Card icon="🌿" title="Simple View">
        <p>
          No jargon. Score as a large percentage with a one-sentence plain-English description,
          icon, and status word. Four-slot time forecast (Now / 15 min / 30 min / 60 min) with
          plain phrases like "Conditions are building." Live NZ sightings map (Leaflet.js). Cloud
          cover overlay (Windy.com ECMWF iframe). Live camera feeds from 7 NZ locations: Oban,
          Queenstown, Twizel, Taylors Mistake, Opiki, Rangitikei, New Plymouth.
        </p>
      </Card>
      <Card icon="🔭" title="Advanced View">
        <p>
          Full dashboard. All gauges: Bz, Bt, speed, density, hemispheric power, moon
          illumination. IMF chart (Bx/By toggleable, per-point source label). IMF clock angle
          chart. Solar wind charts (speed, density, temperature). NZ Magnetometer (EY2M dH).
          Hemispheric power chart. Disturbance index panel. Moon arc chart. Forecast trend chart
          with celestial overlays. Substorm status with detailed metrics.
        </p>
      </Card>
      <Card icon="📈" title="Forecast Trend Chart">
        <p>
          Score history over the past 24–48 h alongside upcoming OWM cloud cover percentage.
          Sunset and moonrise/moonset annotated as vertical lines. Detected substorm events marked
          with timestamps. Hover tooltip shows exact score, Bz, speed, and density at any
          historical point.
        </p>
      </Card>
      <Card icon="🧭" title="IMF Clock Angle Chart">
        <p>
          A circular chart showing the By/Bz vector orientation. 12 o'clock = purely northward
          Bz (poor coupling). 6 o'clock = purely southward Bz (maximum coupling). Useful for
          spotting rapid rotations during CME sheath/ejecta transitions — a full southward
          rotation sustained for minutes is the strongest aurora signature.
        </p>
      </Card>
    </CardGrid>

    <SubHeading color="text-green-400">Solar Activity Page</SubHeading>
    <CardGrid cols={2}>
      <Card icon="☀️" title="GOES X-ray Flux Chart">
        <p>
          24 h real-time GOES flux. Flare class thresholds (B/C/M/X) marked. Each detected flare
          is clickable for a detail modal: begin/peak/end times in NZT, source location, active
          region number, direct NASA DONKI link. If the flare has a linked CME in DONKI, a button
          navigates directly to that CME in the CME Visualization — the CME's activityID is
          extracted from the linkedEvents array and matched to the 3D scene object.
        </p>
      </Card>
      <Card icon="🌑" title="Active Sunspot Tracker">
        <p>
          Three SDO/HMI image modes: HMI Colorized Magnetogram, B&W Magnetogram,
          Intensitygram. Close-up tap opens a fullscreen CSS-zoom lightbox (no canvas, no CORS
          complications).
        </p>
        <p>
          <strong className="text-neutral-200">Data merge logic:</strong> solar-regions.txt is the
          authoritative list. JSON endpoints are supplementary for flare probabilities only, one
          entry per region, latest by observedTime. TXT wins for identity and position; JSON fills
          in M/X/proton probabilities.
        </p>
      </Card>
      <Card icon="⚛️" title="Proton Flux & SUVI">
        <p>
          Proton flux at ≥10, ≥50, ≥100 MeV channels with S-scale threshold at 10 pfu. SUVI
          195 Å coronal image and CCOR-1 coronagraph video. All imagery has tap-to-fullscreen.
          Swipe left/right on the sunspot close-up to cycle the three image modes.
        </p>
      </Card>
    </CardGrid>

    <SubHeading color="text-indigo-400">CME Visualization Page</SubHeading>
    <CardGrid cols={2}>
      <Card icon="🌌" title="3D Heliospheric Scene">
        <p>
          Three.js r128 at 60 fps. Scene scale: <code className="font-mono text-xs bg-neutral-800 px-1 rounded text-purple-300">SCENE_SCALE = 3.0</code> (1 AU = 3 scene units). Sun uses custom animated Simplex noise fragment shader. Earth has: day texture + normal/spec maps, animated cloud layer, atmosphere glow shader (impact-reactive), aurora oval shader (latitude-controlled). CME objects are GCS flux-rope shaped particle clouds.
        </p>
      </Card>
      <Card icon="📅" title="Timeline Scrubber">
        <p>
          Always shows 7 days past + however many days selected in controls (1/3/7 days). CMEs
          move along their propagation paths. Sun rotation is computed from a stable Unix epoch
          reference — not from <code className="font-mono text-xs bg-neutral-800 px-1 rounded text-purple-300">Date.now()</code> each frame. Earth rotation is frozen when the timeline is paused.
        </p>
      </Card>
      <Card icon="🎨" title="CME Colour Scale">
        <div className="space-y-1.5 mt-1">
          {[
            { color: '#808080', label: '≤350 km/s — grey (approaching wind speed)' },
            { color: '#ffff00', label: '500 km/s — yellow' },
            { color: '#ffa500', label: '800 km/s — orange' },
            { color: '#ff4500', label: '1000 km/s — red-orange' },
            { color: '#9370db', label: '1800 km/s — purple' },
            { color: '#ff69b4', label: '≥2500 km/s — pink (extreme X-class events)' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-2.5">
              <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: color }} />
              <span className="text-xs text-neutral-400">{label}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card icon="📊" title="Simulated Impact Forecast">
        <p>
          7-day speed and density chart at Earth. Speed = decelerated CME arrival speed via DBM.
          Density: 1 CME → 5–10 cm⁻³; 3 concurrent → ~20 cm⁻³; 5+ → capped at 50 cm⁻³. HSS
          density peaks 18 h before speed rise (SIR physics). "Now" marked with yellow vertical
          line.
        </p>
      </Card>
      <Card icon="🌀" title="Coronal Hole Spirals (Beta)">
        <p>
          Parker spiral arms from the current live SUVI detection. Static geometry — always the
          most recent CH position and estimated HSS source speed. Spiral reach: 1.65 AU (beyond
          Earth orbit). Beta because GPU cost of spiral geometry affects older devices. Toggle in
          Controls panel.
        </p>
      </Card>
    </CardGrid>
  </Section>
);

export default DocPages;