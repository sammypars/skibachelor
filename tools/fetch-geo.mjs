// Downloads the real-world data the map is built from and bakes it into
// compact files under src/data/geo/. Run once (or to refresh): npm run geo
//
//   terrain.bin / terrain.json  Elevation grid over the map extent, from the
//                               AWS Terrain Tiles open dataset (Terrarium PNGs,
//                               USGS 3DEP 10 m in the US).
//   osm.json                    Lifts, runs, buildings, parking, roads, lakes
//                               and peaks from OpenStreetMap (ODbL,
//                               (c) OpenStreetMap contributors), already in
//                               world meters.
//
// Node 18+ only, no dependencies. Downloads are cached in tools/.cache.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { GEO } from '../src/data/mountain.js';
import { lonLatToWorld, worldToLonLat } from '../src/world/geo.js';

const ROOT = new URL('..', import.meta.url);
const CACHE = new URL('tools/.cache/', ROOT);
const OUT = new URL('src/data/geo/', ROOT);
const UA = 'mt-bachelor-3d-map/0.2 (terrain baker)';
const DEM_ZOOM = 14; // ~7 m pixels at this latitude

await mkdir(CACHE, { recursive: true });
await mkdir(OUT, { recursive: true });

async function cached(name, fetcher) {
  const file = new URL(name, CACHE);
  if (existsSync(file)) return readFile(file);
  const buf = Buffer.from(await fetcher());
  await writeFile(file, buf);
  return buf;
}

// ---------------------------------------------------------------- PNG decoding
function decodePng(buf) {
  let p = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('unsupported PNG');
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const bpp = { 2: 3, 6: 4 }[colorType];
  if (!bpp) throw new Error(`unsupported PNG color type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0;
      const b = y > 0 ? out[dst - stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[dst + x] = v & 255;
    }
  }
  return { width, height, bpp, data: out };
}

// ---------------------------------------------------------------- elevation
const tiles = new Map();
async function tile(z, tx, ty) {
  const key = `${z}/${tx}/${ty}`;
  if (!tiles.has(key)) {
    const buf = await cached(`terrarium-${z}-${tx}-${ty}.png`, async () => {
      const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`;
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      return res.arrayBuffer();
    });
    const png = decodePng(buf);
    const h = new Float32Array(256 * 256);
    for (let k = 0; k < 256 * 256; k++) {
      const o = k * png.bpp;
      h[k] = png.data[o] * 256 + png.data[o + 1] + png.data[o + 2] / 256 - 32768;
    }
    tiles.set(key, h);
  }
  return tiles.get(key);
}

// Web Mercator pixel coordinates at zoom z.
function mercPx(lon, lat, z) {
  const n = 256 * 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
}

async function pixel(z, px, py) {
  const tx = Math.floor(px / 256);
  const ty = Math.floor(py / 256);
  const t = await tile(z, tx, ty);
  return t[(py - ty * 256) * 256 + (px - tx * 256)];
}

async function elevation(lon, lat, z = DEM_ZOOM) {
  const [fx, fy] = mercPx(lon, lat, z);
  const x = Math.floor(fx - 0.5);
  const y = Math.floor(fy - 0.5);
  const tx = fx - 0.5 - x;
  const ty = fy - 0.5 - y;
  const a = await pixel(z, x, y);
  const b = await pixel(z, x + 1, y);
  const c = await pixel(z, x, y + 1);
  const d = await pixel(z, x + 1, y + 1);
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

async function bakeTerrain() {
  const { minX, minZ, size, n } = GEO.terrain;
  const cell = size / (n - 1);
  const q = new Uint16Array(n * n);
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const [lon, lat] = worldToLonLat(minX + i * cell, minZ + j * cell);
      const h = await elevation(lon, lat);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
      q[j * n + i] = Math.round((h - GEO.terrain.offset) / GEO.terrain.step);
    }
  }
  await writeFile(new URL('terrain.bin', OUT), Buffer.from(q.buffer));
  console.log(`terrain: ${n}x${n}, ${tiles.size} tiles, ${lo.toFixed(0)}..${hi.toFixed(0)} m`);
}

// The land around the map, out to the horizon peaks, at two levels of
// detail (same uint16 encoding as terrain.bin).
async function bakeRegion() {
  for (const [name, r] of Object.entries(GEO.region)) {
    const cell = r.size / (r.n - 1);
    const q = new Uint16Array(r.n * r.n);
    let hi = -Infinity;
    for (let j = 0; j < r.n; j++) {
      for (let i = 0; i < r.n; i++) {
        const [lon, lat] = worldToLonLat(r.minX + i * cell, r.minZ + j * cell);
        const h = Math.max(GEO.terrain.offset, await elevation(lon, lat, r.zoom));
        hi = Math.max(hi, h);
        q[j * r.n + i] = Math.round((h - GEO.terrain.offset) / GEO.terrain.step);
      }
    }
    await writeFile(new URL(`region-${name}.bin`, OUT), Buffer.from(q.buffer));
    console.log(`region ${name}: ${r.n}x${r.n}, ${cell.toFixed(0)} m cells, top ${hi.toFixed(0)} m`);
  }
}

// ---------------------------------------------------------------- OpenStreetMap
async function bakeOsm() {
  const { minX, minZ, size } = GEO.terrain;
  const [w, s] = worldToLonLat(minX + size, minZ); // +x is west
  const [e, nth] = worldToLonLat(minX, minZ + size);
  const bbox = `${s.toFixed(5)},${w.toFixed(5)},${nth.toFixed(5)},${e.toFixed(5)}`;
  const query = `[out:json][timeout:90];
(
  way["aerialway"](${bbox});
  way["piste:type"](${bbox});
  relation["piste:type"](${bbox});
  way["building"](${bbox});
  way["amenity"="parking"](${bbox});
  way["highway"~"^(primary|secondary|tertiary|unclassified|service)$"](${bbox});
  way["natural"="water"](${bbox});
  relation["natural"="water"](${bbox});
  node["natural"="peak"](${bbox});
);
out geom tags;`;
  const buf = await cached('osm.json', async () => {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!res.ok) throw new Error(`overpass: ${res.status}`);
    return res.arrayBuffer();
  });
  const { elements } = JSON.parse(buf.toString('utf8'));
  const r1 = (v) => Math.round(v * 10) / 10;
  const pts = (geom) => geom.map((g) => lonLatToWorld(g.lon, g.lat).map(r1));
  const closed = (geom) => geom.length > 3 && geom[0].lat === geom.at(-1).lat && geom[0].lon === geom.at(-1).lon;
  // A multipolygon's outer boundary is often split over several ways: chain
  // them end to end into closed rings.
  const same = (a, b) => a.lat === b.lat && a.lon === b.lon;
  const outerRings = (rel) => {
    const parts = (rel.members || []).filter((m) => m.role === 'outer' && m.geometry).map((m) => [...m.geometry]);
    const rings = [];
    while (parts.length) {
      let ring = parts.shift();
      let grew = true;
      while (!same(ring[0], ring.at(-1)) && grew) {
        grew = false;
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i];
          if (same(ring.at(-1), p[0])) ring = ring.concat(p.slice(1));
          else if (same(ring.at(-1), p.at(-1))) ring = ring.concat(p.slice(0, -1).reverse());
          else if (same(ring[0], p.at(-1))) ring = p.slice(0, -1).concat(ring);
          else if (same(ring[0], p[0])) ring = p.slice(1).reverse().concat(ring);
          else continue;
          parts.splice(i, 1);
          grew = true;
          break;
        }
      }
      rings.push(ring);
    }
    return rings;
  };

  const out = { lifts: [], runs: [], buildings: [], parking: [], roads: [], water: [], peaks: [] };
  for (const el of elements) {
    const t = el.tags || {};
    if (el.type === 'node') {
      out.peaks.push({ name: t.name || null, ele: Number(t.ele) || null, at: lonLatToWorld(el.lon, el.lat).map(r1) });
      continue;
    }
    if (t.aerialway && el.type === 'way') {
      if (t.aerialway === 'station' || t.aerialway === 'pylon') continue;
      out.lifts.push({ name: t.name || null, kind: t.aerialway, pts: pts(el.geometry) });
    } else if (t['piste:type']) {
      const geoms = el.type === 'relation' ? outerRings(el) : [el.geometry];
      for (const g of geoms) {
        out.runs.push({
          name: t.name || null,
          type: t['piste:type'],
          difficulty: t['piste:difficulty'] || null,
          grooming: t['piste:grooming'] || null,
          area: t.area === 'yes' || (el.type === 'relation') || (closed(g) && t.area !== 'no' && t['piste:type'] === 'downhill' && !t.name?.includes('Road')),
          pts: pts(g),
        });
      }
    } else if (t.building && el.type === 'way') {
      out.buildings.push({ name: t.name || null, pts: pts(el.geometry) });
    } else if (t.amenity === 'parking' && el.type === 'way') {
      out.parking.push({ name: t.name || null, pts: pts(el.geometry) });
    } else if (t.highway && el.type === 'way') {
      out.roads.push({ name: t.name || t.ref || null, highway: t.highway, pts: pts(el.geometry) });
    } else if (t.natural === 'water') {
      const geoms = el.type === 'relation' ? outerRings(el) : [el.geometry];
      for (const g of geoms) out.water.push({ name: t.name || null, pts: pts(g) });
    }
  }
  await writeFile(new URL('osm.json', OUT), JSON.stringify(out));
  const counts = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length]));
  console.log('osm:', counts);
}

// ---------------------------------------------------------------- tree cover
// USGS orthoimagery (public domain), exported in lon/lat so pixels map
// linearly onto world meters. Fetched as TILES x TILES images.
const IMAGERY = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/export';
const TILES = 2;
const TILE_PX = 2048;

export async function imagery() {
  const { minX, minZ, size } = GEO.trees;
  const part = size / TILES;
  const tiles = [];
  for (let tj = 0; tj < TILES; tj++) {
    for (let ti = 0; ti < TILES; ti++) {
      // World x grows west, so the tile's west edge is its larger x.
      const x0 = minX + ti * part;
      const z0 = minZ + tj * part;
      const [lonE, latS] = worldToLonLat(x0, z0);
      const [lonW, latN] = worldToLonLat(x0 + part, z0 + part);
      const bbox = [lonW, latS, lonE, latN].map((v) => v.toFixed(7)).join(',');
      // The server keeps pixels square in degrees (it widens the bbox
      // otherwise), so size the image to the bbox's aspect.
      const wPx = Math.round((TILE_PX * (lonE - lonW)) / (latN - latS));
      const url = `${IMAGERY}?bbox=${bbox}&bboxSR=4326&imageSR=4326&size=${wPx},${TILE_PX}&format=png24&transparent=false&f=image`;
      const buf = await cached(`ortho-${TILES}-${ti}-${tj}-${wPx}.png`, async () => {
        const res = await fetch(url, { headers: { 'User-Agent': UA } });
        if (!res.ok) throw new Error(`imagery ${res.status}`);
        return res.arrayBuffer();
      });
      tiles.push({ ti, tj, ...decodePng(buf) });
    }
  }
  // RGB at world (x, z), nearest pixel.
  return (x, z, out) => {
    const fx = (x - minX) / part;
    const fz = (z - minZ) / part;
    const ti = Math.min(TILES - 1, Math.max(0, Math.floor(fx)));
    const tj = Math.min(TILES - 1, Math.max(0, Math.floor(fz)));
    const t = tiles[tj * TILES + ti];
    // Image u runs east->west... no: left edge is west, and west is +x.
    const u = Math.min(t.width - 1, Math.max(0, Math.floor((1 - (fx - ti)) * t.width)));
    const v = Math.min(t.height - 1, Math.max(0, Math.floor((1 - (fz - tj)) * t.height)));
    const bpp = t.data.length / (t.width * t.height);
    const k = (v * t.width + u) * bpp;
    out[0] = t.data[k];
    out[1] = t.data[k + 1];
    out[2] = t.data[k + 2];
    return out;
  };
}

async function bakeTrees() {
  const rgbAt = await imagery();
  const { minX, minZ, size, n } = GEO.trees;
  const cell = size / n;
  const cover = new Uint8Array(n * n);
  const rgb = [0, 0, 0];
  const S = 3; // samples per cell side
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let b = 0; b < S; b++) {
        for (let a = 0; a < S; a++) {
          rgbAt(minX + (i + (a + 0.5) / S) * cell, minZ + (j + (b + 0.5) / S) * cell, rgb);
          sum += treeScore(rgb[0], rgb[1], rgb[2]);
        }
      }
      cover[j * n + i] = Math.round((255 * sum) / (S * S));
    }
  }
  await writeFile(new URL('trees.bin', OUT), cover);
  let total = 0;
  for (const v of cover) total += v;
  console.log(`trees: ${n}x${n}, ${((100 * total) / (255 * n * n)).toFixed(1)}% canopy`);
  return cover;
}

// Conifer canopy in summer imagery is dark and green; pumice, cinders,
// meadows and run surfaces are bright or red-brown. Shadow beside a tree
// counts as tree, which matches how canopy reads from the air.
export function treeScore(r, g, b) {
  const lum = 0.3 * r + 0.59 * g + 0.11 * b;
  const dark = 1 - Math.min(1, Math.max(0, (lum - 70) / 45));
  const green = g - r; // cinders and lava are red-brown (r > g)
  const hue = Math.min(1, Math.max(0, (green + 6) / 14));
  return dark * hue;
}

// npm run geo [osm|terrain|trees]: bake everything, or just one part.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const only = process.argv[2];
  if (!only || only === 'osm') await bakeOsm();
  if (!only || only === 'terrain') await bakeTerrain();
  if (!only || only === 'trees') await bakeTrees();
  if (!only || only === 'region') await bakeRegion();
}
