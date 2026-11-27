/**
 * Loadout picker: two big cards (RIFLE / SMG) + START. Shown at boot before
 * the player can move, and again from the pause menu. Emits `loadout:set`.
 * Closing without a choice keeps the current primary (rifle by default).
 */
import { el } from './util.js';

const CSS = `
.ow-loadout { position: fixed; inset: 0; z-index: 20; display: flex; flex-direction: column; align-items: center;
  justify-content: safe center; gap: 22px; padding: 24px max(5vw,16px); background: rgba(6,9,12,.82); overflow-y: auto;
  font-family: "Inter","Helvetica Neue",Arial,sans-serif; color: #e8f4f8; touch-action: pan-y; user-select: none; -webkit-user-select: none; }
.ow-loadout[hidden] { display: none; }
.ow-loadout h2 { font-size: 30px; letter-spacing: -.02em; }
.ow-loadout .row { display: flex; gap: 18px; flex-wrap: wrap; justify-content: center; }
.ow-loadout .card { width: min(210px, 21vw); padding: 20px; border-radius: 14px; border: 2px solid rgba(61,242,255,.35);
  background: rgba(20,28,34,.8); text-align: left; }
.ow-loadout .card.on { border-color: #3df2ff; box-shadow: 0 0 0 3px rgba(61,242,255,.25); }
.ow-loadout .card b { display: block; font-size: 22px; margin-bottom: 6px; }
.ow-loadout .card span { font-size: 14px; color: #a9bcc4; }
.ow-loadout .start { min-width: 200px; min-height: 52px; border-radius: 26px; border: 0; background: #3df2ff; color: #031015;
  font: 700 18px "Inter","Helvetica Neue",Arial,sans-serif; letter-spacing: .06em; }
.ow-loadout .sub { font-size: 14px; color: #a9bcc4; }
@media (max-height: 560px) {
  .ow-loadout { gap: 10px; padding: 10px max(3vw,12px); }
  .ow-loadout h2 { font-size: 22px; }
  .ow-loadout .row { gap: 8px; flex-wrap: nowrap; }
  .ow-loadout .card { padding: 10px 12px; }
  .ow-loadout .card b { font-size: 16px; margin-bottom: 2px; }
  .ow-loadout .card span { font-size: 11px; }
  .ow-loadout .start { min-height: 44px; }
}
`;

const CARDS = [
  ['rifle', 'RIFLE', 'Accurate at range, 4 body shots'],
  ['smg', 'SMG', 'Fast fire, best up close'],
  ['shotgun', 'SHOTGUN', 'One blast up close, weak at range'],
  ['sniper', 'SNIPER', 'Scope in · one hit kills'],
];

export class LoadoutPicker {
  constructor(host, ctx) {
    this.ctx = ctx;
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);

    this.root = el('div', 'ow-loadout', host);
    el('h2', null, this.root, 'Choose your loadout');
    el('div', 'sub', this.root, 'Primary + pistol · SWAP switches in the match');
    const row = el('div', 'row', this.root);
    this.cards = new Map();
    for (const [id, name, desc] of CARDS) {
      const c = el('button', 'card', row);
      c.type = 'button';
      el('b', null, c, name);
      el('span', null, c, desc);
      c.addEventListener('click', () => this.select(id));
      this.cards.set(id, c);
    }
    this.startBtn = el('button', 'start', this.root, 'START');
    this.startBtn.type = 'button';
    this.startBtn.addEventListener('click', () => this.close());

    this.choice = ctx.peek('weapons')?.loadout?.primary ?? 'rifle';
    this.open = false;
    this.root.hidden = true;
  }

  select(id) {
    this.choice = id;
    for (const [k, c] of this.cards) c.classList.toggle('on', k === id);
  }

  show() {
    this.select(this.ctx.peek('weapons')?.loadout?.primary ?? this.choice);
    this.open = true;
    this.root.hidden = false;
    this.ctx.peek('player')?.setControlEnabled?.(false);
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.root.hidden = true;
    this.ctx.events.emit('loadout:set', { primary: this.choice });
    this.ctx.peek('player')?.setControlEnabled?.(true);
  }

  dispose() {
    this.root.remove();
    this.style.remove();
  }
}
