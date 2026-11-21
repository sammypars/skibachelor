// Drone mode: fly the camera freely over the mountain.
//
//   W A S D      fly forward / left / back / right
//   Space / E    climb        Q / C   descend
//   Shift        boost (3x)
//   Drag mouse   look around  (arrow keys also turn and tilt)
//   Scroll       change cruising speed
//
// Movement eases in and out like a real drone, the camera banks a little
// into turns and strafes, and it never goes under the snow or off the map.

import * as THREE from 'three';

const MIN_SPEED = 8;
const MAX_SPEED = 900;
const CLEARANCE = 3; // hard floor, meters above the snow
const CUSHION = 14; // below this the drone eases itself up over terrain

export function createDrone({ camera, canvas, world }) {
  const keys = new Set();
  const vel = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  let yaw = 0;
  let pitch = 0;
  let roll = 0;
  let yawRate = 0;
  let speed = 80; // m/s cruising speed
  let active = false;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const want = new THREE.Vector3();

  function start() {
    // Pick up the current view direction so entering drone mode is seamless.
    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    yaw = euler.y;
    pitch = euler.x;
    roll = 0;
    vel.set(0, 0, 0);
    keys.clear();
    active = true;
  }

  function stop() {
    active = false;
    keys.clear();
    dragging = false;
    canvas.style.cursor = '';
  }

  // A point ahead of the camera, for handing back to the orbit controls.
  function lookPoint(out = new THREE.Vector3()) {
    camera.getWorldDirection(out);
    const dist = THREE.MathUtils.clamp(camera.position.y - world.hf.heightAt(camera.position.x, camera.position.z), 150, 1500);
    return out.multiplyScalar(dist).add(camera.position);
  }

  const isTyping = (e) => e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
  window.addEventListener('keydown', (e) => {
    if (!active || isTyping(e)) return;
    keys.add(e.code);
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  canvas.addEventListener('pointerdown', (e) => {
    if (!active) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!active || !dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    const k = (camera.fov * Math.PI) / 180 / window.innerHeight; // drag follows the cursor
    yaw += dx * k;
    pitch += dy * k;
    yawRate += dx * k * 4;
  });
  const endDrag = () => {
    dragging = false;
    canvas.style.cursor = active ? 'grab' : '';
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!active) return;
      e.preventDefault();
      speed = THREE.MathUtils.clamp(speed * Math.exp(-e.deltaY * 0.0015), MIN_SPEED, MAX_SPEED);
    },
    { passive: false },
  );

  function update(dt) {
    if (!active) return;
    canvas.style.cursor = dragging ? 'grabbing' : 'grab';
    const down = (...codes) => codes.some((c) => keys.has(c));

    // Arrow keys turn and tilt.
    const turn = (down('ArrowLeft') ? 1 : 0) - (down('ArrowRight') ? 1 : 0);
    const tilt = (down('ArrowUp') ? 1 : 0) - (down('ArrowDown') ? 1 : 0);
    yaw += turn * 1.4 * dt;
    pitch += tilt * 1.0 * dt;
    yawRate += turn * 1.4 * dt * 4;
    pitch = THREE.MathUtils.clamp(pitch, -1.45, 1.2);

    // Flight is level: W flies along the ground direction you face, so
    // looking down at the slope does not dive you into it.
    fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const f = (down('KeyW') ? 1 : 0) - (down('KeyS') ? 1 : 0);
    const s = (down('KeyD') ? 1 : 0) - (down('KeyA') ? 1 : 0);
    const u = (down('Space', 'KeyE') ? 1 : 0) - (down('KeyQ', 'KeyC') ? 1 : 0);
    const boost = down('ShiftLeft', 'ShiftRight') ? 3 : 1;
    want.set(0, 0, 0).addScaledVector(fwd, f).addScaledVector(right, s);
    if (want.lengthSq() > 1) want.normalize();
    want.multiplyScalar(speed * boost);
    want.y = u * speed * boost * 0.6;

    // Ease toward the wanted velocity (quicker to stop than to start).
    const rate = want.lengthSq() > 0.01 ? 2.6 : 3.8;
    vel.lerp(want, 1 - Math.exp(-rate * dt));
    camera.position.addScaledVector(vel, dt);

    // Stay over the map and above the snow.
    const { hf } = world;
    const pad = 300;
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, hf.minX - pad, hf.maxX + pad);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, hf.minZ - pad, hf.maxZ + pad);
    camera.position.y = Math.min(camera.position.y, 9000);
    // Ground avoidance: a soft cushion lifts you over rising slopes (looking
    // a little ahead of where you are flying), with a hard floor below it.
    const ahead = hf.heightAt(camera.position.x + vel.x * 0.6, camera.position.z + vel.z * 0.6);
    const floor = Math.max(hf.heightAt(camera.position.x, camera.position.z), ahead);
    const gap = camera.position.y - floor;
    // Holding Q/C overrides it, so you can still skim the snow on purpose.
    if (gap < CUSHION && u === 0 && Math.hypot(vel.x, vel.z) > 5) {
      const push = (CUSHION - gap) * 4;
      if (vel.y < push) vel.y += (push - vel.y) * (1 - Math.exp(-8 * dt));
    }
    const ground = hf.heightAt(camera.position.x, camera.position.z) + CLEARANCE;
    if (camera.position.y < ground) {
      camera.position.y = ground;
      if (vel.y < 0) vel.y = 0;
    }

    // Bank into strafes and turns, like a drone tilting to move.
    const side = vel.dot(right) / Math.max(speed * 3, 1);
    yawRate *= Math.exp(-6 * dt);
    const bank = THREE.MathUtils.clamp(-side * 0.35 - yawRate * 0.25, -0.35, 0.35);
    roll += (bank - roll) * (1 - Math.exp(-5 * dt));
    euler.set(pitch, yaw, roll, 'YXZ');
    camera.quaternion.setFromEuler(euler);
  }

  return {
    start,
    stop,
    update,
    lookPoint,
    get active() {
      return active;
    },
    get speed() {
      return speed;
    },
    get velocity() {
      return vel;
    },
  };
}
