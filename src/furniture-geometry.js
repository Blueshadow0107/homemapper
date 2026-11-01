// Pure furniture helpers (no DOM/three): used by the editor, the airflow scenario and the tests.
// Plan coords [x, z] metres; rotation_deg clockwise on the plan (z points down), snapped to 0/90/180/270.

export const ROTATIONS = [0, 90, 180, 270];
export const normRot = (d) => ((Math.round((Number(d) || 0) / 90) * 90) % 360 + 360) % 360;

/** Axis-aligned footprint of a placed item in plan space: {x0,z0,x1,z1,w,d}. */
export function footprintRect(item, f) {
  const [w0, , d0] = item.size_m;
  const swap = normRot(f.rotation_deg) % 180 === 90;
  const w = swap ? d0 : w0;
  const d = swap ? w0 : d0;
  const [x, z] = f.position_m;
  return { x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2, w, d };
}

/** Solid furniture as plain boxes for the airflow solver: [{id,type,x0,z0,x1,z1,height_m}]. */
export function furnitureObstacles(fp, catalog) {
  const byId = new Map(catalog.items.map((i) => [i.id, i]));
  const out = [];
  for (const f of fp.furniture ?? []) {
    const item = byId.get(f.type);
    if (!item?.solid) continue;
    const r = footprintRect(item, f);
    out.push({ id: f.id, type: f.type, x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1, height_m: item.size_m[1] });
  }
  return out;
}
