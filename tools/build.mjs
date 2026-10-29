// Bundles the survivors client + simulation worker and assembles a fully static dist/ folder.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.join(ROOT, 'dist');
const dev = process.argv.includes('--dev');

if (!fs.existsSync(path.join(ROOT, 'data/game.json'))) {
    console.error('Missing data/ - run `npm run setup` first.');
    process.exit(1);
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const common = {
    bundle: true,
    format: 'esm',
    target: 'es2022',
    sourcemap: true,
    minify: !dev,
    tsconfig: path.join(ROOT, 'tsconfig.json'),
    logLevel: 'info',
    define: {
        'process.env.BUILD_TIME': JSON.stringify(new Date().toISOString())
    }
};

await build({ ...common, entryPoints: [path.join(ROOT, 'client/src/survivors/main.ts')], outfile: path.join(DIST, 'client.js') });
if (fs.existsSync(path.join(ROOT, 'sim/src/worker.ts'))) {
    await build({ ...common, entryPoints: [path.join(ROOT, 'sim/src/worker.ts')], outfile: path.join(DIST, 'simworker.js') });
}

fs.copyFileSync(path.join(ROOT, 'web/index.html'), path.join(DIST, 'index.html'));
fs.copyFileSync(path.join(ROOT, 'client/src/3rdparty/tinymidipcm/tinymidipcm.wasm'), path.join(DIST, 'tinymidipcm.wasm'));
const sf2 = path.join(ROOT, 'vendor/engine/public/client/SCC1_Florestan.sf2');
if (fs.existsSync(sf2)) {
    fs.copyFileSync(sf2, path.join(DIST, 'SCC1_Florestan.sf2'));
}
fs.cpSync(path.join(ROOT, 'data'), path.join(DIST, 'data'), { recursive: true });

let total = 0;
const walk = d => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else total += fs.statSync(p).size;
    }
};
walk(DIST);
console.log(`dist/ ready (${(total / 1048576).toFixed(1)} MB). Serve it with any static file server, e.g. npm run serve`);
