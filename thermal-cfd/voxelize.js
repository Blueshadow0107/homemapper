function insidePolygon(x, z, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[j];
    const b = polygon[i];
    if ((a[1] > z) !== (b[1] > z)
      && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function segmentHitsBox(a, b, minX, maxX, minZ, maxZ) {
  const direction = [b[0] - a[0], b[1] - a[1]];
  let enter = 0;
  let exit = 1;
  for (let axis = 0; axis < 2; axis += 1) {
    const min = axis === 0 ? minX : minZ;
    const max = axis === 0 ? maxX : maxZ;
    if (Math.abs(direction[axis]) < 1e-12) {
      if (a[axis] < min || a[axis] > max) return false;
      continue;
    }
    const first = (min - a[axis]) / direction[axis];
    const second = (max - a[axis]) / direction[axis];
    enter = Math.max(enter, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
    if (enter > exit) return false;
  }
  return true;
}

function forWallCells(grid, a, b, radius, callback) {
  const { origin_m: origin, cell_m: cell, nx, nz } = grid;
  const minIx = Math.max(0, Math.floor((Math.min(a[0], b[0]) - radius - origin[0]) / cell));
  const maxIx = Math.min(nx - 1, Math.floor((Math.max(a[0], b[0]) + radius - origin[0]) / cell));
  const minIz = Math.max(0, Math.floor((Math.min(a[1], b[1]) - radius - origin[1]) / cell));
  const maxIz = Math.min(nz - 1, Math.floor((Math.max(a[1], b[1]) + radius - origin[1]) / cell));
  for (let iz = minIz; iz <= maxIz; iz += 1) {
    for (let ix = minIx; ix <= maxIx; ix += 1) {
      const minX = origin[0] + ix * cell - radius;
      const maxX = origin[0] + (ix + 1) * cell + radius;
      const minZ = origin[1] + iz * cell - radius;
      const maxZ = origin[1] + (iz + 1) * cell + radius;
      if (segmentHitsBox(a, b, minX, maxX, minZ, maxZ)) callback(ix, iz);
    }
  }
}

function openingWall(opening, walls) {
  const reference = opening.wall ?? opening.wall_id;
  if (Number.isInteger(reference)) return { wall: walls[reference], index: reference };
  const index = walls.findIndex((wall) => wall.id === reference);
  return index >= 0 ? { wall: walls[index], index } : null;
}

function nearestAirCell(grid, position, height) {
  const { origin_m: origin, cell_m: cell, nx, nz, ny, cell_type: types } = grid;
  const baseX = Math.floor((position[0] - origin[0]) / cell);
  const baseZ = Math.floor((position[1] - origin[1]) / cell);
  const iy = Math.max(0, Math.min(ny - 1, Math.floor(height / cell)));
  let best = null;
  for (let radius = 0; radius <= 4 && !best; radius += 1) {
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const ix = baseX + dx;
        const iz = baseZ + dz;
        if (ix < 0 || ix >= nx || iz < 0 || iz >= nz) continue;
        const index = (iy * nz + iz) * nx + ix;
        if (types[index] === 1) continue;
        const distance = dx * dx + dz * dz;
        if (!best || distance < best.distance) best = { index, distance };
      }
    }
  }
  return best?.index ?? -1;
}

export function voxelize(floorplan, cellM = 0.25, heaters = [], obstacles = []) {
  if (!Number.isFinite(cellM) || cellM <= 0) throw new RangeError('cell_m must be positive');
  const points = floorplan.rooms.flatMap((room) => room.polygon);
  if (!points.length) throw new TypeError('floorplan must contain rooms');
  const originX = Math.floor(Math.min(...points.map((point) => point[0])) / cellM) * cellM - 1.5 * cellM;
  const originZ = Math.floor(Math.min(...points.map((point) => point[1])) / cellM) * cellM - 1.5 * cellM;
  const maxX = Math.max(...points.map((point) => point[0])) + 1.5 * cellM;
  const maxZ = Math.max(...points.map((point) => point[1])) + 1.5 * cellM;
  const nx = Math.ceil((maxX - originX) / cellM);
  const nz = Math.ceil((maxZ - originZ) / cellM);
  const height = floorplan.ceiling_height_m ?? 2.7;
  const ny = Math.ceil(height / cellM - 1e-9);
  const n = nx * nz * ny;
  const grid = {
    origin_m: [originX, originZ],
    cell_m: cellM,
    nx,
    nz,
    ny,
    height_m: height,
    cell_type: new Uint8Array(n),
    solid_exterior: new Uint8Array(n),
    heater_sources: [],
  };
  const types = grid.cell_type;
  const exterior = grid.solid_exterior;

  for (let iz = 0; iz < nz; iz += 1) {
    for (let ix = 0; ix < nx; ix += 1) {
      const x = originX + (ix + 0.5) * cellM;
      const z = originZ + (iz + 0.5) * cellM;
      const inRoom = floorplan.rooms.some((room) => insidePolygon(x, z, room.polygon));
      for (let iy = 0; iy < ny; iy += 1) {
        const index = (iy * nz + iz) * nx + ix;
        if (!inRoom) {
          types[index] = 1;
          exterior[index] = 1;
        }
      }
    }
  }

  const walls = floorplan.walls || [];
  for (const wall of walls) {
    const radius = Math.max(0.01, wall.thickness_m ?? 0.1) / 2;
    const isExterior = (wall.exposure ?? wall.type) === 'exterior';
    forWallCells(grid, wall.a, wall.b, radius, (ix, iz) => {
      for (let iy = 0; iy < ny; iy += 1) {
        const index = (iy * nz + iz) * nx + ix;
        types[index] = 1;
        if (isExterior) exterior[index] = 1;
      }
    });
  }

  for (const opening of floorplan.openings || []) {
    const match = openingWall(opening, walls);
    if (!match) continue;
    const { wall } = match;
    const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    if (length < 1e-9) continue;
    const rawPosition = opening.t ?? 0.5;
    const centre = rawPosition >= 0 && rawPosition <= 1 ? rawPosition : rawPosition / length;
    const width = opening.width_m ?? opening.width ?? 0.9;
    const direction = [(wall.b[0] - wall.a[0]) / length, (wall.b[1] - wall.a[1]) / length];
    const middle = [wall.a[0] + (wall.b[0] - wall.a[0]) * centre,
      wall.a[1] + (wall.b[1] - wall.a[1]) * centre];
    const a = [middle[0] - direction[0] * width / 2, middle[1] - direction[1] * width / 2];
    const b = [middle[0] + direction[0] * width / 2, middle[1] + direction[1] * width / 2];
    const wallRadius = Math.max(0.01, wall.thickness_m ?? 0.1) / 2;
    const sill = opening.sill_height_m ?? 0;
    const top = sill + (opening.height_m ?? opening.height ?? (opening.type === 'window' ? 1 : 2));
    forWallCells(grid, a, b, wallRadius + cellM * 0.5, (ix, iz) => {
      for (let iy = 0; iy < ny; iy += 1) {
        const bottom = iy * cellM;
        const cellTop = Math.min(height, (iy + 1) * cellM);
        if (cellTop < sill || bottom > top) continue;
        const index = (iy * nz + iz) * nx + ix;
        types[index] = 0;
        exterior[index] = 0;
      }
    });
  }

  for (const obstacle of obstacles) {
    const x0 = Math.min(obstacle.x0, obstacle.x1);
    const x1 = Math.max(obstacle.x0, obstacle.x1);
    const z0 = Math.min(obstacle.z0, obstacle.z1);
    const z1 = Math.max(obstacle.z0, obstacle.z1);
    const minIx = Math.max(0, Math.floor((x0 - originX) / cellM));
    const maxIx = Math.min(nx - 1, Math.ceil((x1 - originX) / cellM) - 1);
    const minIz = Math.max(0, Math.floor((z0 - originZ) / cellM));
    const maxIz = Math.min(nz - 1, Math.ceil((z1 - originZ) / cellM) - 1);
    const layers = Math.min(ny, Math.max(0, Math.ceil(obstacle.height_m / cellM)));
    for (let iy = 0; iy < layers; iy += 1) {
      for (let iz = minIz; iz <= maxIz; iz += 1) {
        for (let ix = minIx; ix <= maxIx; ix += 1) {
          const index = (iy * nz + iz) * nx + ix;
          types[index] = 1;
          exterior[index] = 0;
        }
      }
    }
  }

  for (const heater of heaters) {
    const index = nearestAirCell(grid, heater.position_m, heater.height_m ?? 0.3);
    if (index < 0) continue;
    const layerSize = nx * nz;
    for (const [offset, fraction] of [0.5, 0.3, 0.2].entries()) {
      const sourceIndex = index + offset * layerSize;
      if (sourceIndex >= n || types[sourceIndex] === 1) continue;
      types[sourceIndex] = 2;
      grid.heater_sources.push({ index: sourceIndex, watts: heater.watts * fraction, room_id: heater.room_id });
    }
  }
  return grid;
}
