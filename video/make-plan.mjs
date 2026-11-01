// Generates video/synthetic-plan.png: a fully synthetic, rectilinear demo floorplan (not from any real home or book).
// Used by capture.mjs for the "upload a plan image" shot. Output is gitignored; re-create with `node video/make-plan.mjs`.
import { writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const S = 80, X0 = 90, Y0 = 110, W = 11.2, D = 8.0; // px per metre, plan origin
const px = (m) => m * S;
const wall = (x1, z1, x2, z2, t = 5) => `<line x1="${X0 + px(x1)}" y1="${Y0 + px(z1)}" x2="${X0 + px(x2)}" y2="${Y0 + px(z2)}" stroke="#222" stroke-width="${t}" stroke-linecap="square"/>`;
const label = (x, z, t, sub) => `<text x="${X0 + px(x)}" y="${Y0 + px(z)}" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="20" fill="#333">${t}</text><text x="${X0 + px(x)}" y="${Y0 + px(z) + 22}" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="14" fill="#777">${sub}</text>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="820" viewBox="0 0 1100 820"><rect width="1100" height="820" fill="#fff"/>
<text x="90" y="60" font-family="Helvetica,Arial,sans-serif" font-size="22" fill="#222" font-weight="bold">SYNTHETIC DEMO PLAN</text>
<text x="90" y="86" font-family="Helvetica,Arial,sans-serif" font-size="14" fill="#777">generated for the Home Comfort Twin demo, not a real building</text>
${wall(0, 0, W, 0, 9)}${wall(W, 0, W, D, 9)}${wall(W, D, 0, D, 9)}${wall(0, D, 0, 0, 9)}
${wall(0, 4, W, 4)}${wall(6, 0, 6, D)}
${label(3, 2, 'BEDROOM', '6.0 x 4.0 m')}${label(8.6, 2, 'STUDY', '5.2 x 4.0 m')}
${label(3, 6, 'LIVING ROOM', '6.0 x 4.0 m')}${label(8.6, 6, 'KITCHEN', '5.2 x 4.0 m')}
<line x1="${X0}" y1="${Y0 + px(D) + 40}" x2="${X0 + px(W)}" y2="${Y0 + px(D) + 40}" stroke="#222" stroke-width="2"/>
<line x1="${X0}" y1="${Y0 + px(D) + 30}" x2="${X0}" y2="${Y0 + px(D) + 50}" stroke="#222" stroke-width="2"/><line x1="${X0 + px(W)}" y1="${Y0 + px(D) + 30}" x2="${X0 + px(W)}" y2="${Y0 + px(D) + 50}" stroke="#222" stroke-width="2"/>
<text x="${X0 + px(W) / 2}" y="${Y0 + px(D) + 70}" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="20" fill="#222">11.2 m</text></svg>`;
const svgPath = path.join(HERE, 'synthetic-plan.svg');
writeFileSync(svgPath, svg);
const out = path.join(HERE, 'synthetic-plan.png');
const r = spawnSync('brave-browser', ['--headless=new', '--no-sandbox', '--disable-gpu', `--screenshot=${out}`, '--window-size=1100,820', `file://${svgPath}`], { stdio: 'ignore' });
console.log(r.status === 0 ? `wrote ${out}` : 'brave screenshot failed');
