/**
 * Player settings: keyboard bindings, touch button layout, touch look speed.
 * Stored per device in localStorage (`tfps.settings.v1`). Every read is
 * validated and every storage access is guarded: private mode, a full quota or
 * hand-edited garbage all fall back to defaults instead of breaking boot.
 */
export const STORAGE_KEY = 'tfps.settings.v1';

/** Actions a player can rebind, in the order the Controls screen lists them. */
export const BINDABLE = [
  'forward', 'back', 'left', 'right',
  'jump', 'crouch', 'sprint', 'dash',
  'fire', 'ads', 'reload', 'swapWeapon',
];

export const ACTION_LABELS = {
  forward: 'Move forward', back: 'Move back', left: 'Move left', right: 'Move right',
  jump: 'Jump', crouch: 'Crouch / slide', sprint: 'Sprint', dash: 'Dash',
  fire: 'Fire', ads: 'Aim (hold)', reload: 'Reload', swapWeapon: 'Swap weapon',
};

export const DEFAULT_BINDINGS = Object.freeze({
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  crouch: ['ControlLeft', 'KeyC'],
  sprint: ['ShiftLeft'],
  dash: ['KeyQ'],
  fire: ['KeyF'],
  ads: ['KeyE'],
  reload: ['KeyR'],
  swapWeapon: ['Tab'],
});

/** Keys that can't be bound (they open the menu or belong to the browser). */
const RESERVED = new Set(['Escape', 'MetaLeft', 'MetaRight']);

export const TOUCH_SCALE = { min: 0.7, max: 1.6 };
export const LOOK_SENS = { min: 0.4, max: 2.5 };

const clone = (b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, [...v]]));

/** Kill-sound packs (src/audio/killsounds.js), kept here so settings stay dependency-free. */
export const KILL_SOUNDS = ['neon', 'chime', 'arcade', 'impact'];

export function defaultSettings() {
  return { bindings: clone(DEFAULT_BINDINGS), touch: { scale: 1, layout: {}, lookSens: 1 }, killSound: 'neon' };
}

/**
 * Bind `code` as the primary key of `action`; it is removed from every other
 * action so one key never does two things. Returns a new bindings object.
 */
export function rebind(bindings, action, code) {
  const out = clone(bindings);
  if (!BINDABLE.includes(action) || RESERVED.has(code) || typeof code !== 'string') return out;
  for (const a of BINDABLE) out[a] = (out[a] ?? []).filter((c) => c !== code);
  out[action] = [code, ...out[action].slice(0, 1)];
  return out;
}

const clamp = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

function sanitize(raw) {
  const s = defaultSettings();
  if (!raw || typeof raw !== 'object') return s;
  const b = raw.bindings;
  if (b && typeof b === 'object') {
    for (const a of BINDABLE) {
      const v = b[a];
      if (Array.isArray(v) && v.every((c) => typeof c === 'string' && !RESERVED.has(c))) s.bindings[a] = v.slice(0, 2);
    }
  }
  if (KILL_SOUNDS.includes(raw.killSound)) s.killSound = raw.killSound;
  const t = raw.touch;
  if (t && typeof t === 'object') {
    s.touch.scale = clamp(t.scale, TOUCH_SCALE.min, TOUCH_SCALE.max, 1);
    s.touch.lookSens = clamp(t.lookSens, LOOK_SENS.min, LOOK_SENS.max, 1);
    if (t.layout && typeof t.layout === 'object') {
      for (const [id, p] of Object.entries(t.layout)) {
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) s.touch.layout[id] = { x: clamp(p.x, 0, 1, 0.5), y: clamp(p.y, 0, 1, 0.5) };
      }
    }
  }
  return s;
}

const store = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export function loadSettings(storage = store()) {
  try {
    const txt = storage?.getItem(STORAGE_KEY);
    return sanitize(txt ? JSON.parse(txt) : null);
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings, storage = store()) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* private mode / quota: settings just won't persist */
  }
}

const NAMED = { Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'R-Shift', ControlLeft: 'Ctrl', ControlRight: 'R-Ctrl',
  AltLeft: 'Alt', AltRight: 'R-Alt', Tab: 'Tab', Enter: 'Enter', Backspace: 'Bksp', CapsLock: 'Caps',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };

export function keyLabel(code) {
  if (!code) return '—';
  if (NAMED[code]) return NAMED[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}
