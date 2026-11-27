/**
 * Screenshots of the robot holding its gun (practice dummy): front and side,
 * aiming level / up, each gun, sprint carry, reload.
 *   CHROME_PATH=/opt/pw-browsers/chromium node tools/avatar-shots.mjs [--port=4173]
 */
import { chromium } from 'playwright';
import { ipad, gameUrl } from './lib/env.mjs';
const PORT = Number((process.argv.find((a) => a.startsWith('--port=')) ?? '--port=4173').split('=')[1]);
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext(ipad())).newPage();
p.on('pageerror', (e) => console.error('page error', String(e).slice(0, 300)));
await p.goto(gameUrl(`http://127.0.0.1:${PORT}/`), { waitUntil: 'commit' });
await p.waitForFunction(() => window.__READY__ === true, null, { timeout: 600000, polling: 2000 });
await p.evaluate(() => document.querySelector('[data-act=practice]').click());
await p.waitForTimeout(400);
await p.evaluate(() => document.querySelector('.ow-loadout .start')?.click());
await p.waitForTimeout(1200);
import { writeFileSync } from 'node:fs';
// Render the robot with our own camera (the player camera is rewritten every frame).
let ang = 0;
const view = async (a) => { ang = a; };
const set = (fn) => p.evaluate(fn);
const shot = async (name) => {
  await p.waitForTimeout(600);
  const url = await p.evaluate((ang) => {
    const e = window.__ENGINE__.ctx; const a = e.peek('practice').avatar; const r = e.peek('render').renderer;
    const cam = e.camera.clone(); cam.fov = 40; cam.aspect = 1; cam.updateProjectionMatrix();
    const yaw = a.root.rotation.y + ang; const d = 2.8;
    cam.position.set(a.position.x - Math.sin(yaw) * d, a.position.y + 1.3, a.position.z - Math.cos(yaw) * d);
    cam.lookAt(a.position.x, a.position.y + 1.0, a.position.z);
    const size = r.getSize(new cam.position.constructor());
    r.setSize(600, 600, false); r.setRenderTarget(null); r.clear(); r.render(e.scene, cam);
    const u = r.domElement.toDataURL('image/png');
    r.setSize(size.x, size.y, false);
    return u;
  }, ang);
  writeFileSync(`shots/avatar-${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
  console.log('shot', name);
};
await view(0.35); await shot('front-rifle');
await view(Math.PI / 2); await shot('side-rifle');
await set(() => window.__ENGINE__.ctx.peek('practice').avatar.setAim(0.6)); await shot('side-aim-up');
await set(() => { const a = window.__ENGINE__.ctx.peek('practice').avatar; a.setAim(0); a.setWeapon('sniper'); }); await shot('side-sniper');
await set(() => window.__ENGINE__.ctx.peek('practice').avatar.setWeapon('pistol')); await shot('side-pistol');
await view(0.6); await set(() => window.__ENGINE__.ctx.peek('practice').avatar.setWeapon('shotgun')); await shot('quarter-shotgun');
await set(() => window.__ENGINE__.ctx.peek('practice').avatar.setReloading(true)); await p.waitForTimeout(300); await shot('quarter-reload');
await b.close();
