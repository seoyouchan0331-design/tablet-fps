/**
 * Which animation clip a duel character should play, from what the network
 * (or the practice dummy) tells us: ground speed, airborne, alive.
 * Clip names are the RobotExpressive ones (public/models/robot.glb).
 *
 * Walk/run switch has hysteresis so a speed hovering at the threshold does not
 * flicker between clips; run playback speeds up with ground speed so the feet
 * roughly match the 35 %-faster arena movement.
 */
const IDLE_BELOW = 0.6; // m/s
const RUN_UP = 4.8; // walk -> run
const RUN_DOWN = 4.0; // run -> walk
const WALK_REF = 2.2; // speed at which the Walking clip looks right
const RUN_REF = 6.5; // speed at which the Running clip looks right

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * @param {{speed:number, air:boolean, alive:boolean}} s
 * @param {string} [current] clip playing now (for hysteresis)
 * @returns {{clip:'Idle'|'Walking'|'Running'|'Jump'|'Death', timeScale:number}}
 */
export function pickClip(s, current) {
  if (!s.alive) return { clip: 'Death', timeScale: 1 };
  if (s.air) return { clip: 'Jump', timeScale: 1 };
  if (s.speed < IDLE_BELOW) return { clip: 'Idle', timeScale: 1 };
  const runThreshold = current === 'Running' ? RUN_DOWN : RUN_UP;
  if (s.speed >= runThreshold) return { clip: 'Running', timeScale: clamp(s.speed / RUN_REF, 0.6, 2.2) };
  return { clip: 'Walking', timeScale: clamp(s.speed / WALK_REF, 0.6, 2.0) };
}
