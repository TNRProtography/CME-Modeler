// --- START OF FILE src/components/FluxRope.tsx ---

import { ProcessedCME } from '../types';

// Helper to get the color based on CME speed, needed for the rope's material
const getCmeCoreColor = (THREE: any, speed: number): any => {
  if (speed >= 2500) return new THREE.Color(0xff69b4);
  if (speed >= 1800) return new THREE.Color(0x9370db);
  if (speed >= 1000) return new THREE.Color(0xff4500);
  if (speed >= 800)  return new THREE.Color(0xffa500);
  if (speed >= 500)  return new THREE.Color(0xffff00);
  if (speed < 350)   return new THREE.Color(0x808080);
  const grey = new THREE.Color(0x808080);
  const yellow = new THREE.Color(0xffff00);
  return grey.lerp(yellow, THREE.MathUtils.mapLinear(speed, 350, 500, 0, 1));
};

// Helper to create the arrow meshes for the flux rope
const createCustomArrow = (THREE: any, direction: any, length: number, color: string) => {
    const coneHeight = length * 0.2;
    const cylinderHeight = length - coneHeight;
    const coneRadius = coneHeight * 0.5;
    const cylinderRadius = coneRadius * 0.4;

    const group = new THREE.Group();
    // Using a shared material for all parts of the arrow
    const material = new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, depthWrite: false });

    const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(cylinderRadius, cylinderRadius, cylinderHeight, 12), material);
    cylinder.position.y = cylinderHeight / 2;
    
    const cone = new THREE.Mesh(new THREE.ConeGeometry(coneRadius, coneHeight, 12), material);
    cone.position.y = cylinderHeight + coneHeight / 2;

    group.add(cylinder);
    group.add(cone);

    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    return group;
};

/**
 * Creates the complete Three.js Group for the flux rope model.
 * @param THREE The THREE.js instance.
 * @returns A THREE.Group containing all the meshes for the flux rope.
 */
export function createFluxRopeGroup(THREE: any): THREE.Group {
    const ropeGroup = new THREE.Group();
    ropeGroup.visible = false;
    
    const config = { numRings: 7, baseRadius: 3, tubeRadius: 0.3, curveSegments: 128, poloidalArrowLength: 2.5 };
    const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(-10, 0, 0),
        new THREE.Vector3(0, 15, 0),
        new THREE.Vector3(10, 0, 0)
    );

    const points = curve.getPoints(config.curveSegments);
    const { tangents, normals, binormals } = curve.computeFrenetFrames(config.curveSegments, false);
    const spacing = Math.floor(config.curveSegments / (config.numRings + 1));
    const isFlipped = false; // This can be parameterized if you want to add the button back

    // Create Rings
    for (let i = 1; i <= config.numRings; i++) {
        const index = i * spacing;
        const t = index / config.curveSegments;
        const position = points[index];
        const radius = config.baseRadius * (1 + t * 0.3);
        const tube = config.tubeRadius * (1 + t * 0.3);
        const ringQuaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangents[index]);
        const ringMaterial = new THREE.MeshStandardMaterial({
            emissive: "#ff6347",
            emissiveIntensity: 3,
            roughness: 0.4,
            metalness: 0.2,
            transparent: true,
            depthWrite: false, // Explicitly set to false to prevent rendering issues with particles
        });
        const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 16, 100), ringMaterial);
        ring.position.copy(position);
        ring.quaternion.copy(ringQuaternion);
        ropeGroup.add(ring);
    }
    
    // Create Poloidal Arrows
    for (let i = 1; i <= config.numRings; i++) {
        const index = i * spacing;
        const t = index / config.curveSegments;
        const position = points[index];
        const radius = config.baseRadius * (1 + t * 0.3);
        
        const frontArrowPos = position.clone().addScaledVector(binormals[index], radius);
        const frontArrowDir = normals[index].clone().multiplyScalar(isFlipped ? -1 : 1);
        const frontArrow = createCustomArrow(THREE, frontArrowDir, config.poloidalArrowLength, '#ffffff');
        frontArrow.position.copy(frontArrowPos);
        ropeGroup.add(frontArrow);
        
        const backArrowPos = position.clone().addScaledVector(binormals[index], -radius);
        const backArrowDir = normals[index].clone().multiplyScalar(isFlipped ? 1 : -1);
        const backArrow = createCustomArrow(THREE, backArrowDir, config.poloidalArrowLength, '#ffffff');
        backArrow.position.copy(backArrowPos);
        ropeGroup.add(backArrow);
    }

    // Create Axial Arrow
    const axialArrowGroup = new THREE.Group();
    const axialMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false, transparent: true, depthWrite: false });
    const axialBody = new THREE.Mesh(
        new THREE.TubeGeometry(curve, config.curveSegments, 0.1, 8, false),
        axialMaterial
    );
    const arrowT = isFlipped ? 0 : 1;
    const arrowHeadPosition = curve.getPoint(arrowT);
    const tangent = curve.getTangent(arrowT).normalize();
    const arrowDirection = isFlipped ? tangent.negate() : tangent;
    const arrowheadQuaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), arrowDirection);
    const axialHead = new THREE.Mesh(
        new THREE.ConeGeometry(0.3, 0.8, 12),
        axialMaterial
    );
    axialHead.position.copy(arrowHeadPosition);
    axialHead.quaternion.copy(arrowheadQuaternion);
    axialArrowGroup.add(axialBody);
    axialArrowGroup.add(axialHead);
    ropeGroup.add(axialArrowGroup);
    
    return ropeGroup;
}

/**
 * Updates the flux rope's position, scale, and material properties to match the target CME object.
 * @param THREE The THREE.js instance.
 * @param fluxRopeGroup The flux rope group to update.
 * @param cmeObject The target CME particle system (THREE.Points).
 * @param getCmeOpacity A function to calculate opacity from speed.
 */
export function updateFluxRope(
    THREE: any,
    fluxRopeGroup: THREE.Group,
    cmeObject: any,
    getCmeOpacity: (speed: number) => number
) {
    const cme: ProcessedCME = cmeObject.userData;
    fluxRopeGroup.position.copy(cmeObject.position);
    fluxRopeGroup.quaternion.copy(cmeObject.quaternion);

    const cmeLength = cmeObject.scale.y; // The length of the particle system cone
    
    // The flux rope curve has a natural height of 15. We scale it to match the CME length.
    const scaleY = cmeLength / 15;
    
    // The flux rope curve has a natural width of 10 (from center).
    // We scale it to be slightly smaller than the CME particle cone.
    const coneRadius = cmeLength * Math.tan(THREE.MathUtils.degToRad(cme.halfAngle));
    const scaleXZ = (coneRadius / 10) * 0.8; // 0.8 factor to make it visually smaller
    
    fluxRopeGroup.scale.set(scaleXZ, scaleY, scaleXZ);

    // Update opacity and color of all parts based on the CME's properties
    const opacity = getCmeOpacity(cme.speed) * 1.5; // Make it slightly more visible than particles
    const color = getCmeCoreColor(THREE, cme.speed);

    fluxRopeGroup.traverse((child: any) => {
        if (child.isMesh && child.material) {
            child.material.opacity = opacity;
            if(child.material.emissive) {
                child.material.emissive.copy(color);
            } else if (child.material.color) {
                child.material.color.copy(color);
            }
        }
    });
}

// --- END OF FILE src/components/FluxRope.tsx ---