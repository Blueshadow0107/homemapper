import assert from 'node:assert/strict';
import { draftToFloorplan } from '../src/draft.js';
import { validate } from '../src/plan-ops.js';
const sq = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const W = (ax, ay, bx, by, exterior) => ({ a: { x: ax, y: ay }, b: { x: bx, y: by }, exterior });

// slightly messy (corners off by a few units, like real vision output), no printed scale, one missing + one duplicate wall
const raw = {
  rooms: [{ name: 'A', polygon: sq(100, 100, 603, 500) }, { name: 'B', polygon: sq(598, 102, 900, 497) }],
  walls: [W(100, 100, 900, 100, true), W(900, 100, 900, 500, true), W(900, 500, 100, 500, true), W(100, 500, 100, 100, true), W(600, 100, 600, 500, false), W(600, 100, 601, 500, false), W(50, 50, 50, 50, false)],
  printed_overall_width_m: null,
  notes: 'test',
};
const { floorplan: fp, underlay, warnings } = draftToFloorplan(raw, { imgW: 1000, imgH: 500 });
assert.equal(fp.rooms.length, 2);
assert.deepEqual(validate(fp), []);                     // closed up despite jitter
assert.equal(fp.walls.length, 5);                       // 4 exterior + 1 shared partition (dup + zero-length dropped)
const xs = fp.rooms.flatMap((r) => r.polygon.map((p) => p[0]));
assert.equal(Math.min(...xs), 0);
assert.equal(Math.max(...xs), 12);                      // longest side assumed 12 m
assert.ok(warnings.some((w) => w.includes('GUESS')));
assert.ok(fp.walls.filter((w) => w.exposure === 'exterior').every((w) => w.material_id === 'brick'));
assert.ok(underlay.w > 0 && underlay.h > 0);

// printed width wins over the guess
const { floorplan: fp2, warnings: w2 } = draftToFloorplan({ ...raw, printed_overall_width_m: 8 }, { imgW: 1000, imgH: 500 });
assert.equal(Math.max(...fp2.rooms.flatMap((r) => r.polygon.map((p) => p[0]))), 8);
assert.ok(!w2.some((w) => w.includes('GUESS')));

// missing room-edge walls get filled and reported
const { floorplan: fp3, warnings: w3 } = draftToFloorplan({ ...raw, walls: [W(100, 100, 900, 100, true)] }, { imgW: 1000, imgH: 500 });
assert.deepEqual(validate(fp3), []);
assert.ok(w3.some((w) => w.startsWith('Added')));

// nothing usable -> clear error
assert.throws(() => draftToFloorplan({ rooms: [], walls: [] }, { imgW: 10, imgH: 10 }), /No rooms/);
console.log('draft: all passed');
