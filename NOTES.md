# Gielinor Survivors — design & engineering notes

Local prototype of an Azeroth Survivors–style roguelike built on the Lost City (2004scape, revision 274,
23 Nov 2004) TypeScript web client. Sections 1–2 were written before building (task §13 step 1);
later sections are the running final report.

---

## 1. Mechanics summary: Azeroth Survivors → RuneScape mapping

| Azeroth Survivors (reference) | Gielinor Survivors (this build) |
|---|---|
| Pick race, gender, class, zone; Enter starts a run | Main screen: class (Melee/Ranged/Magic), zone, and a "Your hero" panel (live model in its equipped gear + gear slots). The appearance designer was dropped after play-testing (hard to read); the hero uses the saved/default 2004 idk look. **Enter World** or Enter key. No login. |
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
later commit; `git diff 49bb10b -- client/src ':!client/src/survivors'` shows them (9 files,
+316/-55). Nothing in the renderer was ripped out; changes are additive and default-off so the
original `Client` still type-checks against them.

| File | Change |
|---|---|
| `client/Cycle.ts` (new) | The loop/draw cycle counters, split out of `Client` so entity/loc animation modules don't import the browser-only `Client`. `Client.loopCycle/drawCycle` became accessors onto it. |
| `client/Client.ts` | Only the accessors above (the original client is not used by the survivors build). |
| `dash3d/ClientLocAnim.ts`, `dash3d/ClientPlayer.ts` | Use `Cycle.loop` instead of `Client.loopCycle`. |
| `io/OnDemand.ts` | Static-bundle mode: `OnDemand.staticBundle` serves archive files from `data/cache/ondemand.bin` instead of the update-server websocket; prefetch/worker disabled in that mode; `app` typed structurally. |
| `dash3d/World.ts` | `drawRadius` (64) + `dynamicVis` per-frame tile frustum test replacing the precomputed 25-tile pitch-128..384 table; `farClip`; `setViewport`; tile `bound*` box (arena + margin); occluder maths generalised from the hard-coded 25/50; telegraph (and faint clicked-destination) `setHighlight` / `clearHighlights` / `renderHighlight` (translucent quads drawn right after each tile's ground in `fill()`, i.e. under entities); sprite cap via `Square.MAX_SPRITES`. `World.lowMem` is toggled per frame at tactical zoom (the client's own average-colour ground path). |
| `dash3d/Square.ts` | `MAX_SPRITES = 48` (was 5) so stacked hordes still render. |
| `dash3d/Model.ts` | Far clip uses `World.farClip` (was 3500); `Model.minLocScreenRadius` skips scenery models that project below ~1.5-4.5 px at tactical zoom. |
| `config/NpcType.ts` | `animCacheEnabled`: animated NPC models cached per (type, primary frame, secondary frame) so a horde of identical NPCs isn't re-animated per NPC per frame. |
| `survivors/*` (new) | `SurvivorsClient` (GameShell subclass: logical resolution, unified mouse/touch input, screens; logic runs in 20 ms steps off a wall-clock accumulator so the 600 ms tick and walk/run speed hold on any display refresh rate), `Assets` (static cache loader), `ArenaBuild` (shared map build + loc filter, also used in Node), `Scene` (World/heights/objs/locs), `Entities` (snapshot application with packet semantics + the original moveEntity/routeMove/entityFace/entityAnim), `Camera`, `SimBridge`, `Appearance` (Engine-TS generateAppearance rules), `Save`, `Music`, `ui/*` (Gfx, Ui, PlayerPreview), `screens/*` (Menu, Run, Results). |

Protocol extension: instead of byte packets, the worker posts a structured `Snapshot`
(`sim/src/protocol.ts`): player steps, NPC adds/removes/moves (up to 2 steps each, run flag),
entity updates (ANIM, SPOTANIM, FACEENTITY, FACESQUARE, SAY, CHANGETYPE, hitmarks with HP/max HP of
any size), projectiles, map spotanims, ground objects, loc changes, telegraph tile sets, events
(boss spawn/death, shake, messages, victory) and HUD state. No count/range/damage limits.

## 4. Architecture

```
 main thread (client/)                                  Web Worker (sim/)
 SurvivorsClient (GameShell, 50 Hz)                     Sim (deterministic, seeded sfc32)
   MenuScreen / RunScreen / ResultsScreen                 tick(): player route + run energy
   SimBridge --- step(commands) every 600 ms --------->     flow field (BFS over collision) -> horde
             <-------------- Snapshot ------------------     abilities, hazards, pickups, guardians,
   Entities.apply (packet semantics) -> ClientNpc/Player     caches, bosses: patterns -> fairness check
   Scene (World, ClientBuild) + Camera + Pix2D UI           -> telegraphs, enrage, style switch
```

- The same `Sim` runs headless in Node (`tools/sim.ts`) with scripted bots; the browser worker can
  also run those bots (`?bot=dodger`) for demos/screenshots.
- Build time (`tools/extract.ts`): the engine-packed cache is split into static files; arena
  collision comes from the client's own `ClientBuild` run headlessly; every content reference (NPC,
  seq, spotanim, obj, loc) is validated against the 2004 cache (`sim/src/validate.ts`).
- Fairness (`sim/src/fairness.ts`): every new telegraph wave is checked with a time-expanded
  walking reachability search over the real collision map (1 tile/tick, moves applied before
  impacts, first move on the tick after the highlight appears) together with all pending impacts;
  tiles nearest the player are trimmed until a walking escape exists. The perfect-dodger bot uses
  the same search to plan its steps.

## 5. Content

- **Classes**: Melee (Slash; Whirlwind, Shatter, Puncture, Shove, Chain Axe, Impale, Rampage),
  Ranged (Shortbow; Snapshot, Crossbow Bolt, Knife Flurry, Dart Barrage, Volley, Javelin, Ogre
  Arrow), Magic (Wind Strike→Bolt→Blast→Wave; Water Bolt, Earth Blast, Fire Wave, Crumble Undead,
  Entangle, Iban Blast, God Spells, Curse). 6 ranks each, targeting rule shown on the card.
  Talents: Toughness/Ferocity/Swiftness/Scavenger/Fortunate/Veteran + class nodes, two milestones,
  two capstones per class (Whirling Blade/Executioner, Knife Master/Marksman, Pyromancer/Disciple
  of Iban) that replace the starting ability.
- **Skill families** (2004 skill list from `Skill.ts`; Slayer is unused in rev 274): Firemaking
  (Fire Trail – real fire locs on your path, Bonfire, Pyromancer), Mining (Shrapnel Slam, Gold
  Rush, Rock Skin), Woodcutting (Axe Whirl, Timber!, Lumberjack), Fishing (Harpoon Throw, Big Net,
  Fresh Catch), Fletching (Multishot, Arrow Ring, Feathering), Agility (Shortcut, Second Wind,
  Nimble), Thieving (Pickpocket, Lucky, Backstab), Cooking (Hearty Stew, Cooked Meal, Food Drops),
  Herblore (Attack Potion, Weapon Poison, Super Restore), Prayer (Protect from Melee/Missiles/
  Magic, with the real overhead icons), Smithing (Plating, Hammer Strike, Spiked Plate), Crafting
  (Jeweller, Gem Cutter, Amulet Stringing), Runecrafting (Rune Orbs, Essence Flow, Altar Pulse).
  Set bonuses at 3/6/10 total ranks, shown on the HUD.
- **Zones** (bosses at 3/6/9/12/16 min; ≥1 style switcher per zone):
  - Lumbridge (castle grounds, River Lum, ring of fire): rats, goblins, men/women, cows, giant
    spiders, thugs, barbarians, dark wizards, zombies, skeletons, ghosts, jail guards, black
    knights. Bosses: Witches experiment (4 forms), Delrith, Melzar the Mad (melee/magic/ranged),
    Black Knight Titan, **Count Draynor** (melee/magic).
  - Edgeville Dungeon (north caves; natural cave walls, rockslides): skeletons, zombies,
    hobgoblins, giant bats, chaos druids, ghosts, deadly red spiders, hill/moss giants, giant
    skeletons. Bosses: Nazastarool (3 forms), Koschei the deathless (4 lives), Tree spirit,
    Dagannoth mother (magic/ranged/melee), **Chronozon**.
  - Deep Wilderness (Demonic Ruins, ring of fire): skeletons, ghosts, dark warriors, chaos
    druids, ice/earth warriors, lesser/greater/black demons, ice giants, hellhounds, green
    dragons. Bosses: Kolodion (4 forms, melee/magic), Elvarg, Black Demon, Kalphite Queen
    (2 forms, ranged/magic), **King Black Dragon** (magic/ranged/melee breath).
- **Telegraph patterns**: single target 3×3, scattered squares, cross through the boss, parallel
  lines, expanding rings (staggered waves), falling rocks (`rockfall` spotanim), cataclysm wipes
  with safe pockets. Enrage (<30% HP): telegraphs 3→2 ticks, faster patterns, 45% chance of a second
  overlapping pattern, faster attacks, moves every tick. Telegraph impacts also hit the horde.
- **Run items** (guardians, caches, bosses): sapphire/emerald/ruby/diamond/dragonstone rings, rings
  of recoil/forging/dueling/wealth/life, amulets of accuracy/defence/magic/strength/power/glory,
  holy water, wizard's mind bomb, dragon bitter, prayer/ranging potions, magic logs, casket, super
  antipoison.
- **Pickups**: XP orbs are the 2004 air/water/earth/fire orb items by value (never despawn, merge
  per tile), coin stacks, sharks (Food Drops), the `magnet` item (pulls every orb).

## 6. Definition of done: verification (all run, not read)

| Check | How it was verified | Result |
|---|---|---|
| Clean clone → playing in ≤10 commands | Fresh `git clone` into an empty dir, then `npm install`, `npm run setup`, `npm run build`, `npm run serve` (README-SURVIVORS.md); page loaded in headless Chromium and a run started | 6 commands, 38 s setup+build, run starts |
| Zero typing, Enter World < 5 s | Playwright timing on the built site | page load → main screen 1.7 s; Enter World → playing 0.5 s |
| Tick movement + interpolation, walk/run anims, run toggle, click = walk | Scripted mouse and touch play-tests; movement uses the original `routeMove` (4/8 units per cycle); no menu code exists in the survivors client | OK |
| 150+ enemies ≥ 30 fps at max zoom, overlay | `?horde=180&bot=dodger` at zoom 9600 / pitch 470, `F` overlay (fps, render ms, sim tick ms, entities) — `docs/survivors/horde-max-zoom.png` | 30–33 fps with 184 entities in headless software Chromium (4 vCPU); sim tick 0.3–0.6 ms (worst 16 ms of 600) |
| Camera: zoom range, rotate/pitch, eased follow, shake, boss intro, auto-frame, Options | Screenshots at zoom 700…9600; boss intro captured (eased pan + quill-font name, snap back); Options sliders/toggles wired to `Camera.options` | OK |
| 3 classes, all families + sets, 3 zones, 5 bosses each, telegraphs, enrage, guardians, caches, coins, rerolls, magnets, endless | `npm run sim` (500 runs) + in-browser autoplay runs: win → endless with returning bosses verified | OK |
| Authentic 2004 UI, no HTML overlays | Every screen is drawn into the canvas with Pix2D/PixFont/cache sprites. The only DOM besides the canvas is a hidden `<input type=file>` used to open the OS file picker for Import | OK |
| Progression survives reload; mid-run reload safe; export/import | Playwright e2e in one browser context: won run → zone 2 unlocked for that class only, gear + talent XP + achievements saved; reload; reload mid-run (save byte-identical); export → modify → import → reload → restore | all pass |
| `npm run sim`: 500 runs, 0 exceptions; perfect dodger 0 telegraph damage over 100 boss fights; ignorer dies faster; balance report | `sim-out/report.md` (below) | 0 exceptions; dodger 100 fights, 0 hits; ignorer 258 hits, dies 6:50 sooner |
| Balance: untalented zone 1 dies 6:00–12:00; max-talent reaches final boss | report below | 6:32 average; 6/9 max-talent runs reached (and beat) the 16:00 final boss |
| Screenshots | `docs/survivors/` | main-screen, horde-max-zoom, levelup-cards, boss-telegraph, boss-enraged, results, talents |

## 7. Balance report (`npm run sim`, latest)

```
Runs: 500 (all classes x all zones, dodger/ignorer bots). Exceptions: 0.
Tick time: avg 0.31 ms, worst 16.4 ms (budget 600 ms). Peak horde alive: 280.

Per class (all zones, untalented)   survival  run lvl  kills  win%  bosses
  melee   167 runs                    4:31     10.4     204    2%    0.29
  ranged  167 runs                    4:17     12.5     224    1%    0.37
  magic   166 runs                    3:53     10.8     156    1%    0.22

Per zone (untalented)   Lumbridge 6:25 (3% wins) | Edgeville Dungeon 3:25 | Deep Wilderness 2:51

Telegraph study (max-talent profile so the bots reach the bosses)
  Perfect dodger (walking only): 30 runs, 100 boss fights, 82 bosses killed, telegraph hits 0, damage 0
  Telegraph ignorer:              30 runs,  44 boss fights, 18 bosses killed, telegraph hits 258, damage 10812
  Alive after the first boss: dodger 9:19, ignorer 2:29

Balance targets
  Untalented zone-1 dodger runs: average 6:32 (target 6:00-12:00)
  Debug max-talent profile, zone 1: 6/9 reached the final boss (16:00), 6 won

Most-picked sets: Prayer: Devout (13), Runecrafting: Novice Runecrafter (9), Woodcutting:
Lumberjack (8), Firemaking: Kindling (8), Fishing: Angler (6), Agility: Light Feet (5) ...
Top cards: shortbow, wind_strike, knives, slash, ogre_arrow, darts, javelin, impale, god_spells
```

Zones 2 and 3 are tuned to be cleared with progression (talents + gear); untalented runs there end
early by design. With the debug max-talent profile, Edgeville is won ~1/3 of the time and the
Wilderness ~1/4 (melee most often).

## 8. Known issues and limitations

- **Performance headroom**: max-zoom dense hordes run at ~30 fps in this test machine's headless
  software Chromium; real desktops should do better, low-end phones may drop below 30 at max zoom.
  Mitigations in place: arena bounds, scenery LOD, low-detail ground, NPC model cache.
- **Class balance**: magic survives least untalented (3:53 average vs 4:31 melee); ranged/magic
  struggle in the Wilderness even with max talents. Numbers come from bots, which don't use range
  as well as people do.
- **Bot-measured balance**: the 6–12 minute target is measured with the scripted dodger, not humans.
- **Movement details**: big NPCs (size ≥ 2, bosses) path greedily over their footprint rather than
  with a full large-entity route-finder; melee enemies may attack diagonally (RS NPCs normally
  can't); knockbacks over 2 tiles snap rather than slide.
- **Audio**: zone music plays from the cache; combat sound effects (synths) aren't hooked up yet.
- **No minimap** in the run HUD (the area is visible at tactical zoom instead).
- **Edgeville Dungeon** arena is a cave network with corridors, so hordes funnel; that's intended
  flavour but makes it the most claustrophobic zone.
- Debug URL parameters (`?debugmax`, `?horde`, `?bot`, `?speed`) are available in the shipped build.

## 9. Next steps

1. Synth sound effects for hits, spells, level-ups and boss telegraphs (`JagFX` is already loaded).
2. A run minimap built from `World.render2DGround` (the client's own minimap path).
3. Large-NPC route-finding and cardinal-only melee for authenticity.
4. Heroic difficulty / affixes, a Prayer hybrid class, controller support (stretch goals).
5. More zones from the 2004 map (Taverley Dungeon, Karamja Volcano, Varrock).
6. A static-scene cache layer for even cheaper max-zoom frames on mobile.
