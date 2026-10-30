// Immediate-mode UI over the client's own Pix2D drawing. Widgets draw in 2004 RS style (Gfx) and
// report clicks; mouse and touch both arrive as logical-pixel taps from SurvivorsClient.
import Pix2D from '#/graphics/Pix2D.js';

import Gfx, { COL, type FontName } from '#/survivors/ui/Gfx.js';

export type Rect = { x: number; y: number; w: number; h: number };

type Scroll = { offset: number; content: number; view: number };

export default class Ui {
    static W = 765;
    static H = 503;
    static mouseX = -1;
    static mouseY = -1;
    static touch = false;

    // a tap/click waiting to be consumed by the first widget under it this frame
    private static click: { x: number; y: number } | null = null;
    private static consumed = false;
    static wheel = 0;
    static dragDY = 0;
    private static scrolls = new Map<string, Scroll>();
    static tooltip: string | null = null;

    static get portrait(): boolean {
        return this.H > this.W;
    }

    static beginFrame(): void {
        this.tooltip = null;
    }

    // returns the click if nobody consumed it (it then becomes a world click)
    static endFrame(): { x: number; y: number } | null {
        const c = this.consumed ? null : this.click;
        this.click = null;
        this.consumed = false;
        this.wheel = 0;
        this.dragDY = 0;
        return c;
    }

    static pushClick(x: number, y: number): void {
        this.click = { x, y };
        this.consumed = false;
    }

    static hasClick(): boolean {
        return this.click !== null && !this.consumed;
    }

    static inside(r: Rect, x: number, y: number): boolean {
        return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
    }

    static hover(r: Rect): boolean {
        return !this.touch && this.inside(r, this.mouseX, this.mouseY);
    }

    // consume a click inside r
    static hit(r: Rect): boolean {
        if (this.click && !this.consumed && this.inside(r, this.click.x, this.click.y)) {
            this.consumed = true;
            return true;
        }
        return false;
    }

    // block clicks inside r from reaching anything drawn later / the world (modal panels)
    static block(r: Rect): void {
        if (this.click && !this.consumed && this.inside(r, this.click.x, this.click.y)) {
            this.consumed = true;
        }
    }

    static button(r: Rect, label: string, opts: { active?: boolean; enabled?: boolean; font?: FontName; tip?: string } = {}): boolean {
        const enabled = opts.enabled ?? true;
        const hover = this.hover(r);
        Gfx.button(r.x, r.y, r.w, r.h, label, opts.active ?? false, hover && enabled, opts.font ?? (r.h >= 30 ? 'b12' : 'p12'), enabled);
        if (hover && opts.tip) this.tooltip = opts.tip;
        const clicked = this.hit(r);
        return clicked && enabled;
    }

    static iconButton(r: Rect, sheet: string, index: number, opts: { active?: boolean; tip?: string } = {}): boolean {
        const hover = this.hover(r);
        Gfx.button(r.x, r.y, r.w, r.h, '', opts.active ?? false, hover, 'p12');
        Gfx.icon(sheet, index, r.x + ((r.w - 25) >> 1), r.y + ((r.h - 25) >> 1));
        if (hover && opts.tip) this.tooltip = opts.tip;
        return this.hit(r);
    }

    static arrows(r: Rect, label: string, value: string): -1 | 0 | 1 {
        const left: Rect = { x: r.x, y: r.y, w: 22, h: r.h };
        const right: Rect = { x: r.x + r.w - 22, y: r.y, w: 22, h: r.h };
        const l = this.button(left, '<', { font: 'b12' });
        const rr = this.button(right, '>', { font: 'b12' });
        Gfx.centre(label, r.x + (r.w >> 1), r.y + (r.h >> 1) - 1, COL.ORANGE, 'p11');
        Gfx.centre(value, r.x + (r.w >> 1), r.y + (r.h >> 1) + 10, COL.WHITE, 'p11');
        return l ? -1 : rr ? 1 : 0;
    }

    static toggle(r: Rect, label: string, on: boolean): boolean {
        Gfx.inset(r.x, r.y, r.w, r.h, 90);
        Gfx.text(label, r.x + 8, r.y + (r.h >> 1) + 5, COL.ORANGE, 'p12');
        const box: Rect = { x: r.x + r.w - 26, y: r.y + ((r.h - 20) >> 1), w: 20, h: 20 };
        Pix2D.fillRect(box.x, box.y, box.w, box.h, 0x2a241d);
        Pix2D.drawRect(box.x, box.y, box.w, box.h, COL.BROWN_LIGHT);
        if (on) Gfx.icon('miscgraphics', 11, box.x + 3, box.y + 2);
        return this.hit(r);
    }

    // slider 0..100; returns the new value
    static slider(r: Rect, label: string, value: number): number {
        Gfx.inset(r.x, r.y, r.w, r.h, 90);
        Gfx.text(`${label}: ${value === 0 ? 'Off' : value + '%'}`, r.x + 8, r.y + 14, COL.ORANGE, 'p12');
        const track: Rect = { x: r.x + 8, y: r.y + r.h - 14, w: r.w - 16, h: 8 };
        Pix2D.fillRect(track.x, track.y, track.w, track.h, COL.BROWN_DARK);
        const fx = track.x + ((track.w * value) / 100) | 0;
        Pix2D.fillRect(track.x, track.y, fx - track.x, track.h, 0x8c1111);
        Pix2D.fillRect(fx - 3, track.y - 3, 6, track.h + 6, COL.BROWN_LIGHT);
        const hitArea: Rect = { x: track.x - 6, y: r.y, w: track.w + 12, h: r.h };
        if (this.click && !this.consumed && this.inside(hitArea, this.click.x, this.click.y)) {
            this.consumed = true;
            const v = Math.round(((this.click.x - track.x) / track.w) * 10) * 10;
            return Math.max(0, Math.min(100, v));
        }
        return value;
    }

    // scrollable region: draw(contentY) draws content at y offset; returns nothing
    static scroll(id: string, r: Rect, contentHeight: number, draw: (top: number) => void): void {
        let s = this.scrolls.get(id);
        if (!s) {
            s = { offset: 0, content: contentHeight, view: r.h };
            this.scrolls.set(id, s);
        }
        s.content = contentHeight;
        s.view = r.h;
        const max = Math.max(0, contentHeight - r.h);
        const over = this.inside(r, this.mouseX, this.mouseY);
        if (over && this.wheel !== 0) {
            s.offset += this.wheel > 0 ? 40 : -40;
            this.wheel = 0;
        }
        if (over && this.dragDY !== 0) {
            s.offset -= this.dragDY;
            this.dragDY = 0;
        }
        s.offset = Math.max(0, Math.min(max, s.offset));
        // clicks outside the visible region must not hit hidden content
        const clickOutside = this.click && !this.consumed && !this.inside(r, this.click.x, this.click.y);
        const saved = clickOutside ? this.click : null;
        if (clickOutside) this.click = null;
        Gfx.clip(r.x, r.y, r.x + r.w - (max > 0 ? 16 : 0), r.y + r.h, () => draw(r.y - s!.offset));
        if (saved) this.click = saved;
        if (max > 0) {
            Gfx.scrollbar(r.x + r.w - 16, r.y, s.offset, contentHeight, r.h);
            const up: Rect = { x: r.x + r.w - 16, y: r.y, w: 16, h: 16 };
            const down: Rect = { x: r.x + r.w - 16, y: r.y + r.h - 16, w: 16, h: 16 };
            if (this.hit(up)) s.offset = Math.max(0, s.offset - 60);
            if (this.hit(down)) s.offset = Math.min(max, s.offset + 60);
            this.block({ x: r.x + r.w - 16, y: r.y, w: 16, h: r.h });
        }
    }

    static resetScroll(id: string): void {
        this.scrolls.delete(id);
    }

    static drawTooltip(): void {
        if (!this.tooltip) return;
        const w = Gfx.width(this.tooltip, 'p12') + 8;
        let x = this.mouseX + 12;
        let y = this.mouseY + 16;
        if (x + w > this.W) x = this.W - w - 2;
        if (y + 18 > this.H) y = this.mouseY - 20;
        Pix2D.fillRect(x, y, w, 18, 0xffffa0);
        Pix2D.drawRect(x, y, w, 18, 0x000000);
        Gfx.text(this.tooltip, x + 4, y + 13, 0x000000, 'p12', false);
    }
}
