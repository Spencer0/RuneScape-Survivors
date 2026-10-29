// The three combat-style classes: starting abilities, talent trees (milestones + capstones), gear.
import type { ClassId, Stats } from '../types.js';

export type TalentDef = {
    id: string;
    name: string;
    icon: [string, number];
    maxRank: number;
    tier: number; // points required in the tree = tier * 5
    desc: (rank: number) => string;
    apply: (s: Stats, rank: number) => void;
    milestone?: boolean;
    capstone?: string; // starting ability replacement
};

export type GearSlot = 'head' | 'body' | 'legs' | 'weapon' | 'shield';
export const GEAR_SLOTS: GearSlot[] = ['head', 'body', 'legs', 'weapon', 'shield'];
export const TIER_NAMES = ['Bronze', 'Iron', 'Steel', 'Mithril', 'Adamant', 'Rune'];

export type ClassDef = {
    id: ClassId;
    name: string;
    style: string;
    icon: [string, number];
    blurb: string;
    start: string; // starting ability id
    base: (s: Stats) => void;
    talents: TalentDef[];
    gear: Record<GearSlot, string[]>; // obj debug names per tier 0..5
    // weapon stance anims [ready, turn, walk, walkb, walkl, walkr, run]
    anims: string[];
};

const common = (cls: string): TalentDef[] => [
    { id: `${cls}_toughness`, name: 'Toughness', icon: ['staticons', 6], maxRank: 5, tier: 0, desc: r => `Max HP +${r * 8}`, apply: (s, r) => (s.maxHp += r * 8) },
    { id: `${cls}_ferocity`, name: 'Ferocity', icon: ['staticons', 1], maxRank: 5, tier: 0, desc: r => `Damage +${r * 3}%`, apply: (s, r) => (s.damage += r * 0.03) },
    { id: `${cls}_swiftness`, name: 'Swiftness', icon: ['staticons', 7], maxRank: 3, tier: 0, desc: r => `Run energy drain -${r * 8}%, regen +${r * 15}%`, apply: (s, r) => { s.energyDrain += r * 0.08; s.energyRegen += r * 0.15; } },
    { id: `${cls}_scavenger`, name: 'Scavenger', icon: ['magicon', 16], maxRank: 3, tier: 1, desc: r => `Pickup range +${r}, coins +${r * 6}%`, apply: (s, r) => { s.pickup += r; s.coins += r * 0.06; } },
    { id: `${cls}_fortunate`, name: 'Fortunate', icon: ['staticons', 9], maxRank: 3, tier: 2, desc: r => `Luck +${r * 10}%`, apply: (s, r) => (s.luck += r * 0.1) },
    { id: `${cls}_veteran`, name: 'Veteran', icon: ['staticons', 5], maxRank: 3, tier: 2, desc: r => `Run XP +${r * 6}%`, apply: (s, r) => (s.xp += r * 0.06) }
];

export const CLASSES: Record<ClassId, ClassDef> = {
    melee: {
        id: 'melee',
        name: 'Melee',
        style: 'Attack, Strength & Defence',
        icon: ['staticons', 0],
        blurb: 'Plate armour and a scimitar. Tough, hits hard up close.',
        start: 'slash',
        base: s => {
            s.maxHp += 30;
            s.armour += 0.06;
        },
        talents: [
            ...common('melee'),
            { id: 'melee_ironhide', name: 'Iron Hide', icon: ['staticons', 2], maxRank: 5, tier: 1, desc: r => `Armour +${r * 2}%`, apply: (s, r) => (s.armour += r * 0.02) },
            { id: 'melee_bloodlust', name: 'Bloodlust', icon: ['prayeron', 10], maxRank: 1, tier: 2, milestone: true, desc: () => 'Milestone: heal 3% of damage dealt', apply: s => (s.lifesteal += 0.03) },
            { id: 'melee_cleaving', name: 'Cleaving', icon: ['combaticons', 3], maxRank: 3, tier: 3, desc: r => `Area +${r * 6}%`, apply: (s, r) => (s.area += r * 0.06) },
            { id: 'melee_warlord', name: 'Warlord', icon: ['prayeron', 9], maxRank: 1, tier: 3, milestone: true, desc: () => 'Milestone: reflect 15% damage, +20 max HP', apply: s => { s.thorns += 0.15; s.maxHp += 20; } },
            { id: 'melee_cap_whirl', name: 'Whirling Blade', icon: ['combaticons', 3], maxRank: 1, tier: 4, capstone: 'whirlwind', desc: () => 'Capstone: start with Whirlwind (rank 2) instead of Slash', apply: () => {} },
            { id: 'melee_cap_exec', name: 'Executioner', icon: ['combaticons', 6], maxRank: 1, tier: 4, capstone: 'puncture', desc: () => 'Capstone: start with Puncture (rank 2) instead of Slash; +10% crit', apply: s => (s.crit += 0.1) }
        ],
        gear: {
            head: ['bronze_full_helm', 'iron_full_helm', 'steel_full_helm', 'mithril_full_helm', 'adamant_full_helm', 'rune_full_helm'],
            body: ['bronze_platebody', 'iron_platebody', 'steel_platebody', 'mithril_platebody', 'adamant_platebody', 'rune_platebody'],
            legs: ['bronze_platelegs', 'iron_platelegs', 'steel_platelegs', 'mithril_platelegs', 'adamant_platelegs', 'rune_platelegs'],
            weapon: ['bronze_scimitar', 'iron_scimitar', 'steel_scimitar', 'mithril_scimitar', 'adamant_scimitar', 'rune_scimitar'],
            shield: ['bronze_kiteshield', 'iron_kiteshield', 'steel_kiteshield', 'mithril_kiteshield', 'adamant_kiteshield', 'rune_kiteshield']
        },
        anims: ['human_ready', 'human_turnonspot', 'human_walk_f', 'human_walk_b', 'human_walk_l', 'human_walk_r', 'human_running']
    },
    ranged: {
        id: 'ranged',
        name: 'Ranged',
        style: 'Ranged',
        icon: ['staticons', 3],
        blurb: 'Leather and hide, bows and thrown blades. Strikes from afar.',
        start: 'shortbow',
        base: s => {
            s.range += 1;
            s.energyRegen += 0.2;
        },
        talents: [
            ...common('ranged'),
            { id: 'ranged_eagle', name: 'Eagle Eye', icon: ['staticons', 3], maxRank: 5, tier: 1, desc: r => `Crit chance +${r * 2}%`, apply: (s, r) => (s.crit += r * 0.02) },
            { id: 'ranged_quiver', name: 'Deep Quiver', icon: ['combaticons2', 5], maxRank: 1, tier: 2, milestone: true, desc: () => 'Milestone: +1 projectile', apply: s => (s.projectiles += 1) },
            { id: 'ranged_longshot', name: 'Longshot', icon: ['combaticons2', 6], maxRank: 3, tier: 3, desc: r => `Range +${r}`, apply: (s, r) => (s.range += r) },
            { id: 'ranged_evasion', name: 'Evasion', icon: ['staticons', 7], maxRank: 1, tier: 3, milestone: true, desc: () => 'Milestone: dodge chance +8%', apply: s => (s.dodge += 0.08) },
            { id: 'ranged_cap_knives', name: 'Knife Master', icon: ['combaticons2', 10], maxRank: 1, tier: 4, capstone: 'knives', desc: () => 'Capstone: start with Knife Flurry (rank 2) instead of Shortbow', apply: () => {} },
            { id: 'ranged_cap_bolt', name: 'Marksman', icon: ['combaticons2', 13], maxRank: 1, tier: 4, capstone: 'bolt', desc: () => 'Capstone: start with Crossbow Bolt (rank 2) instead of Shortbow; +2 range', apply: s => (s.range += 2) }
        ],
        gear: {
            head: ['leather_cowl', 'coif', 'coif', 'coif', 'coif', 'coif'],
            body: ['leather_armour', 'hardleather_body', 'studded_body', 'dragonhide_body', 'blue_dragonhide_body', 'red_dragonhide_body'],
            legs: ['leather_chaps', 'leather_chaps', 'studded_chaps', 'dragonhide_chaps', 'blue_dragonhide_chaps', 'red_dragonhide_chaps'],
            weapon: ['shortbow', 'oak_shortbow', 'willow_shortbow', 'maple_shortbow', 'yew_shortbow', 'magic_shortbow'],
            shield: ['leather_vambraces', 'leather_vambraces', 'leather_vambraces', 'dragon_vambraces', 'blue_dragon_vambraces', 'red_dragon_vambraces']
        },
        anims: ['human_ready', 'human_turnonspot', 'human_walk_f', 'human_walk_b', 'human_walk_l', 'human_walk_r', 'human_running']
    },
    magic: {
        id: 'magic',
        name: 'Magic',
        style: 'Magic',
        icon: ['staticons', 5],
        blurb: 'Robes and a staff. Fragile, but commands the elements.',
        start: 'wind_strike',
        base: s => {
            s.cooldown += 0.05;
            s.xp += 0.05;
            s.maxHp -= 10;
        },
        talents: [
            ...common('magic'),
            { id: 'magic_focus', name: 'Arcane Focus', icon: ['magicon', 9], maxRank: 5, tier: 1, desc: r => `Cooldowns -${r * 2}%`, apply: (s, r) => (s.cooldown += r * 0.02) },
            { id: 'magic_ward', name: 'Ward', icon: ['prayeron', 12], maxRank: 1, tier: 2, milestone: true, desc: () => 'Milestone: all protections +10%', apply: s => { s.protectMelee += 0.1; s.protectRanged += 0.1; s.protectMagic += 0.1; } },
            { id: 'magic_amplify', name: 'Amplify', icon: ['magicon', 20], maxRank: 3, tier: 3, desc: r => `Area +${r * 6}%, duration +${r * 6}%`, apply: (s, r) => { s.area += r * 0.06; s.duration += r * 0.06; } },
            { id: 'magic_runeweaver', name: 'Runeweaver', icon: ['staticons2', 0], maxRank: 1, tier: 3, milestone: true, desc: () => 'Milestone: +1 projectile, XP +10%', apply: s => { s.projectiles += 1; s.xp += 0.1; } },
            { id: 'magic_cap_fire', name: 'Pyromancer', icon: ['magicon', 37], maxRank: 1, tier: 4, capstone: 'fire_wave', desc: () => 'Capstone: start with Fire Wave (rank 2) instead of Wind Strike; fire +20%', apply: s => (s.burn += 0.2) },
            { id: 'magic_cap_iban', name: 'Disciple of Iban', icon: ['magicon', 41], maxRank: 1, tier: 4, capstone: 'iban_blast', desc: () => 'Capstone: start with Iban Blast (rank 2) instead of Wind Strike', apply: () => {} }
        ],
        gear: {
            head: ['bluewizhat', 'blackwizhat', 'blackwizhat', 'gnome_hat_blue', 'wolfenhat_ocean', 'wolfenhat_purple'],
            body: ['wizards_robe', 'black_robe', 'zamrobetop', 'druidrobetop', 'wolfenrobetop_ocean', 'wolfenrobetop_purple'],
            legs: ['blue_skirt', 'black_skirt', 'zamrobebottom', 'druidrobebottom', 'wolfenrobebottom_ocean', 'wolfenrobebottom_purple'],
            weapon: ['staff_of_air', 'staff_of_water', 'staff_of_earth', 'staff_of_fire', 'battlestaff', 'mystic_fire_staff'],
            shield: ['boots_wizard', 'boots_wizard', 'boots_wizard', 'wolfenboots_ocean', 'wolfenboots_ocean', 'wolfenboots_purple']
        },
        anims: ['human_staffready', 'human_turnonspot', 'human_walk_f', 'human_walk_b', 'human_walk_l', 'human_walk_r', 'human_running']
    }
};

// Gear stat contributions per worn piece and full-set bonus
export function applyGear(s: Stats, cls: ClassId, gear: Record<string, number>): { setTier: number } {
    let setTier = 99;
    let pieces = 0;
    for (const slot of ['head', 'body', 'legs', 'weapon', 'shield']) {
        const tier = gear[slot] ?? -1;
        if (tier < 0) {
            setTier = -1;
            continue;
        }
        pieces++;
        setTier = Math.min(setTier, tier);
        const t = tier + 1;
        if (slot === 'weapon') s.damage += 0.03 * t;
        else if (slot === 'body') s.maxHp += 4 * t;
        else if (slot === 'shield') s.armour += 0.008 * t;
        else s.armour += 0.006 * t;
    }
    if (pieces === 5 && setTier >= 0) {
        // full matching-or-better set bonus by the lowest tier worn
        const t = setTier + 1;
        if (cls === 'melee') {
            s.armour += 0.01 * t;
            s.maxHp += 5 * t;
        } else if (cls === 'ranged') {
            s.crit += 0.01 * t;
            s.range += t >= 4 ? 1 : 0;
        } else {
            s.cooldown += 0.01 * t;
            s.xp += 0.02 * t;
        }
        return { setTier };
    }
    return { setTier: -1 };
}

export function setBonusText(cls: ClassId, tier: number): string {
    const t = tier + 1;
    if (cls === 'melee') return `${TIER_NAMES[tier]} set: armour +${t}%, max HP +${5 * t}`;
    if (cls === 'ranged') return `${TIER_NAMES[tier]} set: crit +${t}%${t >= 4 ? ', range +1' : ''}`;
    return `${TIER_NAMES[tier]} set: cooldowns -${t}%, XP +${2 * t}%`;
}
