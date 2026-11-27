/**
 * ArenaSystem — the 1v1 grey-box arena. Replaces the street WorldSystem and
 * registers under the same id ('world') so player, render, minimap and prewarm
 * keep finding the API they already use:
 *
 *   root, bounds, spawnPoints, spawn(i), groundHeight(x,z), isOpen(x,z), stats,
 *   buildings (empty), levelToWorld / worldToLevel (identity), prewarmMaterials()
 *
 * Look: flat grey boxes, neon edge lines, a faint floor grid for a sense of
 * speed. Everything merges into one mesh + two line batches (3 draw calls).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ARENA } from './layout.js';

const GREY = 0x8a8f96;
/** Floor is darker than the boxes so the ground plane never washes out to white under the sun. */
const FLOOR = 0x2c3137;
const NEON = new THREE.Color(0.24, 0.95, 1.0).multiplyScalar(3.0); // HDR, survives exposure
const GRID = new THREE.Color(0.24, 0.95, 1.0).multiplyScalar(0.6);
const GRID_STEP = 2;
const KILL_Y = -10;

export class ArenaSystem {
  static id = 'world';
  static deps = ['physics'];

  async init(ctx) {
    this.ctx = ctx;
    this.layout = ARENA;
    this.buildings = [];
    this.root = new THREE.Group();
    this.root.name = 'arena';

    const boxGeos = [];
    const edgeGeos = [];
    let floorGeo = null;
    for (const b of ARENA.boxes) {
      const g = new THREE.BoxGeometry(b.w, b.h, b.d);
      g.translate(b.x, b.y, b.z);
      if (b.floor) floorGeo = g;
      else boxGeos.push(g);
      edgeGeos.push(...edgeBars(b, b.floor ? 0.08 : 0.045));
    }
    this.material = new THREE.MeshStandardMaterial({ color: GREY, roughness: 0.9, metalness: 0 });
    this.mesh = new THREE.Mesh(mergeGeometries(boxGeos), this.material);
    this.mesh.name = 'arena-boxes';
    this.mesh.userData.surface = 'concrete';
    this.mesh.castShadow = this.mesh.receiveShadow = true; // lite renderer's shadow map
    this.root.add(this.mesh);
    this.floorMaterial = new THREE.MeshStandardMaterial({ color: FLOOR, roughness: 0.95, metalness: 0 });
    this.floor = new THREE.Mesh(floorGeo, this.floorMaterial);
    this.floor.name = 'arena-floor';
    this.floor.receiveShadow = true;
    this.root.add(this.floor);

    // Neon edges are thin emissive bars, not GL lines: lines are 1 px on every
    // WebGL implementation and vanish on a Retina tablet.
    // Lite renderer has no HDR headroom: an HDR neon would clip to white there.
    const lite = !!ctx.config.q?.lite;
    const neon = lite ? new THREE.Color(0.0, 0.78, 1.0) : NEON;
    this.lineMaterial = new THREE.MeshBasicMaterial({ color: neon, toneMapped: false });
    this.edges = new THREE.Mesh(mergeGeometries(edgeGeos), this.lineMaterial);
    this.edges.name = 'arena-neon';
    this.edges.userData.owNoShadow = true;
    this.root.add(this.edges);

    this.gridMaterial = new THREE.LineBasicMaterial({ color: GRID, toneMapped: false });
    this.grid = new THREE.LineSegments(gridGeometry(ARENA.size, GRID_STEP), this.gridMaterial);
    this.grid.userData.owNoShadow = true;
    this.root.add(this.grid);

    for (const g of boxGeos) g.dispose();
    boxGeos.length = 0;
    for (const g of edgeGeos) g.dispose();

    ctx.scene.add(this.root);
    this.root.updateMatrixWorld(true);

    const physics = ctx.get('physics');
    physics.addStatic(this.mesh, 'concrete');
    physics.addStatic(this.floor, 'concrete');
    physics.rebuildStatic();
    const render = ctx.get('render');
    // A merged arena is only 3 meshes — below render's "real level present"
    // heuristic — so tell it explicitly not to show its calibration probe.
    if (render) render.probeDisabled = true;
    render?.patchMaterials?.(this.root);

    const h = ARENA.size / 2;
    this.bounds = new THREE.Box3(new THREE.Vector3(-h, -1, -h), new THREE.Vector3(h, 8, h));
    this.spawnPoints = ARENA.spawns.map((s, i) => ({
      position: new THREE.Vector3(s.x, s.y, s.z),
      yaw: s.yaw,
      tag: i === 0 ? 'A' : 'B',
    }));
    this.stats = {
      staticTris: (this.mesh.geometry.index.count + this.floor.geometry.index.count) / 3,
      instTris: 0,
      instances: 0,
      drawCalls: 4,
    };
    this._spawnIndex = 0;
    console.info(`[arena] ${ARENA.boxes.length} boxes · ${this.stats.staticTris} tris · 4 draw calls`);
  }

  async prewarmMaterials(ctx = this.ctx) {
    const render = ctx.peek?.('render');
    const renderer = render?.renderer;
    if (!renderer) return { ok: false, reason: 'no renderer' };
    try {
      await renderer.compileAsync(ctx.scene, ctx.camera);
    } catch {
      /* boot proceeds; programs compile on first draw */
    }
    return { ok: true };
  }

  lateUpdate() {
    const player = this.ctx.peek('player');
    const p = player?.position;
    if (p && p.y < KILL_Y) player.respawn(this._spawnIndex);
  }

  spawn(i = 0) {
    const n = this.spawnPoints.length;
    return this.spawnPoints[((i % n) + n) % n];
  }

  /** Top of the highest box under (x, z), or 0 for the bare floor. */
  groundHeight(x, z) {
    let top = 0;
    for (const b of ARENA.boxes) {
      if (b.wall || b.floor) continue;
      if (Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2) top = Math.max(top, b.y + b.h / 2);
    }
    return top;
  }

  isOpen(x, z, margin = 0.4) {
    const h = ARENA.size / 2 - 1 - margin;
    if (Math.abs(x) > h || Math.abs(z) > h) return false;
    for (const b of ARENA.boxes) {
      if (b.wall || b.floor) continue;
      if (Math.abs(x - b.x) < b.w / 2 + margin && Math.abs(z - b.z) < b.d / 2 + margin) return false;
    }
    return true;
  }

  levelToWorld(x, y, z, out = new THREE.Vector3()) {
    return out.set(x, y, z);
  }

  worldToLevel(x, y, z, out = new THREE.Vector3()) {
    return out.set(x, y, z);
  }

  dispose() {
    this.ctx.scene.remove(this.root);
    this.mesh.geometry.dispose();
    this.floor.geometry.dispose();
    this.floorMaterial.dispose();
    this.edges.geometry.dispose();
    this.grid.geometry.dispose();
    this.material.dispose();
    this.lineMaterial.dispose();
    this.gridMaterial.dispose();
  }
}

/** The 12 edges of a box as thin bars of thickness t. */
function edgeBars(b, t) {
  const out = [];
  const hx = b.w / 2, hy = b.h / 2, hz = b.d / 2;
  for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push(bar(b.w + t, t, t, b.x, b.y + sy * hy, b.z + sz * hz));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(bar(t, b.h + t, t, b.x + sx * hx, b.y, b.z + sz * hz));
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) out.push(bar(t, t, b.d + t, b.x + sx * hx, b.y + sy * hy, b.z));
  return out;
}

function bar(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function gridGeometry(size, step) {
  const h = size / 2 - 1;
  const pts = [];
  for (let v = -h; v <= h + 1e-6; v += step) {
    pts.push(v, 0.01, -h, v, 0.01, h, -h, 0.01, v, h, 0.01, v);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}
