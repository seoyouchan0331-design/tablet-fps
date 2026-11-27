/**
 * Host-side sanity check of a hit claimed by the shooter's client.
 *
 * Hits are detected on the shooter's own screen (what they saw is what they
 * hit); the host only rejects claims that cannot be true. Order matters: the
 * cheapest and most common rejections first, line of sight (a raycast) last.
 */
/** Longest shot that can be real: FIELD's corner-to-corner diagonal is ~113 m. */
const MAX_RANGE = 120;
const PARTS = new Set(['head', 'body']);
const vec = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n));

/**
 * @param {{shooter:'host'|'guest', target:'host'|'guest', weapon:string, t:number,
 *          from:number[], point:number[], part:'head'|'body'}} claim
 * @param {{live:boolean, alive:{host:boolean,guest:boolean}, lastFire:{host:number,guest:number},
 *          cycleTime:(weapon:string)=>number, lineOfSight:(from:number[],to:number[])=>boolean}} ctx
 * @returns {{ok:true}|{ok:false, reason:string}}
 */
export function validateHit(claim, ctx) {
  if (!claim || !vec(claim.from) || !vec(claim.point) || !PARTS.has(claim.part) || !Number.isFinite(claim.t))
    return { ok: false, reason: 'bad-claim' };
  if (!ctx.live) return { ok: false, reason: 'not-live' };
  if (!ctx.alive[claim.shooter] || !ctx.alive[claim.target]) return { ok: false, reason: 'dead' };
  const interval = claim.t - (ctx.lastFire[claim.shooter] ?? -Infinity);
  if (interval < 0.9 * ctx.cycleTime(claim.weapon)) return { ok: false, reason: 'fire-rate' };
  const [ax, ay, az] = claim.from;
  const [bx, by, bz] = claim.point;
  if (Math.hypot(bx - ax, by - ay, bz - az) > MAX_RANGE) return { ok: false, reason: 'range' };
  if (!ctx.lineOfSight(claim.from, claim.point)) return { ok: false, reason: 'no-los' };
  return { ok: true };
}

/**
 * Which shots already landed. A rifle round hits once; a shotgun shell may land
 * up to one hit per pellet, all under the same shot sequence number.
 */
export class HitLedger {
  constructor() {
    this.clear();
  }

  clear() {
    this._n = { host: new Map(), guest: new Map() };
  }

  /** Record a hit for `seq`; false when that shot has no hits left. */
  take(who, seq, max = 1) {
    const m = this._n[who];
    const n = m.get(seq) ?? 0;
    if (n >= max) return false;
    m.set(seq, n + 1);
    if (m.size > 64) m.delete(m.keys().next().value);
    return true;
  }
}
