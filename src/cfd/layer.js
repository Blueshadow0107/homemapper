import * as THREE from 'three';
import { tempColor, TEMP_RANGE } from '../viewer.js';

// Draws CFD frames: a horizontal temperature slice (solids masked) + velocity arrows on that slice.
// Frame/grid shape is the contract in CHANNEL.md 19:55. World mapping: plan [x,z] -> world [x, y, -z].
// first air cell's t=0 temperature = ambient reference for the opacity ramp
const idx0 = (g) => g.cell_type.findIndex((c) => c === 0);

export function createCfdLayer(viewer) {
  const group = new THREE.Group();
  group.visible = false;
  viewer.scene.add(group);
  let grid = null;
  let frames = [];
  let frameIdx = 0;
  let sliceY = 0.9;
  let showArrows = true;
  let slice = null;
  let arrows = null;
  const cone = new THREE.ConeGeometry(0.05, 1, 8);
  cone.translate(0, 0.5, 0); // base at origin, tip along +Y
  cone.rotateX(Math.PI / 2); // tip along +Z... re-aimed per instance below via lookAt-style quaternion
  const up = new THREE.Vector3(0, 0, 1);

  function clear() {
    for (const o of [slice, arrows]) {
      if (!o) continue;
      group.remove(o);
      o.geometry?.dispose();
      o.material?.map?.dispose();
      o.material?.dispose();
    }
    slice = arrows = null;
  }

  function setGrid(g) {
    grid = g;
    frames = [];
    frameIdx = 0;
    clear();
  }
  const addFrame = (f) => frames.push(f);
  const frameCount = () => frames.length;

  const iyOf = () => Math.min(grid.ny - 1, Math.max(0, Math.floor(sliceY / grid.cell_m)));

  function draw() {
    if (!grid || !frames.length) return null;
    clear();
    const f = frames[Math.min(frameIdx, frames.length - 1)];
    const { nx, nz, cell_m, origin_m, cell_type } = grid;
    const iy = iyOf();
    const y = (iy + 0.5) * cell_m;

    // ---- temperature slice
    const px = 12;
    const cv = document.createElement('canvas');
    cv.width = nx * px;
    cv.height = nz * px;
    const g = cv.getContext('2d');
    const ambientC = frames[0].temperature_c[idx0(grid)];
    let tMin = Infinity;
    let tMax = -Infinity;
    for (let iz = 0; iz < nz; iz++)
      for (let ix = 0; ix < nx; ix++) {
        const idx = (iy * nz + iz) * nx + ix;
        if (cell_type[idx] === 1) continue;
        const T = f.temperature_c[idx];
        tMin = Math.min(tMin, T);
        tMax = Math.max(tMax, T);
        const c = tempColor(T);
        g.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(0.28 + 0.62 * Math.min(1, Math.abs(T - ambientC) / 6)).toFixed(2)})`; // near-ambient stays see-through
        g.fillRect(ix * px, (nz - 1 - iz) * px, px, px); // canvas row 0 = max plan z
      }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    slice = new THREE.Mesh(
      new THREE.PlaneGeometry(nx * cell_m, nz * cell_m),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    slice.rotation.x = -Math.PI / 2;
    slice.position.set(origin_m[0] + (nx * cell_m) / 2, y, -(origin_m[1] + (nz * cell_m) / 2));
    slice.renderOrder = 5;
    group.add(slice);

    // ---- velocity arrows (subsampled to ~28 across the long side)
    let vMax = 1e-9;
    const stride = Math.max(1, Math.round(Math.max(nx, nz) / 28));
    const pts = [];
    for (let iz = Math.floor(stride / 2); iz < nz; iz += stride)
      for (let ix = Math.floor(stride / 2); ix < nx; ix += stride) {
        const idx = (iy * nz + iz) * nx + ix;
        if (cell_type[idx] === 1) continue;
        const v = [f.velocity_m_s[3 * idx], f.velocity_m_s[3 * idx + 1], f.velocity_m_s[3 * idx + 2]];
        const s = Math.hypot(...v);
        vMax = Math.max(vMax, s);
        pts.push({ ix, iz, v, s });
      }
    if (showArrows) {
      const live = pts.filter((p) => p.s > 0.01);
      arrows = new THREE.InstancedMesh(cone, new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true, opacity: 0.95 }), Math.max(1, live.length));
      arrows.renderOrder = 6;
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const col = new THREE.Color();
      live.forEach((p, i) => {
        const dir = new THREE.Vector3(...p.v).normalize();
        q.setFromUnitVectors(up, dir);
        const len = Math.max(0.12, Math.min(1, p.s / Math.max(vMax, 0.3)) * cell_m * stride * 1.4);
        m.compose(
          new THREE.Vector3(origin_m[0] + (p.ix + 0.5) * cell_m, y, -(origin_m[1] + (p.iz + 0.5) * cell_m)),
          q,
          new THREE.Vector3(1, 1, len),
        );
        arrows.setMatrixAt(i, m);
        arrows.setColorAt(i, col.setHSL(0.72 - 0.72 * Math.min(1, p.s / 0.4), 0.9, 0.45)); // slow = violet, fast = red
      });
      arrows.count = live.length;
      arrows.instanceMatrix.needsUpdate = true;
      if (arrows.instanceColor) arrows.instanceColor.needsUpdate = true;
      group.add(arrows);
    }
    return { time_s: f.time_s, tMin, tMax, vMax, height_m: y };
  }

  return {
    setGrid,
    addFrame,
    frameCount,
    setVisible: (v) => (group.visible = v),
    setFrame: (i) => ((frameIdx = i), draw()),
    setSliceHeight: (h) => ((sliceY = h), draw()),
    setArrows: (on) => ((showArrows = on), draw()),
    redraw: draw,
    reset: () => ((grid = null), (frames = []), clear()),
    TEMP_RANGE,
  };
}
