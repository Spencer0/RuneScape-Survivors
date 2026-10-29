// Arena regions pulled from the real 2004 map. Coordinates are absolute world tiles.
// An arena is the set of tiles reachable on foot from the centre inside a square of `half` tiles
// (so natural walls - castle walls, rivers, cave walls - shape it), with a themed boundary of locs
// on every open tile just outside the square.
export type BoundaryTheme = 'fire' | 'rocks' | 'none';

export type ArenaDef = {
    id: string;
    name: string;
    centreX: number;
    centreZ: number;
    half: number;
    boundary: BoundaryTheme;
    // optional extra walkable seeds (for arenas split by obstacles that should still be included)
    seeds?: [number, number][];
    // music track name from midi.pack
    music: string;
};

export const ARENAS: Record<string, ArenaDef> = {
    lumbridge: {
        id: 'lumbridge',
        name: 'Lumbridge',
        centreX: 3222,
        centreZ: 3222,
        half: 28,
        boundary: 'fire',
        music: 'harmony'
    },
    edgeville_dungeon: {
        id: 'edgeville_dungeon',
        name: 'Edgeville Dungeon',
        centreX: 3112,
        centreZ: 9932,
        half: 32,
        boundary: 'rocks',
        music: 'scape cave'
    },
    wilderness: {
        id: 'wilderness',
        name: 'Demonic Ruins',
        centreX: 3287,
        centreZ: 3884,
        half: 28,
        boundary: 'fire',
        music: 'deep wildy'
    }
};

// loc ids from loc.pack (verified at extract time)
export const BOUNDARY_LOCS: Record<BoundaryTheme, string[]> = {
    fire: ['fire'],
    rocks: ['rocks1', 'rocks2', 'rocks3'],
    none: []
};

// Serialized arena data produced by tools/extract.ts (data/arenas/<id>.json)
export type ArenaData = {
    id: string;
    baseX: number;
    baseZ: number;
    centreZoneX: number;
    centreZoneZ: number;
    centreLocalX: number;
    centreLocalZ: number;
    flags: string; // base64 Int32Array(104*104), level 0 collision incl. OUT_OF_ARENA bits
    arenaTiles: number;
    spawnRing: number[]; // idx = x * 104 + z
    lairs: number[]; // guardian lair tiles
    caches: number[]; // cache tiles
    boundaryLocs: { id: number; x: number; z: number; shape: number; angle: number; level: number }[];
    music: number;
};
