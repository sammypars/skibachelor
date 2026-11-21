// Prints where every lift and lodge lands in 3D, and how well the painted
// trail map lines up with the real positions. Run: npm run check
import { buildWorld } from '../src/world/world.js';
import { loadGeo } from '../src/world/geo.js';

const t0 = Date.now();
const w = buildWorld(await loadGeo());
const M2FT = 3.28084;
const ft = (m) => Math.round(m * M2FT);
console.log(`built in ${Date.now() - t0} ms: ${w.runs.length} runs, ${w.nordicTrails.length} Nordic trails, ` +
  `${w.buildings.length} building parts, ${w.roads.length} roads, ${w.parking.length} lots, ${w.lakes.length} lakes`);
console.log('lift                   horiz(m)  vert(ft)  bottom(ft)  top(ft)   trail-map px bottom -> top');
for (const l of w.lifts) {
  const horiz = Math.hypot(l.top.x - l.bottom.x, l.top.z - l.bottom.z);
  const pb = w.toMapPx(l.bottom.x, l.bottom.y, l.bottom.z).map((v) => v.toFixed(0));
  const pt = w.toMapPx(l.top.x, l.top.y, l.top.z).map((v) => v.toFixed(0));
  console.log(
    l.name.padEnd(22),
    horiz.toFixed(0).padStart(8),
    String(ft(l.top.y - l.bottom.y)).padStart(9),
    String(ft(l.bottom.y)).padStart(11),
    String(ft(l.top.y)).padStart(8),
    `   ${pb} -> ${pt}`,
  );
}
for (const l of w.lodges) console.log(l.name.padEnd(28), `x=${l.x.toFixed(0)} z=${l.z.toFixed(0)} ${ft(l.y)} ft`);
const pm = w.lifts.find((l) => l.id === 'pine-marten');
const pml = w.lodges.find((l) => l.id === 'pine-marten-lodge');
console.log(`Pine Marten Lodge is ${(pml.x - pm.top.x).toFixed(0)} m ${pml.x > pm.top.x ? 'west (right on the trail map)' : 'east (left on the trail map)'} of the lift top`);
const res = w.toMapPx.residuals;
console.log(`trail-map fit: mean ${(res.reduce((a, b) => a + b, 0) / res.length).toFixed(1)} px, worst ${Math.max(...res).toFixed(1)} px`);
const counts = {};
w.runs.forEach((r) => (counts[`${r.kind}/${r.difficulty}`] = (counts[`${r.kind}/${r.difficulty}`] || 0) + 1));
console.log('runs', counts);
// Steepest ground under any lift terminal pad: catches spikes and pillars.
let worst = 0;
for (const l of w.lifts) {
  for (const p of [l.bottom, l.top]) {
    for (let a = 0; a < 8; a++) {
      const x = p.x + Math.cos(a) * 30;
      const z = p.z + Math.sin(a) * 30;
      worst = Math.max(worst, Math.abs(w.hf.heightAt(x, z) - p.y) / 30);
    }
  }
}
console.log(`steepest ground 30 m from a lift terminal: ${(Math.atan(worst) * 57.3).toFixed(0)} deg`);
let min = 1e9;
let max = -1e9;
for (const v of w.hf.h) {
  min = Math.min(min, v);
  max = Math.max(max, v);
}
console.log(`terrain ${ft(min)}..${ft(max)} ft`);
