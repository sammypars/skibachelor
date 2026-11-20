// Prints where every lift and lodge lands in 3D and checks the terrain
// matches the trail map's elevations. Run: npm run check
import { buildWorld, baseHeight } from '../src/world/world.js';
import { worldToPx } from '../src/world/projection.js';

const t0 = Date.now();
const w = buildWorld();
const M2FT = 3.28084;
console.log(`built in ${Date.now() - t0} ms, ${w.runs.length} runs`);
console.log('lift                   len(m)  vert(ft)  bottom(ft) top(ft)  base-cone-err(ft) bottom->top px');
for (const l of w.lifts) {
  const len = Math.hypot(l.top.x - l.bottom.x, l.top.z - l.bottom.z, l.top.y - l.bottom.y);
  const errB = (l.bottomFt - baseHeight(l.bottom.x, l.bottom.z) * M2FT).toFixed(0);
  const errT = (l.topFt - baseHeight(l.top.x, l.top.z) * M2FT).toFixed(0);
  const pb = worldToPx(l.bottom.x, l.bottom.y, l.bottom.z).map((v) => v.toFixed(0));
  const pt = worldToPx(l.top.x, l.top.y, l.top.z).map((v) => v.toFixed(0));
  console.log(
    l.name.padEnd(22),
    len.toFixed(0).padStart(6),
    ((l.top.y - l.bottom.y) * M2FT).toFixed(0).padStart(8),
    (l.bottom.y * M2FT).toFixed(0).padStart(10),
    (l.top.y * M2FT).toFixed(0).padStart(7),
    `${errB}/${errT}`.padStart(14),
    `  ${pb} -> ${pt}`,
  );
}
for (const l of w.lodges) console.log(l.name.padEnd(28), `x=${l.x.toFixed(0)} z=${l.z.toFixed(0)} ${(l.y * M2FT).toFixed(0)} ft`);
const counts = {};
w.runs.forEach((r) => (counts[r.difficulty] = (counts[r.difficulty] || 0) + 1));
console.log('runs by difficulty', counts);
let min = 1e9, max = -1e9;
for (const v of w.hf.h) { min = Math.min(min, v); max = Math.max(max, v); }
console.log(`terrain ${(min * M2FT).toFixed(0)}..${(max * M2FT).toFixed(0)} ft`);
