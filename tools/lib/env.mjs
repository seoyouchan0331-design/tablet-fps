/**
 * Shared browser-test setup. This machine has no GPU (Chromium renders with
 * SwiftShader on the CPU), so by default tests run the iPad layout at 1x pixel
 * density with `?fast=1` (a small pixel budget): same code paths, several
 * times the frame rate. FULL_RES=1 restores the real iPad resolution.
 */
import { devices } from 'playwright';

export const FAST = process.env.FULL_RES !== '1';

/** Browser-context options for the emulated iPad. */
export function ipad() {
  const d = { ...devices['iPad Pro 11 landscape'] };
  if (FAST) d.deviceScaleFactor = 1;
  return d;
}

/** Add `fast=1` to a game URL when running fast. */
export function gameUrl(url) {
  if (!FAST) return url;
  return url + (url.includes('?') ? '&' : '?') + 'fast=1';
}
