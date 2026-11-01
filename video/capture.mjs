// Deterministic demo capture: drives the real app in headless Brave and records one silent clip per script row
// (docs/demo-video.md). Voiceover is recorded separately; clips are retimed to it in assembly.
//   node video/capture.mjs [scene ...]     scenes: intro upload inspect wifi heat air outro (default: all)
// Needs: vite dev server (APP, default http://127.0.0.1:5174/) and, for `upload`, the real draft server on :5176.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT || path.join(HERE, 'out');
const APP = process.env.APP || 'http://127.0.0.1:5174/';
const PLAN_IMG = process.env.PLAN_IMG || path.join(HERE, 'synthetic-plan.png'); // fully synthetic (make-plan.mjs); never use a real/third-party plan in public footage
const W = +(process.env.W || 1280), H = +(process.env.H || 720), PORT = 9444; // render small (swiftshader is slow), upscale to 1080p in ffmpeg
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
const prof = path.join(OUT, '.profile');
rmSync(prof, { recursive: true, force: true });

const chrome = spawn('brave-browser', ['--headless=new', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--window-size=${W},${H}`, `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.length) break; } catch {} await sleep(300); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map(); let onFrame = null;
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  else if (d.method === 'Page.screencastFrame') { send('Page.screencastFrameAck', { sessionId: d.params.sessionId }); onFrame?.(d.params); }
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result?.value;
await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScreenWidth: W, deviceScreenHeight: H, deviceScaleFactor: 1, mobile: false });

// ---- fake cursor (headless draws none) injected into every page load
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  addEventListener('DOMContentLoaded',()=>{const c=document.createElement('div');c.id='fake-cursor';
  c.style.cssText='position:fixed;left:0;top:0;width:22px;height:22px;z-index:99999;pointer-events:none;transition:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))';
  c.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  document.body.appendChild(c);addEventListener('mousemove',e=>{c.style.transform='translate('+e.clientX+'px,'+e.clientY+'px)'},true)});` });

// ---- input helpers (real mouse events, eased)
let cur = [W * 0.5, H * 0.5];
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse', ...extra });
const ease = (t) => t * t * (3 - 2 * t);
async function moveTo(x, y, ms = 600) { // wall-clock interpolation: a slow renderer drops steps instead of stretching the move
  const [x0, y0] = cur; const t0 = Date.now();
  for (;;) { const t = Math.min(1, (Date.now() - t0) / ms); const k = ease(t); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + (x - x0) * k, y: y0 + (y - y0) * k, buttons: 0 }); if (t >= 1) break; await sleep(16); }
  cur = [x, y];
}
async function clickAt(x, y, ms = 600) { await moveTo(x, y, ms); await mouse('mousePressed', x, y); await sleep(70); await mouse('mouseReleased', x, y); await sleep(250); }
const center = async (sel) => { const r = JSON.parse(await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return 'null';const r=e.getBoundingClientRect();return JSON.stringify([r.left+r.width/2,r.top+r.height/2])})()`)); if (!r) throw new Error('no element ' + sel); return r; };
const clickSel = async (sel, ms) => { const [x, y] = await center(sel); await clickAt(x, y, ms); };
const clickText = async (txt, ms) => { const r = JSON.parse(await ev(`(()=>{const e=[...document.querySelectorAll('button,summary')].find(b=>b.textContent.trim().replace(/\\s+/g,' ')===${JSON.stringify(txt)});if(!e)return 'null';const r=e.getBoundingClientRect();return JSON.stringify([r.left+r.width/2,r.top+r.height/2])})()`)); if (!r) throw new Error('no button ' + txt); await clickAt(r[0], r[1], ms); };
const proj = async (x, z, y = 0) => ev(`twin.viewer.project([${x},${z}],${y})`);
async function drag(x0, y0, x1, y1, ms = 1400) {
  await moveTo(x0, y0, 400); await mouse('mousePressed', x0, y0); const t0 = Date.now();
  for (;;) { const t = Math.min(1, (Date.now() - t0) / ms); const k = ease(t); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, button: 'left', buttons: 1 }); if (t >= 1) break; await sleep(16); }
  await mouse('mouseReleased', x1, y1); cur = [x1, y1];
}

// ---- recorder: screencast frames -> timestamped jpgs -> one mp4 per scene; pause() cuts dead waits out of the clip
let rec = null;
async function startClip(name) {
  const dir = path.join(OUT, name + '-frames'); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  rec = { name, dir, frames: [], paused: false };
  onFrame = (p) => { if (!rec || rec.paused) return; const f = `${String(rec.frames.length).padStart(5, '0')}.jpg`; writeFileSync(path.join(dir, f), Buffer.from(p.data, 'base64')); rec.frames.push({ f, t: p.metadata.timestamp }); };
  await send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await sleep(300);
}
const pause = () => { rec.paused = true; }, resume = () => { rec.paused = false; rec.gap = true; };
async function endClip() {
  await sleep(400); await send('Page.stopScreencast'); onFrame = null;
  const { name, dir, frames } = rec; rec = null;
  if (frames.length < 2) throw new Error(`clip ${name}: only ${frames.length} frames`);
  // each frame shown until the next one arrives; gaps from pause() are clamped to 150 ms
  const lines = frames.map((fr, i) => `file '${fr.f}'\nduration ${Math.min(0.5, i + 1 < frames.length ? Math.max(0.01, frames[i + 1].t - fr.t) : 0.2).toFixed(3)}`);
  lines.push(`file '${frames.at(-1).f}'`);
  writeFileSync(path.join(dir, 'list.txt'), lines.join('\n'));
  const mp4 = path.join(OUT, name + '.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'), '-vf', 'fps=30,scale=1920:1080:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', mp4]);
  const secs = execFileSync('/usr/bin/ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]).toString().trim();
  console.log(`clip ${name}: ${frames.length} frames, ${(+secs).toFixed(1)} s -> ${mp4}`);
  return +secs;
}
async function load(url = APP) { await send('Page.navigate', { url: 'about:blank' }); await sleep(300); await send('Page.navigate', { url }); await sleep(3200); cur = [W * 0.5, H * 0.5]; }

// ---- scenes (one per row of docs/demo-video.md)
const scenes = {
  async intro() { // 0:00-0:07 start on 2D plan
    await load(); await ev("document.querySelector('#tab-plan').click()"); await sleep(600);
    await startClip('1-intro');
    await moveTo(1100, 400, 900); await sleep(900);
    await moveTo(...await center('[data-act=upload], .ed-bar .primary'), 900); await sleep(1800);
    await moveTo(900, 560, 800); await sleep(1200);
    return endClip();
  },
  async upload() { // 0:07-0:19 upload + crop + scale; the model wait is cut out
    if (!existsSync(PLAN_IMG)) execFileSync('node', [path.join(HERE, 'make-plan.mjs')]);
    if (!existsSync(PLAN_IMG)) throw new Error('missing ' + PLAN_IMG);
    await load(); await ev("document.querySelector('#tab-plan').click()"); await sleep(600);
    await startClip('2-upload');
    const doc = (await send('DOM.getDocument')).result.root.nodeId;
    const node = (await send('DOM.querySelector', { nodeId: doc, selector: 'input[data-kind=image]' })).result.nodeId;
    await moveTo(...await center('.ed-bar .primary'), 700); await sleep(300);
    await send('DOM.setFileInputFiles', { nodeId: node, files: [PLAN_IMG] }); await sleep(1200);
    const r = JSON.parse(await ev("JSON.stringify(document.querySelector('.ud-canvas').getBoundingClientRect())"));
    if (process.env.DBG) { console.log('canvas rect', r); }
    await drag(r.left + r.width * 0.06, r.top + r.height * 0.12, r.left + r.width * 0.92, r.top + r.height * 0.93, 1400);
    await sleep(500);
    if (process.env.DBG) console.log('after drag', await ev("document.querySelector('.ud-width')?'width ok':'no width; body='+document.body.innerText.slice(0,120)"));
    await clickSel('.ud-width', 500); await ev("(()=>{const i=document.querySelector('.ud-width');i.focus();i.value='11.2';i.dispatchEvent(new Event('input',{bubbles:true}))})()"); await sleep(900);
    await clickSel('.ud-go', 600);
    pause(); // real extraction takes ~80 s on gpt-5.5; cut it
    for (let i = 0; i < 300; i++) { await sleep(1000); const b = await ev("[...document.querySelectorAll('.ed-banner div')].map(d=>d.textContent).join('|')"); if (b && !b.startsWith('Reading')) break; }
    resume(); await sleep(2500);
    await moveTo(800, 560, 900); await sleep(1500);
    return endClip();
  },
  async inspect() { // 0:19-0:31 Looks right -> 3D, orbit
    await load(); await ev("document.querySelector('#tab-plan').click()"); await sleep(600);
    await startClip('3-inspect');
    await sleep(800);
    await clickSel('[data-act=to3d]', 900); await sleep(1200);
    await drag(1000, 650, 1300, 600, 2400); await sleep(1200);
    await moveTo(...await center('#plan-sub'), 800); await sleep(1200);
    return endClip();
  },
  async wifi() { // 0:31-0:48
    await load(); await ev("document.querySelector('#walls-toggle').click()"); await ev("document.querySelector('#layer-wifi').click()"); await sleep(600);
    await startClip('4-wifi');
    await sleep(900);
    await clickSel('#router-toggle', 800); await sleep(300);
    let [x, y] = await proj(7, 5); await clickAt(x, y, 900); await sleep(1800);
    await clickSel('#mark-toggle', 700); [x, y] = await proj(2, 2); await clickAt(x, y, 800); await sleep(1500);
    await moveTo(...await center('.pill-claim'), 700); await sleep(1500);
    return endClip();
  },
  async heat() { // 0:48-1:04
    await load(); await ev("document.querySelector('#walls-toggle').click()"); await ev("document.querySelector('#layer-heat').click()"); await sleep(600);
    await startClip('5-heat');
    await sleep(700);
    await clickSel('#heater-toggle', 800); const [x, y] = await proj(3, 0.5); await clickAt(x, y, 900); await sleep(1500);
    const [sx, sy] = await center('#time-slider'); await moveTo(sx - 120, sy, 600); await mouse('mousePressed', sx - 120, sy); await moveTo(sx + 120, sy, 2600); await mouse('mouseReleased', sx + 120, sy); await sleep(1200);
    await moveTo(...await center('#heat-list'), 700); await sleep(1500);
    return endClip();
  },
  async air() { // 1:04-1:14 real solver, wait cut
    await load(); await ev("document.querySelector('#walls-toggle').click()"); await ev("document.querySelector('#layer-heat').click()"); await sleep(400);
    await ev("document.querySelector('#heater-toggle').click()"); const [x, y] = await proj(3, 0.5); await clickAt(x, y, 300); await sleep(400);
    await ev("document.querySelector('#layer-cfd').click()"); await sleep(500);
    await startClip('6-air');
    await sleep(600);
    await clickSel('#cfd-run', 700);
    pause(); for (let i = 0; i < 240; i++) { await sleep(1000); const h = await ev("document.querySelector('#cfd-hint')?.textContent||''"); if (h.startsWith('Done') || h.startsWith('Airflow run failed')) break; }
    resume(); await sleep(1500);
    const [sx, sy] = await center('#cfd-time'); await moveTo(sx - 150, sy, 500); await mouse('mousePressed', sx - 150, sy); await moveTo(sx + 150, sy, 2600); await mouse('mouseReleased', sx + 150, sy); await sleep(800);
    await moveTo(...await center('#cfd-caveat'), 800); await sleep(2000);
    return endClip();
  },
  async outro() { // 1:14-1:24 full 3D view
    await load(); await ev("document.querySelector('#layer-wifi').click()"); await sleep(600);
    await startClip('7-outro');
    await drag(900, 700, 1100, 640, 2600); await sleep(2200);
    return endClip();
  },
};

const want = process.argv.slice(2); const run = want.length ? want : Object.keys(scenes);
const totals = {};
try { for (const s of run) { if (!scenes[s]) throw new Error('unknown scene ' + s); totals[s] = await scenes[s](); } }
finally { console.log(JSON.stringify(totals)); chrome.kill(); }
process.exit(0);
