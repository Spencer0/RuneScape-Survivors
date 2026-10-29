// Main screen (hero picker): class, appearance, zone, Enter World; plus Talents, Rewards,
// Collection, Achievements and Options tabs. Lays out for landscape or portrait frames.
import Pix2D from '#/graphics/Pix2D.js';

import { CLASS_POOLS } from '../../../../sim/src/content/abilities.js';
import { CLASSES, GEAR_SLOTS, TIER_NAMES, setBonusText, type GearSlot } from '../../../../sim/src/content/classes.js';
import { ZONES, ZONE_BY_ID } from '../../../../sim/src/content/zones.js';
import { ACHIEVEMENTS, REWARDS, canRankTalent, rankTalent, respec, rewardCostFor, spentAchievementPoints, spentPoints, talentPoints, talentXpForPoint, zoneLockText, type Profile } from '../../../../sim/src/meta.js';
import type { ClassId } from '../../../../sim/src/types.js';

import { BODY_PARTS, COLOUR_COUNTS, COLOUR_NAMES, buildAppearance, defaultLook, kitsFor, validLook, type Look } from '#/survivors/Appearance.js';
import Assets from '#/survivors/Assets.js';
import Save from '#/survivors/Save.js';
import Gfx, { COL } from '#/survivors/ui/Gfx.js';
import PlayerPreview from '#/survivors/ui/PlayerPreview.js';
import Ui, { type Rect } from '#/survivors/ui/Ui.js';

export type Tab = 'play' | 'talents' | 'rewards' | 'collection' | 'achievements' | 'options';
const TABS: { id: Tab; name: string; icon: [string, number] }[] = [
    { id: 'play', name: 'Play', icon: ['sideicons', 0] },
    { id: 'talents', name: 'Talents', icon: ['sideicons', 1] },
    { id: 'rewards', name: 'Rewards', icon: ['sideicons', 5] },
    { id: 'collection', name: 'Collection', icon: ['sideicons', 4] },
    { id: 'achievements', name: 'Achievements', icon: ['sideicons', 2] },
    { id: 'options', name: 'Options', icon: ['sideicons', 10] }
];

export type MenuHost = {
    startRun(): void;
    onOptionsChanged(): void;
};

export default class MenuScreen {
    tab: Tab = 'play';
    private preview = new PlayerPreview();
    private previewDirty = true;
    private status: string | null = null;
    private statusCycle = 0;
    private dragYaw = 0;

    constructor(private readonly host: MenuHost) {}

    get profile(): Profile {
        return Save.profile;
    }

    get classId(): ClassId {
        return this.profile.lastClass;
    }

    get look(): Look {
        return validLook(this.profile.appearance);
    }

    say(text: string): void {
        this.status = text;
        this.statusCycle = 250;
    }

    private save(): void {
        void Save.write();
    }

    update(): void {
        this.preview.tick();
        this.preview.yaw = (this.preview.yaw + 4 + this.dragYaw) & 0x7ff;
        this.dragYaw = 0;
        if (this.statusCycle > 0) this.statusCycle--;
    }

    key(key: number): void {
        if (key === 10 || key === 13) {
            if (this.tab === 'play') this.enter();
        }
    }

    private enter(): void {
        const cp = this.profile.classes[this.classId];
        if (!cp.unlockedZones.includes(this.profile.lastZone)) {
            this.say(zoneLockText(this.profile.lastZone));
            return;
        }
        this.host.startRun();
    }

    worn(): string[] {
        const cls = CLASSES[this.classId];
        const cp = this.profile.classes[this.classId];
        return GEAR_SLOTS.filter(s => (cp.equipped[s] ?? -1) >= 0).map(s => cls.gear[s][cp.equipped[s]]);
    }

    private refreshPreview(): void {
        if (!this.previewDirty) return;
        this.previewDirty = false;
        const cls = CLASSES[this.classId];
        const anims = cls.anims.map(a => Assets.game.seqs[a] ?? -1);
        this.preview.setAppearance(buildAppearance(this.look, this.worn(), anims));
    }

    draw(): void {
        const W = Ui.W;
        const H = Ui.H;
        this.refreshPreview();
        Gfx.stone(0, 0, W, H);

        // header
        Pix2D.fillRectTrans(0, 0, W, 40, 0, 110);
        Gfx.centre('Gielinor Survivors', W >> 1, 26, COL.ORANGE, 'q8');
        Gfx.right(`Talent pts: ${talentPoints(this.profile.classes[this.classId].talentXp) - spentPoints(this.profile.classes[this.classId])}`, W - 8, 16, COL.YELLOW, 'p11');
        Gfx.right(`Achievement pts: ${this.profile.achievementPoints - spentAchievementPoints(this.profile)}`, W - 8, 30, COL.YELLOW, 'p11');

        // tabs
        const portrait = Ui.portrait;
        const perRow = portrait ? 3 : TABS.length;
        const tabW = Math.min(130, ((W - 8) / perRow - 4) | 0);
        const tabH = 28;
        const tabsW = perRow * (tabW + 4) - 4;
        TABS.forEach((t, i) => {
            const r: Rect = { x: ((W - tabsW) >> 1) + (i % perRow) * (tabW + 4), y: 44 + Math.floor(i / perRow) * (tabH + 4), w: tabW, h: tabH };
            if (Ui.button(r, t.name, { active: this.tab === t.id, font: 'p12' })) {
                this.tab = t.id;
                Ui.resetScroll('menu');
            }
        });
        const top = 44 + Math.ceil(TABS.length / perRow) * (tabH + 4) + 4;
        const area: Rect = { x: 6, y: top, w: W - 12, h: H - top - 6 };

        switch (this.tab) {
            case 'play':
                this.drawPlay(area);
                break;
            case 'talents':
                this.drawTalents(area);
                break;
            case 'rewards':
                this.drawRewards(area);
                break;
            case 'collection':
                this.drawCollection(area);
                break;
            case 'achievements':
                this.drawAchievements(area);
                break;
            case 'options':
                this.drawOptions(area);
                break;
        }

        if (this.status && this.statusCycle > 0) {
            const w = Gfx.width(this.status, 'b12') + 24;
            Pix2D.fillRectTrans((W - w) >> 1, H - 70, w, 24, 0, 200);
            Gfx.centre(this.status, W >> 1, H - 53, COL.YELLOW, 'b12');
        }
    }

    // --------------------------------------------------------------------------------------------
    // Play
    // --------------------------------------------------------------------------------------------

    private drawPlay(a: Rect): void {
        const portrait = Ui.portrait || a.w < 620;
        if (!portrait) {
            const colW = Math.floor((a.w - 16) / 3);
            const classR: Rect = { x: a.x, y: a.y, w: colW, h: a.h };
            const lookR: Rect = { x: a.x + colW + 8, y: a.y, w: colW, h: a.h };
            const zoneR: Rect = { x: a.x + (colW + 8) * 2, y: a.y, w: colW, h: a.h - 56 };
            this.drawClassPicker(classR, false);
            this.drawLook(lookR);
            this.drawZones(zoneR);
            if (Ui.button({ x: zoneR.x, y: a.y + a.h - 48, w: colW, h: 44 }, 'Enter World', { tip: 'Enter' })) this.enter();
            return;
        }
        const enterH = 46;
        const content = 120 + 330 + 70 * ZONES.length + 40;
        Ui.scroll('menu', { x: a.x, y: a.y, w: a.w, h: a.h - enterH - 6 }, content, top => {
            this.drawClassPicker({ x: a.x, y: top, w: a.w - 16, h: 116 }, true);
            this.drawLook({ x: a.x, y: top + 122, w: a.w - 16, h: 324 });
            this.drawZones({ x: a.x, y: top + 452, w: a.w - 16, h: 70 * ZONES.length + 34 });
        });
        if (Ui.button({ x: a.x, y: a.y + a.h - enterH, w: a.w, h: enterH }, 'Enter World')) this.enter();
    }

    private drawClassPicker(r: Rect, row: boolean): void {
        Gfx.panel(r.x, r.y, r.w, r.h);
        Gfx.text('Choose your class', r.x + 12, r.y + 20, COL.ORANGE, 'b12');
        const ids: ClassId[] = ['melee', 'ranged', 'magic'];
        ids.forEach((id, i) => {
            const cls = CLASSES[id];
            const b: Rect = row ? { x: r.x + 10 + i * ((r.w - 20) / 3), y: r.y + 28, w: (r.w - 20) / 3 - 6, h: 40 } : { x: r.x + 10, y: r.y + 30 + i * 46, w: r.w - 20, h: 40 };
            b.x |= 0;
            b.w |= 0;
            if (Ui.button(b, '', { active: this.classId === id })) {
                this.profile.lastClass = id;
                this.previewDirty = true;
                this.save();
            }
            Gfx.icon(cls.icon[0], cls.icon[1], b.x + 8, b.y + 8);
            Gfx.text(cls.name, b.x + 38, b.y + 25, this.classId === id ? COL.WHITE : COL.ORANGE, 'b12');
        });
        const cls = CLASSES[this.classId];
        const cp = this.profile.classes[this.classId];
        const ty = row ? r.y + 82 : r.y + 176;
        Gfx.wrap(cls.blurb, r.x + 12, ty, r.w - 24, COL.WHITE, 'p11');
        if (!row) {
            Gfx.text(`Starting ability: ${cls.start.replace('_', ' ')}`, r.x + 12, ty + 30, COL.GREY, 'p11');
            Gfx.text(`Runs: ${cp.runs}   Wins: ${cp.wins}`, r.x + 12, ty + 44, COL.GREY, 'p11');
            const best = Math.round(cp.bestTicks * 0.6);
            Gfx.text(`Best time: ${Math.floor(best / 60)}:${String(best % 60).padStart(2, '0')}`, r.x + 12, ty + 58, COL.GREY, 'p11');
            const pts = talentPoints(cp.talentXp);
            Gfx.text(`Talent points: ${pts} (${spentPoints(cp)} spent)`, r.x + 12, ty + 72, COL.GREY, 'p11');
            Gfx.text('Class abilities:', r.x + 12, ty + 96, COL.ORANGE, 'p12');
            const pool = CLASS_POOLS[this.classId];
            const per = Math.max(1, Math.floor((r.w - 24) / 30));
            pool.forEach((ab, i) => {
                const ix = r.x + 12 + (i % per) * 30;
                const iy = ty + 102 + Math.floor(i / per) * 30;
                Assets.pix32('miscgraphics', ab.id === cls.start ? 7 : 0)?.plotSprite(ix - 5, iy - 5);
                Gfx.icon(ab.icon[0], ab.icon[1], ix, iy);
                if (Ui.hover({ x: ix, y: iy, w: 26, h: 26 })) Ui.tooltip = `${ab.name}: ${ab.targeting ?? ''}`;
            });
        }
    }

    private drawLook(r: Rect): void {
        Gfx.panel(r.x, r.y, r.w, r.h);
        Gfx.text('Character', r.x + 12, r.y + 20, COL.ORANGE, 'b12');
        const look = this.look;
        // gender
        const gw = 60;
        if (Ui.button({ x: r.x + r.w - gw * 2 - 14, y: r.y + 8, w: gw, h: 22 }, 'Male', { active: look.gender === 0, font: 'p11' }) && look.gender !== 0) this.setLook(defaultLook(0));
        if (Ui.button({ x: r.x + r.w - gw - 10, y: r.y + 8, w: gw, h: 22 }, 'Female', { active: look.gender === 1, font: 'p11' }) && look.gender !== 1) this.setLook(defaultLook(1));

        // preview on the left, arrows on the right
        const pvW = Math.min(110, (r.w * 0.42) | 0);
        const pv: Rect = { x: r.x + 8, y: r.y + 34, w: pvW, h: r.h - 44 };
        Gfx.inset(pv.x, pv.y, pv.w, pv.h, 120);
        Gfx.clip(pv.x, pv.y, pv.x + pv.w, pv.y + pv.h, () => this.preview.draw(pv.x + (pv.w >> 1), pv.y + pv.h - 12, Math.min(pv.h - 30, pv.w * 2)));
        if (Ui.hit(pv)) this.preview.yaw = (this.preview.yaw + 256) & 0x7ff;

        const ax = pv.x + pv.w + 6;
        const aw = r.x + r.w - 8 - ax;
        const rows = BODY_PARTS.length + COLOUR_NAMES.length;
        const rowH = Math.max(22, Math.min(26, ((r.h - 44) / rows) | 0));
        let y = r.y + 34;
        BODY_PARTS.forEach((name, part) => {
            const kits = kitsFor(part, look.gender);
            if (kits.length === 0) {
                y += 0;
                return;
            }
            const i = Math.max(0, kits.indexOf(look.body[part]));
            const d = Ui.arrows({ x: ax, y, w: aw, h: rowH - 2 }, name, `${i + 1}/${kits.length}`);
            if (d !== 0) {
                const next = { ...look, body: [...look.body] };
                next.body[part] = kits[(i + d + kits.length) % kits.length];
                this.setLook(next);
            }
            y += rowH;
        });
        COLOUR_NAMES.forEach((name, c) => {
            const d = Ui.arrows({ x: ax, y, w: aw, h: rowH - 2 }, `${name} colour`, `${look.colours[c] + 1}/${COLOUR_COUNTS[c]}`);
            if (d !== 0) {
                const next = { ...look, colours: [...look.colours] };
                next.colours[c] = (next.colours[c] + d + COLOUR_COUNTS[c]) % COLOUR_COUNTS[c];
                this.setLook(next);
            }
            y += rowH;
        });
    }

    private setLook(look: Look): void {
        this.profile.appearance = validLook(look);
        this.previewDirty = true;
        this.save();
    }

    private drawZones(r: Rect): void {
        Gfx.panel(r.x, r.y, r.w, r.h);
        Gfx.text('Choose a zone', r.x + 12, r.y + 20, COL.ORANGE, 'b12');
        const cp = this.profile.classes[this.classId];
        const zh = Math.min(70, ((r.h - 34) / ZONES.length) | 0) - 4;
        ZONES.forEach((z, i) => {
            const b: Rect = { x: r.x + 8, y: r.y + 30 + i * (zh + 4), w: r.w - 16, h: zh };
            const unlocked = cp.unlockedZones.includes(z.id);
            const sel = this.profile.lastZone === z.id;
            Gfx.inset(b.x, b.y, b.w, b.h, sel ? 60 : 130);
            if (sel) Pix2D.drawRect(b.x, b.y, b.w, b.h, COL.ORANGE);
            Gfx.text(z.name, b.x + 8, b.y + 16, unlocked ? (sel ? COL.WHITE : COL.ORANGE) : COL.DARK_GREY, 'b12');
            if (cp.zonesWon.includes(z.id)) Gfx.icon('miscgraphics', 11, b.x + b.w - 30, b.y - 4);
            if (unlocked) {
                Gfx.wrap(z.flavour, b.x + 8, b.y + 30, b.w - 16, COL.YELLOW, 'p11', 11);
            } else {
                Gfx.wrap(zoneLockText(z.id), b.x + 8, b.y + 30, b.w - 16, COL.RED, 'p11', 11);
            }
            if (Ui.hit(b)) {
                this.profile.lastZone = z.id;
                this.save();
                if (!unlocked) this.say(zoneLockText(z.id));
            }
        });
    }

    // --------------------------------------------------------------------------------------------
    // Talents
    // --------------------------------------------------------------------------------------------

    private drawTalents(a: Rect): void {
        const cls = CLASSES[this.classId];
        const cp = this.profile.classes[this.classId];
        const pts = talentPoints(cp.talentXp);
        const spent = spentPoints(cp);
        Gfx.panel(a.x, a.y, a.w, a.h);
        Gfx.text(`${cls.name} talents`, a.x + 12, a.y + 20, COL.ORANGE, 'b12');
        const next = talentXpForPoint(pts + 1);
        Gfx.text(`Points: ${pts - spent} free / ${pts} earned   XP ${Math.floor(cp.talentXp)} / ${next}`, a.x + 12, a.y + 36, COL.YELLOW, 'p12');
        if (Ui.button({ x: a.x + a.w - 112, y: a.y + 12, w: 90, h: 26 }, 'Respec', { font: 'p12', tip: 'Refund all points (free)' })) {
            respec(cp);
            this.save();
            this.say('Talents reset.');
        }
        const list: Rect = { x: a.x + 8, y: a.y + 46, w: a.w - 16, h: a.h - 54 };
        const rowH = 40;
        const content = cls.talents.length * (rowH + 4) + 5 * 18;
        Ui.scroll('menu', list, content, top => {
            let y = top;
            for (let tier = 0; tier <= 4; tier++) {
                const ts = cls.talents.filter(t => t.tier === tier);
                if (ts.length === 0) continue;
                Gfx.text(tier === 4 ? `Capstones (${tier * 5} points, choose one)` : `Tier ${tier + 1}${tier > 0 ? ` (${tier * 5} points spent)` : ''}`, list.x + 4, y + 13, spent >= tier * 5 ? COL.ORANGE : COL.DARK_GREY, 'p12');
                y += 18;
                for (const t of ts) {
                    const rank = cp.talents[t.id] ?? 0;
                    const err = canRankTalent(this.classId, cp, t.id);
                    const row: Rect = { x: list.x, y, w: list.w - 20, h: rowH };
                    Gfx.inset(row.x, row.y, row.w, row.h, rank > 0 ? 60 : 120);
                    Gfx.icon(t.icon[0], t.icon[1], row.x + 6, row.y + 7);
                    Gfx.text(`${t.name}${t.milestone ? ' (milestone)' : ''}`, row.x + 38, row.y + 15, rank > 0 ? COL.GREEN : COL.ORANGE, 'b12');
                    Gfx.text(`${rank}/${t.maxRank}`, row.x + row.w - 92, row.y + 15, COL.WHITE, 'p12');
                    Gfx.text(t.desc(Math.max(1, rank)), row.x + 38, row.y + 32, COL.YELLOW, 'p11');
                    if (Ui.button({ x: row.x + row.w - 50, y: row.y + 7, w: 42, h: 26 }, '+', { enabled: err === null, tip: err ?? 'Spend a point' })) {
                        if (rankTalent(this.classId, cp, t.id)) {
                            this.save();
                            this.previewDirty = true;
                        }
                    }
                    y += rowH + 4;
                }
            }
        });
    }

    // --------------------------------------------------------------------------------------------
    // Rewards
    // --------------------------------------------------------------------------------------------

    private drawRewards(a: Rect): void {
        const p = this.profile;
        const free = p.achievementPoints - spentAchievementPoints(p);
        Gfx.panel(a.x, a.y, a.w, a.h);
        Gfx.text('Account rewards', a.x + 12, a.y + 20, COL.ORANGE, 'b12');
        Gfx.text(`Achievement points available: ${free}`, a.x + 12, a.y + 36, COL.YELLOW, 'p12');
        let y = a.y + 48;
        for (const r of REWARDS) {
            const have = r.get(p);
            const cost = rewardCostFor(r, p);
            const row: Rect = { x: a.x + 10, y, w: a.w - 20, h: 46 };
            Gfx.inset(row.x, row.y, row.w, row.h, have > 0 ? 60 : 120);
            Gfx.text(`${r.name}  (${have}/${r.max})`, row.x + 8, row.y + 17, have > 0 ? COL.GREEN : COL.ORANGE, 'b12');
            Gfx.wrap(r.desc, row.x + 8, row.y + 33, row.w - 130, COL.YELLOW, 'p11');
            const can = have < r.max && free >= cost;
            if (Ui.button({ x: row.x + row.w - 110, y: row.y + 9, w: 100, h: 28 }, have >= r.max ? 'Owned' : `Buy ${cost}`, { enabled: can, font: 'p12' })) {
                r.buy(p);
                this.save();
                this.say(`Unlocked: ${r.name}`);
            }
            y += 52;
        }
        if (Ui.button({ x: a.x + 10, y: y + 6, w: 160, h: 28 }, 'Reset rewards', { font: 'p12', tip: 'Refund all reward points' })) {
            p.perks = { rerolls: 0, banish: 0, openingHand: false, pet: false };
            this.save();
        }
    }

    // --------------------------------------------------------------------------------------------
    // Collection (gear)
    // --------------------------------------------------------------------------------------------

    private drawCollection(a: Rect): void {
        const cls = CLASSES[this.classId];
        const cp = this.profile.classes[this.classId];
        Gfx.panel(a.x, a.y, a.w, a.h);
        Gfx.text(`${cls.name} gear - bosses drop metal-tier pieces`, a.x + 12, a.y + 20, COL.ORANGE, 'b12');
        const slotNames: Record<GearSlot, string> = { head: 'Head', body: 'Body', legs: 'Legs', weapon: 'Weapon', shield: cls.id === 'melee' ? 'Shield' : cls.id === 'ranged' ? 'Hands' : 'Feet' };
        const wornIcon: Record<GearSlot, number> = { head: 0, body: 4, legs: 7, weapon: 3, shield: cls.id === 'melee' ? 6 : cls.id === 'ranged' ? 8 : 9 };
        const cell = Math.min(42, ((a.w - 110) / 6) | 0);
        const gx = a.x + 80;
        let y = a.y + 34;
        TIER_NAMES.forEach((t, i) => Gfx.centre(t, gx + i * cell + (cell >> 1), y + 8, COL.YELLOW, 'p11'));
        y += 14;
        for (const slot of GEAR_SLOTS) {
            Gfx.text(slotNames[slot], a.x + 12, y + 24, COL.ORANGE, 'p12');
            for (let tier = 0; tier < 6; tier++) {
                const r: Rect = { x: gx + tier * cell, y, w: cell - 2, h: cell - 2 };
                const owned = (cp.gear[slot] ?? []).includes(tier);
                const eq = cp.equipped[slot] === tier;
                Gfx.inset(r.x, r.y, r.w, r.h, owned ? 60 : 160);
                if (eq) Pix2D.drawRect(r.x, r.y, r.w, r.h, COL.RED);
                if (owned) {
                    Gfx.item(Assets.game.objs[cls.gear[slot][tier]], r.x + ((r.w - 32) >> 1), r.y + ((r.h - 32) >> 1));
                } else {
                    Gfx.iconTrans('wornicons', wornIcon[slot], r.x + ((r.w - 32) >> 1), r.y + ((r.h - 32) >> 1), 60);
                }
                if (owned && Ui.hit(r)) {
                    cp.equipped[slot] = eq ? -1 : tier;
                    this.previewDirty = true;
                    this.save();
                }
                if (Ui.hover(r)) Ui.tooltip = owned ? `${TIER_NAMES[tier]} ${slotNames[slot].toLowerCase()}${eq ? ' (equipped)' : ' - click to equip'}` : 'Not collected yet';
            }
            y += cell;
        }
        // set bonus
        const tiers = GEAR_SLOTS.map(s => cp.equipped[s] ?? -1);
        const complete = tiers.every(t => t >= 0);
        y += 8;
        Gfx.text(complete ? setBonusText(this.classId, Math.min(...tiers)) : 'Equip all five slots for a set bonus (lowest tier counts).', a.x + 12, y + 12, complete ? COL.GREEN : COL.GREY, 'p12');
        Gfx.text('Each piece: weapon +3% damage per tier, armour and HP from the rest.', a.x + 12, y + 28, COL.GREY, 'p11');
        // preview
        if (a.w > 520 && a.h > 300) {
            const pv: Rect = { x: a.x + a.w - 130, y: a.y + 40, w: 120, h: Math.min(260, a.h - 50) };
            Gfx.inset(pv.x, pv.y, pv.w, pv.h, 120);
            Gfx.clip(pv.x, pv.y, pv.x + pv.w, pv.y + pv.h, () => this.preview.draw(pv.x + (pv.w >> 1), pv.y + pv.h - 12, Math.min(pv.h - 30, pv.w * 2)));
        }
    }

    // --------------------------------------------------------------------------------------------
    // Achievements
    // --------------------------------------------------------------------------------------------

    private drawAchievements(a: Rect): void {
        const p = this.profile;
        Gfx.panel(a.x, a.y, a.w, a.h);
        const done = ACHIEVEMENTS.filter(x => p.achievements[x.id] !== undefined).length;
        Gfx.text(`Achievements ${done}/${ACHIEVEMENTS.length} - ${p.achievementPoints} points`, a.x + 12, a.y + 20, COL.ORANGE, 'b12');
        const list: Rect = { x: a.x + 8, y: a.y + 30, w: a.w - 16, h: a.h - 38 };
        Ui.scroll('menu', list, ACHIEVEMENTS.length * 38, top => {
            ACHIEVEMENTS.forEach((ach, i) => {
                const got = p.achievements[ach.id] !== undefined;
                const y = top + i * 38;
                Gfx.inset(list.x, y, list.w - 20, 34, got ? 50 : 130);
                if (got) Gfx.icon('miscgraphics', 11, list.x + 2, y - 2);
                Gfx.text(ach.name, list.x + 34, y + 14, got ? COL.GREEN : COL.ORANGE, 'b12');
                Gfx.text(ach.desc, list.x + 34, y + 28, got ? COL.WHITE : COL.GREY, 'p11');
                Gfx.right(`${ach.points} pts`, list.x + list.w - 28, y + 20, COL.YELLOW, 'p12');
            });
        });
        Gfx.text(`Lifetime: ${p.stats.runs} runs, ${p.stats.kills} kills, ${p.stats.bosses} bosses, ${p.stats.wins} wins`, a.x + 12, a.y + a.h - 6, COL.GREY, 'p11');
    }

    // --------------------------------------------------------------------------------------------
    // Options
    // --------------------------------------------------------------------------------------------

    drawOptions(a: Rect): void {
        const o = this.profile.options;
        Gfx.panel(a.x, a.y, a.w, a.h);
        Gfx.text('Options', a.x + 12, a.y + 20, COL.ORANGE, 'b12');
        const two = a.w >= 520;
        const colW = two ? ((a.w - 30) / 2) | 0 : a.w - 20;
        const items: (() => void)[] = [];
        let changed = false;
        const at = (i: number): Rect => {
            const col = two ? i % 2 : 0;
            const row = two ? Math.floor(i / 2) : i;
            return { x: a.x + 10 + col * (colW + 10), y: a.y + 30 + row * 40, w: colW, h: 34 };
        };
        let i = 0;
        const slider = (label: string, v: number, set: (n: number) => void) => {
            const r = at(i++);
            const nv = Ui.slider(r, label, v);
            if (nv !== v) {
                set(nv);
                changed = true;
            }
        };
        const toggle = (label: string, v: boolean, set: (b: boolean) => void) => {
            const r = at(i++);
            if (Ui.toggle(r, label, v)) {
                set(!v);
                changed = true;
            }
        };
        slider('Camera shake', o.shake, v => (o.shake = v));
        slider('Music', o.music, v => (o.music = v));
        toggle('Boss intro camera pan', o.bossIntro, v => (o.bossIntro = v));
        toggle('Auto-frame bosses', o.autoFrame, v => (o.autoFrame = v));
        toggle('Camera lead', o.cameraLead, v => (o.cameraLead = v));
        toggle('Hide roofs', o.hideRoofs, v => (o.hideRoofs = v));
        toggle('FPS / entity / tick overlay (F)', o.showFps, v => (o.showFps = v));
        const quick = o.bossTimes[0] < 3;
        toggle('Quick boss schedule (testing)', quick, v => (o.bossTimes = v ? [1, 2, 3, 4, 5] : [3, 6, 9, 12, 16]));
        void items;
        if (changed) {
            this.save();
            this.host.onOptionsChanged();
        }
        const y = at(i + (two ? 1 : 0)).y + 6;
        const bw = Math.min(150, ((a.w - 40) / 3) | 0);
        if (Ui.button({ x: a.x + 10, y, w: bw, h: 30 }, 'Export save', { font: 'p12' })) Save.exportFile();
        if (Ui.button({ x: a.x + 20 + bw, y, w: bw, h: 30 }, 'Import save', { font: 'p12' })) {
            void Save.importFile().then(err => {
                this.say(err ?? 'Save imported.');
                this.previewDirty = true;
                this.host.onOptionsChanged();
            });
        }
        if (Ui.button({ x: a.x + 30 + bw * 2, y, w: bw, h: 30 }, 'Debug: max talents', { font: 'p11', tip: 'Gives this class max talent XP (for testing)' })) {
            this.profile.classes[this.classId].talentXp = talentXpForPoint(30);
            this.save();
            this.say('Talent XP maxed for this class.');
        }
        Gfx.text(Save.available ? 'Progress saves automatically in this browser.' : 'Storage unavailable (private mode?) - progress will not persist.', a.x + 12, y + 50, COL.GREY, 'p11');
    }

    rotatePreview(dx: number): void {
        this.dragYaw += dx * 4;
    }

    zone(): string {
        return ZONE_BY_ID[this.profile.lastZone] ? this.profile.lastZone : ZONES[0].id;
    }
}
