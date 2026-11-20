// Converts between trail-map pixels and 3D world coordinates.
//
// World axes (meters): +x = west (right on the trail map), +z = north (toward
// the trail-map viewer), +y = elevation above sea level. The summit is at
// x = 0, z = 0.
//
// The painting is modelled as an oblique view from the north, pitched down by
// viewPitchDeg, with a mild perspective that makes the bottom of the map
// (closer to the painter) larger than the top.

import { PROJECTION as P, TRAIL_MAP, FT } from '../data/mountain.js';

const pitch = (P.viewPitchDeg * Math.PI) / 180;
const sinP = Math.sin(pitch);
const cosP = Math.cos(pitch);
const summitM = P.summitElevFt * FT;

function persp(v) {
  return P.perspFar + ((P.perspNear - P.perspFar) * v) / TRAIL_MAP.height;
}

// Unproject a pixel when the elevation at that spot is known.
export function pxToWorld(u, v, elevM) {
  const x = (u - P.summitPx[0]) / (P.pxPerMeter * persp(v));
  const z = ((v - P.summitPx[1]) / P.pxPerMeter - (summitM - elevM) * cosP) / sinP;
  return { x, z };
}

// Unproject a pixel onto a terrain surface (elevation unknown).
export function pxToSurface(u, v, heightFn, guessM = 2000) {
  let h = guessM;
  let p = pxToWorld(u, v, h);
  for (let i = 0; i < 12; i++) {
    h = heightFn(p.x, p.z);
    p = pxToWorld(u, v, h);
  }
  return { x: p.x, y: heightFn(p.x, p.z), z: p.z };
}

// Project a world point back onto the trail map (for debugging / overlays).
export function worldToPx(x, y, z) {
  const v = P.summitPx[1] + P.pxPerMeter * (z * sinP + (summitM - y) * cosP);
  const u = P.summitPx[0] + x * P.pxPerMeter * persp(v);
  return [u, v];
}

export const SUMMIT_M = summitM;
export { FT };
