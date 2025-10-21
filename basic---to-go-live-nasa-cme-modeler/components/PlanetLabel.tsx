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
    
    const updatePosition = () => {
      // Ensure world matrices are up to date
      planetMesh.updateWorldMatrix(true, false);
      sunMesh?.updateWorldMatrix(true, false);

      const planetWorldPos = new THREE.Vector3();
      planetMesh.getWorldPosition(planetWorldPos);

      const cameraPosition = new THREE.Vector3();
      camera.getWorldPosition(cameraPosition);

      // 1. Occlusion Check (only for planets, not the sun itself)
      let isOccluded = false;
      if (sunMesh && label !== 'Sun') {
        const sunWorldPos = new THREE.Vector3();
        sunMesh.getWorldPosition(sunWorldPos);

        const distToPlanetSq = planetWorldPos.distanceToSquared(cameraPosition);
        const distToSunSq = sunWorldPos.distanceToSquared(cameraPosition);

        // Check if planet is farther than the sun from the camera
        if (distToPlanetSq > distToSunSq) {
          const vecToPlanet = planetWorldPos.clone().sub(cameraPosition);
          const vecToSun = sunWorldPos.clone().sub(cameraPosition);
          
          const angle = vecToPlanet.angleTo(vecToSun);
          const sunRadius = sunMesh.geometry.parameters.radius || (0.1 * SCENE_SCALE);
          const sunAngularRadius = Math.atan(sunRadius / Math.sqrt(distToSunSq));
          
          if (angle < sunAngularRadius) {
            isOccluded = true;
          }
        }
      }
      
      // 2. Projection and Frustum Culling Check
      const projectionVector = planetWorldPos.clone().project(camera);
      const isBehindCamera = projectionVector.z > 1;

      // 3. Distance-based Visibility Check
      const dist = planetWorldPos.distanceTo(cameraPosition);
      const minVisibleDist = SCENE_SCALE * 0.2;
      const maxVisibleDist = SCENE_SCALE * 15;
      const isTooCloseOrFar = dist < minVisibleDist || dist > maxVisibleDist;

      const shouldBeVisible = !isOccluded && !isBehindCamera && !isTooCloseOrFar;

      if (shouldBeVisible) {
        const x = Math.round((projectionVector.x * 0.5 + 0.5) * rendererDomElement.clientWidth);
        const y = Math.round((-projectionVector.y * 0.5 + 0.5) * rendererDomElement.clientHeight);

        labelEl.style.transform = `translate(${x}px, ${y}px) translate(15px, -10px)`;
        labelEl.style.opacity = '1';
        
        // 4. Dynamic Font Size
        const fontSize = THREE.MathUtils.mapLinear(dist, minVisibleDist, maxVisibleDist, 16, 10);
        labelEl.style.fontSize = `${Math.max(10, fontSize)}px`;

      } else {
        labelEl.style.opacity = '0';
      }
    };

    const intervalId = setInterval(updatePosition, 32); // Update at ~30fps

    return () => clearInterval(intervalId);

  }, [planetMesh, camera, rendererDomElement, label, sunMesh]);

  // MODIFIED: Added a common class name for easy selection during screenshot capture
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