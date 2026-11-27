import test from 'node:test';
import assert from 'node:assert/strict';
import { insideXZ, topAt, mirrorPiece, windowWall, pieceGeometry, edgeGeometries } from '../src/arena/shapes.js';

const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

test('plain box: footprint and flat top', () => {
  const b = { x: 2, y: 1, z: 3, w: 2, h: 2, d: 4 };
  assert.ok(insideXZ(b, 2.9, 4.9));
  assert.ok(!insideXZ(b, 3.1, 3));
  assert.equal(topAt(b, 2, 3), 2);
  assert.equal(topAt(b, 9, 9), -Infinity);
});

test('turned box: a 45-degree crate covers its diagonal, not its old corners', () => {
  const b = { x: 0, y: 0.5, z: 0, w: 4, h: 1, d: 1, ry: Math.PI / 4 };
  // long axis now runs along x = -z (three turns +x toward -z)
  assert.ok(insideXZ(b, 1.3, -1.3));
  assert.ok(!insideXZ(b, 1.3, 1.3));
});

test('ramp rises toward its high side', () => {
  const r = { x: 0, y: 1, z: 0, w: 6, h: 2, d: 2, ramp: '+x' };
  assert.ok(near(topAt(r, -3, 0), 0));
  assert.ok(near(topAt(r, 0, 0), 1));
  assert.ok(near(topAt(r, 3, 0), 2));
  const z = { x: 0, y: 1, z: 0, w: 2, h: 2, d: 4, ramp: '-z' };
  assert.ok(near(topAt(z, 0, -2), 2) && near(topAt(z, 0, 2), 0));
});

test('mirror flips position and ramp direction, keeps turn', () => {
  const m = mirrorPiece({ x: 3, y: 1, z: -2, w: 1, h: 1, d: 1, ramp: '+x', ry: 0.3 });
  assert.deepEqual([m.x, m.z, m.ramp, m.ry], [-3, 2, '-x', 0.3]);
  // its height profile is the original turned 180 degrees
  const r = { x: 3, y: 1, z: -2, w: 4, h: 2, d: 2, ramp: '+x' };
  const t = mirrorPiece(r);
  assert.ok(near(topAt(r, 4.5, -2), topAt(t, -4.5, 2)));
});

test('window wall: four pieces leaving a hole between sill and top', () => {
  const p = windowWall({ axis: 'x', from: -3, to: 3, at: 5, h: 3, sill: 1, top: 2, gap: 2 });
  assert.equal(p.length, 4);
  // a point in the hole is inside no piece
  const inHole = p.filter((b) => insideXZ(b, 0, 5) && b.y - b.h / 2 < 1.5 && b.y + b.h / 2 > 1.5);
  assert.equal(inHole.length, 0);
  // the wall still spans -3..3
  assert.ok(p.some((b) => insideXZ(b, -2.9, 5)) && p.some((b) => insideXZ(b, 2.9, 5)));
});

test('geometry carries vertex colours and edges come out as bars', () => {
  const g = pieceGeometry({ x: 0, y: 1, z: 0, w: 2, h: 2, d: 2, c: 0xff0000 });
  assert.ok(g.attributes.color);
  assert.ok(near(g.attributes.color.getX(0), 1) && near(g.attributes.color.getY(0), 0));
  assert.equal(edgeGeometries({ x: 0, y: 1, z: 0, w: 2, h: 2, d: 2 }, 0.05).length, 12);
  const ramp = edgeGeometries({ x: 0, y: 1, z: 0, w: 4, h: 2, d: 2, ramp: '+x' }, 0.05);
  assert.ok(ramp.length >= 9 && ramp.length <= 10, `${ramp.length}`);
});

import { prop } from '../src/arena/shapes.js';
test('Blender props become pieces with their real size, and build geometry', () => {
  const a = prop('arch', 5, 0, Math.PI / 2);
  assert.ok(a.w > 6 && a.w < 6.5 && a.h > 4 && a.h < 4.5, JSON.stringify(a));
  assert.ok(near(a.y, a.h / 2));
  const g = pieceGeometry(a);
  g.computeBoundingBox();
  // turned 90 degrees: its 6 m length now runs along z
  assert.ok(g.boundingBox.max.z - g.boundingBox.min.z > 6);
  assert.ok(near(g.boundingBox.min.y, 0, 1e-3));
  assert.ok(edgeGeometries(prop('fountain', 0, 0), 0.05).length >= 1, 'modelled neon ring');
  assert.throws(() => prop('nope', 0, 0));
});

import { building, wallWithOpenings } from '../src/arena/shapes.js';
const solidAt = (pieces, x, y, z) => pieces.some((b) => !b.ramp && insideXZ(b, x, z) && y > b.y - b.h / 2 + 1e-6 && y < b.y + b.h / 2 - 1e-6);

test('wall with a door and a window: holes where asked, solid elsewhere', () => {
  const p = wallWithOpenings({ axis: 'x', from: -5, to: 5, at: 0, h: 3, t: 0.4, openings: [{ c: -2, w: 1.6, bottom: 0, top: 2.4 }, { c: 2.5, w: 1.4, bottom: 1, top: 2.1 }] });
  assert.ok(!solidAt(p, -2, 1.2, 0), 'door is open');
  assert.ok(solidAt(p, -2, 2.7, 0), 'lintel over the door');
  assert.ok(!solidAt(p, 2.5, 1.5, 0), 'window is open');
  assert.ok(solidAt(p, 2.5, 0.5, 0) && solidAt(p, 2.5, 2.5, 0), 'sill and head');
  assert.ok(solidAt(p, 0.5, 1.5, 0) && solidAt(p, -4.5, 1.5, 0), 'plain wall');
});

test('two-storey building: enter by the door, walk up the stairs to the upper floor', () => {
  const B = building({ x: 10, z: -10, w: 10, d: 8, doors: [{ side: '+z', at: -2 }], windows: [{ side: '+z', floor: 1, at: 2 }] });
  const fh = 3.2;
  // the door on the +z face (world z = -6) is open at head height
  assert.ok(!solidAt(B, 8, 1.6, -6), 'door');
  // the upper-floor window is open, the wall beside it is not
  assert.ok(!solidAt(B, 12, fh + 1.5, -6) && solidAt(B, 14.5, fh + 1.5, -6), 'window');
  // a ramp climbs to the upper slab
  const ramp = B.find((b) => b.ramp);
  assert.ok(ramp && Math.abs(ramp.y + ramp.h / 2 - fh) < 0.01, 'stairs reach the floor');
  // walking up the ramp you never hit the slab with your head: no slab over the ramp's lower part
  const lowX = ramp.x - (ramp.ramp === '+x' ? 1 : -1) * ramp.w * 0.25;
  assert.ok(!solidAt(B, lowX, fh - 0.1, ramp.z), 'stair hole in the slab');
  // head room all the way up the stairs: nothing solid 1.9 m above the ramp surface
  for (let k = 0.05; k < 0.95; k += 0.1) {
    const sx = ramp.x - ramp.w / 2 + ramp.w * k;
    const sy = topAt(ramp, sx, ramp.z) + 1.9;
    assert.ok(!B.some((b) => b !== ramp && !b.ramp && insideXZ(b, sx, ramp.z) && sy > b.y - b.h / 2 && b.y - b.h / 2 > topAt(ramp, sx, ramp.z) && b.y - b.h / 2 < sy - 0.01 + 0.01 && b.y - b.h / 2 < sy),
      `ceiling over the stairs at x=${sx.toFixed(2)}`);
  }
  // and the upper floor exists past the stairs
  assert.ok(solidAt(B, 14, fh - 0.1, -9), 'upper floor slab');
  // every piece stays inside the footprint (plus small trims)
  for (const b of B) assert.ok(Math.abs(b.x - 10) <= 5.4 && Math.abs(b.z + 10) <= 4.4, JSON.stringify(b));
});

test('stairs never block a door: they move to a wall without one', () => {
  // the case that shipped: a door in the -z wall, where the stairs used to go
  const B = building({ x: 0, z: 0, w: 9, d: 8, stair: '-x', doors: [{ side: '-z', at: 1.5 }] });
  const ramp = B.find((b) => b.ramp);
  // one step inside the door (world (1.5, -3.2)) the floor is flat ground, not stairs
  assert.ok(topAt(ramp, 1.5, -3.2) === -Infinity, 'stairs sit in front of the door');
  // doors on both long walls: the stairs pick the run that clears both
  const C = building({ x: 0, z: 0, w: 10, d: 8, doors: [{ side: '-z', at: -2.5 }, { side: '+z', at: 2.5 }] });
  const r = C.find((b) => b.ramp);
  for (const [dx, dz] of [[-2.5, -3.2], [2.5, 3.2]]) assert.ok(topAt(r, dx, dz) === -Infinity, `door at ${dx},${dz} blocked`);
  // a door on the short wall at the stairs' high end is not blocked either
  const D = building({ x: 0, z: 0, w: 10, d: 8, stair: '+x', doors: [{ side: '+x', at: -2.9 }] });
  const rd = D.find((b) => b.ramp);
  assert.ok(topAt(rd, 4.3, -2.9) === -Infinity || topAt(rd, 4.3, -2.9) < 0.3, 'high end blocks the side door');
});

import { stairFlight } from '../src/arena/shapes.js';
test('stair flight: drawn steps plus a hidden ramp that climbs the same way', () => {
  for (const dir of ['+z', '-z', '+x', '-x']) {
    const [steps, ramp] = stairFlight(10, 5, dir);
    assert.ok(steps.deco && steps.prop === 'stairs');
    assert.ok(ramp.hidden && ramp.ramp === dir);
    // foot of the flight at (10, 5): the ramp is at ground there, 3.2 m at the far end
    const v = { '+z': [0, 1], '-z': [0, -1], '+x': [1, 0], '-x': [-1, 0] }[dir];
    assert.ok(topAt(ramp, 10 + v[0] * 0.2, 5 + v[1] * 0.2) < 0.3, `${dir} foot`);
    assert.ok(topAt(ramp, 10 + v[0] * 5.4, 5 + v[1] * 5.4) > 2.9, `${dir} head`);
    // the drawn steps cover the same footprint
    assert.ok(Math.abs(steps.x - ramp.x) < 0.25 && Math.abs(steps.z - ramp.z) < 0.25, `${dir} steps off the ramp`);
  }
});

test('no slot between the floors: the outer wall is solid at every height', () => {
  for (const ornate of [false, true]) {
    const B = building({ x: 0, z: 0, w: 10, d: 8, ornate, doors: [{ side: '+z', at: -2.5 }], windows: [{ side: '+z', floor: 1, at: 2.5 }] });
    // a point on the +z wall away from every opening, from the floor to the roof
    for (let y = 0.05; y < 6.4; y += 0.1) { // samples between, not on, piece boundaries
      assert.ok(solidAt(B.filter((b) => !b.deco), 0.5, y, 3.82), `gap in the wall at ${y.toFixed(1)} m (ornate ${ornate})`);
    }
  }
});
