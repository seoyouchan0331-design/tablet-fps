/**
 * Phone in landscape (Galaxy S9+, 740x360 CSS px): every screen's key button
 * must be on screen and tappable — main menu, duel lobby (READY), practice
 * weapon picker (START), pause menu, Controls (DONE after scrolling).
 *   CHROME_PATH=/opt/pw-browsers/chromium node tools/phone-e2e.mjs [--port=4173]
 */
import { chromium, devices } from 'playwright';
import { gameUrl, FAST } from './lib/env.mjs';
const PORT = Number((process.argv.find((a) => a.startsWith('--port=')) ?? '--port=4173').split('=')[1]);
let failed = false;
const fail = (m) => { console.error('FAIL', m); failed = true; };
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const dev = { ...devices['Galaxy S9+ landscape'] };
if (FAST) dev.deviceScaleFactor = 1;
const p = await (await b.newContext(dev)).newPage();
p.on('pageerror', (e) => fail('page error ' + String(e).slice(0, 200)));
await p.goto(gameUrl(`http://127.0.0.1:${PORT}/`), { waitUntil: 'commit' });
await p.waitForFunction(() => window.__READY__ === true, null, { timeout: 600000, polling: 2000 });

/** Scroll it into view if its panel scrolls, then: is it fully on screen and the top element at its centre? */
const reachable = (sel) => p.evaluate((sel) => {
  const n = document.querySelector(sel);
  if (!n) return { ok: false, why: 'missing' };
  n.scrollIntoView({ block: 'nearest' });
  const r = n.getBoundingClientRect();
  const on = r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + 0.5 && r.right <= innerWidth + 0.5;
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { ok: on && (top === n || n.contains(top)), why: `rect ${Math.round(r.top)}..${Math.round(r.bottom)} of ${innerHeight}, top=${top?.className || top?.tagName}` };
}, sel);
const check = async (name, sel) => {
  const r = await reachable(sel);
  console.log(`${r.ok ? 'ok  ' : 'BAD '} ${name}: ${r.why}`);
  if (!r.ok) fail(`${name} not reachable`);
};

await check('menu CREATE', '[data-act="create"]');
await check('menu PRACTICE', '[data-act="practice"]');

// duel lobby as the guest sees it (all settings rows)
await p.evaluate(() => window.__ENGINE__.ctx.peek('match').lobby.showLobby({
  role: 'guest', code: 'K7QP', settings: { aimAssist: 'low', winTarget: 5, map: 'lanes' }, myReady: false, oppReady: false, net: { route: 'direct', rtt: 30 },
}));
await p.screenshot({ path: 'shots/phone-lobby.png' });
await check('lobby READY', '[data-act="ready"]');
// nothing hidden under the READY bar: the whole lobby fits without scrolling
const fits = await p.evaluate(() => { const r = document.querySelector('.ow-lobby'); return r.scrollHeight <= r.clientHeight + 1; });
if (!fits) fail('lobby needs scrolling on a phone (settings hidden under READY)');
await check('lobby SNIPER', '[data-act="primary-sniper"]');
await check('lobby MAP', '[data-act="map-blocks"]');
await p.evaluate(() => window.__ENGINE__.ctx.peek('match').lobby.showMenu());

// practice weapon picker
await p.evaluate(() => document.querySelector('[data-act=practice]').click());
await p.waitForTimeout(400);
await p.screenshot({ path: 'shots/phone-loadout.png' });
await check('loadout START', '.ow-loadout .start');
await p.evaluate(() => document.querySelector('.ow-loadout .start')?.click());
await p.waitForTimeout(800);

// pause menu and Controls
await p.evaluate(() => window.__ENGINE__.ctx.peek('ui').menu.show());
await p.waitForTimeout(500);
await p.screenshot({ path: 'shots/phone-menu.png' });
await check('pause Controls', '[data-act="open-controls"]');
await p.evaluate(() => document.querySelector('[data-act="open-controls"]').click());
await p.waitForTimeout(300);
await check('controls DONE', '[data-act="controls-done"]');

await b.close();
console.log(failed ? 'PHONE FAILED' : 'PHONE OK');
process.exit(failed ? 1 : 0);
