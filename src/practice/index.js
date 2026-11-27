/**
 * PracticeSystem — a strafing dummy at the far spawn, for offline aim practice
 * (and for tuning aim assist before the networked opponent exists).
 *
 * Takes hits through its Avatar colliders: physics emits `damage:dealt` with the
 * avatar as target, this listener applies HP and marks `killed` on the same
 * event object (the pattern ARCHITECTURE.md prescribes: the target applies
 * damage). The listener is prepended so the HUD and audio see `killed`.
 */
import { Avatar } from '../opponent/avatar.js';
import { applyDamage, MAX_HP } from '../opponent/hitbox.js';

const RESPAWN_S = 2;
const STRAFE_HALF = 5; // metres either side of the spawn
const FACE_PLAYER = true;

export class PracticeSystem {
  static id = 'practice';
  static deps = ['physics', 'world'];

  async init(ctx) {
    this.ctx = ctx;
    this.physics = ctx.get('physics');
    this.world = ctx.get('world');
    this.rng = ctx.rng.fork();
    this.dummy = { name: 'DUMMY', isAvatar: true, hp: MAX_HP };
    this.avatar = new Avatar(ctx.scene, this.physics, { owner: this.dummy, name: 'practice-dummy', lite: !!ctx.config.q?.lite });
    this.dummy.avatar = this.avatar;
    this._deadUntil = 0;
    this._phase = 0;
    this._speed = 0.8;
    this._retarget = 0;
    this.kills = 0;

    // prepend: HUD and audio must see `killed` on the killing shot.
    this._off = ctx.events.prepend('damage:dealt', (e) => {
      if (!e || e.target !== this.dummy || !this.avatar.alive) return;
      const r = applyDamage(this.dummy.hp, e.amount ?? 0, e.headshot ? 'head' : 'body');
      this.dummy.hp = r.hp;
      e.amount = r.amount;
      if (r.killed) {
        e.killed = true;
        this.kills++;
        this.avatar.setAlive(false);
        this._deadUntil = ctx.time.elapsed + RESPAWN_S;
        ctx.events.emit('actor:death', { actor: this.dummy, point: e.point, impulse: null });
      }
    });
    this.active = true;
    this._place(0);
  }

  /** Practice dummy on/off (off during a duel). */
  setActive(on) {
    this.active = on;
    this.avatar.setAlive(on);
    if (on) this.dummy.hp = MAX_HP;
  }

  update(dt, ctx) {
    if (!this.active) return;
    const now = ctx.time.elapsed;
    if (!this.avatar.alive) {
      if (now >= this._deadUntil) {
        this.dummy.hp = MAX_HP;
        this.avatar.setAlive(true);
      } else return;
    }
    // Deterministic strafe: a sine whose speed changes every 1-2.5 s.
    if (now >= this._retarget) {
      this._speed = this.rng.range(0.5, 1.6);
      this._retarget = now + this.rng.range(1, 2.5);
    }
    this._phase += dt * this._speed;
    this._place(Math.sin(this._phase) * STRAFE_HALF);
  }

  _place(offsetX) {
    const sp = this.world.spawn(1);
    const x = sp.position.x + offsetX;
    const z = sp.position.z;
    const y = this.world.groundHeight(x, z);
    let yaw = sp.yaw;
    if (FACE_PLAYER) {
      // The player may not exist yet: practice initialises before it.
      const pl = this.ctx.peek('player');
      const p = pl?.movement ? pl.position : null;
      if (p) yaw = Math.atan2(p.x - x, p.z - z);
    }
    this.avatar.setPose(x, y, z, yaw);
  }

  dispose() {
    this._off?.();
    this.avatar.dispose();
  }
}
