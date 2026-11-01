import test from 'node:test';
import assert from 'node:assert/strict';
import { runSimulation } from './run.js';

const floorplan = {
  ceiling_height_m: 2,
  rooms: [{ id: 'room', polygon: [[0, 0], [2, 0], [2, 2], [0, 2]] }],
  walls: [
    { a: [0, 0], b: [2, 0], exposure: 'exterior' },
    { a: [2, 0], b: [2, 2], exposure: 'exterior' },
    { a: [2, 2], b: [0, 2], exposure: 'exterior' },
    { a: [0, 2], b: [0, 0], exposure: 'exterior' },
  ],
};

const scenario = {
  initial_temp_c: 16,
  outside_temp_c: 8,
  duration_s: 10,
  frame_every_s: 5,
  steps_per_frame: 1,
  cell_m: 0.5,
  heaters: [{ position_m: [1, 1], height_m: 0.3, watts: 1000, room_id: 'room' }],
};

test('solver driver emits grid, t0/final frames, progress and done', async () => {
  const messages = [];
  await runSimulation({ floorplan, scenario }, (message) => messages.push(message), () => false);
  assert.equal(messages[0].type, 'grid');
  const frames = messages.filter((message) => message.type === 'frame');
  assert.deepEqual(frames.map((message) => message.frame.time_s), [0, 5, 10]);
  const n = messages[0].grid.nx * messages[0].grid.nz * messages[0].grid.ny;
  for (const { frame } of frames) {
    assert.equal(frame.temperature_c.length, n);
    assert.equal(frame.velocity_m_s.length, 3 * n);
    assert.ok(frame.temperature_c.every(Number.isFinite));
  }
  assert.equal(messages.at(-1).type, 'done');
  assert.equal(messages.at(-1).stats.solver, 'D3Q19-D3Q7');
  assert.equal(messages.at(-1).stats.uncalibrated, true);
});

test('solver driver stops promptly when cancelled', async () => {
  let frames = 0;
  await runSimulation({ floorplan, scenario: { ...scenario, duration_s: 1000 } }, (message) => {
    if (message.type === 'frame') frames += 1;
  }, () => frames >= 2);
  assert.equal(frames, 2);
});
