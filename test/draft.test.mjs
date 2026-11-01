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

// ---- completeness scoring + user-supplied width
const sq2 = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const W2 = (ax, ay, bx, by, exterior) => ({ a: { x: ax, y: ay }, b: { x: bx, y: by }, exterior });
const good = { rooms: [{ name: 'A', polygon: sq2(100, 100, 500, 500) }, { name: 'B', polygon: sq2(500, 100, 900, 500) }],
  walls: [W2(100, 100, 900, 100, true), W2(900, 100, 900, 500, true), W2(900, 500, 100, 500, true), W2(100, 500, 100, 100, true), W2(500, 100, 500, 500, false)],
  printed_overall_width_m: null, plan_count: 1, omitted_or_uncertain: [], notes: '' };
const ok = draftToFloorplan(good, { imgW: 800, imgH: 400 });
assert.equal(ok.quality, 'ok');
assert.equal(ok.floorplan.draft.reviewed, false);
assert.equal(ok.floorplan.draft.quality, 'ok');
assert.ok(ok.warnings[0].startsWith('No obvious gaps'));

// user's width beats a printed width and the guess; scale is exact for the overall extent
const hint = draftToFloorplan({ ...good, printed_overall_width_m: 99 }, { imgW: 800, imgH: 400, widthHintM: 9 });
assert.equal(Math.max(...hint.floorplan.rooms.flatMap((r) => r.polygon.map((p) => p[0]))), 9);
assert.ok(hint.warnings.some((w) => w.includes('width you entered')));

// model drew almost no walls -> the converter filled them in -> flagged INCOMPLETE
const thin = draftToFloorplan({ ...good, walls: [W2(100, 100, 900, 100, true)] }, { imgW: 800, imgH: 400 });
assert.equal(thin.quality, 'poor');
assert.ok(thin.warnings[0].startsWith('LOOKS INCOMPLETE'));
assert.ok(thin.warnings.some((w) => w.startsWith('INCOMPLETE?')));

// several plans / omissions / low room coverage each raise the flag
const multi = draftToFloorplan({ ...good, plan_count: 2, omitted_or_uncertain: ['small washroom not extracted'] }, { imgW: 800, imgH: 400 });
assert.equal(multi.quality, 'poor'); // two independent warning signs
assert.ok(multi.warnings.some((w) => w.includes('shows 2 plans')));
const many = draftToFloorplan({ ...good, plan_count: 2, omitted_or_uncertain: ['small washroom not extracted', 'balcony unclear'] }, { imgW: 800, imgH: 400 });
assert.equal(many.quality, 'poor');
assert.ok(multi.warnings.some((w) => w.includes('washroom')));
const sparse = draftToFloorplan({ rooms: [{ name: 'A', polygon: sq2(100, 100, 300, 300) }, { name: 'B', polygon: sq2(700, 700, 900, 900) }], walls: [W2(100, 100, 300, 100, true), W2(300, 100, 300, 300, true), W2(300, 300, 100, 300, true), W2(100, 300, 100, 100, true), W2(700, 700, 900, 700, true), W2(900, 700, 900, 900, true), W2(900, 900, 700, 900, true), W2(700, 900, 700, 700, true)], printed_overall_width_m: null, plan_count: 1, omitted_or_uncertain: [], notes: '' }, { imgW: 800, imgH: 800 });
assert.ok(sparse.warnings.some((w) => w.includes('cover only')));
assert.notEqual(sparse.quality, 'ok');
console.log('draft quality: passed');

// the model's own hedging counts against a draft
const lone = draftToFloorplan({ ...good, plan_count: 2 }, { imgW: 800, imgH: 400 });
assert.equal(lone.quality, 'review'); // a single sign only asks for a check
const hedge = draftToFloorplan({ ...good, notes: 'Limited details and some missing or unclear areas.' }, { imgW: 800, imgH: 400 });
assert.equal(hedge.quality, 'review');
const hedgeCover = draftToFloorplan({ ...sparseRaw(), notes: 'Limited details and some missing or unclear areas.' }, { imgW: 800, imgH: 800 });
assert.equal(hedgeCover.quality, 'poor');
function sparseRaw() { return { rooms: [{ name: 'A', polygon: sq2(100, 100, 300, 300) }, { name: 'B', polygon: sq2(700, 700, 900, 900) }], walls: [W2(100, 100, 300, 100, true), W2(300, 100, 300, 300, true), W2(300, 300, 100, 300, true), W2(100, 300, 100, 100, true), W2(700, 700, 900, 700, true), W2(900, 700, 900, 900, true), W2(900, 900, 700, 900, true), W2(700, 900, 700, 700, true)], printed_overall_width_m: null, plan_count: 1, omitted_or_uncertain: [] }; }
console.log('draft hedging: passed');

// ---- rectangle-first extraction: box wins over polygon; skewed quads are straightened
{
  const raw = { rooms: [{ name: 'K', rectangular: true, box: { x0: 100, y0: 100, x1: 500, y1: 500 }, polygon: [] }, { name: 'S', rectangular: false, box: { x0: 500, y0: 100, x1: 900, y1: 500 }, polygon: [{ x: 500, y: 100 }, { x: 900, y: 120 }, { x: 880, y: 500 }, { x: 510, y: 480 }] }], walls: [], printed_overall_width_m: null, plan_count: 1, omitted_or_uncertain: [], notes: '' };
  const d = draftToFloorplan(raw, { imgW: 800, imgH: 800 });
  const axisAligned = (r) => r.polygon.length === 4 && r.polygon[0][1] === r.polygon[1][1] && r.polygon[1][0] === r.polygon[2][0];
  assert.ok(d.floorplan.rooms.every(axisAligned), 'rooms are axis-aligned rectangles');
  assert.ok(d.warnings.some((w) => /Straightened 1/.test(w)));
  console.log('rect-first: passed');
}
