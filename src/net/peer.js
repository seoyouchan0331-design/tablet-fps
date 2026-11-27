/**
 * PeerTransport — WebRTC data channel between two devices, via the public
 * PeerJS broker for the handshake only. On the same Wi-Fi the data then flows
 * directly between the iPads.
 *
 * The host registers the id `tfps-<CODE>` and waits for one guest; the guest
 * connects to that id. peerjs is imported dynamically so practice mode never
 * downloads it.
 *
 * Errors (thrown from host()/join()):
 *   room-not-found  the code has no host (PeerJS `peer-unavailable`)
 *   room-taken      someone already hosts this code (`unavailable-id`)
 *   timeout         nothing happened within `timeout` ms (often a Wi-Fi that
 *                   blocks device-to-device traffic)
 *   network         the broker could not be reached
 */
const PREFIX = 'tfps-';

class PeerTransport {
  constructor(peer, conn) {
    this.peer = peer;
    this.conn = conn;
    this._msg = [];
    this._close = [];
    this.closed = false;
    conn.on('data', (d) => {
      if (!this.closed) for (const fn of this._msg) fn(d);
    });
    const gone = () => this._remoteClosed();
    conn.on('close', gone);
    conn.on('error', gone);
    peer.on('disconnected', () => {
      /* broker link lost: the data channel may still be alive; keep going */
    });
    // ICE failure surfaces as the underlying RTCPeerConnection going 'failed'.
    const pc = conn.peerConnection;
    if (pc) {
      pc.addEventListener?.('connectionstatechange', () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') gone();
      });
    }
  }

  static async _peer(id) {
    const { Peer } = await import('peerjs');
    return new Peer(id, { debug: 0 });
  }

  /** Register as host of `code` and resolve once a guest's channel is open. */
  static async host(code, { timeout = 10 * 60 * 1000 } = {}) {
    const peer = await PeerTransport._peer(PREFIX + code);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error('timeout')), timeout);
      const fail = (err) => {
        clearTimeout(timer);
        peer.destroy();
        reject(err);
      };
      peer.on('error', (e) => fail(new Error(e?.type === 'unavailable-id' ? 'room-taken' : 'network')));
      peer.on('connection', (conn) => {
        conn.on('open', () => {
          clearTimeout(timer);
          resolve(new PeerTransport(peer, conn));
        });
      });
    });
  }

  /** Connect to the host of `code`. */
  static async join(code, { timeout = 15000 } = {}) {
    const peer = await PeerTransport._peer(undefined);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error('timeout')), timeout);
      const fail = (err) => {
        clearTimeout(timer);
        peer.destroy();
        reject(err);
      };
      peer.on('error', (e) => fail(new Error(e?.type === 'peer-unavailable' ? 'room-not-found' : 'network')));
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        conn.on('open', () => {
          clearTimeout(timer);
          resolve(new PeerTransport(peer, conn));
        });
      });
    });
  }

  onMessage(fn) {
    this._msg.push(fn);
  }

  onClose(fn) {
    this._close.push(fn);
  }

  send(obj) {
    if (!this.closed && this.conn.open) this.conn.send(obj);
  }

  _remoteClosed() {
    if (this.closed) return;
    this.closed = true;
    for (const fn of this._close) fn();
    this.peer.destroy();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.conn.close();
    } finally {
      this.peer.destroy();
    }
  }
}

export { PeerTransport };
