// The in-run view: applies simulation snapshots to the client entities/scene, renders the world,
// telegraphs, hitsplats/HP bars, the HUD, level-up cards and the pause / victory dialogs.
import { Cycle } from '#/client/Cycle.js';
import ClientEntity from '#/dash3d/ClientEntity.js';
import Model from '#/dash3d/Model.js';
import Pix3D from '#/dash3d/Pix3D.js';
import World from '#/dash3d/World.js';
import Pix2D from '#/graphics/Pix2D.js';

import type { ArenaData } from '../../../../sim/src/content/arenas.js';
import { CLASSES } from '../../../../sim/src/content/classes.js';
import { ZONE_BY_ID } from '../../../../sim/src/content/zones.js';
import type { CardView, GameEvent, HudView, LevelUpView, RunResults, Snapshot } from '../../../../sim/src/protocol.js';
import type { GameDb, RunLoadout } from '../../../../sim/src/types.js';

import { buildAppearance, type Look } from '#/survivors/Appearance.js';
import Assets from '#/survivors/Assets.js';
import type Camera from '#/survivors/Camera.js';
import type Entities from '#/survivors/Entities.js';
import Music from '#/survivors/Music.js';
import type Scene from '#/survivors/Scene.js';
import SimBridge from '#/survivors/SimBridge.js';
import Gfx, { COL, RARITY_COLOURS, RARITY_NAMES } from '#/survivors/ui/Gfx.js';
import Ui, { type Rect } from '#/survivors/ui/Ui.js';

type Message = { text: string; colour: number; cycle: number };

export type RunHost = {
    scene: Scene;
    entities: Entities;
    camera: Camera;
    keyHeld: number[];
    fps: number;
    readonly options: { showFps: boolean; hideRoofs: boolean; shake: number; bossIntro: boolean; autoFrame: boolean; cameraLead: boolean; music: number };
    onRunOver(results: RunResults): void;
    openOptions(): void;
};

export default class RunScreen {
    readonly bridge = new SimBridge();
    hud: HudView | null = null;
    levelUp: LevelUpView | null = null;
    results: RunResults | null = null;
    private victory = false;
    paused = false; // pause menu (Esc / button) - sim does not tick
    blurred = false; // tab hidden / canvas lost focus
    private messages: Message[] = [];
    private banishMode = false;
    private loading = true;
    private zoneName = '';
    private worldUpdateNum = 0;
    private crossX = 0;
    private crossY = 0;
    private crossCycle = 0;
    private crossMode = 0;
    private pendingWalk = false;
    private renderMs = 0;
    private bossFocus: { slot: number } | null = null;
    private look: Look | null = null;
    private worn: string[] = [];
    private anims: number[] = [];
    private headicon = -1;
    private lastHeadicon = -1;
    private tick = 0;
    private overDelay = -1;
    private snapsThisSecond = 0;
    private bossNameCycle = 0;

    constructor(private readonly host: RunHost) {}

    async start(arenaData: ArenaData, loadout: RunLoadout, look: Look): Promise<void> {
        const { scene, entities, camera } = this.host;
        const zone = ZONE_BY_ID[loadout.zoneId];
        this.zoneName = zone.name;
        this.loading = true;
        this.results = null;
        this.victory = false;
        this.paused = false;
        this.levelUp = null;
        this.hud = null;
        this.messages = [];
        this.overDelay = -1;

        World.clearHighlights();
        RunScreen.setArenaBounds(arenaData);
        scene.build(arenaData.centreZoneX, arenaData.centreZoneZ, arenaData.boundaryLocs);
        scene.clearObjs();
        entities.reset();

        // the player's look: identity kit + equipped gear, class weapon stance anims
        const cls = CLASSES[loadout.classId];
        this.look = look;
        this.worn = Object.entries(loadout.gear)
            .filter(([, tier]) => tier >= 0)
            .map(([slot, tier]) => cls.gear[slot as keyof typeof cls.gear][tier]);
        this.anims = cls.anims.map(a => Assets.game.seqs[a] ?? -1);
        entities.player.setAppearance(buildAppearance(look, this.worn, this.anims));
        entities.player.teleport(true, arenaData.centreLocalX, arenaData.centreLocalZ);
        camera.reset(entities.player.x, entities.player.z);
        camera.options = { shake: this.host.options.shake, bossIntro: this.host.options.bossIntro, autoFrame: this.host.options.autoFrame, lead: this.host.options.cameraLead };

        const db: GameDb = { npcs: Assets.game.npcs, seqs: Assets.game.seqs, spotanims: Assets.game.spotanims, objs: Assets.game.objs, locs: Assets.game.locs, synths: Assets.game.synths };
        this.bridge.start(arenaData, db, loadout);
        Music.play(arenaData.music, this.host.options.music);
        this.message(`Welcome to ${zone.name}. Click or tap any tile to walk there.`, COL.WHITE);
    }

    stop(): void {
        this.bridge.stop();
        World.clearHighlights();
        World.boundMinX = World.boundMinZ = 0;
        World.boundMaxX = World.boundMaxZ = 104;
    }

    // draw the arena plus a margin of the real map around it (enough to frame it at max zoom)
    static setArenaBounds(a: ArenaData): void {
        const bin = atob(a.flags);
        const flags = new Int32Array(new Uint8Array([...bin].map(c => c.charCodeAt(0))).buffer);
        let minX = 104;
        let minZ = 104;
        let maxX = 0;
        let maxZ = 0;
        for (let x = 0; x < 104; x++) {
            for (let z = 0; z < 104; z++) {
                if ((flags[x * 104 + z] & 0x4000000) === 0) {
                    minX = Math.min(minX, x);
                    maxX = Math.max(maxX, x);
                    minZ = Math.min(minZ, z);
                    maxZ = Math.max(maxZ, z);
                }
            }
        }
        const m = 10;
        World.boundMinX = Math.max(0, minX - m);
        World.boundMinZ = Math.max(0, minZ - m);
        World.boundMaxX = Math.min(104, maxX + m + 1);
        World.boundMaxZ = Math.min(104, maxZ + m + 1);
    }

    get simPaused(): boolean {
        return this.paused || this.blurred || this.levelUp !== null || this.victory || this.results !== null || this.host.camera.inIntro;
    }

    message(text: string, colour: number = COL.YELLOW): void {
        this.messages.push({ text, colour, cycle: Cycle.loop });
        if (this.messages.length > 6) this.messages.shift();
    }

    // ---------------------------------------------------------------------------------------------
    // logic (50 Hz)
    // ---------------------------------------------------------------------------------------------

    update(): void {
        const { entities, camera, scene } = this.host;

        this.bridge.update(this.simPaused);
        for (let snap = this.bridge.poll(); snap !== null; snap = this.bridge.poll()) {
            this.applySnapshot(snap);
        }
        if (this.bridge.error) {
            this.message(`Simulation error: ${this.bridge.error.split('\n')[0]}`, COL.RED);
            this.bridge.error = null;
        }

        if (World.groundX !== -1) {
            // walk here: the RS client's ground pick from the last rendered frame
            if (this.pendingWalk && !this.levelUp && !this.paused) {
                this.bridge.send({ type: 'walk', x: World.groundX, z: World.groundZ });
                this.crossMode = 1;
                this.crossCycle = 0;
            }
            this.pendingWalk = false;
            World.groundX = -1;
        }

        if (this.crossMode !== 0) {
            this.crossCycle += 20;
            if (this.crossCycle >= 400) this.crossMode = 0;
        }

        if (!this.simPaused || camera.inIntro) {
            entities.move();
        }
        this.worldUpdateNum++;

        const boss = this.hud?.bosses[0];
        const bossEntity = boss ? entities.npc[boss.slot] : null;
        const p = entities.player;
        camera.options = { shake: this.host.options.shake, bossIntro: this.host.options.bossIntro, autoFrame: this.host.options.autoFrame, lead: this.host.options.cameraLead };
        const keys = this.host.keyHeld;
        camera.update(keys[1] === 1, keys[2] === 1, keys[3] === 1, keys[4] === 1, p.x, p.z, bossEntity ? { x: bossEntity.x, z: bossEntity.z } : null, (x, z) => scene.getAvH(x, z));

        if (this.overDelay > 0 && --this.overDelay === 0 && this.results) {
            this.host.onRunOver(this.results);
        }
    }

    private applySnapshot(snap: Snapshot): void {
        const { scene, entities, camera } = this.host;
        this.tick = snap.tick;
        this.loading = false;
        entities.apply(snap);
        for (const o of snap.objDels) scene.delObj(o.x, o.z, o.uid);
        for (const o of snap.objAdds) scene.addObj(o.x, o.z, o.obj, o.count, o.uid);
        for (const l of snap.locs) scene.setLoc(l.x, l.z, l.loc, l.shape, l.angle);

        World.clearHighlights();
        for (const t of snap.telegraphs) {
            // brighter as impact approaches
            const alpha = Math.min(210, 90 + ((t.total - t.ticksLeft + 1) * 120) / Math.max(1, t.total));
            for (const tile of t.tiles) World.setHighlight((tile / 104) | 0, tile % 104, t.colour, alpha | 0);
        }

        this.hud = snap.hud;
        const wasLevel = this.levelUp !== null;
        this.levelUp = snap.levelUp;
        if (this.levelUp && !wasLevel) {
            this.banishMode = false;
        }

        // overhead protection prayer icon (headicons 3/4/5: melee, missiles, magic)
        this.headicon = snap.hud.prayer === 'melee' ? 3 : snap.hud.prayer === 'ranged' ? 4 : snap.hud.prayer === 'magic' ? 5 : -1;

        for (const e of snap.events) this.handleEvent(e);

        if (snap.over && !this.results) {
            this.results = snap.over;
            this.overDelay = snap.over.won ? 60 : 140; // let the death animation play
        }
        void camera;
    }

    private handleEvent(e: GameEvent): void {
        const { camera, entities } = this.host;
        switch (e.type) {
            case 'message':
                this.message(e.text, e.colour ?? COL.YELLOW);
                break;
            case 'shake':
                camera.shake(e.strength);
                break;
            case 'bossSpawn': {
                const npc = entities.npc[e.slot];
                const x = npc ? npc.x : e.x * 128 + 64;
                const z = npc ? npc.z : e.z * 128 + 64;
                camera.startBossIntro(x, z, e.name);
                this.bossNameCycle = Cycle.loop;
                this.bossFocus = { slot: e.slot };
                break;
            }
            case 'bossDeath':
                camera.shake(80);
                break;
            case 'victory':
                this.victory = true;
                break;
            case 'enrage':
                camera.shake(50);
                break;
            case 'levelUp':
                break;
            case 'death':
                break;
        }
    }

    // ---------------------------------------------------------------------------------------------
    // input
    // ---------------------------------------------------------------------------------------------

    key(key: number): void {
        if (this.levelUp) {
            if (key >= 49 && key <= 52) this.pick(key - 49);
            if (key === 114 || key === 82) this.reroll();
            if (key === 115 || key === 83) this.skip();
            if (key === 98 || key === 66) this.banishMode = !this.banishMode && this.levelUp.banishes > 0;
            return;
        }
        if (key === 27) {
            // Esc
            this.paused = !this.paused;
        }
        if (key === 120 || key === 88) {
            // X: toggle run
            this.bridge.send({ type: 'run', on: !(this.hud?.running ?? false) });
        }
        if (key === 102 || key === 70) {
            this.host.options.showFps = !this.host.options.showFps;
        }
    }

    worldClick(x: number, y: number): void {
        if (this.levelUp || this.paused || this.victory || this.results) return;
        this.host.scene.world.updateMousePicking(x, y);
        this.pendingWalk = true;
        this.crossX = x;
        this.crossY = y;
    }

    private pick(i: number): void {
        if (!this.levelUp || i >= this.levelUp.cards.length) return;
        if (this.banishMode) {
            this.bridge.send({ type: 'banish', index: i });
            this.banishMode = false;
        } else {
            this.bridge.send({ type: 'pick', index: i });
            this.levelUp = null;
        }
        this.bridge.flush();
    }

    private reroll(): void {
        if (!this.levelUp) return;
        this.bridge.send({ type: 'reroll' });
        this.bridge.flush();
    }

    private skip(): void {
        if (!this.levelUp) return;
        this.bridge.send({ type: 'skip' });
        this.levelUp = null;
        this.bridge.flush();
    }

    // ---------------------------------------------------------------------------------------------
    // drawing
    // ---------------------------------------------------------------------------------------------

    draw(): void {
        const { scene, entities, camera } = this.host;
        const W = Ui.W;
        const H = Ui.H;
        const t0 = performance.now();

        Pix2D.cls();
        if (this.loading || !scene.built) {
            Gfx.centre('Loading - please wait.', W >> 1, H >> 1, COL.WHITE, 'p12');
            return;
        }

        // overhead prayer icon on the player follows the HUD
        if (this.headicon !== this.lastHeadicon && this.look) {
            this.lastHeadicon = this.headicon;
            entities.player.setAppearance(buildAppearance(this.look, this.worn, this.anims, this.headicon >= 0 ? 1 << this.headicon : 0));
        }

        Model.minLocScreenRadius = camera.zoom > 4000 ? 1.5 + (camera.zoom - 4000) / 1800 : 0;
        // the client's low-detail ground path (average texture colour) once tiles are a few px wide
        World.lowMem = camera.zoom > 6000;
        entities.addToWorld(this.worldUpdateNum);
        this.worldUpdateNum = 0;
        scene.world.renderAll(camera.camX, camera.camY, camera.camZ, this.host.options.hideRoofs ? 0 : 3, camera.camYaw, camera.camPitch);
        scene.world.removeSprites();
        this.textureRunAnims();
        this.entityOverlays();
        this.renderMs = performance.now() - t0;

        if (this.crossMode === 1) {
            Assets.pix32('cross', (this.crossCycle / 100) | 0)?.plotSprite(this.crossX - 12, this.crossY - 12);
        }

        // boss intro title, in the RS quill font
        if (camera.introName) {
            const a = Math.min(1, (Cycle.loop - this.bossNameCycle) / 15);
            if (a > 0.3) {
                Gfx.centre(camera.introName, W >> 1, (H * 0.3) | 0, COL.ORANGE, 'q8');
                Gfx.centre('approaches!', W >> 1, ((H * 0.3) | 0) + 22, COL.YELLOW, 'b12');
            }
        }

        this.drawHud();
        if (this.levelUp) this.drawLevelUp(this.levelUp);
        else if (this.victory) this.drawVictory();
        else if (this.paused) this.drawPause();
        else if (this.results && this.overDelay > 0) {
            Gfx.centre(this.results.won ? 'Victory!' : 'Oh dear, you are dead!', W >> 1, H >> 1, this.results.won ? COL.GREEN : COL.RED, 'q8');
        }
        if (this.blurred && !this.paused) {
            Pix2D.fillRectTrans(0, (H >> 1) - 20, W, 40, 0, 140);
            Gfx.centre('Paused - click to resume', W >> 1, (H >> 1) + 5, COL.WHITE, 'b12');
        }
        if (this.host.options.showFps) this.drawDebug();
    }

    // Client.textureRunAnims: scroll animated textures (water, lava)
    private textureBuffer: Int8Array = new Int8Array(16384) as Int8Array;
    private textureRunAnims(): void {
        for (const id of [17, 24]) {
            const texture = Pix3D.textures[id];
            if (!texture) continue;
            const bottom: number = texture.wi * texture.hi - 1;
            const adjustment: number = texture.wi * 2;
            const src = texture.data as Int8Array;
            const dst = this.textureBuffer as typeof src;
            for (let i: number = 0; i <= bottom; i++) dst[i] = src[(i - adjustment) & bottom];
            texture.data = dst;
            this.textureBuffer = src;
            Pix3D.pushTexture(id);
        }
    }

    private projX = -1;
    private projY = -1;

    // Client.getOverlayPos
    private overlayPos(entity: ClientEntity, height: number): void {
        const { scene, camera } = this.host;
        const x = entity.x;
        const z = entity.z;
        if (x < 128 || z < 128 || x > 13056 || z > 13056) {
            this.projX = this.projY = -1;
            return;
        }
        const y: number = scene.getAvH(x, z) - height;
        let dx: number = x - camera.camX;
        let dy: number = y - camera.camY;
        let dz: number = z - camera.camZ;
        const sinPitch: number = Pix3D.sinTable[camera.camPitch];
        const cosPitch: number = Pix3D.cosTable[camera.camPitch];
        const sinYaw: number = Pix3D.sinTable[camera.camYaw];
        const cosYaw: number = Pix3D.cosTable[camera.camYaw];
        let tmp: number = (dz * sinYaw + dx * cosYaw) >> 16;
        dz = (dz * cosYaw - dx * sinYaw) >> 16;
        dx = tmp;
        tmp = (dy * cosPitch - dz * sinPitch) >> 16;
        dz = (dy * sinPitch + dz * cosPitch) >> 16;
        dy = tmp;
        if (dz >= 50) {
            this.projX = Pix3D.originX + (((dx << 9) / dz) | 0);
            this.projY = Pix3D.originY + (((dy << 9) / dz) | 0);
        } else {
            this.projX = this.projY = -1;
        }
    }

    // ported from Client.entityOverlays: overhead text, HP bars, hitsplats, head icons
    private entityOverlays(): void {
        const { entities } = this.host;
        const list: ClientEntity[] = [entities.player];
        for (let i = 0; i < entities.npcCount; i++) {
            const n = entities.npc[entities.npcIds[i]];
            if (n) list.push(n);
        }
        const p11 = Assets.fonts.p11;
        const b12 = Assets.fonts.b12;
        for (const entity of list) {
            if (!entity.isReady()) continue;
            if (entity === entities.player && this.headicon >= 0) {
                this.overlayPos(entity, entity.height + 15);
                if (this.projX > -1) Assets.pix32('headicons', this.headicon)?.plotSprite(this.projX - 12, this.projY - 30);
            }
            if (entity.chatMessage) {
                this.overlayPos(entity, entity.height);
                if (this.projX > -1) {
                    b12.centreString(entity.chatMessage, this.projX, this.projY + 1, COL.BLACK);
                    b12.centreString(entity.chatMessage, this.projX, this.projY, COL.YELLOW);
                }
            }
            if (entity.combatCycle > Cycle.loop + 100) {
                this.overlayPos(entity, entity.height + 15);
                if (this.projX > -1 && entity.totalHealth > 0) {
                    let w: number = ((entity.health * 30) / entity.totalHealth) | 0;
                    if (w > 30) w = 30;
                    Pix2D.fillRect(this.projX - 15, this.projY - 3, w, 5, COL.GREEN);
                    Pix2D.fillRect(this.projX - 15 + w, this.projY - 3, 30 - w, 5, COL.RED);
                }
            }
            for (let i = 0; i < 4; ++i) {
                if (entity.damageCycles[i] <= Cycle.loop) continue;
                this.overlayPos(entity, (entity.height / 2) | 0);
                if (this.projX <= -1) continue;
                if (i == 1) {
                    this.projY -= 20;
                } else if (i == 2) {
                    this.projX -= 15;
                    this.projY -= 10;
                } else if (i == 3) {
                    this.projX += 15;
                    this.projY -= 10;
                }
                Assets.pix32('hitmarks', entity.damageTypes[i])?.plotSprite(this.projX - 12, this.projY - 12);
                p11.centreString(entity.damageValues[i].toString(), this.projX, this.projY + 4, COL.BLACK);
                p11.centreString(entity.damageValues[i].toString(), this.projX - 1, this.projY + 3, COL.WHITE);
            }
        }
    }

    // ---------------------------------------------------------------------------------------------
    // HUD
    // ---------------------------------------------------------------------------------------------

    private drawHud(): void {
        const hud = this.hud;
        if (!hud) return;
        const W = Ui.W;
        const H = Ui.H;
        const compact = W < 600;

        // --- top-left: clock, level, xp ---
        const tlw = compact ? 150 : 190;
        Gfx.stone(4, 4, tlw, 46);
        Gfx.steelFrameThin(4, 4, tlw, 46);
        const secs = Math.floor(hud.clockTicks * 0.6);
        const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
        Gfx.text(clock, 12, 22, COL.YELLOW, 'b12');
        Gfx.text(`Level ${hud.level}`, 12 + Gfx.width(clock, 'b12') + 10, 22, COL.ORANGE, 'p12');
        Gfx.bar(12, 30, tlw - 16, 8, hud.xp / Math.max(1, hud.xpNext), 0x00c0ff, 0x102030);
        if (hud.nextBossTicks >= 0) {
            const bs = Math.ceil(hud.nextBossTicks * 0.6);
            Gfx.text(hud.endless ? `Endless boss in ${Math.floor(bs / 60)}:${String(bs % 60).padStart(2, '0')}` : `Next boss ${Math.floor(bs / 60)}:${String(bs % 60).padStart(2, '0')}`, 12, 47, bs < 15 ? COL.RED : COL.GREY, 'p11');
        }

        // --- top-right: coins, kills, pause ---
        const trw = 120;
        const trx = W - trw - 4;
        Gfx.stone(trx, 4, trw, 46);
        Gfx.steelFrameThin(trx, 4, trw, 46);
        Gfx.item(Assets.game.objs.coins, trx + 4, 6, 1000);
        Gfx.text(`${hud.coins}`, trx + 42, 22, COL.YELLOW, 'b12');
        Gfx.icon('headicons', 0, trx + 10, 26);
        Gfx.text(`${hud.kills}`, trx + 42, 44, COL.WHITE, 'p12');
        const pauseBtn: Rect = { x: trx - 34, y: 6, w: 30, h: 30 };
        if (Ui.iconButton(pauseBtn, 'sideicons', 10, { tip: 'Pause / Options (Esc)' })) this.paused = !this.paused;

        // --- top-centre: boss bars ---
        let by = 6;
        const bw = Math.min(300, W - tlw - trw - 60);
        const bx = (W - bw) >> 1;
        for (const b of hud.bosses.slice(0, 3)) {
            Pix2D.fillRectTrans(bx - 4, by - 2, bw + 8, 28, 0, 120);
            Gfx.centre(`${b.name}${b.enraged ? ' (Enraged!)' : ''}`, bx + (bw >> 1), by + 11, b.enraged ? COL.RED : COL.ORANGE, 'b12');
            Gfx.bar(bx, by + 15, bw, 8, b.hp / Math.max(1, b.maxHp), 0x00a000, 0xa00000);
            const styleIcon = b.style === 'melee' ? 14 : b.style === 'ranged' ? 13 : 12;
            Gfx.icon('prayeron', styleIcon, bx + bw + 4, by - 2);
            by += 32;
        }

        // --- messages (RS game message style) ---
        const msgBottom = H - (compact ? 112 : 64);
        let my = msgBottom;
        for (let i = this.messages.length - 1; i >= 0 && my > H * 0.45; i--) {
            const m = this.messages[i];
            const age = Cycle.loop - m.cycle;
            if (age > 600) continue;
            Gfx.text(m.text, 8, my, m.colour, 'p12');
            my -= 14;
        }

        // --- bottom-left: HP + run energy orb ---
        const hpw = compact ? 130 : 170;
        const by2 = H - 50;
        Gfx.stone(4, by2, hpw + 56, 46);
        Gfx.steelFrameThin(4, by2, hpw + 56, 46);
        Gfx.icon('staticons', 6, 10, by2 + 4);
        Gfx.text(`${hud.hp}/${hud.maxHp}`, 40, by2 + 18, hud.hp < hud.maxHp * 0.3 ? COL.RED : COL.WHITE, 'b12');
        Gfx.bar(12, by2 + 32, hpw - 8, 8, hud.hp / Math.max(1, hud.maxHp), 0x00c000, 0xa00000);
        const orb: Rect = { x: 4 + hpw + 8, y: by2 + 3, w: 40, h: 40 };
        this.drawRunOrb(orb, hud);
        if (Ui.hit(orb)) this.bridge.send({ type: 'run', on: !hud.running });
        if (Ui.hover(orb)) Ui.tooltip = `Run ${hud.running ? 'on' : 'off'} (X)`;

        // --- bottom: ability icons with tick-cooldown sweeps ---
        const actives = hud.abilities;
        const size = compact ? 30 : 34;
        const perRow = compact ? Math.max(4, Math.floor((W - 16) / (size + 3))) : actives.length;
        const rows = Math.ceil(actives.length / Math.max(1, perRow));
        const ax0 = compact ? 8 : hpw + 72;
        const ayBase = compact ? by2 - rows * (size + 3) - 4 : H - size - 8;
        actives.forEach((a, i) => {
            const col = i % perRow;
            const row = Math.floor(i / perRow);
            const x = ax0 + col * (size + 3);
            const y = ayBase + row * (size + 3);
            Assets.pix32('miscgraphics', 0)?.plotSprite(x - 1, y - 1);
            Gfx.icon(a.icon, a.iconIndex, x + ((size - 25) >> 1), y + ((size - 25) >> 1));
            if (a.maxCooldown > 0 && a.cooldown > 0) {
                const frac = Math.min(1, a.cooldown / a.maxCooldown);
                const h = (size * frac) | 0;
                Pix2D.fillRectTrans(x, y, size, h, 0x000000, 150);
                Gfx.centre(`${a.cooldown}`, x + (size >> 1), y + (size >> 1) + 5, COL.WHITE, 'p11');
            }
            // rank pips
            for (let r = 0; r < a.maxRank; r++) Pix2D.fillRect(x + 2 + r * 5, y + size - 4, 4, 3, r < a.rank ? COL.YELLOW : 0x302a20);
            if (Ui.hover({ x, y, w: size, h: size })) Ui.tooltip = `${a.name} (rank ${a.rank}/${a.maxRank})${a.maxCooldown > 0 ? `, every ${a.maxCooldown} ticks` : ''}`;
        });

        // --- right: set-bonus progress ---
        let sy = 56 + Math.max(0, hud.bosses.length * 0);
        const sx = W - 128;
        for (const s of hud.sets) {
            Pix2D.fillRectTrans(sx, sy, 124, 22, 0, 110);
            const fam = { firemaking: 16, mining: 12, woodcutting: 17, fishing: 14, fletching: 11, agility: 7, thieving: 9, cooking: 15, herblore: 8, prayer: 4, smithing: 13, crafting: 10 }[s.family];
            if (s.family === 'runecrafting') Gfx.icon('staticons2', 0, sx, sy - 1);
            else if (fam !== undefined) Gfx.icon('staticons', fam, sx, sy - 1);
            const next = s.thresholds.find(t => t > s.ranks) ?? s.thresholds[s.thresholds.length - 1];
            Gfx.text(`${s.name}`, sx + 27, sy + 10, s.active > 0 ? COL.GREEN : COL.ORANGE, 'p11');
            Gfx.text(`${s.ranks}/${next}  ${'*'.repeat(s.active)}`, sx + 27, sy + 20, COL.WHITE, 'p11');
            sy += 24;
            if (sy > H - 120) break;
        }
        // run items
        let ix = W - 4 - 36;
        const iy = H - 40;
        for (const item of hud.items.slice(-8)) {
            Gfx.item(item.obj, ix, iy);
            if (Ui.hover({ x: ix, y: iy, w: 32, h: 32 })) Ui.tooltip = item.name;
            ix -= 34;
            if (ix < W * 0.55) break;
        }
    }

    private drawRunOrb(r: Rect, hud: HudView): void {
        const cx = r.x + (r.w >> 1);
        const cy = r.y + (r.h >> 1);
        Pix2D.fillCircle(cx, cy, 19, 0x1e1912, 256);
        Pix2D.fillCircle(cx, cy, 17, hud.running ? 0x8a7500 : 0x3a3020, 256);
        // energy fill from the bottom
        const fill = Math.round((34 * hud.energy) / 100);
        const fc = hud.running ? 0xe0c020 : 0x9a8040;
        for (let yy = cy + 17 - fill; yy <= cy + 17; yy++) {
            const d = yy - cy;
            const half = Math.sqrt(Math.max(0, 17 * 17 - d * d)) | 0;
            Pix2D.hline(cx - half, yy, half * 2 + 1, fc);
        }
        Gfx.icon('staticons', 7, cx - 12, cy - 16);
        Gfx.centre(`${hud.energy}`, cx, cy + 16, COL.WHITE, 'p11');
    }

    private drawDebug(): void {
        const W = Ui.W;
        const lines = [
            `Fps: ${this.host.fps}`,
            `Render: ${this.renderMs.toFixed(1)} ms`,
            `Sim tick: ${this.bridge.lastTickMs.toFixed(2)} ms`,
            `Entities: ${this.bridge.alive} sim / ${this.host.entities.npcCount} drawn`,
            `Horde alive: ${this.hud?.alive ?? 0}`,
            `Tick: ${this.tick}`,
            `Zoom: ${this.host.camera.zoom | 0}`
        ];
        const x = W - 170;
        let y = 64 + (this.hud?.bosses.length ?? 0) * 32;
        Pix2D.fillRectTrans(x - 4, y - 12, 168, lines.length * 14 + 6, 0, 150);
        for (const l of lines) {
            Gfx.text(l, x, y, COL.YELLOW, 'p12');
            y += 14;
        }
    }

    // ---------------------------------------------------------------------------------------------
    // level-up cards
    // ---------------------------------------------------------------------------------------------

    private drawLevelUp(lv: LevelUpView): void {
        const W = Ui.W;
        const H = Ui.H;
        Pix2D.fillRectTrans(0, 0, W, H, 0x000000, 140);
        const n = lv.cards.length;
        const portrait = Ui.portrait || W < 560;
        const cardW = portrait ? Math.min(W - 24, 360) : Math.min(210, ((W - 40) / n) | 0) - 8;
        const cardH = portrait ? Math.min(118, ((H - 150) / n) | 0) - 6 : 230;
        const totalW = portrait ? cardW : n * (cardW + 8) - 8;
        const totalH = portrait ? n * (cardH + 6) - 6 : cardH;
        const x0 = (W - totalW) >> 1;
        const y0 = Math.max(40, ((H - totalH) >> 1) - 10);

        Gfx.centre(`Level ${lv.level}!`, W >> 1, y0 - 22, COL.ORANGE, 'q8');
        Gfx.centre(this.banishMode ? 'Choose a card to banish from this run' : 'Choose a card (1-' + n + ')', W >> 1, y0 - 6, this.banishMode ? COL.RED : COL.WHITE, 'p12');

        let picked = -1;
        lv.cards.forEach((c, i) => {
            const r: Rect = portrait ? { x: x0, y: y0 + i * (cardH + 6), w: cardW, h: cardH } : { x: x0 + i * (cardW + 8), y: y0, w: cardW, h: cardH };
            this.drawCard(c, r, i, portrait);
            if (Ui.hit(r)) picked = i;
        });

        // reroll / skip / banish
        const by = y0 + totalH + 12;
        const bw = Math.min(110, ((W - 40) / 3) | 0);
        const gap = 8;
        const bx = (W - (bw * 3 + gap * 2)) >> 1;
        const rerollLabel = lv.freeRerolls > 0 ? `Reroll (${lv.freeRerolls})` : `Reroll ${lv.rerollCost}gp`;
        if (Ui.button({ x: bx, y: by, w: bw, h: 30 }, rerollLabel, { tip: 'R', enabled: lv.freeRerolls > 0 || (this.hud?.coins ?? 0) >= lv.rerollCost })) this.reroll();
        if (Ui.button({ x: bx + bw + gap, y: by, w: bw, h: 30 }, `Skip +${lv.skipCoins}gp`, { tip: 'S' })) this.skip();
        if (Ui.button({ x: bx + (bw + gap) * 2, y: by, w: bw, h: 30 }, `Banish (${lv.banishes})`, { active: this.banishMode, enabled: lv.banishes > 0, tip: 'B: remove a card from this run' })) this.banishMode = !this.banishMode;
        Ui.block({ x: 0, y: 0, w: W, h: H });
        if (picked >= 0) this.pick(picked);
    }

    private drawCard(c: CardView, r: Rect, index: number, compact: boolean): void {
        const hover = Ui.hover(r);
        Gfx.stone(r.x, r.y, r.w, r.h);
        const col = RARITY_COLOURS[c.rarity];
        Pix2D.drawRect(r.x, r.y, r.w, r.h, col);
        Pix2D.drawRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, col);
        if (hover) Pix2D.fillRectTrans(r.x + 2, r.y + 2, r.w - 4, r.h - 4, 0xffffff, 20);
        Gfx.text(`[${index + 1}]`, r.x + r.w - 26, r.y + 16, COL.GREY, 'p11');
        Assets.pix32('miscgraphics', c.rarity >= 3 ? 7 : 0)?.plotSprite(r.x + 6, r.y + 6);
        Gfx.icon(c.icon, c.iconIndex, r.x + 6 + 5, r.y + 6 + 5);
        Gfx.text(c.name, r.x + 48, r.y + 20, col, 'b12');
        const kind = c.kind === 'new' ? 'New!' : c.kind === 'rank' ? `Rank ${c.rankFrom} -> ${c.rankTo}` : c.kind === 'passive' ? `Passive${c.rankFrom > 0 ? ` ${c.rankFrom} -> ${c.rankTo}` : ''}` : '';
        Gfx.text(`${RARITY_NAMES[c.rarity]} ${c.family}`, r.x + 48, r.y + 34, COL.GREY, 'p11');
        if (kind) Gfx.text(kind, r.x + 48, r.y + 46, c.kind === 'new' ? COL.GREEN : COL.YELLOW, 'p11');
        let y = r.y + (compact ? 58 : 66);
        for (const line of c.lines) {
            y = Gfx.wrap(line, r.x + 8, y, r.w - 16, COL.WHITE, 'p11', 12);
            if (y > r.y + r.h - 4) break;
        }
    }

    private drawVictory(): void {
        const W = Ui.W;
        const H = Ui.H;
        Pix2D.fillRectTrans(0, 0, W, H, 0, 120);
        const pw = Math.min(360, W - 20);
        const ph = 150;
        const px = (W - pw) >> 1;
        const py = (H - ph) >> 1;
        Gfx.panel(px, py, pw, ph, 'Zone cleared!');
        Gfx.centre(`${this.zoneName} is saved... for now.`, W >> 1, py + 52, COL.WHITE, 'p12');
        Gfx.centre('Continue in Endless mode? Bosses will keep returning.', W >> 1, py + 70, COL.YELLOW, 'p11');
        const bw = (pw - 48) >> 1;
        if (Ui.button({ x: px + 16, y: py + ph - 50, w: bw, h: 32 }, 'Endless mode')) {
            this.victory = false;
            this.bridge.send({ type: 'endless', on: true });
            this.bridge.flush();
        }
        if (Ui.button({ x: px + 32 + bw, y: py + ph - 50, w: bw, h: 32 }, 'Finish run')) {
            this.victory = false;
            this.bridge.send({ type: 'endless', on: false });
            this.bridge.flush();
        }
        Ui.block({ x: 0, y: 0, w: W, h: H });
    }

    private drawPause(): void {
        const W = Ui.W;
        const H = Ui.H;
        Pix2D.fillRectTrans(0, 0, W, H, 0, 120);
        const pw = Math.min(260, W - 20);
        const ph = 220;
        const px = (W - pw) >> 1;
        const py = (H - ph) >> 1;
        Gfx.panel(px, py, pw, ph, 'Paused');
        const bw = pw - 40;
        if (Ui.button({ x: px + 20, y: py + 40, w: bw, h: 32 }, 'Resume')) this.paused = false;
        if (Ui.button({ x: px + 20, y: py + 80, w: bw, h: 32 }, 'Options')) this.host.openOptions();
        if (Ui.button({ x: px + 20, y: py + 120, w: bw, h: 32 }, this.host.options.showFps ? 'Hide FPS (F)' : 'Show FPS (F)')) this.host.options.showFps = !this.host.options.showFps;
        if (Ui.button({ x: px + 20, y: py + 160, w: bw, h: 32 }, 'Quit run')) {
            this.paused = false;
            this.bridge.send({ type: 'quit' });
            this.bridge.flush();
        }
        Ui.block({ x: 0, y: 0, w: W, h: H });
    }
}
