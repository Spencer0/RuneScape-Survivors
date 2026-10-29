// Gielinor Survivors simulation. Deterministic (seeded RNG, no DOM, no wall-clock), one step per
// 600 ms game tick. The client (or the headless runner) feeds it Commands and renders Snapshots.
import type { EnemyRef, HitOptions, ProjectileOptions, SimApi, TargetRule } from './api.js';
import { ABILITY_BY_ID, FAMILY_BY_ID, RARITY_MULT } from './content/abilities.js';
import { CLASSES, applyGear } from './content/classes.js';
import { ENEMIES, type EnemyDef } from './content/enemies.js';
import { RUN_ITEMS, RUN_ITEM_BY_ID, type RunItemDef } from './content/items.js';
import { PATTERN_NAMES, generate, type PatternId } from './content/patterns.js';
import { DEFAULT_BOSS_MINUTES, ENDLESS_BOSS_INTERVAL, ZONE_BY_ID, type BossDef, type ZoneDef } from './content/zones.js';
import { applyOffer, describeOffer, effectiveParams, familyRanks, generateOffers, isGenericPassive, type CardInst, type Offer } from './cards.js';
import { makeFair, type Impact } from './fairness.js';
import type { ArenaData } from './content/arenas.js';
import type { Command, EntityUpdate, GameEvent, Hit, HudView, LevelUpView, LocView, MapSpotView, NpcAdd, ObjView, ProjectileView, RunResults, Snapshot, TelegraphView } from './protocol.js';
import { HIT_BLOCK, HIT_DAMAGE, HIT_POISON } from './protocol.js';
import { Rng } from './rng.js';
import { ARMOUR_CAP, COOLDOWN_CAP, TICKS_PER_MINUTE, baseStats, type GameDb, type Hazard, type Pickup, type RunLoadout, type Stats, type Style, type Telegraph } from './types.js';
import { DX, DZ, SIZE, canPlaceLarge, canStep, dirIndex, idx, isBlocked } from './world/collision.js';
import { FlowField, RouteFinder } from './world/pathing.js';

const MAX_SLOTS = 4096;
const ENERGY_MAX = 10000;

type BossState = {
    def: BossDef;
    form: number;
    enraged: boolean;
    patternTimer: number;
    styleIndex: number;
    styleTimer: number;
    final: boolean;
    patternIndex: number;
};

type Enemy = {
    slot: number;
    gen: number;
    def: EnemyDef;
    npcName: string;
    x: number;
    z: number;
    size: number;
    hp: number;
    maxHp: number;
    damage: number;
    attackSpeed: number;
    range: number;
    style: Style;
    speed: number;
    xp: number;
    atkTimer: number;
    alive: boolean;
    dying: number;
    elite: number; // 0 horde, 1 guardian, 2 boss
    sleeping: boolean;
    stun: number;
    slow: number;
    poison: number;
    poisonTicks: number;
    vuln: number;
    vulnTicks: number;
    undead: boolean;
    boss: BossState | null;
    lair: { x: number; z: number } | null;
    lastHitBy: string;
    lastHitFamily: string;
    attackAnim: number;
    deathAnim: number;
    defendAnim: number;
    projectile: number;
    impact: number;
};

type PendingHit = { tick: number; slot: number; gen: number; damage: number; opts: HitOptions };

type Buff = { id: string; ticks: number; mods: Partial<Stats> };

export type SimArena = {
    data: ArenaData;
    flags: Int32Array;
};

export function decodeArena(data: ArenaData): SimArena {
    let bytes: Uint8Array;
    if (typeof atob === 'function') {
        const bin = atob(data.flags);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
        bytes = new Uint8Array(Buffer.from(data.flags, 'base64'));
    }
    const flags = new Int32Array(bytes.buffer, bytes.byteOffset, (SIZE * SIZE) | 0).slice();
    return { data, flags };
}

export class Sim implements SimApi {
    // --- public run state ---
    tick = 0;
    clock = 0; // run time in ticks (doesn't advance while paused)
    readonly rng: Rng;
    readonly zone: ZoneDef;
    readonly loadout: RunLoadout;
    readonly classId: string;
    stats: Stats = baseStats();
    private baseStatsCache: Stats = baseStats();

    // player
    px = 0;
    pz = 0;
    private route: number[] = [];
    running = false;
    energy = ENERGY_MAX;
    hp = 100;
    maxHp = 100;
    dead = false;
    private lastSteps: number[] = [];
    private trail: number[] = [];
    level = 1;
    xp = 0;
    coins = 0;
    kills = 0;
    damageTaken = 0;
    telegraphDamage = 0;
    telegraphHits = 0;
    readonly damageBySource: Record<string, number> = {};
    readonly cards = new Map<string, CardInst>();
    readonly items: RunItemDef[] = [];
    private buffs: Buff[] = [];
    private regenTimer = 0;
    picks: string[] = [];

    // world
    private readonly arena: SimArena;
    readonly flags: Int32Array;
    private readonly db: GameDb;
    private readonly flow = new FlowField();
    private readonly router = new RouteFinder();
    private readonly enemies: (Enemy | null)[] = new Array(MAX_SLOTS).fill(null);
    private alive: Enemy[] = [];
    private freeSlots: number[] = [];
    private slotGen = new Int32Array(MAX_SLOTS);
    private readonly occupancy = new Uint16Array(SIZE * SIZE);
    private readonly pickups = new Map<number, Pickup>();
    private readonly pickupAt = new Map<number, number[]>(); // tile -> uids
    private pickupUid = 1;
    telegraphs: Telegraph[] = [];
    private hazards: Hazard[] = [];
    private readonly fireLocCount = new Map<number, number>();
    private pendingHits: PendingHit[] = [];
    private caches: { x: number; z: number; opened: boolean; cost: number }[] = [];
    private cacheCostMult = 1;
    private petSlot = -1;

    // bosses / schedule
    private readonly bossTimes: number[];
    private nextBoss = 0;
    private endlessIndex = 0;
    private nextEndlessTick = 0;
    endless = false;
    victoryPending = false;
    bossesKilled: string[] = [];
    finalBossKiller: string | null = null;
    guardiansKilled = 0;
    cachesOpened = 0;
    maxAlive = 0;

    // level-up state
    private pendingLevels = 0;
    private offer: Offer[] | null = null;
    private offerLevel = 0;
    rerolls = 0;
    private paidRerolls = 0;
    banishes = 0;
    private readonly banished = new Set<string>();
    private firstLevelUp = true;
    private gearDrops: { classId: string; tier: number; slot: string }[] = [];

    over: RunResults | null = null;

    // --- per-tick snapshot buffers ---
    private npcAdds: NpcAdd[] = [];
    private npcRemoves: number[] = [];
    private npcMoves: number[] = [];
    private updates = new Map<number, EntityUpdate>();
    private projectiles: ProjectileView[] = [];
    private mapSpots: MapSpotView[] = [];
    private objAdds: ObjView[] = [];
    private objDels: ObjView[] = [];
    private locs: LocView[] = [];
    private events: GameEvent[] = [];
    private playerAnimSet = false;

    // diagnostics
    lastTickMs = 0;

    constructor(arena: SimArena, db: GameDb, loadout: RunLoadout) {
        this.arena = arena;
        this.flags = arena.flags;
        this.db = db;
        this.loadout = loadout;
        this.classId = loadout.classId;
        this.rng = new Rng(loadout.seed);
        const zone = ZONE_BY_ID[loadout.zoneId];
        if (!zone) throw new Error(`unknown zone ${loadout.zoneId}`);
        this.zone = zone;
        this.bossTimes = (loadout.bossTimes ?? DEFAULT_BOSS_MINUTES.map(m => m * TICKS_PER_MINUTE)).slice(0, zone.bosses.length);

        for (let i = MAX_SLOTS - 1; i >= 0; i--) this.freeSlots.push(i);

        this.px = arena.data.centreLocalX;
        this.pz = arena.data.centreLocalZ;
        if (isBlocked(this.flags, this.px, this.pz)) {
            const t = this.nearestWalkable(this.px, this.pz);
            this.px = (t / SIZE) | 0;
            this.pz = t % SIZE;
        }

        // starting ability (capstones can replace it)
        const cls = CLASSES[loadout.classId];
        let start = cls.start;
        const capstone = loadout.capstone ? cls.talents.find(t => t.id === loadout.capstone && t.capstone) : null;
        if (capstone && (loadout.talents[capstone.id] ?? 0) > 0) start = capstone.capstone!;
        const def = ABILITY_BY_ID[start];
        this.cards.set(def.id, { def, rank: capstone ? 2 : 1, quality: 0, accum: 1, cooldown: 2 });

        this.rerolls = 2 + loadout.perks.rerolls + (loadout.talents[`${loadout.classId}_luckydraw`] ?? 0);
        this.banishes = loadout.perks.banish;
        this.recomputeStats();
        this.hp = this.maxHp;

        // guardians in lairs, caches
        this.zone.guardians.forEach((g, i) => {
            const tile = arena.data.lairs[i % Math.max(1, arena.data.lairs.length)];
            if (tile === undefined || i >= arena.data.lairs.length) return;
            const e = this.spawnEnemy(ENEMIES[g], (tile / SIZE) | 0, tile % SIZE, 1);
            if (e) {
                e.sleeping = true;
                e.lair = { x: e.x, z: e.z };
                const add = this.npcAdds.find(a => a.slot === e.slot);
                if (add) add.sleeping = true;
            }
        });
        for (const t of arena.data.caches.slice(0, 4)) {
            const x = (t / SIZE) | 0;
            const z = t % SIZE;
            this.caches.push({ x, z, opened: false, cost: zone.cacheCost });
            this.locs.push({ x, z, loc: this.loc('chestclosed'), shape: 10, angle: 0 });
        }

        if (loadout.perks.pet) {
            this.spawnPet();
        }

        this.event({ type: 'message', text: `Welcome to ${zone.name}. Survive!` });
    }

    // =============================================================================================
    // SimApi
    // =============================================================================================

    seq(name: string): number {
        const v = this.db.seqs[name];
        if (v === undefined) throw new Error(`missing seq ${name}`);
        return v;
    }

    spot(name: string): number {
        const v = this.db.spotanims[name];
        if (v === undefined) throw new Error(`missing spotanim ${name}`);
        return v;
    }

    obj(name: string): number {
        const v = this.db.objs[name];
        if (v === undefined) throw new Error(`missing obj ${name}`);
        return v;
    }

    loc(name: string): number {
        const v = this.db.locs[name];
        if (v === undefined) throw new Error(`missing loc ${name}`);
        return v;
    }

    targets(rule: TargetRule, range: number, count: number, x: number = this.px, z: number = this.pz, exclude?: Set<number>): EnemyRef[] {
        const cands: { e: Enemy; d: number }[] = [];
        for (const e of this.alive) {
            if (!e.alive || (e.sleeping && this.dist(e, x, z) > 3) || exclude?.has(e.slot)) continue;
            const d = this.dist(e, x, z);
            if (d <= range) cands.push({ e, d });
        }
        if (cands.length === 0) return [];
        switch (rule) {
            case 'nearest':
                cands.sort((a, b) => a.d - b.d || a.e.slot - b.e.slot);
                break;
            case 'lowest':
                cands.sort((a, b) => a.e.hp - b.e.hp || a.d - b.d);
                break;
            case 'highest':
            case 'strongest':
                cands.sort((a, b) => b.e.hp - a.e.hp || a.d - b.d);
                break;
            case 'random':
                this.rng.shuffle(cands);
                break;
        }
        return cands.slice(0, count).map(c => c.e);
    }

    inRadius(x: number, z: number, radius: number): EnemyRef[] {
        const out: Enemy[] = [];
        for (const e of this.alive) {
            if (e.alive && !e.sleeping && this.dist(e, x, z) <= radius) out.push(e);
        }
        return out;
    }

    inLine(x0: number, z0: number, x1: number, z1: number, length: number): EnemyRef[] {
        const tiles = new Set<number>();
        const dx = x1 - x0;
        const dz = z1 - z0;
        const steps = Math.max(Math.abs(dx), Math.abs(dz));
        if (steps === 0) return this.inRadius(x0, z0, 0);
        for (let i = 1; i <= length; i++) {
            const x = Math.round(x0 + (dx * i) / steps);
            const z = Math.round(z0 + (dz * i) / steps);
            tiles.add(idx(x, z));
            // 3-wide for big lines feels better; keep it 1-wide but include diagonal neighbours on steep angles
        }
        const out: Enemy[] = [];
        for (const e of this.alive) {
            if (!e.alive || e.sleeping) continue;
            let hit = false;
            for (let ix = 0; ix < e.size && !hit; ix++) for (let iz = 0; iz < e.size && !hit; iz++) hit = tiles.has(idx(e.x + ix, e.z + iz));
            if (hit) out.push(e);
        }
        return out;
    }

    nearestCluster(range: number): { x: number; z: number; count: number } | null {
        let best: { x: number; z: number; count: number } | null = null;
        const near = this.alive.filter(e => e.alive && !e.sleeping && this.dist(e, this.px, this.pz) <= range);
        for (const e of near) {
            let count = 0;
            for (const o of near) {
                if (Math.max(Math.abs(o.x - e.x), Math.abs(o.z - e.z)) <= 1) count++;
            }
            if (!best || count > best.count) best = { x: e.x, z: e.z, count };
        }
        return best;
    }

    hit(target: EnemyRef, damage: number, opts: HitOptions): void {
        const e = target as Enemy;
        const delay = opts.delay ?? 0;
        if (delay > 0) {
            this.pendingHits.push({ tick: this.tick + delay, slot: e.slot, gen: e.gen, damage, opts: { ...opts, delay: 0 } });
            return;
        }
        this.applyHit(e, damage, opts);
    }

    projectile(spot: number, to: EnemyRef | { x: number; z: number }, opts: ProjectileOptions = {}): number {
        const from = opts.from ?? 'player';
        const view: ProjectileView = {
            spot,
            fromSlot: from === 'player' ? -1 : typeof from === 'number' ? from : -2,
            fromX: typeof from === 'object' ? from.x : undefined,
            fromZ: typeof from === 'object' ? from.z : undefined,
            toSlot: 'slot' in to ? (to as Enemy).slot : -2,
            toX: to.x,
            toZ: to.z,
            startHeight: opts.startHeight ?? 40,
            endHeight: opts.endHeight ?? 36,
            delay: Math.max(0, opts.delay ?? 20),
            duration: Math.max(1, opts.duration ?? 20),
            peak: opts.peak ?? 16,
            arc: opts.arc ?? 64
        };
        this.projectiles.push(view);
        return Math.ceil((view.delay + view.duration) / 30);
    }

    playerAnim(seq: number, delay: number = 0): void {
        const u = this.upd(-1);
        u.anim = seq;
        u.animDelay = delay;
        this.playerAnimSet = true;
    }

    playerSpot(spot: number, height: number = 0, delay: number = 0): void {
        const u = this.upd(-1);
        u.spot = spot;
        u.spotHeight = height;
        u.spotDelay = delay;
    }

    mapSpot(spot: number, x: number, z: number, height: number = 0, delay: number = 0): void {
        this.mapSpots.push({ spot, x, z, height, delay });
    }

    sound(_name: string): void {
        // synth sounds are optional; names map to synth.pack entries when present
    }

    heal(amount: number): void {
        const before = this.hp;
        this.hp = Math.min(this.maxHp, this.hp + Math.round(amount));
        if (this.hp !== before) {
            const u = this.upd(-1);
            u.hp = this.hp;
            u.maxHp = this.maxHp;
        }
    }

    addHazard(tiles: number[], ticks: number, damage: number, source: string, family: string, kind: Hazard['kind'], opts: { slow?: number; fireLocs?: boolean; hitEvery?: number } = {}): void {
        const h: Hazard = { tiles: new Set(tiles), ticksLeft: ticks, damage, source, family, kind, slow: opts.slow ?? 0, locs: [], hitEvery: opts.hitEvery ?? 1, age: 0 };
        if (opts.fireLocs) {
            const fire = this.loc('fire');
            for (const t of tiles) {
                const x = (t / SIZE) | 0;
                const z = t % SIZE;
                const c = this.fireLocCount.get(t) ?? 0;
                if (c === 0) this.locs.push({ x, z, loc: fire, shape: 10, angle: 0 });
                this.fireLocCount.set(t, c + 1);
                h.locs.push({ x, z });
            }
        }
        this.hazards.push(h);
    }

    buff(id: string, ticks: number, mods: Partial<Stats>): void {
        const existing = this.buffs.find(b => b.id === id);
        if (existing) {
            existing.ticks = Math.max(existing.ticks, ticks);
            existing.mods = mods;
        } else {
            this.buffs.push({ id, ticks, mods });
        }
        this.recomputeStats(false);
    }

    hasBuff(id: string): boolean {
        return this.buffs.some(b => b.id === id);
    }

    lastMove(): { dx: number; dz: number; moved: boolean; trail: number[] } {
        const moved = this.lastSteps.length > 0;
        const d = moved ? this.lastSteps[this.lastSteps.length - 1] : -1;
        return { dx: d >= 0 ? DX[d] : 0, dz: d >= 0 ? DZ[d] : 0, moved, trail: this.trail };
    }

    walkable(x: number, z: number): boolean {
        return !isBlocked(this.flags, x, z);
    }

    enemyAttackStyle(slot: number): Style | null {
        const e = this.enemies[slot];
        return e ? e.style : null;
    }

    message(text: string): void {
        this.event({ type: 'message', text });
    }

    // =============================================================================================
    // Stats
    // =============================================================================================

    recomputeStats(full: boolean = true): void {
        if (full) {
            const s = baseStats();
            const cls = CLASSES[this.loadout.classId];
            cls.base(s);
            for (const t of cls.talents) {
                const r = this.loadout.debugMaxTalents ? t.maxRank : this.loadout.talents[t.id] ?? 0;
                if (r > 0 && (!t.capstone || this.loadout.capstone === t.id || this.loadout.debugMaxTalents)) t.apply(s, r);
            }
            applyGear(s, this.loadout.classId, this.loadout.gear);
            for (const inst of this.cards.values()) {
                if (inst.def.kind === 'passive' && inst.def.apply) inst.def.apply(s, effectiveParams(inst));
            }
            for (const [fam, ranks] of familyRanks(this.cards)) {
                for (const set of FAMILY_BY_ID[fam].sets) {
                    if (ranks >= set.at) set.apply(s);
                }
            }
            for (const item of this.items) item.apply(s);
            this.baseStatsCache = s;
        }
        const s: Stats = { ...this.baseStatsCache };
        for (const b of this.buffs) {
            for (const [k, v] of Object.entries(b.mods)) (s as Record<string, number>)[k] += v as number;
        }
        s.armour = Math.min(ARMOUR_CAP, Math.max(0, s.armour));
        s.cooldown = Math.min(COOLDOWN_CAP, Math.max(0, s.cooldown));
        s.protectMelee = Math.min(0.8, s.protectMelee);
        s.protectRanged = Math.min(0.8, s.protectRanged);
        s.protectMagic = Math.min(0.8, s.protectMagic);
        s.dodge = Math.min(0.5, s.dodge);
        s.crit = Math.min(1, s.crit);
        this.stats = s;
        const oldMax = this.maxHp;
        this.maxHp = Math.max(10, Math.round(s.maxHp));
        if (this.maxHp > oldMax && oldMax > 0) {
            this.hp += this.maxHp - oldMax;
        }
        this.hp = Math.min(this.hp, this.maxHp);
    }

    // =============================================================================================
    // Commands + tick
    // =============================================================================================

    get paused(): boolean {
        return this.offer !== null || this.victoryPending || this.over !== null;
    }

    step(commands: Command[]): Snapshot {
        const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
        for (const cmd of commands) this.command(cmd);

        if (!this.paused) {
            this.tick++;
            this.clock++;
            this.processTick();
        }

        if (this.offer === null && this.pendingLevels > 0 && !this.over) {
            this.makeOffer();
        }

        const snap = this.snapshot();
        this.lastTickMs = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
        return snap;
    }

    private command(cmd: Command): void {
        switch (cmd.type) {
            case 'walk': {
                if (this.dead || this.over) return;
                const tx = Math.max(0, Math.min(SIZE - 1, cmd.x | 0));
                const tz = Math.max(0, Math.min(SIZE - 1, cmd.z | 0));
                this.route = this.router.find(this.flags, this.px, this.pz, tx, tz, 12);
                break;
            }
            case 'run':
                this.running = cmd.on && this.energy > 0;
                break;
            case 'pick': {
                if (!this.offer) return;
                const o = this.offer[cmd.index];
                if (!o) return;
                this.takeOffer(o);
                break;
            }
            case 'reroll': {
                if (!this.offer) return;
                if (this.rerolls > 0) {
                    this.rerolls--;
                } else {
                    const cost = this.rerollCost();
                    if (this.coins < cost) return;
                    this.coins -= cost;
                    this.paidRerolls++;
                }
                this.offer = generateOffers(this.rng, this.classId, this.cards, this.banished, this.stats.luck, this.offer.length);
                break;
            }
            case 'skip': {
                if (!this.offer) return;
                this.coins += this.skipCoins();
                this.offer = null;
                this.pendingLevels--;
                break;
            }
            case 'banish': {
                if (!this.offer || this.banishes <= 0) return;
                const o = this.offer[cmd.index];
                if (!o || o.kind === 'heal' || o.kind === 'coins') return;
                this.banishes--;
                this.banished.add(o.id);
                this.offer = generateOffers(this.rng, this.classId, this.cards, this.banished, this.stats.luck, this.offer.length);
                break;
            }
            case 'endless':
                if (!this.victoryPending) return;
                this.victoryPending = false;
                if (cmd.on) {
                    this.endless = true;
                    this.nextEndlessTick = this.clock + ENDLESS_BOSS_INTERVAL;
                    this.event({ type: 'message', text: 'Endless mode: the bosses will return...' });
                } else {
                    this.finish(true);
                }
                break;
            case 'quit':
                if (!this.over) this.finish(this.bossesKilled.length >= this.zone.bosses.length);
                break;
        }
    }

    rerollCost(): number {
        return 25 + this.paidRerolls * 25;
    }

    skipCoins(): number {
        return 10 + this.level * 2;
    }

    private takeOffer(o: Offer): void {
        if (o.kind === 'heal') {
            this.heal(this.maxHp * 0.3 * RARITY_MULT[o.rarity]);
        } else if (o.kind === 'coins') {
            this.coins += Math.round(40 * RARITY_MULT[o.rarity]);
        } else {
            applyOffer(o, this.cards);
            this.picks.push(o.id);
            this.recomputeStats();
        }
        this.offer = null;
        this.pendingLevels--;
    }

    private makeOffer(): void {
        const count = this.firstLevelUp && this.loadout.perks.openingHand ? 4 : 3;
        this.firstLevelUp = false;
        this.offer = generateOffers(this.rng, this.classId, this.cards, this.banished, this.stats.luck, count);
        this.offerLevel = this.level - this.pendingLevels + 1;
    }

    private processTick(): void {
        this.trail = [];
        this.lastSteps = [];
        this.playerAnimSet = false;

        this.movePlayer();
        this.collectPickups();
        this.flow.compute(this.flags, this.px, this.pz);
        this.moveEnemies();
        this.updatePet();
        this.bossAi();
        this.resolveTelegraphs();
        this.castAbilities();
        this.resolvePendingHits();
        this.tickHazards();
        this.tickStatus();
        this.tickDying();
        this.tickBuffs();
        this.spawnDirector();
        this.bossSchedule();
        this.checkCaches();

        let horde = 0;
        for (const e of this.alive) if (e.alive && e.elite === 0) horde++;
        this.maxAlive = Math.max(this.maxAlive, horde);
    }

    // =============================================================================================
    // Player
    // =============================================================================================

    private movePlayer(): void {
        if (this.dead) return;
        const wantRun = this.running && this.energy > 0;
        const steps = wantRun && this.route.length >= 2 ? 2 : this.route.length > 0 ? 1 : 0;
        for (let s = 0; s < steps; s++) {
            const next = this.route.shift()!;
            const nx = (next / SIZE) | 0;
            const nz = next % SIZE;
            const dx = nx - this.px;
            const dz = nz - this.pz;
            if (Math.abs(dx) > 1 || Math.abs(dz) > 1 || !canStep(this.flags, this.px, this.pz, dx, dz)) {
                this.route = [];
                break;
            }
            this.trail.push(idx(this.px, this.pz));
            this.px = nx;
            this.pz = nz;
            this.lastSteps.push(dirIndex(dx, dz));
        }

        if (this.lastSteps.length === 2) {
            this.energy = Math.max(0, this.energy - Math.round(70 * (1 - Math.min(0.85, this.stats.energyDrain))));
            if (this.energy === 0) this.running = false;
        } else {
            this.energy = Math.min(ENERGY_MAX, this.energy + Math.round(32 * (1 + this.stats.energyRegen) * (this.lastSteps.length === 0 ? 1.25 : 1)));
        }
    }

    private damagePlayer(raw: number, style: Style, source: Enemy | null, fromTelegraph: boolean): void {
        if (this.dead || raw <= 0) return;
        if (!fromTelegraph && this.rng.chance(this.stats.dodge)) {
            this.addPlayerHit(0, HIT_BLOCK);
            return;
        }
        let dmg = raw;
        if (!fromTelegraph) dmg *= 1 - this.stats.armour;
        else dmg *= 1 - this.stats.armour * 0.5;
        const protect = style === 'melee' ? this.stats.protectMelee : style === 'ranged' ? this.stats.protectRanged : this.stats.protectMagic;
        dmg *= 1 - protect;
        const final = Math.max(1, Math.round(dmg));
        this.hp -= final;
        this.damageTaken += final;
        const src = fromTelegraph ? 'telegraph' : source?.boss ? 'boss' : source && source.range > 1 ? 'horde-ranged' : 'horde-melee';
        this.damageBySource[src] = (this.damageBySource[src] ?? 0) + final;
        if (fromTelegraph) {
            this.telegraphDamage += final;
            this.telegraphHits++;
        }
        this.addPlayerHit(final, HIT_DAMAGE);

        if (source && this.stats.thorns > 0 && source.alive) {
            this.applyHit(source, Math.max(1, Math.round(final * this.stats.thorns)), { source: 'thorns', family: 'smithing', noCrit: true });
        }

        if (this.hp <= 0) {
            if (this.stats.revive > 0) {
                this.baseStatsCache.revive -= 1;
                this.stats.revive -= 1;
                this.hp = Math.round(this.maxHp / 2);
                this.playerSpot(this.spot('levelup_anim'));
                this.event({ type: 'message', text: 'You are saved from death!', colour: 0x00ff00 });
                const u = this.upd(-1);
                u.hp = this.hp;
            } else {
                this.hp = 0;
                this.dead = true;
                this.playerAnim(this.seq('human_death'));
                this.event({ type: 'death' });
                this.finish(false);
            }
        }
    }

    private addPlayerHit(dmg: number, type: number): void {
        const u = this.upd(-1);
        (u.hits ??= []).push({ dmg, type });
        u.hp = Math.max(0, this.hp);
        u.maxHp = this.maxHp;
    }

    // =============================================================================================
    // Abilities
    // =============================================================================================

    private castAbilities(): void {
        if (this.dead) return;
        const cdMult = 1 - this.stats.cooldown;
        for (const inst of this.cards.values()) {
            if (inst.def.kind !== 'active' || !inst.def.cast) continue;
            if (--inst.cooldown > 0) continue;
            const p = effectiveParams(inst);
            const fired = inst.def.cast(this, p, inst.rank);
            inst.cooldown = fired ? Math.max(1, Math.round(p.cooldown * cdMult)) : 1;
        }
        // HP regen
        if (++this.regenTimer >= 10) {
            this.regenTimer = 0;
            if (this.stats.regen > 0 && this.hp < this.maxHp) this.heal(this.stats.regen);
        }
    }

    private resolvePendingHits(): void {
        if (this.pendingHits.length === 0) return;
        const keep: PendingHit[] = [];
        for (const h of this.pendingHits) {
            if (h.tick > this.tick) {
                keep.push(h);
                continue;
            }
            const e = this.enemies[h.slot];
            if (e && e.gen === h.gen && e.alive) this.applyHit(e, h.damage, h.opts);
        }
        this.pendingHits = keep;
    }

    private applyHit(e: Enemy, base: number, opts: HitOptions): void {
        if (!e.alive) return;
        const s = this.stats;
        const tags = opts.tags ?? [];
        let dmg = base * (1 + s.damage);
        if (tags.includes('fire')) dmg *= 1 + s.burn;
        if (e.elite > 0 || e.size >= 3) dmg *= 1 + s.bossDamage;
        if (e.undead) dmg *= 1 + s.undeadDamage;
        if (e.vulnTicks > 0) dmg *= 1 + e.vuln;
        let crit = false;
        if (!opts.noCrit && this.rng.chance(s.crit)) {
            crit = true;
            dmg *= s.critMult;
        }
        const final = Math.max(1, Math.round(dmg));
        e.hp -= final;
        e.lastHitBy = opts.source;
        e.lastHitFamily = opts.family;

        const u = this.upd(e.slot);
        (u.hits ??= []).push({ dmg: final, type: tags.includes('poison') ? HIT_POISON : HIT_DAMAGE });
        u.hp = Math.max(0, e.hp);
        u.maxHp = e.maxHp;
        if (opts.spot !== undefined) {
            u.spot = opts.spot;
            u.spotHeight = opts.spotHeight ?? 0;
        }
        void crit;

        if (e.sleeping) this.wake(e);

        if (opts.stun) e.stun = Math.max(e.stun, e.elite === 2 ? Math.min(1, opts.stun) : opts.stun);
        if (opts.slow) e.slow = Math.max(e.slow, opts.slow);
        if (opts.vuln) {
            e.vuln = Math.max(e.vuln, opts.vuln);
            e.vulnTicks = 10;
        }
        const poison = (opts.poison ?? 0) + (opts.source !== 'poison' && opts.source !== 'thorns' ? s.poison : 0);
        if (poison > 0) {
            e.poison = Math.max(e.poison, poison);
            e.poisonTicks = 5;
        }
        if (opts.knockback && e.elite < 2) this.knockback(e, opts.knockback + s.knockback);
        if (s.lifesteal > 0) this.heal(final * s.lifesteal);

        if (e.hp <= 0) this.kill(e);
    }

    private knockback(e: Enemy, tiles: number): void {
        const dx = Math.sign(e.x - this.px);
        const dz = Math.sign(e.z - this.pz);
        if (dx === 0 && dz === 0) return;
        let moved = 0;
        for (let i = 0; i < tiles; i++) {
            if (e.size === 1 ? !canStep(this.flags, e.x, e.z, dx, dz) : !canPlaceLarge(this.flags, e.x + dx, e.z + dz, e.size)) break;
            e.x += dx;
            e.z += dz;
            moved++;
        }
        if (moved > 0) {
            // short knockbacks slide (run steps); long ones snap like a teleport
            const dir = dirIndex(dx, dz);
            if (moved <= 2) this.npcMoves.push(e.slot, e.x, e.z, moved, dir, dir, 1);
            else this.npcMoves.push(e.slot, e.x, e.z, 0, 0, 0, 0);
        }
    }

    // =============================================================================================
    // Enemies
    // =============================================================================================

    private dist(e: Enemy, x: number, z: number): number {
        // Chebyshev distance from the enemy footprint to a tile
        const dx = x < e.x ? e.x - x : x > e.x + e.size - 1 ? x - (e.x + e.size - 1) : 0;
        const dz = z < e.z ? e.z - z : z > e.z + e.size - 1 ? z - (e.z + e.size - 1) : 0;
        return Math.max(dx, dz);
    }

    private allocSlot(): number {
        const s = this.freeSlots.pop();
        return s === undefined ? -1 : s;
    }

    private spawnEnemy(def: EnemyDef, x: number, z: number, elite: number, boss: BossDef | null = null): Enemy | null {
        const slot = this.allocSlot();
        if (slot < 0) return null;
        const npcName = boss ? boss.forms[0].npc : def.npc;
        const npc = this.db.npcs[npcName];
        if (!npc) throw new Error(`missing npc ${npcName}`);
        const minutes = this.clock / TICKS_PER_MINUTE;
        const diff = this.zone.difficulty;
        let hp: number;
        let damage: number;
        if (boss) {
            const endlessScale = this.endless ? 1 + this.endlessIndex * 0.35 : 1;
            hp = Math.round(boss.hp * diff * endlessScale);
            damage = Math.round(boss.damage * 0.6 * Math.pow(diff, 0.8) * endlessScale);
        } else {
            const hpScale = diff * (1 + 0.16 * minutes + 0.012 * minutes * minutes) * (this.endless ? 1.5 + this.endlessIndex * 0.25 : 1);
            const dmgScale = 0.65 * Math.pow(diff, 0.8) * (1 + 0.075 * minutes) * (this.endless ? 1.3 + this.endlessIndex * 0.1 : 1);
            hp = Math.round(def.hp * hpScale * (elite === 1 ? 9 : 1));
            // ranged/magic attackers can't be kited out of range, so they hit softer
            damage = Math.round(def.damage * dmgScale * (elite === 1 ? 1.25 : 1) * (def.range > 1 ? 0.6 : 1));
        }

        this.slotGen[slot]++;
        const attackAnim = def.attackAnim ? this.seq(def.attackAnim) : npc.attackAnim;
        const deathAnim = def.deathAnim ? this.seq(def.deathAnim) : npc.deathAnim;
        const e: Enemy = {
            slot,
            gen: this.slotGen[slot],
            def,
            npcName,
            x,
            z,
            size: npc.size,
            hp,
            maxHp: hp,
            damage,
            attackSpeed: boss ? boss.attackSpeed + 1 : def.attackSpeed + (def.range > 1 ? 2 : 1),
            range: boss ? boss.range : def.range,
            style: boss ? boss.forms[0].style : def.style,
            speed: def.speed,
            xp: Math.round(def.xp * (1 + minutes * 0.08) * (elite === 1 ? 12 : 1)),
            atkTimer: 2,
            alive: true,
            dying: 0,
            elite: boss ? 2 : elite,
            sleeping: false,
            stun: 0,
            slow: 0,
            poison: 0,
            poisonTicks: 0,
            vuln: 0,
            vulnTicks: 0,
            undead: !!def.undead,
            boss: null,
            lair: null,
            lastHitBy: '',
            lastHitFamily: '',
            attackAnim,
            deathAnim,
            defendAnim: npc.defendAnim,
            projectile: def.projectile ? this.spot(def.projectile) : -1,
            impact: def.impact ? this.spot(def.impact) : -1
        };
        this.enemies[slot] = e;
        this.alive.push(e);
        this.npcAdds.push({ slot, npc: npc.id, x, z, hp, maxHp: hp, elite: e.elite, sleeping: false });
        return e;
    }

    private wake(e: Enemy): void {
        e.sleeping = false;
        const u = this.upd(e.slot);
        u.say = 'Grrr!';
        this.event({ type: 'message', text: `A guardian ${this.db.npcs[e.npcName]?.name ?? 'monster'} awakens!`, colour: 0xff981f });
    }

    private moveEnemies(): void {
        const occ = this.occupancy;
        occ.fill(0);
        for (const e of this.alive) if (e.alive) occ[idx(e.x, e.z)]++;

        for (const e of this.alive) {
            if (!e.alive || e.sleeping) {
                if (e.sleeping && this.dist(e, this.px, this.pz) <= 4) this.wake(e);
                continue;
            }
            if (e.stun > 0) {
                e.stun--;
                continue;
            }
            e.atkTimer--;
            if (e.lair && Math.max(Math.abs(this.px - e.lair.x), Math.abs(this.pz - e.lair.z)) > 12) {
                // guardians are optional: outrun them and they return to their lair and sleep
                this.returnToLair(e, occ);
                continue;
            }
            const d = this.dist(e, this.px, this.pz);
            const range = e.boss ? this.bossRange(e) : e.range;
            if (d <= range && !this.dead) {
                // in range: attack on the enemy's own attack-speed cycle, otherwise hold position
                if (e.atkTimer <= 0) this.enemyAttack(e);
                continue;
            }

            let speed = e.speed;
            if (e.boss && !e.boss.enraged && (this.tick & 1) === 1) continue; // bosses lumber; telegraphs are the threat
            if (e.slow > 0) {
                e.slow--;
                if ((this.tick & 1) === 0) continue;
                speed = 1;
            }
            for (let s = 0; s < speed; s++) {
                if (!this.stepEnemy(e, occ)) break;
                if (this.dist(e, this.px, this.pz) <= range) break;
            }
        }
    }

    private returnToLair(e: Enemy, occ: Uint16Array): void {
        const lair = e.lair!;
        if (e.x === lair.x && e.z === lair.z) {
            e.sleeping = true;
            e.hp = e.maxHp;
            const u = this.upd(e.slot);
            u.say = 'Zzz';
            u.hp = e.hp;
            return;
        }
        const dx = Math.sign(lair.x - e.x);
        const dz = Math.sign(lair.z - e.z);
        const ok = e.size === 1 ? canStep(this.flags, e.x, e.z, dx, dz) : canPlaceLarge(this.flags, e.x + dx, e.z + dz, e.size);
        if (!ok) {
            // no straight path home: teleport back (rarely needed)
            this.npcMoves.push(e.slot, lair.x, lair.z, 0, 0, 0, 0);
            occ[idx(e.x, e.z)]--;
            e.x = lair.x;
            e.z = lair.z;
            occ[idx(e.x, e.z)]++;
            return;
        }
        occ[idx(e.x, e.z)]--;
        e.x += dx;
        e.z += dz;
        occ[idx(e.x, e.z)]++;
        this.npcMoves.push(e.slot, e.x, e.z, 1, dirIndex(dx, dz), 0, 0);
    }

    private stepEnemy(e: Enemy, occ: Uint16Array): boolean {
        const ox = e.x;
        const oz = e.z;
        let bestDir = -1;
        let bestScore = 1 << 30;

        if (e.size === 1) {
            const here = this.flow.at(e.x, e.z);
            for (let d = 0; d < 8; d++) {
                if (!canStep(this.flags, e.x, e.z, DX[d], DZ[d])) continue;
                const nx = e.x + DX[d];
                const nz = e.z + DZ[d];
                const fd = this.flow.at(nx, nz);
                if (fd === FlowField.UNREACHABLE) continue;
                // move downhill; sideways steps allowed into empty tiles to spread around the player.
                // stacking is allowed but capped so the horde forms a crowd rather than one pile
                const o = occ[idx(nx, nz)];
                if (fd > here || (fd === here && o > 0) || (o >= 2 && fd > 1)) continue;
                const score = fd * 8 + occ[idx(nx, nz)] * 5 + (fd === here ? 6 : 0) + (DX[d] !== 0 && DZ[d] !== 0 ? 1 : 0);
                if (score < bestScore) {
                    bestScore = score;
                    bestDir = d;
                }
            }
        } else {
            // large npcs: greedy towards the player over footprints that fit
            const cx = this.px;
            const cz = this.pz;
            for (let d = 0; d < 8; d++) {
                const nx = e.x + DX[d];
                const nz = e.z + DZ[d];
                if (!canPlaceLarge(this.flags, nx, nz, e.size)) continue;
                const ddx = cx < nx ? nx - cx : cx > nx + e.size - 1 ? cx - (nx + e.size - 1) : 0;
                const ddz = cz < nz ? nz - cz : cz > nz + e.size - 1 ? cz - (nz + e.size - 1) : 0;
                const score = Math.max(ddx, ddz) * 10 + Math.min(ddx, ddz) + (ddx === 0 && ddz === 0 ? 100 : 0);
                if (score < bestScore) {
                    bestScore = score;
                    bestDir = d;
                }
            }
            if (bestDir >= 0) {
                const cur = this.dist(e, cx, cz);
                const nx = e.x + DX[bestDir];
                const nz = e.z + DZ[bestDir];
                const ddx = cx < nx ? nx - cx : cx > nx + e.size - 1 ? cx - (nx + e.size - 1) : 0;
                const ddz = cz < nz ? nz - cz : cz > nz + e.size - 1 ? cz - (nz + e.size - 1) : 0;
                if (Math.max(ddx, ddz) > cur || (ddx === 0 && ddz === 0)) bestDir = -1;
            }
        }

        if (bestDir < 0) return false;
        occ[idx(e.x, e.z)]--;
        e.x += DX[bestDir];
        e.z += DZ[bestDir];
        occ[idx(e.x, e.z)]++;

        // record the step for the client: merge with an earlier step this tick (run = 2 steps)
        const n = this.npcMoves.length;
        if (n >= 7 && this.npcMoves[n - 7] === e.slot && this.npcMoves[n - 4] === 1) {
            this.npcMoves[n - 6] = e.x;
            this.npcMoves[n - 5] = e.z;
            this.npcMoves[n - 4] = 2;
            this.npcMoves[n - 2] = bestDir;
            this.npcMoves[n - 1] = 1;
        } else {
            this.npcMoves.push(e.slot, e.x, e.z, 1, bestDir, 0, 0);
        }
        void ox;
        void oz;
        return true;
    }

    private enemyAttack(e: Enemy): void {
        e.atkTimer = e.attackSpeed;
        const u = this.upd(e.slot);
        let anim = e.attackAnim;
        let projectile = e.projectile;
        let impact = e.impact;
        if (e.boss) {
            const st = e.style;
            const b = e.boss.def;
            if (b.attackAnim?.[st]) anim = this.seq(b.attackAnim[st]!);
            projectile = b.projectile?.[st] ? this.spot(b.projectile[st]!) : -1;
            impact = b.impact?.[st] ? this.spot(b.impact[st]!) : -1;
        }
        if (anim >= 0) u.anim = anim;
        u.face = 32768;
        const ranged = e.style !== 'melee' && this.dist(e, this.px, this.pz) > 1;
        if (ranged && projectile >= 0) {
            const flight = this.projectile(projectile, { x: this.px, z: this.pz }, { from: e.slot, startHeight: 43, endHeight: 31, delay: 30, duration: 30, peak: 16, arc: 64 });
            void flight;
            const pu = this.upd(-1);
            if (impact >= 0) {
                pu.spot = impact;
                pu.spotHeight = 100;
                pu.spotDelay = 50;
            }
        }
        const dmg = this.rng.range(Math.max(1, Math.round(e.damage * 0.4)), e.damage);
        this.damagePlayer(dmg, e.style, e, false);
    }

    private tickStatus(): void {
        for (const e of this.alive) {
            if (!e.alive) continue;
            if (e.vulnTicks > 0) e.vulnTicks--;
            if (e.poisonTicks > 0) {
                e.poisonTicks--;
                this.applyHit(e, e.poison, { source: 'poison', family: 'herblore', tags: ['poison'], noCrit: true });
            }
        }
    }

    private kill(e: Enemy): void {
        if (!e.alive) return;
        e.alive = false;
        e.dying = 2;
        e.hp = 0;
        this.kills++;
        const u = this.upd(e.slot);
        if (e.deathAnim >= 0) u.anim = e.deathAnim;
        u.dying = true;
        u.hp = 0;

        // drops
        const xp = Math.max(1, Math.round(e.xp));
        this.dropPickup(e.x, e.z, 'xp', xp);
        const coinChance = (e.def.coinChance ?? 0.18) + this.stats.coinOnKill + (e.elite > 0 ? 1 : 0);
        if (this.rng.chance(coinChance)) {
            const minutes = this.clock / TICKS_PER_MINUTE;
            const amount = Math.max(1, Math.round(this.rng.range(1, 4) * (1 + minutes * 0.15) * (1 + this.stats.coins) * (e.elite > 0 ? 15 : 1)));
            this.dropPickup(e.x + (e.size > 1 ? 1 : 0), e.z, 'coins', amount);
        }
        if (this.stats.foodDrop > 0 && this.rng.chance(this.stats.foodDrop)) {
            this.dropPickup(e.x, e.z + (e.size > 1 ? 1 : 0), 'food', 20);
        }
        if (e.elite === 0 && this.rng.chance(0.0025) && ![...this.pickups.values()].some(p => p.kind === 'magnet')) {
            this.dropPickup(e.x, e.z, 'magnet', 0);
        }
        if (this.stats.explodeOnKill > 0) {
            const blast = Math.round(e.maxHp * this.stats.explodeOnKill);
            this.mapSpot(this.spot('firestrike_impact'), e.x, e.z, 0, 0);
            for (const n of this.inRadius(e.x, e.z, 1) as Enemy[]) {
                if (n !== e) this.applyHit(n, blast, { source: 'inferno', family: 'firemaking', tags: ['fire', 'aoe'], noCrit: true });
            }
        }

        if (e.elite === 1) {
            this.guardiansKilled++;
            this.grantItem(e.x, e.z, 1);
        }
        if (e.boss) this.bossKilled(e);
    }

    private tickDying(): void {
        let anyRemoved = false;
        for (const e of this.alive) {
            if (e.alive) continue;
            if (--e.dying <= 0) {
                this.npcRemoves.push(e.slot);
                this.enemies[e.slot] = null;
                this.freeSlots.push(e.slot);
                anyRemoved = true;
            }
        }
        if (anyRemoved) this.alive = this.alive.filter(e => this.enemies[e.slot] === e);
    }

    // =============================================================================================
    // Pickups
    // =============================================================================================

    private orbObj(value: number): number {
        if (value >= 40) return this.obj('fire_orb');
        if (value >= 15) return this.obj('earth_orb');
        if (value >= 5) return this.obj('water_orb');
        return this.obj('air_orb');
    }

    private dropPickup(x: number, z: number, kind: Pickup['kind'], value: number, item?: string): void {
        if (isBlocked(this.flags, x, z)) {
            const t = this.nearestWalkable(x, z);
            x = (t / SIZE) | 0;
            z = t % SIZE;
        }
        const tile = idx(x, z);
        // merge xp orbs / coins on the same tile so the ground stays readable and cheap
        if (kind === 'xp' || kind === 'coins') {
            for (const uid of this.pickupAt.get(tile) ?? []) {
                const p = this.pickups.get(uid)!;
                if (p.kind === kind) {
                    const oldObj = p.obj;
                    p.value += value;
                    const newObj = kind === 'xp' ? this.orbObj(p.value) : p.obj;
                    if (newObj !== oldObj || kind === 'coins') {
                        this.objDels.push({ uid: p.uid, x, z, obj: oldObj, count: 1 });
                        p.obj = newObj;
                        p.uid = this.pickupUid++;
                        this.pickups.delete(uid);
                        this.pickups.set(p.uid, p);
                        const list = this.pickupAt.get(tile)!;
                        list[list.indexOf(uid)] = p.uid;
                        this.objAdds.push({ uid: p.uid, x, z, obj: p.obj, count: kind === 'coins' ? p.value : 1 });
                    }
                    return;
                }
            }
        }
        const obj = kind === 'xp' ? this.orbObj(value) : kind === 'coins' ? this.obj('coins') : kind === 'food' ? this.obj('shark') : kind === 'magnet' ? this.obj('magnet') : this.obj(RUN_ITEM_BY_ID[item!].obj);
        const p: Pickup = { uid: this.pickupUid++, x, z, kind, value, obj, item, pulled: false };
        this.pickups.set(p.uid, p);
        const list = this.pickupAt.get(tile) ?? [];
        list.push(p.uid);
        this.pickupAt.set(tile, list);
        this.objAdds.push({ uid: p.uid, x, z, obj, count: kind === 'coins' ? value : 1 });
    }

    private removePickup(p: Pickup): void {
        this.pickups.delete(p.uid);
        const tile = idx(p.x, p.z);
        const list = this.pickupAt.get(tile);
        if (list) {
            const i = list.indexOf(p.uid);
            if (i >= 0) list.splice(i, 1);
            if (list.length === 0) this.pickupAt.delete(tile);
        }
        this.objDels.push({ uid: p.uid, x: p.x, z: p.z, obj: p.obj, count: 1 });
    }

    private collectPickups(): void {
        if (this.dead) return;
        const r = Math.floor(this.stats.pickup);
        for (let x = this.px - r; x <= this.px + r; x++) {
            for (let z = this.pz - r; z <= this.pz + r; z++) {
                const list = this.pickupAt.get(idx(x, z));
                if (!list) continue;
                for (const uid of [...list]) {
                    // a magnet collected earlier in this loop may already have taken it
                    const p = this.pickups.get(uid);
                    if (p) this.collect(p);
                }
            }
        }
    }

    private collect(p: Pickup): void {
        this.removePickup(p);
        switch (p.kind) {
            case 'xp':
                this.gainXp(p.value);
                break;
            case 'coins':
                this.coins += p.value;
                break;
            case 'food':
                this.heal(this.maxHp * 0.2);
                this.event({ type: 'message', text: 'You eat the shark. It heals some health.' });
                break;
            case 'magnet':
                this.event({ type: 'message', text: 'The magnet pulls in every orb!', colour: 0x00ffff });
                this.playerSpot(this.spot('telegrab_casting'));
                for (const q of [...this.pickups.values()]) if (q.kind === 'xp' && this.pickups.has(q.uid)) this.collect(q);
                break;
            case 'item':
                break;
        }
    }

    private gainXp(v: number): void {
        this.xp += v * (1 + this.stats.xp);
        while (this.xp >= this.xpNext()) {
            this.xp -= this.xpNext();
            this.level++;
            this.pendingLevels++;
            this.playerSpot(this.spot('levelup_anim'));
            this.event({ type: 'levelUp', level: this.level });
            if (this.stats.healOnLevel > 0) this.heal(this.maxHp * this.stats.healOnLevel);
        }
    }

    xpNext(): number {
        const L = this.level;
        return Math.round(5 + 3 * L + 0.3 * L * L);
    }

    private grantItem(x: number, z: number, rarityBoost: number): void {
        const find = this.stats.itemFind;
        const owned = new Set(this.items.map(i => i.id));
        const pool = RUN_ITEMS.filter(i => !owned.has(i.id));
        if (pool.length === 0) return;
        const item = this.rng.weighted(pool, i => Math.pow(0.5, Math.max(0, i.rarity - rarityBoost - find * 2)));
        this.items.push(item);
        this.recomputeStats();
        this.mapSpot(this.spot('levelup_anim'), x, z, 0, 0);
        this.event({ type: 'cacheOpened', x, z, item: item.name });
        this.event({ type: 'message', text: `You receive: ${item.name} (${item.desc})`, colour: 0xff981f });
    }

    private checkCaches(): void {
        for (const c of this.caches) {
            if (c.opened) continue;
            if (Math.max(Math.abs(c.x - this.px), Math.abs(c.z - this.pz)) > 1) continue;
            const cost = Math.round(c.cost * this.cacheCostMult);
            if (this.coins < cost) {
                if ((this.tick % 10) === 0) this.event({ type: 'message', text: `This cache needs ${cost} coins to open.` });
                continue;
            }
            this.coins -= cost;
            c.opened = true;
            this.cachesOpened++;
            this.cacheCostMult *= 1.6;
            this.locs.push({ x: c.x, z: c.z, loc: this.loc('chestopen'), shape: 10, angle: 0 });
            this.grantItem(c.x, c.z, 0.5 + this.stats.itemFind);
        }
    }

    cacheInfo(): { x: number; z: number; opened: boolean; cost: number }[] {
        return this.caches.map(c => ({ ...c, cost: Math.round(c.cost * this.cacheCostMult) }));
    }

    // =============================================================================================
    // Pet companion (reward perk): fetches orbs and coins outside your pickup range
    // =============================================================================================

    private spawnPet(): void {
        const npc = this.db.npcs['kittenpet1'];
        if (!npc) return;
        const slot = this.allocSlot();
        this.petSlot = slot;
        this.npcAdds.push({ slot, npc: npc.id, x: this.px + 1, z: this.pz, hp: 1, maxHp: 1, elite: 0 });
        this.petPos = { x: this.px + 1, z: this.pz };
    }

    private petPos = { x: 0, z: 0 };

    private updatePet(): void {
        if (this.petSlot < 0) return;
        // find nearest pickup within 9 tiles of the player; otherwise follow
        let target: Pickup | null = null;
        let bestD = 1 << 30;
        for (const p of this.pickups.values()) {
            if (p.kind !== 'xp' && p.kind !== 'coins') continue;
            const dp = Math.max(Math.abs(p.x - this.px), Math.abs(p.z - this.pz));
            if (dp > 9) continue;
            const d = Math.max(Math.abs(p.x - this.petPos.x), Math.abs(p.z - this.petPos.z));
            if (d < bestD) {
                bestD = d;
                target = p;
            }
        }
        const goal = target ? { x: target.x, z: target.z } : { x: this.px + 1, z: this.pz + 1 };
        const steps: number[] = [];
        for (let s = 0; s < 2; s++) {
            const dx = Math.sign(goal.x - this.petPos.x);
            const dz = Math.sign(goal.z - this.petPos.z);
            if (dx === 0 && dz === 0) break;
            if (!canStep(this.flags, this.petPos.x, this.petPos.z, dx, dz)) break;
            this.petPos.x += dx;
            this.petPos.z += dz;
            steps.push(dirIndex(dx, dz));
        }
        if (steps.length > 0) this.npcMoves.push(this.petSlot, this.petPos.x, this.petPos.z, steps.length, steps[0], steps[1] ?? 0, steps.length > 1 ? 1 : 0);
        const list = this.pickupAt.get(idx(this.petPos.x, this.petPos.z));
        if (list) {
            for (const uid of [...list]) {
                const p = this.pickups.get(uid);
                if (p && (p.kind === 'xp' || p.kind === 'coins')) this.collect(p);
            }
        }
    }

    // =============================================================================================
    // Hazards (fire trails, arrow rain, nets)
    // =============================================================================================

    private tickHazards(): void {
        if (this.hazards.length === 0) return;
        const keep: Hazard[] = [];
        for (const h of this.hazards) {
            h.age++;
            if (h.age % h.hitEvery === 0) {
                for (const e of this.alive) {
                    if (!e.alive || e.sleeping) continue;
                    let on = h.tiles.has(idx(e.x, e.z));
                    if (!on && e.size > 1) {
                        for (let ix = 0; ix < e.size && !on; ix++) for (let iz = 0; iz < e.size && !on; iz++) on = h.tiles.has(idx(e.x + ix, e.z + iz));
                    }
                    if (!on) continue;
                    if (h.damage > 0) this.applyHit(e, h.damage, { source: h.source, family: h.family, tags: h.kind === 'fire' ? ['fire'] : ['aoe'], noCrit: h.kind === 'fire' });
                    if (h.slow > 0) e.slow = Math.max(e.slow, h.slow);
                }
            }
            if (--h.ticksLeft > 0) {
                keep.push(h);
                continue;
            }
            for (const l of h.locs) {
                const t = idx(l.x, l.z);
                const c = (this.fireLocCount.get(t) ?? 1) - 1;
                if (c <= 0) {
                    this.fireLocCount.delete(t);
                    this.locs.push({ x: l.x, z: l.z, loc: -1, shape: 10, angle: 0 });
                } else {
                    this.fireLocCount.set(t, c);
                }
            }
        }
        this.hazards = keep;
    }

    private tickBuffs(): void {
        if (this.buffs.length === 0) return;
        const before = this.buffs.length;
        for (const b of this.buffs) b.ticks--;
        this.buffs = this.buffs.filter(b => b.ticks > 0);
        if (this.buffs.length !== before) this.recomputeStats(false);
    }

    // =============================================================================================
    // Spawning
    // =============================================================================================

    targetAlive(): number {
        if (this.loadout.debugHorde) return this.loadout.debugHorde;
        const m = this.clock / TICKS_PER_MINUTE;
        const base = 8 + 6.5 * m + 0.55 * m * m;
        return Math.min(this.endless ? 320 : 280, Math.round(base * (this.endless ? 1.3 : 1)));
    }

    private spawnDirector(): void {
        let horde = 0;
        for (const e of this.alive) if (e.alive && e.elite === 0) horde++;
        const want = this.targetAlive();
        if (horde >= want) return;
        const minutes = this.clock / TICKS_PER_MINUTE;
        const roster = this.zone.roster.filter(r => minutes >= r.from && minutes < r.to);
        if (roster.length === 0) return;
        const ring = this.arena.data.spawnRing;
        const toSpawn = Math.min(want - horde, this.loadout.debugHorde ? 40 : 3 + Math.floor(minutes / 2));
        for (let i = 0; i < toSpawn; i++) {
            const entry = this.rng.weighted(roster, r => r.weight);
            const def = ENEMIES[entry.enemy];
            // pick a spawn tile far enough from the player, reachable, preferably out of sight
            let tile = -1;
            for (let tries = 0; tries < 12; tries++) {
                const t = ring[this.rng.int(ring.length)];
                const x = (t / SIZE) | 0;
                const z = t % SIZE;
                const fd = this.flow.at(x, z);
                if (fd === FlowField.UNREACHABLE || fd < 12) continue;
                if (Math.max(Math.abs(x - this.px), Math.abs(z - this.pz)) < 12) continue;
                tile = t;
                break;
            }
            if (tile < 0) continue;
            const x = (tile / SIZE) | 0;
            const z = tile % SIZE;
            const npc = this.db.npcs[def.npc];
            if (npc.size > 1 && !canPlaceLarge(this.flags, x, z, npc.size)) continue;
            this.spawnEnemy(def, x, z, 0);
        }
    }

    // =============================================================================================
    // Bosses
    // =============================================================================================

    private bossSchedule(): void {
        if (!this.endless) {
            if (this.nextBoss < this.bossTimes.length && this.clock >= this.bossTimes[this.nextBoss]) {
                const def = this.zone.bosses[this.nextBoss];
                this.spawnBoss(def, this.nextBoss === this.zone.bosses.length - 1);
                this.nextBoss++;
            }
        } else if (this.clock >= this.nextEndlessTick) {
            const def = this.zone.bosses[this.endlessIndex % this.zone.bosses.length];
            this.endlessIndex++;
            this.spawnBoss(def, false);
            this.nextEndlessTick = this.clock + ENDLESS_BOSS_INTERVAL;
        }
    }

    nextBossTicks(): number {
        if (this.endless) return Math.max(0, this.nextEndlessTick - this.clock);
        if (this.nextBoss >= this.bossTimes.length) return -1;
        return Math.max(0, this.bossTimes[this.nextBoss] - this.clock);
    }

    private spawnBoss(def: BossDef, final: boolean): void {
        const npc = this.db.npcs[def.forms[0].npc];
        if (!npc) throw new Error(`missing boss npc ${def.forms[0].npc}`);
        // a spawn tile around 10-14 tiles from the player where the footprint fits
        let tile = -1;
        const ring = this.arena.data.spawnRing;
        for (let tries = 0; tries < 200; tries++) {
            const cand = tries < 150 ? ring[this.rng.int(ring.length)] : this.rng.int(SIZE * SIZE);
            const x = (cand / SIZE) | 0;
            const z = cand % SIZE;
            const d = Math.max(Math.abs(x - this.px), Math.abs(z - this.pz));
            if (d < 9 || d > 22 || !canPlaceLarge(this.flags, x, z, npc.size)) continue;
            if (this.flow.at(x, z) === FlowField.UNREACHABLE) continue;
            tile = cand;
            break;
        }
        if (tile < 0) tile = this.nearestWalkable(this.px + 10, this.pz);
        const x = (tile / SIZE) | 0;
        const z = tile % SIZE;
        const dummy: EnemyDef = { id: def.id, npc: def.forms[0].npc, hp: def.hp, damage: def.damage, attackSpeed: def.attackSpeed, range: def.range, style: def.forms[0].style, speed: 1, xp: 300 };
        const e = this.spawnEnemy(dummy, x, z, 2, def);
        if (!e) return;
        e.xp = Math.round(250 * this.zone.difficulty);
        e.boss = { def, form: 0, enraged: false, patternTimer: 8, styleIndex: 0, styleTimer: def.styleTicks ?? 0, final, patternIndex: this.rng.int(def.patterns.length) };
        if (def.styleSwitch) e.style = def.styleSwitch[0];
        const name = this.endless ? `${def.name} (Endless ${this.endlessIndex})` : def.name;
        this.event({ type: 'bossSpawn', slot: e.slot, name, x, z });
        this.event({ type: 'message', text: def.intro, colour: 0xff0000 });
        const u = this.upd(e.slot);
        u.say = def.intro.length < 40 ? def.intro : '';
    }

    private bossRange(e: Enemy): number {
        const b = e.boss!;
        return e.style === 'melee' ? 1 : Math.max(2, b.def.range);
    }

    private bossAi(): void {
        for (const e of this.alive) {
            if (!e.alive || !e.boss) continue;
            const b = e.boss;

            // forms
            const frac = e.hp / e.maxHp;
            while (b.form + 1 < b.def.forms.length && frac <= b.def.forms[b.form + 1].hpFrac) {
                b.form++;
                const f = b.def.forms[b.form];
                const npc = this.db.npcs[f.npc];
                const u = this.upd(e.slot);
                u.npcType = npc.id;
                if (f.say) {
                    u.say = f.say;
                    this.event({ type: 'message', text: f.say, colour: 0xff981f });
                }
                e.npcName = f.npc;
                e.size = npc.size;
                if (!b.def.styleSwitch) e.style = f.style;
                e.attackAnim = npc.attackAnim >= 0 ? npc.attackAnim : e.attackAnim;
                e.deathAnim = npc.deathAnim >= 0 ? npc.deathAnim : e.deathAnim;
                if (!canPlaceLarge(this.flags, e.x, e.z, e.size)) {
                    const t = this.nearestFit(e.x, e.z, e.size);
                    e.x = (t / SIZE) | 0;
                    e.z = t % SIZE;
                    this.npcMoves.push(e.slot, e.x, e.z, 0, 0, 0, 0);
                }
            }

            // enrage below 30%
            if (!b.enraged && frac < 0.3) {
                b.enraged = true;
                const u = this.upd(e.slot);
                u.say = 'Rrraaargh!';
                u.spot = this.spot('sp_attackglow_red');
                this.event({ type: 'enrage', slot: e.slot, name: b.def.name });
                this.event({ type: 'message', text: `${b.def.name} becomes enraged!`, colour: 0xff0000 });
                e.attackSpeed = Math.max(2, e.attackSpeed - 1);
            }

            // attack style switching (countered by protection prayers)
            if (b.def.styleSwitch && b.def.styleTicks) {
                if (--b.styleTimer <= 0) {
                    b.styleIndex = (b.styleIndex + 1) % b.def.styleSwitch.length;
                    b.styleTimer = b.def.styleTicks;
                    e.style = b.def.styleSwitch[b.styleIndex];
                    const prayer = e.style === 'melee' ? 'Melee' : e.style === 'ranged' ? 'Missiles' : 'Magic';
                    const u = this.upd(e.slot);
                    u.say = e.style === 'melee' ? 'Face me!' : e.style === 'ranged' ? 'Feel my sting!' : 'Taste my magic!';
                    this.event({ type: 'message', text: `${b.def.name} switches to ${e.style}! (Protect from ${prayer})`, colour: 0xff981f });
                }
            }

            // telegraphed patterns
            if (--b.patternTimer <= 0 && !this.dead) {
                this.firePattern(e, b);
                if (b.enraged && this.rng.chance(0.45)) this.firePattern(e, b);
                b.patternTimer = Math.round(b.def.patternCooldown * (b.enraged ? 0.65 : 1));
            }
        }
    }

    private firePattern(e: Enemy, b: BossState): void {
        const pattern: PatternId = b.def.patterns[b.patternIndex % b.def.patterns.length];
        b.patternIndex += 1 + this.rng.int(2);
        const delay = b.enraged ? 2 : 3;
        const centre = Math.floor(e.size / 2);
        const waves = generate(pattern, {
            rng: this.rng,
            px: this.px,
            pz: this.pz,
            bx: e.x + centre,
            bz: e.z + centre,
            delay,
            walkable: (x, z) => !isBlocked(this.flags, x, z),
            arenaRadius: 26
        });
        const existing: Impact[] = this.telegraphs.map(t => ({ tiles: t.tiles, landTick: t.landTick }));
        const proposed: Impact[] = waves.map(w => ({ tiles: w.tiles, landTick: this.tick + w.delay }));
        const fair = makeFair(this.flags, this.px, this.pz, this.tick, existing, proposed);
        const dmg = Math.round(this.maxHp * b.def.patternDamage * (b.enraged ? 1.15 : 1));
        const spotName = pattern === 'rocks' ? 'rockfall' : pattern === 'rings' ? 'smokepuff' : pattern === 'cross' || pattern === 'lines' ? 'smokepuff' : 'smokepuff';
        for (const w of fair) {
            const tiles = w.tiles instanceof Set ? [...w.tiles] : w.tiles;
            if (tiles.length === 0) continue;
            this.telegraphs.push({
                tiles,
                createdTick: this.tick,
                landTick: w.landTick,
                damage: dmg,
                colour: b.enraged ? 0xd00000 : e.style === 'magic' ? 0x4060ff : e.style === 'ranged' ? 0x20c020 : 0xff4000,
                owner: e.slot,
                style: e.style,
                spot: this.spot(spotName),
                shake: pattern === 'wipe' || pattern === 'cross' || pattern === 'rings' ? 60 : 30
            });
        }
        const u = this.upd(e.slot);
        if (e.attackAnim >= 0) u.anim = e.attackAnim;
        this.event({ type: 'message', text: `${b.def.name}: ${PATTERN_NAMES[pattern]}!`, colour: 0xffff00 });
    }

    private resolveTelegraphs(): void {
        if (this.telegraphs.length === 0) return;
        const keep: Telegraph[] = [];
        for (const t of this.telegraphs) {
            if (t.landTick > this.tick) {
                keep.push(t);
                continue;
            }
            const set = new Set(t.tiles);
            if (set.has(idx(this.px, this.pz))) {
                const owner = this.enemies[t.owner];
                this.damagePlayer(t.damage, t.style, owner && owner.alive ? owner : null, true);
            }
            // heavy damage to anything standing on them - including the horde
            for (const e of this.alive) {
                if (!e.alive || e.elite === 2 || !set.has(idx(e.x, e.z))) continue;
                this.applyHit(e, Math.max(1, Math.round(e.maxHp * 0.35)), { source: 'telegraph', family: 'boss', noCrit: true });
            }
            // impact effects on a sample of tiles (keeps snapshot sizes sane on big wipes)
            const step = Math.max(1, Math.floor(t.tiles.length / 24));
            for (let i = 0; i < t.tiles.length; i += step) {
                const tile = t.tiles[i];
                this.mapSpot(t.spot, (tile / SIZE) | 0, tile % SIZE, 0, 0);
            }
            this.event({ type: 'shake', strength: t.shake });
        }
        this.telegraphs = keep;
    }

    private bossKilled(e: Enemy): void {
        const b = e.boss!;
        this.bossesKilled.push(b.def.id);
        this.event({ type: 'bossDeath', slot: e.slot, name: b.def.name, final: b.final });
        this.event({ type: 'message', text: `You have defeated ${b.def.name}!`, colour: 0x00ff00 });
        // clear its pending telegraphs
        this.telegraphs = this.telegraphs.filter(t => t.owner !== e.slot);
        // gear drop: a random piece of the tier this boss represents
        const index = this.zone.bosses.indexOf(b.def);
        const tier = Math.min(5, this.zone.order * 2 + Math.floor(index / 2));
        const slots = ['head', 'body', 'legs', 'weapon', 'shield'];
        this.gearDrops.push({ classId: this.classId, tier, slot: slots[this.rng.int(slots.length)] });
        this.grantItem(e.x, e.z, 1.5);
        if (b.final && !this.endless) {
            this.finalBossKiller = e.lastHitFamily;
            this.victoryPending = true;
            this.event({ type: 'victory' });
        }
    }

    // =============================================================================================
    // End of run
    // =============================================================================================

    private finish(won: boolean): void {
        if (this.over) return;
        this.victoryPending = false;
        this.over = {
            won: won || this.bossesKilled.includes(this.zone.bosses[this.zone.bosses.length - 1].id),
            endless: this.endless,
            classId: this.classId,
            zoneId: this.zone.id,
            ticksSurvived: this.clock,
            kills: this.kills,
            coins: this.coins,
            bossesKilled: [...this.bossesKilled],
            level: this.level,
            abilities: [...this.cards.values()].map(c => ({ name: c.def.name, rank: c.rank, family: c.def.family })),
            sets: [...familyRanks(this.cards)].flatMap(([fam, ranks]) => FAMILY_BY_ID[fam].sets.filter(s => ranks >= s.at).map((s, i) => ({ name: `${FAMILY_BY_ID[fam].name}: ${s.name}`, tier: i + 1 }))),
            talentXp: 0,
            cachesOpened: this.cachesOpened,
            guardiansKilled: this.guardiansKilled,
            damageTaken: this.damageTaken,
            telegraphDamage: this.telegraphDamage,
            finalBossKilledBy: this.finalBossKiller,
            gearDrops: this.gearDrops,
            picks: this.picks,
            maxAlive: this.maxAlive
        };
    }

    // =============================================================================================
    // Snapshot
    // =============================================================================================

    private upd(slot: number): EntityUpdate {
        let u = this.updates.get(slot);
        if (!u) {
            u = { slot };
            this.updates.set(slot, u);
        }
        return u;
    }

    private event(e: GameEvent): void {
        this.events.push(e);
    }

    private snapshot(): Snapshot {
        const telegraphs: TelegraphView[] = this.telegraphs.map(t => ({ tiles: t.tiles, ticksLeft: t.landTick - this.tick, total: t.landTick - t.createdTick, colour: t.colour }));
        const snap: Snapshot = {
            tick: this.tick,
            playerSteps: this.lastSteps,
            playerRun: this.lastSteps.length === 2,
            playerX: this.px,
            playerZ: this.pz,
            npcAdds: this.npcAdds,
            npcRemoves: this.npcRemoves,
            npcMoves: Int32Array.from(this.npcMoves),
            updates: [...this.updates.values()],
            projectiles: this.projectiles,
            mapSpots: this.mapSpots,
            objAdds: this.objAdds,
            objDels: this.objDels,
            locs: this.locs,
            telegraphs,
            events: this.events,
            hud: this.hud(),
            levelUp: this.levelUpView(),
            over: this.over
        };
        this.npcAdds = [];
        this.npcRemoves = [];
        this.npcMoves = [];
        this.updates = new Map();
        this.projectiles = [];
        this.mapSpots = [];
        this.objAdds = [];
        this.objDels = [];
        this.locs = [];
        this.events = [];
        this.lastSteps = [];
        return snap;
    }

    private levelUpView(): LevelUpView | null {
        if (!this.offer) return null;
        const cdMult = 1 - this.stats.cooldown;
        return {
            level: this.offerLevel,
            cards: this.offer.map(o => describeOffer(o, this.cards, cdMult)),
            rerollCost: this.rerolls > 0 ? 0 : this.rerollCost(),
            freeRerolls: this.rerolls,
            skipCoins: this.skipCoins(),
            banishes: this.banishes
        };
    }

    hud(): HudView {
        const fams = familyRanks(this.cards);
        const sets = [...fams].map(([fam, ranks]) => {
            const f = FAMILY_BY_ID[fam];
            return { family: fam, name: f.name, ranks, thresholds: f.sets.map(s => s.at), active: f.sets.filter(s => ranks >= s.at).length };
        });
        const bosses = this.alive
            .filter(e => e.alive && e.boss)
            .map(e => ({ slot: e.slot, name: e.boss!.def.name, hp: e.hp, maxHp: e.maxHp, enraged: e.boss!.enraged, style: e.style }));
        const cdMult = 1 - this.stats.cooldown;
        let prayer: string | null = null;
        const top = Math.max(this.stats.protectMelee, this.stats.protectRanged, this.stats.protectMagic);
        if (top > 0) {
            const bossStyle = bosses[0]?.style;
            if (bossStyle === 'melee' && this.stats.protectMelee > 0) prayer = 'melee';
            else if (bossStyle === 'ranged' && this.stats.protectRanged > 0) prayer = 'ranged';
            else if (bossStyle === 'magic' && this.stats.protectMagic > 0) prayer = 'magic';
            else prayer = this.stats.protectMelee === top ? 'melee' : this.stats.protectRanged === top ? 'ranged' : 'magic';
        }
        let horde = 0;
        for (const e of this.alive) if (e.alive && e.elite === 0) horde++;
        return {
            clockTicks: this.clock,
            level: this.level,
            xp: Math.floor(this.xp),
            xpNext: this.xpNext(),
            hp: Math.max(0, this.hp),
            maxHp: this.maxHp,
            energy: Math.floor(this.energy / 100),
            running: this.running,
            coins: this.coins,
            kills: this.kills,
            abilities: [...this.cards.values()]
                .filter(c => c.def.kind === 'active' || c.def.family !== 'passive')
                .map(c => {
                    const p = effectiveParams(c);
                    return {
                        id: c.def.id,
                        name: c.def.name,
                        icon: c.def.icon[0],
                        iconIndex: c.def.icon[1],
                        rank: c.rank,
                        maxRank: c.def.maxRank,
                        cooldown: c.def.kind === 'active' ? Math.max(0, c.cooldown) : 0,
                        maxCooldown: c.def.kind === 'active' ? Math.max(1, Math.round((p.cooldown ?? 1) * cdMult)) : 0,
                        family: c.def.family
                    };
                }),
            sets,
            bosses,
            prayer,
            nextBossTicks: this.nextBossTicks(),
            endless: this.endless,
            rerolls: this.rerolls,
            banishes: this.banishes,
            alive: horde,
            items: this.items.map(i => ({ name: i.name, obj: this.obj(i.obj) }))
        };
    }

    // =============================================================================================
    // helpers
    // =============================================================================================

    private nearestWalkable(x: number, z: number): number {
        for (let r = 0; r < 30; r++) {
            for (let dx = -r; dx <= r; dx++) {
                for (let dz = -r; dz <= r; dz++) {
                    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
                    if (!isBlocked(this.flags, x + dx, z + dz)) return idx(x + dx, z + dz);
                }
            }
        }
        return idx(this.arena.data.centreLocalX, this.arena.data.centreLocalZ);
    }

    private nearestFit(x: number, z: number, size: number): number {
        for (let r = 0; r < 20; r++) {
            for (let dx = -r; dx <= r; dx++) {
                for (let dz = -r; dz <= r; dz++) {
                    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
                    if (canPlaceLarge(this.flags, x + dx, z + dz, size)) return idx(x + dx, z + dz);
                }
            }
        }
        return idx(x, z);
    }

    // read-only views for bots / tests
    get enemyCount(): number {
        let n = 0;
        for (const e of this.alive) if (e.alive) n++;
        return n;
    }

    pendingImpacts(): Impact[] {
        return this.telegraphs.map(t => ({ tiles: t.tiles, landTick: t.landTick }));
    }

    enemyPositions(): { x: number; z: number; boss: boolean }[] {
        return this.alive.filter(e => e.alive && !e.sleeping).map(e => ({ x: e.x, z: e.z, boss: e.elite >= 1 }));
    }

    sleepingGuardians(): { x: number; z: number }[] {
        return this.alive.filter(e => e.alive && e.sleeping).map(e => ({ x: e.x, z: e.z }));
    }

    get hasOffer(): boolean {
        return this.offer !== null;
    }

    get offerCards(): Offer[] {
        return this.offer ?? [];
    }

    pickupList(): Pickup[] {
        return [...this.pickups.values()];
    }

    get routeLength(): number {
        return this.route.length;
    }
}

export type { Hit };
export { isGenericPassive };
