// Relates the world to the painted trail map (reference/trail-map.webp).
//
// The painting looks south at the mountain from the north, exaggerated and
// bent like every hand-painted ski map, so no exact camera reproduces it.
// Instead, a few tie points (lift terminals: their pixel on the painting and
// their real 3D position) are fitted with a least-squares map
//   u, v = linear in (x, y, z) + a quadratic in x and z
// which follows the painter's distortions well enough for the overlay dot.

function solve(A, b) {
  // Normal equations with Gaussian elimination (tiny systems only).
  const n = A[0].length;
  const M = Array.from({ length: n }, (_, i) => {
    const row = new Array(n + 1).fill(0);
    for (let r = 0; r < A.length; r++) {
      for (let j = 0; j < n; j++) row[j] += A[r][i] * A[r][j];
      row[n] += A[r][i] * b[r];
    }
    row[i] += 1e-6; // keep it well-posed
    return row;
  });
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

const S = 1 / 1000; // work in km so the quadratic terms stay well scaled
const terms = (x, y, z) => {
  const X = x * S;
  const Y = y * S;
  const Z = z * S;
  return [1, X, Y, Z, X * X, Z * Z, X * Z];
};

// ties: [{ px: [u, v], w: { x, y, z } }] -> (x, y, z) => [u, v]
export function fitTrailMap(ties) {
  const A = ties.map((t) => terms(t.w.x, t.w.y, t.w.z));
  const cu = solve(A, ties.map((t) => t.px[0]));
  const cv = solve(A, ties.map((t) => t.px[1]));
  const fn = (x, y, z) => {
    const f = terms(x, y, z);
    let u = 0;
    let v = 0;
    for (let i = 0; i < f.length; i++) {
      u += cu[i] * f[i];
      v += cv[i] * f[i];
    }
    return [u, v];
  };
  fn.residuals = ties.map((t) => {
    const [u, v] = fn(t.w.x, t.w.y, t.w.z);
    return Math.hypot(u - t.px[0], v - t.px[1]);
  });
  return fn;
}
