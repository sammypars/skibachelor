// Ski mode: ride the mountain yourself.
//
//   A / D or ← / →   carve left / right · spin in the air
//   W or ↑           tuck (pole on the flats) · frontflip in the air
//   S or ↓           brake (skid) · backflip in the air
//   Space            hold to load, release to pop (kickers launch you too)
//   Shift            grab
//   R                back to your last good spot · Esc to stop skiing
//
// The physics is a point mass on the real snow surface (terrain plus the
// shaped park snow): gravity along the slope, snow friction, air drag (less
// in a tuck), and ski edges that grip sideways so the skis carve the
// velocity round instead of sliding. Leave a convex lip fast enough and you
// fly a ballistic arc; spins and flips are added on top and judged when you
// touch down: land with your skis pointing along your travel (forwards or
// switch) and your feet under you, or you crash.

import * as THREE from 'three';
import { Crowd, skierParts } from './render/people.js';

const G = 9.81;
const MASS = 80; // kg, rider and kit
const RHO = 1.0; // air density at 2,000 m
const CDA_STAND = 0.55; // drag area, m^2
const CDA_TUCK = 0.25;
const MU_SNOW = 0.045; // ski on groomed snow
const MU_BRAKE = 0.55; // skidding sideways
const GRIP = 9; // how fast edges kill sideways slip (1/s)
const CARVE_R = 14; // tightest carve radius at speed (m)
const COM = 0.9; // centre of mass above the feet (m)
const SPIN_RATE = 2 * Math.PI * 1.25; // rad/s at full spin
const FLIP_RATE = 2 * Math.PI * 1.15;
const SUBSTEPS = 4;

const UP = new THREE.Vector3(0, 1, 0);

export function createSki({ scene, camera, canvas, world, surfaceAt, treeNear, hud }) {
  const keys = new Set();
  const touch = new Set();
  const held = (...names) => names.some((n) => keys.has(n) || touch.has(n));

  // --- The rider.
  const crowd = new Crowd(skierParts(), 1);
  for (const m of crowd.meshes) {
    m.count = 1;
    m.frustumCulled = false;
    scene.add(m);
    m.visible = false;
  }
  const jacket = new THREE.Color(0xffc20e);
  const pants = new THREE.Color(0x131416);

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
  let air = null; // { spin, flip, grab, t, charge }
  let crashed = 0; // seconds left in a crash
  let active = false;
  let score = 0;
  let safe = { pos: new THREE.Vector3(), yaw: 0 };
  let safeTimer = 0;
  let lean = 0;
  let braking = 0;
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
    if (down && e.code === 'KeyR') respawn();
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

  // --- Start / stop.
  function start(at, heading) {
    active = true;
    for (const m of crowd.meshes) m.visible = true;
    pos.set(at.x, surfaceAt(at.x, at.z), at.z);
    yaw = heading;
    vel.set(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(2);
    onGround = true;
    air = null;
    crashed = 0;
    spinVel = flipVel = 0;
    score = 0;
    safe = { pos: pos.clone(), yaw };
    groundQuat(quat);
    // Camera starts behind.
    camPos.copy(pos).addScaledVector(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), -8).add(new THREE.Vector3(0, 3.5, 0));
    camLook.copy(pos);
    hud.hidden = false;
    toast('Drop in!', '');
  }
  function stop() {
    active = false;
    keys.clear();
    touch.clear();
    for (const m of crowd.meshes) m.visible = false;
    hud.hidden = true;
  }
  function respawn() {
    pos.copy(safe.pos);
    pos.y = surfaceAt(pos.x, pos.z);
    yaw = safe.yaw;
    vel.set(0, 0, 0);
    onGround = true;
    air = null;
    crashed = 0;
    spinVel = flipVel = 0;
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
    r.crossVectors(n, f).normalize(); // body +x
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
    const wantLean = Math.atan2(speed * speed * (steer * rate / Math.max(speed, 1)), G) * (onGround ? 1 : 0);
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
    // Stop dead rather than creep backwards on a gentle slope when braking.
    if (brake && vel.length() < 0.4 && Math.abs(vf) < 0.4) vel.multiplyScalar(0.5);

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
    // The snow pushes back: cancel any velocity into it.
    const n2 = normalAt(pos.x, pos.z, tmp);
    const vn = vel.dot(n2);
    if (vn < 0) vel.addScaledVector(n2, -vn);

    // Trees.
    const t = treeNear?.(pos.x, pos.z, 1.4);
    if (t && speed > 3) crash('Tree!');

    groundQuat(quat);
    safeTimer += dt;
    if (safeTimer > 1 && speed > 1 && !brake) {
      safeTimer = 0;
      safe = { pos: pos.clone(), yaw };
    }
  }

  function takeoff(charge) {
    onGround = false;
    loading = false;
    load = 0;
    // Air orientation as heading / pitch / roll (Y-X-Z): spins turn the
    // heading about the vertical, flips turn the pitch about the body's
    // sideways axis. Off the lip the body starts tipped with the ramp and
    // stands itself up.
    normalAt(pos.x, pos.z);
    f.set(Math.sin(yaw), 0, Math.cos(yaw));
    const rampPitch = Math.atan2(n.x * f.x + n.z * f.z, n.y); // < 0 on a kicker: tips up
    air = {
      spin: 0, flip: 0, grab: false, grabT: 0, t: 0, charge, y0: pos.y,
      heading: yaw, heading0: yaw, pitch: 0, tilt: rampPitch, roll: lean,
      spinTarget: null, flipTarget: null,
    };
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
    const settle = (angle, vel, unit, min) => {
      // Next whole unit in the direction of travel; back up if barely past one.
      const dir = Math.sign(vel) || Math.sign(angle) || 1;
      const k = angle / unit;
      const target = (dir > 0 ? Math.ceil(k - 0.12) : Math.floor(k + 0.12)) * unit;
      const left = target - angle;
      if (Math.abs(left) < 0.01) return { v: 0, angle: target };
      const speed = Math.max(Math.abs(vel), min);
      const step = Math.min(Math.abs(left), speed * dt);
      return { v: Math.sign(left) * speed, angle: angle + Math.sign(left) * step };
    };
    if (spinIn) {
      spinVel = ease(spinVel, spinIn * SPIN_RATE * boost, 7);
      air.spin += spinVel * dt;
    } else if (air.spin !== 0) {
      const r2 = settle(air.spin, spinVel, Math.PI, SPIN_RATE * 0.55);
      spinVel = r2.v;
      air.spin = r2.angle;
    }
    if (flipIn) {
      flipVel = ease(flipVel, flipIn * FLIP_RATE * boost, 6);
      air.flip += flipVel * dt;
    } else if (air.flip !== 0) {
      const r2 = settle(air.flip, flipVel, 2 * Math.PI, FLIP_RATE * 0.6);
      flipVel = r2.v;
      air.flip = r2.angle;
    }
    // The body stands up off the ramp and the takeoff lean fades.
    air.tilt *= Math.exp(-dt * 3);
    air.roll *= Math.exp(-dt * 4);
    air.pitch = air.flip;
    air.heading = air.heading0 + air.spin;
    airQuat();
    if (held('grab')) {
      air.grabT += dt;
      if (air.grabT > 0.25) air.grab = true;
    }

    // Touchdown: the feet (or whatever is lowest) reach the snow.
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
    const impact = -vel.dot(n); // how hard we hit the snow (m/s)
    // Feet under you: how far the flip is from a whole number of turns.
    const fl = ((air.flip % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const flipOff = Math.min(fl, 2 * Math.PI - fl);
    // Skis along the travel (forwards or switch).
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

    // Ride away: skis point where the body points (switch keeps going, the
    // velocity just runs backwards along the skis).
    yaw = air.heading;
    vel.copy(vt);
    // Sketchy landings scrub speed.
    const clean = off < 0.45 && flipOff < 0.45;
    if (!clean) vel.multiplyScalar(0.65);
    if (impact > 8) vel.multiplyScalar(0.85);
    onGround = true;
    lean = 0;
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

  function crash(why) {
    crashed = 2.2;
    onGround = true;
    air = null;
    loading = false;
    load = 0;
    toast('Crash', why);
  }

  function stepCrash(dt) {
    crashed -= dt;
    // Tumble to a stop along the snow.
    const sp = vel.length();
    vel.y = 0;
    vel.multiplyScalar(Math.max(0, 1 - dt * 2.5));
    pos.addScaledVector(vel, dt);
    pos.y = surfaceAt(pos.x, pos.z);
    q1.setFromAxisAngle(tmp.set(1, 0.3, 0.2).normalize(), sp * dt * 0.8);
    quat.multiply(q1);
    if (crashed <= 0) respawn();
  }

  // --- Frame.
  const mat = new THREE.Matrix4();
  const comOff = new THREE.Matrix4().makeTranslation(0, -COM, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const scl = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const look = new THREE.Vector3();
  const dirH = new THREE.Vector3();

  function update(dt) {
    if (!active) return;
    dt = Math.min(dt, 0.05);
    const h = dt / SUBSTEPS;
    for (let i = 0; i < SUBSTEPS; i++) {
      if (crashed > 0) stepCrash(h);
      else if (onGround) stepGround(h);
      else stepAir(h);
    }

    // Draw the rider, rotating about the centre of mass.
    const crouch = onGround ? 1 - 0.22 * load - 0.12 * (held('up') ? 1 : 0) : air?.grab && held('grab') ? 0.72 : 0.92;
    scl.set(1, crouch, 1);
    const upNow = tmp.set(0, 1, 0).applyQuaternion(quat);
    centre.copy(pos).addScaledVector(onGround ? upNow : UP, COM * crouch);
    mat.compose(centre, quat, scl).multiply(comOff);
    crowd.set(0, mat, jacket, pants);
    crowd.finish(1);

    // Chase camera: behind the direction of travel, above the rider.
    dirH.set(vel.x, 0, vel.z);
    if (dirH.lengthSq() < 0.5) dirH.set(Math.sin(yaw), 0, Math.cos(yaw));
    dirH.normalize();
    const speed = vel.length();
    const back = 6.5 + Math.min(4, speed * 0.12);
    const want = tmp.copy(pos).addScaledVector(dirH, -back);
    want.y = Math.max(pos.y, surfaceAt(want.x, want.z)) + 2.6 + Math.min(2, speed * 0.04);
    const k = 1 - Math.exp(-dt * (onGround ? 5 : 3));
    camPos.lerp(want, k);
    const floor = surfaceAt(camPos.x, camPos.z) + 1.2;
    if (camPos.y < floor) camPos.y = floor;
    look.copy(pos).addScaledVector(dirH, 5).add(tmp.set(0, 1, 0));
    camLook.lerp(look, 1 - Math.exp(-dt * 8));
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    const fov = 58 + Math.min(14, speed * 0.35);
    if (Math.abs(camera.fov - fov) > 0.1) {
      camera.fov += (fov - camera.fov) * Math.min(1, dt * 3);
      camera.updateProjectionMatrix();
    }

    // HUD.
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
      return { onGround, crashed, air, score, yaw };
    },
  };
}
