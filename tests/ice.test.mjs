import test from 'node:test';
import assert from 'node:assert/strict';
import { iceServers, routeFromStats, smoothRtt } from '../src/net/ice.js';
import { MSG, decode } from '../src/net/protocol.js';

test('no relay configured: null (PeerJS keeps its own STUN + TURN defaults)', async () => {
  assert.equal(await iceServers({}), null);
});

test('Metered relay: fetches credentials and puts STUN first', async () => {
  let asked = '';
  const fetchFn = async (url) => { asked = url; return { ok: true, json: async () => [{ urls: 'turn:a.relay.metered.ca:80', username: 'u', credential: 'c' }] }; };
  const s = await iceServers({ meteredApp: 'myapp', meteredKey: 'k123', fetchFn });
  assert.equal(asked, 'https://myapp.metered.live/api/v1/turn/credentials?apiKey=k123');
  assert.equal(s[0].urls, 'stun:stun.l.google.com:19302');
  assert.equal(s[1].urls, 'turn:a.relay.metered.ca:80');
});

test('relay fetch failing or hanging falls back to the defaults', async () => {
  assert.equal(await iceServers({ meteredApp: 'a', meteredKey: 'b', fetchFn: async () => { throw new Error('offline'); } }), null);
  assert.equal(await iceServers({ meteredApp: 'a', meteredKey: 'b', fetchFn: async () => ({ ok: false }) }), null);
  const slow = () => new Promise(() => {});
  assert.equal(await iceServers({ meteredApp: 'a', meteredKey: 'b', fetchFn: slow, timeoutMs: 30 }), null);
});

test('route: relay when either side of the chosen pair is a TURN candidate', () => {
  const stats = (lt, rt) => new Map([
    ['p', { type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'l', remoteCandidateId: 'r' }],
    ['l', { type: 'local-candidate', id: 'l', candidateType: lt }],
    ['r', { type: 'remote-candidate', id: 'r', candidateType: rt }],
  ]);
  assert.equal(routeFromStats(stats('host', 'host')), 'direct');
  assert.equal(routeFromStats(stats('srflx', 'prflx')), 'direct');
  assert.equal(routeFromStats(stats('relay', 'srflx')), 'relay');
  assert.equal(routeFromStats(new Map()), 'unknown');
});

test('rtt smoothing ignores one spike', () => {
  let r = null;
  for (const v of [40, 42, 38, 41]) r = smoothRtt(r, v);
  const before = r;
  r = smoothRtt(r, 400);
  assert.ok(r < before + 100, `${r}`);
});

test('PONG is a protocol message', () => {
  assert.equal(MSG.PONG, 'pong');
  assert.deepEqual(decode({ type: 'pong', t: 1 }), { type: 'pong', t: 1 });
});
