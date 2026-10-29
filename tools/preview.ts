// Dev tool: renders a top-down preview of the 104x104 build area around a world tile, using the
// client's minimap ground renderer + collision flags. Usage: tsx tools/preview.ts <tileX> <tileZ> [out.png] [level]
import fs from 'node:fs';
import path from 'node:path';

import { CollisionFlag } from '#/dash3d/CollisionFlag.js';
import CollisionMap, { BuildArea } from '#/dash3d/CollisionMap.js';

import { CacheReader } from './lib/cache.js';
import { encodePng } from './lib/png.js';
import { buildRegion } from './lib/region.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tileX = parseInt(process.argv[2], 10);
const tileZ = parseInt(process.argv[3], 10);
const out = process.argv[4] ?? 'preview.png';
const level = parseInt(process.argv[5] ?? '0', 10);

const cache = new CacheReader(path.join(ROOT, 'vendor/engine/data/pack'));
const region = buildRegion(cache, tileX >> 3, tileZ >> 3);

const S = 4;
const W = BuildArea.SIZE * S;
const px = new Int32Array(W * W);
for (let z = 0; z < BuildArea.SIZE; z++) {
    for (let x = 0; x < BuildArea.SIZE; x++) {
        const offset = (BuildArea.SIZE - 1 - z) * S * W + x * S;
        region.world.render2DGround(level, x, z, px, offset, W);
    }
}

const flags = region.collision[level].flags;
for (let z = 0; z < BuildArea.SIZE; z++) {
    for (let x = 0; x < BuildArea.SIZE; x++) {
        const f = flags[CollisionMap.index(x, z)];
        const oy = (BuildArea.SIZE - 1 - z) * S;
        const ox = x * S;
        const set = (dx: number, dy: number, c: number) => {
            px[(oy + dy) * W + ox + dx] = c;
        };
        if ((f & CollisionFlag.WALK_SCENERY) !== 0 || (f & CollisionFlag.WR_GRND) !== 0) {
            for (let i = 0; i < S; i++) {
                for (let j = 0; j < S; j++) {
                    if ((i + j) % 2 === 0) set(i, j, 0xff0000);
                }
            }
        }
        if ((f & CollisionFlag.W_N) !== 0) for (let i = 0; i < S; i++) set(i, 0, 0xffffff);
        if ((f & CollisionFlag.W_S) !== 0) for (let i = 0; i < S; i++) set(i, S - 1, 0xffffff);
        if ((f & CollisionFlag.W_W) !== 0) for (let i = 0; i < S; i++) set(0, i, 0xffffff);
        if ((f & CollisionFlag.W_E) !== 0) for (let i = 0; i < S; i++) set(S - 1, i, 0xffffff);
    }
}

// grid every 8 tiles, label base coords in console
for (let i = 0; i < W; i++) {
    for (let g = 0; g < BuildArea.SIZE; g += 8) {
        px[i * W + g * S] = 0x202020;
        px[g * S * W + i] = 0x202020;
    }
}

fs.writeFileSync(out, encodePng(W, W, px));
console.log(`base ${region.baseX},${region.baseZ} .. ${region.baseX + 103},${region.baseZ + 103}; removed ${region.removedLocs} locs -> ${out}`);
