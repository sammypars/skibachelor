// A GS race course: alternating red and blue gates down part of a run, a
// start house, B-net safety fencing both sides, and a finish arch with a
// timing hut. Returns the gate line so a racer can run it.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RACE } from '../data/mountain.js';
import { along, beside } from '../world/path.js';
import { bannerMaterial } from './parks.js';

const POLE_H = 1.9;
const PANEL_W = 0.75;
const FENCE = RACE.fence; // meters either side of the centerline

function pole(x, y, z, h = POLE_H, r = 0.025) {
  return new THREE.CylinderGeometry(r, r, h, 6).translate(x, y + h / 2, z);
}

// A vertical ribbon of net hung along a polyline of ground points.
function netRibbon(points, bottom, top) {
  const pos = [];
  const idx = [];
  points.forEach((p, i) => {
    pos.push(p.x, p.y + bottom, p.z, p.x, p.y + top, p.z);
    if (i) {
      const a = (i - 1) * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function netTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.strokeStyle = '#ff5a1f';
  ctx.lineWidth = 5;
  ctx.beginPath();
  for (let i = -64; i < 128; i += 16) {
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 64, 64);
    ctx.moveTo(i + 64, 0);
    ctx.lineTo(i, 64);
  }
  ctx.stroke();
  ctx.fillStyle = '#ff5a1f';
  ctx.fillRect(0, 0, 64, 6); // top rope band
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function buildRaceCourse(world) {
  const run = world.runs.find((r) => r.name === RACE.run && r.length > 300) ||
    world.runs.filter((r) => r.name === RACE.run).sort((a, b) => b.length - a.length)[0];
  if (!run) return null;
  const { hf } = world;
  const H = (p) => hf.heightAt(p.x, p.z);
  const group = new THREE.Group();
  group.name = 'race-course';
  const s0 = run.length * RACE.from;
  const s1 = run.length * RACE.to;
  const pt = {};

  const red = [];
  const blue = [];
  const panelsRed = [];
  const panelsBlue = [];

  // --- GS: two poles and a panel per gate, alternating red and blue.
  const gs = [];
  {
    const { lane, gateSpacing, offset } = RACE.gs;
    let k = 0;
    for (let s = s0 + 22; s < s1 - 15; s += gateSpacing * (0.9 + 0.2 * ((k * 0.618) % 1)), k++) {
      const side = k % 2 ? 1 : -1;
      const o = lane + side * offset;
      gs.push({ s, offset: o, lane });
      beside(run, s, o, pt);
      const y = H(pt);
      // Turning pole on the inside, outside pole 0.75 m further out, panel
      // between them.
      const ox = -pt.dz * side * PANEL_W;
      const oz = pt.dx * side * PANEL_W;
      const poles = k % 2 ? blue : red;
      poles.push(pole(pt.x, y, pt.z), pole(pt.x + ox, y, pt.z + oz));
      const panel = new THREE.PlaneGeometry(PANEL_W, 0.55)
        .rotateY(Math.atan2(pt.dx, pt.dz))
        .translate(pt.x + ox / 2, y + POLE_H - 0.45, pt.z + oz / 2);
      (k % 2 ? panelsBlue : panelsRed).push(panel);
    }
  }

  // --- Slalom: single hinged poles, alternating colours, in a tight
  // rhythm. Every so often a hairpin (two gates straight down the fall
  // line) or a flush (three).
  const sl = [];
  {
    const { lane, gateSpacing, offset, combos } = RACE.slalom;
    let k = 0;
    let side = -1;
    let s = s0 + 18;
    while (s < s1 - 12) {
      const combo = k > 3 && k % combos === 0 ? (k % (combos * 2) === 0 ? 3 : 2) : 1;
      for (let c = 0; c < combo && s < s1 - 12; c++) {
        // In a combo the gates line up vertically, close together.
        const o = lane + (combo > 1 ? side * 0.4 : side * offset);
        sl.push({ s, offset: o, lane });
        beside(run, s, o, pt);
        (sl.length % 2 ? red : blue).push(pole(pt.x, H(pt), pt.z, 1.8, 0.02));
        s += combo > 1 ? 6.5 : gateSpacing * (0.9 + 0.2 * ((k * 0.618) % 1));
      }
      side = -side;
      k++;
    }
  }

  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });
  const add = (list, m) => {
    if (!list.length) return;
    const mesh = new THREE.Mesh(mergeGeometries(list), m);
    mesh.castShadow = true;
    group.add(mesh);
  };
  add(red, mat(0xd7262e));
  add(blue, mat(0x1f4fbf));
  add(panelsRed, mat(0xd7262e, { side: THREE.DoubleSide }));
  add(panelsBlue, mat(0x1f4fbf, { side: THREE.DoubleSide }));

  // --- B-net fences down both sides.
  const netMat = new THREE.MeshStandardMaterial({
    map: netTexture(),
    transparent: true,
    alphaTest: 0.3,
    side: THREE.DoubleSide,
    roughness: 0.8,
  });
  const fencePosts = [];
  for (const side of [-1, 1]) {
    const line = [];
    for (let s = s0 - 6; s <= s1 + 22; s += 4) {
      beside(run, s, side * FENCE, pt);
      const p = { x: pt.x, z: pt.z, y: H(pt) };
      line.push(p);
      if (Math.round(s) % 8 < 4) fencePosts.push(pole(p.x, p.y, p.z, 2.6, 0.05));
    }
    const g = netRibbon(line, 0.25, 2.4);
    // UVs: repeat the mesh pattern every 1.2 m.
    const uv = [];
    let d = 0;
    line.forEach((p, i) => {
      if (i) d += Math.hypot(p.x - line[i - 1].x, p.z - line[i - 1].z);
      uv.push(d / 1.2, 0, d / 1.2, 1.8);
    });
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    group.add(new THREE.Mesh(g, netMat));
  }
  add(fencePosts, mat(0x2a2f35));

  // --- Start house: a small timber hut straddling the course, start wand
  // and a banner overhead.
  along(run, s0, pt);
  const yaw = Math.atan2(pt.dx, pt.dz);
  const start = new THREE.Group();
  const wood = mat(0x7a4f31);
  // Start hut between the two lanes.
  const hut = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.8, 2.6), wood);
  hut.position.set(0, 1.4, -2.5);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.3, 3.2), mat(0xf4f8fc));
  roof.position.set(0, 2.95, -2.5);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(5, 0.5, 4), mat(0x5a3b25));
  deck.position.set(0, 0.25, -2.5);
  start.add(hut, roof, deck);
  start.position.set(pt.x, H(pt), pt.z);
  start.rotation.y = yaw;
  group.add(start);
  // A start ramp, wand and banner at the top of each lane.
  for (const [lane, label] of [[RACE.gs.lane, 'GS Start'], [RACE.slalom.lane, 'Slalom Start']]) {
    beside(run, s0, lane, pt);
    const g = new THREE.Group();
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(4, 0.5, 4), wood);
    ramp.position.set(0, 0.25, -1.5);
    const wand = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.06), mat(0xffd400));
    wand.position.set(0, 0.6, 0.6);
    g.add(ramp, wand);
    g.position.set(pt.x, H(pt), pt.z);
    g.rotation.y = yaw;
    group.add(g);
    group.add(arch(world, run, s0 + 2, 8, label, '#d7262e', lane));
  }

  // --- Finish: arch over the line and the timing hut beside it.
  group.add(arch(world, run, s1 + 8, FENCE * 2, 'Finish · Mt. Bachelor', '#10202f'));
  beside(run, s1 + 14, FENCE + 6, pt);
  const timing = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 3), mat(0xe8e8e8));
  box.position.y = 1.5;
  const glass = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.1, 0.1), mat(0x1d3347, { roughness: 0.1, metalness: 0.6 }));
  glass.position.set(0, 2, 1.52);
  timing.add(box, glass);
  timing.position.set(pt.x, H(pt), pt.z);
  // Local +z (the windows) points back left, toward the course: (dz, -dx).
  timing.rotation.y = Math.atan2(pt.dz, -pt.dx);
  group.add(timing);

  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return {
    group,
    course: {
      run, s0, s1, gates: gs,
      lines: [
        { name: 'gs', gates: gs, lane: RACE.gs.lane, speed: 17, suit: 0xd7262e },
        { name: 'slalom', gates: sl, lane: RACE.slalom.lane, speed: 11.5, suit: 0x1f4fbf },
      ],
    },
  };
}

// Two poles and a banner across the course.
function arch(world, run, s, span, text, bg, center = 0) {
  const { hf } = world;
  const pt = beside(run, s, center, {});
  const L = { x: pt.x + (pt.dz * span) / 2, z: pt.z - (pt.dx * span) / 2 };
  const R = { x: pt.x - (pt.dz * span) / 2, z: pt.z + (pt.dx * span) / 2 };
  const yl = hf.heightAt(L.x, L.z);
  const yr = hf.heightAt(R.x, R.z);
  const top = Math.max(yl, yr) + 4.2;
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x2a2f35, roughness: 0.5 });
  for (const [p, y] of [[L, yl], [R, yr]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, top - y + 0.5, 8), m);
    post.position.set(p.x, (top + y + 0.5) / 2, p.z);
    g.add(post);
  }
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(span - 0.4, 1.5),
    bannerMaterial(text, bg, '#ffffff'),
  );
  banner.position.set((L.x + R.x) / 2, top - 0.5, (L.z + R.z) / 2);
  banner.rotation.y = Math.atan2(-pt.dx, -pt.dz);
  g.add(banner);
  return g;
}
