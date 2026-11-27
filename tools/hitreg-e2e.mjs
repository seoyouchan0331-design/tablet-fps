/**
 * Hit registration (practice dummy, held still): one trigger pull of a rifle
 * or sniper must land exactly one hit, and a scoped sniper shot at the head
 * from 15 m must be a headshot.
 *   CHROME_PATH=/opt/pw-browsers/chromium node tools/hitreg-e2e.mjs [--port=4173]
 */
import { chromium } from 'playwright';
import { ipad, gameUrl } from './lib/env.mjs';
const PORT = Number((process.argv.find((a) => a.startsWith('--port=')) ?? '--port=4173').split('=')[1]);
let failed = false;
const fail = (m) => { console.error('FAIL', m); failed = true; };
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext(ipad())).newPage();
p.on('pageerror', (e) => fail('page error ' + String(e).slice(0, 200)));
const frames = (n) => p.evaluate((n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
await p.goto(gameUrl(`http://127.0.0.1:${PORT}/`), { waitUntil: 'commit' });
await p.waitForFunction(() => window.__READY__ === true, null, { timeout: 600000, polling: 2000 });
await p.evaluate(() => document.querySelector('[data-act=practice]').click());
await p.waitForTimeout(400);
await p.evaluate(() => document.querySelector('.ow-loadout .start')?.click());
await p.waitForTimeout(1200);

// freeze the dummy and stand 15 m in front of it with a clear line
await p.evaluate(() => {
  const e = window.__ENGINE__.ctx; const pr = e.peek('practice');
  pr.update = () => {}; // hold still
  // put it where a player 15 m away has a clear line to its head and body
  const pl = e.peek('player'); const ph = e.peek('physics'); const w = e.peek('world'); const V = pl.position.constructor;
  let ok = false;
  for (const off of [2.5, -2.5, 4, -4, 1.5, -1.5, 3, -3, 0]) {
    pr._place(off);
    const a = pr.avatar.position;
    const gy = w.groundHeight(a.x, a.z + 15);
    const eye = new V(a.x, gy + 1.6, a.z + 15);
    if (ph.lineOfSight(eye, new V(a.x, a.y + 1.62, a.z)) && ph.lineOfSight(eye, new V(a.x, a.y + 1.0, a.z))) {
      pl.movement.teleport(a.x, gy + 0.03, a.z + 15);
      ok = true;
      break;
    }
  }
  window.__clear = ok;
  window.__hits = []; window.__shots = 0;
  e.events.on('damage:dealt', (ev) => { if (ev.target?.isAvatar) window.__hits.push({ head: !!ev.headshot, amt: Math.round(ev.amount) }); });
  e.events.on('weapon:fire', (ev) => { if (!ev.remote) window.__shots++; });
});
if (!(await p.evaluate(() => window.__clear))) fail('no clear line to the dummy from any test spot');
// dy: metres above the feet, or 'head' for the drawn head's centre (+ 'up' m);
// side: metres to the target's left/right as seen by the shooter
const aimAt = (dy, side = 0) => p.evaluate(({ dy, side }) => {
  const e = window.__ENGINE__.ctx; const pl = e.peek('player'); const a = e.peek('practice').avatar;
  const y = typeof dy === 'number' ? dy : a.headY + (dy.up ?? 0);
  const eye = pl.eyePosition;
  const fx = a.position.x - eye.x, fz = a.position.z - eye.z; const L = Math.hypot(fx, fz);
  const tx = a.position.x + (-fz / L) * side, tz = a.position.z + (fx / L) * side; // shooter's right
  const dx = tx - eye.x, h = a.position.y + y - eye.y, dz = tz - eye.z;
  pl.movement.yaw = Math.atan2(-dx, -dz); pl.movement.pitch = Math.atan2(h, Math.hypot(dx, dz));
}, { dy, side });
const reset = () => p.evaluate(() => { const pr = window.__ENGINE__.ctx.peek('practice'); pr.dummy.hp = 100; pr.avatar.setAlive(true); window.__hits = []; window.__shots = 0; });

const HEAD = { up: 0 };
for (const [id, part, dy, scope, side = 0] of [
  ['rifle', 'body', 1.0, true],
  ['sniper', 'body', 1.0, true],
  ['sniper', 'head', HEAD, true],
  ['sniper', 'chest', 1.1, true],
  // the drawn head is ~0.62 m wide: its left and right edges count as the head
  ['sniper', 'head', HEAD, true, 0.24],
  ['sniper', 'head', HEAD, true, -0.24],
  // 15 cm above the drawn head is air
  ['sniper', 'miss', { up: 0.36 }, true],
]) {
  await p.evaluate((id) => window.__ENGINE__.ctx.events.emit('loadout:set', { primary: id }), id);
  await p.waitForFunction(() => window.__ENGINE__.ctx.peek('weapons').canFire(), null, { timeout: 30000 });
  // single shots only: one bullet, one verdict
  await p.evaluate(() => { const w = window.__ENGINE__.ctx.peek('weapons'); for (let i = 0; i < 3 && w.fireMode !== 'semi'; i++) w.cycleFireMode(); });
  if (scope) { await p.keyboard.down('KeyE'); await p.waitForFunction(() => window.__ENGINE__.ctx.peek('weapons').adsProgress > 0.99, null, { timeout: 20000 }); }
  // let the previous shot's camera recoil settle (it moves the real aim line)
  await p.waitForFunction(() => { const r = window.__ENGINE__.ctx.peek('player').rig.recoilPitch; return Math.abs(r.spring.value + r.residual) < 0.002; }, null, { timeout: 20000 });
  await reset();
  for (let i = 0; i < 3; i++) { await aimAt(dy, side); await frames(1); }
  await p.keyboard.down('KeyF'); await frames(1); await p.keyboard.up('KeyF');
  for (let i = 0; i < 10; i++) await frames(1);
  if (scope) await p.keyboard.up('KeyE');
  const r = await p.evaluate(() => ({ shots: window.__shots, hits: window.__hits }));
  console.log(`${id} at ${part}${side ? ` (${side > 0 ? 'right' : 'left'} edge)` : ''}: ${JSON.stringify(r)}`);
  if (r.shots !== 1) fail(`${id}: ${r.shots} shots fired`);
  if (part === 'miss') {
    if (r.hits.length) fail(`shot over the head hit ${JSON.stringify(r.hits)}`);
    await p.waitForTimeout(300);
    continue;
  }
  if (r.hits.length !== r.shots) fail(`${id} at ${part}: ${r.hits.length} hits from ${r.shots} bullets`);
  if (part === 'head' && !r.hits[0]?.head) fail('scoped sniper at the head was not a headshot');
  if (id === 'sniper' && part === 'body' && !(r.hits[0]?.amt >= 100)) fail(`sniper body shot did ${r.hits[0]?.amt} — must kill`);
  await p.waitForTimeout(300);
}
await b.close();
console.log(failed ? 'HITREG FAILED' : 'HITREG OK');
process.exit(failed ? 1 : 0);
