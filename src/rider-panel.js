// The Rider panel: dress your skier (colours, fit, fabric designs, goggles,
// skis) with a live turntable preview, and remap the keys.

import * as THREE from 'three';
import { createSkierModel } from './skier-model.js';
import {
  ACTIONS, bindKey, clearKey, getBindings, getLook, keyName, onSettings, resetKeys, resetLook, setLook,
} from './settings.js';

const SWATCHES = {
  jacket: ['#ffc20e', '#ff5a1f', '#e6194b', '#ff7eb6', '#7b2ff7', '#1d5fa8', '#19b6c9', '#2fbf71', '#6b7f3a', '#f3f4f2', '#8a8f96', '#131416'],
  pants: ['#24282e', '#131416', '#3d4a5c', '#1f3d2b', '#6b5a3a', '#c9b48a', '#f3f4f2', '#ff5a1f', '#1d5fa8', '#7b2ff7'],
  trim: ['#131416', '#f3f4f2', '#ffc20e', '#ff5a1f', '#1d5fa8', '#2fbf71', '#e6194b', '#7b2ff7'],
  helmet: ['#f4f6f8', '#131416', '#ffc20e', '#e6194b', '#1d5fa8', '#2fbf71', '#8a8f96', '#ff7eb6'],
  boot: ['#2a2e34', '#f0f2f4', '#8a8f96', '#1d5fa8', '#e6194b', '#ffc20e'],
  gaiter: ['#131416', '#f3f4f2', '#8a8f96', '#6b7f3a', '#e6194b', '#1d5fa8', '#ff7eb6'],
  skiColor: ['#ffc20e', '#ff5a1f', '#e6194b', '#19b6c9', '#2fbf71', '#f3f4f2', '#7b2ff7'],
};
const CHOICES = {
  fit: [['slim', 'Slim'], ['regular', 'Regular'], ['baggy', 'Baggy'], ['xxl', 'XXL']],
  jacketDesign: [['panels', 'Panels'], ['solid', 'Solid'], ['colorblock', 'Colour block'], ['camo', 'Camo'], ['check', 'Flannel'], ['stripes', 'Stripes'], ['fade', 'Fade']],
  pantsDesign: [['solid', 'Solid'], ['cargo', 'Cargo'], ['camo', 'Camo'], ['check', 'Flannel'], ['stripes', 'Stripes']],
  hood: [['down', 'Down'], ['up', 'Up over the helmet']],
  lens: [['sunset', 'Sunset'], ['ice', 'Ice'], ['gold', 'Gold'], ['smoke', 'Smoke'], ['emerald', 'Emerald']],
  skiDesign: [['chevron', 'Chevron'], ['stripe', 'Racing stripe'], ['flames', 'Flames'], ['checker', 'Checker'], ['wood', 'Woodgrain']],
};

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

export function createRiderPanel({ onOpen, onClose } = {}) {
  const root = el('div', 'rider');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Rider and controls');
  root.innerHTML = `
    <div class="rider-card">
      <header>
        <div class="rider-tabs" role="tablist">
          <button role="tab" data-tab="look" aria-selected="true">Rider</button>
          <button role="tab" data-tab="keys" aria-selected="false">Controls</button>
        </div>
        <button class="rider-close" aria-label="Close">✕</button>
      </header>
      <div class="rider-body" data-pane="look">
        <div class="rider-stage"><canvas width="560" height="680"></canvas><span>Drag to turn</span></div>
        <div class="rider-opts"></div>
      </div>
      <div class="rider-body" data-pane="keys" hidden>
        <p class="rider-note">Click a key to change it, then press the new one. <kbd>Backspace</kbd> clears it, <kbd>Esc</kbd> cancels.</p>
        <div class="rider-keys"></div>
        <button class="rider-reset" data-reset="keys">Reset to defaults</button>
      </div>
    </div>`;
  document.body.appendChild(root);

  // --- Tabs.
  const tabs = root.querySelectorAll('[data-tab]');
  function showTab(name) {
    for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.tab === name));
    for (const p of root.querySelectorAll('[data-pane]')) p.hidden = p.dataset.pane !== name;
  }
  for (const t of tabs) t.addEventListener('click', () => showTab(t.dataset.tab));

  // --- Look options.
  const opts = root.querySelector('.rider-opts');
  function colorRow(key, label) {
    const row = el('div', 'rider-row');
    row.appendChild(el('label', null, label));
    const sw = el('div', 'rider-swatches');
    for (const c of SWATCHES[key]) {
      const b = el('button', 'sw');
      b.style.background = c;
      b.dataset.v = c;
      b.title = c;
      b.addEventListener('click', () => setLook({ [key]: c }));
      sw.appendChild(b);
    }
    const pick = el('input');
    pick.type = 'color';
    pick.title = 'Any colour';
    pick.addEventListener('input', () => setLook({ [key]: pick.value }));
    sw.appendChild(pick);
    row.appendChild(sw);
    row.sync = (look) => {
      for (const b of sw.querySelectorAll('.sw')) b.classList.toggle('on', b.dataset.v.toLowerCase() === String(look[key]).toLowerCase());
      pick.value = look[key];
    };
    return row;
  }
  function chipRow(key, label) {
    const row = el('div', 'rider-row');
    row.appendChild(el('label', null, label));
    const chips = el('div', 'rider-chips');
    for (const [v, name] of CHOICES[key]) {
      const b = el('button', 'chip', name);
      b.dataset.v = v;
      b.addEventListener('click', () => setLook({ [key]: v }));
      chips.appendChild(b);
    }
    row.appendChild(chips);
    row.sync = (look) => {
      for (const b of chips.children) b.classList.toggle('on', b.dataset.v === look[key]);
    };
    return row;
  }
  const rows = [
    chipRow('fit', 'Fit'),
    colorRow('jacket', 'Jacket'),
    chipRow('jacketDesign', 'Jacket design'),
    colorRow('trim', 'Accent'),
    colorRow('pants', 'Pants'),
    chipRow('pantsDesign', 'Pants design'),
    colorRow('helmet', 'Helmet'),
    chipRow('hood', 'Hood'),
    colorRow('gaiter', 'Face mask'),
    chipRow('lens', 'Goggle lens'),
    colorRow('boot', 'Boots'),
    chipRow('skiDesign', 'Ski graphic'),
    colorRow('skiColor', 'Ski colour'),
  ];
  for (const r of rows) opts.appendChild(r);
  const actions = el('div', 'rider-actions');
  const shuffle = el('button', 'rider-reset', '🎲 Shuffle');
  shuffle.addEventListener('click', () => {
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    setLook({
      fit: pick(CHOICES.fit)[0],
      jacket: pick(SWATCHES.jacket),
      jacketDesign: pick(CHOICES.jacketDesign)[0],
      trim: pick(SWATCHES.trim),
      pants: pick(SWATCHES.pants),
      pantsDesign: pick(CHOICES.pantsDesign)[0],
      helmet: pick(SWATCHES.helmet),
      hood: pick(CHOICES.hood)[0],
      gaiter: pick(SWATCHES.gaiter),
      boot: pick(SWATCHES.boot),
      lens: pick(CHOICES.lens)[0],
      skiDesign: pick(CHOICES.skiDesign)[0],
      skiColor: pick(SWATCHES.skiColor),
    });
  });
  const reset = el('button', 'rider-reset', 'Reset');
  reset.addEventListener('click', resetLook);
  actions.append(shuffle, reset);
  opts.appendChild(actions);

  // --- Keys.
  const keysEl = root.querySelector('.rider-keys');
  let listening = null; // { id, slot, button }
  function renderKeys() {
    keysEl.innerHTML = '';
    const b = getBindings();
    for (const a of ACTIONS) {
      const row = el('div', 'rider-key');
      row.appendChild(el('span', null, a.label));
      for (const slot of [0, 1]) {
        const btn = el('button', 'keycap', keyName(b[a.id][slot]));
        if (!b[a.id][slot]) btn.classList.add('empty');
        btn.addEventListener('click', () => {
          if (listening) listening.button.classList.remove('wait');
          listening = { id: a.id, slot, button: btn };
          btn.classList.add('wait');
          btn.textContent = 'Press a key…';
        });
        row.appendChild(btn);
      }
      keysEl.appendChild(row);
    }
  }
  root.querySelector('[data-reset="keys"]').addEventListener('click', resetKeys);
  // Capture keys before the game sees them while the panel is open.
  window.addEventListener(
    'keydown',
    (e) => {
      if (root.hidden) return;
      if (listening) {
        e.preventDefault();
        e.stopPropagation();
        const { id, slot } = listening;
        listening = null;
        if (e.code === 'Escape') renderKeys();
        else if (e.code === 'Backspace' || e.code === 'Delete') clearKey(id, slot);
        else bindKey(id, slot, e.code);
        return;
      }
      if (e.code === 'Escape') {
        e.stopPropagation();
        close();
      }
      if (e.target.tagName !== 'INPUT') e.stopPropagation();
    },
    true,
  );
  window.addEventListener('keyup', (e) => { if (!root.hidden) e.stopPropagation(); }, true);

  // --- Live preview.
  const canvas = root.querySelector('canvas');
  let renderer = null;
  let scene = null;
  let camera = null;
  let model = null;
  let turn = -0.5;
  let raf = 0;
  let drag = null;
  function buildPreview() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdfeeff, 0x8899aa, 1.6));
    const sun = new THREE.DirectionalLight(0xfff4e6, 2.6);
    sun.position.set(2, 4, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -1.5;
    sun.shadow.camera.right = sun.shadow.camera.top = 1.5;
    scene.add(sun);
    const snow = new THREE.Mesh(new THREE.CircleGeometry(1.4, 48), new THREE.MeshStandardMaterial({ color: 0xf4f8fc, roughness: 0.9 }));
    snow.rotation.x = -Math.PI / 2;
    snow.receiveShadow = true;
    scene.add(snow);
    camera = new THREE.PerspectiveCamera(30, canvas.width / canvas.height, 0.1, 20);
    camera.position.set(0, 1.3, 4.6);
    camera.lookAt(0, 0.82, 0);
    canvas.addEventListener('pointerdown', (e) => {
      drag = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (drag == null) return;
      turn += (e.clientX - drag) * 0.01;
      drag = e.clientX;
    });
    canvas.addEventListener('pointerup', () => (drag = null));
  }
  function rebuildModel() {
    if (!scene) return;
    if (model) {
      scene.remove(model.root);
      model.dispose();
    }
    model = createSkierModel({ look: getLook() });
    model.pose({ crouch: 0.22, airArms: 0 });
    model.root.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    scene.add(model.root);
  }
  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (drag == null) turn += 0.004;
    model.root.rotation.y = turn;
    model.pose({ crouch: 0.22 + 0.04 * Math.sin(t / 900), look: Math.sin(t / 1700) * 0.3 });
    renderer.render(scene, camera);
  }

  // --- Sync with settings.
  function sync() {
    const look = getLook();
    for (const r of rows) r.sync(look);
    renderKeys();
    if (!root.hidden) rebuildModel();
  }
  onSettings(sync);

  function open(tab = 'look') {
    root.hidden = false;
    showTab(tab);
    if (!renderer) buildPreview();
    sync();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
    onOpen?.();
  }
  function close() {
    root.hidden = true;
    listening = null;
    cancelAnimationFrame(raf);
    onClose?.();
  }
  root.querySelector('.rider-close').addEventListener('click', close);
  root.addEventListener('pointerdown', (e) => {
    if (e.target === root) close();
  });
  sync();
  return { open, close, get isOpen() { return !root.hidden; } };
}

// The in-game key help line, rebuilt from the current bindings.
export function keyHelpHTML() {
  const b = getBindings();
  const k = (id) => (b[id][0] ? `<kbd>${keyName(b[id][0])}</kbd>` : '<kbd>—</kbd>');
  return `${k('left')}${k('right')} carve · spin &nbsp; ${k('up')} tuck · frontflip &nbsp; ${k('down')} hockey stop · backflip &nbsp; hold ${k('pop')} pop (hold a direction to wind up) &nbsp; ${k('grab')} grab (+${keyName(b.up[0])}/${keyName(b.down[0])}/${keyName(b.left[0])} to change) · butter &nbsp; ${k('lift')} ride lift &nbsp; ${k('sound')} sound &nbsp; ${k('reset')} reset &nbsp; <kbd>Esc</kbd> stop`;
}
