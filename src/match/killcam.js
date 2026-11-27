/**
 * Killcam: after you die the view swings to whoever killed you and holds
 * there through the round-end pause. Pure angle maths, unit tested.
 */

/** Wrap an angle to (-PI, PI]. */
const wrap = (a) => a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;

/**
 * View angles that look from `eye` at `target`, eased from `from` by k (0..1),
 * turning the short way round. Yaw 0 looks down -Z; +yaw turns left.
 */
export function killcamAngles(eye, target, from, k) {
  const dx = target.x - eye.x, dy = target.y - eye.y, dz = target.z - eye.z;
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));
  const t = Math.min(1, Math.max(0, k));
  const e = 1 - (1 - t) ** 3; // ease out
  return { yaw: wrap(from.yaw + wrap(yaw - from.yaw) * e), pitch: from.pitch + (pitch - from.pitch) * e };
}
