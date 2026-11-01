// Strict normalisation of any floorplan that enters the app from outside (JSON import, AI draft).
// Output contains ONLY whitelisted fields with coerced types/ranges, so it is safe to feed to the model, the
// viewer and (escaped) the DOM. Throws a readable Error on structurally unusable input.

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const MAT = /^[a-z0-9_]{1,24}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const num = (v, lo, hi, dflt) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const str = (v, max, dflt) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : dflt);
const COORD = 1000; // metres; anything larger is certainly a unit mistake
function point(p, what) {
  if (!Array.isArray(p) || p.length !== 2) throw new Error(`${what}: expected [x, z]`);
  const x = typeof p[0] === 'number' ? p[0] : NaN;
  const z = typeof p[1] === 'number' ? p[1] : NaN;
  if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > COORD || Math.abs(z) > COORD) throw new Error(`${what}: coordinates must be finite numbers within ±${COORD} m`);
  return [x, z];
}
const PALETTE = ['#d8cdf6', '#c5dff0', '#d1eadc', '#f3d9c4', '#f0cfe0', '#e6e3b8'];

export function normalizePlan(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('plan must be a JSON object');
  if (!Array.isArray(raw.rooms) || !Array.isArray(raw.walls)) throw new Error('needs rooms[] and walls[]');
  if (raw.rooms.length < 1 || raw.rooms.length > 64) throw new Error('rooms: need 1–64');
  if (raw.walls.length > 512) throw new Error('walls: at most 512');

  const usedRoom = new Set();
  const rooms = raw.rooms.map((r, i) => {
    if (!r || typeof r !== 'object') throw new Error(`room ${i + 1}: not an object`);
    if (!Array.isArray(r.polygon) || r.polygon.length < 3 || r.polygon.length > 64) throw new Error(`room ${i + 1}: polygon needs 3–64 corners`);
    let id = typeof r.id === 'string' && ID.test(r.id) ? r.id : `room-${i + 1}`;
    while (usedRoom.has(id)) id += '_';
    usedRoom.add(id);
    return {
      id,
      name: str(r.name, 60, `Room ${i + 1}`),
      polygon: r.polygon.map((p, j) => point(p, `room ${i + 1} corner ${j + 1}`)),
      color: typeof r.color === 'string' && HEX.test(r.color) ? r.color : PALETTE[i % PALETTE.length],
    };
  });

  const walls = raw.walls.map((w, i) => {
    if (!w || typeof w !== 'object') throw new Error(`wall ${i + 1}: not an object`);
    const exposure = (w.exposure ?? w.type) === 'exterior' ? 'exterior' : 'interior';
    return {
      id: typeof w.id === 'string' && ID.test(w.id) ? w.id : `wall-${i + 1}`,
      a: point(w.a, `wall ${i + 1} start`),
      b: point(w.b, `wall ${i + 1} end`),
      thickness_m: num(w.thickness_m, 0.02, 1, exposure === 'exterior' ? 0.16 : 0.1),
      material_id: typeof w.material_id === 'string' && MAT.test(w.material_id) ? w.material_id : exposure === 'exterior' ? 'brick' : 'plasterboard',
      exposure,
      type: exposure,
    };
  });

  const openings = (Array.isArray(raw.openings) ? raw.openings : []).slice(0, 256).filter((o) => o && typeof o === 'object').map((o) => ({
    wall: typeof o.wall === 'string' && ID.test(o.wall) ? o.wall : Number.isInteger(o.wall) && o.wall >= 0 && o.wall < 512 ? o.wall : undefined,
    t: num(o.t, 0, 1, 0.5),
    width: num(o.width, 0.2, 5, 0.9),
    height: num(o.height, 0.2, 4, 2.0),
    type: o.type === 'window' ? 'window' : 'door',
    material_id: typeof o.material_id === 'string' && MAT.test(o.material_id) ? o.material_id : undefined,
    closed: o.closed !== false,
  }));

  const usedF = new Set();
  const furniture = (Array.isArray(raw.furniture) ? raw.furniture : []).slice(0, 200).filter((f) => f && typeof f === 'object' && typeof f.type === 'string' && MAT.test(f.type)).map((f, i) => {
    let id = typeof f.id === 'string' && ID.test(f.id) ? f.id : `furn-${i + 1}`;
    while (usedF.has(id)) id += '_';
    usedF.add(id);
    return { id, type: f.type, position_m: point(f.position_m, `furniture ${i + 1}`), rotation_deg: ((Math.round(num(f.rotation_deg, -3600, 3600, 0) / 90) * 90) % 360 + 360) % 360 };
  });

  const plan = {
    schema_version: 1,
    name: str(raw.name, 80, 'Imported plan'),
    units: 'm',
    ceiling_height_m: num(raw.ceiling_height_m, 2, 6, 2.7),
    rooms,
    walls,
    openings,
    furniture,
  };
  if (raw.draft && typeof raw.draft === 'object') plan.draft = { source: str(raw.draft.source, 20, 'unknown'), reviewed: raw.draft.reviewed === true };
  if (raw.materials && typeof raw.materials === 'object' && !Array.isArray(raw.materials)) {
    plan.materials = {};
    for (const [k, v] of Object.entries(raw.materials).slice(0, 32)) {
      if (!MAT.test(k) || !v || typeof v !== 'object') continue;
      plan.materials[k] = {};
      for (const f of ['wifi_loss_db', 'wifi_loss_db_2p4', 'wifi_loss_db_5', 'u_value_w_m2k']) if (f in v) plan.materials[k][f] = num(v[f], 0, 100, 0);
    }
  }
  return plan;
}
