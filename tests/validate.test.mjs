import test from 'node:test';
import assert from 'node:assert/strict';
import { validateHit } from '../src/match/validate.js';

const base = () => ({
  claim: { shooter: 'host', target: 'guest', weapon: 'rifle', t: 10, from: [0, 1.6, 10], point: [0, 1.2, -10], part: 'body' },
  ctx: { live: true, alive: { host: true, guest: true }, lastFire: { host: 9.9, guest: 0 }, cycleTime: () => 0.075, lineOfSight: () => true },
});

test('accepts a clean claim', () => {
  const { claim, ctx } = base();
  assert.deepEqual(validateHit(claim, ctx), { ok: true });
});

test('rejects outside a live round', () => {
  const { claim, ctx } = base(); ctx.live = false;
  assert.deepEqual(validateHit(claim, ctx), { ok: false, reason: 'not-live' });
});

test('rejects dead shooter or dead target', () => {
  const a = base(); a.ctx.alive.host = false;
  assert.equal(validateHit(a.claim, a.ctx).reason, 'dead');
  const b = base(); b.ctx.alive.guest = false;
  assert.equal(validateHit(b.claim, b.ctx).reason, 'dead');
});

test('rejects fire faster than 90 % of the weapon cycle', () => {
  const { claim, ctx } = base(); ctx.lastFire.host = 10 - 0.05; // 0.05 < 0.9 * 0.075
  assert.equal(validateHit(claim, ctx).reason, 'fire-rate');
});

test('rejects beyond 120 m (longer than any map allows)', () => {
  const { claim, ctx } = base(); claim.point = [0, 1.2, -115];
  assert.equal(validateHit(claim, ctx).reason, 'range');
});

test('accepts a corner-to-corner shot on the 80 m FIELD map', () => {
  const { claim, ctx } = base(); claim.from = [-39, 1.6, -39]; claim.point = [39, 1.2, 39];
  assert.deepEqual(validateHit(claim, ctx), { ok: true });
});

test('rejects hits through walls', () => {
  const { claim, ctx } = base(); ctx.lineOfSight = () => false;
  assert.equal(validateHit(claim, ctx).reason, 'no-los');
});

test('rejects malformed claims', () => {
  const { claim, ctx } = base(); claim.point = ['x', 1, 2];
  assert.equal(validateHit(claim, ctx).reason, 'bad-claim');
  const c = base(); c.claim.part = 'toe';
  assert.equal(validateHit(c.claim, c.ctx).reason, 'bad-claim');
});
