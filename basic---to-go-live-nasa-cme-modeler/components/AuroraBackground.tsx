import React, { useEffect } from 'react';

// Simple pass-through vertex shader
const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

// More subtle, vertical aurora shader
const fragmentShader = `
  uniform vec2 uResolution;
  uniform float uTime;
  varying vec2 vUv;

  float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  float noise(vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(random(i), random(i + vec2(1.0, 0.0)), u.x),
               mix(random(i + vec2(0.0, 1.0)), random(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  void main() {
    vec2 st = vUv;
    float time = uTime * 0.1;
    
    // Starfield
    vec2 star_uv = vUv * 500.0;
    float star_r = random(floor(star_uv));
    float star_val = 0.0;
    if (star_r > 0.99) {
      star_val = step(0.995, star_r) * (sin(uTime * 3.0 * star_r) * 0.5 + 0.5);
    }
    vec3 stars = vec3(star_val);

    // Aurora
    st.y *= 1.5; // Stretch vertically
    float n1 = noise(st * 2.0 + vec2(0.0, time));
    float n2 = noise(st * 5.0 - vec2(0.0, time * 1.5));
    float n3 = noise(st * 10.0 + vec2(0.0, time * 0.5));
    
    float aurora_shape = (n1 * 0.5 + n2 * 0.3 + n3 * 0.2);
    aurora_shape = pow(aurora_shape, 2.0);
    
    // Fade from bottom and top
    float fade = smoothstep(0.0, 0.4, vUv.y) * (1.0 - smoothstep(0.8, 1.0, vUv.y));
    aurora_shape *= fade;
    
    // Color gradient
    vec3 green = vec3(0.0, 1.0, 0.5);
    vec3 pink = vec3(1.0, 0.0, 0.5);
    vec3 aurora_color = mix(green, pink, vUv.y * 1.2);
    
    vec3 final_color = stars + aurora_color * aurora_shape * 0.5; // Reduced intensity

    gl_FragColor = vec4(final_color, 1.0);
  }
`;

const AuroraBackground: React.FC = () => {
    useEffect(() => {
        if (!window.THREE) return;

        const scene = new window.THREE.Scene();
        const camera = new window.THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        
        const renderer = new window.THREE.WebGLRenderer({ antialias: false, powerPreference: "low-power" });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(window.devicePixelRatio * 0.5); // Lower res for better perf
        
        // Style the canvas to be a fixed background
        renderer.domElement.style.position = 'fixed';
        renderer.domElement.style.top = '0';
        renderer.domElement.style.left = '0';
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';
        renderer.domElement.style.zIndex = '-1';
        renderer.domElement.style.pointerEvents = 'none';

        document.body.appendChild(renderer.domElement);

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
            if (document.body.contains(renderer.domElement)) {
                document.body.removeChild(renderer.domElement);
            }
            renderer.dispose();
            geometry.dispose();
            material.dispose();
        };
    }, []);

    // This component now renders nothing to the DOM, it only manages the canvas side-effect.
    return null; 
};

export default AuroraBackground;