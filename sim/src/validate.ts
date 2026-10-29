// Verifies every cache reference in the content (NPCs, seqs, spotanims, objs, locs) exists in the
// 2004 cache build. Abilities are dry-run against a recording mock so names used in code paths are
// covered too. Run at extract time and by `npm run sim`.
import type { EnemyRef, SimApi } from './api.js';
import { ALL_ABILITIES } from './content/abilities.js';
import { CLASSES } from './content/classes.js';
import { ENEMIES } from './content/enemies.js';
import { RUN_ITEMS } from './content/items.js';
import { ZONES } from './content/zones.js';
import { Rng } from './rng.js';
import { baseStats, type GameDb } from './types.js';

export function validateContent(db: GameDb): string[] {
    const errors: string[] = [];
    const need = (kind: keyof GameDb, name: string, where: string) => {
        if ((db[kind] as Record<string, unknown>)[name] === undefined) errors.push(`${where}: missing ${kind} '${name}'`);
    };

    for (const e of Object.values(ENEMIES)) {
        need('npcs', e.npc, `enemy ${e.id}`);
        if (e.attackAnim) need('seqs', e.attackAnim, `enemy ${e.id}`);
        if (e.deathAnim) need('seqs', e.deathAnim, `enemy ${e.id}`);
        if (e.projectile) need('spotanims', e.projectile, `enemy ${e.id}`);
        if (e.impact) need('spotanims', e.impact, `enemy ${e.id}`);
        const npc = db.npcs[e.npc];
        if (npc && npc.attackAnim < 0 && !e.attackAnim) errors.push(`enemy ${e.id}: npc ${e.npc} has no attack anim`);
    }

    for (const z of ZONES) {
        for (const r of z.roster) if (!ENEMIES[r.enemy]) errors.push(`zone ${z.id}: unknown roster enemy ${r.enemy}`);
        for (const g of z.guardians) if (!ENEMIES[g]) errors.push(`zone ${z.id}: unknown guardian ${g}`);
        if (z.bosses.length !== 5) errors.push(`zone ${z.id}: needs 5 bosses`);
        for (const b of z.bosses) {
            for (const f of b.forms) need('npcs', f.npc, `boss ${b.id}`);
            for (const v of Object.values(b.projectile ?? {})) need('spotanims', v!, `boss ${b.id} projectile`);
            for (const v of Object.values(b.impact ?? {})) need('spotanims', v!, `boss ${b.id} impact`);
            for (const v of Object.values(b.attackAnim ?? {})) need('seqs', v!, `boss ${b.id} anim`);
            if (b.patterns.length < 2) errors.push(`boss ${b.id}: needs >= 2 patterns`);
        }
        if (!z.bosses.some(b => b.styleSwitch && b.styleSwitch.length > 1)) errors.push(`zone ${z.id}: needs a style-switching boss`);
    }

    for (const item of RUN_ITEMS) need('objs', item.obj, `item ${item.id}`);

    for (const cls of Object.values(CLASSES)) {
        for (const [slot, objs] of Object.entries(cls.gear)) for (const o of objs) need('objs', o, `class ${cls.id} gear ${slot}`);
        for (const a of cls.anims) need('seqs', a, `class ${cls.id} anims`);
    }

    for (const n of ['coins', 'air_orb', 'water_orb', 'earth_orb', 'fire_orb', 'shark', 'magnet']) need('objs', n, 'pickups');
    for (const n of ['chestclosed', 'chestopen', 'fire', 'rocks1', 'rocks2', 'rocks3']) need('locs', n, 'locs');
    for (const n of ['human_death']) need('seqs', n, 'sim');
    for (const n of ['levelup_anim', 'telegrab_casting', 'firestrike_impact', 'sp_attackglow_red', 'rockfall', 'smokepuff']) need('spotanims', n, 'sim');
    need('npcs', 'kittenpet1', 'pet');

    // dry-run every active ability against a recording mock
    const fake: EnemyRef = { slot: 1, x: 52, z: 50, size: 1, hp: 50, maxHp: 50, elite: 0, undead: true, alive: true };
    const mock: SimApi = {
        tick: 10,
        rng: new Rng(1),
        stats: baseStats(),
        px: 50,
        pz: 50,
        classId: 'melee',
        seq: n => (need('seqs', n, 'ability code'), 0),
        spot: n => (need('spotanims', n, 'ability code'), 0),
        obj: n => (need('objs', n, 'ability code'), 0),
        loc: n => (need('locs', n, 'ability code'), 0),
        targets: () => [fake, { ...fake, slot: 2, x: 53 }],
        inRadius: () => [fake, { ...fake, slot: 2 }, { ...fake, slot: 3 }, { ...fake, slot: 4 }],
        inLine: () => [fake],
        nearestCluster: () => ({ x: 52, z: 50, count: 3 }),
        hit: () => {},
        projectile: () => 1,
        playerAnim: () => {},
        playerSpot: () => {},
        mapSpot: () => {},
        sound: () => {},
        heal: () => {},
        addHazard: (_t, _ticks, _d, _s, _f, kind, opts) => {
            if (opts?.fireLocs) need('locs', 'fire', 'hazard');
            void kind;
        },
        buff: () => {},
        hasBuff: () => false,
        lastMove: () => ({ dx: 1, dz: 0, moved: true, trail: [49 * 104 + 50] }),
        walkable: () => true,
        enemyAttackStyle: () => 'melee',
        message: () => {}
    };
    for (const a of ALL_ABILITIES) {
        if (a.maxRank < 5) errors.push(`ability ${a.id}: needs >= 5 ranks`);
        for (const s of a.refs?.seqs ?? []) need('seqs', s, `ability ${a.id}`);
        for (const s of a.refs?.spots ?? []) need('spotanims', s, `ability ${a.id}`);
        for (const s of a.refs?.objs ?? []) need('objs', s, `ability ${a.id}`);
        for (const s of a.refs?.locs ?? []) need('locs', s, `ability ${a.id}`);
        if (a.kind === 'active' && a.cast) {
            for (let r = 1; r <= a.maxRank; r++) {
                try {
                    a.cast(mock, a.params(r), r);
                } catch (e) {
                    errors.push(`ability ${a.id} rank ${r}: ${(e as Error).message}`);
                }
            }
        }
    }
    return [...new Set(errors)];
}
