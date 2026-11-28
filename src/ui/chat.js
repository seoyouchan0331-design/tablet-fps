/**
 * ChatSystem — typed chat in rooms: everyone (ALL) or your team (TEAM).
 *
 * The screen part only: a log on the left (last 6 lines, fading after 8 s,
 * all of them while typing) and an input bar. Open it with the CHAT button,
 * Enter (all) or T (team); Enter sends, Escape closes. While the bar is
 * open, keys go to the text field, never to the game.
 *
 * A room (duel or party) plugs itself in:
 *   chat.attach({ send(text, team), team: boolean })   team: TEAM is offered
 *   chat.detach()
 *   chat.receive({ from, text, team, mine, color })     a line to show
 * and does the networking (the party host relays TEAM lines to teammates only).
 */
import { el } from './util.js';

export const CHAT_MAX = 120;

/** Typed text -> what may be sent: no control characters, single spaces, at most CHAT_MAX. */
export function cleanChat(s) {
  return [...String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, CHAT_MAX).join('');
}

const CSS = `
.ow-chat-log { position: fixed; left: max(14px, env(safe-area-inset-left)); bottom: 34%; z-index: 33; width: min(420px, 60vw);
  display: flex; flex-direction: column; gap: 3px; pointer-events: none; font: 600 14px "Inter","Helvetica Neue",Arial,sans-serif; }
.ow-chat-log .l { padding: 3px 9px; border-radius: 8px; background: rgba(6,9,12,.62); color: #e8f4f8; overflow-wrap: anywhere;
  transition: opacity .6s; }
.ow-chat-log .l.old { opacity: 0; }
.ow-chat-log.typing .l.old { opacity: 1; }
.ow-chat-log .n { font-weight: 800; margin-right: 6px; }
.ow-chat-log .t { color: #7fe39a; font-weight: 800; margin-right: 4px; }
.ow-chat-btn { position: fixed; right: max(70px, calc(env(safe-area-inset-right) + 70px)); top: 16px; z-index: 33; height: 44px; padding: 0 14px;
  border-radius: 22px; border: 2px solid rgba(61,242,255,.45); background: rgba(10,14,18,.5); color: #e8f4f8;
  font: 700 13px "Inter","Helvetica Neue",Arial,sans-serif; letter-spacing: .06em; }
.ow-chat-btn[hidden], .ow-chat-bar[hidden] { display: none; }
.ow-chat-bar { position: fixed; left: 50%; transform: translateX(-50%); top: 12%; z-index: 34; display: flex; gap: 8px; align-items: center;
  width: min(640px, 94vw); padding: 8px; border-radius: 16px; background: rgba(6,9,12,.92); }
.ow-chat-bar input { flex: 1; min-width: 0; height: 44px; padding: 0 12px; border-radius: 10px; border: 2px solid rgba(61,242,255,.5);
  background: #0d1418; color: #e8f4f8; font: 600 17px "Inter","Helvetica Neue",Arial,sans-serif; }
.ow-chat-bar button { height: 44px; padding: 0 14px; border-radius: 22px; border: 2px solid rgba(61,242,255,.45); background: rgba(20,28,34,.85);
  color: #e8f4f8; font: 700 13px "Inter","Helvetica Neue",Arial,sans-serif; letter-spacing: .05em; }
.ow-chat-bar button.on { background: #3df2ff; color: #031015; border-color: #3df2ff; }
.ow-chat-bar button:disabled { opacity: .35; }
`;

export class ChatSystem {
  static id = 'chat';
  static deps = ['ui'];

  async init(ctx) {
    this.ctx = ctx;
    this.room = null;
    this.team = false;
    this.lines = [];
    const host = document.getElementById('ui') ?? document.body;
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.log = el('div', 'ow-chat-log', host);
    this.log.dataset.act = 'chat-log';
    this.btn = el('button', 'ow-chat-btn', host, 'CHAT');
    this.btn.type = 'button';
    this.btn.dataset.act = 'chat-open';
    this.btn.hidden = true;
    this.btn.addEventListener('click', () => this.open(false));
    this.bar = el('div', 'ow-chat-bar', host);
    this.bar.hidden = true;
    this.allBtn = el('button', null, this.bar, 'ALL');
    this.teamBtn = el('button', null, this.bar, 'TEAM');
    this.allBtn.type = this.teamBtn.type = 'button';
    this.allBtn.dataset.act = 'chat-all';
    this.teamBtn.dataset.act = 'chat-team';
    this.allBtn.addEventListener('click', () => this._mode(false));
    this.teamBtn.addEventListener('click', () => this._mode(true));
    this.input = el('input', null, this.bar);
    this.input.maxLength = CHAT_MAX;
    this.input.autocomplete = 'off';
    this.input.enterKeyHint = 'send';
    this.input.dataset.act = 'chat-input';
    const send = el('button', null, this.bar, 'SEND');
    send.type = 'button';
    send.dataset.act = 'chat-send';
    send.addEventListener('click', () => this.submit());
    const close = el('button', null, this.bar, '✕');
    close.type = 'button';
    close.addEventListener('click', () => this.close());
    for (const t of ['keydown', 'keyup', 'keypress']) {
      this.input.addEventListener(t, (e) => {
        e.stopPropagation(); // typing must never move or shoot
        if (t === 'keydown' && e.key === 'Enter') this.submit();
        if (t === 'keydown' && e.key === 'Escape') this.close();
      });
    }
    this._onKey = (e) => {
      if (!this.room || !this.bar.hidden || e.repeat) return;
      if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      if (e.code === 'Enter') { e.preventDefault(); this.open(false); }
      else if (e.code === 'KeyT' && this.room.team) { e.preventDefault(); this.open(true); }
    };
    addEventListener('keydown', this._onKey);
  }

  attach(room) {
    this.room = room;
    this.btn.hidden = false;
    this._mode(this.team && room.team);
  }

  /** The room's options changed (TEAM comes and goes with the mode). */
  setTeam(on) {
    if (!this.room) return;
    this.room.team = on;
    this._mode(this.team && on);
  }

  detach() {
    this.room = null;
    this.btn.hidden = true;
    this.close();
    this.lines = [];
    this.log.replaceChildren();
  }

  _mode(team) {
    this.team = !!team;
    this.allBtn.classList.toggle('on', !this.team);
    this.teamBtn.classList.toggle('on', this.team);
    this.teamBtn.disabled = !this.room?.team;
  }

  open(team) {
    if (!this.room) return;
    this._mode(team && this.room.team);
    this.bar.hidden = false;
    this.log.classList.add('typing');
    document.exitPointerLock?.();
    this.ctx.peek('player')?.setControlEnabled?.(false);
    this._resume = true;
    setTimeout(() => this.input.focus(), 0);
  }

  close() {
    if (this.bar.hidden) return;
    this.bar.hidden = true;
    this.input.value = '';
    this.input.blur();
    this.log.classList.remove('typing');
    if (this._resume) {
      this._resume = false;
      // back to the game, unless a menu took over in the meantime
      const inMatch = this.ctx.peek('match')?.live || this.ctx.peek('party')?.live;
      const dead = this.ctx.peek('player')?.dead;
      if (inMatch && !dead) this.ctx.peek('player')?.setControlEnabled?.(true);
    }
  }

  submit() {
    const text = cleanChat(this.input.value);
    if (text && this.room) this.room.send(text, this.team && !!this.room.team);
    this.close();
  }

  /** @param {{from:string, text:string, team?:boolean, mine?:boolean, color?:string}} m */
  receive(m) {
    const text = cleanChat(m.text);
    if (!text) return;
    const line = el('div', 'l', this.log);
    if (m.team) el('span', 't', line, '[TEAM]');
    const n = el('span', 'n', line, `${String(m.from ?? '?').slice(0, 16)}:`);
    if (m.color) n.style.color = m.color;
    line.appendChild(document.createTextNode(text));
    this.lines.push({ text, from: m.from, team: !!m.team });
    while (this.log.children.length > 6) this.log.firstChild.remove();
    setTimeout(() => line.classList.add('old'), 8000);
  }

  dispose() {
    removeEventListener('keydown', this._onKey);
    this.log.remove();
    this.btn.remove();
    this.bar.remove();
    this.style.remove();
  }
}
