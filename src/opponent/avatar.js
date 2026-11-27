/**
 * The duel figure: a stylised neon mannequin with a clearly readable head.
 * Owns its two physics colliders (head sphere, body capsule) sized by HITBOX.
 * Used by the practice dummy now and by the networked opponent in Phase 2.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HITBOX } from './hitbox.js';

const BODY = 0x1d2329;
const GLOW = new THREE.Color(1.0, 0.35, 0.24).multiplyScalar(2.2); // team accent, HDR

export class Avatar {
  /**
   * @param {THREE.Scene} scene
   * @param {object} physics  the physics system (addCollider / removeCollider / LAYER)
   * @param {{ owner?: object, name?: string }} opts  owner is reported as the hit actor
   */
  constructor(scene, physics, opts = {}) {
    this.scene = scene;
    this.physics = physics;
    this.owner = opts.owner ?? this;
    this.alive = true;

    const body = [];
    const add = (g, x, y, z) => { g.translate(x, y, z); body.push(g); };
    add(new THREE.BoxGeometry(0.46, 0.62, 0.26), 0, 1.07, 0); // torso
    add(new THREE.BoxGeometry(0.17, 0.72, 0.2), -0.12, 0.38, 0); // legs
    add(new THREE.BoxGeometry(0.17, 0.72, 0.2), 0.12, 0.38, 0);
    add(new THREE.BoxGeometry(0.13, 0.56, 0.15), -0.32, 1.06, 0); // arms
    add(new THREE.BoxGeometry(0.13, 0.56, 0.15), 0.32, 1.06, 0);
    add(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 10), 0, 1.43, 0); // neck
    this.bodyMat = new THREE.MeshStandardMaterial({ color: BODY, roughness: 0.6, metalness: 0.1 });
    const bodyMesh = new THREE.Mesh(mergeGeometries(body), this.bodyMat);
    for (const g of body) g.dispose();

    // Head and a chest band glow so the target reads at range and in shade.
    this.glowMat = new THREE.MeshBasicMaterial({ color: GLOW, toneMapped: false });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), this.glowMat);
    head.position.y = HITBOX.head.y;
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.06, 0.28), this.glowMat);
    band.position.y = 1.2;

    this.root = new THREE.Group();
    this.root.name = opts.name ?? 'avatar';
    this.root.add(bodyMesh, head, band);
    scene.add(this.root);

    const L = physics.LAYER?.ACTOR;
    this.head = physics.addCollider({ shape: 'capsule', layer: L, surface: 'flesh', owner: this.owner, part: 'head', radius: HITBOX.head.radius, damageScale: 1 });
    this.body = physics.addCollider({ shape: 'capsule', layer: L, surface: 'flesh', owner: this.owner, part: 'body', radius: HITBOX.body.radius, damageScale: 1 });
    this.colliders = [this.head, this.body];
    this.position = new THREE.Vector3();
  }

  setPose(x, y, z, yaw) {
    this.position.set(x, y, z);
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    const hy = y + HITBOX.head.y;
    this.head.setSegment(x, hy, z, x, hy, z, HITBOX.head.radius);
    this.body.setSegment(x, y + HITBOX.body.y0, z, x, y + HITBOX.body.y1, z, HITBOX.body.radius);
  }

  setAlive(alive) {
    this.alive = alive;
    this.root.visible = alive;
    for (const c of this.colliders) c.enabled = alive;
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => o.geometry?.dispose());
    this.bodyMat.dispose();
    this.glowMat.dispose();
    for (const c of this.colliders) this.physics.removeCollider(c);
  }
}
