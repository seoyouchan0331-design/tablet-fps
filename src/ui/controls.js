/**
 * Controls screen (from the pause menu): keyboard bindings, touch look speed,
 * and the entry to touch-button layout editing. Changes apply immediately and
 * are saved per device (src/core/settings.js).
 */
import { el } from './util.js';
import { BINDABLE, ACTION_LABELS, DEFAULT_BINDINGS, LOOK_SENS, rebind, keyLabel, saveSettings, defaultSettings } from '../core/settings.js';
import { setBindings } from '../core/input.js';
import { KILL_PACKS, PACK_IDS } from '../audio/killsounds.js';

const CSS = `
.ow-controls { position: fixed; inset: 0; z-index: 40; display: flex; align-items: flex-start; justify-content: center;
  overflow-y: auto; padding: 28px max(5vw,16px) 40px; background: rgba(6,9,12,.94); color: #e8f4f8;
  font-family: "Inter","Helvetica Neue",Arial,sans-serif; touch-action: pan-y; user-select: none; -webkit-user-select: none; }
.ow-controls[hidden] { display: none; }
.ow-controls .wrap { width: min(640px, 100%); display: flex; flex-direction: column; gap: 14px; }
.ow-controls h2 { font-size: 28px; letter-spacing: -.02em; }
.ow-controls h3 { font-size: 15px; color: #a9bcc4; letter-spacing: .06em; margin-top: 8px; }
.ow-controls .row { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 12px; align-items: center;
  padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,.08); font-size: 16px; }
.ow-controls button { min-height: 44px; min-width: 96px; padding: 0 16px; border-radius: 10px; border: 2px solid rgba(61,242,255,.45);
  background: #10181d; color: #e8f4f8; font: 700 15px "Inter","Helvetica Neue",Arial,sans-serif; }
.ow-controls button.wait { border-color: #ffc21f; color: #ffc21f; }
.ow-controls button.primary { background: #3df2ff; color: #031015; border-color: #3df2ff; }
.ow-controls .bar { display: flex; gap: 12px; flex-wrap: wrap; }
.ow-controls input[type=range] { width: min(260px, 50vw); }
.ow-controls .note { font-size: 13px; color: #8fa3ab; }
.ow-controls button.pack { min-width: 0; flex: 1 1 110px; }
.ow-controls button.pack.on { border-color: var(--pc); color: var(--pc); box-shadow: 0 0 0 2px var(--pc) inset; }
`;

export class ControlsPanel {
  /** @param {{ onEditLayout: Function, onClose: Function }} on */
  constructor(host, ctx, on) {
    this.ctx = ctx;
    this.on = on;
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.root = el('div', 'ow-controls', host);
    this.root.hidden = true;
    this.open = false;
    this._capture = null;
  }

  get settings() {
    return this.ctx.settings ?? (this.ctx.settings = defaultSettings());
  }

  show() {
    this.open = true;
    this.root.hidden = false;
    this.render();
  }

  hide() {
    this._stopCapture();
    this.open = false;
    this.root.hidden = true;
  }

  _commit() {
    setBindings(this.settings.bindings);
    saveSettings(this.settings);
  }

  render() {
    const s = this.settings;
    this.root.replaceChildren();
    const w = el('div', 'wrap', this.root);
    el('h2', null, w, 'Controls');

    if (this.ctx.config.touch) {
      el('h3', null, w, 'TOUCH');
      const edit = el('button', 'primary', el('div', 'bar', w), 'EDIT BUTTON LAYOUT');
      edit.type = 'button';
      edit.dataset.act = 'edit-layout';
      edit.addEventListener('click', () => this.on.onEditLayout());
      const r = el('div', 'row', w);
      el('span', null, r, 'Look speed');
      const sens = el('input', null, r);
      sens.type = 'range';
      sens.min = String(LOOK_SENS.min);
      sens.max = String(LOOK_SENS.max);
      sens.step = '0.05';
      sens.value = String(s.touch.lookSens);
      sens.dataset.act = 'look-speed';
      sens.addEventListener('input', () => {
        s.touch.lookSens = Number(sens.value);
        this.ctx.config.touchSensitivity = (this.ctx.config.touchSensitivityBase ?? 0.0045) * s.touch.lookSens;
        saveSettings(s);
      });
    }

    el('h3', null, w, 'KILL SOUND');
    el('div', 'note', w, 'Each kill in a match climbs a step; the 5th gets a finale. Tap to hear it.');
    const packs = el('div', 'bar', w);
    for (const id of PACK_IDS) {
      const pk = KILL_PACKS[id];
      const btn = el('button', 'pack', packs, pk.label);
      btn.type = 'button';
      btn.dataset.act = `kill-sound-${id}`;
      btn.style.setProperty('--pc', pk.color);
      btn.classList.toggle('on', (s.killSound ?? 'neon') === id);
      btn.addEventListener('click', () => {
        s.killSound = id;
        saveSettings(s);
        const audio = this.ctx.peek?.('audio');
        audio?.setKillPack?.(id);
        // preview: a 1st kill, then the 5th
        audio?.confirm?.('kill', { level: 1, pack: id });
        setTimeout(() => audio?.confirm?.('kill', { level: 5, pack: id }), 650);
        this.render();
      });
    }

    el('h3', null, w, 'KEYBOARD');
    el('div', 'note', w, 'Tap an action, then press the new key. Esc cancels.');
    for (const a of BINDABLE) {
      const r = el('div', 'row', w);
      el('span', null, r, ACTION_LABELS[a]);
      const b = el('button', null, r, (s.bindings[a] ?? []).map(keyLabel).join(' / ') || '—');
      b.type = 'button';
      b.dataset.act = `bind-${a}`;
      b.addEventListener('click', () => this._startCapture(a, b));
    }

    const bar = el('div', 'bar', w);
    const reset = el('button', null, bar, 'RESET KEYS');
    reset.type = 'button';
    reset.dataset.act = 'reset-keys';
    reset.addEventListener('click', () => {
      s.bindings = Object.fromEntries(Object.entries(DEFAULT_BINDINGS).map(([k, v]) => [k, [...v]]));
      this._commit();
      this.render();
    });
    const close = el('button', 'primary', bar, 'DONE');
    close.type = 'button';
    close.dataset.act = 'controls-done';
    close.addEventListener('click', () => {
      this.hide();
      this.on.onClose();
    });
  }

  _startCapture(action, btn) {
    this._stopCapture();
    btn.textContent = 'Press a key…';
    btn.classList.add('wait');
    const onKey = (e) => {
      // capture phase + stop: the game must not also act on this key
      e.preventDefault();
      e.stopImmediatePropagation();
      this._stopCapture();
      if (e.code !== 'Escape') {
        this.settings.bindings = rebind(this.settings.bindings, action, e.code);
        this._commit();
      }
      this.render();
    };
    this._capture = onKey;
    addEventListener('keydown', onKey, true);
  }

  _stopCapture() {
    if (this._capture) removeEventListener('keydown', this._capture, true);
    this._capture = null;
  }

  dispose() {
    this._stopCapture();
    this.root.remove();
    this.style.remove();
  }
}
