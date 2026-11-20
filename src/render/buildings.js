import * as THREE from 'three';
import { seededRandom } from '../world/noise.js';

// ------------------------------------------------------------------ textures
// Procedural facade textures. One tile = 4 m x 4 m (one storey, one bay).
const TILE = 4;

function canvasTex(draw, size = 256, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function planks(ctx, s, base, rand) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, s, s);
  const n = 14;
  for (let i = 0; i < n; i++) {
    const x = (i / n) * s;
    ctx.fillStyle = `rgba(${30 + rand() * 30},${18 + rand() * 15},${8 + rand() * 10},${0.12 + rand() * 0.15})`;
    ctx.fillRect(x, 0, s / n, s);
    ctx.fillStyle = 'rgba(25,14,6,0.55)';
    ctx.fillRect(x, 0, 1.5, s);
  }
}

// Window rectangle in tile units (0..1), y measured from the bottom.
const WIN = { x0: 0.18, x1: 0.82, y0: 0.22, y1: 0.8 };

function makeTextures() {
  const rand = seededRandom(4242);
  const winRect = (s) => [WIN.x0 * s, (1 - WIN.y1) * s, (WIN.x1 - WIN.x0) * s, (WIN.y1 - WIN.y0) * s];

  const woodWin = canvasTex((ctx, s) => {
    planks(ctx, s, '#7a4f31', rand);
    const [x, y, w, h] = winRect(s);
    ctx.fillStyle = '#efe9df'; // trim
    ctx.fillRect(x - 6, y - 6, w + 12, h + 12);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#3d5468');
    g.addColorStop(1, '#22313f');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; // sky reflection
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w * 0.45, y);
    ctx.lineTo(x, y + h * 0.6);
    ctx.fill();
    ctx.fillStyle = '#efe9df';
    ctx.fillRect(x + w / 2 - 2, y, 4, h);
    ctx.fillRect(x, y + h * 0.42, w, 4);
  });
  const woodWinGlow = canvasTex((ctx, s) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, s, s);
    const [x, y, w, h] = winRect(s);
    ctx.fillStyle = '#6b4a22';
    ctx.fillRect(x, y + h * 0.45, w, h * 0.55);
  }, 256, true);
  const wood = canvasTex((ctx, s) => planks(ctx, s, '#7a4f31', rand));
  const darkWood = canvasTex((ctx, s) => planks(ctx, s, '#4e3322', rand));
  const stone = canvasTex((ctx, s) => {
    ctx.fillStyle = '#6f6a64';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 70; i++) {
      const w = 22 + rand() * 40;
      const h = 14 + rand() * 18;
      const v = 95 + rand() * 60;
      ctx.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
      ctx.beginPath();
      ctx.roundRect(rand() * s - 10, rand() * s - 10, w, h, 6);
      ctx.fill();
    }
  });
  const metal = canvasTex((ctx, s) => {
    ctx.fillStyle = '#7d8a96';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 32; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.08)';
      ctx.fillRect((i / 32) * s, 0, s / 64, s);
    }
  });
  const door = canvasTex((ctx, s) => {
    ctx.fillStyle = '#c9ccd0';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, (i / 10) * s, s, 2);
    }
  });
  return { woodWin, woodWinGlow, wood, darkWood, stone, metal, door };
}

let MATS = null;
function mats() {
  if (MATS) return MATS;
  const t = makeTextures();
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o });
  MATS = {
    woodWin: std({ map: t.woodWin, emissive: 0xffb25e, emissiveMap: t.woodWinGlow, emissiveIntensity: 0.5 }),
    wood: std({ map: t.wood }),
    darkWood: std({ map: t.darkWood }),
    stone: std({ map: t.stone, roughness: 0.95 }),
    metal: std({ map: t.metal, roughness: 0.55, metalness: 0.3 }),
    door: std({ map: t.door, roughness: 0.6 }),
    snow: std({ color: 0xf6f9fc, roughness: 0.9 }),
    fascia: std({ color: 0x3b2a1e }),
    glass: std({ color: 0x1d3347, roughness: 0.08, metalness: 0.6, emissive: 0xffa94d, emissiveIntensity: 0.05, envMapIntensity: 1.6 }),
    trim: std({ color: 0xeee8dc }),
    steel: std({ color: 0x3a3f45, roughness: 0.5, metalness: 0.5 }),
    catRed: std({ color: 0xc8262c, roughness: 0.5 }),
    track: std({ color: 0x1f2226, roughness: 0.9 }),
  };
  // ExtrudeGeometry UVs are in meters; scale gable-end wood to the 4 m tile.
  MATS.gableEnd = MATS.wood.clone();
  MATS.gableEnd.map = t.wood.clone();
  MATS.gableEnd.map.repeat.set(1 / TILE, 1 / TILE);
  MATS.gableEnd.map.needsUpdate = true;
  return MATS;
}

// ------------------------------------------------------------------ geometry
// Box whose UVs repeat every TILE meters, starting from the bottom edge, so
// window rows line up with storeys.
function tiledBox(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const faces = [
    [d, h], [d, h], // +x, -x
    [w, d], [w, d], // +y, -y
    [w, h], [w, h], // +z, -z
  ];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * faces[f][0]) / TILE, (uv.getY(i) * faces[f][1]) / TILE);
    }
  }
  return g;
}

// Gable roof prism: ridge along local x, spans w (x) by d (z), eaves overhang.
function gableRoof(w, d, rise, overhang = 1.3) {
  const shape = new THREE.Shape();
  shape.moveTo(-d / 2 - overhang, -0.35);
  shape.lineTo(-d / 2 - overhang, 0);
  shape.lineTo(0, rise);
  shape.lineTo(d / 2 + overhang, 0);
  shape.lineTo(d / 2 + overhang, -0.35);
  shape.lineTo(-d / 2 - overhang, -0.35);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w + overhang * 2, bevelEnabled: false });
  geo.translate(0, 0, -(w + overhang * 2) / 2);
  geo.rotateY(Math.PI / 2);
  return geo;
}

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function roofOn(g, w, d, h, pitch, M, ridgeAlongZ = false) {
  const roof = mesh(gableRoof(ridgeAlongZ ? d : w, ridgeAlongZ ? w : d, (ridgeAlongZ ? w : d) * pitch), [M.gableEnd, M.snow], 0, h, 0);
  if (ridgeAlongZ) roof.rotation.y = Math.PI / 2;
  g.add(roof);
  return roof;
}

function chimney(g, x, z, top, M) {
  g.add(mesh(tiledBox(2.2, 5, 2.2), M.stone, x, top - 1.5, z));
  g.add(mesh(new THREE.BoxGeometry(2.6, 0.4, 2.6), M.snow, x, top + 1.2, z));
}

function deck(g, w, d, side, M) {
  const depth = 7;
  const z = side * (d / 2 + depth / 2);
  const y = 3.2;
  g.add(mesh(new THREE.BoxGeometry(w, 0.45, depth), M.darkWood, 0, y, z));
  g.add(mesh(new THREE.BoxGeometry(w, 0.12, depth), M.snow, 0, y + 0.28, z));
  // posts and railing
  for (let i = 0; i <= 6; i++) {
    const x = -w / 2 + (i / 6) * w;
    g.add(mesh(new THREE.BoxGeometry(0.35, y, 0.35), M.darkWood, x, y / 2, z + side * (depth / 2 - 0.3)));
  }
  g.add(mesh(new THREE.BoxGeometry(w, 0.15, 0.15), M.darkWood, 0, y + 1.1, z + side * depth / 2));
  g.add(mesh(new THREE.BoxGeometry(w, 0.9, 0.06), M.glass, 0, y + 0.65, z + side * depth / 2));
  // picnic tables with umbrellas
  for (let i = 0; i < Math.floor(w / 9); i++) {
    const x = -w / 2 + 5 + i * 9;
    g.add(mesh(new THREE.BoxGeometry(1.8, 0.12, 1.2), M.wood, x, y + 1.0, z));
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 4), M.steel, x, y + 1.6, z));
    g.add(mesh(new THREE.ConeGeometry(1.5, 0.6, 8), i % 2 ? M.catRed : M.trim, x, y + 2.9, z));
  }
}

// ------------------------------------------------------------------ styles
function hall(b, M) {
  const g = new THREE.Group();
  const plinth = 2.6;
  g.add(mesh(tiledBox(b.w + 0.6, plinth, b.d + 0.6), M.stone, 0, plinth / 2, 0));
  const upper = b.h - plinth;
  g.add(mesh(tiledBox(b.w, upper, b.d), M.woodWin, 0, plinth + upper / 2, 0));
  roofOn(g, b.w, b.d, b.h, 0.5, M);
  chimney(g, b.w * 0.28, 0, b.h + b.d * 0.25, M);
  // timber columns at the corners
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(mesh(new THREE.BoxGeometry(0.7, b.h, 0.7), M.darkWood, (sx * b.w) / 2, b.h / 2, (sz * b.d) / 2));
    }
  }
  if (b.deck) deck(g, b.w * 0.85, b.d, b.deck, M);
  return g;
}

function aframe(b, M) {
  const g = hall({ ...b, deck: 0 }, M);
  const side = b.deck || 1;
  // Tall cross-gable with a glass A-frame end facing the deck / view.
  const cw = b.w * 0.36;
  const cd = b.d * 0.62;
  const ch = b.h * 0.72;
  const cz = side * (b.d / 2 - cd * 0.3);
  const cross = new THREE.Group();
  cross.position.z = cz;
  g.add(cross);
  cross.add(mesh(tiledBox(cw, ch, cd), M.woodWin, 0, ch / 2, 0));
  const rise = cw * 1.05;
  // Overhang kept tiny so the roof's gable end sits flush behind the glass.
  const roof = mesh(gableRoof(cd, cw, rise, 0.12), [M.gableEnd, M.snow], 0, ch, 0);
  roof.rotation.y = Math.PI / 2;
  cross.add(roof);
  // Glass triangle + glass wall below it.
  const tri = new THREE.Shape();
  tri.moveTo(-cw / 2 + 0.6, 0);
  tri.lineTo(0, rise - 0.9);
  tri.lineTo(cw / 2 - 0.6, 0);
  tri.lineTo(-cw / 2 + 0.6, 0);
  const glass = mesh(new THREE.ShapeGeometry(tri), M.glass, 0, ch, side * (cd / 2 + 0.2));
  if (side < 0) glass.rotation.y = Math.PI;
  cross.add(glass);
  cross.add(mesh(new THREE.BoxGeometry(cw - 1.2, ch - 3, 0.1), M.glass, 0, 1.5 + (ch - 3) / 2, side * (cd / 2 + 0.06)));
  // mullions
  for (let i = -2; i <= 2; i++) {
    cross.add(mesh(new THREE.BoxGeometry(0.18, ch + rise * (1 - Math.abs(i) / 3) - 1.5, 0.2), M.darkWood, (i * cw) / 6, (ch + rise * (1 - Math.abs(i) / 3)) / 2, side * (cd / 2 + 0.3)));
  }
  if (b.deck) deck(g, b.w * 0.9, b.d + (cd * 0.6), b.deck, M);
  return g;
}

function wing(b, M) {
  const g = new THREE.Group();
  g.add(mesh(tiledBox(b.w + 0.4, 1.4, b.d + 0.4), M.stone, 0, 0.7, 0));
  g.add(mesh(tiledBox(b.w, b.h - 1.4, b.d), M.woodWin, 0, 1.4 + (b.h - 1.4) / 2, 0));
  roofOn(g, b.w, b.d, b.h, 0.42, M);
  return g;
}

function shed(b, M) {
  const g = new THREE.Group();
  g.add(mesh(tiledBox(b.w, b.h, b.d), M.woodWin, 0, b.h / 2, 0));
  roofOn(g, b.w, b.d, b.h, 0.4, M);
  return g;
}

function hut(b, M) {
  const g = new THREE.Group();
  g.add(mesh(tiledBox(b.w, b.h, b.d), M.wood, 0, b.h / 2, 0));
  g.add(mesh(new THREE.BoxGeometry(b.w * 0.5, b.h * 0.35, 0.1), M.glass, 0, b.h * 0.6, b.d / 2 + 0.05));
  roofOn(g, b.w, b.d, b.h, 0.55, M);
  return g;
}

function snowcat(M) {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(1.1, 1.1, 5.0), M.track, sx * 1.55, 0.55, 0));
  g.add(mesh(new THREE.BoxGeometry(2.8, 1.1, 3.8), M.catRed, 0, 1.55, -0.3));
  g.add(mesh(new THREE.BoxGeometry(2.3, 1.4, 1.9), M.catRed, 0, 2.75, 0.4));
  g.add(mesh(new THREE.BoxGeometry(2.35, 0.9, 1.6), M.glass, 0, 2.9, 0.48));
  g.add(mesh(new THREE.BoxGeometry(4.6, 1.2, 0.35), M.steel, 0, 0.8, 3.0)); // blade
  g.add(mesh(new THREE.BoxGeometry(4.2, 0.6, 1.1), M.track, 0, 0.5, -2.9)); // tiller
  g.add(mesh(new THREE.BoxGeometry(1.6, 0.18, 0.25), M.trim, 0, 3.55, 0.9)); // light bar
  return g;
}

function garage(b, M) {
  const g = new THREE.Group();
  g.add(mesh(tiledBox(b.w, b.h, b.d), M.metal, 0, b.h / 2, 0));
  roofOn(g, b.w, b.d, b.h, 0.18, M);
  const doors = Math.max(1, Math.floor(b.w / 9));
  for (let i = 0; i < doors; i++) {
    const x = -b.w / 2 + (b.w / doors) * (i + 0.5);
    g.add(mesh(new THREE.BoxGeometry(5.2, 5, 0.2), M.door, x, 2.5, b.d / 2 + 0.1));
  }
  for (let i = 0; i < (b.snowcats || 0); i++) {
    const cat = snowcat(M);
    const x = -b.w / 2 + (b.w / Math.max(1, b.snowcats)) * (i + 0.5);
    cat.position.set(x, 0, b.d / 2 + 7 + (i % 2) * 2);
    cat.rotation.y = (i % 2 ? 0.25 : -0.15);
    g.add(cat);
  }
  return g;
}

const STYLES = { hall, aframe, wing, shed, hut, garage };

function summitHut(M) {
  const g = new THREE.Group();
  g.add(hut({ w: 7, d: 5, h: 4 }, M));
  const mast = mesh(new THREE.CylinderGeometry(0.15, 0.2, 14, 5), M.steel, 4.5, 7, 0);
  g.add(mast);
  g.add(mesh(new THREE.BoxGeometry(1.2, 1.2, 0.2), M.trim, 4.5, 12, 0.3)); // antenna dish-ish
  return g;
}

// ------------------------------------------------------------------ parking
function parkedCars(lots) {
  const rand = seededRandom(97702);
  const spots = [];
  for (const lot of lots) {
    const [w, d] = lot.size;
    const rows = Math.floor(d / 14);
    const cols = Math.floor(w / 3.2);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (rand() < 0.3) continue; // empty spaces
        const lx = -w / 2 + 2 + c * 3.2;
        const lz = -d / 2 + 4 + r * 14 + (r % 2 ? 0 : 1.5);
        const cs = Math.cos(lot.yaw);
        const sn = Math.sin(lot.yaw);
        spots.push({ x: lot.x + lx * cs + lz * sn, z: lot.z - lx * sn + lz * cs, y: lot.y, yaw: lot.yaw + (r % 2 ? Math.PI : 0) });
      }
    }
  }
  const body = new THREE.BoxGeometry(1.8, 0.85, 4.4).translate(0, 0.7, 0);
  const cabin = new THREE.BoxGeometry(1.6, 0.65, 2.4).translate(0, 1.42, -0.3);
  const roofSnow = new THREE.BoxGeometry(1.62, 0.12, 2.3).translate(0, 1.8, -0.3);
  const group = new THREE.Group();
  const mk = (geo, mat, colors) => {
    const im = new THREE.InstancedMesh(geo, mat, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    spots.forEach((s, k) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
      m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(1, 1, 1));
      im.setMatrixAt(k, m);
      if (colors) im.setColorAt(k, colors[k]);
    });
    im.castShadow = true;
    group.add(im);
  };
  const palette = [0x2f3e4e, 0xb9bec4, 0x8b1e24, 0xe8e8e8, 0x1f2a22, 0x50606f, 0x2f4f7d, 0x6b6156];
  const colors = spots.map(() => new THREE.Color(palette[Math.floor(rand() * palette.length)]));
  mk(body, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.4 }), colors);
  mk(cabin, new THREE.MeshStandardMaterial({ color: 0x1c2630, roughness: 0.2, metalness: 0.5 }));
  mk(roofSnow, new THREE.MeshStandardMaterial({ color: 0xf6f9fc, roughness: 0.9 }));
  return group;
}

export function buildBuildings(world) {
  const M = mats();
  const group = new THREE.Group();
  for (const l of world.lodges) {
    if (l.id === 'summit-hut') {
      const h = summitHut(M);
      h.position.set(l.x, l.y - 0.3, l.z);
      group.add(h);
      continue;
    }
    for (const b of l.buildings) {
      const obj = STYLES[b.style](b, M);
      obj.position.set(b.wx, l.y - 0.3, b.wz);
      obj.rotation.y = b.wyaw;
      group.add(obj);
    }
  }
  group.add(parkedCars(world.parking));
  return group;
}
