// Abilities and passive cards. Class pools (melee/ranged/magic) and the 13 skill families.
// Every active ability fires automatically on a tick cooldown and states its targeting rule.
// All anims/spotanims/objs are referenced by their cache debug names and validated at build time.
import type { EnemyRef, SimApi } from '../api.js';
import type { Stats } from '../types.js';

export type Params = Record<string, number>;

export type AbilityDef = {
    id: string;
    name: string;
    family: string; // 'melee' | 'ranged' | 'magic' | skill family id
    kind: 'active' | 'passive';
    icon: [string, number];
    targeting?: string; // shown on cards: nearest / lowest HP / random in range / AoE around you ...
    desc: string;
    maxRank: number;
    params: (rank: number) => Params;
    cast?: (ctx: SimApi, p: Params, rank: number) => boolean;
    apply?: (s: Stats, p: Params) => void;
    tags: string[];
    refs?: { seqs?: string[]; spots?: string[]; objs?: string[]; locs?: string[] };
};

export const PARAM_LABELS: Record<string, [string, string]> = {
    damage: ['Damage', ''],
    cooldown: ['Cooldown', ' ticks'],
    targets: ['Targets', ''],
    radius: ['Radius', ' tiles'],
    range: ['Range', ' tiles'],
    length: ['Length', ' tiles'],
    bounces: ['Bounces', ''],
    stun: ['Stun', ' ticks'],
    slow: ['Slow', ' ticks'],
    duration: ['Duration', ' ticks'],
    count: ['Count', ''],
    heal: ['Heal', ' HP'],
    chance: ['Chance', '%'],
    burn: ['Burn', '/tick'],
    knock: ['Knockback', ' tiles'],
    vuln: ['Vulnerability', '%'],
    pct: ['Bonus', '%'],
    flat: ['Bonus', ''],
    poison: ['Poison', '/tick'],
    reduce: ['Damage taken', ' -%'],
    tiles: ['Tiles', '']
};

// per-rank lookup helper (rank is 1-based)
const at = (rank: number, values: number[]) => values[Math.min(values.length, Math.max(1, rank)) - 1];

// effective radius / range scaled by the Area / Range passives
const area = (ctx: SimApi, r: number) => Math.max(1, Math.round(r * (1 + ctx.stats.area)));
const reach = (ctx: SimApi, r: number) => r + ctx.stats.range;

function travel(ctx: SimApi, spot: string, target: EnemyRef | { x: number; z: number }, startHeight = 40, endHeight = 36, delay = 20, peak = 15, arc = 64, from?: 'player' | { x: number; z: number }): number {
    const dx = target.x - ctx.px;
    const dz = target.z - ctx.pz;
    const dist = Math.max(1, Math.round(Math.sqrt(dx * dx + dz * dz)));
    const duration = 8 + dist * 4;
    ctx.projectile(ctx.spot(spot), target, { from: from ?? 'player', startHeight, endHeight, delay, duration, peak, arc });
    return Math.max(1, Math.ceil((delay + duration) / 30));
}

// ------------------------------------------------------------------------------------------------
// MELEE class pool
// ------------------------------------------------------------------------------------------------

const MELEE: AbilityDef[] = [
    {
        id: 'slash',
        name: 'Slash',
        family: 'melee',
        kind: 'active',
        icon: ['combaticons', 5],
        targeting: 'Nearest enemy within reach, cleaving those beside it',
        desc: 'A wide scimitar slash.',
        maxRank: 6,
        tags: ['melee'],
        params: r => ({ damage: at(r, [16, 20, 25, 31, 38, 46]), cooldown: at(r, [4, 4, 4, 3, 3, 3]), targets: at(r, [2, 3, 3, 4, 5, 6]), range: 2 }),
        cast(ctx, p) {
            const main = ctx.targets('nearest', reach(ctx, p.range), 1)[0];
            if (!main) return false;
            ctx.playerAnim(ctx.seq('human_sword_slash'));
            const hits = [main, ...ctx.inRadius(main.x, main.z, area(ctx, 1)).filter(e => e.slot !== main.slot)].slice(0, p.targets);
            for (const e of hits) ctx.hit(e, p.damage, { source: 'slash', family: 'melee', tags: ['melee'] });
            ctx.sound('sword_slash');
            return true;
        },
        refs: { seqs: ['human_sword_slash'] }
    },
    {
        id: 'whirlwind',
        name: 'Whirlwind',
        family: 'melee',
        kind: 'active',
        icon: ['combaticons', 3],
        targeting: 'AoE around you',
        desc: 'Spin your blade, striking everything around you.',
        maxRank: 6,
        tags: ['melee', 'aoe'],
        params: r => ({ damage: at(r, [14, 18, 22, 27, 33, 40]), cooldown: at(r, [7, 7, 6, 6, 5, 5]), radius: at(r, [1, 1, 2, 2, 2, 3]) }),
        cast(ctx, p) {
            const radius = area(ctx, p.radius);
            const hits = ctx.inRadius(ctx.px, ctx.pz, radius);
            if (hits.length === 0) return false;
            ctx.playerAnim(ctx.seq('human_sword_transslash'));
            ctx.playerSpot(ctx.spot('sp_attack_cleave_spotanim'), 0);
            for (const e of hits) ctx.hit(e, p.damage, { source: 'whirlwind', family: 'melee', tags: ['melee', 'aoe'] });
            return true;
        },
        refs: { seqs: ['human_sword_transslash'], spots: ['sp_attack_cleave_spotanim'] }
    },
    {
        id: 'shatter',
        name: 'Shatter',
        family: 'melee',
        kind: 'active',
        icon: ['combaticons', 12],
        targeting: 'Largest group of enemies within reach',
        desc: 'A crushing mace blow that cracks armour: enemies hit take extra damage.',
        maxRank: 6,
        tags: ['melee', 'aoe'],
        params: r => ({ damage: at(r, [24, 30, 37, 45, 54, 64]), cooldown: at(r, [9, 9, 8, 8, 7, 6]), radius: at(r, [1, 1, 1, 2, 2, 2]), vuln: at(r, [15, 18, 21, 24, 27, 30]), range: 3 }),
        cast(ctx, p) {
            const c = ctx.nearestCluster(reach(ctx, p.range));
            if (!c) return false;
            ctx.playerAnim(ctx.seq('human_staff_pound'));
            ctx.mapSpot(ctx.spot('sp_attack_shatter_spotanim'), c.x, c.z, 0, 10);
            for (const e of ctx.inRadius(c.x, c.z, area(ctx, p.radius))) ctx.hit(e, p.damage, { source: 'shatter', family: 'melee', tags: ['melee', 'aoe'], vuln: p.vuln / 100, delay: 1 });
            return true;
        },
        refs: { seqs: ['human_staff_pound'], spots: ['sp_attack_shatter_spotanim'] }
    },
    {
        id: 'puncture',
        name: 'Puncture',
        family: 'melee',
        kind: 'active',
        icon: ['combaticons', 6],
        targeting: 'Lowest HP enemy within reach',
        desc: 'Two quick stabs on the weakest enemy nearby. Executes the wounded.',
        maxRank: 6,
        tags: ['melee'],
        params: r => ({ damage: at(r, [18, 23, 29, 36, 44, 53]), cooldown: at(r, [5, 5, 4, 4, 4, 3]), range: at(r, [2, 2, 3, 3, 3, 4]), targets: at(r, [1, 1, 1, 2, 2, 2]) }),
        cast(ctx, p) {
            const t = ctx.targets('lowest', reach(ctx, p.range), p.targets);
            if (t.length === 0) return false;
            ctx.playerAnim(ctx.seq('human_sword_stab'));
            for (const e of t) {
                ctx.hit(e, p.damage, { source: 'puncture', family: 'melee', tags: ['melee'], spot: ctx.spot('sp_attack_puncture_spotanim') });
                ctx.hit(e, p.damage, { source: 'puncture', family: 'melee', tags: ['melee'], delay: 1 });
            }
            return true;
        },
        refs: { seqs: ['human_sword_stab'], spots: ['sp_attack_puncture_spotanim'] }
    },
    {
        id: 'shove',
        name: 'Shove',
        family: 'melee',
        kind: 'active',
        icon: ['combaticons', 9],
        targeting: 'Nearest enemies, knocking them back',
        desc: 'A spear shove that hurls enemies away and stuns them.',
        maxRank: 6,
        tags: ['melee'],
        params: r => ({ damage: at(r, [12, 15, 19, 23, 28, 34]), cooldown: at(r, [10, 9, 9, 8, 8, 7]), targets: at(r, [2, 3, 3, 4, 5, 6]), knock: at(r, [2, 2, 3, 3, 3, 4]), stun: at(r, [2, 2, 2, 3, 3, 3]), range: 2 }),
        cast(ctx, p) {
            const t = ctx.targets('nearest', reach(ctx, p.range), p.targets);
            if (t.length === 0) return false;
            ctx.playerAnim(ctx.seq('human_spear_lunge'));
            for (const e of t) ctx.hit(e, p.damage, { source: 'shove', family: 'melee', tags: ['melee'], knockback: p.knock, stun: p.stun, spot: ctx.spot('stunned_shove') });
            return true;
        },
        refs: { seqs: ['human_spear_lunge'], spots: ['stunned_shove'] }
    },
    {
        id: 'chain_axe',
        name: 'Chain Axe',
        family: 'melee',
        kind: 'active',
        icon: ['combaticons', 1],
        targeting: 'Nearest enemy, then bounces to the next nearest',
        desc: 'A rune throwing axe that ricochets between enemies.',
        maxRank: 6,
        tags: ['projectile', 'melee'],
        params: r => ({ damage: at(r, [14, 17, 21, 25, 30, 36]), cooldown: at(r, [6, 6, 5, 5, 5, 4]), bounces: at(r, [2, 3, 4, 5, 6, 8]), range: 6 }),
        cast(ctx, p) {
            const first = ctx.targets('nearest', reach(ctx, p.range), 1)[0];
            if (!first) return false;
            ctx.playerAnim(ctx.seq('human_throw'));
            const hit = new Set<number>();
            let cur: EnemyRef = first;
            let delay = travel(ctx, 'rune_taxe_travel', cur, 40, 36, 15);
            let from: { x: number; z: number } = { x: ctx.px, z: ctx.pz };
            for (let b = 0; b <= p.bounces + ctx.stats.projectiles; b++) {
                hit.add(cur.slot);
                ctx.hit(cur, p.damage, { source: 'chain_axe', family: 'melee', tags: ['projectile'], delay });
                from = { x: cur.x, z: cur.z };
                const next = ctx.targets('nearest', 4, 1, cur.x, cur.z, hit)[0];
                if (!next) break;
                ctx.projectile(ctx.spot('rune_taxe_travel'), next, { from, startHeight: 36, endHeight: 36, delay: delay * 30 - 20, duration: 15, peak: 10, arc: 0 });
                delay += 1;
                cur = next;
            }
            return true;
        },
        refs: { seqs: ['human_throw'], spots: ['rune_taxe_travel'] }
    },
    {
        id: 'impale',
        name: 'Impale',
        family: 'melee',
        kind: 'active',
        icon: ['combaticons', 7],
        targeting: 'A line towards the nearest enemy',
        desc: 'A lunging thrust that pierces every enemy in a line.',
        maxRank: 6,
        tags: ['melee'],
        params: r => ({ damage: at(r, [22, 27, 33, 40, 48, 57]), cooldown: at(r, [8, 8, 7, 7, 6, 6]), length: at(r, [3, 4, 4, 5, 6, 7]) }),
        cast(ctx, p) {
            const t = ctx.targets('nearest', 4, 1)[0];
            if (!t) return false;
            ctx.playerAnim(ctx.seq('human_sword_lunge'));
            ctx.playerSpot(ctx.spot('sp_attack_impale_spotanim'));
            for (const e of ctx.inLine(ctx.px, ctx.pz, t.x, t.z, area(ctx, p.length))) ctx.hit(e, p.damage, { source: 'impale', family: 'melee', tags: ['melee'] });
            return true;
        },
        refs: { seqs: ['human_sword_lunge'], spots: ['sp_attack_impale_spotanim'] }
    },
    {
        id: 'rampage',
        name: 'Rampage',
        family: 'melee',
        kind: 'active',
        icon: ['prayeron', 10],
        targeting: 'Self buff when 4+ enemies are close',
        desc: 'When surrounded, enter a rage: more damage and life steal for a while.',
        maxRank: 6,
        tags: ['buff'],
        params: r => ({ pct: at(r, [20, 25, 30, 36, 43, 50]), chance: at(r, [4, 5, 6, 7, 8, 10]), duration: at(r, [10, 11, 12, 14, 16, 18]), cooldown: 30 }),
        cast(ctx, p) {
            if (ctx.inRadius(ctx.px, ctx.pz, 2).length < 4) return false;
            ctx.playerSpot(ctx.spot('sp_attackglow_red'));
            ctx.buff('rampage', Math.round(p.duration * (1 + ctx.stats.duration)), { damage: p.pct / 100, lifesteal: p.chance / 100 });
            return true;
        },
        refs: { spots: ['sp_attackglow_red'] }
    }
];

// ------------------------------------------------------------------------------------------------
// RANGED class pool
// ------------------------------------------------------------------------------------------------

const RANGED: AbilityDef[] = [
    {
        id: 'shortbow',
        name: 'Shortbow',
        family: 'ranged',
        kind: 'active',
        icon: ['combaticons2', 5],
        targeting: 'Nearest enemies in range',
        desc: 'Rapid shots from your shortbow.',
        maxRank: 6,
        tags: ['projectile', 'ranged'],
        params: r => ({ damage: at(r, [12, 15, 19, 23, 28, 34]), cooldown: at(r, [3, 3, 3, 2, 2, 2]), targets: at(r, [1, 1, 2, 2, 3, 3]), range: 8 }),
        cast(ctx, p) {
            const t = ctx.targets('nearest', reach(ctx, p.range), p.targets + ctx.stats.projectiles);
            if (t.length === 0) return false;
            ctx.playerAnim(ctx.seq('human_bow'));
            ctx.playerSpot(ctx.spot('iron_arrow_launch'), 96);
            for (const e of t) ctx.hit(e, p.damage, { source: 'shortbow', family: 'ranged', tags: ['projectile'], delay: travel(ctx, 'iron_arrow_travel', e, 40, 36, 20, 15, 11) });
            return true;
        },
        refs: { seqs: ['human_bow'], spots: ['iron_arrow_launch', 'iron_arrow_travel'] }
    },
    {
        id: 'snapshot',
        name: 'Snapshot',
        family: 'ranged',
        kind: 'active',
        icon: ['combaticons2', 6],
        targeting: 'Random enemies in range',
        desc: 'A magic shortbow special: two arrows loosed at once.',
        maxRank: 6,
        tags: ['projectile', 'ranged'],
        params: r => ({ damage: at(r, [10, 13, 16, 20, 24, 29]), cooldown: at(r, [6, 6, 5, 5, 4, 4]), count: at(r, [2, 3, 3, 4, 5, 6]), range: 9 }),
        cast(ctx, p) {
            const t = ctx.targets('random', reach(ctx, p.range), p.count + ctx.stats.projectiles);
            if (t.length === 0) return false;
            ctx.playerAnim(ctx.seq('human_bow'));
            ctx.playerSpot(ctx.spot('sp_attack_snapshot_spotanim'), 96);
            for (const e of t) ctx.hit(e, p.damage, { source: 'snapshot', family: 'ranged', tags: ['projectile'], delay: travel(ctx, 'sp_attack_glow_arrow_travel', e, 40, 36, 15, 10, 11) });
            return true;
        },
        refs: { seqs: ['human_bow'], spots: ['sp_attack_snapshot_spotanim', 'sp_attack_glow_arrow_travel'] }
    },
    {
        id: 'bolt',
        name: 'Crossbow Bolt',
        family: 'ranged',
        kind: 'active',
        icon: ['combaticons2', 13],
        targeting: 'Pierces a line towards the farthest enemy in range',
        desc: 'A heavy bolt that passes clean through the horde.',
        maxRank: 6,
        tags: ['projectile', 'ranged'],
        params: r => ({ damage: at(r, [24, 30, 37, 45, 54, 64]), cooldown: at(r, [8, 8, 7, 7, 6, 6]), length: at(r, [6, 7, 8, 9, 10, 12]), range: 8 }),
        cast(ctx, p) {
            const t = ctx.targets('nearest', reach(ctx, p.range), 1)[0];
            if (!t) return false;
            ctx.playerAnim(ctx.seq('human_crossbow'));
            const line = ctx.inLine(ctx.px, ctx.pz, t.x, t.z, p.length + ctx.stats.range);
            const dx = t.x - ctx.px;
            const dz = t.z - ctx.pz;
            const d = Math.max(1, Math.max(Math.abs(dx), Math.abs(dz)));
            const end = { x: ctx.px + Math.round((dx / d) * p.length), z: ctx.pz + Math.round((dz / d) * p.length) };
            travel(ctx, 'crossbowbolt_travel', end, 40, 36, 15, 5, 11);
            for (const e of line) ctx.hit(e, p.damage, { source: 'bolt', family: 'ranged', tags: ['projectile'], delay: 1 });
            return true;
        },
        refs: { seqs: ['human_crossbow'], spots: ['crossbowbolt_travel'] }
    },
    {
        id: 'knives',
        name: 'Knife Flurry',
        family: 'ranged',
        kind: 'active',
        icon: ['combaticons2', 10],
        targeting: 'Random enemies in range',
        desc: 'A fan of rune throwing knives.',
        maxRank: 6,
        tags: ['projectile', 'ranged'],
        params: r => ({ damage: at(r, [8, 10, 12, 15, 18, 22]), cooldown: at(r, [4, 4, 4, 3, 3, 3]), count: at(r, [3, 4, 5, 6, 7, 9]), range: 6 }),
        cast(ctx, p) {
            const t = ctx.targets('random', reach(ctx, p.range), p.count + ctx.stats.projectiles);
            if (t.length === 0) return false;
            ctx.playerAnim(ctx.seq('human_throw'));
            for (const e of t) ctx.hit(e, p.damage, { source: 'knives', family: 'ranged', tags: ['projectile'], delay: travel(ctx, 'rune_tknife_travel', e, 40, 36, 10, 5, 11) });
            return true;
        },
        refs: { seqs: ['human_throw'], spots: ['rune_tknife_travel'] }
    },
    {
        id: 'darts',
        name: 'Dart Barrage',
        family: 'ranged',
        kind: 'active',
        icon: ['combaticons2', 11],
        targeting: 'Lowest HP enemy in range',
        desc: 'Poisoned darts that finish off the wounded.',
        maxRank: 6,
        tags: ['projectile', 'ranged', 'poison'],
        params: r => ({ damage: at(r, [7, 9, 11, 13, 16, 19]), cooldown: at(r, [2, 2, 2, 2, 1, 1]), poison: at(r, [2, 2, 3, 3, 4, 5]), range: 6 }),
        cast(ctx, p) {
            const t = ctx.targets('lowest', reach(ctx, p.range), 1 + Math.floor(ctx.stats.projectiles / 2));
            if (t.length === 0) return false;
            ctx.playerAnim(ctx.seq('human_throw'));
            for (const e of t) ctx.hit(e, p.damage, { source: 'darts', family: 'ranged', tags: ['projectile', 'poison'], poison: p.poison, delay: travel(ctx, 'rune_dart_travel', e, 40, 36, 10, 5, 11) });
            return true;
        },
        refs: { seqs: ['human_throw'], spots: ['rune_dart_travel'] }
    },
    {
        id: 'volley',
        name: 'Volley',
        family: 'ranged',
        kind: 'active',
        icon: ['combaticons2', 14],
        targeting: 'Densest group of enemies in range',
        desc: 'Arrows rain on an area, hitting everything in it for several ticks.',
        maxRank: 6,
        tags: ['ranged', 'aoe'],
        params: r => ({ damage: at(r, [9, 11, 14, 17, 21, 25]), cooldown: at(r, [12, 12, 11, 10, 9, 8]), radius: at(r, [1, 1, 2, 2, 2, 3]), duration: at(r, [3, 3, 4, 4, 5, 5]), range: 8 }),
        cast(ctx, p) {
            const c = ctx.nearestCluster(reach(ctx, p.range));
            if (!c) return false;
            ctx.playerAnim(ctx.seq('human_bow'));
            const radius = area(ctx, p.radius);
            const tiles: number[] = [];
            for (let x = c.x - radius; x <= c.x + radius; x++) for (let z = c.z - radius; z <= c.z + radius; z++) if (ctx.walkable(x, z)) tiles.push(x * 104 + z);
            for (let i = 0; i < 4; i++) {
                const tx = c.x + ctx.rng.range(-radius, radius);
                const tz = c.z + ctx.rng.range(-radius, radius);
                travel(ctx, 'steel_arrow_travel', { x: tx, z: tz }, 40, 0, 15 + i * 6, 45, 11);
            }
            ctx.addHazard(tiles, Math.round(p.duration * (1 + ctx.stats.duration)), p.damage, 'volley', 'ranged', 'arrows', { hitEvery: 1 });
            return true;
        },
        refs: { seqs: ['human_bow'], spots: ['steel_arrow_travel'] }
    },
    {
        id: 'javelin',
        name: 'Javelin',
        family: 'ranged',
        kind: 'active',
        icon: ['combaticons2', 9],
        targeting: 'Highest HP enemy in range',
        desc: 'A heavy javelin for the biggest threat, knocking it back.',
        maxRank: 6,
        tags: ['projectile', 'ranged'],
        params: r => ({ damage: at(r, [30, 38, 47, 57, 68, 80]), cooldown: at(r, [9, 9, 8, 8, 7, 6]), knock: at(r, [1, 1, 2, 2, 2, 3]), range: 9 }),
        cast(ctx, p) {
            const t = ctx.targets('highest', reach(ctx, p.range), 1)[0];
            if (!t) return false;
            ctx.playerAnim(ctx.seq('human_spear_throw'));
            ctx.hit(t, p.damage, { source: 'javelin', family: 'ranged', tags: ['projectile'], knockback: p.knock, delay: travel(ctx, 'rune_javelin_travel', t, 40, 36, 20, 15, 11) });
            return true;
        },
        refs: { seqs: ['human_spear_throw'], spots: ['rune_javelin_travel'] }
    },
    {
        id: 'ogre_arrow',
        name: 'Ogre Arrow',
        family: 'ranged',
        kind: 'active',
        icon: ['combaticons2', 7],
        targeting: 'Random enemy in range, exploding on impact',
        desc: 'A huge ogre arrow whose impact bursts through the crowd.',
        maxRank: 6,
        tags: ['projectile', 'ranged', 'aoe'],
        params: r => ({ damage: at(r, [20, 25, 31, 38, 46, 55]), cooldown: at(r, [10, 10, 9, 8, 8, 7]), radius: at(r, [1, 1, 1, 2, 2, 2]), range: 9 }),
        cast(ctx, p) {
            const t = ctx.targets('random', reach(ctx, p.range), 1)[0];
            if (!t) return false;
            ctx.playerAnim(ctx.seq('human_bow'));
            const delay = travel(ctx, 'ogre_arrow_travel', t, 40, 36, 20, 15, 11);
            for (const e of ctx.inRadius(t.x, t.z, area(ctx, p.radius))) ctx.hit(e, p.damage, { source: 'ogre_arrow', family: 'ranged', tags: ['projectile', 'aoe'], delay, spot: ctx.spot('smokepuff') });
            return true;
        },
        refs: { seqs: ['human_bow'], spots: ['ogre_arrow_travel', 'smokepuff'] }
    }
];

// ------------------------------------------------------------------------------------------------
// MAGIC class pool (the 2004 standard spellbook + god spells)
// ------------------------------------------------------------------------------------------------

const STRIKE_TIERS = [
    { cast: 'windstrike_casting', travel: 'windstrike_travel', impact: 'windstrike_impact' },
    { cast: 'windbolt_casting', travel: 'windbolt_travel', impact: 'windbolt_impact' },
    { cast: 'windblast_casting', travel: 'windblast_travel', impact: 'windblast_impact' },
    { cast: 'windwave_casting', travel: 'windwave_travel', impact: 'windwave_impact' }
];

function spell(ctx: SimApi, castAnim: string, casting: string, travelSpot: string, impact: string, target: EnemyRef, damage: number, source: string, extra: Partial<Parameters<SimApi['hit']>[2]> = {}): number {
    ctx.playerAnim(ctx.seq(castAnim));
    ctx.playerSpot(ctx.spot(casting), 92);
    const delay = travel(ctx, travelSpot, target, 43, 31, 51, 16, 64);
    ctx.hit(target, damage, { source, family: 'magic', tags: ['magic', 'projectile'], delay, spot: ctx.spot(impact), spotHeight: 100, ...extra });
    return delay;
}

const MAGIC: AbilityDef[] = [
    {
        id: 'wind_strike',
        name: 'Wind Strike',
        family: 'magic',
        kind: 'active',
        icon: ['magicon', 0],
        targeting: 'Nearest enemy in range',
        desc: 'The first spell every wizard learns. Grows into Wind Bolt, Blast and Wave as it ranks up.',
        maxRank: 6,
        tags: ['magic', 'projectile'],
        params: r => ({ damage: at(r, [14, 18, 23, 29, 36, 44]), cooldown: at(r, [4, 4, 3, 3, 3, 3]), targets: at(r, [1, 1, 1, 2, 2, 3]), range: 8 }),
        cast(ctx, p, rank) {
            const t = ctx.targets('nearest', reach(ctx, p.range), p.targets + Math.floor(ctx.stats.projectiles / 2));
            if (t.length === 0) return false;
            const tier = STRIKE_TIERS[Math.min(3, Math.floor((rank - 1) / 1.5))];
            for (const e of t) spell(ctx, 'human_caststrike_staff', tier.cast, tier.travel, tier.impact, e, p.damage, 'wind_strike');
            return true;
        },
        refs: { seqs: ['human_caststrike_staff'], spots: STRIKE_TIERS.flatMap(t => [t.cast, t.travel, t.impact]) }
    },
    {
        id: 'water_bolt',
        name: 'Water Bolt',
        family: 'magic',
        kind: 'active',
        icon: ['magicon', 11],
        targeting: 'Random enemy in range, chaining to others',
        desc: 'A bolt of water that splashes onward to nearby enemies.',
        maxRank: 6,
        tags: ['magic', 'projectile'],
        params: r => ({ damage: at(r, [16, 20, 25, 30, 36, 43]), cooldown: at(r, [6, 6, 5, 5, 4, 4]), bounces: at(r, [1, 2, 2, 3, 4, 5]), range: 8 }),
        cast(ctx, p) {
            const first = ctx.targets('random', reach(ctx, p.range), 1)[0];
            if (!first) return false;
            let delay = spell(ctx, 'human_caststrike_staff', 'waterbolt_casting', 'waterbolt_travel', 'waterbolt_impact', first, p.damage, 'water_bolt');
            const hit = new Set<number>([first.slot]);
            let cur = first;
            for (let b = 0; b < p.bounces; b++) {
                const next = ctx.targets('nearest', 4, 1, cur.x, cur.z, hit)[0];
                if (!next) break;
                ctx.projectile(ctx.spot('waterbolt_travel'), next, { from: { x: cur.x, z: cur.z }, startHeight: 31, endHeight: 31, delay: delay * 30, duration: 20, peak: 10, arc: 0 });
                delay += 1;
                ctx.hit(next, p.damage * 0.8, { source: 'water_bolt', family: 'magic', tags: ['magic'], delay, spot: ctx.spot('waterbolt_impact'), spotHeight: 100 });
                hit.add(next.slot);
                cur = next;
            }
            return true;
        },
        refs: { spots: ['waterbolt_casting', 'waterbolt_travel', 'waterbolt_impact'] }
    },
    {
        id: 'earth_blast',
        name: 'Earth Blast',
        family: 'magic',
        kind: 'active',
        icon: ['magicon', 25],
        targeting: 'Highest HP enemy in range',
        desc: 'A heavy blast of earth for the toughest foe in sight.',
        maxRank: 6,
        tags: ['magic', 'projectile'],
        params: r => ({ damage: at(r, [32, 40, 49, 59, 70, 82]), cooldown: at(r, [8, 8, 7, 7, 6, 6]), stun: at(r, [0, 1, 1, 1, 2, 2]), range: 9 }),
        cast(ctx, p) {
            const t = ctx.targets('highest', reach(ctx, p.range), 1)[0];
            if (!t) return false;
            spell(ctx, 'human_caststrike_staff', 'earthblast_casting', 'earthblast_travel', 'earthblast_impact', t, p.damage, 'earth_blast', { stun: p.stun });
            return true;
        },
        refs: { spots: ['earthblast_casting', 'earthblast_travel', 'earthblast_impact'] }
    },
    {
        id: 'fire_wave',
        name: 'Fire Wave',
        family: 'magic',
        kind: 'active',
        icon: ['magicon', 37],
        targeting: 'Densest group of enemies in range',
        desc: 'A wave of fire that bursts over a group of enemies.',
        maxRank: 6,
        tags: ['magic', 'projectile', 'aoe', 'fire'],
        params: r => ({ damage: at(r, [22, 27, 33, 40, 48, 57]), cooldown: at(r, [9, 9, 8, 8, 7, 6]), radius: at(r, [1, 1, 1, 2, 2, 2]), range: 8 }),
        cast(ctx, p) {
            const c = ctx.nearestCluster(reach(ctx, p.range));
            if (!c) return false;
            const centre = ctx.targets('nearest', 1, 1, c.x, c.z)[0];
            if (!centre) return false;
            const delay = spell(ctx, 'human_castwave_staff', 'firewave_casting', 'firewave_travel', 'firewave_impact', centre, p.damage, 'fire_wave', { tags: ['magic', 'fire'] });
            for (const e of ctx.inRadius(c.x, c.z, area(ctx, p.radius))) {
                if (e.slot !== centre.slot) ctx.hit(e, p.damage * 0.75, { source: 'fire_wave', family: 'magic', tags: ['magic', 'fire', 'aoe'], delay });
            }
            return true;
        },
        refs: { seqs: ['human_castwave_staff'], spots: ['firewave_casting', 'firewave_travel', 'firewave_impact'] }
    },
    {
        id: 'crumble_undead',
        name: 'Crumble Undead',
        family: 'magic',
        kind: 'active',
        icon: ['magicon', 19],
        targeting: 'Nearest undead in range (any enemy if none)',
        desc: 'Tears skeletons, zombies and ghosts apart. Triple damage to the undead.',
        maxRank: 6,
        tags: ['magic', 'projectile'],
        params: r => ({ damage: at(r, [14, 17, 21, 25, 30, 36]), cooldown: at(r, [5, 5, 4, 4, 4, 3]), targets: at(r, [1, 1, 2, 2, 3, 3]), range: 8 }),
        cast(ctx, p) {
            let t = ctx.targets('nearest', reach(ctx, p.range), 24).filter(e => e.undead).slice(0, p.targets);
            if (t.length === 0) t = ctx.targets('nearest', reach(ctx, p.range), 1);
            if (t.length === 0) return false;
            for (const e of t) spell(ctx, 'human_castcrumbleundead_staff', 'crumbleundead_casting', 'crumbleundead_travel', 'crumbleundead_impact', e, e.undead ? p.damage * 3 : p.damage, 'crumble_undead');
            return true;
        },
        refs: { seqs: ['human_castcrumbleundead_staff'], spots: ['crumbleundead_casting', 'crumbleundead_travel', 'crumbleundead_impact'] }
    },
    {
        id: 'entangle',
        name: 'Entangle',
        family: 'magic',
        kind: 'active',
        icon: ['magicon', 26],
        targeting: 'Random enemies in range',
        desc: 'Bind, Snare and Entangle: roots enemies in place.',
        maxRank: 6,
        tags: ['magic', 'projectile'],
        params: r => ({ damage: at(r, [6, 8, 10, 12, 15, 18]), cooldown: at(r, [10, 10, 9, 9, 8, 7]), targets: at(r, [3, 4, 5, 6, 7, 9]), stun: at(r, [3, 3, 4, 4, 5, 5]), range: 7 }),
        cast(ctx, p) {
            const t = ctx.targets('random', reach(ctx, p.range), p.targets);
            if (t.length === 0) return false;
            ctx.playerAnim(ctx.seq('human_castentangle_staff'));
            ctx.playerSpot(ctx.spot('entangle_casting'), 92);
            for (const e of t) ctx.hit(e, p.damage, { source: 'entangle', family: 'magic', tags: ['magic'], stun: p.stun, delay: travel(ctx, 'entangle_travel', e, 43, 0, 51, 16, 64), spot: ctx.spot('entangle_impact') });
            return true;
        },
        refs: { seqs: ['human_castentangle_staff'], spots: ['entangle_casting', 'entangle_travel', 'entangle_impact'] }
    },
    {
        id: 'iban_blast',
        name: 'Iban Blast',
        family: 'magic',
        kind: 'active',
        icon: ['magicon', 41],
        targeting: 'Highest HP enemy in range',
        desc: "Iban's dark power: a single devastating blast.",
        maxRank: 6,
        tags: ['magic', 'projectile'],
        params: r => ({ damage: at(r, [60, 74, 90, 108, 128, 150]), cooldown: at(r, [16, 15, 14, 13, 12, 11]), range: 10 }),
        cast(ctx, p) {
            const t = ctx.targets('highest', reach(ctx, p.range), 1)[0];
            if (!t) return false;
            ctx.playerAnim(ctx.seq('human_castibanblast'));
            ctx.playerSpot(ctx.spot('ibanblast_casting'), 92);
            ctx.hit(t, p.damage, { source: 'iban_blast', family: 'magic', tags: ['magic'], delay: travel(ctx, 'ibanblast_travel', t, 43, 31, 60, 16, 64), spot: ctx.spot('ibanblast_impact'), spotHeight: 100 });
            return true;
        },
        refs: { seqs: ['human_castibanblast'], spots: ['ibanblast_casting', 'ibanblast_travel', 'ibanblast_impact'] }
    },
    {
        id: 'god_spells',
        name: 'God Spells',
        family: 'magic',
        kind: 'active',
        icon: ['magicon', 44],
        targeting: 'Random enemies in range (AoE at each)',
        desc: 'Saradomin Strike, Claws of Guthix and Flames of Zamorak fall from the sky.',
        maxRank: 6,
        tags: ['magic', 'aoe'],
        params: r => ({ damage: at(r, [20, 25, 31, 38, 46, 55]), cooldown: at(r, [11, 10, 10, 9, 8, 7]), count: at(r, [1, 2, 2, 3, 3, 4]), radius: 1, range: 8 }),
        cast(ctx, p) {
            const t = ctx.targets('random', reach(ctx, p.range), p.count);
            if (t.length === 0) return false;
            ctx.playerAnim(ctx.seq('human_castwave_staff'));
            const spots = ['saradomin_lightning', 'gunthix_claw', 'zamorak_flame'];
            t.forEach((e, i) => {
                ctx.mapSpot(ctx.spot(spots[(ctx.tick + i) % 3]), e.x, e.z, 0, 30);
                for (const n of ctx.inRadius(e.x, e.z, area(ctx, p.radius))) ctx.hit(n, p.damage, { source: 'god_spells', family: 'magic', tags: ['magic', 'aoe'], delay: 1 });
            });
            return true;
        },
        refs: { seqs: ['human_castwave_staff'], spots: ['saradomin_lightning', 'gunthix_claw', 'zamorak_flame'] }
    },
    {
        id: 'curse',
        name: 'Curse',
        family: 'magic',
        kind: 'active',
        icon: ['magicon', 9],
        targeting: 'All enemies around you',
        desc: 'Confuse, Weaken and Curse: enemies nearby take more damage.',
        maxRank: 6,
        tags: ['magic', 'aoe'],
        params: r => ({ vuln: at(r, [15, 18, 22, 26, 30, 35]), radius: at(r, [3, 3, 4, 4, 5, 5]), cooldown: at(r, [12, 11, 11, 10, 9, 8]) }),
        cast(ctx, p) {
            const t = ctx.inRadius(ctx.px, ctx.pz, area(ctx, p.radius));
            if (t.length === 0) return false;
            ctx.playerAnim(ctx.seq('human_castcurse_staff'));
            ctx.playerSpot(ctx.spot('curse_casting'), 92);
            for (const e of t) ctx.hit(e, 1, { source: 'curse', family: 'magic', tags: ['magic'], vuln: p.vuln / 100, spot: ctx.spot('curse_impact'), noCrit: true });
            return true;
        },
        refs: { seqs: ['human_castcurse_staff'], spots: ['curse_casting', 'curse_impact'] }
    }
];

// ------------------------------------------------------------------------------------------------
// Skill families: every 2004 non-combat skill + Prayer. Available to every class.
// ------------------------------------------------------------------------------------------------

export type FamilyDef = {
    id: string;
    name: string;
    icon: [string, number];
    sets: { at: number; name: string; desc: string; apply: (s: Stats) => void }[];
};

export const FAMILIES: FamilyDef[] = [
    {
        id: 'firemaking', name: 'Firemaking', icon: ['staticons', 16], sets: [
            { at: 3, name: 'Kindling', desc: 'Fire damage +20%', apply: s => (s.burn += 0.2) },
            { at: 6, name: 'Pyre', desc: 'Fire damage +30%, effects last 20% longer', apply: s => { s.burn += 0.3; s.duration += 0.2; } },
            { at: 10, name: 'Inferno', desc: 'Enemies killed explode for 10% of their max HP', apply: s => (s.explodeOnKill += 0.1) }
        ]
    },
    {
        id: 'mining', name: 'Mining', icon: ['staticons', 12], sets: [
            { at: 3, name: 'Prospector', desc: 'Armour +5%', apply: s => (s.armour += 0.05) },
            { at: 6, name: 'Rock Skin', desc: 'Armour +8%, AoE +10%', apply: s => { s.armour += 0.08; s.area += 0.1; } },
            { at: 10, name: 'Motherlode', desc: 'Coins +40%', apply: s => (s.coins += 0.4) }
        ]
    },
    {
        id: 'woodcutting', name: 'Woodcutting', icon: ['staticons', 17], sets: [
            { at: 3, name: 'Lumberjack', desc: 'Damage vs bosses and elites +15%', apply: s => (s.bossDamage += 0.15) },
            { at: 6, name: 'Feller', desc: 'Damage vs bosses and elites +20%, damage +5%', apply: s => { s.bossDamage += 0.2; s.damage += 0.05; } },
            { at: 10, name: 'Woodsman', desc: 'Max HP +40', apply: s => (s.maxHp += 40) }
        ]
    },
    {
        id: 'fishing', name: 'Fishing', icon: ['staticons', 14], sets: [
            { at: 3, name: 'Angler', desc: 'Pickup range +1', apply: s => (s.pickup += 1) },
            { at: 6, name: 'Deep Sea', desc: 'Heal 15% on level-up', apply: s => (s.healOnLevel += 0.15) },
            { at: 10, name: 'Big Catch', desc: 'Projectile range +2', apply: s => (s.range += 2) }
        ]
    },
    {
        id: 'fletching', name: 'Fletching', icon: ['staticons', 11], sets: [
            { at: 3, name: 'Fletcher', desc: 'Projectile damage +10%', apply: s => (s.damage += 0.1) },
            { at: 6, name: 'Bowyer', desc: '+1 projectile', apply: s => (s.projectiles += 1) },
            { at: 10, name: 'Master Fletcher', desc: '+1 projectile, range +1', apply: s => { s.projectiles += 1; s.range += 1; } }
        ]
    },
    {
        id: 'agility', name: 'Agility', icon: ['staticons', 7], sets: [
            { at: 3, name: 'Light Feet', desc: 'Run energy drain -15%', apply: s => (s.energyDrain += 0.15) },
            { at: 6, name: 'Acrobat', desc: 'Dodge chance +5%', apply: s => (s.dodge += 0.05) },
            { at: 10, name: 'Graceful', desc: 'Run energy regen +50%', apply: s => (s.energyRegen += 0.5) }
        ]
    },
    {
        id: 'thieving', name: 'Thieving', icon: ['staticons', 9], sets: [
            { at: 3, name: 'Pickpocket', desc: 'Coins +20%', apply: s => (s.coins += 0.2) },
            { at: 6, name: 'Rogue', desc: 'Crit chance +5%', apply: s => (s.crit += 0.05) },
            { at: 10, name: 'Master Thief', desc: 'Luck +30%', apply: s => (s.luck += 0.3) }
        ]
    },
    {
        id: 'cooking', name: 'Cooking', icon: ['staticons', 15], sets: [
            { at: 3, name: 'Cook', desc: 'Regenerate 1 HP every 10 ticks', apply: s => (s.regen += 1) },
            { at: 6, name: 'Chef', desc: 'Max HP +25', apply: s => (s.maxHp += 25) },
            { at: 10, name: 'Gourmet', desc: 'Regenerate 3 more HP every 10 ticks', apply: s => (s.regen += 3) }
        ]
    },
    {
        id: 'herblore', name: 'Herblore', icon: ['staticons', 8], sets: [
            { at: 3, name: 'Apothecary', desc: 'Cooldowns -5%', apply: s => (s.cooldown += 0.05) },
            { at: 6, name: 'Herbalist', desc: 'Hits poison for 2/tick', apply: s => (s.poison += 2) },
            { at: 10, name: 'Master Herbalist', desc: 'Damage +15%', apply: s => (s.damage += 0.15) }
        ]
    },
    {
        id: 'prayer', name: 'Prayer', icon: ['staticons', 4], sets: [
            { at: 3, name: 'Devout', desc: 'All protections +5%', apply: s => { s.protectMelee += 0.05; s.protectRanged += 0.05; s.protectMagic += 0.05; } },
            { at: 6, name: 'Blessed', desc: 'Max HP +20, all protections +5%', apply: s => { s.maxHp += 20; s.protectMelee += 0.05; s.protectRanged += 0.05; s.protectMagic += 0.05; } },
            { at: 10, name: 'Saintly', desc: 'One extra life', apply: s => (s.revive += 1) }
        ]
    },
    {
        id: 'smithing', name: 'Smithing', icon: ['staticons', 13], sets: [
            { at: 3, name: 'Apprentice Smith', desc: 'Armour +5%', apply: s => (s.armour += 0.05) },
            { at: 6, name: 'Journeyman', desc: 'Reflect 15% of damage taken', apply: s => (s.thorns += 0.15) },
            { at: 10, name: 'Master Smith', desc: 'Armour +10%', apply: s => (s.armour += 0.1) }
        ]
    },
    {
        id: 'crafting', name: 'Crafting', icon: ['staticons', 10], sets: [
            { at: 3, name: 'Jeweller', desc: 'Item find +25%', apply: s => (s.itemFind += 0.25) },
            { at: 6, name: 'Gem Cutter', desc: 'Crit damage +25%', apply: s => (s.critMult += 0.25) },
            { at: 10, name: 'Master Crafter', desc: 'Luck +25%, item find +25%', apply: s => { s.luck += 0.25; s.itemFind += 0.25; } }
        ]
    },
    {
        id: 'runecrafting', name: 'Runecrafting', icon: ['staticons2', 0], sets: [
            { at: 3, name: 'Novice Runecrafter', desc: 'XP gain +10%', apply: s => (s.xp += 0.1) },
            { at: 6, name: 'Adept', desc: 'Effect duration +20%', apply: s => (s.duration += 0.2) },
            { at: 10, name: 'Master Runecrafter', desc: 'Cooldowns -8%', apply: s => (s.cooldown += 0.08) }
        ]
    }
];

const pct5 = (r: number, values: number[]) => at(r, values);

const SKILLS: AbilityDef[] = [
    // --- Firemaking ---
    {
        id: 'fire_trail', name: 'Fire Trail', family: 'firemaking', kind: 'active', icon: ['staticons', 16], maxRank: 5,
        targeting: 'Leaves fires on the tiles you walk over', desc: 'Light logs as you go. Enemies standing in fire burn every tick.', tags: ['fire'],
        params: r => ({ burn: pct5(r, [5, 7, 9, 12, 15]), duration: pct5(r, [8, 9, 10, 12, 14]), cooldown: 1 }),
        cast(ctx, p) {
            const m = ctx.lastMove();
            if (!m.moved || m.trail.length === 0) return false;
            ctx.addHazard(m.trail.slice(0, 1), Math.round(p.duration * (1 + ctx.stats.duration)), p.burn, 'fire_trail', 'firemaking', 'fire', { fireLocs: true, hitEvery: 1 });
            return true;
        },
        refs: { locs: ['fire'] }
    },
    {
        id: 'bonfire', name: 'Bonfire', family: 'firemaking', kind: 'active', icon: ['staticons', 16], maxRank: 5,
        targeting: 'Ring of fire around you', desc: 'Periodically lights a ring of fires around you.', tags: ['fire', 'aoe'],
        params: r => ({ burn: pct5(r, [6, 8, 10, 13, 16]), radius: pct5(r, [2, 2, 3, 3, 3]), duration: pct5(r, [6, 7, 8, 9, 10]), cooldown: pct5(r, [22, 20, 18, 16, 14]) }),
        cast(ctx, p) {
            const radius = area(ctx, p.radius);
            const tiles: number[] = [];
            for (let x = ctx.px - radius; x <= ctx.px + radius; x++) {
                for (let z = ctx.pz - radius; z <= ctx.pz + radius; z++) {
                    if (Math.max(Math.abs(x - ctx.px), Math.abs(z - ctx.pz)) === radius && ctx.walkable(x, z)) tiles.push(x * 104 + z);
                }
            }
            if (ctx.inRadius(ctx.px, ctx.pz, radius + 2).length === 0) return false;
            ctx.playerAnim(ctx.seq('human_firecooking'));
            ctx.addHazard(tiles, Math.round(p.duration * (1 + ctx.stats.duration)), p.burn, 'bonfire', 'firemaking', 'fire', { fireLocs: true, hitEvery: 1 });
            return true;
        },
        refs: { seqs: ['human_firecooking'], locs: ['fire'] }
    },
    {
        id: 'pyromancer', name: 'Pyromancer', family: 'firemaking', kind: 'passive', icon: ['staticons', 16], maxRank: 5,
        desc: 'All fire damage increased.', tags: [],
        params: r => ({ pct: pct5(r, [10, 15, 20, 26, 33]) }),
        apply: (s, p) => (s.burn += p.pct / 100)
    },
    // --- Mining ---
    {
        id: 'shrapnel_slam', name: 'Shrapnel Slam', family: 'mining', kind: 'active', icon: ['staticons', 12], maxRank: 5,
        targeting: 'AoE around you', desc: 'Slam your pickaxe into the ground; rock shrapnel hits everything nearby.', tags: ['aoe'],
        params: r => ({ damage: pct5(r, [18, 23, 29, 36, 44]), radius: pct5(r, [2, 2, 2, 3, 3]), stun: pct5(r, [1, 1, 1, 2, 2]), cooldown: pct5(r, [12, 11, 10, 9, 8]) }),
        cast(ctx, p) {
            const radius = area(ctx, p.radius);
            const hits = ctx.inRadius(ctx.px, ctx.pz, radius);
            if (hits.length === 0) return false;
            ctx.playerAnim(ctx.seq('human_mining_rune_pickaxe'));
            for (let i = 0; i < 4; i++) ctx.mapSpot(ctx.spot('rockfall'), ctx.px + ctx.rng.range(-radius, radius), ctx.pz + ctx.rng.range(-radius, radius), 0, 10 + i * 5);
            for (const e of hits) ctx.hit(e, p.damage, { source: 'shrapnel_slam', family: 'mining', tags: ['aoe'], stun: p.stun, delay: 1 });
            return true;
        },
        refs: { seqs: ['human_mining_rune_pickaxe'], spots: ['rockfall'] }
    },
    {
        id: 'gold_rush', name: 'Gold Rush', family: 'mining', kind: 'passive', icon: ['staticons', 12], maxRank: 5,
        desc: 'Enemies drop more coins.', tags: [],
        params: r => ({ pct: pct5(r, [15, 22, 30, 40, 50]) }),
        apply: (s, p) => (s.coins += p.pct / 100)
    },
    {
        id: 'rock_skin', name: 'Rock Skin', family: 'mining', kind: 'passive', icon: ['prayeron', 3], maxRank: 5,
        desc: 'Skin as hard as granite.', tags: [],
        params: r => ({ pct: pct5(r, [4, 6, 8, 10, 12]) }),
        apply: (s, p) => (s.armour += p.pct / 100)
    },
    // --- Woodcutting ---
    {
        id: 'axe_whirl', name: 'Axe Whirl', family: 'woodcutting', kind: 'active', icon: ['staticons', 17], maxRank: 5,
        targeting: 'Enemies adjacent to you', desc: 'Swing your hatchet in a circle, chopping everything next to you.', tags: ['melee', 'aoe'],
        params: r => ({ damage: pct5(r, [12, 15, 19, 23, 28]), cooldown: pct5(r, [5, 5, 4, 4, 3]), radius: 1 }),
        cast(ctx, p) {
            const hits = ctx.inRadius(ctx.px, ctx.pz, area(ctx, p.radius));
            if (hits.length === 0) return false;
            ctx.playerAnim(ctx.seq('human_woodcutting_rune_axe'));
            for (const e of hits) ctx.hit(e, p.damage, { source: 'axe_whirl', family: 'woodcutting', tags: ['melee', 'aoe'] });
            return true;
        },
        refs: { seqs: ['human_woodcutting_rune_axe'] }
    },
    {
        id: 'timber', name: 'Timber!', family: 'woodcutting', kind: 'active', icon: ['staticons', 17], maxRank: 5,
        targeting: 'A line towards the nearest enemy', desc: 'Fell a great tree across the horde.', tags: ['aoe'],
        params: r => ({ damage: pct5(r, [30, 38, 47, 57, 68]), length: pct5(r, [5, 6, 7, 8, 9]), cooldown: pct5(r, [15, 14, 13, 12, 11]) }),
        cast(ctx, p) {
            const t = ctx.targets('nearest', 6, 1)[0];
            if (!t) return false;
            ctx.playerAnim(ctx.seq('human_woodcutting_rune_axe'));
            const line = ctx.inLine(ctx.px, ctx.pz, t.x, t.z, area(ctx, p.length));
            for (const e of line) {
                ctx.mapSpot(ctx.spot('smokepuff'), e.x, e.z, 0, 20);
                ctx.hit(e, p.damage, { source: 'timber', family: 'woodcutting', tags: ['aoe'], delay: 1, stun: 1 });
            }
            return line.length > 0;
        },
        refs: { spots: ['smokepuff'] }
    },
    {
        id: 'lumberjack', name: 'Lumberjack', family: 'woodcutting', kind: 'passive', icon: ['staticons', 17], maxRank: 5,
        desc: 'Bigger they are, harder they fall: more damage to bosses and elites.', tags: [],
        params: r => ({ pct: pct5(r, [12, 18, 25, 33, 42]) }),
        apply: (s, p) => (s.bossDamage += p.pct / 100)
    },
    // --- Fishing ---
    {
        id: 'harpoon', name: 'Harpoon Throw', family: 'fishing', kind: 'active', icon: ['staticons', 14], maxRank: 5,
        targeting: 'Pierces a line towards a random enemy', desc: 'Hurl a harpoon that skewers enemies in a line.', tags: ['projectile'],
        params: r => ({ damage: pct5(r, [20, 25, 31, 38, 46]), length: pct5(r, [5, 6, 7, 8, 9]), cooldown: pct5(r, [8, 8, 7, 6, 5]) }),
        cast(ctx, p) {
            const t = ctx.targets('random', 7, 1)[0];
            if (!t) return false;
            ctx.playerAnim(ctx.seq('human_harpoon'));
            travel(ctx, 'rune_javelin_travel', t, 40, 36, 15, 5, 11);
            for (const e of ctx.inLine(ctx.px, ctx.pz, t.x, t.z, p.length + ctx.stats.range)) ctx.hit(e, p.damage, { source: 'harpoon', family: 'fishing', tags: ['projectile'], delay: 1 });
            return true;
        },
        refs: { seqs: ['human_harpoon'], spots: ['rune_javelin_travel'] }
    },
    {
        id: 'big_net', name: 'Big Net', family: 'fishing', kind: 'active', icon: ['staticons', 14], maxRank: 5,
        targeting: 'Densest group of enemies nearby', desc: 'Cast a big net that slows everything caught in it.', tags: ['aoe'],
        params: r => ({ damage: pct5(r, [4, 5, 6, 8, 10]), radius: pct5(r, [1, 2, 2, 2, 3]), slow: pct5(r, [6, 7, 8, 9, 10]), cooldown: pct5(r, [14, 13, 12, 11, 10]) }),
        cast(ctx, p) {
            const c = ctx.nearestCluster(6);
            if (!c) return false;
            ctx.playerAnim(ctx.seq('human_fishing_casting'));
            const radius = area(ctx, p.radius);
            const tiles: number[] = [];
            for (let x = c.x - radius; x <= c.x + radius; x++) for (let z = c.z - radius; z <= c.z + radius; z++) if (ctx.walkable(x, z)) tiles.push(x * 104 + z);
            ctx.mapSpot(ctx.spot('watersplash'), c.x, c.z, 0, 15);
            ctx.addHazard(tiles, 3, p.damage, 'big_net', 'fishing', 'net', { slow: p.slow, hitEvery: 1 });
            return true;
        },
        refs: { seqs: ['human_fishing_casting'], spots: ['watersplash'] }
    },
    {
        id: 'fresh_catch', name: 'Fresh Catch', family: 'fishing', kind: 'passive', icon: ['staticons', 14], maxRank: 5,
        desc: 'Heal a share of your max HP every time you level up.', tags: [],
        params: r => ({ pct: pct5(r, [10, 14, 18, 23, 28]) }),
        apply: (s, p) => (s.healOnLevel += p.pct / 100)
    },
    // --- Fletching ---
    {
        id: 'multishot', name: 'Multishot', family: 'fletching', kind: 'passive', icon: ['staticons', 11], maxRank: 5,
        desc: 'Projectile abilities fire extra projectiles.', tags: [],
        params: r => ({ flat: pct5(r, [1, 1, 2, 2, 3]) }),
        apply: (s, p) => (s.projectiles += p.flat)
    },
    {
        id: 'arrow_ring', name: 'Arrow Ring', family: 'fletching', kind: 'active', icon: ['staticons', 11], maxRank: 5,
        targeting: 'Random enemies all around you', desc: 'Loose a ring of arrows in every direction.', tags: ['projectile'],
        params: r => ({ damage: pct5(r, [10, 13, 16, 20, 24]), count: pct5(r, [4, 5, 6, 7, 8]), cooldown: pct5(r, [10, 9, 8, 7, 6]) }),
        cast(ctx, p) {
            const t = ctx.targets('random', 7 + ctx.stats.range, p.count + ctx.stats.projectiles);
            if (t.length === 0) return false;
            ctx.playerAnim(ctx.seq('human_bow'));
            for (const e of t) ctx.hit(e, p.damage, { source: 'arrow_ring', family: 'fletching', tags: ['projectile'], delay: travel(ctx, 'mithril_arrow_travel', e, 40, 36, 15, 15, 11) });
            return true;
        },
        refs: { spots: ['mithril_arrow_travel'] }
    },
    {
        id: 'feathering', name: 'Feathering', family: 'fletching', kind: 'passive', icon: ['staticons', 11], maxRank: 5,
        desc: 'Better fletched projectiles fly further.', tags: [],
        params: r => ({ flat: pct5(r, [1, 1, 2, 2, 3]), pct: pct5(r, [5, 8, 10, 13, 16]) }),
        apply: (s, p) => { s.range += p.flat; s.damage += p.pct / 100; }
    },
    // --- Agility ---
    {
        id: 'shortcut', name: 'Shortcut', family: 'agility', kind: 'passive', icon: ['staticons', 7], maxRank: 5,
        desc: 'Running drains less energy.', tags: [],
        params: r => ({ pct: pct5(r, [12, 18, 25, 32, 40]) }),
        apply: (s, p) => (s.energyDrain += p.pct / 100)
    },
    {
        id: 'second_wind', name: 'Second Wind', family: 'agility', kind: 'passive', icon: ['staticons', 7], maxRank: 5,
        desc: 'Run energy recovers faster.', tags: [],
        params: r => ({ pct: pct5(r, [30, 45, 60, 80, 100]) }),
        apply: (s, p) => (s.energyRegen += p.pct / 100)
    },
    {
        id: 'nimble', name: 'Nimble', family: 'agility', kind: 'passive', icon: ['staticons', 7], maxRank: 5,
        desc: 'A chance to dodge enemy attacks entirely.', tags: [],
        params: r => ({ chance: pct5(r, [4, 6, 8, 10, 12]) }),
        apply: (s, p) => (s.dodge += p.chance / 100)
    },
    // --- Thieving ---
    {
        id: 'pickpocket', name: 'Pickpocket', family: 'thieving', kind: 'passive', icon: ['staticons', 9], maxRank: 5,
        desc: 'Lift extra coins from everything you kill.', tags: [],
        params: r => ({ pct: pct5(r, [15, 22, 30, 40, 50]), chance: pct5(r, [4, 6, 8, 10, 12]) }),
        apply: (s, p) => { s.coins += p.pct / 100; s.coinOnKill += p.chance / 100; }
    },
    {
        id: 'lucky', name: 'Lucky', family: 'thieving', kind: 'passive', icon: ['staticons', 9], maxRank: 5,
        desc: 'Fortune favours you: rarer level-up cards.', tags: [],
        params: r => ({ pct: pct5(r, [15, 22, 30, 40, 50]) }),
        apply: (s, p) => (s.luck += p.pct / 100)
    },
    {
        id: 'backstab', name: 'Backstab', family: 'thieving', kind: 'passive', icon: ['staticons', 9], maxRank: 5,
        desc: 'Critical hits are more likely.', tags: [],
        params: r => ({ chance: pct5(r, [4, 6, 8, 10, 13]) }),
        apply: (s, p) => (s.crit += p.chance / 100)
    },
    // --- Cooking ---
    {
        id: 'hearty_stew', name: 'Hearty Stew', family: 'cooking', kind: 'passive', icon: ['staticons', 15], maxRank: 5,
        desc: 'A good meal makes you tougher.', tags: [],
        params: r => ({ flat: pct5(r, [15, 22, 30, 40, 50]) }),
        apply: (s, p) => (s.maxHp += p.flat)
    },
    {
        id: 'cooked_meal', name: 'Cooked Meal', family: 'cooking', kind: 'active', icon: ['staticons', 15], maxRank: 5,
        targeting: 'Self heal', desc: 'Eat a freshly cooked meal every so often.', tags: ['heal'],
        params: r => ({ heal: pct5(r, [10, 13, 16, 20, 25]), cooldown: pct5(r, [30, 28, 26, 24, 22]) }),
        cast(ctx, p) {
            ctx.playerAnim(ctx.seq('human_cooking'));
            ctx.heal(p.heal);
            return true;
        },
        refs: { seqs: ['human_cooking'] }
    },
    {
        id: 'food_drops', name: 'Food Drops', family: 'cooking', kind: 'passive', icon: ['staticons', 15], maxRank: 5,
        desc: 'Enemies sometimes drop food that heals you.', tags: [],
        params: r => ({ chance: pct5(r, [2, 3, 4, 5, 6]) }),
        apply: (s, p) => (s.foodDrop += p.chance / 100),
        refs: { objs: ['shark', 'lobster', 'meat_pizza'] }
    },
    // --- Herblore ---
    {
        id: 'attack_potion', name: 'Attack Potion', family: 'herblore', kind: 'passive', icon: ['staticons', 8], maxRank: 5,
        desc: 'All damage increased.', tags: [],
        params: r => ({ pct: pct5(r, [6, 9, 12, 16, 20]) }),
        apply: (s, p) => (s.damage += p.pct / 100)
    },
    {
        id: 'weapon_poison', name: 'Weapon Poison', family: 'herblore', kind: 'passive', icon: ['staticons', 8], maxRank: 5,
        desc: 'Your hits poison enemies for 5 ticks.', tags: [],
        params: r => ({ poison: pct5(r, [1, 2, 3, 4, 5]) }),
        apply: (s, p) => (s.poison += p.poison)
    },
    {
        id: 'super_restore', name: 'Super Restore', family: 'herblore', kind: 'passive', icon: ['staticons', 8], maxRank: 5,
        desc: 'Abilities recover faster.', tags: [],
        params: r => ({ pct: pct5(r, [5, 7, 9, 12, 15]) }),
        apply: (s, p) => (s.cooldown += p.pct / 100)
    },
    // --- Prayer (protection auras; counter boss attack styles) ---
    {
        id: 'protect_melee', name: 'Protect from Melee', family: 'prayer', kind: 'passive', icon: ['prayeron', 14], maxRank: 5,
        desc: 'Reduces melee damage taken.', tags: [],
        params: r => ({ reduce: pct5(r, [20, 30, 40, 50, 60]) }),
        apply: (s, p) => (s.protectMelee += p.reduce / 100)
    },
    {
        id: 'protect_missiles', name: 'Protect from Missiles', family: 'prayer', kind: 'passive', icon: ['prayeron', 13], maxRank: 5,
        desc: 'Reduces ranged damage taken.', tags: [],
        params: r => ({ reduce: pct5(r, [20, 30, 40, 50, 60]) }),
        apply: (s, p) => (s.protectRanged += p.reduce / 100)
    },
    {
        id: 'protect_magic', name: 'Protect from Magic', family: 'prayer', kind: 'passive', icon: ['prayeron', 12], maxRank: 5,
        desc: 'Reduces magic damage taken.', tags: [],
        params: r => ({ reduce: pct5(r, [20, 30, 40, 50, 60]) }),
        apply: (s, p) => (s.protectMagic += p.reduce / 100)
    },
    // --- Smithing ---
    {
        id: 'plating', name: 'Plating', family: 'smithing', kind: 'passive', icon: ['staticons', 13], maxRank: 5,
        desc: 'Smith extra armour plates.', tags: [],
        params: r => ({ pct: pct5(r, [4, 6, 8, 10, 12]) }),
        apply: (s, p) => (s.armour += p.pct / 100)
    },
    {
        id: 'hammer_strike', name: 'Hammer Strike', family: 'smithing', kind: 'active', icon: ['staticons', 13], maxRank: 5,
        targeting: 'Nearest enemies, stunning them', desc: 'A smith\'s hammer blow that rings like an anvil.', tags: ['melee'],
        params: r => ({ damage: pct5(r, [18, 23, 29, 36, 44]), targets: pct5(r, [1, 2, 2, 3, 3]), stun: pct5(r, [2, 2, 3, 3, 4]), cooldown: pct5(r, [9, 9, 8, 7, 6]), range: 2 }),
        cast(ctx, p) {
            const t = ctx.targets('nearest', reach(ctx, p.range), p.targets);
            if (t.length === 0) return false;
            ctx.playerAnim(ctx.seq('human_smithing'));
            for (const e of t) ctx.hit(e, p.damage, { source: 'hammer_strike', family: 'smithing', tags: ['melee'], stun: p.stun, spot: ctx.spot('stunned') });
            return true;
        },
        refs: { seqs: ['human_smithing'], spots: ['stunned'] }
    },
    {
        id: 'spiked_plate', name: 'Spiked Plate', family: 'smithing', kind: 'passive', icon: ['staticons', 13], maxRank: 5,
        desc: 'Reflect part of the damage you take.', tags: [],
        params: r => ({ pct: pct5(r, [10, 15, 20, 26, 33]) }),
        apply: (s, p) => (s.thorns += p.pct / 100)
    },
    // --- Crafting ---
    {
        id: 'jeweller', name: 'Jeweller', family: 'crafting', kind: 'passive', icon: ['staticons', 10], maxRank: 5,
        desc: 'Guardians and caches drop more and better jewellery.', tags: [],
        params: r => ({ pct: pct5(r, [20, 30, 40, 55, 70]) }),
        apply: (s, p) => (s.itemFind += p.pct / 100)
    },
    {
        id: 'gem_cutter', name: 'Gem Cutter', family: 'crafting', kind: 'passive', icon: ['staticons', 10], maxRank: 5,
        desc: 'Critical hits deal more damage.', tags: [],
        params: r => ({ pct: pct5(r, [15, 22, 30, 40, 50]) }),
        apply: (s, p) => (s.critMult += p.pct / 100)
    },
    {
        id: 'amulet_stringing', name: 'Amulet Stringing', family: 'crafting', kind: 'passive', icon: ['staticons', 10], maxRank: 5,
        desc: 'A lucky charm: luck and item find.', tags: [],
        params: r => ({ pct: pct5(r, [8, 12, 16, 21, 27]) }),
        apply: (s, p) => { s.luck += p.pct / 100; s.itemFind += p.pct / 200; }
    },
    // --- Runecrafting ---
    {
        id: 'rune_orbs', name: 'Rune Orbs', family: 'runecrafting', kind: 'active', icon: ['staticons2', 0], maxRank: 5,
        targeting: 'Random enemies in range', desc: 'Elemental runes orbit you and fling themselves at enemies.', tags: ['magic', 'projectile'],
        params: r => ({ damage: pct5(r, [9, 12, 15, 19, 23]), count: pct5(r, [2, 3, 3, 4, 5]), cooldown: pct5(r, [6, 6, 5, 5, 4]) }),
        cast(ctx, p) {
            const t = ctx.targets('random', 6 + ctx.stats.range, p.count + ctx.stats.projectiles);
            if (t.length === 0) return false;
            const spots = ['windstrike_travel', 'waterstrike_travel', 'earthstrike_travel', 'firestrike_travel'];
            t.forEach((e, i) => ctx.hit(e, p.damage, { source: 'rune_orbs', family: 'runecrafting', tags: ['magic', 'projectile'], delay: travel(ctx, spots[i % 4], e, 60, 31, 5, 16, 64) }));
            return true;
        },
        refs: { spots: ['windstrike_travel', 'waterstrike_travel', 'earthstrike_travel', 'firestrike_travel'] }
    },
    {
        id: 'essence_flow', name: 'Essence Flow', family: 'runecrafting', kind: 'passive', icon: ['staticons2', 0], maxRank: 5,
        desc: 'Gain more run XP from orbs.', tags: [],
        params: r => ({ pct: pct5(r, [8, 12, 16, 21, 27]) }),
        apply: (s, p) => (s.xp += p.pct / 100)
    },
    {
        id: 'altar_pulse', name: 'Altar Pulse', family: 'runecrafting', kind: 'active', icon: ['staticons2', 0], maxRank: 5,
        targeting: 'AoE around you', desc: 'Channel an altar: a burst of raw magic around you.', tags: ['magic', 'aoe'],
        params: r => ({ damage: pct5(r, [16, 20, 25, 31, 38]), radius: pct5(r, [2, 3, 3, 3, 4]), cooldown: pct5(r, [16, 15, 14, 13, 12]) }),
        cast(ctx, p) {
            const radius = area(ctx, p.radius);
            const hits = ctx.inRadius(ctx.px, ctx.pz, radius);
            if (hits.length === 0) return false;
            ctx.playerAnim(ctx.seq('human_runecraft'));
            ctx.playerSpot(ctx.spot('runecrafting'));
            for (const e of hits) ctx.hit(e, p.damage, { source: 'altar_pulse', family: 'runecrafting', tags: ['magic', 'aoe'], delay: 1 });
            return true;
        },
        refs: { seqs: ['human_runecraft'], spots: ['runecrafting'] }
    }
];

// ------------------------------------------------------------------------------------------------
// Generic passives (any class)
// ------------------------------------------------------------------------------------------------

export const PASSIVES: AbilityDef[] = [
    { id: 'might', name: 'Might', family: 'passive', kind: 'passive', icon: ['staticons', 1], maxRank: 5, desc: 'All damage increased.', tags: [], params: () => ({ pct: 8 }), apply: (s, p) => (s.damage += p.pct / 100) },
    { id: 'haste', name: 'Haste', family: 'passive', kind: 'passive', icon: ['prayeron', 5], maxRank: 5, desc: 'Ability cooldowns reduced (rounded to whole ticks).', tags: [], params: () => ({ pct: 6 }), apply: (s, p) => (s.cooldown += p.pct / 100) },
    { id: 'reach', name: 'Reach', family: 'passive', kind: 'passive', icon: ['prayeron', 2], maxRank: 5, desc: 'Area of effect increased.', tags: [], params: () => ({ pct: 10 }), apply: (s, p) => (s.area += p.pct / 100) },
    { id: 'vigour', name: 'Vigour', family: 'passive', kind: 'passive', icon: ['staticons', 6], maxRank: 5, desc: 'Max HP increased.', tags: [], params: () => ({ flat: 15 }), apply: (s, p) => (s.maxHp += p.flat) },
    { id: 'guard', name: 'Guard', family: 'passive', kind: 'passive', icon: ['staticons', 2], maxRank: 5, desc: 'Armour increased (caps at 60%).', tags: [], params: () => ({ pct: 4 }), apply: (s, p) => (s.armour += p.pct / 100) },
    { id: 'magnetism', name: 'Magnetism', family: 'passive', kind: 'passive', icon: ['magicon', 16], maxRank: 5, desc: 'Pickup range increased.', tags: [], params: () => ({ flat: 1 }), apply: (s, p) => (s.pickup += p.flat) },
    { id: 'fortune', name: 'Fortune', family: 'passive', kind: 'passive', icon: ['staticons', 9], maxRank: 5, desc: 'Luck increased: better card rarities.', tags: [], params: () => ({ pct: 12 }), apply: (s, p) => (s.luck += p.pct / 100) },
    { id: 'stamina', name: 'Stamina', family: 'passive', kind: 'passive', icon: ['staticons', 7], maxRank: 5, desc: 'Run energy drains slower and recovers faster.', tags: [], params: () => ({ pct: 12 }), apply: (s, p) => { s.energyDrain += p.pct / 100; s.energyRegen += p.pct / 50; } },
    { id: 'precision', name: 'Precision', family: 'passive', kind: 'passive', icon: ['staticons', 0], maxRank: 5, desc: 'Critical hit chance increased.', tags: [], params: () => ({ pct: 4 }), apply: (s, p) => (s.crit += p.pct / 100) },
    { id: 'wisdom', name: 'Wisdom', family: 'passive', kind: 'passive', icon: ['staticons', 5], maxRank: 5, desc: 'More run XP from orbs.', tags: [], params: () => ({ pct: 8 }), apply: (s, p) => (s.xp += p.pct / 100) }
];

export const CLASS_POOLS: Record<string, AbilityDef[]> = { melee: MELEE, ranged: RANGED, magic: MAGIC };
export const SKILL_CARDS = SKILLS;

export const ALL_ABILITIES: AbilityDef[] = [...MELEE, ...RANGED, ...MAGIC, ...SKILLS, ...PASSIVES];
export const ABILITY_BY_ID: Record<string, AbilityDef> = Object.fromEntries(ALL_ABILITIES.map(a => [a.id, a]));
export const FAMILY_BY_ID: Record<string, FamilyDef> = Object.fromEntries(FAMILIES.map(f => [f.id, f]));

// Rarity: multiplies generic passive values and grants a quality bonus on ability cards
export const RARITY_MULT = [1.0, 1.4, 1.8, 2.4, 3.2];
export const RARITY_QUALITY = [0, 0.08, 0.16, 0.28, 0.45];
