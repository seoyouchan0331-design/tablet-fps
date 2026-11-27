/**
 * Third-person guns for the duel opponent: the same low-poly models the
 * player holds (weapons/models/lowpoly.js), merged into one mesh per material
 * so each gun is a handful of draw calls. Weapon-local frame: origin at the
 * web of the shooting hand, -Z toward the muzzle (same as the viewmodel).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lowpoly } from '../weapons/models/lowpoly.js';
import { LOWPOLY_PALETTE } from '../weapons/materials.js';

export const GUN_IDS = ['rifle', 'smg', 'shotgun', 'sniper', 'pistol'];

/** Where the hands go on each gun (weapon-local metres). */
export const HOLD = {
  rifle: { right: [0.0, -0.035, 0.06], left: [0.0, 0.045, -0.24], mag: [0.0, -0.06, -0.06] },
  smg: { right: [0.0, -0.035, 0.05], left: [0.0, 0.0, -0.21], mag: [0.0, -0.06, -0.03] },
  shotgun: { right: [0.0, -0.035, 0.06], left: [0.0, 0.045, -0.27], mag: [0.0, -0.06, -0.06] },
  sniper: { right: [0.0, -0.035, 0.06], left: [0.0, 0.05, -0.3], mag: [0.0, -0.06, -0.06] },
  pistol: { right: [0.0, -0.04, 0.03], left: [0.0, -0.045, 0.045], mag: [0.0, -0.08, 0.03] },
};

const _mats = new Map();
function mat(key) {
  if (!_mats.has(key)) {
    const p = LOWPOLY_PALETTE[key] ?? LOWPOLY_PALETTE.lp_body;
    const m = new THREE.MeshStandardMaterial({ color: p[0], roughness: p[1], metalness: p[2] });
    m.name = `tp_${key}`;
    _mats.set(key, m);
  }
  return _mats.get(key);
}

function place(geoMap, node, out) {
  const m4 = new THREE.Matrix4();
  if (node) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler().fromArray(node.rot ?? [0, 0, 0]));
    m4.compose(new THREE.Vector3().fromArray(node.pos), q, new THREE.Vector3(1, 1, 1));
  }
  for (const [k, g] of geoMap) {
    if (node) g.applyMatrix4(m4);
    // merge needs matching attribute sets: keep position/normal only
    for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal') g.deleteAttribute(a);
    const key = k.startsWith('lp_') ? k : 'lp_dark';
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(g.index ? g.toNonIndexed() : g);
  }
}

/** One gun as a THREE.Group (body + magazine + slide), shadows on. */
export function buildGun(id) {
  const m = lowpoly(id);
  const by = new Map();
  place(m.body.build(), null, by);
  const n = m.nodes;
  if (m.moving.magazine) place(m.moving.magazine.build(), n.magSeat, by);
  if (m.moving.slide) place(m.moving.slide.build(), n.slideRest, by);
  if (m.moving.bolt && n.boltRest) place(m.moving.bolt.build(), n.boltRest, by);
  const g = new THREE.Group();
  g.name = `tp-${id}`;
  for (const [key, list] of by) {
    const mesh = new THREE.Mesh(mergeGeometries(list, false), mat(key));
    mesh.castShadow = true;
    g.add(mesh);
    for (const x of list) x.dispose();
  }
  g.userData.muzzle = new THREE.Vector3().fromArray(n.muzzle);
  return g;
}
