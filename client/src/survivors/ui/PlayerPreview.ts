// A ClientPlayer rendered inside the UI with Model.objRender, like the 2004 character-design
// interface's model component, idling on its ready animation.
import SeqType from '#/config/SeqType.js';
import ClientPlayer from '#/dash3d/ClientPlayer.js';
import Pix3D from '#/dash3d/Pix3D.js';
import type Packet from '#/io/Packet.js';

export default class PlayerPreview {
    readonly player = new ClientPlayer();
    yaw = 1024;
    private frame = 0;
    private cycle = 0;

    setAppearance(packet: Packet): void {
        this.player.setAppearance(packet);
        this.player.primaryAnim = -1;
        this.player.secondaryAnim = this.player.readyanim;
    }

    tick(): void {
        const id = this.player.readyanim;
        if (id < 0) return;
        const seq = SeqType.list[id];
        this.player.secondaryAnim = id;
        if (++this.cycle > seq.getDelay(this.frame)) {
            this.cycle = 0;
            this.frame++;
            if (this.frame >= seq.numFrames) this.frame = 0;
        }
        this.player.secondaryAnimFrame = this.frame;
        this.player.secondaryAnimCycle = this.cycle;
    }

    // draws the player standing with its feet at (cx, feetY), about `height` px tall
    draw(cx: number, feetY: number, height: number): void {
        const model = this.player.getTempModel();
        if (!model) return;
        const ox = Pix3D.originX;
        const oy = Pix3D.originY;
        const xan = 60;
        const zoom = Math.max(240, ((240 * 512) / Math.max(40, height)) | 0); // a player model is ~240 units tall
        const eyeY = (Pix3D.sinTable[xan] * zoom) >> 16;
        const eyeZ = (Pix3D.cosTable[xan] * zoom) >> 16;
        // the eye sits on the pitched view ray through the model origin (its feet), so the feet
        // project exactly onto (originX, originY)
        Pix3D.originX = cx;
        Pix3D.originY = feetY;
        model.objRender(0, this.yaw & 0x7ff, 0, xan, 0, eyeY, eyeZ);
        Pix3D.originX = ox;
        Pix3D.originY = oy;
    }
}
