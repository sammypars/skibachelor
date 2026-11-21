import * as THREE from 'three';
import { DISTANT_PEAKS, FT } from '../data/mountain.js';
import { EDGE_HEIGHT } from '../world/world.js';
import { makeNoise2, smoothstep } from '../world/noise.js';
import { HORIZON } from './sky.js';

// Profiles for the surrounding volcanoes, k = 0 at the summit, 1 at the base.
const PROFILES = {
  cone: (k) => Math.pow(1 - k, 1.55),
  jagged: (k) => Math.pow(1 - k, 1.25),
  shield: (k) => Math.pow(1 - Math.pow(k, 1.4), 1.6),
  butte: (k) => Math.pow(1 - k * k, 1.8),
};
const RIDGES = { cone: 0.16, jagged: 0.42, shield: 0.08, butte: 0.05 };
const CRATER = { cone: 0.03, jagged: 0.12, shield: 0, butte: 0 };

// Distance haze baked into vertex colours so very far peaks stay visible
// (scene fog would erase them) but still sit back in the air.
function haze(dist) {
  return 0.88 * (1 - Math.exp(-dist / 42000));
}

function peakMesh(peak, seed) {
  const noise = makeNoise2(seed);
  const shape = peak.shape || 'cone';
  const rings = shape === 'butte' ? 18 : 36;
  const segs = shape === 'butte' ? 40 : 90;
  const top = peak.elevFt * FT - EDGE_HEIGHT;
  const profile = PROFILES[shape];
  const ridgeAmt = RIDGES[shape];
  const crater = CRATER[shape];
  const dist = Math.hypot(peak.x, peak.z);
  // Near peaks use the scene fog; far ones (which fog would erase) get haze
  // baked into their colours instead.
  const nearPeak = dist < 20000;
  const hz = nearPeak ? 0 : haze(dist);

  const grid = [];
  for (let ri = 0; ri <= rings; ri++) {
    const row = [];
    const k = ri / rings;
    for (let si = 0; si < segs; si++) {
      const a = (si / segs) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // Radial ridges and gullies, strongest mid-slope.
      const rib = 1 - Math.abs(noise(ca * 3.2 + k * 1.5, sa * 3.2 - k * 0.8));
      const lump = noise(ca * 1.2 + 7, sa * 1.2 + k * 2.2);
      let h = top * profile(k) * (1 + 0.18 * lump * (1 - k));
      h += top * ridgeAmt * (rib * rib - 0.4) * Math.sin(Math.PI * Math.min(1, k * 1.3)) * 0.35;
      if (crater && k < 0.12) h -= top * crater * (1 - k / 0.12);
      const r = k * peak.radius * (1 + 0.07 * noise(ca * 2 + 3, sa * 2));
      row.push(new THREE.Vector3(ca * r, Math.max(0, h), sa * r));
    }
    grid.push(row);
  }

  const pos = [];
  const col = [];
  const snow = new THREE.Color('#f3f6fa');
  const rock = new THREE.Color('#5d6066');
  const forest = new THREE.Color('#2a4a39');
  const sky = HORIZON.clone();
  const c = new THREE.Color();
  const n = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  for (let ri = 0; ri < rings; ri++) {
    for (let si = 0; si < segs; si++) {
      const a = grid[ri][si];
      const b = grid[ri + 1][si];
      const cc = grid[ri + 1][(si + 1) % segs];
      const d = grid[ri][(si + 1) % segs];
      for (const tri of [[a, cc, b], [a, d, cc]]) {
        e1.subVectors(tri[1], tri[0]);
        e2.subVectors(tri[2], tri[0]);
        n.crossVectors(e1, e2).normalize();
        const y = (tri[0].y + tri[1].y + tri[2].y) / 3 + EDGE_HEIGHT;
        const steep = 1 - n.y;
        // Winter: snow down to the forest; dark forest on the lower slopes.
        const forestAmt = 1 - smoothstep(1950, 2250, y + 120 * noise(tri[0].x / 900, tri[0].z / 900));
        c.copy(steep > 0.42 ? rock : snow);
        // (lerp is in linear light, so push hard toward the dark forest)
        c.lerp(forest, Math.min(1, forestAmt * 1.15) * 0.96);
        c.lerp(sky, hz);
        for (const v of tri) {
          pos.push(v.x, v.y, v.z);
          col.push(c.r, c.g, c.b);
        }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: nearPeak });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(peak.x, EDGE_HEIGHT - 3, peak.z);
  return mesh;
}

export function buildPeaks() {
  const group = new THREE.Group();
  const labels = [];
  DISTANT_PEAKS.forEach((p, i) => {
    group.add(peakMesh(p, 31 + i));
    labels.push({ name: p.name, pos: new THREE.Vector3(p.x, p.elevFt * FT + 250, p.z) });
  });
  return { group, labels };
}

// ------------------------------------------------------------------ clouds
// Soft cumulus: each cloud is a cluster of billboard puffs drawn from a
// few soft, lumpy canvas textures, lit from above (bright tops, grey bases).
function puffTexture(seed) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const noise = makeNoise2(seed);
  for (let k = 0; k < 26; k++) {
    const a = k * 2.399;
    const r = 30 + 60 * Math.abs(noise(k, 1.3));
    const x = 128 + Math.cos(a) * r * 0.9;
    const y = 140 + Math.sin(a) * r * 0.45 - 10;
    const s = 38 + 30 * Math.abs(noise(k, 7.1));
    const g = ctx.createRadialGradient(x, y - s * 0.3, 0, x, y, s);
    const shade = Math.round(255 - Math.max(0, y - 120) * 0.55);
    g.addColorStop(0, `rgba(${shade},${shade},${Math.min(255, shade + 6)},0.55)`);
    g.addColorStop(0.6, `rgba(${shade - 8},${shade - 6},${shade},0.25)`);
    g.addColorStop(1, 'rgba(230,236,244,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildClouds() {
  const group = new THREE.Group();
  const noise = makeNoise2(88);
  const mats = [11, 12, 13].map(
    (seed) => new THREE.SpriteMaterial({ map: puffTexture(seed), fog: false, depthWrite: false, transparent: true, opacity: 0.95 }),
  );
  for (let i = 0; i < 18; i++) {
    const ang = (i / 18) * Math.PI * 2 + noise(i, 0.3) * 0.4;
    const r = 16000 + 16000 * (0.5 + 0.5 * noise(i * 1.7, 4.1));
    const cx = Math.sin(ang) * r;
    const cz = Math.cos(ang) * r;
    const cy = 4300 + 900 * noise(i, 9);
    const size = 900 + 800 * (0.5 + 0.5 * noise(i, 2));
    const count = 4 + (i % 4);
    for (let k = 0; k < count; k++) {
      const t = count > 1 ? k / (count - 1) - 0.5 : 0;
      const sp = new THREE.Sprite(mats[(i + k) % mats.length]);
      const s = size * (1.4 + 0.9 * (1 - Math.abs(t) * 1.4));
      sp.scale.set(s * 1.6, s, 1);
      sp.position.set(
        cx + t * size * 2.4 + noise(i, k) * size * 0.3,
        cy + (1 - Math.abs(t) * 2) * size * 0.2,
        cz + noise(k, i) * size * 0.5,
      );
      sp.renderOrder = -1;
      group.add(sp);
    }
  }
  return group;
}
