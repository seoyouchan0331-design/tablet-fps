import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BINDINGS, BINDABLE, rebind, loadSettings, saveSettings, keyLabel } from '../src/core/settings.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

test('defaults cover every bindable action', () => {
  for (const a of BINDABLE) assert.ok(Array.isArray(DEFAULT_BINDINGS[a]), a);
  assert.deepEqual(DEFAULT_BINDINGS.forward, ['KeyW', 'ArrowUp']);
  assert.deepEqual(DEFAULT_BINDINGS.dash, ['KeyQ']);
});

test('rebind sets the primary key and steals it from any other action', () => {
  const b = rebind(DEFAULT_BINDINGS, 'jump', 'KeyQ');
  assert.equal(b.jump[0], 'KeyQ');
  assert.ok(!b.dash.includes('KeyQ'), 'Q removed from dash');
  assert.deepEqual(DEFAULT_BINDINGS.dash, ['KeyQ'], 'defaults untouched');
});

test('rebind refuses reserved keys (Escape)', () => {
  const b = rebind(DEFAULT_BINDINGS, 'jump', 'Escape');
  assert.deepEqual(b.jump, DEFAULT_BINDINGS.jump);
});

test('settings round-trip through storage; garbage falls back to defaults', () => {
  const s = mem();
  saveSettings({ bindings: rebind(DEFAULT_BINDINGS, 'reload', 'KeyT'), touch: { scale: 1.2, layout: { fire: { x: 0.8, y: 0.6 } }, lookSens: 1.5 } }, s);
  const back = loadSettings(s);
  assert.equal(back.bindings.reload[0], 'KeyT');
  assert.equal(back.touch.scale, 1.2);
  assert.deepEqual(back.touch.layout.fire, { x: 0.8, y: 0.6 });
  const bad = mem(); bad.setItem('tfps.settings.v1', '{not json');
  assert.deepEqual(loadSettings(bad).bindings, DEFAULT_BINDINGS);
  const weird = mem(); weird.setItem('tfps.settings.v1', JSON.stringify({ bindings: { jump: 5, nope: ['KeyX'] }, touch: { scale: 99 } }));
  const w = loadSettings(weird);
  assert.deepEqual(w.bindings.jump, DEFAULT_BINDINGS.jump);
  assert.ok(!('nope' in w.bindings));
  assert.ok(w.touch.scale <= 1.6);
});

test('storage that throws (private mode) still yields defaults', () => {
  const boom = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(loadSettings(boom).bindings, DEFAULT_BINDINGS);
  assert.doesNotThrow(() => saveSettings(loadSettings(boom), boom));
});

test('key labels are human readable', () => {
  assert.equal(keyLabel('KeyW'), 'W');
  assert.equal(keyLabel('Digit3'), '3');
  assert.equal(keyLabel('ShiftLeft'), 'Shift');
  assert.equal(keyLabel('Space'), 'Space');
  assert.equal(keyLabel(undefined), '—');
});
