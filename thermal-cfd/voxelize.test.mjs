import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { voxelize } from './voxelize.js';

const demo = JSON.parse(readFileSync(new URL('../data/demo-floorplan.json', import.meta.url)));

function cellAt(grid, x, z, iy = 2) {
  const ix = Math.floor((x - grid.origin_m[0]) / grid.cell_m);
  const iz = Math.floor((z - grid.origin_m[1]) / grid.cell_m);
  return (iy * grid.nz + iz) * grid.nx + ix;
}

function reachable(grid, start, iy = 2) {
  const first = cellAt(grid, start[0], start[1], iy);
  const queue = [first];
  const seen = new Uint8Array(grid.cell_type.length);
  seen[first] = 1;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    const ix = index % grid.nx;
    const iz = Math.floor(index / grid.nx) % grid.nz;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = ix + dx;
      const z = iz + dz;
      if (x < 0 || x >= grid.nx || z < 0 || z >= grid.nz) continue;
      const next = (iy * grid.nz + z) * grid.nx + x;
      if (!seen[next] && grid.cell_type[next] !== 1) {
        seen[next] = 1;
        queue.push(next);
      }
    }
  }
  return seen;
}

function twoRooms(wallX = 4, thickness = 0.1, openings = []) {
  return {
    ceiling_height_m: 2.5,
    rooms: [
      { id: 'left', polygon: [[0, 0], [wallX, 0], [wallX, 4], [0, 4]] },
      { id: 'right', polygon: [[wallX, 0], [8, 0], [8, 4], [wallX, 4]] },
    ],
    walls: [
      { id: 'north', a: [0, 0], b: [8, 0], exposure: 'exterior' },
      { id: 'east', a: [8, 0], b: [8, 4], exposure: 'exterior' },
      { id: 'south', a: [8, 4], b: [0, 4], exposure: 'exterior' },
      { id: 'west', a: [0, 4], b: [0, 0], exposure: 'exterior' },
      { id: 'partition', a: [wallX, 0], b: [wallX, 4], thickness_m: thickness, exposure: 'interior' },
    ],
    openings,
  };
}

test('demo boundary-centred walls separate all three rooms', () => {
  const grid = voxelize(demo, 0.25);
  const hall = reachable(grid, [2, 2]);
  assert.equal(hall[cellAt(grid, [2, 6][0], 6)], 0);
  assert.equal(hall[cellAt(grid, 6, 6)], 0);
  const workshop = reachable(grid, [2, 6]);
  assert.equal(workshop[cellAt(grid, 6, 6)], 0);
});

test('thin off-lattice wall cannot vanish', () => {
  const grid = voxelize(twoRooms(3.97, 0.02), 0.23);
  assert.equal(reachable(grid, [2, 2])[cellAt(grid, 6, 2)], 0);
});

test('a door opening reconnects adjacent rooms', () => {
  const plan = twoRooms(4, 0.1, [{ wall: 'partition', t: 0.5, width_m: 1, height_m: 2, type: 'door' }]);
  const grid = voxelize(plan, 0.25);
  assert.equal(reachable(grid, [2, 2])[cellAt(grid, 6, 2)], 1);
});

test('diagonal wall has no four-neighbour leak', () => {
  const plan = {
    ceiling_height_m: 2.5,
    rooms: [{ id: 'room', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] }],
    walls: [
      { a: [0, 0], b: [4, 0], exposure: 'exterior' },
      { a: [4, 0], b: [4, 4], exposure: 'exterior' },
      { a: [4, 4], b: [0, 4], exposure: 'exterior' },
      { a: [0, 4], b: [0, 0], exposure: 'exterior' },
      { a: [0, 0], b: [4, 4], thickness_m: 0.05, exposure: 'interior' },
    ],
  };
  const grid = voxelize(plan, 0.2);
  assert.equal(reachable(grid, [1, 3])[cellAt(grid, 3, 1)], 0);
});

test('heater watts are conserved across active plume source cells', () => {
  const grid = voxelize(demo, 0.25, [{ position_m: [2, 2], height_m: 0.3, watts: 1500, room_id: 'lounge' }]);
  const index = cellAt(grid, 2, 2, 1);
  assert.equal(grid.cell_type[index], 2);
  assert.equal(grid.heater_sources.length, 3);
  assert.equal(grid.heater_sources.reduce((sum, source) => sum + source.watts, 0), 1500);
  assert.deepEqual(grid.heater_sources.map((source) => source.watts), [750, 450, 300]);
});

test('furniture AABBs block overlapped cells only through their height', () => {
  const obstacles = [{ id: 'table', type: 'table', x0: 1.8, z0: 1.8, x1: 2.2, z1: 2.2, height_m: 0.5 }];
  const grid = voxelize(demo, 0.25, [{ position_m: [2, 2], height_m: 0.3, watts: 1500 }], obstacles);
  assert.equal(grid.cell_type[cellAt(grid, 2, 2, 0)], 1);
  assert.equal(grid.cell_type[cellAt(grid, 2, 2, 1)], 1);
  assert.notEqual(grid.cell_type[cellAt(grid, 2, 2, 2)], 1);
  assert.equal(grid.heater_sources.length, 3);
  assert.notEqual(grid.heater_sources[0].index, cellAt(grid, 2, 2, 1));
});
