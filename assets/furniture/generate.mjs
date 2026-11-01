// Procedural furniture catalog -> catalog.json. Units: metres, y up. Origin = centre of the floor footprint.
// Each part is {shape:'box'|'cyl'|'sphere', pos:[x,y,z] (centre), size:[w,h,d], color}. Cylinders/spheres use size too (w=diameter).
// `solid` = blocks air (CFD obstacle footprint); `footprint_m` = [w, d] for placement/collision.
import { writeFileSync } from 'node:fs';

const C = {
  wood: '#b98a5e', woodDark: '#8a5f3c', woodPale: '#dcc29a', fabric: '#7a5cc4', fabricLight: '#a88de0', cream: '#ece4d6',
  white: '#f2f0f7', metal: '#b9b6c8', dark: '#2b2440', teal: '#5fb3a8', pink: '#e59bb8', green: '#5f9e6e', red: '#c4544f', blue: '#5b86c9', ceramic: '#f7f5fb',
};
const b = (x, y, z, w, h, d, color) => ({ shape: 'box', pos: [x, y + h / 2, z], size: [w, h, d], color }); // (x,z) centre, y = bottom
const cyl = (x, y, z, dia, h, color) => ({ shape: 'cyl', pos: [x, y + h / 2, z], size: [dia, h, dia], color });
const sph = (x, y, z, dia, color) => ({ shape: 'sphere', pos: [x, y + dia / 2, z], size: [dia, dia, dia], color });
const legs = (w, d, h, t, color, inset = 0.04) => [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => b(sx * (w / 2 - inset - t / 2), 0, sz * (d / 2 - inset - t / 2), t, h, t, color));

const items = [
  { id: 'bed_double', name: 'Double bed', category: 'bedroom', size_m: [1.6, 1.0, 2.1], solid: true, parts: [
    b(0, 0.1, 0, 1.6, 0.25, 2.1, C.woodDark), b(0, 0.35, 0.02, 1.5, 0.22, 2.0, C.cream), b(0, 0.35, 0.02, 1.52, 0.1, 1.2, C.fabricLight),
    b(0, 0.1, -1.0, 1.6, 0.9, 0.1, C.wood), b(-0.38, 0.57, -0.7, 0.55, 0.12, 0.35, C.white), b(0.38, 0.57, -0.7, 0.55, 0.12, 0.35, C.white), ...legs(1.6, 2.1, 0.1, 0.08, C.woodDark, 0) ] },
  { id: 'sofa', name: 'Sofa', category: 'living', size_m: [2.0, 0.85, 0.95], solid: true, parts: [
    b(0, 0.12, 0, 2.0, 0.28, 0.95, C.fabric), b(-0.47, 0.4, 0.06, 0.9, 0.17, 0.75, C.fabricLight), b(0.47, 0.4, 0.06, 0.9, 0.17, 0.75, C.fabricLight),
    b(0, 0.4, -0.38, 2.0, 0.45, 0.2, C.fabric), b(-0.9, 0.4, 0.06, 0.2, 0.27, 0.8, C.fabric), b(0.9, 0.4, 0.06, 0.2, 0.27, 0.8, C.fabric), ...legs(2.0, 0.95, 0.12, 0.05, C.dark, 0.05) ] },
  { id: 'armchair', name: 'Armchair', category: 'living', size_m: [0.85, 0.85, 0.85], solid: true, parts: [
    b(0, 0.12, 0, 0.85, 0.25, 0.85, C.teal), b(0, 0.37, 0.08, 0.5, 0.15, 0.6, '#7fcbc0'), b(0, 0.37, -0.35, 0.85, 0.48, 0.18, C.teal), b(-0.34, 0.37, 0.08, 0.17, 0.25, 0.7, C.teal), b(0.34, 0.37, 0.08, 0.17, 0.25, 0.7, C.teal), ...legs(0.85, 0.85, 0.12, 0.05, C.dark, 0.05) ] },
  { id: 'coffee_table', name: 'Coffee table', category: 'living', size_m: [1.1, 0.42, 0.6], solid: false, parts: [b(0, 0.36, 0, 1.1, 0.06, 0.6, C.woodPale), ...legs(1.1, 0.6, 0.36, 0.05, C.wood, 0.05)] },
  { id: 'tv_unit', name: 'TV unit + TV', category: 'living', size_m: [1.5, 1.0, 0.42], solid: true, parts: [
    b(0, 0, 0, 1.5, 0.45, 0.42, C.wood), b(0, 0.45, 0, 1.52, 0.03, 0.44, C.woodDark), b(0, 0.9 - 0.4, 0, 0.04, 0.12, 0.04, C.dark), b(0, 0.55, 0, 1.15, 0.45, 0.05, C.dark), b(0, 0.57, 0.03, 1.07, 0.38, 0.01, '#3b3560') ] },
  { id: 'dining_table', name: 'Dining table', category: 'dining', size_m: [1.6, 0.75, 0.9], solid: false, parts: [b(0, 0.71, 0, 1.6, 0.05, 0.9, C.wood), ...legs(1.6, 0.9, 0.71, 0.07, C.woodDark, 0.06)] },
  { id: 'chair', name: 'Chair', category: 'dining', size_m: [0.45, 0.9, 0.45], solid: false, parts: [
    b(0, 0.44, 0, 0.45, 0.05, 0.45, C.wood), ...legs(0.45, 0.45, 0.44, 0.04, C.woodDark, 0), b(0, 0.49, -0.2, 0.45, 0.41, 0.04, C.wood) ] },
  { id: 'desk', name: 'Desk', category: 'office', size_m: [1.3, 1.0, 0.62], solid: false, parts: [
    b(0, 0.71, 0, 1.3, 0.04, 0.62, C.woodPale), b(-0.5, 0, 0, 0.3, 0.71, 0.58, C.wood), b(0.57, 0, -0.26, 0.05, 0.71, 0.05, C.woodDark), b(0.57, 0, 0.26, 0.05, 0.71, 0.05, C.woodDark), b(0.1, 0.75, -0.1, 0.34, 0.02, 0.24, C.dark), b(0.1, 0.77, -0.2, 0.34, 0.22, 0.01, '#3b3560') ] },
  { id: 'wardrobe', name: 'Wardrobe', category: 'bedroom', size_m: [1.1, 2.0, 0.58], solid: true, parts: [
    b(0, 0, 0, 1.1, 2.0, 0.58, C.cream), b(-0.275, 0.05, 0.295, 0.52, 1.9, 0.01, C.woodPale), b(0.275, 0.05, 0.295, 0.52, 1.9, 0.01, C.woodPale), b(-0.04, 1.0, 0.31, 0.02, 0.2, 0.02, C.metal), b(0.04, 1.0, 0.31, 0.02, 0.2, 0.02, C.metal) ] },
  { id: 'bookshelf', name: 'Bookshelf', category: 'living', size_m: [0.85, 1.85, 0.3], solid: true, parts: [
    b(-0.4, 0, 0, 0.04, 1.85, 0.3, C.wood), b(0.4, 0, 0, 0.04, 1.85, 0.3, C.wood), b(0, 1.81, 0, 0.84, 0.04, 0.3, C.wood), ...[0, 0.45, 0.9, 1.35].map((y) => b(0, y, 0, 0.78, 0.04, 0.3, C.wood)),
    b(-0.28, 0.04, 0, 0.06, 0.34, 0.2, C.red), b(-0.2, 0.04, 0, 0.07, 0.38, 0.2, C.blue), b(-0.1, 0.04, 0, 0.05, 0.3, 0.2, C.green), b(0.2, 0.49, 0, 0.08, 0.36, 0.2, C.fabric), b(0.3, 0.49, 0, 0.05, 0.32, 0.2, C.pink), b(-0.2, 0.94, 0, 0.3, 0.3, 0.2, C.cream), b(0.15, 1.39, 0, 0.06, 0.3, 0.2, C.teal), b(0.25, 1.39, 0, 0.08, 0.36, 0.2, C.red) ] },
  { id: 'fridge', name: 'Fridge-freezer', category: 'kitchen', size_m: [0.6, 1.8, 0.65], solid: true, parts: [
    b(0, 0, 0, 0.6, 1.8, 0.65, C.white), b(0, 1.15, 0.33, 0.58, 0.01, 0.01, C.metal), b(0.22, 1.2, 0.34, 0.02, 0.4, 0.03, C.metal), b(0.22, 0.6, 0.34, 0.02, 0.25, 0.03, C.metal) ] },
  { id: 'kitchen_counter', name: 'Kitchen counter + hob', category: 'kitchen', size_m: [1.2, 0.92, 0.6], solid: true, parts: [
    b(0, 0, 0, 1.2, 0.86, 0.6, C.cream), b(0, 0.86, 0, 1.22, 0.04, 0.62, C.dark), cyl(-0.25, 0.9, -0.05, 0.18, 0.01, C.metal), cyl(0.15, 0.9, -0.05, 0.18, 0.01, C.metal), cyl(-0.25, 0.9, 0.17, 0.12, 0.01, C.metal), cyl(0.15, 0.9, 0.17, 0.12, 0.01, C.metal) ] },
  { id: 'radiator', name: 'Panel radiator', category: 'heating', size_m: [0.9, 0.75, 0.1], solid: false, heat_source: true, parts: [
    b(0, 0.15, 0, 0.9, 0.6, 0.06, C.white), ...[-0.36, -0.24, -0.12, 0, 0.12, 0.24, 0.36].map((x) => b(x, 0.15, 0.04, 0.02, 0.6, 0.03, '#d9d5e6')), b(-0.4, 0.1, -0.02, 0.03, 0.05, 0.03, C.metal), b(0.4, 0.1, -0.02, 0.03, 0.05, 0.03, C.metal) ] },
  { id: 'bathtub', name: 'Bathtub', category: 'bathroom', size_m: [1.7, 0.72, 0.75], solid: true, parts: [
    b(0, 0, 0, 1.7, 0.58, 0.75, C.ceramic), b(0, 0.5, 0, 1.5, 0.09, 0.55, '#cfe3ee'), cyl(0.75, 0.58, -0.3, 0.05, 0.12, C.metal) ] },
  { id: 'toilet', name: 'Toilet', category: 'bathroom', size_m: [0.4, 0.78, 0.7], solid: true, parts: [
    b(0, 0.35, -0.22, 0.38, 0.4, 0.2, C.ceramic), cyl(0, 0, 0.0, 0.34, 0.4, C.ceramic), b(0, 0.4, 0.05, 0.36, 0.03, 0.4, C.white), b(0.1, 0.72, -0.22, 0.05, 0.06, 0.03, C.metal) ] },
  { id: 'sink', name: 'Washbasin', category: 'bathroom', size_m: [0.55, 1.05, 0.45], solid: true, parts: [
    b(0, 0, 0, 0.5, 0.78, 0.4, C.ceramic), b(0, 0.78, 0, 0.55, 0.1, 0.45, C.ceramic), b(0, 0.88, -0.14, 0.03, 0.18, 0.03, C.metal), b(0, 1.0, -0.06, 0.03, 0.03, 0.18, C.metal) ] },
  { id: 'plant', name: 'Pot plant', category: 'decor', size_m: [0.5, 1.2, 0.5], solid: false, parts: [
    cyl(0, 0, 0, 0.36, 0.34, '#c97b5a'), cyl(0, 0.3, 0, 0.3, 0.06, '#6b4a33'), sph(0, 0.5, 0, 0.55, C.green), sph(0.1, 0.8, 0.05, 0.4, '#79b887') ] },
  { id: 'rug', name: 'Rug', category: 'decor', size_m: [2.0, 0.02, 1.4], solid: false, parts: [b(0, 0, 0, 2.0, 0.02, 1.4, C.fabricLight), b(0, 0.02, 0, 1.7, 0.005, 1.1, C.cream)] },
];

for (const it of items) it.footprint_m = [it.size_m[0], it.size_m[2]];
writeFileSync(new URL('./catalog.json', import.meta.url), JSON.stringify({ units: 'm', up: 'y', origin: 'floor centre of footprint', items }, null, 2) + '\n');
console.log(`wrote ${items.length} items`);
