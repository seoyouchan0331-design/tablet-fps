/**
 * UnstuckSystem — a player must never stay trapped.
 *
 * Automatic: if the player's capsule has been inside geometry for 0.6 s, or
 * the player is out of the map (past the outer walls, or fallen below it),
 * they are moved to the nearest place a player can stand on the map's main
 * walkable area.
 *
 * On request (the pause menu's STUCK? MOVE ME, or `unstuck.rescue()`): the
 * same move, for a spot the player can't climb out of without being inside
 * anything.
 *
 * "The main walkable area" is the largest connected part of the bots' walk
 * graph (party/bots.js), built once per map.
 */
import { buildNav } from '../party/bots.js';
import { insideXZ, topAt } from '../arena/shapes.js';

/**
 * Is a point inside a solid piece of the map? The physics can't tell: a
 * capsule wholly inside a thick box touches none of its faces, so it reads
 * as free space (and the box's inner faces then hold the player in). Boxes,
 * ramps (below their slope), floor slabs and outer walls count; props don't
 * (their boxes are loose: an arch is mostly air).
 */
export function insideSolid(layout, x, y, z) {
  for (const b of layout.boxes) {
    if (b.deco || b.prop || b.rail || b.hidden && !b.ramp) continue;
    if (!insideXZ(b, x, z, -0.04)) continue;
    const bottom = b.y - b.h / 2;
    const top = b.ramp ? topAt(b, x, z) : b.y + b.h / 2;
    if (y > bottom + 0.04 && y < top - 0.12) return true;
  }
  return false;
}

const INSIDE_S = 0.6;

export class UnstuckSystem {
  static id = 'unstuck';
  static deps = ['player', 'physics', 'world'];

  async init(ctx) {
    this.ctx = ctx;
    this._navs = new Map(); // map id -> { nav, main: Uint8Array }
    this._inside = 0;
    this._acc = 0;
    this.rescues = 0;
    this.insideSolid = insideSolid;
  }

  _navFor(id) {
    if (this._navs.has(id)) return this._navs.get(id);
    const layout = this.ctx.peek('world')?.layout;
    if (!layout) return null;
    const nav = buildNav(layout);
    // the largest connected area
    const comp = new Int32Array(nav.nodes.length).fill(-1);
    let best = -1, bestN = 0;
    for (let s = 0, c = 0; s < nav.nodes.length; s++, c++) {
      if (comp[s] !== -1) continue;
      let n = 0;
      const st = [s];
      comp[s] = c;
      while (st.length) {
        const i = st.pop();
        n++;
        for (const j of nav.edges[i]) if (comp[j] === -1) { comp[j] = c; st.push(j); }
      }
      if (n > bestN) { bestN = n; best = c; }
    }
    const main = new Uint8Array(nav.nodes.length);
    for (let i = 0; i < main.length; i++) main[i] = comp[i] === best ? 1 : 0;
    const v = { nav, main };
    this._navs.set(id, v);
    return v;
  }

  /** Move the player to the nearest clear standing spot of the main area. Returns true if moved. */
  rescue() {
    const player = this.ctx.peek('player');
    const world = this.ctx.peek('world');
    const mv = player?.movement;
    if (!mv || !world) return false;
    const N = this._navFor(world.mapId);
    if (!N) return false;
    const P = mv.position;
    const c = mv.character;
    // nearest main-area level that is clear for a standing capsule, preferring the same height
    const ranked = [];
    for (let i = 0; i < N.nav.nodes.length; i++) {
      if (!N.main[i]) continue;
      const n = N.nav.nodes[i];
      ranked.push([Math.hypot(n.x - P.x, n.z - P.z) + Math.abs(n.y - P.y) * 1.5, n]);
    }
    ranked.sort((a, b) => a[0] - b[0]);
    for (const [, n] of ranked.slice(0, 60)) {
      if (!c.checkCapsule(n.x, n.y + 0.05, n.z) || insideSolid(this.ctx.peek('world').layout, n.x, n.y + 0.5, n.z)) continue;
      mv.teleport(n.x, n.y + 0.05, n.z);
      this.rescues++;
      this.ctx.events.emit('player:unstuck', { x: n.x, y: n.y, z: n.z });
      return true;
    }
    const sp = world.spawn?.(0);
    if (sp) {
      mv.teleport(sp.position.x, world.groundHeight(sp.position.x, sp.position.z) + 0.05, sp.position.z);
      this.rescues++;
      return true;
    }
    return false;
  }

  update(dt, ctx) {
    this._acc += dt;
    if (this._acc < 0.1) return;
    const step = this._acc;
    this._acc = 0;
    const player = ctx.peek('player');
    const mv = player?.movement;
    const L = ctx.peek('world')?.layout;
    if (!mv?.character || !L || player.dead) return;
    if (mv.mantleMotion?.active) {
      this._inside = 0; // a mantle passes through its own lip on purpose
      return;
    }
    const P = mv.position;
    // off the edge of a map over the void: in a match the host kills the
    // faller (and respawns them); give it a few seconds before stepping in
    const fell = L.killY != null && P.y < L.killY;
    this._falling = fell ? (this._falling ?? 0) + step : 0;
    const matchLive = ctx.peek('party')?.phase === 'match' || ctx.peek('match')?.live;
    if (fell && matchLive && this._falling < 3) {
      mv.velocity?.set?.(0, 0, 0); // hang there (out of sight below the deck) until the verdict
      return;
    }
    const out = Math.abs(P.x) > L.size / 2 - 0.5 || Math.abs(P.z) > (L.depth ?? L.size) / 2 - 0.5 || P.y < (L.killY ?? -12);
    const c = mv.character;
    const inside = !c.checkCapsule(P.x, P.y + 0.02, P.z, c.height) || insideSolid(L, P.x, P.y + 0.5, P.z);
    this._inside = inside ? this._inside + step : 0;
    if (out || this._inside > INSIDE_S) {
      this._inside = 0;
      this.rescue();
    }
  }
}
