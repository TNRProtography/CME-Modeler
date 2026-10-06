// Labels for things ON the Sun, rather than things near it.
//
// PlanetLabel cannot do this job. It hides a label when the thing it names is
// behind the Sun's disk from the camera, which is right for Mercury and fatal
// for a coronal hole: every surface feature is inside the Sun's angular
// radius by definition, so all of them would be hidden always.
//
// The right test for a surface feature is which way it faces. A patch on the
// far side has its outward normal pointing away from the camera, and that is
// true whichever side of the Sun the camera is on and wherever the Sun is in
// the scene - no angular-radius arithmetic needed.

import React, { useEffect, useRef } from 'react';
import { onSceneFrame } from '../utils/sceneFrame';

export interface SurfaceLabelInfo {
  id: string;
  text: string;
  /** Anchor parented to the Sun, so it turns with it. */
  mesh: any;
  color: string;
  /** Smaller, dimmer labels for secondary things. */
  minor?: boolean;
}

interface Props {
  labels: SurfaceLabelInfo[];
  camera: any;
  rendererDomElement: HTMLCanvasElement | null;
  sunMesh: any;
}

/**
 * How far round the limb a label survives.
 *
 * Zero would flicker: a feature exactly on the limb crosses the threshold
 * back and forth as the Sun turns and as the camera moves. A little margin
 * also stops labels piling up along the edge, where they overlap each other
 * and name features that are barely visible anyway.
 */
const FACING_MARGIN = 0.22;

const SolarSurfaceLabels: React.FC<Props> = ({ labels, camera, rendererDomElement, sunMesh }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const elementsRef = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    const THREE = (window as any).THREE;
    if (!THREE || !camera || !rendererDomElement || !sunMesh || !containerRef.current) return;

    // The canvas size, measured when it changes rather than every frame:
    // reading it each frame forced a layout before every label was placed.
    let boxW = rendererDomElement.clientWidth;
    let boxH = rendererDomElement.clientHeight;
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(([entry]) => { boxW = entry.contentRect.width; boxH = entry.contentRect.height; })
      : null;
    ro?.observe(rendererDomElement);

    // Reused every frame rather than made anew for every label.
    const sunPos = new THREE.Vector3();
    const cameraPos = new THREE.Vector3();
    const world = new THREE.Vector3();
    const outward = new THREE.Vector3();
    const toCamera = new THREE.Vector3();
    const projected = new THREE.Vector3();
    // What each label last showed, so the page is only touched on a change.
    const shown = new Map<string, string>();
    const show = (id: string, el: HTMLDivElement, value: string) => {
      if (shown.get(id) === value) return;
      shown.set(id, value);
      if (value === 'none') { el.style.display = 'none'; return; }
      el.style.display = 'block';
      el.style.transform = value;
    };

    // After each frame the scene draws (utils/sceneFrame), so the labels rest
    // when it does. Placed by transform, which moves them without a layout.
    const tick = () => {
      sunMesh.updateWorldMatrix(true, false);
      sunMesh.getWorldPosition(sunPos);
      camera.getWorldPosition(cameraPos);

      for (const info of labels) {
        const el = elementsRef.current.get(info.id);
        if (!el || !info.mesh) continue;

        info.mesh.updateWorldMatrix(true, false);
        info.mesh.getWorldPosition(world);

        // Which way the surface faces at this point, and whether that is
        // towards us. This is the whole visibility test.
        outward.copy(world).sub(sunPos).normalize();
        toCamera.copy(cameraPos).sub(world).normalize();
        if (outward.dot(toCamera) < FACING_MARGIN) { show(info.id, el, 'none'); continue; }

        projected.copy(world).project(camera);
        if (projected.z > 1) { show(info.id, el, 'none'); continue; }

        const x = Math.round((projected.x * 0.5 + 0.5) * boxW);
        const y = Math.round((-projected.y * 0.5 + 0.5) * boxH);
        show(info.id, el, `translate(${x}px, ${y}px) translate(-50%, -140%)`);
      }
    };

    const off = onSceneFrame(tick);
    const first = requestAnimationFrame(tick);
    return () => { off(); cancelAnimationFrame(first); ro?.disconnect(); };
  }, [labels, camera, rendererDomElement, sunMesh]);

  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none overflow-hidden">
      {labels.map((info) => (
        <div
          key={info.id}
          ref={(el) => {
            if (el) elementsRef.current.set(info.id, el);
            else elementsRef.current.delete(info.id);
          }}
          className={`absolute whitespace-nowrap font-semibold rounded px-1 py-0.5 ${
            info.minor ? 'text-[9px]' : 'text-[10px]'}`}
          style={{
            display: 'none',
            left: 0,
            top: 0,
            transform: 'translate(-50%, -140%)',
            color: info.color,
            // Enough background to stay legible over the photosphere, which
            // is the brightest thing in the scene.
            background: 'rgba(8, 10, 16, 0.72)',
            border: `1px solid ${info.color}55`,
            textShadow: '0 1px 2px rgba(0,0,0,0.9)',
          }}
        >
          {info.text}
        </div>
      ))}
    </div>
  );
};

export default SolarSurfaceLabels;
