// The surface content code (abilities, bosses, items) uses to act on the simulation.
import type { Rng } from './rng.js';
import type { Stats, Style } from './types.js';

export type TargetRule = 'nearest' | 'lowest' | 'highest' | 'random' | 'strongest';

export interface EnemyRef {
    readonly slot: number;
    readonly x: number;
    readonly z: number;
    readonly size: number;
    readonly hp: number;
    readonly maxHp: number;
    readonly elite: number;
    readonly undead: boolean;
    readonly alive: boolean;
}

export type HitOptions = {
    source: string; // ability id
    family: string;
    tags?: string[]; // 'fire' | 'projectile' | 'melee' | 'magic' | 'ranged' | 'aoe' | 'poison'
    delay?: number; // ticks until damage lands (projectile travel)
    stun?: number; // ticks
    slow?: number; // ticks
    knockback?: number; // tiles away from player
    poison?: number; // dmg per tick for 5 ticks
    vuln?: number; // +fraction damage taken for 10 ticks
    noCrit?: boolean;
    spot?: number; // spotanim on the enemy when it lands
    spotHeight?: number;
};

export type ProjectileOptions = {
    from?: 'player' | number | { x: number; z: number }; // npc slot or tile
    startHeight?: number;
    endHeight?: number;
    delay?: number; // client cycles
    duration?: number; // client cycles
    peak?: number;
    arc?: number;
};

export interface SimApi {
    readonly tick: number;
    readonly rng: Rng;
    readonly stats: Stats;
    readonly px: number;
    readonly pz: number;
    readonly classId: string;

    seq(name: string): number;
    spot(name: string): number;
    obj(name: string): number;
    loc(name: string): number;

    targets(rule: TargetRule, range: number, count: number, x?: number, z?: number, exclude?: Set<number>): EnemyRef[];
    inRadius(x: number, z: number, radius: number): EnemyRef[];
    inLine(x0: number, z0: number, x1: number, z1: number, length: number): EnemyRef[];
    nearestCluster(range: number): { x: number; z: number; count: number } | null;

    hit(enemy: EnemyRef, damage: number, opts: HitOptions): void;
    projectile(spot: number, to: EnemyRef | { x: number; z: number }, opts?: ProjectileOptions): number; // returns flight ticks
    playerAnim(seq: number, delay?: number): void;
    playerSpot(spot: number, height?: number, delay?: number): void;
    mapSpot(spot: number, x: number, z: number, height?: number, delay?: number): void;
    sound(name: string): void;
    heal(amount: number): void;
    addHazard(tiles: number[], ticks: number, damage: number, source: string, family: string, kind: 'fire' | 'arrows' | 'net' | 'generic', opts?: { slow?: number; fireLocs?: boolean; hitEvery?: number }): void;
    buff(id: string, ticks: number, mods: Partial<Stats>): void;
    hasBuff(id: string): boolean;
    lastMove(): { dx: number; dz: number; moved: boolean; trail: number[] };
    walkable(x: number, z: number): boolean;
    enemyAttackStyle(slot: number): Style | null;
    message(text: string): void;
}
