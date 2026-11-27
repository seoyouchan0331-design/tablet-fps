import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { linearFloatType } from '../src/core/gpu.js';

const fake = (has) => ({ extensions: { has: (n) => n === 'OES_texture_float_linear' && has } });

test('keeps 32-bit float where linear filtering is supported', () => {
  assert.equal(linearFloatType(fake(true)), THREE.FloatType);
});

test('falls back to half float on iOS-like GPUs (no OES_texture_float_linear)', () => {
  assert.equal(linearFloatType(fake(false)), THREE.HalfFloatType);
});

test('missing renderer is treated as unsupported', () => {
  assert.equal(linearFloatType(undefined), THREE.HalfFloatType);
});
