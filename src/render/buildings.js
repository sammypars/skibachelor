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
  // Pine Marten: pale grey-tan panels with a continuous band of glass and
  // slim mullions (one tile = one storey).
  const panelBase = (ctx, s, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    for (let i = 0; i < 4; i++) ctx.fillRect((i / 4) * s, 0, 2, s); // panel joints
  };
  const ribbon = canvasTex((ctx, s) => {
    panelBase(ctx, s, '#c9c3b6');
    const y = s * 0.16;
    const h = s * 0.5;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#5d7487');
    g.addColorStop(1, '#22313f');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, s, h);
    ctx.fillStyle = '#8d8a84';
    for (let i = 0; i < 2; i++) ctx.fillRect((i / 2) * s, y, 5, h); // mullions
    ctx.fillRect(0, y + h - 4, s, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(0, y, s, h * 0.18);
  });
  const ribbonGlow = canvasTex((ctx, s) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#5a3e1c';
    ctx.fillRect(0, s * 0.36, s, s * 0.3);
  });
  const panel = canvasTex((ctx, s) => panelBase(ctx, s, '#c9c3b6'));
  // West Village: tan siding, rectangular windows with dark frames.
  const siding = (ctx, s, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 24; i++) {
      ctx.fillStyle = 'rgba(60,40,20,0.10)';
      ctx.fillRect(0, (i / 24) * s, s, 2);
    }
  };
  const punched = (ctx, s, frame) => {
    const [x, y, w, h] = [s * 0.12, s * 0.22, s * 0.76, s * 0.48];
    ctx.fillStyle = frame;
    ctx.fillRect(x - 5, y - 5, w + 10, h + 10);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#4f677b');
    g.addColorStop(1, '#1e2c39');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = frame;
    ctx.fillRect(x + w / 2 - 2, y, 4, h);
  };
  const tanWin = canvasTex((ctx, s) => {
    siding(ctx, s, '#c4a77d');
    punched(ctx, s, '#3b3027');
  });
  const tan = canvasTex((ctx, s) => siding(ctx, s, '#c4a77d'));
  // Sunrise: white stucco with dark-framed square windows.
  const stuccoBase = (ctx, s) => {
    ctx.fillStyle = '#ecebe6';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.015 + rand() * 0.02})`;
      ctx.fillRect(rand() * s, rand() * s, 3, 3);
    }
  };
  const stuccoWin = canvasTex((ctx, s) => {
    stuccoBase(ctx, s);
    punched(ctx, s, '#22262b');
  });
  const stucco = canvasTex((ctx, s) => stuccoBase(ctx, s));
  const punchedGlow = canvasTex((ctx, s) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#5a3e1c';
    ctx.fillRect(s * 0.12, s * 0.45, s * 0.76, s * 0.25);
  });
  return { woodWin, woodWinGlow, wood, darkWood, stone, metal, door, ribbon, ribbonGlow, panel, tanWin, tan, stuccoWin, stucco, punchedGlow };
}

// A sign board with lettering.
function signTexture(text, bg = '#1c2733', fg = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 160;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = fg;
  ctx.font = '700 96px "Barlow Condensed", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.toUpperCase(), c.width / 2, c.height / 2 + 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
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
    ribbon: std({ map: t.ribbon, emissive: 0xffb25e, emissiveMap: t.ribbonGlow, emissiveIntensity: 0.45, roughness: 0.5 }),
    panel: std({ map: t.panel }),
    tanWin: std({ map: t.tanWin, emissive: 0xffb25e, emissiveMap: t.punchedGlow, emissiveIntensity: 0.45 }),
    tan: std({ map: t.tan }),
    stuccoWin: std({ map: t.stuccoWin, emissive: 0xffb25e, emissiveMap: t.punchedGlow, emissiveIntensity: 0.45 }),
    stucco: std({ map: t.stucco }),
    slate: std({ color: 0x3b4047, roughness: 0.7 }),
    railing: std({ color: 0x5b6168, roughness: 0.5, metalness: 0.4 }),
    railGlass: std({ color: 0x9fb4c4, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.45 }),
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

// ------------------------------------------------------------------ real lodges
// Modelled on photos of the actual buildings. Local +z * side is the
// downhill front (b.deck carries the side).

function flatRoof(g, w, d, x, y, z, M) {
  g.add(mesh(new THREE.BoxGeometry(w + 0.8, 0.55, d + 0.8), M.slate, x, y + 0.27, z));
  g.add(mesh(new THREE.BoxGeometry(w + 0.5, 0.35, d + 0.5), M.snow, x, y + 0.7, z));
}

// Glass deck railing along local x.
function railing(g, len, x, y, z, M) {
  g.add(mesh(new THREE.BoxGeometry(len, 1.0, 0.06), M.railGlass, x, y + 0.55, z));
  g.add(mesh(new THREE.BoxGeometry(len, 0.09, 0.12), M.railing, x, y + 1.1, z));
}

function sign(g, text, w, h, x, y, z, side, colors = []) {
  const m = mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: signTexture(text, ...colors), roughness: 0.6 }), x, y, z);
  m.rotation.y = side > 0 ? 0 : Math.PI;
  g.add(m);
}

// Pine Marten Lodge (1988): three stepped tiers wrapped in continuous bands
// of glass, flat roofs that double as decks with glass railings, pale panel
// walls on a lava-rock base, a square tower with a steep dark hipped roof,
// and a dark gable at one end.
function pineMarten(b, M) {
  const g = new THREE.Group();
  const s = b.deck || 1;
  const plinth = 1.6;
  g.add(mesh(tiledBox(b.w + 0.4, plinth, b.d + 0.4), M.stone, 0, plinth / 2, 0));
  const tiers = [
    { w: b.w, d: b.d, h: 5 },
    { w: b.w * 0.93, d: b.d * 0.66, h: 4.4 },
    { w: b.w * 0.8, d: b.d * 0.38, h: 4.4 },
  ];
  let y = plinth;
  tiers.forEach((t, i) => {
    const z = -s * (b.d - t.d) / 2; // tiers line up at the back, step back from the front
    g.add(mesh(tiledBox(t.w, t.h, t.d), M.ribbon, 0, y + t.h / 2, z));
    y += t.h;
    flatRoof(g, t.w, t.d, 0, y, z, M);
    const next = tiers[i + 1];
    if (next) {
      // The roof in front of the next tier up is a deck.
      railing(g, t.w - 1, 0, y + 0.8, z + s * (t.d / 2 - 0.2), M);
    }
  });
  // Dark gable over the east end of the middle tier.
  const t1 = tiers[1];
  const gw = 15;
  const gable = mesh(gableRoof(t1.d * 0.9, gw, 5.5, 0.8), [M.panel, M.slate], t1.w / 2 - gw / 2 - 1, plinth + tiers[0].h + t1.h, -s * (b.d - t1.d) / 2);
  gable.rotation.y = Math.PI / 2;
  g.add(gable);
  // The tower, at the back, rising above the top tier.
  const tw = 9;
  const top = y + 6;
  const tx = -b.w * 0.2;
  const tz = -s * (b.d / 2 - tw / 2 - 1.5);
  g.add(mesh(tiledBox(tw, top, tw), M.panel, tx, top / 2, tz));
  g.add(mesh(tiledBox(tw + 0.1, 4, tw + 0.1), M.ribbon, tx, top - 2.4, tz));
  const hip = mesh(new THREE.ConeGeometry(tw * 0.8, 7.5, 4, 1).rotateY(Math.PI / 4), M.slate, tx, top + 3.75, tz);
  g.add(hip);
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 3, 6), M.steel, tx, top + 8.5, tz)); // antenna
  deck(g, b.w * 0.75, b.d, s, M);
  return g;
}

// West Village Lodge: a tan two-storey block with rows of dark-framed
// windows, the upper floor reaching out over the lower, a taller center,
// flat roofs, and an outside stair up to the deck.
function westVillage(b, M) {
  const g = new THREE.Group();
  const s = b.deck || 1;
  const fh = 4.4;
  g.add(mesh(tiledBox(b.w, fh, b.d), M.tanWin, 0, fh / 2, 0));
  const uw = b.w * 0.84;
  const ud = b.d * 0.88;
  const uz = s * 1.4;
  g.add(mesh(tiledBox(uw, fh, ud), M.tanWin, 0, fh * 1.5, uz));
  flatRoof(g, b.w, b.d, 0, fh, 0, M);
  flatRoof(g, uw, ud, 0, fh * 2, uz, M);
  const cw = b.w * 0.3;
  const cd = b.d * 0.5;
  g.add(mesh(tiledBox(cw, 3.6, cd), M.tan, b.w * 0.1, fh * 2 + 1.8, -s * b.d * 0.08));
  flatRoof(g, cw, cd, b.w * 0.1, fh * 2 + 3.6, -s * b.d * 0.08, M);
  // Outside stair along the front, up to the upper deck.
  const run = 10;
  const stair = mesh(new THREE.BoxGeometry(run + 1, 0.35, 2.2), M.darkWood, b.w / 2 - run / 2 - 2, fh / 2, s * (b.d / 2 + 1.5));
  stair.rotation.z = Math.atan2(fh, run);
  g.add(stair);
  railing(g, run + 1, b.w / 2 - run / 2 - 2, fh / 2 - 0.2, s * (b.d / 2 + 2.6), M);
  sign(g, 'West Village Lodge', 16, 2.4, -b.w * 0.15, fh * 2 - 1.2, uz + s * (ud / 2 + 0.06), s);
  deck(g, b.w * 0.5, b.d, s, M);
  return g;
}

// Sunrise Lodge: white stucco, two storeys of dark-framed windows under a
// low dark roof, with a square tower in the middle of the front carrying
// the lodge's name.
function sunrise(b, M) {
  const g = new THREE.Group();
  const s = b.deck || 1;
  const h = 8;
  g.add(mesh(tiledBox(b.w, h, b.d), M.stuccoWin, 0, h / 2, 0));
  g.add(mesh(gableRoof(b.w, b.d, b.d * 0.16, 1.2), [M.stucco, M.slate], 0, h, 0));
  const tw = 9;
  const td = 6;
  const th = 14.5;
  const tz = s * (b.d / 2 - td / 2 + 1);
  g.add(mesh(tiledBox(tw, th, td), M.stucco, 0, th / 2, tz));
  flatRoof(g, tw, td, 0, th, tz, M);
  sign(g, 'Sunrise Lodge', 8, 1.3, 0, th - 2.2, tz + s * (td / 2 + 0.06), s, ['#ecebe6', '#22262b']);
  // Entry canopy under the tower.
  g.add(mesh(new THREE.BoxGeometry(tw + 3, 0.4, 3.5), M.slate, 0, 3.4, tz + s * (td / 2 + 1.6)));
  deck(g, b.w * 0.6, b.d, s, M);
  return g;
}

// Mountain Gateway: newer timber-and-glass building on a stone base under a
// broad, low, dark shed roof.
function gateway(b, M) {
  const g = new THREE.Group();
  const s = b.deck || 1;
  g.add(mesh(tiledBox(b.w + 0.4, 2, b.d + 0.4), M.stone, 0, 1, 0));
  g.add(mesh(tiledBox(b.w, 5.5, b.d), M.woodWin, 0, 2 + 2.75, 0));
  const roof = mesh(new THREE.BoxGeometry(b.w + 3, 0.6, b.d + 4), M.slate, 0, 8.3, 0);
  roof.rotation.x = -s * 0.09; // rises toward the front
  g.add(roof);
  const snowCap = mesh(new THREE.BoxGeometry(b.w + 2.6, 0.3, b.d + 3.6), M.snow, 0, 8.75, 0);
  snowCap.rotation.x = roof.rotation.x;
  g.add(snowCap);
  return g;
}

const STYLES = { hall, aframe, wing, shed, hut, garage, pineMarten, westVillage, sunrise, gateway };

function summitHut(M) {
  const g = new THREE.Group();
  g.add(hut({ w: 7, d: 5, h: 4 }, M));
  const mast = mesh(new THREE.CylinderGeometry(0.15, 0.2, 14, 5), M.steel, 4.5, 7, 0);
  g.add(mast);
  g.add(mesh(new THREE.BoxGeometry(1.2, 1.2, 0.2), M.trim, 4.5, 12, 0.3)); // antenna dish-ish
  return g;
}

// ------------------------------------------------------------------ parking
// Inside the lot outline and at least `inset` meters from its edge.
function inLot(x, z, pts, inset) {
  let inside = false;
  for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
    const A = pts[a];
    const B = pts[b];
    if (A.z > z !== B.z > z && x < ((B.x - A.x) * (z - A.z)) / (B.z - A.z) + A.x) inside = !inside;
    const vx = B.x - A.x;
    const vz = B.z - A.z;
    const t = Math.max(0, Math.min(1, ((x - A.x) * vx + (z - A.z) * vz) / (vx * vx + vz * vz || 1)));
    if (Math.hypot(x - A.x - vx * t, z - A.z - vz * t) < inset) return false;
  }
  return inside;
}

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
        const x = lot.x + lx * cs + lz * sn;
        const z = lot.z - lx * sn + lz * cs;
        if (lot.outline && !inLot(x, z, lot.outline, 3.5)) continue;
        spots.push({ x, z, y: lot.y, yaw: lot.yaw + (r % 2 ? Math.PI : 0) });
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
  const summit = world.lodges.find((l) => l.id === 'summit-hut');
  if (summit) {
    const h = summitHut(M);
    h.position.set(summit.x, summit.y - 0.3, summit.z);
    group.add(h);
  }
  for (const b of world.buildings) {
    const obj = STYLES[b.style](b, M);
    obj.position.set(b.wx, b.y - 0.3, b.wz);
    obj.rotation.y = b.wyaw;
    group.add(obj);
  }
  group.add(parkedCars(world.parking));
  return group;
}
