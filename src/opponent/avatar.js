/**
 * The duel figure. With the character model loaded (public/models/robot.glb,
 * RobotExpressive by Quaternius, CC0) it is an animated robot — idle / walk /
 * run / jump / death driven by gait.js from its ground speed. Without the
 * model (load failed, unit tests) it falls back to a neon box mannequin.
 *
 * Either way it owns the two physics colliders (head sphere, body capsule)
 * sized by HITBOX; the robot is scaled so its head centre sits on the head
 * hitbox.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HITBOX, HITBOX_CROUCH, hitboxAt } from './hitbox.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { pickClip } from './gait.js';

const MODEL_URL = 'models/robot.glb';
/** Robot head centre is ~3.52 model units up; put it on the head hitbox. */
const ROBOT_SCALE = HITBOX.head.y / 3.52;
const ACCENT = 0xff5a36;
/** Crouch squashes the figure so its head lands on the crouched head hitbox. */
const CROUCH_SQUASH = HITBOX_CROUCH.headY / HITBOX.head.y;
const FADE = 0.15; // s crossfade between clips
const CORPSE_S = 2.5; // how long the death pose stays visible

let _modelPromise = null;

/** Load (once) and return the character glTF, or null if it can't be loaded. */
export function loadCharacterModel() {
  if (!_modelPromise) {
    _modelPromise = (async () => {
      try {
        // Static import on purpose: a dynamic import() here would load a chunk
        // that depends on the entry module, which is still evaluating (main.js
        // top-level-awaits engine.init) — the import never settles and boot hangs.
        const base = (import.meta.env && import.meta.env.BASE_URL) || './';
        return await new GLTFLoader().loadAsync(base + MODEL_URL);
      } catch (err) {
        console.warn('[avatar] character model unavailable, using mannequin:', err?.message ?? err);
        return null;
      }
    })();
  }
  return _modelPromise;
}

const BODY = 0x1d2329;
const GLOW = new THREE.Color(1.0, 0.35, 0.24).multiplyScalar(2.2); // team accent, HDR

export class Avatar {
  /**
   * @param {THREE.Scene} scene
   * @param {object} physics  the physics system (addCollider / removeCollider / LAYER)
   * @param {{ owner?: object, name?: string, lite?: boolean, model?: object|null, clone?: Function }} opts
   *   owner is reported as the hit actor; lite = no HDR glow; model = glTF from
   *   loadCharacterModel() with `clone` = SkeletonUtils.clone
   */
  constructor(scene, physics, opts = {}) {
    this.scene = scene;
    this.physics = physics;
    this.owner = opts.owner ?? this;
    this.alive = true;
    this.root = new THREE.Group();
    this.root.name = opts.name ?? 'avatar';
    this.position = new THREE.Vector3();
    this._prev = new THREE.Vector3();
    this._speed = 0;
    this._air = false;
    this._corpseT = 0;
    this._crouch = 0; // 0 standing .. 1 crouched (smoothed)
    this._crouchTarget = 0;
    this.headY = HITBOX.head.y;
    this.bodyNode = null; // set by the builders: the node squashed when crouching
    this.mixer = null;
    this.actions = null;
    this.clip = null;
    this._owned = [];

    if (opts.model && opts.clone) this._buildRobot(opts.model, opts.clone);
    else this._buildMannequin(opts);
    scene.add(this.root);

    const L = physics.LAYER?.ACTOR;
    this.head = physics.addCollider({ shape: 'capsule', layer: L, surface: 'flesh', owner: this.owner, part: 'head', radius: HITBOX.head.radius, damageScale: 1 });
    this.body = physics.addCollider({ shape: 'capsule', layer: L, surface: 'flesh', owner: this.owner, part: 'body', radius: HITBOX.body.radius, damageScale: 1 });
    this.colliders = [this.head, this.body];
  }

  _buildRobot(gltf, clone) {
    const model = clone(gltf.scene);
    model.scale.setScalar(ROBOT_SCALE);
    model.rotation.y = Math.PI; // the robot faces +Z; our yaw 0 faces -Z
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.frustumCulled = false; // skinned bounds don't follow the animation
      const m = o.material.clone();
      if (m.name === 'Main') m.color.setHex(ACCENT);
      o.material = m;
      this._owned.push(m);
    });
    this.root.add(model);
    this.bodyNode = model;
    this._baseScaleY = model.scale.y;
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const clip of gltf.animations) {
      const a = this.mixer.clipAction(clip);
      if (clip.name === 'Death' || clip.name === 'Jump') {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.actions[clip.name] = a;
    }
    this._play('Idle', 1);
  }

  _buildMannequin(opts) {
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
    bodyMesh.castShadow = true;
    for (const g of body) g.dispose();

    // Head and a chest band glow so the target reads at range and in shade.
    const glow = opts.lite ? new THREE.Color(1.0, 0.32, 0.18) : GLOW;
    this.glowMat = new THREE.MeshBasicMaterial({ color: glow, toneMapped: false });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), this.glowMat);
    head.position.y = HITBOX.head.y;
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.06, 0.28), this.glowMat);
    band.position.y = 1.2;

    const fig = new THREE.Group();
    fig.add(bodyMesh, head, band);
    this.root.add(fig);
    this.bodyNode = fig;
    this._baseScaleY = 1;
    this._owned.push(this.bodyMat, this.glowMat);
  }

  _play(name, timeScale) {
    const next = this.actions?.[name];
    if (!next) return;
    next.timeScale = timeScale;
    if (this.clip === name) return;
    const prev = this.actions[this.clip];
    next.reset().play();
    if (prev) next.crossFadeFrom(prev, FADE, false);
    this.clip = name;
  }

  /** Crouched flag from the network: lowers the figure and its hitboxes. */
  setCrouch(on) {
    this._crouchTarget = on ? 1 : 0;
  }

  /** Airborne flag from the network / dummy (drives the Jump clip). */
  setAir(air) {
    this._air = !!air;
  }

  /** Advance animation; ground speed is measured from setPose() motion. */
  tick(dt) {
    if (dt <= 0) return;
    const dx = this.position.x - this._prev.x;
    const dz = this.position.z - this._prev.z;
    this._prev.copy(this.position);
    const inst = Math.hypot(dx, dz) / dt;
    this._speed += (Math.min(inst, 20) - this._speed) * Math.min(1, dt * 10);
    this._crouch += (this._crouchTarget - this._crouch) * Math.min(1, dt * 12);
    if (this.bodyNode) this.bodyNode.scale.y = this._baseScaleY * (1 + (CROUCH_SQUASH - 1) * this._crouch);
    if (!this.alive) {
      this._corpseT -= dt;
      if (this._corpseT <= 0) this.root.visible = false;
    }
    if (!this.mixer) return;
    const pick = pickClip({ speed: this._speed, air: this._air, alive: this.alive }, this.clip);
    this._play(pick.clip, pick.timeScale);
    this.mixer.update(dt);
  }

  setPose(x, y, z, yaw) {
    this.position.set(x, y, z);
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    const hb = hitboxAt(this._crouch);
    this.headY = hb.headY;
    const hy = y + hb.headY;
    this.head.setSegment(x, hy, z, x, hy, z, HITBOX.head.radius);
    this.body.setSegment(x, y + hb.bodyY0, z, x, y + hb.bodyY1, z, HITBOX.body.radius);
  }

  setAlive(alive) {
    const was = this.alive;
    this.alive = alive;
    for (const c of this.colliders) c.enabled = alive;
    if (alive) {
      this.root.visible = true;
      if (!was) this._prev.copy(this.position);
    } else if (was && this.mixer) {
      this._corpseT = CORPSE_S; // play the death pose, then hide (tick)
    } else {
      this.root.visible = false;
    }
  }

  /** Hide immediately (menus, between matches) without a death pose. */
  hide() {
    this.alive = false;
    this.root.visible = false;
    for (const c of this.colliders) c.enabled = false;
  }

  dispose() {
    this.scene.remove(this.root);
    this.mixer?.stopAllAction();
    if (!this.mixer) this.root.traverse((o) => o.geometry?.dispose());
    for (const m of this._owned) m.dispose();
    for (const c of this.colliders) this.physics.removeCollider(c);
  }
}
