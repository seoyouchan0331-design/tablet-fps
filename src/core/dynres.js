/**
 * Dynamic resolution controller. Pure logic, no DOM/GPU: feed it the frame
 * delta every frame and it tells you when to change the render scale.
 *
 * Frame time is averaged over 1 s windows. A slow window steps the scale down;
 * a clearly fast window steps it up. Because rAF is vsync-locked, a GPU with
 * headroom still reports exactly the refresh interval, so after several stable
 * windows at the cap it *probes* one step up; if that probe makes the next
 * window slow, it drops back and refuses to probe again for a while.
 */
const WINDOW = 1.0; // seconds of frames per decision
const STEP_DOWN = 0.1;
const STEP_UP = 0.05;
const HITCH = 0.25; // a single frame longer than this is a stall, not load
const STABLE_WINDOWS_TO_PROBE = 3;
const PROBE_BAN = 30; // seconds
const PROBE_BLAME = 5; // a slowdown this soon after a probe is the probe's fault

export class DynRes {
  /**
   * start: initial scale (defaults to max). warmup: seconds at boot during
   * which frames are ignored — shader/texture uploads hitch there and must not
   * push the resolution down for the rest of the match.
   */
  constructor({ target = 1 / 60, min = 0.45, max = 1, start = max, warmup = 0 } = {}) {
    this.target = target;
    this.min = min;
    this.max = max;
    this.scale = Math.min(max, Math.max(min, start));
    this.warmup = warmup;
    this._acc = 0;
    this._n = 0;
    this._cooldown = false;
    this._stable = 0;
    this._probeAt = -Infinity;
    this._clock = 0;
    this._banUntil = 0;
  }

  /** @returns {boolean} true when `scale` changed this frame */
  sample(dt) {
    if (!(dt > 0) || dt > HITCH) return false;
    this._clock += dt;
    if (this._clock < this.warmup) return false;
    this._acc += dt;
    this._n++;
    if (this._acc < WINDOW) return false;
    const avg = this._acc / this._n;
    this._acc = 0;
    this._n = 0;
    if (this._cooldown) {
      // The window right after a change still contains the old resolution's frames.
      this._cooldown = false;
      return false;
    }
    const t = this.target;
    if (avg > t * 1.2) {
      if (this._clock - this._probeAt <= PROBE_BLAME) this._banUntil = this._clock + PROBE_BAN;
      this._probeAt = -Infinity;
      this._stable = 0;
      return this._set(this.scale - STEP_DOWN);
    }
    if (avg < t * 0.75) {
      this._stable = 0;
      return this._set(this.scale + STEP_UP);
    }
    if (avg < t * 1.1 && ++this._stable >= STABLE_WINDOWS_TO_PROBE && this._clock >= this._banUntil) {
      this._stable = 0;
      if (this._set(this.scale + STEP_UP)) {
        this._probeAt = this._clock;
        return true;
      }
    }
    return false;
  }

  _set(v) {
    const next = Math.round(Math.min(this.max, Math.max(this.min, v)) * 1000) / 1000;
    if (next === this.scale) return false;
    this.scale = next;
    this._cooldown = true;
    return true;
  }
}
