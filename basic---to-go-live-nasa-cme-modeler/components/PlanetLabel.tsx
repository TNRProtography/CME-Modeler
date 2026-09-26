import React, { useEffect, useRef } from 'react';
import { SCENE_SCALE } from '../constants';

interface PlanetLabelProps {
  planetMesh: any; // THREE.Object3D
  camera: any; // THREE.Camera
  rendererDomElement: HTMLCanvasElement | null;
  label: string;
  sunMesh: any; // THREE.Object3D | null
}

const PlanetLabel: React.FC<PlanetLabelProps> = ({ planetMesh, camera, rendererDomElement, label, sunMesh }) => {
  const labelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!planetMesh || !camera || !rendererDomElement || !labelRef.current) return;
    
    const THREE = window.THREE;
    if (!THREE) return;
    
    const labelEl = labelRef.current;
    let rafId = 0;

    // The canvas size, measured when it changes rather than read every frame:
    // reading it after the last label's write forced a layout per label per
    // frame.
    let boxW = rendererDomElement.clientWidth;
    let boxH = rendererDomElement.clientHeight;
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(([entry]) => { boxW = entry.contentRect.width; boxH = entry.contentRect.height; })
      : null;
    ro?.observe(rendererDomElement);

    const planetWorldPos = new THREE.Vector3();
    const cameraPosition = new THREE.Vector3();
    const sunWorldPos = new THREE.Vector3();
    const projectionVector = new THREE.Vector3();
    // Written only when they change: a font size change means a layout.
    let lastTransform = '';
    let lastOpacity = '';
    let lastFontSize = '';

    // Every frame, in step with the scene, so a label does not trail its
    // planet while the timeline plays.
    const updatePosition = () => {
      rafId = requestAnimationFrame(updatePosition);
      planetMesh.updateWorldMatrix(true, false);
      sunMesh?.updateWorldMatrix(true, false);
      planetMesh.getWorldPosition(planetWorldPos);
      camera.getWorldPosition(cameraPosition);

      // 1. Occlusion Check (only for planets, not the sun itself)
      let isOccluded = false;
      if (sunMesh && label !== 'Sun') {
        sunMesh.getWorldPosition(sunWorldPos);
        const distToPlanetSq = planetWorldPos.distanceToSquared(cameraPosition);
        const distToSunSq = sunWorldPos.distanceToSquared(cameraPosition);
        if (distToPlanetSq > distToSunSq) {
          const vecToPlanet = planetWorldPos.clone().sub(cameraPosition);
          const vecToSun = sunWorldPos.clone().sub(cameraPosition);
          const angle = vecToPlanet.angleTo(vecToSun);
          const sunRadius = sunMesh.geometry.parameters.radius || (0.1 * SCENE_SCALE);
          const sunAngularRadius = Math.atan(sunRadius / Math.sqrt(distToSunSq));
          if (angle < sunAngularRadius) isOccluded = true;
        }
      }

      // 2. Projection and Frustum Culling Check
      projectionVector.copy(planetWorldPos).project(camera);
      const isBehindCamera = projectionVector.z > 1;

      // 3. Distance-based Visibility Check
      const dist = planetWorldPos.distanceTo(cameraPosition);
      const minVisibleDist = SCENE_SCALE * 0.2;
      const maxVisibleDist = SCENE_SCALE * 100;
      const isTooCloseOrFar = dist < minVisibleDist || dist > maxVisibleDist;

      const shouldBeVisible = !isOccluded && !isBehindCamera && !isTooCloseOrFar;
      const opacity = shouldBeVisible ? '1' : '0';
      if (opacity !== lastOpacity) { labelEl.style.opacity = opacity; lastOpacity = opacity; }
      if (!shouldBeVisible) return;

      const x = Math.round((projectionVector.x * 0.5 + 0.5) * boxW);
      const y = Math.round((-projectionVector.y * 0.5 + 0.5) * boxH);
      const transform = `translate(${x}px, ${y}px) translate(15px, -10px)`;
      if (transform !== lastTransform) { labelEl.style.transform = transform; lastTransform = transform; }

      // 4. Dynamic Font Size, in whole pixels
      const fontSize = `${Math.round(Math.max(10, THREE.MathUtils.mapLinear(dist, minVisibleDist, maxVisibleDist, 16, 9)))}px`;
      if (fontSize !== lastFontSize) { labelEl.style.fontSize = fontSize; lastFontSize = fontSize; }
    };

    rafId = requestAnimationFrame(updatePosition);

    return () => {
      cancelAnimationFrame(rafId);
      ro?.disconnect();
    };

  }, [planetMesh, camera, rendererDomElement, label, sunMesh]);

  return (
    <div
      ref={labelRef}
      className="planet-label-component absolute top-0 left-0 text-white pointer-events-none transition-opacity duration-300 ease-in-out"
      style={{
        opacity: 0,
        textShadow: '0 0 5px #000, 0 0 8px #000',
        transform: 'translate(-1000px, -1000px)', // Start off-screen
        padding: '2px 8px',
        willChange: 'transform, opacity, font-size'
      }}
    >
      {label}
    </div>
  );
};

export default PlanetLabel;