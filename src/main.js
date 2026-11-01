import demoPlan from '../data/demo-floorplan.json';
import { createEditor } from './editor.js';
import { draftToFloorplan } from './draft.js';
import { openUploadDialog } from './upload-dialog.js';
import { simulate } from '../thermal-model/index.js';
import { createCfdLayer } from './cfd/layer.js';
import { startCfd } from './cfd/client.js';
import catalog from '../assets/furniture/catalog.json';
import { furnitureObstacles } from './furniture-geometry.js';
import { createViewer } from './viewer.js';
import './styles.css';

const $ = (s) => document.querySelector(s);
let floorplan = demoPlan;
const viewer = createViewer({ mount: $('#scene'), floorplan });

// ---- rooms list
function renderRooms() {
  $('#room-list').replaceChildren(
    ...floorplan.rooms.map((room) => {
      const li = document.createElement('li');
      li.className = 'room-item';
      const sw = document.createElement('span');
      sw.className = 'room-swatch';
      sw.style.setProperty('--swatch', /^#[0-9a-f]{3,8}$/i.test(room.color) ? room.color : '#ddd');
      const nm = document.createElement('span');
      nm.textContent = room.name;
      li.append(sw, nm);
      return li;
    }),
  );
  $('#room-count').textContent = String(floorplan.rooms.length).padStart(2, '0');
  $('.panel-heading h2').textContent = floorplan.name ?? 'Plan';
  const draft = floorplan.draft && floorplan.draft.reviewed !== true;
  $('#draft-chip').hidden = !draft;
  $('#draft-chip').textContent = draft ? `AI draft · unverified${floorplan.draft.quality === 'poor' ? ' · looks incomplete' : ''}` : '';
  $('#scene-status').textContent = `${floorplan.name ?? 'Plan'} · ${floorplan.rooms.length} rooms · ${floorplan.walls.length} walls`;
}
renderRooms();

$('#top-view').addEventListener('click', () => viewer.view('top'));
$('#reset-view').addEventListener('click', () => viewer.view('3d'));

let cutaway = false;
$('#walls-toggle').addEventListener('click', (e) => {
  cutaway = !cutaway;
  viewer.setWallMode(cutaway ? 'low' : 'full');
  e.currentTarget.classList.toggle('active', cutaway);
});

// ---- Kimi's modules: wifi-model/ (prediction) and tools/wifi-sampler/ (real RSSI capture).
const modelMods = import.meta.glob('../wifi-model/index.js');
const samplerMods = import.meta.glob('../tools/wifi-sampler/index.js');
const loadFn = async (mods, name) => {
  const loader = Object.values(mods)[0];
  return loader ? (await loader())[name] : undefined;
};

// ---- state. ONE router drives the prediction; readings are optional ground truth.
// tx_power_dbm deliberately unset: the model's own default (wifi-model/) applies until the user overrides it in the panel
const router = { position_m: [2, 2], height_m: 1.0, frequency_hz: 2.4e9 };
const samples = [];
let pending = null;
let mode = null; // null | 'router' | 'mark'

const form = $('#reading-form');
const input = $('#reading-input');
const hint = $('#wifi-hint');

function setMode(next) {
  mode = mode === next ? null : next;
  viewer.setPickMode(mode);
  $('#router-toggle').classList.toggle('active', mode === 'router');
  $('#mark-toggle').classList.toggle('active', mode === 'mark');
  if (mode !== 'mark') {
    pending = null;
    form.hidden = true;
  }
  hint.innerHTML =
    mode === 'router' ? 'Click the floor to put the router there.'
    : mode === 'mark' ? 'Click where you took a reading, then capture or type it.'
    : 'Heatmap = <b>predicted</b> signal from the router (distance + walls). Pins = real readings you took to check it.';
}
$('#router-toggle').addEventListener('click', () => setMode('router'));
$('#tx-power').addEventListener('change', (e) => {
  const v = Number(e.target.value);
  if (e.target.value !== '' && Number.isFinite(v)) router.tx_power_dbm = Math.min(30, Math.max(0, v));
  else delete router.tx_power_dbm; // empty = back to the model default
  refresh();
});
const band = (hz) => (hz < 3e9 ? '2.4' : '5');
$('#router-band').addEventListener('change', (e) => {
  router.frequency_hz = Number(e.target.value);
  refresh();
});
$('#mark-toggle').addEventListener('click', () => setMode('mark'));

viewer.el.addEventListener('twin:router', (e) => {
  router.position_m = e.detail.position_m;
  refresh();
});

viewer.el.addEventListener('twin:mark', async (e) => {
  pending = e.detail.position_m;
  $('#pending-pos').textContent = `x ${pending[0]} · z ${pending[1]} m`;
  form.hidden = false;
  input.focus();
  const sampler = await loadFn(samplerMods, 'sampleRssi');
  $('#capture-btn').hidden = !sampler;
});

function addSample(rssi, extra = {}) {
  if (!pending || !Number.isFinite(rssi)) return;
  samples.push({
    id: `sample-${String(samples.length + 1).padStart(3, '0')}`,
    position_m: pending,
    rssi_dbm: rssi,
    sampled_at: new Date().toISOString(),
    source: 'manual',
    ...extra,
  });
  input.value = '';
  viewer.clearPending();
  pending = null;
  form.hidden = true;
  refresh();
}

// one click: read the real signal from this laptop and save it at the marked spot
$('#capture-btn').addEventListener('click', async () => {
  const sampleRssi = await loadFn(samplerMods, 'sampleRssi');
  if (!sampleRssi) return;
  try {
    const r = await sampleRssi();
    addSample(Math.round(r.rssi_dbm), { source: r.source ?? 'iw', frequency_hz: r.frequency_hz });
  } catch (err) {
    hint.textContent = `Capture failed (${err.message}) — type a reading instead.`;
  }
});

// or type a value and press Enter / Save
form.addEventListener('submit', (e) => {
  e.preventDefault();
  addSample(Number(input.value));
});

let field = null;
async function refresh() {
  viewer.setRouter(router);
  const predict = await loadFn(modelMods, 'predict');
  if (!predict) return void (hint.textContent = 'wifi-model/ is missing: no prediction available.');
  field = predict(router, floorplan, 0.5);
  const r = viewer.setField(field);
  $('#legend-lo').textContent = r.lo;
  $('#legend-hi').textContent = `${r.hi} dBm`;
  viewer.setSamples(samples); // after setField so pins share the colour range
  const near = (s) => !field.cells.length ? { estimated_rssi_dbm: NaN } : field.cells.reduce((m, c) => (Math.hypot(c.position_m[0] - s.position_m[0], c.position_m[1] - s.position_m[1]) < Math.hypot(m.position_m[0] - s.position_m[0], m.position_m[1] - s.position_m[1]) ? c : m));
  $('#wifi-count').textContent = `${samples.length} check${samples.length === 1 ? '' : 's'} · ${field.method}`;
  $('#sample-list').innerHTML =
    (samples.length > 3 ? `<li><span>… ${samples.length - 3} earlier</span></li>` : '') +
    samples
      .slice(-3)
      .map((s) => {
        const p = near(s).estimated_rssi_dbm;
        const d = Math.round(s.rssi_dbm - p);
        const mismatch = s.frequency_hz && band(s.frequency_hz) !== band(router.frequency_hz);
        return `<li><span>${s.position_m.join(', ')} · pred ${Math.round(p)}</span><span>real ${s.rssi_dbm}${s.source === 'manual' ? '*' : ''} (${d >= 0 ? '+' : ''}${d})${mismatch ? ` ⚠ ${band(s.frequency_hz)} GHz reading vs ${band(router.frequency_hz)} GHz model` : ''}</span></li>`;
      })
      .join('');
}
setMode(null);
refresh();

// ---- heating layer (Kimi's thermal-model/simulate; viewer only draws what it returns)
// Heaters ARE radiator furniture in the plan (one object, saved with the plan, undoable). Derived here, never stored twice.
const HEAT_TYPES = new Set(catalog.items.filter((i) => i.heat_source).map((i) => i.id));
const heatersOf = (fp) => (fp.furniture ?? []).filter((f) => HEAT_TYPES.has(f.type)).map((f) => ({ id: f.id, position_m: f.position_m, watts: Number.isFinite(+f.watts) ? +f.watts : 1500 }));
let jumpToEnd = false; // after the first heater appears, show the result instead of t=0
let layer = 'wifi';
let thermal = null;
const timeSlider = $('#time-slider');
const roomAt = (fp, [x, z]) =>
  fp.rooms.find(({ polygon: P }) => {
    let inside = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++)
      if ((P[i][1] > z) !== (P[j][1] > z) && x < ((P[j][0] - P[i][0]) * (z - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) inside = !inside;
    return inside;
  });

function runThermal() {
  const live = heatersOf(floorplan).filter((h) => roomAt(floorplan, h.position_m));
  const scenario = {
    outside_temp_c: Number($('#outside-temp').value) || 0,
    initial_temp_c: 16,
    duration_min: 180,
    step_min: 5,
    heaters: live.map((h) => ({ id: h.id, room_id: roomAt(floorplan, h.position_m).id, position_m: h.position_m, watts: h.watts })),
  };
  try {
    thermal = simulate(floorplan, scenario);
  } catch (err) {
    thermal = null;
    $('#heat-hint').textContent = `Heating model error: ${err.message}`;
  }
  viewer.setHeaters(live);
  timeSlider.max = thermal ? thermal.times_s.length - 1 : 0;
  if (jumpToEnd && live.length) {
    timeSlider.value = timeSlider.max;
    jumpToEnd = false;
  }
  drawHeat();
}

function drawHeat() {
  if (!thermal) return viewer.setRoomTemps(null);
  const i = Math.min(Number(timeSlider.value), thermal.times_s.length - 1);
  const temps = Object.fromEntries(thermal.rooms.map((r) => [r.room_id, r.temps_c[i]]));
  viewer.setRoomTemps(temps);
  $('#time-label').textContent = `${Math.round(thermal.times_s[i] / 60)} min`;
  $('#heat-list').innerHTML = thermal.rooms
    .map((r) => {
      const name = floorplan.rooms.find((x) => x.id === r.room_id)?.name ?? r.room_id;
      return `<li><span>${name.replace(/[<>&"']/g, '')}</span><span>${r.temps_c[i].toFixed(1)}°C${r.heater_energy_kwh ? ` · ${(r.heater_energy_kwh * (thermal.times_s[i] / thermal.times_s.at(-1))).toFixed(2)} kWh so far` : ''}</span></li>`;
    })
    .join('');
  $('#heat-hint').textContent = heatersOf(floorplan).length
    ? 'Estimate: lumped room model (conduction, infiltration, constant heater power). No solar, airflow or thermostat.'
    : 'No heaters yet: rooms just cool toward the outside temperature. Press Add heater and click near a wall: a radiator is placed there.';
}

function setLayer(next) {
  layer = next;
  viewer.setLayer(layer);
  $('#layer-wifi').classList.toggle('active', layer === 'wifi');
  $('#layer-heat').classList.toggle('active', layer === 'heat');
  $('#layer-cfd').classList.toggle('active', layer === 'cfd');
  $('#wifi-card').hidden = layer !== 'wifi';
  $('#heat-card').hidden = layer !== 'heat';
  $('#cfd-card').hidden = layer !== 'cfd';
  cfd.setVisible(layer === 'cfd');
  if (layer === 'heat') {
    setMode(null);
    runThermal();
  } else {
    viewer.setPickMode(null);
    $('#heater-toggle').classList.remove('active');
    if (layer === 'cfd') setMode(null);
  }
}
$('#layer-wifi').addEventListener('click', () => setLayer('wifi'));
$('#layer-heat').addEventListener('click', () => setLayer('heat'));
$('#layer-cfd').addEventListener('click', () => setLayer('cfd'));

// ---- airflow (CFD) layer: separate from the lumped heating layer; solver in a worker, fixture until it lands
const cfd = createCfdLayer(viewer);
let cfdRun = null;
const cfdUi = { time: $('#cfd-time'), height: $('#cfd-height') };
function cfdReadout(info) {
  if (!info) return;
  $('#cfd-time-label').textContent = `${Math.round(info.time_s / 60)} min`;
  $('#cfd-height-label').textContent = `${info.height_m.toFixed(1)} m`;
  $('#cfd-readout').textContent = `Slice ${info.tMin.toFixed(1)}–${info.tMax.toFixed(1)} °C · peak air speed ${info.vMax.toFixed(2)} m/s`;
}
function cfdStop(msg) {
  $('#cfd-run').hidden = false;
  $('#cfd-cancel').hidden = true;
  $('#cfd-progress').hidden = true;
  if (msg) $('#cfd-hint').textContent = msg;
}
$('#cfd-run').addEventListener('click', async () => {
  cfdRun?.cancel();
  cfd.reset();
  cfdUi.time.max = 0;
  cfdUi.time.value = 0;
  $('#cfd-run').hidden = true;
  $('#cfd-cancel').hidden = false;
  $('#cfd-progress').hidden = false;
  $('#cfd-progress').value = 0;
  const live = heatersOf(floorplan).filter((h) => roomAt(floorplan, h.position_m));
  if (!live.length) $('#cfd-hint').textContent = 'No heaters placed (Heating tab) — running with none, so air will stay still.';
  else $('#cfd-hint').textContent = 'Running…';
  try {
    cfdRun = await startCfd({
      floorplan,
      scenario: {
        outside_temp_c: Number($('#outside-temp').value) || 0,
        initial_temp_c: 16,
        duration_s: 10800,
        frame_every_s: 60, // app owns the frame cadence (Kimi: worker keeps its own stability dt)
        cell_m: 0.25,
        obstacles: furnitureObstacles(floorplan, catalog), // solid furniture as plan-space boxes (AABB) — proposal, Kimi may prefer voxel masks
        heaters: live.map((h) => ({ position_m: h.position_m, height_m: 0.3, watts: h.watts, room_id: roomAt(floorplan, h.position_m).id })),
      },
      onGrid: (g) => cfd.setGrid(g),
      onFrame: (f) => {
        cfd.addFrame(f);
        cfdUi.time.max = cfd.frameCount() - 1;
        if (cfd.frameCount() === 1 || Number(cfdUi.time.value) === cfd.frameCount() - 2) {
          cfdUi.time.value = cfd.frameCount() - 1; // follow the live edge until the user scrubs back
          cfdReadout(cfd.setFrame(cfd.frameCount() - 1));
        }
      },
      onProgress: (fr) => ($('#cfd-progress').value = fr),
      onDone: () => cfdStop('Done. Scrub time or move the height slider.'),
      onError: (err) => cfdStop(`Airflow run failed: ${err.message}`),
    });
    $('#cfd-source').textContent = cfdRun.source === 'solver' ? 'thermal-cfd solver' : 'FIXTURE — synthetic, not physics';
    $('#cfd-source').classList.toggle('pill-warn', cfdRun.source !== 'solver');
  } catch (err) {
    cfdStop(`Airflow run failed: ${err.message}`);
  }
});
$('#cfd-cancel').addEventListener('click', () => {
  cfdRun?.cancel();
  cfdStop('Cancelled.');
});
cfdUi.time.addEventListener('input', () => cfdReadout(cfd.setFrame(Number(cfdUi.time.value))));
cfdUi.height.addEventListener('input', () => cfdReadout(cfd.setSliceHeight(Number(cfdUi.height.value))));
$('#cfd-arrows').addEventListener('change', (e) => cfdReadout(cfd.setArrows(e.target.checked)));
$('#heater-toggle').addEventListener('click', () => {
  if (layer !== 'heat') setLayer('heat');
  const on = !$('#heater-toggle').classList.contains('active');
  $('#heater-toggle').classList.toggle('active', on);
  viewer.setPickMode(on ? 'heater' : null);
});
$('#heater-clear').addEventListener('click', () => editor.removeFurnitureWhere((f, item) => item?.heat_source));
viewer.el.addEventListener('twin:heater', (e) => {
  jumpToEnd = true;
  editor.placeFurniture('radiator', e.detail.position_m, { watts: Math.min(5000, Math.max(50, Number($('#heater-watts').value) || 1500)) });
});
timeSlider.addEventListener('input', drawHeat);
$('#outside-temp').addEventListener('change', () => layer === 'heat' && runThermal());

// ---- 2D plan editor: every edit rebuilds the 3D shell and re-predicts the signal
let raf = 0;
// image -> (local proxy -> OpenAI vision) -> draft plan in the editor. The key never touches the browser.
let lastDraft = null; // {image, raw} of the most recent AI read, for the optional review pass
async function reviewDraft() {
  if (!lastDraft) throw new Error('no draft to review');
  const res = await fetch('/api/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: lastDraft.image, extraction: lastDraft.raw }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `server returned ${res.status}`);
  return body;
}
async function uploadPlan(file) {
  const bust = (items, level = 'error') => editor.setBanner({ level, items });
  try {
    const pick = await openUploadDialog(file); // crop to one plan + optional real width
    if (!pick) return;
    if (pick.error) return bust([pick.error]);
    bust(['Reading your plan… (a few seconds)'], 'info');
    const res = await fetch('/api/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: pick.image }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `server returned ${res.status}`);
    const { floorplan: fp, underlay, warnings, quality } = draftToFloorplan(body, { imgW: pick.width, imgH: pick.height, name: file.name.replace(/\.[^.]+$/, ''), widthHintM: pick.widthHintM });
    lastDraft = { image: pick.image, raw: body };
    editor.loadDraft(fp, { ...underlay, href: pick.image }, warnings, quality);
  } catch (err) {
    const noServer = /Failed to fetch|NetworkError|returned 50[24]/.test(err.message);
    bust([`Upload failed: ${err.message}`, ...(noServer ? ['Is the draft server running? Start it from a terminal that has OPENAI_API_KEY: npm run draft-server'] : [])]);
  }
}
const editor = createEditor({
  root: $('#editor'),
  plan: floorplan,
  getRouter: () => router,
  onRouterMove: (p) => {
    router.position_m = p;
    refresh();
  },
  onUploadImage: uploadPlan,
  onReviewDraft: reviewDraft,
  onChange: (fp, { refit, scaleFactor, draft } = {}) => {
    floorplan = fp;
    if (draft) {
      // fresh plan: old spot checks no longer mean anything; put the router mid-way in the largest room
      samples.length = 0;
      const area = (r) => Math.abs(r.polygon.reduce((a, p, j) => { const q = r.polygon[(j + 1) % r.polygon.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0));
      const big = [...fp.rooms].sort((a, b) => area(b) - area(a))[0];
      router.position_m = [+(big.polygon.reduce((a, p) => a + p[0], 0) / big.polygon.length).toFixed(2), +(big.polygon.reduce((a, p) => a + p[1], 0) / big.polygon.length).toFixed(2)];
    }
    if (scaleFactor) {
      router.position_m = router.position_m.map((v) => +(v * scaleFactor).toFixed(3));
      for (const s of samples) s.position_m = s.position_m.map((v) => +(v * scaleFactor).toFixed(3));
    }
    viewer.setFloorplan(fp, { refit });
    if (cfdRun) {
      cfdRun.cancel();
      cfdRun = null;
      cfd.reset();
      cfdStop('Plan changed — run airflow again.');
    }
    renderRooms();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      refresh();
      if (layer === 'heat') runThermal();
    }); // coalesce drag events
  },
});
function showTab(plan) {
  $('#editor').hidden = !plan;
  $('#tab-plan').classList.toggle('active', plan);
  $('#tab-3d').classList.toggle('active', !plan);
  if (plan) {
    setMode(null);
    viewer.setPickMode(null);
    $('#heater-toggle').classList.remove('active');
    editor.render();
  }
}
$('#tab-3d').addEventListener('click', () => showTab(false));
$('#tab-plan').addEventListener('click', () => showTab(true));
if (location.hash === '#plan') showTab(true);
window.twin = { viewer, router, samples, refresh, editor };
