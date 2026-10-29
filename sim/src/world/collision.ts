// RS2 collision rules, ported 1:1 from the Lost City client's tryMove neighbour checks so the
// simulation paths exactly like the original client route-finder would on the same flags.
export const SIZE = 104;

export const PL_WALK_N = 0x280102;
export const PL_WALK_E = 0x280108;
export const PL_WALK_NE = 0x28010e;
export const PL_WALK_S = 0x280120;
export const PL_WALK_SE = 0x280138;
export const PL_WALK_W = 0x280180;
export const PL_WALK_NW = 0x280183;
export const PL_WALK_SW = 0x2801e0;
export const SQ_BLOCKED = 0x280100;

// survivors: bit set on every tile outside the arena border so nothing can leave it
export const OUT_OF_ARENA = 0x4000000;

export const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
export const DZ = [1, 1, 1, 0, 0, -1, -1, -1];

// direction index as used by the client's moveCode (0=NW,1=N,2=NE,3=W,4=E,5=SW,6=S,7=SE)
export function dirIndex(dx: number, dz: number): number {
    for (let i = 0; i < 8; i++) {
        if (DX[i] === dx && DZ[i] === dz) {
            return i;
        }
    }
    return -1;
}

export function idx(x: number, z: number): number {
    return x * SIZE + z;
}

// Can a size-1 entity step from (x,z) by (dx,dz) (each in -1..1)?
export function canStep(flags: Int32Array, x: number, z: number, dx: number, dz: number): boolean {
    const nx = x + dx;
    const nz = z + dz;
    if (nx < 0 || nz < 0 || nx >= SIZE || nz >= SIZE) {
        return false;
    }

    const f = flags[idx(nx, nz)];
    if ((f & OUT_OF_ARENA) !== 0) {
        return false;
    }

    if (dx === -1 && dz === 0) return (f & PL_WALK_E) === 0;
    if (dx === 1 && dz === 0) return (f & PL_WALK_W) === 0;
    if (dx === 0 && dz === -1) return (f & PL_WALK_N) === 0;
    if (dx === 0 && dz === 1) return (f & PL_WALK_S) === 0;

    const fx = flags[idx(x + dx, z)];
    const fz = flags[idx(x, z + dz)];
    if ((fx & OUT_OF_ARENA) !== 0 || (fz & OUT_OF_ARENA) !== 0) {
        return false;
    }

    if (dx === -1 && dz === -1) return (f & PL_WALK_NE) === 0 && (fx & PL_WALK_E) === 0 && (fz & PL_WALK_N) === 0;
    if (dx === 1 && dz === -1) return (f & PL_WALK_NW) === 0 && (fx & PL_WALK_W) === 0 && (fz & PL_WALK_N) === 0;
    if (dx === -1 && dz === 1) return (f & PL_WALK_SE) === 0 && (fx & PL_WALK_E) === 0 && (fz & PL_WALK_S) === 0;
    if (dx === 1 && dz === 1) return (f & PL_WALK_SW) === 0 && (fx & PL_WALK_W) === 0 && (fz & PL_WALK_S) === 0;
    return dx === 0 && dz === 0;
}

export function isBlocked(flags: Int32Array, x: number, z: number): boolean {
    if (x < 0 || z < 0 || x >= SIZE || z >= SIZE) {
        return true;
    }
    const f = flags[idx(x, z)];
    return (f & (SQ_BLOCKED | OUT_OF_ARENA)) !== 0;
}

// Footprint test for large NPCs (bosses): every tile under the NPC must be open.
export function canPlaceLarge(flags: Int32Array, x: number, z: number, size: number): boolean {
    for (let ix = 0; ix < size; ix++) {
        for (let iz = 0; iz < size; iz++) {
            if (isBlocked(flags, x + ix, z + iz)) {
                return false;
            }
        }
    }
    return true;
}
