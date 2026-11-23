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
import { LOOK_DEFAULT } from './settings.js';

const ANKLE_Y = 0.13;
const SHIN = 0.46;
const THIGH = 0.46;
const TORSO = 0.56;
const UPPER_ARM = 0.29;
const FOREARM = 0.27;
const STANCE = 0.12; // half the gap between the feet
export const HIP_AIR = 0.9; // hip height above the feet when standing tall

const v3 = () => new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);

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

const hex = (c) => '#' + new THREE.Color(c).getHexString();
const shade = (c, k) => hex(new THREE.Color(c).multiplyScalar(k));
const mix = (a, b, t) => hex(new THREE.Color(a).lerp(new THREE.Color(b), t));

// A fabric design painted over a w x h canvas. Seeded so a design looks the
// same every time it's built.
function paintDesign(g, w, h, design, base, trim) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  switch (design) {
    case 'colorblock': {
      g.fillStyle = trim;
      g.fillRect(0, h * 0.0, w, h * 0.34);
      g.fillStyle = '#f3f4f2';
      g.fillRect(0, h * 0.34, w, h * 0.1);
      break;
    }
    case 'camo': {
      const cols = [shade(base, 0.55), shade(base, 1.25), mix(base, trim, 0.6), shade(trim, 1.4)];
      for (let i = 0; i < 260; i++) {
        g.fillStyle = cols[i % cols.length];
        const x = rnd() * w;
        const y = rnd() * h;
        const r = 8 + rnd() * 22;
        g.beginPath();
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2;
          const rr = r * (0.6 + rnd() * 0.6);
          const px = x + Math.cos(a) * rr * 1.5;
          const py = y + Math.sin(a) * rr;
          if (k) g.lineTo(px, py);
          else g.moveTo(px, py);
        }
        g.closePath();
        g.fill();
      }
      break;
    }
    case 'check': {
      // Flannel: crossing bands of the trim colour, darker where they cross.
      g.globalAlpha = 0.45;
      g.fillStyle = trim;
      const step = w / 10;
      for (let x = 0; x < w; x += step) g.fillRect(x, 0, step * 0.42, h);
      for (let y = 0; y < h; y += step) g.fillRect(0, y, w, step * 0.42);
      g.globalAlpha = 0.25;
      g.fillStyle = '#ffffff';
      for (let x = step * 0.7; x < w; x += step) g.fillRect(x, 0, 2, h);
      for (let y = step * 0.7; y < h; y += step) g.fillRect(0, y, w, 2);
      g.globalAlpha = 1;
      break;
    }
    case 'stripes': {
      g.fillStyle = trim;
      for (const v of [0.18, 0.26, 0.34]) g.fillRect(0, h * v, w, h * 0.04);
      break;
    }
    case 'fade': {
      const grad = g.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, base);
      grad.addColorStop(1, trim);
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      break;
    }
    case 'panels': {
      g.fillStyle = trim;
      for (const u of [0.25, 0.75]) g.fillRect(w * (u - 0.07), 0, w * 0.14, h);
      g.fillRect(0, 0, w, h * 0.16);
      break;
    }
    default:
      break;
  }
  // Weave: speckle so flat colour reads as fabric.
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},0.035)`;
    g.fillRect(rnd() * w, rnd() * h, 2, 2);
  }
}

// Jacket shell: around (u) from the front centre, up (v) from the hem.
function jacketTexture(design, base, trim) {
  return canvasTex(512, 256, (g, w, h) => {
    paintDesign(g, w, h, design, hex(base), hex(trim));
    // Hem band and storm flap.
    g.fillStyle = hex(trim);
    g.fillRect(0, h * 0.93, w, h * 0.07);
    // Centre zip (front centre is at both edges of the texture).
    g.fillStyle = '#0c0d0f';
    g.fillRect(0, 0, 5, h);
    g.fillRect(w - 5, 0, 5, h);
    // Chest pocket zip.
    g.save();
    g.translate(w * 0.06, h * 0.32);
    g.rotate(-0.5);
    g.fillRect(0, 0, 46, 4);
    g.restore();
    // Seams.
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.lineWidth = 2;
    for (const v of [0.45, 0.7]) {
      g.beginPath();
      g.moveTo(0, h * v);
      g.lineTo(w, h * v);
      g.stroke();
    }
  });
}

// Pants: u around the leg, v up it. Cargo pockets sit on the outside of
// the thigh (both u = 0.25 and 0.75 so either leg gets one outside).
function pantsTexture(design, base, trim) {
  return canvasTex(256, 256, (g, w, h) => {
    paintDesign(g, w, h, design === 'cargo' ? 'solid' : design, hex(base), hex(trim));
    if (design === 'cargo') {
      for (const u of [0.25, 0.75]) {
        g.fillStyle = shade(base, 0.82);
        g.fillRect(w * (u - 0.08), h * 0.3, w * 0.16, h * 0.26);
        g.fillStyle = shade(base, 0.7);
        g.fillRect(w * (u - 0.085), h * 0.52, w * 0.17, h * 0.05);
      }
    }
    // A seam up the outside of each leg.
    g.fillStyle = 'rgba(0,0,0,0.2)';
    for (const u of [0.25, 0.75]) g.fillRect(w * u - 1, 0, 2, h);
  });
}

// Ski topsheet graphic along the ski (v runs tip to tail).
function topsheetTexture(design = 'chevron', color = '#ffc20e') {
  const c = hex(color);
  return canvasTex(64, 512, (g, w, h) => {
    g.fillStyle = '#111214';
    g.fillRect(0, 0, w, h);
    g.fillStyle = c;
    if (design === 'stripe') {
      g.fillRect(w * 0.38, 0, w * 0.24, h);
      g.fillStyle = '#f3f4f2';
      g.fillRect(w * 0.3, 0, w * 0.05, h);
      g.fillRect(w * 0.65, 0, w * 0.05, h);
    } else if (design === 'flames') {
      for (const end of [0, 1]) {
        for (let i = 0; i < 7; i++) {
          const x = (i + 0.5) * (w / 7);
          const len = 90 + ((i * 37) % 60);
          g.beginPath();
          const y0 = end ? h : 0;
          const dir = end ? -1 : 1;
          g.moveTo(x - 5, y0);
          g.quadraticCurveTo(x - 9, y0 + dir * len * 0.6, x + 2, y0 + dir * len);
          g.quadraticCurveTo(x + 4, y0 + dir * len * 0.5, x + 5, y0);
          g.fill();
        }
      }
    } else if (design === 'checker') {
      const sq = w / 4;
      for (let y = 0; y < h; y += sq) for (let x = 0; x < w; x += sq) if (((x + y) / sq) % 2 === 0) g.fillRect(x, y, sq, sq);
    } else if (design === 'wood') {
      const grad = g.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, '#8a5a32');
      grad.addColorStop(0.5, '#b07a45');
      grad.addColorStop(1, '#7c4f2b');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(60,30,10,0.35)';
      for (let i = 0; i < 14; i++) {
        g.beginPath();
        g.moveTo((i / 14) * w, 0);
        g.bezierCurveTo((i / 14) * w + 8, h * 0.3, (i / 14) * w - 8, h * 0.7, (i / 14) * w + 3, h);
        g.stroke();
      }
      g.fillStyle = c;
      g.fillRect(0, h * 0.46, w, h * 0.08);
    } else {
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
    }
  });
}

// Mirrored goggle lens with a bright sky reflection.
const LENSES = {
  sunset: ['#ffd04a', '#ff7a1a', '#a3226e', 0x3a1400],
  ice: ['#d9f4ff', '#4fb4ff', '#2340b8', 0x001a33],
  gold: ['#fff3a0', '#ffc21a', '#9a5a00', 0x2e1c00],
  smoke: ['#6c7480', '#2c3138', '#0d0f12', 0x000000],
  emerald: ['#c6ffb0', '#2fd17a', '#0b6a52', 0x00200e],
};
function lensTexture(type = 'sunset') {
  const [a, b, c] = LENSES[type] || LENSES.sunset;
  return canvasTex(128, 64, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, a);
    grad.addColorStop(0.45, b);
    grad.addColorStop(1, c);
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

// Soft fabric folds: a few crossing waves around and up the garment, so a
// sleeve or a pant leg reads as cloth rather than a pipe.
function folds(a, y, s) {
  return (
    0.55 * Math.sin(a * 3 + y * 26 + s) * Math.sin(y * 43 - a * 2 + s * 1.7) +
    0.3 * Math.sin(a * 5 - y * 19 + s * 2.3) +
    0.15 * Math.sin(a * 9 + y * 61 + s * 0.6)
  );
}

// A garment piece: a smooth lathe through the profile rings, each ring
// squashed to an oval (sx, sz by height) and rippled with folds.
//   profile  [radius, y] control points, smoothed through a spline
//   wrinkle  fold depth as a fraction of the radius
function garment(profile, { segs = 22, rings = 28, sx = 1, sz = 1, wrinkle = 0, seed = 1 } = {}) {
  const curve = new THREE.SplineCurve(profile.map(([r, y]) => new THREE.Vector2(r, y)));
  const g = new THREE.LatheGeometry(curve.getPoints(rings), segs);
  const p = g.attributes.position;
  const fx = typeof sx === 'function' ? sx : () => sx;
  const fz = typeof sz === 'function' ? sz : () => sz;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 1 + wrinkle * folds(Math.atan2(x, z), y, seed);
    p.setXYZ(i, x * fx(y) * k, y, z * fz(y) * k);
  }
  g.computeVertexNormals();
  return g;
}

// A rounded box (soft corners), for boots and gloves.
function softBox(w, h, d, r = 0.02, seg = 3) {
  const g = new THREE.BoxGeometry(w, h, d, seg * 2, seg * 2, seg * 4);
  const p = g.attributes.position;
  const hw = w / 2 - r;
  const hh = h / 2 - r;
  const hd = d / 2 - r;
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(THREE.MathUtils.clamp(v.x, -hw, hw), THREE.MathUtils.clamp(v.y, -hh, hh), THREE.MathUtils.clamp(v.z, -hd, hd));
    v.sub(c);
    if (v.lengthSq() > 1e-12) v.setLength(r);
    v.add(c);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// A band of a sphere: phi around (0 = +x, PI/2 = +z, the front), theta down
// from the top. Used for the spherical goggle lens and its frame.
function sphereBand(r, phi0, phiLen, th0, thLen, w = 32, h = 8) {
  return new THREE.SphereGeometry(r, w, h, phi0, phiLen, th0, thLen);
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

// How baggy the kit is: pants and jacket radius, and how long the jacket hangs.
const FITS = {
  slim: { pants: 0.86, jacket: 0.92, hem: -0.07 },
  regular: { pants: 1.06, jacket: 1.03, hem: 0 },
  baggy: { pants: 1.26, jacket: 1.12, hem: 0.07 },
  xxl: { pants: 1.48, jacket: 1.25, hem: 0.16 },
};

export function createSkierModel({ look = {}, envMap = null } = {}) {
  const L = { ...LOOK_DEFAULT, ...look };
  const { jacket, trim, pants, helmet } = L;
  const fit = FITS[L.fit] || FITS.regular;
  const pf = fit.pants;
  const jf = fit.jacket;
  const env = envMap ? { envMap, envMapIntensity: 0.5 } : {};
  const M = {
    jacket: new THREE.MeshPhysicalMaterial({
      map: jacketTexture(L.jacketDesign, jacket, trim),
      roughness: 0.62,
      sheen: 0.6,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color(0xffffff),
      side: THREE.DoubleSide,
      ...env,
    }),
    sleeve: new THREE.MeshPhysicalMaterial({ map: canvasTex(256, 256, (g, w, h) => paintDesign(g, w, h, L.jacketDesign === 'panels' || L.jacketDesign === 'colorblock' || L.jacketDesign === 'stripes' ? 'solid' : L.jacketDesign, hex(jacket), hex(trim))), roughness: 0.62, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffffff), side: THREE.DoubleSide, ...env }),
    trim: new THREE.MeshStandardMaterial({ color: trim, roughness: 0.7 }),
    // Knit face mask / neck gaiter: matte, slightly fuzzy.
    gaiter: new THREE.MeshPhysicalMaterial({ color: L.gaiter || trim, roughness: 0.95, sheen: 1, sheenRoughness: 0.8, sheenColor: new THREE.Color(0x3a3d42) }),
    pants: new THREE.MeshPhysicalMaterial({ map: pantsTexture(L.pantsDesign, pants, trim), roughness: 0.85, sheen: 0.4, sheenRoughness: 0.6, sheenColor: new THREE.Color(0x8899aa), side: THREE.DoubleSide }),
    bootShell: new THREE.MeshStandardMaterial({ color: L.boot, roughness: 0.32, metalness: 0.05, ...env }),
    bootDark: new THREE.MeshStandardMaterial({ color: 0x1c1f23, roughness: 0.45 }),
    buckle: new THREE.MeshStandardMaterial({ color: 0xc0c6cc, roughness: 0.25, metalness: 0.9, ...env }),
    skiBase: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.3 }),
    skiEdge: new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.25, metalness: 0.9, ...env }),
    skiTop: new THREE.MeshStandardMaterial({ map: topsheetTexture(L.skiDesign, L.skiColor), roughness: 0.25, metalness: 0.05, ...env }),
    binding: new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.35, metalness: 0.5 }),
    bindingHi: new THREE.MeshStandardMaterial({ color: L.skiColor, roughness: 0.4 }),
    helmet: new THREE.MeshStandardMaterial({ color: helmet, roughness: 0.28, metalness: 0.05, ...env }),
    lens: new THREE.MeshStandardMaterial({ map: lensTexture(L.lens), roughness: 0.08, metalness: 0.55, emissive: (LENSES[L.lens] || LENSES.sunset)[3], side: THREE.DoubleSide, ...(envMap ? { envMap, envMapIntensity: 1.2 } : {}) }),
    frame: new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.5, side: THREE.DoubleSide }),
    strap: new THREE.MeshStandardMaterial({ color: jacket, roughness: 0.7, side: THREE.DoubleSide }),
    glove: new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.75 }),
    pole: new THREE.MeshStandardMaterial({ color: 0xc9d1d9, roughness: 0.25, metalness: 0.85, ...env }),
    skin: new THREE.MeshStandardMaterial({ color: 0xd9a888, roughness: 0.7 }),
  };

  const root = new THREE.Group(); // feet on the snow
  root.name = 'player-skier';

  // --- Feet: ski, binding and boot shell stay flat; the boot cuff and leg
  // hang off the ankle above.
  const skiGeo = skiGeometry();
  const skiMats = [M.skiEdge, M.skiEdge, M.skiTop, M.skiBase, M.skiEdge, M.skiEdge];
  const legs = [];
  // Pants stack over the boot: the baggier the fit, the lower the hem sits.
  const hemY = pf > 1.3 ? -0.075 : pf > 1.1 ? -0.055 : pf > 0.95 ? -0.03 : 0.03;
  for (const side of [-1, 1]) {
    const foot = joint(root, side * STANCE, 0, 0);
    const ski = mesh(skiGeo, skiMats, foot, 0, 0.012, 0.04);
    // Binding: plate, toe piece, heel piece with its accent, tucked brakes.
    mesh(softBox(0.072, 0.02, 0.5, 0.006, 1), M.binding, ski, 0, 0.018, -0.02);
    mesh(softBox(0.082, 0.05, 0.09, 0.015, 2), M.binding, ski, 0, 0.045, 0.18);
    mesh(softBox(0.086, 0.072, 0.115, 0.018, 2), M.binding, ski, 0, 0.056, -0.215);
    mesh(new THREE.BoxGeometry(0.03, 0.012, 0.11), M.bindingHi, ski, 0, 0.094, -0.215);
    for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.008, 0.008, 0.12), M.binding, ski, s * 0.05, 0.03, -0.13);
    // Boot: a dark rubber sole with toe and heel lugs under a rounded shell.
    mesh(softBox(0.108, 0.035, 0.315, 0.01, 2), M.bootDark, foot, 0, 0.055, 0.03);
    mesh(softBox(0.114, 0.1, 0.3, 0.04, 3).translate(0, 0, 0), M.bootShell, foot, 0, 0.1, 0.035);
    mesh(softBox(0.06, 0.03, 0.06, 0.012, 2), M.bootDark, foot, 0, 0.06, 0.185); // toe lug
    // Instep buckles across the top of the foot.
    for (const z of [0.07, 0.13]) mesh(softBox(0.1, 0.012, 0.022, 0.005, 1), M.buckle, foot, 0, 0.148, z);

    const ankle = joint(foot, 0, ANKLE_Y, 0);
    // Cuff (oval, a touch taller at the back) and the tongue up the front.
    mesh(new THREE.CylinderGeometry(0.07, 0.078, 0.25, 18).scale(1, 1, 1.18).translate(0, 0.055, -0.005), M.bootShell, ankle);
    mesh(softBox(0.07, 0.22, 0.03, 0.012, 2), M.bootDark, ankle, 0, 0.07, 0.085);
    for (const y of [0.0, 0.09]) mesh(softBox(0.06, 0.014, 0.022, 0.005, 1), M.buckle, ankle, side * 0.03, y, 0.08);
    mesh(new THREE.CylinderGeometry(0.083, 0.083, 0.035, 18, 1, true).scale(1, 1, 1.18), M.bindingHi, ankle, 0, 0.17, -0.005); // power strap

    // Shin: loose pant leg flaring over the boot, with a couple of stacked
    // folds just above the hem.
    mesh(
      garment(
        [[0.118, hemY], [0.124, hemY + 0.03], [0.112, hemY + 0.065], [0.12, hemY + 0.1], [0.108, 0.13], [0.104, 0.24], [0.098, 0.36], [0.095, SHIN], [0.088, SHIN + 0.06]].map(([r, y]) => [r * pf, y]),
        { sz: 1.06, wrinkle: 0.045, seed: side * 3 + 1 },
      ),
      M.pants,
      ankle,
    );
    const knee = joint(ankle, 0, SHIN, 0);
    mesh(new THREE.SphereGeometry(0.1 * pf, 18, 12).scale(1, 1, 1.08), M.pants, knee, 0, 0, 0.004);
    // Thigh: tapering up into the seat, roomy at the top.
    const tp = Math.sqrt(pf);
    mesh(
      garment([[0.096 * pf, -0.04], [0.104 * pf, 0.06], [0.115 * pf, 0.2], [0.128 * tp, 0.35], [0.134 * tp, THIGH - 0.01], [0.118 * tp, THIGH + 0.06]], {
        sz: 1.04,
        wrinkle: 0.035,
        seed: side * 5 + 2,
      }),
      M.pants,
      knee,
    );
    legs.push({ foot, ski, ankle, knee, side });
  }

  // --- Torso from the hips, with the head and arms.
  const hips = joint(root, 0, HIP_AIR, 0);
  // Seat of the pants, a little wider than deep.
  const sp = Math.sqrt(pf);
  mesh(garment([[0.0, -0.13], [0.12 * sp, -0.115], [0.16 * sp, -0.05], [0.162 * sp, 0.03], [0.14 * sp, 0.1], [0.0, 0.12]], { sx: 1.1, sz: 0.8, rings: 16 }), M.pants, hips);
  const spine = joint(hips, 0, 0.04, 0);
  // Jacket shell: a long, boxy cut that hangs over the seat with a slight
  // flare at the hem, broad dropped shoulders, chest a little forward.
  const hem = -0.25 - fit.hem;
  const shoulderW = (y) => 1 + 0.14 * THREE.MathUtils.smoothstep(y, 0.05, 0.42) - 0.12 * THREE.MathUtils.smoothstep(y, 0.47, 0.56);
  const depth = (y) => 0.74 + 0.12 * (1 - THREE.MathUtils.smoothstep(y, 0.0, 0.2));
  mesh(
    garment(
      [[0.222 * jf, hem], [0.226 * jf, hem + 0.035], [0.214 * jf, hem + 0.09], [0.208 * jf, -0.04], [0.204 * jf, 0.1], [0.21 * jf, 0.24], [0.215 * jf, 0.36], [0.208 * jf, 0.45], [0.17 * jf, 0.515], [0.11, 0.55], [0.085, 0.56]],
      { segs: 28, rings: 40, sx: shoulderW, sz: depth, wrinkle: 0.025, seed: 9 },
    ),
    M.jacket,
    spine,
  );
  // Funnel collar zipped to the chin.
  mesh(garment([[0.1, -0.02], [0.098, 0.05], [0.104, 0.11], [0.108, 0.12]], { sz: 1.02, rings: 8, segs: 20 }), M.sleeve, spine, 0, TORSO - 0.01, 0.01);
  // Hood down: bunched on the shoulders behind the collar.
  if (L.hood !== 'up') {
    mesh(new THREE.TorusGeometry(0.1, 0.045, 10, 18, Math.PI * 1.1).rotateX(Math.PI / 2 + 0.35).rotateY(Math.PI - 0.15 * Math.PI), M.sleeve, spine, 0, TORSO + 0.005, -0.04);
    mesh(new THREE.SphereGeometry(0.1, 16, 10).scale(1.25, 0.55, 0.6), M.sleeve, spine, 0, TORSO - 0.03, -0.12);
  }
  const neck = joint(spine, 0, TORSO + 0.03, 0.01);
  const head = new THREE.Group();
  neck.add(head);
  mesh(new THREE.SphereGeometry(0.1, 18, 14).scale(0.92, 1.1, 1.0), M.skin, head, 0, 0.1, 0.012);
  // Face mask pulled up to the goggles.
  mesh(garment([[0.098, -0.03], [0.1, 0.02], [0.104, 0.07], [0.095, 0.1], [0.07, 0.12]], { sz: 1.08, rings: 12, segs: 20, wrinkle: 0.03, seed: 4 }), M.gaiter, head, 0, 0, 0.012);
  // Helmet: low-profile shell dropping over the ears, with a small brim.
  mesh(new THREE.SphereGeometry(0.138, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.56).scale(1.0, 0.94, 1.12), M.helmet, head, 0, 0.12, -0.008);
  for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.06, 14, 10).scale(0.42, 1, 1.05), M.helmet, head, s * 0.128, 0.09, -0.015);
  mesh(new THREE.CylinderGeometry(0.152, 0.155, 0.014, 28, 1, false, -0.85, 1.7).scale(1, 1, 1.12), M.helmet, head, 0, 0.185, -0.008);
  // Big frameless spherical goggles, wider than the face, strap round the helmet.
  const gy = 0.125;
  mesh(sphereBand(0.148, Math.PI / 2 - 1.2, 2.4, Math.PI / 2 - 0.33, 0.66).scale(1.05, 1, 1.16), M.frame, head, 0, gy, 0.0);
  mesh(sphereBand(0.152, Math.PI / 2 - 1.12, 2.24, Math.PI / 2 - 0.29, 0.58).scale(1.05, 1, 1.16), M.lens, head, 0, gy, 0.0);
  mesh(new THREE.CylinderGeometry(0.145, 0.145, 0.042, 28, 1, true, 1.2, Math.PI * 2 - 2.4).scale(1.02, 1, 1.12), M.strap, head, 0, gy + 0.008, -0.008);
  // Hood up, over the helmet: open at the face.
  if (L.hood === 'up') {
    mesh(
      new THREE.SphereGeometry(0.168, 28, 16, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9, 0, Math.PI * 0.78).scale(1.04, 1.02, 1.1),
      M.sleeve,
      head,
      0,
      0.115,
      -0.012,
    );
    mesh(garment([[0.15, -0.08], [0.16, 0.0], [0.16, 0.06]], { sx: 1.1, sz: 1.05, rings: 6, segs: 22, wrinkle: 0.05, seed: 7 }), M.sleeve, head, 0, 0.0, -0.03);
  }

  // --- Arms: shoulder -> upper arm -> elbow -> forearm -> hand.
  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = joint(spine, side * 0.2, TORSO - 0.1, -0.005);
    mesh(new THREE.SphereGeometry(0.088 * jf, 18, 12), M.sleeve, shoulder);
    const upper = mesh(garment([[0.084 * jf, -0.02], [0.082 * jf, 0.08], [0.076 * jf, UPPER_ARM - 0.02], [0.07 * jf, UPPER_ARM + 0.03]], { wrinkle: 0.05, seed: side * 2 + 11, segs: 18, rings: 16 }), M.sleeve, shoulder);
    upper.rotation.x = Math.PI; // hangs down from the shoulder
    const elbow = joint(shoulder, 0, -UPPER_ARM, 0);
    mesh(new THREE.SphereGeometry(0.071 * jf, 16, 10), M.sleeve, elbow);
    // Forearm, ending in a roomy cuff pulled over the glove's gauntlet.
    const fore = mesh(garment([[0.068 * jf, -0.01], [0.07 * jf, 0.06], [0.064 * jf, FOREARM - 0.08], [0.074 * jf, FOREARM - 0.03], [0.072 * jf, FOREARM - 0.005]], { wrinkle: 0.06, seed: side * 2 + 13, segs: 18, rings: 16 }), M.sleeve, elbow);
    fore.rotation.x = Math.PI;
    const hand = joint(elbow, 0, -FOREARM, 0);
    // Mitt: gauntlet, a soft rounded mitt and a thumb.
    mesh(new THREE.CylinderGeometry(0.06, 0.054, 0.08, 14), M.glove, hand, 0, 0.015, 0);
    mesh(softBox(0.085, 0.12, 0.065, 0.03, 3), M.glove, hand, 0, -0.06, 0.008);
    mesh(new THREE.CapsuleGeometry(0.018, 0.04, 4, 8).rotateZ(side * 0.5), M.glove, hand, -side * 0.04, -0.04, 0.03);
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
  //   fallen   lying in the snow after a crash: legs long, arms flung out
  const p = {
    crouch: 0.25, tuck: 0, fold: 0, air: 0, grab: 0, grabType: 'mute', airArms: 0, seated: 0,
    lean: 0, twist: 0, look: 0, plantL: 0, plantR: 0, wobble: 0, t: 0, press: 0, fallen: 0,
  };
  const tgt = v3();
  const tw = v3();
  const poleV = v3();
  const dir = v3();
  const hipPos = v3();
  const off = v3();
  const grabTgt = v3();

  // Hip offset above a foot for shin tilt s and thigh angle a (from vertical,
  // negative = hip behind the knee).
  function legOffset(s, a, out) {
    return out.set(0, ANKLE_Y + Math.cos(s) * SHIN + Math.cos(a) * THIGH, Math.sin(s) * SHIN + Math.sin(a) * THIGH);
  }

  function pose(next) {
    Object.assign(p, next);
    const seated = p.seated > 0.5;
    const crouch = Math.min(1, p.crouch + 0.6 * p.tuck);
    const grabbing = !seated && p.grab > 0;
    const gSide = grabHand(p.grabType);
    const [gx, gz] = grabPoint(p.grabType, gSide);
    const gLeg = gx < 0 ? 0 : 1;
    const tail = p.grabType === 'tail';
    // Leg angles: shin tilt s and thigh angle a (see legOffset).
    let s0;
    let a0;
    if (seated) {
      s0 = 0.05;
      a0 = -1.5;
    } else {
      const bend = 0.35 + 1.25 * crouch;
      s0 = 0.55 * bend;
      a0 = s0 - bend;
      const fold = Math.min(1, p.fold + 0.8 * p.grab);
      s0 += (0.85 - s0) * fold;
      a0 += (-1.65 - a0) * fold;
      if (p.fallen > 0) {
        // Lying back with the knees up and the skis flat on the snow.
        s0 += (0.2 - s0) * p.fallen;
        a0 += (-2.1 - a0) * p.fallen;
      }
    }
    legOffset(s0, a0, off);
    // Hips: planted feet put them at `off`; in the air they sit at HIP_AIR.
    const airK = seated ? 1 : p.air;
    if (seated) hipPos.set(0, ANKLE_Y + SHIN, -THIGH);
    else hipPos.set(0, off.y + (HIP_AIR - off.y) * airK, off.z * (1 - airK));
    hips.position.copy(hipPos);

    // Body shape. For a grab this is solved below: the grabbed leg is pulled
    // up to the hand first (knee to the chest, or the foot kicked back for a
    // tail grab), and only then does the back bend (or straighten) to close
    // the gap, so the skier stays as upright as the grab allows.
    const fwd0 = seated ? -0.12 : (1 - p.fallen) * 0.28 + 0.35 * crouch + 0.5 * p.tuck + 0.45 * Math.min(1, p.fold) + 0.15 * p.press;
    const gTwist = grabbing ? p.grab * (p.grabType === 'mute' ? 0.4 : tail ? 0.45 : -0.15) : 0;
    const tweak = grabbing ? grabTweak(p.grabType) * p.grab : 0;
    function shape(pull, fwd) {
      for (let i = 0; i < 2; i++) {
        const L = legs[i];
        let s = s0;
        let a = a0;
        if (grabbing && i === gLeg && pull > 0) {
          const k = pull * p.grab;
          s += ((tail ? 1.5 : 1.35) - s) * k;
          a += ((tail ? -1.45 : -1.95) - a) * k;
        }
        legOffset(s, a, off);
        // A pitched foot (tweaked ski, or flat on the snow after a fall)
        // carries the whole leg with it, so turn the offset the same way.
        const pitch = seated ? 0.35 : tweak + 1.4 * p.fallen;
        if (!seated) off.applyAxisAngle(X_AXIS, pitch);
        L.foot.position.set(L.side * (STANCE + 0.12 * p.fallen), hipPos.y - off.y, hipPos.z - off.z);
        L.foot.rotation.set(pitch, 0, 0);
        L.ankle.rotation.set(s, 0, -p.lean * 0.18 + L.side * 0.2 * p.fallen);
        L.knee.rotation.set(a - s, 0, 0);
      }
      if (seated) spine.rotation.set(fwd, 0, 0);
      else spine.rotation.set(fwd, p.twist * 0.6 + gTwist, p.lean * 0.45);
      root.updateMatrixWorld(true);
    }
    const gArm = arms.find((A) => A.side === gSide);
    function grabTarget() {
      // A point beside the ski's edge, in the ski's own frame so a tweaked
      // ski carries the hand with it; returned in the spine's frame.
      const L = legs[gLeg];
      grabTgt.set((gx < 0 ? -1 : 1) * 0.075, 0.1, gz + 0.04);
      L.foot.localToWorld(grabTgt);
      spine.worldToLocal(grabTgt);
      return grabTgt.distanceTo(gArm.shoulder.position) <= (UPPER_ARM + FOREARM) * 0.97;
    }
    let pull = 0;
    let fwd = grabbing ? (tail ? fwd0 * (1 - 0.4 * p.grab) : fwd0 + 0.2 * p.grab) : fwd0;
    shape(pull, fwd);
    if (grabbing) {
      for (let k = 0; k < 14 && !grabTarget(); k++) {
        if (pull < 1) pull = Math.min(1, pull + 0.2);
        else fwd = tail ? Math.max(0.05, fwd - 0.08) : fwd + 0.07;
        shape(pull, fwd);
      }
    }

    // Arms by hand targets in the spine's frame.
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
        if (p.fallen > 0) tgt.lerp(tw.set(sd * 0.62, 0.42, 0.06), p.fallen);
        if (p.wobble > 0) {
          const ph = p.t * 13 + sd * 1.7;
          tgt.lerp(tw.set(sd * (0.45 + 0.2 * Math.sin(ph)), 0.35 + 0.25 * Math.cos(ph), 0.15 * Math.sin(ph * 0.7)), p.wobble);
        }
      }
      if (grabbing && sd === gSide) tgt.lerp(grabTgt, p.grab);
      else if (grabbing) tgt.lerp(tw.set(sd * 0.6, 0.38, tail ? 0.2 : -0.08), p.grab); // free arm out for balance
      // Elbows point out and back.
      poleV.set(sd * 0.8, -0.3, -0.6);
      reach(A, tgt, poleV);
    }
    // Head up, eyes on the landing, after any extra bend for a grab.
    neck.rotation.set(-spine.rotation.x * 0.75 + (seated ? 0.1 : 0), p.look + p.twist * 0.3, -spine.rotation.z * 0.5);
    // Poles trail back and down; a plant swings the tip forward to the snow.
    root.updateMatrixWorld(true);
    for (const A of arms) {
      const sd = A.side;
      const plant = seated ? 0 : sd > 0 ? p.plantL : p.plantR;
      if (seated) dir.set(sd * 0.1, -0.6, 1);
      else if (p.tuck > 0.5) dir.set(sd * 0.1, -0.25, -1);
      else dir.set(sd * 0.15, -1, -0.65).lerp(tw.set(sd * 0.2, -1, 0.35), plant);
      if (p.airArms > 0 && !seated) dir.lerp(tw.set(sd * 0.4, -1, -0.4), p.airArms * 0.5);
      // While grabbing, both poles swing back out of the way, along the ski.
      if (grabbing) dir.lerp(tw.set(sd * 0.35, -0.35, -1), p.grab);
      aimPole(A, dir);
    }
  }
  // Ski pitch for each grab (nose down): japan and tail grabs pull the tails up behind.
  function grabTweak(type) {
    return type === 'japan' ? 0.4 : type === 'tail' ? 0.6 : type === 'mute' ? 0.15 : 0;
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
        return [side, -0.32];
      default:
        return [-side, 0.22]; // mute: across to the other ski, in front of the boot
    }
  }

  pose({});
  // Skis on or off the boots (they come off in a big crash).
  function setSkis(on) {
    for (const L of legs) L.ski.visible = on;
  }
  // Free the GPU side when this rider is swapped for a new look.
  function dispose() {
    const seen = new Set();
    root.traverse((o) => {
      if (!o.isMesh) return;
      for (const x of [o.geometry, ...[].concat(o.material)]) {
        if (!x || seen.has(x)) continue;
        seen.add(x);
        x.map?.dispose();
        x.dispose();
      }
    });
  }
  return { root, pose, params: p, setSkis, dispose, rig: { arms, legs, spine } };
}
