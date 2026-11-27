# 1v1 Arena (tablet, same Wi-Fi) — Design

## Intent and the why
Turn the tablet build into a fast 1v1 arena shooter that friends play against each
other on iPads in the same room. The fun to protect, in the user's words: **"moving
fast, then landing the shots and killing — that rush."** Every decision below serves
that: high movement speed, short decisive fights, crisp hit/kill feedback, and hit
registration the shooter can trust.

Genre reference: fast arena duel shooters (the user cited Roblox "Rivals"). We build an
original game in that genre — no names, maps, weapons, art or UI copied from it.

## Goals
- Two iPads on the same Wi-Fi: one creates a room (4-char code), the other joins.
- Round-based duel: one life per round, ~30 s rounds, first to 5 round wins (host-configurable).
- Pre-match loadout: primary (rifle or SMG) + pistol; SWAP switches in-match.
- Fast movement: base speed +30–40 %, auto-sprint at full stick, slide (CROUCH while sprinting) with momentum, slide-jump keeps speed, **new DASH** (short burst in move direction, ~3 s cooldown).
- Aim assist, host-selectable **off / low / medium**: slowdown while the crosshair is over the opponent + light tracking of a moving target. Never snaps or locks onto the head.
- Hit/kill feedback that sells the moment: hitmarker, hit sound, distinct kill effect + sound, round-win banner.
- Arena map in **grey-box style: grey boxes with neon edge lines** so geometry reads clearly. Must hold 60 fps on an iPad.
- Rules live in a **mode** object (rounds, lives, respawn, win condition) so other modes can be added later. Ship only "Rounds" mode.
- Rematch from the results screen without leaving the room.

## Non-goals
Matchmaking with strangers, accounts/rankings/stats, more than 2 players or spectators,
play over the internet between different networks, wall-run / double jump, lean / prone,
keyboard+mouse balance (all players are on tablets; keyboard still works).

## Anti-goals (fails even if it "works")
- "I clearly hit him and he didn't die" — hit registration that disagrees with the shooter's screen.
- Aim assist strong enough that kills don't feel earned.
- Any noticeable stutter on iPad (the current street map runs ~5 M tris/frame and lags badly; see Constraints).

## Constraints
- Runs in Safari on iPadOS; WebGL2 without `OES_texture_float_linear` (fallback already in `src/core/gpu.js`).
- Claude artifact pages block WebRTC → the game is hosted as a normal static site (**GitHub Pages**).
- `ARCHITECTURE.md` forbids new npm deps; **exception: `peerjs`** (client for the public PeerJS broker). Keep the subsystem contract (`static id/deps`, `ctx.get`, events, no per-frame allocation, deterministic RNG).
- Perf evidence driving the map/render budget (mobile preset, measured): shadows 2.89 M tris / 317 calls (58 %), prepass 0.98 M (20 %), main 1.0 M, viewmodel 0.1 M.

## Approaches (networking)
- **A. P2P over WebRTC, PeerJS public broker for the handshake — chosen.** Traffic stays on the local Wi-Fi (lowest latency), no server to run or pay for. Risk: networks that block device-to-device traffic (school/café); public broker reliability. Can swap to our own broker later.
- B. Cloud WebSocket relay (e.g. Cloudflare): works on any network, ready for remote play, but every packet crosses the internet (tens of ms) and needs a deployed server.
- C. Laptop on the Wi-Fi as server: lowest latency, but someone must run a laptop every session; users only have iPads.

## Decided design
**Systems.** Replace `world` with a new `arena` system exposing the same public API the
other systems use (`root`, `bounds`, `spawnPoints`, `spawn(i)`, `groundHeight`, `isOpen`,
`stats`, `prewarmMaterials`) plus static collision registration with `physics`. Remove `ai`
from the match build. Add `net` (PeerJS connection, messages), `match` (mode/round state
machine, loadout, scores) and `opponent` (remote player avatar, interpolation, hitboxes).
UI gains: main menu (Create / Join with code), room lobby (settings, loadout, ready),
round banner + score, results (rematch / leave), DASH button.

**Authority.** The room creator's iPad is **host**: owns match/round state, health, and
validates hits. Each client simulates its own movement and sends its state ~30 Hz; the
other side renders it ~100 ms behind with interpolation. **Shooter-side hit detection**:
the shooter raycasts against the opponent as drawn on their own screen and sends a hit
claim; the host accepts unless it is implausible (fire rate, range, ammo, line of sight
against static geometry, target alive). Host applies damage and broadcasts results.

**Hitboxes.** Head sphere + body capsule, scaled ~1.15× (touch aim is coarse). Damage:
100 HP, headshot ×2, weapon base damage from `src/weapons/defs.js` as starting values.

**Opponent avatar.** Simple stylised figure in the arena's neon style (head clearly
readable, team-colour edge glow), not the street-map soldier.

**Arena look & budget.** Flat grey boxes, emissive neon edge lines, no procedural
textures or props. Shadows reduced to what helps readability (single cascade or off)
and the depth prepass skipped when no effect consumes it. Target ≤ 150 k tris and
≤ 100 draw calls per frame including the viewmodel.

**Hosting.** Static build on GitHub Pages from the user's repo.

## Calls made by Claude (not discussed; easy to change)
- Disconnect mid-match: the remaining player sees "opponent disconnected" and returns to the menu; if the host leaves, the room closes.
- Players start each round at opposite ends of the arena and swap sides every round.
- Keyboard keeps working: DASH on `Q` (lean is removed), everything else as before.
- Working title stays "Tablet FPS" until the user names the game.

## Left to the builder
Exact arena layout (one arena: symmetric, ~30×30 m, cover and a few height levels for
slide/dash routes), message format and serialisation, interpolation details, aim-assist
curves and strengths, DASH distance/feel, round timer behaviour at 0 s (e.g. sudden
death), sounds/visual style of kill effects, menu visuals, how to show connection
errors (incl. "this Wi-Fi blocks direct connections").
