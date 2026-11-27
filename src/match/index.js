/**
 * MatchSystem — menu, lobby and the 1v1 duel.
 *
 * Roles: the room creator is HOST. The host runs RoundsMode, owns both players'
 * HP and validates hit claims; the guest only reports its own shots/hits and
 * state. Both sides run the same `_apply*` handlers for host-originated events,
 * the host simply calls them locally as well as sending them.
 *
 * Hits: a bullet hitting the opponent's avatar on MY screen emits
 * `damage:dealt` (physics). That event is intercepted here (prepended), never
 * applied locally, and turned into a HIT claim tagged with the shot's sequence
 * number. The host accepts at most one hit per shot, validates it
 * (validate.js), applies damage and broadcasts HP. Fire-rate checks use the
 * shooter's own clock (shot timestamps travel with FIRE/HIT).
 *
 * Transport: `?net=bc` uses BroadcastChannel (two tabs, automated tests);
 * otherwise PeerJS WebRTC.
 */
import * as THREE from 'three';
import { MSG } from '../net/protocol.js';
import { makeRoomCode, isRoomCode, normaliseRoomCode } from '../net/roomcode.js';
import { BroadcastTransport } from '../net/transport.js';
import { RoundsMode } from './rounds.js';
import { validateHit, HitLedger } from './validate.js';
import { ClockSync } from './interp.js';
import { applyDamage, MAX_HP } from '../opponent/hitbox.js';
import { Lobby } from '../ui/lobby.js';
import { RoundPick } from '../ui/roundpick.js';
import { DeathRecap } from '../ui/deathrecap.js';
import { killcamAngles } from './killcam.js';
import { Loadout } from '../weapons/loadout.js';
import { MAPS } from '../arena/layout.js';
import { smoothRtt } from '../net/ice.js';

const STATE_HZ = 30;
/** Both sides ping every second; silence this long means the other device is gone. */
const PING_S = 1;
const SILENCE_S = 4;
const ERRORS = {
  'room-not-found': 'Room not found. Check the code and that your friend is still on the lobby screen.',
  'room-taken': 'That room code is in use. Try again.',
  timeout: "Couldn't connect — try again, or switch one device to another network (some Wi-Fi blocks game connections).",
  network: "Couldn't reach the connection service. Check the internet connection.",
};

export class MatchSystem {
  static id = 'match';
  static deps = ['player', 'weapons', 'opponent', 'practice', 'ui', 'physics'];

  async init(ctx) {
    this.ctx = ctx;
    this.net = new URLSearchParams(globalThis.location?.search ?? '').get('net') ?? 'peer';
    this.phase = 'boot'; // boot | menu | practice | connecting | lobby | match | results
    this.transport = null;
    this.role = null;
    this.code = null;
    this.settings = { aimAssist: 'low', winTarget: 5, map: 'grid' };
    this.ready = { host: false, guest: false };
    this.rematch = { host: false, guest: false };
    this.myPrimary = 'rifle';
    this.mode = null;
    this.hp = { host: MAX_HP, guest: MAX_HP };
    this.alive = { host: true, guest: true };
    this.score = { host: 0, guest: 0 };
    this.live = false;
    this._seq = 0;
    this._shots = { host: new Map(), guest: new Map() }; // seq -> {t, prev}
    this._lastShotT = { host: -Infinity, guest: -Infinity };
    this._hits = new HitLedger();
    this._stateAcc = 0;
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._from = new THREE.Vector3();

    this.deathRecap = new DeathRecap(document.getElementById('ui') ?? document.body);
    this._taken = []; // hits I took this round, for the recap
    this._killcam = null;
    // Between rounds: re-pick the primary (applies at once, see RoundPick).
    this.roundPick = new RoundPick(document.getElementById('ui') ?? document.body, Loadout.PRIMARIES, (id) => {
      this.myPrimary = id;
      this.ctx.peek('weapons')?.setLoadout(id);
    });
    this.lobby = new Lobby(document.getElementById('ui') ?? document.body, {
      practice: () => this.startPractice(),
      create: () => this.createRoom(),
      join: (code) => this.joinRoom(code),
      ready: (primary) => this.setReady(primary),
      settings: (s) => this.changeSettings(s),
      rematch: () => this.requestRematch(),
      leave: () => this.leave(),
    });

    this._offHit = ctx.events.prepend('damage:dealt', (e) => this._onLocalHit(e));
    this._offFire = ctx.events.on('weapon:fire', (e) => this._onLocalFire(e));
    // Closing the tab / app: tell the other side right away (best effort).
    this._onPageHide = () => this.transport?.close();
    globalThis.addEventListener?.('pagehide', this._onPageHide);
  }

  get other() {
    return this.role === 'host' ? 'guest' : 'host';
  }

  // ------------------------------------------------------------------ flow --
  showMenu(error = '') {
    this._teardownMatch();
    this.phase = 'menu';
    this.ctx.peek('practice')?.setActive(true);
    this.ctx.peek('player')?.setControlEnabled?.(false);
    this.lobby.showMenu(error);
  }

  startPractice() {
    this.phase = 'practice';
    this.lobby.hide();
    this.ctx.peek('ui')?.loadout?.show();
  }

  async createRoom() {
    this.role = 'host';
    this.code = makeRoomCode();
    this.phase = 'connecting';
    this.lobby.showWaiting(this.code);
    try {
      this.transport = await this._open('host', this.code);
    } catch (err) {
      if (this.phase === 'connecting') this.showMenu(ERRORS[err.message] ?? String(err.message));
      return;
    }
    this._wire();
    this._send(MSG.SETTINGS, this.settings);
    this._enterLobby();
  }

  async joinRoom(raw) {
    const code = normaliseRoomCode(raw);
    if (!isRoomCode(code)) return this.lobby.showJoin('Codes are 4 letters/numbers, like K7QP.');
    this.role = 'guest';
    this.code = code;
    this.phase = 'connecting';
    this.lobby.showBusy(`Joining ${code}…`, 'Connecting to your friend.');
    try {
      this.transport = await this._open('guest', code);
    } catch (err) {
      if (this.phase === 'connecting') this.lobby.showJoin(ERRORS[err.message] ?? String(err.message));
      this.phase = 'menu';
      return;
    }
    this._wire();
    this._send(MSG.HELLO, {});
    this._enterLobby();
  }

  async _open(role, code) {
    if (this.net === 'bc') {
      const t = new BroadcastTransport(code, role, { timeout: role === 'guest' ? 5000 : 30 * 60 * 1000 });
      this._pending = t;
      await t.connect();
      return t;
    }
    const { PeerTransport } = await import('../net/peer.js');
    this._abort = new AbortController();
    const opts = { signal: this._abort.signal };
    return role === 'host' ? PeerTransport.host(code, opts) : PeerTransport.join(code, opts);
  }

  _wire() {
    const t = this.transport;
    this.rtt = null; // ms, smoothed
    this.route = 'unknown';
    // the chosen path settles a moment after the channel opens
    setTimeout(() => t.route?.().then((r) => {
      this.route = r;
      this.lobby.setNet({ route: r, rtt: this.rtt });
    }), 1500);
    // Wall clock, not game time: game time is clamped per frame and would
    // stretch the timeout on a slow device.
    this._lastHeard = performance.now() / 1000;
    t.onMessage((m) => {
      this._lastHeard = performance.now() / 1000;
      this._onMessage(m);
    });
    t.onClose(() => {
      if (this.transport !== t) return;
      this.transport = null;
      this.lobby.toast('Opponent disconnected');
      this.showMenu('Opponent disconnected.');
    });
  }

  _enterLobby() {
    this.phase = 'lobby';
    this.ready = { host: false, guest: false };
    this._renderLobby();
  }

  _renderLobby() {
    if (this.phase !== 'lobby') return;
    this.lobby.showLobby({
      role: this.role,
      code: this.code,
      settings: this.settings,
      myReady: this.ready[this.role],
      oppReady: this.ready[this.other],
      net: { route: this.route, rtt: this.rtt },
    });
  }

  changeSettings(s) {
    if (this.role !== 'host') return;
    this.settings = { aimAssist: s.aimAssist, winTarget: s.winTarget, map: MAPS[s.map] ? s.map : 'grid' };
    this._send(MSG.SETTINGS, this.settings);
    this._renderLobby();
  }

  setReady(primary) {
    this.myPrimary = primary;
    this.ready[this.role] = true;
    this._send(MSG.READY, { primary });
    this._renderLobby();
    this._maybeStart();
  }

  _maybeStart() {
    if (this.role !== 'host' || !this.ready.host || !this.ready.guest) return;
    this._send(MSG.MATCH, { kind: 'start', settings: this.settings });
    this._startMatch();
  }

  requestRematch() {
    this.rematch[this.role] = true;
    this._send(MSG.REMATCH, {});
    this._renderResults();
    if (this.role === 'host' && this.rematch.guest) {
      this._send(MSG.MATCH, { kind: 'start', settings: this.settings });
      this._startMatch();
    }
  }

  leave() {
    this._abort?.abort(); // a host still waiting releases its room code now
    this._abort = null;
    const t = this.transport ?? this._pending;
    this.transport = null;
    this._pending = null;
    t?.close();
    this.showMenu();
  }

  // ----------------------------------------------------------------- match --
  _startMatch() {
    const ctx = this.ctx;
    this.phase = 'match';
    ctx.events.emit('match:start', {}); // kill counters / banners reset
    this.rematch = { host: false, guest: false };
    this.lobby.hide();
    ctx.config.aimAssist = this.settings.aimAssist;
    ctx.peek('practice')?.setActive(false);
    ctx.peek('world')?.load?.(this.settings.map ?? 'grid'); // both sides build the host's pick
    ctx.peek('opponent')?.setVisible(true);
    ctx.peek('weapons')?.setLoadout(this.myPrimary);
    const player = ctx.peek('player');
    if (player?.health) player.health.regenEnabled = false;
    this.score = { host: 0, guest: 0 };
    this._hits.clear();
    this.clock = new ClockSync(); // maps the opponent's STATE timestamps onto our clock
    const ui = ctx.peek('ui');
    if (ui?.state) {
      ui.state.mode = 'DUEL';
      ui.state.scoreUs = ui.state.scoreThem = 0;
    }
    if (this.role === 'host') {
      this.mode = new RoundsMode({ winTarget: this.settings.winTarget, roundTime: MAPS[this.settings.map]?.roundTime ?? 30 });
      this._broadcastRound(this.mode.start());
    }
  }

  _broadcastRound(events) {
    for (const ev of events) {
      const body = { ev, spawns: { host: this.mode.spawnFor('host'), guest: this.mode.spawnFor('guest') } };
      this._send(MSG.ROUND, body);
      this._applyRound(body);
    }
  }

  _applyRound({ ev, spawns }) {
    const ctx = this.ctx;
    const player = ctx.peek('player');
    const ui = ctx.peek('ui');
    this.score = ev.score;
    if (ui?.state) {
      ui.state.scoreUs = ev.score[this.role];
      ui.state.scoreThem = ev.score[this.other];
    }
    if (ev.type === 'countdown') {
      this.deathRecap.hide();
      this._killcam = null;
      this._taken = [];
      this.live = false;
      this.hp = { host: MAX_HP, guest: MAX_HP };
      this.alive = { host: true, guest: true };
      player?.respawn(spawns[this.role]);
      if (player?.health) player.health.regenEnabled = false;
      ctx.peek('weapons')?.refillAll();
      player?.setControlEnabled?.(false);
      ui?.banner?.show(`Round ${ev.round}`, `${ev.score[this.role]} – ${ev.score[this.other]}`);
      this._roundEndsAt = null;
      if (ev.round > 1) this.roundPick.show(this.myPrimary); // still open from the round end
    } else if (ev.type === 'live') {
      this.roundPick.hide();
      this.live = true;
      player?.setControlEnabled?.(true);
      this._roundEndsAt = ctx.time.raw + (ev.time ?? 30);
      ui?.banner?.show('Fight!', '');
    } else if (ev.type === 'roundEnd') {
      this.live = false;
      player?.setControlEnabled?.(false);
      const title = ev.winner === this.role ? 'Round won' : ev.winner ? 'Round lost' : 'Draw';
      ui?.banner?.show(title, `${ev.score[this.role]} – ${ev.score[this.other]}`);
      this.roundPick.show(this.myPrimary);
    } else if (ev.type === 'matchEnd') {
      this.roundPick.hide();
      this.live = false;
      this.phase = 'results';
      this._winner = ev.winner;
      player?.setControlEnabled?.(false);
      this._renderResults();
    }
  }

  _renderResults() {
    if (this.phase !== 'results') return;
    this.lobby.showResults({
      win: this._winner === this.role,
      score: { me: this.score[this.role], them: this.score[this.other] },
      waiting: this.rematch[this.role],
    });
  }

  _teardownMatch() {
    this.roundPick?.hide();
    this.deathRecap?.hide();
    this._killcam = null;
    this.ctx.peek('world')?.load?.('grid'); // practice lives on GRID
    this.live = false;
    this.mode = null;
    this.ctx.peek('opponent')?.setVisible(false);
    const touch = this.ctx.peek('ui')?.touch;
    if (touch) touch.ping = null;
    const player = this.ctx.peek('player');
    if (player?.health) player.health.regenEnabled = true;
    const ui = this.ctx.peek('ui');
    if (ui?.state) ui.state.mode = 'TDM';
  }

  // ------------------------------------------------------------- shooting --
  _onLocalFire(e) {
    if (e?.remote || this.phase !== 'match' || !this.live) return;
    const t = this.ctx.time.raw;
    const seq = ++this._seq;
    this._recordShot(this.role, seq, t);
    // Both sides announce shots: the host books them for hit checks, and the
    // other player hears and sees the opponent's gun go off.
    this._send(MSG.FIRE, { seq, t, weapon: e?.weapon?.id ?? this._weaponId() });
  }

  /** The opponent fired: muzzle flash and gunshot at their gun. */
  _remoteFire(m) {
    const opp = this.ctx.peek('opponent');
    const at = opp?.avatar?.position;
    if (!at || !opp.avatar.root?.visible) return;
    const e = this._remoteFireEvent ?? (this._remoteFireEvent = {
      remote: true, weapon: 'rifle', origin: new THREE.Vector3(), dir: new THREE.Vector3(), seed: 0, flashScale: 0.8,
    });
    e.weapon = typeof m.weapon === 'string' ? m.weapon : 'rifle';
    opp.avatar.setWeapon?.(e.weapon);
    opp.avatar.fire?.(); // the held gun kicks
    if (opp.avatar.muzzleWorld) opp.avatar.muzzleWorld(e.origin);
    else e.origin.set(at.x, at.y + 1.35, at.z);
    const eye = this.ctx.peek('player')?.eyePosition;
    if (eye) e.dir.copy(eye).sub(e.origin).normalize();
    else e.dir.set(0, 0, 1);
    e.seed = (m.seq * 2654435761) >>> 0;
    this.ctx.events.emit('weapon:fire', e);
  }

  _weaponId() {
    return this.ctx.peek('weapons')?.activeId ?? 'rifle';
  }

  _recordShot(who, seq, t) {
    const m = this._shots[who];
    m.set(seq, { t, prev: this._lastShotT[who] });
    this._lastShotT[who] = t;
    if (m.size > 64) m.delete(m.keys().next().value);
  }

  /** Physics says MY bullet hit the opponent: claim it, never apply it here. */
  _onLocalHit(e) {
    const opp = this.ctx.peek('opponent');
    if (!e || e.confirmed || !opp || e.target !== opp.target) return;
    e.killed = false; // the host decides kills
    if (this.phase !== 'match' || !this.live) return;
    const eye = this.ctx.peek('player')?.eyePosition;
    const claim = {
      seq: this._seq,
      t: this._shots[this.role].get(this._seq)?.t ?? this.ctx.time.raw,
      shooter: this.role,
      target: this.other,
      weapon: this._weaponId(),
      from: eye ? [eye.x, eye.y, eye.z] : [0, 0, 0],
      point: e.point ? [e.point.x, e.point.y, e.point.z] : [0, 0, 0],
      part: e.headshot ? 'head' : 'body',
      amount: e.amount ?? 0,
    };
    if (this.role === 'host') this._hostHit(claim);
    else this._send(MSG.HIT, claim);
  }

  _hostHit(c) {
    if (!this.mode) return;
    const shot = this._shots[c.shooter].get(c.seq);
    if (!shot) return; // unknown shot
    const weapons = this.ctx.peek('weapons');
    const def = weapons?.states?.get(c.weapon)?.def;
    const maxHits = def?.pellets ?? 1; // a shotgun shell lands once per pellet
    const physics = this.ctx.peek('physics');
    const res = validateHit({ ...c, t: shot.t }, {
      live: this.live && this.mode.state === 'live',
      alive: this.alive,
      lastFire: { [c.shooter]: shot.prev },
      cycleTime: () => def?.cycleTime ?? 0.05,
      lineOfSight: (a, b) => physics.lineOfSight(this._v1.fromArray(a), this._v2.fromArray(b)),
    });
    if (!res.ok) return;
    if (!this._hits.take(c.shooter, c.seq, maxHits)) return; // shot already used up
    const base = Math.min(Number(c.amount) || 0, def?.damage ?? 40);
    const r = applyDamage(this.hp[c.target], base, c.part);
    this.hp[c.target] = r.hp;
    const body = { victim: c.target, amount: r.amount, headshot: c.part === 'head', killed: r.killed, hp: { ...this.hp }, from: c.from, weapon: c.weapon };
    this._send(MSG.HP, body);
    this._applyHp(body);
    if (r.killed) {
      this.alive[c.target] = false;
      this._broadcastRound(this.mode.kill(c.target));
    }
  }

  /** I died: say how, and swing the view to the killer. */
  _onKilled(m) {
    const player = this.ctx.peek('player');
    const eye = player?.eyePosition;
    const from = Array.isArray(m.from) ? { x: m.from[0], y: m.from[1], z: m.from[2] } : null;
    const distance = eye && from ? Math.hypot(from.x - eye.x, from.y - eye.y, from.z - eye.z) : NaN;
    this.deathRecap.show({
      weapon: typeof m.weapon === 'string' ? m.weapon : '',
      headshot: !!m.headshot,
      distance,
      hits: this._taken,
      oppHp: m.hp?.[this.other],
    });
    const mv = player?.movement;
    this._killcam = mv ? { t: 0, from: { yaw: mv.yaw, pitch: mv.pitch }, fallback: from } : null;
  }

  _stepKillcam(dt) {
    const kc = this._killcam;
    const player = this.ctx.peek('player');
    if (!kc || !player?.movement) return;
    kc.t += dt;
    const av = this.ctx.peek('opponent')?.avatar;
    const p = av?.root?.visible ? av.position : null;
    const target = p ? { x: p.x, y: p.y + (av.headY ?? 1.5) * 0.85, z: p.z } : kc.fallback;
    if (!target) return;
    const a = killcamAngles(player.eyePosition, target, kc.from, kc.t / 0.6);
    player.movement.yaw = a.yaw;
    player.movement.pitch = a.pitch;
  }

  _applyHp(m) {
    this.hp = m.hp;
    const ev = this.ctx.events;
    if (m.victim === this.role) {
      this._taken.push({ amount: Number(m.amount) || 0, headshot: !!m.headshot });
      if (m.killed) this._onKilled(m);
      this._from.fromArray(m.from ?? [0, 0, 0]);
      ev.emit('damage:dealt', { target: this.ctx.peek('player'), amount: m.amount, headshot: m.headshot, killed: m.killed, from: this._from, confirmed: true });
    } else if (m.killed) {
      const opp = this.ctx.peek('opponent');
      ev.emit('damage:dealt', { target: opp.target, amount: m.amount, headshot: m.headshot, killed: true, point: opp.avatar.position, confirmed: true });
    }
  }

  // -------------------------------------------------------------- network --
  _send(type, body) {
    this.transport?.send({ ...body, type });
  }

  _onMessage(m) {
    if (!m || typeof m !== 'object') return;
    switch (m.type) {
      case MSG.PING:
        if (Number.isFinite(m.t)) this._send(MSG.PONG, { t: m.t });
        break;
      case MSG.PONG:
        if (Number.isFinite(m.t)) {
          const ms = (performance.now() / 1000 - m.t) * 1000;
          if (ms >= 0 && ms < 5000) this.rtt = smoothRtt(this.rtt, ms);
          this.lobby.setNet({ route: this.route, rtt: this.rtt });
          const touch = this.ctx.peek('ui')?.touch;
          if (touch) touch.ping = this.rtt;
        }
        break;
      case MSG.HELLO:
        if (this.role === 'host') this._send(MSG.SETTINGS, this.settings);
        break;
      case MSG.SETTINGS:
        if (this.role === 'guest') {
          this.settings = { aimAssist: m.aimAssist, winTarget: m.winTarget, map: MAPS[m.map] ? m.map : 'grid' };
          this._renderLobby();
        }
        break;
      case MSG.READY:
        this.ready[this.other] = true;
        this._renderLobby();
        this._maybeStart();
        break;
      case MSG.MATCH:
        if (this.role === 'guest' && m.kind === 'start') {
          this.settings = m.settings ?? this.settings;
          this._startMatch();
        }
        break;
      case MSG.ROUND:
        if (this.role === 'guest' && m.ev) this._applyRound(m);
        break;
      case MSG.FIRE:
        if (this.role === 'host' && Number.isFinite(m.seq) && Number.isFinite(m.t)) this._recordShot('guest', m.seq, m.t);
        if (this.live) this._remoteFire(m);
        break;
      case MSG.HIT:
        if (this.role === 'host' && m.shooter === 'guest' && m.target === 'host') this._hostHit(m);
        break;
      case MSG.HP:
        if (this.role === 'guest') this._applyHp(m);
        break;
      case MSG.STATE: {
        const now = this.ctx.time.raw;
        // Sender timestamps keep 30 Hz snapshots evenly spaced even when Wi-Fi
        // delivers them in bursts (receive time would collapse a burst to one).
        const t = this.clock && Number.isFinite(m.t) ? this.clock.map(m.t, now) : now;
        this.ctx.peek('opponent')?.push(t, {
          x: m.x, y: m.y, z: m.z, yaw: m.yaw, alive: !!m.alive, air: !!m.air, crouch: !!m.crouch,
          pitch: Number.isFinite(m.pitch) ? m.pitch : 0,
          w: typeof m.w === 'string' ? m.w : 'rifle',
          rl: !!m.rl,
        });
        break;
      }
      case MSG.REMATCH:
        this.rematch[this.other] = true;
        if (this.role === 'host' && this.rematch.host) {
          this._send(MSG.MATCH, { kind: 'start', settings: this.settings });
          this._startMatch();
        }
        break;
      case MSG.BYE:
        this.transport?.close();
        break;
    }
  }

  // ------------------------------------------------------------------ frame --
  /** Heartbeat in every connected phase; a silent peer counts as disconnected. */
  _heartbeat(ctx) {
    const t = this.transport;
    if (!t) return;
    const raw = performance.now() / 1000;
    if (raw - (this._lastPing ?? -1) >= PING_S) {
      this._lastPing = raw;
      this._send(MSG.PING, { t: raw });
    }
    if (raw - this._lastHeard > SILENCE_S) {
      this.transport = null;
      t.close();
      this.lobby.toast('Opponent disconnected');
      this.showMenu('Opponent disconnected.');
    }
  }

  update(dt, ctx) {
    this._heartbeat(ctx);
    if (this.phase === 'boot') {
      // first frame: other systems are up; the deterministic capture path skips menus
      if (ctx.config.deterministic) this.phase = 'practice';
      else this.showMenu();
      return;
    }
    if (this.phase !== 'match') return;
    this._stepKillcam(ctx.time.dt || dt);
    const raw = ctx.time.raw;
    const rawDt = Math.min(0.1, raw - (this._lastRaw ?? raw));
    this._lastRaw = raw;

    if (this.role === 'host' && this.mode) this._broadcastRound(this.mode.tick(rawDt, this.hp));

    const ui = ctx.peek('ui');
    if (ui?.state && this._roundEndsAt) ui.state.timeLeft = Math.max(0, this._roundEndsAt - raw);

    this._stateAcc += rawDt;
    if (this._stateAcc >= 1 / STATE_HZ) {
      this._stateAcc = 0;
      const p = ctx.peek('player');
      const pos = p?.position;
      if (pos) {
        this._send(MSG.STATE, {
          t: raw,
          air: p.movement ? !p.movement.grounded : false,
          crouch: p.movement ? p.movement.stance !== 'stand' : false,
          x: pos.x, y: pos.y, z: pos.z,
          yaw: p.movement?.yaw ?? 0,
          pitch: p.movement?.pitch ?? 0,
          w: this._weaponId(),
          rl: !!this.ctx.peek('weapons')?.reloading,
          alive: this.alive[this.role] && !p.dead,
        });
      }
    }
  }

  dispose() {
    globalThis.removeEventListener?.('pagehide', this._onPageHide);
    this._offHit?.();
    this._offFire?.();
    this.transport?.close();
    this.lobby.dispose();
    this.roundPick.dispose();
    this.deathRecap.dispose();
  }
}
