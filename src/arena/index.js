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
import { MAPS } from './layout.js';

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
    this.buildings = [];
    this.root = new THREE.Group();
    this.root.name = 'arena';
    // Materials live for the whole session: swapping maps only swaps geometry,
    // so no shader program is ever compiled after boot.
    this.material = new THREE.MeshStandardMaterial({ color: GREY, roughness: 0.9, metalness: 0 });
    this.floorMaterial = new THREE.MeshStandardMaterial({ color: FLOOR, roughness: 0.95, metalness: 0 });
    const lite = !!ctx.config.q?.lite;
    const neon = lite ? new THREE.Color(0.0, 0.78, 1.0) : NEON;
    this.lineMaterial = new THREE.MeshBasicMaterial({ color: neon, toneMapped: false });
    this.gridMaterial = new THREE.LineBasicMaterial({ color: GRID, toneMapped: false });
    ctx.scene.add(this.root);
    this.mapId = null;
    this.load('grid');
    const render = ctx.get('render');
    if (render) render.probeDisabled = true;
    render?.patchMaterials?.(this.root);
    this._spawnIndex = 0;
  }

  /**
   * Build map `id` (layout.js MAPS), replacing the current one: meshes,
   * physics statics, spawns, bounds. Cheap (a few ms); done between matches.
   * @returns {boolean} whether the map changed
   */
  load(id) {
    const map = MAPS[id] ?? MAPS.grid;
    const key = MAPS[id] ? id : 'grid';
    if (key === this.mapId) return false;
    const ctx = this.ctx;
    const physics = ctx.get('physics');
    if (this.mesh) {
      physics.removeStatic(this.mesh);
      physics.removeStatic(this.floor);
      for (const o of [this.mesh, this.floor, this.edges, this.grid]) {
        this.root.remove(o);
        o.geometry.dispose();
      }
    }
    const layout = map.layout;
    this.layout = layout;
    this.mapId = key;

    const boxGeos = [];
    const edgeGeos = [];
    let floorGeo = null;
    for (const b of layout.boxes) {
      const g = new THREE.BoxGeometry(b.w, b.h, b.d);
      g.translate(b.x, b.y, b.z);
      if (b.floor) floorGeo = g;
      else boxGeos.push(g);
      edgeGeos.push(...edgeBars(b, b.floor ? 0.08 : 0.045));
    }
    this.mesh = new THREE.Mesh(mergeGeometries(boxGeos), this.material);
    this.mesh.name = 'arena-boxes';
    this.mesh.userData.surface = 'concrete';
    this.mesh.castShadow = this.mesh.receiveShadow = true; // lite renderer's shadow map
    this.floor = new THREE.Mesh(floorGeo, this.floorMaterial);
    this.floor.name = 'arena-floor';
    this.floor.receiveShadow = true;
    this.edges = new THREE.Mesh(mergeGeometries(edgeGeos), this.lineMaterial);
    this.edges.name = 'arena-neon';
    this.edges.userData.owNoShadow = true;
    this.grid = new THREE.LineSegments(gridGeometry(layout.size, GRID_STEP), this.gridMaterial);
    this.grid.userData.owNoShadow = true;
    this.root.add(this.mesh, this.floor, this.edges, this.grid);
    for (const g of boxGeos) g.dispose();
    for (const g of edgeGeos) g.dispose();
    this.root.updateMatrixWorld(true);

    physics.addStatic(this.mesh, 'concrete');
    physics.addStatic(this.floor, 'concrete');
    physics.rebuildStatic();

    const h = layout.size / 2;
    this.bounds = new THREE.Box3(new THREE.Vector3(-h, -1, -h), new THREE.Vector3(h, 8, h));
    this.spawnPoints = layout.spawns.map((s, i) => ({
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
    // shadows cover the whole map (and redraw once if the shadow map is frozen)
    const render = ctx.peek?.('render');
    render?.fitShadow?.(layout.size / 2);
    if (render?.sun) render.sun.shadow.needsUpdate = true;
    // the minimap bakes the level once: ask for a fresh bake
    const mm = ctx.peek?.('ui')?.minimap;
    if (mm) {
      mm.bakeDone = false;
      mm.bakeTries = 0;
    }
    ctx.events?.emit?.('world:map', { id: key });
    console.info(`[arena] map ${key}: ${layout.boxes.length} boxes · ${this.stats.staticTris} tris`);
    return true;
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
    for (const b of this.layout.boxes) {
      if (b.wall || b.floor) continue;
      if (Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2) top = Math.max(top, b.y + b.h / 2);
    }
    return top;
  }

  isOpen(x, z, margin = 0.4) {
    const h = this.layout.size / 2 - 1 - margin;
    if (Math.abs(x) > h || Math.abs(z) > h) return false;
    for (const b of this.layout.boxes) {
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
