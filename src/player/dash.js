/**
 * DASH: a short burst of horizontal velocity in the move direction.
 * Pure timing logic — movement.js feeds the velocity through the character
 * controller's swept move, so a dash can never tunnel through a wall.
 */
export class Dash {
  constructor({ cooldown = 3, duration = 0.15, speed = 22 } = {}) {
    this.cooldown = cooldown;
    this.duration = duration;
    this.speed = speed;
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

  /** Writes the dash velocity into out while active; returns false when idle. */
  velocity(now, out) {
    const t = now - this._start;
    if (t < 0 || t > this.duration) return false;
    out.x = this._dx * this.speed;
    out.z = this._dz * this.speed;
    return true;
  }
}
