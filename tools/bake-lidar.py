"""Bake the map's elevation grid from airborne lidar.

Source: 2009-2011 Oregon Lidar Consortium bare-earth DEM, Deschutes study
area (DOGAMI / Watershed Sciences), hosted by NOAA's Digital Coast as
cloud-optimized GeoTIFFs: 3 ft pixels, NAVD88 heights in feet, Oregon GIC
Lambert. Only the overview that matches our grid spacing is read, straight
over HTTP, so nothing big is downloaded.

  python3 -m venv .venv && .venv/bin/pip install rasterio numpy
  .venv/bin/python tools/bake-lidar.py

Writes src/data/geo/terrain.bin (uint16, h = offset + q * step) on the grid
in GEO.terrain. Where the lidar has no data the previous terrain.bin
(Terrarium tiles) fills in, shifted to meet the lidar without a seam.

  .venv/bin/python tools/bake-lidar.py detail

Writes src/data/geo/detail.png instead: the fine lidar (12 ft pixels) over
the ski area (GEO.detail) minus the 7.5 m grid, as an 8-bit grey image
(128 = no difference, DETAIL_SCALE m per step). The terrain shader lights
it, so cat tracks and rolls show without more triangles.
"""

import json
import math
import re
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import transform

ROOT = Path(__file__).resolve().parent.parent
BASE = '/vsicurl/https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/dem/OLC_Deschutes_DEM_2009-2011_7382/'
# 7.5' quads over the map: be_43121h6 (the mountain), be_44121a6 (the north
# edge), and the neighbours east and west for the map's margins.
TILES = [
    'DESCHUTES_DELIVERY7/be_43121h6.tif',
    'DESCHUTES_DELIVERY16/be_44121a6.tif',
    'DESCHUTES_DELIVERY11/be_43121h5.tif',
    'DESCHUTES_DELIVERY16/be_44121a5.tif',
    'DESCHUTES_DELIVERY7/be_43121h7.tif',
    'DESCHUTES_DELIVERY16/be_44121a7.tif',
]
FT = 1200 / 3937  # US survey foot, m
DETAIL_SCALE = 0.025  # m per grey level


def geo_config():
    src = (ROOT / 'src/data/mountain.js').read_text()
    origin = [float(v) for v in re.search(r'origin:\s*\[([-\d.]+),\s*([-\d.]+)\]', src).groups()]
    block = re.search(r'terrain:\s*\{(.*?)\}', src, re.S).group(1)
    t = {k: float(v) for k, v in re.findall(r'(\w+):\s*([-\d.]+)', block)}
    return origin, t


def sample_lidar(lon, lat, level):
    H = np.full(lon.shape, np.nan)
    for name in TILES:
        with rasterio.open(BASE + name, OVERVIEW_LEVEL=level) as d:
            a = d.read(1).astype(np.float64)
            a[(a < -1e30) | (a == d.nodata)] = np.nan
            tf = d.transform
            px, py = transform('EPSG:4326', d.crs, lon.ravel(), lat.ravel())
            px = np.asarray(px).reshape(lon.shape)
            py = np.asarray(py).reshape(lon.shape)
            fc = (px - tf.c) / tf.a - 0.5
            fr = (py - tf.f) / tf.e - 0.5
            c0 = np.floor(fc).astype(int)
            r0 = np.floor(fr).astype(int)
            ok = (c0 >= 0) & (r0 >= 0) & (c0 < a.shape[1] - 1) & (r0 < a.shape[0] - 1) & np.isnan(H)
            cc, rr = c0[ok], r0[ok]
            tx, ty = (fc[ok] - cc), (fr[ok] - rr)
            H[ok] = (a[rr, cc] * (1 - tx) * (1 - ty) + a[rr, cc + 1] * tx * (1 - ty)
                     + a[rr + 1, cc] * (1 - tx) * ty + a[rr + 1, cc + 1] * tx * ty) * FT
            print(f'{name}: overview {a.shape}')
    return H


def detail():
    from PIL import Image
    (lon0, lat0), t = geo_config()
    src = (ROOT / 'src/data/mountain.js').read_text()
    block = re.search(r'detail:\s*\{(.*?)\}', src, re.S).group(1)
    dcfg = {k: float(v) for k, v in re.findall(r'(\w+):\s*([-\d.]+)', block)}
    phi = math.radians(lat0)
    m_lat = 111132.92 - 559.82 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi)
    m_lon = 111412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi)
    n = int(dcfg['n'])
    px = dcfg['size'] / n  # texel centres
    xs = dcfg['minX'] + (np.arange(n) + 0.5) * px
    zs = dcfg['minZ'] + (np.arange(n) + 0.5) * px
    X, Z = np.meshgrid(xs, zs)
    fine = sample_lidar(lon0 - X / m_lon, lat0 + Z / m_lat, 1)  # 12 ft pixels
    # The grid the mesh is built from, bilinear at the same points.
    gn = int(t['n'])
    g = np.frombuffer((ROOT / 'src/data/geo/terrain.bin').read_bytes(), dtype=np.uint16).reshape(gn, gn) * t['step'] + t['offset']
    cell = t['size'] / (gn - 1)
    fi = (X - t['minX']) / cell
    fj = (Z - t['minZ']) / cell
    i0 = np.clip(np.floor(fi).astype(int), 0, gn - 2)
    j0 = np.clip(np.floor(fj).astype(int), 0, gn - 2)
    tx, tz = fi - i0, fj - j0
    coarse = (g[j0, i0] * (1 - tx) * (1 - tz) + g[j0, i0 + 1] * tx * (1 - tz)
              + g[j0 + 1, i0] * (1 - tx) * tz + g[j0 + 1, i0 + 1] * tx * tz)
    r = np.nan_to_num(fine - coarse)
    print(f'detail: {n}x{n}, {px:.2f} m texels, residual p1 {np.percentile(r, 1):.2f} p99 {np.percentile(r, 99):.2f} m')
    q = np.clip(np.round(128 + r / DETAIL_SCALE), 0, 255).astype(np.uint8)
    Image.fromarray(q).save(ROOT / 'src/data/geo/detail.png', optimize=True)
    print('wrote', (ROOT / 'src/data/geo/detail.png').stat().st_size, 'bytes')


def main():
    if len(sys.argv) > 1 and sys.argv[1] == 'detail':
        return detail()
    (lon0, lat0), t = geo_config()
    n_new = int(sys.argv[1]) if len(sys.argv) > 1 else int(t['n'])
    phi = math.radians(lat0)
    m_lat = 111132.92 - 559.82 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi)
    m_lon = 111412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi)

    # Grid points in world meters (+x west, +z north) -> lon / lat.
    size, min_x, min_z = t['size'], t['minX'], t['minZ']
    cell = size / (n_new - 1)
    xs = min_x + np.arange(n_new) * cell
    zs = min_z + np.arange(n_new) * cell
    X, Z = np.meshgrid(xs, zs)
    lon = lon0 - X / m_lon
    lat = lat0 + Z / m_lat

    H = np.full((n_new, n_new), np.nan)
    for name in TILES:
        with rasterio.open(BASE + name, OVERVIEW_LEVEL=2) as d:  # 3 ft x 8 = 24 ft pixels
            a = d.read(1).astype(np.float64)
            a[(a < -1e30) | (a == d.nodata)] = np.nan
            tf = d.transform
            px, py = transform('EPSG:4326', d.crs, lon.ravel(), lat.ravel())
            px = np.asarray(px).reshape(lon.shape)
            py = np.asarray(py).reshape(lon.shape)
            # Pixel coordinates (centres at +0.5), bilinear sample.
            fc = (px - tf.c) / tf.a - 0.5
            fr = (py - tf.f) / tf.e - 0.5
            c0 = np.floor(fc).astype(int)
            r0 = np.floor(fr).astype(int)
            ok = (c0 >= 0) & (r0 >= 0) & (c0 < a.shape[1] - 1) & (r0 < a.shape[0] - 1) & np.isnan(H)
            cc, rr = c0[ok], r0[ok]
            tx, ty = (fc[ok] - cc), (fr[ok] - rr)
            v = (a[rr, cc] * (1 - tx) * (1 - ty) + a[rr, cc + 1] * tx * (1 - ty)
                 + a[rr + 1, cc] * (1 - tx) * ty + a[rr + 1, cc + 1] * tx * ty)
            H[ok] = v * FT
            print(f'{name}: overview {a.shape}, filled {np.isfinite(v).sum()} points')

    # The previous grid (Terrarium), resampled onto the new one, fills gaps.
    old_n = int(t['n'])
    old_path = ROOT / 'src/data/geo/terrain.bin'
    old = np.frombuffer(old_path.read_bytes(), dtype=np.uint16).reshape(old_n, old_n) * t['step'] + t['offset']
    g = np.arange(n_new) * (old_n - 1) / (n_new - 1)
    i0 = np.minimum(np.floor(g).astype(int), old_n - 2)
    f = g - i0
    rows = old[i0] * (1 - f)[:, None] + old[i0 + 1] * f[:, None]
    old_up = rows[:, i0] * (1 - f) + rows[:, i0 + 1] * f

    valid = np.isfinite(H)
    diff = np.where(valid, H - old_up, np.nan)
    print(f'lidar covers {valid.mean() * 100:.1f}% of the grid; lidar - old: '
          f'median {np.nanmedian(diff):.2f} m, p5 {np.nanpercentile(diff, 5):.1f}, p95 {np.nanpercentile(diff, 95):.1f}')
    # Spread the lidar-vs-old offset into the gaps so they meet without a step.
    d = np.where(valid, diff, 0.0)
    w = valid.astype(np.float64)
    for _ in range(200):
        if w.all():
            break
        dp = np.pad(d * w, 1, mode='edge')
        wp = np.pad(w, 1, mode='edge')
        s = dp[:-2, 1:-1] + dp[2:, 1:-1] + dp[1:-1, :-2] + dp[1:-1, 2:]
        c = wp[:-2, 1:-1] + wp[2:, 1:-1] + wp[1:-1, :-2] + wp[1:-1, 2:]
        grow = (w == 0) & (c > 0)
        d[grow] = s[grow] / c[grow]
        w[grow] = 1
    out = np.where(valid, H, old_up + d)

    q = np.clip(np.round((out - t['offset']) / t['step']), 0, 65535).astype('<u2')
    old_path.write_bytes(q.tobytes())
    print(f'terrain: {n_new}x{n_new}, cell {cell:.2f} m, {out.min():.0f}..{out.max():.0f} m, '
          f'summit {out[np.unravel_index(np.argmin(X**2 + Z**2), X.shape)]:.1f} m')


if __name__ == '__main__':
    main()
