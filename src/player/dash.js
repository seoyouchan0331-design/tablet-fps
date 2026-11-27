/**
 * DASH: a long, fast slide. On the ground it launches a slide at slideSpeed
 * along the move direction (movement.js then lets slide drag bleed it off, so
 * it glides rather than teleports); in the air it is a gentler push.
 * Pure timing + launch maths — the character controller resolves the motion,
 * so a dash can never tunnel through a wall.
 */
export class Dash {
  constructor({ cooldown = 3, slideSpeed = 18, airSpeed = 11 } = {}) {
    this.cooldown = cooldown;
    this.slideSpeed = slideSpeed;
    this.airSpeed = airSpeed;
    this._start = -Infinity;
    this._dx = 0;
    this._dz = 0;
  }

  ready(now) {
    return now - this._start >= this.cooldown;
  }

  cooldownLeft(now) {
    return Math.max(0, this.cooldown - (now - this._start));
  }

  /** Direction need not be normalised; a zero direction is refused. */
  tryStart(now, dirX, dirZ) {
    const len = Math.hypot(dirX, dirZ);
    if (!this.ready(now) || len < 1e-6) return false;
    this._start = now;
    this._dx = dirX / len;
    this._dz = dirZ / len;
    return true;
  }

  /** Horizontal launch velocity for the dash just started. */
  launch(out, grounded) {
    const s = grounded ? this.slideSpeed : this.airSpeed;
    out.x = this._dx * s;
    out.z = this._dz * s;
    return out;
  }
}
