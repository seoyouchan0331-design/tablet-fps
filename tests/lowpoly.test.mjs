import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildRifle } from '../src/weapons/models/rifle.js';
import { buildSmg } from '../src/weapons/models/smg.js';
import { buildPistol } from '../src/weapons/models/pistol.js';
import { lowpoly } from '../src/weapons/models/lowpoly.js';

const stats = (map) => {
  const b = new THREE.Box3(); let tris = 0; const keys = [];
  for (const [k, g] of map) { keys.push(k); g.computeBoundingBox(); b.union(g.boundingBox); tris += (g.index ? g.index.count : g.attributes.position.count) / 3; }
  return { b, tris, keys };
};

for (const [id, build] of [['rifle', buildRifle], ['smg', buildSmg], ['pistol', buildPistol]]) {
  test(`${id}: low-poly keeps the rig contract (nodes + moving parts)`, () => {
    const ref = build();
    const lp = lowpoly(id);
    assert.equal(lp.id, id);
    assert.deepEqual(Object.keys(lp.moving).sort(), Object.keys(ref.moving).sort());
    assert.deepEqual(JSON.stringify(lp.nodes), JSON.stringify(ref.nodes));
  });

  test(`${id}: low-poly body is cheap, uses lp_ materials, and spans the same length`, () => {
    const ref = stats(build().body.build());
    const lp = lowpoly(id);
    const s = stats(lp.body.build());
    assert.ok(s.tris < 3000, `${s.tris} tris`);
    assert.ok(s.tris > 300, `${s.tris} tris: too crude to read as a gun`);
    for (const k of s.keys) assert.ok(k.startsWith('lp_') || k === 'glass', k);
    assert.ok(Math.abs(s.b.min.z - ref.b.min.z) < 0.012, `muzzle ${s.b.min.z} vs ${ref.b.min.z}`);
    assert.ok(Math.abs(s.b.max.z - ref.b.max.z) < 0.03, `rear ${s.b.max.z} vs ${ref.b.max.z}`);
  });

  test(`${id}: low-poly moving parts fit inside their detailed bounds (+5 mm)`, () => {
    const ref = build();
    const lp = lowpoly(id);
    for (const k of Object.keys(ref.moving)) {
      const rb = stats(ref.moving[k].build()).b.expandByScalar(0.005);
      const lb = stats(lp.moving[k].build()).b;
      assert.ok(rb.containsBox(lb), `${k} out of bounds`);
    }
  });
}
