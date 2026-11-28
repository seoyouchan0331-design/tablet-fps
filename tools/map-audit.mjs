/**
 * Map audit: structural mistakes a player would notice, for every map.
 *
 *   overlap   two solid boxes that interpenetrate by more than 0.2 m3 (flicker, things stuck in walls)
 *   float     a solid piece hanging in the air with nothing under or beside it
 *   island    standable places nobody can walk to (closed rooms, sealed gaps)
 *   prop      a solid prop sunk into a box
 *
 *   node tools/map-audit.mjs [map ...]
 */
import { MAPS } from '../src/arena/layout.js';
import { insideXZ, topAt } from '../src/arena/shapes.js';
import { buildNav } from '../src/party/bots.js';

const only = process.argv.slice(2);
const solid = (b) => !b.deco && !b.hidden && !b.floor && !b.wall;
const aabb = (b) => {
  const c = Math.abs(Math.cos(b.ry ?? 0)), s = Math.abs(Math.sin(b.ry ?? 0));
  const ex = (c * b.w + s * b.d) / 2, ez = (s * b.w + c * b.d) / 2;
  return { x0: b.x - ex, x1: b.x + ex, y0: b.y - b.h / 2, y1: b.y + b.h / 2, z0: b.z - ez, z1: b.z + ez };
};
const inter = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)) * Math.max(0, Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0));
const name = (b) => `${b.prop ?? (b.ramp ? 'ramp' : b.shear ? 'rail' : 'box')}@${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)}`;

for (const [id, m] of Object.entries(MAPS)) {
  if (only.length && !only.includes(id)) continue;
  const L = m.layout;
  const boxes = L.boxes.filter(solid);
  const plain = boxes.filter((b) => !b.prop && !b.ry && !b.ramp && !b.shear);
  const issues = { overlap: [], float: [], island: [], prop: [] };

  // overlap between plain boxes (rotated / props / ramps are loose boxes: skipped)
  for (let i = 0; i < plain.length; i++) {
    const A = aabb(plain[i]);
    for (let j = i + 1; j < plain.length; j++) {
      const B = aabb(plain[j]);
      const v = inter(A, B);
      const minVol = Math.min(plain[i].w * plain[i].h * plain[i].d, plain[j].w * plain[j].h * plain[j].d);
      // (smaller: a parapet post through its band, a sill, a corner lap: hidden inside)
      if (v > 0.2 && v > 0.05 * minVol) issues.overlap.push(`${name(plain[i])} x ${name(plain[j])} (${v.toFixed(2)} m3)`);
    }
  }
  // solid props sunk into plain boxes
  for (const p of boxes.filter((b) => b.prop)) {
    const A = aabb(p);
    for (const b of plain) {
      const v = inter(A, aabb(b));
      if (v > 0.1 && v > 0.2 * (p.w * p.h * p.d)) issues.prop.push(`${name(p)} in ${name(b)} (${v.toFixed(2)} m3)`);
    }
  }
  // floating: bottom above ground with no support under it and nothing it leans on
  const floors = L.boxes.filter((b) => b.floor);
  const ground = (x, z) => Math.max(0, ...floors.filter((f) => insideXZ(f, x, z)).map((f) => f.y + f.h / 2));
  for (const b of boxes) {
    const A = aabb(b);
    if (A.y0 - ground(b.x, b.z) < 0.05) continue;
    const touches = L.boxes.some((o) => o !== b && !o.deco && !o.hidden && inter(
      { x0: A.x0 - 0.06, x1: A.x1 + 0.06, y0: A.y0 - 0.06, y1: A.y1 + 0.06, z0: A.z0 - 0.06, z1: A.z1 + 0.06 }, aabb(o)) > 0);
    if (!touches) issues.float.push(name(b));
  }
  // islands: walk-graph levels below roof height not connected to the main area
  const g = buildNav(L);
  const comp = new Int32Array(g.nodes.length).fill(-1);
  const sizes = [];
  for (let s = 0; s < g.nodes.length; s++) {
    if (comp[s] !== -1) continue;
    const c = sizes.length;
    let n = 0;
    const st = [s];
    comp[s] = c;
    while (st.length) { const i = st.pop(); n++; for (const j of g.edges[i]) if (comp[j] === -1) { comp[j] = c; st.push(j); } }
    sizes.push(n);
  }
  const main = sizes.indexOf(Math.max(...sizes));
  const groups = new Map();
  g.nodes.forEach((n, i) => {
    if (comp[i] === main || n.y > 6 || n.y < -3.5) return;
    if (!groups.has(comp[i])) groups.set(comp[i], []);
    groups.get(comp[i]).push(n);
  });
  // a top a player mantles onto from the main area (a crate, a ledge) is fine
  const MANTLE = 1.9;
  const mainNear = (n) => g.nodes.some((m, i) => comp[i] === main && Math.hypot(m.x - n.x, m.z - n.z) < 1.6 && n.y - m.y <= MANTLE && n.y - m.y > -0.2);
  for (const [, ns] of groups) {
    if (ns.length < 3) continue; // a crate top, a sill
    if (ns.some(mainNear)) continue;
    const cx = ns.reduce((a, n) => a + n.x, 0) / ns.length, cz = ns.reduce((a, n) => a + n.z, 0) / ns.length;
    issues.island.push(`${ns.length} cells around ${cx.toFixed(1)},${ns[0].y.toFixed(1)},${cz.toFixed(1)}`);
  }
  console.log(`\n== ${id}: ${Object.entries(issues).map(([k, v]) => `${k} ${v.length}`).join(', ')}`);
  for (const [k, v] of Object.entries(issues)) for (const line of v.slice(0, 200)) console.log(`  ${k}: ${line}`);
}
