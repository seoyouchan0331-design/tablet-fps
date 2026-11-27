/**
 * Between-round weapon pick. Shown from the end of a round until the next one
 * goes live (~6 s): four big buttons for the primary, the current one lit.
 * A pick applies at once (the player can't move then anyway), so the next
 * round starts with it drawn; the opponent sees the swap on their screen.
 * Keyboard: 1-4.
 */
import { el, setStyle } from './util.js';

const CSS = `
.ow-rpick { position: fixed; left: 50%; bottom: 7%; transform: translateX(-50%); z-index: 7; display: none;
  flex-direction: column; align-items: center; gap: 8px; font-family: "Inter","Helvetica Neue",Arial,sans-serif; }
.ow-rpick .lbl { color: #cfe; font: 700 12px "Inter","Helvetica Neue",Arial,sans-serif; letter-spacing: .24em; }
.ow-rpick .row { display: flex; gap: 10px; }
.ow-rpick button { min-width: 108px; min-height: 52px; padding: 0 14px; border-radius: 12px; border: 2px solid rgba(61,242,255,.4);
  background: rgba(10,16,20,.86); color: #e8f4f8; font: 800 15px "Inter","Helvetica Neue",Arial,sans-serif; letter-spacing: .06em; }
.ow-rpick button small { display: block; font-size: 10px; color: #8fa3ab; font-weight: 600; letter-spacing: .1em; }
.ow-rpick button.on { background: #3df2ff; color: #031015; border-color: #3df2ff; }
.ow-rpick button.on small { color: #06414a; }
`;

const LABELS = { rifle: 'RIFLE', smg: 'SMG', shotgun: 'SHOTGUN', sniper: 'SNIPER' };

export class RoundPick {
  /** @param {string[]} ids primaries in order   @param {(id:string)=>void} onPick */
  constructor(host, ids, onPick) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.ids = ids;
    this.onPick = onPick;
    this.root = el('div', 'ow-rpick', host);
    el('div', 'lbl', this.root, 'NEXT ROUND WEAPON');
    const row = el('div', 'row', this.root);
    this.btns = new Map();
    ids.forEach((id, i) => {
      const b = el('button', null, row, LABELS[id] ?? id.toUpperCase());
      el('small', null, b, `KEY ${i + 1}`);
      b.type = 'button';
      b.dataset.act = `round-pick-${id}`;
      b.addEventListener('click', () => this._pick(id));
      this.btns.set(id, b);
    });
    this.open = false;
    this._onKey = (e) => {
      if (!this.open) return;
      const i = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
      if (i >= 0 && this.ids[i]) this._pick(this.ids[i]);
    };
    addEventListener('keydown', this._onKey);
  }

  _pick(id) {
    this.current = id;
    for (const [k, b] of this.btns) b.classList.toggle('on', k === id);
    this.onPick(id);
  }

  show(current) {
    this.current = current;
    for (const [k, b] of this.btns) b.classList.toggle('on', k === current);
    this.open = true;
    setStyle(this.root, 'display', 'flex');
  }

  hide() {
    this.open = false;
    setStyle(this.root, 'display', 'none');
  }

  dispose() {
    removeEventListener('keydown', this._onKey);
    this.root.remove();
    this.style.remove();
  }
}
