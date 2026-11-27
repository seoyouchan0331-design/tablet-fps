import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/core/registry.js';

test('prepend runs before handlers registered earlier', () => {
  const bus = new EventBus();
  const order = [];
  bus.on('x', (e) => order.push(['late', e.killed]));
  bus.prepend('x', (e) => { e.killed = true; order.push(['first']); });
  bus.emit('x', { killed: false });
  assert.deepEqual(order, [['first'], ['late', true]]);
});

test('prepend returns an unsubscribe', () => {
  const bus = new EventBus();
  let n = 0;
  const off = bus.prepend('x', () => n++);
  bus.emit('x', {});
  off();
  bus.emit('x', {});
  assert.equal(n, 1);
});
