// Real-world coordinates <-> world meters, and loading the baked geo data.
//
// World axes: +x = west, +z = north, +y = elevation (m above sea level).
// The origin is the summit of Mt. Bachelor. Over a ~10 km map a local
// equirectangular projection is accurate to well under a meter.

import { GEO } from '../data/mountain.js';

const [LON0, LAT0] = GEO.origin;
const phi = (LAT0 * Math.PI) / 180;
const M_PER_DEG_LAT = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
const M_PER_DEG_LON = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);

export function lonLatToWorld(lon, lat) {
  return [-(lon - LON0) * M_PER_DEG_LON, (lat - LAT0) * M_PER_DEG_LAT];
}

export function worldToLonLat(x, z) {
  return [LON0 - x / M_PER_DEG_LON, LAT0 + z / M_PER_DEG_LAT];
}

async function readBytes(rel) {
  const url = new URL(rel, import.meta.url);
  if (typeof window === 'undefined') {
    const { readFile } = await import('node:fs/promises');
    return readFile(url);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// Elevation grid (meters) plus the OpenStreetMap features, in world meters.
export async function loadGeo() {
  const [bin, osm] = await Promise.all([
    readBytes('../data/geo/terrain.bin'),
    readBytes('../data/geo/osm.json'),
  ]);
  const { n, offset, step } = GEO.terrain;
  const q = new Uint16Array(bin.buffer, bin.byteOffset, n * n);
  const heights = new Float32Array(n * n);
  for (let k = 0; k < q.length; k++) heights[k] = offset + q[k] * step;
  const text = new TextDecoder().decode(osm);
  // Tree cover is optional: without it the forest falls back to the clearing mask.
  const trees = await readBytes('../data/geo/trees.bin').catch(() => null);
  // The land around the map (optional).
  const region = {};
  for (const name of Object.keys(GEO.region || {})) {
    const buf = await readBytes(`../data/geo/region-${name}.bin`).catch(() => null);
    if (!buf) continue;
    const r = GEO.region[name];
    const rq = new Uint16Array(buf.buffer, buf.byteOffset, r.n * r.n);
    const h = new Float32Array(r.n * r.n);
    for (let k = 0; k < rq.length; k++) h[k] = offset + rq[k] * step;
    region[name] = { ...r, cell: r.size / (r.n - 1), h };
  }
  return { heights, region, osm: JSON.parse(text), trees: trees && new Uint8Array(trees.buffer, trees.byteOffset, trees.length) };
}
