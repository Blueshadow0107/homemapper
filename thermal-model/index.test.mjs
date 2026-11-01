import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from './index.js';

const floorplan = {
  ceiling_height_m: 2.5,
  rooms: [
    { id: 'warm', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] },
    { id: 'neighbour', polygon: [[4, 0], [8, 0], [8, 4], [4, 4]] },
  ],
  walls: [
    { id: 'north', a: [0, 0], b: [8, 0], exposure: 'exterior', material_id: 'brick' },
    { id: 'east', a: [8, 0], b: [8, 4], exposure: 'exterior', material_id: 'brick' },
    { id: 'south', a: [8, 4], b: [0, 4], exposure: 'exterior', material_id: 'brick' },
    { id: 'west', a: [0, 4], b: [0, 0], exposure: 'exterior', material_id: 'brick' },
    { id: 'party', a: [4, 0], b: [4, 4], exposure: 'interior', material_id: 'plasterboard' },
  ],
  openings: [],
};

test('returns aligned time series and preserves inputs at equilibrium', () => {
  const original = structuredClone(floorplan);
  const result = simulate(floorplan, { outside_temp_c: 16, initial_temp_c: 16, duration_min: 60, step_min: 5 });
  assert.equal(result.method, 'lumped-rc');
  assert.equal(result.times_s.length, 13);
  assert.equal(result.rooms.length, 2);
  for (const room of result.rooms) {
    assert.equal(room.temps_c.length, result.times_s.length);
    assert.ok(room.temps_c.every((temp) => Math.abs(temp - 16) < 1e-9));
  }
  assert.deepEqual(floorplan, original);
});

test('heater warms its room, transfers heat internally, and records energy', () => {
  const result = simulate(floorplan, {
    outside_temp_c: 16,
    initial_temp_c: 16,
    duration_min: 60,
    step_min: 5,
    heaters: [{ id: 'radiator', room_id: 'warm', watts: 1000 }],
  });
  const warm = result.rooms.find((room) => room.room_id === 'warm');
  const neighbour = result.rooms.find((room) => room.room_id === 'neighbour');
  assert.ok(warm.final_temp_c > 16);
  assert.ok(neighbour.final_temp_c > 16);
  assert.ok(warm.final_temp_c > neighbour.final_temp_c);
  assert.equal(warm.heater_energy_kwh, 1);
  assert.equal(neighbour.heater_energy_kwh, 0);
});

test('unheated rooms cool toward outdoor temperature', () => {
  const result = simulate(floorplan, { outside_temp_c: 5, initial_temp_c: 20, infiltration_ach: 0 });
  for (const room of result.rooms) {
    assert.ok(room.final_temp_c < 20);
    assert.ok(room.final_temp_c > 5);
  }
});

test('higher thermal mass slows warm-up', () => {
  const scenario = {
    outside_temp_c: 16,
    initial_temp_c: 16,
    heaters: [{ room_id: 'warm', watts: 1000 }],
  };
  const light = simulate(floorplan, scenario);
  const heavy = simulate(floorplan, {
    ...scenario,
    room_overrides: { warm: { thermal_mass_j_k: 8e6 }, neighbour: { thermal_mass_j_k: 8e6 } },
  });
  assert.ok(heavy.rooms[0].final_temp_c < light.rooms[0].final_temp_c);
});

test('rejects unknown heater rooms', () => {
  assert.throws(() => simulate(floorplan, { heaters: [{ room_id: 'missing', watts: 1000 }] }), /unknown heater room_id/);
});
