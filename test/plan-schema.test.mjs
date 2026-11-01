import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizePlan } from '../src/plan-schema.js';
import { validate } from '../src/plan-ops.js';
const demo = JSON.parse(readFileSync(new URL('../data/demo-floorplan.json', import.meta.url)));

// the shipped demo round-trips and stays valid
const ok = normalizePlan(demo);
assert.deepEqual(validate(ok), []);
assert.equal(ok.walls.length, demo.walls.length);
assert.equal(ok.walls[0].exposure, 'exterior');

// hostile / sloppy input is neutralised
const evil = normalizePlan({
  name: '<img src=x onerror=alert(1)>',
  ceiling_height_m: '2.7" onfocus="alert(1)',
  rooms: [{ id: '"><script>', name: '<b>x</b>', color: 'red;background:url(x)', polygon: [[0, 0], [4, 0], [4, 4]], extra: 1 }],
  walls: [{ a: [0, 0], b: [4, 0], thickness_m: 9999, material_id: '"><svg onload=1>', exposure: 'weird', __proto__: { x: 1 } }],
  openings: [{ wall: '<x>', type: 'window', width: 'abc' }, null, 5],
});
assert.equal(evil.ceiling_height_m, 2.7);                       // junk string -> default, never reaches the DOM
assert.match(evil.rooms[0].id, /^room-1$/);                      // bad id replaced
assert.match(evil.rooms[0].color, /^#[0-9a-f]{6}$/i);            // css injection impossible
assert.equal(evil.walls[0].thickness_m, 1);                      // clamped
assert.equal(evil.walls[0].material_id, 'plasterboard');         // bad material -> default
assert.equal(evil.walls[0].exposure, 'interior');
assert.equal(evil.openings.length, 1);
assert.equal(evil.openings[0].wall, undefined);
assert.ok(!('extra' in evil.rooms[0]));
assert.equal(typeof evil.name, 'string');                        // (escaped at render time by esc())

// structural garbage is rejected with a readable message
for (const bad of [null, [], {}, { rooms: [], walls: [] }, { rooms: [{ polygon: [[0, 0], [1, 1]] }], walls: [] }, { rooms: [{ polygon: [[0, 0], [1, 0], ['a', 1]] }], walls: [] }, { rooms: [{ polygon: [[0, 0], [1e9, 0], [1, 1]] }], walls: [] }]) assert.throws(() => normalizePlan(bad));
console.log('plan-schema: all passed');

// an AI draft (converter output) passes through unchanged in substance
import { draftToFloorplan } from '../src/draft.js';
const sq = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const { floorplan: drafted } = draftToFloorplan({ rooms: [{ name: 'A', polygon: sq(100, 100, 600, 500) }, { name: 'B', polygon: sq(600, 100, 900, 500) }], walls: [{ a: { x: 100, y: 100 }, b: { x: 900, y: 100 }, exterior: true }], printed_overall_width_m: 8, notes: '' }, { imgW: 800, imgH: 400 });
const n = normalizePlan(drafted);
assert.equal(n.rooms.length, 2);
assert.equal(n.walls.length, drafted.walls.length);
assert.deepEqual(validate(n), []);
assert.equal(n.draft.reviewed, false);
console.log('plan-schema (draft passthrough): passed');
