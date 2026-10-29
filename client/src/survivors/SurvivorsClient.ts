// Gielinor Survivors client shell. Extends the Lost City GameShell (same 50Hz logic loop, input
// and canvas handling) but replaces login/title/chat/sidebar with the survivors screens, and the
// server connection with an in-page simulation worker (see SimBridge).
import GameShell from '#/client/GameShell.js';
import { Cycle } from '#/client/Cycle.js';

import Pix3D from '#/dash3d/Pix3D.js';
import Model from '#/dash3d/Model.js';
import World from '#/dash3d/World.js';
import Pix2D from '#/graphics/Pix2D.js';
import PixMap from '#/graphics/PixMap.js';
import Packet from '#/io/Packet.js';
import { canvas, canvas2d } from '#/graphics/Canvas.js';

import Assets from '#/survivors/Assets.js';
import Camera from '#/survivors/Camera.js';
import Entities from '#/survivors/Entities.js';
import Scene from '#/survivors/Scene.js';
import Gfx, { COL } from '#/survivors/ui/Gfx.js';

export const WIDTH = 765;
export const HEIGHT = 503;

export default class SurvivorsClient extends GameShell {
    db: unknown = null;
    ingame = false;

    frame: PixMap | null = null;
    scene = new Scene();
    entities = new Entities(this.scene);
    camera = new Camera();

    private loaded = false;
    private loadError: string | null = null;
    private worldUpdateNum = 0;
    private dragging = false;
    private dragX = 0;
    private dragY = 0;
    private showOverlay = true;
    private crossX = 0;
    private crossY = 0;
    private crossCycle = 0;
    private crossMode = 0;
    private cross: (ReturnType<typeof Assets.pix32>)[] = [];
    private frameTimes: number[] = [];

    constructor() {
        super(false);
        this.run();
    }

    protected override async maininit(): Promise<void> {
        try {
            await Assets.load('data', this, async (msg, pct) => this.drawProgress(msg, pct));
            this.frame = new PixMap(WIDTH, HEIGHT);
            for (let i = 0; i < 8; i++) {
                this.cross[i] = Assets.pix32('cross', i);
            }

            World.drawRadius = 64;
            World.dynamicVis = true;
            World.farClip = 16000;

            const params = new URLSearchParams(window.location.search);
            const tx = parseInt(params.get('x') ?? '3222', 10);
            const tz = parseInt(params.get('z') ?? '3218', 10);
            this.scene.build(tx >> 3, tz >> 3, []);
            this.entities.reset();
            const appearance = SurvivorsClient.defaultAppearance();
            this.entities.player.setAppearance(appearance);
            this.entities.player.teleport(true, tx - this.scene.baseX, tz - this.scene.baseZ);
            this.camera.reset(this.entities.player.x, this.entities.player.z);
            this.loaded = true;
        } catch (e) {
            console.error(e);
            this.loadError = e instanceof Error ? e.message : String(e);
        }

        canvas.addEventListener('wheel', (e: WheelEvent) => {
            e.preventDefault();
            this.camera.zoomBy(e.deltaY);
        }, { passive: false });
    }

    static defaultAppearance() {
        // PLAYER_INFO appearance block: gender, headicons, 12 body parts, 5 colours, 7 anims, name, combat, skill
        const data = new Uint8Array(64);
        let pos = 0;
        const p1 = (v: number) => (data[pos++] = v & 0xff);
        const p2 = (v: number) => {
            data[pos++] = (v >> 8) & 0xff;
            data[pos++] = v & 0xff;
        };
        p1(0);
        p1(0);
        const idk = [-1, -1, -1, -1, 18, -1, 26, 36, 0, 33, 42, 10];
        for (const part of idk) {
            if (part < 0) {
                p1(0);
            } else {
                p2(0x100 + part);
            }
        }
        for (let i = 0; i < 5; i++) {
            p1(0);
        }
        for (const anim of [808, 823, 819, 820, 821, 822, 824]) {
            p2(anim);
        }
        for (let i = 0; i < 8; i++) {
            p1(0);
        }
        p1(3);
        p2(0);
        return new Packet(data.subarray(0, pos));
    }

    protected override async mainloop(): Promise<void> {
        Cycle.loop++;
        if (!this.loaded) {
            return;
        }

        // camera controls: middle-drag rotates/pitches like RS, arrow keys orbit
        if (this.mouseButton === 0) {
            this.dragging = false;
        }

        if (this.mouseClickButton === 1 && this.mouseClickX >= 0) {
            this.scene.world.updateMousePicking(this.mouseClickX, this.mouseClickY);
            this.crossX = this.mouseClickX;
            this.crossY = this.mouseClickY;
        }

        if (World.groundX !== -1) {
            this.entities.player.moveCode(false, 1);
            this.crossMode = 1;
            this.crossCycle = 0;
            World.groundX = -1;
        }

        if (this.crossMode !== 0) {
            this.crossCycle += 20;
            if (this.crossCycle >= 400) {
                this.crossMode = 0;
            }
        }

        this.entities.move();
        this.worldUpdateNum++;

        const p = this.entities.player;
        this.camera.update(this.keyHeld[1] === 1, this.keyHeld[2] === 1, this.keyHeld[3] === 1, this.keyHeld[4] === 1, p.x, p.z, null, (x, z) => this.scene.getAvH(x, z));
    }

    protected override async mainredraw(): Promise<void> {
        Cycle.draw++;
        if (this.loadError) {
            canvas2d.fillStyle = 'black';
            canvas2d.fillRect(0, 0, WIDTH, HEIGHT);
            canvas2d.fillStyle = 'yellow';
            canvas2d.font = 'bold 13px helvetica, sans-serif';
            canvas2d.fillText(`Error loading game: ${this.loadError}`, 20, 40);
            return;
        }
        if (!this.loaded || !this.frame) {
            return;
        }

        const t0 = performance.now();
        this.frame.setPixels();
        Pix3D.setRenderClipping();
        World.setViewport(WIDTH, HEIGHT);
        Pix2D.cls();

        this.entities.addToWorld(this.worldUpdateNum);
        this.worldUpdateNum = 0;

        Model.mouseCheck = false;
        const c = this.camera;
        this.scene.world.renderAll(c.camX, c.camY, c.camZ, 0, c.camYaw, c.camPitch);
        this.scene.world.removeSprites();

        if (this.crossMode === 1) {
            this.cross[(this.crossCycle / 100) | 0]?.plotSprite(this.crossX - 8 - 4, this.crossY - 8 - 4);
        }

        if (this.showOverlay) {
            const dt = performance.now() - t0;
            this.frameTimes.push(dt);
            if (this.frameTimes.length > 50) {
                this.frameTimes.shift();
            }
            const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
            Gfx.right(`Fps:${this.fps}`, WIDTH - 8, 20, COL.YELLOW);
            Gfx.right(`Render:${avg.toFixed(1)}ms`, WIDTH - 8, 35, COL.YELLOW);
            Gfx.right(`Zoom:${c.zoom | 0} Pitch:${c.pitch}`, WIDTH - 8, 50, COL.YELLOW);
        }

        this.frame.draw(0, 0);
    }

    override pointerDown(x: number, y: number, e: PointerEvent): void {
        if (e.button === 1) {
            this.dragging = true;
            this.dragX = x;
            this.dragY = y;
            e.preventDefault();
        }
    }

    override pointerMove(x: number, y: number, e: PointerEvent): void {
        super.pointerMove(x, y, e);
        if (this.dragging) {
            this.camera.rotate(-(x - this.dragX) * 2, (y - this.dragY) * 2);
            this.dragX = x;
            this.dragY = y;
        }
    }

    override pointerUp(_x: number, _y: number, e: PointerEvent): void {
        if (e.button === 1) {
            this.dragging = false;
        }
    }
}
