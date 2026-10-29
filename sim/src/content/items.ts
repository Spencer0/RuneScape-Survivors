// Run items: rings, amulets and trinkets dropped by guardians and caches. Real 2004 items.
import type { Stats } from '../types.js';

export type RunItemDef = {
    id: string;
    name: string;
    obj: string; // cache debug name
    kind: 'ring' | 'amulet' | 'trinket';
    rarity: number; // 0..4
    desc: string;
    apply: (s: Stats) => void;
};

export const RUN_ITEMS: RunItemDef[] = [
    { id: 'sapphire_ring', name: 'Sapphire ring', obj: 'sapphire_ring', kind: 'ring', rarity: 0, desc: 'Cooldowns -5%', apply: s => (s.cooldown += 0.05) },
    { id: 'emerald_ring', name: 'Emerald ring', obj: 'emerald_ring', kind: 'ring', rarity: 0, desc: 'Pickup range +2', apply: s => (s.pickup += 2) },
    { id: 'ruby_ring', name: 'Ruby ring', obj: 'ruby_ring', kind: 'ring', rarity: 1, desc: 'Damage +10%', apply: s => (s.damage += 0.1) },
    { id: 'diamond_ring', name: 'Diamond ring', obj: 'diamond_ring', kind: 'ring', rarity: 2, desc: 'Crit chance +8%', apply: s => (s.crit += 0.08) },
    { id: 'dragonstone_ring', name: 'Dragonstone ring', obj: 'dragonstone_ring', kind: 'ring', rarity: 3, desc: 'Crit damage +40%', apply: s => (s.critMult += 0.4) },
    { id: 'ring_of_recoil', name: 'Ring of recoil', obj: 'ring_of_recoil', kind: 'ring', rarity: 1, desc: 'Reflect 25% of damage taken', apply: s => (s.thorns += 0.25) },
    { id: 'ring_of_forging', name: 'Ring of forging', obj: 'ring_of_forging', kind: 'ring', rarity: 1, desc: 'Fire damage +40%', apply: s => (s.burn += 0.4) },
    { id: 'ring_of_dueling', name: 'Ring of dueling', obj: 'ring_of_dueling_8', kind: 'ring', rarity: 1, desc: 'Run energy regen +60%, drain -20%', apply: s => { s.energyRegen += 0.6; s.energyDrain += 0.2; } },
    { id: 'ring_of_wealth', name: 'Ring of wealth', obj: 'ring_of_wealth', kind: 'ring', rarity: 2, desc: 'Coins +35%, luck +20%', apply: s => { s.coins += 0.35; s.luck += 0.2; } },
    { id: 'ring_of_life', name: 'Ring of life', obj: 'ring_of_life', kind: 'ring', rarity: 3, desc: 'One extra life (revive at half HP)', apply: s => (s.revive += 1) },
    { id: 'amulet_of_accuracy', name: 'Amulet of accuracy', obj: 'amulet_of_accuracy', kind: 'amulet', rarity: 0, desc: 'Crit chance +5%', apply: s => (s.crit += 0.05) },
    { id: 'amulet_of_defence', name: 'Amulet of defence', obj: 'amulet_of_defence', kind: 'amulet', rarity: 1, desc: 'Armour +8%', apply: s => (s.armour += 0.08) },
    { id: 'amulet_of_magic', name: 'Amulet of magic', obj: 'amulet_of_magic', kind: 'amulet', rarity: 1, desc: 'Cooldowns -8%', apply: s => (s.cooldown += 0.08) },
    { id: 'amulet_of_strength', name: 'Amulet of strength', obj: 'amulet_of_strength', kind: 'amulet', rarity: 2, desc: 'Damage +15%', apply: s => (s.damage += 0.15) },
    { id: 'amulet_of_power', name: 'Amulet of power', obj: 'amulet_of_power', kind: 'amulet', rarity: 3, desc: 'Damage +8%, armour +5%, max HP +20', apply: s => { s.damage += 0.08; s.armour += 0.05; s.maxHp += 20; } },
    { id: 'amulet_of_glory', name: 'Amulet of glory', obj: 'amulet_of_glory_4', kind: 'amulet', rarity: 4, desc: 'Damage +12%, crit +6%, armour +6%, XP +15%', apply: s => { s.damage += 0.12; s.crit += 0.06; s.armour += 0.06; s.xp += 0.15; } },
    { id: 'holy_water', name: 'Holy water', obj: 'holy_water', kind: 'trinket', rarity: 1, desc: 'Damage vs undead +60%', apply: s => (s.undeadDamage += 0.6) },
    { id: 'wizards_mind_bomb', name: "Wizard's mind bomb", obj: 'wizards_mind_bomb', kind: 'trinket', rarity: 0, desc: 'XP +15%', apply: s => (s.xp += 0.15) },
    { id: 'dragon_bitter', name: 'Dragon bitter', obj: 'dragon_bitter', kind: 'trinket', rarity: 1, desc: 'Damage +14%, armour -4%', apply: s => { s.damage += 0.14; s.armour -= 0.04; } },
    { id: 'prayer_potion', name: 'Prayer potion', obj: '4doseprayerrestore', kind: 'trinket', rarity: 2, desc: 'All protections +12%', apply: s => { s.protectMelee += 0.12; s.protectRanged += 0.12; s.protectMagic += 0.12; } },
    { id: 'ranging_potion', name: 'Ranging potion', obj: '4doserangerspotion', kind: 'trinket', rarity: 2, desc: 'Range +2, +1 projectile', apply: s => { s.range += 2; s.projectiles += 1; } },
    { id: 'magic_logs', name: 'Magic logs', obj: 'magic_logs', kind: 'trinket', rarity: 2, desc: 'Effect duration +30%, area +10%', apply: s => { s.duration += 0.3; s.area += 0.1; } },
    { id: 'casket', name: 'Casket', obj: 'casket', kind: 'trinket', rarity: 0, desc: 'Item find +40%, coins +10%', apply: s => { s.itemFind += 0.4; s.coins += 0.1; } },
    { id: 'antipoison', name: 'Super antipoison', obj: '4dose2antipoison', kind: 'trinket', rarity: 1, desc: 'Regenerate 3 HP every 10 ticks', apply: s => (s.regen += 3) }
];

export const RUN_ITEM_BY_ID: Record<string, RunItemDef> = Object.fromEntries(RUN_ITEMS.map(i => [i.id, i]));
