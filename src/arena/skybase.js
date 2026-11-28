/**
 * SKYBASE — a base on a floating platform, 58 x 50 m, point-symmetric.
 *
 * There is no ground under the deck: fall off an edge (or through the hole
 * under each sky bridge) and you die. Railings line nearly every edge; the
 * gaps in them (orange posts) are the deliberate drops.
 *
 *   - Two hangars in opposite corners are the spawns: a big door with a
 *     blast wall outside it, a side door, and a mezzanine whose upper door
 *     opens onto a deck (the "annex") the sky bridge starts from.
 *   - The control tower in the middle: a passage through its base, a stair
 *     in each flank up to a ring walkway at 3.2 m (where the bridges land),
 *     and stairs on the ring up to an open lookout on top at 6.4 m, where
 *     the power weapon appears.
 *   - Jump pads on the deck throw you onto the middle of the nearest bridge;
 *     a cargo lift beside each annex rides from the deck to its top.
 *
 * The (+x, -z) half is written out; the other is its 180-degree twin.
 */
import { prop, mirrorPiece } from './shapes.js';
import { flight, parapet } from './town.js';

const W = 58, D = 50; // the deck
const SX = 64, SZ = 56; // the map's bounds (invisible walls round the void)
const HX = W / 2, HZ = D / 2;
const FH = 3.2; // a storey
const WARN = 0xff8a1e; // edge colour of the posts beside a drop

/** A box from its extents. */
const B = (x0, x1, y0, y1, z0, z1, extra) => ({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2, w: x1 - x0, h: y1 - y0, d: z1 - z0, ...extra });

/** A railing along an edge, its glowing cap at waist height. */
const rail = (x0, z0, x1, z1, y0 = 0) => parapet({ x0, z0, x1, z1, y0, h: 1.0, t: 0.2 });

/** Orange posts on both sides of a drop. */
const warnPosts = (pts, y0 = 0) => pts.map(([x, z]) => ({ x, y: y0 + 0.6, z, w: 0.3, h: 1.2, d: 0.3, e: WARN }));

/** Axis rectangle minus holes -> rectangles covering the rest (rows along z). */
function rectMinus(r, holes) {
  const zs = [...new Set([r.z0, r.z1, ...holes.flatMap((h) => [h.z0, h.z1])])].filter((v) => v >= r.z0 && v <= r.z1).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i + 1 < zs.length; i++) {
    const z0 = zs[i], z1 = zs[i + 1], zm = (z0 + z1) / 2;
    const cut = holes.filter((h) => zm > h.z0 && zm < h.z1).sort((a, b) => a.x0 - b.x0);
    let x = r.x0;
    for (const h of cut) {
      if (h.x0 > x) out.push({ x0: x, x1: h.x0, z0, z1 });
      x = Math.max(x, h.x1);
    }
    if (x < r.x1) out.push({ x0: x, x1: r.x1, z0, z1 });
  }
  return out;
}

// ---------------------------------------------------------------- places --
const HOLE = { x0: 9.6, x1: 13.4, z0: -7.2, z1: -1.8 }; // under the bridge, (+x) side
const NOTCH = { x0: 24, x1: HX, z0: 18, z1: HZ }; // the deck's cut corner, (+x, +z)
const BRIDGE = { x0: 6.5, x1: 16.5, z0: -6.25, z1: -2.75 };
const ANNEX = { x0: 16.5, x1: 24, z0: -11, z1: -2.5 };
const HANGAR = { x0: 16.4, x1: 28.4, z0: -23, z1: -11, top: 6.4 };
const LIFT = { x0: 18, x1: 20, z0: -2.5, z1: -0.5 };
const PAD = { x: 11.5, z: 4.5 };

// the deck: one slab with the holes and corner notches cut out (no seams lit)
const DECK = rectMinus({ x0: -HX, x1: HX, z0: -HZ, z1: HZ }, [
  HOLE, NOTCH,
  { x0: -HOLE.x1, x1: -HOLE.x0, z0: -HOLE.z1, z1: -HOLE.z0 },
  { x0: -NOTCH.x1, x1: -NOTCH.x0, z0: -NOTCH.z1, z1: -NOTCH.z0 },
]).map((q) => B(q.x0, q.x1, -1.2, 0, q.z0, q.z1, { floor: true, noEdge: true }));

// ----------------------------------------------------------------- tower --
// core 7 x 7 m; the passage runs along x through z -1.2 .. 1.2
const TOWER = [
  // over the passage, and its flank walls up to the lookout floor
  B(-3.5, 3.5, 2.6, 6.0, 0, 1.5, { noEdge: true }),
  B(-1.0, 3.1, 0, 2.6, 1.2, 1.5, { noEdge: true }), // the stair's room side; open at its foot
  B(-3.5, 3.5, 0, 6.0, 3.1, 3.5), // outer wall
  B(-3.5, -3.1, 0, 6.0, 1.5, 3.1), // the stair's foot end
  B(3.1, 3.5, 0, FH, 1.5, 3.1), // under the door to the ring
  B(3.1, 3.5, 5.6, 6.0, 1.5, 3.1), // lintel
  B(2.5, 3.1, 0, FH, 1.5, 3.1, { noEdge: true }), // landing at the stair head
  ...flight({ x: -3.1, z: 2.3, dir: '+x', y0: 0, rise: FH }),
  // the ring walkway at 3.2 m: the north strip and the east strip (their twins close it)
  B(-6.5, 6.5, FH - 0.3, FH, 3.5, 6.5),
  B(3.5, 6.5, FH - 0.3, FH, -3.5, 3.5),
  { x: 6.1, y: (FH - 0.3) / 2, z: 6.1, w: 0.6, h: FH - 0.3, d: 0.6 }, // posts under its corners
  { x: 6.1, y: (FH - 0.3) / 2, z: -6.1, w: 0.6, h: FH - 0.3, d: 0.6 },
  ...rail(-6.5, 6.4, 6.5, 6.4, FH),
  ...rail(6.4, BRIDGE.z1, 6.4, 6.5, FH),
  // a stair on the east strip up to the lookout, and its landing
  ...flight({ x: 5.4, z: 4.0, dir: '-z', y0: FH, rise: FH, rails: 'both' }),
  B(3.5, 6.2, 2 * FH - 0.4, 2 * FH, -3.6, -1.6),
  ...rail(3.5, -3.5, 6.2, -3.5, 2 * FH),
  ...rail(6.1, -3.6, 6.1, -1.6, 2 * FH),
  // the lookout's parapet (the landing's edge stays open)
  ...rail(-3.5, 3.4, 3.5, 3.4, 2 * FH),
  ...rail(3.4, -1.6, 3.4, 3.4, 2 * FH),
  // the cupola's posts (two here, their twins the other two)
  { x: 3.25, y: 2 * FH + 1.3, z: 3.25, w: 0.3, h: 2.6, d: 0.3 },
  { x: 3.25, y: 2 * FH + 1.3, z: -3.25, w: 0.3, h: 2.6, d: 0.3 },
];

// ------------------------------------------------------------- the bridge --
const BR = BRIDGE, bz = (BR.z0 + BR.z1) / 2;
const SKYBRIDGE = [
  B(BR.x0, BR.x1, FH - 0.3, FH, BR.z0, BR.z1),
  ...rail(BR.x0, BR.z0 + 0.15, BR.x1, BR.z0 + 0.15, FH),
  ...rail(BR.x0, BR.z1 - 0.15, BR.x1, BR.z1 - 0.15, FH),
  { x: 8.6, y: (FH - 0.3) / 2, z: bz, w: 0.8, h: FH - 0.3, d: 0.8 }, // piers, either side of the hole
  { x: 15.0, y: (FH - 0.3) / 2, z: bz, w: 0.8, h: FH - 0.3, d: 0.8 },
  // roof slats over each end (drawn only: the middle stays open to the sky,
  // where the jump pad lands you)
  ...[7, 9].flatMap((x) => [BR.z0 + 0.15, BR.z1 - 0.15].map((z) => ({ x, y: FH + 1.3, z, w: 0.3, h: 2.6, d: 0.3 }))),
  ...[14, 16].flatMap((x) => [BR.z0 + 0.15, BR.z1 - 0.15].map((z) => ({ x, y: FH + 1.3, z, w: 0.3, h: 2.6, d: 0.3 }))),
  ...[6.8, 7.6, 8.4, 9.2, 14.2, 15.0, 15.8].map((x) => ({ x, y: FH + 2.7, z: bz, w: 0.2, h: 0.15, d: BR.z1 - BR.z0, deco: true })),
  B(6.6, 9.4, FH + 2.6, FH + 2.8, BR.z0, BR.z0 + 0.3, { deco: true }),
  B(6.6, 9.4, FH + 2.6, FH + 2.8, BR.z1 - 0.3, BR.z1, { deco: true }),
  B(13.9, 16.4, FH + 2.6, FH + 2.8, BR.z0, BR.z0 + 0.3, { deco: true }),
  B(13.9, 16.4, FH + 2.6, FH + 2.8, BR.z1 - 0.3, BR.z1, { deco: true }),
  // crates staggered across it: no straight line down its length
  prop('crate', 9.6, BR.z0 + 1.0, 0, FH),
  prop('crate', 13.6, BR.z1 - 1.0, 0, FH),
];

// ------------------------------------------------------- annex and hangar --
const A = ANNEX, H = HANGAR;
const ANNEXES = [
  B(A.x0, A.x1, 0, FH, A.z0, A.z1),
  ...rail(A.x0 + 0.1, A.z0, A.x0 + 0.1, BR.z0, FH), // west edge (the bridge lands on the rest)
  ...rail(A.x0, A.z1 - 0.1, LIFT.x0, A.z1 - 0.1, FH), // north edge, open over the lift
  ...rail(LIFT.x1, A.z1 - 0.1, A.x1, A.z1 - 0.1, FH),
  ...rail(A.x1 - 0.1, A.z0, A.x1 - 0.1, -8.6, FH), // east edge, open where the stair arrives
  ...rail(A.x1 - 0.1, -6.0, A.x1 - 0.1, A.z1, FH),
  ...flight({ x: 24.8, z: -2.5, dir: '-z', y0: 0, rise: FH, rails: 'right' }),
];

const HANGARS = [
  // walls: north (a side door below, the mezzanine's door above), east, south, west (the big door)
  B(H.x0, 18.8, 0, H.top, H.z1 - 0.4, H.z1),
  B(18.8, 20.4, 5.6, H.top, H.z1 - 0.4, H.z1),
  B(20.4, 25.2, 0, H.top, H.z1 - 0.4, H.z1),
  B(25.2, 26.8, 2.4, H.top, H.z1 - 0.4, H.z1),
  B(26.8, H.x1, 0, H.top, H.z1 - 0.4, H.z1),
  B(18.8, 20.4, 0, FH, H.z1 - 0.4, H.z1, { noEdge: true }),
  B(H.x1 - 0.4, H.x1, 0, H.top, H.z0, H.z1 - 0.4),
  B(H.x0, H.x1 - 0.4, 0, H.top, H.z0, H.z0 + 0.4),
  B(H.x0, H.x0 + 0.4, 0, H.top, H.z0 + 0.4, -20),
  B(H.x0, H.x0 + 0.4, 0, H.top, -14, H.z1 - 0.4),
  B(H.x0, H.x0 + 0.4, 4.6, H.top, -20, -14),
  B(H.x0, H.x1, H.top, H.top + 0.4, H.z0, H.z1), // roof
  // the mezzanine: along the north wall and down the east wall, its stair
  // up the south wall
  B(H.x0 + 0.4, H.x1 - 0.4, FH - 0.3, FH, -14.4, H.z1 - 0.4),
  B(26.6, H.x1 - 0.4, FH - 0.3, FH, H.z0 + 0.4, -14.4),
  ...rail(H.x0 + 0.4, -14.5, 26.6, -14.5, FH),
  ...rail(26.7, -21.0, 26.7, -14.4, FH),
  ...flight({ x: 21.0, z: -21.8, dir: '+x', y0: 0, rise: FH, rails: 'right' }),
  // a small aircraft parked inside: cover
  B(18.4, 23.6, 0.3, 1.5, -19.6, -18.4), // fuselage
  B(20.4, 21.6, 0.8, 1.0, -20.6, -17.4, { deco: true }), // wings
  B(18.4, 19.0, 1.5, 2.6, -19.2, -18.8), // tail fin
  B(22.4, 23.0, 0, 0.3, -19.4, -18.6, { noEdge: true }), // gear
  prop('crate', 17.4, -22.0, 0),
  prop('crate', 27.2, -12.6, 0),
  // the blast wall outside the big door: the tower can't see into the spawn
  ...parapet({ x0: 13.6, z0: -19.5, x1: 13.6, z1: -14.5, h: 1.5, t: 0.5 }),
];

// ---------------------------------------------------- the deck, its edges --
const EDGES = [
  // east edge (with a drop at z 2 .. 4), north edge, the notch
  ...rail(HX - 0.1, -HZ, HX - 0.1, 2),
  ...rail(HX - 0.1, 4, HX - 0.1, NOTCH.z0),
  ...warnPosts([[HX - 0.15, 1.85], [HX - 0.15, 4.15]]),
  ...rail(-HX, HZ - 0.1, NOTCH.x0, HZ - 0.1),
  ...rail(NOTCH.x0, NOTCH.z0 + 0.1, HX, NOTCH.z0 + 0.1),
  ...rail(NOTCH.x0 + 0.1, NOTCH.z0, NOTCH.x0 + 0.1, HZ),
  // round the hole: railed except its north side's middle (the drop)
  ...rail(HOLE.x0 - 0.1, HOLE.z0, HOLE.x0 - 0.1, HOLE.z1),
  ...rail(HOLE.x1 + 0.1, HOLE.z0, HOLE.x1 + 0.1, HOLE.z1),
  ...rail(HOLE.x0, HOLE.z0 - 0.1, HOLE.x1, HOLE.z0 - 0.1),
  ...rail(HOLE.x0, HOLE.z1 + 0.1, 10.5, HOLE.z1 + 0.1),
  ...rail(12.5, HOLE.z1 + 0.1, HOLE.x1, HOLE.z1 + 0.1),
  ...warnPosts([[10.35, HOLE.z1 + 0.15], [12.65, HOLE.z1 + 0.15]]),
];

// cover on the open deck
const COVER = [
  prop('cratestack', 6.5, -13, Math.PI / 2),
  prop('crate', 4.8, -15.5, 0.3),
  ...parapet({ x0: 13, z0: 9, x1: 17, z1: 9, h: 1.2, t: 0.5 }),
  prop('crate', 21.5, 9.5, 0),
  prop('cratestack', 22.5, 13, 0),
  ...parapet({ x0: -4.5, z0: -13, x1: -1, z1: -13, h: 1.2, t: 0.5 }),
  prop('cratestack', 9.5, 17.5, 0),
  ...parapet({ x0: 1, z0: 20, x1: 5, z1: 20, h: 1.2, t: 0.5 }),
  prop('crate', 3.5, 9.5, 0.2),
];

// the lift's cage (the pads and the lift platform are drawn by world/gadgets.js)
const GADGETS = [
  { x: LIFT.x0 - 0.15, y: FH + 0.6, z: LIFT.z1 - 0.15, w: 0.3, h: 2 * FH, d: 0.3, e: WARN, deco: true },
  { x: LIFT.x1 + 0.15, y: FH + 0.6, z: LIFT.z1 - 0.15, w: 0.3, h: 2 * FH, d: 0.3, e: WARN, deco: true },
];

const HALF = [...TOWER, ...SKYBRIDGE, ...ANNEXES, ...HANGARS, ...EDGES, ...COVER, ...GADGETS];

const CENTRE = [
  B(-3.5, 3.5, 6.0, 2 * FH, -3.5, 3.5, { sym: true }), // the lookout floor
  B(-3.9, 3.9, 2 * FH + 2.6, 2 * FH + 2.9, -3.9, 3.9, { sym: true, deco: true }), // cupola roof
];

// invisible walls round the void: nobody walks or jumps out of the map
const SHELL = [
  { x: 0, y: 0, z: SZ / 2 - 0.5, w: SX, h: 40, d: 1, wall: true, hidden: true },
  { x: 0, y: 0, z: -(SZ / 2 - 0.5), w: SX, h: 40, d: 1, wall: true, hidden: true },
  { x: SX / 2 - 0.5, y: 0, z: 0, w: 1, h: 40, d: SZ - 2, wall: true, hidden: true },
  { x: -(SX / 2 - 0.5), y: 0, z: 0, w: 1, h: 40, d: SZ - 2, wall: true, hidden: true },
];

// far scenery (drawn only, outside the bounds): a cloud sea far below and a
// few distant floating islands
const CLOUD = 0xf6f9ff;
// a fixed pseudo-random scatter (no Math.random in a map: every client builds the same one)
const hash = (i) => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
const PUFFS = [];
for (let i = 0; i < 46; i++) {
  const a = hash(i) * Math.PI * 2, r = 30 + hash(i + 100) * 120, s = 10 + hash(i + 200) * 22;
  const x = Math.cos(a) * r, z = Math.sin(a) * r, y = -38 - hash(i + 300) * 22;
  PUFFS.push({ x, y, z, w: s, h: s * 0.28, d: s * 0.7, ry: hash(i + 400) * Math.PI, c: CLOUD, deco: true, noEdge: true });
  PUFFS.push({ x: x + s * 0.2, y: y + s * 0.16, z, w: s * 0.55, h: s * 0.3, d: s * 0.45, ry: hash(i + 400) * Math.PI, c: CLOUD, deco: true, noEdge: true });
}
const FAR = [
  ...PUFFS,
  ...[[-95, -60, 14], [110, 30, 18], [-70, 110, 12], [60, -120, 16]].flatMap(([x, z, s]) => [
    { x, y: 6, z, w: s, h: 4, d: s * 0.8, deco: true },
    { x, y: 1, z, w: s * 0.6, h: 6, d: s * 0.5, deco: true, noEdge: true },
    { x: x + s * 0.15, y: 11, z, w: s * 0.3, h: 6, d: s * 0.3, deco: true },
  ]),
];

const mirror = mirrorPiece;
const padTo = { x: 11.5, y: FH, z: bz }; // the middle of the bridge

export const SKYBASE = {
  label: 'SKYBASE',
  note: 'A floating base: bridges, jump pads, and a long way down',
  roundTime: 45,
  layout: {
    size: SX,
    depth: SZ,
    grid: false,
    floorColor: 0xa9b0ba,
    killY: -8, // below this, the void has you
    power: { x: 0, y: 2 * FH, z: 0 }, // the orbital laser appears on the lookout
    hill: { x: 0, z: 0, r: 7, y0: -0.5, y1: 4.5 }, // the tower's base and its ring
    pickups: [{ x: 0, y: 0, z: 0 }, { x: 15, y: 0, z: 15 }, { x: -15, y: 0, z: -15 }],
    pads: [
      { x: PAD.x, y: 0, z: PAD.z, to: padTo },
      { x: -PAD.x, y: 0, z: -PAD.z, to: { x: -padTo.x, y: padTo.y, z: -padTo.z } },
    ],
    lifts: [
      { x0: LIFT.x0, x1: LIFT.x1, z0: LIFT.z0, z1: LIFT.z1, y0: 0, y1: FH },
      { x0: -LIFT.x1, x1: -LIFT.x0, z0: -LIFT.z1, z1: -LIFT.z0, y0: 0, y1: FH },
    ],
    far: FAR,
    boxes: [...SHELL, ...DECK, ...CENTRE, ...HALF, ...HALF.map(mirror)],
    spawns: [
      { x: 22.4, y: 0, z: -16.5, yaw: Math.PI / 2 },
      { x: -22.4, y: 0, z: 16.5, yaw: -Math.PI / 2 },
    ],
  },
};
