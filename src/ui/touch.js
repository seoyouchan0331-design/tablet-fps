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
import { saveSettings, defaultSettings, TOUCH_SCALE } from '../core/settings.js';

const STICK_ZONE = 0.4; // fraction of screen width that spawns the joystick

const CSS = `
.ow-touch { position: fixed; inset: 0; z-index: 5; touch-action: none;
  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent; font-family: "Inter","Helvetica Neue",Arial,sans-serif; }
.ow-touch .tb { position: absolute; display: flex; align-items: center; justify-content: center;
  border-radius: 50%; border: 2px solid rgba(255,255,255,.35); background: rgba(10,14,18,.28);
  color: rgba(255,255,255,.85); font-weight: 700; letter-spacing: .08em; font-size: 12px; }
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
.ow-touch.editing .tb { outline: 2px dashed #3df2ff; outline-offset: 3px; background: rgba(61,242,255,.18); }
.ow-touch .edit-panel { position: absolute; left: 50%; top: 64px; transform: translateX(-50%); display: none; gap: 12px;
  align-items: center; padding: 10px 14px; border-radius: 14px; background: rgba(6,9,12,.88); color: #e8f4f8;
  font: 600 14px "Inter","Helvetica Neue",Arial,sans-serif; touch-action: auto; z-index: 2; }
.ow-touch.editing .edit-panel { display: flex; }
.ow-touch .edit-panel button { min-height: 44px; padding: 0 16px; border-radius: 22px; border: 2px solid rgba(61,242,255,.5);
  background: #10181d; color: #e8f4f8; font: 700 14px "Inter","Helvetica Neue",Arial,sans-serif; }
.ow-touch .edit-panel button.primary { background: #3df2ff; color: #031015; border-color: #3df2ff; }
.ow-touch .edit-panel input[type=range] { width: 160px; }
.ow-touch .fps { position: absolute; top: 6px; left: 50%; transform: translateX(-50%);
  padding: 2px 8px; border-radius: 4px; background: rgba(0,0,0,.45); color: #cfe; font: 600 11px ui-monospace,monospace; }
`;

// [id, label, virtual code, right, bottom] — default arc around the fire button.
// Touch buttons press their own Touch* codes, so keyboard rebinding never moves them.
const BUTTONS = [
  ['reload', 'R', 'TouchReload', 'calc(7% + 108px)', 'calc(26% - 30px)'],
  ['jump', 'JUMP', 'TouchJump', 'calc(7% + 22px)', 'calc(26% + 108px)'],
  ['crouch', 'CROUCH', 'TouchCrouch', 'calc(7% + 22px)', 'calc(26% - 66px)'],
  ['swap', 'SWAP', 'TouchSwap', 'calc(7% + 190px)', 'calc(26% + 10px)'],
  ['dash', 'DASH', 'TouchDash', 'calc(7% + 108px)', 'calc(26% + 118px)'],
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

    /** id -> button element, for layout editing */
    this.buttons = new Map();
    this.fireBtn = el('div', 'tb fire', this.root, 'FIRE');
    this.fireBtn.dataset.zone = 'fire';
    this.adsBtn = el('div', 'tb ads', this.root, 'ADS');
    this.adsBtn.dataset.action = 'ads';
    this.buttons.set('fire', this.fireBtn);
    this.buttons.set('ads', this.adsBtn);
    for (const [id, label, code, right, bottom] of BUTTONS) {
      const b = el('div', 'tb sm', this.root, label);
      b.dataset.code = code;
      b.dataset.id = id;
      if (code === 'TouchDash') this.dashBtn = b;
      setStyle(b, 'right', right);
      setStyle(b, 'bottom', bottom);
      this.buttons.set(id, b);
    }
    const pause = el('div', 'tb sm', this.root, 'II');
    pause.dataset.code = 'Escape';
    setStyle(pause, 'right', '16px');
    setStyle(pause, 'top', '16px');
    setStyle(pause, 'width', '44px');
    setStyle(pause, 'height', '44px');
    this.buttons.set('pause', pause);
    for (const [id, b] of this.buttons) {
      b.dataset.id = id;
      b.dataset.defRight = b.style.right;
      b.dataset.defBottom = b.style.bottom;
      b.dataset.defTop = b.style.top;
    }

    // ---- layout editing ----------------------------------------------------
    this.editing = false;
    this._drag = null;
    this.panel = el('div', 'edit-panel', this.root);
    el('span', null, this.panel, 'Drag buttons · Size');
    this.sizeInput = el('input', null, this.panel);
    this.sizeInput.type = 'range';
    this.sizeInput.min = String(TOUCH_SCALE.min);
    this.sizeInput.max = String(TOUCH_SCALE.max);
    this.sizeInput.step = '0.05';
    this.sizeInput.dataset.act = 'touch-size';
    this.sizeInput.addEventListener('input', () => {
      this.settings.touch.scale = Number(this.sizeInput.value);
      this.applyLayout();
      this._save();
    });
    const reset = el('button', null, this.panel, 'RESET');
    reset.type = 'button';
    reset.dataset.act = 'touch-reset';
    reset.addEventListener('click', () => {
      this.settings.touch.layout = {};
      this.settings.touch.scale = 1;
      this.sizeInput.value = '1';
      this.applyLayout();
      this._save();
    });
    const done = el('button', 'primary', this.panel, 'DONE');
    done.type = 'button';
    done.dataset.act = 'touch-done';
    done.addEventListener('click', () => this.setEditing(false));
    this._onResize = () => this.applyLayout();
    addEventListener('resize', this._onResize);
    this.applyLayout();

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

  get settings() {
    return this.ctx.settings ?? (this.ctx.settings = defaultSettings());
  }

  _save() {
    saveSettings(this.settings);
  }

  /** Put every button at its saved spot (or default) and apply the size. */
  applyLayout() {
    const t = this.settings.touch;
    for (const [id, b] of this.buttons) {
      const p = t.layout[id];
      if (p) {
        setStyle(b, 'right', 'auto');
        setStyle(b, 'bottom', 'auto');
        setStyle(b, 'left', `${Math.round(p.x * innerWidth - b.offsetWidth / 2)}px`);
        setStyle(b, 'top', `${Math.round(p.y * innerHeight - b.offsetHeight / 2)}px`);
      } else {
        // '' drops the inline value, so buttons placed by CSS (fire, ads)
        // fall back to their stylesheet position instead of 'auto'.
        setStyle(b, 'left', '');
        setStyle(b, 'top', b.dataset.defTop || '');
        setStyle(b, 'right', b.dataset.defRight || '');
        setStyle(b, 'bottom', b.dataset.defBottom || '');
      }
      setStyle(b, 'transform', `scale(${t.scale})`);
    }
    this.sizeInput.value = String(t.scale);
  }

  /** Layout edit mode: buttons drag instead of acting; the game ignores touches. */
  setEditing(on) {
    this.editing = on;
    this._drag = null;
    this.root.classList.toggle('editing', on);
    this.input.touchState.cancelAll();
    this.ctx.peek('player')?.setControlEnabled?.(!on);
  }

  _onStart(e) {
    if (this.editing) return this._editStart(e);
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

  _editStart(e) {
    if (e.target.closest?.('.edit-panel')) return; // let the slider and buttons work
    e.preventDefault();
    const t = e.changedTouches[0];
    const b = t?.target.closest?.('.tb');
    if (b) this._drag = { id: b.dataset.id, el: b, touch: t.identifier };
  }

  _onMove(e) {
    if (this.editing) {
      if (e.target.closest?.('.edit-panel')) return;
      e.preventDefault();
      const d = this._drag;
      if (!d) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== d.touch) continue;
        this.settings.touch.layout[d.id] = { x: t.clientX / innerWidth, y: t.clientY / innerHeight };
        this.applyLayout();
      }
      return;
    }
    e.preventDefault();
    const ts = this.input.touchState;
    for (const t of e.changedTouches) ts.move(t.identifier, t.clientX, t.clientY);
  }

  _onEnd(e) {
    if (this.editing) {
      if (this._drag) this._save();
      this._drag = null;
      return;
    }
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
      if (this.ping != null) txt += ` · ${Math.round(this.ping)}ms`; // duel ping
      this.fps.textContent = txt;
      this._frames = 0;
      this._acc = 0;
    }
  }

  dispose() {
    removeEventListener('resize', this._onResize);
    this.input.touchState.cancelAll();
    this.root.remove();
    this.style.remove();
  }
}
