import React, { useRef, useEffect } from 'react';

// Simple pass-through vertex shader
const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The magic happens in the fragment shader
const fragmentShader = `
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  // 2D Random function
  float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  // 2D Noise function
  float noise(vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  // Fractional Brownian Motion (layered noise)
  float fbm(vec2 st) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 0.0;
    for (int i = 0; i < 6; i++) {
      value += amplitude * noise(st);
      st *= 2.0;
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec2 st = gl_FragCoord.xy / uResolution.xy;
    st.x *= uResolution.x / uResolution.y; // Correct for aspect ratio

    // --- Starfield ---
    float star_intensity = 0.0;
    vec2 star_st = st * 300.0;
    float star_r = random(floor(star_st));
    if (star_r > 0.996) {
      float star_size = star_r - 0.996;
      star_intensity = step(1.0 - star_size * 200.0, length(fract(star_st) - 0.5));
      // Twinkling effect
      star_intensity *= (sin(uTime * 2.0 * star_r) * 0.4 + 0.6);
    }
    vec3 stars = vec3(star_intensity);

    // --- Aurora ---
    vec2 aurora_uv = vUv;
    aurora_uv.y *= 2.5; // Stretch the noise vertically
    
    // Animate noise over time
    float time_factor = uTime * 0.05;
    float noise_val = fbm(aurora_uv + vec2(time_factor, 0.0));
    
    // Create vertical beam shapes
    float beam_shape = smoothstep(0.4, 0.5, noise_val);
    
    // Add some faster-moving wispy details
    float wisps = fbm(aurora_uv * vec2(1.0, 3.0) + vec2(time_factor * 3.0, 0.0));
    beam_shape *= smoothstep(0.5, 0.6, wisps);
    
    // Fade out towards the top
    beam_shape *= 1.0 - smoothstep(0.7, 1.0, vUv.y);

    // --- Color Gradient ---
    vec3 green = vec3(0.1, 1.0, 0.4);
    vec3 pink = vec3(0.9, 0.2, 0.8);
    // Use a slow, large-scale noise to blend colors
    float color_noise = noise(vUv + vec2(0.0, -time_factor * 0.2));
    vec3 aurora_color = mix(green, pink, color_noise);
    
    // Final color calculation
    vec3 final_color = mix(stars, aurora_color, beam_shape);

    gl_FragColor = vec4(final_color, 1.0);
  }
`;

const AuroraBackground: React.FC = () => {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mountRef.current) return;

    const scene = new window.THREE.Scene();
    const camera = new window.THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    
    const renderer = new window.THREE.WebGLRenderer({ powerPreference: "low-power" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio * 0.75); // Use lower resolution for performance
    
    const mountNode = mountRef.current;
    mountNode.appendChild(renderer.domElement);

    const geometry = new window.THREE.PlaneGeometry(2, 2);
    const material = new window.THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0.0 },
        uResolution: { value: new window.THREE.Vector2(window.innerWidth, window.innerHeight) }
      },
    });

    const mesh = new window.THREE.Mesh(geometry, material);
    scene.add(mesh);

    const clock = new window.THREE.Clock();
    let animationFrameId: number;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      material.uniforms.uTime.value = clock.getElapsedTime();
      renderer.render(scene, camera);
    };

    const handleResize = () => {
        renderer.setSize(window.innerWidth, window.innerHeight);
        material.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
    };
    
    window.addEventListener('resize', handleResize);
    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      mountNode.removeChild(renderer.domElement);
      renderer.dispose();
      geometry.dispose();
      material.dispose();
    };
  }, []);

  return <div ref={mountRef} className="fixed top-0 left-0 w-full h-full z-[-1] pointer-events-none" />;
};

export default AuroraBackground;