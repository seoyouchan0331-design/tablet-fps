import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGrid, findPath, nearestOpen, Bot, hitChance } from '../src/party/bots.js';
import { MAPS } from '../src/arena/layout.js';
import { insideXZ } from '../src/arena/shapes.js';

const blocked = (layout, x, z) => layout.boxes.some((b) => !b.floor && !b.wall && !b.deco && b.y - b.h / 2 < 2.2 && insideXZ(b, x, z, 0.3));

test('every map has walkable ground and paths between the two spawns', () => {
  for (const [id, m] of Object.entries(MAPS)) {
    const g = buildGrid(m.layout);
    const [a, b] = m.layout.spawns;
    const p = findPath(g, a, b);
    assert.ok(p && p.length > 3, `${id}: no path spawn to spawn`);
    for (const w of p) assert.ok(!blocked(m.layout, w.x, w.z), `${id}: path through a piece at ${w.x},${w.z}`);
  }
});

test('a bot walks to a hidden enemy, then engages and fires once it sees them', () => {
  const L = MAPS.town.layout;
  const g = buildGrid(L);
  const bot = new Bot({ id: 3, grid: g, weapon: { id: 'rifle', damage: 33, cycleTime: 0.075 }, rng: () => 0.3 });
  const s = nearestOpen(g, 29.5, 0);
  bot.place(-g.hx + s.c, -g.hz + s.r);
  const enemy = { id: 0, x: -29.5, y: 0, z: 0 };
  let seen = false;
  const start = Math.hypot(enemy.x - bot.x, enemy.z - bot.z);
  for (let i = 0; i < 400; i++) {
    // sight only within 12 m (stands in for walls)
    const r = bot.update(0.1, { enemies: [enemy], los: (a, b) => Math.hypot(a.x - b.x, a.z - b.z) < 12 });
    if (r.fire) { seen = true; assert.equal(r.fire.target, 0); break; }
    assert.ok(!blocked(L, bot.x, bot.z), `bot walked into a piece at ${bot.x.toFixed(1)},${bot.z.toFixed(1)}`);
  }
  assert.ok(seen, `the bot never got to shoot (still ${Math.hypot(enemy.x - bot.x, enemy.z - bot.z).toFixed(1)} of ${start.toFixed(1)} m away)`);
});

test('hit chance falls with distance', () => {
  assert.ok(hitChance(5) > hitChance(20) && hitChance(20) > hitChance(40));
  assert.ok(hitChance(100) >= 0.12 && hitChance(1) <= 0.75);
});
