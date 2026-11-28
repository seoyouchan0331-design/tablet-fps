/**
 * OpponentSystem — the other players.
 *
 * Duel: one remote player, `avatar` / `target` / `push(t, state)`.
 * Party (3-8 players): any number of remote players by id, through
 * `add(id, opts)` / `pushFor(id, t, state)` / `remove(id)`; `others` lists
 * them all (duel included), `aimTarget()` picks the enemy nearest the
 * crosshair for aim assist.
 *
 * Each remote player is drawn as the neon Avatar, 100 ms behind its newest
 * state snapshot (SnapshotBuffer), so 30 Hz updates move smoothly at 60 fps.
 * Its colliders report its `target` as the hit actor: the local weapon's
 * bullets emit `damage:dealt` with that target, which MatchSystem / PartySystem
 * turn into a hit claim for the host (a remote player's HP is never changed
 * locally).
 */
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Avatar, loadCharacterModel } from './avatar.js';
import { SnapshotBuffer } from '../match/interp.js';

const DELAY = 0.1; // seconds behind the newest snapshot
export const ENEMY_ACCENT = 0xff5a36;
export const TEAM_ACCENT = 0x2fd8ff;

/** One remote player: avatar + snapshot buffer + its hit-actor identity. */
class Remote {
  constructor(ctx, model, { id, name, enemy = true, accent }) {
    this.id = id;
    this.enemy = enemy;
    this.target = { name: name ?? 'OPPONENT', isOpponent: true, remoteId: id };
    this.avatar = new Avatar(ctx.scene, ctx.get('physics'), {
      owner: this.target,
      name: `remote-${id}`,
      lite: !!ctx.config.q?.lite,
      model,
      clone: cloneSkinned,
      accent: accent ?? (enemy ? ENEMY_ACCENT : TEAM_ACCENT),
    });
    this.target.avatar = this.avatar;
    this.buffer = new SnapshotBuffer();
    this._s = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, w: 'rifle', rl: false, alive: false, air: false, crouch: false };
  }

  step(dt, now) {
    const s = this._s;
    const av = this.avatar;
    if (this.buffer.sample(now - DELAY, s)) {
      if (av.alive !== !!s.alive) av.setAlive(!!s.alive);
      if (s.alive) av.setPose(s.x, s.y, s.z, s.yaw);
      av.setAir(s.air);
      av.setCrouch(s.crouch);
      av.setAim(s.pitch ?? 0);
      if (s.w) av.setWeapon(s.w);
      av.setReloading(!!s.rl);
    }
    av.tick(dt);
  }
}

export class OpponentSystem {
  static id = 'opponent';
  static deps = ['physics', 'world'];

  async init(ctx) {
    this.ctx = ctx;
    this.model = await loadCharacterModel();
    // the duel opponent: always there, hidden outside a duel
    this.duel = new Remote(ctx, this.model, { id: 'opp', name: 'OPPONENT' });
    this.target = this.duel.target;
    this.avatar = this.duel.avatar;
    this.visible = false;
    this.avatar.hide();
    /** party players by id */
    this.party = new Map();
  }

  /** Every remote player currently in play (the duel opponent or the party). */
  get others() {
    if (this.party.size) return [...this.party.values()];
    return this.visible ? [this.duel] : [];
  }

  // ------------------------------------------------------------------ duel --
  /** New authoritative state for the duel opponent (t in seconds, sender clock rebased by MatchSystem). */
  push(t, state) {
    this.duel.buffer.push(t, state);
  }

  /** Show/hide the duel opponent entirely (menus, lobby, between matches). */
  setVisible(v) {
    this.visible = v;
    if (!v) {
      this.avatar.hide();
      this.duel.buffer = new SnapshotBuffer();
    }
  }

  // ----------------------------------------------------------------- party --
  /** Add (or recolour) a party player. */
  add(id, { name, enemy = true } = {}) {
    const old = this.party.get(id);
    if (old && old.enemy === enemy) {
      old.target.name = name ?? old.target.name;
      return old;
    }
    if (old) this.remove(id);
    const r = new Remote(this.ctx, this.model, { id, name, enemy });
    r.avatar.hide();
    // teammates can't be hit (no friendly fire): my bullets pass through them
    r.avatar.noHit = !enemy;
    this.party.set(id, r);
    return r;
  }

  get(id) {
    return this.party.get(id) ?? null;
  }

  pushFor(id, t, state) {
    this.party.get(id)?.buffer.push(t, state);
  }

  remove(id) {
    const r = this.party.get(id);
    if (!r) return;
    r.avatar.dispose();
    this.party.delete(id);
  }

  clearParty() {
    for (const id of [...this.party.keys()]) this.remove(id);
  }

  /**
   * The living enemy closest to the crosshair (smallest angle from the view
   * direction), or null. eye: {x,y,z}; yaw/pitch: the player's view.
   */
  aimTarget(eye, yaw) {
    let best = null, bestA = Infinity;
    for (const r of this.others) {
      const av = r.avatar;
      if (!r.enemy || !av.alive || !av.root?.visible) continue;
      const dx = av.position.x - eye.x, dz = av.position.z - eye.z;
      let a = Math.atan2(-dx, -dz) - yaw;
      a -= Math.round(a / (2 * Math.PI)) * 2 * Math.PI;
      if (Math.abs(a) < bestA) {
        bestA = Math.abs(a);
        best = av;
      }
    }
    return best;
  }

  update(dt, ctx) {
    const step = ctx.time.dt || dt;
    const now = ctx.time.raw;
    if (this.visible) this.duel.step(step, now);
    for (const r of this.party.values()) r.step(step, now);
  }

  dispose() {
    this.duel.avatar.dispose();
    this.clearParty();
  }
}
