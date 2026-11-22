// Player settings kept in the browser: key bindings and the rider's look.
// Anything can subscribe with onSettings() to hear about changes.

const KEYS_STORE = 'skibachelor.keys.v1';
const LOOK_STORE = 'skibachelor.look.v1';

// Each action can have up to two keys (KeyboardEvent.code values).
export const ACTIONS = [
  { id: 'left', label: 'Carve / spin left', keys: ['KeyA', 'ArrowLeft'] },
  { id: 'right', label: 'Carve / spin right', keys: ['KeyD', 'ArrowRight'] },
  { id: 'up', label: 'Tuck · frontflip · japan', keys: ['KeyW', 'ArrowUp'] },
  { id: 'down', label: 'Hockey stop · backflip · tail', keys: ['KeyS', 'ArrowDown'] },
  { id: 'pop', label: 'Pop (hold to load)', keys: ['Space'] },
  { id: 'grab', label: 'Grab · butter', keys: ['ShiftLeft', 'ShiftRight'] },
  { id: 'lift', label: 'Ride the lift', keys: ['KeyE'] },
  { id: 'reset', label: 'Back to last spot', keys: ['KeyR'] },
  { id: 'sound', label: 'Sound on / off', keys: ['KeyM'] },
];

export const LOOK_DEFAULT = {
  jacket: '#ffc20e',
  trim: '#131416',
  pants: '#24282e',
  helmet: '#f4f6f8',
  fit: 'regular', // slim | regular | baggy | xxl
  jacketDesign: 'panels', // panels | solid | colorblock | camo | check | stripes | fade
  pantsDesign: 'solid', // solid | camo | cargo | check | stripes
  lens: 'sunset', // sunset | ice | gold | smoke | emerald
  skiDesign: 'chevron', // chevron | stripe | flames | checker | wood
  skiColor: '#ffc20e',
};

const read = (k) => {
  try {
    return JSON.parse(localStorage.getItem(k) || 'null');
  } catch {
    return null;
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* private mode: settings just won't stick */
  }
};

const listeners = new Set();
const emit = () => listeners.forEach((f) => f());
export const onSettings = (f) => (listeners.add(f), () => listeners.delete(f));

// --- Keys.
let bindings = Object.fromEntries(ACTIONS.map((a) => [a.id, [...a.keys]]));
const savedKeys = read(KEYS_STORE);
if (savedKeys) for (const a of ACTIONS) if (Array.isArray(savedKeys[a.id])) bindings[a.id] = savedKeys[a.id].slice(0, 2);

export const getBindings = () => bindings;
// code -> action id, for the key handler.
export function codeMap() {
  const m = {};
  for (const a of ACTIONS) for (const c of bindings[a.id]) m[c] = a.id;
  return m;
}
// Put `code` in `slot` (0 or 1) of an action, taking it off anything else.
export function bindKey(id, slot, code) {
  for (const a of ACTIONS) bindings[a.id] = bindings[a.id].filter((c) => c !== code);
  const list = bindings[id];
  if (slot < list.length) list[slot] = code;
  else list.push(code);
  write(KEYS_STORE, bindings);
  emit();
}
export function clearKey(id, slot) {
  bindings[id].splice(slot, 1);
  write(KEYS_STORE, bindings);
  emit();
}
export function resetKeys() {
  bindings = Object.fromEntries(ACTIONS.map((a) => [a.id, [...a.keys]]));
  write(KEYS_STORE, bindings);
  emit();
}
// A short label for a key code: KeyA -> A, ArrowLeft -> ←, ShiftLeft -> Shift.
export function keyName(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map = {
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space',
    ShiftLeft: 'Shift', ShiftRight: 'R-Shift', ControlLeft: 'Ctrl', ControlRight: 'R-Ctrl',
    AltLeft: 'Alt', AltRight: 'R-Alt', MetaLeft: 'Cmd', MetaRight: 'R-Cmd', Enter: 'Enter',
    Tab: 'Tab', Backspace: '⌫', CapsLock: 'Caps', Semicolon: ';', Quote: "'", Comma: ',',
    Period: '.', Slash: '/', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=',
  };
  return map[code] || code.replace(/^Numpad/, 'Num ');
}

// --- Look.
let look = { ...LOOK_DEFAULT, ...(read(LOOK_STORE) || {}) };
export const getLook = () => look;
export function setLook(patch) {
  look = { ...look, ...patch };
  write(LOOK_STORE, look);
  emit();
}
export function resetLook() {
  look = { ...LOOK_DEFAULT };
  write(LOOK_STORE, look);
  emit();
}
