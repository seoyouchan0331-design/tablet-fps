/**
 * Low-poly weapons for the tablet (lite) build.
 *
 * Each gun is drawn as a handful of SIDE PROFILES extruded to their width —
 * receiver, magwell, grip, stock, slide — plus a few lathed/octagonal parts
 * (barrel, handguard, optic). Profiles carry the silhouette, which is what makes
 * a gun read as a gun at a glance, for ~1-2 k triangles instead of 17-54 k.
 *
 * The RIG CONTRACT is taken verbatim from the detailed model: `nodes` (hand
 * grips, muzzle, sight, mag seat, bolt travel...) are copied, and every moving
 * part is rebuilt inside the detailed part's own bounds in its own local frame,
 * so reloads, recoil and hand placement are unchanged.
 *
 * Coordinates (weapon-local metres): +Y up, -Z toward the muzzle, +X to the
 * ejection side. Profiles below are listed as [z, y].
 *
 * Materials: lp_body (charcoal), lp_accent (per-weapon colour), lp_metal,
 * lp_dark (ports, slots, magazines), lp_grip (rubber).
 */
import * as THREE from 'three';
import { Assembly, box, extrude, rodZ, latheZ } from '../geometry.js';
import { buildRifle } from './rifle.js';
import { buildSmg } from './smg.js';
import { buildPistol } from './pistol.js';

// Shotgun and sniper have no detailed model: they ride the rifle's rig (grip,
// mag seat, hand targets, bolt travel) with their own muzzle position.
const DETAILED = { rifle: buildRifle, smg: buildSmg, pistol: buildPistol, shotgun: buildRifle, sniper: buildRifle };
/** Muzzle crown z for the guns that override the rifle's. */
export const MUZZLE_Z = { shotgun: -0.56, sniper: -0.74 };

/** Extrude a [z, y] side profile to `width` along X, centred on x = cx. */
function side(points, width, cx = 0, bevel = 0.0012) {
  const g = extrude(points.map(([z, y]) => [-z, y]), width, { bevel, curveSegments: 1 });
  g.rotateY(Math.PI / 2); // shape X -> world -Z, extrusion Z -> world X
  g.translate(cx, 0, 0);
  return g;
}

/** Hollow tube along Z, centred on z = 0: optic bodies and lens rings must not block ADS. */
function tubeZ(rIn, rOut, len, seg = 12) {
  const z0 = -len / 2;
  const z1 = len / 2;
  return latheZ([[z0, rIn], [z0, rOut], [z1, rOut], [z1, rIn], [z0, rIn]], seg);
}

/** Red-dot reticle: a tiny unlit sphere sitting on the sight axis. */
function reticle(a, x, y, z) {
  a.add(new THREE.SphereGeometry(0.0009, 8, 6), 'lp_reticle', { x, y, z });
}

/** Octagonal prism along Z (handguards). */
function octZ(r, len) {
  const g = new THREE.CylinderGeometry(r, r, len, 8, 1, false);
  g.rotateY(Math.PI / 8); // flat top
  g.rotateX(Math.PI / 2);
  return g;
}

function boundsOf(asm) {
  const b = new THREE.Box3();
  const map = asm.build();
  for (const g of map.values()) {
    g.computeBoundingBox();
    b.union(g.boundingBox);
    g.dispose();
  }
  return b;
}

/** A moving part rebuilt as a chamfered block filling its detailed bounds. */
function blockPart(name, b, mat, inset = 0.0005) {
  const a = new Assembly(name);
  const sx = b.max.x - b.min.x - inset * 2;
  const sy = b.max.y - b.min.y - inset * 2;
  const sz = b.max.z - b.min.z - inset * 2;
  a.add(box(Math.max(sx, 0.002), Math.max(sy, 0.002), Math.max(sz, 0.002), 0.0015), mat, {
    x: (b.min.x + b.max.x) / 2,
    y: (b.min.y + b.max.y) / 2,
    z: (b.min.z + b.max.z) / 2,
  });
  return a;
}

/** Curved box magazine: a straight upper and a forward-swept lower, inside bounds. */
function magazinePart(name, b) {
  const a = new Assembly(name);
  const w = b.max.x - b.min.x - 0.002;
  const top = b.max.y - 0.001;
  const bottom = b.min.y + 0.001;
  const z0 = b.min.z + 0.001;
  const z1 = b.max.z - 0.001;
  const depth = z1 - z0;
  const mid = top - (top - bottom) * 0.55;
  const sweep = Math.min(0.02, depth * 0.25);
  // profile: rear edge straight then swept forward toward the base
  a.add(
    side(
      [
        [z1, top],
        [z1, mid],
        [z1 - sweep, bottom + 0.012],
        [z1 - sweep, bottom],
        [z0, bottom],
        [z0, mid],
        [z0 + 0.002, top],
      ],
      w,
      (b.min.x + b.max.x) / 2,
      0.0015
    ),
    'lp_dark'
  );
  // base plate in the accent colour
  a.add(box(w + 0.001, 0.008, depth - sweep, 0.0015), 'lp_accent', {
    x: (b.min.x + b.max.x) / 2,
    y: bottom + 0.004,
    z: (z0 + z1 - sweep) / 2,
  });
  return a;
}

/* ------------------------------------------------------------------------ */
/*  bodies                                                                  */
/* ------------------------------------------------------------------------ */

function rifleBody() {
  const a = new Assembly('lp-rifle-body');
  const bore = 0.075;
  // upper receiver with the flat-top rail deck
  a.add(side([[0.055, 0.058], [0.055, 0.097], [0.047, 0.1036], [-0.143, 0.1036], [-0.143, 0.06], [-0.05, 0.057]], 0.03), 'lp_body');
  // lower receiver: magwell, trigger well
  a.add(
    side(
      [[0.05, 0.058], [0.05, 0.036], [0.032, 0.03], [-0.018, 0.03], [-0.024, 0.008], [-0.124, 0.008], [-0.128, 0.04], [-0.133, 0.058]],
      0.028
    ),
    'lp_body'
  );
  // trigger guard
  a.add(box(0.012, 0.004, 0.062, 0.001), 'lp_body', { y: 0.012, z: 0.012 });
  a.add(box(0.012, 0.02, 0.004, 0.001), 'lp_body', { y: 0.02, z: -0.017 });
  // ejection port and forward assist
  a.add(box(0.002, 0.013, 0.034, 0), 'lp_dark', { x: 0.0152, y: 0.079, z: -0.052 });
  a.add(rodZ(0.007, 0.007, 0.022, 8), 'lp_metal', { x: 0.017, y: 0.084, z: 0.005, ry: 0.35 });
  // rail running the whole top, with cross slots
  a.add(box(0.022, 0.008, 0.44, 0.001), 'lp_metal', { y: 0.1036, z: -0.165 });
  for (let i = 0; i < 20; i++) a.add(box(0.0235, 0.0025, 0.0035, 0), 'lp_dark', { y: 0.1065, z: 0.045 - i * 0.021 });
  // pistol grip (raked) in rubber
  a.add(side([[0.052, 0.03], [0.088, 0.034], [0.12, -0.064], [0.113, -0.074], [0.082, -0.074], [0.05, 0.004]], 0.026), 'lp_grip');
  // buffer tube + stock + butt pad
  a.add(rodZ(0.0155, 0.0155, 0.13, 10), 'lp_metal', { y: bore, z: 0.12 });
  a.add(side([[0.145, 0.096], [0.236, 0.104], [0.236, 0.012], [0.222, 0.006], [0.18, 0.04], [0.145, 0.052]], 0.036), 'lp_accent');
  a.add(box(0.038, 0.098, 0.014, 0.003), 'lp_grip', { y: 0.056, z: 0.243 });
  // handguard (accent colour) with side slots
  a.add(octZ(0.0215, 0.24), 'lp_accent', { y: bore, z: -0.265 });
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 4; i++) a.add(box(0.002, 0.008, 0.032, 0), 'lp_dark', { x: sx * 0.0205, y: bore, z: -0.19 - i * 0.05 });
  }
  // barrel, gas block / front sight, muzzle brake with ports
  a.add(rodZ(0.0075, 0.0075, 0.095, 10), 'lp_metal', { y: bore, z: -0.432 });
  a.add(box(0.016, 0.024, 0.014, 0.002), 'lp_body', { y: 0.088, z: -0.392 });
  a.add(box(0.004, 0.016, 0.006, 0.001), 'lp_body', { y: 0.108, z: -0.392 });
  a.add(rodZ(0.011, 0.011, 0.035, 8), 'lp_dark', { y: bore, z: -0.4845 });
  for (const sx of [-1, 1]) a.add(box(0.002, 0.006, 0.02, 0), 'lp_metal', { x: sx * 0.0105, y: bore, z: -0.486 });
  // rear sight
  a.add(box(0.016, 0.014, 0.012, 0.0015), 'lp_body', { y: 0.114, z: 0.04 });
  // red-dot optic on a cantilever mount (hollow-looking tube, sight centre y .142)
  a.add(box(0.016, 0.028, 0.03, 0.002), 'lp_body', { y: 0.113, z: 0.0 });
  // Thin wall and no rear ring: the eye sits right behind the tube in ADS.
  a.add(tubeZ(0.0158, 0.0172, 0.07), 'lp_body', { y: 0.142, z: -0.008 });
  a.add(tubeZ(0.0158, 0.0188, 0.008), 'lp_accent', { y: 0.142, z: -0.04 });
  reticle(a, 0, 0.142, -0.04);
  return a;
}

function smgBody() {
  const a = new Assembly('lp-smg-body');
  const bore = 0.068;
  // tubular upper receiver
  a.add(side([[0.045, 0.05], [0.045, 0.086], [0.038, 0.09], [-0.172, 0.09], [-0.172, 0.05]], 0.028), 'lp_body');
  // lower with magwell and trigger well
  a.add(
    side([[0.04, 0.05], [0.04, 0.03], [0.004, 0.024], [-0.026, 0.024], [-0.03, 0.004], [-0.098, 0.004], [-0.104, 0.03], [-0.12, 0.05]], 0.026),
    'lp_body'
  );
  a.add(box(0.011, 0.004, 0.05, 0.001), 'lp_body', { y: 0.008, z: 0.014 });
  a.add(box(0.002, 0.012, 0.026, 0), 'lp_dark', { x: 0.0142, y: 0.07, z: -0.042 });
  // charging tube on the left
  a.add(rodZ(0.006, 0.006, 0.12, 8), 'lp_metal', { x: -0.016, y: 0.077, z: -0.1 });
  // rail
  a.add(box(0.02, 0.007, 0.21, 0.001), 'lp_metal', { y: 0.0925, z: -0.065 });
  for (let i = 0; i < 10; i++) a.add(box(0.0215, 0.0022, 0.0032, 0), 'lp_dark', { y: 0.0955, z: 0.03 - i * 0.02 });
  // grip
  a.add(side([[0.03, 0.02], [0.06, 0.026], [0.088, -0.066], [0.082, -0.073], [0.058, -0.073], [0.028, 0.0]], 0.025), 'lp_grip');
  // handguard + vertical foregrip
  a.add(octZ(0.0185, 0.12), 'lp_accent', { y: bore, z: -0.232 });
  for (const sx of [-1, 1]) for (let i = 0; i < 2; i++) a.add(box(0.002, 0.007, 0.03, 0), 'lp_dark', { x: sx * 0.0177, y: bore, z: -0.205 - i * 0.05 });
  a.add(side([[-0.19, 0.052], [-0.222, 0.052], [-0.226, -0.03], [-0.214, -0.036], [-0.198, -0.036], [-0.19, -0.03]], 0.022), 'lp_grip');
  // flash hider
  a.add(rodZ(0.01, 0.01, 0.05, 8), 'lp_dark', { y: bore, z: -0.317 });
  // skeleton folding stock: two struts and a butt plate
  a.add(rodZ(0.0055, 0.0055, 0.17, 6), 'lp_metal', { y: 0.08, z: 0.13 });
  a.add(rodZ(0.0055, 0.0055, 0.17, 6), 'lp_metal', { y: 0.032, z: 0.13 });
  a.add(box(0.032, 0.1, 0.014, 0.003), 'lp_accent', { y: 0.052, z: 0.222 });
  // compact red dot (sight centre y .123)
  a.add(box(0.028, 0.012, 0.04, 0.002), 'lp_body', { y: 0.1, z: 0.007 });
  a.add(tubeZ(0.0128, 0.0142, 0.045), 'lp_body', { y: 0.123, z: 0.005 });
  a.add(tubeZ(0.0128, 0.0162, 0.006), 'lp_accent', { y: 0.123, z: -0.018 });
  reticle(a, 0, 0.123, -0.018);
  return a;
}

function pistolBody() {
  const a = new Assembly('lp-pistol-frame');
  // dust cover / frame rail under the slide
  a.add(side([[0.055, 0.016], [0.055, 0.024], [-0.125, 0.024], [-0.125, 0.012], [-0.035, 0.008], [-0.026, -0.004], [0.022, -0.004]], 0.022), 'lp_body');
  // trigger guard (squared, as on a polymer pistol)
  a.add(box(0.011, 0.004, 0.05, 0.001), 'lp_body', { y: -0.03, z: -0.008 });
  a.add(box(0.011, 0.03, 0.005, 0.001), 'lp_body', { y: -0.016, z: -0.034 });
  // grip with 18-degree rake, in rubber with an accent backstrap
  a.add(side([[0.018, 0.006], [0.058, 0.014], [0.086, -0.088], [0.078, -0.094], [0.046, -0.094], [0.014, -0.004]], 0.028), 'lp_grip');
  a.add(side([[0.058, 0.014], [0.066, 0.016], [0.092, -0.086], [0.086, -0.09]], 0.026), 'lp_accent');
  return a;
}

/** Pistol slide, authored in the slide's own frame (origin = bore at slide rest). */
function pistolSlide(b) {
  const a = new Assembly('lp-pistol-slide');
  const top = 0.014;
  a.add(side([[0.05, -0.01], [0.05, top - 0.004], [0.044, top], [-0.124, top], [-0.13, top - 0.006], [-0.13, -0.01]], 0.024), 'lp_metal');
  // rear serrations
  for (let i = 0; i < 6; i++) {
    for (const sx of [-1, 1]) a.add(box(0.0016, 0.016, 0.0022, 0), 'lp_dark', { x: sx * 0.0121, y: 0.002, z: 0.04 - i * 0.005 });
  }
  // ejection port, muzzle face, front sight
  a.add(box(0.0016, 0.01, 0.03, 0), 'lp_dark', { x: 0.0121, y: 0.004, z: -0.005 });
  a.add(rodZ(0.0055, 0.0055, 0.003, 8), 'lp_dark', { y: 0.0, z: -0.1305 });
  a.add(box(0.004, 0.006, 0.006, 0.001), 'lp_dark', { y: top + 0.003, z: -0.115 });
  // slide-mounted mini reflex, window centred on the sight node (local y .026)
  const oz = 0.02;
  a.add(box(0.022, 0.006, 0.034, 0.0015), 'lp_body', { y: top + 0.003, z: oz });
  a.add(box(0.003, 0.02, 0.03, 0.001), 'lp_body', { x: -0.0095, y: 0.026, z: oz });
  a.add(box(0.003, 0.02, 0.03, 0.001), 'lp_body', { x: 0.0095, y: 0.026, z: oz });
  a.add(box(0.022, 0.003, 0.03, 0.001), 'lp_accent', { y: Math.min(b.max.y, 0.04) - 0.002, z: oz });
  reticle(a, 0, 0.026, oz - 0.014);
  return a;
}


/** Rifle-rig lower half shared by the shotgun and sniper: lower receiver, guard, grip. */
function rigLower(a) {
  a.add(
    side(
      [[0.05, 0.058], [0.05, 0.036], [0.032, 0.03], [-0.018, 0.03], [-0.024, 0.008], [-0.124, 0.008], [-0.128, 0.04], [-0.133, 0.058]],
      0.03
    ),
    'lp_body'
  );
  a.add(box(0.012, 0.004, 0.062, 0.001), 'lp_body', { y: 0.012, z: 0.012 });
  a.add(box(0.012, 0.02, 0.004, 0.001), 'lp_body', { y: 0.02, z: -0.017 });
  a.add(side([[0.052, 0.03], [0.088, 0.034], [0.12, -0.064], [0.113, -0.074], [0.082, -0.074], [0.05, 0.004]], 0.026), 'lp_grip');
}

function shotgunBody() {
  const a = new Assembly('lp-shotgun-body');
  const bore = 0.075;
  rigLower(a);
  // slab-sided receiver, taller than the rifle's
  a.add(side([[0.055, 0.056], [0.055, 0.1], [0.044, 0.108], [-0.16, 0.108], [-0.17, 0.098], [-0.17, 0.056]], 0.036), 'lp_body');
  a.add(box(0.002, 0.018, 0.05, 0), 'lp_dark', { x: 0.0185, y: 0.08, z: -0.06 }); // ejection port
  // heavy barrel over a magazine tube, joined by a barrel band
  a.add(rodZ(0.0118, 0.0118, 0.4, 12), 'lp_metal', { y: 0.088, z: -0.36 });
  a.add(rodZ(0.0125, 0.0125, 0.3, 10), 'lp_dark', { y: 0.058, z: -0.31 });
  a.add(box(0.03, 0.05, 0.016, 0.003), 'lp_body', { y: 0.073, z: -0.47 });
  // ribbed pump forend (accent) where the support hand rides
  a.add(octZ(0.0215, 0.17), 'lp_accent', { y: bore, z: -0.27 });
  for (let i = 0; i < 6; i++) a.add(box(0.046, 0.004, 0.006, 0), 'lp_dark', { y: bore - 0.021, z: -0.2 - i * 0.026 });
  // muzzle: a short choke with a bead
  a.add(rodZ(0.0135, 0.0135, 0.028, 12), 'lp_dark', { y: 0.088, z: -0.546 });
  a.add(new THREE.SphereGeometry(0.003, 8, 6), 'lp_accent', { y: 0.103, z: -0.54 });
  // vent rib along the barrel top
  a.add(box(0.008, 0.004, 0.36, 0.001), 'lp_metal', { y: 0.1015, z: -0.36 });
  // solid stock with a thick recoil pad
  a.add(side([[0.05, 0.1], [0.236, 0.106], [0.236, 0.004], [0.2, 0.004], [0.13, 0.042], [0.05, 0.04]], 0.038), 'lp_accent');
  a.add(box(0.04, 0.104, 0.018, 0.004), 'lp_grip', { y: 0.055, z: 0.243 });
  // compact red dot on a riser (sight centre y .142)
  a.add(box(0.018, 0.026, 0.032, 0.002), 'lp_body', { y: 0.12, z: 0.0 });
  a.add(tubeZ(0.0145, 0.016, 0.04), 'lp_body', { y: 0.142, z: -0.004 });
  a.add(tubeZ(0.0145, 0.0175, 0.006), 'lp_accent', { y: 0.142, z: -0.024 });
  reticle(a, 0, 0.142, -0.024);
  return a;
}

function sniperBody() {
  const a = new Assembly('lp-sniper-body');
  const bore = 0.075;
  rigLower(a);
  // round bolt-action receiver
  a.add(rodZ(0.019, 0.019, 0.2, 12), 'lp_metal', { y: bore + 0.004, z: -0.05 });
  // bolt handle with a ball knob on the right
  a.add(box(0.034, 0.006, 0.008, 0.001), 'lp_metal', { x: 0.03, y: bore - 0.004, z: 0.02, rz: -0.5 });
  a.add(new THREE.SphereGeometry(0.008, 10, 8), 'lp_dark', { x: 0.046, y: bore - 0.014, z: 0.02 });
  // chassis: long forend in the accent colour, slotted
  a.add(side([[-0.15, 0.09], [-0.48, 0.09], [-0.5, 0.075], [-0.48, 0.05], [-0.15, 0.048]], 0.044), 'lp_accent');
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) a.add(box(0.002, 0.012, 0.05, 0), 'lp_dark', { x: sx * 0.0222, y: 0.07, z: -0.2 - i * 0.075 });
  // fluted heavy barrel and a brake
  a.add(rodZ(0.0105, 0.0085, 0.25, 10), 'lp_metal', { y: bore, z: -0.6 });
  a.add(box(0.022, 0.03, 0.05, 0.003), 'lp_dark', { y: bore, z: -0.71 });
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) a.add(box(0.002, 0.016, 0.008, 0), 'lp_metal', { x: sx * 0.0115, y: bore, z: -0.695 - i * 0.014 });
  // adjustable stock: thumbhole profile with a cheek riser
  a.add(side([[0.05, 0.1], [0.236, 0.104], [0.236, 0.01], [0.215, 0.004], [0.16, 0.03], [0.13, 0.06], [0.1, 0.06], [0.05, 0.04]], 0.036), 'lp_accent');
  a.add(box(0.028, 0.012, 0.09, 0.003), 'lp_body', { y: 0.11, z: 0.17 });
  a.add(box(0.04, 0.1, 0.016, 0.004), 'lp_grip', { y: 0.055, z: 0.243 });
  // scope: rings, tube, turrets, objective and ocular bells (hollow, sight y .142)
  for (const z of [-0.075, 0.01]) a.add(box(0.012, 0.03, 0.016, 0.002), 'lp_body', { y: 0.116, z });
  a.add(tubeZ(0.0148, 0.0165, 0.16), 'lp_body', { y: 0.142, z: -0.03 });
  a.add(tubeZ(0.022, 0.025, 0.06), 'lp_body', { y: 0.142, z: -0.135 });
  a.add(tubeZ(0.016, 0.0195, 0.04), 'lp_body', { y: 0.142, z: 0.065 });
  a.add(tubeZ(0.022, 0.0258, 0.008), 'lp_accent', { y: 0.142, z: -0.168 });
  a.add(rodZ(0.008, 0.008, 0.016, 10).rotateX(Math.PI / 2), 'lp_metal', { y: 0.166, z: -0.03 });
  a.add(rodZ(0.008, 0.008, 0.016, 10).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), 'lp_metal', { x: 0.024, y: 0.142, z: -0.03 });
  return a;
}

const BODIES = { rifle: rifleBody, smg: smgBody, pistol: pistolBody, shotgun: shotgunBody, sniper: sniperBody };
export const ACCENTS = { rifle: 0xff7a1f, smg: 0x19c3d6, pistol: 0xffc21f, shotgun: 0xe0413a, sniper: 0x6fd36a };

/**
 * Low-poly model with the detailed model's rig contract.
 * @param {'rifle'|'smg'|'pistol'|'shotgun'|'sniper'} id
 */
export function lowpoly(id) {
  const ref = DETAILED[id]();
  const moving = {};
  for (const [name, asm] of Object.entries(ref.moving)) {
    const b = boundsOf(asm);
    if (name === 'magazine') moving[name] = magazinePart(`lp-${id}-mag`, b);
    else if (name === 'slide') moving[name] = pistolSlide(b);
    else moving[name] = blockPart(`lp-${id}-${name}`, b, name === 'trigger' || name === 'selector' ? 'lp_body' : 'lp_metal');
  }
  ref.body.build().forEach((g) => g.dispose());
  const body = BODIES[id]();
  // Each gun gets its own accent colour: give its accent bucket a per-weapon key.
  for (const asm of [body, ...Object.values(moving)]) {
    const acc = asm.buckets.get('lp_accent');
    if (acc) {
      asm.buckets.delete('lp_accent');
      asm.buckets.set(`lp_accent_${id}`, acc);
    }
  }
  let nodes = ref.nodes;
  if (MUZZLE_Z[id] !== undefined) nodes = { ...nodes, muzzle: [nodes.muzzle[0], nodes.muzzle[1], MUZZLE_Z[id]] };
  const extra = id === 'shotgun' || id === 'sniper' ? { id, label: id.toUpperCase(), fxClass: id } : {};
  return { ...ref, ...extra, nodes, body, moving, accent: ACCENTS[id] };
}
