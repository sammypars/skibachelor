import * as THREE from 'three';
import { fbm, smoothstep } from '../world/noise.js';
import { EDGE_HEIGHT } from '../world/world.js';

const TEX = 2048;

// Paints the ground texture: snow, groomed runs, shaded forest floor,
// roads and parking lots.
function paintGround(world) {
  const { hf, clear, openAt, roads, parking, treeline } = world;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEX;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(TEX, TEX);
  const d = img.data;
  const px = hf.size / TEX;
  const canopy = new Uint8Array(TEX * TEX);

  for (let j = 0; j < TEX; j++) {
    const z = hf.minZ + (j + 0.5) * px;
    for (let i = 0; i < TEX; i++) {
      const x = hf.minX + (i + 0.5) * px;
      const y = hf.heightAt(x, z);
      const open = openAt(x, z);
      const real = world.canopyAt(x, z);
      // 1 = deep forest floor, 0 = open snow
      // Thins out over a few hundred meters below treeline, so the upper forest
      // reads as scattered snowy trees like the painting, not a hard edge.
      // Where the real tree cover is known it already has that edge.
      const thinP = 1 - smoothstep(treeline - 340, treeline + 30, y + 40 * fbm(x / 400, z / 400, 2));
      const thin = real ? thinP + (1 - thinP) * real.w * 0.85 : thinP;
      // Trees are only planted where open < 0.35, so match that edge.
      const forest = (1 - smoothstep(0.12, 0.38, open)) * thin * (0.55 + 0.45 * thin);
      const n = fbm(x / 90, z / 90, 2);
      const big = fbm(x / 700, z / 700, 2);

      // Open snow: bright, faintly blue in the large-scale dips.
      let r = 246 + n * 4 + big * 3;
      let g = 249 + n * 3 + big * 2;
      let b = 253 + n * 2;
      // Gullies hold cool blue shade, ridges catch light: reveals the
      // volcano's relief whatever the sun angle (like the painted map).
      const e = 22;
      const lap =
        (hf.heightAt(x + e, z) + hf.heightAt(x - e, z) + hf.heightAt(x, z + e) + hf.heightAt(x, z - e) - 4 * y) /
        (e * e);
      const shade = Math.max(-0.2, Math.min(0.45, lap * 45));
      r -= shade * 46;
      g -= shade * 32;
      b -= shade * 10;
      // Up close the forest floor is snow in tree shade.
      r -= forest * 16;
      g -= forest * 11;
      b -= forest * 5;
      // From far away the forest reads as a dark evergreen canopy speckled
      // with snow, like the painted trail map. Stored separately and blended
      // in by view distance in the shader.
      const speck = Math.max(0, fbm(x / 14, z / 14, 2));
      canopy[j * TEX + i] = 255 * forest * (0.95 - speck * 0.45) * (0.9 + big * 0.2);
      // Groomed runs: a touch warmer/brighter.
      if (clear.at(x, z) > 0.5 && y < treeline + 80) {
        r += 2;
        g += 2;
      }
      const k = (j * TEX + i) * 4;
      d[k] = Math.min(255, r);
      d[k + 1] = Math.min(255, g);
      d[k + 2] = Math.min(255, b);
      d[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const toC = (p) => [((p.x - hf.minX) / hf.size) * TEX, ((p.z - hf.minZ) / hf.size) * TEX];
  const m = TEX / hf.size; // canvas px per meter

  // Plowed snowbanks then asphalt.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const road of roads) {
    ctx.beginPath();
    road.pts.forEach((p, i) => (i ? ctx.lineTo(...toC(p)) : ctx.moveTo(...toC(p))));
    ctx.strokeStyle = '#d7dde3';
    ctx.lineWidth = (road.width + 8) * m;
    ctx.stroke();
    ctx.strokeStyle = '#5c6168';
    ctx.lineWidth = road.width * m;
    ctx.stroke();
  }
  // Nordic trails: groomed skate lane with classic tracks either side.
  for (const t of world.nordicTrails) {
    for (const line of [t.pts, t.link]) {
      ctx.beginPath();
      line.forEach((p, i) => (i ? ctx.lineTo(...toC(p)) : ctx.moveTo(...toC(p))));
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = t.width * m;
      ctx.stroke();
    }
  }
  // Parking lots: real outlines, plowed asphalt with a snowbank rim.
  for (const lot of parking) {
    ctx.beginPath();
    lot.outline.forEach((p, i) => (i ? ctx.lineTo(...toC(p)) : ctx.moveTo(...toC(p))));
    ctx.closePath();
    ctx.fillStyle = '#7b8189';
    ctx.fill();
    ctx.strokeStyle = '#d7dde3';
    ctx.lineWidth = 5 * m;
    ctx.stroke();
  }

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  map.flipY = false;

  const canopyTex = new THREE.DataTexture(canopy, TEX, TEX, THREE.RedFormat, THREE.UnsignedByteType);
  canopyTex.minFilter = THREE.LinearMipmapLinearFilter;
  canopyTex.magFilter = THREE.LinearFilter;
  canopyTex.generateMipmaps = true;
  canopyTex.anisotropy = 8;
  canopyTex.needsUpdate = true;
  return { map, canopy: canopyTex };
}

// Tiling grey noise used for close-up snow texture.
function snowDetailTexture() {
  const N = 256;
  const data = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      // Periodic so it tiles: sample noise on a torus.
      const a = (i / N) * Math.PI * 2;
      const b = (j / N) * Math.PI * 2;
      const v = fbm(Math.cos(a) * 2 + 10, Math.sin(a) * 2 + Math.cos(b) * 2, 4) * 0.7 +
        fbm(Math.sin(b) * 6, Math.cos(a) * 1.5 + Math.sin(a) * 6, 2) * 0.3;
      data[j * N + i] = Math.max(0, Math.min(255, 128 + v * 160));
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// Blend the painted canopy in with distance: from far away the forest looks
// like the trail-map painting; up close you see real trees on snow.
function addCanopyBlend(mat, canopyTex) {
  const uniforms = {
    canopyMap: { value: canopyTex },
    canopyColor: { value: new THREE.Color().setRGB(30 / 255, 76 / 255, 57 / 255, THREE.SRGBColorSpace) },
    canopyNear: { value: 700 },
    canopyFar: { value: 2600 },
    detailMap: { value: snowDetailTexture() },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vViewDist;\nvarying vec2 vWorldXZ;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvViewDist = -mvPosition.z;\nvWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vViewDist;\nvarying vec2 vWorldXZ;\nuniform sampler2D detailMap;\nuniform sampler2D canopyMap;\nuniform vec3 canopyColor;\nuniform float canopyNear;\nuniform float canopyFar;',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float canopyRaw = texture2D(canopyMap, vMapUv).r;
        // Blending happens in linear light, so push coverage up or the
        // forest washes out to pink-grey.
        float canopyAmt = (1.0 - pow(1.0 - canopyRaw, 2.5)) * smoothstep(canopyNear, canopyFar, vViewDist);
        diffuseColor.rgb = mix(diffuseColor.rgb, canopyColor, canopyAmt);
        // Close-up snow grain: wind ripples and soft lumps.
        float near = 1.0 - smoothstep(150.0, 1100.0, vViewDist);
        float grain = texture2D(detailMap, vWorldXZ / 23.0).r * 0.6 + texture2D(detailMap, vWorldXZ / 4.5).r * 0.4;
        diffuseColor.rgb *= mix(1.0, 0.9 + 0.12 * grain, near);`,
      );
  };
  mat.customProgramCacheKey = () => 'terrain-canopy';
  mat.userData.canopy = uniforms;
}

export function buildTerrain(world) {
  const { hf } = world;
  const n = hf.n;
  const geo = new THREE.PlaneGeometry(hf.size, hf.size, n - 1, n - 1);
  geo.rotateX(-Math.PI / 2);
  // After rotation, row 0 is at -z. Shift so the grid matches the heightfield.
  geo.translate(hf.minX + hf.size / 2, 0, hf.minZ + hf.size / 2);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      pos.setY(k, hf.h[k]);
      uv.setXY(k, i / (n - 1), j / (n - 1));
    }
  }
  geo.computeVertexNormals();

  const { map, canopy } = paintGround(world);
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0 });
  addCanopyBlend(mat, canopy);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

// A wide, low ring of land beyond the heightfield so the horizon is not empty.
export function buildSurroundings(world) {
  const { hf } = world;
  const group = new THREE.Group();
  const cx = hf.minX + hf.size / 2;
  const cz = hf.minZ + hf.size / 2;
  const edge = EDGE_HEIGHT;
  // Huge flat plane with a square hole where the heightfield sits.
  const R = 140000;
  const shape = new THREE.Shape([
    new THREE.Vector2(-R, -R), new THREE.Vector2(R, -R),
    new THREE.Vector2(R, R), new THREE.Vector2(-R, R),
  ]);
  const hs = hf.size / 2 - 1;
  shape.holes.push(new THREE.Path([
    new THREE.Vector2(-hs, -hs), new THREE.Vector2(-hs, hs),
    new THREE.Vector2(hs, hs), new THREE.Vector2(hs, -hs),
  ]));
  const ground = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshStandardMaterial({ color: 0x3a5c49, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, edge, cz);
  group.add(ground);
  return { group, edge };
}
