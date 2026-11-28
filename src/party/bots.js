/**
 * Party bots, simulated by the host only. To everyone else a bot is a player
 * like any other: its state goes out in the host's batches, its shots as
 * 'p.fire', its hits as 'p.hp'.
 *
 * Navigation: a 1 m grid of open ground built from the map layout (no
 * piece within 0.45 m; bots stay on the ground floor), A* with diagonal
 * steps that never cut a corner. Behaviour, per bot:
 *   - no enemy in sight: walk to the nearest enemy's position (re-planned
 *     every second), or roam to a random open cell;
 *   - an enemy in sight within 45 m: stop and strafe, turn toward them,
 *     wait a human-ish reaction time, then fire at the weapon's rate with
 *     a hit chance that falls with distance.
 * Pure logic: the host passes positions and a line-of-sight test in.
 */
import { insideXZ } from '../arena/shapes.js';

const STEP = 1;
const SPEED = 4.2; // m/s, a jog
const EYE = 1.6;
const SIGHT = 45;

/** Open ground cells of a layout. */
export function buildGrid(layout) {
  const hx = layout.size / 2 - 1.5, hz = (layout.depth ?? layout.size) / 2 - 1.5;
  const cols = Math.floor((2 * hx) / STEP) + 1, rows = Math.floor((2 * hz) / STEP) + 1;
  const solid = layout.boxes.filter((b) => !b.floor && !b.wall && !b.deco);
  const open = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -hx + c * STEP, z = -hz + r * STEP;
      // pieces floating 2.4 m up or more (bridges, galleries) leave the ground free
      open[r * cols + c] = solid.some((b) => b.y - b.h / 2 < 2.2 && insideXZ(b, x, z, 0.45)) ? 0 : 1;
    }
  }
  return { hx, hz, cols, rows, open };
}

export const cellOf = (g, x, z) => ({
  c: Math.max(0, Math.min(g.cols - 1, Math.round((x + g.hx) / STEP))),
  r: Math.max(0, Math.min(g.rows - 1, Math.round((z + g.hz) / STEP))),
});
const centre = (g, c, r) => ({ x: -g.hx + c * STEP, z: -g.hz + r * STEP });
const isOpen = (g, c, r) => c >= 0 && r >= 0 && c < g.cols && r < g.rows && g.open[r * g.cols + c] === 1;

/** The open cell nearest (x, z) (spiral search), or null. */
export function nearestOpen(g, x, z) {
  const { c, r } = cellOf(g, x, z);
  for (let rad = 0; rad < 6; rad++) {
    for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
      if (Math.max(Math.abs(dr), Math.abs(dc)) === rad && isOpen(g, c + dc, r + dr)) return { c: c + dc, r: r + dr };
    }
  }
  return null;
}

/** A* over the grid: a list of waypoints (cell centres) from near `from` to near `to`, or null. */
export function findPath(g, from, to, maxNodes = 6000) {
  const a = nearestOpen(g, from.x, from.z), b = nearestOpen(g, to.x, to.z);
  if (!a || !b) return null;
  const N = g.cols * g.rows, start = a.r * g.cols + a.c, goal = b.r * g.cols + b.c;
  const gs = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const h = (i) => Math.hypot((i % g.cols) - b.c, Math.floor(i / g.cols) - b.r);
  const open = [start];
  const f = new Float32Array(N).fill(Infinity);
  gs[start] = 0;
  f[start] = h(start);
  let n = 0;
  while (open.length && n++ < maxNodes) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
    const cur = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cc = cur % g.cols, cr = Math.floor(cur / g.cols);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nc = cc + dc, nr = cr + dr;
      if (!isOpen(g, nc, nr)) continue;
      if (dr && dc && (!isOpen(g, cc + dc, cr) || !isOpen(g, cc, cr + dr))) continue; // no corner cutting
      const ni = nr * g.cols + nc;
      const ng = gs[cur] + (dr && dc ? Math.SQRT2 : 1);
      if (ng < gs[ni]) {
        gs[ni] = ng;
        f[ni] = ng + h(ni);
        came[ni] = cur;
        open.push(ni);
      }
    }
  }
  if (came[goal] === -1 && goal !== start) return null;
  const path = [];
  for (let i = goal; i !== -1 && i !== start; i = came[i]) path.push(centre(g, i % g.cols, Math.floor(i / g.cols)));
  return path.reverse();
}

/** Chance a bot's shot lands, by distance: sure up close, a long shot is a gamble. */
export function hitChance(d) {
  return Math.max(0.12, Math.min(0.75, 0.8 - d * 0.016));
}

export class Bot {
  /**
   * @param {{id:number, grid:object, weapon:{id:string, damage:number, cycleTime:number}, rng?:()=>number}} o
   */
  constructor({ id, grid, weapon, rng = Math.random }) {
    this.id = id;
    this.grid = grid;
    this.weapon = weapon;
    this.rng = rng;
    this.x = 0;
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

  place(x, z, yaw = 0) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.path = null;
    this._target = null;
    this._seenFor = 0;
  }

  /**
   * @param {number} dt
   * @param {{enemies:{id:number,x:number,y:number,z:number}[], los:(a:object,b:object)=>boolean}} w
   * @returns {{fire?:{target:number, hit:boolean, head:boolean, from:number[]}}}
   */
  update(dt, w) {
    const out = {};
    this.moving = false;
    if (!this.alive) return out;
    const eye = { x: this.x, y: EYE, z: this.z };
    // the nearest enemy in sight
    let tgt = null, td = Infinity;
    for (const e of w.enemies) {
      const d = Math.hypot(e.x - this.x, e.z - this.z);
      if (d < SIGHT && d < td && w.los(eye, { x: e.x, y: e.y + 1.3, z: e.z })) { tgt = e; td = d; }
    }
    if (tgt) {
      if (this._target !== tgt.id) { this._target = tgt.id; this._seenFor = 0; }
      this._seenFor += dt;
      const dx = tgt.x - this.x, dz = tgt.z - this.z;
      this.yaw = Math.atan2(-dx, -dz);
      this.pitch = Math.atan2(tgt.y + 1.3 - EYE, Math.hypot(dx, dz));
      // strafe a little while shooting
      this._strafeT -= dt;
      if (this._strafeT <= 0) { this._strafe = this.rng() < 0.5 ? -1 : 1; this._strafeT = 0.6 + this.rng() * 0.8; }
      const sx = Math.cos(this.yaw) * this._strafe, sz = -Math.sin(this.yaw) * this._strafe;
      this._move(sx, sz, dt * 0.45);
      this._cool -= dt;
      const reaction = 0.45;
      if (this._seenFor >= reaction && this._cool <= 0) {
        this._cool = this.weapon.cycleTime * (this.weapon.id === 'rifle' || this.weapon.id === 'smg' ? 1.6 : 1);
        out.fire = { target: tgt.id, hit: this.rng() < hitChance(td), head: this.rng() < 0.12, from: [this.x, EYE, this.z] };
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
      let goal = null, gd = Infinity;
      for (const e of w.enemies) {
        const d = Math.hypot(e.x - this.x, e.z - this.z);
        if (d < gd) { gd = d; goal = e; }
      }
      if (!goal) {
        const g = this.grid;
        goal = { x: -g.hx + this.rng() * 2 * g.hx, z: -g.hz + this.rng() * 2 * g.hz };
      }
      this.path = findPath(this.grid, this, goal) ?? [];
    }
    const wp = this.path[0];
    if (wp) {
      const dx = wp.x - this.x, dz = wp.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.3) this.path.shift();
      else {
        this.yaw = Math.atan2(-dx, -dz);
        this.pitch = 0;
        this._move(dx / d, dz / d, dt);
      }
    }
    return out;
  }

  _move(dx, dz, dt) {
    const nx = this.x + dx * SPEED * dt, nz = this.z + dz * SPEED * dt;
    const { c, r } = cellOf(this.grid, nx, nz);
    if (!isOpen(this.grid, c, r)) return;
    this.x = nx;
    this.z = nz;
    this.moving = true;
  }
}
