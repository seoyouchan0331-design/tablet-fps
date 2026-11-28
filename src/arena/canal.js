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

/** The quay +x side and everything on it; the -x side is its 180-degree twin. */
const HALF = [
  // quay slab (a floor: its top is the street) and the canal's retaining wall
  { x: (QX + H) / 2, y: -DEEP / 2, z: 0, w: H - QX, h: DEEP, d: S, floor: true },
  { x: CW + RW / 2, y: -DEEP / 2, z: 0, w: RW, h: DEEP, d: S - 2, noEdge: true },

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
  ...[-27.5, -24.2, -3.5, 3.5, 24.2, 27.5].map((z) => prop('blindarch', CW, z, -Math.PI / 2, -DEEP, { deco: true })),

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
