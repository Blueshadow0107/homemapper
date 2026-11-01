import * as THREE from 'three';

/** Build a THREE.Group for a catalog item (assets/furniture/catalog.json). Origin = floor centre of the footprint, y up. */
export function buildFurniture(item, { opacity = 1 } = {}) {
  const g = new THREE.Group();
  g.name = item.id;
  for (const p of item.parts) {
    const geo = p.shape === 'cyl' ? new THREE.CylinderGeometry(p.size[0] / 2, p.size[0] / 2, p.size[1], 20)
      : p.shape === 'sphere' ? new THREE.SphereGeometry(p.size[0] / 2, 18, 14)
      : new THREE.BoxGeometry(...p.size);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.75, transparent: opacity < 1, opacity }));
    m.position.set(...p.pos);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  g.userData = { id: item.id, footprint_m: item.footprint_m, solid: item.solid, heat_source: !!item.heat_source };
  return g;
}
