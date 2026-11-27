/**
 * Kill banner: pops under the crosshair on every kill.
 *
 *   ◆ emblem   a diamond badge in the kill-sound pack's colour, with the
 *              kill number inside and a ring that pulses out
 *   ●●●○○      five pips — this match's kills so far (the climb the kill
 *              sound follows)
 *   ELIMINATED / HEADSHOT, and a bigger send-off on the 5th
 *
 * Only transform and opacity animate (compositor-only on an iPad); no
 * filters, no blur, no blend modes.
 */
import { el, setStyle, setText } from './util.js';

const CSS = `
.ow-kb { position: fixed; left: 50%; top: 63%; z-index: 6; pointer-events: none; display: none;
  transform: translate(-50%, -50%); text-align: center; font-family: "Inter","Helvetica Neue",Arial,sans-serif;
  --kb: #3df2ff; }
.ow-kb .emb { position: relative; width: 64px; height: 64px; margin: 0 auto 8px; }
.ow-kb .dia { position: absolute; inset: 8px; transform: rotate(45deg); border-radius: 8px;
  background: rgba(8,12,16,.82); border: 3px solid var(--kb); box-shadow: 0 0 14px var(--kb); }
.ow-kb .ring { position: absolute; inset: 0; transform: rotate(45deg); border-radius: 10px; border: 2px solid var(--kb); opacity: 0; }
.ow-kb .num { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 800; font-size: 24px; }
.ow-kb .pips { display: flex; gap: 6px; justify-content: center; margin-bottom: 6px; }
.ow-kb .pip { width: 16px; height: 5px; border-radius: 3px; background: rgba(255,255,255,.22); }
.ow-kb .pip.on { background: var(--kb); }
.ow-kb .t { color: #fff; font-weight: 800; font-size: 20px; letter-spacing: .18em; text-shadow: 0 2px 0 rgba(0,0,0,.5); }
.ow-kb .s { color: var(--kb); font-weight: 700; font-size: 13px; letter-spacing: .24em; margin-top: 2px; }
.ow-kb.max .t { font-size: 26px; }
`;

const LIFE = 1.9;
const TITLES = ['', 'ELIMINATED', 'ELIMINATED', 'ELIMINATED', 'ELIMINATED', 'UNSTOPPABLE'];

export class KillBanner {
  constructor(host) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.root = el('div', 'ow-kb', host);
    const emb = el('div', 'emb', this.root);
    this.ring = el('div', 'ring', emb);
    el('div', 'dia', emb);
    this.num = el('div', 'num', emb, '1');
    this.emb = emb;
    const pips = el('div', 'pips', this.root);
    this.pips = [0, 1, 2, 3, 4].map(() => el('div', 'pip', pips));
    this.title = el('div', 't', this.root, '');
    this.sub = el('div', 's', this.root, '');
    this.t = LIFE;
    this.level = 1;
  }

  /** @param {number} level 1..5   @param {boolean} headshot   @param {string} color pack colour */
  show(level, headshot, color) {
    this.level = level;
    this.count = (this.count ?? 0) + 1;
    this.root.style.setProperty('--kb', color);
    setText(this.num, String(level));
    this.pips.forEach((p, i) => p.classList.toggle('on', i < level));
    setText(this.title, TITLES[level] ?? 'ELIMINATED');
    setText(this.sub, headshot ? 'HEADSHOT' : '');
    setStyle(this.sub, 'display', headshot ? '' : 'none');
    this.root.classList.toggle('max', level >= 5);
    this.t = 0;
    setStyle(this.root, 'display', 'block');
  }

  update(dt) {
    if (this.t >= LIFE) return;
    this.t = Math.min(LIFE, this.t + dt);
    const t = this.t;
    if (t >= LIFE) {
      setStyle(this.root, 'display', 'none');
      return;
    }
    // pop: overshoot from big to 1 in ~0.2 s, fade out over the last 0.35 s
    const pop = Math.min(1, t / 0.2);
    const back = 1 + 2.4 * (pop - 1) ** 3 + 1.4 * (pop - 1) ** 2; // easeOutBack
    const big = this.level >= 5 ? 1.25 : 1;
    const s = (1.7 - 0.7 * back) * big;
    const a = t < 0.08 ? t / 0.08 : t > LIFE - 0.35 ? (LIFE - t) / 0.35 : 1;
    setStyle(this.root, 'opacity', a.toFixed(3));
    setStyle(this.root, 'transform', `translate(-50%, -50%) scale(${s.toFixed(3)})`);
    // the emblem ring pulses out once (twice on the 5th)
    const pulses = this.level >= 5 ? 2 : 1;
    const r = (t * 2.2) % 1;
    const on = t * 2.2 < pulses;
    setStyle(this.ring, 'opacity', on ? (1 - r).toFixed(3) : '0');
    setStyle(this.ring, 'transform', `rotate(45deg) scale(${(1 + r * 0.9).toFixed(3)})`);
  }

  dispose() {
    this.root.remove();
    this.style.remove();
  }
}
