const AIR_DENSITY_KG_M3 = 1.2;
const AIR_HEAT_CAPACITY_J_KGK = 1005;
const DEFAULT_THERMAL_MASS_J_M2K = 60000;
const DEFAULT_U_VALUES = {
  brick: 1.5,
  concrete: 2,
  plasterboard: 2.5,
  wood: 2,
  wood_door: 2,
  glass: 5.8,
  single_glazing: 5.8,
  double_glazing: 2.8,
};

function polygonArea(polygon) {
  let twiceArea = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    twiceArea += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(twiceArea) / 2;
}

function segmentLength(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function collinearOverlapLength(a, b, c, d) {
  const length = segmentLength(a, b);
  if (length < 1e-9 || segmentLength(c, d) < 1e-9) return 0;
  const direction = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  const distanceC = Math.abs((c[0] - a[0]) * direction[1] - (c[1] - a[1]) * direction[0]);
  const distanceD = Math.abs((d[0] - a[0]) * direction[1] - (d[1] - a[1]) * direction[0]);
  if (distanceC > 1e-6 || distanceD > 1e-6) return 0;
  const projectionC = (c[0] - a[0]) * direction[0] + (c[1] - a[1]) * direction[1];
  const projectionD = (d[0] - a[0]) * direction[0] + (d[1] - a[1]) * direction[1];
  return Math.max(0, Math.min(length, Math.max(projectionC, projectionD))
    - Math.max(0, Math.min(projectionC, projectionD)));
}

function wallRoomOverlap(wall, room) {
  let overlap = 0;
  for (let i = 0; i < room.polygon.length; i += 1) {
    const a = room.polygon[i];
    const b = room.polygon[(i + 1) % room.polygon.length];
    overlap += collinearOverlapLength(wall.a, wall.b, a, b);
  }
  return overlap;
}

function openingMatchesWall(opening, wall, wallIndex) {
  const reference = opening.wall ?? opening.wall_id;
  return reference === wall.id || reference === wallIndex;
}

function openingArea(opening) {
  const width = opening.width_m ?? opening.width ?? 0.9;
  const height = opening.height_m ?? opening.height ?? (opening.type === 'window' ? 1 : 2);
  return width * height;
}

function uValue(materialId, floorplan, fallback) {
  return floorplan.materials?.[materialId]?.u_value_w_m2k
    ?? DEFAULT_U_VALUES[materialId]
    ?? fallback;
}

function finiteOr(value, fallback) {
  return value === undefined ? fallback : value;
}

function validateScenario(scenario, rooms) {
  for (const key of ['outside_temp_c', 'initial_temp_c']) {
    if (scenario[key] !== undefined && !Number.isFinite(scenario[key])) {
      throw new TypeError(`${key} must be finite`);
    }
  }
  for (const key of ['duration_min', 'step_min']) {
    if (scenario[key] !== undefined && (!Number.isFinite(scenario[key]) || scenario[key] <= 0)) {
      throw new RangeError(`${key} must be positive and finite`);
    }
  }
  if (scenario.infiltration_ach !== undefined
    && (!Number.isFinite(scenario.infiltration_ach) || scenario.infiltration_ach < 0)) {
    throw new RangeError('infiltration_ach must be non-negative and finite');
  }
  const roomIds = new Set(rooms.map((room) => room.id));
  for (const heater of scenario.heaters || []) {
    if (!roomIds.has(heater.room_id)) throw new RangeError(`unknown heater room_id: ${heater.room_id}`);
    if (!Number.isFinite(heater.watts) || heater.watts < 0) {
      throw new RangeError('heater watts must be non-negative and finite');
    }
  }
}

export function simulate(floorplan, scenario = {}) {
  if (!Array.isArray(floorplan?.rooms) || floorplan.rooms.length === 0
    || floorplan.rooms.some((room) => !Array.isArray(room.polygon) || room.polygon.length < 3)) {
    throw new TypeError('floorplan must contain room polygons');
  }
  validateScenario(scenario, floorplan.rooms);

  const ceilingHeight = finiteOr(floorplan.ceiling_height_m, 2.7);
  if (!Number.isFinite(ceilingHeight) || ceilingHeight <= 0) {
    throw new RangeError('ceiling_height_m must be positive and finite');
  }
  const outsideTemp = finiteOr(scenario.outside_temp_c, 8);
  const initialTemp = finiteOr(scenario.initial_temp_c, 16);
  const infiltrationAch = finiteOr(scenario.infiltration_ach, 0.5);
  const durationSeconds = finiteOr(scenario.duration_min, 60) * 60;
  const outputStepSeconds = finiteOr(scenario.step_min, 5) * 60;
  const openings = floorplan.openings || [];

  const states = floorplan.rooms.map((room, index) => {
    const area = polygonArea(room.polygon);
    if (area <= 0) throw new RangeError(`room ${room.id || index} has zero area`);
    const volume = area * ceilingHeight;
    const override = scenario.room_overrides?.[room.id] || {};
    const capacity = override.thermal_mass_j_k ?? room.thermal_mass_j_k ?? area * DEFAULT_THERMAL_MASS_J_M2K;
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new RangeError(`room ${room.id || index} thermal mass must be positive and finite`);
    }
    const heaterWatts = (scenario.heaters || [])
      .filter((heater) => heater.room_id === room.id)
      .reduce((total, heater) => total + heater.watts, 0);
    return {
      room_id: room.id,
      area,
      volume,
      capacity,
      temp: override.initial_temp_c ?? room.initial_temp_c ?? initialTemp,
      heaterWatts,
      externalConductance: infiltrationAch * volume * AIR_DENSITY_KG_M3 * AIR_HEAT_CAPACITY_J_KGK / 3600,
    };
  });

  for (const [wallIndex, wall] of (floorplan.walls || []).entries()) {
    if ((wall.exposure ?? wall.type) !== 'exterior') continue;
    const length = segmentLength(wall.a, wall.b);
    const wallOpenings = openings.filter((opening) => openingMatchesWall(opening, wall, wallIndex));
    const totalOpeningArea = Math.min(length * ceilingHeight,
      wallOpenings.reduce((total, opening) => total + openingArea(opening), 0));
    const wallU = uValue(wall.material_id, floorplan, 1.5);
    const netWallConductance = wallU * Math.max(0, length * ceilingHeight - totalOpeningArea);
    for (const [index, room] of floorplan.rooms.entries()) {
      const fraction = length > 0 ? wallRoomOverlap(wall, room) / length : 0;
      if (fraction <= 0) continue;
      states[index].externalConductance += netWallConductance * fraction;
      for (const opening of wallOpenings) {
        const materialId = opening.material_id || opening.material
          || (opening.type === 'window' ? 'single_glazing' : 'wood_door');
        const openingU = uValue(materialId, floorplan, opening.type === 'window' ? 5.8 : 2);
        states[index].externalConductance += openingU * openingArea(opening) * fraction;
      }
    }
  }

  const internalLinks = [];
  for (const wall of floorplan.walls || []) {
    if ((wall.exposure ?? wall.type) === 'exterior') continue;
    const overlaps = floorplan.rooms.map((room) => wallRoomOverlap(wall, room));
    const wallU = uValue(wall.material_id, floorplan, 2.5);
    for (let a = 0; a < states.length; a += 1) {
      for (let b = a + 1; b < states.length; b += 1) {
        const sharedLength = Math.min(overlaps[a], overlaps[b]);
        if (sharedLength <= 1e-6) continue;
        internalLinks.push({ a, b, conductance: wallU * sharedLength * ceilingHeight });
      }
    }
  }

  const totalConductance = states.map((state, index) => {
    let total = state.externalConductance;
    for (const link of internalLinks) {
      if (link.a === index || link.b === index) total += link.conductance;
    }
    return total;
  });
  const stableStep = Math.min(...states.map((state, index) => totalConductance[index] > 0
    ? state.capacity / totalConductance[index]
    : Infinity));
  const integrationStep = Math.min(outputStepSeconds, stableStep / 4);

  const times = [0];
  const temperatures = states.map((state) => [state.temp]);
  const outputSteps = Math.ceil(durationSeconds / outputStepSeconds);
  let elapsed = 0;
  for (let outputIndex = 1; outputIndex <= outputSteps; outputIndex += 1) {
    const target = Math.min(outputIndex * outputStepSeconds, durationSeconds);
    while (elapsed < target - 1e-9) {
      const dt = Math.min(integrationStep, target - elapsed);
      const previous = states.map((state) => state.temp);
      const next = states.map((state, index) => {
        let power = state.heaterWatts + state.externalConductance * (outsideTemp - previous[index]);
        for (const link of internalLinks) {
          if (link.a === index) power += link.conductance * (previous[link.b] - previous[index]);
          if (link.b === index) power += link.conductance * (previous[link.a] - previous[index]);
        }
        return previous[index] + dt * power / state.capacity;
      });
      states.forEach((state, index) => { state.temp = next[index]; });
      elapsed += dt;
    }
    times.push(target);
    states.forEach((state, index) => temperatures[index].push(state.temp));
  }

  return {
    method: 'lumped-rc',
    times_s: times,
    rooms: states.map((state, index) => ({
      room_id: state.room_id,
      area_m2: state.area,
      volume_m3: state.volume,
      temps_c: temperatures[index],
      final_temp_c: temperatures[index][temperatures[index].length - 1],
      heater_energy_kwh: state.heaterWatts * durationSeconds / 3.6e6,
    })),
    assumptions: {
      outside_temp_c: outsideTemp,
      initial_temp_c: initialTemp,
      ceiling_height_m: ceilingHeight,
      infiltration_ach: infiltrationAch,
      default_thermal_mass_j_m2k: DEFAULT_THERMAL_MASS_J_M2K,
      constant_heater_power: true,
      excludes: ['CFD/airflow', 'solar gains', 'occupancy gains', 'thermostat control'],
    },
  };
}
