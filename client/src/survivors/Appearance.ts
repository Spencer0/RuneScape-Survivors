// Builds PLAYER_INFO appearance blocks locally, following Engine-TS Player.generateAppearance:
// worn items go in their wearpos slot as 0x200+obj, slots named by wearpos2/wearpos3 are hidden,
// everything else is the player's identity kit (0x100+idk).
import IdkType from '#/config/IdkType.js';
import Packet from '#/io/Packet.js';

import Assets from '#/survivors/Assets.js';

// body part order used by the designer: head, jaw, torso, arms, hands, legs, feet
export const BODY_PARTS = ['Head', 'Jaw', 'Torso', 'Arms', 'Hands', 'Legs', 'Feet'];
const PART_SLOT = [8, 11, 4, 6, 9, 7, 10];
export const COLOUR_NAMES = ['Hair', 'Torso', 'Legs', 'Feet', 'Skin'];
export const COLOUR_COUNTS = [12, 16, 16, 6, 8];

export type Look = { gender: number; body: number[]; colours: number[] };

// identity-kit ids valid for a body part (type 0..6 male, 7..13 female), excluding hidden kits
export function kitsFor(part: number, gender: number): number[] {
    const out: number[] = [];
    const type = part + (gender === 1 ? 7 : 0);
    for (let i = 0; i < IdkType.numDefinitions; i++) {
        const k = IdkType.list[i];
        if (k && k.part === type && !k.disable) {
            out.push(i);
        }
    }
    return out;
}

export function defaultLook(gender: number): Look {
    const body = BODY_PARTS.map((_, part) => kitsFor(part, gender)[0] ?? -1);
    return { gender, body, colours: [0, 0, 0, 0, 0] };
}

export function validLook(look: Look): Look {
    const body = look.body.map((kit, part) => {
        const kits = kitsFor(part, look.gender);
        if (kits.length === 0) return -1;
        return kits.includes(kit) ? kit : kits[0];
    });
    const colours = look.colours.map((c, i) => (c >= 0 && c < COLOUR_COUNTS[i] ? c : 0));
    return { gender: look.gender ? 1 : 0, body, colours };
}

export function buildAppearance(look: Look, worn: string[], anims: number[], headicons: number = 0): Packet {
    const wear = Assets.game.wear;
    const objs = Assets.game.objs;
    const slots: number[] = new Array(12).fill(0);
    const skipped = new Set<number>();

    for (let part = 0; part < 7; part++) {
        const kit = look.body[part];
        if (kit >= 0) slots[PART_SLOT[part]] = 0x100 + kit;
    }

    for (const name of worn) {
        const id = objs[name];
        const w = wear[name];
        if (id === undefined || !w || w[0] < 0 || w[0] > 11) continue;
        slots[w[0]] = 0x200 + id;
        if (w[1] >= 0) skipped.add(w[1]);
        if (w[2] >= 0) skipped.add(w[2]);
    }
    for (const s of skipped) slots[s] = 0;

    const data = new Uint8Array(64);
    let pos = 0;
    const p1 = (v: number) => (data[pos++] = v & 0xff);
    const p2 = (v: number) => {
        data[pos++] = (v >> 8) & 0xff;
        data[pos++] = v & 0xff;
    };
    p1(look.gender);
    p1(headicons);
    for (const v of slots) {
        if (v === 0) p1(0);
        else p2(v);
    }
    for (const c of look.colours) p1(c);
    for (const a of anims) p2(a < 0 ? 65535 : a);
    for (let i = 0; i < 8; i++) p1(0); // name (base37 0)
    p1(3); // combat level
    p2(0);
    return new Packet(data.subarray(0, pos));
}
