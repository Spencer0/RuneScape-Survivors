// Scripted players for the headless simulation (npm run sim).
//  - 'dodger':  perfect dodger. Steps off highlighted tiles on the first tick at WALKING speed
//               (never runs while a telegraph is pending) using the same reachability search the
//               fairness validator uses. Otherwise kites the horde and collects orbs.
//  - 'ignorer': same kiting brain, but pays no attention to telegraphs.
//  - 'idle':    stands still (lower bound).
import { ABILITY_BY_ID } from './content/abilities.js';
import { planDodge } from './fairness.js';
import type { Command, Snapshot } from './protocol.js';
import { Rng } from './rng.js';
import type { Sim } from './sim.js';
import { SIZE, isBlocked } from './world/collision.js';

export type BotKind = 'dodger' | 'ignorer' | 'idle';

export class Bot {
    private readonly rng: Rng;
    private goal = -1;
    private replanIn = 0;
    dodgeSteps = 0;
    endless: boolean;

    constructor(readonly kind: BotKind, seed: number, endless: boolean = false) {
        this.rng = new Rng(seed ^ 0x5bd1e995);
        this.endless = endless;
    }

    decide(sim: Sim, snap: Snapshot | null): Command[] {
        const cmds: Command[] = [];
        if (sim.over) return cmds;

        if (sim.victoryPending) {
            cmds.push({ type: 'endless', on: this.endless });
            return cmds;
        }

        if (sim.hasOffer && snap?.levelUp) {
            const cards = snap.levelUp.cards;
            let best = 0;
            let bestScore = -1;
            cards.forEach((c, i) => {
                const def = ABILITY_BY_ID[c.id];
                let score = c.rarity * 0.6 + this.rng.float() * 0.5;
                if (c.kind === 'heal') score += sim.hp < sim.maxHp * 0.5 ? 6 : 0.5;
                else if (c.kind === 'coins') score += 0.3;
                else if (def) {
                    if (def.kind === 'active') score += def.family === sim.classId ? 5 : 3.2;
                    else score += def.family === 'prayer' ? 3 : 2.2;
                    if (c.kind === 'rank') score += 1;
                }
                if (score > bestScore) {
                    bestScore = score;
                    best = i;
                }
            });
            // picking pauses the sim; the pick and this tick's movement go in the same batch
            cmds.push({ type: 'pick', index: best });
        }

        if (this.kind === 'idle') return cmds;

        // 1) telegraphs: perfect dodge at walking speed
        if (this.kind === 'dodger') {
            const impacts = sim.pendingImpacts();
            if (impacts.length > 0) {
                const next = planDodge(sim.flags, sim.px, sim.pz, sim.tick, impacts);
                if (sim.running) cmds.push({ type: 'run', on: false });
                if (next >= 0 && next !== sim.px * SIZE + sim.pz) {
                    this.dodgeSteps++;
                    cmds.push({ type: 'walk', x: (next / SIZE) | 0, z: next % SIZE });
                } else if (sim.routeLength > 0) {
                    // stay: cancel the current route by walking onto our own tile
                    cmds.push({ type: 'walk', x: sim.px, z: sim.pz });
                }
                this.goal = -1;
                return cmds;
            }
        }

        // 2) kite: pick a goal tile away from enemies, towards orbs
        if (--this.replanIn <= 0 || this.goal === -1) {
            this.goal = this.pickGoal(sim);
            this.replanIn = 3;
            if (this.goal >= 0) cmds.push({ type: 'walk', x: (this.goal / SIZE) | 0, z: this.goal % SIZE });
        }

        // run when crowded and energy allows (the dodger never runs during telegraphs, see above)
        const crowded = sim.enemyPositions().some(e => Math.max(Math.abs(e.x - sim.px), Math.abs(e.z - sim.pz)) <= 2);
        const wantRun = crowded && sim.energy > 2500;
        if (wantRun !== sim.running) cmds.push({ type: 'run', on: wantRun });
        return cmds;
    }

    private pickGoal(sim: Sim): number {
        const enemies = sim.enemyPositions();
        const pickups = sim.pickupList();
        const caches = sim.cacheInfo().filter(c => !c.opened && c.cost <= sim.coins);
        let best = -1;
        let bestScore = -1e9;
        for (let i = 0; i < 40; i++) {
            const r = 2 + this.rng.int(6);
            const ang = this.rng.float() * Math.PI * 2;
            const x = Math.round(sim.px + Math.cos(ang) * r);
            const z = Math.round(sim.pz + Math.sin(ang) * r);
            if (x < 1 || z < 1 || x >= SIZE - 1 || z >= SIZE - 1 || isBlocked(sim.flags, x, z)) continue;
            let score = 0;
            for (const e of enemies) {
                const d = Math.max(Math.abs(e.x - x), Math.abs(e.z - z));
                if (d < 8) score -= (8 - d) * (e.boss ? 6 : 1.4);
            }
            for (const p of pickups) {
                const d = Math.max(Math.abs(p.x - x), Math.abs(p.z - z));
                if (d < 6) score += (6 - d) * (p.kind === 'magnet' ? 8 : p.kind === 'food' ? 4 : 0.8);
            }
            for (const c of caches) {
                const d = Math.max(Math.abs(c.x - x), Math.abs(c.z - z));
                score += Math.max(0, 20 - d) * 1.5;
            }
            // keep away from the arena edge (fewer dead ends)
            for (let k = 0; k < 4; k++) {
                const ex = x + [3, -3, 0, 0][k];
                const ez = z + [0, 0, 3, -3][k];
                if (isBlocked(sim.flags, ex, ez)) score -= 2;
            }
            if (score > bestScore) {
                bestScore = score;
                best = x * SIZE + z;
            }
        }
        return best;
    }
}
