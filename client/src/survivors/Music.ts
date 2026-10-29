// Zone music from the 2004 cache (midi archive), played with the client's tinymidipcm synth.
// audio.js creates window.audioContext (with the iOS unlock fix) that tinymidipcm renders into
import '#3rdparty/audio.js';
import { playMidi, setMidiVolume, stopMidi } from '#3rdparty/tinymidipcm.js';

import Assets from '#/survivors/Assets.js';

export default class Music {
    private static current = -1;
    private static unlocked = false;
    private static pending: { id: number; volume: number } | null = null;

    // browsers only allow audio after a user gesture
    static unlock(): void {
        if (this.unlocked) return;
        this.unlocked = true;
        if (this.pending) {
            const p = this.pending;
            this.pending = null;
            this.current = -1;
            this.play(p.id, p.volume);
        }
    }

    private static requested = -1;

    static play(id: number, volume: number): void {
        this.requested = id;
        if (!this.unlocked) {
            this.pending = { id, volume };
            return;
        }
        if (id === this.current) return;
        this.current = id;
        if (volume <= 0) {
            stopMidi(false);
            return;
        }
        const data = Assets.midi(id);
        if (!data) return;
        try {
            playMidi(data, this.toVol(volume), true);
        } catch (e) {
            console.warn('midi', e);
        }
    }

    static setVolume(volume: number): void {
        if (volume <= 0) {
            stopMidi(false);
            this.current = -1;
            return;
        }
        if (this.current === -1 && this.requested >= 0) {
            this.play(this.requested, volume);
            return;
        }
        try {
            setMidiVolume(this.toVol(volume));
        } catch (_e) {
            // ignore
        }
    }

    private static toVol(v: number): number {
        // dB like the RS client's music settings (0, -4, -8, -12)
        return -((100 - v) * 0.25);
    }
}
