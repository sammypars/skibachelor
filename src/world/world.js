// Builds the Mt. Bachelor world data (no rendering): terrain heights, lift
// and lodge positions, roads, parking, lakes and the ski-run network.
//
// The ground is real elevation data and everything on it (lifts, runs,
// buildings, roads, parking, Nordic trails, lakes) is real OpenStreetMap
// geometry, baked by tools/fetch-geo.mjs. mountain.js adds what the data does
// not say: lift types and colors, labels, building styles.

import { GEO, EXTRA_PARKS, RACE, LIFTS, LODGES, BUILDING_STYLES, TREELINE_M, LAKES, LANDMARKS, TRAIL_MAP_TIES } from '../data/mountain.js';
import { fitTrailMap } from './projection.js';
import { Heightfield, Mask } from './heightfield.js';
import { smoothstep, makeNoise2 } from './noise.js';

export const EXTENT = { minX: GEO.terrain.minX, minZ: GEO.terrain.minZ, size: GEO.terrain.size };
export const EDGE_HEIGHT = 1790; // mean real elevation around the map edge
const GRID_N = GEO.terrain.n;
const MASK_RES = 1400; // ~7.4 m pixels

// ---------------------------------------------------------------- geometry helpers
const P = (a) => ({ x: a[0], z: a[1] });

function centroid(pts) {
  let x = 0;
  let z = 0;
  const ring = pts.length > 1 && pts[0].x === pts.at(-1).x && pts[0].z === pts.at(-1).z ? pts.slice(0, -1) : pts;
  for (const p of ring) {
    x += p.x;
    z += p.z;
  }
  return { x: x / ring.length, z: z / ring.length };
}

// Minimum-area bounding rectangle of a footprint: center, long side w,
// short side d, and the yaw that turns local +x onto the long side.
function orientedBox(pts) {
  const c = centroid(pts);
  let best = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = Math.atan2(pts[i + 1].z - pts[i].z, pts[i + 1].x - pts[i].x);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const p of pts) {
      const u = (p.x - c.x) * ca + (p.z - c.z) * sa;
      const v = -(p.x - c.x) * sa + (p.z - c.z) * ca;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, a, u0, u1, v0, v1 };
  }
  let { a, u0, u1, v0, v1 } = best;
  // Center of the box (not the vertex centroid).
  const cu = (u0 + u1) / 2;
  const cv = (v0 + v1) / 2;
  const x = c.x + cu * Math.cos(a) - cv * Math.sin(a);
  const z = c.z + cu * Math.sin(a) + cv * Math.cos(a);
  let w = u1 - u0;
  let d = v1 - v0;
  if (d > w) {
    [w, d] = [d, w];
    a += Math.PI / 2;
  }
  // three.js yaw: rotation.y = yaw maps local +x to (cos yaw, -sin yaw).
  return { x, z, w, d, yaw: -a };
}

// Resample a polyline so no two points are more than `step` apart.
function densify(pts, step = 10) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  return out;
}

function smoothPolyline(pts, passes = 2) {
  let cur = pts;
  for (let p = 0; p < passes; p++) {
    cur = cur.map((q, i) => {
      if (i === 0 || i === cur.length - 1) return q;
      return { x: (cur[i - 1].x + 2 * q.x + cur[i + 1].x) / 4, z: (cur[i - 1].z + 2 * q.z + cur[i + 1].z) / 4 };
    });
  }
  return cur;
}

// ---------------------------------------------------------------- lakes
// A lake from a shoreline polygon. q(x, z) < 1 inside the water, rising
// smoothly outside (distance from the center relative to the shoreline in
// that direction), which the basin carving and tree planting use.
function lakeFromOutline(name, outline) {
  const c = centroid(outline);
  const BINS = 180;
  const radius = new Float32Array(BINS);
  for (let k = 0; k < BINS; k++) {
    const ang = (k / BINS) * Math.PI * 2;
    const dx = Math.cos(ang);
    const dz = Math.sin(ang);
    let r = 0;
    for (let i = 0; i < outline.length - 1; i++) {
      // Ray / segment intersection.
      const ax = outline[i].x - c.x;
      const az = outline[i].z - c.z;
      const bx = outline[i + 1].x - c.x;
      const bz = outline[i + 1].z - c.z;
      const ex = bx - ax;
      const ez = bz - az;
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = (ax * ez - az * ex) / den;
      const s = (ax * dz - az * dx) / den;
      if (t > 0 && s >= 0 && s <= 1) r = Math.max(r, t);
    }
    radius[k] = r;
  }
  const R = (ang) => {
    const f = ((ang / (Math.PI * 2)) * BINS + BINS) % BINS;
    const i = Math.floor(f);
    const t = f - i;
    return radius[i] * (1 - t) + radius[(i + 1) % BINS] * t || 1;
  };
  const q = (x, z) => Math.hypot(x - c.x, z - c.z) / R(Math.atan2(z - c.z, x - c.x));
  const reach = Math.max(...radius) * 1.3;
  return { name, x: c.x, z: c.z, q, outline, reach };
}

// Irregular ellipse, for lakes OpenStreetMap does not give a full shoreline for.
function lakeFromEllipse(L, i) {
  const noise = makeNoise2(500 + i);
  const yaw = (L.yawDeg * Math.PI) / 180;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const a = L.size[0] / 2;
  const b = L.size[1] / 2;
  const outline = [];
  for (let n = 0; n <= 96; n++) {
    const ang = (n / 96) * Math.PI * 2;
    const k = 1 + 0.16 * noise(Math.cos(ang) * 1.3, Math.sin(ang) * 1.3) + 0.06 * noise(Math.cos(ang) * 4, Math.sin(ang) * 4);
    const lx = a * k * Math.cos(ang);
    const lz = b * k * Math.sin(ang);
    outline.push({ x: L.x + lx * c + lz * s, z: L.z - lx * s + lz * c });
  }
  return { ...lakeFromOutline(L.name, outline), elevFt: L.elevFt };
}

// ---------------------------------------------------------------- runs
const CATWALK = /\b(road|getback|crossover|connection|catchline|shuttle|alley|way|i-5|zoom|leeway|runway)\b/i;
const DIFFICULTY = { novice: 'green', easy: 'green', intermediate: 'blue', advanced: 'black', expert: 'double', freeride: 'double' };
// Typical cut widths (m). Mt. Bachelor's runs are broad; groomers below
// Pine Marten are often 50-80 m across.
const RUN_WIDTH = { green: 62, blue: 56, black: 44, double: 36 };

function runFromOsm(r, i) {
  const difficulty = DIFFICULTY[r.difficulty] || 'blue';
  const catwalk = CATWALK.test(r.name || '');
  const kind = r.type === 'snow_park' ? 'park' : catwalk ? 'catwalk' : 'run';
  const width = kind === 'catwalk' ? 18 : kind === 'park' ? 50 : RUN_WIDTH[difficulty] * (0.8 + 0.4 * ((i * 0.618) % 1));
  return { name: r.name, kind, difficulty, width, pts: smoothPolyline(densify(r.pts.map(P), 8)) };
}

// ---------------------------------------------------------------- build
export function buildWorld(geo) {
  const { osm } = geo;
  const hf = new Heightfield({ ...EXTENT, n: GRID_N });
  hf.h.set(geo.heights);
  // The real land around the map, and a height lookup that works anywhere.
  const region = geo.region || {};
  const regionAt = (x, z) => sampleRegion(region.mid, x, z) ?? sampleRegion(region.far, x, z) ?? EDGE_HEIGHT;
  // Ease the outer border onto the surrounding land (the coarser regional
  // grid, or a flat forest floor without it) so the two meet without a seam.
  {
    const { n, cell, h } = hf;
    const blend = region.mid ? 300 : 700;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const edgeDist = Math.min(i, j, n - 1 - i, n - 1 - j) * cell;
        if (edgeDist > blend) continue;
        const w = 1 - smoothstep(0, blend, edgeDist);
        const target = region.mid ? regionAt(hf.minX + i * cell, hf.minZ + j * cell) : EDGE_HEIGHT;
        h[j * n + i] += (target - h[j * n + i]) * w;
      }
    }
  }
  const groundAt = (x, z) =>
    x > hf.minX && x < hf.maxX && z > hf.minZ && z < hf.maxZ ? hf.heightAt(x, z) : regionAt(x, z);
  const H = (x, z) => hf.heightAt(x, z);

  // --- Lifts, by their OpenStreetMap names. Bottom is the first point.
  const lifts = LIFTS.map((l) => {
    const way = osm.lifts.find((w) => w.name === l.osm);
    if (!way) throw new Error(`No lift named "${l.osm}" in osm.json`);
    const b = P(way.pts[0]);
    const t = P(way.pts.at(-1));
    return { ...l, bottom: { ...b, y: H(b.x, b.z) }, top: { ...t, y: H(t.x, t.z) } };
  });
  const nearLiftEnd = (p, r) =>
    lifts.some((l) => Math.hypot(l.bottom.x - p.x, l.bottom.z - p.z) < r || Math.hypot(l.top.x - p.x, l.top.z - p.z) < r);

  // --- Buildings from real footprints. Lift stations are drawn by the lift
  // renderer, so skip footprints sitting on a lift terminal.
  const buildings = [];
  for (const fp of osm.buildings) {
    const pts = fp.pts.map(P);
    const box = orientedBox(pts);
    if (nearLiftEnd(box, 22) && box.w < 40) continue;
    const style = BUILDING_STYLES[fp.name] || (box.w > 20 ? { style: 'shed', h: 7 } : { style: 'hut', h: 4.5 });
    // Floor level: the downhill corner, so the building digs into the slope
    // instead of floating.
    const g = hf.gradient(box.x, box.z, 15);
    const ys = pts.map((p) => H(p.x, p.z));
    const y = (Math.min(...ys) + Math.max(...ys)) / 2;
    const yaw = box.yaw;
    // Local +z after rotation is (sin yaw, cos yaw); face decks downhill.
    const down = -(Math.sin(yaw) * g.dx + Math.cos(yaw) * g.dz);
    const side = down >= 0 ? 1 : -1;
    const parts = style.parts || [{ style: style.style, dw: 1, dd: 1, dx: 0, dz: 0, h: style.h, deck: style.deck }];
    for (const part of parts) {
      const lx = (part.dx || 0) * box.w;
      const lz = (part.dz || 0) * box.d * side;
      buildings.push({
        name: fp.name,
        style: part.style,
        w: box.w * part.dw,
        d: box.d * part.dd,
        h: part.h,
        deck: part.deck ? side : 0,
        // Local +x is (cos yaw, -sin yaw), local +z is (sin yaw, cos yaw).
        wx: box.x + lx * Math.cos(yaw) + lz * Math.sin(yaw),
        wz: box.z - lx * Math.sin(yaw) + lz * Math.cos(yaw),
        wyaw: yaw,
        y,
        footprint: { x: box.x, z: box.z, w: box.w, d: box.d, yaw },
      });
    }
  }

  // --- Lodges: named anchors for labels and camera views.
  const lodges = LODGES.map((l) => {
    let p = l.at ? { x: l.at[0], z: l.at[1] } : null;
    let size = [10, 10, 6];
    if (l.osm) {
      const fp = osm.buildings.find((b) => b.name === l.osm);
      if (!fp) throw new Error(`No building named "${l.osm}" in osm.json`);
      const box = orientedBox(fp.pts.map(P));
      p = box;
      size = [box.w, box.d, (BUILDING_STYLES[l.osm] || {}).h || 10];
    }
    return { ...l, x: p.x, z: p.z, y: H(p.x, p.z), size };
  });

  // --- Roads and parking that are plowed in winter: the highway up to West
  // Village, and the access roads and lots around the base areas.
  const bases = lodges.filter((l) => l.base);
  const nearBase = (p, r) => bases.some((b) => Math.hypot(b.x - p.x, b.z - p.z) < r);
  const roads = [];
  for (const r of osm.roads) {
    let pts = r.pts.map(P);
    if (r.name === 'Cascade Lakes Highway') {
      // Closed past West Village all winter.
      pts = pts.filter((p) => p.x < -650);
    } else if (!pts.every((p) => nearBase(p, 1300) && H(p.x, p.z) < 2000)) continue;
    if (pts.length < 2) continue;
    const width = r.highway === 'secondary' ? 11 : r.highway === 'service' ? 7 : 9;
    const line = densify(pts, 10).map((p) => ({ ...p, y: H(p.x, p.z) }));
    // Smooth the grade so the road does not follow every bump.
    const ys = line.map((_, i) => {
      let s = 0;
      let c = 0;
      for (let k = Math.max(0, i - 6); k <= Math.min(line.length - 1, i + 6); k++) {
        s += line[k].y;
        c++;
      }
      return s / c;
    });
    line.forEach((p, i) => (p.y = ys[i]));
    roads.push({ id: r.name || r.highway, width, pts: line });
  }
  for (const road of roads) {
    for (const p of road.pts) hf.flattenDisc(p.x, p.z, road.width / 2 + 2, 14, p.y - 0.3);
  }

  const parking = [];
  for (const lot of osm.parking) {
    const pts = lot.pts.map(P);
    const box = orientedBox(pts);
    if (!nearBase(box, 1300)) continue;
    const y = pts.reduce((s, p) => s + H(p.x, p.z), 0) / pts.length;
    parking.push({ id: lot.name || 'lot', x: box.x, z: box.z, y, yaw: box.yaw, size: [box.w, box.d], outline: pts });
  }
  for (const lot of parking) hf.flattenRect(lot.x, lot.z, lot.size[0], lot.size[1], lot.yaw, 25, lot.y);

  // --- Building pads and lift terminal pads (each at its own real height,
  // so they sit in the slope rather than on a plinth).
  for (const b of buildings) {
    const f = b.footprint;
    hf.flattenRect(f.x, f.z, f.w + 8, f.d + 8, f.yaw, 14, b.y);
  }
  for (const l of lifts) {
    hf.flattenDisc(l.bottom.x, l.bottom.z, 12, 16, l.bottom.y);
    hf.flattenDisc(l.top.x, l.top.z, 10, 14, l.top.y);
  }
  for (const l of lifts) {
    l.bottom.y = H(l.bottom.x, l.bottom.z);
    l.top.y = H(l.top.x, l.top.z);
  }
  for (const l of lodges) l.y = H(l.x, l.z);

  // --- Lakes: real shorelines where OpenStreetMap has a closed one, else
  // the approximate outlines in mountain.js.
  const inside = (p, m) => p.x > hf.minX + m && p.x < hf.maxX - m && p.z > hf.minZ + m && p.z < hf.maxZ - m;
  const lakes = [];
  for (const w of osm.water) {
    const pts = w.pts.map(P);
    const closed = pts.length > 3 && pts[0].x === pts.at(-1).x && pts[0].z === pts.at(-1).z;
    if (closed && pts.every((p) => inside(p, 60))) lakes.push(lakeFromOutline(w.name, pts));
  }
  LAKES.forEach((L, i) => {
    if (!lakes.some((k) => k.name === L.name)) lakes.push(lakeFromEllipse(L, i));
  });
  for (const lake of lakes) {
    if (!inside(lake, 0) || lake.x + lake.reach > hf.maxX || lake.z + lake.reach > hf.maxZ ||
        lake.x - lake.reach < hf.minX || lake.z - lake.reach < hf.minZ) {
      lake.level = groundAt(lake.x, lake.z) + 0.4;
      lake.offMap = true;
      continue;
    }
    let level = Infinity;
    for (const p of lake.outline) level = Math.min(level, H(p.x, p.z));
    lake.level = level - 0.6;
    hf.forEachNear(lake.x, lake.z, lake.reach * 1.4, (k, cx, cz) => {
      const q = lake.q(cx, cz);
      if (q < 1) hf.h[k] = Math.min(hf.h[k], lake.level - 3 * Math.min(1, (1 - q) * 4));
      else if (q < 1.25) {
        const t = smoothstep(1, 1.25, q);
        hf.h[k] = Math.min(hf.h[k], (lake.level + 0.5) * (1 - t) + hf.h[k] * t);
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

  // --- Runs, terrain parks and Nordic trails.
  const runs = [];
  const areas = [];
  const nordicTrails = [];
  osm.runs.forEach((r, i) => {
    if (r.type === 'nordic') {
      nordicTrails.push({ name: r.name, width: 6, pts: densify(r.pts.map(P), 8), link: [] });
    } else if (r.type === 'downhill' || r.type === 'snow_park') {
      if (r.area) areas.push({ name: r.name, difficulty: DIFFICULTY[r.difficulty] || null, gladed: r.grooming === 'backcountry', pts: r.pts.map(P) });
      else runs.push(runFromOsm(r, i));
    }
  });
  // Woodward parks that OpenStreetMap doesn't have, laid beside their lift
  // line on whichever side the real tree cover is more open.
  const canopyEarly = makeCanopy(geo.trees);
  for (const zone of EXTRA_PARKS) {
    const l = lifts.find((x) => x.id === zone.lift);
    if (!l) continue;
    const ux = l.bottom.x - l.top.x;
    const uz = l.bottom.z - l.top.z;
    const len = Math.hypot(ux, uz);
    const line = (off) => {
      const pts = [];
      for (let t = zone.from; t <= zone.to + 1e-6; t += 8 / len) {
        pts.push({ x: l.top.x + ux * t - (uz / len) * off, z: l.top.z + uz * t + (ux / len) * off });
      }
      return pts;
    };
    const cover = (pts) => pts.reduce((a, p) => a + (canopyEarly(p.x, p.z)?.v ?? 0.5), 0);
    const a = line(zone.offset);
    const b = line(-zone.offset);
    runs.push({ name: zone.name, kind: 'park', difficulty: 'easy', width: zone.width, pts: cover(a) <= cover(b) ? a : b });
  }

  // Every run runs top to bottom (OpenStreetMap ways are usually drawn that
  // way, not always), and knows its length.
  for (const r of runs) {
    if (H(r.pts[0].x, r.pts[0].z) < H(r.pts.at(-1).x, r.pts.at(-1).z)) r.pts.reverse();
    let len = 0;
    r.cum = r.pts.map((p, i) => (len += i ? Math.hypot(p.x - r.pts[i - 1].x, p.z - r.pts[i - 1].z) : 0));
    r.length = len;
  }

  // --- Clearing masks. `cut` is everything built (lift lines, buildings,
  // roads, lots, lakes, park corridors); `clear` adds the runs, for places
  // without real tree cover.
  const cut = new Mask(EXTENT, MASK_RES);
  for (const l of lifts) {
    cut.segment(l.bottom.x, l.bottom.z, l.top.x, l.top.z, l.type === 'express' ? 12 : 9, 5);
    cut.disc(l.bottom.x, l.bottom.z, 40, 20);
    cut.disc(l.top.x, l.top.z, 32, 16);
  }
  for (const b of buildings) {
    const f = b.footprint;
    cut.disc(f.x, f.z, Math.max(f.w, f.d) * 0.6 + 14, 16);
  }
  for (const l of lodges) if (l.base) cut.disc(l.x, l.z, 90, 40);
  for (const lake of lakes) if (!lake.offMap) cut.polyline([...lake.outline, lake.outline[0]], 20, 15);
  for (const road of roads) cut.polyline(road.pts, road.width / 2 + 8, 6);
  for (const lot of parking) cut.polygon(lot.outline, 12);
  // Park features need their lanes clear of trees.
  for (const r of runs) if (r.kind === 'park') cut.polyline(r.pts, 22, 6);
  // The race corridor on Cliffhanger is cleared out to its B-net.
  const raceRun = runs.filter((r) => r.name === RACE.run).sort((x, y) => y.length - x.length)[0];
  if (raceRun) cut.polyline(raceRun.pts, RACE.fence + 4, 8);

  const clear = new Mask(EXTENT, MASK_RES);
  clear.data.set(cut.data);
  for (const r of runs) clear.polyline(r.pts, r.width / 2, r.kind === 'catwalk' ? 5 : 12);
  for (const a of areas) if (!a.gladed) clear.polygon(a.pts, 15);
  for (const t of nordicTrails) clear.polyline(t.pts, t.width / 2 + 2, 4);

  // --- Real tree cover from aerial imagery over the ski area.
  const canopyAt = makeCanopy(geo.trees);
  // How open the ground is (0 = forest, 1 = open): the real canopy where we
  // have it, blended into the run-based mask toward the edge of its box.
  const openAt = (x, z) => {
    const c = canopyAt(x, z);
    if (c === null) return clear.at(x, z);
    const real = Math.max(cut.at(x, z), 1 - smoothstep(0.22, 0.6, c.v));
    return c.w >= 1 ? real : real * c.w + clear.at(x, z) * (1 - c.w);
  };

  // --- Landmarks: named high points (label anchors).
  const landmarks = LANDMARKS.map((m) => {
    // Snap to the highest ground within `search` meters of the given spot.
    let best = { x: m.at[0], z: m.at[1], y: -Infinity };
    hf.forEachNear(m.at[0], m.at[1], m.search || 0, (k, cx, cz) => {
      if (hf.h[k] > best.y) best = { x: cx, z: cz, y: hf.h[k] };
    });
    if (!Number.isFinite(best.y)) best.y = H(best.x, best.z);
    return { name: m.name, ...best };
  });

  // --- The painted trail map, fitted to the real positions of the lifts so
  // the overlay and cursor dot line up.
  const ties = [];
  for (const t of TRAIL_MAP_TIES) {
    const l = lifts.find((x) => x.id === t.lift);
    if (!l) continue;
    if (t.bottomPx) ties.push({ px: t.bottomPx, w: l.bottom });
    if (t.topPx) ties.push({ px: t.topPx, w: l.top });
  }
  const toMapPx = fitTrailMap(ties);

  return {
    hf, region, groundAt, lifts, lodges, buildings, roads, parking, runs, areas, clear, cut, openAt, canopyAt, lakes, lakeAt, nordicTrails,
    landmarks, toMapPx, treeline: TREELINE_M,
  };
}

// Bilinear lookup into the baked tree-cover grid: {v: 0..1 canopy, w: 0..1
// confidence that fades to 0 at the grid's edge}, or null outside it.
function makeCanopy(data) {
  const { minX, minZ, size, n } = GEO.trees;
  if (!data || data.length !== n * n) return () => null;
  const cell = size / n;
  const FADE = 200;
  const out = { v: 0, w: 0 };
  return (x, z) => {
    const fx = (x - minX) / cell - 0.5;
    const fz = (z - minZ) / cell - 0.5;
    if (fx < 0 || fz < 0 || fx >= n - 1 || fz >= n - 1) return null;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const k = j * n + i;
    const a = data[k] + (data[k + 1] - data[k]) * tx;
    const b = data[k + n] + (data[k + n + 1] - data[k + n]) * tx;
    out.v = (a + (b - a) * tz) / 255;
    const edge = Math.min(x - minX, z - minZ, minX + size - x, minZ + size - z);
    out.w = Math.min(1, edge / FADE);
    return out;
  };
}

// Bilinear height from a regional grid, or null outside it.
function sampleRegion(r, x, z) {
  if (!r) return null;
  const fx = (x - r.minX) / r.cell;
  const fz = (z - r.minZ) / r.cell;
  if (fx < 0 || fz < 0 || fx >= r.n - 1 || fz >= r.n - 1) return null;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const tx = fx - i;
  const tz = fz - j;
  const k = j * r.n + i;
  const a = r.h[k] + (r.h[k + 1] - r.h[k]) * tx;
  const b = r.h[k + r.n] + (r.h[k + r.n + 1] - r.h[k + r.n]) * tx;
  return a + (b - a) * tz;
}
