// Telegraph fairness: a time-expanded reachability check over the real collision map.
// Movement happens before telegraph resolution each tick, and a telegraph created during tick T is
// first visible after T, so a player reacting immediately gets one walking step on every tick
// T+1 .. landTick before it resolves. A set of impacts is fair iff some walking path (1 tile/tick,
// standing still allowed) avoids every impact tile at every impact tick.
import { DX, DZ, SIZE, canStep } from './world/collision.js';

export type Impact = { tiles: Set<number> | number[]; landTick: number };

const N = SIZE * SIZE;

function asSet(t: Set<number> | number[]): Set<number> {
    return t instanceof Set ? t : new Set(t);
}

// Returns the per-tick reachable sets (index 0 = now) or null if every path is caught.
export function reachThroughTime(flags: Int32Array, px: number, pz: number, now: number, impacts: Impact[], parents?: Int32Array[]): Uint8Array[] | null {
    const horizon = impacts.reduce((m, i) => Math.max(m, i.landTick), now);
    const byTick = new Map<number, Set<number>[]>();
    for (const imp of impacts) {
        if (imp.landTick <= now) continue;
        const list = byTick.get(imp.landTick) ?? [];
        list.push(asSet(imp.tiles));
        byTick.set(imp.landTick, list);
    }

    const layers: Uint8Array[] = [];
    let cur = new Uint8Array(N);
    cur[px * SIZE + pz] = 1;
    layers.push(cur);

    for (let t = now + 1; t <= horizon; t++) {
        const next = new Uint8Array(N);
        const parent = parents ? new Int32Array(N).fill(-1) : null;
        for (let i = 0; i < N; i++) {
            if (!cur[i]) continue;
            if (!next[i]) {
                next[i] = 1;
                if (parent) parent[i] = i;
            }
            const x = (i / SIZE) | 0;
            const z = i % SIZE;
            for (let d = 0; d < 8; d++) {
                if (!canStep(flags, x, z, DX[d], DZ[d])) continue;
                const ni = (x + DX[d]) * SIZE + z + DZ[d];
                if (!next[ni]) {
                    next[ni] = 1;
                    if (parent) parent[ni] = i;
                }
            }
        }
        const landing = byTick.get(t);
        if (landing) {
            for (const set of landing) {
                for (const tile of set) next[tile] = 0;
            }
        }
        let any = false;
        for (let i = 0; i < N && !any; i++) any = next[i] === 1;
        if (!any) return null;
        layers.push(next);
        if (parents && parent) parents.push(parent);
        cur = next;
    }
    return layers;
}

export function isFair(flags: Int32Array, px: number, pz: number, now: number, impacts: Impact[]): boolean {
    return reachThroughTime(flags, px, pz, now, impacts) !== null;
}

// Trim new waves (closest tiles to the player first) until the combined set of impacts is fair.
// Returns the trimmed waves, or [] if even the existing impacts cannot be survived (never happens
// in practice since existing impacts were validated when created).
export function makeFair(flags: Int32Array, px: number, pz: number, now: number, existing: Impact[], waves: Impact[]): Impact[] {
    if (isFair(flags, px, pz, now, [...existing, ...waves])) {
        return waves;
    }
    for (let r = 0; r <= 6; r++) {
        const trimmed = waves.map(w => ({
            landTick: w.landTick,
            tiles: [...asSet(w.tiles)].filter(t => {
                const x = (t / SIZE) | 0;
                const z = t % SIZE;
                return Math.max(Math.abs(x - px), Math.abs(z - pz)) > r;
            })
        }));
        if (isFair(flags, px, pz, now, [...existing, ...trimmed])) {
            return trimmed;
        }
    }
    return [];
}

// Perfect-dodger planning (used by the headless bot): a walking path that survives every impact.
// Returns the tile to be on after the next tick, or -1 to stay put / no threat.
export function planDodge(flags: Int32Array, px: number, pz: number, now: number, impacts: Impact[]): number {
    const future = impacts.filter(i => i.landTick > now);
    if (future.length === 0) return -1;
    const parents: Int32Array[] = [];
    const layers = reachThroughTime(flags, px, pz, now, future, parents);
    if (!layers) return -1;
    const last = layers[layers.length - 1];
    // prefer finishing as close as possible to the start (fewer wasted steps)
    let best = -1;
    let bestD = 1 << 30;
    for (let i = 0; i < N; i++) {
        if (!last[i]) continue;
        const x = (i / SIZE) | 0;
        const z = i % SIZE;
        const d = Math.max(Math.abs(x - px), Math.abs(z - pz));
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    if (best === -1) return -1;
    // walk the parents back to the first step
    let tile = best;
    for (let k = parents.length - 1; k >= 1; k--) {
        tile = parents[k][tile];
    }
    return tile;
}
