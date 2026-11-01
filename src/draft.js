// Vision extraction (normalized 0-1000 image coords) -> editable floorplan (metres) + an image underlay for review.
// Pure: no DOM, no network. The AI output is a DRAFT: scale and walls are flagged for the user to check in the editor.
import { addWall, edgeWalled } from './plan-ops.js';

const COLORS = ['#d8cdf6', '#c5dff0', '#d1eadc', '#f3d9c4', '#f0cfe0', '#e6e3b8'];
const ASSUMED_LONGEST_SIDE_M = 12;

function cluster1d(values, tol) {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const map = new Map();
  let group = [];
  const flush = () => {
    if (!group.length) return;
    const avg = group.reduce((a, b) => a + b, 0) / group.length;
    for (const g of group) map.set(g, avg);
    group = [];
  };
  for (const v of sorted) {
    if (group.length && v - group[group.length - 1] > tol) flush();
    group.push(v);
  }
  flush();
  return (v) => map.get(v);
}

export function draftToFloorplan(raw, { imgW, imgH, name = 'Uploaded plan' } = {}) {
  const warnings = [];
  const num = (v) => (Number.isFinite(v) ? v : null);
  const P = (p) => (num(p?.x) !== null && num(p?.y) !== null ? [Math.min(1000, Math.max(0, p.x)), Math.min(1000, Math.max(0, p.y))] : null);
  const rooms0 = (raw.rooms ?? []).map((r) => ({ name: String(r.name ?? 'Room').slice(0, 40), pts: (r.polygon ?? []).map(P).filter(Boolean) })).filter((r) => r.pts.length >= 3);
  const walls0 = (raw.walls ?? []).map((w) => ({ a: P(w.a), b: P(w.b), ext: Boolean(w.exterior) })).filter((w) => w.a && w.b);
  if (!rooms0.length) throw new Error('No rooms found in the image — try a clearer plan or draw it in the editor.');

  // 1. snap near-equal coordinates together so rectilinear plans close up exactly
  const allPts = [...rooms0.flatMap((r) => r.pts), ...walls0.flatMap((w) => [w.a, w.b])];
  const sx = cluster1d(allPts.map((p) => p[0]), 12);
  const sy = cluster1d(allPts.map((p) => p[1]), 12);
  const snap = (p) => [sx(p[0]), sy(p[1])];
  const rooms1 = rooms0.map((r) => ({ ...r, pts: r.pts.map(snap) }));
  const walls1 = walls0.map((w) => ({ ...w, a: snap(w.a), b: snap(w.b) }));

  // 2. scale: printed dimension if the model saw one, otherwise an assumption we shout about
  // bounds from rooms + real walls only: a stray zero-length wall must not move the origin or skew the scale
  const all = [...rooms1.flatMap((r) => r.pts), ...walls1.filter((w) => w.a[0] !== w.b[0] || w.a[1] !== w.b[1]).flatMap((w) => [w.a, w.b])];
  const minX = Math.min(...all.map((p) => p[0]));
  const maxX = Math.max(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1]));
  const maxY = Math.max(...all.map((p) => p[1]));
  const pxX = (v) => (v / 1000) * imgW;
  const pxY = (v) => (v / 1000) * imgH;
  const widthPx = pxX(maxX) - pxX(minX);
  const heightPx = pxY(maxY) - pxY(minY);
  let mPerPx;
  if (num(raw.printed_overall_width_m) > 0 && widthPx > 0) {
    mPerPx = raw.printed_overall_width_m / widthPx;
    warnings.push(`Scale taken from a printed width of ${raw.printed_overall_width_m} m — verify it.`);
  } else {
    mPerPx = ASSUMED_LONGEST_SIDE_M / Math.max(widthPx, heightPx);
    warnings.push(`Scale is a GUESS (longest side = ${ASSUMED_LONGEST_SIDE_M} m). Select a wall, type its real length and press "Set plan scale".`);
  }
  const r2 = (v) => +(Math.round(v / 0.05) * 0.05).toFixed(3);
  const toM = (p) => [r2((pxX(p[0]) - pxX(minX)) * mPerPx), r2((pxY(p[1]) - pxY(minY)) * mPerPx)];

  // 3. rooms
  const rooms = [];
  rooms1.forEach((r, i) => {
    const polygon = r.pts.map(toM).filter((p, j, arr) => j === 0 || p[0] !== arr[j - 1][0] || p[1] !== arr[j - 1][1]);
    const area = Math.abs(polygon.reduce((a, p, j) => { const q = polygon[(j + 1) % polygon.length]; return a + (p[0] * q[1] - q[0] * p[1]); }, 0) / 2);
    if (polygon.length < 3 || area < 0.5) return warnings.push(`Dropped degenerate room "${r.name}".`);
    rooms.push({ id: `room-${rooms.length + 1}`, name: r.name, polygon, color: COLORS[i % COLORS.length] });
  });

  // 4. walls (dedupe, drop zero length)
  let fp = {
    schema_version: 1,
    name,
    units: 'm',
    ceiling_height_m: 2.7,
    rooms,
    walls: [],
    openings: [],
    draft: { source: 'vision', reviewed: false },
  };
  const key = (a, b) => (a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? `${a}|${b}` : `${b}|${a}`);
  const seen = new Set();
  let dropped = 0;
  for (const w of walls1) {
    const a = toM(w.a);
    const b = toM(w.b);
    if (a[0] === b[0] && a[1] === b[1]) { dropped++; continue; }
    const k = key(a, b);
    if (seen.has(k)) { dropped++; continue; }
    seen.add(k);
    fp = addWall(fp, a, b, w.ext ? { exposure: 'exterior', type: 'exterior', material_id: 'brick', thickness_m: 0.16 } : { type: 'interior' });
  }
  if (dropped) warnings.push(`Ignored ${dropped} duplicate/zero-length wall(s).`);

  // 5. every room edge needs a wall or signal/heat would leak — add what the model missed
  let added = 0;
  for (const r of fp.rooms) {
    r.polygon.forEach((p, i) => {
      const q = r.polygon[(i + 1) % r.polygon.length];
      if (!edgeWalled(fp, p, q)) { fp = addWall(fp, p, q, { type: 'interior' }); added++; }
    });
  }
  if (added) warnings.push(`Added ${added} wall(s) along room edges the model did not draw — check them.`);
  if (raw.notes) warnings.push(`Model notes: ${String(raw.notes).slice(0, 300)}`);

  const underlay = { x: r2(-pxX(minX) * mPerPx), y: r2(-pxY(minY) * mPerPx), w: imgW * mPerPx, h: imgH * mPerPx };
  return { floorplan: fp, underlay, warnings };
}
