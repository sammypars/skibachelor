// Snow effects for the player: spray kicked up by the skis (carving hard,
// skidding, landing) and the two grooves the skis leave in the snow.

import * as THREE from 'three';

const MAX_PARTICLES = 700;

function softDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createSnowSpray(scene) {
  const pos = new Float32Array(MAX_PARTICLES * 3);
  const alpha = new Float32Array(MAX_PARTICLES);
  const size = new Float32Array(MAX_PARTICLES);
  const vel = new Float32Array(MAX_PARTICLES * 3);
  const life = new Float32Array(MAX_PARTICLES);
  const maxLife = new Float32Array(MAX_PARTICLES);
  let next = 0;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: softDot() }, scale: { value: 600 } },
    vertexShader: `
      attribute float alpha;
      attribute float size;
      varying float vAlpha;
      uniform float scale;
      void main() {
        vAlpha = alpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * scale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D map;
      varying float vAlpha;
      void main() {
        vec4 c = texture2D(map, gl_PointCoord);
        gl_FragColor = vec4(vec3(0.97, 0.98, 1.0), c.a * vAlpha);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  // Emit n particles at p, thrown along dir (m/s) with some scatter.
  function emit(p, dir, n, spread = 1.5, up = 1.5) {
    for (let k = 0; k < n; k++) {
      const i = next;
      next = (next + 1) % MAX_PARTICLES;
      pos[i * 3] = p.x + (Math.random() - 0.5) * 0.4;
      pos[i * 3 + 1] = p.y + 0.05;
      pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.4;
      vel[i * 3] = dir.x + (Math.random() - 0.5) * spread;
      vel[i * 3 + 1] = dir.y + up * (0.4 + Math.random());
      vel[i * 3 + 2] = dir.z + (Math.random() - 0.5) * spread;
      maxLife[i] = life[i] = 0.5 + Math.random() * 0.7;
      size[i] = 0.25 + Math.random() * 0.35;
    }
  }
  function update(dt) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (life[i] <= 0) {
        alpha[i] = 0;
        continue;
      }
      life[i] -= dt;
      const drag = Math.exp(-dt * 2.2);
      vel[i * 3] *= drag;
      vel[i * 3 + 1] = vel[i * 3 + 1] * drag - 6 * dt;
      vel[i * 3 + 2] *= drag;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      const t = life[i] / maxLife[i];
      alpha[i] = Math.max(0, t) * 0.85;
      size[i] *= 1 + dt * 0.9; // puffs spread as they settle
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.alpha.needsUpdate = true;
    geo.attributes.size.needsUpdate = true;
  }
  return { emit, update, points };
}

// Two grooves behind the skis: a ribbon per ski, laid every 0.35 m while
// the skis are on the snow; a jump breaks the line.
export function createSkiTracks(scene, maxPoints = 900) {
  const W = 0.075;
  const pos = new Float32Array(maxPoints * 2 * 2 * 3); // 2 skis, 2 verts each
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const idx = [];
  for (let ski = 0; ski < 2; ski++) {
    for (let i = 0; i < maxPoints - 1; i++) {
      const a = (ski * maxPoints + i) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x9fb2c7,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  scene.add(mesh);
  const pts = []; // {l: Vector3, r: Vector3, side: Vector3, gap}
  let last = null;

  // centre: feet on the snow; fwd: ski direction; right: across; broken: new line.
  function add(centre, fwd, right, y, broken) {
    if (!broken && last && last.distanceTo(centre) < 0.35) return;
    last = centre.clone();
    pts.push({ c: centre.clone().setY(y + 0.025), r: right.clone(), gap: broken });
    if (pts.length > maxPoints) pts.shift();
    rebuild();
  }
  function rebuild() {
    const n = pts.length;
    for (let ski = 0; ski < 2; ski++) {
      const off = ski ? 0.13 : -0.13;
      for (let i = 0; i < maxPoints; i++) {
        const p = pts[Math.min(i, n - 1)] || null;
        const base = (ski * maxPoints + i) * 2 * 3;
        if (!p || i >= n) {
          // Collapse unused points onto the last one.
          const q = pts[n - 1];
          for (let k = 0; k < 6; k++) pos[base + k] = q ? q.c.getComponent(k % 3) : 0;
          continue;
        }
        // A gap collapses this point's width so the line breaks.
        const w = p.gap ? 0 : W;
        pos[base] = p.c.x + p.r.x * (off - w);
        pos[base + 1] = p.c.y;
        pos[base + 2] = p.c.z + p.r.z * (off - w);
        pos[base + 3] = p.c.x + p.r.x * (off + w);
        pos[base + 4] = p.c.y;
        pos[base + 5] = p.c.z + p.r.z * (off + w);
      }
    }
    geo.attributes.position.needsUpdate = true;
  }
  function clear() {
    pts.length = 0;
    last = null;
    rebuild();
  }
  return { add, clear, mesh };
}
