import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(-0.74, 0.46, 0.4).normalize();
export const HORIZON = new THREE.Color('#d6e6f2');

export function buildSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color('#2d6cb8') },
      mid: { value: new THREE.Color('#7fb0dd') },
      horizon: { value: HORIZON.clone() },
      sunDir: { value: SUN_DIR.clone() },
      sunColor: { value: new THREE.Color('#fff4e0') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 mid; uniform vec3 horizon;
      uniform vec3 sunDir; uniform vec3 sunColor;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.18, h));
        col = mix(col, top, smoothstep(0.12, 0.85, h));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        col += sunColor * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.18);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  return sky;
}

export function buildLights(world) {
  const group = new THREE.Group();
  const hemi = new THREE.HemisphereLight(0xa9c8ec, 0x4a5a52, 0.75);
  group.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff0dc, 3.3);
  const target = new THREE.Vector3(0, 2000, 1600);
  sun.position.copy(target).addScaledVector(SUN_DIR, 14000);
  sun.target.position.copy(target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const cam = sun.shadow.camera;
  cam.left = -5600;
  cam.right = 5600;
  cam.top = 5600;
  cam.bottom = -5600;
  cam.near = 2000;
  cam.far = 22000;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 3;
  group.add(sun, sun.target);
  return { group, sun };
}

// Prefiltered sky reflection for water, ice and glass.
export function makeEnvMap(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const sky = buildSky();
  sky.scale.setScalar(50);
  envScene.add(sky);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(40000, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x5b7466 }),
  );
  ground.position.y = -300;
  envScene.add(ground);
  const rt = pmrem.fromScene(envScene, 0.02, 1, 100000);
  pmrem.dispose();
  return rt.texture;
}

// Keep the sun's shadow map centred on what the camera is looking at, sized
// to the view, so close-up shadows are crisp and the overview still has them.
export function updateSunShadow(sun, focus, cameraDistance, minHalf = 350) {
  const half = THREE.MathUtils.clamp(cameraDistance * 0.9, minHalf, 5600);
  // Bias with the texel size: crisp contact shadows close up (the skier on
  // the snow), no acne on the whole-mountain view.
  sun.shadow.normalBias = half < 300 ? 0.06 + half * 0.0012 : 3;
  const cam = sun.shadow.camera;
  // Snap to shadow texels to avoid shimmering while moving.
  const texel = (half * 2) / sun.shadow.mapSize.x;
  const fx = Math.round(focus.x / texel) * texel;
  const fz = Math.round(focus.z / texel) * texel;
  sun.target.position.set(fx, focus.y, fz);
  sun.position.set(fx, focus.y, fz).addScaledVector(SUN_DIR, 12000);
  if (cam.right !== half) {
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.updateProjectionMatrix();
  }
  sun.target.updateMatrixWorld();
}
