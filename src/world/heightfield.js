// Grid heightfield: the single source of truth for ground height.
// Gameplay, trees, lifts and buildings all sample it through heightAt().

import { smoothstep } from './noise.js';

export class Heightfield {
  constructor({ minX, minZ, size, n }) {
    this.minX = minX;
    this.minZ = minZ;
    this.size = size;
    this.n = n;
    this.cell = size / (n - 1);
    this.h = new Float32Array(n * n);
  }

  get maxX() {
    return this.minX + this.size;
  }
  get maxZ() {
    return this.minZ + this.size;
  }

  fill(fn) {
    const { n, cell, minX, minZ, h } = this;
    for (let j = 0; j < n; j++) {
      const z = minZ + j * cell;
      for (let i = 0; i < n; i++) h[j * n + i] = fn(minX + i * cell, z);
    }
  }

  heightAt(x, z) {
    const { n, cell, h } = this;
    let fx = (x - this.minX) / cell;
    let fz = (z - this.minZ) / cell;
    fx = Math.min(n - 1.0001, Math.max(0, fx));
    fz = Math.min(n - 1.0001, Math.max(0, fz));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const a = h[j * n + i];
    const b = h[j * n + i + 1];
    const c = h[(j + 1) * n + i];
    const d = h[(j + 1) * n + i + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }

  // Downhill-pointing gradient direction (unnormalized) and slope (rise/run).
  gradient(x, z, e = 6) {
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return { dx, dz, slope: Math.hypot(dx, dz) };
  }

  // Visit every grid cell within radius of (x, z).
  forEachNear(x, z, radius, cb) {
    const { n, cell, minX, minZ } = this;
    const i0 = Math.max(0, Math.floor((x - radius - minX) / cell));
    const i1 = Math.min(n - 1, Math.ceil((x + radius - minX) / cell));
    const j0 = Math.max(0, Math.floor((z - radius - minZ) / cell));
    const j1 = Math.min(n - 1, Math.ceil((z + radius - minZ) / cell));
    for (let j = j0; j <= j1; j++) {
      const cz = minZ + j * cell;
      for (let i = i0; i <= i1; i++) {
        const cx = minX + i * cell;
        cb(j * n + i, cx, cz);
      }
    }
  }

  addGaussian(x, z, amp, sigma) {
    const r = sigma * 3;
    const inv = 1 / (2 * sigma * sigma);
    this.forEachNear(x, z, r, (k, cx, cz) => {
      const d2 = (cx - x) ** 2 + (cz - z) ** 2;
      this.h[k] += amp * Math.exp(-d2 * inv);
    });
  }

  // Blend toward a flat target height inside a disc, with a soft edge.
  flattenDisc(x, z, radius, falloff, target) {
    this.forEachNear(x, z, radius + falloff, (k, cx, cz) => {
      const d = Math.hypot(cx - x, cz - z);
      const w = 1 - smoothstep(radius, radius + falloff, d);
      if (w > 0) this.h[k] += (target - this.h[k]) * w;
    });
  }

  // Same for a rotated rectangle (w along local x, d along local z).
  flattenRect(x, z, w, d, yaw, falloff, target) {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const reach = Math.hypot(w, d) / 2 + falloff;
    this.forEachNear(x, z, reach, (k, cx, cz) => {
      const lx = (cx - x) * c - (cz - z) * s;
      const lz = (cx - x) * s + (cz - z) * c;
      const ox = Math.max(0, Math.abs(lx) - w / 2);
      const oz = Math.max(0, Math.abs(lz) - d / 2);
      const dist = Math.hypot(ox, oz);
      const wt = 1 - smoothstep(0, falloff, dist);
      if (wt > 0) this.h[k] += (target - this.h[k]) * wt;
    });
  }
}

// Simple raster mask on the same footprint as a heightfield.
export class Mask {
  constructor({ minX, minZ, size }, res) {
    this.minX = minX;
    this.minZ = minZ;
    this.size = size;
    this.res = res;
    this.px = size / res;
    this.data = new Float32Array(res * res);
  }

  at(x, z) {
    const i = Math.floor((x - this.minX) / this.px);
    const j = Math.floor((z - this.minZ) / this.px);
    if (i < 0 || j < 0 || i >= this.res || j >= this.res) return 0;
    return this.data[j * this.res + i];
  }

  // Paint a thick segment with a feathered edge (max blend).
  segment(ax, az, bx, bz, halfWidth, feather = 8, value = 1) {
    const { px, res, minX, minZ, data } = this;
    const reach = halfWidth + feather;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - minX) / px));
    const i1 = Math.min(res - 1, Math.ceil((Math.max(ax, bx) + reach - minX) / px));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - minZ) / px));
    const j1 = Math.min(res - 1, Math.ceil((Math.max(az, bz) + reach - minZ) / px));
    const vx = bx - ax;
    const vz = bz - az;
    const len2 = vx * vx + vz * vz || 1;
    for (let j = j0; j <= j1; j++) {
      const cz = minZ + (j + 0.5) * px;
      for (let i = i0; i <= i1; i++) {
        const cx = minX + (i + 0.5) * px;
        let t = ((cx - ax) * vx + (cz - az) * vz) / len2;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(cx - (ax + vx * t), cz - (az + vz * t));
        const v = value * (1 - smoothstep(halfWidth, reach, d));
        const k = j * res + i;
        if (v > data[k]) data[k] = v;
      }
    }
  }

  disc(x, z, radius, feather = 10, value = 1) {
    this.segment(x, z, x + 0.01, z, radius, feather, value);
  }

  polyline(points, halfWidth, feather = 8, value = 1) {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      this.segment(a.x, a.z, b.x, b.z, halfWidth, feather, value);
    }
  }
}
