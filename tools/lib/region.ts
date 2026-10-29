// Builds an arena's 104x104 build area from the packed cache using the Lost City client's own map
// code (ClientBuild / CollisionMap / World), headlessly in Node.
import { gunzipSync } from 'fflate';

import FloType from '#/config/FloType.js';
import LocType from '#/config/LocType.js';
import SeqType from '#/config/SeqType.js';
import AnimFrame from '#/dash3d/AnimFrame.js';
import CollisionMap, { BuildArea } from '#/dash3d/CollisionMap.js';
import Model from '#/dash3d/Model.js';
import World from '#/dash3d/World.js';
import Pix3D from '#/dash3d/Pix3D.js';
import JagFile from '#/io/JagFile.js';
import Packet from '#/io/Packet.js';
import { Int32Array3d, Uint8Array3d } from '#/util/Arrays.js';

import { buildArenaScene, type ExtraLoc } from '#/survivors/ArenaBuild.js';
import type { CacheReader } from './cache.js';

let initialised = false;
let mapIndex: { index: number; land: number; loc: number }[] = [];

export function initClientConfigs(cache: CacheReader) {
    if (initialised) {
        return;
    }
    initialised = true;

    const config = new JagFile(cache.read(0, 2)!);
    const versionlist = new JagFile(cache.read(0, 5)!);
    FloType.init(config);
    SeqType.init(config);
    AnimFrame.init(4096);
    LocType.init(config);
    Pix3D.initColourTable(0.8);

    // models are never needed for collision; a provider that never delivers keeps Model.load() returning null
    Model.init(65535, { requestModel: () => {} } as never);

    const data = versionlist.read('map_index')!;
    const buf = new Packet(data);
    mapIndex = [];
    for (let i = 0; i < data.length / 7; i++) {
        const index = buf.g2();
        const land = buf.g2();
        const loc = buf.g2();
        buf.g1();
        mapIndex.push({ index, land, loc });
    }
}

export function mapFile(cache: CacheReader, mx: number, mz: number, type: 0 | 1): Uint8Array | null {
    const entry = mapIndex.find(m => m.index === ((mx << 8) | mz));
    if (!entry) {
        return null;
    }
    const raw = cache.read(4, type === 0 ? entry.land : entry.loc);
    if (!raw) {
        return null;
    }
    return gunzipSync(raw.subarray(0, raw.length - 2));
}

export type BuiltRegion = {
    baseX: number;
    baseZ: number;
    collision: CollisionMap[];
    groundh: Int32Array[][];
    mapl: Uint8Array[][];
    world: World;
    removedLocs: number;
};

// centreZoneX/Z are absolute zone coords (tile >> 3), matching REBUILD_NORMAL
export function buildRegion(cache: CacheReader, centreZoneX: number, centreZoneZ: number, extraLocs: ExtraLoc[] = []): BuiltRegion {
    initClientConfigs(cache);

    const mapl = new Uint8Array3d(BuildArea.LEVELS, BuildArea.SIZE, BuildArea.SIZE);
    const groundh = new Int32Array3d(BuildArea.LEVELS, BuildArea.SIZE + 1, BuildArea.SIZE + 1);
    const world = new World(groundh, BuildArea.SIZE, BuildArea.LEVELS, BuildArea.SIZE);
    const collision: CollisionMap[] = [];
    for (let level = 0; level < BuildArea.LEVELS; level++) {
        collision[level] = new CollisionMap();
    }

    const scene = buildArenaScene((mx, mz, type) => mapFile(cache, mx, mz, type), centreZoneX, centreZoneZ, groundh, mapl, world, collision, extraLocs);
    return { baseX: scene.baseX, baseZ: scene.baseZ, collision, groundh, mapl, world, removedLocs: scene.removedLocs };
}
