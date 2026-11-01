const DISTANCE_EPSILON_M = 1e-6;

function validateBounds(bounds) {
  if (!bounds || !['minX', 'maxX', 'minZ', 'maxZ'].every((key) => Number.isFinite(bounds[key]))) {
    throw new TypeError('bounds must contain finite minX, maxX, minZ and maxZ values');
  }
  if (bounds.minX >= bounds.maxX || bounds.minZ >= bounds.maxZ) {
    throw new RangeError('bounds must have positive width and depth');
  }
}

function validateSamples(samples) {
  if (!Array.isArray(samples)) throw new TypeError('samples must be an array');
  for (const sample of samples) {
    if (!Array.isArray(sample?.position_m) || sample.position_m.length !== 2
      || !sample.position_m.every(Number.isFinite) || !Number.isFinite(sample?.rssi_dbm)) {
      throw new TypeError('each sample needs position_m:[x,z] and a finite rssi_dbm');
    }
  }
}

function pointOnSegment(x, z, a, b) {
  const cross = (x - a[0]) * (b[1] - a[1]) - (z - a[1]) * (b[0] - a[0]);
  if (Math.abs(cross) > 1e-9) return false;
  return x >= Math.min(a[0], b[0]) - 1e-9 && x <= Math.max(a[0], b[0]) + 1e-9
    && z >= Math.min(a[1], b[1]) - 1e-9 && z <= Math.max(a[1], b[1]) + 1e-9;
}

function insidePolygon(x, z, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[j];
    const b = polygon[i];
    if (pointOnSegment(x, z, a, b)) return true;
    const crosses = (a[1] > z) !== (b[1] > z)
      && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

function insideFloorplan(x, z, floorplan) {
  if (!floorplan || !Array.isArray(floorplan.rooms)) return true;
  return floorplan.rooms.some((room) => insidePolygon(x, z, room.polygon));
}

export function interpolate(bounds, samples, cellSize, floorplan) {
  validateBounds(bounds);
  validateSamples(samples);
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new RangeError('cellSize must be a positive finite number');
  }

  const cells = [];
  const halfCell = cellSize / 2;
  for (let z = bounds.minZ + halfCell; z < bounds.maxZ; z += cellSize) {
    for (let x = bounds.minX + halfCell; x < bounds.maxX; x += cellSize) {
      if (!insideFloorplan(x, z, floorplan)) continue;

      let weightedRssi = 0;
      let totalWeight = 0;
      let exactRssi = 0;
      let exactCount = 0;
      for (const sample of samples) {
        const dx = x - sample.position_m[0];
        const dz = z - sample.position_m[1];
        const distanceSquared = dx * dx + dz * dz;
        if (distanceSquared <= DISTANCE_EPSILON_M * DISTANCE_EPSILON_M) {
          exactRssi += sample.rssi_dbm;
          exactCount += 1;
          continue;
        }
        const weight = 1 / distanceSquared;
        weightedRssi += weight * sample.rssi_dbm;
        totalWeight += weight;
      }

      if (exactCount > 0) {
        cells.push({ position_m: [x, z], estimated_rssi_dbm: exactRssi / exactCount });
      } else if (totalWeight > 0) {
        cells.push({ position_m: [x, z], estimated_rssi_dbm: weightedRssi / totalWeight });
      }
    }
  }

  return { method: 'idw', cell_size_m: cellSize, cells };
}

const SPEED_OF_LIGHT_M_S = 299792458;
const DEFAULT_PATH_LOSS_EXPONENT = 3;
const RECEIVER_HEIGHT_M = 1;
const DEFAULT_MATERIAL_LOSS = {
  brick: { wifi_loss_db_2p4: 8, wifi_loss_db_5: 12 },
  concrete: { wifi_loss_db_2p4: 12, wifi_loss_db_5: 18 },
  plasterboard: { wifi_loss_db_2p4: 4, wifi_loss_db_5: 5 },
  wood: { wifi_loss_db_2p4: 3, wifi_loss_db_5: 4 },
  wood_door: { wifi_loss_db_2p4: 2, wifi_loss_db_5: 3 },
  glass: { wifi_loss_db_2p4: 1, wifi_loss_db_5: 2 },
  single_glazing: { wifi_loss_db_2p4: 2, wifi_loss_db_5: 3 },
  double_glazing: { wifi_loss_db_2p4: 2, wifi_loss_db_5: 3 },
};

function floorplanBounds(floorplan) {
  const polygons = floorplan?.rooms?.map((room) => room.polygon)
    .filter((polygon) => Array.isArray(polygon) && polygon.length >= 3);
  if (!polygons?.length) throw new TypeError('floorplan must contain room polygons');
  const points = polygons.flat();
  return {
    minX: Math.min(...points.map((point) => point[0])),
    maxX: Math.max(...points.map((point) => point[0])),
    minZ: Math.min(...points.map((point) => point[1])),
    maxZ: Math.max(...points.map((point) => point[1])),
  };
}

function segmentCrossing(a, b, c, d) {
  const ray = [b[0] - a[0], b[1] - a[1]];
  const wall = [d[0] - c[0], d[1] - c[1]];
  const denominator = ray[0] * wall[1] - ray[1] * wall[0];
  if (Math.abs(denominator) < 1e-12) return null;
  const offset = [c[0] - a[0], c[1] - a[1]];
  const rayPosition = (offset[0] * wall[1] - offset[1] * wall[0]) / denominator;
  const wallPosition = (offset[0] * ray[1] - offset[1] * ray[0]) / denominator;
  const epsilon = 1e-9;
  return rayPosition > epsilon && rayPosition < 1 - epsilon
    && wallPosition > epsilon && wallPosition < 1 - epsilon ? wallPosition : null;
}

function materialLoss(materialId, frequencyHz, floorplan, fallback) {
  const material = floorplan.materials?.[materialId] || DEFAULT_MATERIAL_LOSS[materialId];
  if (!material) return fallback;
  if (Number.isFinite(material.wifi_loss_db)) return material.wifi_loss_db;
  const bandKey = frequencyHz >= 4e9 ? 'wifi_loss_db_5' : 'wifi_loss_db_2p4';
  const fallbackKey = frequencyHz >= 4e9 ? 'wifi_loss_db_2p4' : 'wifi_loss_db_5';
  return material[bandKey] ?? material[fallbackKey] ?? fallback;
}

function openingMatchesWall(opening, wall, wallIndex) {
  const reference = opening.wall ?? opening.wall_id;
  return reference === wall.id || reference === wallIndex;
}

function crossedOpening(floorplan, wall, wallIndex, wallPosition, wallLength) {
  if (!Array.isArray(floorplan.openings)) return null;
  return floorplan.openings.find((opening) => {
    if (!openingMatchesWall(opening, wall, wallIndex)) return false;
    const length = opening.width_m ?? opening.width ?? 0.9;
    const position = opening.t ?? 0.5;
    const centre = position >= 0 && position <= 1 ? position : position / wallLength;
    return Math.abs(wallPosition - centre) * wallLength <= length / 2;
  }) || null;
}

function propagationLossDb(router, point, floorplan, pathLossExponent) {
  const [rx, rz] = router.position_m;
  const horizontalDistance = Math.hypot(point[0] - rx, point[1] - rz);
  const verticalDistance = (router.height_m ?? 1) - RECEIVER_HEIGHT_M;
  const distance = Math.max(1, Math.hypot(horizontalDistance, verticalDistance));
  const frequencyHz = router.frequency_hz ?? 2.4e9;
  const referenceLoss = 20 * Math.log10((4 * Math.PI * frequencyHz) / SPEED_OF_LIGHT_M_S);
  let loss = referenceLoss + 10 * pathLossExponent * Math.log10(distance);

  for (const [index, wall] of (floorplan.walls || []).entries()) {
    const wallPosition = segmentCrossing(router.position_m, point, wall.a, wall.b);
    if (wallPosition === null) continue;
    const wallLength = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    const opening = crossedOpening(floorplan, wall, index, wallPosition, wallLength);
    if (opening?.closed === false) continue;
    if (opening) {
      const materialId = opening.material_id || opening.material
        || (opening.type === 'window' ? 'glass' : 'wood_door');
      loss += materialLoss(materialId, frequencyHz, floorplan, opening.type === 'window' ? 1 : 2);
    } else {
      const fallback = (wall.exposure ?? wall.type) === 'exterior' ? 8 : 4;
      loss += materialLoss(wall.material_id, frequencyHz, floorplan, fallback);
    }
  }
  return loss;
}

export function predict(router, floorplan, cellSize) {
  if (!Array.isArray(router?.position_m) || router.position_m.length !== 2
    || !router.position_m.every(Number.isFinite)) {
    throw new TypeError('router must contain position_m:[x,z]');
  }
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new RangeError('cellSize must be a positive finite number');
  }
  const frequencyHz = router.frequency_hz ?? 2.4e9;
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) {
    throw new RangeError('router.frequency_hz must be positive');
  }
  const pathLossExponent = router.path_loss_exponent ?? DEFAULT_PATH_LOSS_EXPONENT;
  if (!Number.isFinite(pathLossExponent) || pathLossExponent <= 0) {
    throw new RangeError('router.path_loss_exponent must be positive and finite');
  }
  const bounds = floorplanBounds(floorplan);
  const cells = [];
  const halfCell = cellSize / 2;
  for (let z = bounds.minZ + halfCell; z < bounds.maxZ; z += cellSize) {
    for (let x = bounds.minX + halfCell; x < bounds.maxX; x += cellSize) {
      if (!insideFloorplan(x, z, floorplan)) continue;
      cells.push({
        position_m: [x, z],
        estimated_rssi_dbm: (router.tx_power_dbm ?? 17) - propagationLossDb(router, [x, z], floorplan, pathLossExponent),
      });
    }
  }
  return { method: 'multiwall', cell_size_m: cellSize, cells };
}
