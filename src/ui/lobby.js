/**
 * Duel screens: main menu, join, lobby, results, and small messages.
 * Pure DOM; MatchSystem drives it through show*() and receives the player's
 * choices through the `on` handlers. Every control carries a `data-act`
 * attribute so tools/duel-e2e.mjs can find it.
 *
 *   menu     PRACTICE · CREATE ROOM · JOIN
 *   join     4-character code field · JOIN · BACK
 *   lobby    room code · host settings (aim assist, rounds) · loadout · READY
 *   results  WIN / LOSE · score · REMATCH · LEAVE
 */
import { Loadout } from '../weapons/loadout.js';
import { MAPS, MAP_IDS } from '../arena/layout.js';
import { el } from './util.js';

const CSS = `
.ow-lobby { position: fixed; inset: 0; z-index: 30; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 18px; padding: 24px max(5vw,16px); background: rgba(6,9,12,.86); color: #e8f4f8;
  font-family: "Inter","Helvetica Neue",Arial,sans-serif; text-align: center; touch-action: manipulation;
  user-select: none; -webkit-user-select: none; }
.ow-lobby[hidden] { display: none; }
.ow-lobby h2 { font-size: 32px; letter-spacing: -.02em; }
.ow-lobby .sub { font-size: 15px; color: #a9bcc4; max-width: 520px; }
.ow-lobby .err { font-size: 15px; color: #ff9a8a; min-height: 20px; }
.ow-lobby .row { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; }
.ow-lobby button { min-height: 52px; min-width: 150px; padding: 0 22px; border-radius: 26px; border: 2px solid rgba(61,242,255,.45);
  background: rgba(20,28,34,.85); color: #e8f4f8; font: 700 16px "Inter","Helvetica Neue",Arial,sans-serif; letter-spacing: .06em; }
.ow-lobby button.primary { background: #3df2ff; color: #031015; border-color: #3df2ff; }
.ow-lobby button.on { border-color: #3df2ff; background: rgba(61,242,255,.22); }
.ow-lobby button:disabled { opacity: .45; }
.ow-lobby .code { font: 800 64px ui-monospace,monospace; letter-spacing: .2em; color: #3df2ff; }
.ow-lobby input { width: 220px; height: 64px; border-radius: 12px; border: 2px solid rgba(61,242,255,.5); background: #0d1418;
  color: #e8f4f8; font: 800 40px ui-monospace,monospace; letter-spacing: .3em; text-align: center; text-transform: uppercase; }
.ow-lobby .label { font-size: 13px; color: #a9bcc4; letter-spacing: .08em; }
.ow-lobby .score { font: 800 56px ui-monospace,monospace; }
.ow-toast { position: fixed; left: 50%; top: 18%; transform: translateX(-50%); z-index: 31; padding: 10px 18px; border-radius: 10px;
  background: rgba(10,14,18,.85); color: #fff; font: 600 16px "Inter","Helvetica Neue",Arial,sans-serif; pointer-events: none; }
.ow-toast[hidden] { display: none; }
`;

export class Lobby {
  /**
   * @param {HTMLElement} host
   * @param {{practice:Function, create:Function, join:(code:string)=>void, ready:(primary:string)=>void,
   *          settings:(s:{aimAssist:string, winTarget:number})=>void, rematch:Function, leave:Function}} on
   */
  constructor(host, on) {
    this.on = on;
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.root = el('div', 'ow-lobby', host);
    this.toastEl = el('div', 'ow-toast', host);
    this.toastEl.hidden = true;
    this.primary = 'rifle';
    this.open = false;
    this.hide();
  }

  _clear() {
    this.root.replaceChildren();
    this.root.hidden = false;
    this.open = true;
  }

  _btn(parent, label, act, fn, primary = false) {
    const b = el('button', primary ? 'primary' : null, parent, label);
    b.type = 'button';
    b.dataset.act = act;
    b.addEventListener('click', fn);
    return b;
  }

  hide() {
    this.root.hidden = true;
    this.open = false;
  }

  showMenu(error = '') {
    this._clear();
    el('h2', null, this.root, 'Tablet FPS');
    el('div', 'sub', this.root, '1v1 with a friend — same Wi-Fi or anywhere online — or practice on your own.');
    const row = el('div', 'row', this.root);
    this._btn(row, 'CREATE ROOM', 'create', () => this.on.create(), true);
    this._btn(row, 'JOIN', 'join', () => this.showJoin());
    this._btn(row, 'PRACTICE', 'practice', () => this.on.practice());
    el('div', 'err', this.root, error);
  }

  showJoin(error = '') {
    this._clear();
    el('h2', null, this.root, 'Join a room');
    el('div', 'sub', this.root, "Enter the 4-character code on your friend's screen.");
    const input = el('input', null, this.root);
    input.maxLength = 4;
    input.autocapitalize = 'characters';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.dataset.act = 'code';
    const row = el('div', 'row', this.root);
    const go = this._btn(row, 'JOIN', 'join-go', () => this.on.join(input.value), true);
    this._btn(row, 'BACK', 'back', () => this.showMenu());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing a code must not move the player
      if (e.key === 'Enter') go.click();
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    el('div', 'err', this.root, error);
    setTimeout(() => input.focus(), 0);
  }

  showBusy(title, sub = '') {
    this._clear();
    el('h2', null, this.root, title);
    if (sub) el('div', 'sub', this.root, sub);
    this._btn(el('div', 'row', this.root), 'CANCEL', 'leave', () => this.on.leave());
  }

  showWaiting(code) {
    this._clear();
    el('div', 'label', this.root, 'ROOM CODE');
    const c = el('div', 'code', this.root, code);
    c.dataset.act = 'room-code';
    el('div', 'sub', this.root, 'Send this code to your friend. Same Wi-Fi gives the lowest ping.');
    this._btn(el('div', 'row', this.root), 'CANCEL', 'leave', () => this.on.leave());
  }

  /**
   * @param {{role:'host'|'guest', code:string, settings:{aimAssist:string, winTarget:number},
   *          myReady:boolean, oppReady:boolean}} s
   */
  showLobby(s) {
    this._clear();
    el('div', 'label', this.root, `ROOM ${s.code} · ${s.role === 'host' ? 'YOU ARE HOST' : 'CONNECTED'}`);
    el('h2', null, this.root, 'Get ready');

    this.netEl = el('div', 'sub', this.root, '');
    this.netEl.dataset.act = 'net-info';
    this.setNet(s.net);
    el('div', 'label', this.root, 'AIM ASSIST');
    const aa = el('div', 'row', this.root);
    for (const v of ['off', 'low', 'medium']) {
      const b = this._btn(aa, v.toUpperCase(), `aa-${v}`, () => this.on.settings({ ...s.settings, aimAssist: v }));
      b.classList.toggle('on', s.settings.aimAssist === v);
      b.disabled = s.role !== 'host' || s.myReady;
    }
    el('div', 'label', this.root, 'MAP');
    const mr = el('div', 'row', this.root);
    const cur = s.settings.map ?? 'grid';
    for (const id of MAP_IDS) {
      const b = this._btn(mr, MAPS[id].label, `map-${id}`, () => this.on.settings({ ...s.settings, map: id }));
      b.classList.toggle('on', cur === id);
      b.disabled = s.role !== 'host' || s.myReady;
    }
    el('div', 'sub', this.root, MAPS[cur]?.note ?? '').dataset.act = 'map-note';
    el('div', 'label', this.root, 'FIRST TO');
    const rr = el('div', 'row', this.root);
    for (const n of [3, 5, 7]) {
      const b = this._btn(rr, String(n), `rounds-${n}`, () => this.on.settings({ ...s.settings, winTarget: n }));
      b.classList.toggle('on', s.settings.winTarget === n);
      b.disabled = s.role !== 'host' || s.myReady;
    }
    el('div', 'label', this.root, 'YOUR PRIMARY (+ PISTOL)');
    const lo = el('div', 'row', this.root);
    for (const id of Loadout.PRIMARIES) {
      const b = this._btn(lo, id.toUpperCase(), `primary-${id}`, () => {
        this.primary = id;
        this.showLobby(s);
      });
      b.classList.toggle('on', this.primary === id);
      b.disabled = s.myReady;
    }
    const row = el('div', 'row', this.root);
    const ready = this._btn(row, s.myReady ? 'READY ✓' : 'READY', 'ready', () => this.on.ready(this.primary), true);
    ready.disabled = s.myReady;
    this._btn(row, 'LEAVE', 'leave', () => this.on.leave());
    const st = el('div', 'sub', this.root, s.oppReady ? 'Opponent is ready.' : 'Waiting for opponent to be ready…');
    st.dataset.act = 'opp-ready';
  }

  /** @param {{win:boolean, score:{me:number, them:number}, waiting:boolean}} r */
  showResults(r) {
    this._clear();
    const h = el('h2', null, this.root, r.win ? 'YOU WIN' : 'YOU LOSE');
    h.dataset.act = 'result';
    el('div', 'score', this.root, `${r.score.me} – ${r.score.them}`);
    const row = el('div', 'row', this.root);
    const re = this._btn(row, r.waiting ? 'WAITING…' : 'REMATCH', 'rematch', () => this.on.rematch(), true);
    re.disabled = r.waiting;
    this._btn(row, 'LEAVE', 'leave', () => this.on.leave());
  }

  /**
   * Connection line: DIRECT (device to device) or RELAY (via a TURN server,
   * when the networks don't allow a direct path), and the ping.
   * @param {{route?:string, rtt?:number|null}} [net]
   */
  setNet(net) {
    if (!this.netEl?.isConnected) return;
    const route = net?.route === 'direct' ? 'DIRECT' : net?.route === 'relay' ? 'RELAY' : 'CONNECTING…';
    const ms = net?.rtt != null ? ` · ${Math.round(net.rtt)} ms` : '';
    const warn = net?.rtt != null && net.rtt > 120 ? ' · laggy' : '';
    this.netEl.textContent = `Connection: ${route}${ms}${warn}`;
  }

  toast(msg, seconds = 2.5) {
    this.toastEl.textContent = msg;
    this.toastEl.hidden = false;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => (this.toastEl.hidden = true), seconds * 1000);
  }

  dispose() {
    clearTimeout(this._toastT);
    this.root.remove();
    this.toastEl.remove();
    this.style.remove();
  }
}
