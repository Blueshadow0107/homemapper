import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { items } = JSON.parse(readFileSync(new URL('../assets/furniture/catalog.json', import.meta.url)));
const TOL = 0.06; // parts may overhang the declared box slightly (arms, handles)
assert.ok(items.length >= 15);
assert.equal(new Set(items.map((i) => i.id)).size, items.length);
for (const it of items) {
  const [W, H, D] = it.size_m;
  assert.ok(W > 0 && H > 0 && D > 0, it.id);
  assert.deepEqual(it.footprint_m, [W, D], it.id);
  for (const p of it.parts) {
    const [x, y, z] = p.pos;
    const [w, h, d] = p.size;
    assert.match(p.color, /^#[0-9a-fA-F]{6}$/, it.id);
    assert.ok(y - h / 2 >= -1e-6, `${it.id}: part below the floor`);
    assert.ok(Math.abs(x) + w / 2 <= W / 2 + TOL, `${it.id}: part sticks out in x`);
    assert.ok(Math.abs(z) + d / 2 <= D / 2 + TOL, `${it.id}: part sticks out in z`);
    assert.ok(y + h / 2 <= H + TOL, `${it.id}: part above declared height`);
  }
}
console.log(`furniture: ${items.length} items valid`);
