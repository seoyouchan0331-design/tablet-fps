/**
 * The duel figure. With the character model loaded (public/models/robot.glb,
 * RobotExpressive by Quaternius, CC0) it is an animated robot — idle / walk /
 * run / jump / death driven by gait.js from its ground speed. Without the
 * model (load failed, unit tests) it falls back to a neon box mannequin.
 *
 * It carries the opponent's actual gun (gun.js) in both hands. The arms are
 * posed by two-bone IK on top of the walk/run clips (legs and torso keep the
 * clip), so the gun follows where they aim (pitch), kicks when they fire,
 * drops to a low carry when they sprint, tilts for a reload and dips out and
 * back in on a weapon swap.
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
import { buildGun, GUN_IDS, HOLD } from './gun.js';
import { solveElbow, aimBone } from './armik.js';

const MODEL_URL = 'models/robot.glb';
/** Robot head centre is ~3.52 model units up; put it on the head hitbox. */
const ROBOT_SCALE = HITBOX.head.y / 3.52;
const ACCENT = 0xff5a36;
/** Crouch squashes the figure so its head lands on the crouched head hitbox. */
const CROUCH_SQUASH = HITBOX_CROUCH.headY / HITBOX.head.y;
const FADE = 0.15; // s crossfade between clips
const CORPSE_S = 2.5; // how long the death pose stays visible
const GUN_SCALE = 1.8;
/**
 * The model's cartoon head was 1.17 m wide — four times the 0.3 m head hitbox,
 * so most shots at the visible head passed through nothing. It is drawn at
 * half size, and the hitboxes are fitted to the drawn head and body every
 * frame (see _fitHitboxes), so what you see is what you can hit.
 */
const HEAD_SCALE = 0.5;
const BODY_R = 0.3; // torso is ~0.7 m wide, ~0.62 m deep

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
        const loader = new GLTFLoader();
        try {
          return await loader.loadAsync(base + MODEL_URL);
        } catch (err) {
          // Hosts that don't serve .glb (claude.ai artifacts) get the same
          // bytes as base64 text: models/robot.glb.b64.txt
          const res = await fetch(base + MODEL_URL + '.b64.txt');
          if (!res.ok) throw err;
          const bin = Uint8Array.from(atob((await res.text()).trim()), (c) => c.charCodeAt(0));
          return await loader.parseAsync(bin.buffer, base + 'models/');
        }
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
   * @param {{ owner?: object, name?: string, lite?: boolean, model?: object|null, clone?: Function, accent?: number }} opts
   *   owner is reported as the hit actor; lite = no HDR glow; model = glTF from
   *   loadCharacterModel() with `clone` = SkeletonUtils.clone; accent = the
   *   robot's colour band (enemy orange by default, teammates cyan)
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

    if (opts.model && opts.clone) this._buildRobot(opts.model, opts.clone, opts);
    else this._buildMannequin(opts);
    this._buildGuns();
    scene.add(this.root);

    const L = physics.LAYER?.ACTOR;
    this.head = physics.addCollider({ shape: 'capsule', layer: L, surface: 'flesh', owner: this.owner, part: 'head', radius: HITBOX.head.radius, damageScale: 1 });
    this.body = physics.addCollider({ shape: 'capsule', layer: L, surface: 'flesh', owner: this.owner, part: 'body', radius: HITBOX.body.radius, damageScale: 1 });
    this.colliders = [this.head, this.body];
  }

  _buildRobot(gltf, clone, opts = {}) {
    const model = clone(gltf.scene);
    model.scale.setScalar(ROBOT_SCALE);
    model.rotation.y = Math.PI; // the robot faces +Z; our yaw 0 faces -Z
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.frustumCulled = false; // skinned bounds don't follow the animation
      const m = o.material.clone();
      if (m.name === 'Main') m.color.setHex(opts.accent ?? ACCENT);
      o.material = m;
      this._owned.push(m);
    });
    this.root.add(model);
    this.bodyNode = model;
    this._fitRobotHead(model);
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

  /** Shrink the head and measure it (in the Head bone's frame) for the hitbox. */
  _fitRobotHead(model) {
    const bone = model.getObjectByName('Head');
    if (!bone) return;
    bone.scale.setScalar(HEAD_SCALE); // no clip animates scale, so this holds
    this.root.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
    const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const inv = new THREE.Matrix4().copy(bone.matrixWorld).invert();
    bone.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
        lo.min(v);
        hi.max(v);
      }
    });
    if (!Number.isFinite(lo.x)) return;
    this._headBone = bone;
    this._headLocal = lo.clone().add(hi).multiplyScalar(0.5);
    // world-space size of the drawn head (the bone frame carries the scales)
    const w = new THREE.Vector3();
    bone.getWorldScale(w);
    const size = hi.clone().sub(lo).multiply(w);
    // radius: mostly the head's height, a little of its depth, so a side view
    // of the dome is covered too without growing far past the top
    this._headR = 0.7 * (size.y / 2) + 0.3 * (size.z / 2);
    this._headHalfW = Math.max(this._headR, size.x / 2); // a little wider than tall
  }

  /**
   * Hitboxes on the drawn robot: the head as a side-to-side capsule around
   * the head bone (so it follows the run bob, crouch and lean), the body as
   * an upright capsule from the hips to just under the head.
   */
  _fitHitboxes() {
    const b = this._headBone;
    if (!b) return false;
    const c = b.localToWorld((this._v2 ??= new THREE.Vector3()).copy(this._headLocal));
    const r = this._headR;
    const half = Math.max(0, this._headHalfW - r);
    const yaw = this.root.rotation.y;
    const rx = Math.cos(yaw) * half, rz = -Math.sin(yaw) * half; // avatar's right axis
    this.head.setSegment(c.x - rx, c.y, c.z - rz, c.x + rx, c.y, c.z + rz, r);
    const p = this.position;
    const top = Math.max(p.y + HITBOX.body.y0 + 0.1, c.y - r - BODY_R);
    this.body.setSegment(p.x, p.y + HITBOX.body.y0, p.z, p.x, top, p.z, BODY_R);
    this.headY = c.y - p.y;
    return true;
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
    if (!this.mixer) return this._holdGun(dt);
    const pick = pickClip({ speed: this._speed, air: this._air, alive: this.alive }, this.clip);
    this._play(pick.clip, pick.timeScale);
    this.mixer.update(dt);
    this._holdGun(dt);
    if (this._headBone) {
      this.root.updateMatrixWorld(true);
      this._fitHitboxes();
    }
  }

  /* ---------------------------------------------------------------- gun -- */

  _buildGuns() {
    this.gunRoot = new THREE.Group();
    this.gunRoot.name = 'held-gun';
    // The robot is a cartoon with club-like forearms: a life-size gun vanishes
    // inside its fists, so the held gun is drawn larger to read at a glance.
    this.gunRoot.scale.setScalar(GUN_SCALE);
    this.root.add(this.gunRoot);
    this.guns = {};
    for (const id of GUN_IDS) {
      const g = buildGun(id);
      g.visible = false;
      this.gunRoot.add(g);
      this.guns[id] = g;
    }
    this.weapon = 'rifle';
    this._shown = 'rifle';
    this.guns.rifle.visible = true;
    this._aimPitch = 0;
    this._pitchTarget = 0;
    this._kick = 0; // 0..1, decays
    this._kickV = 0;
    this._reload = 0; // reload blend 0..1
    this._reloading = false;
    this._reloadT = 0;
    this._swap = 0; // 1 at the bottom of a swap dip
    this._swapDir = 0;
    this._low = 0; // sprint low-carry blend
    this._v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  }

  /** Which gun they hold. A change plays the swap dip. */
  setWeapon(id) {
    if (!this.guns?.[id] || id === this.weapon) return;
    this.weapon = id;
    this._swapDir = 1; // dip down; the model switches at the bottom
  }

  /** Their look pitch (radians, + up). */
  setAim(pitch) {
    this._pitchTarget = Math.max(-1.2, Math.min(1.2, pitch || 0));
  }

  setReloading(on) {
    if (on && !this._reloading) this._reloadT = 0;
    this._reloading = !!on;
  }

  /** They fired: the gun kicks back and up (harder for heavy guns). */
  fire() {
    const heavy = this.weapon === 'sniper' ? 1.8 : this.weapon === 'shotgun' ? 1.5 : this.weapon === 'pistol' ? 0.8 : 0.55;
    this._kickV += 9 * heavy;
  }

  /** World position of the muzzle of the gun they hold. */
  muzzleWorld(out) {
    const g = this.guns?.[this._shown];
    if (!g) return out.copy(this.position).setY(this.position.y + 1.3);
    g.updateWorldMatrix(true, false);
    return out.copy(g.userData.muzzle).applyMatrix4(g.matrixWorld);
  }

  _bones() {
    if (this._b !== undefined) return this._b;
    // GLTFLoader sanitises node names ('UpperArm.R' -> 'UpperArmR').
    const find = (n) => this.bodyNode?.getObjectByName(n) ?? this.bodyNode?.getObjectByName(n.replace(/\./g, '')) ?? null;
    const b = {
      torso: find('Torso'),
      R: { up: find('UpperArm.R'), lo: find('LowerArm.R'), hand: find('Palm2.R') },
      L: { up: find('UpperArm.L'), lo: find('LowerArm.L'), hand: find('Palm2.L') },
    };
    this._b = b.R.up && b.R.lo && b.R.hand && b.L.up && b.L.lo && b.L.hand ? b : null;
    return this._b;
  }

  /** Pose the gun in avatar space, then reach both hands to it. */
  _holdGun(dt) {
    const gr = this.gunRoot;
    if (!gr) return;
    gr.visible = this.alive;
    if (!this.alive) return;

    // ---- springs and blends ----
    this._aimPitch += (this._pitchTarget - this._aimPitch) * Math.min(1, dt * 14);
    // kick: critically-damped-ish spring driven by fire()
    this._kickV += (-this._kick * 220 - this._kickV * 24) * dt;
    this._kick = Math.max(-0.3, Math.min(1.6, this._kick + this._kickV * dt));
    const running = this._speed > 7 && !this._air;
    this._low += ((running ? 1 : 0) - this._low) * Math.min(1, dt * 8);
    this._reload += ((this._reloading ? 1 : 0) - this._reload) * Math.min(1, dt * 9);
    if (this._reloading) this._reloadT += dt;
    if (this._swapDir) {
      this._swap += this._swapDir * dt / 0.18;
      if (this._swap >= 1) {
        this._swap = 1;
        this._swapDir = -1;
        this.guns[this._shown].visible = false;
        this._shown = this.weapon;
        this.guns[this._shown].visible = true;
      } else if (this._swap <= 0) {
        this._swap = 0;
        this._swapDir = 0;
      }
    }

    // ---- gun transform in avatar space (avatar faces -Z, right is +X) ----
    const id = this._shown;
    const pistol = id === 'pistol';
    const k = this._kick, low = this._low, rl = this._reload, sw = this._swap;
    const crouchDrop = this._crouch * (HITBOX.head.y - HITBOX_CROUCH.headY);
    const pitch = this._aimPitch * (1 - low);
    // pivot at the shoulders so aiming up/down swings the gun, not slides it
    const b = this.mixer ? this._bones() : null;
    let shoulderY = 1.36 - crouchDrop, reach = pistol ? 0.42 : 0.3;
    if (b) {
      this.root.updateMatrixWorld(true);
      const sR = this.root.worldToLocal(b.R.up.getWorldPosition(this._v[0]));
      shoulderY = sR.y;
      // the robot's arms are short: hold the gun where its hands can reach
      const arm = b.R.up.getWorldPosition(this._v[1]).distanceTo(b.R.lo.getWorldPosition(this._v[2])) +
        b.R.lo.getWorldPosition(this._v[1]).distanceTo(b.R.hand.getWorldPosition(this._v[2]));
      reach = arm * (pistol ? 0.9 : 0.62);
    }
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    gr.position.set(
      0.06 - low * 0.05,
      shoulderY - 0.08 + sp * reach - low * 0.12 - sw * 0.3 - rl * 0.04 + k * 0.015,
      -cp * reach + low * 0.06 + k * 0.07
    );
    gr.rotation.set(
      pitch + k * 0.32 - low * 0.75 - sw * 1.0 - rl * 0.3,
      -low * 0.5 + rl * 0.15,
      -rl * 0.65,
      'YXZ'
    );
    if (!b) return; // mannequin / no rig: gun only
    this.root.updateMatrixWorld(true);

    // ---- hand targets on the gun ----
    const hold = HOLD[id];
    const [tR, tL, , pole] = this._v;
    gr.localToWorld(tR.fromArray(hold.right));
    if (rl > 0.02) {
      // support hand goes down to the magazine and back
      const ph = Math.sin(Math.min(1, this._reloadT / 1.6) * Math.PI);
      const m = this._v[2].fromArray(hold.mag);
      m.y -= 0.1 * ph;
      gr.localToWorld(m);
      gr.localToWorld(tL.fromArray(hold.left)).lerp(m, rl);
    } else {
      gr.localToWorld(tL.fromArray(hold.left));
    }

    // ---- two-bone IK per arm; elbows bend down and out ----
    for (const [side, target, out] of [['R', tR, 1], ['L', tL, -1]]) {
      const arm = b[side];
      const s = arm.up.getWorldPosition(this._v[2]);
      const e0 = arm.lo.getWorldPosition(new THREE.Vector3());
      const h0 = arm.hand.getWorldPosition(new THREE.Vector3());
      const a = s.distanceTo(e0), c = e0.distanceTo(h0);
      pole.set(out * 0.8, -1, 0.15).applyQuaternion(this.root.quaternion);
      const e = solveElbow(s, target, a, c, pole);
      aimBone(arm.up, arm.lo, new THREE.Vector3(e.x, e.y, e.z));
      aimBone(arm.lo, arm.hand, target);
    }
  }

  setPose(x, y, z, yaw) {
    this.position.set(x, y, z);
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    if (this._headBone) {
      this.root.updateMatrixWorld(true);
      if (this._fitHitboxes()) return;
    }
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
