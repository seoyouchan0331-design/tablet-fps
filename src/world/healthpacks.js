/**
 * PickupSystem — health packs a map places (layout.pickups: [{x, y, z}]).
 *
 * Walk over one with less than full health: +50 HP, and the pack is gone for
 * 20 s. Who decides:
 *   - alone (practice): this system, for the local player;
 *   - in a duel or a party: the host, for every player (bots included), and
 *     tells everyone (MatchSystem / PartySystem call `take` / `heal`).
 * Drawn as a floating green neon cross over a small base, turning slowly.
 */
import * as THREE from 'three';

export const PACK = { heal: 50, respawn: 20, radius: 1.1 };

export class PickupSystem {
  static id = 'pickups';
  static deps = ['world', 'player'];

  async init(ctx) {
    this.ctx = ctx;
    this.packs = []; // { x, y, z, readyAt, mesh }
    this._map = null;
    this.clock = 0;
    const cross = [new THREE.BoxGeometry(0.5, 0.16, 0.16), new THREE.BoxGeometry(0.16, 0.5, 0.16)];
    this._geo = { cross, base: new THREE.CylinderGeometry(0.42, 0.48, 0.1, 16) };
    this._glow = new THREE.MeshBasicMaterial({ color: 0x6dff9c, toneMapped: false });
    this._baseMat = new THREE.MeshStandardMaterial({ color: 0x2a3036, roughness: 0.6 });
  }

  _build() {
    for (const p of this.packs) this.ctx.scene.remove(p.mesh);
    const list = this.ctx.peek('world')?.layout?.pickups ?? [];
    this.packs = list.map((q) => {
      const g = new THREE.Group();
      const base = new THREE.Mesh(this._geo.base, this._baseMat);
      base.position.y = 0.05;
      const cross = new THREE.Group();
      for (const c of this._geo.cross) cross.add(new THREE.Mesh(c, this._glow));
      cross.position.y = 0.75;
      g.add(base, cross);
      g.position.set(q.x, q.y, q.z);
      this.ctx.scene.add(g);
      return { x: q.x, y: q.y, z: q.z, readyAt: 0, mesh: g, cross };
    });
  }

  ready(i) {
    return !!this.packs[i] && this.clock >= this.packs[i].readyAt;
  }

  /** Pack i was taken: hidden for its respawn time (`left`: seconds still to wait, from the host). */
  take(i, left = PACK.respawn) {
    const p = this.packs[i];
    if (p) p.readyAt = this.clock + left;
  }

  /** The ready pack under (x, y, z), or -1. */
  packAt(x, y, z) {
    for (let i = 0; i < this.packs.length; i++) {
      const p = this.packs[i];
      if (this.ready(i) && Math.hypot(p.x - x, p.z - z) < PACK.radius && Math.abs(p.y - y) < 1.2) return i;
    }
    return -1;
  }

  /** Is someone else deciding (a duel or party is running)? */
  _online() {
    return this.ctx.peek('party')?.phase === 'match' || this.ctx.peek('match')?.phase === 'match';
  }

  update(dt, ctx) {
    const world = ctx.peek('world');
    if (world?.mapId !== this._map) {
      this._map = world?.mapId;
      this._build();
    }
    this.clock += dt;
    for (let i = 0; i < this.packs.length; i++) {
      const p = this.packs[i];
      const on = this.ready(i);
      p.mesh.visible = on;
      if (on) {
        p.cross.rotation.y += dt * 1.6;
        p.cross.position.y = 0.75 + Math.sin(this.clock * 2 + i) * 0.08;
      }
    }
    // alone: the local player picks packs up here
    if (this._online()) return;
    const player = ctx.peek('player');
    const h = player?.health;
    if (!h || h.dead || h.value >= h.max) return;
    const P = player.position;
    const i = this.packAt(P.x, P.y, P.z);
    if (i < 0) return;
    h.heal(PACK.heal);
    this.take(i);
    ctx.events.emit('pickup:health', { amount: PACK.heal });
  }

  dispose() {
    for (const p of this.packs) this.ctx.scene.remove(p.mesh);
    for (const g of [...this._geo.cross, this._geo.base]) g.dispose();
    this._glow.dispose();
    this._baseMat.dispose();
  }
}
