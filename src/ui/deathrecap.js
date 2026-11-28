/**
 * Death recap: shown when the opponent kills you, until the next round
 * starts. Answers "what just happened" in one glance:
 *
 *   ELIMINATED
 *   LR-7 · SNIPER   HEADSHOT   18 m
 *   You took 2 hits · 100 dmg (1 to the head)
 *   Opponent had 67 HP left
 *
 * Plain DOM, no filters or blur (iPad-cheap).
 */
import { el, setStyle, setText } from './util.js';
import { WEAPON_DEFS } from '../weapons/defs.js';

const CSS = `
.ow-dr { position: fixed; left: 50%; top: 22%; transform: translateX(-50%); z-index: 6; pointer-events: none; display: none;
  min-width: min(420px, 86vw); padding: 14px 20px 12px; border-radius: 14px; background: rgba(12,6,8,.84);
  border: 2px solid rgba(255,90,70,.65); color: #fff; text-align: center; font-family: "Inter","Helvetica Neue",Arial,sans-serif; }
.ow-dr .t { font-weight: 800; font-size: 22px; letter-spacing: .2em; color: #ff6a55; }
.ow-dr .w { margin-top: 6px; display: flex; gap: 10px; justify-content: center; align-items: center; flex-wrap: wrap;
  font-weight: 800; font-size: 16px; letter-spacing: .06em; }
.ow-dr .chip { padding: 2px 8px; border-radius: 6px; font-size: 12px; letter-spacing: .14em; background: rgba(255,255,255,.12); }
.ow-dr .chip.hs { background: #ff6a55; color: #1a0605; }
.ow-dr .s { margin-top: 6px; font-size: 13px; color: #d9c6c4; }
@media (max-height: 560px) { .ow-dr { top: 12%; padding: 8px 14px; } .ow-dr .t { font-size: 17px; } }
`;

const CLASS = { rifle: 'RIFLE', smg: 'SMG', shotgun: 'SHOTGUN', sniper: 'SNIPER', pistol: 'PISTOL' };

/** The recap's text, as data (unit tested). */
export function recapText({ weapon, headshot, distance, hits = [], oppHp }) {
  const def = WEAPON_DEFS[weapon];
  const dmg = Math.round(hits.reduce((s, h) => s + (h.amount || 0), 0));
  const heads = hits.filter((h) => h.headshot).length;
  return {
    weapon: def ? `${def.label} · ${CLASS[weapon] ?? weapon.toUpperCase()}` : weapon === 'grenade' ? 'FRAG GRENADE' : 'UNKNOWN',
    headshot: !!headshot,
    distance: Number.isFinite(distance) ? `${Math.round(distance)} m` : '',
    taken: `You took ${hits.length} hit${hits.length === 1 ? '' : 's'} · ${dmg} dmg` + (heads ? ` (${heads} to the head)` : ''),
    opp: Number.isFinite(oppHp) ? `Opponent had ${Math.max(0, Math.round(oppHp))} HP left` : '',
  };
}

export class DeathRecap {
  constructor(host) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.root = el('div', 'ow-dr', host);
    this.root.dataset.act = 'death-recap';
    el('div', 't', this.root, 'ELIMINATED');
    const w = el('div', 'w', this.root);
    this.weapon = el('span', null, w, '');
    this.hs = el('span', 'chip hs', w, 'HEADSHOT');
    this.dist = el('span', 'chip', w, '');
    this.taken = el('div', 's', this.root, '');
    this.opp = el('div', 's', this.root, '');
    this.open = false;
  }

  show(info) {
    const r = recapText(info);
    setText(this.weapon, r.weapon);
    setStyle(this.hs, 'display', r.headshot ? '' : 'none');
    setText(this.dist, r.distance);
    setStyle(this.dist, 'display', r.distance ? '' : 'none');
    setText(this.taken, r.taken);
    setText(this.opp, r.opp);
    setStyle(this.opp, 'display', r.opp ? '' : 'none');
    setStyle(this.root, 'display', 'block');
    this.open = true;
  }

  hide() {
    if (!this.open) return;
    setStyle(this.root, 'display', 'none');
    this.open = false;
  }

  dispose() {
    this.root.remove();
    this.style.remove();
  }
}
