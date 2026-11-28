/**
 * Party bots, simulated by the host only. To everyone else a bot is a player
 * like any other: its state goes out in the host's batches, its shots as
 * 'p.fire', its hits as 'p.hp'.
 *
 * Navigation (buildNav): a 1 m grid over the map where every cell can hold
 * several standing levels — the ground, a stair's slope, an upper floor, the
 * tower platform. A level is a surface (the floor or the top of a piece)
 * with 1.8 m of headroom and no piece within 0.35 m at body height.
 * Neighbouring levels connect when they differ by at most 0.65 m (a stair
 * step of the grid), never cutting a corner. So bots climb stairs and use
 * galleries, bridges, terraces and the tower like players.
 *
 * Behaviour, per bot (BOT_LEVELS tunes it):
 *   - no enemy in sight: walk toward the nearest enemy (re-planned every
 *     second), or roam;
 *   - an enemy in sight: stop and strafe, turn toward them, wait a
 *     reaction time, then fire at the weapon's rate with a hit chance that
 *     falls with distance.
 * Pure logic: the host passes positions and a line-of-sight test in.
 */
import { insideXZ, topAt } from '../arena/shapes.js';

const STEP = 1;
const SPEED = 4.2; // m/s, a jog
const EYE = 1.6;
const HEAD = 1.75; // headroom a level needs (a standing player)
const BODY = 0.25; // clearance round the body (a 1.6 m door between two grid cells leaves 0.3)
const CLIMB = 0.65; // biggest height change between neighbouring levels

export const BOT_LEVELS = {
  easy: { label: 'EASY', reaction: 0.8, aim: 0.55, sight: 30, rate: 1.7, head: 0.05 },
  normal: { label: 'NORMAL', reaction: 0.45, aim: 1, sight: 45, rate: 1.25, head: 0.12 },
  hard: { label: 'HARD', reaction: 0.25, aim: 1.3, sight: 60, rate: 1, head: 0.22 },
};

/** Top of a piece at (x, z), or near it (a ramp's surface at the nearest point of its footprint). */
function surfaceNear(b, x, z) {
  if (!b.ramp) return b.y + b.h / 2;
  if (b.ry) return b.y + b.h / 2;
  const cx = Math.max(b.x - b.w / 2, Math.min(b.x + b.w / 2, x));
  const cz = Math.max(b.z - b.d / 2, Math.min(b.z + b.d / 2, z));
  return topAt(b, cx, cz);
}

/** The walkable levels of a layout, and how they connect. */
export function buildNav(layout) {
  const hx = layout.size / 2 - 1.5, hz = (layout.depth ?? layout.size) / 2 - 1.5;
  const cols = Math.floor((2 * hx) / STEP) + 1, rows = Math.floor((2 * hz) / STEP) + 1;
  // (the tower roof's box spans the whole platform; its posts stand on the
  // parapet corners, where nobody walks)
  const solid = layout.boxes.filter((b) => !b.deco && !b.floor && b.prop !== 'towerroof');
  const nodes = []; // {x, y, z, cell}
  const cells = Array.from({ length: cols * rows }, () => []); // node ids per cell
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -hx + c * STEP, z = -hz + r * STEP;
      const near = solid.filter((b) => insideXZ(b, x, z, BODY + 0.5));
      const tops = [0];
      for (const b of near) {
        if (!insideXZ(b, x, z, 0)) continue;
        const h = b.ramp ? topAt(b, x, z) : b.y + b.h / 2;
        if (h > 0.05 && h < 12) tops.push(h);
      }
      tops.sort((a, b) => a - b);
      let last = -1;
      for (const h of tops) {
        if (h - last < 0.1) continue;
        last = h;
        const blocked = near.some((b) => {
          if (!insideXZ(b, x, z, BODY)) return false;
          const bottom = b.y - b.h / 2;
          const top = b.ramp ? surfaceNear(b, x, z) : b.y + b.h / 2;
          return bottom < h + HEAD && top > h + 0.08;
        });
        if (blocked) continue;
        const id = nodes.length;
        nodes.push({ x, y: h, z, cell: r * cols + c });
        cells[r * cols + c].push(id);
      }
    }
  }
  const at = (c, r) => (c >= 0 && r >= 0 && c < cols && r < rows ? cells[r * cols + c] : []);
  const levelNear = (c, r, y) => at(c, r).find((i) => Math.abs(nodes[i].y - y) <= CLIMB);
  const edges = nodes.map(() => []);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    for (const i of cells[r * cols + c]) {
      const y = nodes[i].y;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const j = levelNear(c + dc, r + dr, y);
        if (j == null) continue;
        if (dr && dc && (levelNear(c + dc, r, y) == null || levelNear(c, r + dr, y) == null)) continue; // no corner cutting
        edges[i].push(j);
      }
    }
  }
  return { hx, hz, cols, rows, nodes, cells, edges };
}

export const cellOf = (g, x, z) => ({
  c: Math.max(0, Math.min(g.cols - 1, Math.round((x + g.hx) / STEP))),
  r: Math.max(0, Math.min(g.rows - 1, Math.round((z + g.hz) / STEP))),
});

/** The level nearest a point (same cell first, then a widening ring), or null. */
export function nearestNode(g, x, y, z) {
  const { c, r } = cellOf(g, x, z);
  for (let rad = 0; rad < 6; rad++) {
    let best = null, bd = Infinity;
    for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
      if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= g.cols || rr >= g.rows) continue;
      for (const i of g.cells[rr * g.cols + cc]) {
        const d = Math.abs(g.nodes[i].y - y) * 2 + Math.hypot(dc, dr);
        if (d < bd) { bd = d; best = i; }
      }
    }
    if (best != null) return best;
  }
  return null;
}

/** A* over the levels: waypoints {x, y, z} from near `from` to near `to`, or null. */
export function findPath(g, from, to, maxNodes = 12000) {
  const a = nearestNode(g, from.x, from.y ?? 0, from.z), b = nearestNode(g, to.x, to.y ?? 0, to.z);
  if (a == null || b == null) return null;
  const N = g.nodes.length;
  const gs = new Float32Array(N).fill(Infinity), f = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const T = g.nodes[b];
  const h = (i) => { const n = g.nodes[i]; return Math.hypot(n.x - T.x, n.z - T.z, (n.y - T.y) * 1.5); };
  const open = [a];
  gs[a] = 0;
  f[a] = h(a);
  let n = 0;
  while (open.length && n++ < maxNodes) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
    const cur = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    if (cur === b) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const P = g.nodes[cur];
    for (const j of g.edges[cur]) {
      const Q = g.nodes[j];
      const ng = gs[cur] + Math.hypot(Q.x - P.x, Q.z - P.z, Q.y - P.y);
      if (ng < gs[j]) {
        gs[j] = ng;
        f[j] = ng + h(j);
        came[j] = cur;
        open.push(j);
      }
    }
  }
  if (came[b] === -1 && b !== a) return null;
  const path = [];
  for (let i = b; i !== -1 && i !== a; i = came[i]) path.push({ ...g.nodes[i] });
  return path.reverse();
}

/** Chance a bot's shot lands, by distance: sure up close, a long shot is a gamble. */
export function hitChance(d, aim = 1) {
  return Math.max(0.08, Math.min(0.9, (0.8 - d * 0.016) * aim));
}

export class Bot {
  /**
   * @param {{id:number, grid:object, weapon:{id:string, damage:number, cycleTime:number}, level?:string, rng?:()=>number}} o
   */
  constructor({ id, grid, weapon, level = 'normal', rng = Math.random }) {
    this.id = id;
    this.grid = grid;
    this.weapon = weapon;
    this.skill = BOT_LEVELS[level] ?? BOT_LEVELS.normal;
    this.rng = rng;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.alive = true;
    this.path = null;
    this._replan = 0;
    this._target = null; // id of the enemy being engaged
    this._seenFor = 0;
    this._cool = 0;
    this._strafe = 1;
    this._strafeT = 0;
    this.moving = false;
  }

  place(x, z, yaw = 0, y = 0) {
    this._sideGoal = null;
    this.x = x;
    this.y = y;
    this.z = z;
    this.yaw = yaw;
    this.path = null;
    this._target = null;
    this._seenFor = 0;
  }

  /**
   * @param {number} dt
   * @param {{enemies:{id:number,x:number,y:number,z:number}[], los:(a:object,b:object)=>boolean, goal?:{x:number,y:number,z:number}|null}} w
   *   goal: where to go when nobody is in sight (the hill); default the nearest enemy
   * @returns {{fire?:{target:number, hit:boolean, head:boolean, from:number[]}}}
   */
  update(dt, w) {
    const out = {};
    const S = this.skill;
    this.moving = false;
    if (!this.alive) return out;
    const eye = { x: this.x, y: this.y + EYE, z: this.z };
    // the nearest enemy in sight
    let tgt = null, td = Infinity;
    for (const e of w.enemies) {
      const d = Math.hypot(e.x - this.x, e.y - this.y, e.z - this.z);
      if (d < S.sight && d < td && w.los(eye, { x: e.x, y: e.y + 1.3, z: e.z })) { tgt = e; td = d; }
    }
    if (tgt) {
      if (this._target !== tgt.id) { this._target = tgt.id; this._seenFor = 0; }
      this._seenFor += dt;
      const dx = tgt.x - this.x, dz = tgt.z - this.z;
      this.yaw = Math.atan2(-dx, -dz);
      this.pitch = Math.atan2(tgt.y + 1.3 - (this.y + EYE), Math.hypot(dx, dz));
      // strafe a little while shooting
      this._strafeT -= dt;
      if (this._strafeT <= 0 || this._sideGoal == null) {
        this._strafe = this.rng() < 0.5 ? -1 : 1;
        this._strafeT = 0.6 + this.rng() * 0.8;
        this._sideGoal = this._sideStep(Math.cos(this.yaw) * this._strafe, -Math.sin(this.yaw) * this._strafe);
      }
      if (this._sideGoal != null && this._walkTo(this.grid.nodes[this._sideGoal], dt * 0.45)) this._sideGoal = null;
      this._cool -= dt;
      if (this._seenFor >= S.reaction && this._cool <= 0) {
        this._cool = this.weapon.cycleTime * (this.weapon.id === 'rifle' || this.weapon.id === 'smg' ? S.rate * 1.3 : S.rate);
        out.fire = { target: tgt.id, hit: this.rng() < hitChance(td, S.aim), head: this.rng() < S.head, from: [this.x, this.y + EYE, this.z] };
      }
      this.path = null;
      return out;
    }
    this._target = null;
    this._seenFor = 0;
    // hunt: walk toward the nearest enemy (or anywhere)
    this._replan -= dt;
    if (!this.path?.length || this._replan <= 0) {
      this._replan = 1 + this.rng() * 0.5;
      let goal = w.goal ?? null, gd = goal ? 0 : Infinity;
      if (!goal) for (const e of w.enemies) {
        const d = Math.hypot(e.x - this.x, e.z - this.z);
        if (d < gd) { gd = d; goal = e; }
      }
      if (!goal) {
        const n = this.grid.nodes[Math.floor(this.rng() * this.grid.nodes.length)];
        goal = n ?? { x: 0, y: 0, z: 0 };
      }
      this.path = findPath(this.grid, this, goal) ?? [];
    }
    const wp = this.path[0];
    if (wp) {
      const dx = wp.x - this.x, dz = wp.z - this.z;
      if (Math.hypot(dx, dz) > 0.05) {
        this.yaw = Math.atan2(-dx, -dz);
        this.pitch = 0;
      }
      if (this._walkTo(wp, dt)) this.path.shift();
    }
    return out;
  }

  /** Walk toward a level's centre (straight, along a graph edge); true on arrival. */
  _walkTo(wp, dt) {
    const dx = wp.x - this.x, dz = wp.z - this.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) {
      this.y = wp.y;
      return true;
    }
    const step = Math.min(d, SPEED * dt);
    this.y += ((wp.y - this.y) * step) / d; // height follows the slope
    this.x += (dx / d) * step;
    this.z += (dz / d) * step;
    this.moving = true;
    return false;
  }

  /** A neighbouring level roughly in direction (dx, dz) to sidestep onto, or null. */
  _sideStep(dx, dz) {
    const g = this.grid;
    const here = nearestNode(g, this.x, this.y, this.z);
    if (here == null) return null;
    let best = null, bd = 0.5;
    for (const j of g.edges[here]) {
      const n = g.nodes[j];
      const ex = n.x - g.nodes[here].x, ez = n.z - g.nodes[here].z;
      const dot = (ex * dx + ez * dz) / Math.hypot(ex, ez);
      if (dot > bd) { bd = dot; best = j; }
    }
    return best;
  }
}
