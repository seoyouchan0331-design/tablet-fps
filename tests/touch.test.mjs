import test from 'node:test';
import assert from 'node:assert/strict';
import { TouchState, STICK_RADIUS } from '../src/core/touch.js';

test('stick: drag up a full radius = full forward, release = stop', () => {
  const t = new TouchState();
  t.start(1, 100, 500, 'stick');
  t.move(1, 100, 500 - STICK_RADIUS);
  assert.equal(t.axis.y, 1);
  assert.equal(t.axis.x, 0);
  t.move(1, 100, 500 - STICK_RADIUS * 3); // clamped
  assert.equal(t.axis.y, 1);
  t.end(1);
  assert.equal(t.axis.y, 0);
  assert.equal(t.stick.active, false);
});

test('stick: pushing to the edge sprints, half-way does not', () => {
  const t = new TouchState();
  t.start(1, 100, 500, 'stick');
  t.move(1, 100, 500 - STICK_RADIUS * 0.5);
  assert.equal(t.sprint, false);
  t.move(1, 100, 500 - STICK_RADIUS);
  assert.equal(t.sprint, true);
  t.move(1, 100 + STICK_RADIUS, 500); // full right strafe is not a sprint
  assert.equal(t.sprint, false);
});

test('look: drag accumulates until consumed', () => {
  const t = new TouchState();
  t.start(2, 800, 300, 'look');
  t.move(2, 810, 305);
  t.move(2, 815, 300);
  assert.deepEqual(t.consume(), { x: 15, y: 0 });
  assert.deepEqual(t.consume(), { x: 0, y: 0 });
});

test('fire: held while down, drag also looks', () => {
  const t = new TouchState();
  t.start(3, 900, 600, 'fire');
  assert.equal(t.fire, true);
  t.move(3, 880, 590);
  assert.deepEqual(t.consume(), { x: -20, y: -10 });
  t.end(3);
  assert.equal(t.fire, false);
});

test('two fingers are independent', () => {
  const t = new TouchState();
  t.start(1, 100, 500, 'stick');
  t.start(2, 800, 300, 'look');
  t.move(2, 830, 300);
  t.move(1, 100 - STICK_RADIUS, 500);
  assert.equal(t.axis.x, -1);
  assert.deepEqual(t.consume(), { x: 30, y: 0 });
  t.end(2);
  assert.equal(t.axis.x, -1, 'lifting the look finger keeps moving');
});

test('unknown ids and cancelAll are safe', () => {
  const t = new TouchState();
  t.move(9, 1, 1);
  t.end(9);
  t.start(1, 100, 500, 'stick');
  t.start(3, 900, 600, 'fire');
  t.move(1, 100, 400);
  t.cancelAll();
  assert.equal(t.fire, false);
  assert.equal(t.axis.y, 0);
  assert.equal(t.sprint, false);
  assert.deepEqual(t.consume(), { x: 0, y: 0 });
});
