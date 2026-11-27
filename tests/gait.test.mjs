import test from 'node:test';
import assert from 'node:assert/strict';
import { pickClip } from '../src/opponent/gait.js';

test('dead always plays Death', () => {
  assert.equal(pickClip({ speed: 9, air: true, alive: false }).clip, 'Death');
});

test('in the air plays Jump', () => {
  assert.equal(pickClip({ speed: 3, air: true, alive: true }).clip, 'Jump');
});

test('standing still idles, slow walks, fast runs', () => {
  assert.equal(pickClip({ speed: 0.1, air: false, alive: true }).clip, 'Idle');
  assert.equal(pickClip({ speed: 2.5, air: false, alive: true }).clip, 'Walking');
  assert.equal(pickClip({ speed: 9, air: false, alive: true }).clip, 'Running');
});

test('run playback speeds up with ground speed, within sane bounds', () => {
  const slow = pickClip({ speed: 5, air: false, alive: true }).timeScale;
  const fast = pickClip({ speed: 12, air: false, alive: true }).timeScale;
  assert.ok(fast > slow);
  assert.ok(slow >= 0.6 && fast <= 2.2, `${slow} ${fast}`);
});

test('hysteresis: around the walk/run threshold it does not flicker', () => {
  const a = pickClip({ speed: 4.4, air: false, alive: true }, 'Running').clip;
  const b = pickClip({ speed: 4.4, air: false, alive: true }, 'Walking').clip;
  assert.equal(a, 'Running');
  assert.equal(b, 'Walking');
});
