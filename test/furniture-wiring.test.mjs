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
