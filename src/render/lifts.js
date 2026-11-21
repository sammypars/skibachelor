import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const CABLE_OFFSET = 2.9; // half the gap between the up and down cables
export const HANGER = 3.3; // cable to seat
const TERM_H = 5.0; // cable height at the terminals
const SPEED = { express: 5.0, fixed: 2.3 }; // m/s, real-world line speeds
const SPACING = { express: 34, fixed: 18 }; // m between chairs
const SEAT_W = 0.62; // width per seat
const BACHELOR_BLUE = 0x3e6db5; // Mt. Bachelor's lift terminals are blue

// A polyline with arc-length lookup.
class Path {
  constructor(points) {
    this.points = points;
    this.cum = [0];
    for (let i = 1; i < points.length; i++) {
      this.cum.push(this.cum[i - 1] + points[i].distanceTo(points[i - 1]));
    }
    this.length = this.cum[this.cum.length - 1];
  }
  at(s, out = new THREE.Vector3()) {
    s = Math.max(0, Math.min(this.length, s));
    let lo = 0;
    let hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const seg = this.cum[hi] - this.cum[lo] || 1;
    return out.lerpVectors(this.points[lo], this.points[hi], (s - this.cum[lo]) / seg);
  }
  // Sagging cable: points between supports dip a little.
  sagged(perSpan = 10, sag = 0.012) {
    const out = [];
    for (let i = 0; i < this.points.length - 1; i++) {
      const a = this.points[i];
      const b = this.points[i + 1];
      const span = a.distanceTo(b);
      for (let k = 0; k < perSpan; k++) {
        const t = k / perSpan;
        const p = new THREE.Vector3().lerpVectors(a, b, t);
        p.y -= 4 * sag * span * t * (1 - t);
        out.push(p);
      }
    }
    out.push(this.points[this.points.length - 1].clone());
    return out;
  }
}

// ------------------------------------------------------------------ chairs
// Chair facing +z (riders look along +z), grip at the origin.
function chairGeometry(seats, express) {
  const w = seats * SEAT_W;
  const H = HANGER;
  const parts = [
    // Hanger: straight down from the grip, then a bend forward to the seat.
    new THREE.BoxGeometry(0.11, H - 0.55, 0.11).translate(0, -(H - 0.55) / 2, -0.32),
    new THREE.BoxGeometry(0.11, 0.11, 0.55).translate(0, -H + 0.55, -0.08),
    new THREE.BoxGeometry(w + 0.1, 0.08, 0.08).translate(0, -H + 0.5, -0.3), // backrest frame
    new THREE.BoxGeometry(w, 0.12, 0.6).translate(0, -H, 0.14), // seat
    new THREE.BoxGeometry(w, 0.62, 0.08).translate(0, -H + 0.36, -0.24), // back
    new THREE.BoxGeometry(0.06, 0.06, 0.95).translate(-w / 2, -H + 0.62, 0.22), // armrests
    new THREE.BoxGeometry(0.06, 0.06, 0.95).translate(w / 2, -H + 0.62, 0.22),
    new THREE.BoxGeometry(w * 0.92, 0.05, 0.05).translate(0, -H + 1.05, 0.62), // restraint bar
    new THREE.BoxGeometry(0.05, 0.6, 0.05).translate(0, -H + 0.75, 0.62),
    new THREE.BoxGeometry(w * 0.85, 0.05, 0.32).translate(0, -H - 0.62, 0.62), // footrest
    new THREE.BoxGeometry(0.4, 0.3, 0.3).translate(0, 0, -0.32), // grip
  ];
  if (express) parts.push(new THREE.BoxGeometry(w * 0.96, 0.1, 0.56).translate(0, -H + 0.11, 0.16)); // padded cushion
  return mergeGeometries(parts);
}

// ------------------------------------------------------------------ terminals
// Every terminal is built with the bullwheel at the origin, cable height
// TERM_H, and +z pointing out along the lift line.
const M = {};
function mats() {
  if (M.steel) return M;
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.2, ...o });
  Object.assign(M, {
    steel: std({ color: 0x6f7b88, metalness: 0.3, roughness: 0.45 }),
    dark: std({ color: 0x2a3038 }),
    glass: std({ color: 0x2a3d50, roughness: 0.1, metalness: 0.3 }),
    silver: std({ color: 0xd3d8de, metalness: 0.25, roughness: 0.35 }),
    white: std({ color: 0xe4e8ec }),
    snow: std({ color: 0xf6f9fc, roughness: 0.9, metalness: 0 }),
    deck: std({ color: 0x3e4650, roughness: 0.8 }),
    wood: std({ color: 0x5b3b25, roughness: 0.85, metalness: 0 }),
    mat: std({ color: 0x24282d, roughness: 0.95, metalness: 0 }),
  });
  return M;
}
const colorMat = new Map();
function paint(color) {
  if (!colorMat.has(color)) colorMat.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.25 }));
  return colorMat.get(color);
}
function part(g, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

// Rounded-rectangle cross-section (x by y) extruded along z, with rounded
// ends: the shape of Doppelmayr canopies.
function capsuleShell(w, h, len, r, endRound = 1.2) {
  const s = new THREE.Shape();
  const x0 = -w / 2 + r;
  const x1 = w / 2 - r;
  s.moveTo(x0, 0);
  s.lineTo(x1, 0);
  s.quadraticCurveTo(w / 2, 0, w / 2, r);
  s.lineTo(w / 2, h - r);
  s.quadraticCurveTo(w / 2, h, x1, h);
  s.lineTo(x0, h);
  s.quadraticCurveTo(-w / 2, h, -w / 2, h - r);
  s.lineTo(-w / 2, r);
  s.quadraticCurveTo(-w / 2, 0, x0, 0);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: len - endRound * 2,
    bevelEnabled: true,
    bevelThickness: endRound,
    bevelSize: Math.min(r * 0.8, 0.9),
    bevelSegments: 4,
    curveSegments: 6,
  });
  geo.translate(0, 0, endRound);
  return geo;
}

// The bullwheel and the horseshoe rail chairs follow round the terminal.
function wheelAndRail(g, railLen) {
  part(g, new THREE.TorusGeometry(CABLE_OFFSET, 0.2, 6, 28).rotateX(Math.PI / 2), M.dark, 0, TERM_H + 0.25, 0);
  if (railLen > 0) {
    const pts = [];
    for (let k = 0; k <= 12; k++) {
      const a = Math.PI / 2 + (k / 12) * Math.PI;
      // From (+C, 0) round behind the wheel (z < 0) to (-C, 0).
      pts.push(new THREE.Vector3(Math.sin(a) * CABLE_OFFSET, TERM_H + 0.7, Math.cos(a) * CABLE_OFFSET));
    }
    const path = new THREE.CurvePath();
    path.add(new THREE.LineCurve3(new THREE.Vector3(CABLE_OFFSET, TERM_H + 0.7, railLen), new THREE.Vector3(CABLE_OFFSET, TERM_H + 0.7, 0)));
    path.add(new THREE.CatmullRomCurve3(pts));
    path.add(new THREE.LineCurve3(new THREE.Vector3(-CABLE_OFFSET, TERM_H + 0.7, 0), new THREE.Vector3(-CABLE_OFFSET, TERM_H + 0.7, railLen)));
    part(g, new THREE.TubeGeometry(path, 60, 0.14, 5), M.steel);
  }
}

function operatorBooth(g, color, x, z, w = 2.8) {
  part(g, new THREE.BoxGeometry(w, 2.7, 2.6), color, x, 1.35, z);
  part(g, new THREE.BoxGeometry(w + 0.04, 0.9, 2.64), M.glass, x, 1.9, z);
  part(g, new THREE.BoxGeometry(w + 0.5, 0.25, 3.1), M.snow, x, 2.85, z);
}

function loadPlatform(g, isTop) {
  if (isTop) {
    // Steel unload deck with railings, sloping off to the snow.
    part(g, new THREE.BoxGeometry(10, 0.5, 9), M.deck, 0, 0.25, 9);
    for (const sx of [-1, 1]) {
      part(g, new THREE.BoxGeometry(0.08, 0.08, 9), paint(BACHELOR_BLUE), sx * 5, 1.2, 9);
      for (let k = 0; k < 4; k++) part(g, new THREE.BoxGeometry(0.08, 1, 0.08), paint(BACHELOR_BLUE), sx * 5, 0.7, 5 + k * 2.7);
    }
  } else {
    part(g, new THREE.BoxGeometry(8, 0.12, 4), M.mat, 0, 0.06, 9); // loading carpet
    for (const sx of [-1, 1]) part(g, new THREE.BoxGeometry(0.1, 1, 10), M.steel, sx * 6, 0.5, 4); // maze rails
  }
}

// Doppelmayr Uni-G (Pine Marten, Cloudchaser): a rounded blue pod canopy on
// a central column, operator booth alongside.
function podTerminal(color, isTop) {
  mats();
  const g = new THREE.Group();
  const c = paint(color);
  part(g, capsuleShell(9.6, 3.8, 16, 1.7), c, 0, TERM_H + 1.1, -4.5);
  part(g, new THREE.BoxGeometry(9.7, 1.0, 9), M.glass, 0, TERM_H + 2.9, 3); // window band
  part(g, new THREE.BoxGeometry(8.6, 0.25, 15), M.snow, 0, TERM_H + 5.0, 3.5); // snow on top
  part(g, new THREE.BoxGeometry(1.5, TERM_H + 1.2, 1.5), M.steel, 0, (TERM_H + 1.2) / 2, 3);
  wheelAndRail(g, 11);
  operatorBooth(g, c, 7.2, 8);
  loadPlatform(g, isTop);
  if (isTop) {
    // Dark lift-ops hut beside the top station, as at Pine Marten.
    part(g, new THREE.BoxGeometry(4, 3.4, 4), M.wood, -8, 1.7, 2);
    part(g, new THREE.BoxGeometry(4.6, 0.3, 4.6), M.snow, -8, 3.55, 2);
  }
  return g;
}

// Doppelmayr CLD-260 (Outback, Northwest, Sunrise): long boxy canopy with
// chamfered ends, white with a blue band, on two legs.
function cldTerminal(color, isTop) {
  mats();
  const g = new THREE.Group();
  const s = new THREE.Shape();
  // Profile in (z, y); extruded across x.
  [[-7, 0.6], [-5, 0], [13, 0], [15, 0.6], [15, 2.6], [13, 3.4], [-5, 3.4], [-7, 2.6]].forEach(([z, y], i) =>
    i ? s.lineTo(z, y) : s.moveTo(z, y));
  const w = 9.4;
  const shell = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(w / 2, 0, 0);
  part(g, shell, M.white, 0, TERM_H + 1.0, 0);
  part(g, new THREE.BoxGeometry(w + 0.06, 0.7, 18), paint(color), 0, TERM_H + 1.6, 4);
  part(g, new THREE.BoxGeometry(w - 0.6, 0.25, 19), M.snow, 0, TERM_H + 4.55, 4);
  for (const z of [-2, 9]) part(g, new THREE.BoxGeometry(1.1, TERM_H + 1.1, 1.1), M.steel, 0, (TERM_H + 1.1) / 2, z);
  wheelAndRail(g, 12);
  operatorBooth(g, paint(color), 6.8, 9);
  loadPlatform(g, isTop);
  return g;
}

// Doppelmayr D-Line (Skyliner, 2023): long, low, sleek silver canopy with
// glass sides.
function dlineTerminal(color, isTop) {
  mats();
  const g = new THREE.Group();
  part(g, capsuleShell(10.6, 2.6, 26, 1.0, 1.8), M.silver, 0, TERM_H + 1.0, -6);
  part(g, new THREE.BoxGeometry(10.7, 0.9, 20), M.glass, 0, TERM_H + 2.0, 6);
  part(g, new THREE.BoxGeometry(10.72, 0.22, 22), paint(color), 0, TERM_H + 1.15, 6);
  part(g, new THREE.BoxGeometry(9.8, 0.2, 24), M.snow, 0, TERM_H + 3.7, 7);
  for (const z of [-3, 6, 15]) part(g, new THREE.BoxGeometry(0.8, TERM_H + 1.0, 0.8), M.silver, 0, (TERM_H + 1.0) / 2, z);
  wheelAndRail(g, 16);
  // Glassy operator cabin.
  part(g, new THREE.BoxGeometry(3.2, 2.9, 3), M.glass, 7.6, 1.45, 10);
  part(g, new THREE.BoxGeometry(3.6, 0.3, 3.4), M.silver, 7.6, 3.05, 10);
  loadPlatform(g, isTop);
  return g;
}

// Summit Express: enclosed terminal buildings from the original 1983 lift,
// built to shut the weather out at 9,000 ft.
function enclosedTerminal(color, isTop) {
  mats();
  const g = new THREE.Group();
  const c = paint(color);
  const len = 20;
  part(g, new THREE.BoxGeometry(11, 9, len), c, 0, 4.5, -6 + len / 2);
  part(g, new THREE.BoxGeometry(11.6, 0.5, len + 0.6), M.white, 0, 9.25, -6 + len / 2);
  part(g, new THREE.BoxGeometry(11.2, 0.4, len + 0.2), M.snow, 0, 9.7, -6 + len / 2);
  // The open end where chairs come and go.
  part(g, new THREE.BoxGeometry(8.4, 6.2, 0.2), M.dark, 0, 3.3, len - 5.9);
  // Control room with windows on the side.
  part(g, new THREE.BoxGeometry(4, 3, 6), M.white, 7.2, 4.5, 6);
  part(g, new THREE.BoxGeometry(4.04, 1.1, 6.04), M.glass, 7.2, 5, 6);
  part(g, new THREE.BoxGeometry(1.2, 3, 1.2), M.steel, 7.2, 1.5, 6);
  wheelAndRail(g, 0);
  loadPlatform(g, isTop);
  return g;
}

// Fixed-grip (Red, Rainbow, Little Pine...): an open bullwheel on a steel
// post and raked brace, a drive box over the wheel at the bottom, and a
// small timber operator shack.
function fixedTerminal(color, isTop) {
  mats();
  const g = new THREE.Group();
  const c = paint(color);
  part(g, new THREE.BoxGeometry(0.9, TERM_H + 0.3, 0.9), c, 0, (TERM_H + 0.3) / 2, -1.2);
  const brace = part(g, new THREE.BoxGeometry(0.5, 6.2, 0.5), c, 0, 2.8, -3.2);
  brace.rotation.x = -0.5;
  part(g, new THREE.BoxGeometry(1.2, 0.5, 3.4), c, 0, TERM_H + 0.25, -0.6);
  wheelAndRail(g, 0);
  if (!isTop) {
    part(g, new THREE.BoxGeometry(2.4, 1.8, 3), c, 0, TERM_H + 1.4, -1.6); // drive
    part(g, new THREE.BoxGeometry(2.6, 0.2, 3.2), M.snow, 0, TERM_H + 2.4, -1.6);
  }
  // Operator shack.
  part(g, new THREE.BoxGeometry(2.4, 2.6, 2.4), M.wood, 5, 1.3, 4);
  part(g, new THREE.BoxGeometry(2.44, 0.8, 2.44), M.glass, 5, 1.8, 4);
  part(g, new THREE.BoxGeometry(2.9, 0.3, 2.9), M.snow, 5, 2.75, 4);
  part(g, new THREE.BoxGeometry(6, 0.12, 3), M.mat, 0, 0.06, 4.5); // load mat
  return g;
}

const TERMINALS = { pod: podTerminal, cld: cldTerminal, dline: dlineTerminal, enclosed: enclosedTerminal, fixed: fixedTerminal };

// ------------------------------------------------------------------ towers
// Tubular tower: tapered pole, crossarm, a sheave train under each cable and
// a work platform. Built at unit height and scaled along y for the pole.
function towerHeadGeometry() {
  const parts = [
    new THREE.BoxGeometry(CABLE_OFFSET * 2 + 1.4, 0.5, 0.55), // crossarm
    new THREE.BoxGeometry(CABLE_OFFSET * 2 + 0.4, 0.12, 0.9).translate(0, -0.75, 0.7), // work platform
    new THREE.BoxGeometry(0.4, 1.4, 0.4).translate(0, 0.9, 0), // lifting frame
    new THREE.BoxGeometry(CABLE_OFFSET * 2 + 0.6, 0.18, 0.18).translate(0, 1.6, 0),
  ];
  for (const sx of [-1, 1]) {
    // Sheave train: a beam with a row of wheels under the cable.
    parts.push(new THREE.BoxGeometry(0.22, 0.32, 3.4).translate(sx * CABLE_OFFSET, -0.35, 0));
    for (let k = -3; k <= 3; k += 2) {
      parts.push(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 10).rotateZ(Math.PI / 2).translate(sx * CABLE_OFFSET, -0.55, k * 0.42));
    }
  }
  return mergeGeometries(parts);
}

export function buildLifts(world) {
  const { hf } = world;
  mats();
  const group = new THREE.Group();
  const lifts = [];
  const towerSpots = [];
  const cableMat = new THREE.LineBasicMaterial({ color: 0x1d2228 });

  for (const L of world.lifts) {
    const B = new THREE.Vector3(L.bottom.x, L.bottom.y, L.bottom.z);
    const T = new THREE.Vector3(L.top.x, L.top.y, L.top.z);
    const flat = new THREE.Vector3(T.x - B.x, 0, T.z - B.z);
    const horiz = flat.length();
    const dir = flat.clone().normalize(); // uphill, horizontal
    const side = new THREE.Vector3(-dir.z, 0, dir.x); // right of uphill
    const yaw = Math.atan2(dir.x, dir.z);

    // Tower tops along the line; raise towers wherever the cable would
    // come too close to the snow.
    const span = L.type === 'express' ? 110 : 85;
    const towerCount = Math.max(1, Math.round(horiz / span) - 1);
    const tops = [new THREE.Vector3(B.x, B.y + TERM_H, B.z)];
    const heights = [];
    for (let k = 1; k <= towerCount; k++) {
      const t = k / (towerCount + 1);
      const x = B.x + (T.x - B.x) * t;
      const z = B.z + (T.z - B.z) * t;
      const ground = hf.heightAt(x, z);
      heights.push(10);
      tops.push(new THREE.Vector3(x, ground + 10, z));
    }
    tops.push(new THREE.Vector3(T.x, T.y + TERM_H, T.z));
    for (let pass = 0; pass < 4; pass++) {
      for (let k = 0; k < tops.length - 1; k++) {
        const a = tops[k];
        const b = tops[k + 1];
        for (let s = 1; s < 10; s++) {
          const p = new THREE.Vector3().lerpVectors(a, b, s / 10);
          const clearance = p.y - HANGER - 2.5 - hf.heightAt(p.x, p.z);
          if (clearance < 0) {
            const lift = -clearance + 0.5;
            if (k > 0 && k - 1 < heights.length && heights[k - 1] < 24) {
              heights[k - 1] += lift;
              a.y += lift;
            }
            if (k < heights.length && heights[k] < 24) {
              heights[k] += lift;
              b.y += lift;
            }
          }
        }
      }
    }

    const up = new Path(tops.map((p) => p.clone().addScaledVector(side, CABLE_OFFSET)));
    const down = new Path(tops.map((p) => p.clone().addScaledVector(side, -CABLE_OFFSET)).reverse());
    for (const path of [up, down]) {
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(path.sagged()), cableMat));
    }

    const color = L.color ? new THREE.Color(L.color).getHex() : BACHELOR_BLUE;
    const build = TERMINALS[L.terminal] || (L.type === 'express' ? podTerminal : fixedTerminal);
    const bottomTerm = build(color, false);
    bottomTerm.position.copy(B);
    bottomTerm.rotation.y = yaw; // +z points up the line
    const topTerm = build(color, true);
    topTerm.position.copy(T);
    topTerm.rotation.y = yaw + Math.PI; // +z points back down the line
    group.add(bottomTerm, topTerm);

    for (let k = 1; k < tops.length - 1; k++) {
      towerSpots.push({ top: tops[k], height: heights[k - 1], yaw, color: L.color ? color : null });
    }

    const type = L.type;
    const loop = up.length + down.length;
    const count = Math.floor(loop / SPACING[type]);
    lifts.push({
      data: L,
      up,
      down,
      yaw,
      dir,
      side,
      type,
      seats: L.seats || (type === 'express' ? 4 : 3),
      speed: SPEED[type],
      loop,
      count,
      spacing: loop / count,
      offset: 0,
      color: L.color ? new THREE.Color(L.color) : new THREE.Color(0x2a2f36),
      labelAnchor: up.at(up.length * 0.55).clone().add(new THREE.Vector3(0, 30, 0)),
    });
  }

  // --- Towers (instanced): pole scaled to height, head at the top.
  const pole = new THREE.CylinderGeometry(0.38, 0.55, 1, 8).translate(0, 0.5, 0);
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x7a8592, roughness: 0.5, metalness: 0.4 });
  const poles = new THREE.InstancedMesh(pole, towerMat, towerSpots.length);
  const heads = new THREE.InstancedMesh(towerHeadGeometry(), towerMat, towerSpots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  towerSpots.forEach((t, k) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.yaw);
    const base = t.top.clone();
    base.y -= t.height + 0.6;
    m.compose(base, q, new THREE.Vector3(1, t.height + 0.6, 1));
    poles.setMatrixAt(k, m);
    m.compose(t.top.clone().add(new THREE.Vector3(0, 0.6, 0)), q, new THREE.Vector3(1, 1, 1));
    heads.setMatrixAt(k, m);
    c.set(t.color ?? 0xffffff);
    poles.setColorAt(k, c);
    heads.setColorAt(k, c);
  });
  for (const im of [poles, heads]) {
    im.castShadow = true;
    group.add(im);
  }

  // --- Chairs: one instanced mesh per chair design.
  const meshes = new Map();
  const key = (l) => `${l.seats}-${l.type}`;
  for (const l of lifts) {
    if (!meshes.has(key(l))) meshes.set(key(l), { seats: l.seats, type: l.type, total: 0 });
    meshes.get(key(l)).total += l.count;
  }
  for (const entry of meshes.values()) {
    const mesh = new THREE.InstancedMesh(
      chairGeometry(entry.seats, entry.type === 'express'),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.3 }),
      entry.total,
    );
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    entry.mesh = mesh;
    entry.next = 0;
    group.add(mesh);
  }
  for (const l of lifts) {
    const entry = meshes.get(key(l));
    l.mesh = entry.mesh;
    l.base = entry.next;
    for (let i = 0; i < l.count; i++) l.mesh.setColorAt(l.base + i, l.color);
    entry.next += l.count;
  }

  const tmp = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const axisY = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);

  // Where chair i of a lift is: position, facing, and whether it is going up.
  function chairAt(l, i, out) {
    const s = (l.offset + i * l.spacing) % l.loop;
    if (s < l.up.length) {
      l.up.at(s, out);
      return true;
    }
    l.down.at(s - l.up.length, out);
    return false;
  }

  function update(dt, running = true) {
    for (const l of lifts) {
      if (running) l.offset = (l.offset + l.speed * dt) % l.loop;
      for (let i = 0; i < l.count; i++) {
        const goingUp = chairAt(l, i, tmp);
        quat.setFromAxisAngle(axisY, goingUp ? l.yaw : l.yaw + Math.PI);
        m.compose(tmp, quat, one);
        l.mesh.setMatrixAt(l.base + i, m);
      }
    }
    for (const entry of meshes.values()) entry.mesh.instanceMatrix.needsUpdate = true;
  }
  update(0);

  // Where a rider sits: on the up cable at distance s.
  function seatAt(lift, s, out = new THREE.Vector3()) {
    lift.up.at(s, out);
    out.y -= HANGER - 1.25;
    return out;
  }
  function lookAt(lift, s, out = new THREE.Vector3()) {
    seatAt(lift, Math.min(lift.up.length, s + 140), ahead);
    return out.copy(ahead);
  }

  return { group, lifts, update, seatAt, lookAt, chairAt };
}
