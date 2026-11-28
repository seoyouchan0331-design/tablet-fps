/**
 * GadgetSystem — the moving parts a map places for the local player:
 *
 *   layout.pads:  [{ x, y, z, to: { x, y, z } }]
 *     A 2 x 2 m jump pad. Step on it and you are thrown on an arc that lands
 *     on `to` (air control still steers, as after a jump).
 *   layout.lifts: [{ x0, x1, z0, z1, y0, y1 }]
 *     A cargo lift. Stand on it at the bottom and it rises to y1 after a
 *     moment, waits, and comes back down; whoever stands on it rides along.
 *
 * Each player's own client moves them (the position is synced like any
 * other), so nothing here goes over the network; a lift's platform is drawn
 * from this client's own timing.
 */
import * as THREE from 'three';
import { GRAVITY } from '../player/tuning.js';

const PAD_HALF = 1.0;
const PAD_APEX = 3.0; // metres above the higher end of the arc
const LIFT = { arm: 0.6, rise: 2.0, hold: 2.5, fall: 2.0 };

/** Launch velocity from `from` that lands on `to`, peaking PAD_APEX above the higher end. */
export function padVelocity(from, to, g = -GRAVITY) {
  const apex = Math.max(from.y, to.y) + PAD_APEX;
  const vy = Math.sqrt(2 * g * (apex - from.y));
  const t = vy / g + Math.sqrt((2 * (apex - to.y)) / g);
  return { x: (to.x - from.x) / t, y: vy, z: (to.z - from.z) / t, t };
}

const smooth = (u) => u * u * (3 - 2 * u);

export class GadgetSystem {
  static id = 'gadgets';
  static deps = ['world', 'player'];

  async init(ctx) {
    this.ctx = ctx;
    this._map = null;
    this.pads = [];
    this.lifts = [];
    this._cool = 0;
    this.launches = 0;
    this.root = new THREE.Group();
    this.root.name = 'gadgets';
    ctx.scene.add(this.root);
    this._glow = new THREE.MeshBasicMaterial({ color: 0x7fd8ff, toneMapped: false });
    this._beam = new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this._plate = new THREE.MeshStandardMaterial({ color: 0x39414d, roughness: 0.5 });
    this._liftMat = new THREE.MeshStandardMaterial({ color: 0xb9c0ca, roughness: 0.6 });
    this._warn = new THREE.LineBasicMaterial({ color: 0xff8a1e, toneMapped: false });
    this._geos = [];
  }

  _geo(g) {
    this._geos.push(g);
    return g;
  }

  _build() {
    this.root.clear();
    for (const g of this._geos) g.dispose();
    this._geos = [];
    const L = this.ctx.peek('world')?.layout ?? {};
    this.pads = (L.pads ?? []).map((p) => {
      const g = new THREE.Group();
      g.position.set(p.x, p.y, p.z);
      const plate = new THREE.Mesh(this._geo(new THREE.BoxGeometry(2 * PAD_HALF, 0.08, 2 * PAD_HALF)), this._plate);
      plate.position.y = 0.04;
      // a chevron pointing where it throws you
      const chevron = new THREE.Group();
      for (const s of [-1, 1]) {
        const bar = new THREE.Mesh(this._geo(new THREE.BoxGeometry(0.9, 0.04, 0.16)), this._glow);
        bar.position.set(s * 0.3, 0.1, 0);
        bar.rotation.y = s * 0.75;
        chevron.add(bar);
      }
      chevron.rotation.y = Math.atan2(p.to.x - p.x, p.to.z - p.z) + Math.PI / 2;
      const ring = new THREE.LineSegments(this._geo(new THREE.EdgesGeometry(new THREE.BoxGeometry(2 * PAD_HALF, 0.1, 2 * PAD_HALF))), new THREE.LineBasicMaterial({ color: 0x7fd8ff, toneMapped: false }));
      ring.position.y = 0.05;
      const beam = new THREE.Mesh(this._geo(new THREE.CylinderGeometry(0.85, 0.95, 3.2, 20, 1, true)), this._beam);
      beam.position.y = 1.6;
      g.add(plate, chevron, ring, beam);
      this.root.add(g);
      return { ...p, mesh: g, beam };
    });
    this.lifts = (L.lifts ?? []).map((l) => {
      const w = l.x1 - l.x0, d = l.z1 - l.z0;
      const g = new THREE.Group();
      const deck = new THREE.Mesh(this._geo(new THREE.BoxGeometry(w - 0.1, 0.2, d - 0.1)), this._liftMat);
      deck.position.y = -0.1;
      const edge = new THREE.LineSegments(this._geo(new THREE.EdgesGeometry(new THREE.BoxGeometry(w - 0.1, 0.2, d - 0.1))), this._warn);
      edge.position.y = -0.1;
      g.add(deck, edge);
      g.position.set((l.x0 + l.x1) / 2, l.y0 + 0.02, (l.z0 + l.z1) / 2);
      this.root.add(g);
      return { ...l, mesh: g, phase: 'bottom', t: 0, y: l.y0 };
    });
  }

  /** Is (x, z) on lift l's platform? */
  _onLift(l, x, z) {
    return x > l.x0 + 0.05 && x < l.x1 - 0.05 && z > l.z0 + 0.05 && z < l.z1 - 0.05;
  }

  update(dt, ctx) {
    const world = ctx.peek('world');
    if (world?.mapId !== this._map) {
      this._map = world?.mapId;
      this._build();
    }
    const player = ctx.peek('player');
    const mv = player?.movement;
    const alive = mv && !player.health?.dead;
    const P = mv?.position;
    const t = ctx.time?.raw ?? 0;
    for (const p of this.pads) p.beam.material.opacity = 0.12 + 0.06 * Math.sin(t * 4);

    // jump pads
    this._cool = Math.max(0, this._cool - dt);
    if (alive && this._cool === 0 && mv.grounded) {
      for (const p of this.pads) {
        if (Math.abs(P.x - p.x) > PAD_HALF || Math.abs(P.z - p.z) > PAD_HALF || Math.abs(P.y - p.y) > 0.4) continue;
        const v = padVelocity(P, p.to);
        mv.launch(v.x, v.y, v.z);
        this._cool = 0.6;
        this.launches++;
        ctx.events.emit('player:launch', { x: p.x, z: p.z });
        break;
      }
    }

    // lifts
    let carry = null;
    for (const l of this.lifts) {
      const on = alive && this._onLift(l, P.x, P.z) && P.y > l.y - 0.5 && P.y < l.y + 0.7;
      l.t += dt;
      if (l.phase === 'bottom') {
        l.y = l.y0;
        if (on && mv.grounded) {
          l.phase = 'arm';
          l.t = 0;
        }
      } else if (l.phase === 'arm') {
        if (!on) l.phase = 'bottom';
        else if (l.t >= LIFT.arm) { l.phase = 'up'; l.t = 0; }
      } else if (l.phase === 'up') {
        l.y = l.y0 + (l.y1 - l.y0) * smooth(Math.min(1, l.t / LIFT.rise));
        if (l.t >= LIFT.rise) { l.phase = 'top'; l.t = 0; }
      } else if (l.phase === 'top') {
        l.y = l.y1;
        if (l.t >= LIFT.hold) { l.phase = 'down'; l.t = 0; }
      } else if (l.phase === 'down') {
        l.y = l.y1 + (l.y0 - l.y1) * smooth(Math.min(1, l.t / LIFT.fall));
        if (l.t >= LIFT.fall) { l.phase = 'bottom'; l.t = 0; }
      }
      l.mesh.position.y = l.y + 0.02;
      if (on && l.phase !== 'bottom' && l.phase !== 'arm') carry = l.y + 0.02;
    }
    if (mv) mv.carryY = carry;
  }

  dispose() {
    this.ctx.scene.remove(this.root);
    for (const g of this._geos) g.dispose();
    for (const m of [this._glow, this._beam, this._plate, this._liftMat, this._warn]) m.dispose();
  }
}
