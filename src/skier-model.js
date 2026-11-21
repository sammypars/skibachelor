// The player's skier: a jointed figure (ankles, knees, hips, shoulders,
// elbows) so the body can crouch, absorb, tuck, grab, throw its arms out in
// the air and sit on a chair. Faces +z with the feet at the origin.

import * as THREE from 'three';

const SHIN = 0.46;
const THIGH = 0.46;
const TORSO = 0.56;
const UPPER_ARM = 0.3;
const FOREARM = 0.28;
const STANCE = 0.13; // half the gap between the feet

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });

// A rounded limb from the joint (y = 0) out along +y.
function limb(r0, r1, len, material) {
  const g = new THREE.CylinderGeometry(r1, r0, len, 10).translate(0, len / 2, 0);
  const cap = new THREE.SphereGeometry(r0, 10, 8);
  const mesh = new THREE.Mesh(g, material);
  mesh.add(new THREE.Mesh(cap, material));
  mesh.castShadow = true;
  return mesh;
}

function joint(parent, x, y, z) {
  const j = new THREE.Group();
  j.position.set(x, y, z);
  parent.add(j);
  return j;
}

export function createSkierModel({ jacket = 0xffc20e, trim = 0x131416, pants = 0x22262b, helmet = 0xf4f6f8 } = {}) {
  const M = {
    jacket: mat(jacket, { roughness: 0.55 }),
    trim: mat(trim, { roughness: 0.6 }),
    pants: mat(pants, { roughness: 0.8 }),
    boot: mat(0x30353b, { roughness: 0.45, metalness: 0.1 }),
    ski: mat(0x15171a, { roughness: 0.35 }),
    skiTop: mat(0xffc20e, { roughness: 0.4 }),
    binding: mat(0x8b939c, { roughness: 0.35, metalness: 0.6 }),
    helmet: mat(helmet, { roughness: 0.35 }),
    goggle: mat(0xff7a1a, { roughness: 0.1, metalness: 0.8, emissive: 0x2a1000 }),
    strap: mat(0x131416),
    glove: mat(0x131416, { roughness: 0.8 }),
    pole: mat(0xb9c2cc, { roughness: 0.3, metalness: 0.8 }),
    skin: mat(0xe0b394),
  };

  const root = new THREE.Group(); // feet on the snow
  root.name = 'player-skier';

  // --- Skis (stay flat on the snow) with upturned tips and bindings.
  const skis = [];
  for (const side of [-1, 1]) {
    const ski = new THREE.Group();
    ski.position.set(side * STANCE, 0.02, 0.05);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.024, 1.55), M.ski);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.006, 1.3), M.skiTop);
    top.position.set(0, 0.015, -0.05);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.022, 0.22), M.ski);
    tip.position.set(0, 0.045, 0.86);
    tip.rotation.x = -0.45;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.022, 0.14), M.ski);
    tail.position.set(0, 0.025, -0.83);
    tail.rotation.x = 0.25;
    const binding = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.34), M.binding);
    binding.position.set(0, 0.03, -0.02);
    ski.add(base, top, tip, tail, binding);
    ski.traverse((o) => (o.castShadow = true));
    root.add(ski);
    skis.push(ski);
  }

  // --- Legs: ankle -> shin -> knee -> thigh -> hip.
  const legs = [];
  for (const side of [-1, 1]) {
    const ankle = joint(root, side * STANCE, 0.11, 0);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.2, 0.3), M.boot);
    boot.position.set(0, -0.02, 0.03);
    boot.castShadow = true;
    ankle.add(boot);
    const shin = limb(0.07, 0.075, SHIN, M.pants);
    ankle.add(shin);
    const knee = joint(ankle, 0, SHIN, 0);
    const thigh = limb(0.08, 0.09, THIGH, M.pants);
    knee.add(thigh);
    legs.push({ ankle, knee, side });
  }

  // --- Torso from the hips, with the head and arms.
  const hips = joint(root, 0, 0.9, 0);
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10).scale(1.15, 0.8, 0.9), M.pants);
  pelvis.castShadow = true;
  hips.add(pelvis);
  const spine = joint(hips, 0, 0.04, 0);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, TORSO - 0.3, 6, 12).scale(1.1, 1, 0.8), M.jacket);
  body.position.y = TORSO / 2;
  body.castShadow = true;
  // Dark shoulder yoke and a zip line.
  const yoke = new THREE.Mesh(new THREE.CapsuleGeometry(0.175, 0.05, 4, 12).scale(1.12, 1, 0.82), M.trim);
  yoke.position.y = TORSO - 0.08;
  const zip = new THREE.Mesh(new THREE.BoxGeometry(0.02, TORSO - 0.12, 0.01), M.trim);
  zip.position.set(0, TORSO / 2 - 0.02, 0.142);
  spine.add(body, yoke, zip);
  const neck = joint(spine, 0, TORSO + 0.02, 0);
  const head = new THREE.Group();
  neck.add(head);
  const helmetMesh = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), M.helmet);
  helmetMesh.position.y = 0.13;
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), M.skin);
  face.position.set(0, 0.1, 0.01);
  const goggle = new THREE.Mesh(new THREE.CylinderGeometry(0.128, 0.128, 0.065, 16, 1, true, -0.9, 1.8), M.goggle);
  goggle.position.set(0, 0.12, 0.012);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.012, 6, 20), M.strap);
  strap.rotation.x = Math.PI / 2;
  strap.position.y = 0.12;
  const gaiter = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.09, 12), M.trim);
  gaiter.position.y = 0.01;
  head.add(helmetMesh, face, goggle, gaiter);
  head.traverse((o) => (o.castShadow = true));

  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = joint(spine, side * 0.2, TORSO - 0.08, 0);
    const upper = limb(0.06, 0.065, UPPER_ARM, M.jacket);
    upper.rotation.x = Math.PI; // hangs down from the shoulder
    shoulder.add(upper);
    const elbow = joint(shoulder, 0, -UPPER_ARM, 0);
    const fore = limb(0.05, 0.055, FOREARM, M.jacket);
    fore.rotation.x = Math.PI;
    elbow.add(fore);
    const hand = joint(elbow, 0, -FOREARM, 0);
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8).scale(1, 1.2, 1.1), M.glove);
    glove.castShadow = true;
    hand.add(glove);
    // Pole: from the hand down and back, grip at the hand, basket near the tip.
    const pole = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 1.15, 6).translate(0, -0.52, 0), M.pole);
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.01, 10), M.strap);
    basket.position.y = -0.98;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.14, 8), M.strap);
    grip.position.y = 0.02;
    pole.add(shaft, basket, grip);
    pole.traverse((o) => (o.castShadow = true));
    hand.add(pole);
    arms.push({ shoulder, elbow, hand, pole, side });
  }

  // --- Pose. All inputs 0..1 unless noted.
  //   crouch  knees bent (absorbing, loading a pop)
  //   tuck    racing tuck (arms forward, chest down)
  //   grab    hand reaches to the ski (mute)
  //   airArms arms out for balance in the air
  //   seated  sitting on a chairlift
  //   brake   skis and hips turned for a skid
  const p = { crouch: 0.25, tuck: 0, grab: 0, airArms: 0, seated: 0, brake: 0, plant: 0 };
  function pose(next) {
    Object.assign(p, next);
    const crouch = Math.min(1, p.crouch + 0.6 * p.tuck + 0.5 * p.grab);
    if (p.seated > 0.5) {
      // Sitting: thighs level, shins hanging, skis dangling.
      for (const L of legs) {
        L.ankle.position.set(L.side * STANCE, 0.11, 0);
        L.ankle.rotation.set(0.05, 0, 0);
        L.knee.rotation.set(-1.5, 0, 0);
      }
      for (const s of skis) s.rotation.x = 0.35;
      hips.position.set(0, 0.11 + SHIN, -THIGH);
      spine.rotation.x = -0.12;
      for (const A of arms) {
        A.shoulder.rotation.set(-0.5, 0, A.side * 0.15);
        A.elbow.rotation.set(-0.9, 0, 0);
        A.pole.rotation.set(1.2, 0, 0);
      }
      neck.rotation.x = 0.1;
      return;
    }
    for (const s of skis) s.rotation.x = 0;
    // Legs: knee bend, shin tips forward by half of it.
    const bend = 0.35 + 1.25 * crouch;
    const shinTilt = bend * 0.55;
    for (const L of legs) {
      L.ankle.position.set(L.side * STANCE, 0.11, 0);
      L.ankle.rotation.set(shinTilt, 0, 0);
      L.knee.rotation.set(-bend, 0, 0);
    }
    // Where the hips end up: shin forward, thigh back.
    const kneeZ = Math.sin(shinTilt) * SHIN;
    const kneeY = 0.11 + Math.cos(shinTilt) * SHIN;
    const thighAngle = shinTilt - bend; // from vertical, negative = back
    hips.position.set(0, kneeY + Math.cos(thighAngle) * THIGH, kneeZ + Math.sin(thighAngle) * THIGH);
    hips.rotation.set(0, p.brake * 0.5, 0);
    // Chest forward: athletic stance, much lower in a tuck or grab.
    spine.rotation.x = 0.3 + 0.35 * crouch + 0.55 * p.tuck + 0.2 * p.grab;
    neck.rotation.x = -spine.rotation.x * 0.7;
    for (const A of arms) {
      // Default: hands forward at hip height, poles trailing back.
      let sx = -0.55;
      let sz = A.side * 0.25;
      let ex = -0.55;
      let px = 0.9;
      if (p.tuck > 0) {
        sx += (-1.1 - sx) * p.tuck;
        ex += (-1.0 - ex) * p.tuck;
        sz += (A.side * 0.05 - sz) * p.tuck;
        px += (1.9 - px) * p.tuck;
      }
      if (p.airArms > 0) {
        sz += (A.side * 1.1 - sz) * p.airArms;
        sx += (-0.2 - sx) * p.airArms;
        ex += (-0.3 - ex) * p.airArms;
      }
      // Grab: the right hand drops to the left ski's binding (mute), the
      // left arm swings out for balance.
      if (p.grab > 0) {
        if (A.side < 0) {
          sx += (0.3 - sx) * p.grab;
          sz += (0.35 - sz) * p.grab;
          ex += (-0.1 - ex) * p.grab;
        } else {
          sz += (1.2 - sz) * p.grab;
        }
      }
      A.shoulder.rotation.set(sx, 0, sz);
      A.elbow.rotation.set(ex, 0, 0);
      A.pole.rotation.set(px - p.plant * 0.8, 0, 0);
    }
  }
  pose({});
  return { root, pose, params: p };
}
