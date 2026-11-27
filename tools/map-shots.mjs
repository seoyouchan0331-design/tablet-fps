/**
 * Overview renders of every duel map (from above one spawn).
 *   CHROME_PATH=/opt/pw-browsers/chromium node tools/map-shots.mjs [--port=4173]
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { ipad, gameUrl } from './lib/env.mjs';
const PORT = Number((process.argv.find((a) => a.startsWith('--port=')) ?? '--port=4173').split('=')[1]);
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext(ipad())).newPage();
await p.goto(gameUrl(`http://127.0.0.1:${PORT}/`), { waitUntil: 'commit' });
await p.waitForFunction(() => window.__READY__ === true, null, { timeout: 600000, polling: 2000 });
for (const id of ['grid', 'lanes', 'blocks']) {
  const url = await p.evaluate((id) => {
    const e = window.__ENGINE__.ctx; const r = e.peek('render').renderer;
    e.peek('world').load(id);
    const cam = e.camera.clone(); cam.fov = 60; cam.aspect = 4 / 3; cam.updateProjectionMatrix();
    cam.position.set(0, 22, 24); cam.lookAt(0, 0, 0);
    const size = r.getSize(new cam.position.constructor());
    r.setSize(800, 600, false); r.setRenderTarget(null); r.clear(); r.render(e.scene, cam);
    const u = r.domElement.toDataURL('image/png');
    r.setSize(size.x, size.y, false);
    return u;
  }, id);
  writeFileSync(`shots/map-${id}.png`, Buffer.from(url.split(',')[1], 'base64'));
  console.log('map', id);
}
await b.close();
