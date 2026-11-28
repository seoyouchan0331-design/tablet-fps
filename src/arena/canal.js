/**
 * CANAL — an original canal town, 64 x 64 m, point-symmetric.
 *
 * A dry canal 12 m wide runs through the middle along z, sunk 3.2 m below
 * the quay streets (the quays are the map's 0 m, the canal floor is -3.2,
 * so the town kit stands on the quays unchanged). The two sides spawn on
 * their quay (x = +-25.5) and must cross:
 *   - the plaza bridge in the middle (14 m wide, three arches underneath
 *     to walk through on the canal floor): the hill in King of the Hill;
 *   - two covered footbridges near the ends (narrow, close fights);
 *   - the canal floor itself, a low route under the bridges, cut by two
 *     lock gates (a doorway each, a walkway on top) so no sight line runs
 *     the canal's length.
 * Each quay has four stairs down into the canal, a street along the
 * parapet, houses you can enter and climb, an arched gateway to the spawn
 * yard and a watch tower in one corner.
 */
import { building, prop } from './shapes.js';
import { tower, bridge, flight, parapet } from './town.js';

const S = 64; // square
const H = S / 2;
const IN = H - 1; // inner face of the outer walls
const CW = 6; // canal half-width
const DEEP = 3.2; // canal depth
const RW = 0.5; // retaining wall thickness
const QX = CW + RW; // where the quay floor starts
const BR = 7; // plaza bridge half-width (along z)
const GATE = 15; // lock gates at z = +-GATE
const FOOT = 23; // footbridges at z = +-FOOT
const STAIR_X = CW - 0.85; // stairs run along the canal wall
const SLAB = 0.6; // the quay street's thickness over a tunnel

// The tunnel under this (+x) quay: from a mouth in the canal wall at the -z
// end, under the street and the end house, up a stair into the back street.
// It is the canal's reason to exist: the only way behind the other side's
// houses (each side's twin opens at the other end).
const TUN = { z0: -27.5, z1: -24.5, x0: QX, x1: 27.6, pit: 22 }; // pit: where the stair up starts

/** Axis-aligned rectangle [x0,x1] x [z0,z1] minus holes -> rectangles covering the rest. */
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
const slab = (q, y0, y1, extra) => ({ x: (q.x0 + q.x1) / 2, y: (y0 + y1) / 2, z: (q.z0 + q.z1) / 2, w: q.x1 - q.x0, h: y1 - y0, d: q.z1 - q.z0, ...extra });

/** The quay: a street slab on top (with the stair pit open), solid below except the tunnel. */
function quay() {
  const all = { x0: QX, x1: H, z0: -H, z1: H };
  const tunnel = { x0: TUN.x0, x1: TUN.x1, z0: TUN.z0, z1: TUN.z1 };
  const pit = { x0: TUN.pit, x1: TUN.x1, z0: TUN.z0, z1: TUN.z1 };
  return [
    // (no neon on these: the pieces' seams would draw lines across the street)
    ...rectMinus(all, [pit]).map((q) => slab(q, -SLAB, 0, { floor: true, noEdge: true })),
    ...rectMinus(all, [tunnel]).map((q) => slab(q, -DEEP, -SLAB, { floor: true, noEdge: true })), // ground mass under the street
    slab(tunnel, -DEEP - 0.5, -DEEP, { floor: true, noEdge: true }), // the tunnel's own floor
    // guide lights along the tunnel's ceiling corners, and the quay's edge line
    slab({ x0: TUN.x0, x1: TUN.pit, z0: TUN.z0, z1: TUN.z0 + 0.06 }, -SLAB - 0.06, -SLAB),
    slab({ x0: TUN.x0, x1: TUN.pit, z0: TUN.z1 - 0.06, z1: TUN.z1 }, -SLAB - 0.06, -SLAB),
  ];
}

/** The quay +x side and everything on it; the -x side is its 180-degree twin. */
const HALF = [
  // the quay (street slab, solid body, the tunnel carved out) and the canal's
  // retaining wall, open at the tunnel's mouth
  ...quay(),
  slab({ x0: CW, x1: QX, z0: -H + 1, z1: TUN.z0 }, -DEEP, 0, { noEdge: true }),
  slab({ x0: CW, x1: QX, z0: TUN.z1, z1: H - 1 }, -DEEP, 0, { noEdge: true }),
  slab({ x0: CW, x1: QX, z0: TUN.z0, z1: TUN.z1 }, -SLAB, 0, { noEdge: true }), // lintel
  // the mouth's glowing frame
  { x: CW - 0.03, y: -DEEP / 2 - SLAB / 2, z: TUN.z0 + 0.08, w: 0.06, h: DEEP - SLAB, d: 0.16 },
  { x: CW - 0.03, y: -DEEP / 2 - SLAB / 2, z: TUN.z1 - 0.08, w: 0.06, h: DEEP - SLAB, d: 0.16 },
  { x: CW - 0.03, y: -SLAB - 0.08, z: (TUN.z0 + TUN.z1) / 2, w: 0.06, h: 0.16, d: TUN.z1 - TUN.z0 },
  // the stair up into the back street, and rails round its pit
  ...flight({ x: TUN.pit, z: (TUN.z0 + TUN.z1) / 2, dir: '+x', y0: -DEEP, rise: DEEP }),
  ...parapet({ x0: TUN.pit, z0: TUN.z1 + 0.15, x1: TUN.x1, z1: TUN.z1 + 0.15, y0: 0, h: 1.0, posts: 3 }),
  ...parapet({ x0: TUN.pit, z0: TUN.z0 - 0.15, x1: TUN.x1, z1: TUN.z0 - 0.15, y0: 0, h: 1.0, posts: 3 }),

  // four stairs from the canal floor up to this quay. All climb toward -z: the
  // drawn flight's side wall then stands on the canal side (a rail), and the
  // quay side stays open to step off at the top.
  ...flight({ x: STAIR_X, z: 13.0, dir: '-z', y0: -DEEP, rise: DEEP }), // top at z 7.4, by the bridge
  ...flight({ x: STAIR_X, z: 21.2, dir: '-z', y0: -DEEP, rise: DEEP }), // top at z 15.6, by the gate
  ...flight({ x: STAIR_X, z: -BR - 0.4, dir: '-z', y0: -DEEP, rise: DEEP }), // top at z -13.0
  ...flight({ x: STAIR_X, z: -GATE - 0.6, dir: '-z', y0: -DEEP, rise: DEEP }), // top at z -21.2

  // parapet along the canal edge, open where a bridge, a gate or a stair's top meets the quay
  ...[
    [-IN, -FOOT - 1.5], [-19.6, -GATE - 0.4], [-GATE + 0.4, -13.0], [-11.4, -BR],
    [9.0, GATE - 0.4], [17.2, FOOT - 1.5], [FOOT + 1.5, IN],
  ].flatMap(([a, b]) => parapet({ x0: CW + 0.2, z0: a, x1: CW + 0.2, z1: b, y0: 0, h: 1.0, posts: 5 })),

  // blind arches on the canal wall where no stair runs (drawn only)
  ...[-21.5 + 0.2, -3.5, 3.5, 24.2, 27.5].filter((z) => z > -21).map((z) => prop('blindarch', CW, z, -Math.PI / 2, -DEEP, { deco: true })),

  // houses facing the canal across the quay street (doors on the street and the back)
  ...building({
    x: 17.5, z: 12, w: 9, d: 7, stair: '+x', ornate: true,
    doors: [{ side: '-x', at: 0, awning: true }, { side: '+x', at: 1.5 }],
    windows: [{ side: '-x', floor: 1, at: -2, balcony: true }, { side: '-x', floor: 1, at: 2 }, { side: '-z', floor: 1, at: 0 }, { side: '+z', floor: 1, at: 0 }],
  }),
  ...building({
    x: 17.5, z: -12, w: 9, d: 7, stair: '-x', ornate: true,
    doors: [{ side: '-x', at: 1.5 }, { side: '+x', at: -1.5, awning: true }],
    windows: [{ side: '-x', floor: 1, at: 2, balcony: true }, { side: '-x', floor: 0, at: -2 }, { side: '+z', floor: 1, at: 0 }, { side: '+x', floor: 1, at: 1.5 }],
  }),

  ...building({
    x: 17.5, z: -24, w: 9, d: 7, stair: '+x', ornate: true,
    doors: [{ side: '-x', at: -1.5 }, { side: '+z', at: 2 }],
    windows: [{ side: '-x', floor: 1, at: 1.5, balcony: true }, { side: '-x', floor: 0, at: 1.8 }, { side: '+z', floor: 1, at: -2 }, { side: '+x', floor: 1, at: 0 }],
  }),

  // the arched gateway between the quay street and the spawn yard
  prop('arch', 13.5, 0, Math.PI / 2),
  // walls from the arch to the houses (z 3.15 .. 8.5)
  { x: 13.5, y: 1.6, z: 5.825, w: 0.6, h: 3.2, d: 5.35, noEdge: true },
  { x: 13.5, y: 1.6, z: -5.825, w: 0.6, h: 3.2, d: 5.35, noEdge: true },
  { x: 13.5, y: 3.25, z: 5.825, w: 0.7, h: 0.1, d: 5.35 },
  { x: 13.5, y: 3.25, z: -5.825, w: 0.7, h: 0.1, d: 5.35 },

  // watch tower in the far corner, overlooking the footbridge
  ...tower({ x: 25.5, z: 24.5 }), // (its inside flights line up with the 1 m walk grid)

  // cover: the spawn yard, the back street, the quay street, the canal floor
  prop('coverwall', 26.9, 2.3, Math.PI / 2, 0, { sx: 1.6 }),
  prop('cratestack', 22, -6.5, 0.4),
  prop('planter', 26, -14.5),
  prop('crate', 24.5, 16.5, 0.5),
  prop('crate', 9.5, 4.2, 0.2),
  prop('bench', 10, -17.5, Math.PI / 2),
  prop('cratestack', -2.6, 11, Math.PI / 2, -DEEP),
  prop('crate', 3, 27.5, 0.3, -DEEP),
];

/** Pieces on the centre line: their own twins. */
const MIDDLE = [
  // canal floor
  { x: 0, y: -DEEP - 0.25, z: 0, w: 2 * QX, h: 0.5, d: S, floor: true },

  // plaza bridge: the deck, its parapets on the canal sides, three arches each face below
  { x: 0, y: -0.15, z: 0, w: 2 * CW, h: 0.3, d: 2 * BR, noEdge: true },
  ...parapet({ x0: -CW, z0: BR - 0.15, x1: CW, z1: BR - 0.15, y0: 0, h: 1.0 }),
  ...parapet({ x0: -CW, z0: -BR + 0.15, x1: CW, z1: -BR + 0.15, y0: 0, h: 1.0 }),
  ...[-3.6, 0, 3.6].flatMap((x) => [prop('archbay', x, BR - 0.4, 0, -DEEP), prop('archbay', -x, -BR + 0.4, Math.PI, -DEEP)]),
  // filler piers between the arches and the canal walls
  { x: 5.7, y: -DEEP / 2 - 0.15, z: BR - 0.4, w: 0.6, h: DEEP - 0.3, d: 0.8, noEdge: true },
  { x: -5.7, y: -DEEP / 2 - 0.15, z: -BR + 0.4, w: 0.6, h: DEEP - 0.3, d: 0.8, noEdge: true },
  { x: -5.7, y: -DEEP / 2 - 0.15, z: BR - 0.4, w: 0.6, h: DEEP - 0.3, d: 0.8, noEdge: true },
  { x: 5.7, y: -DEEP / 2 - 0.15, z: -BR + 0.4, w: 0.6, h: DEEP - 0.3, d: 0.8, noEdge: true },
  // cover on the hill: two low walls and a pair of crates, point-symmetric
  prop('coverwall', 2.6, 3, 0, 0, { sx: 2.4 }),
  prop('coverwall', -2.6, -3, Math.PI, 0, { sx: 2.4 }),
  prop('crate', -3.2, 2.6, 0.4),
  prop('crate', 3.2, -2.6, 0.4 + Math.PI),

  // lock gates: a wall across the canal with a doorway, a narrow walkway with rails on top
  ...[GATE, -GATE].flatMap((z) => [
    { x: -3.4, y: -DEEP / 2, z, w: 5.2, h: DEEP, d: 0.8, noEdge: true },
    { x: 3.4, y: -DEEP / 2, z, w: 5.2, h: DEEP, d: 0.8, noEdge: true },
    { x: 0, y: -0.4, z, w: 1.6, h: 0.8, d: 0.8, noEdge: true },
    // the doorway's glowing frame and the pilasters beside it, on both faces
    ...[1, -1].flatMap((f) => [
      { x: -0.88, y: -DEEP + 1.25, z: z + f * 0.43, w: 0.16, h: 2.5, d: 0.06 },
      { x: 0.88, y: -DEEP + 1.25, z: z + f * 0.43, w: 0.16, h: 2.5, d: 0.06 },
      { x: 0, y: -0.72, z: z + f * 0.43, w: 1.92, h: 0.16, d: 0.06 },
      { x: -1.6, y: -DEEP / 2, z: z + f * 0.47, w: 0.6, h: DEEP, d: 0.14, noEdge: true },
      { x: 1.6, y: -DEEP / 2, z: z + f * 0.47, w: 0.6, h: DEEP, d: 0.14, noEdge: true },
    ]),
    { x: 0, y: 0.5, z: z + 0.37, w: 2 * CW, h: 1.0, d: 0.06 },
    { x: 0, y: 0.5, z: z - 0.37, w: 2 * CW, h: 1.0, d: 0.06 },
  ]),

  // covered footbridges near the ends
  ...bridge({ x: FOOT, z0: -CW, z1: CW, fh: 0, top: 3.0, axis: 'x' }),
  ...bridge({ x: -FOOT, z0: -CW, z1: CW, fh: 0, top: 3.0, axis: 'x' }),
];

const mirror = (b) => {
  const flip = { '+x': '-x', '-x': '+x', '+z': '-z', '-z': '+z' };
  const ry = b.prop && !b.sym ? (b.ry ?? 0) + Math.PI : b.ry;
  return { ...b, x: b.x === 0 ? 0 : -b.x, z: b.z === 0 ? 0 : -b.z, ...(b.ramp ? { ramp: flip[b.ramp] } : {}), ...(ry != null ? { ry } : {}) };
};

const SHELL = [
  // outer walls, from the canal floor up (the canal reaches the walls)
  { x: 0, y: 0.75 - 0.1, z: H - 0.5, w: S, h: 8.5, d: 1, wall: true },
  { x: 0, y: 0.75 - 0.1, z: -(H - 0.5), w: S, h: 8.5, d: 1, wall: true },
  { x: H - 0.5, y: 0.75 - 0.1, z: 0, w: 1, h: 8.5, d: S - 2, wall: true },
  { x: -(H - 0.5), y: 0.75 - 0.1, z: 0, w: 1, h: 8.5, d: S - 2, wall: true },
  // invisible walls above them: a jump from the tower stays in the map
  { x: 0, y: 12, z: IN + 0.5, w: S, h: 14, d: 1, hidden: true },
  { x: 0, y: 12, z: -(IN + 0.5), w: S, h: 14, d: 1, hidden: true },
  { x: IN + 0.5, y: 12, z: 0, w: 1, h: 14, d: S - 2, hidden: true },
  { x: -(IN + 0.5), y: 12, z: 0, w: 1, h: 14, d: S - 2, hidden: true },
];

export const CANAL = {
  label: 'CANAL',
  note: 'A sunken canal: cross the bridges or take the low road',
  roundTime: 45,
  layout: {
    size: S,
    grid: false, // the floor grid would float over the canal
    floorColor: 0x767c83, // pale paving, like the quays in the art
    hill: { x: 0, z: 0, r: 6.5, y0: -0.5, y1: 3.5 }, // the plaza bridge, not the canal under it
    boxes: [...SHELL, ...MIDDLE, ...HALF, ...HALF.map(mirror)],
    spawns: [
      { x: 25.5, y: 0, z: 0, yaw: Math.PI / 2 },
      { x: -25.5, y: 0, z: 0, yaw: -Math.PI / 2 },
    ],
  },
};
