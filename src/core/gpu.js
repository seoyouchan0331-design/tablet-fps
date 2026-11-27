import * as THREE from 'three';

/**
 * Texture type for a render target that is SAMPLED WITH LINEAR FILTERING.
 *
 * 32-bit float textures can only be linearly filtered with
 * OES_texture_float_linear, which iOS/iPadOS Safari does not expose. Without
 * it the texture is "incomplete" and every sample reads 0 — the auto-exposure
 * then meters to zero and the whole 3D view renders black (HUD still fine).
 * Half float is always filterable in WebGL2, so fall back to that.
 */
export function linearFloatType(renderer) {
  return renderer?.extensions?.has?.('OES_texture_float_linear') ? THREE.FloatType : THREE.HalfFloatType;
}
