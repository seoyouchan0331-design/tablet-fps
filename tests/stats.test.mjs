import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelFor, xpForLevel, summary } from '../src/stats/index.js';

test('levels climb with XP, each a little further than the last', () => {
  assert.equal(levelFor(0), 1);
  assert.equal(levelFor(299), 1);
  assert.equal(levelFor(300), 2);
  for (let lv = 2; lv < 30; lv++) {
    assert.equal(levelFor(xpForLevel(lv)), lv);
    assert.equal(levelFor(xpForLevel(lv) - 1), lv - 1);
    assert.ok(xpForLevel(lv + 1) - xpForLevel(lv) > xpForLevel(lv) - xpForLevel(lv - 1));
  }
});

test('summary: K/D, headshot % and win rate', () => {
  const s = summary({ kills: 30, deaths: 20, headshots: 6, matches: 4, wins: 1, xp: 5000 });
  assert.equal(s.kd, 1.5);
  assert.equal(s.hs, 20);
  assert.equal(s.winRate, 25);
  assert.equal(s.level, levelFor(5000));
  assert.equal(summary({ kills: 3, deaths: 0, headshots: 0, matches: 0, wins: 0, xp: 0 }).kd, 3, 'no deaths: K/D is the kills');
});
