// Builds each arena's collision with the client's own ClientBuild, flood-fills the arena from its
// centre, marks everything else OUT_OF_ARENA, and picks spawn ring / lair / cache tiles.
import fs from 'node:fs';
import path from 'node:path';

import CollisionMap from '#/dash3d/CollisionMap.js';

import { ARENAS, BOUNDARY_LOCS, type ArenaData, type ArenaDef } from '../../sim/src/content/arenas.js';
import { DX, DZ, OUT_OF_ARENA, SIZE, canStep, idx } from '../../sim/src/world/collision.js';
import type { CacheReader } from './cache.js';
import type { GameData } from './gamedata.js';
import { encodePng } from './png.js';
import { buildRegion } from './region.js';

// Arena = the largest walkable component inside the square (or the components containing seeds),
// so natural walls shape it and enclosed pockets (inside walls, islands) are excluded.
function floodArena(flags: Int32Array, def: ArenaDef, baseX: number, baseZ: number): Uint8Array {
    const cx = def.centreX - baseX;
    const cz = def.centreZ - baseZ;
    const minX = Math.max(1, cx - def.half);
    const maxX = Math.min(SIZE - 2, cx + def.half);
    const minZ = Math.max(1, cz - def.half);
    const maxZ = Math.min(SIZE - 2, cz + def.half);
    const comp = new Int32Array(SIZE * SIZE).fill(-1);
    const sizes: number[] = [];

    for (let sx = minX; sx <= maxX; sx++) {
        for (let sz = minZ; sz <= maxZ; sz++) {
            const s = idx(sx, sz);
            if (comp[s] !== -1 || (flags[s] & 0x280100) !== 0) {
                continue;
            }
            const id = sizes.length;
            let n = 0;
            const queue = [s];
            comp[s] = id;
            while (queue.length > 0) {
                const cur = queue.pop()!;
                n++;
                const x = (cur / SIZE) | 0;
                const z = cur % SIZE;
                for (let d = 0; d < 8; d++) {
                    const nx = x + DX[d];
                    const nz = z + DZ[d];
                    if (nx < minX || nx > maxX || nz < minZ || nz > maxZ) {
                        continue;
                    }
                    const ni = idx(nx, nz);
                    if (comp[ni] !== -1 || !canStep(flags, x, z, DX[d], DZ[d])) {
                        continue;
                    }
                    comp[ni] = id;
                    queue.push(ni);
                }
            }
            sizes.push(n);
        }
    }

    const keep = new Set<number>();
    for (const [x, z] of def.seeds ?? []) {
        const c = comp[idx(x - baseX, z - baseZ)];
        if (c >= 0) {
            keep.add(c);
        }
    }
    if (keep.size === 0) {
        let best = 0;
        for (let i = 1; i < sizes.length; i++) {
            if (sizes[i] > sizes[best]) {
                best = i;
            }
        }
        keep.add(best);
    }

    const inArena = new Uint8Array(SIZE * SIZE);
    for (let i = 0; i < inArena.length; i++) {
        if (comp[i] >= 0 && keep.has(comp[i])) {
            inArena[i] = 1;
        }
    }
    return inArena;
}

export async function extractArenas(cache: CacheReader, game: GameData, outDir: string) {
    fs.mkdirSync(outDir, { recursive: true });

    for (const def of Object.values(ARENAS)) {
        const centreZoneX = def.centreX >> 3;
        const centreZoneZ = def.centreZ >> 3;
        const region = buildRegion(cache, centreZoneX, centreZoneZ);
        const flags = new Int32Array(SIZE * SIZE);
        const src = region.collision[0].flags;
        for (let x = 0; x < SIZE; x++) {
            for (let z = 0; z < SIZE; z++) {
                flags[idx(x, z)] = src[CollisionMap.index(x, z)];
            }
        }

        const inArena = floodArena(flags, def, region.baseX, region.baseZ);
        let arenaTiles = 0;
        for (let i = 0; i < inArena.length; i++) {
            if (inArena[i]) {
                arenaTiles++;
            } else {
                flags[i] |= OUT_OF_ARENA;
            }
        }

        // distance from the arena edge (BFS from every tile bordering outside)
        const edgeDist = new Int32Array(SIZE * SIZE).fill(1 << 20);
        const q: number[] = [];
        for (let x = 0; x < SIZE; x++) {
            for (let z = 0; z < SIZE; z++) {
                const i = idx(x, z);
                if (!inArena[i]) {
                    continue;
                }
                for (let d = 0; d < 8; d++) {
                    const nx = x + DX[d];
                    const nz = z + DZ[d];
                    if (nx < 0 || nz < 0 || nx >= SIZE || nz >= SIZE || !inArena[idx(nx, nz)]) {
                        edgeDist[i] = 0;
                        q.push(i);
                        break;
                    }
                }
            }
        }
        for (let h = 0; h < q.length; h++) {
            const cur = q[h];
            const x = (cur / SIZE) | 0;
            const z = cur % SIZE;
            for (let d = 0; d < 8; d++) {
                const nx = x + DX[d];
                const nz = z + DZ[d];
                if (nx < 0 || nz < 0 || nx >= SIZE || nz >= SIZE) continue;
                const ni = idx(nx, nz);
                if (!inArena[ni] || edgeDist[ni] <= edgeDist[cur] + 1) continue;
                edgeDist[ni] = edgeDist[cur] + 1;
                q.push(ni);
            }
        }

        const cx = def.centreX - region.baseX;
        const cz = def.centreZ - region.baseZ;
        // spawn ring: arena tiles near the outer square border; for walled arenas (caves) that never
        // reach the square, fall back to the outermost tiles by walking distance from the centre
        let spawnRing: number[] = [];
        for (let i = 0; i < SIZE * SIZE; i++) {
            const x = (i / SIZE) | 0;
            const z = i % SIZE;
            if (inArena[i] && Math.max(Math.abs(x - cx), Math.abs(z - cz)) >= def.half - 3) {
                spawnRing.push(i);
            }
        }
        if (spawnRing.length < 150) {
            const walk = new Int32Array(SIZE * SIZE).fill(-1);
            let start = -1;
            let bestD = 1 << 30;
            for (let i = 0; i < SIZE * SIZE; i++) {
                if (!inArena[i]) continue;
                const d = (((i / SIZE) | 0) - cx) ** 2 + ((i % SIZE) - cz) ** 2;
                if (d < bestD) {
                    bestD = d;
                    start = i;
                }
            }
            const bq = [start];
            walk[start] = 0;
            let maxWalk = 0;
            for (let h = 0; h < bq.length; h++) {
                const cur = bq[h];
                const x = (cur / SIZE) | 0;
                const z = cur % SIZE;
                for (let d = 0; d < 8; d++) {
                    const ni = idx(x + DX[d], z + DZ[d]);
                    if (!inArena[ni] || walk[ni] !== -1 || !canStep(flags, x, z, DX[d], DZ[d])) continue;
                    walk[ni] = walk[cur] + 1;
                    maxWalk = Math.max(maxWalk, walk[ni]);
                    bq.push(ni);
                }
            }
            spawnRing = [];
            for (let i = 0; i < SIZE * SIZE; i++) {
                if (inArena[i] && walk[i] >= maxWalk * 0.6) spawnRing.push(i);
            }
        }

        // lairs: 4 deep tiles (far from edges) in each quadrant; caches: 6 tiles spread around
        const pickNear = (tx: number, tz: number, minEdge: number, taken: number[]): number => {
            let best = -1;
            let bestD = 1 << 30;
            for (let i = 0; i < SIZE * SIZE; i++) {
                if (!inArena[i] || edgeDist[i] < minEdge || (flags[i] & 0x280100) !== 0) continue;
                const x = (i / SIZE) | 0;
                const z = i % SIZE;
                if (taken.some(t => Math.max(Math.abs(((t / SIZE) | 0) - x), Math.abs((t % SIZE) - z)) < 6)) continue;
                const d = (x - tx) * (x - tx) + (z - tz) * (z - tz);
                if (d < bestD) {
                    bestD = d;
                    best = i;
                }
            }
            return best;
        };
        const lairs: number[] = [];
        const r = (def.half * 0.62) | 0;
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            const t = pickNear(cx + sx * r, cz + sz * r, 3, lairs);
            if (t >= 0) lairs.push(t);
        }
        const caches: number[] = [];
        const rc = (def.half * 0.4) | 0;
        for (const [sx, sz] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, 1]]) {
            const t = pickNear(cx + sx * rc * 1.3, cz + sz * rc * 1.3, 2, [...caches, ...lairs]);
            if (t >= 0) caches.push(t);
        }

        // themed boundary locs on open tiles just outside the arena next to arena tiles
        const boundaryLocs: ArenaData['boundaryLocs'] = [];
        const names = BOUNDARY_LOCS[def.boundary];
        const ids = names.map(n => game.locs[n]).filter(id => id !== undefined);
        if (names.length > 0 && ids.length !== names.length) {
            throw new Error(`boundary loc missing from cache for ${def.id}: ${names.join(',')}`);
        }
        if (ids.length > 0) {
            for (let x = 1; x < SIZE - 1; x++) {
                for (let z = 1; z < SIZE - 1; z++) {
                    const i = idx(x, z);
                    if (inArena[i] || (src[CollisionMap.index(x, z)] & 0x280100) !== 0) continue;
                    let touches = false;
                    for (let d = 0; d < 8 && !touches; d++) {
                        const ni = idx(x + DX[d], z + DZ[d]);
                        touches = inArena[ni] === 1 && canStep(src as unknown as Int32Array, x + DX[d], z + DZ[d], -DX[d], -DZ[d]);
                    }
                    if (touches) {
                        boundaryLocs.push({ id: ids[(x * 7 + z * 13) % ids.length], x, z, shape: 10, angle: (x + z) & 3, level: 0 });
                    }
                }
            }
        }

        const music = game.midis[def.music];
        if (music === undefined) {
            throw new Error(`music track missing for ${def.id}: ${def.music}`);
        }

        const data: ArenaData = {
            id: def.id,
            baseX: region.baseX,
            baseZ: region.baseZ,
            centreZoneX,
            centreZoneZ,
            centreLocalX: cx,
            centreLocalZ: cz,
            flags: Buffer.from(flags.buffer).toString('base64'),
            arenaTiles,
            spawnRing,
            lairs,
            caches,
            boundaryLocs,
            music
        };
        fs.writeFileSync(path.join(outDir, `${def.id}.json`), JSON.stringify(data));

        // debug preview of the arena mask
        const S = 3;
        const W = SIZE * S;
        const px = new Int32Array(W * W);
        for (let z = 0; z < SIZE; z++) {
            for (let x = 0; x < SIZE; x++) {
                region.world.render2DGround(0, x, z, px, (SIZE - 1 - z) * S * W + x * S, W);
            }
        }
        for (let z = 0; z < SIZE; z++) {
            for (let x = 0; x < SIZE; x++) {
                const i = idx(x, z);
                const dim = !inArena[i];
                for (let a = 0; a < S; a++) {
                    for (let b = 0; b < S; b++) {
                        const o = ((SIZE - 1 - z) * S + b) * W + x * S + a;
                        if (dim) px[o] = (px[o] >> 2) & 0x3f3f3f;
                    }
                }
            }
        }
        const mark = (list: number[], c: number) => {
            for (const i of list) {
                const x = (i / SIZE) | 0;
                const z = i % SIZE;
                for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) px[((SIZE - 1 - z) * S + b) * W + x * S + a] = c;
            }
        };
        mark(boundaryLocs.map(l => idx(l.x, l.z)), 0xff8000);
        mark(lairs, 0xff00ff);
        mark(caches, 0x00ffff);
        fs.writeFileSync(path.join(outDir, `${def.id}.png`), encodePng(W, W, px));
        console.log(`arena ${def.id}: ${arenaTiles} tiles, ${spawnRing.length} spawn, ${lairs.length} lairs, ${caches.length} caches, ${boundaryLocs.length} boundary locs, ${region.removedLocs} locs removed`);
    }
}
