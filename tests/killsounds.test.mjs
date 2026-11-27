import test from 'node:test';
import assert from 'node:assert/strict';
import { KILL_PACKS, PACK_IDS, killRate, killLevel, synthKill, synthHitTick, synthHeadDing } from '../src/audio/killsounds.js';

const SR = 48000;
const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

test('four packs, neon first (synth, no files)', () => {
  assert.deepEqual(PACK_IDS, ['neon', 'chime', 'arcade', 'impact']);
  assert.equal(KILL_PACKS.neon.files, null);
  for (const id of PACK_IDS.slice(1)) for (const k of ['kill', 'final', 'head']) assert.ok(KILL_PACKS[id].files[k], `${id}.${k}`);
});

test('kill level climbs 1..5 and stays at 5', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map(killLevel), [1, 2, 3, 4, 5, 5, 5]);
  assert.equal(killLevel(0), 1);
});

test('each kill sounds higher than the last', () => {
  for (let l = 1; l < 5; l++) assert.ok(killRate(l + 1) > killRate(l));
  assert.equal(killRate(1), 1);
});

test('neon kill: more notes and longer as the level climbs; clean ends', () => {
  let prev = 0;
  for (let l = 1; l <= 5; l++) {
    const a = synthKill(l, SR);
    assert.ok(a.every(Number.isFinite));
    assert.ok(peak(a) > 0.5 && peak(a) <= 0.95);
    assert.equal(a[a.length - 1], 0);
    assert.ok(a.length > prev, `level ${l} not longer`);
    prev = a.length;
  }
});

test('hit tick is tiny and short; headshot ding is distinct and longer', () => {
  const t = synthHitTick(SR), d = synthHeadDing(SR);
  assert.ok(t.length / SR < 0.06 && peak(t) < 0.6);
  assert.ok(d.length / SR > 0.12 && d.length / SR < 0.4);
  assert.equal(t[t.length - 1], 0);
  assert.equal(d[d.length - 1], 0);
});
