// End-of-run results: time, kills, coins, bosses, run level, abilities and ranks, sets, talent XP.
import Pix2D from '#/graphics/Pix2D.js';

import { CLASSES, TIER_NAMES } from '../../../../sim/src/content/classes.js';
import { ZONE_BY_ID } from '../../../../sim/src/content/zones.js';
import type { RunApplied } from '../../../../sim/src/meta.js';
import type { RunResults } from '../../../../sim/src/protocol.js';
import type { ClassId } from '../../../../sim/src/types.js';

import Assets from '#/survivors/Assets.js';
import Gfx, { COL } from '#/survivors/ui/Gfx.js';
import Ui, { type Rect } from '#/survivors/ui/Ui.js';

export default class ResultsScreen {
    results: RunResults | null = null;
    applied: RunApplied | null = null;

    constructor(private readonly onContinue: () => void) {}

    show(results: RunResults, applied: RunApplied): void {
        this.results = results;
        this.applied = applied;
        Ui.resetScroll('results');
    }

    key(key: number): void {
        if (key === 10 || key === 13 || key === 27) this.onContinue();
    }

    draw(): void {
        const r = this.results;
        const ap = this.applied;
        if (!r || !ap) return;
        const W = Ui.W;
        const H = Ui.H;
        Gfx.stone(0, 0, W, H);
        const pw = Math.min(W - 12, 700);
        const px = (W - pw) >> 1;
        const ph = H - 12;
        Gfx.panel(px, 6, pw, ph);
        const zone = ZONE_BY_ID[r.zoneId];
        Gfx.centre(r.won ? `${zone.name} cleared!` : 'Oh dear, you are dead!', W >> 1, 42, r.won ? COL.GREEN : COL.RED, 'q8');
        Gfx.centre(`${CLASSES[r.classId as ClassId].name} - ${zone.name}${r.endless ? ' (endless)' : ''}`, W >> 1, 58, COL.ORANGE, 'p12');

        const listTop = 66;
        const btnH = 40;
        const area: Rect = { x: px + 22, y: listTop, w: pw - 44, h: ph - listTop - btnH - 10 };
        const two = area.w >= 520;
        const secs = Math.round(r.ticksSurvived * 0.6);
        const stats: [string, string][] = [
            ['Time survived', `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`],
            ['Kills', `${r.kills}`],
            ['Coins', `${r.coins}`],
            ['Run level', `${r.level}`],
            ['Bosses killed', `${r.bossesKilled.length}`],
            ['Guardians / caches', `${r.guardiansKilled} / ${r.cachesOpened}`],
            ['Damage taken', `${r.damageTaken} (${r.telegraphDamage} from telegraphs)`],
            ['Most enemies at once', `${r.maxAlive}`],
            ['Talent XP earned', `+${ap.talentXp}`]
        ];
        const leftLines = stats.length * 16 + 20 + r.bossesKilled.length * 14;
        const rightLines = 20 + r.abilities.length * 14 + 20 + r.sets.length * 14 + 20 + ap.newAchievements.length * 14 + ap.gear.length * 14 + 40;
        const content = two ? Math.max(leftLines, rightLines) : leftLines + rightLines;

        Ui.scroll('results', area, content, top => {
            const colW = two ? ((area.w - 30) / 2) | 0 : area.w - 20;
            let y = top + 14;
            const lx = area.x + 4;
            for (const [k, v] of stats) {
                Gfx.text(k, lx, y, COL.ORANGE, 'p12');
                Gfx.right(v, lx + colW, y, COL.WHITE, 'p12');
                y += 16;
            }
            y += 6;
            if (r.bossesKilled.length > 0) {
                Gfx.text('Bosses defeated:', lx, y, COL.ORANGE, 'p12');
                y += 14;
                for (const b of r.bossesKilled) {
                    const def = zone.bosses.find(x => x.id === b);
                    Gfx.text(`- ${def?.name ?? b}`, lx + 8, y, COL.GREEN, 'p11');
                    y += 14;
                }
            }

            let ry = two ? top + 14 : y + 10;
            const rx = two ? area.x + colW + 24 : lx;
            Gfx.text('Abilities & ranks', rx, ry, COL.ORANGE, 'b12');
            ry += 16;
            for (const a of r.abilities) {
                Gfx.text(`${a.name}`, rx + 4, ry, COL.WHITE, 'p11');
                Gfx.right(`rank ${a.rank}`, rx + colW, ry, COL.YELLOW, 'p11');
                ry += 14;
            }
            ry += 6;
            Gfx.text('Set bonuses', rx, ry, COL.ORANGE, 'b12');
            ry += 16;
            if (r.sets.length === 0) {
                Gfx.text('None this run', rx + 4, ry, COL.GREY, 'p11');
                ry += 14;
            }
            for (const s of r.sets) {
                Gfx.text(s.name, rx + 4, ry, COL.GREEN, 'p11');
                ry += 14;
            }
            if (ap.unlockedZone) {
                ry += 6;
                Gfx.text(`Zone unlocked for ${CLASSES[r.classId as ClassId].name}: ${ZONE_BY_ID[ap.unlockedZone].name}!`, rx, ry, COL.GREEN, 'b12');
                ry += 16;
            }
            if (ap.gear.length > 0) {
                ry += 6;
                Gfx.text('Gear found', rx, ry, COL.ORANGE, 'b12');
                ry += 16;
                for (const g of ap.gear) {
                    const name = CLASSES[r.classId as ClassId].gear[g.slot as 'head'][g.tier];
                    Gfx.text(`${TIER_NAMES[g.tier]} ${g.slot}${g.isNew ? ' (new!)' : ''}`, rx + 4, ry, g.isNew ? COL.GREEN : COL.GREY, 'p11');
                    void name;
                    ry += 14;
                }
            }
            if (ap.newAchievements.length > 0) {
                ry += 6;
                Gfx.text('Achievements unlocked', rx, ry, COL.ORANGE, 'b12');
                ry += 16;
                for (const a of ap.newAchievements) {
                    Gfx.text(`${a.name} (+${a.points} pts)`, rx + 4, ry, COL.GREEN, 'p11');
                    ry += 14;
                }
            }
        });

        if (Ui.button({ x: px + 22, y: 6 + ph - btnH - 14, w: pw - 44, h: btnH }, 'Continue')) this.onContinue();
        void Pix2D;
        void Assets;
    }
}
