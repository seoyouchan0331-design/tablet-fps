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
/** Type a chat line through the UI (team: the TEAM toggle). */
const say = async (p, text, team = false) => {
  await click(p, 'chat-open');
  await waitAct(p, 'chat-input', 10000);
  if (team) await click(p, 'chat-team');
  else await click(p, 'chat-all');
  await p.fill('[data-act="chat-input"]', text);
  await click(p, 'chat-send');
};
const heard = (p, text, timeout = 15000) => waitP(p, (t) => window.__ENGINE__.ctx.peek('chat').lines.some((l) => l.text === t), timeout, text);

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

// chat in the room
await say(B, 'hi everyone');
await Promise.all([A, C].map((p) => heard(p, 'hi everyone').catch(() => fail('a room chat line did not reach everyone'))));
step('room chat reached A and C');

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
const stA = await A.evaluate(() => window.__ENGINE__.ctx.peek('stats').data);
const stB = await B.evaluate(() => window.__ENGINE__.ctx.peek('stats').data);
step(`stats: A ${JSON.stringify(stA)} | B ${JSON.stringify(stB)}`);
if (stA.kills < 1 || stA.xp < 100) fail("A's kill was not counted in its stats");
if (stB.deaths < 1) fail("B's death was not counted in its stats");
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
await waitAct(D, 'stats', 30000).catch(() => fail('no stats line on the main menu'));
step(`menu stats: ${await D.evaluate(() => document.querySelector('[data-act="stats"]').textContent)}`);
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
await click(A, 'bots-hard');
await waitP(B, () => window.__ENGINE__.ctx.peek('party').settings.botLevel === 'hard', 15000).catch(() => fail('bot level did not reach the guest'));
await D.close();
for (const p of [A, B]) await click(p, 'ready');
await Promise.all([A, B].map((p) => waitP(p, () => window.__ENGINE__.ctx.peek('party').live === true, 60000).catch(() => fail('bot match never went live'))));
const botId = await A.evaluate(() => [...window.__ENGINE__.ctx.peek('party').players.values()].find((p) => p.bot).id);
const p0 = await B.evaluate((id) => { const a = window.__ENGINE__.ctx.peek('opponent').get(id)?.avatar; return a ? [a.position.x, a.position.z, a.alive] : null; }, botId);
// keep the humans out of the way, then watch the bot hunt
// hide the humans upstairs in the two gateway houses on one side: the bot must
// hunt them (walk, climb the stairs) before it can shoot
await A.evaluate(() => window.__ENGINE__.ctx.peek('player').movement.teleport(-21, 3.25, -7.5));
await B.evaluate(() => window.__ENGINE__.ctx.peek('player').movement.teleport(-21, 3.25, 7.5));
await waitP(A, () => (window.__ENGINE__.ctx.peek('party').botShots ?? 0) > 0, 150000).catch(() => fail('the bot never found anyone to shoot'));
const by = await A.evaluate((id) => window.__ENGINE__.ctx.peek('party')._bots.get(id).y, botId);
step(`the bot fired from height ${by.toFixed(2)} m`);
const p1 = await B.evaluate((id) => { const a = window.__ENGINE__.ctx.peek('opponent').get(id)?.avatar; return a ? [a.position.x, a.position.z, a.alive] : null; }, botId);
step(`bot ${botId} seen by B: ${JSON.stringify(p0)} -> ${JSON.stringify(p1)}; host counted ${await A.evaluate(() => window.__ENGINE__.ctx.peek('party').botShots)} bot shots`);
// (how far it walked depends on where it spawned: hunting is checked by the
// shot it fired at someone hidden in a house; here only that B sees it)
if (!p0 || !p1) fail('B does not see the bot');

// ---- back to the room; king of the hill (A + B, no bots) ---------------------------------
const backToRoom = async () => {
  await A.evaluate(() => { window.__ENGINE__.ctx.peek('party').rules.timeLeft = 0.01; });
  await Promise.all([A, B].map((p) => waitAct(p, 'result', 20000).catch(() => fail('no results screen'))));
  await click(A, 'again');
  await waitAct(B, 'ready', 15000).catch(() => fail('guest not back in the room'));
};
await backToRoom();
await click(A, 'remove-bot');
await click(A, 'mode-koth');
await waitP(B, () => window.__ENGINE__.ctx.peek('party').settings.mode === 'koth', 15000).catch(() => fail('mode did not reach the guest'));
const teams = await A.evaluate(() => [...window.__ENGINE__.ctx.peek('party').players.values()].map((p) => p.team));
if (new Set(teams).size < 2) await click(B, 'switch-team');
for (const p of [A, B]) await click(p, 'ready');
await Promise.all([A, B].map((p) => waitP(p, () => window.__ENGINE__.ctx.peek('party').live === true, 60000).catch(() => fail('hill match never went live'))));
await A.evaluate(() => window.__ENGINE__.ctx.peek('player').movement.teleport(5, 0.03, 0));
await B.evaluate(() => window.__ENGINE__.ctx.peek('player').movement.teleport(-29.5, 0.03, 0));
const myTeam = await A.evaluate(() => { const P = window.__ENGINE__.ctx.peek('party'); return P.players.get(P.me).team; });
await waitP(B, (t) => (window.__ENGINE__.ctx.peek('party')._teams?.[t] ?? 0) >= 2, 30000, myTeam).catch(() => fail('holding the hill scored nothing'));
// team chat stays in the team, all chat reaches everyone (A and B are on different teams)
await say(B, 'secret plan', true);
await heard(B, 'secret plan').catch(() => fail('the sender does not see its own team line'));
await say(B, 'gg all');
await heard(A, 'gg all').catch(() => fail('an ALL line did not reach the other team'));
if (await A.evaluate(() => window.__ENGINE__.ctx.peek('chat').lines.some((l) => l.text === 'secret plan'))) fail('a TEAM line leaked to the other team');
step('team chat stayed in the team; all chat crossed');
await click(A, 'chat-open');
await A.fill('[data-act="chat-input"]', 'on my way to the hill');
await A.screenshot({ path: 'shots/party-chat.png' });
await A.evaluate(() => window.__ENGINE__.ctx.peek('chat').close());
const hill = await A.evaluate(() => { const P = window.__ENGINE__.ctx.peek('party'); return { teams: P._teams, ring: P._hill?.material.color.getHexString(), hud: window.__ENGINE__.ctx.peek('ui').state.scoreUs }; });
step(`hill: ${JSON.stringify(hill)}`);
if (hill.ring !== '2fd8ff') fail('the hill ring should be cyan (ours) for A');
if (hill.hud < 2) fail("A's HUD does not show the hill points");

// ---- gun game ------------------------------------------------------------------------------
await backToRoom();
await click(A, 'mode-gun');
await waitP(B, () => window.__ENGINE__.ctx.peek('party').settings.mode === 'gun', 15000).catch(() => fail('gun mode did not reach the guest'));
for (const p of [A, B]) await click(p, 'ready');
await Promise.all([A, B].map((p) => waitP(p, () => window.__ENGINE__.ctx.peek('party').live === true, 60000).catch(() => fail('gun game never went live'))));
const w0 = await B.evaluate(() => window.__ENGINE__.ctx.peek('weapons').activeId);
// two kills for B, booked by the host's rules
await A.evaluate(() => {
  const P = window.__ENGINE__.ctx.peek('party');
  P._hostEvents(P.rules.kill(1, 0));
  P.rules.players.get(0).alive = true;
  P._hostEvents(P.rules.kill(1, 0));
});
await waitP(B, () => window.__ENGINE__.ctx.peek('weapons').activeId === 'smg', 15000).catch(() => fail('2 kills did not step B up to the SMG'));
step(`gun game: B started with ${w0}, after 2 kills holds ${await B.evaluate(() => window.__ENGINE__.ctx.peek('weapons').activeId)}`);
if (w0 !== 'rifle') fail('gun game starts on the rifle');

// ---- a grenade: thrown by B, the host applies the blast to A --------------------------------
await waitP(A, () => { const e = window.__ENGINE__.ctx; return e.peek('party').alive[0] === true && !e.peek('player').dead; }, 20000).catch(() => fail('A did not respawn'));
await A.waitForTimeout(1700); // spawn protection
await A.evaluate(() => window.__ENGINE__.ctx.peek('player').movement.teleport(-10, 0.03, 2));
await B.evaluate(() => { const pl = window.__ENGINE__.ctx.peek('player'); pl.movement.teleport(-10, 0.03, 7); pl.movement.yaw = 0; pl.movement.pitch = -0.75; });
await B.waitForTimeout(400);
const thrown = await B.evaluate(() => { const g = window.__ENGINE__.ctx.peek('grenades'); const before = g.count; const ok = g.throw(); return { ok, before, after: g.count }; });
step(`B throws: ${JSON.stringify(thrown)}`);
if (!thrown.ok || thrown.after !== thrown.before - 1) fail('B could not throw a grenade');
await waitP(A, () => window.__ENGINE__.ctx.peek('grenades').live.length > 0, 10000).catch(() => fail("the host never saw B's grenade"));
await waitP(A, () => (window.__ENGINE__.ctx.peek('party').hp[0] ?? 100) < 100, 60000).catch(() => fail('the blast did not hurt A'));
step(`A after the blast: hp ${(await A.evaluate(() => window.__ENGINE__.ctx.peek('party').hp[0])).toFixed(0)}`);

// ---- host migration: E joins the running match, then the host (A) leaves ---------------------
const E = await open('E');
await E.waitForFunction(() => window.__READY__ === true, null, { timeout: 900000, polling: 2000 });
await waitAct(E, 'join'); await click(E, 'join');
await waitAct(E, 'code');
await E.fill('[data-act="code"]', code);
await click(E, 'join-go');
await waitP(E, () => { const P = window.__ENGINE__.ctx.peek('party'); return P.phase === 'match' && P.alive[P.me] === true; }, 60000).catch(() => fail('E never got into the match'));
const eId = await E.evaluate(() => window.__ENGINE__.ctx.peek('party').me);
const bKills = await B.evaluate(() => window.__ENGINE__.ctx.peek('party')._scores[1]?.[0]);
await A.close();
step(`host A left (E is ${eId}, B had ${bKills} kills)`);
await waitP(B, () => window.__ENGINE__.ctx.peek('party').host === true, 30000).catch(() => fail('B did not take over as host'));
await waitP(E, () => { const P = window.__ENGINE__.ctx.peek('party'); return P.hostId === 1 && P.link && P.phase === 'match'; }, 40000).catch(() => fail('E did not reconnect to the new host'));
await waitP(B, (id) => !!window.__ENGINE__.ctx.peek('party').players.get(id)?.peer, 30000, eId).catch(() => fail('new host does not have E back'));
const after = await Promise.all([B, E].map((p) => p.evaluate(() => { const P = window.__ENGINE__.ctx.peek('party'); return { host: P.host, hostId: P.hostId, live: P.live, players: [...P.players.keys()], bKills: P._scores[1]?.[0], rules: P.rules?.state }; })));
step(`after migration: B ${JSON.stringify(after[0])} | E ${JSON.stringify(after[1])}`);
if (after[0].rules !== 'live' || !after[0].live) fail('the match did not carry on under the new host');
if (after[0].bKills !== bKills) fail("B's kills were lost in the migration");
if (after[0].players.includes(0) || after[1].players.includes(0)) fail('the old host is still listed');
// E moves: the new host sees it
await E.evaluate(() => window.__ENGINE__.ctx.peek('player').movement.teleport(-6, 0.03, -18));
await waitP(B, (id) => { const a = window.__ENGINE__.ctx.peek('opponent').get(id)?.avatar; return a && Math.abs(a.position.z + 18) < 0.4; }, 30000, eId).catch(() => fail("the new host does not see E's moves"));
step('the match carries on under B');

if (errors.length) { fail('page errors'); for (const e of errors) console.error('  ', e); }
await browser.close();
console.log(failed ? 'PARTY FAILED' : 'PARTY OK');
process.exit(failed ? 1 : 0);
