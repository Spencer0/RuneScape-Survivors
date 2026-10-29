// Shared arena scene build. Runs both in the browser (render scene) and headlessly in Node at build
// time (collision for the simulation), so the two can never disagree about walls or removed locs.
// It mirrors Client.mapBuild for a REBUILD_NORMAL centred on (centreZoneX, centreZoneZ).
import ClientBuild from '#/client/ClientBuild.js';
import LocType from '#/config/LocType.js';
import CollisionMap, { BuildArea } from '#/dash3d/CollisionMap.js';
import World from '#/dash3d/World.js';
import Packet from '#/io/Packet.js';

import { shouldRemoveLoc } from '../../../sim/src/content/locfilter.js';

export type ExtraLoc = { id: number; x: number; z: number; shape: number; angle: number; level: number };

export type ArenaScene = {
    baseX: number;
    baseZ: number;
    removedLocs: number;
};

export function buildArenaScene(
    getMap: (mx: number, mz: number, type: 0 | 1) => Uint8Array | null,
    centreZoneX: number,
    centreZoneZ: number,
    groundh: Int32Array[][],
    mapl: Uint8Array[][],
    world: World | null,
    collision: (CollisionMap | null)[],
    extraLocs: ExtraLoc[]
): ArenaScene {
    const baseX = (centreZoneX - 6) * 8;
    const baseZ = (centreZoneZ - 6) * 8;

    world?.resetMap();
    for (let level = 0; level < BuildArea.LEVELS; level++) {
        collision[level]?.reset();
    }

    const build = new ClientBuild(BuildArea.SIZE, BuildArea.SIZE, groundh, mapl);
    ClientBuild.lowMem = false;
    world?.fillBaseLevel(0);

    const maps: { mx: number; mz: number }[] = [];
    for (let mx = ((centreZoneX - 6) / 8) | 0; mx <= (((centreZoneX + 6) / 8) | 0); mx++) {
        for (let mz = ((centreZoneZ - 6) / 8) | 0; mz <= (((centreZoneZ + 6) / 8) | 0); mz++) {
            maps.push({ mx, mz });
        }
    }

    const lands = maps.map(({ mx, mz }) => getMap(mx, mz, 0));
    maps.forEach(({ mx, mz }, i) => {
        const land = lands[i];
        if (land) {
            build.loadGround(land, baseX, baseZ, mx * 64 - baseX, mz * 64 - baseZ);
        }
    });
    maps.forEach(({ mx, mz }, i) => {
        if (!lands[i]) {
            build.fadeAdjacent(mz * 64 - baseZ, mx * 64 - baseX, 64, 64);
        }
    });

    let removedLocs = 0;
    maps.forEach(({ mx, mz }) => {
        const src = getMap(mx, mz, 1);
        if (!src) {
            return;
        }
        const filtered = filterLocs(src);
        removedLocs += filtered.removed;
        build.loadLocations(filtered.data, mx * 64 - baseX, mz * 64 - baseZ, world, collision);
    });

    // themed boundary / set dressing locs, encoded as a synthetic loc file in build-area coords
    const blocks = new Map<number, ExtraLoc[]>();
    for (const loc of extraLocs) {
        const key = ((loc.x >> 6) << 8) | (loc.z >> 6);
        const list = blocks.get(key) ?? [];
        list.push({ ...loc, x: loc.x & 0x3f, z: loc.z & 0x3f });
        blocks.set(key, list);
    }
    for (const [key, list] of blocks) {
        build.loadLocations(encodeLocs(list), (key >> 8) * 64, (key & 0xff) * 64, world, collision);
    }

    build.finishBuild(world, collision);
    return { baseX, baseZ, removedLocs };
}

class SmartWriter {
    bytes: Uint8Array;
    pos = 0;

    constructor(size: number) {
        this.bytes = new Uint8Array(size);
    }

    psmart(v: number) {
        if (v < 128) {
            this.bytes[this.pos++] = v;
        } else {
            v += 32768;
            this.bytes[this.pos++] = v >> 8;
            this.bytes[this.pos++] = v & 0xff;
        }
    }

    p1(v: number) {
        this.bytes[this.pos++] = v;
    }
}

// Re-encodes a loc file without the locs survivors mode removes (doors, ladders, stairs, ...).
export function filterLocs(src: Uint8Array): { data: Uint8Array; removed: number } {
    const buf = new Packet(src);
    const out = new SmartWriter(src.length + 16);
    let removed = 0;
    let locId = -1;
    let outLocId = -1;

    while (true) {
        const deltaId = buf.gsmart();
        if (deltaId === 0) {
            break;
        }
        locId += deltaId;

        const kept: { pos: number; info: number }[] = [];
        let locPos = 0;
        while (true) {
            const deltaPos = buf.gsmart();
            if (deltaPos === 0) {
                break;
            }
            locPos += deltaPos - 1;
            const info = buf.g1();
            if (shouldRemoveLoc(LocType.list(locId), info >> 2)) {
                removed++;
            } else {
                kept.push({ pos: locPos, info });
            }
        }

        if (kept.length > 0) {
            out.psmart(locId - outLocId);
            outLocId = locId;
            let prev = 0;
            for (const k of kept) {
                out.psmart(k.pos - prev + 1);
                prev = k.pos;
                out.p1(k.info);
            }
            out.psmart(0);
        }
    }
    out.psmart(0);
    return { data: out.bytes.subarray(0, out.pos), removed };
}

// Encodes locs in the map loc-file format. Positions are 6 bits per axis, so callers split by 64x64 block.
function encodeLocs(locs: ExtraLoc[]): Uint8Array {
    const sorted = [...locs].sort((a, b) => a.id - b.id || pack(a) - pack(b));
    const out = new SmartWriter(sorted.length * 8 + 16);
    let lastId = -1;
    let i = 0;
    while (i < sorted.length) {
        const id = sorted[i].id;
        out.psmart(id - lastId);
        lastId = id;
        let prev = 0;
        while (i < sorted.length && sorted[i].id === id) {
            const p = pack(sorted[i]);
            out.psmart(p - prev + 1);
            prev = p;
            out.p1((sorted[i].shape << 2) | (sorted[i].angle & 3));
            i++;
        }
        out.psmart(0);
    }
    out.psmart(0);
    return out.bytes.subarray(0, out.pos);
}

function pack(l: ExtraLoc): number {
    return (l.level << 12) | ((l.x & 0x3f) << 6) | (l.z & 0x3f);
}
