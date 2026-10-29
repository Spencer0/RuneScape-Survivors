// Telegraphed tile attack patterns. Each generator returns one or more waves of tiles, each with
// its own delay (ticks from the first highlighted tick to impact). The simulation then runs the
// fairness validator (sim/src/fairness.ts) which guarantees every wave is escapable at walking
// speed by a player who reacts on the first highlighted tick, trimming tiles if necessary.
import type { Rng } from '../rng.js';

export type PatternId = 'target' | 'squares' | 'cross' | 'lines' | 'rings' | 'rocks' | 'wipe';

export type Wave = { tiles: number[]; delay: number };

export type PatternCtx = {
    rng: Rng;
    px: number;
    pz: number;
    bx: number; // boss centre
    bz: number;
    delay: number; // base telegraph length in ticks (3 normally, 2 enraged)
    walkable: (x: number, z: number) => boolean;
    arenaRadius: number;
};

export const PATTERN_NAMES: Record<PatternId, string> = {
    target: 'Smite',
    squares: 'Crushing blows',
    cross: 'Cross slam',
    lines: 'Shockwave lines',
    rings: 'Expanding rings',
    rocks: 'Falling rocks',
    wipe: 'Cataclysm'
};

const id = (x: number, z: number) => x * 104 + z;

function square(ctx: PatternCtx, cx: number, cz: number, r: number, out: Set<number>) {
    for (let x = cx - r; x <= cx + r; x++) {
        for (let z = cz - r; z <= cz + r; z++) {
            if (ctx.walkable(x, z)) out.add(id(x, z));
        }
    }
}

export function generate(pattern: PatternId, ctx: PatternCtx): Wave[] {
    const { rng } = ctx;
    switch (pattern) {
        case 'target': {
            // 3x3 on the player's current tile
            const s = new Set<number>();
            square(ctx, ctx.px, ctx.pz, 1, s);
            return [{ tiles: [...s], delay: ctx.delay }];
        }
        case 'squares': {
            const s = new Set<number>();
            const n = 4 + rng.int(3);
            for (let i = 0; i < n; i++) {
                const r = i === 0 ? 1 : rng.int(2) + 1;
                const ox = i === 0 ? 0 : rng.range(-6, 6);
                const oz = i === 0 ? 0 : rng.range(-6, 6);
                square(ctx, ctx.px + ox, ctx.pz + oz, r, s);
            }
            return [{ tiles: [...s], delay: ctx.delay }];
        }
        case 'cross': {
            // a plus through the boss, 3 wide, spanning the arena
            const s = new Set<number>();
            const len = ctx.arenaRadius * 2;
            for (let d = -len; d <= len; d++) {
                for (let w = -1; w <= 1; w++) {
                    if (ctx.walkable(ctx.bx + d, ctx.bz + w)) s.add(id(ctx.bx + d, ctx.bz + w));
                    if (ctx.walkable(ctx.bx + w, ctx.bz + d)) s.add(id(ctx.bx + w, ctx.bz + d));
                }
            }
            return [{ tiles: [...s], delay: ctx.delay }];
        }
        case 'lines': {
            // parallel 2-wide lines across the player's area with 2-wide gaps
            const s = new Set<number>();
            const horizontal = rng.chance(0.5);
            const phase = rng.int(4);
            for (let a = -10; a <= 10; a++) {
                if (((a + phase) & 3) >= 2) continue;
                for (let b = -12; b <= 12; b++) {
                    const x = horizontal ? ctx.px + b : ctx.px + a;
                    const z = horizontal ? ctx.pz + a : ctx.pz + b;
                    if (ctx.walkable(x, z)) s.add(id(x, z));
                }
            }
            return [{ tiles: [...s], delay: ctx.delay }];
        }
        case 'rings': {
            // concentric rings around the boss that land one after another
            const waves: Wave[] = [];
            const start = 2 + rng.int(2);
            for (let r = start, i = 0; r <= start + 10; r += 3, i++) {
                const ring: number[] = [];
                for (let x = ctx.bx - r; x <= ctx.bx + r; x++) {
                    for (let z = ctx.bz - r; z <= ctx.bz + r; z++) {
                        const d = Math.max(Math.abs(x - ctx.bx), Math.abs(z - ctx.bz));
                        if (d === r && ctx.walkable(x, z)) ring.push(id(x, z));
                    }
                }
                waves.push({ tiles: ring, delay: ctx.delay + i });
            }
            return waves;
        }
        case 'rocks': {
            // scattered single tiles around the player
            const s = new Set<number>();
            for (let x = ctx.px - 8; x <= ctx.px + 8; x++) {
                for (let z = ctx.pz - 8; z <= ctx.pz + 8; z++) {
                    if (ctx.walkable(x, z) && rng.chance(0.22)) s.add(id(x, z));
                }
            }
            s.add(id(ctx.px, ctx.pz));
            return [{ tiles: [...s].filter(t => ctx.walkable((t / 104) | 0, t % 104)), delay: ctx.delay }];
        }
        case 'wipe': {
            // everything near the boss except a few 3x3 safe pockets
            const radius = Math.min(14, ctx.arenaRadius);
            const safe = new Set<number>();
            const pockets = 3 + rng.int(2);
            for (let i = 0; i < pockets; i++) {
                const ang = (i / pockets) * Math.PI * 2 + rng.float();
                const dist = 3 + rng.int(4);
                square(ctx, Math.round(ctx.px + Math.cos(ang) * dist), Math.round(ctx.pz + Math.sin(ang) * dist), 1, safe);
            }
            const s: number[] = [];
            for (let x = ctx.bx - radius; x <= ctx.bx + radius; x++) {
                for (let z = ctx.bz - radius; z <= ctx.bz + radius; z++) {
                    const t = id(x, z);
                    if (ctx.walkable(x, z) && !safe.has(t)) s.push(t);
                }
            }
            return [{ tiles: s, delay: ctx.delay + 1 }];
        }
    }
}
