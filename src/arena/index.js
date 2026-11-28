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
import { pieceGeometry, edgeGeometries, topAt, insideXZ } from './shapes.js';

const GREY = 0x8a8f96;
/** Floor is darker than the boxes so the ground plane never washes out to white under the sun. */
const FLOOR = 0x2c3137;
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
    // one vertex-coloured material per layer: maps paint their own colours
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9, metalness: 0 });
    this.floorMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, metalness: 0 });
    const lite = !!ctx.config.q?.lite;
    // edge colours come per piece (vertex colours); the full renderer pushes them into HDR
    this.lineMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(lite ? 1 : 3), vertexColors: true, toneMapped: false });
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
      if (this.clip) physics.removeStatic(this.clip);
      for (const o of [this.mesh, this.floor, this.edges, this.grid, this.deco, this.clip]) {
        if (!o) continue;
        this.root.remove(o);
        o.geometry.dispose();
      }
      this.deco = this.clip = null;
    }
    const layout = map.layout;
    this.layout = layout;
    this.mapId = key;

    // solid pieces collide and draw; deco pieces only draw (railings, shutters,
    // awnings: no snagging, nothing for physics to test); hidden pieces only
    // collide (the smooth ramp under a flight of drawn steps)
    const boxGeos = [];
    const decoGeos = [];
    const clipGeos = [];
    const edgeGeos = [];
    const floorGeos = []; // usually one slab; a map with a sunken canal has several
    for (const b of layout.boxes) {
      if (b.floor) floorGeos.push(pieceGeometry(b, layout.floorColor ?? FLOOR));
      else if (b.hidden) clipGeos.push(pieceGeometry(b, GREY));
      else (b.deco ? decoGeos : boxGeos).push(pieceGeometry(b, layout.color ?? GREY));
      if (!b.hidden) edgeGeos.push(...edgeGeometries(b, b.floor ? 0.08 : 0.045, layout.edgeColor));
    }
    this.mesh = new THREE.Mesh(mergeGeometries(boxGeos), this.material);
    this.mesh.name = 'arena-boxes';
    this.mesh.userData.surface = 'concrete';
    this.mesh.castShadow = this.mesh.receiveShadow = true; // lite renderer's shadow map
    const floorGeo = floorGeos.length > 1 ? mergeGeometries(floorGeos) : floorGeos[0];
    this.floor = new THREE.Mesh(floorGeo, this.floorMaterial);
    this.floor.name = 'arena-floor';
    this.floor.receiveShadow = true;
    this.edges = new THREE.Mesh(mergeGeometries(edgeGeos), this.lineMaterial);
    this.edges.name = 'arena-neon';
    this.edges.userData.owNoShadow = true;
    this.grid = new THREE.LineSegments(gridGeometry(layout.size, GRID_STEP, layout.depth ?? layout.size), this.gridMaterial);
    this.grid.visible = layout.grid !== false;
    this.grid.userData.owNoShadow = true;
    this.root.add(this.mesh, this.floor, this.edges, this.grid);
    if (decoGeos.length) {
      this.deco = new THREE.Mesh(mergeGeometries(decoGeos), this.material);
      this.deco.name = 'arena-deco';
      this.deco.castShadow = this.deco.receiveShadow = true;
      this.root.add(this.deco);
    }
    if (clipGeos.length) {
      this.clip = new THREE.Mesh(mergeGeometries(clipGeos), this.material);
      this.clip.name = 'arena-clip';
      this.clip.visible = false;
      this.root.add(this.clip);
    }
    for (const g of [...decoGeos, ...clipGeos]) g.dispose();
    for (const g of boxGeos) g.dispose();
    for (const g of edgeGeos) g.dispose();
    this.root.updateMatrixWorld(true);

    physics.addStatic(this.mesh, 'concrete');
    physics.addStatic(this.floor, 'concrete');
    if (this.clip) physics.addStatic(this.clip, 'concrete');
    physics.rebuildStatic();

    const h = layout.size / 2, hz = (layout.depth ?? layout.size) / 2;
    this.bounds = new THREE.Box3(new THREE.Vector3(-h, -1, -hz), new THREE.Vector3(h, 8, hz));
    this.spawnPoints = layout.spawns.map((s, i) => ({
      position: new THREE.Vector3(s.x, s.y, s.z),
      yaw: s.yaw,
      tag: i === 0 ? 'A' : 'B',
    }));
    this.stats = {
      staticTris: (this.mesh.geometry.attributes.position.count + this.floor.geometry.attributes.position.count) / 3,
      instTris: 0,
      instances: 0,
      drawCalls: 4,
    };
    // shadows cover the whole map (and redraw once if the shadow map is frozen)
    const render = ctx.peek?.('render');
    render?.fitShadow?.(Math.max(layout.size, layout.depth ?? layout.size) / 2);
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

  /** Top of the highest piece under (x, z) (ramps by their slope), or the floor's own height. */
  groundHeight(x, z) {
    let floor = -Infinity;
    for (const b of this.layout.boxes) if (b.floor) floor = Math.max(floor, topAt(b, x, z));
    let top = Number.isFinite(floor) ? floor : 0;
    for (const b of this.layout.boxes) {
      if (b.wall || b.floor) continue;
      top = Math.max(top, topAt(b, x, z));
    }
    return top;
  }

  isOpen(x, z, margin = 0.4) {
    const h = this.layout.size / 2 - 1 - margin;
    const hz = (this.layout.depth ?? this.layout.size) / 2 - 1 - margin;
    if (Math.abs(x) > h || Math.abs(z) > hz) return false;
    for (const b of this.layout.boxes) {
      if (b.wall || b.floor || b.deco) continue;
      if (insideXZ(b, x, z, margin)) return false;
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

function gridGeometry(size, step, depth = size) {
  const h = size / 2 - 1, hz = depth / 2 - 1;
  const pts = [];
  for (let v = -h; v <= h + 1e-6; v += step) pts.push(v, 0.01, -hz, v, 0.01, hz);
  for (let v = -hz; v <= hz + 1e-6; v += step) pts.push(-h, 0.01, v, h, 0.01, v);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}
