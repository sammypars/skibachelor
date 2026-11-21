// Ski mode: ride the mountain yourself.
//
//   A / D or ← / →   carve left / right · spin in the air · turn on a rail
//   W or ↑           tuck (pole on the flats) · frontflip in the air
//   S or ↓           brake (skid) · backflip in the air
//   Space            hold to load, release to pop (kickers launch you too;
//                    pops you off a rail)
//   Shift            grab
//   E                ride the lift when you're at the bottom of one
//   R                back to your last good spot · Esc to stop skiing
//
// The physics is a point mass on the real snow surface (terrain plus the
// shaped park snow): gravity along the slope, snow friction, air drag (less
// in a tuck), and ski edges that grip sideways so the skis carve the
// velocity round instead of sliding. Leave a convex lip fast enough and you
// fly a ballistic arc; spins and flips are added on top and judged when you
// touch down. Land on a rail or box and you slide it: gravity along the
// rail, low friction, off the end (or pop) back into the air.

import * as THREE from 'three';
import { createSkierModel } from './skier-model.js';
import { createSnowSpray, createSkiTracks } from './ski-fx.js';
import { HANGER } from './render/lifts.js';

const G = 9.81;
const MASS = 80; // kg, rider and kit
const RHO = 1.0; // air density at 2,000 m
const CDA_STAND = 0.55; // drag area, m^2
const CDA_TUCK = 0.25;
const MU_SNOW = 0.045; // ski on groomed snow
const MU_BRAKE = 0.55; // skidding sideways
const MU_RAIL = 0.07; // ski base on steel / UHMW
const GRIP = 9; // how fast edges kill sideways slip (1/s)
const CARVE_R = 14; // tightest carve radius at speed (m)
const COM = 0.9; // centre of mass above the feet (m)
const SPIN_RATE = 2 * Math.PI * 1.25; // rad/s at full spin
const FLIP_RATE = 2 * Math.PI * 1.15;
const SUBSTEPS = 4;
const LIFT_REACH = 28; // how close to a bottom terminal to board (m)

const UP = new THREE.Vector3(0, 1, 0);

export function createSki({ scene, camera, world, surfaceAt, treeNear, grindables = [], lifts, hud }) {
  const keys = new Set();
  const touch = new Set();
  const held = (...names) => names.some((n) => keys.has(n) || touch.has(n));

  // --- The rider, the spray and the tracks.
  const model = createSkierModel();
  const pivot = new THREE.Group(); // rotates about the centre of mass
  model.root.position.y = -COM;
  pivot.add(model.root);
  pivot.visible = false;
  scene.add(pivot);
  const spray = createSnowSpray(scene);
  const tracks = createSkiTracks(scene);

  // --- Rails, boxes and the like, bucketed by 8 m cell.
  const CELL = 8;
  const railCells = new Map();
  const cellKey = (i, j) => i * 100003 + j;
  for (const gr of grindables) {
    for (let i = 0; i < gr.pts.length - 1; i++) {
      const a = gr.pts[i];
      const b = gr.pts[i + 1];
      const i0 = Math.floor(Math.min(a.x, b.x) / CELL);
      const i1 = Math.floor(Math.max(a.x, b.x) / CELL);
      const j0 = Math.floor(Math.min(a.z, b.z) / CELL);
      const j1 = Math.floor(Math.max(a.z, b.z) / CELL);
      for (let ci = i0; ci <= i1; ci++) {
        for (let cj = j0; cj <= j1; cj++) {
          const k = cellKey(ci, cj);
          if (!railCells.has(k)) railCells.set(k, []);
          railCells.get(k).push({ gr, i });
        }
      }
    }
  }

  // --- State.
  const pos = new THREE.Vector3(); // feet
  const vel = new THREE.Vector3();
  const quat = new THREE.Quaternion(); // body orientation (+z = ski tips)
  let yaw = 0; // ski heading on the ground
  let onGround = true;
  let load = 0; // 0..1 while Space is held
  let loading = false;
  let spinVel = 0;
  let flipVel = 0;
  let air = null; // airborne: { spin, flip, grab, t, ... }
  let grind = null; // on a rail: { gr, i, t, dir, speed, off, time }
  let chair = null; // riding a lift: { l, i, lastS }
  let crashed = 0; // seconds left in a crash
  let active = false;
  let score = 0;
  let safe = { pos: new THREE.Vector3(), yaw: 0 };
  let safeTimer = 0;
  let lean = 0;
  let braking = 0;
  let absorb = 0; // landing compression, springs back
  let shake = 0;
  let trackBreak = true;
  let nearLift = null;
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();

  // --- Surface helpers.
  const n = new THREE.Vector3();
  function normalAt(x, z, out = n) {
    const e = 0.6;
    const hx = surfaceAt(x + e, z) - surfaceAt(x - e, z);
    const hz = surfaceAt(x, z + e) - surfaceAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  // --- Input.
  const CODES = {
    KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
    KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
    Space: 'pop', ShiftLeft: 'grab', ShiftRight: 'grab',
  };
  function onKey(e, down) {
    if (!active) return;
    if (e.target.tagName === 'INPUT') return;
    const k = CODES[e.code];
    if (k) {
      e.preventDefault();
      if (down) keys.add(k);
      else keys.delete(k);
    }
    if (!down) return;
    if (e.code === 'KeyR') respawn();
    if (e.code === 'KeyE') {
      if (chair) skipLift();
      else if (nearLift) boardLift(nearLift);
    }
  }
  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));
  window.addEventListener('blur', () => keys.clear());
  // On-screen buttons (touch and mouse): data-ski="left|right|up|down|pop|grab".
  for (const b of hud.querySelectorAll('[data-ski]')) {
    const k = b.dataset.ski;
    const on = (e) => {
      e.preventDefault();
      touch.add(k);
      b.classList.add('on');
    };
    const off = (e) => {
      e.preventDefault();
      touch.delete(k);
      b.classList.remove('on');
    };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointerleave', off);
    b.addEventListener('pointercancel', off);
  }
  const promptEl = hud.querySelector('.ski-prompt');
  promptEl.addEventListener('click', () => {
    if (chair) skipLift();
    else if (nearLift) boardLift(nearLift);
  });

  // --- Start / stop.
  function start(at, heading) {
    active = true;
    pivot.visible = true;
    pos.set(at.x, surfaceAt(at.x, at.z), at.z);
    yaw = heading;
    vel.set(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(2);
    onGround = true;
    air = grind = chair = null;
    crashed = 0;
    spinVel = flipVel = 0;
    score = 0;
    safe = { pos: pos.clone(), yaw };
    tracks.clear();
    trackBreak = true;
    groundQuat(quat);
    camPos.copy(pos).addScaledVector(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), -8).add(new THREE.Vector3(0, 3.5, 0));
    camLook.copy(pos);
    hud.hidden = false;
    toast('Drop in!', '');
  }
  function stop() {
    active = false;
    keys.clear();
    touch.clear();
    pivot.visible = false;
    hud.hidden = true;
    chair = null;
  }
  function respawn() {
    pos.copy(safe.pos);
    pos.y = surfaceAt(pos.x, pos.z);
    yaw = safe.yaw;
    vel.set(0, 0, 0);
    onGround = true;
    air = grind = chair = null;
    crashed = 0;
    spinVel = flipVel = 0;
    trackBreak = true;
    groundQuat(quat);
  }

  // Body orientation when riding: skis along the heading, standing on the
  // snow, leaning into the turn.
  const f = new THREE.Vector3();
  const r = new THREE.Vector3();
  const m3 = new THREE.Matrix4();
  function groundQuat(out) {
    normalAt(pos.x, pos.z);
    f.set(Math.sin(yaw), 0, Math.cos(yaw));
    f.addScaledVector(n, -f.dot(n)).normalize();
    const up = n.clone().applyAxisAngle(f, -lean);
    r.crossVectors(up, f).normalize();
    m3.makeBasis(r, up, f);
    return out.setFromRotationMatrix(m3);
  }

  // --- Tricks.
  let toastTimer = 0;
  const toastEl = hud.querySelector('.ski-toast');
  function toast(title, sub) {
    toastEl.innerHTML = `<b>${title}</b>${sub ? `<span>${sub}</span>` : ''}`;
    toastEl.classList.add('show');
    toastTimer = 2.2;
  }
  function trickName(spin, flip, grab, switchLand) {
    const deg = Math.round(Math.abs(spin) / Math.PI) * 180;
    const flips = Math.round(Math.abs(flip) / (2 * Math.PI));
    const back = flip < 0;
    const parts = [];
    if (flips && deg >= 180) parts.push(`${flips > 1 ? 'Double ' : ''}${back ? 'Cork' : 'Bio'} ${deg}`);
    else if (flips) parts.push(`${flips > 1 ? (flips > 2 ? 'Triple ' : 'Double ') : ''}${back ? 'Backflip' : 'Frontflip'}`);
    else if (deg >= 180) parts.push(`${deg}`);
    if (grab) parts.push(parts.length ? 'Mute' : 'Mute Grab');
    if (switchLand && deg % 360 === 180) parts.push('· lands switch');
    return parts.join(' ') || null;
  }
  function trickPoints(spin, flip, grab) {
    const turns = Math.round(Math.abs(spin) / Math.PI) / 2;
    const flips = Math.round(Math.abs(flip) / (2 * Math.PI));
    let p = Math.round(2000 * Math.pow(turns, 2)) + flips * 3000;
    if (grab) p = Math.round(p * 1.25) + 250;
    return p;
  }

  // --- Physics.
  const g = new THREE.Vector3(0, -G, 0);
  const a = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const q1 = new THREE.Quaternion();

  function stepGround(dt) {
    normalAt(pos.x, pos.z);
    f.set(Math.sin(yaw), 0, Math.cos(yaw));
    f.addScaledVector(n, -f.dot(n)).normalize();
    r.crossVectors(n, f).normalize();

    const speed = vel.length();
    const steer = (held('left') ? 1 : 0) - (held('right') ? 1 : 0);
    const brake = held('down') && !loading;
    const tuck = held('up');
    braking += ((brake ? 1 : 0) - braking) * Math.min(1, dt * 6);

    // Turning: carve radius sets the yaw rate at speed; pivot when slow.
    const rate = Math.min(2.6, Math.max(1.4, speed / CARVE_R)) * (brake ? 1.3 : 1);
    yaw += steer * rate * dt;
    // Lean into the turn (centripetal), clamped.
    const wantLean = Math.atan2(speed * steer * rate, G);
    lean += (Math.max(-0.9, Math.min(0.9, wantLean)) - lean) * Math.min(1, dt * 8);

    // Forces: full gravity (the snow only pushes back if we'd sink into it),
    // snow friction against the travel (much more when skidding), air drag.
    a.copy(g);
    const normalG = G * n.y;
    const vf = vel.dot(f);
    const mu = MU_SNOW + (MU_BRAKE - MU_SNOW) * braking;
    if (speed > 0.05) a.addScaledVector(vel, (-mu * normalG) / speed);
    const cda = tuck ? CDA_TUCK : CDA_STAND;
    a.addScaledVector(vel, (-0.5 * RHO * cda * speed) / MASS);
    // Pole / skate on the flats.
    if (tuck && speed < 5) a.addScaledVector(f, 1.6);
    vel.addScaledVector(a, dt);

    // Edges grip: sideways slip decays, so the skis carve the velocity round.
    const grip = brake ? 2 : GRIP;
    const vl = vel.dot(r);
    vel.addScaledVector(r, -vl * (1 - Math.exp(-grip * dt)));
    if (brake && vel.length() < 0.4 && Math.abs(vf) < 0.4) vel.multiplyScalar(0.5);

    // Snow spray: skids throw a sheet of it, hard carves a little.
    if (speed > 4 && Math.random() < dt * 60) {
      const amount = braking * Math.min(6, speed * 0.4) + Math.abs(steer) * Math.max(0, speed - 9) * 0.12;
      if (amount > 0.3) spray.emit(pos, tmp2.copy(r).multiplyScalar(-Math.sign(vl || steer || 1) * (2 + speed * 0.25)).addScaledVector(vel, 0.3), Math.round(amount), 1.2, 1.2);
    }

    // Pop: release Space to jump off the snow.
    if (loading && !held('pop')) {
      loading = false;
      const charge = load;
      load = 0;
      vel.addScaledVector(n, 2.0 + 2.2 * charge);
      takeoff(charge);
      return;
    }
    if (held('pop')) {
      loading = true;
      load = Math.min(1, load + dt / 0.6);
    }

    // Onto a box from the snow (ride-on boxes, or a deck that leads onto it).
    if (tryGrind()) return;

    // Move, then stay on the snow or leave it: if free fall would carry us
    // above the snow (a lip, a convex roll taken fast) we're in the air.
    tmp.copy(pos).addScaledVector(vel, dt);
    const s = surfaceAt(tmp.x, tmp.z);
    if (tmp.y > s + 0.008) {
      pos.copy(tmp);
      takeoff(load);
      return;
    }
    pos.set(tmp.x, s, tmp.z);
    const n2 = normalAt(pos.x, pos.z, tmp);
    const vn = vel.dot(n2);
    if (vn < 0) vel.addScaledVector(n2, -vn);

    // Trees.
    if (speed > 3 && treeNear?.(pos.x, pos.z, 1.4)) crash('Tree!');

    groundQuat(quat);
    safeTimer += dt;
    if (safeTimer > 1 && speed > 1 && !brake) {
      safeTimer = 0;
      safe = { pos: pos.clone(), yaw };
    }
  }

  function takeoff(charge, heading = yaw, tiltFromSnow = true) {
    onGround = false;
    loading = false;
    load = 0;
    trackBreak = true;
    // Air orientation as heading / pitch / roll (Y-X-Z): spins turn the
    // heading about the vertical, flips turn the pitch about the body's
    // sideways axis. Off the lip the body starts tipped with the ramp and
    // stands itself up.
    let rampPitch = 0;
    if (tiltFromSnow) {
      normalAt(pos.x, pos.z);
      f.set(Math.sin(heading), 0, Math.cos(heading));
      rampPitch = Math.atan2(n.x * f.x + n.z * f.z, n.y); // < 0 on a kicker: tips up
    }
    air = { spin: 0, flip: 0, grab: false, grabT: 0, t: 0, charge, heading, heading0: heading, pitch: 0, tilt: rampPitch, roll: lean };
    spinVel = 0;
    flipVel = 0;
    lean = 0;
    airQuat();
  }
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  function airQuat() {
    euler.set(air.pitch + air.tilt, air.heading, air.roll);
    quat.setFromEuler(euler);
  }

  function stepAir(dt) {
    air.t += dt;
    const speed = vel.length();
    vel.y -= G * dt;
    vel.addScaledVector(vel, (-0.5 * RHO * CDA_STAND * speed * dt) / MASS);
    pos.addScaledVector(vel, dt);

    // Rotation: hold to wind it up; let go and it carries on to the next
    // full 180 of spin / full flip, then stops (if there's air left).
    const boost = 1 + 0.35 * air.charge;
    const spinIn = (held('left') ? 1 : 0) - (held('right') ? 1 : 0);
    const flipIn = (held('up') ? 1 : 0) - (held('down') ? 1 : 0);
    const ease = (v, target, k) => v + (target - v) * Math.min(1, dt * k);
    const settle = (angle, v, unit, min) => {
      const dir = Math.sign(v) || Math.sign(angle) || 1;
      const k = angle / unit;
      const target = (dir > 0 ? Math.ceil(k - 0.12) : Math.floor(k + 0.12)) * unit;
      const left = target - angle;
      if (Math.abs(left) < 0.01) return { v: 0, angle: target };
      const sp = Math.max(Math.abs(v), min);
      const step = Math.min(Math.abs(left), sp * dt);
      return { v: Math.sign(left) * sp, angle: angle + Math.sign(left) * step };
    };
    if (spinIn) {
      spinVel = ease(spinVel, spinIn * SPIN_RATE * boost, 7);
      air.spin += spinVel * dt;
    } else if (air.spin !== 0) {
      const s2 = settle(air.spin, spinVel, Math.PI, SPIN_RATE * 0.55);
      spinVel = s2.v;
      air.spin = s2.angle;
    }
    if (flipIn) {
      flipVel = ease(flipVel, flipIn * FLIP_RATE * boost, 6);
      air.flip += flipVel * dt;
    } else if (air.flip !== 0) {
      const s2 = settle(air.flip, flipVel, 2 * Math.PI, FLIP_RATE * 0.6);
      flipVel = s2.v;
      air.flip = s2.angle;
    }
    air.tilt *= Math.exp(-dt * 3);
    air.roll *= Math.exp(-dt * 4);
    air.pitch = air.flip;
    air.heading = air.heading0 + air.spin;
    airQuat();
    if (held('grab')) {
      air.grabT += dt;
      if (air.grabT > 0.25) air.grab = true;
    }

    // Onto a rail or box?
    if (vel.y < 1.5 && tryGrind()) return;

    // Touchdown.
    const s = surfaceAt(pos.x, pos.z);
    if (pos.y <= s) {
      pos.y = s;
      land();
    }
  }

  function land() {
    normalAt(pos.x, pos.z);
    const vt = vel.clone().addScaledVector(n, -vel.dot(n));
    const sp = vt.length();
    const impact = -vel.dot(n);
    const fl = ((air.flip % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const flipOff = Math.min(fl, 2 * Math.PI - fl);
    const fwd = new THREE.Vector3(Math.sin(air.heading), 0, Math.cos(air.heading));
    let off = 0;
    if (sp > 1) off = Math.acos(Math.min(1, Math.abs(fwd.dot(tmp.copy(vt).setY(0).normalize()))));
    const switchLand = fwd.dot(vt) < 0;

    // Tiny hops over rollers: just keep riding.
    if (air.t < 0.25 && flipOff < 0.5) {
      vel.copy(vt);
      onGround = true;
      air = null;
      spinVel = flipVel = 0;
      return;
    }
    if (flipOff > 0.85) return crash(flipOff > 2 ? 'Head first!' : 'Under-rotated!');
    if (off > 1.0 && sp > 4) return crash('Sideways!');
    if (impact > 13) return crash('Flat landing!');

    yaw = air.heading;
    vel.copy(vt);
    const clean = off < 0.45 && flipOff < 0.45;
    if (!clean) vel.multiplyScalar(0.65);
    if (impact > 8) vel.multiplyScalar(0.85);
    onGround = true;
    lean = 0;
    // Knees soak it up; a puff of snow; the camera feels it.
    absorb = Math.min(1, impact / 9);
    shake = Math.min(0.35, impact * 0.025);
    spray.emit(pos, tmp2.copy(vt).multiplyScalar(0.4), Math.round(8 + impact * 3), 3, 1.6);
    const name = trickName(air.spin, air.flip, air.grab, switchLand);
    const airtime = air.t;
    if (name) {
      let pts = trickPoints(air.spin, air.flip, air.grab);
      if (clean) pts += 600;
      else pts = Math.round(pts * 0.5);
      score += pts;
      toast(name, `${clean ? 'Clean' : 'Sketchy'} · +${pts.toLocaleString()} · ${airtime.toFixed(1)}s air`);
    } else if (airtime > 0.7) {
      const pts = Math.round(airtime * 150);
      score += pts;
      toast(clean ? 'Straight air' : 'Sketchy', `+${pts} · ${airtime.toFixed(1)}s air`);
    }
    air = null;
    spinVel = flipVel = 0;
  }

  // --- Rails and boxes.
  // The nearest slide surface under the feet: lined up with the travel,
  // feet within reach of its top.
  function findGrind() {
    const ci = Math.floor(pos.x / CELL);
    const cj = Math.floor(pos.z / CELL);
    const list = railCells.get(cellKey(ci, cj));
    if (!list) return null;
    const vh = tmp2.set(vel.x, 0, vel.z);
    const vhl = vh.length();
    if (vhl < 2) return null;
    vh.divideScalar(vhl);
    let best = null;
    for (const { gr, i } of list) {
      const A = gr.pts[i];
      const B = gr.pts[i + 1];
      const dx = B.x - A.x;
      const dz = B.z - A.z;
      const len2 = dx * dx + dz * dz;
      if (len2 < 1e-4) continue;
      let t = ((pos.x - A.x) * dx + (pos.z - A.z) * dz) / len2;
      if (t < -0.02 || t > 1.02) continue;
      t = Math.max(0, Math.min(1, t));
      const px = A.x + dx * t;
      const pz = A.z + dz * t;
      const lateral = Math.hypot(pos.x - px, pos.z - pz);
      if (lateral > gr.halfWidth + 0.3) continue;
      const top = A.y + (B.y - A.y) * t;
      if (pos.y < top - 0.35 || pos.y > top + 0.3) continue;
      const len = Math.sqrt(len2);
      const along = (vh.x * dx + vh.z * dz) / len;
      if (Math.abs(along) < 0.6) continue; // must be travelling down it
      if (!best || lateral < best.lateral) best = { gr, i, t, top, lateral, dir: Math.sign(along) };
    }
    return best;
  }

  function tryGrind() {
    const hit = findGrind();
    if (!hit) return false;
    const { gr, i, t, dir } = hit;
    const A = gr.pts[i];
    const B = gr.pts[i + 1];
    const u = tmp.subVectors(B, A).normalize().multiplyScalar(dir);
    const speed = Math.max(2, vel.dot(u));
    // Body angle to the rail: whatever we came in with (a 90 = boardslide).
    const heading = onGround ? yaw : air ? air.heading : yaw;
    const railHeading = Math.atan2(u.x, u.z);
    let off = heading - railHeading;
    off = Math.atan2(Math.sin(off), Math.cos(off));
    // Snap to the nearest stance: along (50-50 / switch) or across (slide).
    const quarter = Math.round(off / (Math.PI / 2)) * (Math.PI / 2);
    // Landing onto it judges the air first (a spin onto the rail counts).
    let lead = '';
    if (air && air.t > 0.3) {
      const name = trickName(air.spin, 0, air.grab, false);
      if (name) lead = `${name} on · `;
    }
    grind = { gr, i, t, dir, speed, off: quarter, time: 0, lead, wobble: 0 };
    air = null;
    onGround = false;
    spinVel = flipVel = 0;
    pos.set(A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t, A.z + (B.z - A.z) * t);
    spray.emit(pos, tmp2.set(0, 0, 0), 6, 1.5, 0.8);
    return true;
  }

  function stepGrind(dt) {
    const G2 = grind;
    const pts = G2.gr.pts;
    let A = pts[G2.i];
    let B = pts[G2.i + 1];
    const seg = tmp.subVectors(B, A);
    const segLen = seg.length();
    const u = seg.divideScalar(segLen).multiplyScalar(G2.dir); // direction of travel
    // Gravity along the rail, sliding friction, air drag.
    const accel = -G * u.y - MU_RAIL * G * Math.sqrt(Math.max(0, 1 - u.y * u.y)) - (0.5 * RHO * CDA_STAND * G2.speed * G2.speed) / MASS;
    G2.speed += accel * dt;
    G2.time += dt;
    // Turn the body on the rail (A/D): 50-50 <-> boardslide.
    const steer = (held('left') ? 1 : 0) - (held('right') ? 1 : 0);
    if (steer) G2.off += steer * 3.2 * dt;
    else {
      const q = Math.round(G2.off / (Math.PI / 2)) * (Math.PI / 2);
      G2.off += (q - G2.off) * Math.min(1, dt * 8);
    }
    // Advance along the polyline.
    G2.t += (G2.dir * G2.speed * dt) / segLen;
    while (G2.t > 1 && G2.i < pts.length - 2) {
      G2.t -= 1;
      G2.i += 1;
    }
    while (G2.t < 0 && G2.i > 0) {
      G2.t += 1;
      G2.i -= 1;
    }
    A = pts[G2.i];
    B = pts[G2.i + 1];
    const railHeading = Math.atan2(u.x, u.z);
    const heading = railHeading + G2.off;
    pos.set(A.x + (B.x - A.x) * G2.t, A.y + (B.y - A.y) * G2.t, A.z + (B.z - A.z) * G2.t);
    vel.copy(u).multiplyScalar(G2.speed);
    euler.set(0, heading, Math.sin(G2.time * 7) * 0.04);
    quat.setFromEuler(euler);
    if (Math.random() < dt * 30) spray.emit(pos, tmp2.copy(vel).multiplyScalar(0.2), 1, 0.8, 0.5);

    const offEnd = G2.t > 1 || G2.t < 0;
    const popped = loading && !held('pop');
    if (held('pop')) {
      loading = true;
      load = Math.min(1, load + dt / 0.6);
    }
    if (offEnd || popped || G2.speed < 0.8) {
      const charge = popped ? load : 0;
      if (popped) vel.addScaledVector(UP, 2.4 + 2 * charge);
      finishGrind();
      takeoff(charge, heading, false);
    }
  }

  function finishGrind() {
    const G2 = grind;
    grind = null;
    const across = Math.abs(Math.sin(G2.off)) > 0.7;
    const kind = G2.gr.name === 'box' || G2.gr.name === 'battleship' ? (across ? 'Boardslide' : '50-50') : across ? 'Boardslide' : '50-50';
    if (G2.time > 0.25) {
      const pts = Math.round((across ? 500 : 300) * (0.6 + G2.time));
      score += pts;
      toast(`${G2.lead}${kind}`, `${G2.gr.name} · ${G2.time.toFixed(1)}s · +${pts.toLocaleString()}`);
    }
  }

  // --- Lifts.
  const liftHeading = (l) => Math.atan2(l.dir.x, l.dir.z);
  function findLift() {
    if (!lifts) return null;
    let best = null;
    let bd = LIFT_REACH;
    for (const l of lifts.lifts) {
      const b = l.data.bottom;
      const d = Math.hypot(b.x - pos.x, b.z - pos.z);
      if (d < bd) {
        bd = d;
        best = l;
      }
    }
    return best;
  }
  function chairS(l, i) {
    return (l.offset + i * l.spacing) % l.loop;
  }
  function boardLift(l) {
    // The chair that has most recently left the loading station.
    let bestI = 0;
    let bestS = Infinity;
    for (let i = 0; i < l.count; i++) {
      const s = chairS(l, i);
      if (s < l.up.length && s < bestS) {
        bestS = s;
        bestI = i;
      }
    }
    chair = { l, i: bestI, lastS: bestS };
    air = grind = null;
    vel.set(0, 0, 0);
    tracks.clear();
    trackBreak = true;
    toast(l.data.name, 'Enjoy the ride · E to skip to the top');
  }
  function skipLift() {
    if (chair) unload(chair.l);
  }
  function unload(l) {
    chair = null;
    // Off the top terminal, a few meters past it, pointed down the fall line.
    const top = l.data.top;
    const p = tmp.set(top.x, 0, top.z).addScaledVector(tmp2.set(l.dir.x, 0, l.dir.z).normalize(), 14);
    pos.set(p.x, surfaceAt(p.x, p.z), p.z);
    const e = 6;
    const gx = surfaceAt(pos.x + e, pos.z) - surfaceAt(pos.x - e, pos.z);
    const gz = surfaceAt(pos.x, pos.z + e) - surfaceAt(pos.x, pos.z - e);
    yaw = Math.hypot(gx, gz) > 0.01 ? Math.atan2(-gx, -gz) : liftHeading(l);
    vel.set(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(2.5);
    onGround = true;
    safe = { pos: pos.clone(), yaw };
    groundQuat(quat);
    toast('Top of ' + l.data.name, 'Drop in!');
  }
  function stepChair() {
    const { l, i } = chair;
    const s = chairS(l, i);
    if (s >= l.up.length - 6 || s < chair.lastS - 1) return unload(l);
    chair.lastS = s;
    l.up.at(s, pos);
    // Seat: below the cable by the hanger; feet hang lower still.
    pos.y -= HANGER - 0.42;
    euler.set(0, liftHeading(l), 0);
    quat.setFromEuler(euler);
  }

  function crash(why) {
    crashed = 2.2;
    onGround = true;
    air = grind = null;
    loading = false;
    load = 0;
    shake = 0.4;
    spray.emit(pos, tmp2.copy(vel).multiplyScalar(0.3), 30, 3, 2);
    toast('Crash', why);
  }

  function stepCrash(dt) {
    crashed -= dt;
    const sp = vel.length();
    vel.y = 0;
    vel.multiplyScalar(Math.max(0, 1 - dt * 2.5));
    pos.addScaledVector(vel, dt);
    pos.y = surfaceAt(pos.x, pos.z);
    q1.setFromAxisAngle(tmp.set(1, 0.3, 0.2).normalize(), sp * dt * 0.8);
    quat.multiply(q1);
    if (sp > 2 && Math.random() < dt * 30) spray.emit(pos, tmp2.set(0, 0, 0), 2, 2, 1);
    if (crashed <= 0) respawn();
  }

  // --- Frame.
  const look = new THREE.Vector3();
  const dirH = new THREE.Vector3();
  const centre = new THREE.Vector3();
  let poleT = 0;

  function update(dt) {
    if (!active) return;
    dt = Math.min(dt, 0.05);
    if (chair) stepChair();
    else {
      const h = dt / SUBSTEPS;
      for (let i = 0; i < SUBSTEPS; i++) {
        if (chair) break;
        if (crashed > 0) stepCrash(h);
        else if (grind) stepGrind(h);
        else if (onGround) stepGround(h);
        else stepAir(h);
      }
    }
    spray.update(dt);
    absorb *= Math.exp(-dt * 5);
    shake *= Math.exp(-dt * 6);

    // Ski tracks while on the snow.
    if (onGround && !grind && !chair && crashed <= 0) {
      f.set(Math.sin(yaw), 0, Math.cos(yaw));
      r.set(f.z, 0, -f.x);
      tracks.add(pos, f, r, pos.y, trackBreak);
      trackBreak = false;
    }

    // --- Pose the body.
    const speed = vel.length();
    const tuck = onGround && held('up') && speed > 5 ? 1 : 0;
    poleT = onGround && held('up') && speed < 5 ? poleT + dt * 3 : 0;
    model.pose({
      seated: chair ? 1 : 0,
      crouch: crashed > 0 ? 0.6 : grind ? 0.35 : onGround ? 0.22 + 0.5 * load + 0.6 * absorb : 0.35 + (air && air.t < 0.3 ? 0.2 : 0),
      tuck,
      grab: air?.grab && held('grab') ? 1 : 0,
      airArms: air && !held('grab') ? Math.min(1, air.t * 3) * 0.6 : grind ? 0.8 : 0,
      brake: onGround ? braking : 0,
      plant: Math.max(0, Math.sin(poleT * Math.PI)),
    });
    // Rotate about the centre of mass; on the snow the feet stay planted.
    const upNow = tmp.set(0, 1, 0).applyQuaternion(quat);
    centre.copy(pos).addScaledVector(chair ? UP : onGround || grind ? upNow : UP, COM);
    if (chair) centre.y -= COM - 0.02; // the seat holds the hips, not the feet
    pivot.position.copy(centre);
    pivot.quaternion.copy(quat);

    // --- Lift prompt.
    nearLift = onGround && !grind && !chair && crashed <= 0 && speed < 8 ? findLift() : null;
    if (chair) {
      promptEl.textContent = `Riding ${chair.l.data.name} · E: skip to the top`;
      promptEl.hidden = false;
    } else if (nearLift) {
      promptEl.textContent = `E: ride ${nearLift.data.name}`;
      promptEl.hidden = false;
    } else promptEl.hidden = true;

    // --- Camera.
    if (chair) {
      const d = tmp2.set(chair.l.dir.x, 0, chair.l.dir.z).normalize();
      const want = tmp.copy(pos).addScaledVector(d, -7).add(look.set(0, 3, 0));
      camPos.lerp(want, 1 - Math.exp(-dt * 3));
      camLook.lerp(look.copy(pos).addScaledVector(d, 25).add(tmp.set(0, 4, 0)), 1 - Math.exp(-dt * 3));
    } else {
      dirH.set(vel.x, 0, vel.z);
      if (dirH.lengthSq() < 0.5) dirH.set(Math.sin(yaw), 0, Math.cos(yaw));
      dirH.normalize();
      const back = 6.5 + Math.min(4, speed * 0.12);
      const want = tmp.copy(pos).addScaledVector(dirH, -back);
      want.y = Math.max(pos.y, surfaceAt(want.x, want.z)) + 2.6 + Math.min(2, speed * 0.04);
      camPos.lerp(want, 1 - Math.exp(-dt * (onGround ? 5 : 3)));
      const floor = surfaceAt(camPos.x, camPos.z) + 1.2;
      if (camPos.y < floor) camPos.y = floor;
      look.copy(pos).addScaledVector(dirH, 5).add(tmp.set(0, 1, 0));
      camLook.lerp(look, 1 - Math.exp(-dt * 8));
    }
    camera.position.copy(camPos);
    if (shake > 0.01) camera.position.add(tmp.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
    camera.lookAt(camLook);
    const fov = 58 + Math.min(14, speed * 0.35);
    if (Math.abs(camera.fov - fov) > 0.1) {
      camera.fov += (fov - camera.fov) * Math.min(1, dt * 3);
      camera.updateProjectionMatrix();
    }

    // --- HUD.
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) toastEl.classList.remove('show');
    }
    hud.querySelector('.ski-speed').textContent = `${Math.round(speed * 2.23694)} mph`;
    hud.querySelector('.ski-score').textContent = score.toLocaleString();
    hud.querySelector('.ski-load').style.width = `${Math.round(load * 100)}%`;
  }

  return {
    start,
    stop,
    update,
    respawn,
    boardLift,
    get active() {
      return active;
    },
    get position() {
      return pos;
    },
    get velocity() {
      return vel;
    },
    get quaternion() {
      return quat;
    },
    get state() {
      return { onGround, crashed, air, grind, chair, score, yaw, nearLift };
    },
  };
}
