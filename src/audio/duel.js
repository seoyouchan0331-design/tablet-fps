/**
 * AUDIO — gunshots and footsteps, nothing else.
 *
 * The original engine also ran a distant-battle ambience, enemy voice barks,
 * shell/impact/whizz foley, a heartbeat, tinnitus and room reverb. In a two-
 * player arena all of that was noise on top of the two sounds that matter, so
 * this replaces it: every sound is pre-rendered once (synth.js) and playback is
 * one buffer source through a gain (and a panner for the opponent).
 *
 *   own shot      head-locked, full level
 *   opponent shot from their gun: distance gain, stereo pan, a little duller
 *   own steps     from player:footstep / player:land
 *   opponent      steps synthesised from their movement (the avatar position)
 *
 * The public surface keeps the old method names (play, playUi, playShell, ui,
 * bark, setMasterVolume...) as harmless no-ops so callers never break.
 */
import { SHOT_PROFILES, profileFor, synthShot, synthStep } from './synth.js';

const GESTURES = ['pointerdown', 'touchstart', 'keydown', 'mousedown'];
const VARIANTS = 4;
const STRIDE = 1.7; // metres between opponent footfalls when running

export class DuelAudioSystem {
  static id = 'audio';
  static deps = [];

  constructor() {
    this.running = false;
    this.failed = false;
    this.actx = null;
    this.deafness = 0;
    this.stats = { started: false, shots: 0, steps: 0 };
    this._shots = null; // profile -> AudioBuffer[]
    this._steps = null; // kind -> AudioBuffer[]
    this._n = 0;
    this._oppStep = { x: 0, z: 0, acc: 0, had: false };
  }

  async init(ctx) {
    this.ctx = ctx;
    this._offs = [
      ctx.events.on('weapon:fire', (e) => this._onFire(e)),
      ctx.events.on('player:footstep', (e) => this._step(e?.stance === 'crouch' ? 'crouch' : e?.running ? 'run' : 'walk', null, 1)),
      ctx.events.on('player:land', (e) => {
        const v = Math.abs(typeof e?.velocity === 'number' ? e.velocity : 4);
        if (v > 2.5) this._step('land', null, Math.min(1, v / 8));
      }),
    ];
    // iOS only starts audio inside a user gesture, so build and resume there.
    this._kick = () => {
      this._disarm();
      this.start();
    };
    for (const g of GESTURES) addEventListener(g, this._kick, { passive: true });
    if (typeof window !== 'undefined') window.__AUDIO__ = this;
  }

  _disarm() {
    if (!this._kick) return;
    for (const g of GESTURES) removeEventListener(g, this._kick);
    this._kick = null;
  }

  start() {
    if (this.running) return Promise.resolve(true);
    if (this.failed) return Promise.resolve(false);
    try {
      const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!AC) throw new Error('no AudioContext');
      const actx = new AC({ latencyHint: 'interactive' });
      this.actx = actx;
      const resumed = actx.state === 'suspended' ? actx.resume() : Promise.resolve();
      // master: gain -> gentle limiter -> speakers
      this.master = actx.createGain();
      this.master.gain.value = 0.85;
      const lim = actx.createDynamicsCompressor();
      lim.threshold.value = -6;
      lim.knee.value = 4;
      lim.ratio.value = 8;
      lim.attack.value = 0.002;
      lim.release.value = 0.12;
      this.master.connect(lim).connect(actx.destination);
      this._render(actx);
      this.running = true;
      this.stats.started = true;
      console.info(`[audio] duel audio online @ ${actx.sampleRate} Hz`);
      return resumed.then(() => true, () => true);
    } catch (err) {
      console.warn('[audio] disabled:', err?.message ?? err);
      this.failed = true;
      return Promise.resolve(false);
    }
  }

  _render(actx) {
    const sr = actx.sampleRate;
    const buf = (data) => {
      const b = actx.createBuffer(1, data.length, sr);
      b.getChannelData(0).set(data);
      return b;
    };
    this._shots = new Map();
    for (const p of Object.values(SHOT_PROFILES)) {
      const list = [];
      for (let v = 0; v < VARIANTS; v++) list.push(buf(synthShot(p, sr, v + 1)));
      this._shots.set(p, list);
    }
    this._steps = {};
    for (const k of ['walk', 'run', 'crouch', 'land']) {
      this._steps[k] = [];
      for (let v = 0; v < 6; v++) this._steps[k].push(buf(synthStep(k, sr, v + 1)));
    }
  }

  /**
   * One buffer, optionally placed in the world. `at` null = on the listener.
   * Distant sounds get quieter, panned to their side, and slightly duller.
   */
  _voice(buffer, at, gain, rate = 1) {
    const actx = this.actx;
    if (!actx || actx.state === 'closed') return;
    const src = actx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = actx.createGain();
    let node = src;
    let level = gain;
    if (at) {
      const cam = this.ctx.camera;
      const e = cam.matrixWorld.elements;
      const dx = at.x - e[12], dy = at.y - e[13], dz = at.z - e[14];
      const d = Math.hypot(dx, dy, dz);
      level *= 1 / (1 + d / 9);
      // listener's right vector is matrix column 0
      const side = d > 1e-3 ? (dx * e[0] + dy * e[1] + dz * e[2]) / d : 0;
      const pan = actx.createStereoPanner?.();
      if (pan) {
        pan.pan.value = Math.max(-0.85, Math.min(0.85, side * 0.85));
        node.connect(pan);
        node = pan;
      }
      if (d > 6) {
        const lp = actx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = Math.max(2200, 14000 - d * 260);
        node.connect(lp);
        node = lp;
      }
    }
    g.gain.value = level;
    node.connect(g).connect(this.master);
    src.start();
  }

  _onFire(e) {
    if (!this.running || !e || e.empty) return;
    const list = this._shots.get(profileFor(e.weapon));
    if (!list) return;
    this.stats.shots++;
    const buf = list[this._n++ % list.length];
    const rate = 0.97 + ((this._n * 0.37) % 1) * 0.06; // tiny pitch spread
    if (e.remote) this._voice(buf, e.origin, 0.95, rate);
    else this._voice(buf, null, 0.8, rate);
  }

  _step(kind, at, level) {
    if (!this.running) return;
    const list = this._steps?.[kind];
    if (!list) return;
    this.stats.steps++;
    this._voice(list[this._n++ % list.length], at, level);
  }

  /** Opponent footsteps from how far their avatar has moved on the ground. */
  update() {
    if (!this.running) return;
    const av = this.ctx.peek('opponent')?.avatar;
    const s = this._oppStep;
    if (!av || !av.root?.visible || !av.alive || av._air) {
      s.had = false;
      return;
    }
    const p = av.position;
    if (!s.had) {
      s.x = p.x; s.z = p.z; s.acc = 0; s.had = true;
      return;
    }
    const d = Math.hypot(p.x - s.x, p.z - s.z);
    s.x = p.x; s.z = p.z;
    if (d > 3) return; // a respawn teleport, not a stride
    s.acc += d;
    if (s.acc >= STRIDE) {
      s.acc = 0;
      this._step('run', p, 1.1);
    }
  }

  /* ---- old API, kept so callers never break ------------------------------ */
  play() {}
  playUi() {}
  playShell() {}
  ui() {}
  bark() {}
  setAmbienceIntensity() {}
  setBusVolume() {}
  setMasterVolume(v) {
    if (this.master) this.master.gain.value = Math.max(0, Math.min(1, v)) * 0.85;
  }
  report() {
    return { ...this.stats, state: this.actx?.state ?? 'none' };
  }

  dispose() {
    this._disarm();
    for (const off of this._offs ?? []) off();
    try {
      if (this.actx && this.actx.state !== 'closed') this.actx.close();
    } catch {
      /* already gone */
    }
    this.running = false;
    if (typeof window !== 'undefined' && window.__AUDIO__ === this) delete window.__AUDIO__;
  }
}
