/**
 * NEXUS 3D Cybernetic Holographic Core Engine
 * Rendered using Three.js with inner crystalline geodesic structure,
 * dual-layer particle accretion discs, chromatic cyan/violet color shifts,
 * and interactive magnetic cursor repulsion physics.
 */

(function init3DCyberneticCore() {
    const container = document.getElementById('hero-3d-container');
    if (!container) return;

    if (typeof THREE === 'undefined') {
        console.warn('[3D Core] Three.js not loaded');
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

    // 2. Inner Crystalline Geodesic Core Structure
    const crystalGroup = new THREE.Group();

    // Icosahedron Wireframe
    const icoGeo = new THREE.IcosahedronGeometry(0.85, 1);
    const wireframeGeo = new THREE.WireframeGeometry(icoGeo);
    const lineMat = new THREE.LineBasicMaterial({
        color: 0x8b5cf6,
        transparent: true,
        opacity: 0.45,
        linewidth: 1.5
    });
    const crystalLines = new THREE.LineSegments(wireframeGeo, lineMat);
    crystalGroup.add(crystalLines);

    // Inner Glowing Core Solid Node
    const coreNodeGeo = new THREE.IcosahedronGeometry(0.45, 2);
    const coreNodeMat = new THREE.MeshBasicMaterial({
        color: 0xc4b5fd,
        wireframe: true,
        transparent: true,
        opacity: 0.65
    });
    const coreNodeMesh = new THREE.Mesh(coreNodeGeo, coreNodeMat);
    crystalGroup.add(coreNodeMesh);

    scene.add(crystalGroup);

    // Inner Point Light for Glowing Ambient Radiation
    const pointLight = new THREE.PointLight(0xc4b5fd, 2.5, 10);
    scene.add(pointLight);

    // 3. Soft Glowing Circular Particle Texture
    function createParticleTexture() {
        const size = 64;
        const canvasMat = document.createElement('canvas');
        canvasMat.width = size;
        canvasMat.height = size;
        const ctx = canvasMat.getContext('2d');

        const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
        grad.addColorStop(0.2, 'rgba(224, 242, 254, 0.95)'); // Cyan tint
        grad.addColorStop(0.5, 'rgba(196, 181, 253, 0.5)');  // Lilac tint
        grad.addColorStop(1, 'rgba(139, 92, 246, 0.0)');   // Violet transparent

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);

        const texture = new THREE.Texture(canvasMat);
        texture.needsUpdate = true;
        return texture;
    }

    // 4. Particle System Setup — 18,000 Particles
    const PARTICLE_COUNT = 18000;
    const CORE_RADIUS = 1.35;
    const OUTER_RADIUS = 2.25;

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const currPos = new Float32Array(PARTICLE_COUNT * 3);
    const velocities = new Float32Array(PARTICLE_COUNT * 3);
    const colors = new Float32Array(PARTICLE_COUNT * 3);
    const baseColors = [];

    const particleMeta = [];

    // Tilted Orbital Accretion Rings (5 inclined planes)
    const rings = [
        { tiltX: 0.35, tiltZ: 0.45, speed: 0.52 },
        { tiltX: -0.55, tiltZ: 0.85, speed: -0.42 },
        { tiltX: 0.85, tiltZ: -0.35, speed: 0.58 },
        { tiltX: -0.25, tiltZ: -0.75, speed: -0.48 },
        { tiltX: 0.65, tiltZ: 0.65, speed: 0.38 }
    ];

    const colorWhite = new THREE.Color('#ffffff');
    const colorLilac = new THREE.Color('#c4b5fd');
    const colorViolet = new THREE.Color('#8b5cf6');
    const colorCyan = new THREE.Color('#38bdf8');

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const u = Math.random();
        const v = Math.random();
        const theta = u * 2.0 * Math.PI;
        const phi = Math.acos(2.0 * v - 1.0);
        const r = Math.pow(Math.random(), 0.7) * OUTER_RADIUS;

        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi);

        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;

        currPos[i * 3] = x;
        currPos[i * 3 + 1] = y;
        currPos[i * 3 + 2] = z;

        const isCore = r < CORE_RADIUS;
        const ringIndex = Math.floor(Math.random() * rings.length);

        let pColor;
        if (isCore) {
            pColor = Math.random() > 0.4 ? colorWhite : colorLilac;
        } else {
            const rand = Math.random();
            pColor = rand > 0.65 ? colorCyan : (rand > 0.35 ? colorLilac : (rand > 0.15 ? colorViolet : colorWhite));
        }

        colors[i * 3] = pColor.r;
        colors[i * 3 + 1] = pColor.g;
        colors[i * 3 + 2] = pColor.b;
        baseColors.push(pColor.clone());

        particleMeta.push({
            isCore,
            baseX: x,
            baseY: y,
            baseZ: z,
            r,
            theta,
            phi,
            ringIndex,
            orbitalRadius: r * (1.2 + Math.random() * 0.5),
            speed: (0.35 + Math.random() * 0.55) * (Math.random() > 0.5 ? 1 : -1),
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

    // Outer Subtle Accretion Halo Ring
    const haloGeo = new THREE.RingGeometry(CORE_RADIUS * 1.1, CORE_RADIUS * 1.14, 64);
    const haloMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending
    });
    const haloMesh = new THREE.Mesh(haloGeo, haloMat);
    haloMesh.rotation.x = Math.PI / 3;
    scene.add(haloMesh);

    // 5. Mouse Interaction & 3D Vector Raycasting for Magnetic Repulsion
    let mouseX = 0;
    let mouseY = 0;
    let targetRotX = 0;
    let targetRotY = 0;

    const mouse3D = new THREE.Vector3(999, 999, 0);
    const raycaster = new THREE.Raycaster();
    const mouse2D = new THREE.Vector2(-999, -999);
    const mousePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

    window.addEventListener('mousemove', (e) => {
        const halfX = window.innerWidth / 2;
        const halfY = window.innerHeight / 2;
        mouseX = (e.clientX - halfX) / halfX;
        mouseY = (e.clientY - halfY) / halfY;

        const rect = renderer.domElement.getBoundingClientRect();
        mouse2D.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse2D.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

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
