# Tablet Touch + Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lag-free play on a tablet with keyboard + touchscreen (no mouse).
**Architecture:** A `mobile` quality preset + runtime dynamic resolution in render; touch is translated into the existing `Input` fields so gameplay code is untouched; a DOM overlay draws the touch controls.
**Tech Stack:** Three.js r180, vanilla JS, Vite, `node:test` for pure logic, Playwright (tablet emulation) for smoke.
**Spec:** `docs/superpowers/specs/2026-11-27-tablet-touch-design.md`

## Global Constraints
- No new npm dependencies; no `Math.random()`; no per-frame allocation in update paths.
- `npm run build` must pass; desktop mouse/keyboard behaviour unchanged.

## Review Focus
- Multi-touch: joystick finger and look finger at the same time must not steal each other's touch id.
- Touch released outside the button / `touchcancel` must release fire/move (no stuck firing or running).
- Dynamic resolution must not oscillate every second (hysteresis + cooldown).
- Touch devices must never be forced into the pause menu by missing pointer lock.
- Keyboard WASD + touch look together must both apply.

---

### Task 1: Mobile preset + auto-select
**Files:** Modify `src/core/config.js`, `src/main.js`, `src/render/index.js` (resize pixel-ratio cap), `src/ui/menu.js` (preset list). Test: `tests/config.test.mjs`
- [ ] Test: `createConfig({quality:'mobile'}).q` has `renderScale <= 0.7`, `taa/gtao/ssr/volumetrics/motionBlur === false`, `cascades === 2`, `maxPixelRatio === 1`; `pickDefaultQuality({touch:true})==='mobile'`, `pickDefaultQuality({touch:false})==='ultra'`.
- [ ] Implement `QUALITY_PRESETS.mobile`, `maxPixelRatio` on every preset (1.5 for existing), `export function pickDefaultQuality({touch}): string`.
- [ ] main.js: `quality: params.get('q') ?? pickDefaultQuality({touch: isTouch})`. Render resize uses `q.maxPixelRatio`. Render `qLevel` for `mobile` = 0 (disables DOF/contact/view MSAA).
- [ ] Run tests + `npm run build`; commit.

### Task 2: Dynamic resolution
**Files:** Create `src/core/dynres.js`; modify `src/render/index.js`. Test: `tests/dynres.test.mjs`
- [ ] Test `DynRes({target:1/60,min:0.45,max:q.renderScale})`: feeding 2 s of 30 ms frames lowers `scale` by one step (0.1); feeding 2 s of 8 ms frames after that raises it; never below min/above max; no change within 1.5 s cooldown.
- [ ] Implement `class DynRes { constructor(opts); sample(dt): boolean /* true if scale changed */; scale }` (EMA of frame time, step 0.1, down when > target*1.2, up when < target*0.75).
- [ ] Render: on change, set `this.q.renderScale` and call `this.resize(...)` with last CSS size. Enabled only when `config.dynamicResolution` (true on touch default).
- [ ] Tests + build; commit.

### Task 3: Touch input
**Files:** Create `src/core/touch.js`; modify `src/core/input.js`. Test: `tests/touch.test.mjs`
- [ ] Test `TouchState` with fake touches: left-half touch drag of 60 px → `move.y === 1` (radius 60), release → 0; past 0.95 → `sprint`; right-half drag of dx=10 → `lookDx===10`, consumed after `consume()`; touch starting on fire zone sets `fire` and drag also adds look; two simultaneous touches handled independently; `cancelAll()` clears everything.
- [ ] Implement `class TouchState { start(id,x,y,zone); move(id,x,y); end(id); cancelAll(); consume() }` with zones `'stick'|'look'|'fire'`.
- [ ] Input: attach touch listeners on canvas when touch device; in `beginFrame` add look (× `touchSensitivity`), map fire → `Mouse0`, ads toggle → `Mouse2`, move into `stick.moveX/moveY`, sprint → `ShiftLeft` virtual; buttons press virtual codes (`KeyR`, `Space`, `KeyC`, `Tab`, `Escape`). `input.touch = true` flag.
- [ ] Tests + build; commit.

### Task 4: Touch overlay + pause fix + FPS readout
**Files:** Create `src/ui/touch.js`; modify `src/ui/index.js`.
- [ ] Overlay DOM: fire (large, bottom-right), ADS, reload, jump, crouch, swap, pause; floating stick ring; FPS readout. Buttons call `input.touchButton(code, down)`.
- [ ] `ui/index.js`: skip lock-loss auto-pause when `input.touch`.
- [ ] Playwright smoke (`tools/touch-smoke.mjs`, iPad emulation): boots, no page errors, swipe changes camera yaw, fire button increments shots; screenshot.
- [ ] Commit.
