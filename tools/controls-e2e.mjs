/**
 * Controls settings end to end (iPad emulation): rebind Jump to J, drag the
 * DASH button to the middle, reload — both survive; crouch holds while the
 * stick is pushed to full (auto-sprint).
 *   CHROME_PATH=/opt/pw-browsers/chromium node tools/controls-e2e.mjs [--port=4173]
 */
import { chromium, devices } from 'playwright';
import { ipad, gameUrl } from './lib/env.mjs';
const PORT = Number((process.argv.find((a) => a.startsWith('--port=')) ?? '--port=4173').split('=')[1]);
let failed = false;
const fail = (m) => { console.error('FAIL', m); failed = true; };
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext(ipad());
const p = await ctx.newPage();
p.on('pageerror', (e) => fail('page error ' + String(e).slice(0, 200)));
const boot = async () => {
  await p.waitForFunction(() => window.__READY__ === true, null, { timeout: 600000, polling: 2000 });
  await p.waitForSelector('[data-act=practice]', { timeout: 30000 });
  await p.evaluate(() => document.querySelector('[data-act=practice]').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('.ow-loadout .start')?.click());
  await p.waitForTimeout(1500);
};
const click = (act) => p.evaluate((a) => document.querySelector(`[data-act="${a}"]`).click(), act);
await p.goto(gameUrl(`http://127.0.0.1:${PORT}/`), { waitUntil: 'commit' });
await boot();

// ---- rebind Jump to J ----------------------------------------------------------
await p.evaluate(() => window.__ENGINE__.ctx.peek('ui').menu.show());
await p.waitForTimeout(300);
await click('open-controls');
await click('bind-jump');
await p.keyboard.press('KeyJ');
const label = await p.evaluate(() => document.querySelector('[data-act="bind-jump"]').textContent);
console.log('jump bound to', label);
if (!label.startsWith('J')) fail('jump did not rebind to J');
await click('controls-done');
await p.evaluate(() => window.__ENGINE__.ctx.peek('ui').menu.close());
await p.waitForTimeout(500);
const jumped = async () => {
  await p.keyboard.down('KeyJ'); await p.waitForTimeout(150); await p.keyboard.up('KeyJ');
  await p.waitForTimeout(250);
  return p.evaluate(() => { const m = window.__ENGINE__.ctx.peek('player').movement; return !m.grounded || m.velocity.y > 0.1 || m.state === 'jump' || m.state === 'fall'; });
};
if (!(await jumped())) fail('pressing J did not jump');
else console.log('J jumps');

// ---- drag DASH to the middle ---------------------------------------------------
await p.evaluate(() => window.__ENGINE__.ctx.peek('ui').menu.show());
await click('open-controls');
await click('edit-layout');
const vp = p.viewportSize();
const dash = await p.evaluate(() => { const r = document.querySelector('.ow-touch .tb[data-id="dash"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
const cdp = await ctx.newCDPSession(p);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: dash.x, y: dash.y, id: 1 }] });
for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: dash.x + (vp.width / 2 - dash.x) * i / 5, y: dash.y + (vp.height / 2 - dash.y) * i / 5, id: 1 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await click('touch-done');
const moved = await p.evaluate(() => { const r = document.querySelector('.ow-touch .tb[data-id="dash"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
console.log('dash moved to', JSON.stringify(moved));
if (Math.abs(moved.x - vp.width / 2) > 8 || Math.abs(moved.y - vp.height / 2) > 8) fail('dash button did not follow the drag');

// ---- reload: both settings persist ----------------------------------------------
await p.reload({ waitUntil: 'commit' });
await boot();
const after = await p.evaluate(() => { const r = document.querySelector('.ow-touch .tb[data-id="dash"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
console.log('after reload dash at', JSON.stringify(after));
if (Math.abs(after.x - vp.width / 2) > 8 || Math.abs(after.y - vp.height / 2) > 8) fail('touch layout not restored after reload');
await p.waitForTimeout(800);
if (!(await jumped())) fail('J binding not restored after reload');
else console.log('J still jumps after reload');

// ---- crouch while the stick is fully pushed -------------------------------------
await p.waitForTimeout(800);
const cdp2 = await ctx.newCDPSession(p);
await cdp2.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: vp.width * 0.15, y: vp.height * 0.7, id: 5 }] });
await cdp2.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: vp.width * 0.15, y: vp.height * 0.7 - 80, id: 5 }] });
await p.waitForTimeout(1200);
await p.keyboard.press('KeyC');
await p.waitForTimeout(2500);
const st = await p.evaluate(() => window.__ENGINE__.ctx.peek('player').movement.stance);
await cdp2.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
console.log('stance after crouch with stick held', st);
if (st !== 'crouch') fail('crouch did not hold while moving');

console.log(failed ? 'CONTROLS FAILED' : 'CONTROLS OK');
await b.close();
process.exitCode = failed ? 1 : 0;
