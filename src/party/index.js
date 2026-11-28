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
import { openPartyHost, openPartyGuest } from '../net/party.js';
import { makeRoomCode } from '../net/roomcode.js';
import { smoothRtt } from '../net/ice.js';
import { validateHit } from '../match/validate.js';
import { ClockSync } from '../match/interp.js';
import { applyDamage, MAX_HP } from '../opponent/hitbox.js';
import { Deathmatch, PARTY_MODES, spawnCandidates, pickSpawn } from './rules.js';
import { Bot, buildGrid } from './bots.js';
import { insideXZ } from '../arena/shapes.js';
import { MAPS } from '../arena/layout.js';
import { PartyUI, playerName, names, cleanName } from '../ui/party.js';

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
    this.settings = { mode: 'ffa', map: 'town', scoreLimit: PARTY_MODES.ffa.def, timeLimit: 300, aimAssist: 'low' };
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
      name: (n) => {
        saveName(n);
        this._send({ type: 'p.name', name: n }, true);
      },
      again: () => this._backToRoom(),
      leave: () => this.leave(),
    });
    this._offHit = ctx.events.prepend('damage:dealt', (e) => this._onLocalHit(e));
    this._offFire = ctx.events.on('weapon:fire', (e) => this._onLocalFire(e));
    this._onPageHide = () => this.link?.close();
    globalThis.addEventListener?.('pagehide', this._onPageHide);
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
    } catch (err) {
      if (this.phase === 'connecting') this._exit(ERRORS[err.message] ?? String(err.message));
      return;
    }
    const hub = this.link;
    this._heard = new Map();
    hub.onJoin((peer) => this._hostJoin(peer));
    hub.onLeave((peer) => this._hostLeave(peer));
    hub.onMessage((peer, m) => {
      const id = this._idOf(peer);
      if (id == null) return;
      this._heard.set(id, performance.now() / 1000);
      this._hostMessage(id, m);
    });
    this.players.set(0, { id: 0, team: 0, ready: false, primary: 'rifle', name: loadName() });
    this.phase = 'lobby';
    this._broadcastRoster();
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
    const link = this.link;
    this._lastHeard = performance.now() / 1000;
    link.onMessage((m) => {
      this._lastHeard = performance.now() / 1000;
      this._guestMessage(m);
    });
    link.onClose(() => {
      if (this.link !== link) return;
      this.link = null;
      this._exit('The host left the party.');
    });
    setTimeout(() => link.route?.().then((r) => { this.route = r; }), 1500);
    this.phase = 'lobby';
  }

  leave() {
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

  /** Back to the main menu (with a message). */
  _exit(msg = '') {
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

  _hostJoin(peer) {
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
    };
    for (const p of this.players.values()) p.ready = !!p.bot;
    this._broadcastRoster();
  }

  _roster() {
    return [...this.players.values()].map(({ id, team, ready, primary, name, bot }) => ({ id, team, ready, primary, name: name ?? '', bot: !!bot }));
  }

  _broadcastRoster(start = true) {
    const m = { type: 'p.roster', players: this._roster(), settings: this.settings };
    this.link?.broadcast(m);
    this._applyRoster(m);
    if (start) this._maybeStart();
  }

  _maybeStart() {
    if (!this.host || this.phase !== 'lobby' || this.players.size < 2) return;
    if (![...this.players.values()].every((p) => p.ready)) return;
    if (this.settings.mode === 'tdm' && new Set([...this.players.values()].map((p) => p.team)).size < 2) return;
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
          this._broadcastRoster(false);
        }
        break;
      case 'p.team':
        if (p && this.phase === 'lobby' && !p.ready && (m.team === 0 || m.team === 1)) {
          p.team = m.team;
          this._broadcastRoster();
        }
        break;
      case 'p.state':
        if (this.phase === 'match') {
          const st = { ...m, id, type: undefined };
          this._latest.set(id, st); // where everyone is (spawn picks)
          this._fresh.set(id, st); // what goes out in the next batch
          this._applyState(st);
        }
        break;
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
    this._grid = buildGrid(layout);
    const weapons = this.ctx.peek('weapons');
    for (const p of this.players.values()) {
      if (!p.bot) continue;
      const def = weapons?.states?.get(p.primary)?.def;
      const b = new Bot({ id: p.id, grid: this._grid, weapon: { id: p.primary, damage: def?.damage ?? 30, cycleTime: def?.cycleTime ?? 0.1, pellets: def?.pellets ?? 1 } });
      const s = spawns[p.id];
      if (s) b.place(s.x, s.z, s.yaw);
      this._bots.set(p.id, b);
    }
  }

  _stepBots(dt, raw) {
    if (!this._bots?.size) return;
    const physics = this.ctx.peek('physics');
    const tdm = this.settings.mode === 'tdm';
    const live = this.rules?.state === 'live';
    const where = (id) => {
      if (id === this.me) {
        const q = this.ctx.peek('player')?.position;
        return q ? { x: q.x, y: q.y, z: q.z } : null;
      }
      const b = this._bots.get(id);
      if (b) return { x: b.x, y: 0, z: b.z };
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
      if (live) for (let left = dt; left > 1e-6 && !r.fire; left -= 0.1) r = bot.update(Math.min(0.1, left), { enemies, los });
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
      out.push({ id, t: raw, x: b.x, y: 0, z: b.z, yaw: b.yaw, pitch: b.pitch, air: false, crouch: false, w: b.weapon.id, rl: false, alive: this.alive[id] !== false });
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
    const tdm = this.settings.mode === 'tdm';
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
        if (loadName()) this.link?.send({ type: 'p.name', name: loadName() });
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
        if (Array.isArray(m.s)) for (const s of m.s) this._applyState(s);
        break;
      case 'p.fire':
        this._applyFire(m);
        break;
      case 'p.hp':
        this._applyHp(m);
        break;
    }
  }

  _applyRoster(m) {
    if (!Array.isArray(m.players)) return;
    if (!this.host) {
      this.players = new Map(m.players.map((p) => [p.id, { ...p, name: cleanName(p.name) }]));
      if (m.settings) this.settings = m.settings;
    }
    names.clear();
    for (const p of this.players.values()) if (p.name) names.set(p.id, p.name);
    for (const p of this.players.values()) this.ctx.peek('opponent')?.get(p.id)?.target && (this.ctx.peek('opponent').get(p.id).target.name = playerName(p.id));
    // party players who left disappear from the scene; late joiners appear
    const opp = this.ctx.peek('opponent');
    for (const id of [...(opp?.party.keys() ?? [])]) if (!this.players.has(id)) opp.remove(id);
    if (this.phase === 'match' && opp) {
      const myTeam = this.players.get(this.me)?.team;
      const tdm = this.settings.mode === 'tdm';
      for (const p of this.players.values()) {
        if (p.id === this.me || opp.get(p.id)) continue;
        opp.add(p.id, { name: playerName(p.id), enemy: !tdm || p.team !== myTeam });
        this.alive[p.id] ??= false;
        this.hp[p.id] ??= MAX_HP;
      }
    }
    if (this.phase === 'lobby') {
      const net = this.host ? '' : this.rtt != null ? `${Math.round(this.rtt)} ms` : '';
      this.ui.showLobby({ code: this.code, me: this.me, host: this.host, players: [...this.players.values()], settings: this.settings, net });
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
    ctx.peek('weapons')?.setLoadout(me?.primary ?? 'rifle');
    ctx.peek('weapons')?.refillAll?.();
    const player = ctx.peek('player');
    if (player?.health) player.health.regenEnabled = false;
    const opp = ctx.peek('opponent');
    opp.clearParty();
    const tdm = this.settings.mode === 'tdm';
    for (const p of this.players.values()) {
      if (p.id === this.me) continue;
      opp.add(p.id, { name: playerName(p.id), enemy: !tdm || p.team !== me?.team });
    }
    this._clocks.clear();
    this._latest.clear();
    this._fresh.clear();
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
      ui.state.mode = tdm ? 'TDM' : 'FFA';
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
      ui?.banner?.show(this.settings.mode === 'tdm' ? 'Team deathmatch' : 'Free for all', `First to ${this.settings.scoreLimit}`);
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
        player?.setControlEnabled?.(true);
      }
    } else if (ev.type === 'end') {
      this.live = false;
      this.phase = 'results';
      player?.setControlEnabled?.(false);
      this.ui.showResults({ standings: ev.standings ?? [], teams: ev.teams ?? [0, 0], mode: this.settings.mode, winner: ev.winner, me: this.me, host: this.host });
    }
  }

  /** HUD score: FFA = my kills vs the best other; TDM = my team vs theirs. */
  _hud() {
    const ui = this.ctx.peek('ui');
    if (!ui?.state) return;
    if (this.settings.mode === 'tdm') {
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
      this._recordShot(0, seq, t);
      const out = { type: 'p.fire', id: 0, seq, weapon };
      this.link.broadcast(out);
    } else this._send({ type: 'p.fire', seq, t, weapon });
  }

  _weaponId() {
    return this.ctx.peek('weapons')?.activeId ?? 'rifle';
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
      if (self) this._hostMessage(0, m);
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
      this._exit('Lost the connection to the host.');
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
      this._hostEvents(this.rules.tick(wallDt));
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
      this.link?.send({ ...s, type: 'p.state' });
      return;
    }
    // host: one batch per guest with every state that arrived since the last
    // one (each snapshot goes out once), and the host's own
    this._latest.set(0, s);
    this._fresh.set(0, s);
    for (const b of this._botStates(raw)) {
      this._fresh.set(b.id, b);
      this._applyState(b);
    }
    const fresh = [...this._fresh.values()];
    this._fresh.clear();
    for (const p of this.players.values()) {
      if (!p.peer) continue;
      const out = fresh.filter((x) => x.id !== p.id);
      if (out.length) this.link.send(p.peer, { type: 'p.states', s: out });
    }
  }

  dispose() {
    globalThis.removeEventListener?.('pagehide', this._onPageHide);
    this._offHit?.();
    this._offFire?.();
    this.link?.close();
    this.ui.dispose();
  }
}
