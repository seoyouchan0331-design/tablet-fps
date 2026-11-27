/**
 * OpponentSystem — the other player in a duel.
 *
 * Draws the remote player as the neon Avatar, 100 ms behind the newest state
 * snapshot (SnapshotBuffer), so 30 Hz updates move smoothly at 60 fps. Its
 * colliders report `target` as the hit actor: the local weapon's bullets emit
 * `damage:dealt` with that target, which MatchSystem turns into a hit claim for
 * the host (the opponent's HP is never changed locally).
 */
import { Avatar } from './avatar.js';
import { SnapshotBuffer } from '../match/interp.js';

const DELAY = 0.1; // seconds behind the newest snapshot

export class OpponentSystem {
  static id = 'opponent';
  static deps = ['physics', 'world'];

  async init(ctx) {
    this.ctx = ctx;
    this.target = { name: 'OPPONENT', isOpponent: true };
    this.avatar = new Avatar(ctx.scene, ctx.get('physics'), {
      owner: this.target,
      name: 'opponent',
      lite: !!ctx.config.q?.lite,
    });
    this.target.avatar = this.avatar;
    this.buffer = new SnapshotBuffer();
    this._s = { x: 0, y: 0, z: 0, yaw: 0, alive: false };
    this.visible = false;
    this.avatar.setAlive(false);
  }

  /** New authoritative state for the remote player (t in seconds, sender clock rebased by MatchSystem). */
  push(t, state) {
    this.buffer.push(t, state);
  }

  /** Show/hide the opponent entirely (menus, lobby, between matches). */
  setVisible(v) {
    this.visible = v;
    if (!v) {
      this.avatar.setAlive(false);
      this.buffer = new SnapshotBuffer();
    }
  }

  update(dt, ctx) {
    if (!this.visible) return;
    const s = this._s;
    if (!this.buffer.sample(ctx.time.raw - DELAY, s)) return;
    if (this.avatar.alive !== !!s.alive) this.avatar.setAlive(!!s.alive);
    if (s.alive) this.avatar.setPose(s.x, s.y, s.z, s.yaw);
  }

  dispose() {
    this.avatar.dispose();
  }
}
