import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotBuffer } from '../src/match/interp.js';

const S = (x, yaw = 0) => ({ x, y: 0, z: 0, yaw, alive: true });

test('before the first snapshot there is nothing to show', () => {
  const b = new SnapshotBuffer();
  assert.equal(b.sample(1, {}), false);
});

test('halfway between two snapshots', () => {
  const b = new SnapshotBuffer();
  b.push(1, S(0)); b.push(2, S(10));
  const o = {};
  assert.equal(b.sample(1.5, o), true);
  assert.ok(Math.abs(o.x - 5) < 1e-9);
});

test('yaw takes the short way across +/- PI', () => {
  const b = new SnapshotBuffer();
  b.push(1, S(0, 3.1)); b.push(2, S(0, -3.1));
  const o = {};
  b.sample(1.5, o);
  assert.ok(Math.abs(Math.abs(o.yaw) - Math.PI) < 0.01, String(o.yaw));
});

test('after the last snapshot it holds the last state', () => {
  const b = new SnapshotBuffer();
  b.push(1, S(0)); b.push(2, S(10));
  const o = {};
  b.sample(5, o);
  assert.equal(o.x, 10);
});

test('drops snapshots older than 1 s', () => {
  const b = new SnapshotBuffer();
  for (let t = 0; t <= 5; t += 0.1) b.push(t, S(t));
  assert.ok(b.length <= 12, String(b.length));
});

test('non-boolean fields come from the nearer snapshot', () => {
  const b = new SnapshotBuffer();
  b.push(1, { ...S(0), alive: true }); b.push(2, { ...S(1), alive: false });
  const o = {};
  b.sample(1.9, o);
  assert.equal(o.alive, false);
});
