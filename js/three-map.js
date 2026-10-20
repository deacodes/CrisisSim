import * as THREE from './vendor/three.module.js';
import { OBJLoader } from './vendor/OBJLoader.js';
import { MTLLoader } from './vendor/MTLLoader.js';
import { OrbitControls } from './vendor/OrbitControls.js';

const ASSET_ROOT = new URL('../assets/riverton-obj-assets/', import.meta.url).href;
const ASSET_VERSION = 'outward-faces-2';

export class RivertonThreeMap {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.options = {
      isCompact: false,
      showControls: true,
      showLegend: true,
      ...options
    };
    this.clock = new THREE.Clock();
    this.agentPaths = [];
    this.agents = [];
    this.loaded = false;
    this.raf = null;
    this.onResize = () => this.resize();
    if (this.container) this.init();
  }

  init() {
    const { isCompact, showControls, showLegend } = this.options;
    this.container.innerHTML = `
      <div class="map-3d-shell ${isCompact ? 'compact' : ''}" aria-label="Interactive three-dimensional Riverton flood simulation">
        ${showControls && !isCompact ? `
          <div class="map-3d-toolbar">
            <div class="map-3d-status"><span class="map-3d-status-dot"></span><strong>3D city simulation</strong><span id="map-3d-hour">Hour 08.6</span></div>
            <div class="map-3d-actions">
              <button type="button" class="map-3d-action" data-action="reset">Reset view</button>
              <button type="button" class="map-3d-action" data-action="top">Top view</button>
              <button type="button" class="map-3d-action" data-action="switch-to-2d">2D map</button>
            </div>
          </div>
        ` : ''}
        <div class="map-3d-canvas" id="map-3d-canvas"></div>
        ${showControls && !isCompact ? '<div class="map-3d-hint">Drag to orbit · scroll or pinch to zoom · right-drag to pan</div>' : ''}
        ${showLegend && !isCompact ? `<div class="map-3d-legend" aria-label="Operational legend">
          <span><i class="legend-dot flood"></i>Flooded area</span>
          <span><i class="legend-dot risk"></i>Flood risk (+6h)</span>
          <span><i class="legend-dot route"></i>Safe route</span>
          <span><i class="legend-dot closed"></i>Closed road / bridge</span>
          <span><i class="legend-dot resident"></i>Evacuating resident</span>
          <span><i class="legend-dot safe"></i>Active shelter</span>
          <span><i class="legend-dot hospital"></i>Hospital</span>
        </div>` : ''}
      </div>`;

    this.canvasHost = this.container.querySelector('#map-3d-canvas');
    if (this.options.onNeighborhoodClick) {
      const select = document.createElement('select');
      select.className = 'map-3d-action';
      select.setAttribute('aria-label', 'Inspect neighborhood');
      for (const neighborhood of window.CrisisData?.NEIGHBORHOODS || []) {
        select.add(new Option(neighborhood.name, neighborhood.id));
      }
      select.value = 'N5';
      select.addEventListener('change', () => {
        this.selectNeighborhood(select.value);
        this.options.onNeighborhoodClick(select.value);
      });
      this.container.querySelector('.map-3d-actions')?.prepend(select);
    }
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07111d);
    this.scene.fog = new THREE.Fog(0x07111d, 42, 105);

    this.camera = new THREE.PerspectiveCamera(43, 1, 0.1, 220);
    this.setCamera('isometric');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvasHost.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 28;
    this.controls.maxDistance = 76;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minPolarAngle = Math.PI * 0.19;
    this.controls.maxAzimuthAngle = Math.PI * 0.78;
    this.controls.minAzimuthAngle = -Math.PI * 0.78;
    this.controls.screenSpacePanning = true;

    this.addLighting();
    this.addTerrain();
    this.addRoadsAndRoutes();
    this.addMarkers();
    this.addAgents();
    this.loadCityAssets();
    this.bindControls();
    this.resize();
    this.resizeObserver = new ResizeObserver(this.onResize);
    this.resizeObserver.observe(this.container);
    window.addEventListener('resize', this.onResize);

    if (window.CrisisState?.simulation) {
      this.unsubscribe = window.CrisisState.simulation.subscribe(state => this.updateSimulationState(state));
      this.updateSimulationState(window.CrisisState.simulation.getState());
    }
    this.animate();
  }

  setCamera(mode) {
    if (mode === 'top') this.camera.position.set(0, 63, 0.5);
    else this.camera.position.set(42, 38, 47);
    this.camera.lookAt(0, 0, 0);
  }

  selectNeighborhood(id) {
    this.selectedNeighborhoodId = id;
    const select = this.container.querySelector('select');
    if (select) select.value = id;
  }

  addLighting() {
    this.scene.add(new THREE.HemisphereLight(0x84c9f5, 0x112d2a, 2.4));
    const sun = new THREE.DirectionalLight(0xd8f1ff, 3.2);
    sun.position.set(25, 46, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -50;
    sun.shadow.camera.right = 50;
    sun.shadow.camera.top = 50;
    sun.shadow.camera.bottom = -50;
    this.scene.add(sun);
  }

  addTerrain() {
    // Use the same channel profile for the land and water, so the river
    // sits below its banks rather than covering buildings with a flat sheet.
    const riverCenter = z => 5 + Math.sin(z * 0.12) * 2.2;
    const geometry = new THREE.PlaneGeometry(68, 58, 136, 116);
    const position = geometry.attributes.position;
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const z = -position.getY(index);
      const distance = Math.abs(x - riverCenter(z));
      const channel = 1 - THREE.MathUtils.smoothstep(distance, 2.5, 4.2);
      position.setZ(index, -1.2 * channel);
    }
    geometry.computeVertexNormals();
    const terrain = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x426452, roughness: 0.94, metalness: 0 }));
    terrain.rotation.x = -Math.PI / 2;
    terrain.receiveShadow = true;
    this.scene.add(terrain);

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(68, 1, 58),
      new THREE.MeshStandardMaterial({ color: 0x293a32, roughness: 1 })
    );
    base.position.y = -1.7;
    this.scene.add(base);
    // Close the terrain's outer edge down to the base, including the river
    // mouths where the perimeter is lower than the surrounding land.
    const rim = [];
    for (let i = 0; i <= 136; i++) rim.push([-34 + i * 0.5, -29]);
    for (let i = 1; i <= 116; i++) rim.push([34, -29 + i * 0.5]);
    for (let i = 1; i <= 136; i++) rim.push([34 - i * 0.5, 29]);
    for (let i = 1; i < 116; i++) rim.push([-34, 29 - i * 0.5]);
    const skirtVertices = [];
    for (let i = 0; i < rim.length; i++) {
      const [x, z] = rim[i];
      const [nx, nz] = rim[(i + 1) % rim.length];
      const height = -1.2 * (1 - THREE.MathUtils.smoothstep(Math.abs(x - riverCenter(z)), 2.5, 4.2));
      const nextHeight = -1.2 * (1 - THREE.MathUtils.smoothstep(Math.abs(nx - riverCenter(nz)), 2.5, 4.2));
      skirtVertices.push(x, height, z, nx, nextHeight, nz, x, -2.2, z,
        nx, nextHeight, nz, nx, -2.2, nz, x, -2.2, z);
    }
    const skirtGeometry = new THREE.BufferGeometry();
    skirtGeometry.setAttribute('position', new THREE.Float32BufferAttribute(skirtVertices, 3));
    skirtGeometry.computeVertexNormals();
    this.scene.add(new THREE.Mesh(skirtGeometry, base.material));

    const waterVertices = [];
    const waterIndices = [];
    for (let i = 0; i <= 116; i++) {
      const z = -29 + i * 0.5;
      const center = riverCenter(z);
      waterVertices.push(center - 3.8, -0.22, z, center + 3.8, -0.22, z);
      if (i < 116) {
        const a = i * 2;
        waterIndices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const waterGeometry = new THREE.BufferGeometry();
    waterGeometry.setAttribute('position', new THREE.Float32BufferAttribute(waterVertices, 3));
    waterGeometry.setIndex(waterIndices);
    waterGeometry.computeVertexNormals();
    const river = new THREE.Mesh(waterGeometry, new THREE.MeshStandardMaterial({
      color: 0x157fb0, roughness: 0.3, metalness: 0.1
    }));
    river.name = 'Riverton River';
    river.receiveShadow = true;
    this.scene.add(river);

    this.flood = new THREE.Mesh(new THREE.CircleGeometry(10, 48), new THREE.MeshStandardMaterial({ color: 0x0d9be7, transparent: true, opacity: 0.18, roughness: 0.25, metalness: 0.08, depthWrite: false }));
    this.flood.rotation.x = -Math.PI / 2;
    this.flood.position.set(8, 0.08, 5);
    this.scene.add(this.flood);
    this.floodRisk = new THREE.Mesh(new THREE.CircleGeometry(10, 48),
      new THREE.MeshBasicMaterial({ color: 0x769bc8, transparent: true, opacity: 0.22, depthWrite: false }));
    this.floodRisk.rotation.x = -Math.PI / 2;
    this.floodRisk.position.set(8, 0.065, 5);
    this.floodRisk.renderOrder = 1;
    this.flood.renderOrder = 2;
    this.scene.add(this.floodRisk);
  }

  addRoadsAndRoutes() {
    const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x293a47, roughness: 0.9 });
    const road = (x, z, w, d) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), roadMaterial);
      mesh.position.set(x, 0.13, z);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    };
    road(-4, 0, 60, 2.0);
    road(0, 0, 2.0, 52);
    road(-10, -11, 34, 1.4);
    road(13, 10, 1.4, 33);

    const routeMaterial = new THREE.LineDashedMaterial({ color: 0x45e0e7, dashSize: 1.1, gapSize: 0.62, linewidth: 1 });
    const routes = [
      [[-25, -16], [-15, -10], [-7, -3], [10, 9]],
      [[-18, 12], [-9, 7], [-1, 4], [10, 9]],
      [[20, -16], [13, -8], [6, -2], [0, 4]],
    ];
    routes.forEach(points => {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(([x, z]) => new THREE.Vector3(x, 0.28, z))), routeMaterial);
      line.computeLineDistances();
      this.scene.add(line);
      this.agentPaths.push(points.map(([x, z]) => new THREE.Vector3(x, 0.52, z)));
    });
  }

  addMarkers() {
    const addBeacon = (x, z, color, height) => {
      const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.48, height, 8), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, roughness: 0.5 }));
      beacon.position.set(x, height / 2 + 0.22, z);
      beacon.castShadow = true;
      this.scene.add(beacon);
    };
    [[10, 9], [-15, -10], [0, 4]].forEach(([x, z]) => addBeacon(x, z, 0x21d49b, 2.5));
    addBeacon(16, -4, 0xee554f, 3.2);
    this.addMapLabel('East Shelter', 10, 6, 9, '#21d49b');
    this.addMapLabel('North Shelter', -15, 6, -10, '#21d49b');
    this.addMapLabel('West Shelter', 0, 6, 4, '#21d49b');
    this.addMapLabel('Riverside Hospital', 16, 7, -4, '#ff7770');
    this.closures = [
      { x: 3.2, z: -2, hour: 4.2, name: 'Bridge 3 closed' },
      { x: 0, z: -11, hour: 2.4, name: 'Parkway closed' },
      { x: 13, z: 18, hour: 3.75, name: 'Canal bypass closed' }
    ].map(closure => {
      const group = new THREE.Group();
      const material = new THREE.MeshBasicMaterial({ color: 0xef4444 });
      for (const angle of [-Math.PI / 4, Math.PI / 4]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.16, 0.3), material);
        bar.rotation.y = angle;
        group.add(bar);
      }
      group.position.set(closure.x, 0.4, closure.z);
      this.scene.add(group);
      const label = this.addMapLabel(closure.name, closure.x, 3, closure.z, '#ff7770');
      return { ...closure, group, label };
    });
  }

  addMapLabel(text, x, y, z, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 80;
    const context = canvas.getContext('2d');
    context.fillStyle = '#101820';
    context.fillRect(0, 0, 512, 80);
    context.fillStyle = color;
    context.font = '600 30px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, 256, 40);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false }));
    sprite.position.set(x, y, z);
    sprite.scale.set(8, 1.25, 1);
    sprite.renderOrder = 5;
    this.scene.add(sprite);
    return sprite;
  }

  addAgents() {
    const geometry = new THREE.SphereGeometry(0.22, 8, 8);
    const material = new THREE.MeshStandardMaterial({ color: 0xf7c84a, emissive: 0xb78710, emissiveIntensity: 0.35, roughness: 0.5 });
    for (let index = 0; index < 42; index += 1) {
      const agent = new THREE.Mesh(geometry, material);
      agent.castShadow = true;
      const state = { mesh: agent, path: index % 3, progress: (index * 0.113) % 1, speed: 0.028 + (index % 6) * 0.004 };
      this.setAgentPosition(state);
      this.agents.push(state);
      this.scene.add(agent);
    }
  }

  async loadCityAssets() {
    const mtlLoader = new MTLLoader();
    const objLoader = new OBJLoader();
    try {
      const materials = await mtlLoader.loadAsync(`${ASSET_ROOT}riverton.mtl`);
      materials.preload();
      objLoader.setMaterials(materials);
      const assets = await Promise.all([
        this.loadAsset(objLoader, 'office-tower.obj'), this.loadAsset(objLoader, 'apartment-building.obj'), this.loadAsset(objLoader, 'row-house.obj'),
        this.loadAsset(objLoader, 'hospital.obj'), this.loadAsset(objLoader, 'emergency-shelter.obj'), this.loadAsset(objLoader, 'bridge.obj'),
        this.loadAsset(objLoader, 'rescue-boat.obj'), this.loadAsset(objLoader, 'ambulance.obj'), this.loadAsset(objLoader, 'tree.obj'),
        this.loadAsset(objLoader, 'flood-barrier.obj'), this.loadAsset(objLoader, 'emergency-park.obj'),
      ]);
      const [office, apartment, rowhouse, hospital, shelter, bridge, boat, ambulance, tree, barrier, park] = assets;
      const place = (source, x, z, scale, rotation = 0) => {
        const copy = source.clone(true);
        copy.position.set(x, 0.2, z);
        copy.scale.setScalar(scale);
        copy.rotation.y = rotation;
        copy.traverse(node => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
        this.scene.add(copy);
        return copy;
      };
      place(office, -17, 11, 1.22, 0.1);
      place(apartment, -20, -13, 1.05, -0.3); place(apartment, -10, 15, 0.9, 0.2);
      place(rowhouse, -19, -2, 0.92, 0.02); place(rowhouse, 19, 13, 0.82, -0.42);
      place(hospital, 16, -4, 0.82, 0.22);
      place(shelter, 10, 9, 0.83, 0); place(shelter, -15, -10, 0.7, 0.6); place(shelter, 0, 4, 0.58, -0.2);
      place(bridge, 3.2, -2, 0.62, Math.PI / 2); place(boat, 7.7, 0, 0.8, Math.PI / 2);
      place(ambulance, 13, -7, 0.95, -0.1); place(barrier, 3, -7, 0.95, 0); place(park, -6, -18, 0.7, 0.12);
      [[-25,8],[-13,1],[-9,-18],[2,18],[21,4],[25,-10],[-2,12],[7,-17]].forEach(([x,z], index) => place(tree, x, z, 0.75 + (index % 3) * 0.08, index * 0.6));
      this.loaded = true;
      const status = this.container.querySelector('.map-3d-status strong');
      if (status) status.textContent = '3D city simulation · assets loaded';
    } catch (error) {
      const status = this.container.querySelector('.map-3d-status strong');
      if (status) status.textContent = '3D city simulation · models unavailable';
      console.warn('Riverton models could not load:', error);
    }
  }

  loadAsset(loader, name) { return loader.loadAsync(`${ASSET_ROOT}${name}?v=${ASSET_VERSION}`); }

  setAgentPosition(agent) {
    const path = this.agentPaths[agent.path];
    const scaled = agent.progress * (path.length - 1);
    const index = Math.min(path.length - 2, Math.floor(scaled));
    agent.mesh.position.lerpVectors(path[index], path[index + 1], scaled - index);
  }

  updateSimulationState(state) {
    if (!state || !this.flood) return;
    const progress = Math.max(0, Math.min(1, state.currentTimeHours / 24));
    const spread = 0.62 + progress * 1.1;
    this.flood.scale.set(spread * 1.28, spread, 1);
    this.flood.material.opacity = 0.13 + progress * 0.34;
    const futureSpread = 0.62 + Math.min(1, (state.currentTimeHours + 6) / 24) * 1.1;
    this.floodRisk.scale.set(futureSpread * 1.28, futureSpread, 1);
    for (const closure of this.closures) {
      closure.group.visible = closure.label.visible = state.currentTimeHours >= closure.hour;
    }
    const label = this.container.querySelector('#map-3d-hour');
    if (label) label.textContent = `Hour ${state.currentTimeHours.toFixed(1)}`;
    this.simulationRunning = state.isRunning;
    this.simulationSpeed = state.speedMultiplier || 1;
  }

  bindControls() {
    this.container.querySelector('[data-action="reset"]')?.addEventListener('click', () => { this.setCamera('isometric'); this.controls.target.set(0, 0, 0); this.controls.update(); });
    this.container.querySelector('[data-action="top"]')?.addEventListener('click', () => { this.setCamera('top'); this.controls.target.set(0, 0, 0); this.controls.update(); });
    this.container.querySelector('[data-action="switch-to-2d"]')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('crisissim-map-mode-change', { detail: { mode: '2d' } }));
    });
  }

  animate() {
    const delta = Math.min(this.clock.getDelta(), 0.05);
    if (this.simulationRunning && !document.documentElement.classList.contains('reduced-motion')) {
      this.agents.forEach(agent => {
        agent.progress = (agent.progress + delta * agent.speed * (this.simulationSpeed || 1)) % 1;
        this.setAgentPosition(agent);
      });
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(() => this.animate());
  }

  resize() {
    if (!this.canvasHost) return;
    const { width, height } = this.canvasHost.getBoundingClientRect();
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.onResize);
    if (this.unsubscribe) this.unsubscribe();
    this.controls?.dispose();
    this.renderer?.dispose();
  }
}

window.RivertonThreeMap = RivertonThreeMap;
window.dispatchEvent(new Event('crisis-three-ready'));
