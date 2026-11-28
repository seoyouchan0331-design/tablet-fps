/**
 * Party rules — deathmatch for 2-8 players, run by the host as a pure state
 * machine (no DOM, no network: unit-tested).
 *
 *   countdown (3 s) -> live -> end   (score limit reached, or time up)
 *
 * Modes:
 *   ffa   every player for themselves; first to `scoreLimit` kills wins
 *   tdm   two teams (0, 1); first team to `scoreLimit` kills wins; no
 *         friendly fire
 *   koth  two teams; a team alone in the hill (the zone in the middle)
 *         scores a point a second; first to `scoreLimit` points wins
 *   gun   gun game: every player for themselves; the primary changes
 *         every 2 kills along GUN_LADDER; the first to finish it wins
 * A dead player respawns after `respawn` seconds and can't be hurt for
 * `protect` seconds after that. Events returned for the host to broadcast:
 *   { type: 'countdown', time } | { type: 'live', time }
 *   { type: 'kill', killer, victim, scores }
 *   { type: 'respawn', id }
 *   { type: 'zone', teams, holder }  (koth: a point scored, or the hill changed hands)
 *   { type: 'end', winner, standings, teams }
 */
export const PARTY_MODES = {
  ffa: { label: 'FREE FOR ALL', limits: [10, 20, 30], def: 20 },
  tdm: { label: 'TEAM DEATHMATCH', limits: [20, 40, 60], def: 40, team: true },
  koth: { label: 'KING OF THE HILL', limits: [60, 100, 150], def: 100, team: true, unit: 'POINTS' },
  gun: { label: 'GUN GAME', limits: [8], def: 8 },
};
export const isTeamMode = (mode) => !!PARTY_MODES[mode]?.team;
/** Gun game: the primary for a number of kills (2 kills a step). */
export const GUN_LADDER = ['rifle', 'smg', 'shotgun', 'sniper'];
export const gunFor = (kills) => GUN_LADDER[Math.min(GUN_LADDER.length - 1, Math.floor(kills / 2))];
/** The hill: a circle round the middle of the map. */
export const HILL = { x: 0, z: 0, r: 7, h: 4 };
export const TIME_LIMITS = [300, 600];

export class Deathmatch {
  constructor({ mode = 'ffa', scoreLimit = 20, timeLimit = 300, respawn = 3, protect = 1.5, countdown = 3 } = {}) {
    this.mode = PARTY_MODES[mode] ? mode : 'ffa';
    this.team = isTeamMode(this.mode);
    this.zone = [0, 0];
    this.holder = null;
    this._zoneAcc = 0;
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
    for (const p of roster) this.players.set(p.id, { id: p.id, team: this.team ? (p.team ?? 0) : p.id, kills: 0, deaths: 0, alive: true, respawnAt: 0, safeUntil: 0 });
    this.zone = [0, 0];
    this.holder = null;
    this._zoneAcc = 0;
    this.clock = 0;
    this.state = 'countdown';
    this.timeLeft = this.countdown;
    this.winner = null;
    return [{ type: 'countdown', time: this.countdown }];
  }

  /**
   * Pick a match up where another host left it (host migration): the
   * scores, who is alive, the clock and the hill as every player knew them.
   * @param {{state:string, timeLeft:number, players:{id:number, team:number, kills:number, deaths:number, alive:boolean}[], zone?:number[]}} s
   */
  restore(s) {
    this.players.clear();
    for (const p of s.players) this.players.set(p.id, { id: p.id, team: this.team ? p.team : p.id, kills: p.kills, deaths: p.deaths, alive: p.alive, respawnAt: 1, safeUntil: 0 });
    this.clock = 0;
    this.state = s.state;
    this.timeLeft = s.timeLeft;
    this.zone = [...(s.zone ?? [0, 0])];
    this.holder = null;
    this._zoneAcc = 0;
    this.winner = null;
  }

  scores() {
    const out = {};
    for (const p of this.players.values()) out[p.id] = [p.kills, p.deaths];
    return out;
  }

  teamScores() {
    if (this.mode === 'koth') return [...this.zone];
    const t = [0, 0];
    if (this.team) for (const p of this.players.values()) t[p.team] += p.kills;
    return t;
  }

  /** Can `shooter` hurt `target` right now? */
  canHit(shooter, target) {
    if (this.state !== 'live' || shooter === target) return false;
    const a = this.players.get(shooter), b = this.players.get(target);
    if (!a || !b || !a.alive || !b.alive) return false;
    if (this.team && a.team === b.team) return false;
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
    if (this.mode === 'koth') return out; // the hill scores, not kills
    const lead = this.team ? Math.max(...this.teamScores()) : (k?.kills ?? 0);
    if (lead >= this.scoreLimit) out.push(this._end());
    return out;
  }

  /** A player joined mid-match: they come in dead and respawn within a moment. */
  add(id, team = 0) {
    if (this.players.has(id) || this.state === 'idle' || this.state === 'end') return;
    this.players.set(id, { id, team: this.team ? team : id, kills: 0, deaths: 0, alive: false, respawnAt: this.clock + 0.5, safeUntil: 0 });
  }

  /** A player left: drop them; the match ends if fewer than 2 remain (or one team is empty). */
  remove(id) {
    if (!this.players.delete(id) || this.state === 'idle' || this.state === 'end') return [];
    const teams = new Set([...this.players.values()].map((p) => p.team));
    if (this.players.size < 2 || (this.team && teams.size < 2)) return [this._end()];
    return [];
  }

  /**
   * @param {number} dt
   * @param {{inZone?:number[]}} [w]  koth: living players of each team inside the hill
   */
  tick(dt, w = {}) {
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
    if (this.mode === 'koth') {
      const [a, b] = w.inZone ?? [0, 0];
      const holder = a > 0 && !b ? 0 : b > 0 && !a ? 1 : null;
      if (holder !== this.holder) {
        this.holder = holder;
        this._zoneAcc = 0;
        out.push({ type: 'zone', teams: [...this.zone], holder });
      } else if (holder != null) {
        this._zoneAcc += dt;
        while (this._zoneAcc >= 1) {
          this._zoneAcc -= 1;
          this.zone[holder]++;
          out.push({ type: 'zone', teams: [...this.zone], holder });
          if (this.zone[holder] >= this.scoreLimit) {
            out.push(this._end());
            return out;
          }
        }
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
    if (this.team) winner = teams[0] === teams[1] ? null : teams[0] > teams[1] ? 0 : 1;
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
