// Parses the Lost City content configs (.npc text configs + .pack id tables) into a compact JSON
// the simulation can use. Every id here comes straight from the 2004 cache build.
import fs from 'node:fs';
import path from 'node:path';

import type { CacheReader } from './cache.js';

export type NpcInfo = {
    id: number;
    debugname: string;
    name: string;
    size: number;
    vislevel: number;
    hitpoints: number;
    attack: number;
    strength: number;
    defence: number;
    magic: number;
    ranged: number;
    attackrate: number;
    attackAnim: number;
    defendAnim: number;
    deathAnim: number;
    walkAnim: number;
    readyAnim: number;
    damagetype: string;
    ops: string[];
};

export type GameData = {
    npcs: Record<string, NpcInfo>;
    seqs: Record<string, number>;
    spotanims: Record<string, number>;
    locs: Record<string, number>;
    objs: Record<string, number>;
    midis: Record<string, number>;
    synths: Record<string, number>;
    idks: Record<string, number>;
};

function readPack(file: string): Record<string, number> {
    const out: Record<string, number> = {};
    if (!fs.existsSync(file)) {
        return out;
    }
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const eq = line.indexOf('=');
        if (eq <= 0) {
            continue;
        }
        const id = parseInt(line.substring(0, eq), 10);
        const name = line.substring(eq + 1).trim();
        if (!Number.isNaN(id) && name.length > 0) {
            out[name] = id;
        }
    }
    return out;
}

function walk(dir: string, ext: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === '_unpack') {
                continue; // raw revision dumps, superseded by the curated configs
            }
            walk(full, ext, out);
        } else if (entry.name.endsWith(ext)) {
            out.push(full);
        }
    }
    return out;
}

function parseConfigs(files: string[]): Map<string, Map<string, string[]>> {
    const out = new Map<string, Map<string, string[]>>();
    for (const file of files) {
        let current: Map<string, string[]> | null = null;
        for (let line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const comment = line.indexOf('//');
            if (comment !== -1) {
                line = line.substring(0, comment);
            }
            line = line.trim();
            if (line.length === 0) {
                continue;
            }
            if (line.startsWith('[') && line.endsWith(']')) {
                current = new Map();
                out.set(line.substring(1, line.length - 1), current);
                continue;
            }
            const eq = line.indexOf('=');
            if (!current || eq === -1) {
                continue;
            }
            const key = line.substring(0, eq);
            const value = line.substring(eq + 1);
            const list = current.get(key) ?? [];
            list.push(value);
            current.set(key, list);
        }
    }
    return out;
}

export function extractGameData(contentDir: string, _cache: CacheReader): GameData {
    const pack = (name: string) => readPack(path.join(contentDir, 'pack', `${name}.pack`));
    const npcIds = pack('npc');
    const seqs = pack('seq');
    const spotanims = pack('spotanim');
    const locs = pack('loc');
    const objs = pack('obj');
    const midis = pack('midi');
    const synths = pack('synth');
    const idks = pack('idk');

    const configs = parseConfigs(walk(path.join(contentDir, 'scripts'), '.npc'));
    const npcs: Record<string, NpcInfo> = {};

    const seq = (name: string | undefined): number => {
        if (!name) {
            return -1;
        }
        const id = seqs[name.split(',')[0].trim()];
        return id === undefined ? -1 : id;
    };

    for (const [debugname, props] of configs) {
        const id = npcIds[debugname];
        if (id === undefined) {
            continue;
        }

        const get = (key: string) => props.get(key)?.[0];
        const num = (key: string, fallback: number) => {
            const v = get(key);
            const n = v === undefined ? NaN : parseInt(v, 10);
            return Number.isNaN(n) ? fallback : n;
        };
        const params = new Map<string, string>();
        for (const p of props.get('param') ?? []) {
            const comma = p.indexOf(',');
            if (comma !== -1) {
                params.set(p.substring(0, comma), p.substring(comma + 1));
            }
        }

        const ops: string[] = [];
        for (let i = 1; i <= 5; i++) {
            const op = get(`op${i}`);
            if (op) {
                ops.push(op);
            }
        }

        const vislevelRaw = get('vislevel');
        npcs[debugname] = {
            id,
            debugname,
            name: get('name') ?? debugname,
            size: num('size', 1),
            vislevel: vislevelRaw === 'hide' ? 0 : num('vislevel', 0),
            hitpoints: num('hitpoints', 1),
            attack: num('attack', 1),
            strength: num('strength', 1),
            defence: num('defence', 1),
            magic: num('magic', 1),
            ranged: num('ranged', 1),
            attackrate: parseInt(params.get('attackrate') ?? '4', 10) || 4,
            attackAnim: seq(params.get('attack_anim')),
            defendAnim: seq(params.get('defend_anim')),
            deathAnim: seq(params.get('death_anim')),
            walkAnim: seq(get('walkanim')),
            readyAnim: seq(get('readyanim')),
            damagetype: (params.get('damagetype') ?? '').replace('^', ''),
            ops
        };
    }

    return { npcs, seqs, spotanims, locs, objs, midis, synths, idks };
}
