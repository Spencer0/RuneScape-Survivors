// Dev helper: open the built game in headless Chromium, run a scripted sequence, save screenshots.
// usage: node tools/shot.mjs <url> <out.png> [waitMs] [actions-json]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const [url, out, waitMs = '6000', actions = '[]'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 765, height: 503 } });
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForTimeout(parseInt(waitMs, 10));
for (const a of JSON.parse(actions)) {
    if (a.type === 'click') await page.mouse.click(a.x, a.y, { button: a.button ?? 'left' });
    if (a.type === 'key') await page.keyboard.press(a.key);
    if (a.type === 'down') await page.keyboard.down(a.key);
    if (a.type === 'up') await page.keyboard.up(a.key);
    if (a.type === 'wheel') { await page.mouse.move(a.x ?? 380, a.y ?? 250); await page.mouse.wheel(0, a.dy); }
    if (a.type === 'wait') await page.waitForTimeout(a.ms);
    if (a.type === 'shot') await page.screenshot({ path: a.path });
    if (a.type === 'eval') logs.push(`[eval] ${JSON.stringify(await page.evaluate(a.js))}`);
}
await page.screenshot({ path: out });
console.log(logs.slice(-40).join('\n'));
await browser.close();
