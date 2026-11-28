import test from 'node:test';
import assert from 'node:assert/strict';
import { ARENA, validateLayout } from '../src/arena/layout.js';

const near = (a, b) => Math.abs(a - b) < 1e-6;

test('layout is mirror-symmetric about the centre', () => {
  for (const b of ARENA.boxes) {
    const twin = ARENA.boxes.find((o) => near(o.x, -b.x) && near(o.z, -b.z) && near(o.y, b.y)
      && near(o.h, b.h) && ((near(o.w, b.w) && near(o.d, b.d))));
    assert.ok(twin, `no twin for box at ${b.x},${b.z}`);
  }
});

test('two spawns, far apart, facing each other', () => {
  assert.equal(ARENA.spawns.length, 2);
  const [a, b] = ARENA.spawns;
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 24);
  const dy = Math.abs(((a.yaw - b.yaw) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI));
  assert.ok(near(dy, Math.PI), `yaw diff ${dy}`);
});

test('boxes stay inside the arena', () => {
  const h = ARENA.size / 2;
  for (const b of ARENA.boxes) {
    assert.ok(Math.abs(b.x) + b.w / 2 <= h + 1e-6 && Math.abs(b.z) + b.d / 2 <= h + 1e-6, `box ${b.x},${b.z} out of bounds`);
  }
});

test('perimeter walls are at least 4 m tall', () => {
  const h = ARENA.size / 2;
  const walls = ARENA.boxes.filter((b) => b.wall);
  assert.equal(walls.length, 4);
  for (const w of walls) {
    assert.ok(w.y + w.h / 2 >= 4);
    assert.ok(near(Math.abs(w.x) + w.w / 2, h) || near(Math.abs(w.z) + w.d / 2, h));
  }
});

test('at least 3 distinct standable heights', () => {
  const tops = new Set(ARENA.boxes.filter((b) => !b.wall).map((b) => (b.y + b.h / 2).toFixed(2)));
  assert.ok(tops.size >= 3, [...tops].join(','));
});

test('validateLayout passes the shipped arena and catches a bad one', () => {
  assert.deepEqual(validateLayout(ARENA), []);
  const bad = { ...ARENA, spawns: [ARENA.spawns[0]] };
  assert.ok(validateLayout(bad).length > 0);
});

test('spawns are not inside a box', () => {
  for (const s of ARENA.spawns) {
    for (const b of ARENA.boxes) {
      if (b.floor) continue;
      const inside = Math.abs(s.x - b.x) < b.w / 2 && Math.abs(s.z - b.z) < b.d / 2 && s.y < b.y + b.h / 2 && s.y > b.y - b.h / 2;
      assert.ok(!inside, `spawn inside box ${b.x},${b.z}`);
    }
  }
});

// ---- every map --------------------------------------------------------------
import { MAPS, MAP_IDS } from '../src/arena/layout.js';

test('six maps, GRID first and identical to ARENA', () => {
  assert.deepEqual(MAP_IDS, ['grid', 'lanes', 'blocks', 'town', 'canal', 'field']);
  assert.equal(MAPS.grid.layout, ARENA);
});

for (const id of ['grid', 'lanes', 'blocks', 'field', 'town', 'canal']) {
  const L = MAPS[id].layout;
  test(`${id}: valid (symmetric, bounded, walls, spawns 24 m apart)`, () => {
    assert.deepEqual(validateLayout(L), []);
  });
  test(`${id}: spawn strafe lanes are clear (practice dummy moves +-5 m)`, () => {
    for (const s of L.spawns) {
      for (let x = s.x - 5; x <= s.x + 5; x += 0.5) {
        for (const b of L.boxes) {
          if (b.floor || b.wall) continue;
          const inside = insideXZ(b, x, s.z, 0.4);
          assert.ok(!inside, `${id}: box at ${b.x},${b.z} blocks the spawn lane at x=${x}`);
        }
      }
    }
  });
}

test('lanes: a long open sight line down the middle', () => {
  const L = MAPS.lanes.layout;
  // a standing eye line (1.6 m) from spawn to spawn along x = 0.8 is not blocked by anything taller than 1.6
  const blocked = L.boxes.filter((b) => !b.floor && !b.wall && b.y + b.h / 2 > 1.6 && Math.abs(0.8 - b.x) < b.w / 2);
  assert.deepEqual(blocked.map((b) => [b.x, b.z]), []);
});

test('blocks: denser than lanes', () => {
  const n = (id) => MAPS[id].layout.boxes.filter((b) => !b.floor && !b.wall).length;
  assert.ok(n('blocks') > n('lanes'));
});

test('field: a huge map, spawns far apart, longer rounds, climbable tower', () => {
  const F = MAPS.field;
  assert.ok(F.layout.size >= 80, `size ${F.layout.size}`);
  const [a, b] = F.layout.spawns;
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 60);
  assert.ok(F.roundTime >= 45, 'room to find each other');
  // every raised box near the tower can be climbed in steps of at most 0.6 m from the floor
  const tops = F.layout.boxes.filter((o) => !o.floor && !o.wall && Math.abs(o.z) < 2.5 && o.x > 0).map((o) => +(o.y + o.h / 2).toFixed(2)).sort((x, y) => x - y);
  let h = 0;
  for (const t of tops) { if (t > 3.01) break; assert.ok(t - h <= 0.61, `step ${h} -> ${t}`); h = t; }
});

test('maps say their own round time (default 30 s)', () => {
  for (const id of MAP_IDS) assert.ok(Number.isFinite(MAPS[id].roundTime ?? 30));
});

import { topAt, insideXZ } from '../src/arena/shapes.js';
test('town: long map with walk-in two-storey houses, Blender props, a ramp to climb', () => {
  const L = MAPS.town.layout;
  assert.ok(L.size > (L.depth ?? L.size), 'longer than deep');
  assert.ok(!L.boxes.some((b) => b.c != null), 'grey-box style: no painted pieces');
  assert.ok(L.boxes.filter((b) => b.ramp).length >= 4, 'stairs in the houses');
  assert.ok(['archbay', 'fountain', 'towerroof', 'balustrade', 'pier'].every((n) => L.boxes.some((b) => b.prop === n)), 'arcade, fountain, tower');
  const stair = L.boxes.find((b) => b.ramp);
  assert.ok(stair.y + stair.h / 2 >= 3, 'stairs reach the upper floor');
  assert.ok(['cratestack', 'stall', 'coverwall', 'planter'].every((n) => L.boxes.some((b) => b.prop === n)), 'modelled plaza cover');
});

/** Solid (collides) pieces whose box holds the point. */
const solidsAt = (L, x, y, z, skip) => L.boxes.filter((b) => b !== skip && !b.deco && !b.floor && insideXZ(b, x, z) && y > b.y - b.h / 2 + 0.02 && y < (b.ramp ? topAt(b, x, z) : b.y + b.h / 2) - 0.02);

test('town: every flight of stairs has headroom (nothing over its walking line)', () => {
  const L = MAPS.town.layout;
  for (const r of L.boxes.filter((b) => b.ramp)) {
    for (const k of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      // a point k along the ramp, on its centre line
      const ax = r.ramp[1] === 'x', s = r.ramp[0] === '+' ? 1 : -1;
      const x = ax ? r.x + s * (k - 0.5) * r.w : r.x, z = ax ? r.z : r.z + s * (k - 0.5) * r.d;
      const y = topAt(r, x, z);
      for (const h of [0.3, 1.0, 1.75]) {
        // (the tower roof's box spans the tower; only its corner posts are solid)
        const hit = solidsAt(L, x, y + h, z, r).filter((b) => !b.ramp && b.prop !== 'towerroof');
        assert.deepEqual(hit.map((b) => b.prop ?? `${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)}`), [], `ramp at ${r.x.toFixed(1)},${r.z.toFixed(1)} k=${k} h=${h}`);
      }
    }
  }
});

test('town: the tower climbs 0 -> 1.6 -> 3.2 -> 4.8 -> 6.4 and its platform has a parapet', () => {
  const L = MAPS.town.layout;
  const inTower = (b) => b.x > 21.5 && b.x < 27.5 && b.z > 15.5 && b.z < 21.5;
  const ramps = L.boxes.filter((b) => b.ramp && inTower(b)).map((b) => [b.y - b.h / 2, b.y + b.h / 2]);
  assert.deepEqual(ramps.map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)]).sort((p, q) => p[0] - q[0]), [[0, 1.6], [1.6, 3.2], [3.2, 4.8], [4.8, 6.4]]);
  // standing on the platform by the parapet, a crouched player (1 m) is covered on each face
  for (const [x, z] of [[24.5, 15.6], [24.5, 21.4], [21.6, 18.5], [27.4, 18.5]]) {
    assert.ok(solidsAt(L, x, 6.4 + 0.5, z).length > 0, `parapet at ${x},${z}`);
  }
});

test('town: the arcade gallery and the bridge each have two ways off', () => {
  const L = MAPS.town.layout;
  // gallery (y 3.2, x -9..9, z ~21): the stair head at +x, the house door at -x
  const stairHead = L.boxes.find((b) => b.ramp === '-x' && Math.abs(b.x - 11.8) < 0.1 && b.z > 21);
  assert.ok(stairHead && Math.abs(stairHead.y + stairHead.h / 2 - 3.2) < 1e-6, 'gallery stair');
  assert.equal(solidsAt(L, -9.1, 3.2 + 1.0, 21.3).length, 0, 'upper door from the gallery into the house');
  // bridge ends: open doors into both gateway houses at the upper floor
  assert.equal(solidsAt(L, 22, 3.2 + 1.0, 4.2).length, 0, 'north house door');
  assert.equal(solidsAt(L, 22, 3.2 + 1.0, -4.2).length, 0, 'south house door');
  // and the passage under it is open
  assert.equal(solidsAt(L, 22, 1.0, 0).length, 0, 'passage under the bridge');
});

import { buildNav, findPath, spawnPoints } from '../src/party/bots.js';
test('canal: quays at 0 m, the canal floor at -3.2 m; every crossing and stair is walkable', () => {
  const L = MAPS.canal.layout;
  const g = buildNav(L);
  const at = (x, y, z) => findPath(g, { x: 27, y: 0, z: 0 }, { x, y, z });
  for (const [name, to] of Object.entries({
    'plaza bridge': { x: 0, y: 0, z: 0 },
    'canal under the bridge': { x: 0, y: -3.2, z: 0 },
    'canal past a lock gate': { x: 0, y: -3.2, z: 20 },
    footbridge: { x: 0, y: 0, z: 23 },
    'far quay': { x: -27, y: 0, z: 0 },
    'tower top': { x: 25.5, y: 6.4, z: 24 },
    'tunnel under the quay': { x: 15.5, y: -3.2, z: -26 },
    'tunnel exit in the back street': { x: 29.5, y: 0, z: -26 },
  })) {
    const p = at(to.x, to.y, to.z);
    assert.ok(p?.length, `${name}: no path`);
    const e = p.at(-1);
    assert.ok(Math.abs(e.y - to.y) < 0.35 && Math.hypot(e.x - to.x, e.z - to.z) < 1.6, `${name}: ends at ${e.x},${e.y.toFixed(2)},${e.z}`);
  }
  // spawns happen on both levels
  const pts = spawnPoints(g);
  assert.ok(pts.some((p) => p.y === 0) && pts.some((p) => p.y === -3.2), 'spawn points on the quays and in the canal');
});

test('canal: the tunnel is the way from the canal into the back street (spawn side)', () => {
  const g = buildNav(MAPS.canal.layout);
  const p = findPath(g, { x: 0, y: -3.2, z: -20 }, { x: 29.5, y: 0, z: -26 });
  assert.ok(p?.length, 'no path');
  assert.ok(p.some((w) => w.x > 10 && w.y < -3), 'the path goes through the tunnel');
});
