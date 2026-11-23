// NPC skiers and snowboarders.
//
// - Skiers carve S-turns down the real runs, leaning into each turn, at a
//   speed that suits the run and the slope. At the bottom of a run they carry
//   on down a connecting run, or catch the nearest lift and reappear at its
//   top to pick a new run.
// - The chairs going up carry riders.
// - Racers run the GS and slalom courses gate to gate.
//
// Everyone is drawn with a few instanced meshes (jacket, gear, skin) that
// share the same per-person transform.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { along, beside } from '../world/path.js';
import { seededRandom } from '../world/noise.js';
import { HANGER } from './lifts.js';
import { bakeSkier } from '../skier-model.js';

const SKIERS = 340;
const PARK_RIDERS_MAX = 40;
const G = 9.81;
const smooth01 = (t) => t * t * (3 - 2 * t);
const BOARDER_SHARE = 0.25;
const RIDER_RANGE = 1400; // m from the camera that chair riders are drawn

// ------------------------------------------------------------------ figures
// Everyone is the player's own character (src/skier-model.js), posed and
// baked into plain geometry at a lower detail. Each part carries a vertex
// colour; parts are merged into four instanced meshes (jacket, pants,
// gear and goggles, helmet) that share one transform per person. Figures
// face +z with the feet at y = 0.
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const DARK = 0x1a1d21;
function colored(g, color) {
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function block(w, h, d, c, color, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d).rotateX(rx).rotateZ(rz).rotateY(ry).translate(c.x, c.y, c.z);
  return colored(g, color);
}

// Snowboarder: the same character with its skis and poles off, feet set
// wide on a board, knees bent, arms out along the board for balance. Built
// facing +z with the feet along x, then turned side-on to the travel.
export function boarderParts() {
  const out = bakeSkier({ crouch: 0.5, wide: 0.16, airArms: 0.75, look: 0.25 }, { skis: false, poles: false, detail: 0.32 });
  delete out.hips;
  // Board with kicked-up nose and tail, under the boots.
  out.skin.push(indexed(block(1.3, 0.025, 0.28, V(0, 0.02, 0), DARK)));
  for (const s of [-1, 1]) out.skin.push(indexed(block(0.22, 0.022, 0.27, V(s * 0.74, 0.05, 0), DARK, 0, 0, s * 0.32)));
  const turn = Math.PI / 2 - 0.26;
  for (const k of ['jacket', 'gear', 'skin', 'helmet']) for (const g of out[k]) g.rotateY(turn);
  return out;
}
// The baked figures are indexed with position / normal / color only; match
// that so they merge.
function indexed(g) {
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
  return g;
}

const JACKETS = [0xd7262e, 0x1f5fbf, 0xf26b21, 0x16a34a, 0xfacc15, 0x7c3aed, 0x0ea5e9, 0xec4899, 0x111827, 0xf8fafc, 0x14b8a6, 0x9a3412];
const PANTS = [0x1f2937, 0x111827, 0x374151, 0x1e3a8a, 0x3f3f46, 0xe5e7eb, 0x7c2d12];
const JACKET_C = JACKETS.map((c) => new THREE.Color(c));
const HELMETS_C = [0xf4f6f8, 0x15171a, 0xf4f6f8, 0x2b2f36, 0xd7262e, 0x1f5fbf, 0xffc20e, 0x8a9199].map((c) => new THREE.Color(c));
const PANTS_C = PANTS.map((c) => new THREE.Color(c));

// A person drawn as three instanced meshes sharing transforms.
export class Crowd {
  constructor(parts, capacity) {
    // Double-sided: the baked garments are open at the hems and cuffs.
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, side: THREE.DoubleSide });
    this.meshes = ['jacket', 'gear', 'skin', 'helmet'].filter((k) => parts[k]?.length).map((k) => {
      const m = new THREE.InstancedMesh(mergeGeometries(parts[k]), mat, capacity);
      m.castShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      return m;
    });
    this.white = new THREE.Color(1, 1, 1);
  }
  set(i, matrix, jacket, pants) {
    const [j, g, s, h] = this.meshes;
    j.setMatrixAt(i, matrix);
    g.setMatrixAt(i, matrix);
    s.setMatrixAt(i, matrix);
    h?.setMatrixAt(i, matrix);
    if (jacket) {
      j.setColorAt(i, jacket);
      g.setColorAt(i, pants);
      s.setColorAt(i, this.white);
      if (h) h.setColorAt(i, HELMETS_C[Math.floor((jacket.r * 7 + pants.g * 13 + i * 0.37) * 10) % HELMETS_C.length]);
    }
  }
  finish(count) {
    for (const m of this.meshes) {
      m.count = count;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}

export function buildPeople(world, lifts, race, parks) {
  const { hf } = world;
  const rand = seededRandom(31415);
  const group = new THREE.Group();
  group.name = 'people';
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const color = (list) => new THREE.Color(pick(list));

  // Runs people ski: not parks (they'd ski through the jumps) and not tiny
  // fragments.
  const runs = world.runs.filter((r) => r.kind !== 'park' && r.length > 60);
  const weightTotal = runs.reduce((s, r) => s + r.length, 0);
  const randomRun = () => {
    let t = rand() * weightTotal;
    for (const r of runs) if ((t -= r.length) <= 0) return r;
    return runs[0];
  };
  const startsNear = (x, z, radius, not) =>
    runs.filter((r) => r !== not && Math.hypot(r.pts[0].x - x, r.pts[0].z - z) < radius);

  // Skiers and chair riders are the player's own character, posed and
  // baked at a lower detail; boarders keep their simpler figure.
  // Chair riders are many and mostly far off: lighter still, poles stowed.
  const skierFig = bakeSkier({ crouch: 0.35 }, { detail: 0.32 });
  const seated = bakeSkier({ seated: 1 }, { detail: 0.22, poles: false, minPart: 0.05 });
  const h = seated.hips;
  for (const k of ['jacket', 'gear', 'skin', 'helmet']) for (const g of seated[k]) g.translate(-h.x, -h.y + 0.1, -h.z - 0.02);
  const skiers = new Crowd(skierFig, SKIERS + 4 + PARK_RIDERS_MAX);
  const boarders = new Crowd(boarderParts(), SKIERS + PARK_RIDERS_MAX);
  const riders = new Crowd(seated, lifts.lifts.reduce((s, l) => s + l.count * l.seats, 0));
  for (const c of [skiers, boarders, riders]) for (const m of c.meshes) group.add(m);

  // --- Skiers.
  const SPEED = { green: [5, 8], blue: [8, 12], black: [10, 15], double: [11, 16] };
  function startOn(p, run, s = 0) {
    p.run = run;
    p.s = s;
    const half = Math.max(2, run.width / 2 - 4);
    const narrow = run.kind === 'catwalk';
    p.lane = (rand() - 0.5) * half * (narrow ? 0.6 : 0.9);
    p.amp = narrow ? 0.5 + rand() : Math.min(half - Math.abs(p.lane), 3 + rand() * (p.board ? 9 : 7));
    p.turnLen = narrow ? 30 : 9 + rand() * 14;
    const [lo, hi] = SPEED[run.difficulty] || SPEED.blue;
    p.base = (lo + rand() * (hi - lo)) * p.skill;
  }
  function nextRun(p) {
    const end = p.run.pts.at(-1);
    const more = startsNear(end.x, end.z, 70, p.run);
    if (more.length && rand() < 0.85) return startOn(p, pick(more));
    // Catch the nearest lift and pop out at its top.
    let best = null;
    let bestD = 450;
    for (const l of lifts.lifts) {
      const d = Math.hypot(l.data.bottom.x - end.x, l.data.bottom.z - end.z);
      if (d < bestD) {
        bestD = d;
        best = l;
      }
    }
    const top = best ? best.data.top : pick(lifts.lifts).data.top;
    const options = startsNear(top.x, top.z, 260);
    startOn(p, options.length ? pick(options) : randomRun());
  }

  const people = [];
  for (let i = 0; i < SKIERS; i++) {
    const p = {
      board: rand() < BOARDER_SHARE,
      skill: 0.75 + rand() * 0.45,
      size: 0.9 + rand() * 0.17, // people come in all heights
      phase: rand() * Math.PI * 2,
      jacket: color(JACKETS),
      pants: color(PANTS),
    };
    const run = randomRun();
    startOn(p, run, rand() * run.length);
    people.push(p);
  }

  // --- Racers: one per course (GS and slalom), each running its gates and
  // then heading back up for another run, starts staggered.
  const course = race?.course;
  const racers = (course?.lines || []).map((line, i) => ({
    line,
    s: course.s0 - i * 140,
    wait: i * 6,
    jacket: new THREE.Color(line.suit),
    pants: new THREE.Color(0xf8fafc),
  }));
  // The racer's line: tight on the inside of each gate, carving across the
  // fall line between them; starts and finishes in the middle of its lane.
  const raceOffset = (line, s) => {
    const g = line.gates;
    const inside = (gate) => gate.offset - Math.sign(gate.offset - gate.lane) * 0.7;
    if (s <= g[0].s) return line.lane + (inside(g[0]) - line.lane) * Math.max(0, (s - course.s0) / (g[0].s - course.s0));
    for (let i = 0; i < g.length - 1; i++) {
      if (s < g[i + 1].s) {
        const t = (s - g[i].s) / (g[i + 1].s - g[i].s);
        const a = inside(g[i]);
        const b = inside(g[i + 1]);
        return a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * t));
      }
    }
    return line.lane + (inside(g.at(-1)) - line.lane) * Math.max(0, 1 - (s - g.at(-1).s) / 30);
  };

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const pt = {};
  let first = true;

  // Pose a person at a point on a run with a sideways slope of the path
  // (k = d offset / d s) and a lean.
  const sc = new THREE.Vector3();
  function pose(run, s, offset, k, lean, size = 1) {
    beside(run, s, offset, pt);
    pos.set(pt.x, hf.heightAt(pt.x, pt.z), pt.z);
    const vx = pt.dx - pt.dz * k;
    const vz = pt.dz + pt.dx * k;
    // Pitch the body to the slope ahead.
    const ahead = hf.heightAt(pt.x + vx * 2, pt.z + vz * 2);
    const pitch = Math.atan2(pos.y - ahead, 2 * Math.hypot(vx, vz)) * 0.8;
    e.set(pitch, Math.atan2(vx, vz), lean);
    q.setFromEuler(e);
    m.compose(pos, q, sc.setScalar(size));
    return m;
  }

  // --- Park riders: lap the jump lines, hitting each tabletop at the speed
  // it was built for, flying a real ballistic arc off the lip (with a spin)
  // and landing on the landing.
  const parkLines = new Map();
  for (const j of parks?.jumps || []) {
    if (!parkLines.has(j.run)) parkLines.set(j.run, []);
    parkLines.get(j.run).push(j);
  }
  const parkRiders = [];
  for (const [run, js] of parkLines) {
    js.sort((a, b) => a.s - b.s);
    for (let i = 0; i < 3 && parkRiders.length < PARK_RIDERS_MAX; i++) {
      const board = i === 1;
      // Each rider sticks to one side of the park's jump line.
      const side = i === 0 ? -1 : i === 1 ? 1 : 0;
      const line = js.filter((j) => side === 0 || Math.sign(j.off) === side || j.off === 0);
      parkRiders.push({
        run,
        jumps: line.length ? line : js,
        board,
        s: 6 - i * 45,
        off: 0,
        v: 8,
        air: null,
        wait: i * 3,
        skill: 1.0 + rand() * 0.025,
        jacket: color(JACKETS),
        pants: color(PANTS),
      });
    }
  }
  // Snow surface height above the natural ground on a park run.
  const parkSurface = (r, s, off) => {
    let h = 0;
    for (const j of r.jumps) {
      const a = s - j.s;
      if (a < 0 || a > j.prof.length) continue;
      const half = JUMP_HALF_WIDTH(j);
      if (Math.abs(off - j.off) < half) h = Math.max(h, j.prof.h(a));
    }
    return h;
  };
  const JUMP_HALF_WIDTH = (j) => (j.size === 'xl' ? 5 : j.size === 'l' ? 4 : j.size === 'm' ? 3 : 2.2);
  const groundAt = (run, s, off, out) => {
    beside(run, s, off, out);
    return hf.heightAt(out.x, out.z);
  };
  const rp = {};
  const rq = {};
  function updateParkRider(r, dt) {
    if (r.wait > 0) {
      r.wait -= dt;
      if (r.wait <= 0) {
        r.s = 4;
        r.off = 0;
        r.air = null;
      }
      return false;
    }
    if (r.s < 0) {
      r.s += 8 * dt;
      return false;
    }
    if (r.air) {
      // Ballistic flight from the lip.
      const A = r.air;
      A.t += dt;
      const d = A.v * Math.cos(A.th) * A.t;
      r.s = A.s0 + d;
      const y = A.y0 + Math.tan(A.th) * d - (G * d * d) / (2 * A.v * A.v * Math.cos(A.th) ** 2);
      const surface = groundAt(r.run, r.s, r.off, rp) + parkSurface(r, r.s, r.off);
      if (y <= surface && A.t > 0.15) {
        r.air = null; // stomped it
        r.v = A.v * 0.92;
      } else {
        A.y = y;
      }
    } else {
      const next = r.jumps.find((j) => j.s + j.prof.lip.x > r.s + 0.01);
      const target = next ? next.off : r.off * 0.98;
      r.off += Math.max(-2 * dt, Math.min(2 * dt, target - r.off));
      // Speed check before each jump; cruise between.
      const want = next && next.s + next.prof.lip.x - r.s < 45 ? next.prof.lip.v * r.skill : 9;
      r.v += Math.max(-3 * dt, Math.min(3 * dt, want - r.v));
      const s0 = r.s;
      r.s += r.v * dt;
      if (next) {
        const lipS = next.s + next.prof.lip.x;
        if (s0 < lipS && r.s >= lipS && Math.abs(r.off - next.off) < JUMP_HALF_WIDTH(next)) {
          const y0 = groundAt(r.run, lipS, r.off, rp) + next.prof.lip.h;
          // Pick a trick: spins in multiples of 180, bigger on bigger jumps.
          const big = next.size === 'l' || next.size === 'xl';
          const turns = big ? (rand() < 0.5 ? 2 : r.board ? 3 : 4) : rand() < 0.5 ? 1 : 2;
          r.air = { s0: lipS, y0, y: y0, v: r.v, th: next.prof.lip.angle, t: 0, spin: turns * Math.PI * (rand() < 0.5 ? -1 : 1), grab: rand() < 0.6 };
          r.s = lipS;
        }
      }
    }
    if (r.s > r.run.length - 8) r.wait = 4;
    return true;
  }
  function poseParkRider(r) {
    const y = r.air ? r.air.y : groundAt(r.run, r.s, r.off, rp) + parkSurface(r, r.s, r.off);
    beside(r.run, r.s, r.off, rp);
    pos.set(rp.x, y, rp.z);
    let pitch = 0;
    let spin = 0;
    let lean = 0;
    if (r.air) {
      const A = r.air;
      const d = A.v * Math.cos(A.th) * A.t;
      const slope = Math.tan(A.th) - (G * d) / (A.v * A.v * Math.cos(A.th) ** 2);
      pitch = -Math.atan(slope) * 0.6;
      // Spin through the air, finishing by the time they land.
      const flight = Math.max(0.4, (2 * A.v * Math.sin(A.th)) / G + 0.35);
      spin = A.spin * smooth01(Math.min(1, A.t / flight));
      lean = A.grab ? 0.35 * Math.sin(Math.PI * Math.min(1, A.t / flight)) : 0;
    } else {
      const ahead = groundAt(r.run, r.s + 1.5, r.off, rq) + parkSurface(r, r.s + 1.5, r.off);
      pitch = Math.atan2(y - ahead, 1.5) * 0.8;
    }
    e.set(pitch, Math.atan2(rp.dx, rp.dz) + spin + (r.board ? Math.PI / 2 : 0) * 0, lean);
    q.setFromEuler(e);
    m.compose(pos, q, one);
    return m;
  }

  function update(dt, cam = null) {
    dt = Math.min(dt, 0.1);
    let ns = 0;
    let nb = 0;
    for (const p of people) {
      along(p.run, p.s, pt);
      // Faster on steeper ground.
      const slope = hf.gradient(pt.x, pt.z, 10).slope;
      const v = p.base * (0.7 + Math.min(0.9, slope * 1.4));
      p.s += v * dt;
      p.phase += ((v * dt) / p.turnLen) * Math.PI;
      // Onto the next run without skipping a frame: every person keeps the
      // same instance slot (and so the same colours) every frame.
      if (p.s >= p.run.length - 1) nextRun(p);
      const w = Math.PI / p.turnLen;
      // Fade turns in and out at the ends of a run.
      const fade = Math.min(1, p.s / 25, (p.run.length - p.s) / 25);
      const amp = p.amp * fade;
      const off = p.lane * fade + amp * Math.sin(p.phase);
      const k = amp * w * Math.cos(p.phase);
      const lean = -Math.sin(p.phase) * Math.min(0.5, amp * w * w * 6) * (p.board ? 1.4 : 1);
      pose(p.run, p.s, off, k, lean, p.size);
      if (p.board) boarders.set(nb++, m, first && p.jacket, p.pants);
      else skiers.set(ns++, m, first && p.jacket, p.pants);
    }

    for (const r of racers) {
      const { run, s0, s1 } = course;
      if (r.wait > 0) {
        r.wait -= dt;
        if (r.wait <= 0) r.s = s0;
        if (r.s < s0) continue; // still on the way up
      } else {
        r.s += r.line.speed * dt;
        if (r.s > s1 + 30) r.wait = 10;
      }
      const s = Math.min(r.s, s1 + 30);
      const o = raceOffset(r.line, s);
      const k = (raceOffset(r.line, s + 0.5) - o) / 0.5;
      const curve = raceOffset(r.line, s + 1) - 2 * o + raceOffset(r.line, s - 1);
      const lean = -Math.max(-0.7, Math.min(0.7, curve * 2.2));
      pose(run, s, o, k, lean);
      skiers.set(ns++, m, r.jacket, r.pants);
    }
    for (const r of parkRiders) {
      if (!updateParkRider(r, dt)) continue;
      poseParkRider(r);
      if (r.board) boarders.set(nb++, m, r.jacket, r.pants);
      else skiers.set(ns++, m, r.jacket, r.pants);
    }
    skiers.finish(ns);
    boarders.finish(nb);

    // --- Riders on the chairs going up. Each chair's seats are filled the
    // same way every lap, so a chair keeps its riders.
    let nr = 0;
    const seat = new THREE.Vector3();
    for (const l of lifts.lifts) {
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, l.yaw);
      for (let i = 0; i < l.count; i++) {
        if (!lifts.chairAt(l, i, seat)) continue;
        // Riders on chairs far off are specks: don't draw them.
        if (cam && seat.distanceToSquared(cam) > RIDER_RANGE * RIDER_RANGE) continue;
        for (let k = 0; k < l.seats; k++) {
          const h = Math.sin((i + 1) * 12.9898 + (k + 1) * 78.233 + l.count) * 43758.5453;
          if (h - Math.floor(h) > 0.55) continue;
          pos.set((k - (l.seats - 1) / 2) * 0.62, -HANGER + 0.06, 0.12).applyQuaternion(q).add(seat);
          m.compose(pos, q, one);
          // Rider slots shift as chairs come and go, so colors are set every frame.
          const hc = Math.floor((h - Math.floor(h)) * 1000);
          riders.set(nr++, m, JACKET_C[hc % JACKET_C.length], PANTS_C[hc % PANTS_C.length]);
        }
      }
    }
    riders.finish(nr);
    first = false;
  }
  update(0);
  return { group, update, parkRiders, count: SKIERS + parkRiders.length };
}
