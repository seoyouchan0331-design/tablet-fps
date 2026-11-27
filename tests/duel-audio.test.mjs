import test from 'node:test';
import assert from 'node:assert/strict';
import { synthShot, synthStep, SHOT_PROFILES, profileFor } from '../src/audio/synth.js';

const SR = 48000;
const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rms = (a, i0, i1) => { let s = 0; for (let i = i0; i < i1; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, i1 - i0)); };

for (const id of Object.keys(SHOT_PROFILES)) {
  test(`${id} shot: finite, loud, never clips, and ends in silence (no hiss tail)`, () => {
    const a = synthShot(SHOT_PROFILES[id], SR, 7);
    assert.ok(a.every(Number.isFinite));
    const p = peak(a);
    assert.ok(p > 0.6 && p <= 0.95, `peak ${p}`);
    const n = a.length;
    assert.ok(n / SR <= 0.9, `${(n / SR).toFixed(2)} s long`);
    assert.ok(rms(a, n - Math.floor(SR * 0.05), n) < 0.004, 'last 50 ms must be silent');
    assert.equal(a[n - 1], 0);
  });
}

test('shots differ by weapon: shotgun and sniper carry more low end than the smg', () => {
  const energy = (id) => { const a = synthShot(SHOT_PROFILES[id], SR, 1); return rms(a, 0, a.length) * a.length / SR; };
  assert.ok(energy('shotgun') > energy('smg') * 1.4);
  assert.ok(energy('sniper') > energy('smg') * 1.4);
});

test('variants of one weapon are close but not identical', () => {
  const a = synthShot(SHOT_PROFILES.rifle, SR, 1);
  const b = synthShot(SHOT_PROFILES.rifle, SR, 2);
  assert.equal(a.length, b.length);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
  assert.ok(diff > 1);
});

test('footsteps are short, soft, and silent at the end', () => {
  for (const kind of ['walk', 'run', 'crouch', 'land']) {
    const a = synthStep(kind, SR, 3);
    assert.ok(a.every(Number.isFinite));
    assert.ok(a.length / SR < 0.3, kind);
    const p = peak(a);
    assert.ok(p > 0.05 && p < 0.8, `${kind} peak ${p}`);
    assert.equal(a[a.length - 1], 0);
  }
  assert.ok(peak(synthStep('crouch', SR, 3)) < peak(synthStep('run', SR, 3)));
});

test('profileFor maps weapon ids, defs and classes', () => {
  assert.equal(profileFor('sniper'), SHOT_PROFILES.sniper);
  assert.equal(profileFor({ id: 'shotgun' }), SHOT_PROFILES.shotgun);
  assert.equal(profileFor({ id: 'rifle', class: 'carbine' }), SHOT_PROFILES.rifle);
  assert.equal(profileFor('ai_rifle'), SHOT_PROFILES.rifle);
  assert.equal(profileFor(undefined), SHOT_PROFILES.rifle);
});
