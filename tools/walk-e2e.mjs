/**
 * TOWN walk-through: the player walks real routes (doors, stairs, the tower,
 * the arcade gallery, the bridge, the terrace) and must arrive at the
 * expected height. Catches stairs that snag, doors that are too narrow and
 * ceilings that block a climb.
 *   node tools/walk-e2e.mjs [--port=4173]
 */
import { chromium } from 'playwright';
import { ipad, gameUrl } from './lib/env.mjs';
const PORT = Number((process.argv.find((a) => a.startsWith('--port=')) ?? '--port=4173').split('=')[1]);
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext(ipad())).newPage();
await p.goto(gameUrl(`http://127.0.0.1:${PORT}/`), { waitUntil: 'commit' });
await p.waitForFunction(() => window.__READY__ === true, null, { timeout: 600000, polling: 2000 });
await p.evaluate(() => document.querySelector('[data-act=practice]').click());
await p.waitForTimeout(400);
await p.evaluate(() => document.querySelector('.ow-loadout .start')?.click());
await p.waitForTimeout(1200);
await p.evaluate(() => window.__ENGINE__.ctx.peek('world').load('town'));
await p.waitForTimeout(500);

const ROUTES = {
  tower: { start: [19.5, 18.5], path: [[22.4, 18.5], [22.5, 16.5], [25.9, 16.5], [25.9, 20.5], [22.5, 20.5], [22.5, 16.5], [24.5, 18.2]], y: 6.4 },
  gallery: { start: [16.5, 21], path: [[15.3, 22.2], [9.4, 22.2], [5, 21], [-8.3, 21.3], [-10.6, 21.3]], y: 3.2 },
  bridge: { start: [16.4, 7.5], path: [[19.2, 7.5], [18.7, 9.9], [25.1, 9.9], [23.5, 6.5], [22, 5], [22, -3], [22, -5.6]], y: 3.2 },
  terrace: { start: [18.3, -13.5], path: [[18.8, -17], [22.6, -17], [25.9, -17], [29.6, -17], [31.5, -18.5]], y: 3.2 },
  spawnstair: { start: [33, -18.5, 3.25], path: [[34.2, -16.3], [34.2, -10]], y: 0 },
};
let fail = 0;
for (const [name, r] of Object.entries(ROUTES)) {
  const res = await p.evaluate(async (r) => {
    const pl = window.__ENGINE__.ctx.peek('player');
    const mv = pl.movement;
    pl.setControlEnabled?.(true);
    mv.teleport(r.start[0], r.start[2] ?? 0.05, r.start[1]);
    // the touch UI rewrites the stick every frame: feed the move command directly
    const input = window.__ENGINE__.ctx.input;
    const stick = { moveY: 0 };
    input.moveVector = (out = {}) => { out.x = 0; out.y = -stick.moveY; return out; };
    const log = [];
    for (const [tx, tz] of r.path) {
      // stuck = no 0.2 m of progress for 4 s (wall clock: the CI box may be slow)
      let best = Infinity, tBest = performance.now();
      for (;;) {
        const P = mv.position;
        const dx = tx - P.x, dz = tz - P.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.3) break;
        if (dist < best - 0.2) { best = dist; tBest = performance.now(); }
        if (performance.now() - tBest > 4000) { log.push(`stuck going to ${tx},${tz} at ${P.x.toFixed(2)},${P.y.toFixed(2)},${P.z.toFixed(2)}`); stick.moveY = 0; return { ok: false, log, y: P.y }; }
        mv.yaw = Math.atan2(-dx, -dz);
        stick.moveY = -0.7; // the stick's y is down-positive: negative walks forward
        await new Promise((res) => setTimeout(res, 30));
      }
      log.push(`${tx},${tz} y=${mv.position.y.toFixed(2)}`);
    }
    stick.moveY = 0;
    await new Promise((res) => setTimeout(res, 400));
    return { ok: true, log, y: mv.position.y };
  }, r);
  const ok = res.ok && Math.abs(res.y - r.y) < 0.25;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: y=${res.y.toFixed(2)} (want ${r.y})  ${res.log.join(' | ')}`);
}
await b.close();
process.exit(fail ? 1 : 0);
