/**
 * Touch gesture state, independent of the DOM so it can be unit tested.
 * The overlay (src/ui/touch.js) decides which zone a finger started in; this
 * tracks each finger by its identifier so several can act at once.
 *
 *  'stick' — floating joystick anchored where the finger landed → `axis`, `sprint`
 *  'look'  — drag deltas in CSS px → `consume()`
 *  'fire'  — held → `fire`; dragging it also looks (shoot while tracking)
 */
export const STICK_RADIUS = 60; // CSS px for full deflection
const SPRINT_AT = 0.95;

export class TouchState {
  constructor() {
    this.axis = { x: 0, y: 0 }; // y > 0 is forward
    this.sprint = false;
    this.fire = false;
    /** For drawing the floating stick. */
    this.stick = { active: false, ox: 0, oy: 0, x: 0, y: 0 };
    this._fingers = new Map(); // id -> { zone, x, y }
    this._look = { x: 0, y: 0 };
    this._out = { x: 0, y: 0 };
    this._stickId = null;
  }

  start(id, x, y, zone) {
    if (zone === 'stick') {
      if (this._stickId !== null) return; // one stick at a time
      this._stickId = id;
      const s = this.stick;
      s.active = true;
      s.ox = s.x = x;
      s.oy = s.y = y;
      this._setAxis(0, 0);
    } else if (zone === 'fire') {
      this.fire = true;
    } else if (zone !== 'look') {
      return;
    }
    this._fingers.set(id, { zone, x, y });
  }

  move(id, x, y) {
    const f = this._fingers.get(id);
    if (!f) return;
    if (f.zone === 'stick') {
      const s = this.stick;
      let dx = (x - s.ox) / STICK_RADIUS;
      let dy = (s.oy - y) / STICK_RADIUS;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        dx /= len;
        dy /= len;
      }
      s.x = s.ox + dx * STICK_RADIUS;
      s.y = s.oy - dy * STICK_RADIUS;
      this._setAxis(dx, dy);
    } else {
      this._look.x += x - f.x;
      this._look.y += y - f.y;
    }
    f.x = x;
    f.y = y;
  }

  end(id) {
    const f = this._fingers.get(id);
    if (!f) return;
    this._fingers.delete(id);
    if (f.zone === 'stick') {
      this._stickId = null;
      this.stick.active = false;
      this._setAxis(0, 0);
    } else if (f.zone === 'fire') {
      this.fire = false;
      for (const g of this._fingers.values()) if (g.zone === 'fire') this.fire = true;
    }
  }

  cancelAll() {
    for (const id of [...this._fingers.keys()]) this.end(id);
    this._look.x = this._look.y = 0;
  }

  /** Look delta (CSS px) since the last call; the returned object is reused. */
  consume() {
    this._out.x = this._look.x;
    this._out.y = this._look.y;
    this._look.x = this._look.y = 0;
    return this._out;
  }

  _setAxis(x, y) {
    this.axis.x = x;
    this.axis.y = y;
    this.sprint = y > 0.7 && Math.hypot(x, y) >= SPRINT_AT;
  }
}
