// Walking along a run's centerline: runs from world.js carry pts (top to
// bottom), cum (distance to each point) and length.

// Position and unit direction (downhill along the run) at distance s.
export function along(run, s, out = {}) {
  const { pts, cum } = run;
  s = Math.max(0, Math.min(run.length, s));
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const a = pts[lo];
  const b = pts[hi];
  const seg = cum[hi] - cum[lo] || 1;
  const t = (s - cum[lo]) / seg;
  out.x = a.x + (b.x - a.x) * t;
  out.z = a.z + (b.z - a.z) * t;
  // Direction from a slightly wider window so it doesn't jitter.
  const p0 = pts[Math.max(0, lo - 1)];
  const p1 = pts[Math.min(pts.length - 1, hi + 1)];
  const dx = p1.x - p0.x;
  const dz = p1.z - p0.z;
  const len = Math.hypot(dx, dz) || 1;
  out.dx = dx / len;
  out.dz = dz / len;
  return out;
}

// A point offset sideways from the run's centerline (+ = right, looking downhill).
export function beside(run, s, offset, out = {}) {
  along(run, s, out);
  // Right of downhill direction (dx, dz) with +y up is (-dz, dx).
  out.x += -out.dz * offset;
  out.z += out.dx * offset;
  return out;
}
