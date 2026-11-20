// Builds the Mt. Bachelor world data (no rendering): terrain heights, lift
// and lodge positions, roads, parking, and the ski-run network.

import {
  FT, LIFTS, LODGES, ROADS, PARKING, FEATURES, TREELINE_M, LAKES, NORDIC_TRAILS,
} from '../data/mountain.js';
import { pxToWorld, pxToSurface, SUMMIT_M } from './projection.js';
import { Heightfield, Mask } from './heightfield.js';
import { noise2, fbm, smoothstep, seededRandom, makeNoise2 } from './noise.js';

export const EXTENT = { minX: -5200, minZ: -3800, size: 10400 };
export const EDGE_HEIGHT = 1700;
// Cascade Lakes Highway west of the painted map, toward Sparks Lake.
const HIGHWAY_WEST = [
  { x: 1500, z: 5000 }, { x: 2700, z: 5250 }, { x: 3900, z: 5250 }, { x: 5150, z: 5400 },
];
const GRID_N = 705; // ~14.8 m cells
const MASK_RES = 1400; // ~7.4 m pixels

const gullyNoise = makeNoise2(77);

// Landforms placed off the trail map.
const features = FEATURES.map((f) => {
  const p = pxToWorld(f.px[0], f.px[1], f.elevFt * FT);
  return { ...f, x: p.x, z: p.z };
});

// The volcano: a concave cone with a small summit crater, radial gullies and
// rolling noise, plus extra landforms.
export function baseHeight(x, z) {
  const r = Math.hypot(x, z);
  // Profile fitted to the lift/lodge elevations on the trail map. The east
  // side (left on the map, -x) sits a little lower than the west.
  let h = 1835 + 928 * Math.exp(-Math.pow(r / 1930, 1.75));
  h += 0.015 * x * Math.min(1, r / 1500);
  h -= 0.05 * Math.max(0, r - 3300); // forest floor keeps falling away
  h += 30 * Math.exp(-((r / 420) ** 2)); // pointier summit cone

  // Summit crater and rim.
  h -= 20 * Math.exp(-((r / 95) ** 2));
  h += 6 * Math.exp(-(((r - 150) / 55) ** 2));

  // Radial gullies and ribs running down the cone.
  const a = Math.atan2(x, z); // seam faces south (behind the mountain)
  const gw = smoothstep(180, 1300, r) * (1 - smoothstep(3600, 5200, r));
  const rib = 1 - Math.abs(gullyNoise(a * 4.2, r / 1800 + 0.25 * noise2(x / 900, z / 900)));
  h += gw * (rib * rib - 0.45) * (14 + 14 * (1 - smoothstep(1200, 2600, r)));

  // Rolling terrain.
  h += fbm(x / 1400, z / 1400, 3) * 22 * smoothstep(400, 1800, r);
  h += fbm(x / 260, z / 260, 3) * 4.5;

  for (const f of features) {
    const d = Math.hypot(x - f.x, z - f.z);
    const q = d / f.radius;
    h += f.height * Math.exp(-q * q * 2.2);
    if (f.crater) h -= f.height * 0.35 * Math.exp(-((d / (f.radius * 0.28)) ** 2));
  }
  return h;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a, b, c, d) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) };
}

function smoothPath(ctrl, step = 14) {
  const pts = [];
  const ext = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
  for (let i = 1; i < ext.length - 2; i++) {
    const a = ext[i];
    const b = ext[i + 1];
    const segs = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let s = 0; s < segs; s++) pts.push(catmull(ext[i - 1], a, b, ext[i + 2], s / segs));
  }
  pts.push(ctrl[ctrl.length - 1]);
  return pts;
}

function difficultyFor(hf, pts) {
  let maxSlope = 0;
  let sum = 0;
  for (const p of pts) {
    const s = hf.gradient(p.x, p.z, 20).slope;
    sum += s;
    maxSlope = Math.max(maxSlope, s);
  }
  const avg = sum / pts.length;
  if (maxSlope > 0.8 || avg > 0.46) return 'black';
  if (avg > 0.24) return 'blue';
  return 'green';
}

// Runs fan out from a lift's top terminal and gather back to its bottom.
// Some branch off earlier runs part-way down, so the network looks like the
// painted trail map rather than a set of spokes.
function runsForLift(hf, lift, rand) {
  const { bottom: B, top: T } = lift;
  const len = Math.hypot(T.x - B.x, T.z - B.z);
  const dx = (B.x - T.x) / len;
  const dz = (B.z - T.z) / len;
  const nx = -dz;
  const nz = dx;
  const count = Math.max(3, Math.min(11, Math.round(len / 185)));
  const fan = len * (0.2 + rand() * 0.08);
  const at = (t, spread) => ({
    x: T.x + dx * len * t + nx * spread,
    z: T.z + dz * len * t + nz * spread,
  });
  const progress = (p) => ((p.x - T.x) * dx + (p.z - T.z) * dz) / len;
  const runs = [];
  const gap = (2 * fan) / count; // distance between neighbouring run centres
  const jitter = gap * 0.22;
  const wiggleAmp = Math.min(40, gap * 0.26);
  for (let k = 0; k < count; k++) {
    // Runs keep their left-to-right order all the way down, so they sit side
    // by side with strips of trees between them instead of crossing.
    const spread = (-1 + (2 * (k + 0.5)) / count) * fan + (rand() - 0.5) * jitter;
    let start = at(0.015, (k - (count - 1) / 2) * 7);
    if (k >= 1 && rand() < 0.45) {
      // Branch off the neighbouring run a little way down.
      const parent = runs[k - 1].pts;
      start = parent[Math.floor(parent.length * (0.12 + rand() * 0.28))];
    }
    const t0 = Math.max(0.015, progress(start));
    const span = 1 - t0;
    const ctrl = [
      start,
      at(t0 + span * 0.3, spread * 0.8 + (rand() - 0.5) * jitter),
      at(t0 + span * 0.62, spread + (rand() - 0.5) * jitter),
      at(0.92, spread * 0.55),
      at(1.0, Math.sign(spread || 1) * 30 + spread * 0.2),
    ];
    let pts = smoothPath(ctrl);
    const seed = rand() * 100;
    const total = pts.length;
    pts = pts.map((p, i) => {
      const t = i / (total - 1);
      const w = Math.sin(Math.PI * t) * wiggleAmp * noise2(seed + (t * len * span) / 230, seed * 0.37);
      return { x: p.x + nx * w, z: p.z + nz * w };
    });
    const width = Math.min(gap * 0.62, (lift.type === 'express' ? 28 : 24) + rand() * 22);
    runs.push({ lift: lift.id, pts, width: Math.max(20, width), difficulty: difficultyFor(hf, pts) });
  }
  return runs;
}

// A cat track that holds one elevation around the mountain between two
// bearings (radians, atan2(x, z): 0 = north, negative = east).
function contourTrack(hf, elevM, a0, a1) {
  const pts = [];
  const steps = Math.ceil(Math.abs(a1 - a0) / 0.012);
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    const sx = Math.sin(a);
    const sz = Math.cos(a);
    let lo = 40;
    let hi = 5000;
    for (let k = 0; k < 28; k++) {
      const mid = (lo + hi) / 2;
      if (hf.heightAt(sx * mid, sz * mid) > elevM) lo = mid;
      else hi = mid;
    }
    pts.push({ x: sx * lo, z: sz * lo });
  }
  // Smooth the wobble from gullies.
  return pts.map((p, i) => {
    let x = 0;
    let z = 0;
    let c = 0;
    for (let k = Math.max(0, i - 6); k <= Math.min(pts.length - 1, i + 6); k++) {
      x += pts[k].x;
      z += pts[k].z;
      c++;
    }
    return { x: x / c, z: z / c };
  });
}

// Irregular lake outline around an ellipse. q(x, z) < 1 inside the water.
function makeLake(L, i) {
  const noise = makeNoise2(500 + i);
  const yaw = (L.yawDeg * Math.PI) / 180;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const a = L.size[0] / 2;
  const b = L.size[1] / 2;
  const k = (ang) =>
    1 + 0.16 * noise(Math.cos(ang) * 1.3, Math.sin(ang) * 1.3) + 0.06 * noise(Math.cos(ang) * 4, Math.sin(ang) * 4);
  const q = (x, z) => {
    const dx = x - L.x;
    const dz = z - L.z;
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    return Math.hypot(lx / a, lz / b) / k(Math.atan2(lz / b, lx / a));
  };
  const outline = [];
  for (let n = 0; n < 96; n++) {
    const ang = (n / 96) * Math.PI * 2;
    const lx = a * k(ang) * Math.cos(ang);
    const lz = b * k(ang) * Math.sin(ang);
    outline.push({ x: L.x + lx * c + lz * s, z: L.z - lx * s + lz * c });
  }
  return { ...L, q, outline, reach: Math.max(a, b) * 1.3 };
}

export function buildWorld() {
  const hf = new Heightfield({ ...EXTENT, n: GRID_N });
  hf.fill(baseHeight);
  // Ease the outer border down to a flat forest floor so the land beyond the
  // map edge meets it cleanly.
  {
    const { n, cell, h } = hf;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const edgeDist = Math.min(i, j, n - 1 - i, n - 1 - j) * cell;
        const w = 1 - smoothstep(0, 900, edgeDist);
        h[j * n + i] += (EDGE_HEIGHT - h[j * n + i]) * w;
      }
    }
  }

  // --- Place lifts and lodges from the trail map at their real elevations.
  const lifts = LIFTS.map((l) => {
    const b = pxToWorld(l.bottomPx[0], l.bottomPx[1], l.bottomFt * FT);
    const t = pxToWorld(l.topPx[0], l.topPx[1], l.topFt * FT);
    return {
      ...l,
      bottom: { x: b.x, z: b.z, y: l.bottomFt * FT },
      top: { x: t.x, z: t.z, y: l.topFt * FT },
    };
  });
  const lodges = LODGES.map((l) => {
    const p = pxToWorld(l.px[0], l.px[1], l.elevFt * FT);
    const yaw = (l.yawDeg * Math.PI) / 180;
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const buildings = (l.buildings || []).map((b) => ({
      ...b,
      wx: p.x + b.x * c + b.z * sn,
      wz: p.z - b.x * sn + b.z * c,
      wyaw: yaw + ((b.yawDeg || 0) * Math.PI) / 180,
    }));
    return { ...l, x: p.x, z: p.z, y: l.elevFt * FT, yaw, buildings };
  });

  // --- Bend the terrain so it passes through every known elevation.
  const controls = [
    { x: 0, z: 0, y: SUMMIT_M },
    ...lifts.flatMap((l) => [l.bottom, l.top]),
    ...lodges,
  ];
  for (let iter = 0; iter < 8; iter++) {
    for (const c of controls) {
      const r = c.y - hf.heightAt(c.x, c.z);
      if (Math.abs(r) > 0.2) hf.addGaussian(c.x, c.z, r * 0.7, 560);
    }
  }

  // --- Roads and parking (unprojected onto the corrected surface).
  const heightFn = (x, z) => hf.heightAt(x, z);
  const inside = (p, m) =>
    p.x > hf.minX + m && p.x < hf.maxX - m && p.z > hf.minZ + m && p.z < hf.maxZ - m;
  const roads = ROADS.map((road) => {
    const ctrl = road.px.map(([u, v]) => pxToSurface(u, v, heightFn));
    if (road.id === 'cascade-lakes-hwy') {
      // Beyond the painted map: east toward Bend, and west past Sparks Lake.
      const [a, b] = ctrl;
      const len = Math.hypot(a.x - b.x, a.z - b.z);
      const dir = { x: (a.x - b.x) / len, z: (a.z - b.z) / len };
      // Run on a little, then swing north-east toward Bend.
      const east = [
        { x: a.x + dir.x * 500, z: a.z + dir.z * 500 },
        { x: a.x + dir.x * 1000 - 250, z: a.z + dir.z * 1000 + 350 },
        { x: a.x + dir.x * 1000 - 1400, z: a.z + dir.z * 1000 + 1100 },
        { x: a.x + dir.x * 1000 - 2800, z: a.z + dir.z * 1000 + 1900 },
      ];
      for (const p of east) if (inside(p, 60)) ctrl.unshift(p);
      for (const p of HIGHWAY_WEST) if (inside(p, 40)) ctrl.push({ ...p });
    }
    const pts = smoothPath(ctrl, 10).map((p) => ({ x: p.x, z: p.z, y: hf.heightAt(p.x, p.z) }));
    // Smooth the road's grade so it does not follow every bump.
    const smoothY = pts.map((_, i) => {
      let s = 0;
      let c = 0;
      for (let k = Math.max(0, i - 14); k <= Math.min(pts.length - 1, i + 14); k++) {
        s += pts[k].y;
        c++;
      }
      return s / c;
    });
    pts.forEach((p, i) => (p.y = smoothY[i]));
    return { ...road, pts };
  });
  for (const road of roads) {
    for (const p of road.pts) hf.flattenDisc(p.x, p.z, road.width / 2 + 3, 22, p.y - 0.4);
  }

  const parking = PARKING.map((lot) => {
    const p = pxToSurface(lot.px[0], lot.px[1], heightFn);
    return { ...lot, x: p.x, z: p.z, y: p.y, yaw: (lot.yawDeg * Math.PI) / 180 };
  });
  for (const lot of parking) {
    hf.flattenRect(lot.x, lot.z, lot.size[0], lot.size[1], lot.yaw, 30, lot.y);
  }

  // --- Building pads and lift terminal pads.
  for (const l of lodges) {
    hf.flattenDisc(l.x, l.z, 18, 25, l.y);
    for (const b of l.buildings) hf.flattenRect(b.wx, b.wz, b.w + 14, b.d + 14, b.wyaw, 22, l.y);
  }
  for (const l of lifts) {
    hf.flattenDisc(l.bottom.x, l.bottom.z, 14, 18, l.bottom.y);
    hf.flattenDisc(l.top.x, l.top.z, 12, 16, l.top.y);
  }
  // Re-sample elevations after flattening (roads may have nudged them).
  for (const l of lifts) {
    l.bottom.y = hf.heightAt(l.bottom.x, l.bottom.z);
    l.top.y = hf.heightAt(l.top.x, l.top.z);
  }
  for (const l of lodges) l.y = hf.heightAt(l.x, l.z);

  // --- Lakes. Ones inside the heightfield get a basin carved for them.
  const lakes = LAKES.map((L, i) => makeLake(L, i));
  for (const lake of lakes) {
    if (!inside(lake, 0) || lake.x + lake.reach > hf.maxX || lake.z + lake.reach > hf.maxZ) {
      lake.level = EDGE_HEIGHT + 0.4;
      continue;
    }
    let level = Infinity;
    for (const p of lake.outline) level = Math.min(level, hf.heightAt(p.x, p.z));
    lake.level = level - 1;
    hf.forEachNear(lake.x, lake.z, lake.reach * 1.4, (k, cx, cz) => {
      const q = lake.q(cx, cz);
      if (q < 1) hf.h[k] = lake.level - 4 * Math.min(1, (1 - q) * 4);
      else if (q < 1.4) {
        const t = smoothstep(1, 1.4, q);
        hf.h[k] = (lake.level + 0.6) * (1 - t) + hf.h[k] * t;
      }
    });
  }
  const lakeAt = (x, z) => {
    let best = 9;
    for (const lake of lakes) {
      if (Math.abs(x - lake.x) > lake.reach * 1.3 || Math.abs(z - lake.z) > lake.reach * 1.3) continue;
      best = Math.min(best, lake.q(x, z));
    }
    return best; // < 1 means in the water
  };

  // --- Nordic Center trail loops.
  const nordicLodge = lodges.find((l) => l.id === 'nordic');
  const nordicTrails = NORDIC_TRAILS.map((t, i) => {
    const noise = makeNoise2(300 + i);
    const cx = nordicLodge.x + t.dx;
    const cz = nordicLodge.z + t.dz;
    const pts = [];
    const steps = Math.ceil((2 * Math.PI * Math.max(t.rx, t.rz)) / 12);
    for (let k = 0; k <= steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      const w = 1 + (t.wobble / Math.max(t.rx, t.rz)) * noise(Math.cos(a) * 1.6, Math.sin(a) * 1.6);
      pts.push({ x: cx + Math.cos(a) * t.rx * w, z: cz + Math.sin(a) * t.rz * w });
    }
    // Connector from the lodge to the nearest point on the loop.
    let near = pts[0];
    for (const p of pts) {
      if (Math.hypot(p.x - nordicLodge.x, p.z - nordicLodge.z) < Math.hypot(near.x - nordicLodge.x, near.z - nordicLodge.z)) near = p;
    }
    const link = smoothPath([{ x: nordicLodge.x, z: nordicLodge.z }, near], 10);
    return { ...t, pts, link };
  });

  // --- Ski runs.
  const rand = seededRandom(1958);
  const runs = lifts.flatMap((l) => (l.id === 'little-pine' ? [] : runsForLift(hf, l, rand)));
  // Cat tracks: one around the mountain at Pine Marten Lodge level, one
  // linking Sunrise and West Village along the bottom.
  const bearing = (p) => Math.atan2(p.x, p.z);
  const cc = lifts.find((l) => l.id === 'cloudchaser');
  const nw = lifts.find((l) => l.id === 'northwest');
  const pmLodge = lodges.find((l) => l.id === 'pine-marten-lodge');
  const srLodge = lodges.find((l) => l.id === 'sunrise-lodge');
  const wvLodge = lodges.find((l) => l.id === 'west-village');
  runs.push({
    lift: null,
    kind: 'catwalk',
    pts: contourTrack(hf, pmLodge.y - 8, bearing(cc.top) - 0.05, bearing(nw.top) + 0.08),
    width: 16,
    difficulty: 'green',
  });
  runs.push({
    lift: null,
    kind: 'catwalk',
    pts: contourTrack(hf, (srLodge.y + wvLodge.y) / 2 + 25, bearing(srLodge) + 0.03, bearing(wvLodge) - 0.03),
    width: 15,
    difficulty: 'green',
  });
  // Little Pine: one wide, gentle beginner slope.
  const lp = lifts.find((l) => l.id === 'little-pine');
  runs.push({
    lift: lp.id,
    pts: smoothPath([lp.top, { x: lerp(lp.top.x, lp.bottom.x, 0.5) + 25, z: lerp(lp.top.z, lp.bottom.z, 0.5) }, lp.bottom]),
    width: 95,
    difficulty: 'green',
  });

  // --- Clearing mask: where the forest is cut (runs, lift lines, base areas).
  const clear = new Mask(EXTENT, MASK_RES);
  for (const r of runs) clear.polyline(r.pts, r.width / 2, 10);
  for (const l of lifts) {
    clear.segment(l.bottom.x, l.bottom.z, l.top.x, l.top.z, 13, 6);
    clear.disc(l.bottom.x, l.bottom.z, 55, 25);
    clear.disc(l.top.x, l.top.z, 45, 20);
  }
  for (const l of lodges) {
    clear.disc(l.x, l.z, 40, 30);
    for (const b of l.buildings) clear.disc(b.wx, b.wz, Math.max(b.w, b.d) * 0.75 + 12, 20);
  }
  for (const t of nordicTrails) {
    clear.polyline(t.pts, t.width / 2 + 3, 5);
    clear.polyline(t.link, t.width / 2 + 3, 5);
  }
  for (const lake of lakes) {
    if (lake.level > EDGE_HEIGHT + 1) clear.polyline([...lake.outline, lake.outline[0]], 25, 15);
  }
  for (const road of roads) clear.polyline(road.pts, road.width / 2 + 9, 6);
  for (const lot of parking) clear.disc(lot.x, lot.z, Math.max(...lot.size) * 0.62, 25);

  // Base-area beginner meadows.
  const wv = lodges.find((l) => l.id === 'west-village');
  const sr = lodges.find((l) => l.id === 'sunrise-lodge');
  clear.disc(wv.x, wv.z - 110, 170, 60);
  clear.disc(sr.x + 20, sr.z - 90, 120, 50);

  return {
    hf, lifts, lodges, roads, parking, runs, clear, features, lakes, lakeAt, nordicTrails,
    treeline: TREELINE_M,
  };
}
