# Arena Phase 1 (offline practice arena + iPad deploy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-player build the user can open on an iPad from GitHub Pages: neon grey-box arena, fast movement with DASH, loadout pick, aim assist, and a strafing practice dummy with head/body hitboxes — at 60 fps.
**Architecture:** A new `ArenaSystem` replaces the street `WorldSystem` (it registers under the id `world` so existing consumers keep working); `ai` is not registered. Pure logic (layout, dash, loadout, aim assist, hitboxes) lives in small modules with `node:test` tests; systems wire them in. Phase 2 (network, rounds, lobby, real opponent) gets its own plan and reuses the hitbox and dummy-avatar modules.
**Tech Stack:** Three.js r180, vanilla ES modules, Vite, `node:test`, Playwright (iPad emulation, `/opt/pw-browsers/chromium`), GitHub Actions → Pages.
**Spec:** `docs/superpowers/specs/2026-11-27-arena-1v1-design.md`

## Global Constraints
- iPad Safari, WebGL2, no `OES_texture_float_linear` (use `linearFloatType` from `src/core/gpu.js` for any new filtered float target).
- No new npm deps in this phase (`peerjs` arrives in Phase 2). No `Math.random()` (use `ctx.rng`). No per-frame allocation in update paths.
- Budget: ≤ 150 k triangles and ≤ 100 draw calls per frame (measured by `tools/pass-breakdown.mjs`) in the `mobile` preset.
- Base speed +35 % over current (`MOVE.sprintSpeed` 7.01 → 9.46; scale walk/slide/tac by the same factor). DASH cooldown 3.0 s. HP 100, headshot ×2, hitboxes ×1.15.
- Aim assist levels exactly `'off' | 'low' | 'medium'`; never snaps to the head.
- Remove lean and prone from input/touch. Keyboard DASH = `KeyQ`.
- Game is original: no names/maps/art from other games. Working title "Tablet FPS".

## Review Focus
- Dash pressed during cooldown, mid-air, or while sliding: must neither stack nor launch the player through walls (dash uses the character controller's swept move, never a teleport).
- Aim assist with the dummy behind a wall: no slowdown/tracking through geometry (line-of-sight required).
- Loadout picker closed without choosing: default `rifle` + `pistol`; SWAP only ever cycles the two chosen weapons.
- Arena edges: player can never leave the playable bounds (perimeter walls + kill-plane respawn below y = -10).
- Dummy killed mid-reload / during dash: respawns after 2 s at the far spawn, hitboxes re-enabled, no double kill feed.

---

### Task 1: Arena layout + ArenaSystem (replaces street map)
**Files:** Create `src/arena/layout.js`, `src/arena/index.js`; modify `src/main.js`, `src/core/prewarm.js` (only if it references `world` by import). Test: `tests/arena-layout.test.mjs`

**Interfaces:**
- Produces `ARENA` = `{ size: 30, boxes: Array<{x,y,z,w,h,d}> /* centre + size, metres */, spawns: [{x,y,z,yaw}, {x,y,z,yaw}] }` and `validateLayout(layout): string[]` (empty = valid) in `layout.js`.
- Produces `class ArenaSystem { static id = 'world'; static deps = ['physics']; root; bounds; spawnPoints; spawn(i); groundHeight(x,z); isOpen(x,z); stats; buildings = []; levelToWorld(x,y,z,out); worldToLevel(x,y,z,out); prewarmMaterials() }`.
- [ ] Test: layout is mirror-symmetric about the centre (each box has a twin at (-x,-z)); exactly 2 spawns, ≥ 24 m apart, facing each other (yaw differs by π); all boxes inside ±size/2; perimeter walls ≥ 4 m tall; at least 3 distinct box top heights (height levels); `validateLayout(ARENA)` returns `[]`.
- [ ] Implement layout data (floor, perimeter, 2 tiers of platforms with ramps as stepped boxes, central cover) + `validateLayout`.
- [ ] Implement ArenaSystem: one merged `MeshStandardMaterial` grey (`#8a8f96`, roughness 0.9) box geometry, one merged `LineSegments` from `EdgesGeometry` in neon cyan `#3df2ff` (team-neutral) with `toneMapped:false`; `physics.addStaticGroup(root,'concrete')` + `rebuildStatic()`; `isOpen` true inside bounds and not inside a box; levelToWorld/worldToLevel identity. Kill plane: if the player's y < -10, respawn at their spawn.
- [ ] main.js: register `ArenaSystem` instead of `WorldSystem`, drop `AiSystem`. Sky stays.
- [ ] Run tests + `npm run build`; run `tools/touch-smoke.mjs` (yaw/fire/move checks still pass).
- [ ] Commit.

### Task 2: Render budget for the arena
**Files:** Modify `src/render/index.js`, `src/core/config.js`; Test: `tests/config.test.mjs`
- [ ] Test: `QUALITY_PRESETS.mobile.cascades === 1` and `QUALITY_PRESETS.mobile.prepass === false`; every other preset has `prepass === true`.
- [ ] Implement: `needsPrepass = q.prepass !== false`; CSM honours `cascades: 1`.
- [ ] Verify: `CHROME_PATH=/opt/pw-browsers/chromium node tools/pass-breakdown.mjs --port=4173` prints total ≤ 150 k tris and ≤ 100 calls.
- [ ] Commit.

### Task 3: Fast movement + DASH
**Files:** Create `src/player/dash.js`; modify `src/player/tuning.js`, `src/player/movement.js`, `src/core/input.js` (ACTIONS: add `dash: ['KeyQ','TouchDash']`, remove `leanLeft/leanRight/prone`), `src/ui/touch.js` (DASH button, `data-code="TouchDash"`). Test: `tests/dash.test.mjs`
**Interfaces:** Produces `class Dash { constructor({cooldown=3, duration=0.15, speed=22}); tryStart(now, dirX, dirZ): boolean; velocity(now, out:{x,z}): boolean /* true while active */; ready(now): boolean; cooldownLeft(now): number }`.
- [ ] Test: first `tryStart` succeeds; a second within 3 s fails and `cooldownLeft` counts down; succeeds again at 3.0 s; zero direction dashes along facing (caller passes facing); `velocity` is active only for 0.15 s and magnitude 22.
- [ ] Implement Dash; movement applies its velocity through the controller's normal swept move (no position writes); dash ends a slide but keeps horizontal speed; slide-jump keeps current horizontal speed instead of clamping to `airSpeedCap`.
- [ ] Tuning ×1.35 as in Global Constraints. Touch DASH button shows remaining cooldown as a ring.
- [ ] Tests + build + smoke; commit.

### Task 4: Loadout
**Files:** Create `src/weapons/loadout.js`, `src/ui/loadout.js`; modify `src/weapons/index.js` (number keys/Tab/wheel/SWAP use the loadout), `src/ui/index.js`. Test: `tests/loadout.test.mjs`
**Interfaces:** Produces `class Loadout { constructor(primary='rifle'); primary; secondary='pistol'; ids(): string[]; other(id): string; static PRIMARIES = ['rifle','smg'] }` and `ctx.events` event `loadout:set` `{ primary }`.
- [ ] Test: default ids `['rifle','pistol']`; `new Loadout('smg').ids()` → `['smg','pistol']`; invalid primary throws; `other('pistol')` → primary.
- [ ] UI: picker shown at boot before control is enabled (two big cards RIFLE / SMG + START); closing without choice = rifle. Pause menu gets a "Change loadout" button.
- [ ] Tests + build; commit.

### Task 5: Hitboxes + practice dummy
**Files:** Create `src/opponent/hitbox.js`, `src/opponent/avatar.js`, `src/practice/index.js` (`PracticeSystem`, id `practice`, deps `['physics','world']`); modify `src/main.js`. Test: `tests/hitbox.test.mjs`
**Interfaces:**
- `HITBOX = { scale: 1.15, head: { radius, y }, body: { radius, y0, y1 } }`, `applyDamage(hp, base, part): { hp, killed, amount }` (head ×2, floor at 0).
- `class Avatar { constructor(scene, physics, opts); setPose(x,y,z,yaw); setAlive(bool); colliders /* [head, body] with part 'head'|'body' */; dispose() }` — neon figure (box torso + sphere head, emissive edge), ≤ 2 k tris.
- PracticeSystem spawns one Avatar at spawn 1 that strafes on a deterministic pattern (`ctx.rng`), takes damage via collider `onHit`, emits `damage:dealt` `{ target: avatar, amount, headshot, killed, point }`, respawns after 2 s.
- [ ] Test: `applyDamage(100, 33, 'body')` → hp 67; head → 34; killing blow reports `killed: true` once and hp 0; HITBOX radii are the base values ×1.15.
- [ ] Implement; verify in smoke test that firing at the dummy produces `damage:dealt` (add assertion to `tools/touch-smoke.mjs`: aim at dummy via `player.movement.yaw/pitch`, hold FIRE, expect ≥ 1 event).
- [ ] Commit.

### Task 6: Aim assist
**Files:** Create `src/player/aimassist.js`; modify `src/player/index.js` (look path), `src/ui/menu.js` (Off/Low/Medium segment), `src/core/config.js` (`aimAssist: 'low'` default). Test: `tests/aimassist.test.mjs`
**Interfaces:** `aimAssist(level, angErr: {yaw, pitch} /* radians from crosshair to nearest target head-to-body line */, targetAngVel: {yaw, pitch}, visible: boolean): { lookScale: number, trackYaw: number, trackPitch: number }`; strengths `{ off: [1,0], low: [0.75,0.25], medium: [0.55,0.45] }` = [slowdown scale inside cone, tracking fraction of target angular velocity]; cone 3° (×1.15 hitbox scale already applied by caller).
- [ ] Test: `off` → `{1,0,0}`; inside cone `low` → lookScale 0.75 and track = 0.25×vel; outside cone → no effect; `visible:false` → no effect; tracking never exceeds target angular velocity (no snap).
- [ ] Wire: player computes angle to the nearest live Avatar (practice dummy now, opponent in Phase 2) with `physics.lineOfSight`, applies result to touch look only (keyboard unaffected).
- [ ] Commit.

### Task 7: Kill feedback
**Files:** Modify `src/ui/index.js`, `src/audio/index.js` (reuse existing hit/kill cues), `src/fx/index.js`.
- [ ] On `damage:dealt` with `killed` against an Avatar: crosshair kill marker, short screen flash (≤ 120 ms), kill sound, avatar burst (fx particles in neon colour). Headshot gets a distinct marker colour.
- [ ] Smoke: killing the dummy produces exactly one kill event and no page errors. Commit.

### Task 8: GitHub Pages deploy
**Files:** Modify `vite.config.js` (`base: './'`); create `.github/workflows/pages.yml`.
- [ ] Workflow: on push to `main` → `npm ci`, `node --test tests/*.test.mjs`, `npm run build`, upload `dist` with `actions/upload-pages-artifact@v3`, deploy with `actions/deploy-pages@v4`.
- [ ] Verify locally: `npm run build && npx vite preview` serves under a sub-path (`/tablet-fps/`) without 404s.
- [ ] Commit; user enables Settings → Pages → Source: GitHub Actions and merges to `main`.
