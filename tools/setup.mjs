// Fetches the Lost City engine + content at pinned commits, packs the 2004 cache
// with the engine's own tooling, then extracts the data the survivors build needs.
// Everything lands in vendor/ and data/ (both gitignored).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const VENDOR = path.join(ROOT, 'vendor');

const REPOS = [
    { dir: 'engine', url: 'https://github.com/LostCityRS/Engine-TS', sha: '1d25566cb53e7af1b1cb18ade8af996316c19614' },
    { dir: 'content', url: 'https://github.com/LostCityRS/Content', sha: '65b754f768b79b941b21b2a1eb3b0d1ecae3cdfe' }
];

function run(cmd, cwd) {
    console.log(`> ${cmd}${cwd ? `   (in ${path.relative(ROOT, cwd) || '.'})` : ''}`);
    execSync(cmd, { cwd: cwd ?? ROOT, stdio: 'inherit' });
}

fs.mkdirSync(VENDOR, { recursive: true });

for (const repo of REPOS) {
    const dir = path.join(VENDOR, repo.dir);
    if (fs.existsSync(path.join(dir, '.git'))) {
        const head = execSync('git rev-parse HEAD', { cwd: dir }).toString().trim();
        if (head === repo.sha) {
            console.log(`${repo.dir}: already at ${repo.sha.slice(0, 7)}`);
            continue;
        }
    } else {
        fs.mkdirSync(dir, { recursive: true });
        run('git init -q', dir);
        run(`git remote add origin ${repo.url}`, dir);
    }

    run(`git fetch -q --depth 1 origin ${repo.sha}`, dir);
    run('git checkout -q FETCH_HEAD', dir);
}

const engine = path.join(VENDOR, 'engine');
if (!fs.existsSync(path.join(engine, 'node_modules'))) {
    run('npm install --no-audit --no-fund --ignore-scripts', engine);
}

if (!fs.existsSync(path.join(engine, 'data/pack/main_file_cache.dat'))) {
    run('npm run build', engine);
}

run('npx tsx tools/extract.ts');

console.log('\nSetup complete. Next: npm run build && npm run serve');
