/**
 * GrenadeSystem — frag grenades.
 *
 * The local player throws with G / the NADE button (2 per life, refilled
 * on respawn and at the start of a round). A grenade flies under gravity,
 * bounces off the map (raycasts against the static world) and goes off
 * 2.5 s after the throw.
 *
 * Everyone simulates every grenade from the same throw (origin, velocity),
 * so it looks the same on every screen. Damage is NOT decided here: the
 * explosion is announced as
 *   'explosion'          { position, radius, visualOnly: true }  fx, shake
 *   'grenade:explode'    { gid, owner, position }                the host's
 *                                                                rules apply damage
 * and a local throw as
 *   'grenade:throw'      { gid, origin:[x,y,z], vel:[x,y,z] }    for the network
 *
 *   grenades.spawn({ gid, owner, origin, vel })   a remote player's throw
 *   grenades.refill() / grenades.count / grenades.enabled
 */
import * as THREE from 'three';

export const GRENADE = {
  perLife: 2,
  fuse: 2.5,
  speed: 17,
  radius: 6, // damage radius, m
  maxDamage: 100,
  bounce: 0.42,
};
const G = 9.81;
const STEP = 1 / 120;

/** Damage at distance d from the blast (none past the radius). */
export function grenadeDamage(d) {
  if (d >= GRENADE.radius) return 0;
  return GRENADE.maxDamage * Math.pow(1 - d / GRENADE.radius, 1.1);
}

export class GrenadeSystem {
  static id = 'grenades';
  static deps = ['physics', 'player'];

  async init(ctx) {
    this.ctx = ctx;
    this.count = GRENADE.perLife;
    this.enabled = true; // matches switch it off between rounds / while dead
    this.live = []; // { gid, owner, p, v, t, mesh, rest }
    this._seq = 0;
    this._cool = 0;
    const body = new THREE.CylinderGeometry(0.06, 0.07, 0.13, 10);
    const band = new THREE.CylinderGeometry(0.073, 0.073, 0.025, 10);
    this._bodyMat = new THREE.MeshStandardMaterial({ color: 0x232a30, roughness: 0.5, metalness: 0.3 });
    this._bandMat = new THREE.MeshBasicMaterial({ color: 0xffa040, toneMapped: false });
    this._geo = { body, band };
    this._dir = new THREE.Vector3();
    this._o = new THREE.Vector3();
    this._d = new THREE.Vector3();
  }

  refill() {
    this.count = GRENADE.perLife;
  }

  _mesh() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this._geo.body, this._bodyMat), new THREE.Mesh(this._geo.band, this._bandMat));
    g.children[0].castShadow = true;
    this.ctx.scene.add(g);
    return g;
  }

  /** Throw from the local player's eye along the view (a little upward). */
  throw() {
    const player = this.ctx.peek('player');
    if (!this.enabled || this.count <= 0 || this._cool > 0 || !player || player.dead || !player.controlEnabled) return false;
    const eye = player.eyePosition;
    const f = player.rig?.forward ?? this._dir.set(0, 0, -1);
    const d = this._dir.copy(f).normalize();
    d.y += 0.18;
    d.normalize();
    const origin = [eye.x + d.x * 0.4, eye.y - 0.1, eye.z + d.z * 0.4];
    const vel = [d.x * GRENADE.speed, d.y * GRENADE.speed, d.z * GRENADE.speed];
    this.count--;
    this._cool = 0.6;
    const gid = `${Date.now().toString(36)}${(++this._seq).toString(36)}`;
    this.spawn({ gid, owner: 'me', origin, vel });
    this.ctx.events.emit('grenade:throw', { gid, origin, vel });
    return true;
  }

  /** Start simulating a grenade (ours, or one a remote player threw). */
  spawn({ gid, owner, origin, vel }) {
    if (!Array.isArray(origin) || !Array.isArray(vel) || this.live.some((g) => g.gid === gid)) return;
    if (![...origin, ...vel].every(Number.isFinite)) return;
    const mesh = this._mesh();
    this.live.push({ gid, owner, p: new THREE.Vector3(...origin), v: new THREE.Vector3(...vel), t: 0, mesh, rest: false });
  }

  /** Remove every grenade (map change, end of a match). */
  clear() {
    for (const g of this.live) this.ctx.scene.remove(g.mesh);
    this.live.length = 0;
  }

  _step(g, dt) {
    const physics = this.ctx.peek('physics');
    for (let left = dt; left > 1e-6; left -= STEP) {
      const h = Math.min(STEP, left);
      if (g.rest) break;
      g.v.y -= G * h;
      const dist = g.v.length() * h;
      if (dist < 1e-6) continue;
      this._d.copy(g.v).normalize();
      const hit = physics?.raycast(g.p, this._d, dist + 0.07, physics.MASK?.WORLD);
      if (hit?.hit) {
        const n = hit.normal;
        g.p.copy(hit.point).addScaledVector(n, 0.07);
        // reflect, lose energy
        const vn = g.v.dot(n);
        g.v.addScaledVector(n, -2 * vn).multiplyScalar(GRENADE.bounce);
        if (g.v.length() < 1.2 && n.y > 0.7) {
          g.v.set(0, 0, 0);
          g.rest = true;
        }
      } else g.p.addScaledVector(g.v, h);
    }
  }

  update(dt, ctx) {
    const step = ctx.time.dt || dt;
    this._cool = Math.max(0, this._cool - step);
    if (ctx.input?.actionPressed?.('grenade')) this.throw();
    for (let i = this.live.length - 1; i >= 0; i--) {
      const g = this.live[i];
      g.t += step;
      this._step(g, step);
      g.mesh.position.copy(g.p);
      g.mesh.rotation.x += step * 9 * (g.rest ? 0 : 1);
      g.mesh.rotation.z += step * 5 * (g.rest ? 0 : 1);
      if (g.t >= GRENADE.fuse) {
        this.live.splice(i, 1);
        ctx.scene.remove(g.mesh);
        const position = g.p.clone();
        position.y += 0.15;
        ctx.events.emit('explosion', { position, radius: 3.5, visualOnly: true, grenade: true });
        ctx.events.emit('grenade:explode', { gid: g.gid, owner: g.owner, position });
      }
    }
  }

  dispose() {
    this.clear();
    this._geo.body.dispose();
    this._geo.band.dispose();
    this._bodyMat.dispose();
    this._bandMat.dispose();
  }
}
