/**
 * Shotgun + sniper + duel audio (iPad emulation, practice range):
 *   shotgun  one trigger pull = several pellets landing on the dummy
 *   sniper   scoping zooms the camera and shows the scope picture
 *   audio    shots and footsteps reach the new audio system, nothing else runs
 *   CHROME_PATH=/opt/pw-browsers/chromium node tools/weapons-e2e.mjs [--port=4173]
 */
import { chromium, devices } from 'playwright';
import { ipad, gameUrl } from './lib/env.mjs';
const PORT = Number((process.argv.find((a) => a.startsWith('--port=')) ?? '--port=4173').split('=')[1]);
let failed = false;
const fail = (m) => { console.error('FAIL', m); failed = true; };
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext(ipad());
const p = await ctx.newPage();
p.on('pageerror', (e) => fail('page error ' + String(e).slice(0, 200)));
const frames = (n) => p.evaluate((n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
await p.goto(gameUrl(`http://127.0.0.1:${PORT}/`), { waitUntil: 'commit' });
await p.waitForFunction(() => window.__READY__ === true, null, { timeout: 600000, polling: 2000 });
await p.waitForSelector('[data-act=practice]', { timeout: 30000 });
await p.evaluate(() => document.querySelector('[data-act=practice]').click());
await p.waitForTimeout(400);
const cards = await p.evaluate(() => [...document.querySelectorAll('.ow-loadout .card b')].map((x) => x.textContent));
console.log('loadout cards', cards.join(', '));
if (!cards.includes('SHOTGUN') || !cards.includes('SNIPER')) fail('new guns missing from the picker');
await p.evaluate(() => { [...document.querySelectorAll('.ow-loadout .card')].find((c) => c.textContent.includes('SHOTGUN')).click(); document.querySelector('.ow-loadout .start').click(); });
await p.waitForTimeout(1500);
await p.mouse.click(5, 5); // a gesture: starts audio
await p.keyboard.press('Shift'); // keydown gesture too
await frames(10);

const setup = await p.evaluate(() => {
  const e = window.__ENGINE__; const pl = e.ctx.peek('player');
  window.__hits = 0; window.__fires = 0;
  e.ctx.events.on('damage:dealt', (ev) => { if (ev.target?.isAvatar) window.__hits++; });
  e.ctx.events.on('weapon:fire', () => window.__fires++);
  { const pr = e.ctx.peek('practice'); pr.update = (dt) => pr.avatar.tick(dt); } // hold the dummy still (still animating): its strafe can carry it behind cover
  const a = e.ctx.peek('practice').avatar.position;
  const ph = e.ctx.peek('physics'); const V = pl.position.constructor;
  // stand 5 m from the dummy with a clear line
  for (let k = 0; k < 16; k++) {
    const ang = (k / 16) * Math.PI * 2; const x = a.x + Math.cos(ang) * 5, z = a.z + Math.sin(ang) * 5;
    const gy = e.ctx.peek('world').groundHeight(x, z);
    if (ph.lineOfSight(new V(x, gy + 1.6, z), new V(a.x, a.y + 1.15, a.z))) { pl.movement.teleport(x, gy + 0.03, z); return { active: e.ctx.peek('weapons').activeId }; }
  }
  return { active: e.ctx.peek('weapons').activeId, noSpot: true };
});
console.log('setup', JSON.stringify(setup));
if (setup.active !== 'shotgun') fail('shotgun not drawn');
const aim = (dy = 1.1) => p.evaluate((dy) => {
  const e = window.__ENGINE__; const pl = e.ctx.peek('player'); const a = e.ctx.peek('practice').avatar.position;
  const eye = pl.eyePosition; const dx = a.x - eye.x, h = a.y + dy - eye.y, dz = a.z - eye.z;
  pl.movement.yaw = Math.atan2(-dx, -dz); pl.movement.pitch = Math.atan2(h, Math.hypot(dx, dz));
}, dy);
await p.waitForFunction(() => window.__ENGINE__.ctx.peek('weapons').canFire(), null, { timeout: 30000 });
for (let i = 0; i < 4; i++) { await aim(); await frames(1); }
await p.keyboard.down('KeyF'); await frames(2); await p.keyboard.up('KeyF');
for (let i = 0; i < 20; i++) { await aim(); await frames(1); }
const sg = await p.evaluate(() => ({ fires: window.__fires, hits: window.__hits }));
console.log('shotgun one pull', JSON.stringify(sg));
// keep shooting until the dummy drops (a pull that lands 6 of 8 leaves it on 4 hp)
for (let n = 0; n < 4; n++) {
  const k = await p.evaluate(() => window.__AUDIO__.report().kills ?? 0);
  if (k > 0) break;
  await p.waitForFunction(() => window.__ENGINE__.ctx.peek('weapons').canFire(), null, { timeout: 30000 });
  await aim(); await p.keyboard.down('KeyF'); await frames(2); await p.keyboard.up('KeyF');
  for (let i = 0; i < 8; i++) { await aim(); await frames(1); }
}
await p.screenshot({ path: 'shots/kill-banner.png' });
const kb = await p.evaluate(() => ({
  count: window.__ENGINE__.ctx.peek('ui').killBanner.count ?? 0,
  title: document.querySelector('.ow-kb .t').textContent,
  pips: document.querySelectorAll('.ow-kb .pip.on').length,
  kills: window.__AUDIO__.report().kills ?? 0,
}));
console.log('kill banner', JSON.stringify(kb));
if (kb.count < 1 || kb.pips < 1) fail('kill banner not shown');
if (kb.kills < 1) fail('kill sound not played');
await p.waitForTimeout(600);
await p.screenshot({ path: 'shots/shotgun.png' });
if (sg.fires !== 1) fail(`one pull fired ${sg.fires} times`);
if (sg.hits < 4) fail(`only ${sg.hits} pellets landed at 5 m`);
if (sg.hits > 8) fail(`${sg.hits} hits from 8 pellets: a pellet counted twice`);

// ---- sniper: scope view ---------------------------------------------------------
await p.evaluate(() => window.__ENGINE__.ctx.events.emit('loadout:set', { primary: 'sniper' }));
await p.waitForFunction(() => window.__ENGINE__.ctx.peek('weapons').canFire(), null, { timeout: 30000 });
await p.waitForTimeout(400);
await p.screenshot({ path: 'shots/sniper.png' });
const fov0 = await p.evaluate(() => window.__ENGINE__.ctx.camera.fov);
await p.keyboard.down('KeyE');
await p.waitForTimeout(2200);
const sc = await p.evaluate(() => ({
  fov: window.__ENGINE__.ctx.camera.fov,
  overlay: getComputedStyle(document.querySelector('.ow-scope')).display,
  vm: window.__ENGINE__.ctx.viewScene.visible,
  ads: window.__ENGINE__.ctx.peek('weapons').adsProgress,
}));
console.log('sniper scoped', JSON.stringify({ fov0, ...sc }));
await p.screenshot({ path: 'shots/sniper-scope.png' });
if (!(sc.fov < fov0 * 0.45)) fail('sniper did not zoom');
if (sc.overlay !== 'block' || sc.vm) fail('scope picture not shown');
// one scoped shot: the camera recoil right after the shot, and how slowly it returns
const kick = await p.evaluate(() => new Promise((done) => {
  const e = window.__ENGINE__.ctx; const rig = e.peek('player').rig;
  const off = e.events.on('weapon:fire', () => {
    off?.();
    done({ peakDeg: (rig.recoilPitch.spring.value + rig.recoilPitch.residual) * 57.3, freq: rig.recoilPitch.spring.freq });
  });
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
  setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF' })), 50);
}));
console.log('sniper kick', JSON.stringify(kick));
if (!(kick.freq < 5)) fail('sniper recoil returns as fast as the rifle');
if (!(kick.peakDeg > 3)) fail(`sniper kick only ${kick.peakDeg.toFixed(2)} deg`);
await p.keyboard.up('KeyE');
await p.waitForTimeout(700);
const un = await p.evaluate(() => ({ overlay: getComputedStyle(document.querySelector('.ow-scope')).display, vm: window.__ENGINE__.ctx.viewScene.visible }));
if (un.overlay !== 'none' || !un.vm) fail('scope picture stuck after release');

// ---- audio --------------------------------------------------------------------
await p.keyboard.down('KeyW'); await p.waitForTimeout(1200); await p.keyboard.up('KeyW');
const au = await p.evaluate(() => ({ ...window.__AUDIO__.report(), duel: typeof window.__AUDIO__._step === 'function' && !('ambience' in window.__AUDIO__) }));
console.log('audio', JSON.stringify(au));
if (!au.duel) fail('old audio engine still loaded');
if (!au.started) fail('audio did not start on a gesture');
if (au.shots < 1) fail('no gunshot played');
if (au.steps < 1) fail('no footstep played');
if (!(au.fileShots > 0)) fail('recorded gunshot files did not play');

await b.close();
console.log(failed ? 'WEAPONS FAILED' : 'WEAPONS OK');
process.exit(failed ? 1 : 0);
