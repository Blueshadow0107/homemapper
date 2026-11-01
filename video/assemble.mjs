// Assemble the captioned, voiceless demo from capture.mjs clips -> video/out/homemapper-demo.mp4 (git-ignored).
// Timeline follows docs/demo-video.md; each clip is sped up (max 1.6x) or freeze-padded to its slot. Open captions are burned in.
//   node video/assemble.mjs        (run `node video/capture.mjs` first)
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT || path.join(HERE, 'out');
const FONT = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf';
const FFMPEG = '/usr/bin/ffmpeg', FFPROBE = '/usr/bin/ffprobe';
const dur = (f) => +execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();

// slot = seconds on the final timeline; captions = [start offset in slot, end offset, text]
const rows = [
  { clip: '1-intro', slot: 7, caps: [[0.3, 6.7, 'Early-stage house design: compare heating and router placement']] },
  { clip: '2-upload', slot: 12, caps: [[0.3, 5.5, 'Upload a plan image: an AI draft, not verified'], [5.5, 11.7, 'Review and correct it in 2D, then confirm it']] },
  { clip: '3-inspect', slot: 11, caps: [[0.3, 4.5, 'Same plan, now in 3D: inspect the rooms'], [4.5, 10.7, 'Orbit the shell']] },
  { clip: '4-wifi', slot: 17, caps: [[0.3, 8, 'Wi-Fi (estimated): move the router, see coverage change'], [8, 16.7, 'Add a reading to compare with reality at one spot']] },
  { clip: '5-heat', slot: 16, caps: [[0.3, 7, 'Heating (quantitative estimate): add a radiator'], [7, 15.7, 'Room temperatures over time, from a lumped model']] },
  { clip: '6-air', slot: 10, caps: [[0.3, 9.7, 'Airflow (qualitative): where warm air tends to move']] },
  { clip: '7-outro', slot: 10, caps: [[0.3, 3.4, 'Early-stage estimates to compare options, not a survey'], [3.4, 6.7, 'Next: windows, multiple floors, furniture-heat-airflow interaction'], [6.7, 9.7, 'Solo build in a day with Claude, Kimi and Codex (AI agents)']] },
];
const esc = (t) => t.replace(/[\\:']/g, (c) => '\\' + c);
const parts = [];
for (const [i, r] of rows.entries()) {
  const src = path.join(OUT, r.clip + '.mp4');
  if (!existsSync(src)) throw new Error('missing clip ' + src + ' (run capture.mjs)');
  const d = dur(src); const speed = Math.min(1.6, Math.max(1, d / r.slot));
  const played = d / speed; const pad = Math.max(0, r.slot - played);
  const dt = r.caps.map(([a, b, t]) => `drawtext=fontfile=${FONT}:text='${esc(t)}':fontsize=34:fontcolor=white:box=1:boxcolor=0x14102ab8:boxborderw=14:x=max(400\\,(w-text_w)/2):y=34:enable='gte(t,${a})*lt(t,${b})'`).join(',');
  const f = path.join(OUT, `seg-${i}.mp4`);
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', src, '-vf', `setpts=PTS/${speed.toFixed(4)},tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)},${dt},fps=30,format=yuv420p`, '-t', String(r.slot), '-an', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', f]);
  parts.push(f);
  console.log(`${r.clip}: ${d.toFixed(1)} s -> slot ${r.slot} s (x${speed.toFixed(2)}${pad > 0.05 ? `, +${pad.toFixed(1)} s freeze` : ''})`);
}
writeFileSync(path.join(OUT, 'concat.txt'), parts.map((p) => `file '${p}'`).join('\n'));
const final = path.join(OUT, 'homemapper-demo.mp4');
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(OUT, 'concat.txt'), '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-shortest', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', final]);
console.log(`final: ${final} ${dur(final).toFixed(2)} s`);
