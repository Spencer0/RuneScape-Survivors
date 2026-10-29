// Web Worker host for the simulation. The page sends one 'step' per 600 ms game tick (or none while
// paused); the worker replies with the tick's Snapshot. No DOM, no timers: fully deterministic.
import type { ArenaData } from './content/arenas.js';
import type { Command } from './protocol.js';
import { Bot, type BotKind } from './bots.js';
import type { Snapshot } from './protocol.js';
import { Sim, decodeArena } from './sim.js';
import type { GameDb, RunLoadout } from './types.js';

type In =
    | { type: 'init'; arena: ArenaData; db: GameDb; loadout: RunLoadout; bot?: BotKind; endless?: boolean }
    | { type: 'step'; commands: Command[]; id: number };

let sim: Sim | null = null;
// optional autoplay (?bot=dodger): the headless bots drive the in-browser run for demos/screenshots
let bot: Bot | null = null;
let last: Snapshot | null = null;

self.onmessage = (ev: MessageEvent<In>) => {
    const msg = ev.data;
    try {
        if (msg.type === 'init') {
            sim = new Sim(decodeArena(msg.arena), msg.db, msg.loadout);
            bot = msg.bot ? new Bot(msg.bot, msg.loadout.seed, !!msg.endless) : null;
            const snap = sim.step([]);
            last = snap;
            (self as unknown as Worker).postMessage({ type: 'snapshot', id: -1, snap, tickMs: sim.lastTickMs, alive: sim.enemyCount });
        } else if (msg.type === 'step' && sim) {
            const commands = bot ? [...msg.commands.filter(c => c.type === 'quit'), ...bot.decide(sim, last)] : msg.commands;
            const snap = sim.step(commands);
            last = snap;
            (self as unknown as Worker).postMessage({ type: 'snapshot', id: msg.id, snap, tickMs: sim.lastTickMs, alive: sim.enemyCount }, [snap.npcMoves.buffer]);
        }
    } catch (e) {
        (self as unknown as Worker).postMessage({ type: 'error', error: (e as Error).stack ?? String(e) });
    }
};
