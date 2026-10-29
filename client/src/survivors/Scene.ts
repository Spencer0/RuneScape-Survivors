// The rendered arena: World + heightmaps + ground objects, built with the shared ArenaBuild (the
// equivalent of Client's REBUILD_NORMAL -> mapBuild path) and the original showObject/getAvH logic.
import ClientBuild from '#/client/ClientBuild.js';
import LocType from '#/config/LocType.js';
import ObjType from '#/config/ObjType.js';
import { LocLayer } from '#/dash3d/LocLayer.js';
import { LOC_SHAPE_TO_LAYER } from '#/dash3d/LocShape.js';

import ClientObj from '#/dash3d/ClientObj.js';
import CollisionMap, { BuildArea } from '#/dash3d/CollisionMap.js';
import { MapFlag } from '#/dash3d/MapFlag.js';
import Pix3D from '#/dash3d/Pix3D.js';
import World from '#/dash3d/World.js';

import LinkList from '#/datastruct/LinkList.js';
import Pix32 from '#/graphics/Pix32.js';
import { Int32Array3d, TypedArray3d, Uint8Array3d } from '#/util/Arrays.js';

import Assets from '#/survivors/Assets.js';
import { buildArenaScene, type ExtraLoc } from '#/survivors/ArenaBuild.js';

export default class Scene {
    readonly mapl: Uint8Array[][] = new Uint8Array3d(BuildArea.LEVELS, BuildArea.SIZE, BuildArea.SIZE);
    readonly groundh: Int32Array[][] = new Int32Array3d(BuildArea.LEVELS, BuildArea.SIZE + 1, BuildArea.SIZE + 1);
    readonly world: World = new World(this.groundh, BuildArea.SIZE, BuildArea.LEVELS, BuildArea.SIZE);
    readonly collision: CollisionMap[] = [];
    readonly groundObj: (LinkList<ClientObj> | null)[][][] = new TypedArray3d(BuildArea.LEVELS, BuildArea.SIZE, BuildArea.SIZE, null);
    readonly minimap: Pix32 = new Pix32(512, 512);

    baseX = 0;
    baseZ = 0;
    level = 0;
    built = false;

    constructor() {
        for (let level = 0; level < BuildArea.LEVELS; level++) {
            this.collision[level] = new CollisionMap();
        }
    }

    build(centreZoneX: number, centreZoneZ: number, extraLocs: ExtraLoc[]): void {
        Pix3D.clearTexels();
        LocType.mc1?.clear();
        LocType.mc2?.clear();
        ObjType.modelCache?.clear();

        for (let level = 0; level < BuildArea.LEVELS; level++) {
            for (let x = 0; x < BuildArea.SIZE; x++) {
                for (let z = 0; z < BuildArea.SIZE; z++) {
                    this.groundObj[level][x][z] = null;
                    this.mapl[level][x][z] = 0;
                }
            }
        }

        const scene = buildArenaScene((mx, mz, type) => Assets.mapFile(mx, mz, type), centreZoneX, centreZoneZ, this.groundh, this.mapl, this.world, this.collision, extraLocs);
        this.baseX = scene.baseX;
        this.baseZ = scene.baseZ;
        this.built = true;
        LocType.mc1?.clear();
        Pix3D.initPool(20);
    }

    getAvH(sceneX: number, sceneZ: number, level: number = this.level): number {
        const tileX: number = sceneX >> 7;
        const tileZ: number = sceneZ >> 7;

        if (tileX < 0 || tileZ < 0 || tileX > 103 || tileZ > 103) {
            return 0;
        }

        let realLevel: number = level;
        if (level < 3 && (this.mapl[1][tileX][tileZ] & MapFlag.LinkBelow) !== 0) {
            realLevel = level + 1;
        }

        const tileLocalX: number = sceneX & 0x7f;
        const tileLocalZ: number = sceneZ & 0x7f;
        const y00: number = (this.groundh[realLevel][tileX][tileZ] * (128 - tileLocalX) + this.groundh[realLevel][tileX + 1][tileZ] * tileLocalX) >> 7;
        const y11: number = (this.groundh[realLevel][tileX][tileZ + 1] * (128 - tileLocalX) + this.groundh[realLevel][tileX + 1][tileZ + 1] * tileLocalX) >> 7;
        return (y00 * (128 - tileLocalZ) + y11 * tileLocalZ) >> 7;
    }

    // OBJ_ADD / OBJ_DEL equivalents
    addObj(x: number, z: number, id: number, count: number, uid: number): void {
        let list = this.groundObj[this.level][x][z];
        if (!list) {
            list = this.groundObj[this.level][x][z] = new LinkList();
        }
        const obj = new ClientObj(id, count);
        (obj as ClientObj & { uid: number }).uid = uid;
        list.push(obj);
        this.showObject(x, z);
    }

    delObj(x: number, z: number, uid: number): void {
        const list = this.groundObj[this.level][x][z];
        if (!list) {
            return;
        }
        for (let obj = list.head(); obj !== null; obj = list.next()) {
            if ((obj as ClientObj & { uid: number }).uid === uid) {
                obj.unlink();
                break;
            }
        }
        if (!list.head()) {
            this.groundObj[this.level][x][z] = null;
        }
        this.showObject(x, z);
    }

    clearObjs(): void {
        for (let x = 0; x < BuildArea.SIZE; x++) {
            for (let z = 0; z < BuildArea.SIZE; z++) {
                if (this.groundObj[this.level][x][z]) {
                    this.groundObj[this.level][x][z] = null;
                    this.world.delObj(this.level, x, z);
                }
            }
        }
    }

    // ported from Client.showObject
    showObject(x: number, z: number): void {
        const objs = this.groundObj[this.level][x][z];
        if (!objs) {
            this.world.delObj(this.level, x, z);
            return;
        }

        let topCost: number = -99999999;
        let topObj: ClientObj | null = null;

        for (let obj = objs.head(); obj !== null; obj = objs.next()) {
            const type: ObjType = ObjType.list(obj.id);
            let cost: number = type.cost;

            if (type.stackable) {
                cost *= obj.count + 1;
            }

            if (cost > topCost) {
                topCost = cost;
                topObj = obj;
            }
        }

        if (!topObj) {
            return;
        }

        objs.pushFront(topObj);

        let bottomObj: ClientObj | null = null;
        let middleObj: ClientObj | null = null;
        for (let obj = objs.head(); obj !== null; obj = objs.next()) {
            if (obj.id !== topObj.id && bottomObj === null) {
                bottomObj = obj;
            }

            if (obj.id !== topObj.id && bottomObj && obj.id !== bottomObj.id && middleObj === null) {
                middleObj = obj;
            }
        }

        const typecode: number = (x + (z << 7) + 0x60000000) | 0;
        this.world.setObj(x, z, this.getAvH(x * 128 + 64, z * 128 + 64, this.level), this.level, typecode, topObj, middleObj, bottomObj);
    }

    // LOC_ADD_CHANGE / LOC_DEL equivalent (ported from Client.locChangeUnchecked) for caches etc.
    setLoc(x: number, z: number, id: number, shape: number, angle: number): void {
        const level = this.level;
        if (x < 1 || z < 1 || x > 102 || z > 102) {
            return;
        }
        const layer = LOC_SHAPE_TO_LAYER[shape];
        let typecode = 0;
        if (layer === LocLayer.WALL) {
            typecode = this.world.wallType(level, x, z);
        } else if (layer === LocLayer.WALL_DECOR) {
            typecode = this.world.decorType(level, z, x);
        } else if (layer === LocLayer.GROUND) {
            typecode = this.world.sceneType(level, x, z);
        } else if (layer === LocLayer.GROUND_DECOR) {
            typecode = this.world.gdType(level, x, z);
        }

        if (typecode !== 0) {
            if (layer === LocLayer.WALL) {
                this.world.delWall(level, x, z);
            } else if (layer === LocLayer.WALL_DECOR) {
                this.world.delDecor(level, x, z);
            } else if (layer === LocLayer.GROUND) {
                this.world.delLoc(level, x, z);
            } else if (layer === LocLayer.GROUND_DECOR) {
                this.world.delGroundDecor(level, x, z);
            }
        }

        if (id >= 0) {
            let tileLevel = level;
            if (level < 3 && (this.mapl[1][x][z] & MapFlag.LinkBelow) !== 0) {
                tileLevel = level + 1;
            }
            ClientBuild.changeLocUnchecked(level, x, z, id, shape, angle, tileLevel, this.groundh, this.world, null);
        }
    }
}
