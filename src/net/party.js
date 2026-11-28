/**
 * Party transports: one host, up to 7 guests, in a star. Guests only talk to
 * the host; the host relays what the others need.
 *
 * Host side (`openPartyHost`):
 *   onJoin(fn(peer))          a guest connected (peer: opaque string id)
 *   onMessage(fn(peer, msg))  a guest sent msg
 *   onLeave(fn(peer))         a guest left or its link dropped
 *   send(peer, msg)           to one guest
 *   broadcast(msg, except?)   to every guest (but `except`)
 *   kick(peer)                drop one guest
 *   close()
 * Guest side (`openPartyGuest`): send(msg) / onMessage(fn) / onClose(fn) /
 * close() / route(), like the duel transports.
 *
 * Two kinds: 'bc' (BroadcastChannel: tabs of one browser, automated tests) and
 * 'peer' (PeerJS WebRTC: real devices). Party rooms use their own broker
 * prefix, so a duel code and a party code never collide.
 */
import { iceServers, buildIceConfig, routeFromStats } from './ice.js';

const PREFIX = 'tfpp-';
/** The broker id / channel of a room: a new host after a migration opens generation 1, 2, ... */
const roomId = (code, gen = 0) => PREFIX + code + (gen ? `-g${gen}` : '');
export const MAX_GUESTS = 7;

class Hub {
  constructor() {
    this._join = [];
    this._msg = [];
    this._leave = [];
    this.closed = false;
  }
  onJoin(fn) { this._join.push(fn); }
  onMessage(fn) { this._msg.push(fn); }
  onLeave(fn) { this._leave.push(fn); }
  _joined(p) { if (!this.closed) for (const fn of this._join) fn(p); }
  _got(p, m) { if (!this.closed) for (const fn of this._msg) fn(p, m); }
  _left(p) { if (!this.closed) for (const fn of this._leave) fn(p); }
}

class Link {
  constructor() {
    this._msg = [];
    this._close = [];
    this._early = []; // what arrived before anyone listened (the host's welcome)
    this.closed = false;
  }
  onMessage(fn) {
    this._msg.push(fn);
    const q = this._early;
    this._early = [];
    for (const m of q) fn(m);
  }
  onClose(fn) { this._close.push(fn); }
  _got(m) {
    if (this.closed || m?.type === '_full') return;
    if (!this._msg.length) this._early.push(m);
    else for (const fn of this._msg) fn(m);
  }
  _remoteClosed() {
    if (this.closed) return;
    this.closed = true;
    for (const fn of this._close) fn();
  }
}

/* ------------------------------------------------------- BroadcastChannel -- */

const rid = () => Math.random().toString(36).slice(2, 10);

class BcHost extends Hub {
  constructor(code, gen = 0) {
    super();
    this.ch = new BroadcastChannel(roomId(code, gen));
    this.peers = new Set();
    this.ch.onmessage = (e) => {
      const m = e.data;
      if (!m || m.to !== 'host' || this.closed) return;
      if (m.k === 'hello' && !this.peers.has(m.from)) {
        if (this.peers.size >= MAX_GUESTS) return this.ch.postMessage({ k: 'full', to: m.from });
        this.peers.add(m.from);
        this.ch.postMessage({ k: 'welcome', to: m.from });
        this._joined(m.from);
      } else if (m.k === 'data' && this.peers.has(m.from)) this._got(m.from, m.p);
      else if (m.k === 'bye' && this.peers.delete(m.from)) this._left(m.from);
    };
  }
  async ready() {}
  send(peer, msg) { if (!this.closed && this.peers.has(peer)) this.ch.postMessage({ k: 'data', to: peer, p: msg }); }
  broadcast(msg, except) { for (const p of this.peers) if (p !== except) this.send(p, msg); }
  kick(peer) {
    if (!this.peers.delete(peer)) return;
    this.ch.postMessage({ k: 'bye', to: peer });
    this._left(peer);
  }
  close() {
    if (this.closed) return;
    for (const p of this.peers) this.ch.postMessage({ k: 'bye', to: p });
    this.closed = true;
    this.ch.close();
  }
}

class BcGuest extends Link {
  constructor(code, gen = 0) {
    super();
    this.id = rid();
    this.ch = new BroadcastChannel(roomId(code, gen));
  }
  connect(timeout) {
    return new Promise((resolve, reject) => {
      const hello = () => this.ch.postMessage({ k: 'hello', from: this.id, to: 'host' });
      const iv = setInterval(hello, 100);
      const t = setTimeout(() => { clearInterval(iv); reject(new Error('room-not-found')); }, timeout);
      hello();
      this.ch.onmessage = (e) => {
        const m = e.data;
        if (!m || m.to !== this.id || this.closed) return;
        if (m.k === 'welcome') { clearInterval(iv); clearTimeout(t); resolve(this); }
        else if (m.k === 'full') { clearInterval(iv); clearTimeout(t); reject(new Error('room-full')); }
        else if (m.k === 'data') this._got(m.p);
        else if (m.k === 'bye') { this._remoteClosed(); this.ch.close(); }
      };
    });
  }
  send(msg) { if (!this.closed) this.ch.postMessage({ k: 'data', from: this.id, to: 'host', p: msg }); }
  async route() { return 'direct'; }
  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.ch.postMessage({ k: 'bye', from: this.id, to: 'host' }); this.ch.close(); } catch { /* closed */ }
  }
}

/* ---------------------------------------------------------------- PeerJS -- */

async function makePeer(id) {
  const [{ Peer }, servers] = await Promise.all([import('peerjs'), iceServers(buildIceConfig())]);
  return new Peer(id, servers ? { debug: 0, config: { iceServers: servers } } : { debug: 0 });
}

class PeerHost extends Hub {
  constructor(peer) {
    super();
    this.peer = peer;
    this.conns = new Map(); // peer id -> DataConnection
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        if (this.closed) return conn.close();
        if (this.conns.size >= MAX_GUESTS) {
          conn.send({ type: '_full' });
          setTimeout(() => conn.close(), 300);
          return;
        }
        const id = conn.peer;
        this.conns.set(id, conn);
        const gone = () => {
          if (this.conns.get(id) !== conn) return;
          this.conns.delete(id);
          this._left(id);
        };
        conn.on('data', (d) => this._got(id, d));
        conn.on('close', gone);
        conn.on('error', gone);
        conn.peerConnection?.addEventListener?.('connectionstatechange', () => {
          const s = conn.peerConnection.connectionState;
          if (s === 'failed' || s === 'closed') gone();
        });
        this._joined(id);
      });
    });
  }
  send(peer, msg) {
    const c = this.conns.get(peer);
    if (!this.closed && c?.open) c.send(msg);
  }
  broadcast(msg, except) { for (const p of this.conns.keys()) if (p !== except) this.send(p, msg); }
  kick(peer) {
    const c = this.conns.get(peer);
    if (!c) return;
    this.conns.delete(peer);
    c.close();
    this._left(peer);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const c of this.conns.values()) try { c.close(); } catch { /* gone */ }
    this.peer.destroy();
  }
}

class PeerGuest extends Link {
  constructor(peer, conn) {
    super();
    this.peer = peer;
    this.conn = conn;
    conn.on('data', (d) => this._got(d));
    const gone = () => { this._remoteClosed(); this.peer.destroy(); };
    conn.on('close', gone);
    conn.on('error', gone);
    conn.peerConnection?.addEventListener?.('connectionstatechange', () => {
      const s = conn.peerConnection.connectionState;
      if (s === 'failed' || s === 'closed') gone();
    });
  }
  send(msg) { if (!this.closed && this.conn.open) this.conn.send(msg); }
  async route() {
    try { return routeFromStats(await this.conn.peerConnection.getStats()); } catch { return 'unknown'; }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.conn.close(); } finally { this.peer.destroy(); }
  }
}

/* --------------------------------------------------------------- offline -- */

/** A room nobody can join: playing against bots needs no network at all. */
export class OfflineHub extends Hub {
  constructor() {
    super();
    this.offline = true;
  }
  send() {}
  broadcast() {}
  kick() {}
  close() { this.closed = true; }
}

/* --------------------------------------------------------------- factory -- */

/** Host a party room. Errors: room-taken, network. */
export async function openPartyHost(kind, code, { signal, gen = 0 } = {}) {
  if (kind === 'bc') return new BcHost(code, gen);
  const peer = await makePeer(roomId(code, gen));
  return new Promise((resolve, reject) => {
    const fail = (err) => { peer.destroy(); reject(err); };
    signal?.addEventListener('abort', () => fail(new Error('cancelled')), { once: true });
    peer.on('error', (e) => {
      if (e?.type === 'peer-unavailable') return; // a guest that vanished: not our failure
      const err = new Error(e?.type === 'unavailable-id' ? 'room-taken' : 'network');
      err.detail = e?.type ?? String(e?.message ?? e); // which PeerJS error: for the message on screen
      fail(err);
    });
    peer.on('open', () => resolve(new PeerHost(peer)));
  });
}

/** Join a party room. Errors: room-not-found, room-full, timeout, network. */
export async function openPartyGuest(kind, code, { timeout = 15000, signal, gen = 0 } = {}) {
  if (kind === 'bc') return new BcGuest(code, gen).connect(Math.min(timeout, 5000));
  const peer = await makePeer(undefined);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => fail(new Error('timeout')), timeout);
    const fail = (err) => { clearTimeout(timer); peer.destroy(); reject(err); };
    signal?.addEventListener('abort', () => fail(new Error('cancelled')), { once: true });
    peer.on('error', (e) => fail(new Error(e?.type === 'peer-unavailable' ? 'room-not-found' : 'network')));
    peer.on('open', () => {
      const conn = peer.connect(roomId(code, gen), { reliable: true, serialization: 'json' });
      const guest = new PeerGuest(peer, conn); // keeps what arrives until the caller listens
      conn.on('data', (d) => { if (d?.type === '_full') fail(new Error('room-full')); });
      conn.on('open', () => {
        // the host answers a full room within a moment: wait for it before succeeding
        setTimeout(() => {
          if (!conn.open || guest.closed) return;
          clearTimeout(timer);
          resolve(guest);
        }, 350);
      });
    });
  });
}
