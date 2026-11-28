/**
 * Compact player state for the party network: an array of integers instead
 * of a keyed object with 16-digit floats. Sent 20 times a second per player,
 * so this is most of a party's traffic.
 *
 *   [id, t, x, y, z, yaw, pitch, flags, weapon]
 *   t      sender clock, ms
 *   x y z  cm                 (error <= 0.5 cm)
 *   yaw    milliradians       (error <= 0.0005 rad, 0.03 deg)
 *   pitch  milliradians
 *   flags  1 alive, 2 in the air, 4 crouched, 8 reloading
 *   weapon index into WEAPONS (or the id itself if unknown)
 *
 * Only how OTHER players are drawn uses this. Hit claims (where I shot from
 * and what I hit) still travel at full precision.
 */
export const WEAPONS = ['rifle', 'smg', 'pistol', 'shotgun', 'sniper'];

const wrap = (a) => a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;

/** @param {{id:number,t:number,x:number,y:number,z:number,yaw:number,pitch:number,alive:boolean,air:boolean,crouch:boolean,rl:boolean,w:string}} s */
export function packState(s) {
  const wi = WEAPONS.indexOf(s.w);
  return [
    s.id,
    Math.round(s.t * 1000),
    Math.round(s.x * 100),
    Math.round(s.y * 100),
    Math.round(s.z * 100),
    Math.round(wrap(s.yaw) * 1000),
    Math.round(s.pitch * 1000),
    (s.alive ? 1 : 0) | (s.air ? 2 : 0) | (s.crouch ? 4 : 0) | (s.rl ? 8 : 0),
    wi >= 0 ? wi : String(s.w ?? 'rifle'),
  ];
}

/** Inverse of packState; null for anything malformed (it came off the network). */
export function unpackState(a) {
  if (!Array.isArray(a) || a.length < 9) return null;
  for (let i = 0; i < 8; i++) if (!Number.isFinite(a[i])) return null;
  const f = a[7];
  return {
    id: a[0],
    t: a[1] / 1000,
    x: a[2] / 100,
    y: a[3] / 100,
    z: a[4] / 100,
    yaw: a[5] / 1000,
    pitch: a[6] / 1000,
    alive: !!(f & 1),
    air: !!(f & 2),
    crouch: !!(f & 4),
    rl: !!(f & 8),
    w: typeof a[8] === 'number' ? (WEAPONS[a[8]] ?? 'rifle') : String(a[8]),
  };
}
