import test from 'node:test';
import assert from 'node:assert/strict';
import { MSG, encode, decode } from '../src/net/protocol.js';
import { makeRoomCode, isRoomCode } from '../src/net/roomcode.js';
import { LoopbackTransport, BroadcastTransport } from '../src/net/transport.js';

test('decode rejects garbage, unknown types and non-objects', () => {
  assert.equal(decode('not json'), null);
  assert.equal(decode('42'), null);
  assert.equal(decode('null'), null);
  assert.equal(decode('{"type":"nope"}'), null);
  assert.equal(decode('{"x":1}'), null);
});

test('encode/decode round-trips every message type', () => {
  for (const type of Object.values(MSG)) {
    const back = decode(encode(type, { a: 1, s: 'x' }));
    assert.deepEqual(back, { type, a: 1, s: 'x' });
  }
});

test('room codes use the unambiguous alphabet', () => {
  for (let i = 0; i < 200; i++) assert.match(makeRoomCode(), /^[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(isRoomCode('k7qp'), true);
  assert.equal(isRoomCode('K0QP'), false);
  assert.equal(isRoomCode('ABC'), false);
});

test('loopback pair delivers both ways in order and close notifies once', async () => {
  const [a, b] = LoopbackTransport.pair();
  const got = { a: [], b: [] };
  a.onMessage((m) => got.a.push(m));
  b.onMessage((m) => got.b.push(m));
  a.send({ n: 1 }); a.send({ n: 2 }); b.send({ n: 3 });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(got.b, [{ n: 1 }, { n: 2 }]);
  assert.deepEqual(got.a, [{ n: 3 }]);
  let closed = 0;
  b.onClose(() => closed++);
  a.close(); a.close();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(closed, 1);
});

test('broadcast guest with no host rejects room-not-found', async () => {
  const t = new BroadcastTransport('ZZZZ', 'guest', { timeout: 200 });
  await assert.rejects(t.connect(), /room-not-found/);
  t.close();
});

test('broadcast host and guest connect and exchange messages', async () => {
  const host = new BroadcastTransport('AB23', 'host', { timeout: 1000 });
  const guest = new BroadcastTransport('AB23', 'guest', { timeout: 1000 });
  const hp = host.connect();
  await guest.connect();
  await hp;
  const got = [];
  host.onMessage((m) => got.push(m));
  guest.send({ hi: 1 });
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(got, [{ hi: 1 }]);
  let closed = false;
  host.onClose(() => (closed = true));
  guest.close();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(closed, true);
  host.close();
});
