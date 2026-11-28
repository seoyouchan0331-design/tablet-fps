/**
 * Large town structures, assembled from boxes (what players walk on and
 * hide behind) and Blender kit props (the carved detail). Each builder
 * returns plain pieces, so a map lists them like any other box and mirrors
 * them with mirrorPiece. Heights follow the houses: 3.2 m a floor, upper
 * walkways at 3.2, roofs at 6.2 - 6.45, cover walls 1.1 m (stand to shoot
 * over, crouch to hide).
 */
import { prop, wallWithOpenings } from './shapes.js';

const RY = { '+z': 0, '-z': Math.PI, '+x': Math.PI / 2, '-x': -Math.PI / 2 };
const COVER = 1.1;

/**
 * A flight of steps whose foot is at (x, y0, z), climbing toward `dir`.
 * rise 3.2 draws the full 'stairs' model (1.6 wide, 5.6 run); rise 1.6 the
 * 'steps16' half flight (2.8 run) stretched to width w. Players walk on a
 * hidden smooth ramp under the drawn steps.
 */
export function flight({ x, z, dir, y0 = 0, rise = 1.6, w = 1.4 }) {
  const full = rise > 2;
  const run = full ? 5.6 : 2.8;
  const width = full ? 1.6 : w;
  const ry = RY[dir];
  const ox = x + (run / 2) * Math.round(Math.sin(ry)), oz = z + (run / 2) * Math.round(Math.cos(ry));
  const along = dir[1] === 'z';
  return [
    prop(full ? 'stairs' : 'steps16', ox, oz, ry, y0, { deco: true, ...(full ? {} : { sx: width }) }),
    { x: ox, y: y0 + rise / 2, z: oz, w: along ? width : run, h: rise, d: along ? run : width, ramp: dir, hidden: true },
  ];
}

/** A cover wall from (x0, z0) to (x1, z1) (axis-aligned) standing on y0, with a glowing cap. */
export function parapet({ x0, z0, x1, z1, y0 = 0, h = COVER, t = 0.3 }) {
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
  const x = (x0 + x1) / 2, z = (z0 + z1) / 2;
  const box = (hh, tt, y) => (alongX ? { x, y, z, w: len, h: hh, d: tt } : { x, y, z, w: tt, h: hh, d: len });
  return [
    { ...box(h, t, y0 + h / 2), noEdge: true },
    box(0.08, t + 0.1, y0 + h + 0.04), // the cap carries the neon line
  ];
}

/**
 * Two-level arcade along x, centred on x, its front at zf and its back
 * against zb (zf < zb: it faces -z). Ground floor: `bays` round arches
 * (Blender 'archbay', 3.6 m each) in front of a covered walkway. Upper
 * floor: an open gallery behind a balustrade, piers holding a flat roof.
 * One straight stair climbs to the gallery at its +x end, along the back.
 */
export function arcade({ x = 0, zf, zb, bays = 5, fh = 3.2, top = 6.2 }) {
  const BW = 3.6, L = bays * BW, x0 = x - L / 2, x1 = x + L / 2;
  const out = [];
  for (let i = 0; i < bays; i++) out.push(prop('archbay', x0 + BW * (i + 0.5), zf + 0.4, Math.PI));
  // gallery floor, its glowing fascia, the back wall up to the roof
  out.push({ x, y: fh - 0.15, z: (zf + zb) / 2, w: L, h: 0.3, d: zb - zf, noEdge: true });
  out.push({ x, y: fh - 0.12, z: zf - 0.04, w: L + 0.1, h: 0.18, d: 0.08 });
  out.push({ x, y: (fh + top + 0.25) / 2, z: zb - 0.2, w: L, h: top + 0.25 - fh, d: 0.4, noEdge: true });
  // balustrade (drawn per metre; one hidden wall is what stops players and bullets)
  for (let k = 0; k < L; k++) out.push(prop('balustrade', x0 + k + 0.5, zf + 0.2, 0, fh, { deco: true }));
  out.push({ x, y: fh + COVER / 2, z: zf + 0.2, w: L, h: COVER, d: 0.34, hidden: true });
  // the open +x end above the walkway, beside the stair head
  const zs = zb - 1.6; // the stair band runs zs..zb
  const endLen = zs - (zf + 0.4);
  out.push(prop('balustrade', x1 - 0.18, (zf + 0.4 + zs) / 2, Math.PI / 2, fh, { sx: endLen, deco: true }));
  out.push({ x: x1 - 0.18, y: fh + COVER / 2, z: (zf + 0.4 + zs) / 2, w: 0.34, h: COVER, d: endLen, hidden: true });
  for (let i = 0; i <= bays; i++) out.push({ ...prop('pier', x0 + BW * i, zf + 0.37, 0, fh), noEdge: true });
  // roof and cornice
  out.push({ x, y: top + 0.125, z: (zf - 0.3 + zb) / 2, w: L + 0.6, h: 0.25, d: zb - zf + 0.3 });
  out.push(prop('cornice', x, zf - 0.3, Math.PI, top + 0.25, { sx: L + 0.6, deco: true }));
  out.push(...flight({ x: x1 + 5.6, z: zb - 0.8, dir: '-x', rise: fh }));
  return out;
}

/**
 * A covered bridge at x, spanning z0..z1 at the upper floor between two
 * houses (their upper doors open onto it): waist-high walls, two piers a
 * side making three openings to shoot through, a flat roof. The passage
 * under it stays open, 2.9 m clear.
 */
export function bridge({ x, z0, z1, w = 3, fh = 3.2, top = 6.2 }) {
  const z = (z0 + z1) / 2, len = z1 - z0;
  const out = [{ x, y: fh - 0.15, z, w, h: 0.3, d: len, noEdge: true }];
  for (const s of [-1, 1]) {
    const xs = x + s * (w / 2 - 0.15);
    out.push({ x: x + s * (w / 2 + 0.04), y: fh - 0.12, z, w: 0.08, h: 0.18, d: len }); // fascia
    out.push(...parapet({ x0: xs, z0, x1: xs, z1, y0: fh }));
    for (const k of [1, 2]) out.push({ ...prop('pier', xs, z0 + (len * k) / 3, 0, fh), noEdge: true });
  }
  out.push({ x, y: top + 0.125, z, w: w + 0.4, h: 0.25, d: len });
  return out;
}

/**
 * A square watch tower centred on (x, z), s metres a side, door on its -x
 * face. Inside, four 1.6 m flights climb round the walls (south, east,
 * north, west) to a platform at 6.4 behind a 1.1 m parapet with a firing
 * slot in each face; a pyramid roof on four corner posts above. The
 * platform is open over the last two flights (their headroom).
 */
export function tower({ x, z, s = 6, t = 0.35 }) {
  const out = [];
  const x0 = x - s / 2, x1 = x + s / 2, z0 = z - s / 2, z1 = z + s / 2;
  const ix0 = x0 + t, ix1 = x1 - t, iz0 = z0 + t, iz1 = z1 - t;
  const B = (ix1 - ix0 - 2.8) / 2; // band width: the flights are 2.8 long
  const TOP = 6.4, WALL = TOP + COVER, SLOT = 1.6;
  // walls up to the slots' sill (a door on -x), then the parapet's top band
  // either side of each face's slot, with a glowing cap
  const SILL = TOP + 0.6;
  const quiet = (list) => list.map((p) => ({ ...p, noEdge: true }));
  out.push(...quiet(wallWithOpenings({ axis: 'x', from: x0, to: x1, at: z1 - t / 2, h: SILL, t })));
  out.push(...quiet(wallWithOpenings({ axis: 'x', from: x0, to: x1, at: z0 + t / 2, h: SILL, t })));
  out.push(...quiet(wallWithOpenings({ axis: 'z', from: iz0, to: iz1, at: x1 - t / 2, h: SILL, t })));
  out.push(...quiet(wallWithOpenings({ axis: 'z', from: iz0, to: iz1, at: x0 + t / 2, h: SILL, t, openings: [{ c: z, w: 1.6, bottom: 0, top: 2.4 }] })));
  const seg = (s - SLOT) / 2, bh = WALL - SILL;
  for (const sg of [-1, 1]) {
    const off = sg * (SLOT / 2 + seg / 2);
    for (const [px, pz, alongX] of [[x + off, z1 - t / 2, true], [x + off, z0 + t / 2, true], [x1 - t / 2, z + off, false], [x0 + t / 2, z + off, false]]) {
      const dims = alongX ? { w: seg, d: t } : { w: t, d: seg };
      out.push({ x: px, y: SILL + bh / 2, z: pz, ...dims, h: bh, noEdge: true });
      out.push({ x: px, y: WALL + 0.04, z: pz, ...(alongX ? { w: seg, d: t + 0.1 } : { w: t + 0.1, d: seg }), h: 0.08 });
    }
  }
  // the slots' sills glow too
  out.push({ x, y: SILL - 0.04, z: z1 - t / 2, w: SLOT, h: 0.08, d: t + 0.1 }, { x, y: SILL - 0.04, z: z0 + t / 2, w: SLOT, h: 0.08, d: t + 0.1 });
  out.push({ x: x1 - t / 2, y: SILL - 0.04, z, w: t + 0.1, h: 0.08, d: SLOT }, { x: x0 + t / 2, y: SILL - 0.04, z, w: t + 0.1, h: 0.08, d: SLOT });
  // flights round the walls, with their landings
  out.push(...flight({ x: ix0 + B, z: iz0 + B / 2, dir: '+x', y0: 0, w: B }));
  out.push({ x: ix1 - B / 2, y: 0.8, z: (iz0 + iz0 + B + 2.8) / 2, w: B, h: 1.6, d: B + 2.8, noEdge: true }); // SE landing + what holds flight 2
  out.push(...flight({ x: ix1 - B / 2, z: iz0 + B, dir: '+z', y0: 1.6, w: B }));
  out.push({ x: ix1 - B / 2, y: 1.6, z: iz1 - B / 2, w: B, h: 3.2, d: B, noEdge: true }); // NE landing
  out.push(...flight({ x: ix1 - B, z: iz1 - B / 2, dir: '-x', y0: 3.2, w: B }));
  out.push({ x: ix0 + B / 2, y: 4.8 - 0.15, z: iz1 - B / 2, w: B, h: 0.3, d: B, noEdge: true }); // NW landing
  out.push(...flight({ x: ix0 + B / 2, z: iz1 - B, dir: '-z', y0: 4.8, w: B }));
  // the platform: the south band (with the head of the last flight) and the middle
  out.push({ x: (ix0 + ix1) / 2, y: TOP - 0.15, z: iz0 + B / 2, w: ix1 - ix0, h: 0.3, d: B, noEdge: true });
  out.push({ x: (ix0 + B + ix1) / 2, y: TOP - 0.15, z: (iz0 + B + iz1 - B) / 2, w: ix1 - ix0 - B, h: 0.3, d: iz1 - iz0 - 2 * B, noEdge: true });
  // corbelled cornice under the parapet, corner pilasters, door frame, blind windows
  for (const [px, pz, ry, len] of [[x, z1, 0, s + 0.8], [x, z0, Math.PI, s + 0.8], [x1, z, Math.PI / 2, s], [x0, z, -Math.PI / 2, s]]) {
    out.push(prop('cornice', px, pz, ry, TOP - 0.4, { sx: len, deco: true }));
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(prop('pilaster', x + sx * (s / 2 - 0.22), z + sz * (s / 2 - 0.22), 0, 0, { deco: true }));
  out.push(prop('doorframe', x0, z, -Math.PI / 2, 0, { deco: true }));
  out.push(prop('window', x, z1, 0, 3.6, { deco: true }));
  out.push(prop('window', x1, z, Math.PI / 2, 2.0, { deco: true }));
  out.push(prop('window', x1, z, Math.PI / 2, 4.4, { deco: true }));
  out.push(prop('window', x, z0, Math.PI, 3.0, { deco: true }));
  out.push({ ...prop('towerroof', x, z, 0, WALL), sym: true });
  return out;
}
