/**
 * PartySystem — rooms of 2-8 players: free-for-all or team deathmatch with
 * respawns, on any map.
 *
 * Star network: the room creator is the HOST (player 0). Guests (1..7) talk
 * only to the host. The host
 *   - runs the rules (party/rules.js), owns every player's HP,
 *   - validates hit claims (match/validate.js) and broadcasts damage, kills,
 *     respawns (with the spawn point it picked) and the end,
 *   - relays everyone's state 20 times a second in one batch per guest, and
 *     relays each shot as it happens.
 * Every side runs the same `_apply*` handlers for host events; the host just
 * calls them locally as well as sending them. As in the duel, a bullet that
 * hits a remote player on MY screen becomes a claim for the host, never
 * damage applied here.
 *
 * Transport: `?net=bc` BroadcastChannel tabs (tests), else PeerJS.
 */
import * as THREE from 'three';
import { openPartyHost, openPartyGuest, OfflineHub } from '../net/party.js';
import { makeRoomCode } from '../net/roomcode.js';
import { smoothRtt } from '../net/ice.js';
import { validateHit } from '../match/validate.js';
import { ClockSync } from '../match/interp.js';
import { applyDamage, MAX_HP } from '../opponent/hitbox.js';
import { Deathmatch, PARTY_MODES, spawnCandidates, pickSpawn, isTeamMode, gunFor, HILL } from './rules.js';
import { Bot, buildNav, BOT_LEVELS } from './bots.js';
import { packState, unpackState } from './wire.js';
import { grenadeDamage } from '../weapons/grenades.js';
import { insideXZ } from '../arena/shapes.js';
import { MAPS } from '../arena/layout.js';
import { PartyUI, playerName, names, levels, cleanName } from '../ui/party.js';
import { cleanChat } from '../ui/chat.js';

const NAME_KEY = 'tfps.name';
const loadName = () => { try { return cleanName(localStorage.getItem(NAME_KEY)); } catch { return ''; } };
const saveName = (n) => { try { localStorage.setItem(NAME_KEY, n); } catch { /* private mode */ } };

const STATE_HZ = 20;
const PING_S = 1;
/** Silence this long means a device is gone (a clean leave is seen at once, by the link). */
const SILENCE_S = 10;
const ERRORS = {
  'room-not-found': 'Party not found. Check the code and that the host is still in the room.',
  'room-full': 'That party is full (8 players).',
  'room-taken': 'That party code is in use. Try again.',
  'in-progress': 'That party is in a match. Join when it is back in the room.',
  timeout: "Couldn't connect — try again, or switch to another network.",
  network: "Couldn't reach the connection service. Check the internet connection.",
};

export class PartySystem {
  static id = 'party';
  static deps = ['player', 'weapons', 'opponent', 'ui', 'physics', 'match'];

  async init(ctx) {
    this.ctx = ctx;
    this.net = new URLSearchParams(globalThis.location?.search ?? '').get('net') ?? 'peer';
    this.phase = 'off'; // off | connecting | lobby | match | results
    this.host = false;
    this.me = -1;
    this.code = null;
    this.link = null; // host: hub, guest: link to the host
    this.settings = { mode: 'ffa', map: 'town', scoreLimit: PARTY_MODES.ffa.def, timeLimit: 300, aimAssist: 'low', botLevel: 'normal' };
    /** @type {Map<number, {id:number, team:number, ready:boolean, primary:string, peer?:string}>} */
    this.players = new Map();
    this.rules = null; // host only
    this.hp = {};
    this.alive = {};
    this.live = false;
    this._seq = 0;
    this._shots = new Map(); // id -> Map(seq -> {t, prev})
    this._lastShot = new Map(); // id -> t
    this._hitCount = new Map(); // `${id}:${seq}` -> hits taken
    this._latest = new Map(); // host: id -> newest state
    this._fresh = new Map(); // host: states received since the last batch
    this._seen = new Map(); // everyone: the newest state seen of each player (a takeover starts from it)
    this._clocks = new Map(); // id -> ClockSync
    this._stateAcc = 0;
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._from = new THREE.Vector3();
    this.ui = new PartyUI(document.getElementById('ui') ?? document.body, {
      ready: (primary) => this._send({ type: 'p.ready', primary }, true),
      settings: (s) => this._changeSettings(s),
      team: (t) => this._send({ type: 'p.team', team: t }, true),
      bot: (n) => (n > 0 ? this._addBot() : this._removeBot()),
      secondary: (id) => { const w = this.ctx.peek('weapons'); if (w) w.secondaryPick = id; },
      name: (n) => {
        saveName(n);
        this._send({ type: 'p.name', name: n, lv: this._myLv() }, true);
      },
      again: () => this._backToRoom(),
      leave: () => this.leave(),
    });
    this._offHit = ctx.events.prepend('damage:dealt', (e) => this._onLocalHit(e));
    this._offFire = ctx.events.on('weapon:fire', (e) => this._onLocalFire(e));
    this._nades = new Map(); // grenade id -> thrower id (host)
    this._offNade = ctx.events.on('grenade:throw', (e) => this._onLocalNade(e));
    this._offBoom = ctx.events.on('grenade:explode', (e) => this._onBoom(e));
    this._onPageHide = () => this.link?.close();
    globalThis.addEventListener?.('pagehide', this._onPageHide);
  }

  _myLv() {
    return this.ctx.peek('stats')?.level ?? 1;
  }

  get active() {
    return this.phase !== 'off';
  }

  // ------------------------------------------------------------------ flow --
  async create() {
    this.host = true;
    this.me = 0;
    this.code = makeRoomCode(undefined, 5);
    this.phase = 'connecting';
    this._enterParty();
    this.ui.showBusy('Opening a party…', '', () => this.leave());
    try {
      this._abort = new AbortController();
      this.link = await openPartyHost(this.net, this.code, { signal: this._abort.signal });
      this.offline = false;
    } catch (err) {
      if (this.phase !== 'connecting') return;
      if (err.message === 'cancelled') return this._exit();
      // no connection service (no internet, or a page that may not open
      // connections): the room still works for bots, just nobody can join
      this.link = new OfflineHub();
      this.offline = true;
      this._offlineWhy = `${ERRORS[err.message] ?? err.message}${err.detail ? ` (${err.detail})` : ''}`;
    }
    this.gen = 0;
    this.hostId = 0;
    this._wireHub(this.link);
    this._attachChat();
    this.players.set(0, { id: 0, team: 0, ready: false, primary: 'rifle', name: loadName(), lv: this._myLv() });
    this.phase = 'lobby';
    this._broadcastRoster();
  }

  /** A room with bots only, no network needed (the menu's VS BOTS). */
  async createOffline() {
    this.host = true;
    this.me = 0;
    this.code = 'BOTS';
    this.phase = 'connecting';
    this._enterParty();
    this.link = new OfflineHub();
    this.offline = true;
    this._offlineWhy = '';
    this.gen = 0;
    this.hostId = 0;
    this._wireHub(this.link);
    this._attachChat();
    this.players.set(0, { id: 0, team: 0, ready: false, primary: 'rifle', name: loadName(), lv: this._myLv() });
    this.phase = 'lobby';
    this._addBot();
    this._addBot();
    this._addBot();
    this._broadcastRoster(false);
  }

  /**
   * Straight into an offline match against bots (the dev panel's SOLO
   * buttons): mode, map, how many bots.
   */
  async startSolo({ mode = 'ffa', map = 'town', bots = 3 } = {}) {
    if (this.phase !== 'off') this.leave();
    await this.createOffline();
    while ([...this.players.values()].filter((p) => p.bot).length > bots) this._removeBot();
    while ([...this.players.values()].filter((p) => p.bot).length < bots) this._addBot();
    this._changeSettings({ ...this.settings, mode, map, scoreLimit: PARTY_MODES[mode]?.def });
    this._send({ type: 'p.ready', primary: this.ui.primary ?? 'rifle' }, true);
  }

  /** Bot difficulty now, for the bots already playing too (dev panel). */
  setBotLevel(level) {
    this.settings.botLevel = level;
    for (const b of this._bots?.values() ?? []) b.skill = BOT_LEVELS[level] ?? b.skill;
  }

  async join(code) {
    this.host = false;
    this.code = code;
    this.phase = 'connecting';
    this._enterParty();
    this.ui.showBusy(`Joining party ${code}…`, 'Connecting to the host.', () => this.leave());
    try {
      this._abort = new AbortController();
      this.link = await openPartyGuest(this.net, code, { signal: this._abort.signal });
    } catch (err) {
      if (this.phase === 'connecting') this._exit(ERRORS[err.message] ?? String(err.message));
      return;
    }
    this.gen = 0;
    this.hostId = 0;
    this._wireGuest(this.link);
    this._attachChat();
    this.phase = 'lobby';
  }

  _wireHub(hub) {
    this._heard = new Map();
    hub.onJoin((peer) => this._hostJoin(peer));
    hub.onLeave((peer) => this._hostLeave(peer));
    hub.onMessage((peer, m) => {
      if (m?.type === 'p.rejoin') return this._hostRejoin(peer, m);
      const id = this._idOf(peer);
      if (id == null) return;
      this._heard.set(id, performance.now() / 1000);
      this._hostMessage(id, m);
    });
  }

  _wireGuest(link) {
    this._lastHeard = performance.now() / 1000;
    link.onMessage((m) => {
      this._lastHeard = performance.now() / 1000;
      this._guestMessage(m);
    });
    link.onClose(() => {
      if (this.link !== link) return;
      this.link = null;
      this._hostLost();
    });
    setTimeout(() => link.route?.().then((r) => { this.route = r; }), 1500);
  }

  // ------------------------------------------------------- host migration --
  /**
   * The host is gone. The remaining human with the lowest id takes over:
   * it re-opens the room under the next generation of the code and picks
   * the match up from what everybody knew (scores, clock, who is alive,
   * bots where they were last seen); the others reconnect to it and keep
   * their ids. If the chosen one never shows up, the next in line tries.
   */
  async _hostLost() {
    if (this._migrating || this.phase === 'off') return;
    this._migrating = true;
    const old = this.hostId;
    this.players.delete(old);
    this.ctx.peek('opponent')?.remove(old);
    this.alive[old] = false;
    const line = [...this.players.values()].filter((p) => !p.bot).map((p) => p.id).sort((a, b) => a - b);
    const gen = (this.gen ?? 0) + 1;
    const ui = this.ctx.peek('ui');
    for (const next of line) {
      if (this.phase === 'off') break;
      if (next === this.me) {
        ui?.banner?.show('The host left', 'You are the new host');
        if (await this._becomeHost(gen)) {
          this._migrating = false;
          return;
        }
        break;
      }
      ui?.banner?.show('The host left', `${playerName(next)} takes over…`);
      if (await this._rejoin(gen, next)) {
        this._migrating = false;
        return;
      }
      // they never opened the room: drop them and try the next in line
      this.players.delete(next);
      this.ctx.peek('opponent')?.remove(next);
    }
    this._migrating = false;
    this._exit('The host left the party.');
  }

  async _becomeHost(gen) {
    let hub;
    try {
      hub = await openPartyHost(this.net, this.code, { gen });
    } catch {
      return false;
    }
    if (this.phase === 'off') {
      hub.close();
      return false;
    }
    this.link = hub;
    this.gen = gen;
    this.host = true;
    this.hostId = this.me;
    for (const p of this.players.values()) delete p.peer;
    this._wireHub(hub);
    this._chatAt = new Map();
    this._rejoinUntil = performance.now() / 1000 + 20;
    if (this.phase === 'match' || this.phase === 'results') {
      const wall = performance.now() / 1000;
      this.rules = new Deathmatch({ mode: this.settings.mode, scoreLimit: this.settings.scoreLimit, timeLimit: this.settings.timeLimit });
      this.rules.restore({
        state: this.phase === 'results' ? 'end' : this.live ? 'live' : 'countdown',
        timeLeft: this.live && this._roundEndsAt ? Math.max(1, this._roundEndsAt - wall) : this.live ? this.settings.timeLimit : 1,
        players: [...this.players.values()].map((p) => ({ id: p.id, team: p.team, kills: this._scores?.[p.id]?.[0] ?? 0, deaths: this._scores?.[p.id]?.[1] ?? 0, alive: this.alive[p.id] !== false })),
        zone: this.settings.mode === 'koth' ? this._teams : undefined,
      });
      for (const [id, st] of this._seen) if (this.players.has(id)) this._latest.set(id, st);
      // the bots carry on from where they were last seen
      this._startBots({});
      for (const [id, b] of this._bots) {
        const st = this._seen.get(id);
        if (st) b.place(st.x, st.z, st.yaw, st.y);
        if (this.settings.mode === 'gun') b.weapon = this._botWeapon(gunFor(this._scores?.[id]?.[0] ?? 0));
      }
      if (this.phase === 'results' && this._lastEnd) this.ui.showResults({ ...this._lastEnd, host: true });
    }
    this._broadcastRoster(false);
    return true;
  }

  async _rejoin(gen, hostId) {
    const until = performance.now() / 1000 + 15;
    while (performance.now() / 1000 < until && this.phase !== 'off') {
      try {
        const link = await openPartyGuest(this.net, this.code, { gen, timeout: 5000 });
        if (this.phase === 'off') {
          link.close();
          return false;
        }
        this.link = link;
        this.gen = gen;
        this.host = false;
        this.hostId = hostId;
        this._wireGuest(link);
        link.send({ type: 'p.rejoin', id: this.me });
        return true;
      } catch {
        await new Promise((r) => setTimeout(r, 600));
      }
    }
    return false;
  }

  /** New host: someone from the old room is back. */
  _hostRejoin(peer, m) {
    const p = this.players.get(m.id);
    if (!p || p.bot || p.peer || p.id === this.me) return this._hostJoin(peer, true);
    p.peer = peer;
    this._heard.set(p.id, performance.now() / 1000);
    this.link.send(peer, { type: 'p.welcome', you: p.id, code: this.code });
    this._broadcastRoster(false);
  }

  leave() {
    this._migrating = false;
    this._rejoinUntil = 0;
    this._abort?.abort();
    const l = this.link;
    this.link = null;
    l?.close();
    this._exit();
  }

  /** Take over the screen from the duel menu. */
  _enterParty() {
    const match = this.ctx.peek('match');
    if (match) {
      match.phase = 'party';
      match.lobby.hide();
    }
    this.ctx.peek('player')?.setControlEnabled?.(false);
  }

  // ------------------------------------------------------------------ chat --
  _attachChat() {
    this._chatAt = new Map(); // host: id -> last line time (rate limit)
    this.ctx.peek('chat')?.attach({
      team: isTeamMode(this.settings.mode),
      send: (text, team) => {
        if (this.host) this._hostChat(this.me, text, team);
        else this.link?.send({ type: 'p.chat', text, team });
      },
    });
  }

  /** Host: a line from player `id` -> everyone (ALL) or the sender's team (TEAM). */
  _hostChat(id, raw, team) {
    const from = this.players.get(id);
    const text = cleanChat(raw);
    if (!from || !text) return;
    const now = performance.now() / 1000;
    if (now - (this._chatAt.get(id) ?? -1) < 0.5) return; // one line every half second
    this._chatAt.set(id, now);
    const toTeam = !!team && isTeamMode(this.settings.mode);
    const out = { type: 'p.chat', id, text, team: toTeam };
    for (const p of this.players.values()) {
      if (!p.peer || (toTeam && p.team !== from.team)) continue;
      this.link.send(p.peer, out);
    }
    if (!toTeam || this.players.get(this.me)?.team === from.team) this._applyChat(out);
  }

  _applyChat(m) {
    if (!Number.isInteger(m.id)) return;
    const p = this.players.get(m.id);
    const tm = isTeamMode(this.settings.mode);
    const color = m.id === this.me ? '#3df2ff' : tm ? (p?.team === this.players.get(this.me)?.team ? '#3df2ff' : '#ff7a52') : '#ffd25a';
    this.ctx.peek('chat')?.receive({ from: playerName(m.id), text: m.text, team: !!m.team, mine: m.id === this.me, color });
  }

  /** Back to the main menu (with a message). */
  _exit(msg = '') {
    this.ctx.peek('chat')?.detach();
    this._teardownMatch();
    this.phase = 'off';
    this.players.clear();
    this.ui.hide();
    this.ui.hideBoard();
    this.ui.clearFeed();
    this.ctx.peek('opponent')?.clearParty();
    this.ctx.peek('match')?.showMenu(msg);
  }

  // ----------------------------------------------------------- host: room --
  _idOf(peer) {
    for (const p of this.players.values()) if (p.peer === peer) return p.id;
    return null;
  }

  _hostJoin(peer, now = false) {
    if (!now && performance.now() / 1000 < (this._rejoinUntil ?? 0)) {
      // right after a migration most arrivals are players coming back: give them a moment to say so
      setTimeout(() => { if (this._idOf(peer) == null && this.link) this._hostJoin(peer, true); }, 1500);
      return;
    }
    const late = this.phase === 'match' && this.rules && this.rules.state !== 'end';
    if (this.phase !== 'lobby' && !late) {
      // the results screen: come back in a moment
      this.link.send(peer, { type: 'p.busy' });
      setTimeout(() => this.link?.kick(peer), 200);
      return;
    }
    if (this.players.size >= 8 && !this._removeBot(false)) {
      this.link.send(peer, { type: 'p.full' });
      setTimeout(() => this.link?.kick(peer), 200);
      return;
    }
    let id = 1;
    while (this.players.has(id)) id++;
    const team = this._smallerTeam();
    this.players.set(id, { id, team, ready: late, primary: 'rifle', peer, name: '' });
    this._heard.set(id, performance.now() / 1000);
    this.link.send(peer, { type: 'p.welcome', you: id, code: this.code });
    if (late) {
      // straight into the running match: it loads the map, the rules respawn it
      this.rules.add(id, team);
      this.alive[id] = false;
      this.hp[id] = MAX_HP;
      this.link.send(peer, {
        type: 'p.start', settings: this.settings, players: this._roster(), spawns: {},
        late: { scores: this.rules.scores(), teams: this.rules.teamScores(), timeLeft: this.rules.state === 'live' ? this.rules.timeLeft : null, alive: { ...this.alive } },
      });
    }
    this._broadcastRoster(!late);
  }

  _hostLeave(peer) {
    const id = this._idOf(peer);
    if (id == null) return;
    this.players.delete(id);
    this._latest.delete(id);
    if (this.rules) this._hostEvents(this.rules.remove(id));
    this._broadcastRoster();
  }

  _smallerTeam() {
    const n = [0, 0];
    for (const p of this.players.values()) n[p.team]++;
    return n[1] < n[0] ? 1 : 0;
  }

  /** Host, in the room: a bot takes a free slot (8 players at most). */
  _addBot() {
    if (!this.host || this.phase !== 'lobby' || this.players.size >= 8) return;
    let id = 1;
    while (this.players.has(id)) id++;
    const n = [...this.players.values()].filter((p) => p.bot).length + 1;
    const primary = ['rifle', 'smg', 'shotgun'][n % 3];
    this.players.set(id, { id, team: this._smallerTeam(), ready: true, primary, bot: true, name: `Bot ${n}` });
    this._broadcastRoster(false);
  }

  /** Drop the newest bot (to make room, or on request). False when there is none. */
  _removeBot(announce = true) {
    const bots = [...this.players.values()].filter((p) => p.bot);
    if (!bots.length || (announce && this.phase !== 'lobby')) return false;
    const id = bots.at(-1).id;
    this.players.delete(id);
    this._bots?.delete(id);
    this._latest.delete(id);
    if (this.rules) this._hostEvents(this.rules.remove(id));
    if (announce) this._broadcastRoster(false);
    return true;
  }

  _changeSettings(s) {
    if (!this.host || this.phase !== 'lobby') return;
    const mode = PARTY_MODES[s.mode] ? s.mode : 'ffa';
    this.settings = {
      mode,
      map: MAPS[s.map] ? s.map : 'town',
      scoreLimit: PARTY_MODES[mode].limits.includes(s.scoreLimit) ? s.scoreLimit : PARTY_MODES[mode].def,
      timeLimit: s.timeLimit === 600 ? 600 : 300,
      aimAssist: s.aimAssist ?? 'low',
      botLevel: BOT_LEVELS[s.botLevel] ? s.botLevel : 'normal',
    };
    for (const p of this.players.values()) p.ready = !!p.bot;
    this._broadcastRoster();
  }

  _roster() {
    return [...this.players.values()].map(({ id, team, ready, primary, name, bot, lv }) => ({ id, team, ready, primary, name: name ?? '', bot: !!bot, lv: lv ?? 1 }));
  }

  _broadcastRoster(start = true) {
    const m = { type: 'p.roster', players: this._roster(), settings: this.settings, hostId: this.me };
    this.link?.broadcast(m);
    this._applyRoster(m);
    if (start) this._maybeStart();
  }

  _maybeStart() {
    if (!this.host || this.phase !== 'lobby' || this.players.size < 2) return;
    if (![...this.players.values()].every((p) => p.ready)) return;
    if (isTeamMode(this.settings.mode) && new Set([...this.players.values()].map((p) => p.team)).size < 2) return;
    this.rules = new Deathmatch({ mode: this.settings.mode, scoreLimit: this.settings.scoreLimit, timeLimit: this.settings.timeLimit });
    this._cands = spawnCandidates(MAPS[this.settings.map].layout, insideXZ);
    const roster = this._roster();
    const evs = this.rules.start(roster);
    const spawns = {};
    for (const p of roster) spawns[p.id] = this._pickSpawn(p.id, spawns);
    const m = { type: 'p.start', settings: this.settings, players: roster, spawns };
    this.link.broadcast(m);
    this._applyStart(m);
    this._startBots(spawns);
    this._hostEvents(evs);
  }

  _backToRoom() {
    if (!this.host) return;
    this.rules = null;
    const m = { type: 'p.room' };
    this.link?.broadcast(m);
    this._applyRoom();
    for (const p of this.players.values()) p.ready = !!p.bot;
    this._broadcastRoster();
  }

  // --------------------------------------------------------- host: match --
  _hostMessage(id, m) {
    if (!m || typeof m !== 'object') return;
    const p = this.players.get(id);
    switch (m.type) {
      case 'p.ping':
        if (Number.isFinite(m.t)) this.link.send(p.peer, { type: 'p.pong', t: m.t });
        break;
      case 'p.ready':
        if (p && this.phase === 'lobby') {
          p.ready = true;
          p.primary = typeof m.primary === 'string' ? m.primary : 'rifle';
          this._broadcastRoster();
        }
        break;
      case 'p.name':
        if (p) {
          p.name = cleanName(m.name);
          if (Number.isInteger(m.lv) && m.lv > 0 && m.lv < 1000) p.lv = m.lv;
          this._broadcastRoster(false);
        }
        break;
      case 'p.chat':
        this._hostChat(id, m.text, !!m.team);
        break;
      case 'p.team':
        if (p && this.phase === 'lobby' && !p.ready && (m.team === 0 || m.team === 1)) {
          p.team = m.team;
          this._broadcastRoster();
        }
        break;
      case 'p.s': {
        const u = this.phase === 'match' ? unpackState(m.a) : null;
        if (u) {
          const st = { ...u, id }; // the sender's id is the link it came on, not what it claims
          this._latest.set(id, st); // where everyone is (spawn picks)
          this._fresh.set(id, st); // what goes out in the next batch
          this._applyState(st);
        }
        break;
      }
      case 'p.fire':
        if (this.phase === 'match' && Number.isFinite(m.seq) && Number.isFinite(m.t)) {
          this._recordShot(id, m.seq, m.t);
          const out = { type: 'p.fire', id, seq: m.seq, weapon: m.weapon };
          this.link.broadcast(out, p?.peer);
          this._applyFire(out);
        }
        break;
      case 'p.hit':
        if (this.phase === 'match' && m.shooter === id) this._hostHit(m);
        break;
      case 'p.nade':
        if (this.phase === 'match' && this.live && this.alive[id] !== false && typeof m.gid === 'string') {
          this._nades.set(m.gid, id);
          const out = { type: 'p.nade', id, gid: m.gid, o: m.o, v: m.v };
          this.link.broadcast(out, p?.peer);
          this.ctx.peek('grenades')?.spawn({ gid: m.gid, owner: id, origin: m.o, vel: m.v });
        }
        break;
    }
  }

  _recordShot(id, seq, t) {
    let m = this._shots.get(id);
    if (!m) this._shots.set(id, (m = new Map()));
    m.set(seq, { t, prev: this._lastShot.get(id) ?? -Infinity });
    this._lastShot.set(id, t);
    if (m.size > 64) m.delete(m.keys().next().value);
  }

  _hostHit(c) {
    const R = this.rules;
    if (!R || !Number.isInteger(c.target) || !this.players.has(c.target)) return;
    const shot = this._shots.get(c.shooter)?.get(c.seq);
    if (!shot || !R.canHit(c.shooter, c.target)) return;
    const def = this.ctx.peek('weapons')?.states?.get(c.weapon)?.def;
    const physics = this.ctx.peek('physics');
    const res = validateHit({ ...c, t: shot.t }, {
      live: true,
      alive: { [c.shooter]: true, [c.target]: true },
      lastFire: { [c.shooter]: shot.prev },
      cycleTime: () => def?.cycleTime ?? 0.05,
      lineOfSight: (a, b) => physics.lineOfSight(this._v1.fromArray(a), this._v2.fromArray(b)),
    });
    if (!res.ok) return;
    const key = `${c.shooter}:${c.seq}`;
    const n = this._hitCount.get(key) ?? 0;
    if (n >= (def?.pellets ?? 1)) return; // a shotgun shell lands once per pellet
    this._hitCount.set(key, n + 1);
    if (this._hitCount.size > 512) this._hitCount.delete(this._hitCount.keys().next().value);
    this._hostDamage(c.shooter, c.target, Math.min(Number(c.amount) || 0, def?.damage ?? 40), c.part, c.from, c.weapon);
  }

  /** Accepted damage (a player's claim or a bot's shot) -> HP, broadcast, maybe a kill. */
  _hostDamage(shooter, target, base, part, from, weapon) {
    const r = applyDamage(this.hp[target] ?? MAX_HP, base, part);
    this.hp[target] = r.hp;
    const m = { type: 'p.hp', victim: target, attacker: shooter, amount: r.amount, hp: r.hp, headshot: part === 'head', killed: r.killed, from, weapon };
    this.link.broadcast(m);
    this._applyHp(m);
    if (r.killed) this._hostEvents(this.rules.kill(shooter, target).map((e) => (e.type === 'kill' ? { ...e, weapon, headshot: part === 'head' } : e)));
  }

  // ------------------------------------------------------------ host: bots --
  _startBots(spawns) {
    this._bots = new Map();
    const layout = MAPS[this.settings.map].layout;
    // the walk graph is built once per map (a few hundred ms on a tablet)
    this._navs ??= new Map();
    if (!this._navs.has(this.settings.map)) this._navs.set(this.settings.map, buildNav(layout));
    this._grid = this._navs.get(this.settings.map);
    const weapons = this.ctx.peek('weapons');
    for (const p of this.players.values()) {
      if (!p.bot) continue;
      const gun = this.settings.mode === 'gun' ? gunFor(0) : p.primary;
      const b = new Bot({ id: p.id, grid: this._grid, weapon: this._botWeapon(gun), level: this.settings.botLevel });
      const s = spawns[p.id];
      if (s) b.place(s.x, s.z, s.yaw);
      this._bots.set(p.id, b);
    }
  }

  _botWeapon(id) {
    const def = this.ctx.peek('weapons')?.states?.get(id)?.def;
    return { id, damage: def?.damage ?? 30, cycleTime: def?.cycleTime ?? 0.1, pellets: def?.pellets ?? 1 };
  }

  /** King of the hill: living players of each team inside the hill. */
  _inZone() {
    const n = [0, 0];
    for (const p of this.players.values()) {
      if (this.alive[p.id] === false) continue;
      let q = null;
      if (p.id === this.me) q = this.ctx.peek('player')?.position;
      else q = this._bots?.get(p.id) ?? this._latest.get(p.id);
      if (q && Math.hypot(q.x - HILL.x, q.z - HILL.z) <= HILL.r && q.y < HILL.h) n[p.team]++;
    }
    return n;
  }

  /** The hill's ring on the ground: white = free/contested, cyan = ours, orange = theirs. */
  _paintHill(ours) {
    if (!this._hill) return;
    this._hill.material.color.setHex(ours == null ? 0xe8f4f8 : ours ? 0x2fd8ff : 0xff5a36);
  }

  _showHill(on) {
    if (on && !this._hill) {
      const g = new THREE.RingGeometry(HILL.r - 0.18, HILL.r, 64);
      g.rotateX(-Math.PI / 2);
      this._hill = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xe8f4f8, toneMapped: false, transparent: true, opacity: 0.9, depthWrite: false }));
      this._hill.position.set(HILL.x, 0.04, HILL.z);
      this._hill.renderOrder = 2;
      this.ctx.scene.add(this._hill);
    } else if (!on && this._hill) {
      this.ctx.scene.remove(this._hill);
      this._hill.geometry.dispose();
      this._hill.material.dispose();
      this._hill = null;
    }
  }

  _stepBots(dt, raw) {
    if (!this._bots?.size) return;
    const physics = this.ctx.peek('physics');
    const tdm = isTeamMode(this.settings.mode);
    const live = this.rules?.state === 'live';
    const where = (id) => {
      if (id === this.me) {
        const q = this.ctx.peek('player')?.position;
        return q ? { x: q.x, y: q.y, z: q.z } : null;
      }
      const b = this._bots.get(id);
      if (b) return { x: b.x, y: b.y, z: b.z };
      const s = this._latest.get(id);
      return s ? { x: s.x, y: s.y, z: s.z } : null;
    };
    const los = (a, b) => physics.lineOfSight(this._v1.set(a.x, a.y, a.z), this._v2.set(b.x, b.y, b.z));
    for (const [id, bot] of this._bots) {
      bot.alive = this.alive[id] !== false;
      const me = this.players.get(id);
      const enemies = [];
      if (live) {
        for (const p of this.players.values()) {
          if (p.id === id || this.alive[p.id] === false || (tdm && p.team === me?.team)) continue;
          const q = where(p.id);
          if (q) enemies.push({ id: p.id, ...q });
        }
      }
      // small steps: a slow frame must not carry a bot through a wall
      let r = {};
      // king of the hill: with nobody in sight, bots head for the hill
      const goal = this.settings.mode === 'koth' ? { x: HILL.x + ((id * 2.3) % 5) - 2.5, y: 0, z: HILL.z + ((id * 1.7) % 5) - 2.5 } : null;
      if (live) for (let left = dt; left > 1e-6 && !r.fire; left -= 0.1) r = bot.update(Math.min(0.1, left), { enemies, los, goal });
      if (r.fire) {
        this.botShots = (this.botShots ?? 0) + 1;
        const seq = (bot._seq = (bot._seq ?? 0) + 1);
        const out = { type: 'p.fire', id, seq, weapon: bot.weapon.id };
        this.link.broadcast(out);
        this._applyFire(out);
        if (r.fire.hit && this.rules.canHit(id, r.fire.target)) {
          const base = bot.weapon.damage * (bot.weapon.pellets > 1 ? Math.ceil(bot.weapon.pellets * 0.6) : 1);
          this._hostDamage(id, r.fire.target, base, r.fire.head ? 'head' : 'body', r.fire.from, bot.weapon.id);
        }
      }
    }
  }

  _botStates(raw) {
    const out = [];
    for (const [id, b] of this._bots ?? []) {
      out.push({ id, t: raw, x: b.x, y: b.y, z: b.z, yaw: b.yaw, pitch: b.pitch, air: false, crouch: false, w: b.weapon.id, rl: false, alive: this.alive[id] !== false });
    }
    return out;
  }

  /** Rules events -> everyone. Respawns get their spawn point here. */
  _hostEvents(evs) {
    for (const ev of evs) {
      if (ev.type === 'respawn') {
        this.hp[ev.id] = MAX_HP;
        ev.spawn = this._pickSpawn(ev.id);
        this._bots?.get(ev.id)?.place(ev.spawn.x, ev.spawn.z, ev.spawn.yaw);
      }
      const m = { type: 'p.ev', ev };
      this.link?.broadcast(m);
      this._applyEvent(ev);
    }
  }

  /** A spawn far from the living enemies of player `id` (and from spawns already handed out). */
  _pickSpawn(id, taken = {}) {
    const me = this.players.get(id);
    const tdm = isTeamMode(this.settings.mode);
    const enemies = [];
    const pos = (pid) => {
      if (pid === this.me) {
        const p = this.ctx.peek('player')?.position;
        return p ? { x: p.x, z: p.z } : null;
      }
      const b = this._bots?.get(pid);
      if (b) return { x: b.x, z: b.z };
      const s = this._latest.get(pid);
      return s ? { x: s.x, z: s.z } : null;
    };
    for (const p of this.players.values()) {
      if (p.id === id || (tdm && p.team === me?.team)) continue;
      if (taken[p.id]) enemies.push(taken[p.id]);
      else if (this.alive[p.id] !== false && this.phase === 'match') {
        const q = pos(p.id);
        if (q) enemies.push(q);
      }
    }
    // teammates' spawns count too at the start: nobody spawns on anybody
    for (const [pid, s] of Object.entries(taken)) if (!enemies.includes(s) && Number(pid) !== id) enemies.push(s);
    const layout = MAPS[this.settings.map]?.layout;
    const sp0 = layout?.spawns?.[0];
    const axis = sp0 ? { x: sp0.x, z: sp0.z } : { x: 1, z: 0 };
    const side = tdm ? (me?.team === 0 ? 1 : -1) : 0;
    return pickSpawn(this._cands ?? [], enemies, { side, axis });
  }

  // ----------------------------------------------------------- everyone --
  _guestMessage(m) {
    if (!m || typeof m !== 'object') return;
    switch (m.type) {
      case 'p.welcome':
        if (Number.isInteger(m.you)) this.me = m.you;
        this.link?.send({ type: 'p.name', name: loadName(), lv: this._myLv() });
        break;
      case 'p.full':
        this.link?.close();
        this.link = null;
        this._exit(ERRORS['room-full']);
        break;
      case 'p.busy':
        this.link?.close();
        this.link = null;
        this._exit(ERRORS['in-progress']);
        break;
      case 'p.pong':
        if (Number.isFinite(m.t)) {
          const ms = (performance.now() / 1000 - m.t) * 1000;
          if (ms >= 0 && ms < 5000) this.rtt = smoothRtt(this.rtt, ms);
          const touch = this.ctx.peek('ui')?.touch;
          if (touch && this.phase === 'match') touch.ping = this.rtt;
        }
        break;
      case 'p.roster':
        this._applyRoster(m);
        break;
      case 'p.chat':
        this._applyChat(m);
        break;
      case 'p.start':
        this._applyStart(m);
        break;
      case 'p.room':
        this._applyRoom();
        break;
      case 'p.ev':
        if (m.ev) this._applyEvent(m.ev);
        break;
      case 'p.states':
        if (Array.isArray(m.s)) for (const a of m.s) {
          const u = unpackState(a);
          if (u) this._applyState(u);
        }
        break;
      case 'p.fire':
        this._applyFire(m);
        break;
      case 'p.hp':
        this._applyHp(m);
        break;
      case 'p.nade':
        if (this.phase === 'match' && typeof m.gid === 'string') this.ctx.peek('grenades')?.spawn({ gid: m.gid, owner: m.id, origin: m.o, vel: m.v });
        break;
    }
  }

  _applyRoster(m) {
    if (!Array.isArray(m.players)) return;
    if (!this.host) {
      if (Number.isInteger(m.hostId)) this.hostId = m.hostId;
      this.players = new Map(m.players.map((p) => [p.id, { ...p, name: cleanName(p.name) }]));
      if (m.settings) this.settings = m.settings;
    }
    this.ctx.peek('chat')?.setTeam(isTeamMode(this.settings.mode));
    names.clear();
    levels.clear();
    for (const p of this.players.values()) {
      if (p.name) names.set(p.id, p.name);
      if (p.lv && !p.bot) levels.set(p.id, p.lv);
    }
    for (const p of this.players.values()) this.ctx.peek('opponent')?.get(p.id)?.target && (this.ctx.peek('opponent').get(p.id).target.name = playerName(p.id));
    // party players who left disappear from the scene; late joiners appear
    const opp = this.ctx.peek('opponent');
    for (const id of [...(opp?.party.keys() ?? [])]) if (!this.players.has(id)) opp.remove(id);
    if (this.phase === 'match' && opp) {
      const myTeam = this.players.get(this.me)?.team;
      const tdm = isTeamMode(this.settings.mode);
      for (const p of this.players.values()) {
        if (p.id === this.me || opp.get(p.id)) continue;
        opp.add(p.id, { name: playerName(p.id), enemy: !tdm || p.team !== myTeam });
        this.alive[p.id] ??= false;
        this.hp[p.id] ??= MAX_HP;
      }
    }
    if (this.phase === 'lobby') {
      const net = this.host ? '' : this.rtt != null ? `${Math.round(this.rtt)} ms` : '';
      this.ui.showLobby({ offline: this.host && this.offline, offlineWhy: this._offlineWhy, code: this.code, me: this.me, host: this.host, hostId: this.hostId ?? 0, players: [...this.players.values()], settings: this.settings, net });
    }
  }

  _applyStart(m) {
    const ctx = this.ctx;
    this.settings = m.settings ?? this.settings;
    if (!this.host) this.players = new Map(m.players.map((p) => [p.id, { ...p }]));
    this.phase = 'match';
    this.ui.hide();
    this.ui.clearFeed();
    ctx.events.emit('match:start', {});
    ctx.config.aimAssist = this.settings.aimAssist;
    ctx.peek('practice')?.setActive(false);
    ctx.peek('world')?.load?.(this.settings.map);
    this._cands = spawnCandidates(MAPS[this.settings.map].layout, insideXZ);
    const me = this.players.get(this.me);
    if (this.settings.mode === 'gun') ctx.peek('weapons')?.setLoadout(gunFor(0), 'pistol');
    else ctx.peek('weapons')?.setLoadout(me?.primary ?? 'rifle');
    this._showHill(this.settings.mode === 'koth');
    ctx.peek('grenades')?.clear();
    ctx.peek('grenades')?.refill();
    this._holder = undefined;
    this._paintHill(null);
    ctx.peek('weapons')?.refillAll?.();
    const player = ctx.peek('player');
    if (player?.health) player.health.regenEnabled = false;
    const opp = ctx.peek('opponent');
    opp.clearParty();
    const tdm = isTeamMode(this.settings.mode);
    for (const p of this.players.values()) {
      if (p.id === this.me) continue;
      opp.add(p.id, { name: playerName(p.id), enemy: !tdm || p.team !== me?.team });
    }
    this._clocks.clear();
    this._latest.clear();
    this._fresh.clear();
    this._seen.clear();
    this._shots.clear();
    this._lastShot.clear();
    this._hitCount.clear();
    for (const p of this.players.values()) {
      this.hp[p.id] = MAX_HP;
      this.alive[p.id] = true;
    }
    this._scores = {};
    this._teams = [0, 0];
    const sp = m.spawns?.[this.me];
    if (sp) player?.respawnAt(sp.x, sp.z, sp.yaw);
    player?.setControlEnabled?.(false);
    this.live = false;
    if (m.late) {
      // joined a running match: its scores and clock, and wait for our respawn
      this._scores = m.late.scores ?? {};
      this._teams = m.late.teams ?? [0, 0];
      for (const [id, a] of Object.entries(m.late.alive ?? {})) this.alive[id] = a;
      this.alive[this.me] = false;
      if (m.late.timeLeft != null) {
        this.live = true;
        this._roundEndsAt = performance.now() / 1000 + m.late.timeLeft;
      }
      this._deadUntil = performance.now() / 1000 + 0.5;
      ctx.peek('ui')?.banner?.show('Joined the match', '');
    }
    const ui = ctx.peek('ui');
    if (ui?.state) {
      ui.state.mode = { ffa: 'FFA', tdm: 'TDM', koth: 'HILL', gun: 'GUN' }[this.settings.mode] ?? 'FFA';
      ui.state.scoreUs = ui.state.scoreThem = 0;
    }
    if (m.late) this._hud();
  }

  _applyRoom() {
    this._teardownMatch();
    this.phase = 'lobby';
    this.ui.hideBoard();
    for (const p of this.players.values()) p.ready = false;
    this._applyRoster({ players: this._roster(), settings: this.settings });
  }

  _teardownMatch() {
    this.live = false;
    this._bots = null;
    const nades = this.ctx.peek('grenades');
    if (nades) {
      nades.clear();
      nades.enabled = true;
    }
    this._showHill(false);
    this.ctx.peek('opponent')?.clearParty();
    this.ctx.peek('world')?.load?.('grid');
    const player = this.ctx.peek('player');
    if (player?.health) player.health.regenEnabled = true;
    const touch = this.ctx.peek('ui')?.touch;
    if (touch) touch.ping = null;
    const ui = this.ctx.peek('ui');
    if (ui?.state) ui.state.mode = 'TDM';
    this._roundEndsAt = null;
  }

  _applyEvent(ev) {
    const ctx = this.ctx;
    const player = ctx.peek('player');
    const ui = ctx.peek('ui');
    if (ev.type === 'countdown') {
      const M = PARTY_MODES[this.settings.mode];
      const goal = this.settings.mode === 'koth' ? `Hold the hill: first to ${this.settings.scoreLimit} points` : this.settings.mode === 'gun' ? 'A new gun every 2 kills: finish the ladder' : `First to ${this.settings.scoreLimit}`;
      ui?.banner?.show(M?.label ?? 'Party', goal);
    } else if (ev.type === 'live') {
      this.live = true;
      player?.setControlEnabled?.(true);
      this._roundEndsAt = performance.now() / 1000 + (ev.time ?? 300);
      ui?.banner?.show('Fight!', '');
    } else if (ev.type === 'kill') {
      this.alive[ev.victim] = false;
      this._scores = ev.scores ?? this._scores;
      this._teams = ev.teams ?? this._teams;
      this._hud();
      this.ui.feedKill({ killer: ev.killer, victim: ev.victim, weapon: ev.weapon, headshot: ev.headshot, me: this.me });
      if (this.settings.mode === 'gun' && ev.killer !== ev.victim) {
        const k = this._scores[ev.killer]?.[0] ?? 0;
        const gun = gunFor(k);
        if (ev.killer === this.me && gun !== gunFor(k - 1)) {
          ctx.peek('weapons')?.setLoadout(gun, 'pistol');
          ui?.banner?.show(gun.toUpperCase(), 'New gun');
        }
        const bot = this._bots?.get(ev.killer);
        if (bot) bot.weapon = this._botWeapon(gun);
      }
      if (ev.victim === this.me) {
        player?.setControlEnabled?.(false);
        this._deadUntil = performance.now() / 1000 + 3;
        ui?.banner?.show(`Killed by ${playerName(ev.killer)}`, String(ev.weapon ?? '').toUpperCase());
      }
    } else if (ev.type === 'respawn') {
      this.alive[ev.id] = true;
      this.hp[ev.id] = MAX_HP;
      if (ev.id === this.me) {
        this._deadUntil = null;
        this.ui.hideBoard();
        const s = ev.spawn;
        if (s) player?.respawnAt(s.x, s.z, s.yaw);
        if (player?.health) player.health.regenEnabled = false;
        ctx.peek('weapons')?.refillAll?.();
        ctx.peek('grenades')?.refill();
        player?.setControlEnabled?.(true);
      }
    } else if (ev.type === 'zone') {
      this._teams = ev.teams ?? this._teams;
      this._hud();
      if (ev.holder !== this._holder) {
        this._holder = ev.holder;
        const mine = this.players.get(this.me)?.team;
        this._paintHill(ev.holder == null ? null : ev.holder === mine);
        if (ev.holder == null) ui?.banner?.show('Hill contested', '');
        else ui?.banner?.show(ev.holder === mine ? 'Your team holds the hill' : 'The enemy holds the hill', '');
      }
    } else if (ev.type === 'end') {
      this.live = false;
      this.phase = 'results';
      player?.setControlEnabled?.(false);
      this._lastEnd = { standings: ev.standings ?? [], teams: ev.teams ?? [0, 0], mode: this.settings.mode, winner: ev.winner, me: this.me };
      const mine = isTeamMode(this.settings.mode) ? this.players.get(this.me)?.team : this.me;
      ctx.events.emit('match:result', { win: ev.winner != null && ev.winner === mine, mode: this.settings.mode });
      this.ui.showResults({ ...this._lastEnd, host: this.host });
    }
  }

  /** HUD score: FFA = my kills vs the best other; TDM = my team vs theirs. */
  _hud() {
    const ui = this.ctx.peek('ui');
    if (!ui?.state) return;
    if (isTeamMode(this.settings.mode)) {
      const t = this.players.get(this.me)?.team ?? 0;
      ui.state.scoreUs = this._teams[t] ?? 0;
      ui.state.scoreThem = this._teams[1 - t] ?? 0;
    } else {
      const mine = this._scores[this.me]?.[0] ?? 0;
      let best = 0;
      for (const [id, s] of Object.entries(this._scores)) if (Number(id) !== this.me) best = Math.max(best, s[0]);
      ui.state.scoreUs = mine;
      ui.state.scoreThem = best;
    }
  }

  _standings() {
    return [...this.players.values()]
      .map((p) => ({ id: p.id, team: p.team, kills: this._scores?.[p.id]?.[0] ?? 0, deaths: this._scores?.[p.id]?.[1] ?? 0 }))
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.id - b.id);
  }

  _applyState(s) {
    if (!Number.isInteger(s?.id) || s.id === this.me) return;
    this._seen.set(s.id, s);
    const now = this.ctx.time.raw;
    let c = this._clocks.get(s.id);
    if (!c) this._clocks.set(s.id, (c = new ClockSync()));
    const t = Number.isFinite(s.t) ? c.map(s.t, now) : now;
    this.ctx.peek('opponent')?.pushFor(s.id, t, {
      x: s.x, y: s.y, z: s.z, yaw: s.yaw, alive: !!s.alive, air: !!s.air, crouch: !!s.crouch,
      pitch: Number.isFinite(s.pitch) ? s.pitch : 0,
      w: typeof s.w === 'string' ? s.w : 'rifle',
      rl: !!s.rl,
    });
  }

  /** Someone else fired: muzzle flash and gunshot at their gun, along their aim. */
  _applyFire(m) {
    if (m.id === this.me || !this.live) return;
    const r = this.ctx.peek('opponent')?.get(m.id);
    const av = r?.avatar;
    if (!av?.root?.visible) return;
    const e = this._fireEv ?? (this._fireEv = { remote: true, weapon: 'rifle', origin: new THREE.Vector3(), dir: new THREE.Vector3(), seed: 0, flashScale: 0.8 });
    e.weapon = typeof m.weapon === 'string' ? m.weapon : 'rifle';
    av.setWeapon?.(e.weapon);
    av.fire?.();
    if (av.muzzleWorld) av.muzzleWorld(e.origin);
    else e.origin.set(av.position.x, av.position.y + 1.35, av.position.z);
    const yaw = av.root.rotation.y, pitch = r._s?.pitch ?? 0;
    e.dir.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    e.seed = ((m.seq ?? 0) * 2654435761 + m.id) >>> 0;
    this.ctx.events.emit('weapon:fire', e);
  }

  _applyHp(m) {
    const ev = this.ctx.events;
    this.hp[m.victim] = m.hp;
    if (m.victim === this.me) {
      const player = this.ctx.peek('player');
      this._from.fromArray(Array.isArray(m.from) ? m.from : [0, 0, 0]);
      // the host's HP is the truth: a kill always empties the local bar
      const amount = m.killed ? Math.max(Number(m.amount) || 0, player?.health?.value ?? 0) : m.amount;
      ev.emit('damage:dealt', { target: player, amount, headshot: m.headshot, killed: m.killed, from: this._from, confirmed: true });
    } else if (!m.killed && m.attacker === this.me && m.weapon === 'grenade') {
      // my grenade hurt someone: a hit marker (bullets get theirs on the shot)
      const r = this.ctx.peek('opponent')?.get(m.victim);
      if (r) ev.emit('damage:dealt', { target: r.target, amount: m.amount, headshot: false, killed: false, point: r.avatar.position, confirmed: true });
    } else if (m.killed && m.attacker === this.me) {
      const r = this.ctx.peek('opponent')?.get(m.victim);
      if (r) ev.emit('damage:dealt', { target: r.target, amount: m.amount, headshot: m.headshot, killed: true, point: r.avatar.position, confirmed: true });
    }
  }

  // ------------------------------------------------------------- shooting --
  _onLocalFire(e) {
    if (e?.remote || this.phase !== 'match' || !this.live || this.alive[this.me] === false) return;
    const t = this.ctx.time.raw;
    const seq = ++this._seq;
    const weapon = e?.weapon?.id ?? this._weaponId();
    if (this.host) {
      this._recordShot(this.me, seq, t);
      const out = { type: 'p.fire', id: this.me, seq, weapon };
      this.link.broadcast(out);
    } else this._send({ type: 'p.fire', seq, t, weapon });
  }

  _weaponId() {
    return this.ctx.peek('weapons')?.activeId ?? 'rifle';
  }

  /** I threw a grenade: tell the host (the host tells everyone). */
  _onLocalNade(e) {
    if (this.phase !== 'match' || !this.live) return;
    if (this.host) {
      this._nades.set(e.gid, this.me);
      this.link?.broadcast({ type: 'p.nade', id: this.me, gid: e.gid, o: e.origin, v: e.vel });
    } else this._send({ type: 'p.nade', gid: e.gid, o: e.origin, v: e.vel });
  }

  /** Host: a grenade went off (on the host's own simulation): damage everyone in reach. */
  _onBoom(e) {
    if (!this.host || this.phase !== 'match' || !this.rules) return;
    const owner = e.owner === 'me' ? this.me : this._nades.get(e.gid) ?? e.owner;
    this._nades.delete(e.gid);
    if (!Number.isInteger(owner) || !this.players.has(owner)) return;
    const physics = this.ctx.peek('physics');
    const b = e.position;
    for (const p of this.players.values()) {
      if (p.id === owner || this.alive[p.id] === false || !this.rules.canHit(owner, p.id)) continue;
      const q = this._where(p.id);
      if (!q) continue;
      const chest = { x: q.x, y: q.y + 1.0, z: q.z };
      const dmg = grenadeDamage(Math.hypot(chest.x - b.x, chest.y - b.y, chest.z - b.z));
      if (dmg < 1) continue;
      if (!physics.lineOfSight(this._v1.set(b.x, b.y + 0.2, b.z), this._v2.set(chest.x, chest.y, chest.z))) continue;
      this._hostDamage(owner, p.id, dmg, 'body', [b.x, b.y, b.z], 'grenade');
    }
  }

  /** Host: where a player stands (me, a bot, or a guest's newest state). */
  _where(id) {
    if (id === this.me) {
      const q = this.ctx.peek('player')?.position;
      return q ? { x: q.x, y: q.y, z: q.z } : null;
    }
    const b = this._bots?.get(id);
    if (b) return { x: b.x, y: b.y, z: b.z };
    const s = this._latest.get(id);
    return s ? { x: s.x, y: s.y, z: s.z } : null;
  }

  /** Physics says MY bullet hit a party player: claim it, never apply it here. */
  _onLocalHit(e) {
    const id = e?.target?.remoteId;
    if (!e || e.confirmed || !Number.isInteger(id) || this.phase !== 'match') return;
    e.killed = false; // the host decides kills
    if (!this.live) return;
    const eye = this.ctx.peek('player')?.eyePosition;
    const claim = {
      type: 'p.hit',
      seq: this._seq,
      shooter: this.me,
      target: id,
      weapon: this._weaponId(),
      from: eye ? [eye.x, eye.y, eye.z] : [0, 0, 0],
      point: e.point ? [e.point.x, e.point.y, e.point.z] : [0, 0, 0],
      part: e.headshot ? 'head' : 'body',
      amount: e.amount ?? 0,
      t: this.ctx.time.raw,
    };
    if (this.host) this._hostHit(claim);
    else this._send(claim);
  }

  // -------------------------------------------------------------- network --
  /** Guest: to the host. Host (`self`): handle as if it came from player 0. */
  _send(m, self = false) {
    if (this.host) {
      if (self) this._hostMessage(this.me, m);
      return;
    }
    this.link?.send(m);
  }

  _myState(raw) {
    const p = this.ctx.peek('player');
    const pos = p?.position;
    if (!pos) return null;
    return {
      id: this.me,
      t: raw,
      air: p.movement ? !p.movement.grounded : false,
      crouch: p.movement ? p.movement.stance !== 'stand' : false,
      x: pos.x, y: pos.y, z: pos.z,
      yaw: p.movement?.yaw ?? 0,
      pitch: p.movement?.pitch ?? 0,
      w: this._weaponId(),
      rl: !!this.ctx.peek('weapons')?.reloading,
      alive: this.alive[this.me] !== false && !p.dead,
    };
  }

  _heartbeat() {
    const raw = performance.now() / 1000;
    // If THIS device stalled (a map load on a slow phone), nobody could be
    // heard meanwhile: don't count that time as their silence.
    const gap = raw - (this._beatAt ?? raw);
    this._beatAt = raw;
    if (gap > 1) {
      if (this._heard) for (const id of this._heard.keys()) this._heard.set(id, Math.max(this._heard.get(id), raw - 1));
      if (this._lastHeard != null) this._lastHeard = Math.max(this._lastHeard, raw - 1);
    }
    if (!this.link || this.phase === 'connecting') return;
    if (this.host) {
      if (this._rejoinUntil && raw > this._rejoinUntil) {
        this._rejoinUntil = 0;
        for (const p of [...this.players.values()]) {
          if (p.bot || p.peer || p.id === this.me) continue;
          this.players.delete(p.id);
          if (this.rules) this._hostEvents(this.rules.remove(p.id));
        }
        this._broadcastRoster(false);
      }
      for (const [id, t] of this._heard ?? []) {
        const p = this.players.get(id);
        if (!p) this._heard.delete(id);
        else if (raw - t > SILENCE_S) {
          this._heard.delete(id);
          this.link.kick(p.peer);
        }
      }
      return;
    }
    if (raw - (this._lastPing ?? -1) >= PING_S) {
      this._lastPing = raw;
      this.link.send({ type: 'p.ping', t: raw });
    }
    if (raw - this._lastHeard > SILENCE_S) {
      const l = this.link;
      this.link = null;
      l.close();
      this._hostLost();
    }
  }

  update(dt, ctx) {
    this._heartbeat();
    if (this.host && this.link && this.phase === 'lobby') {
      // the host speaks every second in the room too, so guests don't time out
      const raw = performance.now() / 1000;
      if (raw - (this._lastBeat ?? -1) >= PING_S) {
        this._lastBeat = raw;
        this.link.broadcast({ type: 'p.pong', t: -1 });
      }
    }
    if (this.phase !== 'match') return;
    const nades = ctx.peek('grenades');
    if (nades) nades.enabled = this.live && this.alive[this.me] !== false;
    const raw = ctx.time.raw;
    const rawDt = Math.min(0.1, raw - (this._lastRaw ?? raw));
    this._lastRaw = raw;
    // the rules run on the wall clock: a host whose frame rate drops must
    // not stretch everyone's respawn and match timers (game time is clamped
    // per frame)
    const wall = performance.now() / 1000;
    const wallDt = Math.min(1, wall - (this._lastWall ?? wall));
    this._lastWall = wall;
    if (this.host && this.rules) {
      this._hostEvents(this.rules.tick(wallDt, this.settings.mode === 'koth' ? { inZone: this._inZone() } : undefined));
      this._stepBots(wallDt, raw);
    }
    const ui = ctx.peek('ui');
    if (ui?.state && this._roundEndsAt) ui.state.timeLeft = Math.max(0, this._roundEndsAt - wall);
    // dead: the scoreboard, with the respawn countdown
    if (this._deadUntil != null && wall - (this._boardAt ?? -1) > 0.1) {
      this._boardAt = wall;
      const left = Math.max(0, this._deadUntil - wall);
      this.ui.showBoard({ standings: this._standings(), teams: this._teams, mode: this.settings.mode, me: this.me, sub: `Respawn in ${left.toFixed(1)} s` });
    }
    this._stateAcc += rawDt;
    if (this._stateAcc < 1 / STATE_HZ) return;
    this._stateAcc = 0;
    const s = this._myState(raw);
    if (!s) return;
    if (!this.host) {
      this.link?.send({ type: 'p.s', a: packState(s) });
      return;
    }
    // host: one batch per guest with every state that arrived since the last
    // one (each snapshot goes out once), and the host's own
    this._latest.set(this.me, s);
    this._fresh.set(this.me, s);
    for (const b of this._botStates(raw)) {
      this._fresh.set(b.id, b);
      this._applyState(b);
    }
    const fresh = [...this._fresh.values()];
    this._fresh.clear();
    for (const p of this.players.values()) {
      if (!p.peer) continue;
      const out = fresh.filter((x) => x.id !== p.id);
      if (out.length) this.link.send(p.peer, { type: 'p.states', s: out.map(packState) });
    }
  }

  dispose() {
    globalThis.removeEventListener?.('pagehide', this._onPageHide);
    this._offHit?.();
    this._offFire?.();
    this._offNade?.();
    this._offBoom?.();
    this.link?.close();
    this.ui.dispose();
  }
}
