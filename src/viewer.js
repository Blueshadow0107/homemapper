import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import catalog from '../assets/furniture/catalog.json';
import { buildFurniture } from './furniture.js';
const ITEMS = new Map(catalog.items.map((i) => [i.id, i]));

// Plan coords are [x, z] metres (z down the plan) -> world [x, y, -z]. See docs/data-contract.md.
const toWorld = ([x, z], y = 0) => new THREE.Vector3(x, y, -z);

// RSSI -> colour. -90 (bad) .. -40 (great). Shared by pins, heatmap and legend.
export const range = { lo: -90, hi: -40 }; // auto-fitted to the current field by setField
export function rssiColor(dbm) {
  const t = Math.min(1, Math.max(0, (dbm - range.lo) / (range.hi - range.lo)));
  const stops = [
    [0.0, [180, 40, 70]],
    [0.35, [230, 140, 60]],
    [0.65, [235, 215, 90]],
    [1.0, [70, 190, 130]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const k = (t - t0) / (t1 - t0);
      return c0.map((v, j) => Math.round(v + (c1[j] - v) * k));
    }
  }
  return stops[3][1];
}
export const TEMP_RANGE = { lo: 6, hi: 24 }; // fixed so scenarios stay comparable
export function tempColor(c) {
  const t = Math.min(1, Math.max(0, (c - TEMP_RANGE.lo) / (TEMP_RANGE.hi - TEMP_RANGE.lo)));
  const stops = [[0, [70, 110, 220]], [0.5, [236, 232, 240]], [1, [232, 110, 60]]];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const k = (t - t0) / (t1 - t0);
      return c0.map((v, j) => Math.round(v + (c1[j] - v) * k));
    }
  }
  return stops[2][1];
}
const css = (rgb, a = 1) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;

function labelSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 48;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(34,26,52,0.88)';
  g.beginPath();
  g.roundRect(2, 2, 124, 44, 12);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = 3;
  g.stroke();
  g.fillStyle = '#fff';
  g.font = '600 24px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 25);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(0.85, 0.32, 1);
  s.renderOrder = 10;
  return s;
}

export function createViewer({ mount, floorplan: initial }) {
  let floorplan = initial;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f4f2fa');

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  mount.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 4;
  controls.maxDistance = 28;

  scene.add(new THREE.HemisphereLight('#ffffff', '#c5bdd8', 2.2));
  const key = new THREE.DirectionalLight('#ffffff', 3.1);
  key.position.set(-5, 12, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);

  // ---- bounds / camera presets (recomputed by setFloorplan; `bounds` object identity is stable)
  const bounds = { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };
  let width = 1;
  let depth = 1;
  let center = new THREE.Vector3();
  function computeBounds() {
    const pts = floorplan.rooms.flatMap((r) => r.polygon);
    Object.assign(bounds, {
      minX: Math.min(...pts.map((p) => p[0])),
      maxX: Math.max(...pts.map((p) => p[0])),
      minZ: Math.min(...pts.map((p) => p[1])),
      maxZ: Math.max(...pts.map((p) => p[1])),
    });
    width = bounds.maxX - bounds.minX;
    depth = bounds.maxZ - bounds.minZ;
    center = toWorld([(bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2]);
  }

  function view(kind) {
    controls.target.copy(center);
    if (kind === 'top') camera.position.set(center.x, Math.max(width, depth) * 1.7, center.z + 0.001);
    else camera.position.set(center.x + width * 0.85, 9, center.z + depth * 1.05);
    controls.update();
  }

  // ---- ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ color: '#eeeaf5', roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.18;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(30, 30, '#d4cfdf', '#e2deea');
  grid.position.y = -0.17;
  scene.add(grid);

  // ---- shell (rebuilt on every plan edit)
  const shell = new THREE.Group();
  scene.add(shell);
  let floors = [];
  let wallMeshes = [];
  let wallH = 2.7;
  let wallModeCur = 'full';

  function disposeShell() {
    for (const o of [...shell.children]) {
      o.traverse((n) => {
        n.geometry?.dispose();
        n.material?.dispose();
      });
      shell.remove(o);
    }
  }

  function buildShell() {
    disposeShell();
    floors = [];
    wallMeshes = [];
    wallH = floorplan.ceiling_height_m ?? 2.7;
    for (const room of floorplan.rooms) {
      const shape = new THREE.Shape();
      room.polygon.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, z) : shape.lineTo(x, z)));
      shape.closePath();
      // Shape lives in (x, plan-z); rotating -PI/2 about x lands plan-z on world -z.
      const floor = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        new THREE.MeshStandardMaterial({ color: room.color || '#ddd', roughness: 0.83, side: THREE.DoubleSide }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.02;
      floor.receiveShadow = true;
      floor.userData.roomId = room.id;
      floor.userData.baseColor = room.color || '#ddd';
      floor.userData.centroid = [room.polygon.reduce((a, p) => a + p[0], 0) / room.polygon.length, room.polygon.reduce((a, p) => a + p[1], 0) / room.polygon.length];
      shell.add(floor);
      floors.push(floor);
    }
    for (const wall of floorplan.walls) {
      const start = toWorld(wall.a);
      const end = toWorld(wall.b);
      const delta = end.clone().sub(start);
      if (delta.length() < 1e-6) continue;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(delta.length(), wallH, wall.thickness_m),
        new THREE.MeshStandardMaterial({
          color: (wall.exposure ?? wall.type) === 'exterior' ? '#756c86' : '#9a91aa',
          roughness: 0.78,
        }),
      );
      mesh.position.copy(start).add(end).multiplyScalar(0.5);
      mesh.position.y = wallH / 2;
      mesh.rotation.y = -Math.atan2(delta.z, delta.x);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      shell.add(mesh);
      wallMeshes.push(mesh);
    }
    for (const f of floorplan.furniture ?? []) {
      const item = ITEMS.get(f.type);
      if (!item) continue; // unknown type in an imported plan: skip rather than crash
      const g = buildFurniture(item);
      g.position.copy(toWorld(f.position_m, 0));
      g.rotation.y = THREE.MathUtils.degToRad(f.rotation_deg || 0); // plan-clockwise == +rotation.y (plan z = -world z)
      shell.add(g);
    }
    setWallMode(wallModeCur);
    applyHeat();
  }

  function setWallMode(mode) {
    // 'full' | 'low' (cutaway: 0.4 m stubs so the interior and heatmap stay visible)
    wallModeCur = mode;
    const h = mode === 'low' ? 0.4 : wallH;
    for (const m of wallMeshes) {
      m.scale.y = h / wallH;
      m.position.y = h / 2;
    }
  }

  /** Swap in a new plan. `refit` re-centres the camera (use on import/scale, not on every drag). */
  function setFloorplan(fp, { refit = false } = {}) {
    floorplan = fp;
    computeBounds();
    buildShell();
    if (refit) view('3d');
  }

  // ---- heating layer: room tint + labels + heater markers (values come from thermal-model, never computed here)
  let layer = 'wifi';
  let roomTemps = null; // {room_id: °C}
  const heatGroup = new THREE.Group();
  scene.add(heatGroup);
  const heaterGroup = new THREE.Group();
  scene.add(heaterGroup);

  function applyHeat() {
    heatGroup.clear();
    const heat = layer === 'heat';
    const cfd = layer === 'cfd';
    for (const f of floors) {
      const t = heat && roomTemps ? roomTemps[f.userData.roomId] : undefined;
      if (t === undefined) f.material.color.set(f.userData.baseColor);
      else {
        const rgb = tempColor(t);
        f.material.color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
        const lab = labelSprite(`${t.toFixed(1)}°C`, css(rgb));
        lab.scale.set(1.1, 0.4, 1);
        lab.position.copy(toWorld(f.userData.centroid, 0.5));
        heatGroup.add(lab);
      }
    }
    heaterGroup.visible = heat || cfd;
    if (fieldMesh) fieldMesh.visible = !heat && !cfd;
    router.visible = !heat && !cfd && routerSet;
    samplesGroup.visible = !heat && !cfd;
  }
  function setLayer(l) {
    layer = l;
    applyHeat();
  }
  function setRoomTemps(map) {
    roomTemps = map;
    applyHeat();
  }
  function setHeaters(list = []) {
    // The radiator itself is furniture (drawn with the shell); here only the wattage tag floats above it.
    heaterGroup.clear();
    for (const hh of list) {
      const lab = labelSprite(`${hh.watts} W`, '#e8693c');
      lab.position.copy(toWorld(hh.position_m, 1.0));
      heaterGroup.add(lab);
    }
  }

  // ---- overlays
  const samplesGroup = new THREE.Group();
  scene.add(samplesGroup);
  let fieldMesh = null;
  const FIELD_Y = 1.0;

  function setSamples(samples = []) {
    samplesGroup.clear();
    for (const s of samples) {
      const rgb = rssiColor(s.rssi_dbm);
      const col = css(rgb);
      const pin = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 20, 14),
        new THREE.MeshStandardMaterial({ color: `rgb(${rgb.join(',')})`, emissive: `rgb(${rgb.join(',')})`, emissiveIntensity: 0.35 }),
      );
      pin.position.copy(toWorld(s.position_m, FIELD_Y + 0.05));
      pin.castShadow = true;
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.015, FIELD_Y, 6),
        new THREE.MeshBasicMaterial({ color: '#5a4d73' }),
      );
      stem.position.copy(toWorld(s.position_m, FIELD_Y / 2));
      const label = labelSprite(`${Math.round(s.rssi_dbm)}${s.source === 'manual' ? '*' : ''}`, col);
      label.position.copy(toWorld(s.position_m, FIELD_Y + 0.42));
      samplesGroup.add(stem, pin, label);
    }
  }

  function setField(field) {
    if (fieldMesh) {
      scene.remove(fieldMesh);
      fieldMesh.material.map.dispose();
      fieldMesh.geometry.dispose();
      fieldMesh = null;
    }
    const cells = field?.cells;
    if (!cells?.length) return range;
    const vals = cells.map((c) => c.estimated_rssi_dbm);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = Math.max(0, 15 - (hi - lo)) / 2; // never stretch noise: keep >=15 dB span
    range.lo = Math.floor(lo - pad);
    range.hi = Math.ceil(hi + pad);
    const cs = field.cell_size_m;
    const xs = cells.map((c) => c.position_m[0]);
    const zs = cells.map((c) => c.position_m[1]);
    const minX = Math.min(...xs) - cs / 2;
    const maxZ = Math.max(...zs) + cs / 2;
    const nx = Math.round((Math.max(...xs) - Math.min(...xs)) / cs) + 1;
    const nz = Math.round((Math.max(...zs) - Math.min(...zs)) / cs) + 1;
    const px = 24; // texture px per cell
    const cv = document.createElement('canvas');
    cv.width = nx * px;
    cv.height = nz * px;
    const g = cv.getContext('2d');
    for (const c of cells) {
      const col = Math.round((c.position_m[0] - cs / 2 - minX) / cs);
      const row = Math.round((maxZ - (c.position_m[1] + cs / 2)) / cs);
      g.fillStyle = css(rssiColor(c.estimated_rssi_dbm), 0.62);
      g.fillRect(col * px, row * px, px, px);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter; // smooth look; still reads as modelled, not measured
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(nx * cs, nz * cs),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(toWorld([minX + (nx * cs) / 2, maxZ - (nz * cs) / 2], FIELD_Y));
    mesh.renderOrder = 5;
    scene.add(mesh);
    fieldMesh = mesh;
    mesh.visible = layer === 'wifi';
    return range;
  }

  function setFieldVisible(v) {
    if (fieldMesh) fieldMesh.visible = v;
  }

  // ---- mark mode (click floor -> twin:mark)
  let pickMode = null; // null | 'mark' | 'router'
  const pending = new THREE.Mesh(
    new THREE.RingGeometry(0.18, 0.26, 32),
    new THREE.MeshBasicMaterial({ color: '#7a4dff', side: THREE.DoubleSide }),
  );
  pending.rotation.x = -Math.PI / 2;
  pending.position.y = 0.03;
  pending.visible = false;
  scene.add(pending);

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downAt = null;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]));
  el.addEventListener('pointerup', (e) => {
    if (!pickMode || !downAt) return;
    if (Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return; // was an orbit drag
    const r = el.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(floors, false)[0];
    if (!hit) return;
    const position_m = [+hit.point.x.toFixed(2), +(-hit.point.z).toFixed(2)];
    if (pickMode === 'heater') {
      el.dispatchEvent(new CustomEvent('twin:heater', { detail: { position_m, roomId: hit.object.userData.roomId }, bubbles: true }));
      return;
    }
    if (pickMode === 'router') {
      el.dispatchEvent(new CustomEvent('twin:router', { detail: { position_m }, bubbles: true }));
      return;
    }
    pending.position.set(hit.point.x, 0.03, hit.point.z);
    pending.visible = true;
    el.dispatchEvent(new CustomEvent('twin:mark', { detail: { position_m, roomId: hit.object.userData.roomId }, bubbles: true }));
  });

  function setPickMode(mode) {
    pickMode = mode;
    el.style.cursor = mode ? 'crosshair' : '';
    if (mode !== 'mark') pending.visible = false;
  }

  // ---- router (the single signal source)
  const router = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.24), new THREE.MeshStandardMaterial({ color: '#2b2440' }));
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 8), new THREE.MeshStandardMaterial({ color: '#2b2440' }));
  mast.position.y = 0.16;
  const rings = [0.28, 0.5, 0.75].map((r, i) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.025, 40), new THREE.MeshBasicMaterial({ color: '#7a4dff', transparent: true, opacity: 0.55 - i * 0.12, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.3;
    return m;
  });
  router.add(body, mast, ...rings);
  router.visible = false;
  scene.add(router);
  let routerH = 1.0;
  let routerSet = false;
  function setRouter(r) {
    routerSet = Boolean(r);
    if (!r) return void (router.visible = false);
    routerH = r.height_m ?? 1.0;
    router.position.copy(toWorld(r.position_m, routerH));
    router.visible = layer === 'wifi';
  }
  const clearPending = () => (pending.visible = false);

  // ---- loop / resize
  function resize() {
    const b = mount.getBoundingClientRect();
    const w = Math.max(b.width, 1);
    const h = Math.max(b.height, 1);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  new ResizeObserver(resize).observe(mount);
  resize();
  (function loop() {
    requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  })();

  setFloorplan(floorplan, { refit: true });

  /** plan [x,z] (+height) -> client pixel, for tests/overlays */
  function project(position_m, y = 0) {
    const v = toWorld(position_m, y).project(camera);
    const r = el.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  }

  return { el, scene, project, view, setFloorplan, setWallMode, setSamples, setField, setFieldVisible, setPickMode, setRouter, setLayer, setRoomTemps, setHeaters, clearPending, bounds };
}
