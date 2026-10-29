// Level-up card offers: new abilities, rank-ups and passives, rarity rolled with luck.
import { ABILITY_BY_ID, CLASS_POOLS, FAMILY_BY_ID, PARAM_LABELS, PASSIVES, RARITY_MULT, RARITY_QUALITY, SKILL_CARDS, type AbilityDef, type Params } from './content/abilities.js';
import type { Rng } from './rng.js';
import type { CardView } from './protocol.js';

export const MAX_ACTIVES = 7;

export type CardInst = {
    def: AbilityDef;
    rank: number;
    quality: number; // accumulated rarity quality bonus (actives + ranked passives)
    accum: number; // generic passives: sum of rarity multipliers
    cooldown: number; // ticks until next cast (actives)
};

export type Offer = { id: string; kind: CardView['kind']; rarity: number };

const BASE_WEIGHTS = [60, 25, 10, 4, 1];

export function rollRarity(rng: Rng, luck: number): number {
    const w = BASE_WEIGHTS.map((b, i) => (i === 0 ? b : b * (1 + luck * (1 + i * 0.5))));
    let total = 0;
    for (const x of w) total += x;
    let r = rng.float() * total;
    for (let i = 0; i < w.length; i++) {
        r -= w[i];
        if (r < 0) return i;
    }
    return 0;
}

export function isGenericPassive(def: AbilityDef): boolean {
    return def.family === 'passive';
}

// effective params for an owned card (rank table * quality, or generic base * accum)
export function effectiveParams(inst: CardInst): Params {
    const base = inst.def.params(inst.rank);
    if (isGenericPassive(inst.def)) {
        const out: Params = {};
        for (const [k, v] of Object.entries(base)) out[k] = round1(v * inst.accum);
        return out;
    }
    if (inst.def.kind === 'passive') {
        const out: Params = {};
        for (const [k, v] of Object.entries(base)) out[k] = round1(v * (1 + inst.quality));
        return out;
    }
    const out: Params = { ...base };
    if (out.damage !== undefined) out.damage = Math.round(out.damage * (1 + inst.quality));
    if (out.burn !== undefined) out.burn = Math.round(out.burn * (1 + inst.quality));
    if (out.heal !== undefined) out.heal = Math.round(out.heal * (1 + inst.quality));
    return out;
}

function round1(v: number): number {
    return Math.round(v * 10) / 10;
}

export function generateOffers(rng: Rng, classId: string, owned: Map<string, CardInst>, banished: Set<string>, luck: number, count: number): Offer[] {
    const activeCount = [...owned.values()].filter(c => c.def.kind === 'active').length;
    const candidates: { id: string; kind: CardView['kind']; weight: number }[] = [];

    for (const inst of owned.values()) {
        if (inst.rank < inst.def.maxRank && !banished.has(inst.def.id)) {
            candidates.push({ id: inst.def.id, kind: isGenericPassive(inst.def) ? 'passive' : 'rank', weight: inst.def.kind === 'active' ? 4 : 2.5 });
        }
    }
    const pool = [...CLASS_POOLS[classId], ...SKILL_CARDS, ...PASSIVES];
    for (const def of pool) {
        if (owned.has(def.id) || banished.has(def.id)) continue;
        if (def.kind === 'active' && activeCount >= MAX_ACTIVES) continue;
        const classCard = def.family === classId;
        const weight = classCard ? 3 : isGenericPassive(def) ? 1.6 : 0.9;
        candidates.push({ id: def.id, kind: isGenericPassive(def) ? 'passive' : 'new', weight });
    }

    const offers: Offer[] = [];
    const used = new Set<string>();
    for (let i = 0; i < count && candidates.length > 0; i++) {
        const avail = candidates.filter(c => !used.has(c.id));
        if (avail.length === 0) break;
        const pick = rng.weighted(avail, c => c.weight);
        used.add(pick.id);
        offers.push({ id: pick.id, kind: pick.kind, rarity: rollRarity(rng, luck) });
    }
    // nothing left to learn: fall back to heals / coins
    while (offers.length < count) {
        offers.push({ id: offers.length % 2 === 0 ? '__heal' : '__coins', kind: offers.length % 2 === 0 ? 'heal' : 'coins', rarity: rollRarity(rng, luck) });
    }
    return offers;
}

function fmt(key: string, v: number): string {
    const [, unit] = PARAM_LABELS[key] ?? [key, ''];
    if (key === 'reduce') return `${v}%`;
    if (unit === '%' || key === 'pct' || key === 'chance' || key === 'vuln') return `${v}%`;
    return `${v}${unit}`;
}

function label(key: string): string {
    return (PARAM_LABELS[key] ?? [key, ''])[0];
}

// Card text: exact before -> after numbers for every changed parameter
export function describeOffer(offer: Offer, owned: Map<string, CardInst>, cooldownMult: number): CardView {
    if (offer.kind === 'heal') {
        const pct = Math.round(30 * RARITY_MULT[offer.rarity]);
        return { id: offer.id, kind: 'heal', name: 'Cooked meat', family: 'cooking', rarity: offer.rarity, icon: 'staticons', iconIndex: 15, lines: [`Heal ${pct}% of max HP`], rankFrom: 0, rankTo: 0 };
    }
    if (offer.kind === 'coins') {
        const n = Math.round(40 * RARITY_MULT[offer.rarity]);
        return { id: offer.id, kind: 'coins', name: 'Coin pouch', family: 'thieving', rarity: offer.rarity, icon: 'staticons', iconIndex: 9, lines: [`Coins +${n}`], rankFrom: 0, rankTo: 0 };
    }

    const def = ABILITY_BY_ID[offer.id];
    const inst = owned.get(def.id);
    const familyName = FAMILY_BY_ID[def.family]?.name ?? (def.family === 'passive' ? 'Passive' : def.family[0].toUpperCase() + def.family.slice(1));
    const lines: string[] = [];
    const q = RARITY_QUALITY[offer.rarity];

    const before: CardInst | null = inst ?? null;
    const after: CardInst = inst
        ? { ...inst, rank: inst.rank + 1, quality: inst.quality + q, accum: inst.accum + RARITY_MULT[offer.rarity] }
        : { def, rank: 1, quality: q, accum: RARITY_MULT[offer.rarity], cooldown: 0 };

    const pa = effectiveParams(after);
    const pb = before ? effectiveParams(before) : null;

    for (const key of Object.keys(pa)) {
        if (key === 'cooldown') {
            const a = Math.max(1, Math.round(pa.cooldown * cooldownMult));
            const b = pb ? Math.max(1, Math.round(pb.cooldown * cooldownMult)) : null;
            if (b === null) lines.push(`Speed ${a} ticks`);
            else if (a !== b) lines.push(`Speed ${b} -> ${a} ticks`);
            continue;
        }
        const name = def.kind === 'passive' && (key === 'pct' || key === 'flat') ? def.name : label(key);
        if (!pb) {
            lines.push(`${name} ${fmt(key, pa[key])}`);
        } else if (pb[key] !== pa[key]) {
            lines.push(`${name} ${fmt(key, pb[key])} -> ${fmt(key, pa[key])}`);
        }
    }
    if (def.kind === 'active' && q > 0) {
        lines.push(`Quality +${Math.round(q * 100)}% damage`);
    }
    if (!inst && def.targeting) {
        lines.push(`Target: ${def.targeting}`);
    }
    if (lines.length === 0) {
        lines.push(def.desc);
    }

    return {
        id: def.id,
        kind: offer.kind,
        name: def.name,
        family: familyName,
        rarity: offer.rarity,
        icon: def.icon[0],
        iconIndex: def.icon[1],
        lines,
        rankFrom: inst ? inst.rank : 0,
        rankTo: inst ? inst.rank + 1 : 1
    };
}

export function applyOffer(offer: Offer, owned: Map<string, CardInst>): void {
    const def = ABILITY_BY_ID[offer.id];
    if (!def) return;
    const q = RARITY_QUALITY[offer.rarity];
    const inst = owned.get(def.id);
    if (inst) {
        inst.rank = Math.min(def.maxRank, inst.rank + 1);
        inst.quality += q;
        inst.accum += RARITY_MULT[offer.rarity];
    } else {
        owned.set(def.id, { def, rank: 1, quality: q, accum: RARITY_MULT[offer.rarity], cooldown: 2 });
    }
}

export function familyRanks(owned: Map<string, CardInst>): Map<string, number> {
    const out = new Map<string, number>();
    for (const inst of owned.values()) {
        if (FAMILY_BY_ID[inst.def.family]) {
            out.set(inst.def.family, (out.get(inst.def.family) ?? 0) + inst.rank);
        }
    }
    return out;
}

export { ABILITY_BY_ID };
