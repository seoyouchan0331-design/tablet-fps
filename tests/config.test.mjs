import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfig, pickDefaultQuality, QUALITY_PRESETS } from '../src/core/config.js';

test('mobile preset is cheap', () => {
  const q = createConfig({ quality: 'mobile' }).q;
  for (const k of ['taa', 'gtao', 'ssr', 'volumetrics', 'motionBlur']) assert.equal(q[k], false, k);
  assert.equal(q.cascades, 1);
});

test('mobile preset uses the lite renderer at up to Retina pixel ratio', () => {
  const q = createConfig({ quality: 'mobile' }).q;
  assert.equal(q.lite, true);
  assert.equal(q.maxPixelRatio, 2);
  assert.equal(q.renderScale, 0.75);
  for (const [name, p] of Object.entries(QUALITY_PRESETS)) if (name !== 'mobile') assert.ok(!p.lite, name);
});

test('every preset has a pixel-ratio cap', () => {
  for (const [name, q] of Object.entries(QUALITY_PRESETS)) assert.ok(q.maxPixelRatio > 0, name);
  assert.equal(QUALITY_PRESETS.ultra.maxPixelRatio, 1.5);
});

test('default quality follows input device', () => {
  assert.equal(pickDefaultQuality({ touch: true }), 'mobile');
  assert.equal(pickDefaultQuality({ touch: false }), 'ultra');
});

test('mobile preset: one shadow cascade; depth prepass stays on (sky aerial perspective needs depth)', () => {
  assert.equal(QUALITY_PRESETS.mobile.cascades, 1);
  for (const [name, q] of Object.entries(QUALITY_PRESETS)) assert.equal(q.prepass, true, name);
});

test('mobile preset may climb to full resolution when the tablet has headroom', () => {
  assert.equal(QUALITY_PRESETS.mobile.dynresMax, 1);
});
