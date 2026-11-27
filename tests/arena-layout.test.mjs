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

test('three maps, GRID first and identical to ARENA', () => {
  assert.deepEqual(MAP_IDS, ['grid', 'lanes', 'blocks']);
  assert.equal(MAPS.grid.layout, ARENA);
});

for (const id of ['grid', 'lanes', 'blocks']) {
  const L = MAPS[id].layout;
  test(`${id}: valid (symmetric, bounded, walls, spawns 24 m apart)`, () => {
    assert.deepEqual(validateLayout(L), []);
  });
  test(`${id}: spawn strafe lanes are clear (practice dummy moves +-5 m)`, () => {
    for (const s of L.spawns) {
      for (let x = -5; x <= 5; x += 0.5) {
        for (const b of L.boxes) {
          if (b.floor || b.wall) continue;
          const inside = Math.abs(x - b.x) < b.w / 2 + 0.4 && Math.abs(s.z - b.z) < b.d / 2 + 0.4;
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
