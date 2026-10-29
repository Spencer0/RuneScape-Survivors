// Headless simulation: runs the real game simulation with scripted bots and no rendering.
//   npm run sim                 -> full suite: 500 runs + dodger/ignorer boss study + balance report
//   npm run sim -- --runs 30    -> smaller suite
//   npm run sim -- --one melee lumbridge dodger [seed]
import fs from 'node:fs';
import path from 'node:path';

import { Bot, type BotKind } from '../sim/src/bots.js';
import type { ArenaData } from '../sim/src/content/arenas.js';
import { ZONES } from '../sim/src/content/zones.js';
import { CLASSES } from '../sim/src/content/classes.js';
import { computeTalentXp, emptyProfile } from '../sim/src/meta.js';
import type { Snapshot } from '../sim/src/protocol.js';
import { Sim, decodeArena } from '../sim/src/sim.js';
import type { ClassId, GameDb, RunLoadout } from '../sim/src/types.js';
import { validateContent } from '../sim/src/validate.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const db: GameDb = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/game.json'), 'utf8'));
const arenas: Record<string, ReturnType<typeof decodeArena>> = {};
for (const z of ZONES) {
    const data: ArenaData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/arenas', `${z.arena}.json`), 'utf8'));
    arenas[z.id] = decodeArena(data);
}

export type RunStat = {
    classId: ClassId;
    zoneId: string;
    bot: BotKind;
    seed: number;
    ticks: number;
    level: number;
    kills: number;
    won: boolean;
    bosses: number;
    bossFights: number;
    telegraphDamage: number;
    telegraphHits: number;
    damageTaken: number;
    maxAlive: number;
    sets: string[];
    picks: string[];
    maxTickMs: number;
    avgTickMs: number;
    talentXp: number;
    deathBy: string;
    error?: string;
};

function loadout(classId: ClassId, zoneId: string, seed: number, maxTalents: boolean): RunLoadout {
    const cls = CLASSES[classId];
    const talents: Record<string, number> = {};
    let capstone: string | null = null;
    if (maxTalents) {
        for (const t of cls.talents) {
            if (t.capstone) continue;
            talents[t.id] = t.maxRank;
        }
        const cap = cls.talents.find(t => t.capstone)!;
        talents[cap.id] = 1;
        capstone = cap.id;
    }
    return {
        classId,
        zoneId,
        seed,
        talents,
        capstone,
        gear: maxTalents ? { head: 3, body: 3, legs: 3, weapon: 3, shield: 3 } : { head: -1, body: -1, legs: -1, weapon: -1, shield: -1 },
        perks: { rerolls: maxTalents ? 3 : 0, banish: 0, openingHand: maxTalents, pet: maxTalents },
        appearance: []
    };
}

export function runOne(classId: ClassId, zoneId: string, kind: BotKind, seed: number, opts: { maxTalents?: boolean; maxTicks?: number; endless?: boolean } = {}): RunStat {
    const sim = new Sim(arenas[zoneId], db, loadout(classId, zoneId, seed, !!opts.maxTalents));
    const bot = new Bot(kind, seed, !!opts.endless);
    let snap: Snapshot | null = null;
    let maxMs = 0;
    let totalMs = 0;
    let steps = 0;
    const limit = opts.maxTicks ?? 2400;
    let error: string | undefined;
    try {
        while (!sim.over && sim.clock < limit) {
            const t0 = performance.now();
            snap = sim.step(bot.decide(sim, snap));
            const dt = performance.now() - t0;
            totalMs += dt;
            steps++;
            if (dt > maxMs) maxMs = dt;
            if (steps > limit * 4) throw new Error('sim stuck (too many paused steps)');
        }
        if (!sim.over) sim.step([{ type: 'quit' }]);
    } catch (e) {
        error = (e as Error).stack ?? String(e);
    }
    const res = sim.over;
    return {
        classId,
        zoneId,
        bot: kind,
        seed,
        ticks: sim.clock,
        level: sim.level,
        kills: sim.kills,
        won: res?.won ?? false,
        bosses: sim.bossesKilled.length,
        bossFights: sim.bossesSpawned,
        telegraphDamage: sim.telegraphDamage,
        telegraphHits: sim.telegraphHits,
        damageTaken: sim.damageTaken,
        maxAlive: sim.maxAlive,
        sets: res?.sets.map(s => s.name) ?? [],
        picks: sim.picks,
        maxTickMs: maxMs,
        avgTickMs: steps ? totalMs / steps : 0,
        talentXp: res ? computeTalentXp(res, emptyProfile()) : 0,
        deathBy: sim.dead ? 'died' : res?.won ? 'won' : 'timeout',
        error
    };
}

const fmtTime = (ticks: number) => {
    const s = Math.round(ticks * 0.6);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function main() {
    const args = process.argv.slice(2);
    const errors = validateContent(db);
    if (errors.length > 0) {
        console.error('Content validation failed:\n' + errors.join('\n'));
        process.exit(1);
    }

    if (args[0] === '--one') {
        const [classId, zoneId, kind, seed] = [args[1] as ClassId, args[2], args[3] as BotKind, parseInt(args[4] ?? '1', 10)];
        const r = runOne(classId, zoneId, kind, seed, { maxTalents: args.includes('--max') });
        console.log(JSON.stringify({ ...r, picks: r.picks.length }, null, 1));
        return;
    }

    const runsArg = args.indexOf('--runs');
    const totalRuns = runsArg >= 0 ? parseInt(args[runsArg + 1], 10) : 500;
    const bossFightsArg = args.indexOf('--boss-fights');
    const bossFights = bossFightsArg >= 0 ? parseInt(args[bossFightsArg + 1], 10) : 100;

    const classes: ClassId[] = ['melee', 'ranged', 'magic'];
    const results: RunStat[] = [];
    const t0 = Date.now();

    // 1) N runs across all classes and zones (alternating bots)
    for (let i = 0; i < totalRuns; i++) {
        const classId = classes[i % 3];
        const zone = ZONES[Math.floor(i / 3) % ZONES.length];
        const kind: BotKind = i % 5 === 4 ? 'ignorer' : 'dodger';
        const r = runOne(classId, zone.id, kind, 1000 + i);
        results.push(r);
        if (r.error) console.error(`run ${i} ERROR ${r.error}`);
        if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${totalRuns} runs (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }

    // 2) boss study: dodger vs ignorer, max talents so they reach the bosses
    const study: RunStat[] = [];
    let fights = 0;
    let seed = 50000;
    while (fights < bossFights) {
        const classId = classes[seed % 3];
        const zone = ZONES[seed % ZONES.length];
        const d = runOne(classId, zone.id, 'dodger', seed, { maxTalents: true });
        const ig = runOne(classId, zone.id, 'ignorer', seed, { maxTalents: true });
        study.push(d, ig);
        fights += d.bossFights;
        seed++;
        if (study.length > bossFights * 6) break;
    }

    // 3) balance targets: untalented zone-1 dodgers, and a max-talent profile on zone 1
    const z1: RunStat[] = [];
    for (let i = 0; i < 30; i++) z1.push(runOne(classes[i % 3], 'lumbridge', 'dodger', 70000 + i));
    const z1max: RunStat[] = [];
    for (let i = 0; i < 9; i++) z1max.push(runOne(classes[i % 3], 'lumbridge', 'dodger', 80000 + i, { maxTalents: true }));

    const report = buildReport(results, study, z1, z1max);
    const outDir = path.join(ROOT, 'sim-out');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'report.md'), report);
    fs.writeFileSync(path.join(outDir, 'runs.json'), JSON.stringify({ results, study, z1, z1max }, null, 1));
    console.log(report);
    console.log(`\nwrote sim-out/report.md (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

    const exceptions = [...results, ...study, ...z1, ...z1max].filter(r => r.error).length;
    if (exceptions > 0) process.exit(2);
}

function buildReport(results: RunStat[], study: RunStat[], z1: RunStat[], z1max: RunStat[]): string {
    const lines: string[] = [];
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const exceptions = [...results, ...study, ...z1, ...z1max].filter(r => r.error).length;

    lines.push('# Gielinor Survivors - headless balance report');
    lines.push('');
    lines.push(`Runs: ${results.length} (all classes x all zones, dodger/ignorer bots). Exceptions: **${exceptions}**.`);
    lines.push(`Tick time: avg ${avg(results.map(r => r.avgTickMs)).toFixed(2)} ms, worst ${Math.max(...results.map(r => r.maxTickMs)).toFixed(1)} ms (budget 600 ms). Peak horde alive: ${Math.max(...results.map(r => r.maxAlive))}.`);
    lines.push('');
    lines.push('## Per class (all zones, untalented)');
    lines.push('| Class | Runs | Avg survival | Avg run level | Avg kills | Win rate | Avg bosses |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const c of ['melee', 'ranged', 'magic']) {
        const rs = results.filter(r => r.classId === c);
        lines.push(`| ${c} | ${rs.length} | ${fmtTime(avg(rs.map(r => r.ticks)))} | ${avg(rs.map(r => r.level)).toFixed(1)} | ${avg(rs.map(r => r.kills)).toFixed(0)} | ${((100 * rs.filter(r => r.won).length) / Math.max(1, rs.length)).toFixed(0)}% | ${avg(rs.map(r => r.bosses)).toFixed(2)} |`);
    }
    lines.push('');
    lines.push('## Per zone (untalented)');
    lines.push('| Zone | Runs | Avg survival | Win rate |');
    lines.push('|---|---|---|---|');
    for (const z of ZONES) {
        const rs = results.filter(r => r.zoneId === z.id);
        lines.push(`| ${z.name} | ${rs.length} | ${fmtTime(avg(rs.map(r => r.ticks)))} | ${((100 * rs.filter(r => r.won).length) / Math.max(1, rs.length)).toFixed(0)}% |`);
    }
    lines.push('');
    lines.push('## Telegraph study (max-talent profile so the bots reach the bosses)');
    const dod = study.filter(r => r.bot === 'dodger');
    const ign = study.filter(r => r.bot === 'ignorer');
    const bossTicks = (rs: RunStat[]) => avg(rs.map(r => Math.max(0, r.ticks - 300)));
    lines.push(`- Perfect dodger (walking only): ${dod.length} runs, **${dod.reduce((a, r) => a + r.bossFights, 0)} boss fights**, ${dod.reduce((a, r) => a + r.bosses, 0)} bosses killed, telegraph hits **${dod.reduce((a, r) => a + r.telegraphHits, 0)}**, telegraph damage **${dod.reduce((a, r) => a + r.telegraphDamage, 0)}**.`);
    lines.push(`- Telegraph ignorer: ${ign.length} runs, ${ign.reduce((a, r) => a + r.bossFights, 0)} boss fights, ${ign.reduce((a, r) => a + r.bosses, 0)} bosses killed, telegraph hits ${ign.reduce((a, r) => a + r.telegraphHits, 0)}, telegraph damage ${ign.reduce((a, r) => a + r.telegraphDamage, 0)}.`);
    lines.push(`- Average time alive after the first boss (3:00): dodger ${fmtTime(bossTicks(dod))}, ignorer ${fmtTime(bossTicks(ign))}.`);
    lines.push('');
    lines.push('## Balance targets');
    const z1avg = avg(z1.map(r => r.ticks));
    lines.push(`- Untalented zone-1 (Lumbridge) dodger runs: average survival **${fmtTime(z1avg)}** (target 6:00-12:00), ${z1.filter(r => r.won).length}/${z1.length} wins.`);
    lines.push(`- Debug max-talent profile, zone 1: ${z1max.filter(r => r.ticks >= 1600 || r.won).length}/${z1max.length} reached the final boss (16:00), ${z1max.filter(r => r.won).length} won.`);
    lines.push('');
    lines.push('## Most-picked sets and cards');
    const setCounts = new Map<string, number>();
    for (const r of results) for (const s of r.sets) setCounts.set(s, (setCounts.get(s) ?? 0) + 1);
    const topSets = [...setCounts].sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [s, n] of topSets) lines.push(`- ${s}: ${n} runs`);
    const pickCounts = new Map<string, number>();
    for (const r of results) for (const p of r.picks) pickCounts.set(p, (pickCounts.get(p) ?? 0) + 1);
    lines.push('');
    lines.push('Top cards: ' + [...pickCounts].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([p, n]) => `${p} (${n})`).join(', '));
    return lines.join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('sim.ts')) {
    main();
}
