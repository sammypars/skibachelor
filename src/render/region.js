// The real land around the map out to the horizon: Broken Top, the Three
// Sisters, Mt. Jefferson, Diamond Peak, the Cascade Lakes basin and the
// high desert, from the regional elevation grids. Winter colours come from
// elevation, slope and aspect: dark conifer forest low down, patchy snowy
// forest up to treeline, then snowfields with rock on the steep faces.

import * as THREE from 'three';
import { DISTANT_PEAKS, FT } from '../data/mountain.js';
import { fbm, smoothstep } from '../world/noise.js';
import { HORIZON } from './sky.js';

const SNOW = new THREE.Color('#f5f8fc');
const SNOW_SHADE = new THREE.Color('#dfe7f1');
const ROCK = new THREE.Color('#5f5753');
const ROCK_DARK = new THREE.Color('#3d3835');
const FOREST = new THREE.Color('#2c3a36');
const FOREST_SNOWY = new THREE.Color('#8b9894');
const DESERT = new THREE.Color('#c9cdc9'); // snow over sage and pumice flats

function colorAt(out, y, slope, northness, x, z) {
  const n1 = fbm(x / 1800, z / 1800, 3);
  const n2 = fbm(x / 260, z / 260, 2);
  // Treeline wanders with exposure: lower on cold north faces' cornices is
  // not a thing, but forests climb higher in sheltered spots.
  const tl = 2250 + 120 * n1 - 60 * northness;
  const forest = 1 - smoothstep(tl - 380, tl, y + 90 * n2);
  // Steep ground sheds snow: rock from ~33 degrees, dark cliff from ~48.
  const rock = smoothstep(0.4 - 0.08 * n2, 0.62, slope) * smoothstep(1500, 1900, y);
  const cliff = smoothstep(0.7, 0.95, slope);

  // Snowfields, faintly blue on the shady (north) side.
  out.copy(SNOW).lerp(SNOW_SHADE, Math.max(0, northness) * 0.5 + 0.15 * (0.5 + 0.5 * n2));
  if (rock > 0) out.lerp(ROCK, rock * (0.75 + 0.25 * n2)).lerp(ROCK_DARK, cliff * 0.8);
  if (forest > 0) {
    // Dense forest reads dark; near treeline it is snow-plastered and patchy.
    const patchy = smoothstep(tl - 500, tl, y);
    const f = new THREE.Color().copy(FOREST).lerp(FOREST_SNOWY, patchy * 0.7 + 0.15 * (0.5 + 0.5 * n2));
    // Openings and meadows.
    const open = smoothstep(0.25, 0.6, n2 * 0.6 + n1 * 0.5) * 0.6;
    out.lerp(f, forest * (1 - open) * (1 - rock * 0.7));
  }
  // The dry flats east toward Bend: thin forest, open snowy ground.
  const desert = smoothstep(1500, 1250, y);
  out.lerp(DESERT, desert * 0.5 * (0.6 + 0.4 * n1));
  return out;
}

// One regional grid as a mesh, leaving out the cells covered by `hole`
// (a square region already drawn in more detail). Cells overlapping the
// hole's border are kept but sunk a little under it.
function regionMesh(r, hole, sink, edgeTo) {
  const { n, cell, h, minX, minZ, size } = r;
  const pos = new Float32Array(n * n * 3);
  const col = new Float32Array(n * n * 3);
  const c = new THREE.Color();
  const H = (i, j) => h[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))];
  const inHole = (x, z, pad) =>
    hole && x > hole.minX + pad && x < hole.minX + hole.size - pad && z > hole.minZ + pad && z < hole.minZ + hole.size - pad;

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = minX + i * cell;
      const z = minZ + j * cell;
      let y = h[k];
      // Slope and aspect from the grid.
      const gx = (H(i + 1, j) - H(i - 1, j)) / (2 * cell);
      const gz = (H(i, j + 1) - H(i, j - 1)) / (2 * cell);
      const slope = Math.hypot(gx, gz);
      // Ground falling toward +z faces north.
      const northness = slope > 0.02 ? -gz / slope : 0;
      colorAt(c, y, slope, northness, x, z);
      if (inHole(x, z, -cell)) y -= sink;
      // Fold the outer rim down so the land meets the low plain beyond.
      if (edgeTo !== undefined) {
        const e = Math.min(i, j, n - 1 - i, n - 1 - j);
        if (e < 4) y = edgeTo + (y - edgeTo) * (e / 4);
      }
      pos.set([x, y, z], k * 3);
      col.set([c.r, c.g, c.b], k * 3);
    }
  }
  const idx = [];
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const x0 = minX + i * cell;
      const z0 = minZ + j * cell;
      // Skip cells entirely inside the hole.
      if (inHole(x0, z0, 0) && inHole(x0 + cell, z0 + cell, 0)) continue;
      const a = j * n + i;
      idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(n * n > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(minX + size / 2, 2000, minZ + size / 2), size);
  return geo;
}

// Atmospheric perspective: the scene's exponential fog up close (so the
// land matches the map), easing into a gentler haze far away so the
// horizon volcanoes stay visible, pale and blue, like they do on a clear day.
function hazeMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    // World position for fine surface detail (wind-packed snow, scree).
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWorldP;
        float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec2 q = vWorldP.xz;
          // Streaks run downslope-ish: stretch the noise along one axis.
          float d = vnoise(q / vec2(90.0, 30.0)) * 0.6 + vnoise(q / 18.0) * 0.4;
          float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
          // Bright snow gets faint wind texture; dark ground gets speckle.
          diffuseColor.rgb *= mix(0.9 + 0.12 * d, 0.75 + 0.5 * d, 1.0 - smoothstep(0.35, 0.7, lum));
        }`,
      )
      .replace(
      '#include <fog_fragment>',
      `#ifdef USE_FOG
        float fNear = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
        float fFar = 0.86 * ( 1.0 - exp( - vFogDepth / 46000.0 ) );
        gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, min( fNear, fFar ) );
      #endif`,
    );
  };
  mat.customProgramCacheKey = () => 'region-haze';
  return mat;
}

export function buildRegion(world) {
  const group = new THREE.Group();
  group.name = 'region';
  const { region, hf } = world;
  const labels = [];
  if (!region?.mid) return { group, labels };
  const mat = hazeMaterial();
  const PLAIN = 1150;
  const add = (geo) => {
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    group.add(m);
  };
  add(regionMesh(region.mid, { minX: hf.minX, minZ: hf.minZ, size: hf.size }, 6));
  if (region.far) add(regionMesh(region.far, region.mid, 40, PLAIN));

  // A low plain beyond everything, so the horizon never shows a gap.
  const R = 160000;
  const far = region.far || region.mid;
  const shape = new THREE.Shape([
    new THREE.Vector2(-R, -R), new THREE.Vector2(R, -R), new THREE.Vector2(R, R), new THREE.Vector2(-R, R),
  ]);
  const inset = far.cell * 2;
  // Shape coords are (x, -z) after the rotation below.
  shape.holes.push(new THREE.Path([
    new THREE.Vector2(far.minX + inset, -(far.minZ + inset)),
    new THREE.Vector2(far.minX + inset, -(far.minZ + far.size - inset)),
    new THREE.Vector2(far.minX + far.size - inset, -(far.minZ + far.size - inset)),
    new THREE.Vector2(far.minX + far.size - inset, -(far.minZ + inset)),
  ]));
  const plainGeo = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, PLAIN - 2, 0);
  const pc = new THREE.Color();
  colorAt(pc, PLAIN, 0, 0, 0, 0);
  const plain = new THREE.Mesh(plainGeo, hazeMaterial());
  plain.material.vertexColors = false;
  plain.material.color.copy(pc);
  group.add(plain);

  // Label each named peak on its real high point.
  for (const p of DISTANT_PEAKS) {
    let best = { x: p.x, z: p.z, y: -Infinity };
    for (let dz = -1500; dz <= 1500; dz += 100) {
      for (let dx = -1500; dx <= 1500; dx += 100) {
        const y = world.groundAt(p.x + dx, p.z + dz);
        if (y > best.y) best = { x: p.x + dx, z: p.z + dz, y };
      }
    }
    if (best.y < p.elevFt * FT - 400) best = { x: p.x, z: p.z, y: p.elevFt * FT };
    labels.push({ name: p.name, pos: new THREE.Vector3(best.x, best.y + 250, best.z) });
  }
  return { group, labels };
}

