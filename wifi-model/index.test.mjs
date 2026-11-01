import test from 'node:test';
import assert from 'node:assert/strict';
import { predict } from './index.js';

const floorplan = {
  rooms: [{ id: 'hall', polygon: [[0, 0], [12, 0], [12, 2], [0, 2]] }],
  walls: [{ id: 'partition', a: [5, 0], b: [5, 2], exposure: 'interior', material_id: 'plasterboard' }],
  openings: [],
};

function atTenMetres(router) {
  const field = predict({ position_m: [0.25, 0.75], height_m: 1, ...router }, floorplan, 0.5);
  return field.cells.find((cell) => cell.position_m[0] === 10.25 && cell.position_m[1] === 0.75).estimated_rssi_dbm;
}

test('defaults give a plausible 10 m plus plasterboard estimate at 2.4 GHz', () => {
  assert.ok(Math.abs(atTenMetres({ frequency_hz: 2.4e9 }) - -57.05) < 0.01);
});

test('5 GHz includes higher reference and plasterboard loss', () => {
  assert.ok(Math.abs(atTenMetres({ frequency_hz: 5e9 }) - -64.43) < 0.01);
});

test('tx power and path-loss exponent can be calibrated explicitly', () => {
  const calibrated = atTenMetres({ frequency_hz: 2.4e9, tx_power_dbm: 20, path_loss_exponent: 2 });
  assert.ok(Math.abs(calibrated - -44.05) < 0.01);
});

test('rejects an invalid path-loss exponent', () => {
  assert.throws(() => atTenMetres({ path_loss_exponent: 0 }), /path_loss_exponent/);
});
