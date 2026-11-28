/**
 * Party screens (3-8 players): the room (players, teams, host settings,
 * ready), the kill feed, the scoreboard and the results. Pure DOM; the
 * PartySystem drives it and receives choices through `on`. Controls carry
 * `data-act` for tools/party-e2e.mjs. Reuses the duel lobby's look
 * (.ow-lobby, styled by ui/lobby.js).
 */
import { Loadout } from '../weapons/loadout.js';
import { MAPS, MAP_IDS } from '../arena/layout.js';
import { PARTY_MODES, TIME_LIMITS, isTeamMode } from '../party/rules.js';
import { BOT_LEVELS } from '../party/bots.js';
import { el } from './util.js';

const CSS = `
.ow-lobby input.name { width: 260px; height: 48px; font: 700 22px "Inter","Helvetica Neue",Arial,sans-serif; letter-spacing: .04em; text-transform: none; }
.ow-plist { display: flex; flex-direction: column; gap: 6px; min-width: min(420px, 90vw); }
.ow-plist .p { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-radius: 12px; background: rgba(20,28,34,.85);
  font: 600 16px "Inter","Helvetica Neue",Arial,sans-serif; }
.ow-plist .p .n { flex: 1; text-align: left; }
.ow-plist .p.me { outline: 2px solid rgba(61,242,255,.6); }
.ow-plist .t0 { color: #3df2ff; } .ow-plist .t1 { color: #ff7a52; }
.ow-plist .ok { color: #7fe39a; }
.ow-plist .lv { font: 700 12px ui-monospace,monospace; color: #a9bcc4; padding: 2px 6px; border-radius: 6px; background: rgba(61,242,255,.12); }
.ow-feed { position: fixed; right: max(14px, env(safe-area-inset-right)); top: 64px; z-index: 12; display: flex; flex-direction: column;
  align-items: flex-end; gap: 4px; pointer-events: none; font: 700 14px "Inter","Helvetica Neue",Arial,sans-serif; }
.ow-feed div { padding: 4px 10px; border-radius: 8px; background: rgba(6,9,12,.66); color: #e8f4f8; }
.ow-feed .me { background: rgba(61,242,255,.28); }
.ow-feed .hs { color: #ffd25a; }
.ow-board { position: fixed; left: 50%; top: 50%; transform: translate(-50%,-50%); z-index: 13; min-width: min(460px, 92vw);
  padding: 16px 18px; border-radius: 16px; background: rgba(6,9,12,.86); color: #e8f4f8; pointer-events: none;
  font: 600 15px "Inter","Helvetica Neue",Arial,sans-serif; }
.ow-board[hidden] { display: none; }
.ow-board h3 { font-size: 18px; margin-bottom: 8px; text-align: center; letter-spacing: .06em; }
.ow-board table { width: 100%; border-collapse: collapse; }
.ow-board td { padding: 4px 8px; text-align: right; } .ow-board td:first-child { text-align: left; }
.ow-board tr.me td { color: #3df2ff; }
.ow-board .t1 td:first-child { color: #ff7a52; } .ow-board .t0 td:first-child { color: #3df2ff; }
.ow-board .sub { text-align: center; margin-top: 8px; color: #a9bcc4; }
`;

/** Names players chose (id -> name); PartySystem keeps it in step with the roster. */
export const names = new Map();
/** Players' levels (id -> level), from the roster. */
export const levels = new Map();
export const playerName = (id) => names.get(id) || `P${id + 1}`;

/** A name as typed -> a safe display name: no control characters, at most 12 characters. */
export function cleanName(s) {
  return [...String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim()].slice(0, 12).join('');
}

export class PartyUI {
  /**
   * @param {HTMLElement} host
   * @param {{ready:(primary:string)=>void, settings:(s:object)=>void, team:(t:number)=>void,
   *          name:(n:string)=>void, bot:(n:number)=>void, again:()=>void, leave:()=>void}} on
   */
  constructor(host, on) {
    this.on = on;
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.root = el('div', 'ow-lobby', host);
    this.root.hidden = true;
    this.feed = el('div', 'ow-feed', host);
    this.board = el('div', 'ow-board', host);
    this.board.hidden = true;
    this.board.dataset.act = 'scoreboard';
    this.primary = 'rifle';
    this.secondary = 'pistol';
  }

  _clear() {
    this.root.replaceChildren();
    this.root.hidden = false;
    this.root.classList.add('in-room');
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
  }

  showBusy(title, sub, onCancel) {
    this._clear();
    el('h2', null, this.root, title);
    if (sub) el('div', 'sub', this.root, sub);
    this._btn(el('div', 'row', this.root), 'CANCEL', 'leave', onCancel);
  }

  /**
   * @param {{code:string, me:number, host:boolean, players:{id:number, team:number, ready:boolean}[],
   *          settings:{mode:string, map:string, scoreLimit:number, timeLimit:number, aimAssist:string},
   *          net?:string}} s
   */
  showLobby(s) {
    // a roster update must not steal the name field from someone typing in it
    const typing = document.activeElement === this.nameEl ? { v: this.nameEl.value, at: this.nameEl.selectionStart } : null;
    this._clear();
    if (s.offline) {
      el('div', 'label', this.root, 'VS BOTS · OFFLINE');
      el('div', 'code', this.root, 'BOTS').dataset.act = 'room-code';
      el('div', 'sub', this.root, s.offlineWhy
        ? `No connection service, so friends can't join — bots only. ${s.offlineWhy}`
        : 'Just you and the bots: no internet needed.').dataset.act = 'net-info';
    } else {
      el('div', 'label', this.root, `PARTY ROOM · ${s.host ? 'YOU ARE HOST' : 'CONNECTED'}`);
      const c = el('div', 'code', this.root, s.code);
      c.dataset.act = 'room-code';
      el('div', 'sub', this.root, `${s.players.length}/8 players · friends join with this code${s.net ? ' · ' + s.net : ''}`).dataset.act = 'net-info';
    }
    const me = s.players.find((p) => p.id === s.me);
    const locked = !s.host || !!me?.ready;
    const ng = el('div', 'set', this.root);
    el('div', 'label', ng, 'YOUR NAME');
    const name = el('input', 'name', ng);
    name.maxLength = 12;
    name.placeholder = `P${s.me + 1}`;
    name.value = typing ? typing.v : (me?.name ?? '');
    name.autocomplete = 'off';
    name.spellcheck = false;
    name.dataset.act = 'name';
    const commit = () => this.on.name(cleanName(name.value));
    name.addEventListener('change', commit);
    name.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing must not move the player
      if (e.key === 'Enter') name.blur();
    });
    name.addEventListener('keyup', (e) => e.stopPropagation());
    this.nameEl = name;
    if (typing) {
      name.focus();
      name.setSelectionRange(typing.at, typing.at);
    }
    const set = (label) => {
      const g = el('div', 'set', this.root);
      el('div', 'label', g, label);
      return el('div', 'row', g);
    };
    const mo = set('MODE');
    for (const [id, m] of Object.entries(PARTY_MODES)) {
      const b = this._btn(mo, m.label, `mode-${id}`, () => this.on.settings({ ...s.settings, mode: id, scoreLimit: m.def }));
      b.classList.toggle('on', s.settings.mode === id);
      b.disabled = locked;
    }
    const mr = set('MAP');
    for (const id of MAP_IDS) {
      const b = this._btn(mr, MAPS[id].label, `map-${id}`, () => this.on.settings({ ...s.settings, map: id }));
      b.classList.toggle('on', s.settings.map === id);
      b.disabled = locked;
    }
    const sl = set({ tdm: 'TEAM KILLS TO WIN', koth: 'HILL POINTS TO WIN', gun: 'KILLS (4 GUNS × 2)' }[s.settings.mode] ?? 'KILLS TO WIN');
    for (const n of PARTY_MODES[s.settings.mode].limits) {
      const b = this._btn(sl, String(n), `limit-${n}`, () => this.on.settings({ ...s.settings, scoreLimit: n }));
      b.classList.toggle('on', s.settings.scoreLimit === n);
      b.disabled = locked;
    }
    const tl = set('TIME');
    for (const t of TIME_LIMITS) {
      const b = this._btn(tl, `${t / 60} MIN`, `time-${t}`, () => this.on.settings({ ...s.settings, timeLimit: t }));
      b.classList.toggle('on', s.settings.timeLimit === t);
      b.disabled = locked;
    }
    const lo = set('PRIMARY');
    for (const id of Loadout.PRIMARIES) {
      const b = this._btn(lo, id.toUpperCase(), `primary-${id}`, () => {
        this.primary = id;
        this.showLobby(s);
      });
      b.classList.toggle('on', this.primary === id);
      b.disabled = !!me?.ready || s.settings.mode === 'gun'; // gun game hands out the guns
    }
    // the secondary: one button on the primary's line that cycles (phones have no room for another line)
    const secs = Loadout.SECONDARIES.filter((id) => id !== this.primary);
    const sec = secs.includes(this.secondary) ? this.secondary : 'pistol';
    const sb = this._btn(lo, `2ND: ${sec.toUpperCase()} ▸`, 'secondary', () => {
      this.secondary = secs[(secs.indexOf(sec) + 1) % secs.length];
      this.on.secondary?.(this.secondary);
      this.showLobby(s);
    });
    sb.disabled = !!me?.ready || s.settings.mode === 'gun';
    const list = el('div', 'ow-plist', this.root);
    list.dataset.act = 'players';
    for (const p of s.players) {
      const row = el('div', `p${p.id === s.me ? ' me' : ''}`, list);
      el('span', `n${isTeamMode(s.settings.mode) ? ' t' + p.team : ''}`, row, `${playerName(p.id)}${p.id === (s.hostId ?? 0) ? ' · host' : ''}${p.bot ? ' · bot' : ''}${p.id === s.me ? ' (you)' : ''}`);
      if (isTeamMode(s.settings.mode)) el('span', `t${p.team}`, row, p.team === 0 ? 'CYAN' : 'ORANGE');
      if (levels.get(p.id)) el('span', 'lv', row, `LV ${levels.get(p.id)}`);
      el('span', p.ready ? 'ok' : '', row, p.ready ? 'READY' : '…');
    }
    if (s.players.some((p) => p.bot)) {
      const bl = set('BOTS');
      for (const [id, l] of Object.entries(BOT_LEVELS)) {
        const b = this._btn(bl, l.label, `bots-${id}`, () => this.on.settings({ ...s.settings, botLevel: id }));
        b.classList.toggle('on', (s.settings.botLevel ?? 'normal') === id);
        b.disabled = locked;
      }
    }
    if (s.host) {
      const br = el('div', 'row', this.root);
      const add = this._btn(br, '+ BOT', 'add-bot', () => this.on.bot(1));
      add.disabled = s.players.length >= 8 || !!me?.ready;
      const rem = this._btn(br, '− BOT', 'remove-bot', () => this.on.bot(-1));
      rem.disabled = !s.players.some((p) => p.bot) || !!me?.ready;
    }
    const row = el('div', 'row actions', this.root);
    if (isTeamMode(s.settings.mode)) {
      const t = this._btn(row, 'SWITCH TEAM', 'switch-team', () => this.on.team(1 - (me?.team ?? 0)));
      t.disabled = !!me?.ready;
    }
    const enough = s.players.length >= 2;
    const ready = this._btn(row, me?.ready ? 'READY ✓' : 'READY', 'ready', () => this.on.ready(this.primary), true);
    ready.disabled = !!me?.ready;
    this._btn(row, 'LEAVE', 'leave', () => this.on.leave());
    el('div', 'sub', this.root, enough ? 'The match starts when everyone is ready.' : 'Waiting for at least one more player…');
  }

  /** @param {{standings:object[], teams:number[], mode:string, winner:number|null, me:number, host:boolean}} r */
  showResults(r) {
    this.board.hidden = true;
    this._clear();
    let title;
    if (isTeamMode(r.mode)) {
      const myTeam = r.standings.find((p) => p.id === r.me)?.team;
      title = r.winner == null ? 'DRAW' : r.winner === myTeam ? 'YOUR TEAM WINS' : 'YOUR TEAM LOSES';
      el('div', 'score', this.root, `${r.teams[0]} – ${r.teams[1]}`);
    } else title = r.winner === r.me ? 'YOU WIN' : r.winner == null ? 'DRAW' : `${playerName(r.winner)} WINS`;
    const h = el('h2', null, this.root, title);
    h.dataset.act = 'result';
    this.root.prepend(h);
    this._table(this.root, r.standings, r.me, r.mode);
    const row = el('div', 'row', this.root);
    if (r.host) this._btn(row, 'BACK TO ROOM', 'again', () => this.on.again(), true);
    else el('div', 'sub', row, 'The host can start another match.');
    this._btn(row, 'LEAVE', 'leave', () => this.on.leave());
  }

  _table(parent, standings, me, mode) {
    const t = el('table', null, parent);
    const head = el('tr', null, t);
    for (const h of ['PLAYER', 'K', 'D']) el('td', null, head, h);
    for (const p of standings) {
      const tr = el('tr', `${p.id === me ? 'me ' : ''}${isTeamMode(mode) ? 't' + p.team : ''}`, t);
      el('td', null, tr, `${playerName(p.id)}${levels.get(p.id) ? `  ·  LV ${levels.get(p.id)}` : ''}`);
      el('td', null, tr, String(p.kills));
      el('td', null, tr, String(p.deaths));
    }
    return t;
  }

  /** Scoreboard overlay (while dead, or on demand). */
  showBoard({ standings, teams, mode, me, sub = '' }) {
    this.board.replaceChildren();
    el('h3', null, this.board, isTeamMode(mode) ? `CYAN ${teams[0]} – ${teams[1]} ORANGE` : 'SCORES');
    this._table(this.board, standings, me, mode);
    if (sub) el('div', 'sub', this.board, sub).dataset.act = 'respawn-in';
    this.board.hidden = false;
    this.lastBoard = this.board.textContent; // what the player last saw (tests)
  }

  hideBoard() {
    this.board.hidden = true;
  }

  /** One kill-feed line, gone after a few seconds. */
  feedKill({ killer, victim, weapon, headshot, me }) {
    const line = el('div', killer === me || victim === me ? 'me' : '', this.feed);
    line.textContent = killer === victim
      ? `${playerName(victim)}  ${weapon === 'fall' ? 'fell off the edge' : 'died'}`
      : `${playerName(killer)}  ▸  ${playerName(victim)}  ·  ${String(weapon ?? '').toUpperCase()}`;
    if (headshot) el('span', 'hs', line, '  ✦');
    while (this.feed.children.length > 5) this.feed.firstChild.remove();
    setTimeout(() => line.remove(), 6000);
  }

  clearFeed() {
    this.feed.replaceChildren();
  }

  dispose() {
    this.root.remove();
    this.feed.remove();
    this.board.remove();
    this.style.remove();
  }
}
