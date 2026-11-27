import test from 'node:test';
import assert from 'node:assert/strict';
import { pelletOffsets } from '../src/weapons/pellets.js';
import { WEAPON_DEFS } from '../src/weapons/defs.js';
import { HitLedger } from '../src/match/validate.js';
import { applyDamage, MAX_HP } from '../src/opponent/hitbox.js';

const rng = (seed = 1) => ({ float: () => ((seed = (seed * 16807) % 2147483647) / 2147483647) });

test('pelletOffsets returns n offsets inside the unit cone', () => {
  const o = pelletOffsets(8, rng());
  assert.equal(o.length, 8);
  for (const p of o) assert.ok(Math.hypot(p.x, p.y) <= 1.0001, JSON.stringify(p));
});

test('pellets cover the cone instead of bunching', () => {
  const o = pelletOffsets(8, rng(7));
  const outer = o.filter((p) => Math.hypot(p.x, p.y) > 0.5).length;
  assert.ok(outer >= 3, `only ${outer} pellets in the outer half`);
  let minD = Infinity;
  for (let i = 0; i < o.length; i++) for (let j = i + 1; j < o.length; j++) minD = Math.min(minD, Math.hypot(o[i].x - o[j].x, o[i].y - o[j].y));
  assert.ok(minD > 0.12, `pellets ${minD.toFixed(3)} apart`);
});

test('shotgun kills up close with most pellets, not with one', () => {
  const s = WEAPON_DEFS.shotgun;
  assert.ok(s.pellets >= 6);
  assert.ok(s.damage * s.pellets >= MAX_HP, 'all pellets body = kill');
  assert.ok(s.damage * 2 < MAX_HP / 2, 'a stray pellet is a scratch');
});

test('sniper: headshot kills, body shot does not', () => {
  const s = WEAPON_DEFS.sniper;
  assert.equal(applyDamage(MAX_HP, s.damage, 'head').killed, true);
  assert.equal(applyDamage(MAX_HP, s.damage, 'body').killed, false);
  assert.ok(s.scopeFov < 0.4, 'sniper zooms far more than the rifle');
  assert.ok(60 / s.rpm >= 1, 'bolt action: at most one shot a second');
});

test('HitLedger allows one hit per shot, or one per pellet', () => {
  const l = new HitLedger();
  assert.equal(l.take('host', 1, 1), true);
  assert.equal(l.take('host', 1, 1), false);
  for (let i = 0; i < 8; i++) assert.equal(l.take('guest', 5, 8), true);
  assert.equal(l.take('guest', 5, 8), false);
  l.clear();
  assert.equal(l.take('host', 1, 1), true);
});

test('sniper kicks hard: one heavy shot', () => {
  const s = WEAPON_DEFS.sniper, r = WEAPON_DEFS.rifle;
  assert.ok(s.recoil.pitch >= r.recoil.pitch * 10, 'camera climb per shot');
  assert.ok(s.recoil.punch >= 1, 'camera pushed back');
  assert.ok(s.recoil.weight >= 2, 'slow, heavy return');
  assert.ok(s.shake > 0.2, 'screen shake');
});
