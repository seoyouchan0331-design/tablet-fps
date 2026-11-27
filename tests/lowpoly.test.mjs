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

// ADS looks down the sight axis: nothing on the gun may block it.
const sightClear = (id) => {
  const m = lowpoly(id);
  const meshes = [];
  const add = (asm, offset) => {
    for (const [k, g] of asm.build()) {
      if (k === 'lp_reticle') continue; // the reticle dot is meant to be seen
      const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      if (offset) mesh.position.fromArray(offset);
      mesh.updateMatrixWorld();
      meshes.push(mesh);
    }
  };
  add(m.body);
  if (m.moving.slide) add(m.moving.slide, m.nodes.slideRest.pos);
  const [sx, sy, sz] = m.nodes.sight;
  // A small bundle of rays (within 6 mm of the axis) from 20 cm behind the
  // sight point, straight down -Z for 50 cm. Exactly on-axis rays can slip
  // through the degenerate centre vertex of a lathe cap, so offset them.
  const hits = [];
  for (const [dx, dy] of [[0.002, 0.001], [-0.004, 0.003], [0.003, -0.004], [-0.001, -0.002], [0.005, 0.002]]) {
    const rc = new THREE.Raycaster(new THREE.Vector3(sx + dx, sy + dy, sz + 0.2), new THREE.Vector3(0, 0, -1), 0, 0.5);
    hits.push(...rc.intersectObjects(meshes, false));
  }
  return hits;
};

for (const id of ['rifle', 'smg', 'pistol']) {
  test(`${id}: the sight picture is not blocked (hollow optic)`, () => {
    const hits = sightClear(id);
    assert.equal(hits.length, 0, hits.map((h) => `${h.object.geometry.uuid.slice(0, 4)} @ z=${h.point.z.toFixed(3)}`).join(', '));
  });

  test(`${id}: has a reticle dot on the sight axis`, () => {
    const m = lowpoly(id);
    const part = m.moving.slide ?? m.body;
    assert.ok(part.build().has('lp_reticle'));
  });
}

for (const id of ['shotgun', 'sniper']) {
  test(`${id}: rides the rifle rig with its own muzzle`, () => {
    const ref = buildRifle();
    const lp = lowpoly(id);
    assert.equal(lp.id, id);
    assert.deepEqual(Object.keys(lp.moving).sort(), Object.keys(ref.moving).sort());
    assert.deepEqual(lp.nodes.sight, ref.nodes.sight);
    assert.deepEqual(lp.nodes.gripR, ref.nodes.gripR);
    const s = stats(lp.body.build());
    assert.ok(s.tris > 300 && s.tris < 3500, `${s.tris} tris`);
    for (const k of s.keys) assert.ok(k.startsWith('lp_'), k);
    assert.ok(Math.abs(s.b.min.z - lp.nodes.muzzle[2]) < 0.012, `muzzle node ${lp.nodes.muzzle[2]} vs body ${s.b.min.z}`);
  });
}
