// Web Worker host for the simulation. The page sends one 'step' per 600 ms game tick (or none while
// paused); the worker replies with the tick's Snapshot. No DOM, no timers: fully deterministic.
import type { ArenaData } from './content/arenas.js';
import type { Command } from './protocol.js';
import { Sim, decodeArena } from './sim.js';
import type { GameDb, RunLoadout } from './types.js';

type In =
    | { type: 'init'; arena: ArenaData; db: GameDb; loadout: RunLoadout }
    | { type: 'step'; commands: Command[]; id: number };

let sim: Sim | null = null;

self.onmessage = (ev: MessageEvent<In>) => {
    const msg = ev.data;
    try {
        if (msg.type === 'init') {
            sim = new Sim(decodeArena(msg.arena), msg.db, msg.loadout);
            const snap = sim.step([]);
            (self as unknown as Worker).postMessage({ type: 'snapshot', id: -1, snap, tickMs: sim.lastTickMs, alive: sim.enemyCount });
        } else if (msg.type === 'step' && sim) {
            const snap = sim.step(msg.commands);
            (self as unknown as Worker).postMessage({ type: 'snapshot', id: msg.id, snap, tickMs: sim.lastTickMs, alive: sim.enemyCount }, [snap.npcMoves.buffer]);
        }
    } catch (e) {
        (self as unknown as Worker).postMessage({ type: 'error', error: (e as Error).stack ?? String(e) });
    }
};
