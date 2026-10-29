// Zones: real 2004 map areas, native rosters, five bosses on a fixed schedule, guardians, caches.
import type { Style } from '../types.js';
import type { PatternId } from './patterns.js';

export type BossForm = {
    npc: string; // cache debug name
    hpFrac: number; // switch to this form when HP fraction drops to/below this (first form = 1)
    style: Style;
    say?: string;
};

export type BossDef = {
    id: string;
    name: string;
    forms: BossForm[];
    hp: number;
    damage: number;
    attackSpeed: number;
    range: number;
    patterns: PatternId[];
    patternCooldown: number; // ticks between patterns
    patternDamage: number; // fraction of player max HP
    styleSwitch?: Style[]; // rotates attack style every styleTicks (countered by Protect prayers)
    styleTicks?: number;
    projectile?: Partial<Record<Style, string>>;
    impact?: Partial<Record<Style, string>>;
    attackAnim?: Partial<Record<Style, string>>;
    intro: string;
};

export type RosterEntry = { enemy: string; from: number; to: number; weight: number }; // minutes

export type ZoneDef = {
    id: string;
    name: string;
    arena: string;
    flavour: string;
    difficulty: number; // enemy HP/damage multiplier, talent XP multiplier
    order: number;
    unlockedBy: string | null; // previous zone id (its final boss)
    roster: RosterEntry[];
    bosses: BossDef[]; // 5, last one is the final boss
    guardians: string[]; // enemy ids used as sleeping elites in lairs
    cacheCost: number;
};

const B = (o: BossDef) => o;

export const ZONES: ZoneDef[] = [
    {
        id: 'lumbridge',
        name: 'Lumbridge',
        arena: 'lumbridge',
        flavour: 'The Duke\'s castle is overrun. Hold the courtyard until Count Draynor rises.',
        difficulty: 1,
        order: 0,
        unlockedBy: null,
        cacheCost: 60,
        guardians: ['black_knight', 'jail_guard', 'barbarian', 'dark_wizard_elder'],
        roster: [
            { enemy: 'rat', from: 0, to: 4, weight: 4 },
            { enemy: 'goblin', from: 0, to: 6, weight: 5 },
            { enemy: 'giant_rat', from: 1, to: 8, weight: 3 },
            { enemy: 'man', from: 1, to: 7, weight: 2 },
            { enemy: 'woman', from: 1, to: 7, weight: 2 },
            { enemy: 'cow', from: 2, to: 6, weight: 1 },
            { enemy: 'goblin_armed', from: 3, to: 10, weight: 4 },
            { enemy: 'giant_spider', from: 4, to: 12, weight: 3 },
            { enemy: 'thug', from: 5, to: 12, weight: 3 },
            { enemy: 'dark_wizard', from: 6, to: 16, weight: 2 },
            { enemy: 'barbarian', from: 7, to: 16, weight: 3 },
            { enemy: 'zombie', from: 9, to: 99, weight: 4 },
            { enemy: 'skeleton', from: 10, to: 99, weight: 4 },
            { enemy: 'ghost', from: 11, to: 99, weight: 3 },
            { enemy: 'dark_wizard_elder', from: 12, to: 99, weight: 2 },
            { enemy: 'jail_guard', from: 13, to: 99, weight: 2 },
            { enemy: 'black_knight', from: 14, to: 99, weight: 2 }
        ],
        bosses: [
            B({
                id: 'witches_experiment', name: 'Witches experiment', hp: 900, damage: 10, attackSpeed: 4, range: 1,
                forms: [
                    { npc: 'shapeshifterglob', hpFrac: 1, style: 'melee' },
                    { npc: 'shapeshifterspider', hpFrac: 0.75, style: 'melee', say: 'The experiment shifts form!' },
                    { npc: 'shapeshifterbear', hpFrac: 0.5, style: 'melee', say: 'It becomes a bear!' },
                    { npc: 'shapeshifterwolf', hpFrac: 0.25, style: 'melee', say: 'A wolf! Run!' }
                ],
                patterns: ['target', 'squares'], patternCooldown: 9, patternDamage: 0.22,
                intro: 'The Witch\'s experiment escapes!'
            }),
            B({
                id: 'delrith', name: 'Delrith', hp: 1600, damage: 13, attackSpeed: 4, range: 1,
                forms: [{ npc: 'delrith', hpFrac: 1, style: 'melee' }],
                patterns: ['cross', 'target', 'rocks'], patternCooldown: 8, patternDamage: 0.25,
                intro: 'Delrith has been summoned!'
            }),
            B({
                id: 'melzar', name: 'Melzar the Mad', hp: 2300, damage: 15, attackSpeed: 4, range: 6,
                forms: [{ npc: 'melzar_the_mad', hpFrac: 1, style: 'magic' }],
                styleSwitch: ['magic', 'melee', 'magic', 'ranged'], styleTicks: 25,
                projectile: { magic: 'firebolt_travel', ranged: 'iron_arrow_travel' },
                impact: { magic: 'firebolt_impact' },
                attackAnim: { magic: 'human_caststrike', melee: 'human_unarmedpunch', ranged: 'human_throw' },
                patterns: ['lines', 'squares', 'rings'], patternCooldown: 8, patternDamage: 0.25,
                intro: 'Melzar the Mad cackles from the maze!'
            }),
            B({
                id: 'black_knight_titan', name: 'Black Knight Titan', hp: 3400, damage: 18, attackSpeed: 5, range: 1,
                forms: [{ npc: 'black_knight_titan', hpFrac: 1, style: 'melee' }],
                patterns: ['rings', 'cross', 'rocks', 'squares'], patternCooldown: 8, patternDamage: 0.28,
                intro: 'The Black Knight Titan towers over you!'
            }),
            B({
                id: 'count_draynor', name: 'Count Draynor', hp: 6000, damage: 20, attackSpeed: 4, range: 1,
                forms: [{ npc: 'count_draynor', hpFrac: 1, style: 'melee' }],
                styleSwitch: ['melee', 'magic'], styleTicks: 30,
                projectile: { magic: 'curse_travel' }, impact: { magic: 'curse_impact' },
                attackAnim: { melee: 'human_unarmedpunch', magic: 'human_castcurse' },
                patterns: ['wipe', 'rings', 'target', 'lines', 'rocks'], patternCooldown: 7, patternDamage: 0.3,
                intro: 'Count Draynor rises from his coffin!'
            })
        ]
    },
    {
        id: 'edgeville_dungeon',
        name: 'Edgeville Dungeon',
        arena: 'edgeville_dungeon',
        flavour: 'Giants, the restless dead and worse lurk beneath Edgeville. Chronozon waits below.',
        difficulty: 1.7,
        order: 1,
        unlockedBy: 'lumbridge',
        cacheCost: 110,
        guardians: ['moss_giant', 'giant_skeleton', 'hill_giant'],
        roster: [
            { enemy: 'skeleton', from: 0, to: 6, weight: 4 },
            { enemy: 'zombie', from: 0, to: 6, weight: 4 },
            { enemy: 'giant_rat', from: 0, to: 4, weight: 3 },
            { enemy: 'hobgoblin', from: 1, to: 9, weight: 3 },
            { enemy: 'giant_bat', from: 2, to: 12, weight: 2 },
            { enemy: 'chaos_druid', from: 3, to: 14, weight: 2 },
            { enemy: 'ghost', from: 3, to: 12, weight: 3 },
            { enemy: 'skeleton_armed', from: 5, to: 99, weight: 4 },
            { enemy: 'zombie_armed', from: 5, to: 99, weight: 4 },
            { enemy: 'hobgoblin_armed', from: 6, to: 99, weight: 3 },
            { enemy: 'deadly_spider', from: 7, to: 99, weight: 2 },
            { enemy: 'hill_giant', from: 8, to: 99, weight: 3 },
            { enemy: 'moss_giant', from: 11, to: 99, weight: 2 },
            { enemy: 'giant_skeleton', from: 12, to: 99, weight: 2 }
        ],
        bosses: [
            B({
                id: 'nazastarool', name: 'Nazastarool', hp: 1800, damage: 16, attackSpeed: 4, range: 1,
                forms: [
                    { npc: 'zq_mainzombie1', hpFrac: 1, style: 'melee' },
                    { npc: 'zq_mainzombie2', hpFrac: 0.66, style: 'melee', say: 'Nazastarool rises again as a skeleton!' },
                    { npc: 'zq_mainzombie3', hpFrac: 0.33, style: 'melee', say: 'Nazastarool returns as a ghost!' }
                ],
                patterns: ['target', 'squares', 'rocks'], patternCooldown: 8, patternDamage: 0.24,
                intro: 'Nazastarool stirs in the dark!'
            }),
            B({
                id: 'koschei', name: 'Koschei the deathless', hp: 2600, damage: 18, attackSpeed: 4, range: 1,
                forms: [
                    { npc: 'viking_enemy1', hpFrac: 1, style: 'melee' },
                    { npc: 'viking_enemy2', hpFrac: 0.75, style: 'melee', say: 'You cannot kill me!' },
                    { npc: 'viking_enemy3', hpFrac: 0.5, style: 'melee', say: 'I am deathless!' },
                    { npc: 'viking_enemy4', hpFrac: 0.25, style: 'melee', say: 'Enough!' }
                ],
                patterns: ['lines', 'cross', 'target'], patternCooldown: 8, patternDamage: 0.26,
                intro: 'Koschei the deathless challenges you!'
            }),
            B({
                id: 'tree_spirit', name: 'Tree spirit', hp: 3600, damage: 19, attackSpeed: 4, range: 1,
                forms: [{ npc: 'tree_spirit', hpFrac: 1, style: 'melee' }],
                patterns: ['rings', 'rocks', 'squares'], patternCooldown: 8, patternDamage: 0.27,
                intro: 'The Tree spirit guards the way!'
            }),
            B({
                id: 'dagannoth_mother', name: 'Dagannoth mother', hp: 5000, damage: 22, attackSpeed: 4, range: 5,
                forms: [{ npc: 'horror_dagganoth_air', hpFrac: 1, style: 'magic' }],
                styleSwitch: ['magic', 'ranged', 'melee'], styleTicks: 22,
                projectile: { magic: 'windblast_travel', ranged: 'kalphite_spine' }, impact: { magic: 'windblast_impact' },
                patterns: ['wipe', 'lines', 'rings', 'cross'], patternCooldown: 7, patternDamage: 0.28,
                intro: 'The Dagannoth mother surfaces!'
            }),
            B({
                id: 'chronozon', name: 'Chronozon', hp: 8500, damage: 26, attackSpeed: 4, range: 4,
                forms: [{ npc: 'chronozon', hpFrac: 1, style: 'melee' }],
                styleSwitch: ['melee', 'magic'], styleTicks: 28,
                projectile: { magic: 'firewave_travel' }, impact: { magic: 'firewave_impact' },
                patterns: ['wipe', 'cross', 'rocks', 'rings', 'squares'], patternCooldown: 6, patternDamage: 0.32,
                intro: 'Chronozon, the blood demon, awakens!'
            })
        ]
    },
    {
        id: 'wilderness',
        name: 'Deep Wilderness',
        arena: 'wilderness',
        flavour: 'The Demonic Ruins. Demons, dragons and the King Black Dragon himself.',
        difficulty: 2.6,
        order: 2,
        unlockedBy: 'edgeville_dungeon',
        cacheCost: 180,
        guardians: ['greater_demon', 'green_dragon', 'ice_giant', 'hellhound'],
        roster: [
            { enemy: 'skeleton_armed', from: 0, to: 5, weight: 4 },
            { enemy: 'dark_warrior', from: 0, to: 7, weight: 4 },
            { enemy: 'chaos_druid_w', from: 1, to: 12, weight: 2 },
            { enemy: 'ice_warrior', from: 2, to: 10, weight: 3 },
            { enemy: 'earth_warrior', from: 3, to: 12, weight: 3 },
            { enemy: 'lesser_demon', from: 4, to: 99, weight: 4 },
            { enemy: 'ice_giant', from: 6, to: 99, weight: 2 },
            { enemy: 'hellhound', from: 8, to: 99, weight: 2 },
            { enemy: 'greater_demon', from: 9, to: 99, weight: 3 },
            { enemy: 'green_dragon', from: 11, to: 99, weight: 1 },
            { enemy: 'black_demon', from: 13, to: 99, weight: 2 }
        ],
        bosses: [
            B({
                id: 'kolodion', name: 'Kolodion', hp: 3000, damage: 22, attackSpeed: 5, range: 7,
                forms: [
                    { npc: 'kologre', hpFrac: 1, style: 'melee' },
                    { npc: 'kolspider', hpFrac: 0.75, style: 'melee', say: 'Kolodion becomes a spider!' },
                    { npc: 'kolethereal', hpFrac: 0.5, style: 'magic', say: 'Kolodion turns ethereal!' },
                    { npc: 'koldemon', hpFrac: 0.25, style: 'magic', say: 'Kolodion becomes a demon!' }
                ],
                styleSwitch: ['melee', 'magic'], styleTicks: 20,
                projectile: { magic: 'saradomin_lightning' }, impact: { magic: 'saradomin_lightning' },
                patterns: ['target', 'rings', 'squares'], patternCooldown: 8, patternDamage: 0.26,
                intro: 'Kolodion, the battle mage, appears!'
            }),
            B({
                id: 'elvarg', name: 'Elvarg', hp: 4500, damage: 26, attackSpeed: 5, range: 4,
                forms: [{ npc: 'elvarg', hpFrac: 1, style: 'magic' }],
                projectile: { magic: 'firebreath_travel' }, impact: { magic: 'firebreath_attack' },
                attackAnim: { magic: 'dragon_firebreath_attack' },
                patterns: ['cross', 'lines', 'rocks'], patternCooldown: 7, patternDamage: 0.28,
                intro: 'Elvarg descends from Crandor!'
            }),
            B({
                id: 'black_demon_boss', name: 'Black Demon', hp: 6000, damage: 28, attackSpeed: 4, range: 1,
                forms: [{ npc: 'black_demon', hpFrac: 1, style: 'melee' }],
                patterns: ['wipe', 'squares', 'rings'], patternCooldown: 7, patternDamage: 0.3,
                intro: 'A Black Demon tears free of the ruins!'
            }),
            B({
                id: 'kalphite_queen', name: 'Kalphite Queen', hp: 8000, damage: 30, attackSpeed: 4, range: 6,
                forms: [
                    { npc: 'kalphite_queen', hpFrac: 1, style: 'ranged' },
                    { npc: 'kalphite_flyingqueen', hpFrac: 0.5, style: 'magic', say: 'The Kalphite Queen takes flight!' }
                ],
                styleSwitch: ['ranged', 'magic'], styleTicks: 24,
                projectile: { ranged: 'kalphite_queen_spine', magic: 'kalphite_glow_travel' }, impact: { magic: 'kalphite_glow_impact' },
                attackAnim: { ranged: 'kalphite_queen_ranged_attack', magic: 'kalphite_queen_lightning' },
                patterns: ['rocks', 'lines', 'cross', 'wipe'], patternCooldown: 6, patternDamage: 0.3,
                intro: 'The Kalphite Queen bursts from the sand!'
            }),
            B({
                id: 'king_black_dragon', name: 'King Black Dragon', hp: 12000, damage: 34, attackSpeed: 4, range: 5,
                forms: [{ npc: 'king_dragon', hpFrac: 1, style: 'magic' }],
                styleSwitch: ['magic', 'ranged', 'melee'], styleTicks: 20,
                projectile: { magic: 'firebreath_travel', ranged: 'icebreath_attack' }, impact: { magic: 'firebreath_attack', ranged: 'icebreath_attack' },
                attackAnim: { magic: 'dragon_firebreath_attack', ranged: 'dragon_icebreath_attack', melee: 'dragon_attack' },
                patterns: ['wipe', 'rings', 'cross', 'rocks', 'lines', 'squares'], patternCooldown: 6, patternDamage: 0.34,
                intro: 'The King Black Dragon roars!'
            })
        ]
    }
];

export const ZONE_BY_ID: Record<string, ZoneDef> = Object.fromEntries(ZONES.map(z => [z.id, z]));

// default schedule in minutes: 3, 6, 9, 12, final at 16
export const DEFAULT_BOSS_MINUTES = [3, 6, 9, 12, 16];
export const ENDLESS_BOSS_INTERVAL = 150; // ticks (1.5 min) between endless bosses
