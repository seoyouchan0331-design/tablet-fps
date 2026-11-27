/**
 * Snapshot interpolation for the remote player. States arrive ~30 Hz; the
 * renderer samples ~100 ms in the past so there are almost always two
 * snapshots to blend between.
 *
 * Numbers interpolate linearly, `yaw`/`pitch` take the shortest arc, anything
 * else (booleans, strings) comes from the nearer snapshot.
 */
const KEEP = 1.0; // seconds of history
const ANGLES = new Set(['yaw', 'pitch']);

function lerpAngle(a, b, t) {
  let d = b - a;
  d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
  let r = a + d * t;
  r -= Math.round(r / (2 * Math.PI)) * 2 * Math.PI;
  return r;
}

export class SnapshotBuffer {
  constructor() {
    this._buf = []; // [{t, s}]
  }

  get length() {
    return this._buf.length;
  }

  push(t, state) {
    const b = this._buf;
    if (b.length && t <= b[b.length - 1].t) return; // out of order / duplicate
    b.push({ t, s: state });
    while (b.length > 2 && t - b[0].t > KEEP) b.shift();
  }

  /** Writes the interpolated state into `out`; false when nothing has arrived yet. */
  sample(time, out) {
    const b = this._buf;
    if (!b.length) return false;
    if (time <= b[0].t) return Object.assign(out, b[0].s), true;
    const last = b[b.length - 1];
    if (time >= last.t) return Object.assign(out, last.s), true;
    let i = 1;
    while (b[i].t < time) i++;
    const A = b[i - 1];
    const B = b[i];
    const k = (time - A.t) / (B.t - A.t);
    for (const key of Object.keys(B.s)) {
      const a = A.s[key];
      const c = B.s[key];
      if (typeof a === 'number' && typeof c === 'number') out[key] = ANGLES.has(key) ? lerpAngle(a, c, k) : a + (c - a) * k;
      else out[key] = k < 0.5 ? a : c;
    }
    return true;
  }
}
