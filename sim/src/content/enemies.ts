// Enemy types. `npc` is the cache debug name (resolved + verified against data/game.json).
// Stats are rebalanced for survivors mode; anims come from the NPC's own cache config unless overridden.
import type { Style } from '../types.js';

export type EnemyDef = {
    id: string;
    npc: string;
    hp: number; // base HP before zone/time scaling
    damage: number; // base max hit before scaling
    attackSpeed: number; // ticks between attacks
    range: number; // 1 = melee
    style: Style;
    speed: 1 | 2; // tiles per tick (wolves/hounds run)
    xp: number;
    undead?: boolean;
    projectile?: string; // spotanim for ranged/magic attacks
    impact?: string;
    attackAnim?: string; // seq override (humans have no attack anim in their npc config)
    deathAnim?: string;
    coinChance?: number;
};

const human = { attackAnim: 'human_unarmedpunch', deathAnim: 'human_death' };

export const ENEMIES: Record<string, EnemyDef> = {
    // --- Lumbridge & Draynor ---
    rat: { id: 'rat', npc: 'rat', hp: 5, damage: 2, attackSpeed: 4, range: 1, style: 'melee', speed: 1, xp: 1 },
    giant_rat: { id: 'giant_rat', npc: 'giantrat1', hp: 10, damage: 3, attackSpeed: 4, range: 1, style: 'melee', speed: 1, xp: 2 },
    goblin: { id: 'goblin', npc: 'goblin', hp: 8, damage: 3, attackSpeed: 4, range: 1, style: 'melee', speed: 1, xp: 1 },
    goblin_armed: { id: 'goblin_armed', npc: 'goblin_armed', hp: 14, damage: 4, attackSpeed: 5, range: 1, style: 'melee', speed: 1, xp: 2 },
    man: { id: 'man', npc: 'man', hp: 10, damage: 3, attackSpeed: 4, range: 1, style: 'melee', speed: 1, xp: 2, ...human },
    woman: { id: 'woman', npc: 'woman', hp: 10, damage: 3, attackSpeed: 4, range: 1, style: 'melee', speed: 1, xp: 2, ...human },
    cow: { id: 'cow', npc: 'cow', hp: 18, damage: 3, attackSpeed: 5, range: 1, style: 'melee', speed: 1, xp: 3 },
    giant_spider: { id: 'giant_spider', npc: 'giantspider2', hp: 22, damage: 6, attackSpeed: 4, range: 1, style: 'melee', speed: 1, xp: 4 },
    thug: { id: 'thug', npc: 'thug', hp: 24, damage: 6, attackSpeed: 4, range: 1, style: 'melee', speed: 1, xp: 4 },
    barbarian: { id: 'barbarian', npc: 'barbarian', hp: 26, damage: 7, attackSpeed: 5, range: 1, style: 'melee', speed: 1, xp: 5 },
    dark_wizard: { id: 'dark_wizard', npc: 'young_dark_wizard', hp: 18, damage: 6, attackSpeed: 6, range: 6, style: 'magic', speed: 1, xp: 5, projectile: 'windstrike_travel', impact: 'windstrike_impact', attackAnim: 'human_caststrike', deathAnim: 'human_death' },
    dark_wizard_elder: { id: 'dark_wizard_elder', npc: 'bearded_dark_wizard', hp: 30, damage: 9, attackSpeed: 6, range: 6, style: 'magic', speed: 1, xp: 8, projectile: 'firestrike_travel', impact: 'firestrike_impact', attackAnim: 'human_caststrike', deathAnim: 'human_death' },
    zombie: { id: 'zombie', npc: 'zombie_unarmed', hp: 30, damage: 7, attackSpeed: 5, range: 1, style: 'melee', speed: 1, xp: 5, undead: true },
    skeleton: { id: 'skeleton', npc: 'skeleton_unarmed', hp: 28, damage: 8, attackSpeed: 4, range: 1, style: 'melee', speed: 1, xp: 5, undead: true },
    ghost: { id: 'ghost', npc: 'ghost', hp: 26, damage: 8, attackSpeed: 4, range: 1, style: 'melee', speed: 1, xp: 6, undead: true },
    jail_guard: { id: 'jail_guard', npc: 'jailguard', hp: 40, damage: 10, attackSpeed: 5, range: 1, style: 'melee', speed: 1, xp: 8 },
    black_knight: { id: 'black_knight', npc: 'black_knight', hp: 48, damage: 11, attackSpeed: 5, range: 1, style: 'melee', speed: 1, xp: 10 },

    // --- Edgeville Dungeon ---
    hobgoblin: { id: 'hobgoblin', npc: 'hobgoblin_unarmed', hp: 34, damage: 8, attackSpeed: 4, range: 1, style: 'melee', speed: 1, xp: 6 },
    hobgoblin_armed: { id: 'hobgoblin_armed', npc: 'hobgoblin_armed', hp: 48, damage: 11, attackSpeed: 5, range: 1, style: 'melee', speed: 1, xp: 8 },
    giant_bat: { id: 'giant_bat', npc: 'bat', hp: 30, damage: 7, attackSpeed: 4, range: 1, style: 'melee', speed: 2, xp: 6 },
    chaos_druid: { id: 'chaos_druid', npc: 'chaos_druid', hp: 30, damage: 9, attackSpeed: 6, range: 6, style: 'magic', speed: 1, xp: 7, projectile: 'earthstrike_travel', impact: 'earthstrike_impact', attackAnim: 'human_caststrike', deathAnim: 'human_death' },
    hill_giant: { id: 'hill_giant', npc: 'giant', hp: 70, damage: 14, attackSpeed: 6, range: 1, style: 'melee', speed: 1, xp: 14 },
    moss_giant: { id: 'moss_giant', npc: 'mossgiant', hp: 90, damage: 16, attackSpeed: 6, range: 1, style: 'melee', speed: 1, xp: 18 },
    deadly_spider: { id: 'deadly_spider', npc: 'deadly_red_spider', hp: 40, damage: 10, attackSpeed: 4, range: 1, style: 'melee', speed: 2, xp: 8 },
    giant_skeleton: { id: 'giant_skeleton', npc: 'giantskeleton', hp: 80, damage: 15, attackSpeed: 5, range: 1, style: 'melee', speed: 1, xp: 16, undead: true },
    zombie_armed: { id: 'zombie_armed', npc: 'zombie_armed', hp: 50, damage: 11, attackSpeed: 5, range: 1, style: 'melee', speed: 1, xp: 9, undead: true },
    skeleton_armed: { id: 'skeleton_armed', npc: 'skeleton_armed', hp: 48, damage: 12, attackSpeed: 4, range: 1, style: 'melee', speed: 1, xp: 9, undead: true },

    // --- Deep Wilderness ---
    dark_warrior: { id: 'dark_warrior', npc: 'dark_warrior', hp: 50, damage: 12, attackSpeed: 4, range: 1, style: 'melee', speed: 1, xp: 10 },
    earth_warrior: { id: 'earth_warrior', npc: 'earthwarrior', hp: 70, damage: 14, attackSpeed: 4, range: 1, style: 'melee', speed: 1, xp: 14 },
    ice_warrior: { id: 'ice_warrior', npc: 'icewarrior', hp: 80, damage: 15, attackSpeed: 4, range: 1, style: 'melee', speed: 1, xp: 15 },
    ice_giant: { id: 'ice_giant', npc: 'icegiant', hp: 110, damage: 18, attackSpeed: 5, range: 1, style: 'melee', speed: 1, xp: 20 },
    lesser_demon: { id: 'lesser_demon', npc: 'lesser_demon', hp: 110, damage: 18, attackSpeed: 4, range: 1, style: 'melee', speed: 1, xp: 22 },
    greater_demon: { id: 'greater_demon', npc: 'greater_demon', hp: 160, damage: 24, attackSpeed: 4, range: 1, style: 'melee', speed: 1, xp: 32 },
    hellhound: { id: 'hellhound', npc: 'hellhound', hp: 130, damage: 20, attackSpeed: 4, range: 1, style: 'melee', speed: 2, xp: 28 },
    green_dragon: { id: 'green_dragon', npc: 'green_dragon', hp: 200, damage: 26, attackSpeed: 5, range: 3, style: 'magic', speed: 1, xp: 45, projectile: 'firebreath_travel', impact: 'firebreath_attack' },
    black_demon: { id: 'black_demon', npc: 'black_demon', hp: 240, damage: 30, attackSpeed: 4, range: 1, style: 'melee', speed: 1, xp: 55 },
    chaos_druid_w: { id: 'chaos_druid_w', npc: 'chaos_druid', hp: 50, damage: 13, attackSpeed: 6, range: 6, style: 'magic', speed: 1, xp: 10, projectile: 'earthbolt_travel', impact: 'earthbolt_impact', attackAnim: 'human_caststrike', deathAnim: 'human_death' }
};
