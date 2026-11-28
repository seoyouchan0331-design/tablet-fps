import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Deathmatch, spawnCandidates, pickSpawn } from '../src/party/rules.js';
import { MAPS } from '../src/arena/layout.js';
import { insideXZ } from '../src/arena/shapes.js';

const live = (dm) => dm.tick(dm.countdown + 0.01);

test('ffa: countdown, then live; kills score; first to the limit wins', () => {
  const dm = new Deathmatch({ mode: 'ffa', scoreLimit: 2 });
  assert.equal(dm.start([{ id: 0 }, { id: 1 }, { id: 2 }])[0].type, 'countdown');
  assert.equal(dm.canHit(0, 1), false, 'no hits in the countdown');
  assert.equal(live(dm)[0].type, 'live');
  assert.equal(dm.canHit(0, 1), true);
  const k = dm.kill(0, 1);
  assert.equal(k[0].type, 'kill');
  assert.deepEqual(k[0].scores[0], [1, 0]);
  assert.deepEqual(k[0].scores[1], [0, 1]);
  assert.equal(dm.canHit(0, 1), false, 'the dead cannot be hit');
  assert.deepEqual(dm.kill(0, 1), [], 'no double kill');
  const end = dm.kill(0, 2);
  assert.equal(end.at(-1).type, 'end');
  assert.equal(end.at(-1).winner, 0);
  assert.equal(end.at(-1).standings[0].id, 0);
});

test('respawn after the delay, protected for a moment', () => {
  const dm = new Deathmatch({ respawn: 3, protect: 1.5 });
  dm.start([{ id: 0 }, { id: 1 }]);
  live(dm);
  dm.kill(0, 1);
  assert.deepEqual(dm.tick(2.9), []);
  assert.deepEqual(dm.tick(0.2), [{ type: 'respawn', id: 1 }]);
  assert.equal(dm.canHit(0, 1), false, 'spawn protection');
  dm.tick(1.6);
  assert.equal(dm.canHit(0, 1), true);
});

test('tdm: no friendly fire, team kills add up, time up ends it', () => {
  const dm = new Deathmatch({ mode: 'tdm', scoreLimit: 50, timeLimit: 10 });
  dm.start([{ id: 0, team: 0 }, { id: 1, team: 1 }, { id: 2, team: 0 }, { id: 3, team: 1 }]);
  live(dm);
  assert.equal(dm.canHit(0, 2), false, 'teammate');
  assert.equal(dm.canHit(0, 1), true);
  dm.kill(0, 1);
  dm.kill(2, 3);
  assert.deepEqual(dm.teamScores(), [2, 0]);
  const ev = dm.tick(10);
  assert.equal(ev.at(-1).type, 'end');
  assert.equal(ev.at(-1).winner, 0);
});

test('a late joiner respawns within a moment and can play', () => {
  const dm = new Deathmatch({ mode: 'ffa' });
  dm.start([{ id: 0 }, { id: 1 }]);
  live(dm);
  dm.add(2);
  assert.equal(dm.canHit(0, 2), false, 'not in yet');
  assert.deepEqual(dm.tick(0.6), [{ type: 'respawn', id: 2 }]);
  dm.tick(2);
  assert.equal(dm.canHit(0, 2), true);
  assert.deepEqual(dm.scores()[2], [0, 0]);
});

test('a match ends when players leave', () => {
  const dm = new Deathmatch({ mode: 'tdm' });
  dm.start([{ id: 0, team: 0 }, { id: 1, team: 1 }, { id: 2, team: 1 }]);
  live(dm);
  assert.deepEqual(dm.remove(2), []);
  assert.equal(dm.remove(1)[0].type, 'end', 'one team left');
});

test('spawn candidates are open ground on every map; spawns avoid enemies', () => {
  for (const [id, m] of Object.entries(MAPS)) {
    const c = spawnCandidates(m.layout, insideXZ);
    assert.ok(c.length >= 12, `${id}: ${c.length} spawn points`);
  }
  const c = spawnCandidates(MAPS.town.layout, insideXZ);
  const enemy = { x: 20, z: 0 };
  let near = Infinity;
  for (let i = 0; i < 20; i++) {
    const s = pickSpawn(c, [enemy]);
    near = Math.min(near, Math.hypot(s.x - enemy.x, s.z - enemy.z));
  }
  assert.ok(near > 30, `spawned ${near.toFixed(1)} m from the only enemy`);
  // team side
  for (let i = 0; i < 20; i++) assert.ok(pickSpawn(c, [], { side: -1 }).x < 0);
});
