/**
 * Tablet smoke test: boots the game in an emulated iPad (touch, no mouse) and
 * checks the touch path end to end. Needs a dev/preview server on --port.
 *   node tools/touch-smoke.mjs --port=4173 --out=shots/touch.png
 */
import { chromium, devices } from 'playwright';
import { ipad, gameUrl } from './lib/env.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const PORT = Number(args.port ?? 4173);
const OUT = args.out ?? 'shots/touch.png';
const fail = (m) => { console.error('FAIL', m); process.exitCode = 1; };

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext(ipad());
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (process.env.VERBOSE) console.log('[page]', m.type(), m.text().slice(0, 160)); });

await page.goto(gameUrl(`http://127.0.0.1:${PORT}/`));
await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 240000 });

// Main menu -> PRACTICE opens the loadout picker.
await page.waitForSelector('[data-act=practice]', { timeout: 30000 });
await page.evaluate(() => document.querySelector('[data-act=practice]').click());
// Loadout picker: pick SMG and start (also verifies the picker gates control).
const picker = await page.waitForFunction(() => !!document.querySelector('.ow-loadout:not([hidden])'), null, { timeout: 30000 }).then(() => true, () => false);
console.log('loadout picker shown', picker);
if (!picker) fail('loadout picker not shown at boot');
await page.evaluate(() => {
  [...document.querySelectorAll('.ow-loadout .card')][1].click();
  document.querySelector('.ow-loadout .start').click();
});
const lo = await page.evaluate(() => { const w = window.__ENGINE__.ctx.peek('weapons'); return { ids: w.loadout.ids(), active: w.activeId }; });
console.log('loadout', JSON.stringify(lo));
if (lo.ids[0] !== 'smg' || lo.active !== 'smg') fail('loadout choice not applied');
const pickerGone = await page.evaluate(() => getComputedStyle(document.querySelector('.ow-loadout')).display === 'none');
if (!pickerGone) fail('loadout picker still covers the screen after START');

// Tablet build must not use full-screen SVG/backdrop filters (they stall iPad Safari on every hit).
const heavy = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('.ow-blood-a, .ow-blood-b, .ow-desat, .ow-hitflash, .ow-touch .tb')) {
    const cs = getComputedStyle(el);
    if ((cs.filter && cs.filter !== 'none' && cs.display !== 'none') || (cs.backdropFilter && cs.backdropFilter !== 'none' && cs.display !== 'none') || (cs.mixBlendMode && cs.mixBlendMode !== 'normal'))
      out.push(`${el.className}: filter=${cs.filter} backdrop=${cs.backdropFilter} blend=${cs.mixBlendMode}`);
  }
  return out;
});
console.log('heavy css', heavy.length);
if (heavy.length) fail('heavy CSS effects in the tablet build:\n' + heavy.join('\n'));

// Every shader must already be compiled at boot: show the hidden duel avatar and draw.
const lateCompiles = await page.evaluate(async () => {
  const e = window.__ENGINE__; const r = e.ctx.peek('render').renderer;
  const before = r.info.programs.length;
  const opp = e.ctx.peek('opponent'); opp.avatar.setAlive(true); opp.avatar.setPose(0, 0, 5, 0);
  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  opp.avatar.hide();
  return r.info.programs.length - before;
});
console.log('late shader compiles when the opponent appears', lateCompiles);
// The "starved" fallback (shadows off) must not change shader programs either.
const starvedCompiles = await page.evaluate(async () => {
  const e = window.__ENGINE__; const rs = e.ctx.peek('render'); const r = rs.renderer;
  const before = r.info.programs.length;
  if (rs.dynres) rs.dynres.starved = true;
  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(res))));
  return r.info.programs.length - before;
});
console.log('shader compiles when shadows fall back', starvedCompiles);
if (starvedCompiles > 0) fail('shadow fallback recompiled shaders mid-game');
if (lateCompiles > 0) fail('opponent avatar compiled shaders mid-game (not prewarmed)');

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

await page.screenshot({ path: OUT.replace(/\.png$/, '-idle.png'), timeout: 240000 });

// 0) DASH is a long fast slide (keyboard Q works alongside touch).
// Face the open lane toward +x: straight ahead from spawn is the pillar.
await page.evaluate(() => { window.__ENGINE__.ctx.peek('player').movement.yaw = -Math.PI / 2; });
await frames(2);
const posXZ = () => page.evaluate(() => { const p = window.__ENGINE__.ctx.peek('player').position; return [p.x, p.z]; });
const d0 = await posXZ();
await page.keyboard.down('KeyQ');
await frames(1);
const slid = await page.evaluate(() => window.__ENGINE__.ctx.peek('player').movement.sliding);
await page.keyboard.up('KeyQ');
// Measure over 0.9 s of GAME time: a software-GL runner may draw only a few frames per second.
const tDash = await page.evaluate(() => window.__ENGINE__.ctx.time.elapsed);
await page.waitForFunction((t) => window.__ENGINE__.ctx.time.elapsed >= t + 0.9, tDash, { timeout: 60000, polling: 100 });
const d1 = await posXZ();
const dashDist = Math.hypot(d1[0] - d0[0], d1[1] - d0[1]);
const cd = await page.evaluate(() => { const e = window.__ENGINE__; return e.ctx.peek('player').movement.dash.cooldownLeft(e.ctx.time.elapsed); });
console.log('dash slid', slid, 'moved', dashDist.toFixed(2), 'm in 0.9 s game time, cooldown left', cd.toFixed(2));
if (!slid) fail('dash did not start a slide');
if (dashDist < 5) fail('dash glide too short');
if (!(cd > 0)) fail('dash cooldown not running');

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

// 2b) practice dummy: freeze it, aim at its chest, hold FIRE, expect hits on the avatar
await page.evaluate(() => {
  const e = window.__ENGINE__;
  const pr = e.ctx.peek('practice');
  pr._speed = 0; pr._retarget = Infinity;
  window.__dummyHits = 0; window.__dummyKills = 0;
  e.ctx.events.on('damage:dealt', (ev) => { if (ev.target?.isAvatar) { window.__dummyHits++; if (ev.killed) window.__dummyKills++; } });
});
// The arena's pillar blocks the spawn-to-spawn line by design: move the player
// to the first nearby spot with a clear line to the dummy's chest.
const spot = await page.evaluate(() => {
  const e = window.__ENGINE__; const pl = e.ctx.peek('player'); const ph = e.ctx.peek('physics');
  const a = e.ctx.peek('practice').avatar.position;
  const V = pl.position.constructor;
  for (const [x, z] of [[-3, 8], [3, 8], [-6, 2], [6, 2], [-2, 0.5], [2, -3], [-7, -4]]) {
    const gy = e.ctx.peek('world').groundHeight(x, z);
    if (ph.lineOfSight(new V(x, gy + 1.6, z), new V(a.x, a.y + 1.15, a.z))) {
      pl.movement.teleport(x, gy + 0.03, z);
      return [x, z];
    }
  }
  return null;
});
console.log('clear line from', JSON.stringify(spot));
if (!spot) fail('no clear line to the dummy from any test spot');
await frames(3);
const aimAtDummy = () => page.evaluate(() => {
  const e = window.__ENGINE__; const pl = e.ctx.peek('player'); const a = e.ctx.peek('practice').avatar.position;
  const eye = pl.eyePosition; const dx = a.x - eye.x, dy = a.y + 1.1 - eye.y, dz = a.z - eye.z;
  pl.movement.yaw = Math.atan2(-dx, -dz); pl.movement.pitch = Math.atan2(dy, Math.hypot(dx, dz));
});
await aimAtDummy();
await frames(3);
// aim and measure in the same tick: the dummy keeps strafing between frames
const aa = await page.evaluate(() => {
  const e = window.__ENGINE__; const pl = e.ctx.peek('player'); const a = e.ctx.peek('practice').avatar.position;
  const eye = pl.eyePosition; const dx = a.x - eye.x, dy = a.y + 1.1 - eye.y, dz = a.z - eye.z;
  pl.movement.yaw = Math.atan2(-dx, -dz); pl.movement.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  const r = pl._aimAssist(1 / 60); return { ...r, level: e.ctx.config.aimAssist };
});
console.log('aim assist on target', JSON.stringify(aa));
if (aa.level === 'low' && aa.lookScale !== 0.75) fail('aim assist did not slow look on a visible target');
// The earlier fire test emptied the magazine: reload and wait for rounds.
await page.keyboard.down('KeyR'); await frames(2); await page.keyboard.up('KeyR');
await page.waitForFunction(() => window.__ENGINE__.ctx.peek('weapons').ammo.mag > 5, null, { timeout: 60000, polling: 500 }).catch(() => {});
const ammo = await page.evaluate(() => window.__ENGINE__.ctx.peek('weapons').ammo.mag);
console.log('mag before dummy test', ammo);
await page.evaluate(() => { window.__dummyShots = 0; window.__ENGINE__.ctx.events.on('weapon:fire', () => window.__dummyShots++); });
const fb2 = await page.locator('.ow-touch .fire').boundingBox();
await touch('touchStart', [{ x: fb2.x + fb2.width / 2, y: fb2.y + fb2.height / 2, id: 7 }]);
for (let i = 0; i < 40; i++) { await aimAtDummy(); await frames(1); }
await touch('touchEnd', []);
await frames(5);
const dh = await page.evaluate(() => ({ shots: window.__dummyShots, hits: window.__dummyHits, kills: window.__dummyKills, hp: window.__ENGINE__.ctx.peek('practice').dummy.hp }));
console.log('dummy', JSON.stringify(dh));
if (dh.hits < 1) fail('no hits registered on the practice dummy');
const feed = await page.evaluate(() => window.__ENGINE__.ctx.peek('ui').state.scoreUs);
console.log('kills on HUD', feed);
if (feed !== dh.kills) fail(`HUD kills ${feed} != dummy deaths ${dh.kills} (double or missed kill)`);

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

// the 3D view and the HUD must share one centre, or shots land off the crosshair
const centres = await page.evaluate(() => {
  const c = document.getElementById('game').getBoundingClientRect();
  return { canvas: [c.left + c.width / 2, c.top + c.height / 2], view: [innerWidth / 2, innerHeight / 2] };
});
if (Math.abs(centres.canvas[0] - centres.view[0]) > 1 || Math.abs(centres.canvas[1] - centres.view[1]) > 1)
  fail(`3D centre ${centres.canvas} != screen centre ${centres.view}`);

if (errors.length) fail('page errors:\n' + errors.join('\n'));
console.log(process.exitCode ? 'SMOKE FAILED' : 'SMOKE OK', '→', OUT);
await browser.close();
