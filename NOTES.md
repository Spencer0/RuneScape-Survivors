# Gielinor Survivors — design & engineering notes

Local prototype of an Azeroth Survivors–style roguelike built on the Lost City (2004scape, revision 274,
23 Nov 2004) TypeScript web client. Sections 1–2 were written before building (task §13 step 1);
later sections are the running final report.

---

## 1. Mechanics summary: Azeroth Survivors → RuneScape mapping

| Azeroth Survivors (reference) | Gielinor Survivors (this build) |
|---|---|
| Pick race, gender, class, zone; Enter starts a run | Main screen: class (Melee/Ranged/Magic), appearance via the 2004 idk body parts + 5 colour slots, zone; **Enter World** or Enter key. No login. |
| WASD real-time movement, auto-cast spells | Authentic RS: click-to-walk on the real collision map, 600 ms ticks, walk 1 tile/tick, run 2 tiles/tick with run energy. Abilities auto-fire on tick cooldowns. |
| Horde grows with the run clock | Spawn director scales count/HP/damage by run clock; spawns just inside the arena border from the zone's native roster. |
| 5 bosses at 3/6/9/12/16 min, can overlap, enrage <30% | Same schedule (configurable), real 2004 NPCs as bosses, telegraphed **tile** attacks, enrage <30% (shorter telegraphs / overlapping patterns). |
| Final boss unlocks next zone for that class only; endless mode after | Same; endless brings bosses back on a timer. |
| XP wisps that never despawn, magnet pillar | XP orbs = cache orb items (air/water/earth/fire orb by value) that never despawn; magnet pickup pulls every orb. |
| Gold → rerolls, caches | Coins (real coin stack models) → rerolls (after free ones), card skips, caches (closed chest locs, opened by walking into them with enough coins). |
| Level-up: 3 cards (new spell / rank-up / passive), rarity white→orange, luck | Run level (not RS skills). 3 cards, rarity common→legendary in RS item-name colours, luck raises rarity. Every card states exact numbers. 1/2/3 or click, R reroll, skip for coins. |
| Rarity multipliers 1.0/1.4/1.8/2.4/3.2 | Same multipliers for passive values and rank-up quality bonuses. |
| Class spell pools, capstones changing the starting spell | 3 combat-style classes, ≥8 class abilities × ≥5 ranks each, talent tree with milestones and capstones that change the starting ability. |
| — | **Skill card families**: every 2004 non-combat skill (+ Prayer) is a family of ≥3 themed cards (Firemaking fire trails, Mining shrapnel slam, …). Ranks held in a family unlock set bonuses (3 / 5 / 8). |
| Guardians in lairs, caches, rings/trinkets/amulets | Sleeping elite NPCs ("Zzz") in lairs; they and caches drop run items (rings, amulets, trinkets from the 2004 cache) that modify the build. |
| Armour caps at 60% | Armour damage reduction hard-caps at 60%. |
| Talent XP per class, bonus for classes behind; free respec | Same formula inputs (time, kills, bosses, win, zone difficulty), behind-class bonus +20%/+40%, free respec. |
| Gear per class from bosses | Metal-tier sets (bronze → rune) per class, worn on the player model, set bonuses, equipped on the main screen. |
| Account-wide rewards from achievement points | Rewards tab: extra free rerolls, Banish, Opening Hand (4 cards on first level-up), pet companion that fetches orbs/coins. ≥10 achievements. |
| Saves in browser storage, Export/Import | IndexedDB autosave, Export/Import under Options. |

## 2. Recon answers (§15)

**How the client consumes server packets, and how an in-page sim can drive it.**
`Client.tcpIn()` reads opcodes from a `ClientStream` websocket; `PLAYER_INFO` (`getPlayerPos*`) and
`NPC_INFO` (`getNpcPos*`) are bit-packed: an 8-bit count of known NPCs, per-NPC 2-bit ops
(no change / walk 1 dir / run 2 dirs / remove), new NPCs as 14-bit index + 11-bit type + **5-bit
relative dx/dz (±15 tiles)**, then an extended-info block per mask (ANIM with priority/restart rules,
HITMARK with **1-byte damage/HP**, SPOTANIM, FACEENTITY, FACESQUARE, SAY, CHANGETYPE). Each op ends in
`ClientEntity.moveCode(run, dir)` / `teleport()` / `addHitmark()` and field writes; the 50 Hz
`moveEntity → routeMove/entityFace/entityAnim` loop then interpolates 4 units/cycle walking
(8 running), i.e. one tile per 600 ms tick, which is the authentic smooth movement.
The wire format cannot express 150+ NPCs over a 64-tile arena (255 count, ±15 range) or big damage
numbers, so the simulation does **not** serialise bytes: it posts a structured `Snapshot`
(`sim/src/protocol.ts`) per tick from a Web Worker, and `client/src/survivors/Entities.ts` applies
each field with exactly the packet handler semantics (moveCode per step, ANIM priority rules,
addHitmark, spotanim timing, MAP_PROJANIM/MAP_ANIM, OBJ_ADD/DEL via the original `showObject`).

**How to load an arbitrary map region with collision and scenery, and remove interactive objects.**
`REBUILD_NORMAL` gives a centre zone; the client requests every 64×64 map square overlapping the
13×13 zone build area (104×104 tiles) from on-demand archive 3, then `mapBuild()` runs
`ClientBuild.loadGround` / `loadLocations` / `finishBuild` into `World` + per-level `CollisionMap`.
`client/src/survivors/ArenaBuild.ts` performs the same build for any arena centre, re-encoding each
loc file first to drop doors, gates, ladders, stairs and trapdoors (`sim/src/content/locfilter.ts`),
and appending themed boundary locs (fire / rocks) as a synthetic loc file. The same function runs in
Node at build time (`tools/extract.ts`) to bake the collision flags + arena mask the simulation
paths over, so render and sim can never disagree.

**Client limits on visible NPCs, draw distance and zoom, and what must change.**
- NPC array is 16384 slots (fine). `Square` holds at most **5 sprites per tile** (stacked hordes
  vanish) → raised to 48 (`Square.MAX_SPRITES`).
- Draw distance: `World.renderAll` walks **±25 tiles** using a visibility table precomputed by
  `resetVisCalc` for pitch 128–384 only, and both `World.testPoint` and `Model.worldRender` clip at
  **z ≥ 3500** (~27 tiles). → `World.drawRadius`, `World.dynamicVis` (per-frame frustum test per
  tile, any pitch), `World.farClip`.
- Zoom: camera distance is hard-wired `pitch*3+600` and pitch clamped 128–383; the viewport is a
  fixed 512×334 `areaGame`. → own camera rig (`Camera.ts`) using the same `camFollow` maths, zoom
  600–9600, pitch up to 470, rendering into a full 765×503 frame.
- The 2004 client has no fog; beyond the draw radius is black. With radius 64 the whole 104×104
  build area (and therefore every arena) is drawn, so there is no pop-in.

**How the interface system and cache sprites/fonts can build custom screens.**
`IfType` interfaces are server-opened components (layers, rects, text, sprites, models, inventories)
with `clientCode` hooks; driving them would need fake interface packets and they cannot express new
layouts without new cache data. Instead the survivors screens are drawn with the same primitives the
interface renderer uses (`Pix2D` rects/translucency, `PixFont` p11/p12/b12/q8 with `@col@` tags,
`Pix8`/`Pix32` sprites from the `media` and `title` archives: `invback` stone, `steelborder` frames,
`combatboxes` stone buttons, `scrollbar` arrows, `staticons`, `magicon`, `prayeron`, `headicons`,
`hitmarks`, `wornicons`, item sprites via `ObjType.getSprite`, player models via `ClientPlayer`).
`client/src/survivors/ui/Gfx.ts` wraps these; no HTML/CSS UI exists.

**How to render tile highlights for telegraphs.**
The original client has no tile markers. `World.fill()` draws each tile's ground
(`renderGround`/`renderQuickGround`) before that tile's walls/sprites, so a translucent quad drawn
immediately after the ground is under entities and over terrain. `World.setHighlight(x, z, rgb,
alpha)` stores per-tile colours; `renderHighlight` projects the tile's 4 height-mapped corners with
the same maths as `renderQuickGround` and fills two `Pix3D.flatTriangle`s with `Pix3D.trans`.

## 3. Client changes (all of them)

Baseline: `client/` = LostCityRS/Client-TS `274` @ `7d6ca61` (commit `49bb10b`). Every change is a
later commit; `git diff 49bb10b -- client/src/{client,config,dash3d,io,graphics}` shows them.

| File | Change |
|---|---|
| `client/Cycle.ts` (new) | The loop/draw cycle counters, split out of `Client` so entity/loc animation modules don't import the whole browser-only `Client`. `Client.loopCycle/drawCycle` became accessors onto it. |
| `dash3d/ClientLocAnim.ts`, `dash3d/ClientPlayer.ts` | Use `Cycle.loop` instead of `Client.loopCycle`. |
| `io/OnDemand.ts` | Static-bundle mode: `OnDemand.staticBundle` serves archive files from `data/cache/ondemand.bin` instead of the update-server websocket; prefetch/worker disabled in that mode; `app` typed structurally. |
| `dash3d/World.ts` | `drawRadius`, `dynamicVis` + `calcDynamicVis`, `farClip`, `setViewport`; occluder maths generalised from the hard-coded 25/50; telegraph `setHighlight` / `clearHighlights` / `renderHighlight` hook in `fill()`; sprite cap via `Square.MAX_SPRITES`. |
| `dash3d/Square.ts` | `MAX_SPRITES = 48` (was 5). |
| `dash3d/Model.ts` | Far clip uses `World.farClip` (was 3500). |
| `survivors/*` (new) | Survivors shell, assets loader, arena build, scene, entity bridge, camera, UI. |

(continued in later sections as the build progresses)
