import * as ops from './plan-ops.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent?.append(n);
  return n;
};
export const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const h = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
};

/**
 * 2D plan editor. Owns an SVG + toolbar inside `root`; reports every committed or in-progress edit via
 * onChange(fp, {refit?, scaleFactor?}). The plan itself stays plain JSON (docs/data-contract.md).
 */
export function createEditor({ root, plan, onChange, getRouter, onRouterMove, onUploadImage }) {
  let fp = plan;
  const history = [];
  let tool = 'select'; // select | wall | room | router
  let sel = null; // {kind:'wall'|'room', i}
  let drag = null; // {orig:[x,z], base:fp} | {room:true, from:[x,z], to:[x,z]}
  let wallStart = null;
  let hover = null;
  let vb = { x: 0, y: 0, w: 10, h: 10 };
  let underlay = null; // {href,x,y,w,h} faint source image for checking an AI draft
  let banner = null; // {level:'info'|'warn'|'error', items:string[]}
  let showUnderlay = true;

  root.innerHTML = '';
  const bar = h(`<div class="ed-bar">
    <div class="ed-group" role="group" aria-label="tools">
      <button data-tool="select" class="icon-button">Select</button>
      <button data-tool="wall" class="icon-button">Wall</button>
      <button data-tool="room" class="icon-button">Room</button>
      <button data-tool="router" class="icon-button">Router</button>
    </div>
    <div class="ed-group">
      <button data-act="undo" class="icon-button">Undo</button>
      <button data-act="delete" class="icon-button">Delete</button>
    </div>
    <div class="ed-group">
      <button data-act="upload" class="icon-button primary">Upload plan image</button>
      <button data-act="import" class="icon-button">Import JSON</button>
      <button data-act="export" class="icon-button">Export JSON</button>
      <input type="file" accept="application/json,.json" hidden data-kind="json" />
      <input type="file" accept="image/png,image/jpeg,image/webp" hidden data-kind="image" />
    </div>
  </div>`);
  const stage = h('<div class="ed-stage"></div>');
  const svg = el('svg', { class: 'ed-svg', preserveAspectRatio: 'xMidYMid meet' });
  stage.append(svg);
  const side = h('<div class="ed-side"></div>');
  root.append(bar, stage, side);
  const fileInput = bar.querySelector('input[data-kind=json]');
  const imageInput = bar.querySelector('input[data-kind=image]');

  const toolHint = {
    select: 'Drag a corner to reshape · click a wall or room to edit it',
    wall: 'Click to start a wall, click again to place it · Esc to stop',
    room: 'Drag a rectangle to add a room',
    router: 'Click to place the router',
  };

  // ---------- helpers
  const snapStep = 0.1;
  const verts = () => {
    const seen = [];
    for (const w of fp.walls) for (const p of [w.a, w.b]) if (!seen.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-6)) seen.push(p);
    return seen;
  };
  function pointer(e) {
    const m = svg.getScreenCTM().inverse();
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return [pt.x, pt.y];
  }
  function snapped(e) {
    const raw = pointer(e);
    const near = verts().find((v) => Math.hypot(v[0] - raw[0], v[1] - raw[1]) < 0.3);
    return near ? [...near] : ops.snapPt(raw, snapStep);
  }
  function fit() {
    const b = ops.bounds(fp);
    const m = 1.2;
    vb = { x: b.minX - m, y: b.minZ - m, w: b.maxX - b.minX + 2 * m, h: b.maxZ - b.minZ + 2 * m };
  }
  function commit(next, extra = {}) {
    if (next === fp) return;
    history.push(fp);
    if (history.length > 100) history.shift();
    fp = next;
    onChange(fp, extra);
    render();
  }
  function setPlan(next, { refit = true } = {}) {
    fp = next;
    sel = null;
    if (refit) fit();
    render();
  }

  // ---------- render
  function render() {
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    svg.replaceChildren();
    if (underlay && showUnderlay) el('image', { href: underlay.href, x: underlay.x, y: underlay.y, width: underlay.w, height: underlay.h, opacity: 0.4, preserveAspectRatio: 'none', class: 'ed-underlay' }, svg);
    // 1 m grid
    for (let x = Math.ceil(vb.x); x <= vb.x + vb.w; x++) el('line', { x1: x, y1: vb.y, x2: x, y2: vb.y + vb.h, class: x % 5 ? 'ed-grid' : 'ed-grid ed-grid-major' }, svg);
    for (let z = Math.ceil(vb.y); z <= vb.y + vb.h; z++) el('line', { x1: vb.x, y1: z, x2: vb.x + vb.w, y2: z, class: z % 5 ? 'ed-grid' : 'ed-grid ed-grid-major' }, svg);

    fp.rooms.forEach((r, i) => {
      const poly = el('polygon', { points: r.polygon.map((p) => p.join(',')).join(' '), fill: r.color || '#ddd', class: 'ed-room' + (sel?.kind === 'room' && sel.i === i ? ' sel' : '') }, svg);
      poly.dataset.room = i;
      const cx = r.polygon.reduce((a, p) => a + p[0], 0) / r.polygon.length;
      const cz = r.polygon.reduce((a, p) => a + p[1], 0) / r.polygon.length;
      const t = el('text', { x: cx, y: cz, class: 'ed-label' }, svg);
      t.textContent = r.name;
    });

    fp.walls.forEach((w, i) => {
      const isSel = sel?.kind === 'wall' && sel.i === i;
      const line = el('line', {
        x1: w.a[0], y1: w.a[1], x2: w.b[0], y2: w.b[1],
        'stroke-width': Math.max(w.thickness_m, 0.08),
        class: `ed-wall ${(w.exposure ?? w.type) === 'exterior' ? 'ext' : 'int'}${isSel ? ' sel' : ''}`,
      }, svg);
      line.dataset.wall = i;
      // fat invisible hit target so thin walls are easy to click
      const hit = el('line', { x1: w.a[0], y1: w.a[1], x2: w.b[0], y2: w.b[1], class: 'ed-hit', 'stroke-width': 0.35 }, svg);
      hit.dataset.wall = i;
      if (isSel) {
        const t = el('text', { x: (w.a[0] + w.b[0]) / 2, y: (w.a[1] + w.b[1]) / 2 - 0.2, class: 'ed-dim' }, svg);
        t.textContent = `${ops.wallLength(w).toFixed(2)} m`;
      }
    });

    if (tool === 'select' || tool === 'wall') {
      for (const v of verts()) {
        const c = el('circle', { cx: v[0], cy: v[1], r: 0.14, class: 'ed-vert' + (hover && Math.hypot(hover[0] - v[0], hover[1] - v[1]) < 0.3 ? ' hot' : '') }, svg);
        c.dataset.vx = v[0];
        c.dataset.vz = v[1];
      }
    }
    if (tool === 'wall' && wallStart) {
      el('circle', { cx: wallStart[0], cy: wallStart[1], r: 0.18, class: 'ed-vert hot' }, svg);
      if (hover) el('line', { x1: wallStart[0], y1: wallStart[1], x2: hover[0], y2: hover[1], class: 'ed-wall int ghost', 'stroke-width': 0.1 }, svg);
    }
    if (drag?.room) {
      const [a, b] = [drag.from, drag.to];
      el('rect', { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]), class: 'ed-ghost-room' }, svg);
    }
    const r = getRouter?.();
    if (r) {
      el('circle', { cx: r.position_m[0], cy: r.position_m[1], r: 0.22, class: 'ed-router' }, svg);
      el('circle', { cx: r.position_m[0], cy: r.position_m[1], r: 0.5, class: 'ed-router-ring' }, svg);
    }
    renderSide();
    for (const b of bar.querySelectorAll('[data-tool]')) b.classList.toggle('active', b.dataset.tool === tool);
  }

  function renderSide() {
    const issues = ops.validate(fp);
    let html = '';
    if (banner) html += `<div class="ed-banner ${banner.level}">${banner.items.map((t) => `<div>${esc(t)}</div>`).join('')}</div>`;
    if (underlay) html += `<label class="ed-toggle"><input type="checkbox" data-f="underlay" ${showUnderlay ? 'checked' : ''} /> show source image</label>`;
    html += `<div class="ed-hint">${toolHint[tool]}</div>`;
    if (sel?.kind === 'wall' && fp.walls[sel.i]) {
      const w = fp.walls[sel.i];
      html += `<div class="ed-card"><b>Wall ${sel.i + 1}</b>
        <label>Material <select data-f="material_id">${ops.MATERIALS.map((m) => `<option ${m === w.material_id ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
        <label>Exposure <select data-f="exposure"><option ${(w.exposure ?? w.type) === 'interior' ? 'selected' : ''}>interior</option><option ${(w.exposure ?? w.type) === 'exterior' ? 'selected' : ''}>exterior</option></select></label>
        <label>Length (m) <input data-f="length" type="number" step="0.01" min="0.1" value="${ops.wallLength(w).toFixed(2)}" /></label>
        <button data-act="scale" class="icon-button">Set plan scale from this wall</button>
        <small>Measure one real wall, type its length, press the button: the whole plan rescales.</small></div>`;
    } else if (sel?.kind === 'room' && fp.rooms[sel.i]) {
      html += `<div class="ed-card"><b>Room</b><label>Name <input data-f="name" value="${esc(fp.rooms[sel.i].name)}" /></label></div>`;
    } else {
      html += `<div class="ed-card"><b>Plan</b><label>Ceiling height (m) <input data-f="ceiling" type="number" step="0.1" min="2" max="6" value="${fp.ceiling_height_m ?? 2.7}" /></label></div>`;
    }
    html += `<div class="ed-issues">${issues.length ? issues.map((i) => `<div class="ed-issue ${i.level}">⚠ ${esc(i.msg)}</div>`).join('') : '<div class="ed-ok">✓ plan looks consistent</div>'}</div>`;
    side.innerHTML = html;
  }

  // ---------- side-panel edits
  side.addEventListener('change', (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    if (f === 'underlay') {
      showUnderlay = e.target.checked;
      return render();
    }
    if (sel?.kind === 'wall') {
      if (f === 'material_id' || f === 'exposure') commit(ops.updateWall(fp, sel.i, { [f]: e.target.value }));
      if (f === 'length') {
        const v = Number(e.target.value);
        if (v > 0) side.dataset.pendingLen = v;
      }
    } else if (sel?.kind === 'room' && f === 'name') {
      const next = structuredClone(fp);
      next.rooms[sel.i].name = e.target.value || next.rooms[sel.i].name;
      commit(next);
    } else if (f === 'ceiling') {
      commit({ ...fp, ceiling_height_m: Math.min(6, Math.max(2, Number(e.target.value) || 2.7)) });
    }
  });
  side.addEventListener('click', (e) => {
    if (e.target.dataset.act !== 'scale' || sel?.kind !== 'wall') return;
    const v = Number(side.querySelector('[data-f=length]').value);
    const { fp: next, factor } = ops.scaleToLength(fp, sel.i, v);
    if (factor !== 1) {
      history.push(fp);
      fp = next;
      fit();
      onChange(fp, { refit: true, scaleFactor: factor });
      render();
    }
  });

  // ---------- toolbar
  bar.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tool]');
    if (t) return setTool(t.dataset.tool);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'undo') undo();
    if (act === 'delete') del();
    if (act === 'export') exportJson();
    if (act === 'import') fileInput.click();
    if (act === 'upload') imageInput.click();
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const next = JSON.parse(await file.text());
      if (!Array.isArray(next.rooms) || !Array.isArray(next.walls)) throw new Error('needs rooms[] and walls[]');
      history.push(fp);
      fp = next;
      sel = null;
      fit();
      onChange(fp, { refit: true });
      render();
    } catch (err) {
      side.insertAdjacentHTML('afterbegin', `<div class="ed-issue error">Import failed: ${esc(err.message)}</div>`);
    }
  });
  imageInput.addEventListener('change', () => {
    const file = imageInput.files[0];
    imageInput.value = '';
    if (file) onUploadImage?.(file);
  });
  function setBanner(b) {
    banner = b;
    renderSide();
  }
  /** Land an AI draft: becomes the current plan (undoable), shown over its source image, with a to-check list. */
  function loadDraft(next, under, warnings) {
    history.push(fp);
    fp = next;
    sel = null;
    underlay = under;
    banner = { level: 'warn', items: ['AI DRAFT — not verified.', ...warnings] };
    fit();
    onChange(fp, { refit: true, draft: true });
    render();
  }
  function exportJson() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(fp, null, 2)], { type: 'application/json' }));
    a.download = 'floorplan.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function setTool(t) {
    tool = t;
    wallStart = null;
    drag = null;
    render();
  }
  function undo() {
    const prev = history.pop();
    if (!prev) return;
    fp = prev;
    sel = null;
    onChange(fp, {});
    render();
  }
  function del() {
    if (sel?.kind === 'wall') commit(ops.deleteWall(fp, sel.i));
    else if (sel?.kind === 'room') commit(ops.deleteRoom(fp, sel.i));
    sel = null;
    render();
  }
  root.tabIndex = -1;
  root.addEventListener('keydown', (e) => {
    if (e.target.matches('input,select')) return;
    if (e.key === 'Escape') setTool(tool === 'wall' ? 'wall' : 'select');
    if (e.key === 'Delete' || e.key === 'Backspace') del();
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') undo();
  });

  // ---------- canvas
  svg.addEventListener('pointerdown', (e) => {
    root.focus({ preventScroll: true });
    const p = snapped(e);
    if (tool === 'router') {
      onRouterMove(p);
      render();
      return;
    }
    if (tool === 'wall') {
      if (!wallStart) wallStart = p;
      else {
        commit(ops.addWall(fp, wallStart, p, { exposure: 'interior' }));
        wallStart = p; // chain
      }
      render();
      return;
    }
    if (tool === 'room') {
      drag = { room: true, from: p, to: p };
      svg.setPointerCapture(e.pointerId);
      return;
    }
    // select tool
    const vx = e.target.dataset?.vx;
    if (vx !== undefined) {
      drag = { orig: [Number(vx), Number(e.target.dataset.vz)], base: fp, moved: false };
      svg.setPointerCapture(e.pointerId);
      return;
    }
    if (e.target.dataset?.wall !== undefined) sel = { kind: 'wall', i: Number(e.target.dataset.wall) };
    else if (e.target.dataset?.room !== undefined) sel = { kind: 'room', i: Number(e.target.dataset.room) };
    else sel = null;
    render();
  });
  svg.addEventListener('pointermove', (e) => {
    hover = snapped(e);
    if (drag?.room) {
      drag.to = hover;
      render();
    } else if (drag?.orig) {
      if (!drag.moved) {
        history.push(drag.base);
        drag.moved = true;
      }
      fp = ops.moveVertex(drag.base, drag.orig, hover);
      onChange(fp, {});
      render();
    } else if (tool === 'wall') render();
  });
  svg.addEventListener('pointerup', () => {
    if (drag?.room) {
      const next = ops.addRoom(fp, drag.from, drag.to);
      drag = null;
      commit(next);
      render();
    } else if (drag?.orig) {
      drag = null;
      fit();
      render();
    }
  });

  fit();
  render();
  return { setPlan, setBanner, loadDraft, render, resize: () => render(), getPlan: () => fp, setTool };
}
