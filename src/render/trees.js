import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm, noise2, smoothstep, seededRandom } from '../world/noise.js';
import { EDGE_HEIGHT } from '../world/world.js';
import { GEO } from '../data/mountain.js';

const MAX_TREES = 155000;
const MAX_GHOSTS = 9000;

function colorize(geo, fn) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    fn(c, pos.getX(i), pos.getY(i), pos.getZ(i));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// Low-poly fir, ~1 unit = 1 m, about 12 m tall before instance scaling.
function firGeometry() {
  const parts = [];
  const tiers = [
    { r: 3.1, h: 5.6, y: 0.4 },
    { r: 2.4, h: 4.8, y: 3.9 },
    { r: 1.6, h: 4.4, y: 7.1 },
  ];
  const dark = new THREE.Color('#1f3d2b');
  const mid = new THREE.Color('#2f5a3e');
  const snow = new THREE.Color('#e9f0f4');
  for (const t of tiers) {
    const cone = new THREE.ConeGeometry(t.r, t.h, 7, 1, true).translate(0, t.y + t.h / 2, 0);
    parts.push(
      colorize(cone.toNonIndexed(), (c, x, y, z) => {
        const k = (y - t.y) / t.h; // 0 at the skirt, 1 at the tip
        // Snow-dusted tip fading to a dark skirt; every other branch tip on
        // the skirt holds a clump of snow.
        if (k > 0.98) c.copy(snow).lerp(mid, 0.62);
        else {
          const ang = Math.atan2(z, x);
          const tipSnow = Math.round(((ang + Math.PI) / (Math.PI * 2)) * 7) % 2 === 0;
          c.copy(dark).lerp(mid, 0.35);
          if (tipSnow) c.lerp(snow, 0.3);
        }
      }),
    );
  }
  return mergeGeometries(parts);
}

// Rime-crusted "snow ghost" near treeline.
function ghostGeometry() {
  const parts = [];
  const blobs = [
    { r: 2.2, y: 2.2, s: [1, 1.15, 1] },
    { r: 1.8, y: 5.0, s: [1, 1.25, 1] },
    { r: 1.2, y: 7.4, s: [1, 1.4, 1] },
  ];
  for (const b of blobs) {
    const g = new THREE.IcosahedronGeometry(b.r, 0).scale(...b.s).translate(0, b.y, 0);
    parts.push(
      colorize(g, (c, x, y) => {
        c.set('#f3f7fb').lerp(new THREE.Color('#c9d6e3'), Math.max(0, (b.y - y) / (b.r * 2)));
      }),
    );
  }
  return mergeGeometries(parts);
}

export function buildForest(world) {
  const { hf, clear, treeline, canopyAt, openAt } = world;
  const rand = seededRandom(7775);
  const firs = [];
  const outer = []; // trees beyond the heightfield edge (horizon filler)
  const ghosts = [];

  // Puts a tree (or a rime-crusted snow ghost near treeline) at x, z.
  const plant = (x, z, y, alt, inside) => {
    if (y > treeline - 230 && y < treeline + 90 && rand() < 0.55 * (1 - alt * 0.6)) {
      ghosts.push({ x, y, z, s: 0.8 + rand() * 0.7 });
      return;
    }
    // Shorter, stockier trees higher up.
    const s = (1.25 + rand() * 0.9) * (0.65 + 0.35 * alt);
    (inside ? firs : outer).push({ x, y, z, s });
  };

  // 1) Over the ski area, the real tree cover from aerial imagery: every
  // stand, glade and run edge where it actually is.
  const { minX, minZ, size } = GEO.trees;
  const fine = 12;
  const nf = Math.floor(size / fine);
  for (let j = 0; j < nf; j++) {
    for (let i = 0; i < nf; i++) {
      const x = minX + (i + rand()) * fine;
      const z = minZ + (j + rand()) * fine;
      const c = canopyAt(x, z);
      if (!c || rand() > c.w) continue; // fades into pass 2 at the edge
      const forest = 1 - openAt(x, z);
      if (forest < 0.2 || rand() > forest * 1.05) continue;
      if (world.lakeAt(x, z) < 1.18) continue;
      const y = hf.heightAt(x, z);
      plant(x, z, y, 1 - smoothstep(treeline - 260, treeline + 40, y), true);
    }
  }

  // 2) Everywhere else, a procedural forest around the cleared runs.
  const spacing = 15;
  const margin = 2600; // keep planting past the heightfield edge
  const x0 = hf.minX - margin;
  const z0 = hf.minZ - margin;
  const span = hf.size + margin * 2;
  const cells = Math.floor(span / spacing);

  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const x = x0 + (i + rand()) * spacing;
      const z = z0 + (j + rand()) * spacing;
      const inside = x > hf.minX && x < hf.maxX && z > hf.minZ && z < hf.maxZ;
      if (!inside && rand() < 0.8) continue; // sparser beyond the edge
      const c = inside && canopyAt(x, z);
      if (c && rand() < c.w) continue; // pass 1 has it
      const y = inside ? hf.heightAt(x, z) : world.groundAt ? world.groundAt(x, z) : EDGE_HEIGHT;
      if (inside && clear.at(x, z) > 0.35) continue;
      if (world.lakeAt(x, z) < 1.18) continue;

      // Clumpy forest with natural meadows.
      const dens = 0.62 + 0.55 * fbm(x / 420, z / 420, 3) + 0.25 * noise2(x / 90, z / 90);
      // Thin out toward and above treeline (ragged edge).
      const tl = treeline + 70 * fbm(x / 300, z / 300, 2);
      const alt = 1 - smoothstep(tl - 260, tl, y);
      if (rand() > dens * (0.25 + 0.75 * alt)) continue;
      if (alt < 0.05) {
        if (y < tl + 90 && rand() < 0.55) ghosts.push({ x, y, z, s: 0.8 + rand() * 0.7 });
        continue;
      }
      plant(x, z, y, alt, inside);
    }
  }

  const shuffleCap = (arr, cap) => {
    if (arr.length <= cap) return arr;
    for (let i = arr.length - 1; i > 0; i--) {
      const k = Math.floor(rand() * (i + 1));
      [arr[i], arr[k]] = [arr[k], arr[i]];
    }
    return arr.slice(0, cap);
  };

  const group = new THREE.Group();
  const make = (geo, list, cap, tint) => {
    list = shuffleCap(list, cap);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const c = new THREE.Color();
    list.forEach((t, k) => {
      e.set((rand() - 0.5) * 0.06, rand() * Math.PI * 2, (rand() - 0.5) * 0.06);
      q.setFromEuler(e);
      const sy = t.s * (0.9 + rand() * 0.25);
      m.compose(new THREE.Vector3(t.x, t.y - 0.4, t.z), q, new THREE.Vector3(t.s, sy, t.s));
      mesh.setMatrixAt(k, m);
      tint(c, t);
      mesh.setColorAt(k, c);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  };

  const allFirs = shuffleCap(firs, MAX_TREES).concat(shuffleCap(outer, 16000));
  make(firGeometry(), allFirs, Infinity, (c) => {
    const v = 0.82 + rand() * 0.3;
    c.setRGB(v, v * (0.97 + rand() * 0.06), v);
  });
  make(ghostGeometry(), ghosts, MAX_GHOSTS, (c) => {
    const v = 0.93 + rand() * 0.07;
    c.setRGB(v, v, v);
  });
  // Trunks by 10 m cell, for skiers to hit.
  const trunks = new Map();
  const cellKey = (x, z) => Math.floor(x / 10) * 100003 + Math.floor(z / 10);
  for (const t of allFirs) {
    const k = cellKey(t.x, t.z);
    if (!trunks.has(k)) trunks.set(k, []);
    trunks.get(k).push(t);
  }
  // The nearest trunk within r meters of (x, z), or null.
  const treeNear = (x, z, r) => {
    let best = null;
    let bd = r;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = trunks.get(cellKey(x + dx * 10, z + dz * 10));
        if (!list) continue;
        for (const t of list) {
          const d = Math.hypot(t.x - x, t.z - z);
          if (d < bd) {
            bd = d;
            best = t;
          }
        }
      }
    }
    return best;
  };
  return { group, treeNear, count: allFirs.length + Math.min(ghosts.length, MAX_GHOSTS) };
}
