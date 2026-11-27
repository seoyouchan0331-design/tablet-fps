/**
 * Developer panel (?dev=1): opens, loads every map, draws every gun, and the
 * feedback buttons run without errors. Screenshot: shots/dev-panel.png.
 *   CHROME_PATH=/opt/pw-browsers/chromium node tools/dev-e2e.mjs [--port=4173]
 */
import { chromium } from 'playwright';
import { ipad, gameUrl } from './lib/env.mjs';
const PORT = Number((process.argv.find((a) => a.startsWith('--port=')) ?? '--port=4173').split('=')[1]);
let failed = false;
const fail = (m) => { console.error('FAIL', m); failed = true; };
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext(ipad())).newPage();
p.on('pageerror', (e) => fail('page error ' + String(e).slice(0, 200)));
await p.goto(gameUrl(`http://127.0.0.1:${PORT}/?dev=1`), { waitUntil: 'commit' });
await p.waitForFunction(() => window.__READY__ === true, null, { timeout: 600000, polling: 2000 });
await p.evaluate(() => document.querySelector('[data-act=practice]').click());
await p.waitForTimeout(400);
await p.evaluate(() => document.querySelector('.ow-loadout .start')?.click());
await p.waitForTimeout(600);
const click = (act) => p.evaluate((a) => document.querySelector(`[data-act="dev-${a}"]`)?.click(), act);
await p.evaluate(() => document.querySelector('.dev-btn').click());
for (const id of ['grid', 'lanes', 'blocks', 'town', 'field']) {
  await click(`map-${id}`);
  await p.waitForTimeout(300);
  const m = await p.evaluate(() => window.__ENGINE__.ctx.peek('world').mapId);
  if (m !== id) fail(`map ${id} not loaded (${m})`);
}
console.log('maps ok');
for (const id of ['rifle', 'smg', 'shotgun', 'sniper', 'pistol']) {
  await click(`weapon-${id}`);
  await p.waitForTimeout(200);
  if ((await p.evaluate(() => window.__ENGINE__.ctx.peek('weapons').activeId)) !== id) fail(`weapon ${id}`);
}
console.log('weapons ok');
for (const a of ['god', 'ammo', 'hitboxes', 'dummy-ahead', 'kill-3', 'kill-5', 'recap', 'killcam', 'speed-0.5', 'speed-1']) await click(a);
await p.waitForTimeout(1200);
const st = await p.evaluate(() => ({ hb: !!window.__DEVPANEL__._hb, frozen: window.__DEVPANEL__.flags.freeze, stats: document.querySelector('.dev-panel .stats')?.textContent }));
console.log('state', JSON.stringify(st));
if (!st.hb || !st.frozen) fail('hitboxes / dummy freeze not active');
await p.screenshot({ path: 'shots/dev-panel.png' });
await b.close();
console.log(failed ? 'DEV FAILED' : 'DEV OK');
process.exit(failed ? 1 : 0);
