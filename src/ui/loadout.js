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
.ow-loadout .sec { min-height: 44px; min-width: 110px; padding: 0 18px; border-radius: 22px; border: 2px solid rgba(61,242,255,.35);
  background: rgba(20,28,34,.8); color: #e8f4f8; font: 700 15px "Inter","Helvetica Neue",Arial,sans-serif; letter-spacing: .05em; }
.ow-loadout .sec.on { border-color: #3df2ff; background: rgba(61,242,255,.22); }
.ow-loadout .sec:disabled { opacity: .35; }
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
    el('div', 'sub', this.root, 'Primary + secondary · SWAP switches in the match · G / NADE throws a grenade');
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
    el('div', 'sub', this.root, 'SECONDARY');
    const srow = el('div', 'row', this.root);
    this.secs = new Map();
    for (const id of ['pistol', 'smg', 'shotgun']) {
      const b = el('button', 'sec', srow, id.toUpperCase());
      b.type = 'button';
      b.dataset.act = `practice-secondary-${id}`;
      b.addEventListener('click', () => this.selectSecondary(id));
      this.secs.set(id, b);
    }
    this.secondary = ctx.peek('weapons')?.secondaryPick ?? 'pistol';
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
    if (this.secondary === id) this.secondary = 'pistol'; // never the primary twice
    this.selectSecondary(this.secondary);
  }

  selectSecondary(id) {
    this.secondary = id === this.choice ? 'pistol' : id;
    for (const [k, b] of this.secs ?? []) {
      b.classList.toggle('on', k === this.secondary);
      b.disabled = k === this.choice;
    }
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
    const w = this.ctx.peek('weapons');
    if (w) w.secondaryPick = this.secondary;
    this.ctx.events.emit('loadout:set', { primary: this.choice });
    this.ctx.peek('player')?.setControlEnabled?.(true);
  }

  dispose() {
    this.root.remove();
    this.style.remove();
  }
}
