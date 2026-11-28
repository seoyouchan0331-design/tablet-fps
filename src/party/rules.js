/**
 * Party rules — deathmatch for 2-8 players, run by the host as a pure state
 * machine (no DOM, no network: unit-tested).
 *
 *   countdown (3 s) -> live -> end   (score limit reached, or time up)
 *
 * Modes:
 *   ffa  every player for themselves; first to `scoreLimit` kills wins
 *   tdm  two teams (0, 1); first team to `scoreLimit` kills wins; no
 *        friendly fire
 * A dead player respawns after `respawn` seconds and can't be hurt for
 * `protect` seconds after that. Events returned for the host to broadcast:
 *   { type: 'countdown', time } | { type: 'live', time }
 *   { type: 'kill', killer, victim, scores }
 *   { type: 'respawn', id }
 *   { type: 'end', winner, standings, teams }
 */
export const PARTY_MODES = {
  ffa: { label: 'FREE FOR ALL', limits: [10, 20, 30], def: 20 },
  tdm: { label: 'TEAM DEATHMATCH', limits: [20, 40, 60], def: 40 },
};
export const TIME_LIMITS = [300, 600];

export class Deathmatch {
  constructor({ mode = 'ffa', scoreLimit = 20, timeLimit = 300, respawn = 3, protect = 1.5, countdown = 3 } = {}) {
    this.mode = mode === 'tdm' ? 'tdm' : 'ffa';
    this.scoreLimit = scoreLimit;
    this.timeLimit = timeLimit;
    this.respawnDelay = respawn;
    this.protect = protect;
    this.countdown = countdown;
    this.state = 'idle';
    this.clock = 0; // seconds since start()
    this.timeLeft = 0;
    /** @type {Map<number, {id:number, team:number, kills:number, deaths:number, alive:boolean, respawnAt:number, safeUntil:number}>} */
    this.players = new Map();
  }

  /** @param {{id:number, team?:number}[]} roster */
  start(roster) {
    this.players.clear();
    for (const p of roster) this.players.set(p.id, { id: p.id, team: this.mode === 'tdm' ? (p.team ?? 0) : p.id, kills: 0, deaths: 0, alive: true, respawnAt: 0, safeUntil: 0 });
    this.clock = 0;
    this.state = 'countdown';
    this.timeLeft = this.countdown;
    this.winner = null;
    return [{ type: 'countdown', time: this.countdown }];
  }

  scores() {
    const out = {};
    for (const p of this.players.values()) out[p.id] = [p.kills, p.deaths];
    return out;
  }

  teamScores() {
    const t = [0, 0];
    if (this.mode === 'tdm') for (const p of this.players.values()) t[p.team] += p.kills;
    return t;
  }

  /** Can `shooter` hurt `target` right now? */
  canHit(shooter, target) {
    if (this.state !== 'live' || shooter === target) return false;
    const a = this.players.get(shooter), b = this.players.get(target);
    if (!a || !b || !a.alive || !b.alive) return false;
    if (this.mode === 'tdm' && a.team === b.team) return false;
    return this.clock >= b.safeUntil;
  }

  kill(killer, victim) {
    const v = this.players.get(victim);
    if (this.state !== 'live' || !v?.alive) return [];
    v.alive = false;
    v.deaths++;
    v.respawnAt = this.clock + this.respawnDelay;
    const k = this.players.get(killer);
    if (k && killer !== victim) k.kills++;
    const out = [{ type: 'kill', killer, victim, scores: this.scores(), teams: this.teamScores() }];
    const lead = this.mode === 'tdm' ? Math.max(...this.teamScores()) : (k?.kills ?? 0);
    if (lead >= this.scoreLimit) out.push(this._end());
    return out;
  }

  /** A player left: drop them; the match ends if fewer than 2 remain (or one team is empty). */
  remove(id) {
    if (!this.players.delete(id) || this.state === 'idle' || this.state === 'end') return [];
    const teams = new Set([...this.players.values()].map((p) => p.team));
    if (this.players.size < 2 || (this.mode === 'tdm' && teams.size < 2)) return [this._end()];
    return [];
  }

  tick(dt) {
    if (this.state === 'idle' || this.state === 'end') return [];
    this.clock += dt;
    this.timeLeft -= dt;
    const out = [];
    if (this.state === 'countdown') {
      if (this.timeLeft <= 1e-9) {
        this.state = 'live';
        this.timeLeft = this.timeLimit;
        out.push({ type: 'live', time: this.timeLimit });
      }
      return out;
    }
    for (const p of this.players.values()) {
      if (!p.alive && this.clock >= p.respawnAt) {
        p.alive = true;
        p.safeUntil = this.clock + this.protect;
        out.push({ type: 'respawn', id: p.id });
      }
    }
    if (this.timeLeft <= 1e-9) out.push(this._end());
    return out;
  }

  /** Best first: kills, then fewer deaths, then id. */
  standings() {
    return [...this.players.values()]
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.id - b.id)
      .map((p) => ({ id: p.id, team: p.team, kills: p.kills, deaths: p.deaths }));
  }

  _end() {
    this.state = 'end';
    const st = this.standings();
    const teams = this.teamScores();
    let winner = null;
    if (this.mode === 'tdm') winner = teams[0] === teams[1] ? null : teams[0] > teams[1] ? 0 : 1;
    else if (st.length && (st.length < 2 || st[0].kills > st[1].kills)) winner = st[0].id;
    this.winner = winner;
    return { type: 'end', winner, standings: st, teams };
  }
}

/* ----------------------------------------------------------------- spawns -- */

/**
 * Open ground to spawn on, from a layout: a 3 m grid inside the outer walls,
 * keeping points with no piece (box, ramp, prop, house) within 0.8 m.
 * @param {{size:number, depth?:number, boxes:object[]}} layout
 * @param {(b:object, x:number, z:number, margin:number)=>boolean} insideXZ
 */
export function spawnCandidates(layout, insideXZ) {
  const hx = layout.size / 2 - 3, hz = (layout.depth ?? layout.size) / 2 - 3;
  const solid = layout.boxes.filter((b) => !b.floor && !b.wall && !b.deco);
  const out = [];
  for (let x = -hx; x <= hx + 1e-6; x += 3) {
    for (let z = -hz; z <= hz + 1e-6; z += 3) {
      if (!solid.some((b) => insideXZ(b, x, z, 0.8))) out.push({ x, z });
    }
  }
  return out;
}

/**
 * Where to respawn: the candidate whose nearest living enemy is farthest
 * away, picked at random among the best few so spawns don't repeat. In a
 * team match, only candidates on the team's own half (`side`: +1 or -1 along
 * `axis`, the line between the map's two duel spawns).
 * @param {{x:number,z:number}[]} cands
 * @param {{x:number,z:number}[]} enemies  living enemies' positions
 * @param {{side?:number, axis?:{x:number,z:number}, rng?:()=>number}} [opt]
 */
export function pickSpawn(cands, enemies, { side = 0, axis = { x: 1, z: 0 }, rng = Math.random } = {}) {
  let pool = side ? cands.filter((c) => Math.sign(c.x * axis.x + c.z * axis.z) === side) : cands;
  if (!pool.length) pool = cands;
  if (!pool.length) return { x: 0, z: 0, yaw: 0 };
  const far = (c) => (enemies.length ? Math.min(...enemies.map((e) => Math.hypot(e.x - c.x, e.z - c.z))) : rng() * 100);
  const ranked = pool.map((c) => ({ c, d: far(c) })).sort((a, b) => b.d - a.d);
  const top = ranked.slice(0, Math.min(4, ranked.length));
  const c = top[Math.floor(rng() * top.length)].c;
  // face the middle of the map
  return { x: c.x, z: c.z, yaw: Math.atan2(c.x, c.z) };
}
