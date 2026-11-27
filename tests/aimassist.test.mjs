import test from 'node:test';
import assert from 'node:assert/strict';
import { aimAssist, CONE } from '../src/player/aimassist.js';

const deg = (d) => (d * Math.PI) / 180;
const inside = { yaw: deg(1), pitch: 0 };
const outside = { yaw: deg(5), pitch: 0 };
const vel = { yaw: 0.8, pitch: -0.2 };

test('cone is 3 degrees', () => {
  assert.ok(Math.abs(CONE - deg(3)) < 1e-12);
});

test('off does nothing', () => {
  assert.deepEqual(aimAssist('off', inside, vel, true), { lookScale: 1, trackYaw: 0, trackPitch: 0 });
});

test('low inside the cone: 0.75 slowdown, tracks 25 % of target angular velocity', () => {
  const r = aimAssist('low', inside, vel, true);
  assert.equal(r.lookScale, 0.75);
  assert.ok(Math.abs(r.trackYaw - 0.2) < 1e-12);
  assert.ok(Math.abs(r.trackPitch - -0.05) < 1e-12);
});

test('medium inside the cone: 0.55 slowdown, 45 % tracking', () => {
  const r = aimAssist('medium', inside, vel, true);
  assert.equal(r.lookScale, 0.55);
  assert.ok(Math.abs(r.trackYaw - 0.36) < 1e-12);
});

test('outside the cone or not visible: no effect', () => {
  assert.deepEqual(aimAssist('medium', outside, vel, true), { lookScale: 1, trackYaw: 0, trackPitch: 0 });
  assert.deepEqual(aimAssist('medium', inside, vel, false), { lookScale: 1, trackYaw: 0, trackPitch: 0 });
});

test('tracking never exceeds the target angular velocity (no snap)', () => {
  for (const level of ['low', 'medium']) {
    const r = aimAssist(level, inside, vel, true);
    assert.ok(Math.abs(r.trackYaw) <= Math.abs(vel.yaw));
    assert.ok(Math.abs(r.trackPitch) <= Math.abs(vel.pitch));
  }
});

test('unknown level behaves like off', () => {
  assert.deepEqual(aimAssist('max', inside, vel, true), { lookScale: 1, trackYaw: 0, trackPitch: 0 });
});
