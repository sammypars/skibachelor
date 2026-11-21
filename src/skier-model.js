// The player's skier: a jointed, shaped figure. Legs are lathed (baggy
// pants over boots), the jacket is a fabric-sheen shell with panels and a
// zip, the skis are twin tips with real sidecut and rocker, and the arms use
// two-bone IK so hands can go where they need to: forward in an athletic
// stance, planting a pole, reaching down to a ski for a grab.
//
// Faces +z with the feet at the origin. Two leg modes:
//   ground  feet stay planted, the hips move as the knees bend
//   air     the hips stay put at the centre of mass and the feet come up

import * as THREE from 'three';

const ANKLE_Y = 0.13;
const SHIN = 0.46;
const THIGH = 0.46;
const TORSO = 0.56;
const UPPER_ARM = 0.29;
const FOREARM = 0.27;
const STANCE = 0.12; // half the gap between the feet
export const HIP_AIR = 0.9; // hip height above the feet when standing tall

const v3 = () => new THREE.Vector3();

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Jacket shell: around (u) from the front centre, up (v) from the hem.
function jacketTexture(base, trim) {
  const b = '#' + new THREE.Color(base).getHexString();
  const k = '#' + new THREE.Color(trim).getHexString();
  return canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = b;
    g.fillRect(0, 0, w, h);
    // Side panels under the arms.
    g.fillStyle = k;
    for (const u of [0.25, 0.75]) g.fillRect(w * (u - 0.07), 0, w * 0.14, h);
    // Shoulder yoke.
    g.fillRect(0, 0, w, h * 0.16);
    // Hem band and storm flap.
    g.fillRect(0, h * 0.93, w, h * 0.07);
    // Centre zip (front centre is at both edges of the texture).
    g.fillStyle = '#0c0d0f';
    g.fillRect(0, 0, 5, h);
    g.fillRect(w - 5, 0, 5, h);
    // Chest pocket zip.
    g.fillStyle = '#0c0d0f';
    g.save();
    g.translate(w * 0.06, h * 0.32);
    g.rotate(-0.5);
    g.fillRect(0, 0, 46, 4);
    g.restore();
    // Seams and soft fabric shading.
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.lineWidth = 2;
    for (const v of [0.45, 0.7]) {
      g.beginPath();
      g.moveTo(0, h * v);
      g.lineTo(w, h * v);
      g.stroke();
    }
    for (let i = 0; i < 1800; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},0.035)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  });
}

// Ski topsheet graphic along the ski (v runs tip to tail).
function topsheetTexture() {
  return canvasTex(64, 512, (g, w, h) => {
    g.fillStyle = '#111214';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffc20e';
    // Chevrons toward the tip and tail, a block under foot.
    for (let i = 0; i < 6; i++) {
      for (const end of [0, 1]) {
        const y = end ? h - 30 - i * 26 : 30 + i * 26;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w / 2, y + (end ? 14 : -14));
        g.lineTo(w, y);
        g.lineTo(w, y + 7);
        g.lineTo(w / 2, y + (end ? 21 : -7));
        g.lineTo(0, y + 7);
        g.fill();
      }
    }
    g.fillRect(0, h * 0.44, w, h * 0.12);
    g.fillStyle = '#111214';
    g.fillRect(w * 0.15, h * 0.47, w * 0.7, h * 0.06);
  });
}

// Mirrored goggle lens: orange to magenta with a bright sky reflection.
function lensTexture() {
  return canvasTex(128, 64, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#ffd04a');
    grad.addColorStop(0.45, '#ff7a1a');
    grad.addColorStop(1, '#a3226e');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    g.ellipse(w * 0.35, h * 0.3, w * 0.28, h * 0.12, -0.2, 0, Math.PI * 2);
    g.fill();
  });
}

// Twin-tip ski: sidecut (wide tip and tail, narrow waist), camber underfoot,
// rocker rising into both ends.
function skiGeometry() {
  const L = 1.72;
  const T = 0.017;
  const waist = 0.088;
  const tip = 0.122;
  const tail = 0.116;
  const g = new THREE.BoxGeometry(1, T, L, 1, 1, 48);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    const u = z / (L / 2);
    const a = Math.abs(u);
    let w = waist + ((u > 0 ? tip : tail) - waist) * Math.min(1, a / 0.82) ** 2;
    if (a > 0.86) w *= Math.sqrt(Math.max(0, 1 - ((a - 0.86) / 0.14) ** 2)) * 0.85 + 0.15;
    p.setX(i, Math.sign(p.getX(i)) * w * 0.5);
    let y = p.getY(i) + 0.005 * (1 - u * u);
    if (a > 0.7) y += ((a - 0.7) / 0.3) ** 2 * (u > 0 ? 0.075 : 0.06);
    p.setY(i, y);
  }
  g.computeVertexNormals();
  return g;
}

function lathe(profile, segs = 14) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segs);
}

function joint(parent, x, y, z) {
  const j = new THREE.Group();
  j.position.set(x, y, z);
  parent.add(j);
  return j;
}

function mesh(geo, mat, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent?.add(m);
  return m;
}

export function createSkierModel({ jacket = 0xffc20e, trim = 0x131416, pants = 0x24282e, helmet = 0xf4f6f8, envMap = null } = {}) {
  const env = envMap ? { envMap, envMapIntensity: 0.5 } : {};
  const M = {
    jacket: new THREE.MeshPhysicalMaterial({
      map: jacketTexture(jacket, trim),
      roughness: 0.62,
      sheen: 0.6,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color(0xffffff),
      ...env,
    }),
    sleeve: new THREE.MeshPhysicalMaterial({ color: jacket, roughness: 0.62, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffffff), ...env }),
    trim: new THREE.MeshStandardMaterial({ color: trim, roughness: 0.7 }),
    pants: new THREE.MeshPhysicalMaterial({ color: pants, roughness: 0.85, sheen: 0.4, sheenRoughness: 0.6, sheenColor: new THREE.Color(0x8899aa) }),
    bootShell: new THREE.MeshStandardMaterial({ color: 0xf0f2f4, roughness: 0.3, metalness: 0.05, ...env }),
    bootDark: new THREE.MeshStandardMaterial({ color: 0x1c1f23, roughness: 0.45 }),
    buckle: new THREE.MeshStandardMaterial({ color: 0xc0c6cc, roughness: 0.25, metalness: 0.9, ...env }),
    skiBase: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.3 }),
    skiEdge: new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.25, metalness: 0.9, ...env }),
    skiTop: new THREE.MeshStandardMaterial({ map: topsheetTexture(), roughness: 0.25, metalness: 0.05, ...env }),
    binding: new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.35, metalness: 0.5 }),
    bindingHi: new THREE.MeshStandardMaterial({ color: 0xffc20e, roughness: 0.4 }),
    helmet: new THREE.MeshStandardMaterial({ color: helmet, roughness: 0.28, metalness: 0.05, ...env }),
    lens: new THREE.MeshStandardMaterial({ map: lensTexture(), roughness: 0.08, metalness: 0.55, emissive: 0x3a1400, side: THREE.DoubleSide, ...(envMap ? { envMap, envMapIntensity: 1.2 } : {}) }),
    frame: new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.5, side: THREE.DoubleSide }),
    strap: new THREE.MeshStandardMaterial({ color: 0xffc20e, roughness: 0.7, side: THREE.DoubleSide }),
    glove: new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.75 }),
    pole: new THREE.MeshStandardMaterial({ color: 0xc9d1d9, roughness: 0.25, metalness: 0.85, ...env }),
    skin: new THREE.MeshStandardMaterial({ color: 0xd9a888, roughness: 0.7 }),
  };

  const root = new THREE.Group(); // feet on the snow
  root.name = 'player-skier';

  // --- Feet: ski, binding and boot sole stay flat; the boot cuff and leg
  // hang off the ankle above.
  const skiGeo = skiGeometry();
  const skiMats = [M.skiEdge, M.skiEdge, M.skiTop, M.skiBase, M.skiEdge, M.skiEdge];
  const legs = [];
  for (const side of [-1, 1]) {
    const foot = joint(root, side * STANCE, 0, 0);
    const ski = mesh(skiGeo, skiMats, foot, 0, 0.012, 0.04);
    // Binding: toe piece, heel piece and a plate.
    mesh(new THREE.BoxGeometry(0.07, 0.022, 0.5), M.binding, ski, 0, 0.018, -0.02);
    mesh(new THREE.BoxGeometry(0.08, 0.05, 0.09), M.binding, ski, 0, 0.045, 0.17);
    mesh(new THREE.BoxGeometry(0.085, 0.07, 0.11), M.binding, ski, 0, 0.055, -0.21);
    mesh(new THREE.BoxGeometry(0.03, 0.012, 0.11), M.bindingHi, ski, 0, 0.092, -0.21);
    // Brakes, tucked up.
    for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.008, 0.008, 0.12), M.binding, ski, s * 0.05, 0.03, -0.13);
    // Boot sole and lower shell, flat on the binding.
    const sole = mesh(new THREE.BoxGeometry(0.11, 0.04, 0.32), M.bootDark, foot, 0, 0.065, 0.03);
    const shell = mesh(new THREE.SphereGeometry(0.5, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.12, 0.13, 0.33), M.bootShell, foot, 0, 0.08, 0.03);
    void sole;
    void shell;

    const ankle = joint(foot, 0, ANKLE_Y, 0);
    // Boot cuff with two buckles, flexing with the shin.
    const cuff = mesh(new THREE.CylinderGeometry(0.068, 0.078, 0.24, 14).translate(0, 0.06, 0.0), M.bootShell, ankle);
    void cuff;
    for (const [y, z] of [[0.0, 0.07], [0.1, 0.066]]) {
      mesh(new THREE.BoxGeometry(0.05, 0.016, 0.02), M.buckle, ankle, 0, y, z + 0.012);
    }
    mesh(new THREE.BoxGeometry(0.12, 0.012, 0.02), M.bindingHi, ankle, 0, 0.16, 0.0); // power strap edge
    // Shin: baggy pants over the boot.
    mesh(lathe([[0.096, 0.1], [0.104, 0.16], [0.097, 0.32], [0.09, SHIN], [0.07, SHIN + 0.05]]), M.pants, ankle);
    const knee = joint(ankle, 0, SHIN, 0);
    mesh(new THREE.SphereGeometry(0.094, 14, 10), M.pants, knee);
    mesh(lathe([[0.075, -0.02], [0.095, 0.04], [0.112, 0.25], [0.12, THIGH - 0.02], [0.1, THIGH + 0.05]]), M.pants, knee);
    legs.push({ foot, ski, ankle, knee, side });
  }

  // --- Torso from the hips, with the head and arms.
  const hips = joint(root, 0, HIP_AIR, 0);
  mesh(new THREE.SphereGeometry(0.16, 16, 12).scale(1.15, 0.85, 0.95), M.pants, hips);
  const spine = joint(hips, 0, 0.04, 0);
  // The shell: hem below the hips, chest, shoulders, collar.
  const shellGeo = lathe(
    [[0.0, -0.17], [0.195, -0.165], [0.205, -0.1], [0.19, 0.04], [0.192, 0.18], [0.205, 0.32], [0.208, 0.42], [0.18, 0.5], [0.12, 0.555], [0.0, 0.565]],
    22,
  ).scale(1.0, 1, 0.74);
  mesh(shellGeo, M.jacket, spine);
  // Collar and the hood bunched behind the neck.
  mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.11, 16, 1, true), M.trim, spine, 0, TORSO + 0.02, 0.005).material = M.trim;
  mesh(new THREE.SphereGeometry(0.1, 14, 10).scale(1.3, 0.6, 0.7), M.sleeve, spine, 0, TORSO - 0.02, -0.11);
  const neck = joint(spine, 0, TORSO + 0.03, 0.01);
  const head = new THREE.Group();
  neck.add(head);
  mesh(new THREE.SphereGeometry(0.1, 16, 12).scale(0.92, 1.1, 1.0), M.skin, head, 0, 0.1, 0.012);
  mesh(new THREE.CylinderGeometry(0.09, 0.098, 0.075, 16), M.trim, head, 0, 0.005, 0.005); // gaiter
  const helm = mesh(new THREE.SphereGeometry(0.135, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.6).scale(1.0, 0.98, 1.12), M.helmet, head, 0, 0.115, -0.005);
  void helm;
  // Ear pads and a vent ridge.
  for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.05, 10, 8).scale(0.5, 1, 1), M.helmet, head, s * 0.125, 0.085, -0.01);
  for (const x of [-0.04, 0, 0.04]) mesh(new THREE.BoxGeometry(0.014, 0.012, 0.14), M.trim, head, x, 0.245, -0.005);
  // Goggles: frame, mirrored lens, strap round the back of the helmet.
  mesh(new THREE.CylinderGeometry(0.139, 0.139, 0.082, 24, 1, true, -1.05, 2.1), M.frame, head, 0, 0.12, 0.012);
  mesh(new THREE.CylinderGeometry(0.143, 0.141, 0.064, 24, 1, true, -0.92, 1.84), M.lens, head, 0, 0.12, 0.012);
  mesh(new THREE.CylinderGeometry(0.146, 0.146, 0.04, 24, 1, true, 1.0, Math.PI * 2 - 2.0), M.strap, head, 0, 0.13, -0.005);

  // --- Arms: shoulder -> upper arm -> elbow -> forearm -> hand.
  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = joint(spine, side * 0.2, TORSO - 0.1, -0.005);
    mesh(new THREE.SphereGeometry(0.078, 14, 10), M.sleeve, shoulder);
    const upper = mesh(lathe([[0.066, 0.0], [0.074, 0.06], [0.07, UPPER_ARM - 0.02], [0.062, UPPER_ARM + 0.03]], 12), M.sleeve, shoulder);
    upper.rotation.x = Math.PI; // hangs down from the shoulder
    const elbow = joint(shoulder, 0, -UPPER_ARM, 0);
    mesh(new THREE.SphereGeometry(0.064, 12, 8), M.sleeve, elbow);
    const fore = mesh(lathe([[0.058, 0.0], [0.064, 0.05], [0.058, FOREARM - 0.06], [0.07, FOREARM - 0.03], [0.05, FOREARM]], 12), M.sleeve, elbow);
    fore.rotation.x = Math.PI;
    const hand = joint(elbow, 0, -FOREARM, 0);
    // Gauntlet glove: cuff, mitt and thumb.
    mesh(new THREE.CylinderGeometry(0.062, 0.058, 0.08, 12), M.glove, hand, 0, 0.02, 0);
    mesh(new THREE.SphereGeometry(0.052, 12, 10).scale(0.85, 1.3, 1.1), M.glove, hand, 0, -0.06, 0.005);
    mesh(new THREE.SphereGeometry(0.022, 8, 6).scale(1, 1.6, 1), M.glove, hand, -side * 0.035, -0.04, 0.03);
    // Pole: grip in the hand, tapered shaft, basket near the tip.
    const pole = new THREE.Group();
    pole.position.set(0, -0.06, 0.01);
    hand.add(pole);
    mesh(new THREE.CylinderGeometry(0.017, 0.02, 0.15, 10), M.trim, pole, 0, 0.02, 0);
    mesh(new THREE.CylinderGeometry(0.009, 0.006, 1.1, 8).translate(0, -0.55, 0), M.pole, pole);
    mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.008, 12), M.trim, pole, 0, -1.0, 0);
    mesh(new THREE.ConeGeometry(0.006, 0.04, 6).rotateX(Math.PI), M.buckle, pole, 0, -1.12, 0);
    arms.push({ shoulder, elbow, hand, pole, side });
  }

  // --- Two-bone IK: put the hand at `target` (in the spine's frame) with the
  // elbow pointing toward `pole`.
  const IK = { d: v3(), u: v3(), p: v3(), X: v3(), Y: v3(), Z: v3(), m: new THREE.Matrix4(), q: new THREE.Quaternion(), qp: new THREE.Quaternion() };
  function reach(A, target, pole) {
    const S = A.shoulder.position;
    const d = IK.d.subVectors(target, S);
    const reachMax = (UPPER_ARM + FOREARM) * 0.995;
    const D = Math.min(reachMax, Math.max(0.12, d.length()));
    d.normalize();
    // Upper arm swung off the shoulder-hand line toward the pole.
    const alpha = Math.acos(THREE.MathUtils.clamp((UPPER_ARM ** 2 + D ** 2 - FOREARM ** 2) / (2 * UPPER_ARM * D), -1, 1));
    const p = IK.p.copy(pole).addScaledVector(d, -pole.dot(d));
    if (p.lengthSq() < 1e-6) p.set(0, 0, -1);
    p.normalize();
    const u = IK.u.copy(d).multiplyScalar(Math.cos(alpha)).addScaledVector(p, Math.sin(alpha));
    // Shoulder frame: limb runs down -Y, the forearm folds toward +Z.
    const Y = IK.Y.copy(u).negate();
    const Z = IK.Z.copy(d).addScaledVector(u, -d.dot(u));
    if (Z.lengthSq() < 1e-6) Z.copy(p).negate();
    Z.normalize();
    const X = IK.X.crossVectors(Y, Z).normalize();
    A.shoulder.quaternion.setFromRotationMatrix(IK.m.makeBasis(X, Y, Z));
    const inner = Math.acos(THREE.MathUtils.clamp((UPPER_ARM ** 2 + FOREARM ** 2 - D ** 2) / (2 * UPPER_ARM * FOREARM), -1, 1));
    A.elbow.rotation.set(-(Math.PI - inner), 0, 0);
  }
  // Point a pole along `dir` (root frame).
  const DOWN = new THREE.Vector3(0, -1, 0);
  const qRoot = new THREE.Quaternion();
  function aimPole(A, dir) {
    A.hand.updateWorldMatrix(true, false);
    A.hand.getWorldQuaternion(IK.qp);
    root.getWorldQuaternion(qRoot);
    IK.q.setFromUnitVectors(DOWN, dir.clone().normalize()).premultiply(qRoot);
    A.pole.quaternion.copy(IK.qp.invert().multiply(IK.q));
  }

  // --- Pose. Inputs 0..1 unless noted.
  //   crouch   knees bent (absorbing, loading a pop)
  //   tuck     racing tuck
  //   fold     knees pulled up in the air (grabs, big spins)
  //   air      0 = feet planted, 1 = hips fixed at the centre of mass
  //   grab     0..1 reaching for the ski; grabType mute|safety|japan|tail
  //   airArms  arms out for balance in the air
  //   seated   sitting on a chairlift
  //   lean     body inclination into the turn (rad); the upper body angulates
  //   twist    upper body turned from the skis (rad), e.g. in a hockey stop
  //   look     head turn (rad)
  //   plantL/R pole plants
  //   wobble   arms flailing on a sketchy landing
  //   t        clock for the flail
  const p = {
    crouch: 0.25, tuck: 0, fold: 0, air: 0, grab: 0, grabType: 'mute', airArms: 0, seated: 0,
    lean: 0, twist: 0, look: 0, plantL: 0, plantR: 0, wobble: 0, t: 0, press: 0,
  };
  const tgt = v3();
  const tw = v3();
  const poleV = v3();
  const dir = v3();
  const hipPos = v3();
  const off = v3();

  // Hip offset above a foot for shin tilt s and thigh angle a (from vertical,
  // negative = hip behind the knee).
  function legOffset(s, a, out) {
    return out.set(0, ANKLE_Y + Math.cos(s) * SHIN + Math.cos(a) * THIGH, Math.sin(s) * SHIN + Math.sin(a) * THIGH);
  }

  function pose(next) {
    Object.assign(p, next);
    const seated = p.seated > 0.5;
    const crouch = Math.min(1, p.crouch + 0.6 * p.tuck);
    // Leg angles.
    let s;
    let a;
    if (seated) {
      s = 0.05;
      a = -1.5;
    } else {
      const bend = 0.35 + 1.25 * crouch;
      s = 0.55 * bend;
      a = s - bend;
      const fold = Math.min(1, p.fold + 0.8 * p.grab);
      s += (0.85 - s) * fold;
      a += (-1.65 - a) * fold;
    }
    legOffset(s, a, off);
    // Hips: planted feet put them at `off`; in the air they sit at HIP_AIR.
    const airK = seated ? 1 : p.air;
    if (seated) hipPos.set(0, ANKLE_Y + SHIN, -THIGH);
    else hipPos.set(0, off.y + (HIP_AIR - off.y) * airK, off.z * (1 - airK));
    hips.position.copy(hipPos);
    for (const L of legs) {
      L.foot.position.set(L.side * STANCE, hipPos.y - off.y, hipPos.z - off.z);
      L.foot.rotation.set(seated ? 0.35 : 0, 0, 0);
      L.ankle.rotation.set(s, 0, -p.lean * 0.18);
      L.knee.rotation.set(a - s, 0, 0);
    }

    // Spine: forward lean, angulation against the turn, twist.
    if (seated) spine.rotation.set(-0.12, 0, 0);
    else {
      const fwd = 0.28 + 0.35 * crouch + 0.5 * p.tuck + 0.55 * Math.min(1, p.fold + p.grab) + 0.15 * p.press;
      spine.rotation.set(fwd, p.twist * 0.6, p.lean * 0.45);
    }
    neck.rotation.set(-spine.rotation.x * 0.75 + (seated ? 0.1 : 0), p.look + p.twist * 0.3, -spine.rotation.z * 0.5);

    // Arms by hand targets in the spine's frame.
    root.updateMatrixWorld(true);
    for (const A of arms) {
      const sd = A.side;
      let plant = sd > 0 ? p.plantL : p.plantR;
      if (seated) {
        tgt.set(sd * 0.17, 0.02, 0.3);
        plant = 0;
      } else {
        // Athletic stance: hands forward, a little wide, above the belt.
        tgt.set(sd * 0.3, 0.2, 0.34);
        if (p.tuck > 0) tgt.lerp(tw.set(sd * 0.13, 0.22, 0.42), p.tuck);
        if (plant > 0) tgt.lerp(tw.set(sd * 0.32, 0.12, 0.44), plant);
        if (p.airArms > 0) tgt.lerp(tw.set(sd * 0.6, 0.4, 0.12), p.airArms);
        if (p.wobble > 0) {
          const ph = p.t * 13 + sd * 1.7;
          tgt.lerp(tw.set(sd * (0.45 + 0.2 * Math.sin(ph)), 0.35 + 0.25 * Math.cos(ph), 0.15 * Math.sin(ph * 0.7)), p.wobble);
        }
      }
      // Grabs: the grabbing hand goes to a point on a ski (root frame).
      const grabbing = !seated && p.grab > 0 && grabHand(p.grabType) === sd;
      if (grabbing) {
        const [gx, gz] = grabPoint(p.grabType, sd);
        const L = legs[gx < 0 ? 0 : 1];
        tw.set(L.foot.position.x + (gx < 0 ? -0.03 : 0.03), L.foot.position.y + 0.05, L.foot.position.z + gz);
        root.localToWorld(tw);
        spine.worldToLocal(tw);
        tgt.lerp(tw, p.grab);
      } else if (!seated && p.grab > 0) {
        // The free arm goes out for balance.
        tgt.lerp(tw.set(sd * 0.55, 0.42, -0.05), p.grab);
      }
      // Elbows point out and back.
      poleV.set(sd * 0.8, -0.3, -0.6);
      reach(A, tgt, poleV);
    }
    // Poles trail back and down; a plant swings the tip forward to the snow.
    root.updateMatrixWorld(true);
    for (const A of arms) {
      const sd = A.side;
      const plant = seated ? 0 : sd > 0 ? p.plantL : p.plantR;
      if (seated) dir.set(sd * 0.1, -0.6, 1);
      else if (p.tuck > 0.5) dir.set(sd * 0.1, -0.25, -1);
      else dir.set(sd * 0.15, -1, -0.65).lerp(tw.set(sd * 0.2, -1, 0.35), plant);
      if (p.airArms > 0 && !seated) dir.lerp(tw.set(sd * 0.4, -1, -0.4), p.airArms * 0.5);
      aimPole(A, dir);
    }
  }
  function grabHand(type) {
    return type === 'tail' ? 1 : -1;
  }
  // Which ski (x sign) and where along it (z) each grab takes hold.
  function grabPoint(type, side) {
    switch (type) {
      case 'safety':
        return [side, 0.0];
      case 'japan':
        return [side, 0.3];
      case 'tail':
        return [side, -0.4];
      default:
        return [-side, 0.22]; // mute: across to the other ski, in front of the boot
    }
  }

  pose({});
  return { root, pose, params: p };
}
