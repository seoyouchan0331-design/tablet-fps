# Arena Phase 2 (1v1 duel over same-Wi-Fi P2P) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two iPads on the same Wi-Fi play a round-based 1v1 in the arena: one creates a room (4-char code), the other joins, both pick loadouts, first to 5 round wins, rematch from the results screen.
**Architecture:** A `Transport` interface (send / onMessage / onClose) with three implementations: PeerJS WebRTC (real play), BroadcastChannel (two tabs, for automated e2e tests — no internet needed) and an in-memory loopback pair (unit tests). Pure logic — protocol, room codes, round state machine, host hit validation, snapshot interpolation — lives in small tested modules. `MatchSystem` wires transport + rules + player + `OpponentSystem` (remote avatar) + lobby UI. The room creator is host and owns round state and HP; hits are detected on the shooter's screen and validated by the host.
**Tech Stack:** Three.js r180, vanilla ES modules, Vite, `peerjs@1.5.4`, `node:test`, Playwright (two-page e2e over BroadcastChannel).
**Spec:** `docs/superpowers/specs/2026-11-27-arena-1v1-design.md`

## Global Constraints
- One new dependency only: `peerjs` pinned to exactly `1.5.4`. PeerJS ids are `tfps-<CODE>`; default public broker.
- Room code: 4 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I).
- Rounds mode defaults: first to 5 round wins (host may pick 3/5/7), one life per round, 30 s round timer, 3 s countdown, 3 s round-end pause; sides swap every round.
- Damage rules from Phase 1: 100 HP, headshot x2, hitboxes x1.15 (`src/opponent/hitbox.js`). No health regen during a match.
- State snapshots 30 Hz; remote rendered 100 ms behind with interpolation.
- Host validation rejects: shooter or target dead / not in a live round; fire interval below 90 % of the weapon's cycle time; range > 80 m; no line of sight from the claimed shooter position to the hit point (static world).
- Aim assist level and round count are host settings, applied to both players.
- No `Math.random()` in gameplay; room codes use `crypto.getRandomValues`.
- Keep Practice mode working (main menu entry).

## Review Focus
- Peer disconnects mid-round (tab closed, Wi-Fi drop): the other side shows "Opponent disconnected" and returns to the menu within 5 s; no stuck round.
- Both players die in the same frame (simultaneous kill): host resolves by the first accepted hit; the round awards exactly one point (or none) — never two.
- Join with a wrong/expired code: clear "Room not found" error within 10 s, back to the join screen.
- Rematch pressed by only one player: waits with "Waiting for opponent"; nothing starts until both are ready.
- Network on a Wi-Fi that blocks peer-to-peer (connection never opens): timeout message "Couldn't connect — this Wi-Fi may block direct connections" after 15 s.

---

### Task 1: Protocol, room codes, transports
**Files:** Create `src/net/protocol.js`, `src/net/roomcode.js`, `src/net/transport.js`. Test: `tests/net.test.mjs`
**Interfaces (produces):**
- `MSG` = `{ HELLO:'hello', SETTINGS:'settings', LOADOUT:'loadout', READY:'ready', STATE:'state', FIRE:'fire', HIT:'hit', HP:'hp', ROUND:'round', MATCH:'match', REMATCH:'rematch', BYE:'bye' }`; `encode(type, body): string`, `decode(str): {type, ...body} | null` (null on bad JSON / unknown type / missing `type`).
- `makeRoomCode(randomBytes = cryptoBytes): string` (4 chars), `isRoomCode(s): boolean` (case-insensitive, normalised to upper).
- `class LoopbackTransport { static pair(): [LoopbackTransport, LoopbackTransport]; send(obj); onMessage(fn); onClose(fn); close() }` — delivery async (queueMicrotask), close notifies the other side.
- `class BroadcastTransport { constructor(code, role: 'host'|'guest'); connect(): Promise<void>; send; onMessage; onClose; close }` — BroadcastChannel named `tfps-<code>`; HELLO handshake.
- [ ] Tests: decode rejects garbage, unknown types and non-objects; encode/decode round-trips every MSG type; room codes match `/^[A-HJ-NP-Z2-9]{4}$/` for 200 generated codes and `isRoomCode('k7qp')` is true while `isRoomCode('K0QP')` is false; loopback pair delivers both ways, preserves order, and `close()` fires the peer's onClose once; `new BroadcastTransport('ZZZZ','guest', { timeout: 200 }).connect()` with no host rejects with `room-not-found` (Node 22 has BroadcastChannel).
- [ ] Implement; run `node --test tests/net.test.mjs` → pass; commit.

### Task 2: PeerJS transport
**Files:** Create `src/net/peer.js`; modify `package.json` (`peerjs: "1.5.4"`).
**Interfaces:** `class PeerTransport` with the same surface as Task 1 plus `static host(code): Promise<PeerTransport>` (registers id `tfps-<code>`, resolves when the guest connects) and `static join(code): Promise<PeerTransport>` (rejects with `Error('room-not-found')` on PeerJS `peer-unavailable`, `Error('timeout')` after 15 s).
- [ ] `npm install peerjs@1.5.4 --save-exact`; build passes.
- [ ] Implement with dynamic `import('peerjs')` so practice mode never loads it; reliable data channel, JSON payloads.
- [ ] No unit test (needs a broker); covered by the e2e transport-agnostic flow in Task 7 and on-device check. Commit.

### Task 3: Rounds mode (state machine)
**Files:** Create `src/match/rounds.js`. Test: `tests/rounds.test.mjs`
**Interfaces:** `class RoundsMode { constructor({ winTarget=5, roundTime=30, countdown=3, pause=3 }); state: 'countdown'|'live'|'roundEnd'|'matchEnd'; round; score: {host, guest}; timeLeft; start(); tick(dt): Event[]; kill(victim: 'host'|'guest'): Event[]; spawnFor(role): 0|1 }` where `Event = { type: 'countdown'|'live'|'roundEnd'|'matchEnd', winner?: 'host'|'guest'|null, score }`.
- [ ] Tests: start → countdown 3 s → live; `kill('guest')` in live → roundEnd with winner host, score {1,0}; kill outside live is ignored; second kill in the same round ignored (simultaneous-kill rule); timer expiry → roundEnd with winner = higher HP passed via `tick(dt, hp)` and null on tie; after 5 host wins → matchEnd winner host; `spawnFor('host')` alternates 0,1,0… per round, guest always the other.
- [ ] Implement; tests pass; commit.

### Task 4: Host hit validation + interpolation
**Files:** Create `src/match/validate.js`, `src/match/interp.js`. Tests: `tests/validate.test.mjs`, `tests/interp.test.mjs`
**Interfaces:** `validateHit(claim, ctx): { ok: boolean, reason?: string }` with `claim = { shooter, target, weapon, t, from:[x,y,z], point:[x,y,z], part }` and `ctx = { live: boolean, alive: {host,guest}, lastFire: {host,guest}, cycleTime(weapon): number, lineOfSight(from, to): boolean }`. `class SnapshotBuffer { push(t, state); sample(renderTime, out): boolean }` (linear position, shortest-arc yaw; holds last when starved; drops >1 s old).
- [ ] validate tests: accepts a clean claim; rejects `not-live`, `dead`, `fire-rate` (interval < 0.9 x cycle), `range` (> 80 m), `no-los`.
- [ ] interp tests: halfway between two snapshots; yaw from 3.1 to -3.1 goes the short way; before first snapshot returns false; after last holds last.
- [ ] Implement; tests pass; commit.

### Task 5: OpponentSystem
**Files:** Create `src/opponent/index.js` (`OpponentSystem`, id `opponent`, deps `['physics','world']`); modify `src/main.js`, `src/practice/index.js` (add `setActive(bool)`: hides dummy, disables colliders).
**Interfaces:** `opponent.avatar` (Avatar, lite colours), `opponent.target` = `{ name:'OPPONENT', isOpponent:true }` (collider owner), `opponent.push(t, state)`, `opponent.setVisible(bool)`. `update()` samples the SnapshotBuffer at `now - 0.1`.
- [ ] Aim assist already prefers `ctx.peek('opponent')?.avatar` (Phase 1) — verify it is null-safe when hidden (`avatar.alive=false`).
- [ ] Commit (exercised by Task 7).

### Task 6: MatchSystem + lobby UI
**Files:** Create `src/match/index.js` (`MatchSystem`, id `match`), `src/ui/lobby.js`; modify `src/ui/index.js` (main menu replaces the boot loadout picker), `src/player/health.js` (`regenEnabled` flag), `src/main.js`.
**Interfaces / behaviour:**
- Main menu: PRACTICE · CREATE ROOM · JOIN (4-char code field, uppercase, validated by `isRoomCode`).
- Lobby: big room code, host-only settings (aim assist off/low/medium, rounds 3/5/7), loadout cards, READY; shows opponent's ready state.
- In match: `?net=bc` selects BroadcastTransport, otherwise PeerTransport.
- Host: runs RoundsMode, owns HP for both, sends ROUND / HP / MATCH; on FIRE stores lastFire; on HIT runs `validateHit` and, if ok, applies `applyDamage`, broadcasts HP and on kill calls `mode.kill`.
- Shooter side: local `damage:dealt` whose target is `opponent.target` becomes a HIT claim (never applied locally).
- Victim side: HP message with a drop emits `damage:dealt` with the local player as target (existing HUD/damage effects).
- Round start: both respawn at `spawnFor(role)`, HP 100, regen off; round banner "ROUND n" / "YOU WIN THE ROUND"; HUD score = round wins.
- Results: WIN/LOSE, final score, REMATCH (needs both) and LEAVE. BYE or transport close → "Opponent disconnected" → menu.
- [ ] Commit (exercised by Task 7).

### Task 7: Two-player e2e over BroadcastChannel
**Files:** Create `tools/duel-e2e.mjs`.
- [ ] Two pages in one browser context (iPad emulation), `?net=bc`: page A CREATE ROOM, read code; page B JOIN with it; both pick loadouts and READY.
- [ ] Assert: both see countdown then live; A aims at B's avatar (teleport into clear LOS like touch-smoke) and fires until HP message drops B below 100; B's HUD health falls; killing B ends the round with A score 1 on both pages; sides swap next round.
- [ ] Assert REMATCH needs both; closing page B shows "Opponent disconnected" on A within 5 s.
- [ ] Run `CHROME_PATH=/opt/pw-browsers/chromium node tools/duel-e2e.mjs` → `DUEL OK`; `tools/touch-smoke.mjs` (practice path) still `SMOKE OK`; commit.

### Task 8: Ship
- [ ] Merge to `main` (Pages deploy), confirm the Actions run succeeds.
- [ ] On-device check by the user: two iPads, same Wi-Fi, CREATE/JOIN on `https://seoyouchan0331-design.github.io/tablet-fps/`.
