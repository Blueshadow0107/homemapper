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

export function draftToFloorplan(raw, { imgW, imgH, name = 'Uploaded plan', widthHintM = null } = {}) {
  const warnings = [];
  const num = (v) => (Number.isFinite(v) ? v : null);
  const P = (p) => (num(p?.x) !== null && num(p?.y) !== null ? [Math.min(1000, Math.max(0, p.x)), Math.min(1000, Math.max(0, p.y))] : null);
  const rectOf = (pts) => { const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]); return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)], [Math.min(...xs), Math.max(...ys)]]; };
  const polyArea = (pts) => Math.abs(pts.reduce((a, p, j) => { const q = pts[(j + 1) % pts.length]; return a + (p[0] * q[1] - q[0] * p[1]); }, 0) / 2);
  let rectified = 0;
  const rooms0 = (raw.rooms ?? []).map((r) => {
    let pts = (r.polygon ?? []).map(P).filter(Boolean);
    const bx = r.box && [r.box.x0, r.box.y0, r.box.x1, r.box.y1].every(Number.isFinite) ? [P({ x: r.box.x0, y: r.box.y0 }), P({ x: r.box.x1, y: r.box.y1 })] : null;
    if (r.rectangular && bx && bx[1][0] > bx[0][0] && bx[1][1] > bx[0][1]) pts = rectOf(bx); // rectangle straight from the box: no corner can come out skewed
    else if (pts.length >= 3 && pts.length <= 5) { // a near-rectangle drawn with skewed corners -> straighten it
      const rc = rectOf(pts);
      if (polyArea(pts) / Math.max(1e-9, polyArea(rc)) > 0.65 && polyArea(pts) / Math.max(1e-9, polyArea(rc)) < 0.999) { pts = rc; rectified++; }
    }
    return { name: String(r.name ?? 'Room').slice(0, 40), pts };
  }).filter((r) => r.pts.length >= 3);
  if (rectified) warnings.push(`Straightened ${rectified} room outline(s) that came back slanted.`);
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
  if (num(widthHintM) > 0 && widthPx > 0) {
    mPerPx = widthHintM / widthPx;
    warnings.push(`Scale set from the width you entered (${(+widthHintM).toFixed(2)} m) — it is applied to the overall extent the model drew, so check a wall.`);
  } else if (num(raw.printed_overall_width_m) > 0 && widthPx > 0) {
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

  // ---- completeness: structural validity says nothing about whether the drawing was fully read
  const modelWalls = walls1.length;
  const area = (r) => Math.abs(r.polygon.reduce((a, p, j) => { const q = r.polygon[(j + 1) % r.polygon.length]; return a + (p[0] * q[1] - q[0] * p[1]); }, 0) / 2);
  const roomArea = fp.rooms.reduce((a, r) => a + area(r), 0);
  const bboxArea = (Math.max(...fp.rooms.flatMap((r) => r.polygon.map((p) => p[0]))) - Math.min(...fp.rooms.flatMap((r) => r.polygon.map((p) => p[0])))) * (Math.max(...fp.rooms.flatMap((r) => r.polygon.map((p) => p[1]))) - Math.min(...fp.rooms.flatMap((r) => r.polygon.map((p) => p[1]))));
  const coverage = bboxArea > 0 ? roomArea / bboxArea : 0;
  const addedShare = added / Math.max(1, fp.walls.length);
  const omitted = (Array.isArray(raw.omitted_or_uncertain) ? raw.omitted_or_uncertain : []).map((t) => String(t).slice(0, 160)).slice(0, 8);
  let strikes = 0;
  if (Number(raw.plan_count) > 1) { strikes++; warnings.push(`The image shows ${raw.plan_count} plans; only one was extracted. Crop the plan you want and upload again for a better read.`); }
  if (addedShare > 0.3) { strikes += addedShare > 0.5 ? 3 : 2; warnings.push(`INCOMPLETE? The model drew only ${modelWalls} walls; ${added} of ${fp.walls.length} walls were filled in automatically from room outlines.`); }
  if (coverage < 0.7) { strikes++; warnings.push(`Rooms cover only ${Math.round(coverage * 100)}% of the footprint — some rooms or spaces are probably missing.`); }
  for (const o of omitted) { strikes++; warnings.push(`Model says: ${o}`); }
  if (raw.notes) warnings.push(`Model notes: ${String(raw.notes).slice(0, 300)}`);
  if (/\b(missing|incomplete|partial|limited|unclear|not extracted|omitted|hard to|tricky|difficult)\b/i.test(String(raw.notes ?? ''))) strikes++; // the model hedged: believe it
  const quality = strikes >= 2 ? 'poor' : strikes >= 1 ? 'review' : 'ok';
  fp.draft.quality = quality;
  warnings.unshift(quality === 'poor' ? 'LOOKS INCOMPLETE — expect to add rooms/walls by hand, or crop to one plan and retry.' : quality === 'review' ? 'Check for missing rooms/walls before trusting this.' : 'No obvious gaps detected — still verify corners, names and scale.');

  const underlay = { x: r2(-pxX(minX) * mPerPx), y: r2(-pxY(minY) * mPerPx), w: imgW * mPerPx, h: imgH * mPerPx };
  return { floorplan: fp, underlay, warnings, quality };
}
