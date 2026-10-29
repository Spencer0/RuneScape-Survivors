// The simulation -> client update format. This is the in-page stand-in for the RS2 server's
// PLAYER_INFO / NPC_INFO / zone packets: the client applies each field with the same semantics the
// original packet handlers use (moveCode steps, ANIM priority rules, hitmarks, spotanims, OBJ_ADD...),
// but without the 255-NPC count, +/-15 tile range and 255-damage limits of the 2004 wire format.

export const HIT_BLOCK = 0;
export const HIT_DAMAGE = 1;
export const HIT_POISON = 2;

export type Hit = { dmg: number; type: number };

export type NpcAdd = {
    slot: number;
    npc: number; // NpcType id in the cache
    x: number;
    z: number;
    hp: number;
    maxHp: number;
    elite: number; // 0 normal, 1 guardian/elite, 2 boss
    sleeping?: boolean;
};

export type EntityUpdate = {
    slot: number; // -1 = local player
    anim?: number;
    animDelay?: number;
    spot?: number;
    spotHeight?: number;
    spotDelay?: number;
    hits?: Hit[];
    hp?: number;
    maxHp?: number;
    say?: string;
    face?: number; // npc slot to face, -1 to clear
    faceX?: number;
    faceZ?: number;
    npcType?: number; // CHANGETYPE
    dying?: boolean;
};

export type ProjectileView = {
    spot: number;
    fromSlot: number; // -1 = player, otherwise npc slot, -2 = tile
    fromX?: number;
    fromZ?: number;
    toSlot: number; // -1 = player, otherwise npc slot, -2 = tile
    toX?: number;
    toZ?: number;
    startHeight: number;
    endHeight: number;
    delay: number; // client cycles (20ms)
    duration: number; // client cycles
    peak: number;
    arc: number;
};

export type MapSpotView = { spot: number; x: number; z: number; height: number; delay: number };

export type ObjView = { uid: number; x: number; z: number; obj: number; count: number };

export type LocView = { x: number; z: number; loc: number; shape: number; angle: number };

export type TelegraphView = {
    tiles: number[]; // x * 104 + z
    ticksLeft: number;
    total: number;
    colour: number;
};

export type AbilityView = {
    id: string;
    name: string;
    icon: string; // sprite sheet name
    iconIndex: number;
    rank: number;
    maxRank: number;
    cooldown: number; // ticks remaining
    maxCooldown: number;
    family: string;
};

export type SetView = { family: string; name: string; ranks: number; thresholds: number[]; active: number };

export type BossView = { slot: number; name: string; hp: number; maxHp: number; enraged: boolean; style: string };

export type HudView = {
    clockTicks: number;
    level: number;
    xp: number;
    xpNext: number;
    hp: number;
    maxHp: number;
    energy: number; // 0..100
    running: boolean;
    coins: number;
    kills: number;
    abilities: AbilityView[];
    sets: SetView[];
    bosses: BossView[];
    prayer: string | null; // active protection prayer
    nextBossTicks: number;
    endless: boolean;
    rerolls: number;
    banishes: number;
    alive: number;
    items: { name: string; obj: number }[];
};

export type CardView = {
    id: string;
    kind: 'new' | 'rank' | 'passive' | 'heal' | 'coins';
    name: string;
    family: string;
    rarity: number; // 0 common .. 4 legendary
    icon: string;
    iconIndex: number;
    lines: string[];
    rankFrom: number;
    rankTo: number;
};

export type LevelUpView = {
    level: number;
    cards: CardView[];
    rerollCost: number;
    freeRerolls: number;
    skipCoins: number;
    banishes: number;
};

export type GameEvent =
    | { type: 'bossSpawn'; slot: number; name: string; x: number; z: number }
    | { type: 'bossDeath'; slot: number; name: string; final: boolean }
    | { type: 'shake'; strength: number }
    | { type: 'sound'; synth: number }
    | { type: 'message'; text: string; colour?: number }
    | { type: 'levelUp'; level: number }
    | { type: 'victory' }
    | { type: 'death' }
    | { type: 'cacheOpened'; x: number; z: number; item: string }
    | { type: 'enrage'; slot: number; name: string };

export type Snapshot = {
    tick: number;
    playerSteps: number[]; // directions moved this tick (0..2)
    playerRun: boolean;
    playerX: number;
    playerZ: number;
    npcAdds: NpcAdd[];
    npcRemoves: number[];
    // packed per moved npc: slot, x, z, stepCount, dir0, dir1, run
    npcMoves: Int32Array;
    updates: EntityUpdate[];
    projectiles: ProjectileView[];
    mapSpots: MapSpotView[];
    objAdds: ObjView[];
    objDels: ObjView[];
    locs: LocView[];
    telegraphs: TelegraphView[];
    events: GameEvent[];
    hud: HudView;
    levelUp: LevelUpView | null;
    over: RunResults | null;
};

export type RunResults = {
    won: boolean;
    endless: boolean;
    classId: string;
    zoneId: string;
    ticksSurvived: number;
    kills: number;
    coins: number;
    bossesKilled: string[];
    level: number;
    abilities: { name: string; rank: number; family: string }[];
    sets: { name: string; tier: number }[];
    talentXp: number;
    cachesOpened: number;
    guardiansKilled: number;
    damageTaken: number;
    telegraphDamage: number;
    finalBossKilledBy: string | null;
    gearDrops: { classId: string; tier: number; slot: string }[];
    picks: string[];
    maxAlive: number;
};

// client -> simulation
export type Command =
    | { type: 'walk'; x: number; z: number }
    | { type: 'run'; on: boolean }
    | { type: 'pick'; index: number }
    | { type: 'reroll' }
    | { type: 'skip' }
    | { type: 'banish'; index: number }
    | { type: 'endless'; on: boolean }
    | { type: 'quit' };
