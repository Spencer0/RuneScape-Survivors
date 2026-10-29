// Meta-progression rules shared by the client (save/profile) and the headless runner:
// talent XP & points, per-class zone unlocks, gear collection, achievements and rewards.
import { CLASSES, GEAR_SLOTS } from './content/classes.js';
import { ZONES, ZONE_BY_ID } from './content/zones.js';
import type { RunResults } from './protocol.js';
import type { ClassId } from './types.js';

export const SAVE_VERSION = 1;

export type ClassProfile = {
    talentXp: number;
    talents: Record<string, number>;
    capstone: string | null;
    unlockedZones: string[];
    zonesWon: string[];
    gear: Record<string, number[]>; // slot -> owned tiers
    equipped: Record<string, number>; // slot -> tier (-1 none)
    bestTicks: number;
    runs: number;
    wins: number;
};

export type Options = {
    shake: number; // 0..100
    bossIntro: boolean;
    autoFrame: boolean;
    cameraLead: boolean;
    music: number; // 0..100
    sound: number;
    hideRoofs: boolean;
    showFps: boolean;
    bossTimes: number[]; // minutes
};

export type Profile = {
    version: number;
    created: number;
    classes: Record<ClassId, ClassProfile>;
    appearance: { gender: number; body: number[]; colours: number[] };
    lastClass: ClassId;
    lastZone: string;
    achievements: Record<string, number>; // id -> unlocked timestamp(run index)
    achievementPoints: number;
    perks: { rerolls: number; banish: number; openingHand: boolean; pet: boolean };
    stats: { runs: number; kills: number; bosses: number; caches: number; guardians: number; wins: number };
    options: Options;
    runSeq: number;
};

export function emptyClass(): ClassProfile {
    return {
        talentXp: 0,
        talents: {},
        capstone: null,
        unlockedZones: [ZONES[0].id],
        zonesWon: [],
        gear: Object.fromEntries(GEAR_SLOTS.map(s => [s, []])),
        equipped: Object.fromEntries(GEAR_SLOTS.map(s => [s, -1])),
        bestTicks: 0,
        runs: 0,
        wins: 0
    };
}

export function defaultOptions(): Options {
    return { shake: 60, bossIntro: true, autoFrame: true, cameraLead: true, music: 60, sound: 60, hideRoofs: true, showFps: false, bossTimes: [3, 6, 9, 12, 16] };
}

export function emptyProfile(): Profile {
    return {
        version: SAVE_VERSION,
        created: 0,
        classes: { melee: emptyClass(), ranged: emptyClass(), magic: emptyClass() },
        appearance: { gender: 0, body: [0, 10, 18, 26, 33, 36, 42], colours: [0, 0, 0, 0, 0] },
        lastClass: 'melee',
        lastZone: ZONES[0].id,
        achievements: {},
        achievementPoints: 0,
        perks: { rerolls: 0, banish: 0, openingHand: false, pet: false },
        stats: { runs: 0, kills: 0, bosses: 0, caches: 0, guardians: 0, wins: 0 },
        options: defaultOptions(),
        runSeq: 0
    };
}

// ---------------------------------------------------------------------------------------------
// Talents
// ---------------------------------------------------------------------------------------------

export const MAX_TALENT_POINTS = 30;

// cumulative XP needed for point n (1-based)
export function talentXpForPoint(n: number): number {
    return 120 * n + 20 * n * (n - 1);
}

export function talentPoints(xp: number): number {
    let n = 0;
    while (n < MAX_TALENT_POINTS && xp >= talentXpForPoint(n + 1)) n++;
    return n;
}

export function spentPoints(cp: ClassProfile): number {
    return Object.values(cp.talents).reduce((a, b) => a + b, 0);
}

export function canRankTalent(cls: ClassId, cp: ClassProfile, id: string): string | null {
    const def = CLASSES[cls].talents.find(t => t.id === id);
    if (!def) return 'Unknown talent';
    const rank = cp.talents[id] ?? 0;
    if (rank >= def.maxRank) return 'Already at max rank';
    if (spentPoints(cp) >= talentPoints(cp.talentXp)) return 'No talent points left';
    if (spentPoints(cp) < def.tier * 5) return `Requires ${def.tier * 5} points spent in the tree`;
    if (def.capstone && CLASSES[cls].talents.some(t => t.capstone && t.id !== id && (cp.talents[t.id] ?? 0) > 0)) return 'Only one capstone at a time';
    return null;
}

export function rankTalent(cls: ClassId, cp: ClassProfile, id: string): boolean {
    if (canRankTalent(cls, cp, id)) return false;
    cp.talents[id] = (cp.talents[id] ?? 0) + 1;
    const def = CLASSES[cls].talents.find(t => t.id === id)!;
    if (def.capstone) cp.capstone = id;
    return true;
}

export function respec(cp: ClassProfile): void {
    cp.talents = {};
    cp.capstone = null;
}

// Talent XP: time survived, kills, bosses, a win and zone difficulty, plus a catch-up bonus for
// classes behind your best class (+20% below 50% of the best, +40% below 25%).
export function computeTalentXp(r: RunResults, profile: Profile): number {
    const zone = ZONE_BY_ID[r.zoneId];
    const minutes = r.ticksSurvived / 100;
    let xp = minutes * 22 + r.kills * 0.35 + r.bossesKilled.length * 140 + (r.won ? 500 : 0) + r.guardiansKilled * 40;
    xp *= zone?.difficulty ?? 1;
    const best = Math.max(...Object.values(profile.classes).map(c => c.talentXp));
    const mine = profile.classes[r.classId as ClassId]?.talentXp ?? 0;
    if (best > 0 && mine < best * 0.25) xp *= 1.4;
    else if (best > 0 && mine < best * 0.5) xp *= 1.2;
    return Math.round(xp);
}

// ---------------------------------------------------------------------------------------------
// Achievements & rewards
// ---------------------------------------------------------------------------------------------

export type AchievementDef = { id: string; name: string; desc: string; points: number; check: (r: RunResults, p: Profile) => boolean };

const finalBoss = (zoneId: string) => ZONE_BY_ID[zoneId].bosses[ZONE_BY_ID[zoneId].bosses.length - 1].id;

export const ACHIEVEMENTS: AchievementDef[] = [
    { id: 'first_blood', name: 'First Blood', desc: 'Kill 100 enemies in one run', points: 5, check: r => r.kills >= 100 },
    { id: 'horde_breaker', name: 'Horde Breaker', desc: 'Kill 1,000 enemies in one run', points: 10, check: r => r.kills >= 1000 },
    { id: 'massacre', name: 'Massacre', desc: 'Kill 2,500 enemies in one run', points: 20, check: r => r.kills >= 2500 },
    { id: 'survivor', name: 'Survivor', desc: 'Survive 10:00 in any zone', points: 10, check: r => r.ticksSurvived >= 1000 },
    { id: 'boss_slayer', name: 'Boss Slayer', desc: 'Defeat a boss', points: 5, check: r => r.bossesKilled.length >= 1 },
    { id: 'lumbridge_saved', name: 'Lumbridge Saved', desc: 'Defeat Count Draynor in Lumbridge', points: 20, check: r => r.bossesKilled.includes(finalBoss('lumbridge')) },
    { id: 'below_edgeville', name: 'Below Edgeville', desc: 'Defeat Chronozon in the Edgeville Dungeon', points: 25, check: r => r.bossesKilled.includes(finalBoss('edgeville_dungeon')) },
    { id: 'dragon_slayer', name: 'Dragon Slayer', desc: 'Defeat the King Black Dragon', points: 30, check: r => r.bossesKilled.includes(finalBoss('wilderness')) },
    { id: 'frugal', name: 'Frugal', desc: 'Win a zone without opening a cache', points: 15, check: r => r.won && r.cachesOpened === 0 },
    { id: 'pyre_for_the_count', name: 'Pyre for the Count', desc: 'Land the killing blow on Count Draynor with a Firemaking card', points: 20, check: r => r.bossesKilled.includes('count_draynor') && r.finalBossKilledBy === 'firemaking' },
    { id: 'guardian_hunter', name: 'Guardian Hunter', desc: 'Kill 3 guardians in one run', points: 10, check: r => r.guardiansKilled >= 3 },
    { id: 'set_collector', name: 'Set Collector', desc: 'Complete 3 skill set bonuses in one run', points: 10, check: r => r.sets.length >= 3 },
    { id: 'untouchable', name: 'Untouchable', desc: 'Kill a boss without taking any telegraph damage', points: 15, check: r => r.bossesKilled.length >= 1 && r.telegraphDamage === 0 },
    { id: 'endless', name: 'No End in Sight', desc: 'Survive to 25:00 in endless mode', points: 20, check: r => r.endless && r.ticksSurvived >= 2500 },
    { id: 'all_rounder', name: 'All-rounder', desc: 'Win a zone with every class', points: 25, check: (_r, p) => Object.values(p.classes).every(c => c.zonesWon.length > 0) }
];

export type RewardDef = { id: string; name: string; desc: string; cost: number; max: number; get: (p: Profile) => number; buy: (p: Profile) => void };

export const REWARDS: RewardDef[] = [
    { id: 'reroll', name: 'Extra Reroll', desc: '+1 free reroll every run (up to 3)', cost: 10, max: 3, get: p => p.perks.rerolls, buy: p => (p.perks.rerolls += 1) },
    { id: 'banish', name: 'Banish', desc: 'Remove a card from the run and redeal (+1 per run, up to 3)', cost: 15, max: 3, get: p => p.perks.banish, buy: p => (p.perks.banish += 1) },
    { id: 'opening_hand', name: 'Opening Hand', desc: 'Your first level-up each run deals 4 cards', cost: 20, max: 1, get: p => (p.perks.openingHand ? 1 : 0), buy: p => (p.perks.openingHand = true) },
    { id: 'pet', name: 'Pet Kitten', desc: 'A kitten follows you and fetches orbs and coins', cost: 25, max: 1, get: p => (p.perks.pet ? 1 : 0), buy: p => (p.perks.pet = true) }
];

export function rewardCostFor(def: RewardDef, p: Profile): number {
    return def.cost * (def.get(p) + 1);
}

export function spentAchievementPoints(p: Profile): number {
    let spent = 0;
    for (const r of REWARDS) for (let i = 0; i < r.get(p); i++) spent += r.cost * (i + 1);
    return spent;
}

// Apply a finished run to the profile. Returns what changed, for the results screen.
export type RunApplied = { talentXp: number; newAchievements: AchievementDef[]; unlockedZone: string | null; gear: { slot: string; tier: number; isNew: boolean }[] };

export function applyRun(p: Profile, r: RunResults): RunApplied {
    const cp = p.classes[r.classId as ClassId];
    const xp = computeTalentXp(r, p);
    cp.talentXp += xp;
    cp.runs++;
    cp.bestTicks = Math.max(cp.bestTicks, r.ticksSurvived);
    p.stats.runs++;
    p.stats.kills += r.kills;
    p.stats.bosses += r.bossesKilled.length;
    p.stats.caches += r.cachesOpened;
    p.stats.guardians += r.guardiansKilled;
    p.runSeq++;

    let unlockedZone: string | null = null;
    if (r.won) {
        cp.wins++;
        p.stats.wins++;
        if (!cp.zonesWon.includes(r.zoneId)) cp.zonesWon.push(r.zoneId);
        const next = ZONES.find(z => z.unlockedBy === r.zoneId);
        if (next && !cp.unlockedZones.includes(next.id)) {
            cp.unlockedZones.push(next.id);
            unlockedZone = next.id;
        }
    }

    const gear: RunApplied['gear'] = [];
    for (const g of r.gearDrops) {
        const owned = cp.gear[g.slot] ?? (cp.gear[g.slot] = []);
        const isNew = !owned.includes(g.tier);
        if (isNew) owned.push(g.tier);
        gear.push({ slot: g.slot, tier: g.tier, isNew });
        if ((cp.equipped[g.slot] ?? -1) < g.tier && isNew) cp.equipped[g.slot] = g.tier;
    }

    const newAchievements: AchievementDef[] = [];
    for (const a of ACHIEVEMENTS) {
        if (p.achievements[a.id] !== undefined) continue;
        if (a.check(r, p)) {
            p.achievements[a.id] = p.runSeq;
            p.achievementPoints += a.points;
            newAchievements.push(a);
        }
    }
    return { talentXp: xp, newAchievements, unlockedZone, gear };
}

export function zoneLockText(zoneId: string): string {
    const z = ZONE_BY_ID[zoneId];
    if (!z.unlockedBy) return '';
    const prev = ZONE_BY_ID[z.unlockedBy];
    return `Defeat ${prev.bosses[prev.bosses.length - 1].name} in ${prev.name} to unlock`;
}

// Validates and migrates an imported/loaded save. Throws on garbage.
export function sanitizeProfile(raw: unknown): Profile {
    if (!raw || typeof raw !== 'object') throw new Error('Not a save file');
    const src = raw as Partial<Profile>;
    if (typeof src.version !== 'number' || !src.classes) throw new Error('Not a Gielinor Survivors save');
    const p = emptyProfile();
    p.created = typeof src.created === 'number' ? src.created : 0;
    for (const c of ['melee', 'ranged', 'magic'] as ClassId[]) {
        const s = src.classes[c];
        if (!s) continue;
        const cp = p.classes[c];
        cp.talentXp = Math.max(0, Number(s.talentXp) || 0);
        cp.talents = typeof s.talents === 'object' && s.talents ? { ...s.talents } : {};
        cp.capstone = typeof s.capstone === 'string' ? s.capstone : null;
        cp.unlockedZones = Array.isArray(s.unlockedZones) ? s.unlockedZones.filter(z => ZONE_BY_ID[z]) : [ZONES[0].id];
        if (!cp.unlockedZones.includes(ZONES[0].id)) cp.unlockedZones.unshift(ZONES[0].id);
        cp.zonesWon = Array.isArray(s.zonesWon) ? s.zonesWon.filter(z => ZONE_BY_ID[z]) : [];
        for (const slot of GEAR_SLOTS) {
            cp.gear[slot] = Array.isArray(s.gear?.[slot]) ? s.gear[slot].filter(t => t >= 0 && t <= 5) : [];
            const eq = s.equipped?.[slot];
            cp.equipped[slot] = typeof eq === 'number' && cp.gear[slot].includes(eq) ? eq : -1;
        }
        cp.bestTicks = Number(s.bestTicks) || 0;
        cp.runs = Number(s.runs) || 0;
        cp.wins = Number(s.wins) || 0;
        // drop talents that no longer exist / exceed max ranks
        for (const [id, rank] of Object.entries(cp.talents)) {
            const def = CLASSES[c].talents.find(t => t.id === id);
            if (!def || typeof rank !== 'number' || rank <= 0) delete cp.talents[id];
            else cp.talents[id] = Math.min(def.maxRank, rank);
        }
        if (spentPoints(cp) > talentPoints(cp.talentXp)) respec(cp);
    }
    if (src.appearance && Array.isArray(src.appearance.body) && Array.isArray(src.appearance.colours)) {
        p.appearance = { gender: src.appearance.gender ? 1 : 0, body: src.appearance.body.slice(0, 7), colours: src.appearance.colours.slice(0, 5) };
    }
    p.lastClass = src.lastClass && ['melee', 'ranged', 'magic'].includes(src.lastClass) ? src.lastClass : 'melee';
    p.lastZone = src.lastZone && ZONE_BY_ID[src.lastZone] ? src.lastZone : ZONES[0].id;
    p.achievements = typeof src.achievements === 'object' && src.achievements ? { ...src.achievements } : {};
    p.achievementPoints = ACHIEVEMENTS.filter(a => p.achievements[a.id] !== undefined).reduce((s, a) => s + a.points, 0);
    if (src.perks) {
        p.perks.rerolls = Math.min(3, Math.max(0, Number(src.perks.rerolls) || 0));
        p.perks.banish = Math.min(3, Math.max(0, Number(src.perks.banish) || 0));
        p.perks.openingHand = !!src.perks.openingHand;
        p.perks.pet = !!src.perks.pet;
    }
    if (spentAchievementPoints(p) > p.achievementPoints) p.perks = { rerolls: 0, banish: 0, openingHand: false, pet: false };
    if (src.stats) p.stats = { ...p.stats, ...src.stats };
    if (src.options) p.options = { ...p.options, ...src.options };
    p.runSeq = Number(src.runSeq) || 0;
    return p;
}
