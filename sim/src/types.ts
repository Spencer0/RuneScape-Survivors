// Core simulation types. Coordinates are build-area local tiles (0..103) of the arena's region.
export type Style = 'melee' | 'ranged' | 'magic';
export type ClassId = 'melee' | 'ranged' | 'magic';

// Resolved cache data the simulation needs (subset of data/game.json)
export type GameDb = {
    npcs: Record<string, { id: number; name: string; size: number; attackAnim: number; defendAnim: number; deathAnim: number; walkAnim: number; readyAnim: number; hitpoints: number; vislevel: number }>;
    seqs: Record<string, number>;
    spotanims: Record<string, number>;
    objs: Record<string, number>;
    locs: Record<string, number>;
    synths: Record<string, number>;
};

export type Stats = {
    damage: number; // +fraction
    cooldown: number; // fraction reduction (0..0.6)
    area: number; // +fraction radius/size
    maxHp: number; // flat
    armour: number; // fraction (capped 0.6)
    pickup: number; // tiles
    luck: number; // +fraction
    energyDrain: number; // fraction reduction of run drain
    energyRegen: number; // +fraction regen
    crit: number; // chance 0..1
    critMult: number; // multiplier on crit
    projectiles: number; // extra projectiles for projectile abilities
    range: number; // +tiles for ranged/projectile abilities
    duration: number; // +fraction for hazards/buffs
    xp: number; // +fraction
    coins: number; // +fraction
    regen: number; // hp per 10 ticks
    dodge: number; // chance
    thorns: number; // fraction reflected
    burn: number; // +fraction fire damage
    poison: number; // poison dmg per hit (flat, 0 = none)
    lifesteal: number; // fraction of damage dealt
    bossDamage: number; // +fraction vs bosses/elites/large
    undeadDamage: number;
    itemFind: number; // +fraction jewellery/item drops
    protectMelee: number; // fraction reduction
    protectRanged: number;
    protectMagic: number;
    foodDrop: number; // chance per kill
    healOnLevel: number; // fraction of max HP
    revive: number; // extra lives
    coinOnKill: number; // flat chance bonus
    knockback: number; // tiles added to knockback effects
    slowOnHit: number; // chance
    explodeOnKill: number; // fraction of max hp of killed enemy dealt around it
};

export function baseStats(): Stats {
    return {
        damage: 0,
        cooldown: 0,
        area: 0,
        maxHp: 100,
        armour: 0,
        pickup: 2,
        luck: 0,
        energyDrain: 0,
        energyRegen: 0,
        crit: 0.05,
        critMult: 1.5,
        projectiles: 0,
        range: 0,
        duration: 0,
        xp: 0,
        coins: 0,
        regen: 0,
        dodge: 0,
        thorns: 0,
        burn: 0,
        poison: 0,
        lifesteal: 0,
        bossDamage: 0,
        undeadDamage: 0,
        itemFind: 0,
        protectMelee: 0,
        protectRanged: 0,
        protectMagic: 0,
        foodDrop: 0,
        healOnLevel: 0,
        revive: 0,
        coinOnKill: 0,
        knockback: 0,
        slowOnHit: 0,
        explodeOnKill: 0
    };
}

export type StatKey = keyof Stats;

export const ARMOUR_CAP = 0.6;
export const COOLDOWN_CAP = 0.6;

// Profile data the simulation needs at run start (from the meta-progression save)
export type RunLoadout = {
    classId: ClassId;
    zoneId: string;
    seed: number;
    talents: Record<string, number>; // talent id -> rank
    capstone: string | null;
    gear: Record<string, number>; // slot -> tier (0..5), -1 none
    perks: { rerolls: number; banish: number; openingHand: boolean; pet: boolean };
    appearance: number[];
    bossTimes?: number[]; // ticks; default 3/6/9/12/16 min
    debugMaxTalents?: boolean;
};

export const TICKS_PER_MINUTE = 100; // 600 ms ticks

export type Pickup = {
    uid: number;
    x: number;
    z: number;
    kind: 'xp' | 'coins' | 'magnet' | 'food' | 'item';
    value: number;
    obj: number;
    item?: string;
    pulled: boolean;
};

export type Telegraph = {
    tiles: number[]; // idx
    createdTick: number;
    landTick: number;
    damage: number;
    colour: number;
    owner: number; // boss slot
    style: Style;
    spot: number; // spotanim on impact (-1 none)
    shake: number;
};

export type Hazard = {
    tiles: Set<number>;
    ticksLeft: number;
    damage: number;
    source: string; // ability id
    family: string;
    kind: 'fire' | 'arrows' | 'net' | 'generic';
    slow: number;
    locs: { x: number; z: number }[]; // fire locs placed for this hazard
    hitEvery: number;
    age: number;
};
