import test from 'node:test';
import assert from 'node:assert/strict';
import { MOVE, STANCE, SPEED_SCALE } from '../src/player/tuning.js';

const close = (a, b) => Math.abs(a - b) < 0.01;

test('arena movement is 35 % faster than the original tuning', () => {
  assert.equal(SPEED_SCALE, 1.35);
  assert.ok(close(MOVE.sprintSpeed, 7.01 * 1.35), String(MOVE.sprintSpeed));
  assert.ok(close(MOVE.tacSprintSpeed, 8.38 * 1.35));
  assert.ok(close(STANCE.stand.speed, 4.57 * 1.35));
  assert.ok(close(STANCE.crouch.speed, 2.44 * 1.35));
  assert.ok(close(MOVE.slide.entrySpeed, 8.84 * 1.35));
  assert.ok(close(MOVE.slide.minEntry, 6.2 * 1.35));
  assert.ok(close(MOVE.airSpeedCap, 3.4 * 1.35));
});

test('dash tuning matches the spec', () => {
  assert.equal(MOVE.dash.cooldown, 3);
  assert.equal(MOVE.dash.slideSpeed, 18);
});
