// Drives the simulation worker on the 600 ms game tick, like the server's world cycle.
import type { ArenaData } from '../../../sim/src/content/arenas.js';
import type { Command, Snapshot } from '../../../sim/src/protocol.js';
import type { GameDb, RunLoadout } from '../../../sim/src/types.js';

export const CYCLES_PER_TICK = 30; // 30 x 20ms client cycles = 600ms

export default class SimBridge {
    private worker: Worker | null = null;
    private waiting = false;
    private queued: Command[] = [];
    private nextId = 0;
    private readonly inbox: Snapshot[] = [];
    cycle = 0;
    lastTickMs = 0;
    alive = 0;
    error: string | null = null;
    ready = false;
    autoplay = false;
    speed = 1; // debug/test only: sim ticks per 600ms

    start(arena: ArenaData, db: GameDb, loadout: RunLoadout, bot?: string, endless?: boolean): void {
        this.stop();
        this.worker = new Worker(new URL('./simworker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = ev => {
            const msg = ev.data;
            if (msg.type === 'snapshot') {
                this.waiting = false;
                this.ready = true;
                this.lastTickMs = msg.tickMs;
                this.alive = msg.alive;
                this.inbox.push(msg.snap);
            } else if (msg.type === 'error') {
                this.error = msg.error;
                console.error(msg.error);
            }
        };
        this.worker.onerror = e => {
            this.error = e.message;
        };
        this.waiting = true;
        this.cycle = 0;
        this.worker.postMessage({ type: 'init', arena, db, loadout, bot, endless });
        this.autoplay = !!bot;
    }

    stop(): void {
        this.worker?.terminate();
        this.worker = null;
        this.waiting = false;
        this.ready = false;
        this.queued = [];
        this.inbox.length = 0;
    }

    send(cmd: Command): void {
        this.queued.push(cmd);
    }

    // send queued commands now (used for card picks while paused: no need to wait for the tick)
    flush(): void {
        if (!this.worker || this.waiting) return;
        this.waiting = true;
        const commands = this.queued;
        this.queued = [];
        this.cycle = 0;
        this.worker.postMessage({ type: 'step', commands, id: this.nextId++ });
    }

    // called every 20ms client cycle; steps the sim every 30 cycles while not paused
    update(paused: boolean): void {
        if (!this.worker || !this.ready) return;
        if (paused) {
            if (this.queued.length > 0) this.flush();
            return;
        }
        if (++this.cycle >= Math.max(1, Math.round(CYCLES_PER_TICK / this.speed))) {
            if (this.waiting) {
                this.cycle = CYCLES_PER_TICK; // the worker is late; step as soon as it replies
                return;
                return;
            }
            this.flush();
        }
    }

    poll(): Snapshot | null {
        return this.inbox.shift() ?? null;
    }
}
