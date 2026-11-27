import test from 'node:test';
import assert from 'node:assert/strict';
import { RoundsMode } from '../src/match/rounds.js';

const run = (m, secs, hp) => { const ev = []; for (let t = 0; t < secs - 1e-9; t += 0.1) ev.push(...m.tick(0.1, hp)); return ev; };

test('start -> 3 s countdown -> live', () => {
  const m = new RoundsMode();
  const e0 = m.start();
  assert.equal(m.state, 'countdown');
  assert.equal(e0[0].type, 'countdown');
  const ev = run(m, 3.05);
  assert.equal(m.state, 'live');
  assert.ok(ev.some((e) => e.type === 'live'));
  assert.equal(m.round, 1);
});

test('kill in live ends the round for the shooter; score counts', () => {
  const m = new RoundsMode(); m.start(); run(m, 3.05);
  const ev = m.kill('guest');
  assert.equal(m.state, 'roundEnd');
  assert.deepEqual(ev[0], { type: 'roundEnd', winner: 'host', score: { host: 1, guest: 0 }, round: 1 });
});

test('kill outside live is ignored; a second kill in the same round too', () => {
  const m = new RoundsMode(); m.start();
  assert.deepEqual(m.kill('guest'), []);
  run(m, 3.05);
  m.kill('guest');
  assert.deepEqual(m.kill('host'), []);
  assert.deepEqual(m.score, { host: 1, guest: 0 });
});

test('timer expiry: higher HP wins, tie gives no point', () => {
  const m = new RoundsMode(); m.start(); run(m, 3.05);
  const ev = run(m, 30.2, { host: 40, guest: 70 });
  const end = ev.find((e) => e.type === 'roundEnd');
  assert.equal(end.winner, 'guest');
  const m2 = new RoundsMode(); m2.start(); run(m2, 3.05);
  const e2 = run(m2, 30.2, { host: 100, guest: 100 }).find((e) => e.type === 'roundEnd');
  assert.equal(e2.winner, null);
  assert.deepEqual(m2.score, { host: 0, guest: 0 });
});

test('after the pause the next round counts down; first to 5 wins the match', () => {
  const m = new RoundsMode(); m.start();
  let last = [];
  for (let r = 0; r < 5; r++) {
    run(m, 3.05);
    assert.equal(m.state, 'live', `round ${r + 1} live`);
    last = m.kill('guest');
    if (r < 4) { run(m, 3.05); assert.equal(m.state, 'countdown'); }
  }
  assert.equal(m.state, 'matchEnd');
  assert.ok(last.some((e) => e.type === 'matchEnd' && e.winner === 'host'));
});

test('winTarget is configurable (3)', () => {
  const m = new RoundsMode({ winTarget: 3 }); m.start();
  for (let r = 0; r < 3; r++) { run(m, 3.05); m.kill('host'); if (r < 2) run(m, 3.05); }
  assert.equal(m.state, 'matchEnd');
});

test('sides swap every round; guest always opposite', () => {
  const m = new RoundsMode(); m.start();
  const seen = [];
  for (let r = 0; r < 3; r++) {
    seen.push([m.spawnFor('host'), m.spawnFor('guest')]);
    run(m, 3.05); m.kill('guest'); run(m, 3.05);
  }
  assert.deepEqual(seen, [[0, 1], [1, 0], [0, 1]]);
});
