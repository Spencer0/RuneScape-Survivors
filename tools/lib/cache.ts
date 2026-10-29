// Minimal reader for the RS2 main_file_cache (.dat + .idx0-4) written by the Lost City engine packer.
import fs from 'node:fs';

export class CacheReader {
    private readonly dat: Buffer;
    private readonly idx: Buffer[] = [];

    constructor(dir: string) {
        this.dat = fs.readFileSync(`${dir}/main_file_cache.dat`);
        for (let i = 0; i <= 4; i++) {
            this.idx[i] = fs.readFileSync(`${dir}/main_file_cache.idx${i}`);
        }
    }

    count(index: number): number {
        return (this.idx[index].length / 6) | 0;
    }

    // index 0 = jag archives, 1..4 = on-demand archives 0..3 (models, anims, midi, maps)
    read(index: number, file: number): Uint8Array | null {
        const idx = this.idx[index];
        if (file < 0 || file >= this.count(index)) {
            return null;
        }

        const p = file * 6;
        const size = (idx[p] << 16) | (idx[p + 1] << 8) | idx[p + 2];
        let sector = (idx[p + 3] << 16) | (idx[p + 4] << 8) | idx[p + 5];
        if (size <= 0 || sector <= 0) {
            return null;
        }

        const out = new Uint8Array(size);
        let pos = 0;
        for (let part = 0; pos < size; part++) {
            const s = sector * 520;
            const sectorFile = (this.dat[s] << 8) | this.dat[s + 1];
            const sectorPart = (this.dat[s + 2] << 8) | this.dat[s + 3];
            const next = (this.dat[s + 4] << 16) | (this.dat[s + 5] << 8) | this.dat[s + 6];
            const sectorIndex = this.dat[s + 7];
            if (sectorFile !== file || sectorPart !== part || sectorIndex !== index + 1) {
                throw new Error(`cache corrupt at index ${index} file ${file} part ${part}`);
            }

            const n = Math.min(512, size - pos);
            out.set(this.dat.subarray(s + 8, s + 8 + n), pos);
            pos += n;
            sector = next;
        }

        return out;
    }
}

const CRC_TABLE = new Int32Array(256);
for (let i = 0; i < 256; i++) {
    let r = i;
    for (let b = 0; b < 8; b++) {
        r = (r & 1) !== 0 ? (r >>> 1) ^ 0xedb88320 : r >>> 1;
    }
    CRC_TABLE[i] = r;
}

export function crc32(src: Uint8Array): number {
    let crc = 0xffffffff;
    for (let i = 0; i < src.length; i++) {
        crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ src[i]) & 0xff];
    }
    return ~crc;
}
