// Dev helper: open the game, wait until a JS condition on gs.debugState() holds, screenshot.
// usage: node tools/capture.mjs <url> <out.png> "<condition using s>" [timeoutSec] [w] [h] [setupJs]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const [url, out, cond, timeout = '120', w = '765', h = '503', setup = ''] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: parseInt(w), height: parseInt(h) } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForTimeout(6000);
if (setup) await page.evaluate(setup);
const end = Date.now() + parseInt(timeout) * 1000;
let ok = false;
while (Date.now() < end) {
    const res = await page.evaluate(`(() => { const s = window.gs.debugState(); if (s.levelUp && !(${cond})) window.gs.debugPick(0); return (${cond}); })()`);
    if (res) { ok = true; break; }
    await page.waitForTimeout(150);
}
await page.screenshot({ path: out });
console.log(ok ? 'captured' : 'timeout', JSON.stringify(await page.evaluate(() => { const s = window.gs.debugState(); return { fps: s.fps, npcs: s.npcs, tg: s.telegraphs, hl: s.highlights, clock: s.hud?.clockTicks, bosses: s.hud?.bosses }; })));
await browser.close();
