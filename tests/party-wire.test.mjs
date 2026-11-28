import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packState, unpackState } from '../src/party/wire.js';

const rnd = (lo, hi) => lo + Math.random() * (hi - lo);
const angDiff = (a, b) => Math.abs(a - b - Math.round((a - b) / (2 * Math.PI)) * 2 * Math.PI);

test('round trip: position within 0.5 cm, angles within 0.03 degrees, flags exact', () => {
  let maxPos = 0, maxAng = 0;
  for (let i = 0; i < 20000; i++) {
    const s = {
      id: i % 8, t: rnd(0, 7200), x: rnd(-40, 40), y: rnd(0, 7), z: rnd(-40, 40),
      yaw: rnd(-20, 20), pitch: rnd(-1.5, 1.5),
      alive: Math.random() < 0.5, air: Math.random() < 0.5, crouch: Math.random() < 0.5, rl: Math.random() < 0.5,
      w: ['rifle', 'smg', 'pistol', 'shotgun', 'sniper'][i % 5],
    };
    const u = unpackState(JSON.parse(JSON.stringify(packState(s))));
    maxPos = Math.max(maxPos, Math.abs(u.x - s.x), Math.abs(u.y - s.y), Math.abs(u.z - s.z));
    maxAng = Math.max(maxAng, angDiff(u.yaw, s.yaw), Math.abs(u.pitch - s.pitch));
    assert.equal(u.id, s.id);
    assert.ok(Math.abs(u.t - s.t) <= 0.0005);
    for (const k of ['alive', 'air', 'crouch', 'rl', 'w']) assert.equal(u[k], s[k], k);
  }
  assert.ok(maxPos <= 0.005 + 1e-9, `position error ${maxPos} m`);
  assert.ok(maxAng <= 0.0005 + 1e-9, `angle error ${maxAng} rad`);
});

test('compact: at least half the size of the keyed state', () => {
  const s = { id: 3, t: 123.45678901234, x: 12.345678901234567, y: 0.0312345678, z: -7.123456789012345, yaw: 1.2345678901234567, pitch: -0.123456789012345, w: 'rifle', rl: false, alive: true, air: false, crouch: false };
  const full = JSON.stringify(s).length, small = JSON.stringify(packState(s)).length;
  assert.ok(small * 2 <= full, `${small} vs ${full} bytes`);
});

test('malformed input is rejected', () => {
  for (const bad of [null, {}, [1, 2], [1, 'x', 0, 0, 0, 0, 0, 1, 0], 'str']) assert.equal(unpackState(bad), null);
});
