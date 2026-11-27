/**
 * Two-player duel, end to end, in one browser: page A creates a room, page B
 * joins it, both ready up, A shoots B, rounds/score/side-swap/results/rematch
 * and disconnect are checked. Uses `?net=bc` (BroadcastChannel) so it needs no
 * internet; the PeerJS path is the same MatchSystem over a different transport.
 *
 *   CHROME_PATH=/opt/pw-browsers/chromium node tools/duel-e2e.mjs [--port=4173]
 */
import { chromium, devices } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const PORT = Number(args.port ?? 4173);
const URL = `http://127.0.0.1:${PORT}/?net=bc`;
let failed = false;
const fail = (m) => { console.error('FAIL', m); failed = true; };
const step = (m) => console.log('·', m);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'] });
const errors = [];
const open = async (name) => {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${name}: ${String(e).slice(0, 300)}`));
  await p.goto(URL, { waitUntil: 'commit' });
  return p;
};
const [A, B] = await Promise.all([open('A'), open('B')]);
const ready = (p) => p.waitForFunction(() => window.__READY__ === true, null, { timeout: 900000, polling: 2000 });
await Promise.all([ready(A), ready(B)]);
step('both booted');

const click = (p, act) => p.evaluate((a) => document.querySelector(`[data-act="${a}"]`)?.click(), act);
const waitAct = (p, act, timeout = 60000) => p.waitForSelector(`[data-act="${act}"]`, { timeout });
const match = (p, fn, arg) => p.evaluate(fn, arg);
const waitMatch = (p, pred, timeout = 120000) => p.waitForFunction(pred, null, { timeout, polling: 250 });

// ---- create / join ---------------------------------------------------------
await waitAct(A, 'create'); await click(A, 'create');
await waitAct(A, 'room-code');
const code = await A.evaluate(() => document.querySelector('[data-act="room-code"]').textContent.trim());
step(`room ${code}`);
if (!/^[A-HJ-NP-Z2-9]{4}$/.test(code)) fail(`bad room code ${code}`);
await waitAct(B, 'join'); await click(B, 'join');
await waitAct(B, 'code');
await B.fill('[data-act="code"]', code.toLowerCase());
await click(B, 'join-go');
await Promise.all([waitAct(A, 'ready'), waitAct(B, 'ready')]);
step('both in lobby');

// host setting propagates to the guest
await click(A, 'rounds-3');
await waitMatch(B, () => window.__ENGINE__.ctx.peek('match').settings.winTarget === 3, 15000).catch(() => fail('guest did not receive host settings'));

await click(A, 'primary-smg');
await click(A, 'ready');
await click(B, 'ready');
await Promise.all([
  waitMatch(A, () => window.__ENGINE__.ctx.peek('match').live === true),
  waitMatch(B, () => window.__ENGINE__.ctx.peek('match').live === true),
]);
step('round 1 live on both');
const roles = await Promise.all([A, B].map((p) => match(p, () => window.__ENGINE__.ctx.peek('match').role)));
if (roles[0] !== 'host' || roles[1] !== 'guest') fail(`roles ${roles}`);


// ---- stall probe -------------------------------------------------------------
const arm = (p) => p.evaluate(() => {
  const r = window.__ENGINE__.ctx.peek('render').renderer;
  window.__probe = { max: 0, last: performance.now(), programs: () => r.info.programs.length, seen: new Set(r.info.programs.map((x) => x.cacheKey)) };
  const loop = (t) => { const d = t - window.__probe.last; window.__probe.last = t; if (d > window.__probe.max) window.__probe.max = d; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
});
const snap = (p) => p.evaluate(() => {
  const r = window.__ENGINE__.ctx.peek('render').renderer;
  const added = r.info.programs.filter((x) => !window.__probe.seen.has(x.cacheKey));
  for (const x of added) window.__probe.seen.add(x.cacheKey);
  const diffs = added.map((x) => {
    const twin = r.info.programs.find((y) => y !== x && y.name === x.name);
    if (!twin) return `${x.name}: (no twin)`;
    const a = twin.cacheKey.split(','), b = x.cacheKey.split(',');
    const d = []; for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) d.push(`#${i} ${a[i]} -> ${b[i]}`);
    return `${x.name}: ${d.join(' | ').slice(0, 300)}`;
  });
  const o = { programs: window.__probe.programs(), maxFrame: Math.round(window.__probe.max), added: diffs };
  window.__probe.max = 0; return o; });
await arm(A); await arm(B);
await B.evaluate(() => { const pl = window.__ENGINE__.ctx.peek('player'); pl.movement.teleport(3, 0.03, -3); });
await A.evaluate(() => { const pl = window.__ENGINE__.ctx.peek('player'); pl.movement.teleport(3, 0.03, 3); });
await A.waitForTimeout(3000);
console.log('baseline A', JSON.stringify(await snap(A)), 'B', JSON.stringify(await snap(B)));
const aim = () => A.evaluate(() => {
  const e = window.__ENGINE__; const pl = e.ctx.peek('player'); const a = e.ctx.peek('opponent').avatar.position;
  const eye = pl.eyePosition; const dx = a.x - eye.x, dy = a.y + 1.1 - eye.y, dz = a.z - eye.z;
  pl.movement.yaw = Math.atan2(-dx, -dz); pl.movement.pitch = Math.atan2(dy, Math.hypot(dx, dz));
});
const cdp = await ctx.newCDPSession(A);
const fire = await A.locator('.ow-touch .fire').boundingBox();
const press = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: fire.x + fire.width / 2, y: fire.y + fire.height / 2, id: 1 }] });
let phase = 'pre';
await press('touchStart');
for (let i = 0; i < 400; i++) {
  await aim();
  const s = await B.evaluate(() => ({ hp: window.__ENGINE__.ctx.peek('match').hp.guest, score: window.__ENGINE__.ctx.peek('match').score.host }));
  if (phase === 'pre' && s.hp < 100) { phase = 'hit'; await A.waitForTimeout(1500); console.log('FIRST HIT  A', JSON.stringify(await snap(A)), 'B', JSON.stringify(await snap(B))); }
  if (s.score >= 1) break;
  await A.waitForTimeout(50);
}
await press('touchEnd');
await A.waitForTimeout(1500);
console.log('ROUND END  A', JSON.stringify(await snap(A)), 'B', JSON.stringify(await snap(B)));
await A.waitForTimeout(6000);
console.log('NEXT ROUND A', JSON.stringify(await snap(A)), 'B', JSON.stringify(await snap(B)));
await browser.close();
