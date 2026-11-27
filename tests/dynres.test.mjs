import test from 'node:test';
import assert from 'node:assert/strict';
import { DynRes } from '../src/core/dynres.js';

const feed = (d, ms, seconds) => {
  let changed = 0;
  for (let t = 0; t < seconds; t += ms / 1000) if (d.sample(ms / 1000)) changed++;
  return changed;
};

test('drops one step when slow, then recovers when fast', () => {
  const d = new DynRes({ target: 1 / 60, min: 0.45, max: 0.7 });
  assert.equal(d.scale, 0.7);
  feed(d, 30, 2);
  assert.ok(Math.abs(d.scale - 0.6) < 1e-9, `got ${d.scale}`);
  feed(d, 8, 3);
  assert.ok(d.scale > 0.6, `got ${d.scale}`);
});

test('respects bounds', () => {
  const d = new DynRes({ target: 1 / 60, min: 0.45, max: 0.7 });
  feed(d, 100, 30);
  assert.ok(Math.abs(d.scale - 0.45) < 1e-9);
  feed(d, 4, 60);
  assert.ok(Math.abs(d.scale - 0.7) < 1e-9);
});

test('cooldown: at most one change per 1.5 s', () => {
  const d = new DynRes({ target: 1 / 60, min: 0.1, max: 1 });
  assert.equal(feed(d, 50, 1.4), 1);
});

test('steady vsync-locked frames at max scale never change it', () => {
  const d = new DynRes({ target: 1 / 60, min: 0.45, max: 0.7 });
  assert.equal(feed(d, 16.7, 20), 0);
  assert.equal(d.scale, 0.7);
});

test('vsync-locked below max: probes up, backs off and stays if the probe hurts', () => {
  const d = new DynRes({ target: 1 / 60, min: 0.45, max: 0.7 });
  feed(d, 30, 2); // -> 0.6
  feed(d, 16.7, 8); // stable at the cap: should probe up
  assert.ok(d.scale > 0.6, `probe expected, got ${d.scale}`);
  const probed = d.scale;
  feed(d, 30, 2); // probe was too expensive
  assert.ok(d.scale < probed);
  const settled = d.scale;
  assert.equal(feed(d, 16.7, 20), 0, 'must not re-probe right away');
  assert.equal(d.scale, settled);
});

test('ignores huge one-off hitches (tab switch)', () => {
  const d = new DynRes({ target: 1 / 60, min: 0.45, max: 0.7 });
  feed(d, 10, 2);
  d.sample(2.0);
  assert.equal(feed(d, 10, 0.5), 0);
  assert.equal(d.scale, 0.7);
});

test('boot warm-up: slow frames in the first 3 s never lower the scale', () => {
  const d = new DynRes({ target: 1 / 60, min: 0.45, max: 1, start: 0.7, warmup: 3 });
  assert.equal(d.scale, 0.7);
  assert.equal(feed(d, 60, 2.9), 0);
  assert.equal(d.scale, 0.7);
});

test('starts at `start` and can climb above it up to max when there is headroom', () => {
  const d = new DynRes({ target: 1 / 60, min: 0.45, max: 1, start: 0.7, warmup: 0 });
  assert.equal(d.scale, 0.7);
  feed(d, 16.7, 30); // vsync-locked, never slow: keeps probing up
  assert.ok(d.scale > 0.85, `got ${d.scale}`);
});
