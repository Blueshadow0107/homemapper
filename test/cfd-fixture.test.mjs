import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildGrid, runFixture } from '../src/cfd/fixture.js';
const fp = JSON.parse(readFileSync(new URL('../data/demo-floorplan.json', import.meta.url)));
const heaters = [{ position_m: [2, 2], watts: 1500, room_id: 'lounge' }];

const g = buildGrid(fp, 0.25, heaters);
const idx = (ix, iz, iy) => (iy * g.nz + iz) * g.nx + ix;
const cellAt = (x, z, iy = 3) => g.cell_type[idx(Math.floor((x - g.origin_m[0]) / g.cell_m), Math.floor((z - g.origin_m[1]) / g.cell_m), iy)];
assert.equal(g.cell_type.length, g.nx * g.nz * g.ny);
assert.equal(cellAt(4, 2), 0);          // inside main hall = air
assert.equal(cellAt(-0.1, 2), 1);       // margin cell outside the building = solid
assert.equal(cellAt(2.5, 4), 1);        // on the interior wall y=4 = solid
assert.equal(cellAt(2, 2, 1), 2);       // heater cell (0.3 m default height -> layer 1)
for (const x of [0.5, 2.5, 4.5, 7.5]) for (const iy of [0, 5, g.ny - 1]) assert.equal(cellAt(x, 4, iy), 1, `wall at z=4 leaks at x=${x}, iy=${iy}`); // no gaps
assert.equal(g.ny, Math.ceil(2.7 / 0.25));
assert.ok(g.cell_type.filter((c) => c === 0).length > 100);

// protocol: grid first, frames after, done last, frames have correct sizes; cancel stops it
const msgs = [];
await new Promise((res) => runFixture({ floorplan: fp, scenario: { heaters, duration_s: 900, frame_every_s: 300, cell_m: 0.25 } }, (m) => { msgs.push(m); if (m.type === 'done') res(); }, () => false));
assert.equal(msgs[0].type, 'grid');
const frames = msgs.filter((m) => m.type === 'frame').map((m) => m.frame);
assert.equal(frames.length, 4);
assert.equal(msgs.at(-1).type, 'done');
const n = g.nx * g.nz * g.ny;
assert.equal(frames[0].temperature_c.length, n);
assert.equal(frames[0].velocity_m_s.length, 3 * n);
assert.equal(frames[0].time_s, 0);
assert.ok(frames.at(-1).temperature_c[idx(Math.floor((2 - g.origin_m[0]) / 0.25), Math.floor((2 - g.origin_m[1]) / 0.25), 3)] > 16.5); // heated plume
let stopped = 0;
await new Promise((res) => { runFixture({ floorplan: fp, scenario: { heaters, duration_s: 9000, frame_every_s: 60 } }, (m) => { if (m.type === 'frame') stopped++; }, () => stopped >= 2); setTimeout(res, 200); });
assert.ok(stopped <= 3, `cancel should stop the run, got ${stopped} frames`);
console.log('cfd-fixture: all passed');
