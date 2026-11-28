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
const loadMap = (id) => p.evaluate((id) => window.__ENGINE__.ctx.peek('world').load(id), id);
await loadMap('town');
await p.waitForTimeout(500);

const CANAL_ROUTES = {
  // down a stair into the canal, under the bridge's middle arch, through the
  // lock gate's doorway, back up a stair on the far quay
  canalfloor: { start: [9, -12.2], path: [[6.9, -12.2], [5.15, -12.6], [5.15, -7.8], [3.5, -8.2], [0, -8.2], [0, 8], [0, 14], [0, 16.4], [-5.15, 16.2], [-5.15, 20.6], [-7.5, 20.4], [-9, 20.4]], y: 0 },
  tunnel: { start: [0, -20, -3.15], path: [[2.5, -26], [8, -26], [21, -26], [27.3, -26], [29.5, -26]], y: 0 },
  // pushed sideways off a canal stair, toward the canal: the rail holds (stays on the steps, ~1.7 m up)
  stairrail: { start: [5.15, -10, -1.6], path: [[2.0, -10]], y: -1.71, blocked: true },
  plazabridge: { start: [9, 0], path: [[3, 0], [-3, 0], [-9, 0]], y: 0 },
  footbridge: { start: [9, 23], path: [[0, 23], [-9, 23]], y: 0 },
  gatewalk: { start: [8, 15], path: [[0, 15], [-8, 15]], y: 0 },
  canaltower: { start: [21, 24.5], path: [[23.4, 24.5], [23.5, 23.0], [27.5, 23.0], [27.5, 26.0], [23.5, 26.0], [23.5, 22.4], [25.5, 22.4], [25.5, 24.5]], y: 6.4 },
};
const SKY_ROUTES = {
  // the passage, the flank stair to the ring, the ring stair to the lookout
  skytower: { start: [-2, 0], path: [[-2.4, 2.3], [2.8, 2.3], [4.05, 2.3], [4.05, 4.7], [5.4, 4.7], [5.4, -1.4], [4.8, -2.6], [2, -2.6]], y: 6.4 },
  // ring -> sky bridge (weaving between its crates) -> annex
  skybridge: { start: [5, -4.5, 3.25], path: [[8.5, -4.0], [10.8, -4.0], [12.4, -5.0], [16, -5.0], [19, -5.0]], y: 3.2 },
  annexstair: { start: [24.8, -1.5], path: [[24.8, -7.8], [22, -7.5]], y: 3.2 },
  // hangar: up the south-wall stair, along the mezzanine, out its door onto the annex
  mezzanine: { start: [20, -20.4], path: [[21.3, -21.8], [26.2, -21.8], [27.3, -21.6], [27.3, -14.2], [19.6, -13], [19.6, -9]], y: 3.2 },
};
const ROUTES = {
  tower: { start: [19.5, 18.5], path: [[22.4, 18.5], [22.5, 16.5], [25.9, 16.5], [25.9, 20.5], [22.5, 20.5], [22.5, 16.5], [24.5, 18.2]], y: 6.4 },
  gallery: { start: [16.5, 21], path: [[15.3, 22.2], [9.4, 22.2], [5, 21], [-8.3, 21.3], [-10.6, 21.3]], y: 3.2 },
  bridge: { start: [16.4, 7.5], path: [[19.2, 7.5], [18.7, 9.9], [25.1, 9.9], [23.5, 6.5], [22, 5], [22, -3], [22, -5.6]], y: 3.2 },
  terrace: { start: [18.3, -13.5], path: [[18.8, -17], [22.6, -17], [25.9, -17], [29.6, -17], [31.5, -18.5]], y: 3.2 },
  spawnstair: { start: [33, -18.5, 3.25], path: [[34.2, -16.3], [34.2, -10]], y: 0 },
};
let fail = 0;
const ALL = [...Object.entries(ROUTES).map(([n, r]) => ['town', n, r]), ...Object.entries(CANAL_ROUTES).map(([n, r]) => ['canal', n, r]), ...Object.entries(SKY_ROUTES).map(([n, r]) => ['skybase', n, r])];
for (const [map, name, r] of ALL) {
  if ((await p.evaluate(() => window.__ENGINE__.ctx.peek('world').mapId)) !== map) {
    await loadMap(map);
    await p.waitForTimeout(500);
  }
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
  const ok = r.blocked ? !res.ok && Math.abs(res.y - r.y) < 0.35 : res.ok && Math.abs(res.y - r.y) < 0.25;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: y=${res.y.toFixed(2)} (want ${r.y})  ${res.log.join(' | ')}`);
}
// SKYBASE gadgets (the map is loaded: the sky routes ran last)
const gad = await p.evaluate(async () => {
  const e = window.__ENGINE__.ctx; const mv = e.peek('player').movement;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const settle = async () => { let last = Infinity; for (let i = 0; i < 60; i++) { await wait(100); if (Math.abs(mv.position.y - last) < 0.005 && mv.grounded) break; last = mv.position.y; } };
  const out = {};
  // jump pad: onto the middle of the sky bridge
  mv.teleport(11.5, 0.05, 4.5);
  await wait(300); await settle(); await wait(300); await settle();
  out.pad = { x: +mv.position.x.toFixed(2), y: +mv.position.y.toFixed(2), z: +mv.position.z.toFixed(2), launches: e.peek('gadgets').launches };
  // lift: stand on it, ride up, step off onto the annex
  mv.teleport(19, 0.05, -1.5);
  const t0 = performance.now(); let top = 0;
  while (performance.now() - t0 < 6000) { await wait(100); top = Math.max(top, mv.position.y); if (mv.position.y > 3.1) break; }
  out.liftTop = +top.toFixed(2);
  const input = e.input; const stick = { y: 0 };
  input.moveVector = (o = {}) => { o.x = 0; o.y = stick.y; return o; };
  mv.yaw = 0; stick.y = 1; // walk -z, onto the annex
  await wait(1200); stick.y = 0; await settle();
  out.lift = { y: +mv.position.y.toFixed(2), z: +mv.position.z.toFixed(2) };
  // over the edge, alone: the unstuck system brings you back onto the deck
  mv.teleport(31, 0.05, 3);
  await wait(2500); await settle();
  out.fall = { x: +mv.position.x.toFixed(2), y: +mv.position.y.toFixed(2), rescues: e.peek('unstuck').rescues };
  return out;
});
console.log('skybase gadgets:', JSON.stringify(gad));
const near = (a, b, d) => Math.abs(a - b) < d;
if (!(gad.pad.launches >= 1 && near(gad.pad.y, 3.2, 0.25) && near(gad.pad.z, -4.5, 1.6))) { fail++; console.log('FAIL jump pad did not land on the bridge'); }
if (!(gad.liftTop > 3.0 && near(gad.lift.y, 3.2, 0.25) && gad.lift.z < -2.6)) { fail++; console.log('FAIL the lift did not carry me onto the annex'); }
if (!(gad.fall.y > -0.5 && Math.abs(gad.fall.x) < 29)) { fail++; console.log('FAIL falling off the edge alone did not bring me back'); }
await b.close();
process.exit(fail ? 1 : 0);
