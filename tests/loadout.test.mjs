import test from 'node:test';
import assert from 'node:assert/strict';
import { Loadout } from '../src/weapons/loadout.js';

test('default loadout is rifle + pistol', () => {
  assert.deepEqual(new Loadout().ids(), ['rifle', 'pistol']);
});

test('smg primary', () => {
  assert.deepEqual(new Loadout('smg').ids(), ['smg', 'pistol']);
});

test('invalid primary throws', () => {
  assert.throws(() => new Loadout('pistol'));
  assert.throws(() => new Loadout('rocket'));
});

test('other() swaps between the two chosen weapons only', () => {
  const l = new Loadout('smg');
  assert.equal(l.other('smg'), 'pistol');
  assert.equal(l.other('pistol'), 'smg');
  assert.equal(l.other('rifle'), 'smg', 'a weapon outside the loadout swaps to the primary');
});

test('PRIMARIES lists the two choices', () => {
  assert.deepEqual(Loadout.PRIMARIES, ['rifle', 'smg']);
});
