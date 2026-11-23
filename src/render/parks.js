// Terrain parks along the real park lines from OpenStreetMap: tabletop
// jumps, rails and boxes, kids' rollers, the half pipe, and a banner at the
// top of each park. Snow features are meshes draped on the terrain.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PARKS } from '../data/mountain.js';
import { along, beside } from '../world/path.js';
import { seededRandom } from '../world/noise.js';
import { addSparkle } from './sparkle.js';

// Woodward colours, from Mt. Bachelor's park photos: black steel, yellow
// panels with black lettering, white slide surfaces, timber A-frames.
const WW_YELLOW = '#ffc20e';
const WW_BLACK = '#131416';
const CORD = 2.4; // meters per corduroy texture tile

// Jump sizes. H: lip height above the slope; lip: takeoff angle; land:
// landing angle (both degrees from horizontal); D: deck (table) length;
// W: width. Riders' speed isn't fixed: each jump works out the speed that
// puts a straight air on the sweet spot of its landing.
const JUMPS = {
  xs: { H: 0.55, lip: 18, land: 28, D: 2.5, W: 3.5 },
  s: { H: 0.9, lip: 22, land: 31, D: 4.5, W: 4.5 },
  m: { H: 1.4, lip: 25, land: 33, D: 7, W: 6 },
  l: { H: 2.0, lip: 27, land: 34, D: 10, W: 8 },
  xl: { H: 3.0, lip: 30, land: 36, D: 15, W: 11 },
  // Contest size, X Games style: a tall steep lip, a long table dug out in
  // the middle (a gap: come up short and you case the far wall), and a
  // long steep landing.
  xxl: { H: 3.8, lip: 32, land: 37, D: 20, W: 13, gap: true },
};
const smooth = (t) => t * t * (3 - 2 * t);
const G = 9.81;
const DEG = Math.PI / 180;
const clamp01 = (t) => Math.max(0, Math.min(1, t));

// A tabletop built for the slope it sits on (tA = tan of the fall-line
// slope, downhill positive). Worked out in absolute terms along the fall
// line, x from the start of the kicker, ground y = -tA x:
//   kicker  curves up from the slope to the lip angle (sharp lip),
//   deck    near-level table (follows the slope a little where it's steep),
//   knuckle rounded,
//   landing straight at the landing angle down to the slope,
//   run-out blends back into the slope.
// h(x) is the snow built up above the natural slope.
function jumpProfile(J, tA = 0.2, deckScale = 1) {
  // Landings must be steeper than the slope, or there's nothing to land on.
  const tB = Math.max(Math.tan(J.land * DEG), tA + 0.25);
  return buildJump(J, tA, deckScale, tB);
}

function buildJump(J, tA, deckScale, tB) {
  const tL = Math.tan(J.lip * DEG);
  const tDeck = Math.max(0, tA - 0.14); // decks stay near level
  const ground = (x) => -tA * x;
  const R = (2.2 * J.H) / (tL + tA); // kicker length for the lip angle
  const xL = R;
  const yL = J.H + ground(xL);
  const GAP = 1.0; // the lip drops onto the table
  const xD = xL + GAP;
  const yD0 = yL - 0.25;
  const xK = xD + J.D * deckScale;
  const deckTop = (x) => yD0 - tDeck * (x - xD);
  // Gap jumps: the middle of the table is cut away with steep walls.
  const gapDepth = J.gap ? J.H * 0.85 : 0;
  const deck = (x) => {
    if (!gapDepth) return deckTop(x);
    const w = 2.2; // wall run
    const u = Math.min(clamp01((x - xD - 2.5) / w), clamp01((xK - 3.5 - x) / w));
    return deckTop(x) - gapDepth * smooth(u);
  };
  const yK = deckTop(xK);
  const hK = yK - ground(xK); // table height above the slope at the knuckle
  // Landing: straight at the landing angle for the top 60% of its drop,
  // then a long smooth curve out onto the slope.
  const m0 = tB - tA; // steepness relative to the slope
  const Ls = (0.72 * hK) / m0;
  const h1 = 0.28 * hK;
  const Lt = (2.4 * h1) / m0;
  const xEnd = xK + Ls + Lt;
  const relLand = (x) => {
    if (x < xK + Ls) return hK - m0 * (x - xK);
    const u = clamp01((x - xK - Ls) / Lt);
    const h00 = 2 * u * u * u - 3 * u * u + 1;
    const h10 = u * u * u - 2 * u * u + u;
    return h1 * h00 - m0 * Lt * h10;
  };
  const length = xEnd + 1;
  const abs = (x) => {
    if (x < xL) return ground(x) + J.H * Math.pow(x / R, 2.2);
    if (x < xD) return yL + (yD0 - yL) * smooth((x - xL) / GAP);
    // Rounded knuckle: blend deck into landing over 1.6 m.
    if (x < xK - 0.8) return deck(x);
    const landAbs = ground(x) + relLand(x);
    if (x < xK + 0.8) return deckTop(x) + (landAbs - deckTop(x)) * smooth((x - xK + 0.8) / 1.6);
    return landAbs;
  };
  // Sweet spot about a third of the way down the straight part, and the
  // takeoff speed whose straight air comes down on it.
  const xS = xK + Math.max(1.8, 0.5 * Ls);
  // Where a straight air at speed v first touches the snow.
  const cos2 = 1 / (1 + tL * tL);
  const touchdown = (v) => {
    for (let x = xL + 0.1; x < length + 30; x += 0.1) {
      const d = x - xL;
      if (yL + tL * d - (G * d * d) / (2 * v * v * cos2) <= abs(x)) return x;
    }
    return Infinity;
  };
  // The takeoff speed that lands on the sweet spot (bisection).
  let lo = 2;
  let hi = 35;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (touchdown(mid) < xS) lo = mid;
    else hi = mid;
  }
  const v = (lo + hi) / 2;
  const d = xS - xL;
  const impactAngle = -Math.atan(tL - (G * d) / (v * v * cos2));
  return {
    length,
    height: Math.max(J.H, hK),
    h: (x) => Math.max(0, abs(x) - ground(x)),
    lip: { x: xL, h: J.H, angle: Math.atan(tL), v },
    knuckle: xK,
    sweet: xS,
    impactAngle,
  };
}

// Hip: a kicker straight down the fall line whose landing swings off to one
// side (side = +1 right, -1 left), so riders turn in the air.
function hipProfile(J, side, tA) {
  const base = jumpProfile(J, tA, 0.35);
  const x0 = base.lip.x * 0.7;
  return {
    ...base,
    shift: (a) => side * J.W * 0.9 * smooth(clamp01((a - x0) / (base.length - x0))),
    // The landing banks down toward the outside.
    cross: (a, u) => (a < base.lip.x ? 1 : 1 - 0.35 * side * u * clamp01((a - base.lip.x) / 4)),
  };
}

// Little take-off deck in front of a rail or box.
// Built up to just under the feature's start so you ride straight onto it.
const deckFor = (H) => ({
  length: 5,
  height: H,
  h: (a) => (a < 3 ? H * smooth(a / 3) : a < 4.2 ? H : H * (1 - smooth((a - 4.2) / 0.8))),
});
const jibDeck = deckFor(0.7);

// Smooth whoops.
const rollers = (n, H, span) => ({
  length: n * span,
  height: H,
  h: (a) => H * Math.pow(Math.sin((Math.PI * a) / span), 2),
});

// Banked turn: the lane swings to one side and the snow banks up on the
// outside of the turn.
function bermProfile(side, H = 1.8, L = 18) {
  return {
    length: L,
    height: H,
    h: (a) => H * Math.pow(Math.max(0, Math.sin((Math.PI * a) / L)), 0.7),
    shift: (a) => side * 3.5 * Math.sin((Math.PI * a) / L),
    cross: (a, u) => 0.08 + Math.pow(Math.max(0, -side * u), 1.6),
  };
}

// Quarterpipe facing uphill: a round transition up to a near-vertical lip,
// a short deck, then the back side down to the slope.
function qpProfile(R = 3.2) {
  return {
    length: R + 2 + 5,
    height: R,
    h(a) {
      if (a < R) return R - Math.sqrt(Math.max(0, R * R - a * a));
      if (a < R + 2) return R;
      return R * (1 - smooth((a - R - 2) / 5));
    },
  };
}

// Peace Park's "big wave": a long curling wall of snow on one side of the
// lane that riders carve up and slash.
function waveProfile(side, H = 3.4, L = 26) {
  return {
    length: L,
    height: H,
    h: (a) => H * Math.pow(Math.max(0, Math.sin((Math.PI * a) / L)), 0.8) * (0.85 + 0.15 * Math.sin(a / 2.2)),
    cross: (a, u) => Math.pow(Math.max(0, side * u), 2.2),
  };
}

// Spine: two transitions back to back with a sharp ridge on top.
const spineProfile = {
  length: 11,
  height: 1.7,
  h: (a) => 1.7 * Math.pow(Math.max(0, 1 - Math.abs(a - 5.5) / 5.5), 1.6),
};

// Accumulates draped snow features into one geometry.
class SnowBuilder {
  constructor(hf) {
    this.hf = hf;
    this.pos = [];
    this.uv = [];
    this.idx = [];
  }
  // A profile h(a) laid along a run from distance s0, centered `offset`
  // meters sideways, `width` wide, with sloped sides.
  drape(run, s0, offset, width, profile) {
    const { hf } = this;
    // Shaped features have firm, steep sidewalls (~50 degrees), cut sharper
    // the bigger the feature, like a contest build.
    const side = Math.max(0.8, profile.height * (profile.height > 2.5 ? 0.75 : 1.0));
    const na = Math.max(4, Math.ceil(profile.length / 0.5));
    const cs = profile.cross
      ? [-width / 2 - side, -width / 2, -width * 0.375, -width / 4, -width / 8, 0, width / 8, width / 4, width * 0.375, width / 2, width / 2 + side]
      : [-width / 2 - side, -width / 2, -width / 4, 0, width / 4, width / 2, width / 2 + side];
    const base = this.pos.length / 3;
    const p = {};
    for (let i = 0; i <= na; i++) {
      const a = (i / na) * profile.length;
      const h = profile.h(a);
      for (const c of cs) {
        const shift = profile.shift ? profile.shift(a) : 0;
        beside(run, s0 + a, offset + shift + c, p);
        const u = Math.max(-1, Math.min(1, c / (width / 2)));
        const k = Math.abs(c) <= width / 2 ? 1 : 1 - (Math.abs(c) - width / 2) / side;
        const cross = profile.cross ? profile.cross(a, u) : 1;
        this.pos.push(p.x, hf.heightAt(p.x, p.z) + h * k * cross - 0.15, p.z);
        // Corduroy runs down the fall line: u across, v along.
        this.uv.push((offset + shift + c) / CORD, (s0 + a) / CORD);
      }
    }
    const nc = cs.length;
    for (let i = 0; i < na; i++) {
      for (let j = 0; j < nc - 1; j++) {
        const a = base + i * nc + j;
        const b = a + nc;
        this.idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  // The half pipe: flat floor, quarter-circle walls, decks and outer banks.
  pipe(run, s0, length, { floor = 9, R = 4, deck = 3.5, bank = 8 } = {}) {
    const { hf } = this;
    const half = floor / 2;
    const cs = [];
    const edge = half + R + deck + bank;
    for (let k = 0; k <= 60; k++) cs.push(-edge + (2 * edge * k) / 60);
    // Extra samples in the transitions so the curve is round.
    for (let k = 1; k < 12; k++) {
      const c = half + (R * k) / 12;
      cs.push(c, -c);
    }
    cs.sort((a, b) => a - b);
    const prof = (c) => {
      const x = Math.abs(c);
      if (x <= half) return 0;
      if (x <= half + R) {
        const u = x - half;
        return R - Math.sqrt(Math.max(0, R * R - u * u));
      }
      if (x <= half + R + deck) return R;
      return R * (1 - smooth((x - half - R - deck) / bank));
    };
    // A real pipe is cut dead straight on an even grade: run it along the
    // chord from the top of the line to the bottom, with the floor on a
    // straight slope between the two ends.
    const A = along(run, s0, {});
    const B = along(run, s0 + length, {});
    const L = Math.hypot(B.x - A.x, B.z - A.z);
    const dx = (B.x - A.x) / L;
    const dz = (B.z - A.z) / L;
    const yA = hf.heightAt(A.x, A.z);
    const yB = hf.heightAt(B.x, B.z);
    const na = Math.ceil(L / 1.5);
    // Lift the line just enough that no bump of natural ground pokes
    // through the floor (the pipe is built up out of snow there).
    let lift = 0;
    for (let i = 0; i <= na; i++) {
      const t = i / na;
      for (const c of [-half - R, -half, 0, half, half + R]) {
        const g = hf.heightAt(A.x + dx * L * t - dz * c, A.z + dz * L * t + dx * c);
        const floor = yA + (yB - yA) * t + (Math.abs(c) > half ? R * 0.3 : 0);
        lift = Math.max(lift, g - floor + 0.3);
      }
    }
    const base = this.pos.length / 3;
    for (let i = 0; i <= na; i++) {
      const a = (i / na) * L;
      const taper = smooth(Math.min(1, a / 10)) * smooth(Math.min(1, (L - a) / 6));
      const yc = yA + (yB - yA) * (a / L) + lift;
      for (const c of cs) {
        const px = A.x + dx * a - dz * c;
        const pz = A.z + dz * a + dx * c;
        const outer = Math.max(0, (Math.abs(c) - half - R - deck) / bank);
        const ground = hf.heightAt(px, pz);
        // Inside the pipe everything hangs off the straight floor line; the
        // outer banks blend back to the natural slope.
        const y = (yc + prof(c) * taper) * (1 - outer) + (ground + prof(c) * taper) * outer;
        this.pos.push(px, y + 0.05, pz);
        this.uv.push(c / CORD, (s0 + a) / CORD);
      }
    }
    const nc = cs.length;
    for (let i = 0; i < na; i++) {
      for (let j = 0; j < nc - 1; j++) {
        const a = base + i * nc + j;
        const b = a + nc;
        this.idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  mesh(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    m.castShadow = true;
    return m;
  }
}

// A box spanning two points (rails, boxes, posts).
function spanBox(a, b, w, h) {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(w, h, len);
  const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0));
  m.setPosition(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5));
  return g.applyMatrix4(m);
}
function spanTube(a, b, r) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, 8).rotateX(Math.PI / 2);
  const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0));
  m.setPosition(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5));
  return g.applyMatrix4(m);
}


// ---------------------------------------------------------------- textures
function canvasTex(w, h, draw, repeat = false) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Freshly groomed corduroy: fine ridges running down the fall line.
function corduroyTexture() {
  return canvasTex(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 8) {
      const g = ctx.createLinearGradient(x, 0, x + 8, 0);
      g.addColorStop(0, 'rgba(150,170,195,0.0)');
      g.addColorStop(0.5, 'rgba(150,170,195,0.22)');
      g.addColorStop(1, 'rgba(150,170,195,0.0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 8, h);
    }
  }, true);
}

// Box side: black steel with the yellow WOODWARD panel.
function boxSideTexture() {
  return canvasTex(1024, 64, (ctx, w, h) => {
    ctx.fillStyle = '#2a2c30';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = WW_YELLOW;
    ctx.fillRect(w * 0.42, 4, w * 0.56, h - 8);
    ctx.fillStyle = WW_BLACK;
    ctx.font = 'italic 900 50px "Barlow Condensed", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('WOODWARD', w * 0.7, h / 2 + 3);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, 0, w, 3);
  });
}

// Weathered timber planks for the A-frames and wallride.
function plankTexture(base = '#8a4b2f') {
  return canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) {
      ctx.fillStyle = `rgba(0,0,0,${0.08 + ((y * 37) % 5) * 0.03})`;
      ctx.fillRect(0, y, w, 32);
      ctx.fillStyle = 'rgba(30,15,8,0.55)';
      ctx.fillRect(0, y, w, 3);
    }
    for (let k = 0; k < 120; k++) {
      ctx.fillStyle = `rgba(255,220,190,${0.03 + (k % 4) * 0.01})`;
      ctx.fillRect((k * 53) % w, (k * 97) % h, 40 + (k % 5) * 10, 1);
    }
  }, true);
}

// A box (or battleship) segment from a to b: black steel body, white slide
// top, yellow WOODWARD panel on the sides. BoxGeometry faces: +x, -x, +y,
// -y, +z, -z; after lookAt the box's z runs along the segment.
function boxSegment(a, b, w, h, mats) {
  return new THREE.Mesh(spanBox(a, b, w, h), [mats.side, mats.side, mats.top, mats.body, mats.body, mats.body]);
}

// A-frame "rooftop" jib: two sloping timber planes meeting at a steel ridge,
// its eaves buried in the snow, with gable ends.
function roofGeometry(a, b, halfW, rise) {
  const len = a.distanceTo(b);
  const slope = Math.hypot(halfW, rise);
  const ang = Math.atan2(rise, halfW);
  const parts = [];
  for (const side of [-1, 1]) {
    parts.push(
      new THREE.BoxGeometry(slope, 0.06, len)
        .translate((side * slope) / 2, 0, 0)
        .rotateZ(side * -ang)
        .translate(0, rise, 0),
    );
  }
  const gable = new THREE.Shape([new THREE.Vector2(-halfW, 0), new THREE.Vector2(halfW, 0), new THREE.Vector2(0, rise)]);
  for (const z of [-len / 2, len / 2]) parts.push(new THREE.ShapeGeometry(gable).translate(0, 0, z));
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0));
  m.setPosition(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5));
  return g.applyMatrix4(m);
}

// Banners glow a little so they read even with the sun behind them.
export function bannerMaterial(text, bg, stripe) {
  const map = bannerTexture(text, bg, stripe);
  return new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.55, side: THREE.DoubleSide, roughness: 0.7 });
}

export function bannerTexture(text, bg = WW_BLACK, stripe = WW_YELLOW) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = stripe;
  ctx.fillRect(0, 0, c.width, 14);
  ctx.fillRect(0, c.height - 14, c.width, 14);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 72px "Barlow Condensed", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (stripe === WW_YELLOW) {
    // Woodward park banner: yellow "W" block, then the park name.
    ctx.fillStyle = WW_YELLOW;
    ctx.fillRect(28, 26, 76, 76);
    ctx.fillStyle = WW_BLACK;
    ctx.font = '900 66px "Barlow Condensed", Impact, sans-serif';
    ctx.fillText('W', 66, 68);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 72px "Barlow Condensed", Impact, sans-serif';
    ctx.fillText(text.toUpperCase(), c.width / 2 + 40, c.height / 2 + 4);
  } else ctx.fillText(text.toUpperCase(), c.width / 2, c.height / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}


// Woodward size sign: black board, yellow size rating, park name.
function sizeSignTexture(name, size, lift) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 320;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#111417';
  ctx.fillRect(0, 0, 256, 320);
  ctx.strokeStyle = WW_YELLOW;
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, 240, 304);
  ctx.fillStyle = WW_YELLOW;
  ctx.beginPath();
  ctx.ellipse(128, 120, 92, 74, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#111417';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${size.length > 3 ? 50 : 76}px "Barlow Condensed", Impact, sans-serif`;
  ctx.fillText(size, 128, 124);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 34px "Barlow Condensed", Impact, sans-serif';
  ctx.fillText(name.toUpperCase(), 128, 232, 230);
  ctx.fillStyle = '#9aa4ad';
  ctx.font = '600 22px "Barlow Condensed", Impact, sans-serif';
  if (lift) ctx.fillText(`WOODWARD · ${lift.toUpperCase()}`, 128, 274, 230);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Jib shapes: [distance along, height above the snow] down the feature.
const RAILS = {
  flat: [[0, 0.7], [8, 0.7]],
  down: [[0, 1.05], [9, 0.35]],
  dfd: [[0, 1.2], [3, 0.75], [6.5, 0.95], [10, 0.4]],
  kink: [[0, 1.0], [3.5, 0.6], [6, 0.95], [10, 0.45]],
  rainbow: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((a) => [a, 0.55 + 0.9 * Math.sin((Math.PI * a) / 8)]),
};
const BOXES = {
  flat: [[0, 0.55], [9, 0.55]],
  down: [[0, 0.95], [9, 0.35]],
  'ride-on': [[0, 0.12], [6, 0.12]],
};
const HULL = [[0, 0.25], [2.5, 1.2], [7.5, 1.2], [10, 0.25]];


// The shaped snow as a height lookup (for skiing on it): every triangle of
// the park mesh rasterized into sparse 0.5 m tiles, keeping the highest.
class HeightTiles {
  constructor(cell = 0.5, n = 64) {
    this.cell = cell;
    this.n = n;
    this.tiles = new Map();
  }
  tile(ti, tj, make) {
    const key = ti * 100003 + tj;
    let t = this.tiles.get(key);
    if (!t && make) {
      t = new Float32Array(this.n * this.n).fill(-Infinity);
      this.tiles.set(key, t);
    }
    return t;
  }
  get(i, j) {
    const { n } = this;
    const ti = Math.floor(i / n);
    const tj = Math.floor(j / n);
    const t = this.tile(ti, tj, false);
    return t ? t[(j - tj * n) * n + (i - ti * n)] : -Infinity;
  }
  set(i, j, y) {
    const { n } = this;
    const ti = Math.floor(i / n);
    const tj = Math.floor(j / n);
    const t = this.tile(ti, tj, true);
    const k = (j - tj * n) * n + (i - ti * n);
    if (y > t[k]) t[k] = y;
  }
  triangle(ax, ay, az, bx, by, bz, cx, cy, cz) {
    const c = this.cell;
    const i0 = Math.floor(Math.min(ax, bx, cx) / c);
    const i1 = Math.ceil(Math.max(ax, bx, cx) / c);
    const j0 = Math.floor(Math.min(az, bz, cz) / c);
    const j1 = Math.ceil(Math.max(az, bz, cz) / c);
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-9) return;
    for (let j = j0; j <= j1; j++) {
      const z = j * c;
      for (let i = i0; i <= i1; i++) {
        const x = i * c;
        const w1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
        const w2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
        const w3 = 1 - w1 - w2;
        if (w1 < -1e-4 || w2 < -1e-4 || w3 < -1e-4) continue;
        this.set(i, j, w1 * ay + w2 * by + w3 * cy);
      }
    }
  }
  // Bilinear height at (x, z); -Infinity where there's no shaped snow.
  at(x, z) {
    const c = this.cell;
    const fx = x / c;
    const fz = z / c;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const a = this.get(i, j);
    const b = this.get(i + 1, j);
    const e = this.get(i, j + 1);
    const f = this.get(i + 1, j + 1);
    if (a === -Infinity || b === -Infinity || e === -Infinity || f === -Infinity) return Math.max(a, b, e, f);
    const tx = fx - i;
    const tz = fz - j;
    return (a + (b - a) * tx) * (1 - tz) + (e + (f - e) * tx) * tz;
  }
}

export function buildParks(world) {
  const { hf } = world;
  const rand = seededRandom(2203);
  const group = new THREE.Group();
  group.name = 'parks';
  const snow = new SnowBuilder(hf);
  const steel = [];
  const boxMats = {
    // A little self-lit so the yellow panel still reads on the shady side.
    side: (() => {
      const map = boxSideTexture();
      return new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.28, roughness: 0.5, metalness: 0.1 });
    })(),
    top: new THREE.MeshStandardMaterial({ color: 0xeef1f4, roughness: 0.35 }),
    body: new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.5, metalness: 0.4 }),
  };
  const boxMeshes = [];
  const roofs = [];
  const yellow = []; // feature markers, end caps
  const flagPoles = [];
  const flags = [];
  const posts = [];
  const wood = [];
  const plywood = [];
  const bus = { lower: [], upper: [], glass: [], tire: [] };
  const banners = [];
  const pt = {};
  const parks = [];
  const jumps = []; // every tabletop, for riders to hit

  // World point `off` meters beside the run at distance s, `h` above snow.
  const at = (run, s, off, h) => {
    beside(run, s, off, pt);
    return new THREE.Vector3(pt.x, hf.heightAt(pt.x, pt.z) + h, pt.z);
  };
  // A chain of segments through [along, height] points, each made by `seg`.
  const chain = (run, s, off, shape, seg) => {
    const ps = shape.map(([a, h]) => at(run, s + a, off, h));
    for (let i = 1; i < ps.length; i++) seg(ps[i - 1], ps[i], i);
    return ps;
  };
  const postsUnder = (ps, w) => {
    for (const e of ps) {
      const g = hf.heightAt(e.x, e.z);
      if (e.y - g > 0.2) posts.push(spanBox(new THREE.Vector3(e.x, e.y - 0.05, e.z), new THREE.Vector3(e.x, g - 0.4, e.z + 0.01), w, w));
    }
  };

  // Things you can slide: polylines along the top surface (ps are the
  // centerline points; top = y + lift), half-width of the slide surface.
  const grindables = [];
  const grind = (ps, lift, halfWidth, name) => {
    grindables.push({ pts: ps.map((p) => p.clone().setY(p.y + lift)), halfWidth, name });
  };
  // Blue dye line sprayed across a lip or knuckle so riders can read it:
  // a thin strip on the snow from side to side at distance a into a jump.
  const dye = [];
  const dyeLine = (run, s, a, off, width, prof) => {
    const pos = [];
    const idx = [];
    const N = 8;
    for (let k = 0; k <= N; k++) {
      const c = -width / 2 + (width * k) / N;
      for (const da of [-0.18, 0.18]) {
        const p = at(run, s + a + da, off + c, 0);
        pos.push(p.x, p.y + prof.h(a + da) - 0.12, p.z);
      }
      if (k) idx.push((k - 1) * 2, (k - 1) * 2 + 1, k * 2, (k - 1) * 2 + 1, k * 2 + 1, k * 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    dye.push(g);
  };
  // Dye down a jump's edge from a0 to a1 at sideways c (contest builds paint
  // the edges of the lip and landing so riders can read them in flat light).
  const dyeAlong = (run, s, a0, a1, off, c, prof) => {
    const pos = [];
    const idx = [];
    const N = Math.max(2, Math.ceil((a1 - a0) / 0.5));
    for (let k = 0; k <= N; k++) {
      const a = a0 + ((a1 - a0) * k) / N;
      for (const dc of [-0.15, 0.15]) {
        const p = at(run, s + a, off + c + dc, 0);
        pos.push(p.x, p.y + prof.h(a) - 0.12, p.z);
      }
      if (k) idx.push((k - 1) * 2, (k - 1) * 2 + 1, k * 2, (k - 1) * 2 + 1, k * 2 + 1, k * 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    dye.push(g);
  };
  // Small yellow marker block on the snow (h = snow built up there).
  // Fall-line slope (tan) under a feature: average over `len` meters.
  const slopeAt = (run, s, off, len) => {
    const a = at(run, s, off, 0);
    const b = at(run, s + len, off, 0);
    return Math.max(0.05, (a.y - b.y) / Math.max(1, Math.hypot(b.x - a.x, b.z - a.z)));
  };
  const marker = (run, s, off, h = 0) => {
    const p = at(run, s, off, h);
    yellow.push(new THREE.BoxGeometry(0.35, 0.5, 0.12).translate(p.x, p.y + 0.2, p.z));
  };
  // Yellow flag on a black pole beside a big jump.
  const flag = (run, s, off, h = 0) => {
    const p = at(run, s, off, h);
    flagPoles.push(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 6).translate(p.x, p.y + 1.1, p.z));
    flags.push(new THREE.PlaneGeometry(0.7, 0.45).translate(0.35, 0, 0).translate(p.x, p.y + 2.1, p.z));
  };

  // Lays one feature at distance s, `off` sideways; returns its length.
  const feature = (run, s, [type, variant, off, size]) => {
    switch (type) {
      case 'jump': {
        const J = JUMPS[variant];
        const prof = jumpProfile(J, slopeAt(run, s, off, 30));
        snow.drape(run, s, off, J.W, prof);
        // Where the lip is and which way it throws you, for the skier.
        const l0 = at(run, s + prof.lip.x - 1.5, off, 0);
        const l1 = at(run, s + prof.lip.x, off, 0);
        const lipDir = new THREE.Vector3(l1.x - l0.x, 0, l1.z - l0.z).normalize();
        jumps.push({ run, s, off, prof, size: variant, lipPos: new THREE.Vector3(l1.x, l1.y + J.H, l1.z), lipDir, lipAngle: prof.lip.angle, halfWidth: J.W / 2 });
        dyeLine(run, s, prof.lip.x - 0.2, off, J.W, prof);
        dyeLine(run, s, prof.knuckle, off, J.W, prof);
        if (J.H >= 2.5) {
          // Contest paint: the sweet spot, and both edges of lip and landing.
          dyeLine(run, s, prof.sweet, off, J.W, prof);
          for (const c of [-J.W / 2 + 0.25, J.W / 2 - 0.25]) {
            dyeAlong(run, s, prof.lip.x * 0.35, prof.lip.x - 0.1, off, c, prof);
            dyeAlong(run, s, prof.knuckle, prof.length - 2, off, c, prof);
          }
        }
        // Yellow markers either side of the lip; flags on the big ones.
        for (const side of [-1, 1]) marker(run, s + prof.lip.x - 0.4, off + side * (J.W / 2 + 0.6), J.H * 0.9);
        if (J.H >= 1.4) flag(run, s + prof.lip.x, off - J.W / 2 - 2, J.H * 0.7);
        return prof.length;
      }
      case 'hip': {
        const J = JUMPS[size || 'm'];
        const prof = hipProfile(J, variant === 'r' ? 1 : -1, slopeAt(run, s, off, 20));
        snow.drape(run, s, off, J.W, prof);
        return prof.length;
      }
      case 'roof': {
        // A-frame rooftop: a takeoff deck, then the timber roof down the
        // fall line with its eaves sunk in the snow.
        snow.drape(run, s, off, 3.4, deckFor(0.75));
        const a = at(run, s + 4.4, off, -0.15);
        const b = at(run, s + 11.4, off, -0.15);
        roofs.push(roofGeometry(a, b, 1.1, 0.95));
        steel.push(spanTube(a.clone().setY(a.y + 0.95), b.clone().setY(b.y + 0.95), 0.06));
        grind([a.clone().setY(a.y + 0.95), b.clone().setY(b.y + 0.95)], 0.06, 0.08, 'A-frame');
        marker(run, s + 3.2, off);
        return 12;
      }
      case 'berm': {
        const prof = bermProfile(variant === 'r' ? 1 : -1);
        snow.drape(run, s, off, 7, prof);
        return prof.length;
      }
      case 'rollers': {
        const prof = rollers(4, variant === 'xs' ? 0.55 : 0.8, 6);
        snow.drape(run, s, off, 6, prof);
        return prof.length;
      }
      case 'qp': {
        const prof = qpProfile();
        snow.drape(run, s, off, 8, prof);
        return prof.length;
      }
      case 'wave': {
        const prof = waveProfile(variant === 'r' ? 1 : -1);
        snow.drape(run, s, off, 9, prof);
        return prof.length;
      }
      case 'spine':
        snow.drape(run, s, off, 9, spineProfile);
        return spineProfile.length;
      case 'rail': {
        if (variant !== 'rainbow') snow.drape(run, s, off, 3.2, deckFor(RAILS[variant][0][1] - 0.05));
        const s1 = s + (variant === 'rainbow' ? 0 : 4.2);
        const ps = chain(run, s1, off, RAILS[variant], (a, b) => steel.push(spanTube(a, b, 0.055)));
        grind(ps, 0.055, 0.06, variant === 'rainbow' ? 'rainbow rail' : `${variant === 'dfd' ? 'down-flat-down' : variant} rail`);
        postsUnder(ps.filter((_, i) => i === 0 || i === ps.length - 1 || i % 2 === 0), 0.09);
        // Yellow end cap on the rail's nose, and a marker beside the takeoff.
        yellow.push(new THREE.SphereGeometry(0.075, 8, 6).translate(ps[0].x, ps[0].y, ps[0].z));
        marker(run, s1 - 1.2, off);
        return s1 - s + RAILS[variant].at(-1)[0];
      }
      case 'box': {
        const rideOn = variant === 'ride-on';
        if (!rideOn) snow.drape(run, s, off, 3.4, deckFor(BOXES[variant][0][1] - 0.05));
        const s1 = s + (rideOn ? 0 : 4.2);
        const ps = chain(run, s1, off, BOXES[variant], (a, b) => {
          const d = new THREE.Vector3(0, rideOn ? 0.15 : 0.25, 0);
          boxMeshes.push(boxSegment(a.clone().sub(d), b.clone().sub(d), rideOn ? 0.8 : 0.6, rideOn ? 0.3 : 0.5, boxMats));
        });
        grind(ps, 0, rideOn ? 0.4 : 0.3, 'box');
        if (!rideOn) postsUnder(ps, 0.4);
        marker(run, s1 - 1.2, off);
        return s1 - s + BOXES[variant].at(-1)[0];
      }
      case 'battleship': {
        snow.drape(run, s, off, 3.6, jibDeck);
        const s1 = s + 3.6;
        const ps = chain(run, s1, off, HULL, (a, b) => {
          const d = new THREE.Vector3(0, 0.4, 0);
          boxMeshes.push(boxSegment(a.clone().sub(d), b.clone().sub(d), 1.5, 0.8, boxMats));
          steel.push(spanTube(a, b, 0.045)); // coping on the deck edge
        });
        grind(ps, 0, 0.75, 'battleship');
        postsUnder([ps[1], ps[2]], 0.5);
        return s1 - s + 10;
      }
      case 'wallride': {
        // A plywood wall standing just off the lane, leaning back, with a
        // little kicker to hit it.
        const side = variant === 'r' ? 1 : -1;
        snow.drape(run, s, off - side * 3, 3, jibDeck);
        const a = at(run, s + 5, off, 0);
        const b = at(run, s + 12, off + side * 1.6, 0);
        const len = a.distanceTo(b);
        const panel = new THREE.BoxGeometry(0.12, 2.8, len).translate(0, 1.4, 0).rotateZ(side * 0.25);
        const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0));
        m.setPosition(a.clone().lerp(b, 0.5).setY(Math.min(a.y, b.y) - 0.3));
        plywood.push(panel.applyMatrix4(m));
        for (const e of [a, b]) wood.push(spanBox(e.clone().setY(e.y - 0.4), new THREE.Vector3(e.x + side * 0.01, e.y + 2.5, e.z), 0.2, 0.2));
        return 13;
      }
      case 'bus': {
        // An old VW bus half sunk in the snow, with a ramp up to its roof.
        const ramp = { length: 6, height: 1.9, h: (a) => 1.9 * smooth(Math.min(1, a / 6)) };
        snow.drape(run, s, off, 2.6, ramp);
        const a = at(run, s + 6, off, 0);
        const b = at(run, s + 10.4, off, 0);
        const y = Math.max(a.y, b.y) - 0.35; // wheels buried
        a.y = b.y = y;
        const lift = (h) => [a.clone().setY(y + h), b.clone().setY(y + h)];
        bus.lower.push(spanBox(...lift(0.55), 1.85, 1.1));
        bus.upper.push(spanBox(...lift(1.5), 1.85, 0.8));
        bus.glass.push(spanBox(...lift(1.45), 1.9, 0.45));
        bus.upper.push(spanBox(...lift(1.95), 1.6, 0.12)); // roof
        for (const t of [0.18, 0.82]) {
          const c = a.clone().lerp(b, t);
          bus.tire.push(new THREE.CylinderGeometry(0.36, 0.36, 1.95, 12).rotateZ(Math.PI / 2).translate(c.x, y + 0.15, c.z));
        }
        return 11;
      }
      case 'log': {
        const ps = chain(run, s, off, [[0, 0.3], [9, 0.3]], (a, b) => wood.push(spanTube(a, b, 0.32)));
        grind(ps, 0.32, 0.25, 'log');
        postsUnder(ps, 0.3);
        return 9;
      }
      default:
        return 0;
    }
  };

  // Lines built once go on the longest stretch of run with the park's name.
  const longest = {};
  for (const run of world.runs) if (PARKS[run.name] && (!longest[run.name] || run.length > longest[run.name].length)) longest[run.name] = run;
  for (const run of world.runs) {
    const cfg = PARKS[run.name];
    if (!cfg || run.length < 60) continue;
    if (cfg.once && longest[run.name] !== run) continue;
    parks.push({ run, cfg });

    if (cfg.kind === 'pipe') {
      snow.pipe(run, 8, run.length - 14);
    } else if (cfg.kind === 'whoops') {
      // Natural whoops through the trees.
      for (let s = 40; s < run.length - 40; s += 70 + rand() * 40) snow.drape(run, s, (rand() - 0.5) * 6, 5, rollers(3, 0.5, 5));
      continue; // tree runs have no banner
    } else {
      // The park line top to bottom, repeated if the run is long enough.
      let s = cfg.inrun || 26; // big lines get a longer drop-in for speed
      for (let k = 0; ; k++) {
        const row = cfg.line[k % cfg.line.length];
        if (k >= cfg.line.length && (cfg.once || (k % cfg.line.length === 0 && run.length - s < 180))) break;
        // Don't start a row that won't fit.
        const need = Math.max(...row.map(([t, v]) => (t === 'jump' ? jumpProfile(JUMPS[v], 0.25).length : 26)));
        if (s + need > run.length - 12) break;
        let len = 0;
        for (const f of row) len = Math.max(len, feature(run, s, f));
        s += len + 14 + rand() * 8;
      }
    }

    // Banner over the entrance with the park's name.
    along(run, 5, pt);
    const span = cfg.kind === 'pipe' ? 32 : 20;
    const left = new THREE.Vector3(pt.x + pt.dz * span / 2, 0, pt.z - pt.dx * span / 2);
    const right = new THREE.Vector3(pt.x - pt.dz * span / 2, 0, pt.z + pt.dx * span / 2);
    left.y = hf.heightAt(left.x, left.z);
    right.y = hf.heightAt(right.x, right.z);
    const top = Math.max(left.y, right.y) + 4.6;
    posts.push(spanTube(left, new THREE.Vector3(left.x, top + 0.4, left.z), 0.12));
    posts.push(spanTube(right, new THREE.Vector3(right.x, top + 0.4, right.z), 0.12));
    const name = cfg.label || run.name;
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(span - 0.6, 1.4), bannerMaterial(name));
    banner.position.set((left.x + right.x) / 2, top - 0.4, (left.z + right.z) / 2);
    // Face uphill, toward riders dropping in.
    banner.rotation.y = Math.atan2(-pt.dx, -pt.dz);
    banners.push(banner);

    // Size sign beside the entrance, facing uphill.
    if (cfg.size) {
      const sp = at(run, 2, -span / 2 - 2.5, 0);
      posts.push(spanBox(sp.clone().setY(sp.y - 0.3), sp.clone().setY(sp.y + 1.2), 0.1, 0.1));
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(1.2, 1.5),
        new THREE.MeshStandardMaterial({ map: sizeSignTexture(name, cfg.size, cfg.lift), roughness: 0.6, side: THREE.DoubleSide }),
      );
      sign.position.set(sp.x, sp.y + 1.9, sp.z);
      sign.rotation.y = Math.atan2(-pt.dx, -pt.dz);
      banners.push(sign);
    }
  }

  // The shaped snow as a height lookup, for skiing on it.
  const snowTiles = new HeightTiles();
  {
    const P = snow.pos;
    const I = snow.idx;
    for (let k = 0; k < I.length; k += 3) {
      const a = I[k] * 3;
      const b = I[k + 1] * 3;
      const c = I[k + 2] * 3;
      snowTiles.triangle(P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]);
    }
  }
  // Shaped snow: bright groomed corduroy.
  group.add(snow.mesh(addSparkle(new THREE.MeshStandardMaterial({ color: 0xf6f9fc, map: corduroyTexture(), roughness: 0.82 }))));
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });
  const addList = (list, mat) => {
    if (list.length) group.add(new THREE.Mesh(mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g))), mat));
  };
  // Woodward rails are black powder-coated steel.
  addList(steel, std(0x1c1e21, { roughness: 0.35, metalness: 0.6 }));
  addList(posts, std(0x1c1e21, { metalness: 0.4 }));
  addList(wood, std(0x6b4a2e, { roughness: 0.9 }));
  addList(plywood, new THREE.MeshStandardMaterial({ map: plankTexture('#b98a52'), roughness: 0.85 }));
  addList(roofs, new THREE.MeshStandardMaterial({ map: plankTexture(), roughness: 0.85, side: THREE.DoubleSide }));
  addList(dye, new THREE.MeshBasicMaterial({ color: 0x2b7bd6, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide }));
  addList(yellow, std(0xffc20e, { roughness: 0.45, emissive: 0x6a4c00 }));
  addList(flagPoles, std(0x1c1e21));
  addList(flags, std(0xffc20e, { side: THREE.DoubleSide, emissive: 0x6a4c00 }));
  addList(bus.lower, std(0x3aa39b, { roughness: 0.5 }));
  addList(bus.upper, std(0xf1e8d4, { roughness: 0.5 }));
  addList(bus.glass, std(0x1b2833, { roughness: 0.15, metalness: 0.5 }));
  addList(bus.tire, std(0x1a1a1a, { roughness: 0.9 }));
  for (const b of boxMeshes) group.add(b);
  for (const b of banners) group.add(b);
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  // Snow surface height anywhere: natural ground or the shaped park snow.
  const surfaceAt = (x, z) => Math.max(hf.heightAt(x, z), snowTiles.at(x, z));
  return { group, parks, jumps, grindables, surfaceAt };
}
