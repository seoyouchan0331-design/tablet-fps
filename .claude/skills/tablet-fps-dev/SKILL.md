---
name: tablet-fps-dev
description: How to work on the tablet-fps game repo (Three.js neon grey-box FPS for tablets, 1v1 duels and 2–8 player parties) — building or changing maps, adding gameplay systems or weapons, testing, deploying to GitHub Pages and republishing the two claude.ai artifacts. Use this whenever the task touches this repo at all — a new map, map structure fixes, stairs/rails/doors, bots, party modes, weapons, pickups, the dev panel, "deploy", "배포", "맵 만들어", "아티팩트", or any bug report about the game, even if the user doesn't name a file.
---

# tablet-fps

A tablet-first FPS: Three.js r180 + Vite, no other runtime deps (peerjs for
online play). Read `ARCHITECTURE.md` once for the engine contract (systems with
`static id/deps`, `init/update`, reach others through `ctx.get(id)`, no
per-frame allocation, `ctx.rng` instead of `Math.random`).

The user writes in Korean; reply in Korean. They want you to go ahead with your
recommended option rather than ask them to choose, except when they ask "what
next" — then list options first.

## Where things live

| area | files |
|---|---|
| map data | `src/arena/layout.js` (`MAPS`, small maps, TOWN), `canal.js`, `town.js` (kit: `flight`, `parapet`, `arcade`, `bridge`, `tower`), `shapes.js` (`building`, `prop`, `stairRails`, `mirrorPiece`, `insideXZ`, `topAt`) |
| sculpted props | `tools/blender/props.py` → GLBs → `tools/blender/glb2json.py` → `src/arena/props.json` |
| bots / walk graph | `src/party/bots.js` (`buildNav`, `findPath`, `BOT_LEVELS`) |
| party (2–8 players) | `src/party/index.js`, `rules.js` (ffa/tdm/koth/gun, `canHit`), `wire.js`, `src/net/party.js` |
| player safety | `src/player/unstuck.js` (`insideSolid`, rescue) |
| pickups | `src/world/healthpacks.js` (host decides in a match) |
| weapons | `src/weapons/` (grenades in `grenades.js`) |
| dev panel | `src/dev/panel.js` (`?dev=1`) |

## Maps

A layout is `{ size, depth?, boxes, spawns: [2], pickups?, hill?, floorColor?, grid? }`
registered in `MAPS` with `label`, `note`, optional `roundTime`.

A piece is an axis box `{x, y, z, w, h, d}` (y is the centre) plus flags:
`ry` (turn), `ramp: '+x'|'-x'|'+z'|'-z'` (rises toward that side), `prop: name`
(mesh from props.json, collider = its box), `deco` (drawn, no collision),
`hidden` (collision, not drawn), `floor` (a walkable slab; nav treats it as a
level), `wall` (perimeter), `noEdge` (no neon edge lines — use on slabs that
are carved into pieces, or seams glow), `sym` (its own twin), `shear` /`rail`
(stair handrails).

Rules that keep maps right — each one came from a bug:

- **Point symmetry.** Build one half (`X_HALF`) and add `X_HALF.map(mirror)`.
  `validateLayout` rejects a piece with no twin. Something on the centre
  (fountain, tower) gets `sym: true`.
- **Spawns** 2 of them, ≥ 24 m apart, on a clear strafe lane.
- **Walls meet slabs.** A storey wall runs the full floor height; stopping it at
  the slab's underside leaves a slot you can see and shoot through.
- **Doors never open onto stairs.** `building()` already picks the stair wall
  that keeps doors clear; keep that when adding doors.
- **Stair rails** (`stairRails`) leave the bottom 30 % of a run open, or players
  can't step on and off sideways.
- **No sunk pieces.** A prop's box inside a wall, a wall poking through a roof
  (coplanar tops z-fight). End a wall at the roof's underside.
- **Thick boxes trap players.** Physics reads a capsule wholly inside a thick
  box as free space; `insideSolid` covers this. Don't leave hollow-looking gaps
  inside solid blocks.
- **Grid alignment.** The walk graph samples a 1 m grid (`x.5` centres on most
  maps). A narrow tower or passage off the grid can vanish from it; nudge it.

### Check a map

```bash
node tools/map-audit.mjs [mapId ...]
```

It reports overlaps > 0.2 m³, floating pieces, sunk props and islands (walk
areas not connected to the main area and above mantle reach). Remaining
islands are usually roofs, tall cover and prop tops — look at what piece sits
there before "fixing" it. Islands that are a whole upper floor mean a stair
the walk graph can't see: fix the nav or the stair, because unstuck and bots
both use that graph.

For pictures: `node tools/map-shots.mjs` (see its header for options).

## Tests

```bash
node tools/test.mjs            # unit tests + the browser suites the diff touches
node tools/test.mjs --all      # every suite, before a deploy
node tools/test.mjs walk party # named suites
```

Suites: smoke, controls, duel, stall, weapons, hitreg, phone, dev, walk, party.
The machine has 4 cores and no GPU (SwiftShader), so `--all` takes ~25 min —
run it in the background. Under that load `party`, `walk` and smoke's
aim-assist check sometimes fail on timing; rerun the failed suites alone
before calling it a real failure. Don't run bare `node --test` (it picks up
`tools/test.mjs` itself and fights over port 4173).

New behaviour gets a check in the matching e2e script (`tools/*-e2e.mjs`), e.g.
a party rule in `dev-e2e.mjs` via `party.startSolo({ mode, map, bots })`.

## Ship it

Work on branch `claude/arena-setup`. After tests pass:

```bash
git add -A && git commit -m "..." && git push -u origin claude/arena-setup
git push origin claude/arena-setup:main      # GitHub Pages deploys main
node tools/artifact-build.mjs                # dist/artifact.html + artifact-dev.html, prints the files map
```

Every deploy must also republish both claude.ai artifacts (root `dist`):

- "Tablet FPS" — https://claude.ai/artifact/P6WZfDirMQ713A8sDp629w — `dist/artifact.html`
- "Tablet FPS Dev" — https://claude.ai/artifact/ET299vDhUTsnYVrKiFJXEU — `dist/artifact-dev.html`

The bundle names change every build: in the publish `files` map add the new
`assets/index-*.js` / `assets/peer-*.js` and set the previous ones to `null`
(`git show HEAD~1:...` won't tell you — the old names are the ones in your last
publish, or list the artifact's files with `scope: "files"`).

Live game: https://seoyouchan0331-design.github.io/tablet-fps/

## Image prompts

Map planning starts from concept images the user generates. Write prompts in
English. When the user has attached a reference image, the prompt names the
attachment order and what to take from it ("use attachment 1 only as the style
reference") instead of re-describing the style. Ask for: an overview
(isometric, point-symmetric), then one eye-level shot per landmark, then a prop
sheet. Review each image against gameplay (symmetry, spawn safety, sightlines,
fall risk, tablet readability) and say what you will change when building.
