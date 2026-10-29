// Build-time extraction from the Lost City engine pack + content repo.
//  1. data/cache/*       static copies of the jag archives and an on-demand bundle the client loads over plain HTTP
//  2. data/game.json     NPC / seq / spotanim / loc ids and stats used by the simulation (verified against the cache)
//  3. data/arenas/*.json per-arena collision + height grids built with the client's own ClientBuild code
import fs from 'node:fs';
import path from 'node:path';

import { CacheReader, crc32 } from './lib/cache.js';
import { extractGameData } from './lib/gamedata.js';
import { extractArenas } from './lib/arenas.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PACK = path.join(ROOT, 'vendor/engine/data/pack');
const CONTENT = path.join(ROOT, 'vendor/content');
const OUT = path.join(ROOT, 'data');

const JAG_NAMES = ['', 'title', 'config', 'interface', 'media', 'versionlist', 'textures', 'wordenc', 'sounds'];

function writeCache(cache: CacheReader) {
    const dir = path.join(OUT, 'cache');
    fs.mkdirSync(dir, { recursive: true });

    // crc table exactly as the engine's /crc route serves it
    const crcs: number[] = [];
    const crcBuf = Buffer.alloc(4 * 9 + 4);
    for (let i = 0; i < 9; i++) {
        const jag = cache.read(0, i);
        crcs[i] = jag ? crc32(jag) : 0;
        crcBuf.writeInt32BE(crcs[i], i * 4);
        if (jag && JAG_NAMES[i]) {
            fs.writeFileSync(path.join(dir, JAG_NAMES[i]), jag);
        }
    }
    let hash = 1234;
    for (let i = 0; i < 9; i++) {
        hash = ((hash << 1) + crcs[i]) | 0;
    }
    crcBuf.writeInt32BE(hash, 36);
    fs.writeFileSync(path.join(dir, 'crc'), crcBuf);

    // on-demand bundle: "GSOD", u8 archives, per archive u32 count, then (u32 offset, u32 length) per file, then data.
    // Files are stored exactly as the update server would stream them (gzip + 2 byte version trailer).
    const files: (Uint8Array | null)[][] = [];
    for (let a = 0; a < 4; a++) {
        const count = cache.count(a + 1);
        files[a] = [];
        for (let f = 0; f < count; f++) {
            files[a][f] = cache.read(a + 1, f);
        }
    }

    let headerSize = 4 + 1;
    for (let a = 0; a < 4; a++) {
        headerSize += 4 + files[a].length * 8;
    }

    let dataSize = 0;
    for (const archive of files) {
        for (const f of archive) {
            dataSize += f?.length ?? 0;
        }
    }

    const bundle = Buffer.alloc(headerSize + dataSize);
    bundle.write('GSOD', 0, 'ascii');
    bundle[4] = 4;
    let hp = 5;
    let dp = headerSize;
    for (let a = 0; a < 4; a++) {
        bundle.writeUInt32BE(files[a].length, hp);
        hp += 4;
        for (const f of files[a]) {
            bundle.writeUInt32BE(f ? dp : 0, hp);
            bundle.writeUInt32BE(f?.length ?? 0, hp + 4);
            hp += 8;
            if (f) {
                bundle.set(f, dp);
                dp += f.length;
            }
        }
    }
    fs.writeFileSync(path.join(dir, 'ondemand.bin'), bundle);
    console.log(`cache: jag archives + ondemand.bin (${(bundle.length / 1048576).toFixed(1)} MB, ${files.map(f => f.length).join('/')} files)`);
}

if (!fs.existsSync(path.join(PACK, 'main_file_cache.dat'))) {
    console.error('Missing vendor/engine/data/pack - run `npm run setup` first.');
    process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
const cache = new CacheReader(PACK);
writeCache(cache);

const game = extractGameData(CONTENT, cache);
fs.writeFileSync(path.join(OUT, 'game.json'), JSON.stringify(game));
console.log(`game.json: ${Object.keys(game.npcs).length} npcs, ${Object.keys(game.seqs).length} seqs, ${Object.keys(game.spotanims).length} spotanims`);

await extractArenas(cache, game, path.join(OUT, 'arenas'));
