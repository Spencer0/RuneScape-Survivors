// 2004-style interface drawing helpers. Everything is drawn with the client's own Pix2D / PixFont
// and sprites from the cache's media + title archives (invback stone, steelborder frames,
// combatboxes buttons, scrollbar arrows, staticons...). No HTML/CSS UI anywhere.
import ObjType from '#/config/ObjType.js';
import Pix2D from '#/graphics/Pix2D.js';
import type Pix32 from '#/graphics/Pix32.js';
import type Pix8 from '#/graphics/Pix8.js';
import type PixFont from '#/graphics/PixFont.js';

import Assets from '#/survivors/Assets.js';

export const COL = {
    YELLOW: 0xffff00,
    ORANGE: 0xff981f, // interface title orange
    WHITE: 0xffffff,
    BLACK: 0x000000,
    RED: 0xff0000,
    GREEN: 0x00ff00,
    CYAN: 0x00ffff,
    GREY: 0x9f9f9f,
    DARK_GREY: 0x5f5f5f,
    LIME: 0x80ff80,
    BROWN_DARK: 0x23201b, // SCROLLBAR_TRACK
    BROWN: 0x4d4233, // SCROLLBAR_GRIP_FOREGROUND
    BROWN_LIGHT: 0x766654, // SCROLLBAR_GRIP_HIGHLIGHT
    BROWN_LOW: 0x332d25, // SCROLLBAR_GRIP_LOWLIGHT
    STONE_EDGE: 0x3e3529,
    STONE_HI: 0x564c3e
};

// Card rarity colours follow RS conventions: white, green, light blue, purple, orange
export const RARITY_COLOURS = [0xffffff, 0x1eff00, 0x0070dd, 0xa335ee, 0xff8000];
export const RARITY_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];

export type FontName = 'p11' | 'p12' | 'b12' | 'q8';

export default class Gfx {
    static font(name: FontName = 'p12'): PixFont {
        return Assets.fonts[name];
    }

    static text(str: string, x: number, y: number, rgb: number = COL.YELLOW, font: FontName = 'p12', shadow: boolean = true): void {
        this.font(font).drawStringTag(str, x, y, rgb, shadow);
    }

    static centre(str: string, x: number, y: number, rgb: number = COL.YELLOW, font: FontName = 'p12', shadow: boolean = true): void {
        this.font(font).centreStringTag(str, x, y, rgb, shadow);
    }

    static right(str: string, x: number, y: number, rgb: number = COL.YELLOW, font: FontName = 'p12', shadow: boolean = true): void {
        this.font(font).drawStringRight(str, x, y, rgb, shadow);
    }

    static width(str: string, font: FontName = 'p12'): number {
        return this.font(font).stringWid(str);
    }

    // splits str into lines no wider than maxWidth
    static lines(str: string, maxWidth: number, font: FontName = 'p11'): string[] {
        const words = str.split(' ');
        let line = '';
        const lines: string[] = [];
        for (const w of words) {
            const test = line.length > 0 ? `${line} ${w}` : w;
            if (this.width(test.replace(/@...@/g, ''), font) > maxWidth && line.length > 0) {
                lines.push(line);
                line = w;
            } else {
                line = test;
            }
        }
        if (line.length > 0) {
            lines.push(line);
        }
        return lines;
    }

    // word-wrapped text, returns the y after the last line
    static wrap(str: string, x: number, y: number, maxWidth: number, rgb: number = COL.YELLOW, font: FontName = 'p11', lineHeight: number = 12, centred: boolean = false): number {
        for (const l of this.lines(str, maxWidth, font)) {
            if (centred) {
                this.centre(l, x + ((maxWidth / 2) | 0), y, rgb, font);
            } else {
                this.text(l, x, y, rgb, font);
            }
            y += lineHeight;
        }
        return y;
    }

    // Tiles the inventory stone texture (invback) over a rectangle
    static stone(x: number, y: number, w: number, h: number): void {
        const tex: Pix8 | null = Assets.pix8('invback');
        if (!tex) {
            Pix2D.fillRect(x, y, w, h, 0x3e3529);
            return;
        }
        this.clip(x, y, x + w, y + h, () => {
            // skip the dark rim of the texture so tiles join seamlessly
            const tw = tex.wi - 16;
            const th = tex.hi - 16;
            for (let ty = y - 8; ty < y + h; ty += th) {
                for (let tx = x - 8; tx < x + w; tx += tw) {
                    tex.plotSprite(tx, ty);
                }
            }
        });
    }

    // A stone panel with the steel border frame used around 2004 interfaces
    static panel(x: number, y: number, w: number, h: number, title?: string): void {
        this.stone(x, y, w, h);
        this.steelFrame(x, y, w, h);
        if (title) {
            this.centre(title, x + ((w / 2) | 0), y + 22, COL.ORANGE, 'b12');
        }
    }

    // Recessed dark box (like interface inner rects)
    static inset(x: number, y: number, w: number, h: number, alpha: number = 140): void {
        Pix2D.fillRectTrans(x, y, w, h, 0x000000, alpha);
        Pix2D.hline(x, y, w, COL.BROWN_LOW);
        Pix2D.vline(x, y, h, COL.BROWN_LOW);
        Pix2D.hline(x, y + h - 1, w, COL.BROWN_LIGHT);
        Pix2D.vline(x + w - 1, y, h, COL.BROWN_LIGHT);
    }

    // thin 2px brown bevel used around HUD boxes (like the chatbox / minimap edges)
    static steelFrameThin(x: number, y: number, w: number, h: number): void {
        Pix2D.drawRect(x, y, w, h, 0x000000);
        Pix2D.hline(x + 1, y + 1, w - 2, COL.BROWN_LIGHT);
        Pix2D.vline(x + 1, y + 1, h - 2, COL.BROWN_LIGHT);
        Pix2D.hline(x + 1, y + h - 2, w - 2, COL.BROWN_LOW);
        Pix2D.vline(x + w - 2, y + 1, h - 2, COL.BROWN_LOW);
    }

    static steelFrame(x: number, y: number, w: number, h: number): void {
        const corners: (Pix32 | null)[] = [0, 1, 2, 3].map(i => Assets.pix32('steelborder', i));
        const hedge = Assets.pix32('steelborder2', 0);
        const vedge = Assets.pix32('steelborder2', 1);
        if (!corners[0] || !hedge || !vedge) {
            Pix2D.drawRect(x, y, w, h, COL.BROWN_LOW);
            return;
        }
        const cw = 25;
        const ch = 30;
        // edges
        this.clip(x + cw, y, x + w - cw, y + h, () => {
            for (let tx = x + cw; tx < x + w - cw; tx += 36) {
                // the edge sprites carry a 15px offset; cancel it so the bars sit flush with the corners
                hedge.plotSprite(tx, y - hedge.yof);
                hedge.plotSprite(tx, y + h - hedge.hi - hedge.yof);
            }
        });
        this.clip(x, y + ch, x + w, y + h - ch, () => {
            for (let ty = y + ch; ty < y + h - ch; ty += 36) {
                vedge.plotSprite(x - vedge.xof, ty);
                vedge.plotSprite(x + w - vedge.wi - vedge.xof, ty);
            }
        });
        corners[0]?.plotSprite(x, y);
        corners[1]?.plotSprite(x + w - cw, y);
        corners[2]?.plotSprite(x, y + h - ch);
        corners[3]?.plotSprite(x + w - cw, y + h - ch);
    }

    // Stone button from combatboxes (grey = normal, red = selected/hovered), stretched horizontally
    // by 3-slicing the sprite.
    static button(x: number, y: number, w: number, h: number, label: string, active: boolean, hover: boolean, font: FontName = 'b12', enabled: boolean = true): void {
        const small = h <= 26;
        const sprite = Assets.pix32('combatboxes', (small ? 2 : 0) + (active ? 1 : 0));
        if (sprite) {
            const sw = sprite.wi;
            const sh = sprite.hi;
            const edge = 12;
            // plotSprite adds the sprite's trim offset; cancel it so the box fills the rect exactly
            const ox = sprite.xof;
            const yOff = y + (((h - sh) / 2) | 0) - sprite.yof;
            this.clip(x, y, x + edge, y + h, () => sprite.plotSprite(x - ox, yOff));
            this.clip(x + w - edge, y, x + w, y + h, () => sprite.plotSprite(x + w - sw - ox, yOff));
            // middle: repeat only the sprite's interior columns so no inner border shows through
            const inner = sw - edge * 2;
            for (let tx = x + edge; tx < x + w - edge; tx += inner) {
                const end = Math.min(tx + inner, x + w - edge);
                this.clip(tx, y, end, y + h, () => sprite.plotSprite(tx - edge - ox, yOff));
            }
        } else {
            Pix2D.fillRect(x, y, w, h, active ? 0x7a1f12 : 0x5a5246);
        }
        if (hover && !active) {
            Pix2D.fillRectTrans(x + 3, y + 3, w - 6, h - 6, 0xffffff, 24);
        }
        const colour = !enabled ? COL.DARK_GREY : hover ? COL.WHITE : COL.ORANGE;
        this.centre(label, x + ((w / 2) | 0), y + ((h / 2) | 0) + 5, colour, font);
    }

    static icon(sheet: string, index: number, x: number, y: number): void {
        Assets.pix32(sheet, index)?.plotSprite(x, y);
    }

    static iconTrans(sheet: string, index: number, x: number, y: number, alpha: number): void {
        Assets.pix32(sheet, index)?.transPlotSprite(x, y, alpha);
    }

    static item(obj: number, x: number, y: number, count: number = 1): void {
        try {
            ObjType.getSprite(obj, count, 0)?.plotSprite(x, y);
        } catch (_e) {
            // ignore missing models
        }
    }

    static clip(x1: number, y1: number, x2: number, y2: number, fn: () => void): void {
        const oldMinX = Pix2D.clipMinX;
        const oldMinY = Pix2D.clipMinY;
        const oldMaxX = Pix2D.clipMaxX;
        const oldMaxY = Pix2D.clipMaxY;
        Pix2D.setClipping(Math.max(x1, oldMinX), Math.max(y1, oldMinY), Math.min(x2, oldMaxX), Math.min(y2, oldMaxY));
        try {
            fn();
        } finally {
            Pix2D.setClipping(oldMinX, oldMinY, oldMaxX, oldMaxY);
        }
    }

    // RS scrollbar (Client.drawScrollbar) with the cache's up/down arrow sprites
    static scrollbar(x: number, y: number, scrollY: number, scrollHeight: number, height: number): void {
        Assets.pix8('scrollbar', 0)?.plotSprite(x, y);
        Assets.pix8('scrollbar', 1)?.plotSprite(x, y + height - 16);
        Pix2D.fillRect(x, y + 16, 16, height - 32, COL.BROWN_DARK);

        let gripSize = (((height - 32) * height) / Math.max(1, scrollHeight)) | 0;
        if (gripSize < 8) {
            gripSize = 8;
        }
        const gripY = (((height - 32 - gripSize) * scrollY) / Math.max(1, scrollHeight - height)) | 0;
        Pix2D.fillRect(x, y + gripY + 16, 16, gripSize, COL.BROWN);
        Pix2D.vline(x, y + gripY + 16, gripSize, COL.BROWN_LIGHT);
        Pix2D.vline(x + 1, y + gripY + 16, gripSize, COL.BROWN_LIGHT);
        Pix2D.hline(x, y + gripY + 16, 16, COL.BROWN_LIGHT);
        Pix2D.hline(x, y + gripY + 17, 16, COL.BROWN_LIGHT);
        Pix2D.vline(x + 15, y + gripY + 16, gripSize, COL.BROWN_LOW);
        Pix2D.vline(x + 14, y + gripY + 17, gripSize - 1, COL.BROWN_LOW);
        Pix2D.hline(x, y + gripY + gripSize + 15, 16, COL.BROWN_LOW);
        Pix2D.hline(x + 1, y + gripY + gripSize + 14, 15, COL.BROWN_LOW);
    }

    // horizontal bar like the RS XP/HP bars drawn by interfaces
    static bar(x: number, y: number, w: number, h: number, frac: number, fg: number, bg: number): void {
        const f = Math.max(0, Math.min(1, frac));
        const fw = (w * f) | 0;
        Pix2D.fillRect(x, y, fw, h, fg);
        Pix2D.fillRect(x + fw, y, w - fw, h, bg);
        Pix2D.drawRect(x - 1, y - 1, w + 2, h + 2, 0x000000);
    }
}
