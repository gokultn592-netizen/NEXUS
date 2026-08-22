/**
 * NEXUS Cybernetic Holographic 3D Core Upgrade
 * - Inner glowing 3D geodesic wireframe crystal
 * - 18,000+ particle dual counter-rotating accretion discs
 * - Dynamic chromatic violet / neon cyan color transitions
 * - Interactive magnetic cursor repulsion & spring physics
 */

(function initCybernetic3DCore() {
    const container = document.getElementById('hero-3d-container');
    if (!container) return;

    if (typeof THREE === 'undefined') {
        console.warn('[Cybernetic 3D Core] Three.js not loaded');
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
        grad.addColorStop(0.2, 'rgba(240, 235, 255, 0.95)');
        grad.addColorStop(0.5, 'rgba(56, 189, 248, 0.45)');
        grad.addColorStop(0.8, 'rgba(139, 92, 246, 0.2)');
        grad.addColorStop(1, 'rgba(139, 92, 246, 0.0)');

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);

        const texture = new THREE.Texture(canvasMat);
        texture.needsUpdate = true;
        return texture;
    }

    // 3. Inner Geodesic Crystalline Wireframe Core
    const crystalGroup = new THREE.Group();

    // Primary Geodesic Icosahedron Wireframe
    const icosaGeo = new THREE.IcosahedronGeometry(0.9, 2);
    const wireframeGeo = new THREE.WireframeGeometry(icosaGeo);
    const crystalMat = new THREE.LineBasicMaterial({
        color: 0x8b5cf6,
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending
    });
    const crystalMesh = new THREE.LineSegments(wireframeGeo, crystalMat);
    crystalGroup.add(crystalMesh);

    // Inner Concentric Dodecahedron Crystal
    const innerDodecaGeo = new THREE.DodecahedronGeometry(0.55, 1);
    const innerWireframeGeo = new THREE.WireframeGeometry(innerDodecaGeo);
    const innerCrystalMat = new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending
    });
    const innerCrystalMesh = new THREE.LineSegments(innerWireframeGeo, innerCrystalMat);
    crystalGroup.add(innerCrystalMesh);

    // Core Point Light
    const coreLight = new THREE.PointLight(0x8b5cf6, 2.5, 10);
    crystalGroup.add(coreLight);

    scene.add(crystalGroup);

    // 4. 18,000 Particle Dual Accretion System
    const PARTICLE_COUNT = 18000;
    const CORE_RADIUS = 1.2;
    const OUTER_RADIUS = 2.4;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const currPos = new Float32Array(PARTICLE_COUNT * 3);
    const velocities = new Float32Array(PARTICLE_COUNT * 3);
    const colors = new Float32Array(PARTICLE_COUNT * 3);
    const baseColors = [];

    const particleMeta = [];

    // Dual counter-rotating inclination rings
    const rings = [
        { tiltX: 0.35, tiltZ: 0.45, speed: 0.55, dir: 1 },
        { tiltX: -0.55, tiltZ: 0.75, speed: 0.48, dir: -1 },
        { tiltX: 0.85, tiltZ: -0.35, speed: 0.62, dir: 1 },
        { tiltX: -0.35, tiltZ: -0.75, speed: 0.52, dir: -1 },
        { tiltX: 0.65, tiltZ: 0.65, speed: 0.42, dir: 1 }
    ];

    // Color Palette: Pure White, Soft Lilac, Electric Violet, Neon Cyan
    const palette = [
        new THREE.Color('#ffffff'),
        new THREE.Color('#c4b5fd'),
        new THREE.Color('#8b5cf6'),
        new THREE.Color('#38bdf8')
    ];

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const u = Math.random();
        const v = Math.random();
        const theta = u * 2.0 * Math.PI;
        const phi = Math.acos(2.0 * v - 1.0);
        
        const r = Math.pow(Math.random(), 0.8) * OUTER_RADIUS;

        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi);

        positions[i * 3]     = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;

        currPos[i * 3]     = x;
        currPos[i * 3 + 1] = y;
        currPos[i * 3 + 2] = z;

        const isCore = r < CORE_RADIUS;
        const ringIndex = Math.floor(Math.random() * rings.length);

        const colIndex = isCore ? (Math.random() > 0.4 ? 0 : 1) : Math.floor(Math.random() * palette.length);
        const pColor = palette[colIndex].clone();

        colors[i * 3]     = pColor.r;
        colors[i * 3 + 1] = pColor.g;
        colors[i * 3 + 2] = pColor.b;

        baseColors.push({ r: pColor.r, g: pColor.g, b: pColor.b, hsl: pColor.getHSL({}) });

        particleMeta.push({
            isCore,
            baseX: x,
            baseY: y,
            baseZ: z,
            r,
            ringIndex,
            orbitalRadius: r * (1.18 + Math.random() * 0.5),
            speed: rings[ringIndex].speed * rings[ringIndex].dir * (0.8 + Math.random() * 0.4),
            phase: Math.random() * Math.PI * 2,
            noiseOffset: Math.random() * 100
        });
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(currPos, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const particleMaterial = new THREE.PointsMaterial({
        size: 0.052,
        map: createParticleTexture(),
        vertexColors: true,
        transparent: true,
        opacity: 0.94,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    const particleSystem = new THREE.Points(geometry, particleMaterial);
    scene.add(particleSystem);

    // Outer Energy Halo
    const haloGeo = new THREE.RingGeometry(CORE_RADIUS * 1.1, CORE_RADIUS * 1.14, 64);
    const haloMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending
    });
    const haloMesh = new THREE.Mesh(haloGeo, haloMat);
    haloMesh.rotation.x = Math.PI / 3;
    scene.add(haloMesh);

    // 5. Interactive Magnetic Mouse Repulsion Physics
    let mouseX = 0;
    let mouseY = 0;
    let targetRotX = 0;
    let targetRotY = 0;

    const mouse3D = new THREE.Vector3(999, 999, 0);
    const raycaster = new THREE.Raycaster();
    const mousePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

    window.addEventListener('mousemove', (e) => {
        const halfX = window.innerWidth / 2;
        const halfY = window.innerHeight / 2;
        mouseX = (e.clientX - halfX) / halfX;
        mouseY = (e.clientY - halfY) / halfY;

        // Convert mouse to 3D world space plane
        const mouse2D = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
        raycaster.setFromCamera(mouse2D, camera);
        raycaster.ray.intersectPlane(mousePlane, mouse3D);
    });

    // 6. Responsive Handling
    function handleResize() {
        const width = container.clientWidth;
        const height = container.clientHeight || width;
        if (width === 0 || height === 0) return;

        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);

        if (width < 480) {
            particleMaterial.size = 0.040;
            camera.position.z = 7.0;
        } else {
            particleMaterial.size = 0.052;
            camera.position.z = 6.2;
        }
    }

    const resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(container);
    handleResize();

    // 7. Animation & Physics Loop
    const clock = new THREE.Clock();

    function animate() {
        requestAnimationFrame(animate);

        const elapsedTime = clock.getElapsedTime();
        const posAttr = geometry.attributes.position;
        const colAttr = geometry.attributes.color;
        const posArr = posAttr.array;
        const colArr = colAttr.array;

        // Smooth Mouse Parallax Rotation
        targetRotY = mouseX * 0.42;
        targetRotX = mouseY * 0.30;

        particleSystem.rotation.y += 0.0035 + (targetRotY - particleSystem.rotation.y) * 0.025;
        particleSystem.rotation.x += (targetRotX - particleSystem.rotation.x) * 0.025;
        particleSystem.rotation.z = Math.sin(elapsedTime * 0.25) * 0.12;

        crystalGroup.rotation.y -= 0.006;
        crystalGroup.rotation.x = Math.sin(elapsedTime * 0.5) * 0.2;
        crystalGroup.rotation.z = Math.cos(elapsedTime * 0.4) * 0.2;

        // Crystal breathing scale pulse
        const crystalScale = 1.0 + Math.sin(elapsedTime * 2.0) * 0.06;
        crystalGroup.scale.set(crystalScale, crystalScale, crystalScale);

        haloMesh.rotation.z = elapsedTime * 0.22;

        // Chromatic Violet/Cyan Color Pulse
        const colorPulse = (Math.sin(elapsedTime * 0.8) + 1) / 2;

        // Update Particles & Physics
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const meta = particleMeta[i];
            const idx = i * 3;

            // Ideal orbital position target
            let targetX, targetY, targetZ;

            if (meta.isCore) {
                // Dense Core Vibration
                const freq = 2.0;
                const amp = 0.03;
                targetX = meta.baseX + Math.sin(elapsedTime * freq + meta.noiseOffset) * amp;
                targetY = meta.baseY + Math.cos(elapsedTime * freq * 1.2 + meta.noiseOffset) * amp;
                targetZ = meta.baseZ + Math.sin(elapsedTime * freq * 0.8 + meta.noiseOffset) * amp;
            } else {
                // Dual Accretion Rings Swirl
                const ring = rings[meta.ringIndex];
                const peelWave = Math.sin(elapsedTime * 0.85 + meta.ringIndex * 1.3);
                const peelFactor = 0.4 + 0.6 * (0.5 + 0.5 * peelWave);

                const currentAngle = meta.phase + elapsedTime * meta.speed;
                const currentRadius = meta.r + (meta.orbitalRadius - meta.r) * peelFactor;

                let ox = currentRadius * Math.cos(currentAngle);
                let oy = currentRadius * Math.sin(currentAngle) * 0.28;
                let oz = currentRadius * Math.sin(currentAngle);

                const cosX = Math.cos(ring.tiltX);
                const sinX = Math.sin(ring.tiltX);
                const cosZ = Math.cos(ring.tiltZ);
                const sinZ = Math.sin(ring.tiltZ);

                let y1 = oy * cosX - oz * sinX;
                let z1 = oy * sinX + oz * cosX;
                let x2 = ox * cosZ - y1 * sinZ;
                let y2 = ox * sinZ + y1 * cosZ;

                targetX = meta.baseX * (1 - peelFactor) + x2 * peelFactor;
                targetY = meta.baseY * (1 - peelFactor) + y2 * peelFactor;
                targetZ = meta.baseZ * (1 - peelFactor) + z1 * peelFactor;
            }

            // Magnetic Mouse Repulsion Physics
            const px = currPos[idx];
            const py = currPos[idx + 1];
            const pz = currPos[idx + 2];

            const dx = px - mouse3D.x;
            const dy = py - mouse3D.y;
            const dz = pz - mouse3D.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            const REPEL_RADIUS = 1.6;
            if (dist < REPEL_RADIUS && dist > 0.001) {
                const force = ((REPEL_RADIUS - dist) / REPEL_RADIUS) * 0.22;
                velocities[idx]     += (dx / dist) * force;
                velocities[idx + 1] += (dy / dist) * force;
                velocities[idx + 2] += (dz / dist) * force;
            }

            // Spring return force towards ideal target
            velocities[idx]     += (targetX - px) * 0.08;
            velocities[idx + 1] += (targetY - py) * 0.08;
            velocities[idx + 2] += (targetZ - pz) * 0.08;

            // Velocity damping
            velocities[idx]     *= 0.86;
            velocities[idx + 1] *= 0.86;
            velocities[idx + 2] *= 0.86;

            // Apply velocity to position
            currPos[idx]     += velocities[idx];
            currPos[idx + 1] += velocities[idx + 1];
            currPos[idx + 2] += velocities[idx + 2];

            // Chromatic color shift over time
            const baseCol = baseColors[i];
            colArr[idx]     = baseCol.r * (1 - colorPulse * 0.25);
            colArr[idx + 1] = baseCol.g * (1 + colorPulse * 0.2);
            colArr[idx + 2] = baseCol.b * (1 + colorPulse * 0.15);
        }

        posAttr.needsUpdate = true;
        colAttr.needsUpdate = true;
        renderer.render(scene, camera);
    }

    animate();
})();
