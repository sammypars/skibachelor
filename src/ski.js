// Ski mode: ride the mountain yourself.
//
//   A / D or ← / →   roll onto an edge and carve · spin in the air · turn on a rail
//   W or ↑           tuck (pole on the flats) · frontflip in the air
//   S or ↓           hockey stop · backflip in the air
//   Space            hold to load, release to pop. Hold a direction as you
//                    pop (or carve off the lip) to wind up a spin or flip.
//   Shift            grab in the air · on the snow, press the nose and A / D
//                    to butter
//   E                ride the lift when you're at the bottom of one
//   M                sound on / off · R back to your last good spot · Esc stop
//
// The physics, in the spirit of Cork7's skier:
//
// - On the snow you are a mass on the real surface (terrain plus the shaped
//   park snow). Gravity, base friction and air drag act along the travel.
//   Steering rolls the skis onto their edges over a fraction of a second;
//   an edged ski carves an arc set by its sidecut (radius = sidecut x cos
//   edge), so turns tighten as you edge harder and the yaw rate scales with
//   speed. Edges hold sideways only up to a friction limit (more edge, more
//   grip; more weight, more grip), so carve too tight for your speed and the
//   tails wash out into a skid. The body leans to balance whatever sideways
//   force the edges are actually making.
// - The snow pushes back harder in compressions and lighter over rolls (the
//   g-load), which changes grip and how deep the knees bend.
// - A hockey stop swings the skis across the travel and scrapes.
// - In the air you fly a ballistic arc. Rotation is angular momentum:
//   whatever yaw rate you carved off the lip, plus any wind-up from the pop,
//   carries into the air. Arms can add a little more; pulling in for a grab
//   spins you faster. Let go and you open up to spot the landing, slowing or
//   stretching the rotation to land on the next 180 if you have the air.
//   Touchdown is judged on the flip, whether the skis point along the travel
//   (forwards or switch), and how hard you hit.
// - Rails and boxes: gravity along the rail, low sliding friction, off the
//   end (or pop) back into the air.

import * as THREE from 'three';
import { createSkierModel } from './skier-model.js';
import { createSnowSpray, createSkiTracks } from './ski-fx.js';
import { createSkiAudio } from './ski-audio.js';
import { HANGER } from './render/lifts.js';
import { codeMap, getLook, onSettings } from './settings.js';

const G = 9.81;
const MASS = 80; // kg, rider and kit
const RHO = 1.0; // air density at 2,000 m
const CDA_STAND = 0.55; // drag area, m^2
const CDA_TUCK = 0.25;
const MU_SNOW = 0.045; // ski base on groomed snow
const MU_RAIL = 0.07; // ski base on steel / UHMW
const MU_LAT_HOLD = 0.75; // sideways grip with the skis held lightly on edge
const MU_LAT_EDGE = 1.35; // ... fully edged and pressured
const MU_SCRAPE = 0.72; // skis sideways in a hockey stop
const MU_BUTTER = 0.12; // flat base pivoting on the snow
const SIDECUT_R = 16; // ski sidecut radius (m)
const EDGE_MAX = 1.05; // ~60 degrees of edge
const EDGE_RATE = 3.2; // how fast the skis roll onto edge (1/s): tap for a gentle turn, hold to tighten
const PIVOT_RATE = 2.3; // steering the skis round at low speed (rad/s)
const BUTTER_RATE = 4.4;
const COM = 0.9; // centre of mass above the feet (m)
// Rotation in the air is angular momentum L = I * w, set at takeoff and
// conserved: the body can only change how fast it turns by changing shape
// (inertia I relative to standing). Tucked tight it turns faster, arms out
// slower.
const SPIN_POP = 4.6; // rad/s of spin a full wind-up throws (a flat pop gets you round about 270)
const FLIP_POP = 7.2; // rad/s of flip a full pop throws
const I_TUCK = 0.85; // knees up, arms in
const I_SPOT = 0.95; // spotting is mostly opening up: it can't add much
const I_GRAB = 0.85;
const I_OPEN = 1.6; // arms and legs spread
const ARM_TORQUE = 1.4; // rad/s^2: with no wind-up, arms can start a lazy turn
const ARM_MAX = 1.1;
const SUBSTEPS = 4;
const LIFT_REACH = 28; // how close to a bottom terminal to board (m)

const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const GRAB_NAMES = { mute: 'Mute', safety: 'Safety', japan: 'Japan', tail: 'Tail' };
const grabList = (grabs) => grabs.map((g) => GRAB_NAMES[g]).join(' to ');

export function createSki({ scene, camera, world, surfaceAt, treeNear, grindables = [], kickers = [], lifts, hud, envMap = null }) {
  const keys = new Set();
  const touch = new Set();
  const held = (...names) => names.some((n) => keys.has(n) || touch.has(n));

  // --- The rider, the spray, the tracks and the sound.
  let model = createSkierModel({ look: getLook(), envMap });
  const pivot = new THREE.Group(); // rotates about the centre of mass
  model.root.position.y = -COM;
  pivot.add(model.root);
  // A new look from the Rider panel: rebuild the rider in place.
  let lookKey = JSON.stringify(getLook());
  onSettings(() => {
    const k = JSON.stringify(getLook());
    if (k === lookKey) return;
    lookKey = k;
    const old = model;
    model = createSkierModel({ look: getLook(), envMap });
    model.root.position.y = -COM;
    pivot.remove(old.root);
    pivot.add(model.root);
    old.dispose();
    if (loose.length) model.setSkis(false);
  });
  let paused = false;
  pivot.visible = false;
  scene.add(pivot);
  const spray = createSnowSpray(scene);
  const tracks = createSkiTracks(scene);
  const audio = createSkiAudio();

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
  let yawRate = 0; // rad/s, carried into the air as spin
  let edge = 0; // signed edge angle (rad)
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
  let brakeSide = 1;
  let press = 0; // nose (+) or tail (-) press for butters
  let butterType = 'Nose';
  let butterFinish = 0; // radians left to swing round after a butter
  let butterSpin = 0;
  let slip = 0; // sideways skid speed (m/s)
  let nForce = G; // what the snow pushes back with, per kg (m/s^2)
  let gLoad = 1;
  let absorb = 0; // landing compression, springs back
  let airBlend = 0;
  let wobble = 0;
  let lastLanding = null; // the numbers behind the last touchdown, for debugging
  let landPivot = 0; // leftover spin skidding the skis round after a landing (rad/s)
  let check = 0; // sitting back after a heavy or under-rotated landing: hand drag, butt check
  let checkSide = 1;
  let landTilt = 0; // body pitch off the snow at touchdown (+ nose-heavy, - backseat), settling out
  let shake = 0;
  let trackBreak = true;
  let nearLift = null;
  let clock = 0;
  let lastEdgeSign = 0;
  const plant = { '-1': 0, 1: 0 };
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

  // Leaving a kicker: the shaped lip throws you at its built angle. (The
  // snow surface is sampled on a half-meter grid, which rounds a sharp lip
  // off by several degrees.) Keeps speed and heading; only raises the pitch.
  function offTheLip() {
    for (const k of kickers) {
      const dx = pos.x - k.lipPos.x;
      const dz = pos.z - k.lipPos.z;
      if (dx * dx + dz * dz > 9) continue;
      const along = dx * k.lipDir.x + dz * k.lipDir.z;
      const across = Math.abs(dx * k.lipDir.z - dz * k.lipDir.x);
      if (along < -1.2 || along > 1.2 || across > k.halfWidth + 0.3) continue;
      const vh = Math.hypot(vel.x, vel.z);
      if (vh < 2 || (vel.x * k.lipDir.x + vel.z * k.lipDir.z) / vh < 0.6) continue;
      const sp = vel.length();
      const pitch = Math.max(Math.asin(THREE.MathUtils.clamp(vel.y / sp, -1, 1)), k.lipAngle);
      const h = Math.cos(pitch) * sp;
      vel.set((vel.x / vh) * h, Math.sin(pitch) * sp, (vel.z / vh) * h);
      return;
    }
  }

  // Surface normal from the snow just traversed: along the travel from a
  // point 0.35 m back, across it from a centred difference.
  const tdir = new THREE.Vector3();
  const tside = new THREE.Vector3();
  function trailingNormal(x, z, h0, out) {
    tdir.set(vel.x, 0, vel.z);
    const l = tdir.length();
    if (l < 2) return normalAt(x, z, out);
    tdir.divideScalar(l);
    const b = 0.35;
    const hb = surfaceAt(x - tdir.x * b, z - tdir.z * b);
    tside.set(-tdir.z, 0, tdir.x);
    const e = 0.5;
    const hs = surfaceAt(x + tside.x * e, z + tside.z * e) - surfaceAt(x - tside.x * e, z - tside.z * e);
    // Tangents: along (b, h0 - hb), across (2e, hs); normal = across x along.
    const ax = tdir.x * b, ay = h0 - hb, az = tdir.z * b;
    const cx = tside.x * 2 * e, cy = hs, cz = tside.z * 2 * e;
    out.set(cy * az - cz * ay, cz * ax - cx * az, cx * ay - cy * ax).normalize();
    if (out.y < 0) out.negate();
    return out;
  }

  // --- Input.
  // Keys come from the player's bindings (remappable in the Rider panel).
  const HELD = new Set(['left', 'right', 'up', 'down', 'pop', 'grab']);
  let CODES = codeMap();
  onSettings(() => {
    CODES = codeMap();
    keys.clear();
  });
  function onKey(e, down) {
    if (!active || paused) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const k = CODES[e.code];
    if (!k) return;
    e.preventDefault();
    if (HELD.has(k)) {
      if (down) keys.add(k);
      else keys.delete(k);
    }
    if (!down || e.repeat) return;
    if (k === 'reset') respawn();
    if (k === 'sound') toast(audio.toggleMute() ? 'Sound off' : 'Sound on', '');
    if (k === 'lift') {
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
  // Speed check: approaching a kicker, how your speed compares with the
  // speed it was built for (what a coach at the side of the jump would call).
  let checkEl = hud.querySelector('.ski-speedcheck');
  if (!checkEl) {
    checkEl = document.createElement('div');
    checkEl.className = 'ski-speedcheck';
    hud.appendChild(checkEl);
  }
  let checkState = '';
  function kickerAhead() {
    const vh = Math.hypot(vel.x, vel.z);
    if (vh < 2) return null;
    for (const k of kickers) {
      const dx = k.lipPos.x - pos.x;
      const dz = k.lipPos.z - pos.z;
      const along = (dx * vel.x + dz * vel.z) / vh;
      if (along < 3 || along > 45) continue;
      const across = Math.abs(dx * vel.z - dz * vel.x) / vh;
      if (across > k.halfWidth + 1) continue;
      if ((vel.x * k.lipDir.x + vel.z * k.lipDir.z) / vh < 0.8) continue;
      return k;
    }
    return null;
  }
  let liveEl = hud.querySelector('.ski-live');
  if (!liveEl) {
    liveEl = document.createElement('div');
    liveEl.className = 'ski-live';
    hud.appendChild(liveEl);
  }

  // --- Start / stop.
  function reset() {
    onGround = true;
    air = grind = chair = null;
    crashed = 0;
    fall = null;
    clearLoose();
    spinVel = flipVel = 0;
    yawRate = edge = lean = 0;
    braking = press = butterSpin = butterFinish = slip = 0;
    nForce = G;
    gLoad = 1;
    wobble = airBlend = 0;
    landPivot = check = landTilt = 0;
    trackBreak = true;
  }
  function start(at, heading) {
    active = true;
    pivot.visible = true;
    pos.set(at.x, surfaceAt(at.x, at.z), at.z);
    yaw = heading;
    vel.set(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(2);
    reset();
    score = 0;
    safe = { pos: pos.clone(), yaw };
    tracks.clear();
    groundQuat(quat);
    camPos.copy(pos).addScaledVector(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), -7).add(new THREE.Vector3(0, 3, 0));
    camLook.copy(pos);
    hud.hidden = false;
    audio.resume();
    toast('Drop in!', '');
  }
  function stop() {
    active = false;
    keys.clear();
    touch.clear();
    pivot.visible = false;
    hud.hidden = true;
    chair = null;
    audio.suspend();
  }
  function respawn() {
    pos.copy(safe.pos);
    pos.y = surfaceAt(pos.x, pos.z);
    yaw = safe.yaw;
    vel.set(0, 0, 0);
    reset();
    groundQuat(quat);
  }


  // Ski axes on the snow: f along the skis, r across (toward +x at yaw 0).
  const f = new THREE.Vector3();
  const r = new THREE.Vector3();
  const m3 = new THREE.Matrix4();
  function basis() {
    f.set(Math.sin(yaw), 0, Math.cos(yaw));
    f.addScaledVector(n, -f.dot(n)).normalize();
    r.crossVectors(n, f).normalize();
  }
  // Body orientation when riding: skis along the heading, standing on the
  // snow, leaning to balance the edge force, nose pressed for a butter.
  const q1 = new THREE.Quaternion();
  function groundQuat(out) {
    normalAt(pos.x, pos.z);
    basis();
    const up = n.clone().applyAxisAngle(f, -lean);
    const rr = new THREE.Vector3().crossVectors(up, f).normalize();
    m3.makeBasis(rr, up, f);
    out.setFromRotationMatrix(m3);
    if (press > 0.01) out.multiply(q1.setFromAxisAngle(X_AXIS, press * 0.24));
    return out;
  }
  // Heading of the travel, flipped when riding switch so it lines up with
  // the skis either way.
  function travelHeading(sw) {
    return Math.atan2(vel.x, vel.z) + (sw ? Math.PI : 0);
  }

  // --- Tricks.
  let toastTimer = 0;
  const toastEl = hud.querySelector('.ski-toast');
  function toast(title, sub) {
    toastEl.innerHTML = `<b>${title}</b>${sub ? `<span>${sub}</span>` : ''}`;
    toastEl.classList.add('show');
    toastTimer = 2.2;
  }
  function trickName(spin, flip, grabs, opts = {}) {
    const deg = Math.round(Math.abs(spin) / Math.PI) * 180;
    const flips = Math.round(Math.abs(flip) / (2 * Math.PI));
    const back = flip < 0;
    const mult = flips > 2 ? 'Triple ' : flips > 1 ? 'Double ' : '';
    const parts = [];
    if (opts.butter && deg >= 180) parts.push(`${opts.butter} butter`);
    if (opts.switchTakeoff && (deg || flips)) parts.push('Switch');
    if (flips && deg >= 180) parts.push(`${mult}${back ? 'Cork' : 'Misty'} ${deg}`);
    else if (flips) parts.push(`${mult}${back ? 'Backflip' : 'Frontflip'}`);
    else if (deg >= 180) parts.push(`${deg}`);
    if (grabs.length) parts.push(parts.length || grabs.length > 1 ? grabList(grabs) : `${grabList(grabs)} Grab`);
    return parts.join(' ') || null;
  }
  function trickPoints(spin, flip, grabs, switchTakeoff) {
    const turns = Math.round(Math.abs(spin) / Math.PI) / 2;
    const flips = Math.round(Math.abs(flip) / (2 * Math.PI));
    let p = Math.round(2000 * Math.pow(turns, 2)) + flips * 3000;
    if (grabs.length) p = Math.round((p * 1.25 + 250 * grabs.length) * (1 + 0.3 * (grabs.length - 1)));
    if (switchTakeoff) p = Math.round(p * 1.3);
    return p;
  }

  // --- Physics.
  const g = new THREE.Vector3(0, -G, 0);
  const a = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const n2 = new THREE.Vector3();

  function stepGround(dt) {
    normalAt(pos.x, pos.z);
    basis();

    const speed = vel.length();
    const steer = (held('left') ? 1 : 0) - (held('right') ? 1 : 0);
    // Butter: Shift presses the nose (with S, the tail) and A / D pivot the
    // skis round on it. Quicker when you're moving; let go and the skis
    // swing on round to the nearest 180.
    const butter = held('grab') && speed < 20 && !loading;
    if (butter) butterType = held('down') ? 'Tail' : 'Nose';
    const brake = held('down') && !loading && !butter && speed > 0.6;
    const tuck = held('up') && !butter;
    braking += ((brake ? 1 : 0) - braking) * Math.min(1, dt * 6);
    press += ((butter ? (butterType === 'Tail' ? -1 : 1) : 0) - press) * Math.min(1, dt * 8);
    const sw = vel.dot(f) < -0.3; // riding switch

    // Roll onto the edges (or flatten them for a butter).
    const edgeMax = tuck ? 0.6 : EDGE_MAX;
    const wantEdge = butter ? 0 : brake ? brakeSide * 0.6 : steer * edgeMax;
    edge += (wantEdge - edge) * Math.min(1, dt * EDGE_RATE);
    // A new turn: plant the inside pole.
    const es = Math.abs(edge) > 0.25 ? Math.sign(edge) : 0;
    if (es && es !== lastEdgeSign && speed > 4 && !tuck) plant[es] = 1;
    if (es) lastEdgeSign = es;

    // Yaw: carve, pivot, butter or swing into a hockey stop.
    let w;
    if (butter) {
      butterFinish = 0;
      w = steer * BUTTER_RATE * (0.55 + 0.45 * smooth(0.5, 6, speed));
      butterSpin += w * dt;
    } else if (butterFinish) {
      const step = Math.sign(butterFinish) * BUTTER_RATE * 0.8 * dt;
      if (Math.abs(step) >= Math.abs(butterFinish)) {
        w = butterFinish / dt;
        butterFinish = 0;
      } else {
        w = step / dt;
        butterFinish -= step;
      }
    } else if (brake) {
      if (braking < 0.2 && steer) brakeSide = steer;
      const target = travelHeading(sw) + brakeSide * 1.3;
      w = THREE.MathUtils.clamp(wrap(target - yaw) * 7, -5, 5);
    } else {
      const ae = Math.abs(edge);
      // The sidecut sets the arc; a skier balances against what the edges
      // can hold, so at speed the arc opens up (just past the limit, so
      // the tails skid and spray a little on the hardest turns).
      const muMax = MU_LAT_HOLD + (MU_LAT_EDGE - MU_LAT_HOLD) * smooth(0.05, 0.6, ae);
      const R = Math.max(SIDECUT_R * Math.cos(ae), (speed * speed) / (muMax * Math.max(1, nForce)) * 0.88);
      const carve = (Math.abs(vel.dot(f)) / R) * Math.sign(edge) * smooth(0.04, 0.4, ae);
      // (Holding a direction while loading a pop winds up the spin; it
      // doesn't pivot the skis.)
      const pivotW = loading ? 0 : steer * PIVOT_RATE * (1 - smooth(3, 12, speed));
      w = Math.abs(pivotW) > Math.abs(carve) ? pivotW : carve;
      // Skis can't swing far past the travel unless pivoting slowly.
      if (speed > 3) {
        const slipAng = wrap(travelHeading(sw) - yaw);
        if (Math.abs(slipAng) > 0.55 && Math.sign(w) === -Math.sign(slipAng)) w *= 0.15;
      }
    }
    if (!butter && Math.abs(butterSpin) > 0.2) endButter();
    // Spin left over from the air keeps the skis turning until the edges
    // bite and stop it, scrubbing speed and throwing snow.
    if (Math.abs(landPivot) > 0.05) {
      w += landPivot;
      landPivot *= Math.exp(-dt * 5.5);
      vel.multiplyScalar(1 - Math.min(0.5, Math.abs(landPivot) * 0.03) * dt * 4);
      if (speed > 2 && Math.random() < dt * 40) spray.emit(pos, tmp2.copy(r).multiplyScalar(-Math.sign(landPivot) * 3).addScaledVector(vel, 0.3), 3, 1.2, 1.2);
    } else landPivot = 0;
    yaw += w * dt;
    yawRate += (w - yawRate) * Math.min(1, dt * 20);
    basis();

    // Forces along the travel: gravity, base friction (as hard as the snow
    // is pushing back: gravity's share plus the terrain's curvature), drag,
    // poling.
    const N = Math.max(0.5, nForce);
    a.copy(g);
    if (speed > 0.05) a.addScaledVector(vel, (-MU_SNOW * N) / speed);
    const cda = tuck ? CDA_TUCK : CDA_STAND;
    a.addScaledVector(vel, (-0.5 * RHO * cda * speed) / MASS);
    if (tuck && speed < 5) a.addScaledVector(f, 1.6);
    vel.addScaledVector(a, dt);

    // Sideways: the edges push back up to their grip limit. Anything beyond
    // that is a skid.
    const vl = vel.dot(r);
    const muLat = butter
      ? MU_BUTTER
      : brake
        ? MU_SCRAPE
        : MU_LAT_HOLD + (MU_LAT_EDGE - MU_LAT_HOLD) * smooth(0.05, 0.6, Math.abs(edge));
    const maxDv = muLat * N * dt;
    const dv = -Math.sign(vl) * Math.min(Math.abs(vl), maxDv);
    vel.addScaledVector(r, dv);
    slip = Math.abs(vl) - Math.abs(dv) + (brake && speed > 2 ? 1.5 : 0);
    if (brake && vel.length() < 0.4) vel.multiplyScalar(0.5);
    // Lean to balance the sideways force the edges make.
    const aLat = dv / dt;
    const wantLean = butter ? 0 : THREE.MathUtils.clamp(Math.atan2(aLat, N), -1.15, 1.15);
    lean += (wantLean - lean) * Math.min(1, dt * 10);

    // Snow spray: skids throw a sheet of it to the outside, hard carves a fan.
    if (speed > 3 && Math.random() < dt * 60) {
      const amount = Math.min(7, slip * 1.4) + Math.max(0, Math.abs(aLat) - 6) * 0.25 * (speed > 9 ? 1 : 0);
      if (amount > 0.4) {
        const out = -Math.sign(aLat || vl || 1);
        spray.emit(pos, tmp2.copy(r).multiplyScalar(out * (2 + speed * 0.22)).addScaledVector(vel, 0.35), Math.round(amount), 1.2, 1.2);
      }
    }

    // Pop: release Space to jump off the snow.
    if (loading && !held('pop')) {
      const charge = load;
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
      offTheLip();
      takeoff(load);
      return;
    }
    pos.set(tmp.x, s, tmp.z);
    // The slope just behind the skis (the snow they're actually on), so a
    // kicker sends you off at its real lip angle rather than one averaged
    // with the drop past the lip.
    trailingNormal(pos.x, pos.z, s, n2);
    const vn = vel.dot(n2);
    // The snow stops us sinking in: that is the normal force (more in a
    // compression, less over a roll).
    const push = vn < 0 ? -vn / dt : 0;
    nForce += (Math.min(50, push) - nForce) * Math.min(1, dt * 12);
    if (vn < 0) vel.addScaledVector(n2, -vn);
    gLoad = N / G;

    // Trees.
    if (speed > 3 && treeNear?.(pos.x, pos.z, 1.4)) crash('Tree!');

    groundQuat(quat);
    safeTimer += dt;
    if (safeTimer > 1 && speed > 1 && !brake) {
      safeTimer = 0;
      safe = { pos: pos.clone(), yaw };
    }
  }

  function endButter(popped = false) {
    // Swing on round to the nearest 180 (if it's close) so you ride away
    // forwards or switch.
    const k = butterSpin / Math.PI;
    const ahead = (Math.sign(butterSpin) > 0 ? Math.ceil(k) : Math.floor(k)) * Math.PI;
    const rest = ahead - butterSpin;
    if (!popped && Math.abs(rest) < 0.9) butterFinish = rest;
    const deg = Math.round(Math.abs(popped ? butterSpin : ahead) / Math.PI) * 180;
    if (deg >= 180 && !popped) {
      const pts = Math.round(deg * 2.2);
      score += pts;
      toast(`${butterType} butter ${deg}`, `+${pts.toLocaleString()}`);
    }
    butterSpin = 0;
  }

  // Time until the current arc meets the snow (s).
  function timeToLand() {
    let px = pos.x;
    let py = pos.y;
    let pz = pos.z;
    let vy = vel.y;
    const h = 0.04;
    for (let t = h; t < 6; t += h) {
      px += vel.x * h;
      pz += vel.z * h;
      vy -= G * h;
      py += vy * h;
      if (py <= surfaceAt(px, pz)) return t;
    }
    return 6;
  }

  function takeoff(charge, heading = yaw, tiltFromSnow = true) {
    const switchTakeoff = onGround && vel.dot(f) < -0.3;
    onGround = false;
    loading = false;
    load = 0;
    trackBreak = true;
    const wasButter = Math.abs(butterSpin) > 0.6 ? butterType : null;
    if (Math.abs(butterSpin) > 0.2) endButter(true);
    // Air orientation as heading / pitch / roll (Y-X-Z): spins turn the
    // heading about the vertical, flips turn the pitch about the body's
    // sideways axis. Off the lip the body starts tipped with the ramp and
    // stands itself up.
    let rampPitch = 0;
    if (tiltFromSnow) {
      normalAt(pos.x, pos.z);
      tmp.set(Math.sin(heading), 0, Math.cos(heading));
      rampPitch = Math.atan2(n.x * tmp.x + n.z * tmp.z, n.y); // < 0 on a kicker: tips up
    }
    // Wind-up: the yaw rate carved off the lip carries on as spin; a
    // direction held on the pop throws more.
    const steer = (held('left') ? 1 : 0) - (held('right') ? 1 : 0);
    const flipIn = (held('up') ? 1 : 0) - (held('down') ? 1 : 0);
    // A quick tap barely turns you; a full wind-up throws SPIN_POP.
    const power = 0.25 + 0.75 * charge;
    const Ls = THREE.MathUtils.clamp(yawRate * 0.5 + steer * SPIN_POP * power, -SPIN_POP * 1.15, SPIN_POP * 1.15);
    const Lf = flipIn * FLIP_POP * (0.45 + 0.55 * charge);
    air = {
      spin: 0, flip: 0, grab: null, grabs: [], pending: null, pendT: 0, grabT: 0, t: 0, charge, heading, heading0: heading, pitch: 0,
      tilt: rampPitch, roll: lean, Ls, Lf, Is: 1, If: 1, tl: timeToLand(), tlAge: 0, switchTakeoff,
      butter: wasButter,
    };
    spinVel = Ls;
    flipVel = Lf;
    lean = 0;
    edge = 0;
    press = 0;
    airQuat();
  }
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  function airQuat() {
    euler.set(air.pitch + air.tilt, air.heading, air.roll);
    quat.setFromEuler(euler);
  }

  // Rotate one axis in the air. L is fixed from takeoff; the body only
  // changes shape. Holding the way you're turning tucks you up (faster),
  // holding against it opens you out (slower). Let go and you spot the
  // landing: the shape that finishes on a whole `unit` at touchdown, if one
  // is within reach. With no wind-up at all the arms can start a lazy turn.
  function rotate(L, I, angle, input, unit, grabbing, dt) {
    let want = 1;
    if (input && Math.abs(L) < ARM_MAX && (Math.sign(input) === Math.sign(L) || Math.abs(L) < 0.2)) {
      L = THREE.MathUtils.clamp(L + input * ARM_TORQUE * dt, -ARM_MAX, ARM_MAX);
    } else if (input) {
      want = Math.sign(input) === Math.sign(L) ? I_TUCK : I_OPEN;
    } else if (Math.abs(L) > 0.05) {
      const tl = Math.max(0.05, air.tl);
      const dir = Math.sign(L);
      // Of the whole turns still ahead, aim for one this body can actually
      // stretch or shrink to; otherwise the closest miss.
      let best = Infinity;
      let bestCost = Infinity;
      const base = dir > 0 ? Math.ceil(angle / unit - 0.03) : Math.floor(angle / unit + 0.03);
      for (let k = 0; k < 5; k++) {
        const rem = (base + dir * k) * unit - angle;
        if (rem * dir < 0.02) continue;
        const Ineed = Math.abs(L) / (Math.abs(rem) / tl);
        const miss = Ineed < I_SPOT ? I_SPOT / Ineed : Ineed > I_OPEN ? Ineed / I_OPEN : 1;
        const cost = (miss - 1) * 10 + Math.abs(Math.log(Ineed));
        if (cost < bestCost) {
          bestCost = cost;
          best = Ineed;
        }
      }
      if (Number.isFinite(best)) want = THREE.MathUtils.clamp(best, I_SPOT, I_OPEN);
      // A small turn that can't make the next 180: fight it with the arms
      // and land as straight as you can.
      if (bestCost > 0.5 && Math.abs(L) < 3.4) {
        L -= Math.sign(L) * Math.min(Math.abs(L), ARM_TORQUE * 3.2 * dt);
        want = I_OPEN;
      }
    }
    if (grabbing) want = Math.min(want, I_GRAB);
    I += (want - I) * Math.min(1, dt * 5);
    return { L, I, angle: angle + (L / I) * dt };
  }

  function stepAir(dt) {
    air.t += dt;
    const speed = vel.length();
    vel.y -= G * dt;
    vel.addScaledVector(vel, (-0.5 * RHO * CDA_STAND * speed * dt) / MASS);
    pos.addScaledVector(vel, dt);
    air.tlAge += dt;
    air.tl -= dt;
    if (air.tlAge > 0.06) {
      air.tl = timeToLand();
      air.tlAge = 0;
    }

    const spinIn = (held('left') ? 1 : 0) - (held('right') ? 1 : 0);
    const dirIn = (held('up') ? 1 : 0) - (held('down') ? 1 : 0);
    const grabbing = !!air.grab && held('grab');
    // While grabbing, up / down pick the grab instead of shaping the flip.
    const flipIn = held('grab') ? 0 : dirIn;
    const s = rotate(air.Ls, air.Is, air.spin, spinIn, Math.PI, grabbing, dt);
    air.Ls = s.L;
    air.Is = s.I;
    air.spin = s.angle;
    spinVel = s.L / s.I;
    const fl = rotate(air.Lf, air.If, air.flip, flipIn, 2 * Math.PI, grabbing, dt);
    air.Lf = fl.L;
    air.If = fl.I;
    air.flip = fl.angle;
    flipVel = fl.L / fl.I;
    air.tilt *= Math.exp(-dt * 3);
    air.roll *= Math.exp(-dt * 4);
    air.pitch = air.flip;
    air.heading = air.heading0 + air.spin;
    airQuat();
    // Grabs: Shift alone is a mute, with W a japan, with S a tail, with A / D
    // a safety. Change the direction (or let go and grab again) to link
    // grabs in one air: "Mute to Tail".
    if (held('grab')) {
      air.grabT += dt;
      const want = dirIn > 0 ? 'japan' : dirIn < 0 ? 'tail' : spinIn ? 'safety' : 'mute';
      if (want !== air.pending) {
        air.pending = want;
        air.pendT = 0;
      }
      air.pendT += dt;
      if (air.pendT > 0.16 && (air.grab !== want || !air.holding)) {
        air.grab = want;
        air.holding = true;
        if (air.grabs[air.grabs.length - 1] !== want) air.grabs.push(want);
      }
    } else {
      air.pending = null;
      air.holding = false;
      if (air.grabT > 0) air.grabT = Math.max(0, air.grabT - dt * 2);
    }

    // Onto a rail or box?
    if (vel.y < 1.5 && tryGrind()) return;

    // Touchdown.
    const sf = surfaceAt(pos.x, pos.z);
    if (pos.y <= sf) {
      pos.y = sf;
      land();
    }
  }

  // Where on a jump you came down: on the table short of the knuckle
  // (cased), on the knuckle itself, or on the sweet spot of the landing.
  function landingZone() {
    for (const k of kickers) {
      const dx = pos.x - k.lipPos.x;
      const dz = pos.z - k.lipPos.z;
      const along = dx * k.lipDir.x + dz * k.lipDir.z;
      const across = Math.abs(dx * k.lipDir.z - dz * k.lipDir.x);
      const knuckle = k.prof.knuckle - k.prof.lip.x;
      const end = k.prof.length - k.prof.lip.x;
      if (across > k.halfWidth + 1 || along < -0.5 || along > end + 30) continue;
      if (along > end) return 'flat'; // overshot the landing onto the run-out
      if (along < knuckle - 1.2) return 'cased';
      if (along < knuckle + 1.2) return 'knuckle';
      const sweet = k.prof.sweet - k.prof.lip.x;
      if (Math.abs(along - sweet) < Math.max(2.5, 0.25 * (end - knuckle))) return 'sweet';
      return 'landing';
    }
    return null;
  }

  function land() {
    normalAt(pos.x, pos.z);
    const vt = vel.clone().addScaledVector(n, -vel.dot(n));
    const sp = vt.length();
    const impact = -vel.dot(n);
    // Pitch error at touchdown, signed: + tips down (over-rotated forward),
    // - leaning back (short of a backflip, or sitting back).
    const fe = Math.atan2(Math.sin(air.flip), Math.cos(air.flip)) + air.tilt;
    const flipOff = Math.abs(fe);
    const fwd = new THREE.Vector3(Math.sin(air.heading), 0, Math.cos(air.heading));
    let off = 0;
    if (sp > 1) off = Math.acos(Math.min(1, Math.abs(fwd.dot(tmp.copy(vt).setY(0).normalize()))));
    const switchLand = fwd.dot(vt) < 0;
    const residual = spinVel; // spin still going at touchdown (rad/s)
    audio.thump(impact / 10);

    // Tiny hops over rollers: just keep riding.
    if (air.t < 0.25 && flipOff < 0.5) {
      vel.copy(vt);
      onGround = true;
      yaw = air.heading;
      air = null;
      spinVel = flipVel = 0;
      yawRate = 0;
      return;
    }
    const zone = landingZone();
    lastLanding = { impact: +impact.toFixed(2), zone, fe: +fe.toFixed(2), off: +off.toFixed(2), residual: +residual.toFixed(2), airtime: +air.t.toFixed(2) };
    if (flipOff > 0.9) return crash(flipOff > 2 ? 'Head first!' : fe < 0 ? 'Under-rotated!' : 'Over-rotated!');
    if (off > 1.05 && sp > 4) return crash('Sideways!');
    if (Math.abs(residual) > 6 && off > 0.45) return crash('Over-rotated!');
    if (impact > 14 || (zone === 'cased' && impact > 11)) return crash(zone === 'cased' ? 'Cased it!' : 'Flat landing!');

    // The skis meet the snow where they point; the travel carries on and
    // the edges bring the two back together (a skid if they're far apart).
    yaw = air.heading;
    vel.copy(vt);
    // Spin you didn't stop before touchdown carries on as a skid.
    landPivot = Math.abs(residual) > 0.8 ? THREE.MathUtils.clamp(residual * 0.45, -2.6, 2.6) : 0;
    const hard = zone === 'cased' || zone === 'knuckle' ? impact * 1.25 : zone === 'flat' ? impact * 1.15 : impact;
    const clean = off < 0.42 && flipOff < 0.4 && hard < 11 && Math.abs(residual) < 2.4;
    const stomped = clean && off < 0.2 && flipOff < 0.2 && hard < 7 && Math.abs(residual) < 1.2 && (zone === 'sweet' || zone === 'landing' || !zone);
    // Sitting back: a heavy hit or landing short of the flip puts the hips
    // behind the feet; a hand drags the snow (or the seat of the pants).
    const sitBack = hard > 9.5 || fe < -0.32;
    if (sitBack) {
      check = Math.min(1, 0.55 + Math.max(0, hard - 9.5) * 0.12 + Math.max(0, -fe - 0.32) * 1.2);
      checkSide = residual ? -Math.sign(residual) : Math.random() < 0.5 ? -1 : 1;
      vel.multiplyScalar(check > 0.85 ? 0.6 : 0.8);
    }
    landTilt = THREE.MathUtils.clamp(fe, -0.8, 0.8);
    if (!clean) {
      vel.multiplyScalar(0.8);
      wobble = Math.min(1, 0.5 + flipOff + off * 0.6);
    }
    if (zone === 'cased') vel.multiplyScalar(0.75);
    if (impact > 8) vel.multiplyScalar(0.9);
    onGround = true;
    lean = 0;
    edge = 0;
    yawRate = landPivot;
    // Knees soak it up; a puff of snow; the camera feels it.
    absorb = Math.min(1, hard / 8);
    shake = Math.min(0.4, hard * 0.028);
    spray.emit(pos, tmp2.copy(vt).multiplyScalar(0.4), Math.round(8 + hard * 3), 3, 1.6);
    const name = trickName(air.spin, air.flip, air.grabs, { switchTakeoff: air.switchTakeoff, butter: air.butter });
    const airtime = air.t;
    const missed = { cased: 'Cased', flat: 'Overshot', knuckle: 'Knuckled' }[zone];
    let how = 'Sketchy';
    if (stomped) how = 'Stomped';
    else if (clean) how = switchLand ? 'Clean · rides out switch' : 'Clean';
    else if (check > 0.85) how = 'Butt check';
    else if (check > 0) how = 'Hand drag';
    else if (missed) how = missed;
    else if (Math.abs(residual) >= 2.4) how = 'Over-rotated';
    const mult = stomped ? 1.25 : clean ? 1 : check > 0.85 ? 0.35 : 0.5;
    if (name) {
      let pts = trickPoints(air.spin, air.flip, air.grabs, air.switchTakeoff);
      pts = Math.round(pts * mult) + (stomped ? 1000 : clean ? 600 : 0);
      score += pts;
      toast(name, `${how} · +${pts.toLocaleString()} · ${airtime.toFixed(1)}s air`);
    } else if (airtime > 0.7) {
      const pts = Math.round(airtime * 150 * mult) + (stomped ? 300 : 0);
      score += pts;
      toast(stomped ? 'Stomped' : clean ? 'Straight air' : how, `+${pts} · ${airtime.toFixed(1)}s air`);
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
      const deg = Math.round(Math.abs(air.spin) / (Math.PI / 2)) * 90;
      if (deg >= 180) lead = `${deg} on · `;
    }
    if (Math.abs(butterSpin) > 0.2) endButter();
    grind = { gr, i, t, dir, speed, off: quarter, time: 0, lead, wobble: 0 };
    air = null;
    onGround = false;
    spinVel = flipVel = 0;
    yawRate = 0;
    pos.set(A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t, A.z + (B.z - A.z) * t);
    spray.emit(pos, tmp2.set(0, 0, 0), 6, 1.5, 0.8);
    audio.clank();
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
      yaw = heading;
      takeoff(charge, heading, false);
    }
  }

  function finishGrind() {
    const G2 = grind;
    grind = null;
    const across = Math.abs(Math.sin(G2.off)) > 0.7;
    const kind = across ? 'Boardslide' : '50-50';
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
    reset();
    chair = { l, i: bestI, lastS: bestS };
    vel.set(0, 0, 0);
    tracks.clear();
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

  // --- Crashes. The body falls flat, slides on the snow (gravity down the
  // fall line against a heavy body-on-snow friction), tumbles while it's
  // fast, and settles on its back. A big one ejects the skis, which bounce
  // and slide off on their own ("yard sale").
  const MU_BODY = 0.62;
  let fall = null;
  const loose = [];
  const qFall = new THREE.Quaternion();
  const qRoll = new THREE.Quaternion();
  const fx = new THREE.Vector3();
  const fy = new THREE.Vector3();
  const fz = new THREE.Vector3();
  const nFall = new THREE.Vector3();

  function crash(why) {
    const sp = vel.length();
    normalAt(pos.x, pos.z);
    vel.addScaledVector(n, -Math.min(0, vel.dot(n))); // the snow stops the fall into it
    const d = new THREE.Vector3(vel.x, 0, vel.z);
    if (d.lengthSq() < 0.25) d.set(Math.sin(yaw), 0, Math.cos(yaw));
    d.normalize();
    fall = {
      t: 0,
      still: 0,
      dir: d,
      roll: 0,
      rollVel: sp > 6 ? (Math.random() < 0.5 ? -1 : 1) * Math.min(14, sp / 0.3) : 0,
      spin: THREE.MathUtils.clamp(spinVel * 0.5 + (Math.random() - 0.5) * 2, -4, 4),
      q0: quat.clone(),
    };
    crashed = 1;
    onGround = true;
    air = grind = null;
    loading = false;
    load = 0;
    shake = 0.45;
    wobble = 0;
    spray.emit(pos, tmp2.copy(vel).multiplyScalar(0.3), 34, 3, 2);
    audio.thump(1);
    if (sp > 9 || /Head|Flat/.test(why)) {
      ejectSkis();
      toast('Yard sale!', why);
    } else toast('Crash', why);
  }

  function stepCrash(dt) {
    fall.t += dt;
    normalAt(pos.x, pos.z);
    // Stay on the snow: drop any motion into or off it.
    vel.addScaledVector(n, -vel.dot(n));
    // Gravity along the slope.
    vel.addScaledVector(tmp.set(0, -G, 0).addScaledVector(n, G * n.y), dt);
    // Body-on-snow friction and a little air drag.
    const sp = vel.length();
    const dec = (MU_BODY * G * n.y + 0.015 * sp * sp) * dt;
    if (sp > dec) vel.multiplyScalar(1 - dec / sp);
    else vel.set(0, 0, 0);
    pos.addScaledVector(vel, dt);
    pos.y = surfaceAt(pos.x, pos.z);
    // Tumbling slows with the body; then it rolls onto its back.
    fall.rollVel *= Math.exp(-dt * 1.1);
    if (Math.abs(fall.rollVel) > sp / 0.25) fall.rollVel = Math.sign(fall.rollVel) * (sp / 0.25);
    if (Math.abs(fall.rollVel) > 2.5) fall.roll += fall.rollVel * dt;
    else {
      const rest = Math.round(fall.roll / (2 * Math.PI)) * 2 * Math.PI;
      fall.roll += (rest - fall.roll) * Math.min(1, dt * 3);
    }
    // The body slews round on the snow.
    fall.spin *= Math.exp(-dt * 1.4);
    fall.dir.applyAxisAngle(UP, fall.spin * dt);
    if (sp > 2 && Math.random() < dt * 30) spray.emit(pos, tmp2.copy(vel).multiplyScalar(0.2), 2, 2, 1);
    fall.still = sp < 0.4 ? fall.still + dt : 0;
    if (fall.t >= GET_UP) getUp();
  }

  // Three seconds after a crash the rider gets back up right where they
  // came to rest, skis back on, pointed the way they were sliding.
  const GET_UP = 3;
  function getUp() {
    pos.y = surfaceAt(pos.x, pos.z);
    const sp = Math.hypot(vel.x, vel.z);
    yaw = sp > 0.5 ? Math.atan2(vel.x, vel.z) : Math.atan2(fall.dir.x, fall.dir.z);
    vel.multiplyScalar(0.3);
    reset();
    groundQuat(quat);
  }

  // Orientation lying in the snow: feet first down the slide, on the back,
  // turned by the roll about the body's long axis; blended in over the fall.
  function fallPose() {
    normalAt(pos.x, pos.z, nFall);
    fy.copy(fall.dir).addScaledVector(nFall, -fall.dir.dot(nFall)).normalize().negate(); // head trails
    fz.copy(nFall); // chest to the sky
    fx.crossVectors(fy, fz).normalize();
    qFall.setFromRotationMatrix(m3.makeBasis(fx, fy, fz));
    qFall.multiply(qRoll.setFromAxisAngle(UP, fall.roll));
    const k = THREE.MathUtils.smoothstep(fall.t, 0, 0.45);
    quat.slerpQuaternions(fall.q0, qFall, k);
    return k;
  }

  function ejectSkis() {
    model.setSkis(true);
    pivot.updateMatrixWorld(true);
    for (const L of model.rig.legs) {
      const m = L.ski.clone();
      L.ski.matrixWorld.decompose(m.position, m.quaternion, m.scale);
      scene.add(m);
      const v = vel.clone().multiplyScalar(0.5 + Math.random() * 0.4);
      v.x += (Math.random() - 0.5) * 4;
      v.z += (Math.random() - 0.5) * 4;
      v.y += 2 + Math.random() * 3;
      const w = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(22);
      loose.push({ m, v, w, ground: false });
    }
    model.setSkis(false);
  }

  const nSki = new THREE.Vector3();
  const qFlat = new THREE.Quaternion();
  function stepLoose(dt) {
    for (const s of loose) {
      const { m, v, w } = s;
      v.y -= G * dt;
      m.position.addScaledVector(v, dt);
      const wl = w.length();
      if (wl > 0.01) m.quaternion.premultiply(q1.setFromAxisAngle(tmp.copy(w).divideScalar(wl), wl * dt));
      const ground = surfaceAt(m.position.x, m.position.z) + 0.03;
      if (m.position.y <= ground) {
        m.position.y = ground;
        normalAt(m.position.x, m.position.z, nSki);
        const vn = v.dot(nSki);
        if (vn < 0) v.addScaledVector(nSki, -vn * (vn < -2 ? 1.35 : 1)); // bounce off, or just stop sinking
        // Sliding on its base: slick along the ski, grippy across it.
        const along = tmp.set(0, 0, 1).applyQuaternion(m.quaternion);
        const va = v.dot(along);
        tmp2.copy(v).addScaledVector(along, -va).multiplyScalar(Math.exp(-dt * 4));
        v.copy(tmp2).addScaledVector(along, va * Math.exp(-dt * 0.6));
        v.addScaledVector(tmp.set(0, -G, 0).addScaledVector(nSki, G * nSki.y), dt * 0.6);
        w.multiplyScalar(Math.exp(-dt * 6));
        // Settle flat on the snow, base down, keeping its heading.
        along.addScaledVector(nSki, -along.dot(nSki)).normalize();
        fx.crossVectors(nSki, along).normalize();
        qFlat.setFromRotationMatrix(m3.makeBasis(fx, nSki, along));
        m.quaternion.slerp(qFlat, Math.min(1, dt * 6));
      }
    }
  }
  function clearLoose() {
    for (const s of loose) scene.remove(s.m);
    loose.length = 0;
    model.setSkis(true);
  }

  // --- Frame.
  const look = new THREE.Vector3();
  const dirH = new THREE.Vector3();
  const centre = new THREE.Vector3();
  let poleT = 0;
  let foldNow = 0;
  let grabNow = 0;
  let lastGrab = null;

  function update(dt) {
    if (!active || paused) return;
    dt = Math.min(dt, 0.05);
    clock += dt;
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
    if (loose.length) stepLoose(dt);
    absorb *= Math.exp(-dt * 5);
    shake *= Math.exp(-dt * 6);
    wobble *= Math.exp(-dt * 2.2);
    check *= Math.exp(-dt * (onGround ? 1.4 : 6));
    landTilt *= Math.exp(-dt * 3.5);
    plant[1] = Math.max(0, plant[1] - dt * 3);
    plant[-1] = Math.max(0, plant[-1] - dt * 3);

    // Ski tracks while on the snow.
    if (onGround && !grind && !chair && crashed <= 0) {
      f.set(Math.sin(yaw), 0, Math.cos(yaw));
      r.set(f.z, 0, -f.x);
      tracks.add(pos, f, r, pos.y, trackBreak);
      trackBreak = false;
    }

    // --- Pose the body.
    const speed = vel.length();
    const tuck = onGround && held('up') && speed > 5 && !held('grab') ? 1 : 0;
    poleT = onGround && held('up') && speed < 5 ? poleT + dt * 3 : 0;
    const inAir = !!air && crashed <= 0;
    airBlend += ((inAir ? 1 : 0) - airBlend) * Math.min(1, dt * (inAir ? 6 : 14));
    // In the air: knees come up for grabs and big rotations, legs reach for
    // the snow just before touchdown.
    // The body's shape is what sets the spin rate (see rotate()): tucked
    // tight it whips round, opened out it slows to spot the landing.
    let foldT = 0;
    let tuckK = 0;
    let openK = 0;
    if (inAir) {
      const rot = Math.min(1, (Math.abs(spinVel) + Math.abs(flipVel)) / 6);
      const I = Math.min(air.Is, air.If);
      tuckK = THREE.MathUtils.clamp((1.15 - I) / 0.3, 0, 1);
      openK = THREE.MathUtils.clamp((Math.max(air.Is, air.If) - 1.1) / 0.5, 0, 1);
      // Tall off the lip (the pop), then knees up; legs reach for the snow
      // just before touchdown.
      foldT = air.t < 0.14 || air.tl < 0.22 ? 0 : 0.12 + 0.3 * rot + 0.45 * tuckK - 0.12 * openK;
    }
    foldNow += (foldT - foldNow) * Math.min(1, dt * 7);
    const grabbing = inAir && air.grab && air.holding && air.tl > 0.15;
    // Switching grab: the hand lets go and reaches for the new spot.
    if (air?.grab && air.grab !== lastGrab) grabNow = Math.min(grabNow, 0.3);
    lastGrab = air?.grab || null;
    grabNow += ((grabbing ? 1 : 0) - grabNow) * Math.min(1, dt * 9);
    const travel = Math.atan2(vel.x, vel.z);
    const sw = onGround && Math.cos(travel - yaw) < 0;
    const twist = onGround && speed > 1.5 ? THREE.MathUtils.clamp(wrap(travel + (sw ? Math.PI : 0) - yaw) * 0.9, -1.1, 1.1) : 0;
    const plantPulse = (v) => Math.sin(Math.min(1, 1 - v) * Math.PI) * (v > 0 ? 1 : 0);
    const fallK = crashed > 0 && fall ? fallPose() : 0;
    model.pose({
      seated: chair ? 1 : 0,
      crouch: crashed > 0
        ? 0.5 * (1 - fallK)
        : grind
          ? 0.35
          : onGround
            ? 0.32 + 0.5 * load + 0.6 * absorb + 0.55 * check + THREE.MathUtils.clamp((gLoad - 1) * 0.35, -0.15, 0.4) + 0.15 * press
            : air && air.t < 0.14
              ? 0.05
              : 0.3,
      tuck,
      fold: foldNow,
      air: crashed > 0 ? Math.max(airBlend, fallK) : airBlend,
      grab: crashed > 0 ? 0 : grabNow,
      grabType: air?.grab || 'mute',
      airArms: inAir && !grabbing ? Math.min(1, air.t * 3) * (0.3 + 0.6 * openK) * (1 - 0.6 * tuckK) : grind ? 0.8 : 0,
      lean: onGround ? lean : 0,
      // Shoulders lead the spin; near the snow they square up to spot it.
      twist: inAir ? THREE.MathUtils.clamp(spinVel * (air.tl < 0.35 ? -0.04 : 0.07), -0.55, 0.55) : twist,
      check,
      checkSide,
      look: inAir ? THREE.MathUtils.clamp(spinVel * 0.12, -0.7, 0.7) : onGround ? THREE.MathUtils.clamp(yawRate * 0.25, -0.5, 0.5) : 0,
      plantL: plantPulse(plant[1]) + Math.max(0, Math.sin(poleT * Math.PI)),
      plantR: plantPulse(plant[-1]) + Math.max(0, Math.sin(poleT * Math.PI)),
      wobble: crashed > 0 && fall ? Math.min(1, Math.abs(fall.rollVel) / 6 + 0.8 * (1 - fallK)) : onGround ? wobble : 0,
      t: clock,
      press,
      fallen: fallK,
    });
    // Rotate about the centre of mass; on the snow the feet stay planted.
    const upNow = tmp.set(0, 1, 0).applyQuaternion(quat);
    centre.copy(pos).addScaledVector(chair ? UP : onGround || grind ? upNow : UP, COM);
    if (chair) centre.y -= COM - 0.02; // the seat holds the hips, not the feet
    if (fallK > 0) {
      // Falling: the centre drops from standing height to lying on the snow.
      const up0 = tmp.set(0, 1, 0).applyQuaternion(fall.q0);
      centre.copy(pos).addScaledVector(up0, COM * (1 - fallK)).addScaledVector(nFall, 0.26 * fallK);
    }
    pivot.position.copy(centre);
    pivot.quaternion.copy(quat);
    // Touching down nose-heavy or in the backseat: the body rocks over the
    // feet and recovers.
    if (Math.abs(landTilt) > 0.01 && onGround && crashed <= 0) pivot.rotateX(landTilt * 0.45);
    if (wobble > 0.05 && onGround) {
      // A sketchy landing rocks the body.
      pivot.rotateZ(Math.sin(clock * 9) * wobble * 0.12);
      pivot.rotateX(Math.sin(clock * 7.3) * wobble * 0.08);
    }

    // --- Speed check before a kicker.
    let want = '';
    if (onGround && !grind && !chair && crashed <= 0) {
      const k = kickerAhead();
      if (k) {
        const ratio = speed / k.prof.lip.v;
        want = ratio > 1.15 ? 'fast' : ratio < 0.85 ? 'slow' : 'ok';
      }
    }
    if (want !== checkState) {
      checkState = want;
      checkEl.className = `ski-speedcheck ${want}${want ? ' show' : ''}`;
      if (want) checkEl.textContent = want === 'fast' ? 'Too fast · speed check' : want === 'slow' ? 'Too slow · tuck' : 'Good speed · send it';
    }

    // --- Lift prompt.
    nearLift = onGround && !grind && !chair && crashed <= 0 && speed < 8 ? findLift() : null;
    if (chair) {
      promptEl.textContent = `Riding ${chair.l.data.name} · E: skip to the top`;
      promptEl.hidden = false;
    } else if (nearLift) {
      promptEl.textContent = `E: ride ${nearLift.data.name}`;
      promptEl.hidden = false;
    } else promptEl.hidden = true;

    // --- Camera: low and close behind the travel, steady through the air.
    if (chair) {
      const d = tmp2.set(chair.l.dir.x, 0, chair.l.dir.z).normalize();
      const want = tmp.copy(pos).addScaledVector(d, -7).add(look.set(0, 3, 0));
      camPos.lerp(want, 1 - Math.exp(-dt * 3));
      camLook.lerp(look.copy(pos).addScaledVector(d, 25).add(tmp.set(0, 4, 0)), 1 - Math.exp(-dt * 3));
    } else {
      dirH.set(vel.x, 0, vel.z);
      if (dirH.lengthSq() < 0.5) dirH.set(Math.sin(yaw), 0, Math.cos(yaw));
      dirH.normalize();
      const back = 5.2 + Math.min(3.5, speed * 0.1);
      const want = tmp.copy(pos).addScaledVector(dirH, -back);
      want.y = Math.max(pos.y, surfaceAt(want.x, want.z)) + 2.0 + Math.min(1.6, speed * 0.035);
      camPos.lerp(want, 1 - Math.exp(-dt * (onGround ? 5 : 2.5)));
      const floor = surfaceAt(camPos.x, camPos.z) + 1.0;
      if (camPos.y < floor) camPos.y = floor;
      look.copy(pos).addScaledVector(dirH, 4).add(tmp.set(0, 0.9, 0));
      camLook.lerp(look, 1 - Math.exp(-dt * 8));
    }
    camera.position.copy(camPos);
    if (shake > 0.01) camera.position.add(tmp.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
    camera.lookAt(camLook);
    const fov = 58 + Math.min(16, speed * 0.4);
    if (Math.abs(camera.fov - fov) > 0.1) {
      camera.fov += (fov - camera.fov) * Math.min(1, dt * 3);
      camera.updateProjectionMatrix();
    }

    // --- Sound.
    audio.update({
      speed,
      carve: onGround ? Math.abs(edge) / EDGE_MAX : 0,
      skid: onGround ? slip : 0,
      rail: !!grind,
      air: !!air,
      quiet: !!chair || crashed > 0,
    });

    // --- HUD.
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) toastEl.classList.remove('show');
    }
    let live = '';
    if (air && air.t > 0.15) {
      const deg = Math.floor(Math.abs(air.spin) / (Math.PI / 4) + 0.5) * 45;
      const flips = Math.abs(air.flip) / (2 * Math.PI);
      const bits = [];
      if (deg >= 90) bits.push(`${deg}°`);
      if (flips > 0.2) bits.push(`${air.flip < 0 ? 'back' : 'front'} ×${flips.toFixed(1)}`);
      if (air.grabs.length) bits.push(grabList(air.grabs));
      live = bits.join(' · ');
    } else if (onGround && Math.abs(butterSpin) > 0.6) live = `butter ${Math.round(Math.abs(butterSpin) * 57.3)}°`;
    else if (grind) live = `${Math.abs(Math.sin(grind.off)) > 0.7 ? 'boardslide' : '50-50'} ${grind.time.toFixed(1)}s`;
    liveEl.textContent = live;
    liveEl.classList.toggle('show', !!live);
    hud.querySelector('.ski-speed').textContent = Math.round(speed * 2.23694);
    hud.querySelector('.ski-score').textContent = score.toLocaleString();
    hud.querySelector('.ski-load').style.width = `${Math.round(load * 100)}%`;
    hud.querySelector('.ski-loadbar').style.opacity = load > 0.01 ? '1' : '0';
  }

  return {
    start,
    stop,
    update,
    respawn,
    crash, // for testing from the console
    boardLift,
    get active() {
      return active;
    },
    get paused() {
      return paused;
    },
    set paused(v) {
      paused = v;
      keys.clear();
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
      return { onGround, crashed, air, grind, chair, score, yaw, nearLift, edge, lean, slip, gLoad, lastLanding };
    },
  };
}
