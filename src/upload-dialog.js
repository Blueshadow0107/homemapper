// Pre-flight for an AI floorplan read: show the image, let the user crop to ONE plan (deterministic, beats asking the
// model to guess which plan on a sheet) and optionally type a real overall width (beats a guessed scale).
// Resolves {image:dataURL (cropped, <=1600px), width:cropW, height:cropH, widthHintM|null} or null if cancelled.

const FT = 0.3048;

export function openUploadDialog(file) {
  return new Promise(async (resolve) => {
    let bmp;
    try {
      bmp = await createImageBitmap(file);
    } catch {
      return resolve({ error: 'That file could not be read as an image.' });
    }
    const wrap = document.createElement('div');
    wrap.className = 'ud-overlay';
    wrap.innerHTML = `<div class="ud-box" role="dialog" aria-label="Read floorplan">
      <div class="ud-title">Read floorplan</div>
      <p class="ud-hint">Drag on the image to crop to <b>one plan</b> (skip elevations, legends, other layouts). A tight crop reads better.</p>
      <canvas class="ud-canvas"></canvas>
      <div class="ud-row">
        <label>Overall building width in this crop (optional)
          <span><input class="ud-width" type="number" min="0.5" step="0.1" placeholder="e.g. 11.2" />
          <select class="ud-unit"><option value="m">m</option><option value="ft">ft</option></select></span></label>
        <small>Without it the scale is a guess you must fix by hand.</small>
      </div>
      <div class="ud-actions"><button class="icon-button ud-reset" type="button">Reset crop</button><span class="ud-spacer"></span>
        <button class="icon-button ud-cancel" type="button">Cancel</button><button class="icon-button primary ud-go" type="button">Read plan</button></div>
    </div>`;
    document.body.append(wrap);
    const cv = wrap.querySelector('.ud-canvas');
    const k = Math.min(1, 640 / bmp.width, 360 / bmp.height);
    cv.width = Math.round(bmp.width * k);
    cv.height = Math.round(bmp.height * k);
    const g = cv.getContext('2d');
    let crop = null; // in canvas px
    let start = null;
    const draw = () => {
      g.clearRect(0, 0, cv.width, cv.height);
      g.drawImage(bmp, 0, 0, cv.width, cv.height);
      if (crop) {
        g.fillStyle = 'rgba(20,16,36,0.55)';
        g.fillRect(0, 0, cv.width, cv.height);
        g.drawImage(bmp, crop.x / k, crop.y / k, crop.w / k, crop.h / k, crop.x, crop.y, crop.w, crop.h);
        g.strokeStyle = '#7a4dff';
        g.lineWidth = 2;
        g.strokeRect(crop.x, crop.y, crop.w, crop.h);
      }
    };
    draw();
    const pos = (e) => {
      const r = cv.getBoundingClientRect();
      return [Math.min(cv.width, Math.max(0, ((e.clientX - r.left) / r.width) * cv.width)), Math.min(cv.height, Math.max(0, ((e.clientY - r.top) / r.height) * cv.height))];
    };
    cv.addEventListener('pointerdown', (e) => {
      start = pos(e);
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!start) return;
      const [x, y] = pos(e);
      crop = { x: Math.min(start[0], x), y: Math.min(start[1], y), w: Math.abs(x - start[0]), h: Math.abs(y - start[1]) };
      draw();
    });
    cv.addEventListener('pointerup', () => {
      start = null;
      if (crop && (crop.w < 30 || crop.h < 30)) crop = null; // accidental click
      draw();
    });
    const close = (v) => {
      wrap.remove();
      resolve(v);
    };
    wrap.querySelector('.ud-reset').addEventListener('click', () => {
      crop = null;
      draw();
    });
    wrap.querySelector('.ud-cancel').addEventListener('click', () => close(null));
    wrap.addEventListener('keydown', (e) => e.key === 'Escape' && close(null));
    wrap.querySelector('.ud-go').addEventListener('click', () => {
      const sx = crop ? crop.x / k : 0;
      const sy = crop ? crop.y / k : 0;
      const sw = crop ? crop.w / k : bmp.width;
      const sh = crop ? crop.h / k : bmp.height;
      const s = Math.min(1, 1600 / Math.max(sw, sh));
      const out = document.createElement('canvas');
      out.width = Math.round(sw * s);
      out.height = Math.round(sh * s);
      const og = out.getContext('2d');
      og.fillStyle = '#fff';
      og.fillRect(0, 0, out.width, out.height);
      og.drawImage(bmp, sx, sy, sw, sh, 0, 0, out.width, out.height);
      const v = Number(wrap.querySelector('.ud-width').value);
      const unit = wrap.querySelector('.ud-unit').value;
      close({ image: out.toDataURL('image/jpeg', 0.88), width: out.width, height: out.height, widthHintM: v > 0 ? v * (unit === 'ft' ? FT : 1) : null });
    });
    wrap.tabIndex = -1;
    wrap.focus();
  });
}
