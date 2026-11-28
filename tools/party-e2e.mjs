/**
 * Party of three, end to end, in one browser: A opens a party room, B and C
 * join with its 5-character code, everyone readies, A shoots B; the kill
 * shows in every kill feed, scores agree, B respawns elsewhere, C leaves
 * mid-match, the match ends and the host takes everyone back to the room.
 * `?net=bc` (BroadcastChannel tabs): no internet needed.
 *
 *   node tools/party-e2e.mjs [--port=4173]
 */
import { chromium } from 'playwright';
import { ipad, gameUrl } from './lib/env.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const PORT = Number(args.port ?? 4173);
const URL = gameUrl(`http://127.0.0.1:${PORT}/?net=bc`);
let failed = false;
const fail = (m) => { console.error('FAIL', m); failed = true; };
const step = (m) => console.log('·', m);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext(ipad());
const errors = [];
const open = async (name) => {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${name}: ${String(e).slice(0, 300)}`));
  await p.goto(URL, { waitUntil: 'commit' });
  return p;
};
const [A, B, C] = await Promise.all([open('A'), open('B'), open('C')]);
await Promise.all([A, B, C].map((p) => p.waitForFunction(() => window.__READY__ === true, null, { timeout: 900000, polling: 2000 })));
step('three tabs booted');

const click = (p, act) => p.evaluate((a) => document.querySelector(`[data-act="${a}"]`)?.click(), act);
const waitAct = (p, act, timeout = 60000) => p.waitForSelector(`[data-act="${act}"]`, { timeout });
const party = (p, fn, arg) => p.evaluate(fn, arg);
const waitP = (p, pred, timeout = 120000, arg) => p.waitForFunction(pred, arg, { timeout, polling: 250 });

// ---- open / join ------------------------------------------------------------
await waitAct(A, 'party'); await click(A, 'party');
await waitAct(A, 'room-code');
const code = await A.evaluate(() => document.querySelector('[data-act="room-code"]').textContent.trim());
step(`party ${code}`);
if (!/^[A-HJ-NP-Z2-9]{5}$/.test(code)) fail(`bad party code ${code}`);
for (const p of [B, C]) {
  await waitAct(p, 'join'); await click(p, 'join');
  await waitAct(p, 'code');
  await p.fill('[data-act="code"]', code.toLowerCase());
  await click(p, 'join-go');
}
await Promise.all([A, B, C].map((p) => waitP(p, () => window.__ENGINE__.ctx.peek('party').players.size === 3, 30000).catch(() => fail('roster never reached 3'))));
const ids = await Promise.all([A, B, C].map((p) => party(p, () => window.__ENGINE__.ctx.peek('party').me)));
step(`ids ${ids}`);
if (ids.join() !== '0,1,2') fail(`ids ${ids}`);

// names: A calls itself Alpha; everyone's list shows it
await A.fill('[data-act="name"]', 'Alpha');
await A.evaluate(() => document.querySelector('[data-act="name"]').dispatchEvent(new Event('change')));
await waitP(B, () => document.querySelector('[data-act="players"]')?.textContent.includes('Alpha'), 15000).catch(() => fail("B's player list does not show A's name"));

// host settings reach the guests
await click(A, 'map-lanes');
await waitP(C, () => window.__ENGINE__.ctx.peek('party').settings.map === 'lanes', 15000).catch(() => fail('guest did not get the map pick'));
await click(B, 'primary-smg');
await B.screenshot({ path: 'shots/party-lobby.png' });
for (const p of [A, B, C]) await click(p, 'ready');
const dump = () => Promise.all([A, B, C].map((p) => party(p, () => { const P = window.__ENGINE__.ctx.peek('party'); return JSON.stringify({ me: P.me, phase: P.phase, live: P.live, players: [...P.players.values()].map((x) => [x.id, x.ready]), rules: P.rules?.state }); })));
try {
  await Promise.all([A, B, C].map((p) => waitP(p, () => window.__ENGINE__.ctx.peek('party').live === true)));
} catch (e) {
  console.error('never live:', (await dump()).join(' | '));
  throw e;
}
step('match live on all three');
const seen = await Promise.all([A, B, C].map((p) => party(p, () => [window.__ENGINE__.ctx.peek('world').mapId, window.__ENGINE__.ctx.peek('opponent').party.size])));
step(`map / others: ${JSON.stringify(seen)}`);
if (seen.some(([m, n]) => m !== 'lanes' || n !== 2)) fail('every player should be on LANES with two others');
// nobody spawns on top of anybody
const pos = await Promise.all([A, B, C].map((p) => party(p, () => { const q = window.__ENGINE__.ctx.peek('player').position; return [q.x, q.z]; })));
const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
step(`spawn gaps ${d(pos[0], pos[1]).toFixed(1)} ${d(pos[0], pos[2]).toFixed(1)} ${d(pos[1], pos[2]).toFixed(1)} m`);
if (Math.min(d(pos[0], pos[1]), d(pos[0], pos[2]), d(pos[1], pos[2])) < 4) fail('players spawned on top of each other');

// ---- A shoots B ----------------------------------------------------------------
await B.evaluate(() => window.__ENGINE__.ctx.peek('player').movement.teleport(3, 0.03, -3));
await A.evaluate(() => window.__ENGINE__.ctx.peek('player').movement.teleport(3, 0.03, 3));
await C.evaluate(() => window.__ENGINE__.ctx.peek('player').movement.teleport(-10, 0.03, 10));
await waitP(A, () => { const r = window.__ENGINE__.ctx.peek('opponent').get(1); return r?.avatar.alive && Math.abs(r.avatar.position.z + 3) < 0.3; }, 30000)
  .catch(() => fail('A never saw B at its new position (relayed state)'));
// protection after the start is long over (1.5 s): wait it out anyway
await A.waitForTimeout(1600);
const aim = () => A.evaluate(() => {
  const e = window.__ENGINE__; const pl = e.ctx.peek('player'); const a = e.ctx.peek('opponent').get(1).avatar.position;
  const eye = pl.eyePosition; const dx = a.x - eye.x, dy = a.y + 1.1 - eye.y, dz = a.z - eye.z;
  pl.movement.yaw = Math.atan2(-dx, -dz); pl.movement.pitch = Math.atan2(dy, Math.hypot(dx, dz));
});
const cdp = await ctx.newCDPSession(A);
const fire = await A.locator('.ow-touch .fire').boundingBox();
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fire.x + fire.width / 2, y: fire.y + fire.height / 2, id: 1 }] });
let hurt = false, killed = false;
for (let i = 0; i < 400 && !killed; i++) {
  await aim();
  const s = await B.evaluate(() => { const e = window.__ENGINE__.ctx; return { hp: e.peek('party').hp[1], health: e.peek('player').health.value, alive: e.peek('party').alive[1] }; });
  if (s.hp < 100 && !hurt) { hurt = true; step(`B hit: host hp ${s.hp}, B's own bar ${s.health.toFixed(0)}`); if (s.health >= 100) fail("victim's health bar did not drop"); }
  if (s.alive === false) killed = true;
  await A.waitForTimeout(50);
}
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
if (!hurt) fail('no hit on B was accepted by the host');
if (!killed) fail('B never died');
const scores = await Promise.all([A, B, C].map((p) => party(p, () => JSON.stringify(window.__ENGINE__.ctx.peek('party')._scores))));
step(`scores ${scores.join(' | ')}`);
if (new Set(scores).size !== 1 || JSON.parse(scores[0])[0]?.[0] !== 1 || JSON.parse(scores[0])[1]?.[1] !== 1) fail('kill not recorded the same on every side');
await C.screenshot({ path: 'shots/party-feed.png' });
const feed = await C.evaluate(() => document.querySelector('.ow-feed')?.textContent ?? '');
step(`C's kill feed: "${feed.trim()}"`);
if (!/Alpha\s+▸\s+P2/.test(feed)) fail("the kill (by Alpha) is missing from C's feed");
const board = await B.evaluate(() => window.__ENGINE__.ctx.peek('party').ui.lastBoard ?? '');
step(`B's scoreboard while dead: "${board.slice(0, 60)}"`);
if (!/Respawn in/.test(board)) fail('no scoreboard with a respawn countdown on the dead player');

// ---- B respawns ------------------------------------------------------------------
await waitP(B, () => { const e = window.__ENGINE__.ctx; return e.peek('party').alive[1] === true && !e.peek('player').dead; }, 15000)
  .catch(() => fail('B did not respawn'));
const back = await B.evaluate(() => { const e = window.__ENGINE__.ctx; const q = e.peek('player').position; return { hp: e.peek('player').health.value, x: q.x, z: q.z }; });
step(`B back: health ${back.hp.toFixed(0)} at ${back.x.toFixed(1)},${back.z.toFixed(1)}`);
if (back.hp < 100) fail('B respawned hurt');
await waitP(A, () => window.__ENGINE__.ctx.peek('opponent').get(1)?.avatar.alive === true, 10000).catch(() => fail('A does not see B alive again'));

// ---- C leaves ----------------------------------------------------------------------
await C.close();
await waitP(A, () => window.__ENGINE__.ctx.peek('party').players.size === 2 && !window.__ENGINE__.ctx.peek('opponent').get(2), 15000)
  .catch(() => fail('host still lists C after C left'));
await waitP(B, () => !window.__ENGINE__.ctx.peek('opponent').get(2), 15000).catch(() => fail('B still draws C after C left'));
step('C left; A and B carry on');

// ---- D joins the running match ------------------------------------------------------
const D = await open('D');
await D.waitForFunction(() => window.__READY__ === true, null, { timeout: 900000, polling: 2000 });
await waitAct(D, 'join'); await click(D, 'join');
await waitAct(D, 'code');
await D.fill('[data-act="code"]', code);
await click(D, 'join-go');
await waitP(D, () => { const e = window.__ENGINE__.ctx; const P = e.peek('party'); return P.phase === 'match' && P.alive[P.me] === true && !e.peek('player').dead; }, 60000)
  .catch(() => fail('late joiner D never got into the match alive'));
const dv = await D.evaluate(() => { const e = window.__ENGINE__.ctx; return { me: e.peek('party').me, map: e.peek('world').mapId, others: e.peek('opponent').party.size, score: JSON.stringify(e.peek('party')._scores[0]) }; });
step(`D joined late: ${JSON.stringify(dv)}`);
if (dv.map !== 'lanes' || dv.others !== 2) fail('D should be on LANES seeing A and B');
if (dv.score !== '[1,0]') fail("D did not get the match's scores");
await waitP(A, (id) => window.__ENGINE__.ctx.peek('opponent').get(id)?.avatar.alive === true, 20000, dv.me).catch(() => fail('A does not see D'));

// ---- the end, back to the room -------------------------------------------------
await A.evaluate(() => { window.__ENGINE__.ctx.peek('party').rules.timeLeft = 0.01; });
await Promise.all([A, B, D].map((p) => waitAct(p, 'result', 15000).catch(() => fail('no results screen'))));
const res = await B.evaluate(() => document.querySelector('[data-act="result"]').textContent);
step(`B result: ${res}`);
if (res !== 'Alpha WINS') fail(`B should see Alpha win, saw ${res}`);
await click(A, 'again');
await waitAct(B, 'ready', 15000).catch(() => fail('guest not back in the room'));
const ph = await Promise.all([A, B].map((p) => party(p, () => window.__ENGINE__.ctx.peek('party').phase)));
if (ph.join() !== 'lobby,lobby') fail(`phases after BACK TO ROOM: ${ph}`);
step('back in the room');

// ---- bots ----------------------------------------------------------------------------
await click(A, 'add-bot');
await click(A, 'add-bot');
await waitP(B, () => [...window.__ENGINE__.ctx.peek('party').players.values()].filter((p) => p.bot).length === 2, 15000).catch(() => fail('B does not list the two bots'));
await click(A, 'remove-bot');
await waitP(B, () => [...window.__ENGINE__.ctx.peek('party').players.values()].filter((p) => p.bot).length === 1, 15000).catch(() => fail('bot not removed'));
await click(A, 'map-town');
await D.close();
for (const p of [A, B]) await click(p, 'ready');
await Promise.all([A, B].map((p) => waitP(p, () => window.__ENGINE__.ctx.peek('party').live === true, 60000).catch(() => fail('bot match never went live'))));
const botId = await A.evaluate(() => [...window.__ENGINE__.ctx.peek('party').players.values()].find((p) => p.bot).id);
const p0 = await B.evaluate((id) => { const a = window.__ENGINE__.ctx.peek('opponent').get(id)?.avatar; return a ? [a.position.x, a.position.z, a.alive] : null; }, botId);
// keep the humans out of the way, then watch the bot hunt
await A.evaluate(() => window.__ENGINE__.ctx.peek('player').movement.teleport(-29.5, 0.03, 0));
await B.evaluate(() => window.__ENGINE__.ctx.peek('player').movement.teleport(29.5, 0.03, 0));
await waitP(A, () => (window.__ENGINE__.ctx.peek('party').botShots ?? 0) > 0, 90000).catch(() => fail('the bot never fired'));
const p1 = await B.evaluate((id) => { const a = window.__ENGINE__.ctx.peek('opponent').get(id)?.avatar; return a ? [a.position.x, a.position.z, a.alive] : null; }, botId);
step(`bot ${botId} seen by B: ${JSON.stringify(p0)} -> ${JSON.stringify(p1)}; host counted ${await A.evaluate(() => window.__ENGINE__.ctx.peek('party').botShots)} bot shots`);
if (!p0 || !p1) fail('B does not see the bot');
else if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 2) fail('the bot did not move');

if (errors.length) { fail('page errors'); for (const e of errors) console.error('  ', e); }
await browser.close();
console.log(failed ? 'PARTY FAILED' : 'PARTY OK');
process.exit(failed ? 1 : 0);
