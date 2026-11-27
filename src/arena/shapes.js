/**
 * Map building blocks. A map is a list of pieces; each is a box
 *   { x, y, z, w, h, d }            centre and full size (metres)
 * with optional extras:
 *   ry: angle                        turned about the vertical axis
 *   ramp: '+x' | '-x' | '+z' | '-z'  a wedge that rises toward that side
 *                                    (in the piece's own, unturned frame)
 *   c: 0xrrggbb                      surface colour (default grey)
 *   e: 0xrrggbb                      edge-line colour (default neon cyan)
 *   prop: 'arch' | 'fountain'        a sculpted mesh made in Blender
 *                                    (tools/blender/props.py -> props.json)
 * and helpers that expand into several pieces (windowWall).
 *
 * Everything here is pure: geometry builders return BufferGeometries with a
 * vertex `color` attribute (one material for the whole map, so switching
 * maps never compiles a shader), and the height / footprint queries are what
 * spawns, the practice dummy and the minimap use.
 */
import * as THREE from 'three';
import PROPS from './props.json' with { type: 'json' };

export const DEFAULT_COLOR = 0x8a8f96;
export const DEFAULT_EDGE = 0x00c7ff;

/* ---------------------------------------------------------- local frame -- */

/** World (x, z) -> the piece's own frame (unturned, centred). */
function toLocal(b, x, z) {
  const dx = x - b.x, dz = z - b.z;
  const a = -(b.ry ?? 0);
  const c = Math.cos(a), s = Math.sin(a);
  // three's rotation.y turns +x toward -z: inverse rotation of (dx, dz)
  return { lx: dx * c + dz * s, lz: -dx * s + dz * c };
}

/** Is (x, z) over the piece's footprint (grown by margin)? */
export function insideXZ(b, x, z, margin = 0) {
  const { lx, lz } = toLocal(b, x, z);
  return Math.abs(lx) <= b.w / 2 + margin && Math.abs(lz) <= b.d / 2 + margin;
}

/** Height of the piece's top at (x, z), or -Infinity off its footprint. */
export function topAt(b, x, z) {
  const { lx, lz } = toLocal(b, x, z);
  if (Math.abs(lx) > b.w / 2 || Math.abs(lz) > b.d / 2) return -Infinity;
  const bottom = b.y - b.h / 2;
  if (!b.ramp) return b.y + b.h / 2;
  const axis = b.ramp[1] === 'x' ? lx / b.w : lz / b.d; // -0.5 .. 0.5
  const k = b.ramp[0] === '+' ? axis + 0.5 : 0.5 - axis; // 0 low side .. 1 high side
  return bottom + b.h * k;
}

/** The 180-degree twin of a piece (point symmetry about the map centre). */
export function mirrorPiece(b) {
  const flip = { '+x': '-x', '-x': '+x', '+z': '-z', '-z': '+z' };
  // a prop has a front: turned 180 degrees with its position (a box doesn't care)
  const ry = b.prop && !b.sym ? (b.ry ?? 0) + Math.PI : b.ry;
  return { ...b, x: b.x === 0 ? 0 : -b.x, z: b.z === 0 ? 0 : -b.z, ...(b.ramp ? { ramp: flip[b.ramp] } : {}), ...(ry != null ? { ry } : {}) };
}

/* ------------------------------------------------------------- helpers -- */

/**
 * A flight of drawn stone steps (Blender 'stairs', 3.2 m rise over 5.6 m)
 * whose foot is at (x, y0, z), climbing toward `dir`, with its side wall on
 * the right as you climb. Players walk on a hidden smooth ramp under the
 * steps (no step-up snagging); the steps are drawn only.
 */
export function stairFlight(x, z, dir = '+z', y0 = 0) {
  const ry = { '+z': 0, '-z': Math.PI, '+x': Math.PI / 2, '-x': -Math.PI / 2 }[dir];
  const RUN = 5.6, RISE = 3.2, W = 1.6;
  const c = Math.cos(ry), s = Math.sin(ry);
  // the model's origin is the middle of the flight; its foot is RUN/2 back
  const ox = x + (RUN / 2) * s, oz = z + (RUN / 2) * c;
  const along = dir[1] === 'z';
  return [
    prop('stairs', ox, oz, ry, y0, { deco: true }),
    { x: ox, y: y0 + RISE / 2, z: oz, w: along ? W : RUN, h: RISE, d: along ? RUN : W, ramp: dir, hidden: true },
  ];
}

/**
 * A Blender prop as a piece. (x, y0, z) is where the model's own origin goes
 * (its base; for wall pieces the point on the wall face), ry turns it, and
 *   opts.sx  stretches it along its own x (cornices, parapets: 1 m models)
 *   opts.deco  visual only: no collision (railings, shutters, awnings)
 * The piece's x/y/z/w/h/d are its bounding box, as for any other piece.
 */
export function prop(name, x, z, ry = 0, y0 = 0, opts = {}) {
  const p = PROPS[name];
  if (!p) throw new Error(`unknown prop "${name}"`);
  const sx = opts.sx ?? 1;
  const w = (p.max[0] - p.min[0]) * sx, h = p.max[1] - p.min[1], d = p.max[2] - p.min[2];
  const cx = ((p.min[0] + p.max[0]) / 2) * sx, cy = (p.min[1] + p.max[1]) / 2, cz = (p.min[2] + p.max[2]) / 2;
  const c = Math.cos(ry), s = Math.sin(ry);
  return {
    prop: name, x: x + cx * c + cz * s, y: y0 + cy, z: z - cx * s + cz * c, w, h, d,
    ...(ry ? { ry } : {}), ...(sx !== 1 ? { sx } : {}), ...(opts.deco ? { deco: true } : {}),
  };
}

function rawGeometry(src, sx, p) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(src.positions, 3));
  g.setIndex(src.indices);
  const flat = g.toNonIndexed();
  g.dispose();
  if (sx !== 1) flat.scale(sx, 1, 1);
  flat.translate(-((p.min[0] + p.max[0]) / 2) * sx, -(p.min[1] + p.max[1]) / 2, -(p.min[2] + p.max[2]) / 2);
  flat.computeVertexNormals();
  return flat;
}

function propGeometry(b) {
  const p = PROPS[b.prop];
  return rawGeometry(p, b.sx ?? 1, p);
}

/** The prop's own neon strips, placed like its body (null when it has none). */
function propNeon(b) {
  const p = PROPS[b.prop];
  if (!p.neon) return null;
  const g = rawGeometry(p.neon, b.sx ?? 1, p);
  if (b.ry) g.rotateY(b.ry);
  g.translate(b.x, b.y, b.z);
  return g;
}

/**
 * A wall with a window: the wall from x0..x1 (axis 'x') or z0..z1 (axis 'z')
 * at the other coordinate `at`, height h, thickness t, with a hole from
 * sill to top across the middle `gap` metres. Returns 4 pieces.
 */
export function windowWall({ axis = 'x', from, to, at, h = 3, t = 0.6, sill = 1.0, top = 2.0, gap = 2, c, e }) {
  const mid = (from + to) / 2;
  const len = Math.abs(to - from);
  const side = (len - gap) / 2;
  const P = (u, y, lu, lh) =>
    axis === 'x'
      ? { x: u, y, z: at, w: lu, h: lh, d: t, ...(c != null && { c }), ...(e != null && { e }) }
      : { x: at, y, z: u, w: t, h: lh, d: lu, ...(c != null && { c }), ...(e != null && { e }) };
  return [
    P(Math.min(from, to) + side / 2, h / 2, side, h), // left post
    P(Math.max(from, to) - side / 2, h / 2, side, h), // right post
    P(mid, sill / 2, gap, sill), // under the window
    P(mid, (top + h) / 2, gap, h - top), // over the window
  ];
}

/**
 * A straight wall from `from` to `to` along `axis`, centred on the other
 * coordinate `at`, standing on y0, with openings cut through it. Each
 * opening is { c: centre along the wall, w: width, bottom, top } (heights
 * above y0): a door has bottom 0. Openings get a projecting sill (windows)
 * so they read from a distance.
 */
export function wallWithOpenings({ axis = 'x', from, to, at, y0 = 0, h = 3, t = 0.4, openings = [] }) {
  const lo = Math.min(from, to), hi = Math.max(from, to);
  /** A piece spanning u0..u1 along the wall, b..top above y0, `across` thick. */
  const P = (u0, u1, b, top, across = t) => {
    const len = u1 - u0, hh = top - b;
    if (len <= 1e-3 || hh <= 1e-3) return null;
    const u = (u0 + u1) / 2, y = y0 + (b + top) / 2;
    return axis === 'x' ? { x: u, y, z: at, w: len, h: hh, d: across } : { x: at, y, z: u, w: across, h: hh, d: len };
  };
  const out = [];
  let cursor = lo;
  for (const o of [...openings].sort((a, b) => a.c - b.c)) {
    const a = Math.max(lo, o.c - o.w / 2), b = Math.min(hi, o.c + o.w / 2);
    out.push(P(cursor, a, 0, h)); // solid stretch before the opening
    out.push(P(a, b, 0, o.bottom)); // under it (none for a door)
    out.push(P(a, b, o.top, h)); // over it
    if (o.bottom > 0.2) out.push(P(a - 0.1, b + 0.1, o.bottom - 0.08, o.bottom, t + 0.24)); // projecting sill
    cursor = b;
  }
  out.push(P(cursor, hi, 0, h));
  return out.filter(Boolean);
}

/**
 * A two-storey building, axis-aligned, centred on (x, z), w x d metres.
 *   doors:   [{ side: '+x'|'-x'|'+z'|'-z', at, w = 1.6 }]   ground floor
 *   windows: [{ side, floor: 0|1, at, w = 1.4 }]
 *   stair:   '+x' | '-x'  which way the inside stairs climb (along x, against
 *            a long inner wall with no door in the way); the upper slab has a
 *            hole over them
 * Detailing: a band between the floors, a cornice on the roof and square
 * pilasters on the corners, all a few cm proud of the walls.
 */
export function building({ x, z, w, d, fh = 3.2, t = 0.35, slab = 0.3, doors = [], windows = [], stair = '+x', ornate = false }) {
  const hw = w / 2, hd = d / 2;
  const out = [];
  const opens = (side, floor) => [
    ...(floor === 0 ? doors.filter((o) => o.side === side).map((o) => ({ c: o.at, w: o.w ?? 1.6, bottom: 0, top: 2.4 })) : []),
    ...windows.filter((o) => o.side === side && (o.floor ?? 1) === floor)
      .map((o) => (ornate
        ? { c: o.at, w: 1.4, bottom: 1.0, top: 2.2 }
        : { c: o.at, w: o.w ?? 1.4, bottom: floor === 0 ? 1.0 : 0.9, top: floor === 0 ? 2.1 : 2.2 })),
  ];
  for (let f = 0; f < 2; f++) {
    const y0 = f * fh;
    const h = fh; // walls meet the next floor: ending at the slab's underside left a 0.3 m slot all round
    // long walls run along x (their openings' `at` is an x offset), short along z
    const shift = (list, k) => list.map((o) => ({ ...o, c: o.c + k }));
    // Walls carry no neon of their own: the building's glow is its frame
    // (corner pilasters, floor band, roofline), as in the art direction.
    const quiet = (list) => list.map((p) => ({ ...p, noEdge: true }));
    out.push(...quiet(wallWithOpenings({ axis: 'x', from: x - hw, to: x + hw, at: z + hd - t / 2, y0, h, t, openings: shift(opens('+z', f), x) })));
    out.push(...quiet(wallWithOpenings({ axis: 'x', from: x - hw, to: x + hw, at: z - hd + t / 2, y0, h, t, openings: shift(opens('-z', f), x) })));
    out.push(...quiet(wallWithOpenings({ axis: 'z', from: z - hd + t, to: z + hd - t, at: x + hw - t / 2, y0, h, t, openings: shift(opens('+x', f), z) })));
    out.push(...quiet(wallWithOpenings({ axis: 'z', from: z - hd + t, to: z + hd - t, at: x - hw + t / 2, y0, h, t, openings: shift(opens('-x', f), z) })));
  }
  // stairs: a ramp along x against one long inner wall, rising to the slab.
  // Pick the wall and direction that keep every door clear (the asked-for
  // direction first): a door must never open onto the stairs.
  const sw = 1.5; // stair width
  const run = Math.min(w - 2 * t - 1.2, 6.2); // leave a landing at the top
  const xIn = x - hw + t, xOut = x + hw - t;
  const options = [];
  for (const wall of ['-z', '+z']) for (const dir of [stair, stair === '+x' ? '-x' : '+x']) options.push({ wall, dir });
  options.sort((a, b) => (a.dir === stair ? 0 : 1) - (b.dir === stair ? 0 : 1));
  const blocks = ({ wall, dir }) => {
    const r0 = dir === '+x' ? xIn : xOut - run;
    const zA = wall === '-z' ? z - hd : z + hd - t - sw, zB = zA + t + sw; // stair band incl. wall
    return doors.some((o) => {
      const half = (o.w ?? 1.6) / 2 + 0.15;
      if (o.side === wall) return x + o.at + half > r0 && x + o.at - half < r0 + run; // door in the wall behind the stairs
      const highEnd = dir === '+x' ? '+x' : '-x';
      if (o.side === highEnd) return z + o.at + half > zA && z + o.at - half < zB; // door at the stair head
      return false;
    });
  };
  const pick = options.find((o) => !blocks(o)) ?? options[0];
  const sdir = pick.dir;
  const zS = pick.wall === '-z' ? z - hd + t + sw / 2 : z + hd - t - sw / 2;
  const r0 = sdir === '+x' ? xIn : xOut - run; // ramp spans r0..r0+run
  out.push({ x: r0 + run / 2, y: (fh - slab) / 2 + slab / 2, z: zS, w: run, h: fh, d: sw, ramp: sdir, noEdge: false });
  // upper slab with a hole over the stairs
  const slabY = fh - slab / 2;
  const zA = pick.wall === '-z' ? z - hd + t + sw : z - hd + t; // slab beside the stairs: zA..zB
  const zB = pick.wall === '-z' ? z + hd - t : z + hd - t - sw;
  out.push({ x: (xIn + xOut) / 2, y: slabY, z: (zA + zB) / 2, w: xOut - xIn, h: slab, d: zB - zA, noEdge: true });
  const landA = sdir === '+x' ? r0 + run : xIn, landB = sdir === '+x' ? xOut : r0; // the landing at the stair head
  if (landB - landA > 0.05) out.push({ x: (landA + landB) / 2, y: slabY, z: zS, w: landB - landA, h: slab, d: sw, noEdge: true });
  if (ornate) return [...out, ...ornament({ x, z, w, d, fh, slab, doors, windows })];
  // roof slab, cornice, string course, corner pilasters
  out.push({ x, y: 2 * fh + slab / 2, z, w, h: slab, d, noEdge: true });
  out.push({ x, y: 2 * fh + slab + 0.1, z, w: w + 0.3, h: 0.2, d: d + 0.3 }); // roofline: glows
  // string course: four thin strips proud of the outside faces (a solid band
  // across the footprint would be a ceiling over the stairs)
  const sc = 0.08, scH = 0.18;
  out.push({ x, y: fh, z: z + hd + sc / 2, w: w + 2 * sc, h: scH, d: sc });
  out.push({ x, y: fh, z: z - hd - sc / 2, w: w + 2 * sc, h: scH, d: sc });
  out.push({ x: x + hw + sc / 2, y: fh, z, w: sc, h: scH, d });
  out.push({ x: x - hw - sc / 2, y: fh, z, w: sc, h: scH, d });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    out.push({ x: x + sx * (hw - 0.22), y: fh + slab / 2, z: z + sz * (hd - 0.22), w: 0.56, h: 2 * fh + slab, d: 0.56 });
  }
  return out;
}

/**
 * The Blender kit dressed onto a building() shell: carved corner pilasters, a
 * cornice round the roof, a frame (with shutters) on every window, a frame on
 * every door, and balconies / awnings where a window or door asks for one
 * ({ balcony: true } on an upper window, { awning: true } on a door or a
 * ground-floor window). Everything but the pilasters and the roof is deco.
 */
function ornament({ x, z, w, d, fh, slab, doors, windows }) {
  const hw = w / 2, hd = d / 2;
  const out = [];
  // where a wall's outer face is, which way it faces, and how `at` runs along it
  const face = {
    '+z': (at) => ({ px: x + at, pz: z + hd, ry: 0 }),
    '-z': (at) => ({ px: x + at, pz: z - hd, ry: Math.PI }),
    '+x': (at) => ({ px: x + hw, pz: z + at, ry: Math.PI / 2 }),
    '-x': (at) => ({ px: x - hw, pz: z + at, ry: -Math.PI / 2 }),
  };
  const roofY = 2 * fh;
  out.push({ x, y: roofY + slab / 2, z, w, h: slab, d, noEdge: true }); // roof slab
  // cornice on all four sides (1 m model stretched)
  for (const [side, len] of [['+z', w + 0.8], ['-z', w + 0.8], ['+x', d], ['-x', d]]) {
    const f = face[side](0);
    out.push(prop('cornice', f.px, f.pz, f.ry, roofY + slab, { sx: len, deco: true }));
  }
  // floor band (thin strip that glows), as before
  const sc = 0.08, scH = 0.18;
  out.push({ x, y: fh, z: z + hd + sc / 2, w: w + 2 * sc, h: scH, d: sc });
  out.push({ x, y: fh, z: z - hd - sc / 2, w: w + 2 * sc, h: scH, d: sc });
  out.push({ x: x + hw + sc / 2, y: fh, z, w: sc, h: scH, d });
  out.push({ x: x - hw - sc / 2, y: fh, z, w: sc, h: scH, d });
  // carved corner pilasters (they collide: a player hugs a corner against them)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    out.push(prop('pilaster', x + sx * (hw - 0.22), z + sz * (hd - 0.22), 0, 0));
  }
  for (const o of windows) {
    const f = face[o.side](o.at);
    const y = (o.floor ?? 1) * fh + 1.0;
    out.push(prop('window', f.px, f.pz, f.ry, y, { deco: true }));
    if (o.balcony && (o.floor ?? 1) === 1) out.push(prop('balcony', f.px, f.pz, f.ry, fh + 0.05, { deco: true }));
    if (o.awning && (o.floor ?? 1) === 0) out.push(prop('awning', f.px, f.pz, f.ry, y + 1.75, { deco: true }));
  }
  for (const o of doors) {
    const f = face[o.side](o.at);
    out.push(prop('doorframe', f.px, f.pz, f.ry, 0, { deco: true }));
    if (o.awning) out.push(prop('awning', f.px, f.pz, f.ry, 3.05, { deco: true }));
  }
  return out;
}

/* ------------------------------------------------------------ geometry -- */

function paint(g, hex) {
  const col = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = col.r;
    a[i * 3 + 1] = col.g;
    a[i * 3 + 2] = col.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** Wedge: a box whose top on the low side is pulled down to the bottom. */
function wedge(b) {
  const g = new THREE.BoxGeometry(b.w, b.h, b.d).toNonIndexed();
  const p = g.attributes.position;
  const ax = b.ramp[1] === 'x' ? 0 : 2;
  const sign = b.ramp[0] === '+' ? 1 : -1;
  for (let i = 0; i < p.count; i++) {
    const u = ax === 0 ? p.getX(i) : p.getZ(i);
    if (p.getY(i) > 0 && u * sign < 0) p.setY(i, -b.h / 2);
  }
  g.computeVertexNormals();
  return g;
}

/** Surface geometry of one piece, world-placed, vertex-coloured. */
export function pieceGeometry(b, fallback = DEFAULT_COLOR) {
  let g = b.prop ? propGeometry(b) : b.ramp ? wedge(b) : new THREE.BoxGeometry(b.w, b.h, b.d).toNonIndexed();
  if (b.ry) g.rotateY(b.ry);
  g.translate(b.x, b.y, b.z);
  // merge needs identical attribute sets
  if (g.attributes.uv) g.deleteAttribute('uv');
  return paint(g, b.c ?? fallback);
}

const _up = new THREE.Vector3(0, 1, 0);

/** A thin square bar from p to q (edge lines that stay visible on an iPad). */
function bar(p, q, t) {
  const dir = new THREE.Vector3().subVectors(q, p);
  const len = dir.length();
  const g = new THREE.BoxGeometry(t, len + t, t).toNonIndexed();
  const quat = new THREE.Quaternion().setFromUnitVectors(_up, dir.normalize());
  g.applyQuaternion(quat);
  g.translate((p.x + q.x) / 2, (p.y + q.y) / 2, (p.z + q.z) / 2);
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

/** Edge bars along the piece's hard edges (any shape, turned or not). */
export function edgeGeometries(b, t, fallback = DEFAULT_EDGE) {
  if (b.noEdge) return [];
  if (b.prop && PROPS[b.prop].neon) {
    const g = propNeon(b);
    if (g.attributes.uv) g.deleteAttribute('uv');
    return [paint(g, b.e ?? fallback)];
  }
  if (b.prop && b.deco) return [];
  const surf = b.prop ? propGeometry(b) : b.ramp ? wedge(b) : new THREE.BoxGeometry(b.w, b.h, b.d);
  if (b.ry) surf.rotateY(b.ry);
  surf.translate(b.x, b.y, b.z);
  const edges = new THREE.EdgesGeometry(surf, 25);
  surf.dispose();
  const p = edges.attributes.position;
  const out = [];
  const A = new THREE.Vector3(), B = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 2) {
    A.fromBufferAttribute(p, i);
    B.fromBufferAttribute(p, i + 1);
    if (A.distanceToSquared(B) < 1e-6) continue;
    out.push(paint(bar(A, B, t), b.e ?? fallback));
  }
  edges.dispose();
  return out;
}
