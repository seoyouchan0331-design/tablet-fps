/**
 * LiteRenderSystem — the tablet renderer.
 *
 * The AAA pipeline in index.js (HDR targets, CSM, MRT prepass, GTAO, TAA,
 * auto-exposure, sky aerial perspective, separate viewmodel target) spends its
 * time per pixel, which on an iPad forced dynamic resolution down to ~50 % and
 * blurred everything. A neon grey-box arena needs none of it.
 *
 * This draws the world and the viewmodel straight to the canvas with three's
 * own forward renderer: hardware MSAA, ACES tone mapping, a bright hemisphere +
 * sun, three's built-in shadow map for the arena, and a one-off RoomEnvironment
 * PMREM so metal still reflects something. No sky system.
 *
 * It registers under the same id ('render') and exposes the same public surface
 * other systems touch (renderer, screenSize, addLight, registerPass, ...), with
 * the expensive features reported as absent (depthTexture null, csm null).
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { DynRes } from '../core/dynres.js';

const BACKGROUND = 0xbfe3ff; // clear bright sky blue
const SUN_DIR = new THREE.Vector3(0.45, 0.85, 0.3).normalize();
const ARENA_HALF = 18; // shadow camera covers the arena

export class LiteRenderSystem {
  static id = 'render';
  static deps = [];

  async init(ctx) {
    this.ctx = ctx;
    const q = ctx.config.q;
    this.q = q;
    this.frame = 0;
    this.lite = true;
    this.probeDisabled = true;

    const renderer = new THREE.WebGLRenderer({
      canvas: ctx.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    renderer.setClearColor(BACKGROUND, 1);
    this.renderer = renderer;

    // ---- world lighting -------------------------------------------------
    const scene = ctx.scene;
    scene.background = new THREE.Color(BACKGROUND);
    this.hemi = new THREE.HemisphereLight(0xeaf6ff, 0x9aa3ad, 1.6);
    this.sun = new THREE.DirectionalLight(0xfff4e2, 2.4);
    this.sun.name = 'lite-sun';
    this.sun.position.copy(SUN_DIR).multiplyScalar(30);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -ARENA_HALF;
    sc.right = sc.top = ARENA_HALF;
    sc.near = 1;
    sc.far = 80;
    this.sun.shadow.mapSize.set(q.shadowMapSize ?? 1024, q.shadowMapSize ?? 1024);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.hemi, this.sun, this.sun.target);

    // ---- viewmodel lighting (drawn in its own scene) --------------------
    const view = ctx.viewScene;
    // Weapon albedos were authored ~1/3 of physical to suit the AAA renderer's
    // very hot viewmodel rig (see README); this rig is ~3x brighter to match.
    this.viewHemi = new THREE.HemisphereLight(0xf2f8ff, 0x8a929c, 4.2);
    this.viewSun = new THREE.DirectionalLight(0xfff4e2, 5.5);
    this.viewSun.position.set(0.6, 1.0, 0.4);
    view.add(this.viewHemi, this.viewSun);

    // ---- environment for reflections -------------------------------------
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    this.envMap = pmrem.fromScene(room, 0.04).texture;
    room.dispose?.();
    pmrem.dispose();
    scene.environment = this.envMap;
    view.environment = this.envMap;
    scene.environmentIntensity = 0.6;
    view.environmentIntensity = 2.0;

    // ---- public surface other systems read -------------------------------
    this.sunDir = SUN_DIR.clone();
    this.sunDirView = SUN_DIR.clone();
    this.screenSize = { width: 1, height: 1 };
    this.displaySize = { width: 1, height: 1 };
    this.depthTexture = null;
    this.velocityTexture = null;
    this.normalTexture = null;
    this.exposureTexture = null;
    this.hdrTexture = null;
    this.csm = null;
    this.gbuffer = null;
    this.lights = [];
    this._passes = [];

    this.dynres = ctx.config.dynamicResolution
      ? new DynRes({ target: 1 / 60, min: 0.5, max: q.dynresMax ?? 1, start: q.renderScale, warmup: 3 })
      : null;
    this._scale = this.dynres ? this.dynres.scale : q.renderScale;
    this._lastRaw = 0;
  }

  // ---- API used by other systems (cheap or no-op here) ---------------------
  registerPass(pass) {
    // Post passes (heat haze, low-health tint) are skipped in lite mode.
    this._passes.push(pass);
    return () => {
      const i = this._passes.indexOf(pass);
      if (i >= 0) this._passes.splice(i, 1);
    };
  }

  addLight(light) {
    if (!this.lights.includes(light)) this.lights.push(light);
    return light;
  }

  removeLight(light) {
    const i = this.lights.indexOf(light);
    if (i >= 0) this.lights.splice(i, 1);
  }

  requestEnvMap() {
    return this.envMap;
  }

  setEnvMap() {
    /* the lite renderer keeps its own neutral room environment */
  }

  patchMaterials() {}
  setExposureBias() {}
  _cullLights() {}

  async prewarmMaterials() {
    const r = this.renderer;
    try {
      await r.compileAsync(this.ctx.scene, this.ctx.camera);
      await r.compileAsync(this.ctx.viewScene, this.ctx.viewCamera);
    } catch {
      /* programs compile on first draw instead */
    }
    return { ok: true };
  }

  // ---- frame ----------------------------------------------------------------
  resize(w, h) {
    this._cssW = w;
    this._cssH = h;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, this.q.maxPixelRatio ?? 2);
    const pr = dpr * this._scale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.screenSize.width = this.displaySize.width = Math.max(1, Math.floor(w * pr));
    this.screenSize.height = this.displaySize.height = Math.max(1, Math.floor(h * pr));
  }

  render(ctx) {
    const r = this.renderer;
    this.frame++;
    if (this.dynres) {
      const raw = ctx.time.raw;
      const dt = raw - this._lastRaw;
      this._lastRaw = raw;
      if (this.dynres.sample(dt) && this._cssW) {
        this._scale = this.dynres.scale;
        this.resize(this._cssW, this._cssH);
      }
    }
    r.info.reset();
    r.setRenderTarget(null);
    r.clear(true, true, false);
    r.render(ctx.scene, ctx.camera);
    r.clearDepth();
    r.render(ctx.viewScene, ctx.viewCamera);
  }

  dispose() {
    this.envMap?.dispose();
    this.renderer.dispose();
  }
}
