import test from 'node:test';
import assert from 'node:assert/strict';
import { Dash } from '../src/player/dash.js';

test('first dash starts; second within cooldown is refused', () => {
  const d = new Dash();
  assert.equal(d.tryStart(10, 0, -1), true);
  assert.equal(d.tryStart(11, 0, -1), false);
  assert.ok(Math.abs(d.cooldownLeft(11) - 2) < 1e-9);
  assert.equal(d.ready(12.99), false);
});

test('ready again exactly at 3.0 s', () => {
  const d = new Dash();
  d.tryStart(10, 1, 0);
  assert.equal(d.ready(13), true);
  assert.equal(d.tryStart(13, 1, 0), true);
});

test('dash is a fast slide: launch velocity along the normalised direction at slideSpeed', () => {
  const d = new Dash();
  assert.equal(d.slideSpeed, 18);
  d.tryStart(0, 3, 4);
  const v = d.launch({ x: 0, z: 0 }, true);
  assert.ok(Math.abs(Math.hypot(v.x, v.z) - 18) < 1e-9);
  assert.ok(Math.abs(v.x / v.z - 0.75) < 1e-9);
});

test('in the air the push is gentler (airSpeed)', () => {
  const d = new Dash();
  assert.ok(d.airSpeed < d.slideSpeed);
  d.tryStart(0, 1, 0);
  const v = d.launch({ x: 0, z: 0 }, false);
  assert.ok(Math.abs(v.x - d.airSpeed) < 1e-9 && v.z === 0);
});

test('zero direction is refused (caller must pass facing)', () => {
  const d = new Dash();
  assert.equal(d.tryStart(0, 0, 0), false);
  assert.equal(d.ready(0), true);
});

test('cooldownLeft is never negative', () => {
  const d = new Dash();
  assert.equal(d.cooldownLeft(0), 0);
  d.tryStart(0, 1, 0);
  assert.equal(d.cooldownLeft(100), 0);
});
