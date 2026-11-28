/**
 * Two-player duel, end to end, in one browser: page A creates a room, page B
 * joins it, both ready up, A shoots B, rounds/score/side-swap/results/rematch
 * and disconnect are checked. Uses `?net=bc` (BroadcastChannel) so it needs no
 * internet; the PeerJS path is the same MatchSystem over a different transport.
 *
 *   CHROME_PATH=/opt/pw-browsers/chromium node tools/duel-e2e.mjs [--port=4173]
 */
import { chromium, devices } from 'playwright';
import { ipad, gameUrl } from './lib/env.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const PORT = Number(args.port ?? 4173);
const URL = gameUrl(`http://127.0.0.1:${PORT}/?net=bc`);
let failed = false;
const fail = (m) => { console.error('FAIL', m); failed = true; };
const step = (m) => console.log('·', m);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext(ipad());
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
await B.waitForFunction(() => /\d+ ms/.test(document.querySelector('[data-act="net-info"]')?.textContent ?? ''), null, { timeout: 15000 })
  .catch(() => fail('lobby never showed a ping'));
step('net ' + (await B.evaluate(() => document.querySelector('[data-act="net-info"]')?.textContent)));

// chat: the guest types, the host reads
await click(B, 'chat-open');
await B.waitForSelector('[data-act="chat-input"]', { timeout: 10000 });
await B.fill('[data-act="chat-input"]', 'good luck');
await click(B, 'chat-send');
await A.waitForFunction(() => window.__ENGINE__.ctx.peek('chat').lines.some((l) => l.text === 'good luck'), null, { timeout: 15000, polling: 250 })
  .catch(() => fail('duel chat did not reach the host'));
step('duel chat ok');

// host setting propagates to the guest
await click(A, 'rounds-3');
await waitMatch(B, () => window.__ENGINE__.ctx.peek('match').settings.winTarget === 3, 15000).catch(() => fail('guest did not receive host settings'));

await click(A, 'map-lanes');
await waitMatch(B, () => window.__ENGINE__.ctx.peek('match').settings.map === 'lanes', 15000).catch(() => fail('guest did not receive the map pick'));
await B.screenshot({ path: 'shots/lobby-guest.png' });
await click(A, 'primary-smg');
await click(A, 'ready');
await click(B, 'ready');
await Promise.all([
  waitMatch(A, () => window.__ENGINE__.ctx.peek('match').live === true),
  waitMatch(B, () => window.__ENGINE__.ctx.peek('match').live === true),
]);
step('round 1 live on both');
const maps = await Promise.all([A, B].map((p) => p.evaluate(() => window.__ENGINE__.ctx.peek('world').mapId)));
step(`maps ${maps}`);
if (maps[0] !== 'lanes' || maps[1] !== 'lanes') fail('picked map not loaded on both sides');
const roles = await Promise.all([A, B].map((p) => match(p, () => window.__ENGINE__.ctx.peek('match').role)));
if (roles[0] !== 'host' || roles[1] !== 'guest') fail(`roles ${roles}`);

// ---- A shoots B --------------------------------------------------------------
await B.evaluate(() => { const pl = window.__ENGINE__.ctx.peek('player'); pl.movement.teleport(3, 0.03, -3); });
await A.evaluate(() => { const pl = window.__ENGINE__.ctx.peek('player'); pl.movement.teleport(3, 0.03, 3); });
await A.waitForFunction(() => { const o = window.__ENGINE__.ctx.peek('opponent'); return o.avatar.alive && Math.abs(o.avatar.position.z + 3) < 0.3; }, null, { timeout: 30000 })
  .catch(() => fail('A never saw B at its new position (state sync)'));
const aim = () => A.evaluate(() => {
  const e = window.__ENGINE__; const pl = e.ctx.peek('player'); const a = e.ctx.peek('opponent').avatar.position;
  const eye = pl.eyePosition; const dx = a.x - eye.x, dy = a.y + 1.1 - eye.y, dz = a.z - eye.z;
  pl.movement.yaw = Math.atan2(-dx, -dz); pl.movement.pitch = Math.atan2(dy, Math.hypot(dx, dz));
});
const cdp = await ctx.newCDPSession(A);
const fire = await A.locator('.ow-touch .fire').boundingBox();
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fire.x + fire.width / 2, y: fire.y + fire.height / 2, id: 1 }] });
let hurt = false;
for (let i = 0; i < 400; i++) {
  await aim();
  const s = await B.evaluate(() => { const e = window.__ENGINE__; return { hp: e.ctx.peek('match').hp.guest, health: e.ctx.peek('player').health.value, score: e.ctx.peek('match').score }; });
  if (s.hp < 100 && !hurt) { hurt = true; step(`B hit: hp ${s.hp}, B's own health ${s.health.toFixed(0)}`); if (s.health >= 100) fail('victim HUD health did not drop'); }
  if (s.score.host >= 1) break;
  await A.waitForTimeout(50);
}
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
if (!hurt) fail('no hit on B was accepted by the host');
const sc = await Promise.all([A, B].map((p) => match(p, () => window.__ENGINE__.ctx.peek('match').score)));
step(`score after kill A=${JSON.stringify(sc[0])} B=${JSON.stringify(sc[1])}`);
if (sc[0].host !== 1 || sc[1].host !== 1) fail('round win not recorded on both sides');

// ---- B sees how it died, and the killcam turns B toward A --------------------------
await B.waitForTimeout(900);
const dr = await B.evaluate(() => {
  const n = document.querySelector('[data-act="death-recap"]');
  const e = window.__ENGINE__.ctx; const pl = e.peek('player'); const o = e.peek('opponent').avatar.position;
  const eye = pl.eyePosition; const want = Math.atan2(-(o.x - eye.x), -(o.z - eye.z));
  let d = want - pl.movement.yaw; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
  return { shown: n && getComputedStyle(n).display, text: n?.textContent ?? '', yawOff: Math.abs(d) * 57.3 };
});
step(`B recap "${dr.text.slice(0, 80)}", killcam off by ${dr.yawOff.toFixed(1)} deg`);
if (dr.shown !== 'block') fail('no death recap on the victim');
if (!/MPX-9 · SMG/.test(dr.text)) fail('recap does not name the SMG that killed B');
if (dr.yawOff > 15) fail('killcam did not turn B toward A');

// ---- between rounds: B switches to the shotgun ------------------------------------
await waitAct(B, 'round-pick-shotgun', 15000).catch(() => fail('no weapon pick between rounds'));
const pickShown = await B.evaluate(() => getComputedStyle(document.querySelector('.ow-rpick')).display);
if (pickShown !== 'flex') fail('round pick hidden during the round break');
await click(B, 'round-pick-shotgun');

// ---- round 2: sides swapped ---------------------------------------------------
await waitMatch(A, () => { const m = window.__ENGINE__.ctx.peek('match'); return m.live && m.score.host === 1; });
await waitMatch(B, () => window.__ENGINE__.ctx.peek('match').live, 15000);
const bw = await B.evaluate(() => ({ w: window.__ENGINE__.ctx.peek('weapons').activeId, pick: getComputedStyle(document.querySelector('.ow-rpick')).display }));
step(`B round 2 weapon ${bw.w}, pick strip ${bw.pick}`);
if (bw.w !== 'shotgun') fail('round pick did not change the weapon');
if (bw.pick !== 'none') fail('round pick still showing in a live round');
await waitMatch(A, () => window.__ENGINE__.ctx.peek('opponent').avatar.weapon === 'shotgun', 15000)
  .catch(() => fail("host does not see the guest's new shotgun"));
const zA = await A.evaluate(() => window.__ENGINE__.ctx.peek('player').position.z);
step(`round 2 live, host spawn z=${zA.toFixed(1)}`);
if (!(zA < -6)) fail('host did not swap to the far spawn in round 2');

// ---- fast-forward to match end, then rematch ---------------------------------
await A.evaluate(() => { const m = window.__ENGINE__.ctx.peek('match'); m.mode.score.host = 2; m._broadcastRound(m.mode.kill('guest')); });
await Promise.all([waitAct(A, 'result'), waitAct(B, 'result')]);
const res = await Promise.all([A, B].map((p) => p.evaluate(() => document.querySelector('[data-act="result"]').textContent)));
step(`results A="${res[0]}" B="${res[1]}"`);
if (res[0] !== 'YOU WIN' || res[1] !== 'YOU LOSE') fail('wrong results');
await click(A, 'rematch');
await A.waitForTimeout(1500);
if ((await match(A, () => window.__ENGINE__.ctx.peek('match').phase)) !== 'results') fail('rematch started with only one player ready');
await click(B, 'rematch');
await waitMatch(A, () => window.__ENGINE__.ctx.peek('match').phase === 'match', 30000).catch(() => fail('rematch did not start'));
step('rematch started');

// ---- disconnect ----------------------------------------------------------------
const t0 = Date.now();
await B.close();
await waitMatch(A, () => window.__ENGINE__.ctx.peek('match').phase === 'menu', 15000).catch(() => fail('A did not return to menu after B left'));
step(`A back at menu ${((Date.now() - t0) / 1000).toFixed(1)} s after B left`);
if ((await A.evaluate(() => window.__ENGINE__.ctx.peek('world').mapId)) !== 'grid') fail('menu did not go back to the GRID map');
if (Date.now() - t0 > 5000) fail('disconnect took longer than 5 s to notice');

if (errors.length) fail('page errors:\n' + errors.join('\n'));
console.log(failed ? 'DUEL FAILED' : 'DUEL OK');
await browser.close();
process.exitCode = failed ? 1 : 0;
