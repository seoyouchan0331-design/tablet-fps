/**
 * Two-bone arm IK for the opponent robot, written against WORLD positions so
 * it works whatever axes the model's bones were authored in.
 *
 *   solveElbow   where the elbow goes for a shoulder, a hand target, the two
 *                bone lengths and a pole (the direction the elbow should bend
 *                toward). Pure maths on {x,y,z} — unit tested.
 *   aimBone      rotate a bone so the direction to one of its descendants
 *                (child joint) points at a world target.
 */
import * as THREE from 'three';

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a) => Math.hypot(a.x, a.y, a.z);
const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

/**
 * @param {{x,y,z}} s shoulder   @param {{x,y,z}} t hand target
 * @param {number} a upper-arm length   @param {number} b forearm length
 * @param {{x,y,z}} pole direction the elbow bends toward (need not be unit)
 * @returns {{x,y,z}} elbow position. Out of reach: the arm points straight at t.
 */
export function solveElbow(s, t, a, b, pole) {
  const st = sub(t, s);
  let d = len(st);
  if (d < 1e-6) return add(s, scale(pole, a / (len(pole) || 1)));
  const u = scale(st, 1 / d);
  d = Math.min(d, (a + b) * 0.9999);
  d = Math.max(d, Math.abs(a - b) + 1e-4);
  // distance along u to the elbow's foot, and the elbow's height off the line
  const x = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  // pole direction made perpendicular to the shoulder->target line
  let p = sub(pole, scale(u, dot(pole, u)));
  let pl = len(p);
  if (pl < 1e-6) {
    p = Math.abs(u.y) < 0.9 ? { x: 0, y: -1, z: 0 } : { x: 1, y: 0, z: 0 };
    p = sub(p, scale(u, dot(p, u)));
    pl = len(p);
  }
  p = scale(p, 1 / pl);
  return add(add(s, scale(u, x)), scale(p, h));
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _wq = new THREE.Quaternion();

/**
 * Turn `bone` (in world space) so that `joint` — a descendant — lies on the
 * line from the bone to `target`. Matrices must be current; this updates the
 * bone's subtree afterwards.
 */
export function aimBone(bone, joint, target) {
  bone.getWorldPosition(_a);
  joint.getWorldPosition(_b);
  const from = _b.sub(_a);
  const to = _a.clone().negate().add(target);
  if (from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12) return;
  _q.setFromUnitVectors(from.normalize(), to.normalize());
  bone.getWorldQuaternion(_wq);
  _wq.premultiply(_q); // desired world rotation
  if (bone.parent) bone.parent.getWorldQuaternion(_pq);
  else _pq.identity();
  bone.quaternion.copy(_pq.invert().multiply(_wq));
  bone.updateMatrixWorld(true);
}
