// Gielinor Survivors client shell. Extends the Lost City GameShell (same 50 Hz logic loop, key
// handling and canvas) but replaces login/title/chat/sidebar with the survivors screens, and the
// server connection with an in-page simulation worker (SimBridge).
//
// The frame is a "logical" resolution derived from the window: 503 px tall in landscape (like the
// 765x503 applet), 480 px wide in portrait, then scaled to fill the window with pixelated filtering,
// so the 2004 software renderer and UI work on any screen size and orientation.
import GameShell from '#/client/GameShell.js';
import { Cycle } from '#/client/Cycle.js';

import NpcType from '#/config/NpcType.js';
import Pix3D from '#/dash3d/Pix3D.js';
import World from '#/dash3d/World.js';
import Pix2D from '#/graphics/Pix2D.js';
import PixMap from '#/graphics/PixMap.js';
import { canvas, canvas2d } from '#/graphics/Canvas.js';

import type { ArenaData } from '../../../sim/src/content/arenas.js';
import { ZONE_BY_ID } from '../../../sim/src/content/zones.js';
import { applyRun, talentXpForPoint } from '../../../sim/src/meta.js';
import type { RunResults } from '../../../sim/src/protocol.js';
import type { ClassId, RunLoadout } from '../../../sim/src/types.js';

import { validLook } from '#/survivors/Appearance.js';
import Assets from '#/survivors/Assets.js';
import Camera from '#/survivors/Camera.js';
import Entities from '#/survivors/Entities.js';
import Music from '#/survivors/Music.js';
import Save from '#/survivors/Save.js';
import Scene from '#/survivors/Scene.js';
import MenuScreen from '#/survivors/screens/MenuScreen.js';
import ResultsScreen from '#/survivors/screens/ResultsScreen.js';
import RunScreen from '#/survivors/screens/RunScreen.js';
import Gfx, { COL } from '#/survivors/ui/Gfx.js';
import Ui from '#/survivors/ui/Ui.js';

type State = 'loading' | 'menu' | 'run' | 'results';

type Pointer = { id: number; x: number; y: number; sx: number; sy: number; t: number; type: string; moved: boolean };

export default class SurvivorsClient extends GameShell {
    db: unknown = null;
    ingame = false;

    frame: PixMap | null = null;
    readonly scene = new Scene();
    readonly entities = new Entities(this.scene);
    readonly camera = new Camera();
    private screen: State = 'loading';
    private loadMessage = 'Loading...';
    private loadPercent = 0;
    private loadError: string | null = null;
    private readonly arenas = new Map<string, ArenaData>();

    private readonly menu: MenuScreen;
    private readonly runScreen: RunScreen;
    private readonly results: ResultsScreen;
    private optionsOverlay = false;

    private readonly pointers = new Map<number, Pointer>();
    private middleDrag: { x: number; y: number } | null = null;
    private pinch: { dist: number; cx: number; cy: number } | null = null;
    private params = new URLSearchParams(window.location.search);

    constructor() {
        super(false);
        this.menu = new MenuScreen({ startRun: () => void this.startRun(), onOptionsChanged: () => this.optionsChanged() });
        this.runScreen = new RunScreen({
            scene: this.scene,
            entities: this.entities,
            camera: this.camera,
            keyHeld: this.keyHeld,
            get fps() {
                return client.fps;
            },
            get options() {
                return Save.profile.options;
            },
            onRunOver: r => this.runOver(r),
            openOptions: () => (this.optionsOverlay = true)
        });
        this.results = new ResultsScreen(() => this.toMenu());
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const client = this;
        (window as unknown as { gs: SurvivorsClient }).gs = this;

        canvas.style.touchAction = 'none';
        this.applyLogicalSize();
        window.addEventListener('resize', () => this.applyLogicalSize());
        canvas.addEventListener('wheel', e => this.onWheel(e), { passive: false });
        document.addEventListener('visibilitychange', () => this.setBlurred(document.hidden));
        window.addEventListener('blur', () => this.setBlurred(true));
        this.run();
    }

    get fpsValue(): number {
        return this.fps;
    }

    // ---------------------------------------------------------------------------------------------
    // screen size
    // ---------------------------------------------------------------------------------------------

    private applyLogicalSize(): void {
        const vw = Math.max(200, window.innerWidth);
        const vh = Math.max(200, window.innerHeight);
        let w: number;
        let h: number;
        if (vw >= vh) {
            h = 503;
            w = Math.round((503 * vw) / vh);
            if (w < 640) {
                // squarer than 4:3 - keep at least 640 wide
                w = 640;
                h = Math.round((640 * vh) / vw);
            }
            if (w > 1200) {
                w = 1200;
                h = Math.round((1200 * vh) / vw);
            }
        } else {
            w = 480;
            h = Math.round((480 * vh) / vw);
            if (h > 1040) {
                h = 1040;
                w = Math.round((1040 * vw) / vh);
            }
        }
        if (this.frame && canvas.width === w && canvas.height === h) return;
        this.resize(w, h);
        canvas.style.width = `${vw}px`;
        canvas.style.height = `${vh}px`;
        Ui.W = w;
        Ui.H = h;
        this.frame = new PixMap(w, h);
    }

    // ---------------------------------------------------------------------------------------------
    // lifecycle
    // ---------------------------------------------------------------------------------------------

    protected override async maininit(): Promise<void> {
        try {
            await Assets.load('data', this, async (msg, pct) => {
                this.loadMessage = msg;
                this.loadPercent = pct;
                this.drawLoading();
                await new Promise(r => setTimeout(r, 0));
            });
            await Save.load();

            NpcType.animCacheEnabled = true;
            World.drawRadius = 64;
            World.dynamicVis = true;
            World.farClip = 16000;

            // preload the arena data (small) so Enter World is instant
            await Promise.all(Object.values(ZONE_BY_ID).map(z => this.loadArena(z.arena)));
            this.screen = 'menu';
            canvas.focus();
            Music.play(Assets.game.midis['scape main'] ?? 0, Save.profile.options.music);

            if (this.params.get('autostart')) {
                const cls = this.params.get('class') as ClassId | null;
                if (cls && ['melee', 'ranged', 'magic'].includes(cls)) Save.profile.lastClass = cls;
                const zone = this.params.get('zone');
                if (zone && ZONE_BY_ID[zone]) Save.profile.lastZone = zone;
                await this.startRun();
            }
        } catch (e) {
            console.error(e);
            this.loadError = e instanceof Error ? e.message : String(e);
        }
    }

    private async loadArena(id: string): Promise<ArenaData> {
        let a = this.arenas.get(id);
        if (!a) {
            a = (await (await fetch(`data/arenas/${id}.json`)).json()) as ArenaData;
            this.arenas.set(id, a);
        }
        return a;
    }

    async startRun(): Promise<void> {
        const p = Save.profile;
        const classId = p.lastClass;
        const zoneId = this.menu.zone();
        const cp = p.classes[classId];
        const zone = ZONE_BY_ID[zoneId];
        const debugMax = this.params.get('debugmax') === '1';
        if (!cp.unlockedZones.includes(zoneId) && !debugMax) return;
        const arena = await this.loadArena(zone.arena);
        const seedParam = this.params.get('seed');
        const loadout: RunLoadout = {
            classId,
            zoneId,
            seed: seedParam ? parseInt(seedParam, 10) : (Date.now() ^ (Math.random() * 0x7fffffff)) & 0x7fffffff,
            talents: { ...cp.talents },
            capstone: cp.capstone,
            gear: { ...cp.equipped },
            perks: { ...p.perks },
            appearance: [],
            bossTimes: (this.params.get('bossat') ? this.params.get('bossat')!.split(',').map(Number) : p.options.bossTimes).map(m => Math.round(m * 100)),
            debugMaxTalents: debugMax,
            debugHorde: this.params.get('horde') ? parseInt(this.params.get('horde')!, 10) : undefined
        };
        this.optionsOverlay = false;
        this.screen = 'run';
        this.ingame = true;
        await this.runScreen.start(arena, loadout, validLook(p.appearance));
    }

    private runOver(r: RunResults): void {
        this.runScreen.stop();
        const applied = applyRun(Save.profile, r);
        void Save.write();
        this.results.show(r, applied);
        this.screen = 'results';
        this.ingame = false;
        Music.play(Assets.game.midis['scape main'] ?? 0, Save.profile.options.music);
    }

    private toMenu(): void {
        this.screen = 'menu';
        this.menu.tab = 'play';
    }

    private optionsChanged(): void {
        Music.setVolume(Save.profile.options.music);
    }

    private setBlurred(b: boolean): void {
        if (b) this.runScreen.blurred = true;
    }

    // ---------------------------------------------------------------------------------------------
    // 50 Hz logic
    // ---------------------------------------------------------------------------------------------

    protected override async mainloop(): Promise<void> {
        Cycle.loop++;

        for (let key = this.pollKey(); key !== -1; key = this.pollKey()) {
            if (this.screen === 'run') {
                if (this.optionsOverlay && key === 27) this.optionsOverlay = false;
                else this.runScreen.key(key);
            } else if (this.screen === 'menu') this.menu.key(key);
            else if (this.screen === 'results') this.results.key(key);
        }

        if (this.screen === 'menu') {
            this.menu.update();
        } else if (this.screen === 'run') {
            this.runScreen.update();
        }
    }

    // ---------------------------------------------------------------------------------------------
    // drawing
    // ---------------------------------------------------------------------------------------------

    private drawLoading(): void {
        if (!this.frame) return;
        this.frame.setPixels();
        Pix2D.cls();
        const W = Ui.W;
        const H = Ui.H;
        if (Assets.fonts) {
            Gfx.stone(0, 0, W, H);
            Gfx.centre('Gielinor Survivors', W >> 1, (H >> 1) - 60, COL.ORANGE, 'q8');
        }
        const bw = Math.min(304, W - 40);
        const x = (W - bw) >> 1;
        const y = (H >> 1) - 18;
        Pix2D.drawRect(x, y, bw, 34, 0x8c1111);
        Pix2D.drawRect(x + 1, y + 1, bw - 2, 32, 0x000000);
        Pix2D.fillRect(x + 2, y + 2, (((bw - 4) * this.loadPercent) / 100) | 0, 30, 0x8c1111);
        if (Assets.fonts) {
            Gfx.centre(`${this.loadMessage}`, W >> 1, y + 22, COL.WHITE, 'b12', false);
        }
        this.frame.draw(0, 0);
        if (!Assets.fonts) {
            canvas2d.fillStyle = 'white';
            canvas2d.font = 'bold 13px helvetica, sans-serif';
            canvas2d.textAlign = 'center';
            canvas2d.fillText(this.loadMessage, W >> 1, y + 22);
        }
    }

    protected override async drawProgress(message: string, progress: number): Promise<void> {
        this.loadMessage = message;
        this.loadPercent = progress;
        this.drawLoading();
    }

    protected override async mainredraw(): Promise<void> {
        Cycle.draw++;
        if (this.loadError) {
            canvas2d.fillStyle = 'black';
            canvas2d.fillRect(0, 0, canvas.width, canvas.height);
            canvas2d.fillStyle = 'yellow';
            canvas2d.font = 'bold 13px helvetica, sans-serif';
            canvas2d.textAlign = 'left';
            canvas2d.fillText(`Error loading game: ${this.loadError}`, 20, 40);
            canvas2d.fillText('Run `npm run setup && npm run build` and serve the dist/ folder.', 20, 60);
            return;
        }
        if (!this.frame || this.screen === 'loading') {
            this.drawLoading();
            return;
        }

        this.frame.setPixels();
        Pix3D.setRenderClipping();
        World.setViewport(Ui.W, Ui.H);
        Ui.beginFrame();

        if (this.screen === 'menu') {
            this.menu.draw();
        } else if (this.screen === 'run') {
            this.runScreen.draw();
            if (this.optionsOverlay) {
                const w = Math.min(Ui.W - 20, 620);
                const h = Math.min(Ui.H - 20, 330);
                const r = { x: (Ui.W - w) >> 1, y: (Ui.H - h) >> 1, w, h };
                this.menu.drawOptions(r);
                if (Ui.button({ x: r.x + r.w - 90, y: r.y + 6, w: 80, h: 24 }, 'Close', { font: 'p12' })) this.optionsOverlay = false;
                Ui.block(r);
            }
        } else if (this.screen === 'results') {
            this.results.draw();
        }

        Ui.drawTooltip();
        const worldClick = Ui.endFrame();
        if (worldClick && this.screen === 'run') {
            if (this.runScreen.blurred) this.runScreen.blurred = false;
            else this.runScreen.worldClick(worldClick.x, worldClick.y);
        }
        this.frame.draw(0, 0);
    }

    // ---------------------------------------------------------------------------------------------
    // input: mouse + touch unified through pointer events (every click/tap is "walk here")
    // ---------------------------------------------------------------------------------------------

    protected override mouseDown(x: number, y: number, _e: MouseEvent): void {
        // clicks are handled from pointer events; keep the RS mouse position in sync only
        this.mouseX = x;
        this.mouseY = y;
    }

    override pointerDown(x: number, y: number, e: PointerEvent): void {
        Music.unlock();
        canvas.focus();
        if (this.screen === 'run' && this.runScreen.blurred && e.pointerType === 'mouse') {
            this.runScreen.blurred = false;
        }
        Ui.touch = e.pointerType === 'touch';
        Ui.mouseX = x;
        Ui.mouseY = y;
        this.pointers.set(e.pointerId, { id: e.pointerId, x, y, sx: x, sy: y, t: performance.now(), type: e.pointerType, moved: false });
        try {
            canvas.setPointerCapture(e.pointerId);
        } catch (_e) {
            // ignore
        }
        if (e.pointerType === 'mouse') {
            if (e.button === 0) {
                Ui.pushClick(x, y); // RS acts on press
            } else if (e.button === 1) {
                this.middleDrag = { x, y };
                e.preventDefault();
            }
        }
        if (this.pointers.size === 2) {
            const [a, b] = [...this.pointers.values()];
            this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        }
    }

    override pointerMove(x: number, y: number, e: PointerEvent): void {
        super.pointerMove(x, y, e);
        Ui.mouseX = x;
        Ui.mouseY = y;
        const p = this.pointers.get(e.pointerId);
        if (this.middleDrag) {
            this.camera.rotate(-(x - this.middleDrag.x) * 3, (y - this.middleDrag.y) * 2);
            this.middleDrag = { x, y };
        }
        if (!p) return;
        const dx = x - p.x;
        const dy = y - p.y;
        p.x = x;
        p.y = y;
        if (Math.hypot(x - p.sx, y - p.sy) > 10) p.moved = true;

        if (this.pointers.size >= 2 && this.pinch) {
            const [a, b] = [...this.pointers.values()];
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            const cx = (a.x + b.x) / 2;
            const cy = (a.y + b.y) / 2;
            if (this.screen === 'run') {
                const ratio = dist / Math.max(1, this.pinch.dist);
                if (Math.abs(ratio - 1) > 0.04) {
                    this.camera.zoomBy(ratio < 1 ? 1 : -1);
                    this.pinch.dist = dist;
                }
                this.camera.rotate(-(cx - this.pinch.cx) * 3, (cy - this.pinch.cy) * 2);
            }
            this.pinch.cx = cx;
            this.pinch.cy = cy;
            return;
        }

        if (p.moved && (p.type === 'touch' || (p.type === 'mouse' && this.mouseButton === 1 && this.screen !== 'run'))) {
            if (this.screen === 'run') {
                // one-finger drag orbits the camera on touch screens
                this.camera.rotate(-dx * 3, dy * 2);
            } else {
                Ui.dragDY += dy;
            }
        }
    }

    override pointerUp(x: number, y: number, e: PointerEvent): void {
        const p = this.pointers.get(e.pointerId);
        this.pointers.delete(e.pointerId);
        if (this.pointers.size < 2) this.pinch = null;
        if (e.pointerType === 'mouse' && e.button === 1) this.middleDrag = null;
        if (!p) return;
        if (p.type === 'touch' && !p.moved && performance.now() - p.t < 500 && this.pointers.size === 0) {
            if (this.screen === 'run' && this.runScreen.blurred) this.runScreen.blurred = false;
            Ui.mouseX = x;
            Ui.mouseY = y;
            Ui.pushClick(x, y);
        }
    }

    private onWheel(e: WheelEvent): void {
        e.preventDefault();
        if (this.screen === 'run' && !this.runScreen.levelUp && !this.optionsOverlay) {
            this.camera.zoomBy(e.deltaY);
        } else {
            Ui.wheel = e.deltaY;
        }
    }

    // automation hooks (Playwright screenshots / perf checks)
    debugState(): unknown {
        return {
            state: this.screen,
            fps: this.fps,
            hud: this.runScreen.hud,
            levelUp: this.runScreen.levelUp,
            npcs: this.entities.npcCount,
            simMs: this.runScreen.bridge.lastTickMs,
            zoom: this.camera.zoom,
            talentXpMax: talentXpForPoint(30)
        };
    }

    renderMs(): number {
        return (this.runScreen as unknown as { renderMs: number }).renderMs;
    }

    debugCamera(zoom: number, pitch: number, yaw: number): void {
        this.camera.targetZoom = zoom;
        this.camera.zoom = zoom;
        this.camera.pitch = pitch;
        this.camera.targetPitch = pitch;
        this.camera.yaw = yaw;
    }

    debugPick(i: number): void {
        (this.runScreen as unknown as { pick(i: number): void }).pick(i);
    }
}
