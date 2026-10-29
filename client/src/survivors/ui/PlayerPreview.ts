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

    draw(cx: number, cy: number, zoom: number = 700): void {
        const model = this.player.getTempModel();
        if (!model) return;
        const ox = Pix3D.originX;
        const oy = Pix3D.originY;
        Pix3D.originX = cx;
        Pix3D.originY = cy;
        const xan = 80;
        const eyeY = ((Pix3D.sinTable[xan] * zoom) >> 16) - 90;
        const eyeZ = (Pix3D.cosTable[xan] * zoom) >> 16;
        model.objRender(0, this.yaw & 0x7ff, 0, xan, 0, eyeY, eyeZ);
        Pix3D.originX = ox;
        Pix3D.originY = oy;
    }
}
