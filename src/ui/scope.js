/**
 * Sniper scope picture. When the sniper is fully aimed the 3-D scope would be a
 * small tube in the middle of the screen, so it is swapped for a flat scope
 * view: a wide clear circle, thin crosshair, red centre dot, black outside.
 * Plain gradients and borders only — no filters or blending (iPad-cheap).
 */
import { el, setStyle } from './util.js';

const CSS = `
.ow-scope { position: fixed; inset: 0; pointer-events: none; z-index: 4; display: none;
  background: radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 0, rgba(0,0,0,0) 44vmin, rgba(0,0,0,.55) 45vmin, #000 46.5vmin); }
.ow-scope .h, .ow-scope .v { position: absolute; left: 50%; top: 50%; background: #0b0f12; }
.ow-scope .h { width: 88vmin; height: 2px; transform: translate(-50%, -50%); }
.ow-scope .v { width: 2px; height: 88vmin; transform: translate(-50%, -50%); }
.ow-scope .gap { position: absolute; left: 50%; top: 50%; width: 9vmin; height: 9vmin; transform: translate(-50%, -50%);
  border-radius: 50%; background: radial-gradient(circle, #ff2b2b 0 3px, rgba(0,0,0,0) 4px); }
.ow-scope .ring { position: absolute; left: 50%; top: 50%; width: 92vmin; height: 92vmin; transform: translate(-50%, -50%);
  border-radius: 50%; border: 4px solid #111; box-sizing: border-box; }
`;

export class ScopeOverlay {
  constructor(host) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.root = el('div', 'ow-scope', host);
    el('div', 'h', this.root);
    el('div', 'v', this.root);
    el('div', 'ring', this.root);
    el('div', 'gap', this.root);
    this.on = false;
    this._kick = 0;
  }

  /** The shot jolts the scope picture up, then it settles. */
  kick(amount = 1) {
    this._kick = Math.min(1.5, this._kick + amount);
  }

  update(dt) {
    if (this._kick <= 0.001) {
      if (this._kick) {
        this._kick = 0;
        setStyle(this.root, 'transform', '');
      }
      return;
    }
    this._kick *= Math.exp(-dt * 7);
    const k = this._kick;
    setStyle(this.root, 'transform', `translateY(${(-k * 6).toFixed(2)}vmin) scale(${(1 + k * 0.05).toFixed(4)})`);
  }

  /** @param {boolean} on show the scope view (and hide the 3-D viewmodel) */
  set(on, ctx) {
    if (on === this.on) return;
    this.on = on;
    setStyle(this.root, 'display', on ? 'block' : 'none');
    if (ctx?.viewScene) ctx.viewScene.visible = !on;
  }

  dispose() {
    this.root.remove();
    this.style.remove();
  }
}
