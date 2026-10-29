// The survivors camera: RS-style orbit camera (same yaw/pitch units and camFollow maths as the
// 2004 client) extended with a wide eased zoom range, a steeper default pitch, movement lead,
// shake, boss-intro pans and boss auto-framing. No roll, ever; every effect honours Options.
import Pix3D from '#/dash3d/Pix3D.js';

export type CameraOptions = {
    shake: number; // 0..100 (0 = off)
    bossIntro: boolean;
    autoFrame: boolean;
    lead: boolean;
};

export const ZOOM_MIN = 600; // close, authentic RS framing
export const ZOOM_MAX = 9600; // tactical, whole arena
export const PITCH_MIN = 128;
export const PITCH_MAX = 470; // near top-down
const DEFAULT_ZOOM = 2600;
const DEFAULT_PITCH = 330;

export default class Camera {
    // output (world units, RS angle units 0..2047)
    camX = 0;
    camY = 0;
    camZ = 0;
    camPitch = DEFAULT_PITCH;
    camYaw = 0;

    // control state
    yaw = 0;
    pitch = DEFAULT_PITCH;
    zoom = DEFAULT_ZOOM;
    targetZoom = DEFAULT_ZOOM;
    targetPitch = DEFAULT_PITCH;
    private yawVelocity = 0;
    private pitchVelocity = 0;

    focusX = 0;
    focusZ = 0;
    private leadX = 0;
    private leadZ = 0;
    private lastPlayerX = 0;
    private lastPlayerZ = 0;

    // shake
    private shakeAmp = 0;
    private shakePhase = 0;

    // boss intro pan
    private introActive = false;
    private introCycle = 0;
    private introX = 0;
    private introZ = 0;
    private introFromX = 0;
    private introFromZ = 0;
    introName: string | null = null;
    private static readonly INTRO_IN = 40; // cycles (0.8s) eased pan to boss
    private static readonly INTRO_HOLD = 45; // cycles (0.9s) hold with name
    // total 1.7s, then snap back to the player

    // auto-framing extra zoom (eased)
    private frameZoom = 0;

    options: CameraOptions = { shake: 60, bossIntro: true, autoFrame: true, lead: true };

    reset(playerX: number, playerZ: number): void {
        this.focusX = playerX;
        this.focusZ = playerZ;
        this.lastPlayerX = playerX;
        this.lastPlayerZ = playerZ;
        this.leadX = 0;
        this.leadZ = 0;
        this.introActive = false;
        this.introName = null;
        this.shakeAmp = 0;
        this.frameZoom = 0;
    }

    zoomBy(delta: number): void {
        // multiplicative steps feel even across the range; easing happens in update()
        const factor = delta > 0 ? 1.12 : 1 / 1.12;
        this.targetZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.targetZoom * factor));
        // steeper pitch as you zoom out keeps the horde readable
        const t = (this.targetZoom - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN);
        this.targetPitch = Math.max(this.pitch, Math.round(DEFAULT_PITCH - 140 + t * 280));
    }

    rotate(dyaw: number, dpitch: number): void {
        this.yaw = (this.yaw + dyaw) & 0x7ff;
        this.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, this.pitch + dpitch));
        this.targetPitch = this.pitch;
    }

    shake(strength: number): void {
        const s = (strength * this.options.shake) / 100;
        if (s > this.shakeAmp) {
            this.shakeAmp = s;
        }
    }

    startBossIntro(x: number, z: number, name: string): void {
        if (!this.options.bossIntro) {
            return;
        }
        this.introActive = true;
        this.introCycle = 0;
        this.introX = x;
        this.introZ = z;
        this.introFromX = this.focusX;
        this.introFromZ = this.focusZ;
        this.introName = name;
    }

    get inIntro(): boolean {
        return this.introActive;
    }

    // keys: held arrow keys (1=left,2=right,3=up,4=down) like the RS client
    update(keyLeft: boolean, keyRight: boolean, keyUp: boolean, keyDown: boolean, playerX: number, playerZ: number, boss: { x: number; z: number } | null, getHeight: (x: number, z: number) => number): void {
        // arrow-key orbit, same velocity model as Client.followCamera
        if (keyLeft) {
            this.yawVelocity += ((-this.yawVelocity - 24) / 2) | 0;
        } else if (keyRight) {
            this.yawVelocity += ((24 - this.yawVelocity) / 2) | 0;
        } else {
            this.yawVelocity = (this.yawVelocity / 2) | 0;
        }
        if (keyUp) {
            this.pitchVelocity += ((12 - this.pitchVelocity) / 2) | 0;
        } else if (keyDown) {
            this.pitchVelocity += ((-this.pitchVelocity - 12) / 2) | 0;
        } else {
            this.pitchVelocity = (this.pitchVelocity / 2) | 0;
        }
        this.yaw = ((this.yaw + this.yawVelocity / 2) | 0) & 0x7ff;
        if (this.pitchVelocity !== 0) {
            this.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, this.pitch + ((this.pitchVelocity / 2) | 0)));
            this.targetPitch = this.pitch;
        }

        // eased zoom / pitch (no sudden jumps)
        this.zoom += (this.targetZoom - this.zoom) * 0.15;
        this.pitch += Math.round((this.targetPitch - this.pitch) * 0.12);

        // lead in the direction of travel
        const vx = playerX - this.lastPlayerX;
        const vz = playerZ - this.lastPlayerZ;
        this.lastPlayerX = playerX;
        this.lastPlayerZ = playerZ;
        const leadScale = this.options.lead ? 18 : 0;
        this.leadX += (vx * leadScale - this.leadX) * 0.04;
        this.leadZ += (vz * leadScale - this.leadZ) * 0.04;
        const maxLead = 128 * 3;
        this.leadX = Math.max(-maxLead, Math.min(maxLead, this.leadX));
        this.leadZ = Math.max(-maxLead, Math.min(maxLead, this.leadZ));

        let goalX = playerX + this.leadX;
        let goalZ = playerZ + this.leadZ;

        // auto-framing: keep player and boss on screen by moving focus between them and easing zoom out
        let wantFrame = 0;
        if (boss && this.options.autoFrame && !this.introActive) {
            const dx = boss.x - playerX;
            const dz = boss.z - playerZ;
            const dist = Math.sqrt(dx * dx + dz * dz);
            goalX = playerX + dx * 0.35;
            goalZ = playerZ + dz * 0.35;
            const needed = dist * 1.25 + 900;
            wantFrame = Math.max(0, needed - this.zoom);
        }
        this.frameZoom += (wantFrame - this.frameZoom) * 0.03;

        if (this.introActive) {
            this.introCycle++;
            const t = Math.min(1, this.introCycle / Camera.INTRO_IN);
            const e = t * t * (3 - 2 * t); // smoothstep ease
            goalX = this.introFromX + (this.introX - this.introFromX) * e;
            goalZ = this.introFromZ + (this.introZ - this.introFromZ) * e;
            this.focusX = goalX;
            this.focusZ = goalZ;
            if (this.introCycle >= Camera.INTRO_IN + Camera.INTRO_HOLD) {
                this.introActive = false;
                this.introName = null;
                // snap back to the player
                this.focusX = playerX;
                this.focusZ = playerZ;
                this.leadX = 0;
                this.leadZ = 0;
            }
        } else {
            // eased follow (exponential smoothing; the RS client uses /16 per cycle)
            this.focusX += (goalX - this.focusX) / 10;
            this.focusZ += (goalZ - this.focusZ) / 10;
        }

        // shake decays every cycle
        this.shakePhase++;
        this.shakeAmp *= 0.9;
        if (this.shakeAmp < 0.5) {
            this.shakeAmp = 0;
        }

        const distance = Math.min(ZOOM_MAX * 1.4, this.zoom + this.frameZoom);
        const fx = this.focusX | 0;
        const fz = this.focusZ | 0;
        const fy = getHeight(fx, fz) - 50;
        this.follow(this.pitch | 0, this.yaw, fx, fy, fz, distance | 0);

        if (this.shakeAmp > 0) {
            // translational shake only (x/y/z) - no roll, small pitch wobble
            const a = this.shakeAmp;
            this.camX += (Math.sin(this.shakePhase * 1.7) * a) | 0;
            this.camY += (Math.sin(this.shakePhase * 2.3 + 1) * a) | 0;
            this.camZ += (Math.sin(this.shakePhase * 1.9 + 2) * a) | 0;
        }
    }

    // Client.camFollow
    private follow(pitch: number, yaw: number, targetX: number, targetY: number, targetZ: number, distance: number): void {
        const invPitch: number = (2048 - pitch) & 0x7ff;
        const invYaw: number = (2048 - yaw) & 0x7ff;

        let x: number = 0;
        let y: number = 0;
        let z: number = distance;
        let sin: number;
        let cos: number;
        let tmp: number;

        if (invPitch !== 0) {
            sin = Pix3D.sinTable[invPitch];
            cos = Pix3D.cosTable[invPitch];
            tmp = (y * cos - distance * sin) >> 16;
            z = (y * sin + distance * cos) >> 16;
            y = tmp;
        }

        if (invYaw !== 0) {
            sin = Pix3D.sinTable[invYaw];
            cos = Pix3D.cosTable[invYaw];
            tmp = (z * sin + x * cos) >> 16;
            z = (z * cos - x * sin) >> 16;
            x = tmp;
        }

        this.camX = targetX - x;
        this.camY = targetY - y;
        this.camZ = targetZ - z;
        this.camPitch = pitch;
        this.camYaw = yaw;
    }
}
