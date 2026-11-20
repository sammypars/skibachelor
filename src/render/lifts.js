import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const CABLE_OFFSET = 2.9; // half the gap between the up and down cables
const HANGER = 3.3; // cable to seat
const SPEED = { express: 5.0, fixed: 2.3 }; // m/s, real-world line speeds
const SPACING = { express: 34, fixed: 18 }; // m between chairs
const SEATS = { express: 4, fixed: 3 };

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

function chairGeometry(seats) {
  const w = seats * 0.62;
  const parts = [
    new THREE.BoxGeometry(0.12, HANGER - 0.4, 0.12).translate(0, -(HANGER - 0.4) / 2, -0.25),
    new THREE.BoxGeometry(0.12, 0.12, 0.7).translate(0, -HANGER + 0.4, 0.05),
    new THREE.BoxGeometry(w, 0.14, 0.62).translate(0, -HANGER, 0.12), // seat
    new THREE.BoxGeometry(w, 0.7, 0.1).translate(0, -HANGER + 0.35, -0.22), // back
    new THREE.BoxGeometry(w, 0.06, 0.06).translate(0, -HANGER + 0.75, 0.55), // safety bar
    new THREE.BoxGeometry(w * 0.9, 0.06, 0.3).translate(0, -HANGER - 0.85, 0.65), // footrest
    new THREE.BoxGeometry(0.4, 0.25, 0.25).translate(0, 0, -0.25), // grip
  ];
  return mergeGeometries(parts);
}

function terminalGroup(color) {
  const g = new THREE.Group();
  const steel = new THREE.MeshLambertMaterial({ color: 0x5f6b78 });
  const shed = new THREE.MeshLambertMaterial({ color });
  const roof = new THREE.MeshLambertMaterial({ color: 0xf2f5f8 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(9, 4, 7), shed);
  base.position.set(0, 2, -6);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.5, 7.6), roof);
  cap.position.set(0, 4.25, -6);
  const column = new THREE.Mesh(new THREE.BoxGeometry(1.4, 7, 1.4), steel);
  column.position.set(0, 3.5, 0);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(CABLE_OFFSET, 0.22, 6, 24), steel);
  wheel.rotation.x = Math.PI / 2;
  wheel.position.set(0, 7.2, 0);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 4), shed);
  housing.position.set(0, 7.6, -1.2);
  for (const m of [base, cap, column, wheel, housing]) {
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

export function buildLifts(world) {
  const { hf } = world;
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
    const towerCount = Math.max(1, Math.round(horiz / 105) - 1);
    const tops = [new THREE.Vector3(B.x, B.y + 7.2, B.z)];
    const heights = [];
    for (let k = 1; k <= towerCount; k++) {
      const t = k / (towerCount + 1);
      const x = B.x + (T.x - B.x) * t;
      const z = B.z + (T.z - B.z) * t;
      const ground = hf.heightAt(x, z);
      heights.push(11);
      tops.push(new THREE.Vector3(x, ground + 11, z));
    }
    tops.push(new THREE.Vector3(T.x, T.y + 7.2, T.z));
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
    const down = new Path(
      tops.map((p) => p.clone().addScaledVector(side, -CABLE_OFFSET)).reverse(),
    );

    for (const path of [up, down]) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(path.sagged()), cableMat);
      group.add(line);
    }

    const termColor = L.color ? new THREE.Color(L.color) : new THREE.Color(0x2c4d6e);
    const bottomTerm = terminalGroup(termColor);
    bottomTerm.position.copy(B);
    bottomTerm.rotation.y = yaw; // drive shed sits downhill of the bullwheel
    const topTerm = terminalGroup(termColor);
    topTerm.position.copy(T);
    topTerm.rotation.y = yaw + Math.PI; // and uphill at the top
    group.add(bottomTerm, topTerm);

    for (let k = 1; k < tops.length - 1; k++) {
      towerSpots.push({ top: tops[k], height: heights[k - 1], yaw });
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
      speed: SPEED[type],
      loop,
      count,
      spacing: loop / count,
      offset: 0,
      color: L.color ? new THREE.Color(L.color) : new THREE.Color(0x2a2f36),
      labelAnchor: up.at(up.length * 0.55).clone().add(new THREE.Vector3(0, 30, 0)),
    });
  }

  // --- Towers (instanced).
  const pole = new THREE.CylinderGeometry(0.42, 0.55, 1, 6).translate(0, 0.5, 0);
  const arm = new THREE.BoxGeometry(CABLE_OFFSET * 2 + 1.6, 0.45, 0.6);
  const towerMat = new THREE.MeshLambertMaterial({ color: 0x6d7987 });
  const poles = new THREE.InstancedMesh(pole, towerMat, towerSpots.length);
  const arms = new THREE.InstancedMesh(arm, towerMat, towerSpots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  towerSpots.forEach((t, k) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.yaw);
    const base = t.top.clone();
    base.y -= t.height + 0.6;
    m.compose(base, q, new THREE.Vector3(1, t.height + 0.6, 1));
    poles.setMatrixAt(k, m);
    m.compose(t.top.clone().add(new THREE.Vector3(0, 0.25, 0)), q, new THREE.Vector3(1, 1, 1));
    arms.setMatrixAt(k, m);
  });
  for (const im of [poles, arms]) {
    im.castShadow = true;
    group.add(im);
  }

  // --- Chairs (one instanced mesh per chair size).
  const meshes = {};
  for (const type of ['express', 'fixed']) {
    const total = lifts.filter((l) => l.type === type).reduce((s, l) => s + l.count, 0);
    const mesh = new THREE.InstancedMesh(
      chairGeometry(SEATS[type]),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      Math.max(1, total),
    );
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    meshes[type] = mesh;
    group.add(mesh);
    let k = 0;
    for (const l of lifts.filter((x) => x.type === type)) {
      l.mesh = mesh;
      l.base = k;
      for (let i = 0; i < l.count; i++) mesh.setColorAt(k + i, l.color);
      k += l.count;
    }
  }

  const tmp = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const axisY = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);

  function update(dt, running = true) {
    for (const l of lifts) {
      if (running) l.offset = (l.offset + l.speed * dt) % l.loop;
      for (let i = 0; i < l.count; i++) {
        const s = (l.offset + i * l.spacing) % l.loop;
        let face;
        if (s < l.up.length) {
          l.up.at(s, tmp);
          face = l.yaw;
        } else {
          l.down.at(s - l.up.length, tmp);
          face = l.yaw + Math.PI;
        }
        quat.setFromAxisAngle(axisY, face);
        m.compose(tmp, quat, one);
        l.mesh.setMatrixAt(l.base + i, m);
      }
    }
    for (const mesh of Object.values(meshes)) mesh.instanceMatrix.needsUpdate = true;
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

  return { group, lifts, update, seatAt, lookAt };
}
