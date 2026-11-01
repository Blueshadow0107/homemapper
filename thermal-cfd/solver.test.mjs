import test from 'node:test';
import assert from 'node:assert/strict';
import { ThermalLbmSolver } from './solver.js';
import { createCavityGrid, cavityMetrics } from './cavity.js';

function isothermalGrid(size = 8) {
  const grid = createCavityGrid(size);
  grid.solid_temperature.fill(NaN);
  return grid;
}

test('3D cubic isothermal cavity stays uniform and at rest', () => {
  const solver = new ThermalLbmSolver(isothermalGrid(), {
    initial_temp_c: 0.5,
    reference_temp_c: 0.5,
    buoyancy: 5e-4,
  });
  solver.step(60);
  const stats = solver.stats();
  assert.ok(stats.max_speed_lu < 1e-12);
  assert.ok(Math.abs(stats.min_temperature_c - 0.5) < 1e-12);
  assert.ok(Math.abs(stats.max_temperature_c - 0.5) < 1e-12);
});

test('differentially heated cavity develops the correct circulation', () => {
  const solver = new ThermalLbmSolver(createCavityGrid(10, 4), {
    initial_temp_c: 0.5,
    reference_temp_c: 0.5,
    buoyancy: 0.05,
  });
  solver.step(250);
  const metrics = cavityMetrics(solver);
  assert.ok(metrics.hot_vertical_velocity > 0, JSON.stringify(metrics));
  assert.ok(metrics.cold_vertical_velocity < 0, JSON.stringify(metrics));
  assert.ok(Math.abs(metrics.top_horizontal_velocity) > 1e-4, JSON.stringify(metrics));
  assert.ok(Math.abs(metrics.bottom_horizontal_velocity) > 1e-4, JSON.stringify(metrics));
  assert.ok(metrics.hot_temperature > metrics.cold_temperature);
});

test('3D cubic heated cavity remains finite and stable', () => {
  const solver = new ThermalLbmSolver(createCavityGrid(9, 9), {
    initial_temp_c: 0.5,
    reference_temp_c: 0.5,
    buoyancy: 5e-4,
  });
  solver.step(250);
  const stats = solver.stats();
  const metrics = cavityMetrics(solver);
  assert.ok(stats.max_speed_lu > 0);
  assert.ok(stats.max_speed_lu < 0.5);
  assert.ok(stats.min_temperature_c >= -0.01);
  assert.ok(stats.max_temperature_c <= 1.01);
  assert.ok(metrics.hot_vertical_velocity > 0);
  assert.ok(metrics.cold_vertical_velocity < 0);
});

test('heater watts add energy and drive buoyant motion', () => {
  const grid = isothermalGrid(8);
  const index = (3 * 8 + 3) * 8 + 3;
  grid.cell_type[index] = 2;
  grid.heater_sources = [{ index, watts: 1000 }];
  const solver = new ThermalLbmSolver(grid, { initial_temp_c: 0.5, reference_temp_c: 0.5 });
  solver.step(5);
  const stats = solver.stats();
  assert.ok(stats.max_temperature_c > 0.5);
  assert.ok(stats.max_speed_lu > 0);
  assert.ok(stats.source_energy_j > 0);
  assert.ok(stats.air_energy_change_j > 0);
  assert.ok(Math.abs(stats.energy_residual_j) < 1e-6);
});
