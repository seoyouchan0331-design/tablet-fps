import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { solveElbow, aimBone } from '../src/opponent/armik.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test('elbow keeps both bone lengths when the target is in reach', () => {
  const s = { x: 0, y: 1.4, z: 0 }, t = { x: 0.1, y: 1.2, z: -0.4 };
  const e = solveElbow(s, t, 0.3, 0.28, { x: 0, y: -1, z: 0 });
  assert.ok(Math.abs(dist(s, e) - 0.3) < 1e-6);
  assert.ok(Math.abs(dist(e, t) - 0.28) < 1e-6);
});

test('elbow bends toward the pole', () => {
  const s = { x: 0, y: 1.4, z: 0 }, t = { x: 0, y: 1.4, z: -0.4 };
  const down = solveElbow(s, t, 0.3, 0.3, { x: 0, y: -1, z: 0 });
  const out = solveElbow(s, t, 0.3, 0.3, { x: 1, y: 0, z: 0 });
  assert.ok(down.y < 1.4 - 0.05);
  assert.ok(out.x > 0.05);
});

test('out of reach: arm points straight at the target', () => {
  const s = { x: 0, y: 0, z: 0 }, t = { x: 0, y: 0, z: -2 };
  const e = solveElbow(s, t, 0.3, 0.3, { x: 0, y: -1, z: 0 });
  assert.ok(Math.abs(e.z + 0.3) < 1e-3 && Math.abs(e.y) < 0.01);
});

test('aimBone turns a bone so its child points at the target, whatever the rest axes', () => {
  const root = new THREE.Object3D();
  root.rotation.set(0.3, -1.1, 0.7); // arbitrary authoring frame
  const bone = new THREE.Object3D();
  bone.position.set(0.2, 0.1, 0);
  bone.rotation.set(-0.4, 0.2, 1.3);
  const child = new THREE.Object3D();
  child.position.set(0, 0.5, 0);
  root.add(bone); bone.add(child);
  root.updateMatrixWorld(true);
  const target = new THREE.Vector3(1, 2, -3);
  aimBone(bone, child, target);
  const bp = bone.getWorldPosition(new THREE.Vector3());
  const cp = child.getWorldPosition(new THREE.Vector3());
  const want = target.clone().sub(bp).normalize();
  const got = cp.sub(bp).normalize();
  assert.ok(want.dot(got) > 0.99999, `${want.dot(got)}`);
});
