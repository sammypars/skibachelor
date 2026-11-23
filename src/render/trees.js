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

// Close-up fir: a dozen drooping branch whorls with ragged, star-shaped
// skirts, snow lying on the upper side of each whorl, and a bare trunk at
// the base. Same height and footprint as the low-poly fir it stands in for.
function firDetailGeometry() {
  const parts = [];
  const dark = new THREE.Color('#1b3526');
  const mid = new THREE.Color('#2c5039');
  const tipC = new THREE.Color('#3f6b48');
  const snow = new THREE.Color('#eef4f8');
  const TIERS = 11;
  const H = 12.4;
  for (let i = 0; i < TIERS; i++) {
    const t = i / (TIERS - 1); // 0 bottom whorl, 1 top
    const y0 = 0.9 + t * (H - 2.6);
    const r = 3.25 * (1 - t) ** 0.95 + 0.35;
    const h = 1.9 + 0.6 * (1 - t);
    const seg = 14;
    const g = new THREE.ConeGeometry(r, h, seg, 3, true).toNonIndexed();
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k);
      const y = p.getY(k);
      const z = p.getZ(k);
      const rim = (h / 2 - y) / h; // 0 at the tip, 1 at the skirt
      const a = Math.atan2(z, x);
      // Branch tips poke out between notches and sag under their weight.
      const star = 1 + 0.22 * rim * Math.cos(a * 7 + i * 1.3) + 0.08 * rim * Math.sin(a * 13 + i);
      const sag = rim ** 2 * (0.35 + 0.25 * Math.cos(a * 7 + i * 1.3));
      p.setXYZ(k, x * star, y - sag, z * star);
    }
    g.translate(0, y0 + h / 2, 0);
    g.computeVertexNormals();
    parts.push(
      colorize(g, (c, x, y, z) => {
        const rim = THREE.MathUtils.clamp((y0 + h - y) / h, 0, 1);
        const a = Math.atan2(z, x);
        c.copy(dark).lerp(mid, 0.3 + 0.4 * rim).lerp(tipC, Math.max(0, Math.cos(a * 7 + i * 1.3)) * rim * 0.4);
        // Snow load on the upper half of each whorl, heavier up top and on
        // the branch tips.
        const load = (1 - rim) * 0.75 + 0.35 * Math.max(0, Math.cos(a * 7 + i * 1.3)) * rim;
        c.lerp(snow, THREE.MathUtils.clamp(load * (0.55 + 0.35 * t), 0, 0.82));
      }),
    );
  }
  // Snow-capped leader.
  parts.push(colorize(new THREE.ConeGeometry(0.28, 1.4, 8, 1, true).translate(0, H - 0.4, 0).toNonIndexed(), (c) => c.copy(snow).lerp(mid, 0.3)));
  // Trunk, visible under the lowest whorl.
  parts.push(colorize(new THREE.CylinderGeometry(0.16, 0.26, 2.2, 8, 1, true).translate(0, 0.9, 0).toNonIndexed(), (c) => c.set('#4a3426')));
  for (const g of parts) {
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
  }
  return mergeGeometries(parts);
}

// Rime-crusted "snow ghost" near treeline: a fir buried in wind-packed
// rime, all lumpy pillows of snow with a few dark needles showing through
// on the lee side.
function ghostGeometry() {
  const parts = [];
  const blobs = [
    { r: 2.3, y: 2.0, s: [1.05, 1.0, 1] },
    { r: 1.9, y: 4.6, s: [1, 1.15, 1] },
    { r: 1.4, y: 6.9, s: [1, 1.3, 1] },
    { r: 0.8, y: 8.7, s: [1, 1.5, 1] },
  ];
  const rime = new THREE.Color('#f5f8fb');
  const shade = new THREE.Color('#c4d2df');
  const needle = new THREE.Color('#3a5446');
  blobs.forEach((b, i) => {
    const g = new THREE.IcosahedronGeometry(b.r, 1);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k);
      const y = p.getY(k);
      const z = p.getZ(k);
      // Lumpy pillows, and a crust built out on the windward (+x) side.
      const n = 1 + 0.16 * Math.sin(x * 2.3 + i) * Math.sin(y * 2.9) * Math.sin(z * 2.1 + i * 2) + 0.08 * Math.sin(x * 5 + z * 4);
      const wind = 1 + 0.12 * Math.max(0, x / b.r);
      p.setXYZ(k, x * n * wind * b.s[0], y * n * b.s[1], z * n * b.s[2]);
    }
    g.translate(0, b.y, 0);
    g.computeVertexNormals();
    parts.push(
      colorize(g.toNonIndexed(), (c, x, y, z) => {
        c.copy(rime).lerp(shade, Math.max(0, (b.y - y) / (b.r * 2.2)));
        // Needles peek out of the crust on the sheltered side.
        if (x < -b.r * 0.55 && Math.sin(y * 7 + z * 5) > 0.55) c.lerp(needle, 0.55);
      }),
    );
  });
  for (const g of parts) for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  return mergeGeometries(parts);
}

// Trees dissolve (a screen-door dither) when the camera comes within a few
// metres of them, so a chase camera skimming the tree line never ends up
// staring at the inside of a fir.
function fadeNearCamera(mat, near = 3.5, far = 9) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFadeW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvFadeW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFadeW;')
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        {
          float fd = distance(vFadeW, cameraPosition);
          float keep = smoothstep(${near.toFixed(1)}, ${far.toFixed(1)}, fd);
          float dither = fract(dot(floor(gl_FragCoord.xy), vec2(0.5, 0.25)) + fract(gl_FragCoord.y * 0.125) * 0.5);
          if (keep < 0.999 && dither > keep) discard;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'tree-fade';
  return mat;
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
  const make = (geo, list, cap, tint, flat = true) => {
    list = shuffleCap(list, cap);
    const mat = fadeNearCamera(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: flat }));
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
  const firMesh = make(firGeometry(), allFirs, Infinity, (c) => {
    const v = 0.82 + rand() * 0.3;
    c.setRGB(v, v * (0.97 + rand() * 0.06), v);
  });
  make(ghostGeometry(), ghosts, MAX_GHOSTS, (c) => {
    const v = 0.93 + rand() * 0.07;
    c.setRGB(v, v, v);
  }, false);
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

  // --- Close-up swap: the trees nearest the camera are drawn with the
  // detailed fir instead (each one hidden from the low-poly mesh while it
  // is). Re-picked whenever the camera has moved a few tens of metres.
  const NEAR_MAX = 4500;
  const NEAR_R = 230;
  const detail = new THREE.InstancedMesh(firDetailGeometry(), fadeNearCamera(new THREE.MeshLambertMaterial({ vertexColors: true })), NEAR_MAX);
  detail.castShadow = true;
  detail.receiveShadow = true;
  detail.frustumCulled = false;
  detail.count = 0;
  group.add(detail);
  const src = firMesh.instanceMatrix.array;
  const orig = src.slice(); // every fir's own matrix
  const cols = firMesh.instanceColor.array;
  const nearIdx = new Int32Array(NEAR_MAX);
  let nearCount = 0;
  const lastCam = new THREE.Vector3(Infinity, 0, 0);
  const pick = [];
  function updateDetail(cam) {
    if (cam.distanceToSquared(lastCam) < 20 * 20) return;
    lastCam.copy(cam);
    // Put back the trees that were swapped out.
    for (let k = 0; k < nearCount; k++) {
      const o = nearIdx[k] * 16;
      for (let q = 0; q < 16; q++) src[o + q] = orig[o + q];
    }
    nearCount = 0;
    // High above the forest the detail can't be seen.
    const ground = hf.heightAt(cam.x, cam.z);
    if (cam.y - ground < 450) {
      pick.length = 0;
      const r2 = NEAR_R * NEAR_R;
      for (let i = 0; i < allFirs.length; i++) {
        const o = i * 16;
        const dx = orig[o + 12] - cam.x;
        const dz = orig[o + 14] - cam.z;
        const d = dx * dx + dz * dz;
        if (d < r2) pick.push(d, i);
      }
      let order = [];
      for (let k = 0; k < pick.length; k += 2) order.push(k);
      if (order.length > NEAR_MAX) order = order.sort((a, b) => pick[a] - pick[b]).slice(0, NEAR_MAX);
      const dm = detail.instanceMatrix.array;
      const dc = detail.instanceColor ? detail.instanceColor.array : null;
      for (const k of order) {
        const i = pick[k + 1];
        const o = i * 16;
        dm.set(orig.subarray(o, o + 16), nearCount * 16);
        if (dc) dc.set(cols.subarray(i * 3, i * 3 + 3), nearCount * 3);
        else detail.setColorAt(nearCount, new THREE.Color(cols[i * 3], cols[i * 3 + 1], cols[i * 3 + 2]));
        for (let q = 0; q < 16; q++) src[o + q] = 0; // hide the low-poly one
        nearIdx[nearCount++] = i;
      }
    }
    detail.count = nearCount;
    detail.instanceMatrix.needsUpdate = true;
    if (detail.instanceColor) detail.instanceColor.needsUpdate = true;
    firMesh.instanceMatrix.needsUpdate = true;
  }

  return { group, treeNear, updateDetail, count: allFirs.length + Math.min(ghosts.length, MAX_GHOSTS) };
}
