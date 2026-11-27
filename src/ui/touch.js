/**
 * On-screen touch controls for tablets (only built when `config.touch`).
 *
 *   left 40 % of the screen  floating joystick (appears where the thumb lands)
 *   rest of the screen       drag to look
 *   FIRE                     hold to fire; dragging it also looks
 *   ADS                      toggle aim-down-sights
 *   small buttons            reload / jump / crouch / swap / pause
 *
 * Gesture state lives in `input.touchState` (src/core/touch.js); this file only
 * routes DOM touches into it and draws the stick + an FPS readout.
 */
import { el, setStyle } from './util.js';

const STICK_ZONE = 0.4; // fraction of screen width that spawns the joystick

const CSS = `
.ow-touch { position: fixed; inset: 0; z-index: 5; touch-action: none;
  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent; font-family: "Inter","Helvetica Neue",Arial,sans-serif; }
.ow-touch .tb { position: absolute; display: flex; align-items: center; justify-content: center;
  border-radius: 50%; border: 2px solid rgba(255,255,255,.35); background: rgba(10,14,18,.28);
  color: rgba(255,255,255,.85); font-weight: 700; letter-spacing: .08em; font-size: 12px;
  backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); }
.ow-touch .tb.on, .ow-touch .tb.held { background: rgba(255,255,255,.28); border-color: rgba(255,255,255,.8); }
.ow-touch .fire { width: 96px; height: 96px; right: 7%; bottom: 26%; font-size: 14px;
  border-color: rgba(255,120,90,.7); }
.ow-touch .fire.held { background: rgba(255,110,80,.35); }
.ow-touch .ads { width: 64px; height: 64px; right: calc(7% + 112px); bottom: calc(26% + 40px); }
.ow-touch .sm { width: 52px; height: 52px; font-size: 10px; }
.ow-touch .ring { position: absolute; width: 120px; height: 120px; margin: -60px 0 0 -60px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,.3); background: rgba(10,14,18,.18); pointer-events: none; display: none; }
.ow-touch .knob { position: absolute; width: 52px; height: 52px; margin: -26px 0 0 -26px; border-radius: 50%;
  background: rgba(255,255,255,.45); pointer-events: none; display: none; }
.ow-touch .fps { position: absolute; top: 6px; left: 50%; transform: translateX(-50%);
  padding: 2px 8px; border-radius: 4px; background: rgba(0,0,0,.45); color: #cfe; font: 600 11px ui-monospace,monospace; }
`;

// [label, code, right, bottom] — a column/arc above and beside the fire button
const BUTTONS = [
  ['R', 'KeyR', 'calc(7% + 108px)', 'calc(26% - 30px)'],
  ['JUMP', 'Space', 'calc(7% + 22px)', 'calc(26% + 108px)'],
  ['CROUCH', 'KeyC', 'calc(7% + 22px)', 'calc(26% - 66px)'],
  ['SWAP', 'Tab', 'calc(7% + 190px)', 'calc(26% + 10px)'],
  ['DASH', 'TouchDash', 'calc(7% + 108px)', 'calc(26% + 118px)'],
];

export class TouchControls {
  constructor(host, ctx) {
    this.ctx = ctx;
    this.input = ctx.input;
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);

    this.root = el('div', 'ow-touch', null);
    host.insertBefore(this.root, host.firstChild);

    this.ring = el('div', 'ring', this.root);
    this.knob = el('div', 'knob', this.root);

    this.fireBtn = el('div', 'tb fire', this.root, 'FIRE');
    this.fireBtn.dataset.zone = 'fire';
    this.adsBtn = el('div', 'tb ads', this.root, 'ADS');
    this.adsBtn.dataset.action = 'ads';
    for (const [label, code, right, bottom] of BUTTONS) {
      const b = el('div', 'tb sm', this.root, label);
      b.dataset.code = code;
      if (code === 'TouchDash') this.dashBtn = b;
      setStyle(b, 'right', right);
      setStyle(b, 'bottom', bottom);
    }
    const pause = el('div', 'tb sm', this.root, 'II');
    pause.dataset.code = 'Escape';
    setStyle(pause, 'right', '16px');
    setStyle(pause, 'top', '16px');
    setStyle(pause, 'width', '44px');
    setStyle(pause, 'height', '44px');

    this.fps = el('div', 'fps', this.root, '-- fps');
    this.fps.dataset.action = 'fps';
    this._detail = false;
    this._frames = 0;
    this._acc = 0;

    /** touch id -> button element held by it */
    this._held = new Map();

    this._onStart = this._onStart.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onEnd = this._onEnd.bind(this);
    const opt = { passive: false };
    this.root.addEventListener('touchstart', this._onStart, opt);
    this.root.addEventListener('touchmove', this._onMove, opt);
    this.root.addEventListener('touchend', this._onEnd, opt);
    this.root.addEventListener('touchcancel', this._onEnd, opt);
  }

  _onStart(e) {
    e.preventDefault(); // also suppresses emulated mouse events and double-tap zoom
    const ts = this.input.touchState;
    for (const t of e.changedTouches) {
      const btn = t.target.closest?.('.tb');
      if (btn?.dataset.zone === 'fire') {
        ts.start(t.identifier, t.clientX, t.clientY, 'fire');
        this.fireBtn.classList.add('held');
      } else if (btn?.dataset.action === 'ads') {
        this.input.toggleAds();
      } else if (btn?.dataset.action === 'fps') {
        this._detail = !this._detail;
      } else if (btn?.dataset.code) {
        this.input.touchButton(btn.dataset.code, true);
        btn.classList.add('held');
        this._held.set(t.identifier, btn);
      } else {
        const zone = t.clientX < innerWidth * STICK_ZONE ? 'stick' : 'look';
        ts.start(t.identifier, t.clientX, t.clientY, zone);
      }
    }
  }

  _onMove(e) {
    e.preventDefault();
    const ts = this.input.touchState;
    for (const t of e.changedTouches) ts.move(t.identifier, t.clientX, t.clientY);
  }

  _onEnd(e) {
    e.preventDefault();
    const ts = this.input.touchState;
    for (const t of e.changedTouches) {
      ts.end(t.identifier);
      const btn = this._held.get(t.identifier);
      if (btn) {
        this.input.touchButton(btn.dataset.code, false);
        btn.classList.remove('held');
        this._held.delete(t.identifier);
      }
    }
    if (!ts.fire) this.fireBtn.classList.remove('held');
  }

  /** Called from the HUD's lateUpdate with unscaled dt. */
  update(rawDt) {
    const ts = this.input.touchState;
    const s = ts.stick;
    const show = s.active ? 'block' : 'none';
    setStyle(this.ring, 'display', show);
    setStyle(this.knob, 'display', show);
    if (s.active) {
      setStyle(this.ring, 'transform', `translate(${s.ox}px,${s.oy}px)`);
      setStyle(this.knob, 'transform', `translate(${s.x}px,${s.y}px)`);
    }
    this.adsBtn.classList.toggle('on', this.input._adsToggled);
    const dash = this.ctx.peek('player')?.movement?.dash;
    if (dash && this.dashBtn) {
      // Cooldown ring: the unlit arc is the time left before the next dash.
      const left = dash.cooldownLeft(this.ctx.time.elapsed) / dash.cooldown;
      const deg = Math.round((1 - left) * 360);
      setStyle(this.dashBtn, 'background', left > 0
        ? `conic-gradient(rgba(61,242,255,.45) ${deg}deg, rgba(10,14,18,.28) ${deg}deg)`
        : 'rgba(61,242,255,.30)');
    }

    this._frames++;
    this._acc += rawDt;
    if (this._acc >= 0.5) {
      const fps = Math.round(this._frames / this._acc);
      const dr = this.ctx.peek('render')?.dynres;
      let txt = dr ? `${fps} fps · ${Math.round(dr.scale * 100)}%` : `${fps} fps`;
      const pf = globalThis.__ENGINE__?.perf;
      if (this._detail && pf) {
        const cpu = pf.sim + pf.update + pf.render;
        txt += ` | frame ${(1000 / Math.max(1, fps)).toFixed(0)}ms cpu ${cpu.toFixed(0)}ms` +
          ` (phys ${pf.sim.toFixed(0)} upd ${pf.update.toFixed(0)} draw ${pf.render.toFixed(0)})` +
          ` | ${pf.calls} calls ${(pf.tris / 1e6).toFixed(2)}M tris`;
      }
      this.fps.textContent = txt;
      this._frames = 0;
      this._acc = 0;
    }
  }

  dispose() {
    this.input.touchState.cancelAll();
    this.root.remove();
    this.style.remove();
  }
}
