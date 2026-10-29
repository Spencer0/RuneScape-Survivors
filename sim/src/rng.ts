// Deterministic seeded RNG (sfc32). The simulation never touches Math.random.
export class Rng {
    private a: number;
    private b: number;
    private c: number;
    private d: number;

    constructor(seed: number) {
        this.a = 0x9e3779b9;
        this.b = 0x243f6a88;
        this.c = 0xb7e15162;
        this.d = seed | 0;
        for (let i = 0; i < 16; i++) {
            this.next();
        }
    }

    // uint32
    next(): number {
        this.a |= 0;
        this.b |= 0;
        this.c |= 0;
        this.d |= 0;
        const t = (((this.a + this.b) | 0) + this.d) | 0;
        this.d = (this.d + 1) | 0;
        this.a = this.b ^ (this.b >>> 9);
        this.b = (this.c + (this.c << 3)) | 0;
        this.c = (this.c << 21) | (this.c >>> 11);
        this.c = (this.c + t) | 0;
        return t >>> 0;
    }

    float(): number {
        return this.next() / 4294967296;
    }

    // [0, n)
    int(n: number): number {
        return Math.floor(this.float() * n);
    }

    range(lo: number, hi: number): number {
        return lo + this.int(hi - lo + 1);
    }

    chance(p: number): boolean {
        return this.float() < p;
    }

    pick<T>(arr: readonly T[]): T {
        return arr[this.int(arr.length)];
    }

    weighted<T>(items: readonly T[], weight: (t: T) => number): T {
        let total = 0;
        for (const it of items) {
            total += Math.max(0, weight(it));
        }
        let r = this.float() * total;
        for (const it of items) {
            r -= Math.max(0, weight(it));
            if (r < 0) {
                return it;
            }
        }
        return items[items.length - 1];
    }

    shuffle<T>(arr: T[]): T[] {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = this.int(i + 1);
            const t = arr[i];
            arr[i] = arr[j];
            arr[j] = t;
        }
        return arr;
    }

    state(): number[] {
        return [this.a, this.b, this.c, this.d];
    }
}
