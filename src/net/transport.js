/**
 * Transports: one message pipe between the two players.
 *
 *   send(obj)          deliver a plain object to the other side
 *   onMessage(fn)      fn(obj) for every message received
 *   onClose(fn)        fn() once, when the other side leaves or the link drops
 *   close()            leave (the other side's onClose fires)
 *
 * LoopbackTransport: in-memory pair for unit tests.
 * BroadcastTransport: two tabs of the same origin (automated e2e, no internet).
 * PeerTransport (peer.js): WebRTC between two devices — real play.
 */
class Base {
  constructor() {
    this._msg = [];
    this._close = [];
    this.closed = false;
  }
  onMessage(fn) {
    this._msg.push(fn);
  }
  onClose(fn) {
    this._close.push(fn);
  }
  _deliver(obj) {
    if (this.closed) return;
    for (const fn of this._msg) fn(obj);
  }
  _remoteClosed() {
    if (this.closed) return;
    this.closed = true;
    for (const fn of this._close) fn();
  }
}

export class LoopbackTransport extends Base {
  static pair() {
    const a = new LoopbackTransport();
    const b = new LoopbackTransport();
    a._peer = b;
    b._peer = a;
    return [a, b];
  }
  send(obj) {
    if (this.closed) return;
    const copy = structuredClone(obj);
    const peer = this._peer;
    queueMicrotask(() => peer._deliver(copy));
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    const peer = this._peer;
    queueMicrotask(() => peer._remoteClosed());
  }
}

export class BroadcastTransport extends Base {
  /** @param {'host'|'guest'} role */
  constructor(code, role, { timeout = 15000 } = {}) {
    super();
    this.code = code;
    this.role = role;
    this.timeout = timeout;
    this.ch = new BroadcastChannel(`tfps-${code}`);
    this.ch.onmessage = (e) => this._onRaw(e.data);
    this._connected = false;
    this._resolve = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this._resolve = resolve;
      if (this.role === 'guest') {
        const hello = () => this.ch.postMessage({ k: 'hello', from: 'guest' });
        hello();
        this._helloTimer = setInterval(hello, 100);
        this._timer = setTimeout(() => {
          clearInterval(this._helloTimer);
          if (!this._connected) reject(new Error('room-not-found'));
        }, this.timeout);
      }
    });
  }

  _onRaw(m) {
    if (!m || m.from === this.role || this.closed) return;
    if (m.k === 'hello' && this.role === 'host' && !this._connected) {
      this._connected = true;
      this.ch.postMessage({ k: 'welcome', from: 'host' });
      this._resolve?.();
    } else if (m.k === 'welcome' && this.role === 'guest' && !this._connected) {
      this._connected = true;
      clearInterval(this._helloTimer);
      clearTimeout(this._timer);
      this._resolve?.();
    } else if (m.k === 'data' && this._connected) {
      this._deliver(m.p);
    } else if (m.k === 'bye' && this._connected) {
      this._remoteClosed();
      this.ch.close();
    }
  }

  send(obj) {
    if (this.closed || !this._connected) return;
    this.ch.postMessage({ k: 'data', from: this.role, p: obj });
  }

  close() {
    clearInterval(this._helloTimer);
    clearTimeout(this._timer);
    if (this.closed) return;
    this.closed = true;
    try {
      this.ch.postMessage({ k: 'bye', from: this.role });
      this.ch.close();
    } catch {
      /* already closed */
    }
  }
}
