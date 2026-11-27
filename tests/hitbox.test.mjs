import test from 'node:test';
import assert from 'node:assert/strict';
import { HITBOX, HITBOX_BASE, applyDamage } from '../src/opponent/hitbox.js';

test('hitbox radii are the base values scaled by 1.15', () => {
  assert.equal(HITBOX.scale, 1.15);
  assert.ok(Math.abs(HITBOX.head.radius - HITBOX_BASE.head.radius * 1.15) < 1e-9);
  assert.ok(Math.abs(HITBOX.body.radius - HITBOX_BASE.body.radius * 1.15) < 1e-9);
});

test('head sits above the body capsule', () => {
  assert.ok(HITBOX.head.y - HITBOX.head.radius >= HITBOX.body.y1 - 0.05);
});

test('body hit subtracts base damage', () => {
  assert.deepEqual(applyDamage(100, 33, 'body'), { hp: 67, killed: false, amount: 33 });
});

test('headshot doubles damage', () => {
  assert.deepEqual(applyDamage(100, 33, 'head'), { hp: 34, killed: false, amount: 66 });
});

test('killing blow floors at 0 and reports killed once', () => {
  const r = applyDamage(20, 33, 'body');
  assert.equal(r.hp, 0);
  assert.equal(r.killed, true);
  assert.equal(r.amount, 20);
  const again = applyDamage(0, 33, 'body');
  assert.equal(again.killed, false, 'already dead: no second kill');
  assert.equal(again.amount, 0);
});

import { hitboxAt } from '../src/opponent/hitbox.js';

test('crouched hitboxes are lower; k interpolates between standing and crouched', () => {
  const stand = hitboxAt(0);
  const crouch = hitboxAt(1);
  assert.equal(stand.headY, HITBOX.head.y);
  assert.equal(stand.bodyY1, HITBOX.body.y1);
  assert.ok(crouch.headY < 1.15 && crouch.headY > 0.9, String(crouch.headY));
  assert.ok(crouch.bodyY1 < stand.bodyY1);
  assert.ok(crouch.headY - HITBOX.head.radius >= crouch.bodyY1 - 0.05, 'head still above the body');
  const half = hitboxAt(0.5);
  assert.ok(half.headY < stand.headY && half.headY > crouch.headY);
});
