// Client-side entity state driven by simulation snapshots. Movement interpolation, facing and
// animation are the original Client.moveEntity/routeMove/entityFace/entityAnim code; applying a
// snapshot follows the NPC_INFO / PLAYER_INFO decode semantics (moveCode steps, ANIM priorities,
// hitmarks, SPOTANIM) so entities look and move exactly as they would from a real server.
import { Cycle } from '#/client/Cycle.js';

import NpcType from '#/config/NpcType.js';
import SeqType, { PostanimMove, PreanimMove, RestartMode } from '#/config/SeqType.js';
import SpotType from '#/config/SpotType.js';

import ClientEntity from '#/dash3d/ClientEntity.js';
import ClientNpc from '#/dash3d/ClientNpc.js';
import ClientPlayer from '#/dash3d/ClientPlayer.js';
import ClientProj from '#/dash3d/ClientProj.js';
import { BuildArea } from '#/dash3d/CollisionMap.js';
import MapSpotAnim from '#/dash3d/MapSpotAnim.js';

import LinkList from '#/datastruct/LinkList.js';
import { Int32Array2d, TypedArray1d } from '#/util/Arrays.js';

import type { EntityUpdate, Snapshot } from '../../../sim/src/protocol.js';
import type Scene from '#/survivors/Scene.js';

export const MAX_NPCS = 16384;
export const PLAYER_TYPECODE = 2047 << 14;

export default class Entities {
    readonly npc: (ClientNpc | null)[] = new TypedArray1d(MAX_NPCS, null);
    npcIds: Int32Array = new Int32Array(MAX_NPCS);
    npcCount = 0;
    readonly elite = new Uint8Array(MAX_NPCS);
    readonly sleeping = new Uint8Array(MAX_NPCS);
    readonly dying = new Uint8Array(MAX_NPCS);
    player: ClientPlayer = new ClientPlayer();
    readonly projectiles: LinkList<ClientProj> = new LinkList();
    readonly spotanims: LinkList<MapSpotAnim> = new LinkList();
    private readonly tileLastOccupiedCycle: Int32Array[] = new Int32Array2d(BuildArea.SIZE, BuildArea.SIZE);
    private sceneCycle = 0;

    constructor(private readonly scene: Scene) {}

    reset(): void {
        for (let i = 0; i < MAX_NPCS; i++) {
            this.npc[i] = null;
        }
        this.npcCount = 0;
        this.elite.fill(0);
        this.sleeping.fill(0);
        this.dying.fill(0);
        this.projectiles.clear();
        this.spotanims.clear();
        this.player = new ClientPlayer();
    }

    // ---- snapshot application (server packet semantics) ----

    apply(snap: Snapshot): void {
        const p = this.player;
        if (snap.playerSteps.length === 0 && (p.routeX[0] !== snap.playerX || p.routeZ[0] !== snap.playerZ)) {
            // correction (e.g. first tick): PLAYER_INFO op3 teleport
            p.teleport(true, snap.playerX, snap.playerZ);
        }
        for (const dir of snap.playerSteps) {
            p.moveCode(snap.playerRun, dir); // PLAYER_INFO op1/op2
        }

        for (const add of snap.npcAdds) {
            const npc = new ClientNpc();
            this.npc[add.slot] = npc;
            npc.type = NpcType.list(add.npc);
            npc.size = npc.type.size;
            npc.turnspeed = npc.type.turnspeed;
            npc.walkanim = npc.type.walkanim;
            npc.walkanim_b = npc.type.walkanim_b;
            npc.walkanim_l = npc.type.walkanim_r;
            npc.walkanim_r = npc.type.walkanim_l;
            npc.readyanim = npc.type.readyanim;
            npc.health = add.hp;
            npc.totalHealth = add.maxHp;
            npc.teleport(true, add.x, add.z);
            npc.cycle = Cycle.loop;
            this.elite[add.slot] = add.elite;
            this.sleeping[add.slot] = add.sleeping ? 1 : 0;
            this.dying[add.slot] = 0;
            if (add.sleeping) {
                npc.chatMessage = 'Zzz';
                npc.chatTimer = 1 << 30;
            }
        }

        for (const slot of snap.npcRemoves) {
            const npc = this.npc[slot];
            if (npc) {
                npc.type = null;
            }
            this.npc[slot] = null;
        }

        const moves = snap.npcMoves;
        for (let i = 0; i < moves.length; i += 7) {
            const npc = this.npc[moves[i]];
            if (!npc) {
                continue;
            }
            const steps = moves[i + 3];
            const run = moves[i + 6] === 1;
            if (steps === 0) {
                npc.teleport(true, moves[i + 1], moves[i + 2]);
                continue;
            }
            npc.moveCode(run, moves[i + 4]); // NPC_INFO op1
            if (steps > 1) {
                npc.moveCode(run, moves[i + 5]); // NPC_INFO op2
            }
            if (npc.routeX[0] !== moves[i + 1] || npc.routeZ[0] !== moves[i + 2]) {
                npc.teleport(false, moves[i + 1], moves[i + 2]);
            }
        }

        for (const upd of snap.updates) {
            const e: ClientEntity | null = upd.slot === -1 ? this.player : this.npc[upd.slot];
            if (e) {
                this.applyUpdate(e, upd);
            }
        }

        for (const proj of snap.projectiles) {
            this.addProjectile(proj.spot, proj.fromSlot, proj.fromX ?? 0, proj.fromZ ?? 0, proj.toSlot, proj.toX ?? 0, proj.toZ ?? 0, proj.startHeight, proj.endHeight, proj.delay, proj.duration, proj.peak, proj.arc);
        }

        for (const spot of snap.mapSpots) {
            // MAP_ANIM
            const x = spot.x * 128 + 64;
            const z = spot.z * 128 + 64;
            this.spotanims.push(new MapSpotAnim(spot.spot, this.scene.level, x, z, this.scene.getAvH(x, z) - spot.height, Cycle.loop, spot.delay));
        }

        // rebuild npc id list
        this.npcCount = 0;
        for (let i = 0; i < MAX_NPCS; i++) {
            if (this.npc[i]) {
                this.npcIds[this.npcCount++] = i;
            }
        }
    }

    private applyUpdate(e: ClientEntity, upd: EntityUpdate): void {
        if (upd.npcType !== undefined && e instanceof ClientNpc) {
            // CHANGETYPE
            e.type = NpcType.list(upd.npcType);
            e.size = e.type.size;
            e.turnspeed = e.type.turnspeed;
            e.walkanim = e.type.walkanim;
            e.walkanim_b = e.type.walkanim_b;
            e.walkanim_l = e.type.walkanim_r;
            e.walkanim_r = e.type.walkanim_l;
            e.readyanim = e.type.readyanim;
        }

        if (upd.anim !== undefined) {
            Entities.setAnim(e, upd.anim, upd.animDelay ?? 0);
        }

        if (upd.face !== undefined) {
            e.faceEntity = upd.face < 0 ? -1 : upd.face;
        }

        if (upd.faceX !== undefined && upd.faceZ !== undefined) {
            // FACESQUARE uses absolute coords * 2 + 1; we store build-area coords the same way
            e.faceSquareX = (upd.faceX + this.scene.baseX) * 2 + 1;
            e.faceSquareZ = (upd.faceZ + this.scene.baseZ) * 2 + 1;
        }

        if (upd.say !== undefined) {
            e.chatMessage = upd.say.length > 0 ? upd.say : null;
            e.chatTimer = 100;
            e.chatColour = 0;
            e.chatEffect = 0;
        }

        if (upd.hits) {
            for (const hit of upd.hits) {
                e.addHitmark(Cycle.loop, hit.type, hit.dmg);
            }
            e.combatCycle = Cycle.loop + 400;
        }

        if (upd.hp !== undefined) {
            e.health = upd.hp;
        }
        if (upd.maxHp !== undefined) {
            e.totalHealth = upd.maxHp;
        }

        if (upd.spot !== undefined) {
            e.spotanimId = upd.spot;
            e.spotanimHeight = upd.spotHeight ?? 0;
            e.spotanimLastCycle = Cycle.loop + (upd.spotDelay ?? 0);
            e.spotanimFrame = 0;
            e.spotanimCycle = 0;
            if (e.spotanimLastCycle > Cycle.loop) {
                e.spotanimFrame = -1;
            }
            if (e.spotanimId === 65535) {
                e.spotanimId = -1;
            }
        }

        if (upd.dying && e instanceof ClientNpc) {
            const slot = this.npc.indexOf(e);
            if (slot >= 0) {
                this.dying[slot] = 1;
                this.sleeping[slot] = 0;
            }
        }
    }

    // NPC_INFO / PLAYER_INFO ANIM mask semantics
    static setAnim(e: ClientEntity, seqId: number, delay: number): void {
        if (seqId === e.primaryAnim) {
            e.primaryAnimLoop = 0;
        }

        if (e.primaryAnim === seqId && seqId !== -1) {
            const restartMode = SeqType.list[seqId].duplicatebehaviour;
            if (restartMode == RestartMode.RESET) {
                e.primaryAnimFrame = 0;
                e.primaryAnimCycle = 0;
                e.primaryAnimDelay = delay;
                e.primaryAnimLoop = 0;
            } else if (restartMode == RestartMode.RESETLOOP) {
                e.primaryAnimLoop = 0;
            }
        } else if (seqId === -1 || e.primaryAnim === -1 || SeqType.list[seqId].priority >= SeqType.list[e.primaryAnim].priority) {
            e.primaryAnim = seqId;
            e.primaryAnimFrame = 0;
            e.primaryAnimCycle = 0;
            e.primaryAnimDelay = delay;
            e.primaryAnimLoop = 0;
            e.preanimRouteLength = e.routeLength;
        }
    }

    // MAP_PROJANIM equivalent
    private addProjectile(spot: number, fromSlot: number, fromX: number, fromZ: number, toSlot: number, toX: number, toZ: number, h1: number, h2: number, delay: number, duration: number, peak: number, arc: number): void {
        let srcX: number;
        let srcZ: number;
        if (fromSlot === -1) {
            srcX = this.player.x;
            srcZ = this.player.z;
        } else if (fromSlot >= 0 && this.npc[fromSlot]) {
            srcX = this.npc[fromSlot]!.x;
            srcZ = this.npc[fromSlot]!.z;
        } else {
            srcX = fromX * 128 + 64;
            srcZ = fromZ * 128 + 64;
        }

        // target encoding as in the original client: >0 npc index + 1, <0 -(player index + 1)
        let target = 0;
        let dstX = toX * 128 + 64;
        let dstZ = toZ * 128 + 64;
        if (toSlot === -1) {
            target = -1;
            dstX = this.player.x;
            dstZ = this.player.z;
        } else if (toSlot >= 0 && this.npc[toSlot]) {
            target = toSlot + 1;
            dstX = this.npc[toSlot]!.x;
            dstZ = this.npc[toSlot]!.z;
        }

        const proj = new ClientProj(spot, this.scene.level, srcX, this.scene.getAvH(srcX, srcZ) - h1, srcZ, Cycle.loop + delay, Cycle.loop + delay + duration, peak, arc, target, h2);
        proj.setTarget(dstX, this.scene.getAvH(dstX, dstZ) - h2, dstZ, Cycle.loop + delay);
        (proj as ClientProj & { fixedTarget: boolean }).fixedTarget = target === 0;
        this.projectiles.push(proj);
    }

    // ---- per client cycle (20ms) ----

    move(): void {
        this.moveEntity(this.player);
        for (let i = 0; i < this.npcCount; i++) {
            const npc = this.npc[this.npcIds[i]];
            if (npc && npc.type) {
                this.moveEntity(npc);
            }
        }

        for (let i = 0; i < this.npcCount; i++) {
            const npc = this.npc[this.npcIds[i]];
            if (npc && npc.chatTimer > 0) {
                npc.chatTimer--;
                if (npc.chatTimer === 0) {
                    npc.chatMessage = null;
                }
            }
        }
        if (this.player.chatTimer > 0) {
            this.player.chatTimer--;
            if (this.player.chatTimer === 0) {
                this.player.chatMessage = null;
            }
        }
    }

    private moveEntity(e: ClientEntity): void {
        if (e.x < 128 || e.z < 128 || e.x >= 13184 || e.z >= 13184) {
            e.primaryAnim = -1;
            e.spotanimId = -1;
            e.exactMoveEnd = 0;
            e.exactMoveStart = 0;
            e.x = e.routeX[0] * 128 + e.size * 64;
            e.z = e.routeZ[0] * 128 + e.size * 64;
            e.abortRoute();
        }

        if (e.exactMoveEnd > Cycle.loop) {
            this.exactMove1(e);
        } else if (e.exactMoveStart >= Cycle.loop) {
            this.exactMove2(e);
        } else {
            this.routeMove(e);
        }

        this.entityFace(e);
        this.entityAnim(e);
    }

    private exactMove1(e: ClientEntity): void {
        const delta: number = e.exactMoveEnd - Cycle.loop;
        const dstX: number = e.exactStartX * 128 + e.size * 64;
        const dstZ: number = e.exactStartZ * 128 + e.size * 64;
        e.x += ((dstX - e.x) / delta) | 0;
        e.z += ((dstZ - e.z) / delta) | 0;
        e.animDelayMove = 0;
        if (e.exactMoveFacing === 0) {
            e.dstYaw = 1024;
        } else if (e.exactMoveFacing === 1) {
            e.dstYaw = 1536;
        } else if (e.exactMoveFacing === 2) {
            e.dstYaw = 0;
        } else if (e.exactMoveFacing === 3) {
            e.dstYaw = 512;
        }
    }

    private exactMove2(e: ClientEntity): void {
        if (e.exactMoveStart === Cycle.loop || e.primaryAnim === -1 || e.primaryAnimDelay !== 0 || e.primaryAnimCycle + 1 > SeqType.list[e.primaryAnim].getDelay(e.primaryAnimFrame)) {
            const duration: number = e.exactMoveStart - e.exactMoveEnd;
            const delta: number = Cycle.loop - e.exactMoveEnd;
            const dx0: number = e.exactStartX * 128 + e.size * 64;
            const dz0: number = e.exactStartZ * 128 + e.size * 64;
            const dx1: number = e.exactEndX * 128 + e.size * 64;
            const dz1: number = e.exactEndZ * 128 + e.size * 64;
            e.x = ((dx0 * (duration - delta) + dx1 * delta) / duration) | 0;
            e.z = ((dz0 * (duration - delta) + dz1 * delta) / duration) | 0;
        }
        e.animDelayMove = 0;
        if (e.exactMoveFacing === 0) {
            e.dstYaw = 1024;
        } else if (e.exactMoveFacing === 1) {
            e.dstYaw = 1536;
        } else if (e.exactMoveFacing === 2) {
            e.dstYaw = 0;
        } else if (e.exactMoveFacing === 3) {
            e.dstYaw = 512;
        }
        e.yaw = e.dstYaw;
    }

    private routeMove(e: ClientEntity): void {
        e.secondaryAnim = e.readyanim;

        if (e.routeLength === 0) {
            e.animDelayMove = 0;
            return;
        }

        if (e.primaryAnim !== -1 && e.primaryAnimDelay === 0) {
            const seq: SeqType = SeqType.list[e.primaryAnim];
            if (e.preanimRouteLength > 0 && seq.preanim_move === PreanimMove.DELAYMOVE) {
                e.animDelayMove++;
                return;
            }
            if (e.preanimRouteLength <= 0 && seq.postanim_move === PostanimMove.DELAYMOVE) {
                e.animDelayMove++;
                return;
            }
        }

        const x: number = e.x;
        const z: number = e.z;
        const dstX: number = e.routeX[e.routeLength - 1] * 128 + e.size * 64;
        const dstZ: number = e.routeZ[e.routeLength - 1] * 128 + e.size * 64;

        if (dstX - x > 256 || dstX - x < -256 || dstZ - z > 256 || dstZ - z < -256) {
            e.x = dstX;
            e.z = dstZ;
            return;
        }

        if (x < dstX) {
            if (z < dstZ) {
                e.dstYaw = 1280;
            } else if (z > dstZ) {
                e.dstYaw = 1792;
            } else {
                e.dstYaw = 1536;
            }
        } else if (x > dstX) {
            if (z < dstZ) {
                e.dstYaw = 768;
            } else if (z > dstZ) {
                e.dstYaw = 256;
            } else {
                e.dstYaw = 512;
            }
        } else if (z < dstZ) {
            e.dstYaw = 1024;
        } else {
            e.dstYaw = 0;
        }

        let deltaYaw: number = (e.dstYaw - e.yaw) & 0x7ff;
        if (deltaYaw > 1024) {
            deltaYaw -= 2048;
        }

        let seqId: number = e.walkanim_b;
        if (deltaYaw >= -256 && deltaYaw <= 256) {
            seqId = e.walkanim;
        } else if (deltaYaw >= 256 && deltaYaw < 768) {
            seqId = e.walkanim_r;
        } else if (deltaYaw >= -768 && deltaYaw <= -256) {
            seqId = e.walkanim_l;
        }

        if (seqId === -1) {
            seqId = e.walkanim;
        }

        e.secondaryAnim = seqId;

        let moveSpeed: number = 4;
        if (e.yaw !== e.dstYaw && e.faceEntity === -1 && e.turnspeed !== 0) {
            moveSpeed = 2;
        }
        if (e.routeLength > 2) {
            moveSpeed = 6;
        }
        if (e.routeLength > 3) {
            moveSpeed = 8;
        }
        if (e.animDelayMove > 0 && e.routeLength > 1) {
            moveSpeed = 8;
            e.animDelayMove--;
        }
        if (e.routeRun[e.routeLength - 1]) {
            moveSpeed <<= 0x1;
        }

        if (moveSpeed >= 8 && e.secondaryAnim === e.walkanim && e.runanim !== -1) {
            e.secondaryAnim = e.runanim;
        }

        if (x < dstX) {
            e.x += moveSpeed;
            if (e.x > dstX) {
                e.x = dstX;
            }
        } else if (x > dstX) {
            e.x -= moveSpeed;
            if (e.x < dstX) {
                e.x = dstX;
            }
        }
        if (z < dstZ) {
            e.z += moveSpeed;
            if (e.z > dstZ) {
                e.z = dstZ;
            }
        } else if (z > dstZ) {
            e.z -= moveSpeed;
            if (e.z < dstZ) {
                e.z = dstZ;
            }
        }

        if (e.x === dstX && e.z === dstZ) {
            e.routeLength--;
            if (e.preanimRouteLength > 0) {
                e.preanimRouteLength--;
            }
        }
    }

    private entityFace(e: ClientEntity): void {
        if (e.turnspeed === 0) {
            return;
        }

        if (e.faceEntity !== -1 && e.faceEntity < 32768) {
            const npc: ClientNpc | null = this.npc[e.faceEntity];
            if (npc) {
                const dstX: number = e.x - npc.x;
                const dstZ: number = e.z - npc.z;
                if (dstX !== 0 || dstZ !== 0) {
                    e.dstYaw = ((Math.atan2(dstX, dstZ) * 325.949) | 0) & 0x7ff;
                }
            }
        }

        if (e.faceEntity >= 32768) {
            const player = this.player;
            const dstX: number = e.x - player.x;
            const dstZ: number = e.z - player.z;
            if (dstX !== 0 || dstZ !== 0) {
                e.dstYaw = ((Math.atan2(dstX, dstZ) * 325.949) | 0) & 0x7ff;
            }
        }

        if ((e.faceSquareX !== 0 || e.faceSquareZ !== 0) && (e.routeLength === 0 || e.animDelayMove > 0)) {
            const dstX: number = e.x - (e.faceSquareX - this.scene.baseX - this.scene.baseX) * 64;
            const dstZ: number = e.z - (e.faceSquareZ - this.scene.baseZ - this.scene.baseZ) * 64;
            if (dstX !== 0 || dstZ !== 0) {
                e.dstYaw = ((Math.atan2(dstX, dstZ) * 325.949) | 0) & 0x7ff;
            }
            e.faceSquareX = 0;
            e.faceSquareZ = 0;
        }

        const remainingYaw: number = (e.dstYaw - e.yaw) & 0x7ff;
        if (remainingYaw !== 0) {
            if (remainingYaw < e.turnspeed || remainingYaw > 2048 - e.turnspeed) {
                e.yaw = e.dstYaw;
            } else if (remainingYaw > 1024) {
                e.yaw -= e.turnspeed;
            } else {
                e.yaw += e.turnspeed;
            }
            e.yaw &= 0x7ff;

            if (e.secondaryAnim === e.readyanim && e.yaw !== e.dstYaw) {
                if (e.turnanim != -1) {
                    e.secondaryAnim = e.turnanim;
                } else {
                    e.secondaryAnim = e.walkanim;
                }
            }
        }
    }

    private entityAnim(e: ClientEntity): void {
        e.needsForwardDrawPadding = false;

        let seq: SeqType | null;
        if (e.secondaryAnim !== -1) {
            seq = SeqType.list[e.secondaryAnim];
            e.secondaryAnimCycle++;
            if (e.secondaryAnimFrame < seq.numFrames && e.secondaryAnimCycle > seq.getDelay(e.secondaryAnimFrame)) {
                e.secondaryAnimCycle = 0;
                e.secondaryAnimFrame++;
            }
            if (e.secondaryAnimFrame >= seq.numFrames) {
                e.secondaryAnimCycle = 0;
                e.secondaryAnimFrame = 0;
            }
        }

        if (e.spotanimId !== -1 && Cycle.loop >= e.spotanimLastCycle) {
            if (e.spotanimFrame < 0) {
                e.spotanimFrame = 0;
            }
            seq = SpotType.list[e.spotanimId].seq;
            e.spotanimCycle++;
            while (seq && e.spotanimFrame < seq.numFrames && e.spotanimCycle > seq.getDelay(e.spotanimFrame)) {
                e.spotanimCycle -= seq.getDelay(e.spotanimFrame);
                e.spotanimFrame++;
            }
            if (seq && e.spotanimFrame >= seq.numFrames) {
                if (e.spotanimFrame < 0 || e.spotanimFrame >= seq.numFrames) {
                    e.spotanimId = -1;
                }
            }
        }

        if (e.primaryAnim != -1 && e.primaryAnimDelay <= 1) {
            seq = SeqType.list[e.primaryAnim];
            if (seq.preanim_move === PreanimMove.DELAYANIM && e.preanimRouteLength > 0 && Cycle.loop >= e.exactMoveStart && Cycle.loop > e.exactMoveEnd) {
                e.primaryAnimDelay = 1;
                return;
            }
        }

        if (e.primaryAnim !== -1 && e.primaryAnimDelay === 0) {
            seq = SeqType.list[e.primaryAnim];
            e.primaryAnimCycle++;
            while (e.primaryAnimFrame < seq.numFrames && e.primaryAnimCycle > seq.getDelay(e.primaryAnimFrame)) {
                e.primaryAnimCycle -= seq.getDelay(e.primaryAnimFrame);
                e.primaryAnimFrame++;
            }
            if (e.primaryAnimFrame >= seq.numFrames) {
                e.primaryAnimFrame -= seq.loops;
                e.primaryAnimLoop++;
                if (e.primaryAnimLoop >= seq.maxloops) {
                    e.primaryAnim = -1;
                }
                if (e.primaryAnimFrame < 0 || e.primaryAnimFrame >= seq.numFrames) {
                    e.primaryAnim = -1;
                }
            }
            e.needsForwardDrawPadding = seq.reachforward;
        }

        if (e.primaryAnimDelay > 0) {
            e.primaryAnimDelay--;
        }
    }

    // ---- adding to the world for the next frame (Client.addPlayers / addNpcs / addProjectiles / addMapAnim) ----

    addToWorld(worldUpdateNum: number): void {
        this.sceneCycle++;
        const world = this.scene.world;
        const level = this.scene.level;

        const p = this.player;
        if (p.isReady()) {
            p.y = this.scene.getAvH(p.x, p.z, level);
            world.addDynamic(level, p.x, p.y, p.z, p, PLAYER_TYPECODE, p.yaw, 60, p.needsForwardDrawPadding);
        }

        for (const alwaysontop of [true, false]) {
            for (let i = 0; i < this.npcCount; i++) {
                const slot = this.npcIds[i];
                const npc = this.npc[slot];
                const typecode: number = ((slot << 14) + 0x20000000) | 0;
                if (!npc || !npc.isReady() || npc.type?.alwaysontop !== alwaysontop) {
                    continue;
                }
                const x: number = npc.x >> 7;
                const z: number = npc.z >> 7;
                if (x < 0 || x >= BuildArea.SIZE || z < 0 || z >= BuildArea.SIZE) {
                    continue;
                }
                if (npc.size === 1 && (npc.x & 0x7f) === 64 && (npc.z & 0x7f) === 64) {
                    if (this.tileLastOccupiedCycle[x][z] === this.sceneCycle) {
                        continue;
                    }
                    this.tileLastOccupiedCycle[x][z] = this.sceneCycle;
                }
                world.addDynamic(level, npc.x, this.scene.getAvH(npc.x, npc.z, level), npc.z, npc, typecode, npc.yaw, (npc.size - 1) * 64 + 60, npc.needsForwardDrawPadding);
            }
        }

        for (let proj = this.projectiles.head(); proj !== null; proj = this.projectiles.next()) {
            if (proj.level !== level || Cycle.loop > proj.t2) {
                proj.unlink();
            } else if (Cycle.loop >= proj.t1) {
                if (proj.target > 0) {
                    const npc: ClientNpc | null = this.npc[proj.target - 1];
                    if (npc) {
                        proj.setTarget(npc.x, this.scene.getAvH(npc.x, npc.z, proj.level) - proj.h2, npc.z, Cycle.loop);
                    }
                } else if (proj.target < 0) {
                    proj.setTarget(p.x, this.scene.getAvH(p.x, p.z, proj.level) - proj.h2, p.z, Cycle.loop);
                }
                proj.move(worldUpdateNum);
                world.addDynamic(level, proj.x | 0, proj.y | 0, proj.z | 0, proj, -1, proj.yaw, 60, false);
            }
        }

        for (let spot = this.spotanims.head(); spot !== null; spot = this.spotanims.next()) {
            if (spot.level !== level || spot.animComplete) {
                spot.unlink();
            } else if (Cycle.loop >= spot.startCycle) {
                spot.update(worldUpdateNum);
                if (spot.animComplete) {
                    spot.unlink();
                } else {
                    world.addDynamic(spot.level, spot.x, spot.y, spot.z, spot, -1, 0, 60, false);
                }
            }
        }
    }
}
