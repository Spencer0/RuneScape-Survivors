// Dev helper: plays the built game in headless Chromium with random walk clicks, picks cards,
// and saves screenshots of interesting moments. usage: node tools/playtest.mjs <url> <outDir> <seconds>
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');

const [url, outDir, secs = '60', w = '765', h = '503'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: parseInt(w), height: parseInt(h) } });
const logs = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForTimeout(5000);
const end = Date.now() + parseInt(secs) * 1000;
let shots = 0;
let lastLevelShot = 0;
while (Date.now() < end) {
    const st = await page.evaluate(() => window.gs.debugState());
    if (st.state === 'menu') {
        await page.keyboard.press('Enter');
    } else if (st.state === 'results') {
        await page.screenshot({ path: `${outDir}/results.png` });
        console.log('RESULTS reached');
        break;
    } else if (st.levelUp) {
        if (Date.now() - lastLevelShot > 20000) {
            await page.screenshot({ path: `${outDir}/levelup_${shots++}.png` });
            lastLevelShot = Date.now();
        }
        await page.keyboard.press(String(1 + Math.floor(Math.random() * st.levelUp.cards.length)));
    } else {
        const vw = parseInt(w), vh = parseInt(h);
        await page.mouse.click(vw * (0.3 + Math.random() * 0.4), vh * (0.3 + Math.random() * 0.4));
    }
    await page.waitForTimeout(1200);
    if (st.hud && st.hud.clockTicks % 50 < 2) {
        await page.screenshot({ path: `${outDir}/t${st.hud.clockTicks}.png` });
    }
}
const st = await page.evaluate(() => window.gs.debugState());
console.log(JSON.stringify({ state: st.state, fps: st.fps, npcs: st.npcs, simMs: st.simMs, clock: st.hud?.clockTicks, level: st.hud?.level, kills: st.hud?.kills, hp: st.hud?.hp }));
await page.screenshot({ path: `${outDir}/final.png` });
console.log(logs.slice(-20).join('\n'));
await browser.close();
