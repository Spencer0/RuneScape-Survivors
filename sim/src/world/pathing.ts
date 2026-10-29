import { DX, DZ, SIZE, canStep, idx } from './collision.js';

const N = SIZE * SIZE;

// BFS route-finder with the RS2 neighbour order (W, E, S, N, SW, SE, NW, NE). Returns the tile path
// (excluding the start) to (tx,tz), or to the closest reachable tile within `nearest` tiles of it.
export class RouteFinder {
    private readonly prev = new Int32Array(N);
    private readonly dist = new Int32Array(N);
    private readonly queue = new Int32Array(N);
    private stamp = new Int32Array(N);
    private gen = 0;

    find(flags: Int32Array, sx: number, sz: number, tx: number, tz: number, nearest: number = 10): number[] {
        this.gen++;
        const order = [3, 4, 6, 1, 5, 7, 0, 2]; // W, E, S, N, SW, SE, NW, NE
        let head = 0;
        let tail = 0;
        const start = idx(sx, sz);
        this.queue[tail++] = start;
        this.stamp[start] = this.gen;
        this.dist[start] = 0;
        this.prev[start] = -1;

        let found = -1;
        while (head < tail) {
            const cur = this.queue[head++];
            const cx = (cur / SIZE) | 0;
            const cz = cur % SIZE;
            if (cx === tx && cz === tz) {
                found = cur;
                break;
            }
            for (const d of order) {
                const nx = cx + DX[d];
                const nz = cz + DZ[d];
                if (nx < 0 || nz < 0 || nx >= SIZE || nz >= SIZE) {
                    continue;
                }
                const ni = idx(nx, nz);
                if (this.stamp[ni] === this.gen || !canStep(flags, cx, cz, DX[d], DZ[d])) {
                    continue;
                }
                this.stamp[ni] = this.gen;
                this.dist[ni] = this.dist[cur] + 1;
                this.prev[ni] = cur;
                this.queue[tail++] = ni;
            }
        }

        if (found === -1) {
            // nearest reachable tile to the target (by distance to target, then path length)
            let best = -1;
            let bestD = 1 << 30;
            let bestLen = 1 << 30;
            for (let px = tx - nearest; px <= tx + nearest; px++) {
                for (let pz = tz - nearest; pz <= tz + nearest; pz++) {
                    if (px < 0 || pz < 0 || px >= SIZE || pz >= SIZE) {
                        continue;
                    }
                    const pi = idx(px, pz);
                    if (this.stamp[pi] !== this.gen) {
                        continue;
                    }
                    const d = (px - tx) * (px - tx) + (pz - tz) * (pz - tz);
                    if (d < bestD || (d === bestD && this.dist[pi] < bestLen)) {
                        best = pi;
                        bestD = d;
                        bestLen = this.dist[pi];
                    }
                }
            }
            found = best;
        }

        if (found === -1 || found === start) {
            return [];
        }

        const path: number[] = [];
        for (let cur = found; cur !== start; cur = this.prev[cur]) {
            path.push(cur);
        }
        path.reverse();
        return path;
    }

    // Reachable set within `maxSteps` steps (used by telegraph fairness checks / bots)
    reach(flags: Int32Array, sx: number, sz: number, maxSteps: number, out: Int32Array): number {
        this.gen++;
        let head = 0;
        let tail = 0;
        const start = idx(sx, sz);
        this.queue[tail++] = start;
        this.stamp[start] = this.gen;
        this.dist[start] = 0;
        let count = 0;
        while (head < tail) {
            const cur = this.queue[head++];
            out[count++] = cur;
            if (this.dist[cur] >= maxSteps) {
                continue;
            }
            const cx = (cur / SIZE) | 0;
            const cz = cur % SIZE;
            for (let d = 0; d < 8; d++) {
                const nx = cx + DX[d];
                const nz = cz + DZ[d];
                if (nx < 0 || nz < 0 || nx >= SIZE || nz >= SIZE) {
                    continue;
                }
                const ni = idx(nx, nz);
                if (this.stamp[ni] === this.gen || !canStep(flags, cx, cz, DX[d], DZ[d])) {
                    continue;
                }
                this.stamp[ni] = this.gen;
                this.dist[ni] = this.dist[cur] + 1;
                this.queue[tail++] = ni;
            }
        }
        return count;
    }
}

// Flow field: BFS distance from the player's tile to every tile, over the moves an enemy could make
// *towards* the player (enemy steps n -> t must satisfy canStep(n, t)). Recomputed every tick.
export class FlowField {
    readonly dist = new Int32Array(N);
    private readonly queue = new Int32Array(N);
    static readonly UNREACHABLE = 0x7fffffff;

    compute(flags: Int32Array, px: number, pz: number): void {
        this.dist.fill(FlowField.UNREACHABLE);
        let head = 0;
        let tail = 0;
        const start = idx(px, pz);
        this.dist[start] = 0;
        this.queue[tail++] = start;
        while (head < tail) {
            const cur = this.queue[head++];
            const cx = (cur / SIZE) | 0;
            const cz = cur % SIZE;
            const nd = this.dist[cur] + 1;
            for (let d = 0; d < 8; d++) {
                const nx = cx + DX[d];
                const nz = cz + DZ[d];
                if (nx < 0 || nz < 0 || nx >= SIZE || nz >= SIZE) {
                    continue;
                }
                const ni = idx(nx, nz);
                if (this.dist[ni] <= nd) {
                    continue;
                }
                // enemy at (nx,nz) stepping back towards (cx,cz)
                if (!canStep(flags, nx, nz, -DX[d], -DZ[d])) {
                    continue;
                }
                this.dist[ni] = nd;
                this.queue[tail++] = ni;
            }
        }
    }

    at(x: number, z: number): number {
        if (x < 0 || z < 0 || x >= SIZE || z >= SIZE) {
            return FlowField.UNREACHABLE;
        }
        return this.dist[idx(x, z)];
    }
}
