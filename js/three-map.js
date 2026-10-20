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
    this.scene.background = new THREE.Color(0x0a1820);
    this.scene.fog = new THREE.FogExp2(0x0a1820, 0.012);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 260);
    this.setCamera('isometric');

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvasHost.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 26;
    this.controls.maxDistance = 80;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.minPolarAngle = Math.PI * 0.18;
    this.controls.maxAzimuthAngle = Math.PI * 0.85;
    this.controls.minAzimuthAngle = -Math.PI * 0.85;
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
    if (mode === 'top') {
      this.camera.position.set(0, 68, 0.5);
    } else {
      this.camera.position.set(44, 36, 50);
    }
    this.camera.lookAt(0, 1, 0);
  }

  selectNeighborhood(id) {
    this.selectedNeighborhoodId = id;
    const select = this.container.querySelector('select');
    if (select) select.value = id;
  }

  addLighting() {
    const ambient = new THREE.HemisphereLight(0x7ab8e8, 0x1a3d28, 1.8);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xc8e8ff, 3.8);
    sun.position.set(30, 55, 22);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -55;
    sun.shadow.camera.right = 55;
    sun.shadow.camera.top = 55;
    sun.shadow.camera.bottom = -55;
    sun.shadow.bias = -0.001;
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0x3a6080, 0.7);
    fill.position.set(-20, 20, -15);
    this.scene.add(fill);
  }

  addTerrain() {
    const W = 72, D = 60, SW = 144, SD = 120;

    const riverX = z => 1.8 + Math.sin(z * 0.09) * 3.4 + Math.sin(z * 0.17) * 1.1;
    const riverHalfWidth = 4.0;

    const hillHeight = (x, z) => {
      const nw = Math.exp(-((x + 22) ** 2 + (z - 16) ** 2) / 90) * 4.2;
      const ne = Math.exp(-((x - 20) ** 2 + (z + 14) ** 2) / 120) * 2.8;
      const sw = Math.exp(-((x + 18) ** 2 + (z + 20) ** 2) / 100) * 3.1;
      const se = Math.exp(-((x - 22) ** 2 + (z - 18) ** 2) / 110) * 2.4;
      return nw + ne + sw + se;
    };

    const geometry = new THREE.PlaneGeometry(W, D, SW, SD);
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = -position.getY(i);
      const rx = riverX(z);
      const dist = Math.abs(x - rx);
      const channel = THREE.MathUtils.smoothstep(dist, riverHalfWidth - 0.4, riverHalfWidth + 0.8);
      const hill = hillHeight(x, z);
      const height = hill * channel - (1 - channel) * 0.6;
      position.setZ(i, height);
    }
    geometry.computeVertexNormals();

    const terrain = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color: 0x3a5e40,
      roughness: 0.92,
      metalness: 0.0,
    }));
    terrain.rotation.x = -Math.PI / 2;
    terrain.receiveShadow = true;
    this.scene.add(terrain);

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(W, 1.5, D),
      new THREE.MeshStandardMaterial({ color: 0x1e2e24, roughness: 1 })
    );
    base.position.y = -1.8;
    this.scene.add(base);

    const rim = [];
    for (let i = 0; i <= SW; i++) rim.push([-W / 2 + i * (W / SW), -D / 2]);
    for (let i = 1; i <= SD; i++) rim.push([W / 2, -D / 2 + i * (D / SD)]);
    for (let i = 1; i <= SW; i++) rim.push([W / 2 - i * (W / SW), D / 2]);
    for (let i = 1; i < SD; i++) rim.push([-W / 2, D / 2 - i * (D / SD)]);
    const skirtVerts = [];
    for (let i = 0; i < rim.length; i++) {
      const [x, z] = rim[i];
      const [nx, nz] = rim[(i + 1) % rim.length];
      const rx = riverX(z), nrx = riverX(nz);
      const ch = THREE.MathUtils.smoothstep(Math.abs(x - rx), riverHalfWidth - 0.4, riverHalfWidth + 0.8);
      const nch = THREE.MathUtils.smoothstep(Math.abs(nx - nrx), riverHalfWidth - 0.4, riverHalfWidth + 0.8);
      const h = hillHeight(x, z) * ch - (1 - ch) * 0.6;
      const nh = hillHeight(nx, nz) * nch - (1 - nch) * 0.6;
      skirtVerts.push(x, h, z, nx, nh, nz, x, -2.5, z, nx, nh, nz, nx, -2.5, nz, x, -2.5, z);
    }
    const skirtGeo = new THREE.BufferGeometry();
    skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(skirtVerts, 3));
    skirtGeo.computeVertexNormals();
    this.scene.add(new THREE.Mesh(skirtGeo, base.material));

    const riverSegments = 140;
    const riverVerts = [];
    const riverIdx = [];
    for (let i = 0; i <= riverSegments; i++) {
      const z = -D / 2 + i * (D / riverSegments);
      const cx = riverX(z);
      riverVerts.push(cx - riverHalfWidth, -0.15, z);
      riverVerts.push(cx + riverHalfWidth, -0.15, z);
      if (i < riverSegments) {
        const a = i * 2;
        riverIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const riverGeo = new THREE.BufferGeometry();
    riverGeo.setAttribute('position', new THREE.Float32BufferAttribute(riverVerts, 3));
    riverGeo.setIndex(riverIdx);
    riverGeo.computeVertexNormals();
    const river = new THREE.Mesh(riverGeo, new THREE.MeshStandardMaterial({
      color: 0x1a90c8,
      roughness: 0.18,
      metalness: 0.12,
    }));
    river.name = 'Riverton River';
    river.receiveShadow = true;
    this.scene.add(river);

    const floodGeo = new THREE.BufferGeometry();
    const floodVerts = [];
    const floodIdx = [];
    for (let i = 0; i <= riverSegments; i++) {
      const z = -D / 2 + i * (D / riverSegments);
      const cx = riverX(z);
      const halfW = riverHalfWidth + 3.5;
      floodVerts.push(cx - halfW, -0.05, z);
      floodVerts.push(cx + halfW, -0.05, z);
      if (i < riverSegments) {
        const a = i * 2;
        floodIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    floodGeo.setAttribute('position', new THREE.Float32BufferAttribute(floodVerts, 3));
    floodGeo.setIndex(floodIdx);
    floodGeo.computeVertexNormals();
    this.flood = new THREE.Mesh(floodGeo, new THREE.MeshStandardMaterial({
      color: 0x1aabef,
      transparent: true,
      opacity: 0.25,
      roughness: 0.22,
      metalness: 0.05,
      depthWrite: false,
    }));
    this.flood.renderOrder = 2;
    this.scene.add(this.flood);

    const riskGeo = new THREE.BufferGeometry();
    const riskVerts = [];
    const riskIdx = [];
    for (let i = 0; i <= riverSegments; i++) {
      const z = -D / 2 + i * (D / riverSegments);
      const cx = riverX(z);
      const halfW = riverHalfWidth + 7.5;
      riskVerts.push(cx - halfW, -0.02, z);
      riskVerts.push(cx + halfW, -0.02, z);
      if (i < riverSegments) {
        const a = i * 2;
        riskIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    riskGeo.setAttribute('position', new THREE.Float32BufferAttribute(riskVerts, 3));
    riskGeo.setIndex(riskIdx);
    riskGeo.computeVertexNormals();
    this.floodRisk = new THREE.Mesh(riskGeo, new THREE.MeshBasicMaterial({
      color: 0x5588bb,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    }));
    this.floodRisk.renderOrder = 1;
    this.scene.add(this.floodRisk);
  }

  addRoadsAndRoutes() {
    const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x1e2d3a, roughness: 0.88 });
    const road = (x, z, w, d, h = 0.18) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.07, d), roadMaterial);
      mesh.position.set(x, h, z);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    };

    road(0, 0, 64, 2.2);
    road(0, 0, 2.2, 54);
    road(-12, -12, 28, 1.6);
    road(14, 12, 1.6, 30);

    const routeMaterial = new THREE.LineDashedMaterial({
      color: 0x35dce8,
      dashSize: 1.2,
      gapSize: 0.7,
      linewidth: 1,
    });

    const routes = [
      [[-24, -18], [-16, -11], [-7, -4], [12, 8]],
      [[-19, 14], [-10, 8], [-2, 4], [12, 8]],
      [[22, -18], [14, -9], [6, -2], [1, 5]],
    ];
    routes.forEach(points => {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points.map(([x, z]) => new THREE.Vector3(x, 0.38, z))),
        routeMaterial
      );
      line.computeLineDistances();
      this.scene.add(line);
      this.agentPaths.push(points.map(([x, z]) => new THREE.Vector3(x, 0.62, z)));
    });
  }

  addMarkers() {
    const addBeacon = (x, z, color, height) => {
      const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.26, 0.46, height, 8),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.45, roughness: 0.5 })
      );
      beacon.position.set(x, height / 2 + 0.3, z);
      beacon.castShadow = true;
      this.scene.add(beacon);
    };

    [[12, 8], [-16, -11], [1, 5]].forEach(([x, z]) => addBeacon(x, z, 0x21d49b, 2.6));
    addBeacon(18, -5, 0xee554f, 3.4);

    this.addMapLabel('East Shelter', 12, 6.5, 8, '#21d49b');
    this.addMapLabel('North Shelter', -16, 6.5, -11, '#21d49b');
    this.addMapLabel('West Shelter', 1, 6.5, 5, '#21d49b');
    this.addMapLabel('Riverside Hospital', 18, 7.5, -5, '#ff7770');

    this.closures = [
      { x: 3.5, z: -1.5, hour: 4.2, name: 'Parkway closed' },
      { x: 0, z: -12, hour: 2.4, name: 'Bridge 3 closed' },
      { x: 14, z: 20, hour: 3.75, name: 'Canal bypass closed' },
    ].map(closure => {
      const group = new THREE.Group();
      const material = new THREE.MeshBasicMaterial({ color: 0xef4444 });
      for (const angle of [-Math.PI / 4, Math.PI / 4]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.18, 0.34), material);
        bar.rotation.y = angle;
        group.add(bar);
      }
      group.position.set(closure.x, 0.55, closure.z);
      this.scene.add(group);
      const label = this.addMapLabel(closure.name, closure.x, 3.2, closure.z, '#ff7770');
      return { ...closure, group, label };
    });
  }

  addMapLabel(text, x, y, z, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 80;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(10,22,32,0.88)';
    const rr = (cx, cy, cw, ch, r) => {
      ctx.beginPath();
      ctx.moveTo(cx + r, cy);
      ctx.lineTo(cx + cw - r, cy);
      ctx.quadraticCurveTo(cx + cw, cy, cx + cw, cy + r);
      ctx.lineTo(cx + cw, cy + ch - r);
      ctx.quadraticCurveTo(cx + cw, cy + ch, cx + cw - r, cy + ch);
      ctx.lineTo(cx + r, cy + ch);
      ctx.quadraticCurveTo(cx, cy + ch, cx, cy + ch - r);
      ctx.lineTo(cx, cy + r);
      ctx.quadraticCurveTo(cx, cy, cx + r, cy);
      ctx.closePath();
      ctx.fill();
    };
    rr(4, 8, 504, 64, 10);
    ctx.fillStyle = color;
    ctx.font = '600 28px "Prompt", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 42);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false }));
    sprite.position.set(x, y, z);
    sprite.scale.set(9, 1.4, 1);
    sprite.renderOrder = 5;
    this.scene.add(sprite);
    return sprite;
  }

  addAgents() {
    const geometry = new THREE.SphereGeometry(0.24, 8, 8);
    const material = new THREE.MeshStandardMaterial({
      color: 0xf7c84a,
      emissive: 0xb78710,
      emissiveIntensity: 0.4,
      roughness: 0.5,
    });
    for (let index = 0; index < 42; index++) {
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
        this.loadAsset(objLoader, 'office-tower.obj'),
        this.loadAsset(objLoader, 'apartment-building.obj'),
        this.loadAsset(objLoader, 'row-house.obj'),
        this.loadAsset(objLoader, 'hospital.obj'),
        this.loadAsset(objLoader, 'emergency-shelter.obj'),
        this.loadAsset(objLoader, 'bridge.obj'),
        this.loadAsset(objLoader, 'rescue-boat.obj'),
        this.loadAsset(objLoader, 'ambulance.obj'),
        this.loadAsset(objLoader, 'tree.obj'),
        this.loadAsset(objLoader, 'flood-barrier.obj'),
        this.loadAsset(objLoader, 'emergency-park.obj'),
      ]);
      const [office, apartment, rowhouse, hospital, shelter, bridge, boat, ambulance, tree, barrier, park] = assets;

      const place = (source, x, z, scale, rotation = 0, yOffset = 0) => {
        const copy = source.clone(true);
        copy.position.set(x, yOffset, z);
        copy.scale.setScalar(scale);
        copy.rotation.y = rotation;
        copy.traverse(node => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
        this.scene.add(copy);
        return copy;
      };

      place(office, -20, 14, 1.28, 0.1);
      place(apartment, -22, -14, 1.1, -0.3); place(apartment, -12, 17, 0.95, 0.2);
      place(rowhouse, -22, -2, 0.96, 0.02); place(rowhouse, 21, 15, 0.86, -0.42);
      place(hospital, 18, -5, 0.86, 0.22);
      place(shelter, 12, 8, 0.86, 0); place(shelter, -16, -11, 0.74, 0.6); place(shelter, 1, 5, 0.62, -0.2);
      place(bridge, 3.5, -1.5, 0.66, Math.PI / 2);
      place(boat, 7.5, 0.5, 0.84, Math.PI / 2);
      place(ambulance, 14, -8, 0.98, -0.1);
      place(barrier, 3, -8, 0.98, 0);
      place(park, -7, -20, 0.74, 0.12);

      const treePositions = [[-27, 9], [-14, 2], [-10, -20], [2, 20], [23, 5], [26, -11], [-3, 13], [8, -18], [24, -20], [18, 20]];
      treePositions.forEach(([x, z], i) => place(tree, x, z, 0.78 + (i % 3) * 0.09, i * 0.62));

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
    const spread = 0.7 + progress * 1.2;
    this.flood.scale.set(spread, 1, spread);
    this.flood.material.opacity = 0.18 + progress * 0.38;
    const futureSpread = 0.7 + Math.min(1, (state.currentTimeHours + 6) / 24) * 1.2;
    this.floodRisk.scale.set(futureSpread, 1, futureSpread);
    for (const closure of this.closures) {
      closure.group.visible = closure.label.visible = state.currentTimeHours >= closure.hour;
    }
    const label = this.container.querySelector('#map-3d-hour');
    if (label) label.textContent = `Hour ${state.currentTimeHours.toFixed(1)}`;
    this.simulationRunning = state.isRunning;
    this.simulationSpeed = state.speedMultiplier || 1;
  }

  bindControls() {
    this.container.querySelector('[data-action="reset"]')?.addEventListener('click', () => {
      this.setCamera('isometric');
      this.controls.target.set(0, 1, 0);
      this.controls.update();
    });
    this.container.querySelector('[data-action="top"]')?.addEventListener('click', () => {
      this.setCamera('top');
      this.controls.target.set(0, 1, 0);
      this.controls.update();
    });
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
