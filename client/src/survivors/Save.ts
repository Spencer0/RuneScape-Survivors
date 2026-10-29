// Local profile persistence: IndexedDB (one record, written atomically with a backup of the previous
// version), plus Export/Import as a JSON file. Runs never write the save mid-run, so reloading during
// a run can never corrupt progress.
import { emptyProfile, sanitizeProfile, type Profile } from '../../../sim/src/meta.js';

const DB_NAME = 'gielinor-survivors';
const STORE = 'save';

function open(): Promise<IDBDatabase | null> {
    return new Promise(resolve => {
        try {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(STORE);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        } catch (_e) {
            resolve(null);
        }
    });
}

function get(db: IDBDatabase, key: string): Promise<unknown> {
    return new Promise(resolve => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(undefined);
    });
}

export default class Save {
    private static db: IDBDatabase | null = null;
    static profile: Profile = emptyProfile();
    static available = false;

    static async load(): Promise<Profile> {
        this.db = await open();
        this.available = this.db !== null;
        if (!this.db) {
            this.profile = emptyProfile();
            this.profile.created = Date.now();
            return this.profile;
        }
        for (const key of ['profile', 'profile_prev']) {
            const raw = await get(this.db, key);
            if (raw === undefined) continue;
            try {
                this.profile = sanitizeProfile(typeof raw === 'string' ? JSON.parse(raw) : raw);
                return this.profile;
            } catch (e) {
                console.warn(`save '${key}' unreadable`, e);
            }
        }
        // first launch: create the local profile silently
        this.profile = emptyProfile();
        this.profile.created = Date.now();
        await this.write();
        return this.profile;
    }

    static async write(): Promise<void> {
        if (!this.db) return;
        const json = JSON.stringify(this.profile);
        const db = this.db;
        await new Promise<void>(resolve => {
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            const prev = store.get('profile');
            prev.onsuccess = () => {
                if (prev.result !== undefined) store.put(prev.result, 'profile_prev');
                store.put(json, 'profile');
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
            tx.onabort = () => resolve();
        });
    }

    static exportFile(): void {
        const blob = new Blob([JSON.stringify(this.profile, null, 1)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gielinor-survivors-save-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // opens the OS file picker; resolves to an error message or null on success
    static importFile(): Promise<string | null> {
        return new Promise(resolve => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,application/json';
            input.style.display = 'none';
            input.onchange = async () => {
                const file = input.files?.[0];
                document.body.removeChild(input);
                if (!file) return resolve('No file chosen');
                try {
                    this.profile = sanitizeProfile(JSON.parse(await file.text()));
                    await this.write();
                    resolve(null);
                } catch (e) {
                    resolve(`Import failed: ${(e as Error).message}`);
                }
            };
            document.body.appendChild(input);
            input.click();
        });
    }
}
