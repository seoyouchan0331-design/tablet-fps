/**
 * Tablet smoke test: boots the game in an emulated iPad (touch, no mouse) and
 * checks the touch path end to end. Needs a dev/preview server on --port.
 *   node tools/touch-smoke.mjs --port=4173 --out=shots/touch.png
 */
import { chromium, devices } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const PORT = Number(args.port ?? 4173);
const OUT = args.out ?? 'shots/touch.png';
const fail = (m) => { console.error('FAIL', m); process.exitCode = 1; };

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (process.env.VERBOSE) console.log('[page]', m.type(), m.text().slice(0, 160)); });

await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 240000 });

const info = await page.evaluate(() => {
  const e = window.__ENGINE__;
  return { touch: e.ctx.config.touch, quality: e.ctx.config.quality, overlay: !!document.querySelector('.ow-touch'),
    dynres: !!e.ctx.peek('render').dynres };
});
console.log('boot', info);
if (!info.touch) fail('touch mode not detected');
if (info.quality !== 'mobile') fail(`expected mobile preset, got ${info.quality}`);
if (!info.overlay) fail('touch overlay missing');

// Dispatch real TouchEvents through the CDP touch emulation.
const cdp = await ctx.newCDPSession(page);
const touch = async (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
const yaw = () => page.evaluate(() => window.__ENGINE__.ctx.peek('player').movement.yaw);
const frames = (n) => page.evaluate((n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const vp = page.viewportSize();

// 1) drag on the right half rotates the camera
const y0 = await yaw();
await touch('touchStart', [{ x: vp.width * 0.7, y: vp.height * 0.4, id: 1 }]);
for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: vp.width * 0.7 + i * 20, y: vp.height * 0.4, id: 1 }]); await frames(1); }
await touch('touchEnd', []);
await frames(2);
const y1 = await yaw();
console.log('yaw', y0.toFixed(3), '->', y1.toFixed(3));
if (Math.abs(y1 - y0) < 0.05) fail('look drag did not rotate the camera');

// 2) holding FIRE fires
const fireBox = await page.locator('.ow-touch .fire').boundingBox();
const shots = await page.evaluate(() => { window.__shots = 0; window.__ENGINE__.ctx.events.on('weapon:fire', () => window.__shots++); return 0; });
await touch('touchStart', [{ x: fireBox.x + fireBox.width / 2, y: fireBox.y + fireBox.height / 2, id: 2 }]);
await frames(20);
await page.screenshot({ path: OUT });
await touch('touchEnd', []);
await frames(10);
const fired = await page.evaluate(() => window.__shots);
const firing = await page.evaluate(() => window.__ENGINE__.ctx.input.fire);
console.log('shots fired', fired, 'still firing after release:', firing);
if (fired < 1) fail('fire button did not fire');
if (firing) fail('fire stuck after release');

// 3) joystick + look simultaneously, then lift both
await touch('touchStart', [{ x: vp.width * 0.15, y: vp.height * 0.7, id: 3 }, { x: vp.width * 0.7, y: vp.height * 0.3, id: 4 }]);
await touch('touchMove', [{ x: vp.width * 0.15, y: vp.height * 0.7 - 80, id: 3 }, { x: vp.width * 0.7 + 30, y: vp.height * 0.3, id: 4 }]);
await frames(3);
const mv = await page.evaluate(() => window.__ENGINE__.ctx.input.moveVector());
console.log('move while looking', mv);
if (mv.y < 0.9) fail('joystick forward not applied');
await touch('touchEnd', []);
await frames(3);
const mv2 = await page.evaluate(() => window.__ENGINE__.ctx.input.moveVector());
if (Math.abs(mv2.y) > 0.01 || Math.abs(mv2.x) > 0.01) fail('movement stuck after release');

// 4) no pause menu forced by missing pointer lock
const menuOpen = await page.evaluate(() => window.__ENGINE__.ctx.peek('ui').menu.open);
if (menuOpen) fail('pause menu opened by itself');

if (errors.length) fail('page errors:\n' + errors.join('\n'));
console.log(process.exitCode ? 'SMOKE FAILED' : 'SMOKE OK', '→', OUT);
await browser.close();
