import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNav, findPath, Bot, hitChance, BOT_LEVELS } from '../src/party/bots.js';
import { MAPS } from '../src/arena/layout.js';
import { insideXZ } from '../src/arena/shapes.js';

/** Is a body standing at (x, y, z) inside a piece? */
const inside = (layout, x, y, z) => layout.boxes.some((b) => !b.floor && !b.deco && !b.ramp && b.prop !== 'towerroof' && insideXZ(b, x, z, 0.05) && b.y - b.h / 2 < y + 1.5 && b.y + b.h / 2 > y + 0.3);

const navs = new Map();
const nav = (id) => navs.get(id) ?? navs.set(id, buildNav(MAPS[id].layout)).get(id);

test('every map: a path between the two spawns, never through a piece', () => {
  for (const id of Object.keys(MAPS)) {
    const L = MAPS[id].layout;
    const [a, b] = L.spawns;
    const p = findPath(nav(id), { ...a, y: 0 }, { ...b, y: 0 });
    assert.ok(p && p.length > 3, `${id}: no path spawn to spawn`);
    for (const w of p) assert.ok(!inside(L, w.x, w.y, w.z), `${id}: path through a piece at ${w.x},${w.y.toFixed(2)},${w.z}`);
  }
});

test('town: bots can climb to the tower top, the arcade gallery, the bridge and the terrace', () => {
  const g = nav('town');
  const from = { x: 29.5, y: 0, z: 0 };
  for (const [name, to] of Object.entries({
    house: { x: 21, y: 3.2, z: 7 },
    tower: { x: 24.5, y: 6.4, z: 18 },
    gallery: { x: 0, y: 3.2, z: 21 },
    bridge: { x: 22, y: 3.2, z: 0 },
    terrace: { x: 32, y: 3.2, z: -19 },
  })) {
    const p = findPath(g, from, to);
    assert.ok(p?.length, `${name}: no path`);
    const end = p.at(-1);
    assert.ok(Math.abs(end.y - to.y) < 0.3 && Math.hypot(end.x - to.x, end.z - to.z) < 1.6, `${name}: path ends at ${end.x},${end.y.toFixed(2)},${end.z}`);
    // the climb is gradual: no jump of more than a stair step between waypoints
    for (let i = 1; i < p.length; i++) assert.ok(Math.abs(p[i].y - p[i - 1].y) <= 0.66, `${name}: ${p[i - 1].y} -> ${p[i].y}`);
  }
});

test('a bot walks to a hidden enemy, then engages and fires once it sees them', () => {
  const g = nav('town');
  const bot = new Bot({ id: 3, grid: g, weapon: { id: 'rifle', damage: 33, cycleTime: 0.075 }, rng: () => 0.3 });
  bot.place(29.5, 0);
  const enemy = { id: 0, x: -29.5, y: 0, z: 0 };
  let seen = false;
  for (let i = 0; i < 600 && !seen; i++) {
    const r = bot.update(0.1, { enemies: [enemy], los: (a, b) => Math.hypot(a.x - b.x, a.z - b.z) < 12 });
    if (r.fire) { seen = true; assert.equal(r.fire.target, 0); }
    assert.ok(!inside(MAPS.town.layout, bot.x, bot.y, bot.z), `bot inside a piece at ${bot.x.toFixed(1)},${bot.y.toFixed(1)},${bot.z.toFixed(1)}`);
  }
  assert.ok(seen, `never got to shoot (at ${bot.x.toFixed(1)},${bot.z.toFixed(1)})`);
});

test('difficulty: harder bots react sooner and hit more', () => {
  const { easy, normal, hard } = BOT_LEVELS;
  assert.ok(easy.reaction > normal.reaction && normal.reaction > hard.reaction);
  assert.ok(hitChance(20, easy.aim) < hitChance(20, normal.aim) && hitChance(20, normal.aim) < hitChance(20, hard.aim));
  assert.ok(hitChance(5) > hitChance(20) && hitChance(20) > hitChance(40));
});
