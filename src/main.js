import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildWorld } from './world/world.js';
import { loadGeo } from './world/geo.js';
import { createDrone } from './drone.js';
import { createSki } from './ski.js';
import { createRiderPanel, keyHelpHTML } from './rider-panel.js';
import { onSettings } from './settings.js';
import { TRAIL_MAP } from './data/mountain.js';
import { buildTerrain, buildSurroundings } from './render/terrain.js';
import { buildForest } from './render/trees.js';
import { buildLifts } from './render/lifts.js';
import { buildBuildings } from './render/buildings.js';
import { buildSky, buildLights, HORIZON, makeEnvMap, updateSunShadow } from './render/sky.js';
import { buildPeaks, buildClouds } from './render/peaks.js';
import { buildRegion } from './render/region.js';
import { buildLakes } from './render/lakes.js';
import { buildParks } from './render/parks.js';
import { buildRaceCourse } from './render/race.js';
import { buildPeople } from './render/people.js';
import { along } from './world/path.js';

const M2FT = 3.28084;
const $ = (s) => document.querySelector(s);
const loading = $('#loading');
let loadStep = 0;
const setStatus = (t) => {
  loading.querySelector('p').textContent = t;
  loadStep++;
  const bar = loading.querySelector('.load-bar i');
  if (bar) bar.style.width = `${Math.min(96, loadStep * 17)}%`;
};
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// ---------------------------------------------------------------- renderer
const canvas = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = HORIZON.clone();
scene.fog = new THREE.FogExp2(HORIZON.clone(), 0.000045);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 4, 170000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 25;
controls.maxDistance = 30000;
controls.zoomSpeed = 1.2;

// ---------------------------------------------------------------- build
setStatus('Shaping the volcano…');
await nextFrame();
const world = buildWorld(await loadGeo());

setStatus('Grooming runs…');
await nextFrame();
scene.add(buildTerrain(world));
const envMap = makeEnvMap(renderer);
// The real land out to the horizon when it's baked; otherwise a flat plain
// and stand-in volcano shapes.
let peaks = buildRegion(world);
if (!peaks.group.children.length) {
  scene.add(buildSurroundings(world).group);
  peaks = buildPeaks();
}
scene.add(peaks.group);
scene.add(buildLakes(world, envMap));
const clouds = buildClouds();
scene.add(clouds);

setStatus('Planting the forest…');
await nextFrame();
const forest = buildForest(world);
scene.add(forest.group);

setStatus('Stringing chairlifts…');
await nextFrame();
const lifts = buildLifts(world);
scene.add(lifts.group);
const buildings = buildBuildings(world);
const withEnv = (root) => root.traverse((o) => {
  const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
  for (const m of ms) if (m.metalness > 0.1 || (m.roughness !== undefined && m.roughness < 0.4)) m.envMap = envMap;
});
withEnv(lifts.group);
buildings.traverse((o) => {
  const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
  for (const m of ms) if (m.roughness !== undefined && m.roughness < 0.4) m.envMap = envMap;
});
scene.add(buildings);

setStatus('Building the parks…');
await nextFrame();
const parks = buildParks(world);
scene.add(parks.group);
const race = buildRaceCourse(world);
if (race) scene.add(race.group);
const people = buildPeople(world, lifts, race, parks);
scene.add(people.group);

const sky = buildSky();
scene.add(sky);
const lights = buildLights(world);
scene.add(lights.group);

// ---------------------------------------------------------------- camera moves
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
let flight = null;
function flyTo(pos, target, duration = 1.8) {
  endDrone();
  flight = {
    p0: camera.position.clone(),
    t0: controls.target.clone(),
    p1: pos.clone(),
    t1: target.clone(),
    time: 0,
    duration,
  };
}

const VIEWS = {
  'trail-map': () => {
    // Looking south from the north, like the painted trail map.
    const t = new THREE.Vector3(-450, 2050, 1250);
    const pitch = THREE.MathUtils.degToRad(27);
    const d = 5900;
    return [t.clone().add(new THREE.Vector3(0, Math.sin(pitch) * d, Math.cos(pitch) * d)), t];
  },
  summit: () => {
    // Standing just behind the summit, looking down the front side.
    const t = new THREE.Vector3(-600, 2250, 1900);
    return [new THREE.Vector3(40, 2805, -110), t];
  },
  'west-village': () => {
    const l = world.lodges.find((x) => x.id === 'west-village');
    const t = new THREE.Vector3(l.x, l.y + 10, l.z - 150);
    return [new THREE.Vector3(l.x + 260, l.y + 230, l.z + 520), t];
  },
  sunrise: () => {
    const l = world.lodges.find((x) => x.id === 'sunrise-lodge');
    const t = new THREE.Vector3(l.x, l.y + 10, l.z - 150);
    return [new THREE.Vector3(l.x - 300, l.y + 240, l.z + 480), t];
  },
  nordic: () => {
    const l = world.lodges.find((x) => x.id === 'nordic');
    const t = new THREE.Vector3(l.x + 500, l.y, l.z + 250);
    return [new THREE.Vector3(l.x - 500, l.y + 650, l.z + 1300), t];
  },
  parks: () => {
    // Looking down The Point and the Skyliner parks from the side.
    const run = world.runs.find((r) => r.name === 'The Point');
    const p = along(run, run.length * 0.45, {});
    const t = new THREE.Vector3(p.x, world.hf.heightAt(p.x, p.z), p.z);
    return [t.clone().add(new THREE.Vector3(-p.dz * 260 + p.dx * 120, 130, p.dx * 260 + p.dz * 120)), t];
  },
  pipe: () => {
    const run = world.runs.find((r) => r.name === 'Halfpipe');
    const p = along(run, 0, {});
    const t = along(run, run.length * 0.6, {});
    const target = new THREE.Vector3(t.x, world.hf.heightAt(t.x, t.z), t.z);
    return [new THREE.Vector3(p.x - p.dx * 30, world.hf.heightAt(p.x, p.z) + 28, p.z - p.dz * 30), target];
  },
  race: () => {
    const { run, s0, s1 } = race.course;
    const p = along(run, (s0 + s1) / 2, {});
    const t = new THREE.Vector3(p.x, world.hf.heightAt(p.x, p.z), p.z);
    return [t.clone().add(new THREE.Vector3(p.dz * 320 - p.dx * 260, 240, -p.dx * 320 - p.dz * 260)), t];
  },
  backside: () => {
    const nw = world.lifts.find((x) => x.id === 'northwest');
    const t = new THREE.Vector3((nw.top.x + nw.bottom.x) / 2, (nw.top.y + nw.bottom.y) / 2, (nw.top.z + nw.bottom.z) / 2);
    return [t.clone().add(new THREE.Vector3(2300, 1300, 1700)), t];
  },
};

function liftView(l) {
  const B = l.up.points[0];
  const T = l.up.points[l.up.points.length - 1];
  const mid = new THREE.Vector3().addVectors(B, T).multiplyScalar(0.5);
  const len = B.distanceTo(T);
  let side = l.side.clone();
  if (side.z < 0) side.negate(); // look from the north, like the trail map
  const pos = mid.clone()
    .addScaledVector(side, len * 0.62)
    .addScaledVector(l.dir, -len * 0.25)
    .add(new THREE.Vector3(0, len * 0.38, 0));
  return [pos, mid];
}

// ---------------------------------------------------------------- lift riding
let ride = null;
let rideSpeed = 4;
const rideHud = $('#ride-hud');
const lookTarget = new THREE.Vector3();
function startRide(l) {
  endDrone();
  flight = null;
  ride = { lift: l, s: 6 };
  controls.enabled = false;
  rideHud.hidden = false;
  lifts.seatAt(l, ride.s, camera.position);
  lifts.lookAt(l, ride.s, lookTarget);
}
function endRide() {
  if (!ride) return;
  const l = ride.lift;
  const top = l.up.points[l.up.points.length - 1];
  ride = null;
  rideHud.hidden = true;
  controls.enabled = true;
  controls.target.copy(top);
  const back = l.dir.clone().multiplyScalar(-90).add(new THREE.Vector3(0, 45, 0));
  camera.position.copy(top).add(back);
}

// ---------------------------------------------------------------- drone
const drone = createDrone({ camera, canvas, world });
const droneHud = $('#drone-hud');
const droneButton = $('#drone-toggle');
function startDrone() {
  if (drone.active) return;
  endRide();
  endSki();
  flight = null;
  controls.enabled = false;
  drone.start();
  droneHud.hidden = false;
  droneButton.classList.add('on');
  document.body.classList.add('flying');
}
function endDrone() {
  if (!drone.active) return;
  drone.stop();
  droneHud.hidden = true;
  droneButton.classList.remove('on');
  document.body.classList.remove('flying');
  // Hand back to orbiting around whatever the drone was looking at.
  controls.target.copy(drone.lookPoint());
  controls.enabled = true;
}
droneButton.addEventListener('click', () => (drone.active ? endDrone() : startDrone()));

// ---------------------------------------------------------------- ski mode
const ski = createSki({
  scene, camera, world,
  surfaceAt: parks.surfaceAt,
  treeNear: forest.treeNear,
  grindables: parks.grindables,
  kickers: parks.jumps,
  lifts,
  hud: $('#ski-hud'),
  envMap,
});
// Rider panel: dress the skier and remap the keys. The game holds still
// while it's open.
const riderPanel = createRiderPanel({
  onOpen: () => (ski.paused = true),
  onClose: () => (ski.paused = false),
});
$('#rider-open').addEventListener('click', () => riderPanel.open());
$('#ski-hud .ski-rider').addEventListener('click', () => riderPanel.open());
const skiHelp = $('#ski-hud .ski-help');
const syncHelp = () => (skiHelp.innerHTML = keyHelpHTML());
onSettings(syncHelp);
syncHelp();
const skiButton = $('#ski-toggle');
const startHeading = (run) => {
  const a = run.pts[0];
  const b = run.pts[Math.min(run.pts.length - 1, 4)];
  return Math.atan2(b.x - a.x, b.z - a.z);
};
// Start at the top of a run: the one named, or the nearest to the view.
function startSki(runName) {
  endRide();
  endDrone();
  flight = null;
  const near = controls.target;
  const candidates = world.runs.filter((r) => r.length > 120 && r.kind !== 'catwalk');
  const run = runName
    ? candidates.filter((r) => r.name === runName).sort((x, y) => y.length - x.length)[0]
    : candidates.reduce((best, r) => {
        const d = Math.hypot(r.pts[0].x - near.x, r.pts[0].z - near.z);
        return !best || d < best.d ? { r, d } : best;
      }, null).r;
  controls.enabled = false;
  ski.start(run.pts[0], startHeading(run));
  skiButton.classList.add('on');
  document.body.classList.add('skiing');
  camera.near = 0.3;
  camera.updateProjectionMatrix();
}
function endSki() {
  if (!ski.active) return;
  ski.stop();
  skiButton.classList.remove('on');
  document.body.classList.remove('skiing');
  camera.near = 4;
  camera.fov = 40;
  camera.updateProjectionMatrix();
  controls.target.copy(ski.position);
  controls.enabled = true;
}
skiButton.addEventListener('click', () => (ski.active ? endSki() : startSki()));
$('#ski-parks').addEventListener('click', () => startSki('Pacific City'));

// ---------------------------------------------------------------- labels
const labelLayer = $('#labels');
const labels = [];
function addLabel(text, pos, cls, onClick, maxDist = 16000, html = false) {
  const el = document.createElement('div');
  el.className = `label ${cls}`;
  if (html) el.innerHTML = text;
  else el.textContent = text;
  if (onClick) el.addEventListener('click', onClick);
  labelLayer.appendChild(el);
  labels.push({ el, pos, maxDist });
}
for (const l of lifts.lifts) {
  addLabel(l.data.name, l.labelAnchor, 'lift', () => flyTo(...liftView(l)));
}
for (const lodge of world.lodges) {
  addLabel(lodge.name, new THREE.Vector3(lodge.x, lodge.y + lodge.size[2] + 18, lodge.z), lodge.id === 'summit-hut' ? 'peak' : 'lodge');
}
for (const p of peaks.labels) addLabel(p.name, p.pos, 'mountain', null, 95000);
for (const lake of world.lakes) {
  addLabel(lake.name, new THREE.Vector3(lake.x, lake.level + 60, lake.z), 'lake', null, 30000);
}
// Run names: one label per named run, on its longest stretch, a third of the
// way down (where the painted map tends to put them).
const runLabels = [];
{
  const longest = new Map();
  const len = (pts) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) : 0), 0);
  for (const r of world.runs) {
    if (!r.name) continue;
    const L = len(r.pts);
    if (!longest.has(r.name) || longest.get(r.name).L < L) longest.set(r.name, { r, L });
  }
  for (const { r } of longest.values()) {
    // Runs are drawn top to bottom in OpenStreetMap, but not always.
    const pts = world.hf.heightAt(r.pts[0].x, r.pts[0].z) >= world.hf.heightAt(r.pts.at(-1).x, r.pts.at(-1).z) ? r.pts : [...r.pts].reverse();
    const p = pts[Math.floor(pts.length * 0.35)];
    const esc = r.name.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    addLabel(`<i class="${r.difficulty}"></i>${esc}`, new THREE.Vector3(p.x, world.hf.heightAt(p.x, p.z) + 8, p.z), 'run', null, 3800, true);
    runLabels.push(labels.at(-1));
  }
}
for (const m of world.landmarks) addLabel(m.name, new THREE.Vector3(m.x, m.y + 120, m.z), 'mountain', null, 40000);
const proj = new THREE.Vector3();
const placed = [];
const rank = (l) => {
  const c = l.el.classList;
  return c.contains('lift') ? 0 : c.contains('lodge') || c.contains('peak') ? 1 : c.contains('run') ? 3 : 2;
};
// Is the straight line from the camera to p cut by the mountain?
const probe = new THREE.Vector3();
function blockedByTerrain(p) {
  const hf = world.hf;
  // Sample densely near the camera, where the mountain usually is.
  for (let i = 1; i < 80; i++) {
    const t = (i / 80) ** 2;
    probe.lerpVectors(camera.position, p, t);
    if (probe.x < hf.minX || probe.x > hf.maxX || probe.z < hf.minZ || probe.z > hf.maxZ) continue;
    if (probe.y < hf.heightAt(probe.x, probe.z) - 2) return true;
  }
  return false;
}
let labelTick = 0;
function updateLabels() {
  if (labelLayer.hidden) return;
  labelTick = (labelTick + 1) % 8; // re-test occlusion every 8 frames
  const w = window.innerWidth;
  const h = window.innerHeight;
  placed.length = 0;
  // Lifts first so they win when labels collide; nearer labels next.
  const order = labels
    .map((l) => ({ l, dist: camera.position.distanceTo(l.pos) }))
    .sort((a, b) => rank(a.l) - rank(b.l) || a.dist - b.dist);
  for (const { l, dist } of order) {
    const { el, pos } = l;
    if (l.off) {
      el.style.display = 'none';
      continue;
    }
    proj.copy(pos).project(camera);
    let visible = proj.z < 1 && Math.abs(proj.x) < 1.1 && Math.abs(proj.y) < 1.1 && dist < l.maxDist;
    if (visible && labelTick === 0) l.hiddenByTerrain = blockedByTerrain(pos);
    if (l.hiddenByTerrain) visible = false;
    el.style.display = visible ? '' : 'none';
    if (!visible) continue;
    if (!l.size) l.size = [el.offsetWidth, el.offsetHeight];
    const scale = THREE.MathUtils.clamp(2600 / dist, 0.7, 1.15);
    const bw = l.size[0] * scale;
    const bh = l.size[1] * scale;
    const x = ((proj.x + 1) / 2) * w;
    let y = ((1 - proj.y) / 2) * h;
    const hits = () => placed.find((r) => Math.abs(r.x - x) < (r.w + bw) / 2 + 2 && Math.abs(r.y - y) < (r.h + bh) / 2 + 2);
    if (el.classList.contains('run')) {
      // Run names are optional: drop one rather than stack it.
      if (hits()) {
        el.style.display = 'none';
        continue;
      }
    } else {
      // Nudge upward until this label clears the ones already placed.
      for (let tries = 0; tries < 6; tries++) {
        const hit = hits();
        if (!hit) break;
        y = hit.y - (hit.h + bh) / 2 - 3;
      }
    }
    placed.push({ x, y, w: bw, h: bh });
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${scale})`;
  }
}

// ---------------------------------------------------------------- panel
// Fold the panel away for a clear view; remembered between visits.
const panelEl = $('#panel');
const panelOpen = $('.panel-open');
function foldPanel(folded) {
  panelEl.classList.toggle('folded', folded);
  panelOpen.hidden = !folded;
  try {
    localStorage.setItem('skibachelor.panel.folded', folded ? '1' : '');
  } catch {
    /* private mode */
  }
}
$('.panel-fold').addEventListener('click', () => foldPanel(true));
panelOpen.addEventListener('click', () => foldPanel(false));
try {
  if (localStorage.getItem('skibachelor.panel.folded')) foldPanel(true);
} catch {
  /* private mode */
}
const list = $('#lift-list');
for (const l of lifts.lifts) {
  const li = document.createElement('li');
  const vertFt = Math.round((l.data.top.y - l.data.bottom.y) * M2FT);
  li.innerHTML = `
    <button class="lift-name" title="Fly to ${l.data.name}">
      <span class="pill" style="${l.data.color ? `background:${l.data.color}` : ''}"></span>
      <span>${l.data.name}</span>
      <small>${vertFt.toLocaleString()}′ vert</small>
    </button>
    <button class="ride" title="Ride ${l.data.name}">Ride</button>`;
  li.querySelector('.lift-name').addEventListener('click', () => {
    endRide();
    flyTo(...liftView(l));
  });
  li.querySelector('.ride').addEventListener('click', () => startRide(l));
  list.appendChild(li);
}
document.querySelectorAll('[data-view]').forEach((b) =>
  b.addEventListener('click', () => {
    endRide();
    flyTo(...VIEWS[b.dataset.view]());
  }),
);

const toggles = {
  labels: (on) => (labelLayer.hidden = !on),
  runs: (on) => runLabels.forEach((l) => (l.off = !on)),
  trees: (on) => (forest.group.visible = on),
  chairs: (on) => (chairsRunning = on),
  people: (on) => (people.group.visible = on),
  map: (on) => ($('#ref').hidden = !on),
};
let chairsRunning = true;
document.querySelectorAll('[data-toggle]').forEach((input) => {
  input.addEventListener('change', () => toggles[input.dataset.toggle](input.checked));
  toggles[input.dataset.toggle](input.checked);
});
const setToggle = (name, on) => {
  const el = document.querySelector(`[data-toggle="${name}"]`);
  el.checked = on;
  toggles[name](on);
};

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'Escape') {
    endRide();
    endDrone();
    endSki();
  }
  if (ski.active) return; // the ski keys belong to the skier
  if (e.key === 'k' || e.key === 'K') startSki();
  if (e.key === 'f' || e.key === 'F') drone.active ? endDrone() : startDrone();
  if (e.key === '1') flyTo(...VIEWS['trail-map']());
  if (e.key === 'l') setToggle('labels', labelLayer.hidden);
  if (e.key === 'm') setToggle('map', $('#ref').hidden);
  if (e.key === 'r') setToggle('runs', !!runLabels[0]?.off);
  if (e.key === '+' || e.key === '=') rideSpeed = Math.min(16, rideSpeed * 2);
  if (e.key === '-') rideSpeed = Math.max(1, rideSpeed / 2);
});

// ---------------------------------------------------------------- cursor readout
const hud = $('#hud');
const refDot = $('#ref-dot');
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let mouseDirty = false;
canvas.addEventListener('pointermove', (e) => {
  mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  mouseDirty = true;
});

// March the view ray across the heightfield (much cheaper than a mesh raycast).
function pickGround() {
  raycaster.setFromCamera(mouse, camera);
  const { origin, direction } = raycaster.ray;
  const p = new THREE.Vector3();
  let t = 1;
  let prev = 0;
  for (let i = 0; i < 600 && t < 40000; i++) {
    p.copy(origin).addScaledVector(direction, t);
    const gap = p.y - world.hf.heightAt(p.x, p.z);
    if (gap < 0) {
      let lo = prev;
      let hi = t;
      for (let k = 0; k < 20; k++) {
        const m = (lo + hi) / 2;
        p.copy(origin).addScaledVector(direction, m);
        if (p.y - world.hf.heightAt(p.x, p.z) < 0) hi = m;
        else lo = m;
      }
      return p;
    }
    prev = t;
    t += Math.max(2, gap * 0.5);
  }
  return null;
}

function updateHud() {
  const camFt = Math.round(camera.position.y * M2FT).toLocaleString();
  let cursor = '—';
  if (mouseDirty) {
    const p = pickGround();
    if (p && p.x > world.hf.minX && p.x < world.hf.maxX && p.z > world.hf.minZ && p.z < world.hf.maxZ) {
      const [u, v] = world.toMapPx(p.x, p.y, p.z);
      cursor = `${Math.round(p.y * M2FT).toLocaleString()} ft · map px ${u.toFixed(0)}, ${v.toFixed(0)}`;
      refDot.style.left = `${(u / TRAIL_MAP.width) * 100}%`;
      refDot.style.top = `${(v / TRAIL_MAP.height) * 100}%`;
      refDot.hidden = false;
    } else refDot.hidden = true;
    hud.querySelector('.cursor').textContent = cursor;
    mouseDirty = false;
  }
  hud.querySelector('.camera').textContent = `${camFt} ft`;
}

// ---------------------------------------------------------------- loop
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
let hudTimer = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);

  if (flight) {
    flight.time += dt;
    const k = ease(Math.min(1, flight.time / flight.duration));
    camera.position.lerpVectors(flight.p0, flight.p1, k);
    // Arc up a little so long flights clear the mountain.
    const hop = Math.sin(Math.PI * k) * flight.p0.distanceTo(flight.p1) * 0.12;
    camera.position.y += hop;
    controls.target.lerpVectors(flight.t0, flight.t1, k);
    if (k >= 1) flight = null;
  }

  lifts.update(dt, chairsRunning);
  if (people.group.visible) people.update(chairsRunning ? dt : 0, camera.position);

  if (ride) {
    const l = ride.lift;
    ride.s += l.speed * rideSpeed * dt;
    if (ride.s >= l.up.length - 10) endRide();
    else {
      lifts.seatAt(l, ride.s, camera.position);
      lifts.lookAt(l, ride.s, lookTarget);
      lookTarget.y -= 6; // look slightly down the line, not at the cable
      camera.lookAt(lookTarget);
      const pct = Math.round((ride.s / l.up.length) * 100);
      const ft = Math.round(camera.position.y * M2FT).toLocaleString();
      rideHud.querySelector('span').textContent = `${l.data.name} · ${pct}% · ${ft} ft · ${rideSpeed}× speed`;
    }
  } else if (ski.active) {
    ski.update(dt);
  } else if (drone.active) {
    drone.update(dt);
    const agl = camera.position.y - world.hf.heightAt(camera.position.x, camera.position.z);
    const mph = Math.round(drone.velocity.length() * 2.23694);
    droneHud.querySelector('span').textContent =
      `Drone · ${Math.round(camera.position.y * M2FT).toLocaleString()} ft · ${Math.round(agl * M2FT).toLocaleString()} ft above snow · ${mph} mph`;
  } else {
    controls.update();
    // Never let the camera dip under the snow.
    const ground = world.hf.heightAt(camera.position.x, camera.position.z);
    if (camera.position.y < ground + 6) camera.position.y = ground + 6;
  }

  sky.position.copy(camera.position);
  clouds.rotation.y += dt * 0.0015; // slow drift
  const close = ride || drone.active || ski.active;
  const focus = close ? camera.position : controls.target;
  updateSunShadow(lights.sun, focus, ride ? 400 : ski.active ? 75 : drone.active ? 700 : camera.position.distanceTo(controls.target), ski.active ? 60 : 350);
  updateLabels();
  hudTimer += dt;
  if (hudTimer > 0.08) {
    hudTimer = 0;
    updateHud();
  }
  if (forest.group.visible) forest.updateDetail(camera.position);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

const [startPos, startTarget] = VIEWS['trail-map']();
camera.position.copy(startPos);
controls.target.copy(startTarget);
controls.update();
loading.classList.add('done');
setTimeout(() => loading.remove(), 700);
console.info(`Mt. Bachelor: ${forest.count.toLocaleString()} trees, ${world.runs.length} runs, ${lifts.lifts.length} lifts, ${parks.parks.length} parks, ${people.count} skiers`);
window.__mtb = { scene, camera, renderer, world, controls, drone, ski, lifts, parks, race, people, flyTo, VIEWS }; // handy for debugging in the console
frame();
