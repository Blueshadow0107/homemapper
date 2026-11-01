import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as ops from '../src/plan-ops.js';
import { normalizePlan } from '../src/plan-schema.js';
import { footprintRect, furnitureObstacles, normRot } from '../src/furniture-geometry.js';
import { buildGrid } from '../src/cfd/fixture.js';
const rd = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const demo = rd('../data/demo-floorplan.json');
const catalog = rd('../assets/furniture/catalog.json');

let fp = ops.addFurniture(demo, 'sofa', [4, 2]);
fp = ops.addFurniture(fp, 'wardrobe', [6, 6], 90);
fp = ops.addFurniture(fp, 'plant', [1, 1]);               // not solid
assert.equal(fp.furniture.length, 3);
assert.equal(demo.furniture, undefined);                   // original untouched
assert.notEqual(fp.furniture[0].id, fp.furniture[1].id);

// rotation: 90° swaps footprint, snaps odd inputs
assert.equal(normRot(-90), 270); assert.equal(normRot(100), 90); assert.equal(normRot(360), 0);
const sofa = catalog.items.find((i) => i.id === 'sofa');
const r0 = footprintRect(sofa, fp.furniture[0]);
assert.ok(Math.abs(r0.w - 2.0) < 1e-9 && Math.abs(r0.d - 0.95) < 1e-9);
const r90 = footprintRect(sofa, ops.rotateFurniture(fp, 0).furniture[0]);
assert.ok(Math.abs(r90.w - 0.95) < 1e-9 && Math.abs(r90.d - 2.0) < 1e-9);
assert.equal(ops.rotateFurniture(ops.rotateFurniture(ops.rotateFurniture(ops.rotateFurniture(fp, 0), 0), 0), 0).furniture[0].rotation_deg, 0);

// obstacles: only solid items, as boxes with real heights
const obs = furnitureObstacles(fp, catalog);
assert.deepEqual(obs.map((o) => o.type).sort(), ['sofa', 'wardrobe']);
assert.equal(obs.find((o) => o.type === 'wardrobe').height_m, 2.0);

// move/delete
assert.deepEqual(ops.moveFurniture(fp, 0, [5, 5]).furniture[0].position_m, [5, 5]);
assert.equal(ops.deleteFurniture(fp, 1).furniture.length, 2);

// scaling the plan moves positions but not item sizes
const { fp: big } = ops.scaleToLength(fp, 0, 16);
assert.deepEqual(big.furniture[0].position_m, [8, 4]);

// schema: hostile furniture neutralised, valid kept
const n = normalizePlan({ ...demo, furniture: [{ id: '"><x>', type: 'sofa', position_m: [1, 2], rotation_deg: 100 }, { type: '<script>', position_m: [0, 0] }, { type: 'bed_double', position_m: ['a', 1] }].slice(0, 2) });
assert.equal(n.furniture.length, 1);
assert.equal(n.furniture[0].id, 'furn-1');
assert.equal(n.furniture[0].rotation_deg, 90);
assert.throws(() => normalizePlan({ ...demo, furniture: [{ type: 'sofa', position_m: ['a', 1] }] }));

// airflow grid: furniture becomes solid cells up to its height, air above it stays air
const g = buildGrid(demo, 0.25, [], furnitureObstacles(ops.addFurniture(demo, 'wardrobe', [4, 2]), catalog));
const idx = (x, z, iy) => (iy * g.nz + Math.floor((z - g.origin_m[1]) / g.cell_m)) * g.nx + Math.floor((x - g.origin_m[0]) / g.cell_m);
assert.equal(g.cell_type[idx(4, 2, 2)], 1);               // inside wardrobe at 0.6 m
assert.equal(g.cell_type[idx(4, 2, g.ny - 1)], 0);        // above the 2.0 m top = air
assert.equal(g.cell_type[idx(6.5, 2, 2)], 0);             // elsewhere unchanged
console.log('furniture-wiring: all passed');

// ---- radiator == heater: wall snapping + source survives the wall
const radiator = catalog.items.find((i) => i.id === 'radiator');
// click near the north wall (z=0) from inside the main hall -> flush to the wall, facing +z (into the room)
const n1 = ops.snapToWall(demo, radiator, [3, 0.4]);
assert.equal(n1.rotation_deg, 0);
assert.ok(n1.position_m[1] > 0.08 && n1.position_m[1] < 0.2, `radiator should hug the wall, got z=${n1.position_m[1]}`);
assert.equal(n1.position_m[0], 3);
// east wall (x=8) from inside -> faces -x = 90°
const n2 = ops.snapToWall(demo, radiator, [7.6, 2]);
assert.equal(n2.rotation_deg, 90);
assert.ok(n2.position_m[0] < 8 && n2.position_m[0] > 7.8);
// west wall (x=0) -> faces +x = 270°;  south wall (z=8) -> faces -z = 180°
assert.equal(ops.snapToWall(demo, radiator, [0.4, 6]).rotation_deg, 270);
assert.equal(ops.snapToWall(demo, radiator, [2, 7.6]).rotation_deg, 180);
// far from every wall: unchanged
assert.deepEqual(ops.snapToWall({ ...demo, walls: [demo.walls[0]] }, radiator, [4, 7]), { position_m: [4, 7], rotation_deg: 0 });
// watts survive the schema; junk watts clamp
assert.equal(normalizePlan({ ...demo, furniture: [{ type: 'radiator', position_m: [1, 1], watts: 99999 }] }).furniture[0].watts, 5000);
assert.equal(normalizePlan({ ...demo, furniture: [{ type: 'radiator', position_m: [1, 1], watts: 'x' }] }).furniture[0].watts, 1500);
assert.equal(normalizePlan({ ...demo, furniture: [{ type: 'sofa', position_m: [1, 1] }] }).furniture[0].watts, undefined);
// the snapped radiator's heat source still lands in an air cell even though it hugs the wall
const gr = buildGrid(demo, 0.25, [{ position_m: n1.position_m, watts: 1500, height_m: 0.3 }], []);
assert.equal(gr.cell_type.filter((c) => c === 2).length, 1);
console.log('radiator-as-heater: passed');
