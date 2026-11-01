// Pure geometry edits on a floorplan (docs/data-contract.md). Every op returns a NEW floorplan; nothing mutates.
// Plan coords are [x, z] metres. No DOM, no three.js — safe to unit-test in node.

export const MATERIALS = ['brick', 'concrete', 'plasterboard', 'wood', 'glass'];
const EPS = 1e-6;
const same = (p, q) => Math.abs(p[0] - q[0]) < EPS && Math.abs(p[1] - q[1]) < EPS;
const clone = (fp) => structuredClone(fp);
const len = (w) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
const ROOM_COLORS = ['#d8cdf6', '#c5dff0', '#d1eadc', '#f3d9c4', '#f0cfe0', '#e6e3b8'];

export const snap = (v, step = 0.1) => +(Math.round(v / step) * step).toFixed(6);
export const snapPt = (p, step = 0.1) => [+snap(p[0], step).toFixed(3), +snap(p[1], step).toFixed(3)];

/** Move every wall end / room corner sitting on `from` to `to` (shared corners stay joined). */
export function moveVertex(fp, from, to) {
  const out = clone(fp);
  for (const w of out.walls) {
    if (same(w.a, from)) w.a = [...to];
    if (same(w.b, from)) w.b = [...to];
  }
  for (const r of out.rooms) r.polygon = r.polygon.map((p) => (same(p, from) ? [...to] : p));
  return out;
}

export function addWall(fp, a, b, props = {}) {
  if (same(a, b)) return fp;
  const out = clone(fp);
  const n = out.walls.length + 1;
  out.walls.push({
    id: `wall-${n}`,
    a: [...a],
    b: [...b],
    thickness_m: 0.1,
    material_id: 'plasterboard',
    exposure: 'interior',
    ...props,
  });
  return out;
}

export function deleteWall(fp, i) {
  const out = clone(fp);
  out.walls.splice(i, 1);
  return out;
}

export function updateWall(fp, i, patch) {
  const out = clone(fp);
  const w = out.walls[i];
  Object.assign(w, patch);
  // keep legacy `type` (used by older viewer code / demo plan) in sync with exposure
  if (patch.exposure) w.type = patch.exposure;
  if (patch.exposure === 'exterior' && patch.thickness_m === undefined) w.thickness_m = Math.max(w.thickness_m, 0.16);
  return out;
}

/** Rectangle room from two opposite corners; adds interior walls only for edges not already walled. */
export function addRoom(fp, c1, c2, name) {
  const [x0, x1] = [Math.min(c1[0], c2[0]), Math.max(c1[0], c2[0])];
  const [z0, z1] = [Math.min(c1[1], c2[1]), Math.max(c1[1], c2[1])];
  if (x1 - x0 < 0.3 || z1 - z0 < 0.3) return fp;
  const poly = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  let out = clone(fp);
  const n = out.rooms.length + 1;
  out.rooms.push({ id: `room-${n}`, name: name || `Room ${n}`, polygon: poly, color: ROOM_COLORS[(n - 1) % ROOM_COLORS.length] });
  for (let i = 0; i < 4; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % 4];
    if (!out.walls.some((w) => (same(w.a, a) && same(w.b, b)) || (same(w.a, b) && same(w.b, a)))) out = addWall(out, a, b);
  }
  return out;
}

export function deleteRoom(fp, i) {
  const out = clone(fp);
  out.rooms.splice(i, 1);
  return out;
}

/** Scale the whole plan so wall `i` is exactly `metres` long. Returns {fp, factor}. */
export function scaleToLength(fp, i, metres) {
  const cur = len(fp.walls[i]);
  if (!(cur > EPS) || !(metres > 0)) return { fp, factor: 1 };
  const k = metres / cur;
  const out = clone(fp);
  const sc = (p) => [+(p[0] * k).toFixed(4), +(p[1] * k).toFixed(4)];
  for (const w of out.walls) {
    w.a = sc(w.a);
    w.b = sc(w.b);
  }
  for (const r of out.rooms) r.polygon = r.polygon.map(sc);
  for (const f of out.furniture ?? []) f.position_m = sc(f.position_m); // positions scale; catalog sizes are real-world and do not
  return { fp: out, factor: k };
}

export const wallLength = len;

/** Cheap sanity flags shown in the editor (and reusable before running any model). */
export function validate(fp) {
  const issues = [];
  fp.walls.forEach((w, i) => {
    if (len(w) < 0.2) issues.push({ level: 'warn', msg: `Wall ${i + 1} is only ${len(w).toFixed(2)} m long` });
  });
  fp.rooms.forEach((r) => {
    r.polygon.forEach((p, i) => {
      const q = r.polygon[(i + 1) % r.polygon.length];
      if (!edgeWalled(fp, p, q)) issues.push({ level: 'warn', msg: `${r.name}: edge ${i + 1} has no wall (signal/heat would leak)` });
    });
  });
  if (!fp.rooms.length) issues.push({ level: 'error', msg: 'No rooms yet' });
  return issues;
}

export const edgeWalled = (fp, p, q) =>
  fp.walls.some((w) => (same(w.a, p) && same(w.b, q)) || (same(w.a, q) && same(w.b, p)) || onSegment(w, p, q));

// room edge p→q lies fully inside wall w (collinear + within the segment)
function onSegment(w, p, q) {
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  if (Math.abs(cross(w.a, w.b, p)) > 1e-4 || Math.abs(cross(w.a, w.b, q)) > 1e-4) return false;
  const inside = (r) => r[0] >= Math.min(w.a[0], w.b[0]) - EPS && r[0] <= Math.max(w.a[0], w.b[0]) + EPS && r[1] >= Math.min(w.a[1], w.b[1]) - EPS && r[1] <= Math.max(w.a[1], w.b[1]) + EPS;
  return inside(p) && inside(q);
}

export function bounds(fp) {
  const pts = fp.rooms.flatMap((r) => r.polygon).concat(fp.walls.flatMap((w) => [w.a, w.b]));
  return {
    minX: Math.min(...pts.map((p) => p[0])),
    maxX: Math.max(...pts.map((p) => p[0])),
    minZ: Math.min(...pts.map((p) => p[1])),
    maxZ: Math.max(...pts.map((p) => p[1])),
  };
}

// ---- furniture (catalog ids live in assets/furniture/catalog.json; types are validated at render time)
export function addFurniture(fp, type, position_m, rotation_deg = 0, extra = {}) {
  const out = clone(fp);
  out.furniture ??= [];
  let n = out.furniture.length + 1;
  while (out.furniture.some((f) => f.id === `furn-${n}`)) n++;
  out.furniture.push({ id: `furn-${n}`, type, position_m: [...position_m], rotation_deg, ...extra });
  return out;
}
export function moveFurniture(fp, i, position_m) {
  const out = clone(fp);
  out.furniture[i].position_m = [...position_m];
  return out;
}
export function rotateFurniture(fp, i, step = 90) {
  const out = clone(fp);
  out.furniture[i].rotation_deg = (((out.furniture[i].rotation_deg + step) % 360) + 360) % 360;
  return out;
}
export function deleteFurniture(fp, i) {
  const out = clone(fp);
  out.furniture.splice(i, 1);
  return out;
}
export function updateFurniture(fp, i, patch) {
  const out = clone(fp);
  Object.assign(out.furniture[i], patch);
  return out;
}

/**
 * Wall-mounted pieces (radiators): snap `p` to the nearest wall within maxDist, back against the wall, facing into the
 * room on the side `p` was on. Returns {position_m, rotation_deg}; unchanged (rotation 0) when no wall is near.
 * Front of a piece is local +z at rotation 0; clockwise-on-plan rotations send it to -x (90), -z (180), +x (270).
 */
export function snapToWall(fp, item, p, maxDist = 1.2) {
  let best = null;
  for (const w of fp.walls) {
    const dx = w.b[0] - w.a[0];
    const dz = w.b[1] - w.a[1];
    const l2 = dx * dx + dz * dz;
    if (l2 < 1e-9) continue;
    const t = Math.max(0, Math.min(1, ((p[0] - w.a[0]) * dx + (p[1] - w.a[1]) * dz) / l2));
    const q = [w.a[0] + t * dx, w.a[1] + t * dz];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (!best || d < best.d) best = { w, q, d, dx, dz };
  }
  if (!best || best.d > maxDist) return { position_m: [...p], rotation_deg: 0 };
  const nl = Math.hypot(best.dx, best.dz);
  let nx = -best.dz / nl;
  let nz = best.dx / nl;
  if ((p[0] - best.q[0]) * nx + (p[1] - best.q[1]) * nz < 0) [nx, nz] = [-nx, -nz];
  const fronts = [[0, 0, 1], [90, -1, 0], [180, 0, -1], [270, 1, 0]];
  const rot = fronts.reduce((a, f) => (f[1] * nx + f[2] * nz > a[1] * nx + a[2] * nz ? f : a))[0];
  const off = best.w.thickness_m / 2 + item.size_m[2] / 2 + 0.01;
  return { position_m: [+(best.q[0] + nx * off).toFixed(3), +(best.q[1] + nz * off).toFixed(3)], rotation_deg: rot };
}
