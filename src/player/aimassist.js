/**
 * Touch aim assist. Two gentle effects while the crosshair is within CONE of a
 * visible target: look input is slowed (so a flick doesn't overshoot) and the
 * view follows a fraction of the target's angular velocity (so a strafing
 * target doesn't slide out). It never rotates toward the target on its own:
 * tracking is a fraction of the target's motion, so it cannot snap.
 */
export const CONE = (3 * Math.PI) / 180;

/** level -> [lookScale inside the cone, tracking fraction] */
const STRENGTH = {
  off: [1, 0],
  low: [0.75, 0.25],
  medium: [0.55, 0.45],
};

const NONE = Object.freeze({ lookScale: 1, trackYaw: 0, trackPitch: 0 });

/**
 * @param {'off'|'low'|'medium'} level
 * @param {{yaw:number,pitch:number}} angErr  radians from crosshair to target
 * @param {{yaw:number,pitch:number}} targetAngVel  target's angular velocity as seen by the player, rad/s
 * @param {boolean} visible  line of sight to the target
 * @param {{lookScale:number,trackYaw:number,trackPitch:number}} [out]
 */
export function aimAssist(level, angErr, targetAngVel, visible, out) {
  const s = STRENGTH[level];
  const o = out ?? { lookScale: 1, trackYaw: 0, trackPitch: 0 };
  if (!s || s[1] === 0 || !visible || Math.hypot(angErr.yaw, angErr.pitch) > CONE) {
    o.lookScale = NONE.lookScale;
    o.trackYaw = NONE.trackYaw;
    o.trackPitch = NONE.trackPitch;
    return o;
  }
  o.lookScale = s[0];
  o.trackYaw = targetAngVel.yaw * s[1];
  o.trackPitch = targetAngVel.pitch * s[1];
  return o;
}
