// FIXTURE ONLY — a synthetic, physics-free stand-in that speaks the same worker protocol as thermal-cfd/worker.js
// (see CHANNEL.md 19:55). It exists so the Airflow UI can be built/tested before the real solver lands, and is
// always labelled "FIXTURE — synthetic, not physics" in the UI. Never present its output as simulation.

const dist2Seg = (p, a, b) => {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  const qx = a[0] + t * dx;
  const qz = a[1] + t * dz;
  return (p[0] - qx) ** 2 + (p[1] - qz) ** 2;
};
const inPoly = (P, x, z) => {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++)
    if ((P[i][1] > z) !== (P[j][1] > z) && x < ((P[j][0] - P[i][0]) * (z - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) inside = !inside;
  return inside;
};

export function buildGrid(fp, cell_m, heaters = [], obstacles = []) {
  const pts = fp.rooms.flatMap((r) => r.polygon);
  // Align the lattice so plan lines at multiples of cell_m land on cell CENTRES. A wall sitting exactly on a cell
  // boundary would otherwise be >half-thickness from both neighbouring centres and vanish (air leaks through it).
  const x0 = Math.floor(Math.min(...pts.map((p) => p[0])) / cell_m) * cell_m - 1.5 * cell_m;
  const z0 = Math.floor(Math.min(...pts.map((p) => p[1])) / cell_m) * cell_m - 1.5 * cell_m;
  const x1 = Math.max(...pts.map((p) => p[0])) + 1.5 * cell_m;
  const z1 = Math.max(...pts.map((p) => p[1])) + 1.5 * cell_m;
  const height_m = fp.ceiling_height_m ?? 2.7;
  const nx = Math.ceil((x1 - x0) / cell_m);
  const nz = Math.ceil((z1 - z0) / cell_m);
  const ny = Math.ceil(height_m / cell_m - 1e-9); // per Kimi (CHANNEL 14:39)
  const cell_type = new Uint8Array(nx * nz * ny); // 0 air, 1 solid, 2 heater
  for (let iz = 0; iz < nz; iz++)
    for (let ix = 0; ix < nx; ix++) {
      const p = [x0 + (ix + 0.5) * cell_m, z0 + (iz + 0.5) * cell_m];
      const inRoom = fp.rooms.some((r) => inPoly(r.polygon, p[0], p[1]));
      const onWall = fp.walls.some((w) => dist2Seg(p, w.a, w.b) < (Math.max(w.thickness_m, cell_m) / 2) ** 2);
      const solid = !inRoom || onWall;
      for (let iy = 0; iy < ny; iy++) cell_type[(iy * nz + iz) * nx + ix] = solid ? 1 : 0;
    }
  // furniture: solid boxes (plan-space AABBs with a height), conservatively rasterised like walls
  for (const o of obstacles)
    for (let iz = 0; iz < nz; iz++)
      for (let ix = 0; ix < nx; ix++) {
        const cx0 = x0 + ix * cell_m;
        const cz0 = z0 + iz * cell_m;
        if (cx0 + cell_m <= o.x0 || cx0 >= o.x1 || cz0 + cell_m <= o.z0 || cz0 >= o.z1) continue; // no overlap with the cell
        const top = Math.ceil(o.height_m / cell_m - 1e-9);
        for (let iy = 0; iy < Math.min(ny, top); iy++) cell_type[(iy * nz + iz) * nx + ix] = 1;
      }
  for (const h of heaters) {
    const ix = Math.floor((h.position_m[0] - x0) / cell_m);
    const iz = Math.floor((h.position_m[1] - z0) / cell_m);
    const iy = Math.min(ny - 1, Math.floor((h.height_m ?? 0.3) / cell_m)); // default 0.3 m, per Kimi
    const idx = (iy * nz + iz) * nx + ix;
    if (ix >= 0 && ix < nx && iz >= 0 && iz < nz && cell_type[idx] === 0) cell_type[idx] = 2; // 2 = AIR cell with a source, not solid
  }
  return { origin_m: [x0, z0], cell_m, nx, nz, ny, height_m, cell_type };
}

function makeFrame(grid, heaters, t, ambient) {
  const { nx, nz, ny, cell_m, origin_m, height_m, cell_type } = grid;
  const n = nx * nz * ny;
  const T = new Float32Array(n).fill(ambient);
  const V = new Float32Array(3 * n);
  const ramp = 1 - Math.exp(-t / 600);
  const spin = Math.min(1, t / 120);
  for (const h of heaters) {
    const A = (h.watts / 1500) * 7 * ramp;
    for (let iy = 0; iy < ny; iy++) {
      const y = (iy + 0.5) * cell_m;
      const sig = 0.3 + 0.22 * y;
      for (let iz = 0; iz < nz; iz++)
        for (let ix = 0; ix < nx; ix++) {
          const idx = (iy * nz + iz) * nx + ix;
          if (cell_type[idx] === 1) continue;
          const dx = origin_m[0] + (ix + 0.5) * cell_m - h.position_m[0];
          const dz = origin_m[1] + (iz + 0.5) * cell_m - h.position_m[1];
          const r2 = dx * dx + dz * dz;
          const g = Math.exp(-r2 / (2 * sig * sig));
          T[idx] += A * (0.6 * g + 1.2 * (y / height_m) * Math.exp(-r2 / 18)); // plume + ceiling layer
          const r = Math.sqrt(r2) + 1e-6;
          const inflow = y < 0.5 ? -0.12 : y > height_m - 0.6 ? 0.16 : 0;
          V[3 * idx + 1] += 0.35 * g * spin; // rising plume
          V[3 * idx] += (dx / r) * inflow * Math.exp(-r2 / 8) * spin;
          V[3 * idx + 2] += (-dz / r) * inflow * Math.exp(-r2 / 8) * spin; // plan z -> world -z
        }
    }
  }
  return { time_s: t, temperature_c: T, velocity_m_s: V };
}

/** Same message surface as the real worker: post({type:'grid'|'frame'|'progress'|'done'|'error'}). */
export function runFixture(msg, post, isCancelled) {
  const sc = msg.scenario ?? {};
  const grid = buildGrid(msg.floorplan, sc.cell_m ?? 0.25, sc.heaters ?? [], sc.obstacles ?? []);
  post({ type: 'grid', grid });
  const dur = sc.duration_s ?? 10800;
  const every = sc.frame_every_s ?? 60;
  const times = [];
  for (let t = 0; t <= dur; t += every) times.push(t);
  let i = 0;
  const step = () => {
    if (isCancelled()) return;
    const t = times[i];
    post({ type: 'frame', frame: makeFrame(grid, sc.heaters ?? [], t, sc.initial_temp_c ?? 16) });
    post({ type: 'progress', fraction: (i + 1) / times.length });
    if (++i < times.length) setTimeout(step, 0);
    else post({ type: 'done', stats: { fixture: true } });
  };
  setTimeout(step, 0);
}
