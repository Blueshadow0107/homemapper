export function createCavityGrid(size = 10, depth = size) {
  const nx = size;
  const nz = size;
  const ny = depth;
  const n = nx * nz * ny;
  const grid = {
    origin_m: [0, 0],
    cell_m: 1,
    nx,
    nz,
    ny,
    height_m: depth,
    cell_type: new Uint8Array(n).fill(1),
    solid_exterior: new Uint8Array(n),
    solid_temperature: new Float64Array(n).fill(NaN),
    heater_sources: [],
  };
  for (let iy = 1; iy < ny - 1; iy += 1) {
    for (let iz = 1; iz < nz - 1; iz += 1) {
      for (let ix = 1; ix < nx - 1; ix += 1) {
        grid.cell_type[(iy * nz + iz) * nx + ix] = 0;
      }
    }
  }
  for (let iy = 0; iy < ny; iy += 1) {
    for (let iz = 0; iz < nz; iz += 1) {
      grid.solid_temperature[(iy * nz + iz) * nx] = 1;
      grid.solid_temperature[(iy * nz + iz) * nx + nx - 1] = 0;
    }
  }
  return grid;
}

export function cavityMetrics(solver) {
  const { nx, nz, ny } = solver.grid;
  const iy = Math.floor(ny / 2);
  const iz = Math.floor(nz / 2);
  const hotIndex = solver.index(1, iz, iy);
  const coldIndex = solver.index(nx - 2, iz, iy);
  const topIndex = solver.index(Math.floor(nx / 2), iz, ny - 2);
  const bottomIndex = solver.index(Math.floor(nx / 2), iz, 1);
  return {
    hot_vertical_velocity: solver.velocity[3 * hotIndex + 1],
    cold_vertical_velocity: solver.velocity[3 * coldIndex + 1],
    top_horizontal_velocity: solver.velocity[3 * topIndex],
    bottom_horizontal_velocity: solver.velocity[3 * bottomIndex],
    hot_temperature: solver.temperature[hotIndex],
    cold_temperature: solver.temperature[coldIndex],
  };
}
