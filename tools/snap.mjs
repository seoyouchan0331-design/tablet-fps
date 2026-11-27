/** Boot in iPad emulation, press START, screenshot each weapon: node tools/snap.mjs shots/prefix [port] */
import { chromium, devices } from 'playwright';
const prefix = process.argv[2] ?? 'shots/snap';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const c = await b.newContext({ ...devices['iPad Pro 11 landscape'] });
const p = await c.newPage();
p.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 300)));
await p.goto(`http://127.0.0.1:${process.argv[3] ?? 4173}/`, { waitUntil: 'commit' });
await p.waitForFunction(() => window.__READY__ === true, null, { timeout: 600000, polling: 2000 });
await p.waitForFunction(() => !!document.querySelector('.ow-loadout:not([hidden])'), null, { timeout: 30000 }).catch(() => {});
await p.evaluate(() => document.querySelector('.ow-loadout .start')?.click());
await p.evaluate(() => { const pl = window.__ENGINE__.ctx.peek('player'); pl.movement.teleport(-3, 0.03, 8); pl.movement.yaw = 0.25; });
for (const id of ['rifle', 'smg', 'pistol']) {
  await p.evaluate((id) => window.__ENGINE__.ctx.peek('weapons').setWeaponImmediate(id), id);
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${prefix}-${id}.png`, timeout: 240000 });
  console.log('saved', `${prefix}-${id}.png`);
}
await b.close();
