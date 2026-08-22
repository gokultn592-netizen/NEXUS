/**
 * NEXUS 3D Particle Sphere — Energy Core
 * Renders thousands of tiny glowing dots with a dense static core
 * and outer layers peeling away into rotating orbital rings.
 */

(function init3DParticleSphere() {
    const container = document.getElementById('hero-3d-container');
    if (!container) return;

    // Check if Three.js is loaded
    if (typeof THREE === 'undefined') {
        console.warn('[3D Particle Sphere] Three.js not loaded');
        return;
    }

    // 1. Scene, Camera, Renderer
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.z = 6.2;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    // Make canvas fill container
    const canvas = renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';

    // 2. Soft Glowing Circular Particle Texture
    function createParticleTexture() {
        const size = 64;
        const canvasMat = document.createElement('canvas');
        canvasMat.width = size;
        canvasMat.height = size;
        const ctx = canvasMat.getContext('2d');

        const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
        grad.addColorStop(0.25, 'rgba(235, 230, 255, 0.9)');
        grad.addColorStop(0.55, 'rgba(196, 181, 253, 0.4)');
        grad.addColorStop(1, 'rgba(139, 92, 246, 0.0)');

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);

        const texture = new THREE.Texture(canvasMat);
        texture.needsUpdate = true;
        return texture;
    }

    // 3. Particle System Setup
    const PARTICLE_COUNT = 14000;
    const CORE_RADIUS = 1.25;
    const OUTER_RADIUS = 2.1;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const colors = new Float32Array(PARTICLE_COUNT * 3);

    // Per-particle animation metadata
    const particleMeta = [];

    // Tilted Orbital Rings definitions (5 inclined orbital planes for outer peeling particles)
    const rings = [
        { tiltX: 0.3, tiltZ: 0.4, speed: 0.45 },
        { tiltX: -0.5, tiltZ: 0.8, speed: -0.38 },
        { tiltX: 0.8, tiltZ: -0.3, speed: 0.52 },
        { tiltX: -0.2, tiltZ: -0.7, speed: -0.42 },
        { tiltX: 0.6, tiltZ: 0.6, speed: 0.35 }
    ];

    // Palette: pure white, soft lilac, violet tint
    const colorWhite = new THREE.Color('#ffffff');
    const colorLilac = new THREE.Color('#c4b5fd');
    const colorViolet = new THREE.Color('#a78bfa');

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        // Uniform spherical random distribution
        const u = Math.random();
        const v = Math.random();
        const theta = u * 2.0 * Math.PI;
        const phi = Math.acos(2.0 * v - 1.0);
        
        // Distribution biased slightly towards core
        const r = Math.pow(Math.random(), 0.75) * OUTER_RADIUS;

        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi);

        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;

        const isCore = r < CORE_RADIUS;
        const ringIndex = Math.floor(Math.random() * rings.length);

        // Assign colors based on layer
        let pColor;
        if (isCore) {
            pColor = Math.random() > 0.3 ? colorWhite : colorLilac;
        } else {
            const rand = Math.random();
            pColor = rand > 0.6 ? colorLilac : (rand > 0.3 ? colorViolet : colorWhite);
        }

        colors[i * 3] = pColor.r;
        colors[i * 3 + 1] = pColor.g;
        colors[i * 3 + 2] = pColor.b;

        particleMeta.push({
            isCore,
            baseX: x,
            baseY: y,
            baseZ: z,
            r,
            theta,
            phi,
            ringIndex,
            orbitalRadius: r * (1.15 + Math.random() * 0.45),
            speed: (0.3 + Math.random() * 0.5) * (Math.random() > 0.5 ? 1 : -1),
            phase: Math.random() * Math.PI * 2,
            noiseOffset: Math.random() * 100
        });
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Particle Material
    const material = new THREE.PointsMaterial({
        size: 0.055,
        map: createParticleTexture(),
        vertexColors: true,
        transparent: true,
        opacity: 0.92,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    const particleSystem = new THREE.Points(geometry, material);
    scene.add(particleSystem);

    // Outer subtle energy halo ring
    const haloGeo = new THREE.RingGeometry(CORE_RADIUS * 1.05, CORE_RADIUS * 1.08, 64);
    const haloMat = new THREE.MeshBasicMaterial({
        color: 0x8b5cf6,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.15,
        blending: THREE.AdditiveBlending
    });
    const haloMesh = new THREE.Mesh(haloGeo, haloMat);
    haloMesh.rotation.x = Math.PI / 3;
    scene.add(haloMesh);

    // 4. Mouse Tracking for Parallax Tilt
    let mouseX = 0;
    let mouseY = 0;
    let targetRotationX = 0;
    let targetRotationY = 0;

    window.addEventListener('mousemove', (e) => {
        const halfX = window.innerWidth / 2;
        const halfY = window.innerHeight / 2;
        mouseX = (e.clientX - halfX) / halfX;
        mouseY = (e.clientY - halfY) / halfY;
    });

    // 5. Responsive Resize Handler
    function handleResize() {
        const width = container.clientWidth;
        const height = container.clientHeight || width;
        if (width === 0 || height === 0) return;

        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);

        // Adjust size responsively for smaller screens
        if (width < 480) {
            material.size = 0.042;
            camera.position.z = 7.0;
        } else {
            material.size = 0.055;
            camera.position.z = 6.2;
        }
    }

    const resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(container);
    handleResize();

    // 6. Animation Loop
    const clock = new THREE.Clock();

    function animate() {
        requestAnimationFrame(animate);

        const elapsedTime = clock.getElapsedTime();
        const posAttr = geometry.attributes.position;
        const posArray = posAttr.array;

        // Smooth Mouse Parallax
        targetRotationY = mouseX * 0.35;
        targetRotationX = mouseY * 0.25;

        particleSystem.rotation.y += 0.003 + (targetRotationY - particleSystem.rotation.y) * 0.02;
        particleSystem.rotation.x += (targetRotationX - particleSystem.rotation.x) * 0.02;
        particleSystem.rotation.z = Math.sin(elapsedTime * 0.2) * 0.1;

        haloMesh.rotation.z = elapsedTime * 0.15;

        // Update positions dynamically
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const meta = particleMeta[i];
            const idx = i * 3;

            if (meta.isCore) {
                // Dense Core: Stays clustered near center with high-density harmonic breathing
                const freq = 1.8;
                const amp = 0.025;
                posArray[idx]     = meta.baseX + Math.sin(elapsedTime * freq + meta.noiseOffset) * amp;
                posArray[idx + 1] = meta.baseY + Math.cos(elapsedTime * freq * 1.2 + meta.noiseOffset) * amp;
                posArray[idx + 2] = meta.baseZ + Math.sin(elapsedTime * freq * 0.8 + meta.noiseOffset) * amp;
            } else {
                // Outer Layers: Dynamically separate, peel away, and swirl into inclined rotating orbital rings
                const ring = rings[meta.ringIndex];
                
                // Continuous organic peeling wave cycle
                const peelWave = Math.sin(elapsedTime * 0.75 + meta.ringIndex * 1.25);
                const peelFactor = 0.35 + 0.65 * (0.5 + 0.5 * peelWave);

                // Current orbital angle
                const currentAngle = meta.phase + elapsedTime * ring.speed;
                const currentRadius = meta.r + (meta.orbitalRadius - meta.r) * peelFactor;

                // Position on un-tilted orbital plane
                let ox = currentRadius * Math.cos(currentAngle);
                let oy = currentRadius * Math.sin(currentAngle) * 0.3; // Slight ellipticity
                let oz = currentRadius * Math.sin(currentAngle);

                // Apply ring tilt rotations
                const cosX = Math.cos(ring.tiltX);
                const sinX = Math.sin(ring.tiltX);
                const cosZ = Math.cos(ring.tiltZ);
                const sinZ = Math.sin(ring.tiltZ);

                // X rotation
                let y1 = oy * cosX - oz * sinX;
                let z1 = oy * sinX + oz * cosX;

                // Z rotation
                let x2 = ox * cosZ - y1 * sinZ;
                let y2 = ox * sinZ + y1 * cosZ;

                // Smooth interpolation between base spherical position and orbital peeled position
                posArray[idx]     = meta.baseX * (1 - peelFactor) + x2 * peelFactor;
                posArray[idx + 1] = meta.baseY * (1 - peelFactor) + y2 * peelFactor;
                posArray[idx + 2] = meta.baseZ * (1 - peelFactor) + z1 * peelFactor;
            }
        }

        posAttr.needsUpdate = true;
        renderer.render(scene, camera);
    }

    animate();
})();
