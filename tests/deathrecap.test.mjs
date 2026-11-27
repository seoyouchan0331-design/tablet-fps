import test from 'node:test';
import assert from 'node:assert/strict';
import { recapText } from '../src/ui/deathrecap.js';
import { killcamAngles } from '../src/match/killcam.js';

test('recap names the weapon, headshot, distance, hits and their HP', () => {
  const r = recapText({ weapon: 'sniper', headshot: true, distance: 17.6, hits: [{ amount: 100, headshot: true }], oppHp: 67.2 });
  assert.equal(r.weapon, 'LR-7 · SNIPER');
  assert.equal(r.headshot, true);
  assert.equal(r.distance, '18 m');
  assert.equal(r.taken, 'You took 1 hit · 100 dmg (1 to the head)');
  assert.equal(r.opp, 'Opponent had 67 HP left');
});

test('recap with several body hits and unknown bits', () => {
  const r = recapText({ weapon: 'rifle', headshot: false, distance: NaN, hits: [{ amount: 33 }, { amount: 33 }, { amount: 34 }] });
  assert.equal(r.weapon, 'M4A1 · RIFLE');
  assert.equal(r.distance, '');
  assert.equal(r.taken, 'You took 3 hits · 100 dmg');
  assert.equal(r.opp, '');
  assert.equal(recapText({ weapon: 'nope', hits: [] }).weapon, 'UNKNOWN');
});

test('killcam turns toward the killer the short way round and eases in', () => {
  const eye = { x: 0, y: 1.6, z: 0 };
  // killer straight behind (+z): yaw PI; from yaw -3 the short way is down through -PI
  const a = killcamAngles(eye, { x: 0, y: 1.6, z: 10 }, { yaw: -3, pitch: 0 }, 1);
  assert.ok(Math.abs(Math.abs(a.yaw) - Math.PI) < 1e-6, `${a.yaw}`);
  const half = killcamAngles(eye, { x: 10, y: 1.6, z: 0 }, { yaw: 0, pitch: 0 }, 0.5);
  assert.ok(half.yaw < 0 && half.yaw > -Math.PI / 2, `${half.yaw}`); // +x is yaw -PI/2
  const up = killcamAngles(eye, { x: 0, y: 6.6, z: -5 }, { yaw: 0, pitch: 0 }, 1);
  assert.ok(Math.abs(up.pitch - Math.PI / 4) < 1e-6);
});
