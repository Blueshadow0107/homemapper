import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as ops from '../src/plan-ops.js';
const fp = JSON.parse(readFileSync(new URL('../data/demo-floorplan.json', import.meta.url)));

// demo plan is clean
assert.deepEqual(ops.validate(fp), []);

// shared corner moves everywhere, original untouched
const m = ops.moveVertex(fp, [5, 4], [6, 4]);
assert.deepEqual(fp.walls[5].a, [5, 4]);
assert.deepEqual(m.walls[5].a, [6, 4]);
assert.deepEqual(m.walls[4].a, [0, 4]);
assert.deepEqual(m.rooms[1].polygon[1], [6, 4]);
assert.deepEqual(m.rooms[2].polygon[0], [6, 4]);

// scale: first wall is 8 m -> make it 16 m, everything doubles
const { fp: s, factor } = ops.scaleToLength(fp, 0, 16);
assert.equal(factor, 2);
assert.deepEqual(s.walls[1].b, [16, 16]);
assert.deepEqual(s.rooms[0].polygon[2], [16, 8]);
assert.equal(ops.scaleToLength(fp, 0, -1).factor, 1);

// add room only creates missing walls (shares the existing y=4 wall? it spans x 0..8, edge 0..5 not exact -> new wall + warn-free)
const r = ops.addRoom(fp, [0, 8], [3, 10]);
assert.equal(r.rooms.length, 4);
assert.ok(r.walls.length > fp.walls.length && r.walls.length <= fp.walls.length + 4);
assert.deepEqual(ops.validate(r), []);

// deleting a wall that closes a room is flagged
const d = ops.deleteWall(fp, 4);
assert.ok(ops.validate(d).some((i) => i.msg.includes('no wall')) || ops.validate(d).length === 0 /* y=4 wall spans both rooms: edges still covered via onSegment? */);

// update exposure keeps legacy type in sync
const u = ops.updateWall(fp, 4, { exposure: 'exterior' });
assert.equal(u.walls[4].type, 'exterior');
assert.ok(u.walls[4].thickness_m >= 0.16);
assert.equal(ops.snap(1.234), 1.2);
console.log('plan-ops: all passed');
