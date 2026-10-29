// Loads the 2004 cache from the static build (data/cache) the same way Client.maininit does from the
// web server, but without CRC-busting URLs, the update-server socket or the title screen.
import { gunzipSync } from 'fflate';

import FloType from '#/config/FloType.js';
import IdkType from '#/config/IdkType.js';
import IfType from '#/config/IfType.js';
import LocType from '#/config/LocType.js';
import NpcType from '#/config/NpcType.js';
import ObjType from '#/config/ObjType.js';
import SeqType from '#/config/SeqType.js';
import SpotType from '#/config/SpotType.js';
import VarBitType from '#/config/VarBitType.js';
import VarpType from '#/config/VarpType.js';

import AnimFrame from '#/dash3d/AnimFrame.js';
import Model from '#/dash3d/Model.js';
import Pix3D from '#/dash3d/Pix3D.js';

import Pix32 from '#/graphics/Pix32.js';
import Pix8 from '#/graphics/Pix8.js';
import PixFont from '#/graphics/PixFont.js';

import JagFile from '#/io/JagFile.js';
import OnDemand from '#/io/OnDemand.js';
import Packet from '#/io/Packet.js';

import JagFX from '#/sound/JagFX.js';

import { downloadUrl } from '#/util/JsUtil.js';

export type Fonts = { p11: PixFont; p12: PixFont; b12: PixFont; q8: PixFont };

export default class Assets {
    static fonts: Fonts;
    static title: JagFile;
    static media: JagFile;
    static onDemand: OnDemand;
    static game: GameJson;

    private static pix8Cache = new Map<string, Pix8 | null>();
    private static pix32Cache = new Map<string, Pix32 | null>();

    static async load(base: string, app: { db: unknown; ingame: boolean }, progress: (msg: string, pct: number) => Promise<void>): Promise<void> {
        await progress('Loading game data', 5);

        const [title, config, interfaces, media, textures, sounds, versionlist, bundle, game] = await Promise.all([
            downloadUrl(`${base}/cache/title`),
            downloadUrl(`${base}/cache/config`),
            downloadUrl(`${base}/cache/interface`),
            downloadUrl(`${base}/cache/media`),
            downloadUrl(`${base}/cache/textures`),
            downloadUrl(`${base}/cache/sounds`),
            downloadUrl(`${base}/cache/versionlist`),
            downloadUrl(`${base}/cache/ondemand.bin`),
            fetch(`${base}/game.json`).then(r => r.json() as Promise<GameJson>)
        ]);

        Assets.game = game;
        await progress('Unpacking fonts', 30);
        Assets.title = new JagFile(title);
        Assets.fonts = {
            p11: PixFont.depack(Assets.title, 'p11_full', false),
            p12: PixFont.depack(Assets.title, 'p12_full', false),
            b12: PixFont.depack(Assets.title, 'b12_full', false),
            q8: PixFont.depack(Assets.title, 'q8_full', true)
        };

        OnDemand.staticBundle = OnDemand.parseStaticBundle(bundle);
        Assets.onDemand = new OnDemand(new JagFile(versionlist), app);
        AnimFrame.init(Assets.onDemand.getAnimFrameCount());
        Model.init(Assets.onDemand.getFileCount(0), Assets.onDemand);

        await progress('Unpacking animations', 45);
        const anims = OnDemand.staticBundle[1];
        for (let i = 0; i < anims.length; i++) {
            const raw = anims[i];
            if (raw) {
                AnimFrame.unpack(gunzipSync(raw.subarray(0, raw.length - 2)));
            }
        }

        await progress('Unpacking models', 60);
        const models = OnDemand.staticBundle[0];
        for (let i = 0; i < models.length; i++) {
            const raw = models[i];
            if (raw) {
                Model.unpack(i, gunzipSync(raw.subarray(0, raw.length - 2)));
            }
        }

        await progress('Unpacking textures', 75);
        Assets.media = new JagFile(media);
        Pix3D.unpackTextures(new JagFile(textures));
        Pix3D.initColourTable(0.8);
        Pix3D.initPool(20);

        await progress('Unpacking config', 85);
        const configJag = new JagFile(config);
        SeqType.init(configJag);
        LocType.init(configJag);
        FloType.init(configJag);
        ObjType.init(configJag, true);
        NpcType.init(configJag);
        IdkType.init(configJag);
        SpotType.init(configJag);
        VarpType.init(configJag);
        VarBitType.init(configJag);

        await progress('Unpacking sounds', 90);
        JagFX.init(new Packet(new JagFile(sounds).read('sounds.dat')));

        await progress('Unpacking interfaces', 95);
        IfType.init(new JagFile(interfaces), Assets.media, [Assets.fonts.p11, Assets.fonts.p12, Assets.fonts.b12, Assets.fonts.q8]);
    }

    static pix8(name: string, index: number = 0): Pix8 | null {
        const key = `${name}:${index}`;
        if (!this.pix8Cache.has(key)) {
            try {
                this.pix8Cache.set(key, Pix8.depack(this.media, name, index));
            } catch (_e) {
                this.pix8Cache.set(key, null);
            }
        }
        return this.pix8Cache.get(key) ?? null;
    }

    static pix32(name: string, index: number = 0): Pix32 | null {
        const key = `${name}:${index}`;
        if (!this.pix32Cache.has(key)) {
            try {
                this.pix32Cache.set(key, Pix32.depack(this.media, name, index));
            } catch (_e) {
                this.pix32Cache.set(key, null);
            }
        }
        return this.pix32Cache.get(key) ?? null;
    }

    static titlePix8(name: string, index: number = 0): Pix8 | null {
        const key = `title:${name}:${index}`;
        if (!this.pix8Cache.has(key)) {
            try {
                this.pix8Cache.set(key, Pix8.depack(this.title, name, index));
            } catch (_e) {
                this.pix8Cache.set(key, null);
            }
        }
        return this.pix8Cache.get(key) ?? null;
    }

    static mapFile(x: number, z: number, type: 0 | 1): Uint8Array | null {
        const file = this.onDemand.getMapFile(x, z, type);
        if (file === -1) {
            return null;
        }
        const raw = OnDemand.staticBundle?.[3]?.[file];
        if (!raw) {
            return null;
        }
        return gunzipSync(raw.subarray(0, raw.length - 2));
    }

    static midi(id: number): Uint8Array | null {
        const raw = OnDemand.staticBundle?.[2]?.[id];
        if (!raw) {
            return null;
        }
        return gunzipSync(raw.subarray(0, raw.length - 2));
    }
}

export type GameJson = {
    seqs: Record<string, number>;
    spotanims: Record<string, number>;
    objs: Record<string, number>;
    locs: Record<string, number>;
    midis: Record<string, number>;
    synths: Record<string, number>;
    idks: Record<string, number>;
};
