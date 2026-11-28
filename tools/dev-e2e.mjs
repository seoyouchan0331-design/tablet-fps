/**
 * Developer panel (?dev=1): opens, loads every map, draws every gun, and the
 * feedback buttons run without errors. Screenshot: shots/dev-panel.png.
 *   CHROME_PATH=/opt/pw-browsers/chromium node tools/dev-e2e.mjs [--port=4173]
 */
import { chromium } from 'playwright';
import { ipad, gameUrl } from './lib/env.mjs';
const PORT = Number((process.argv.find((a) => a.startsWith('--port=')) ?? '--port=4173').split('=')[1]);
let failed = false;
const fail = (m) => { console.error('FAIL', m); failed = true; };
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext(ipad())).newPage();
p.on('pageerror', (e) => fail('page error ' + String(e).slice(0, 200)));
await p.goto(gameUrl(`http://127.0.0.1:${PORT}/?dev=1`), { waitUntil: 'commit' });
await p.waitForFunction(() => window.__READY__ === true, null, { timeout: 600000, polling: 2000 });
await p.evaluate(() => document.querySelector('[data-act=practice]').click());
await p.waitForTimeout(400);
await p.evaluate(() => document.querySelector('.ow-loadout .start')?.click());
await p.waitForTimeout(600);
const click = (act) => p.evaluate((a) => document.querySelector(`[data-act="dev-${a}"]`)?.click(), act);
await p.evaluate(() => document.querySelector('.dev-btn').click());
for (const id of ['grid', 'lanes', 'blocks', 'town', 'field']) {
  await click(`map-${id}`);
  await p.waitForTimeout(300);
  const m = await p.evaluate(() => window.__ENGINE__.ctx.peek('world').mapId);
  if (m !== id) fail(`map ${id} not loaded (${m})`);
}
console.log('maps ok');
for (const id of ['rifle', 'smg', 'shotgun', 'sniper', 'pistol']) {
  await click(`weapon-${id}`);
  await p.waitForTimeout(200);
  if ((await p.evaluate(() => window.__ENGINE__.ctx.peek('weapons').activeId)) !== id) fail(`weapon ${id}`);
}
console.log('weapons ok');
for (const a of ['god', 'ammo', 'hitboxes', 'dummy-ahead', 'kill-3', 'kill-5', 'recap', 'killcam', 'speed-0.5', 'speed-1']) await click(a);
await p.waitForTimeout(1200);
const st = await p.evaluate(() => ({ hb: !!window.__DEVPANEL__._hb, frozen: window.__DEVPANEL__.flags.freeze, stats: document.querySelector('.dev-panel .stats')?.textContent }));
console.log('state', JSON.stringify(st));
if (!st.hb || !st.frozen) fail('hitboxes / dummy freeze not active');
await p.screenshot({ path: 'shots/dev-panel.png' });

// ---- never trapped: inside a box, or out of the map, the player is moved back ----
for (const [what, place] of [
  ['inside a box', () => { const e = window.__ENGINE__.ctx; const b = e.peek('world').layout.boxes.find((x) => !x.wall && !x.floor && !x.deco && !x.hidden && !x.ramp && !x.ry && x.w > 1.5 && x.d > 1.5 && x.h > 2 && x.y - x.h / 2 < 0.05); const mv = e.peek('player').movement; mv.teleport(b.x, b.y - b.h / 2 + 0.1, b.z); const P = mv.position; const inside = !mv.character.checkCapsule(P.x, P.y + 0.02, P.z) || e.peek('unstuck').insideSolid(e.peek('world').layout, P.x, P.y + 0.5, P.z); return [b.x, b.z, b.w, b.h, inside ? 'inside' : 'clear?!']; }],
  ['under the map', () => { const mv = window.__ENGINE__.ctx.peek('player').movement; mv.teleport(3, -20, 3); return [3, 3, mv.position.y < -1 ? 'below' : 'not below?!']; }],
]) {
  const from = await p.evaluate(place);
  if (String(from.at(-1)).includes('?!')) fail(`the test did not put the player ${what}`);
  const ok = await p.waitForFunction(() => { const e = window.__ENGINE__.ctx; const mv = e.peek('player').movement; const P = mv.position; return P.y > -1 && mv.character.checkCapsule(P.x, P.y + 0.02, P.z) && !e.peek('unstuck').insideSolid(e.peek('world').layout, P.x, P.y + 0.5, P.z); }, null, { timeout: 20000, polling: 200 })
    .then(() => true).catch(() => false);
  const at = await p.evaluate(() => { const P = window.__ENGINE__.ctx.peek('player').movement.position; return [P.x.toFixed(1), P.y.toFixed(1), P.z.toFixed(1)]; });
  console.log(`${what} at ${from}: ${ok ? 'freed' : 'STILL STUCK'} -> ${at}`);
  if (!ok) fail(`player left ${what}`);
}

// ---- a grenade at the dummy hurts it (practice) --------------------------------
await click('map-grid');
await p.waitForTimeout(300);
await click('nade-dummy');
const nade = await p.waitForFunction(() => window.__ENGINE__.ctx.peek('practice').dummy.hp < 100 || !window.__ENGINE__.ctx.peek('practice').avatar.alive, null, { timeout: 60000, polling: 250 })
  .then(() => p.evaluate(() => window.__ENGINE__.ctx.peek('practice').dummy.hp)).catch(() => null);
console.log('dummy after a grenade:', nade);
if (nade == null) fail('a grenade at the dummy did no damage');

// ---- solo vs bots, offline ------------------------------------------------------
await click('solo-ffa');
await p.waitForFunction(() => { const P = window.__ENGINE__.ctx.peek('party'); return P.live === true && P.offline; }, null, { timeout: 120000, polling: 500 })
  .catch(() => fail('SOLO FFA did not start an offline match'));
const solo = await p.evaluate(() => { const P = window.__ENGINE__.ctx.peek('party'); return { bots: [...P.players.values()].filter((x) => x.bot).length, avatars: window.__ENGINE__.ctx.peek('opponent').party.size, map: window.__ENGINE__.ctx.peek('world').mapId }; });
console.log('solo', JSON.stringify(solo));
if (solo.bots !== 3 || solo.avatars !== 3) fail('solo match should have 3 bots on screen');
// my grenade at a bot's feet: the host's blast hurts it (and I get a hit marker)
const botHit = await p.evaluate(async () => {
  const e = window.__ENGINE__.ctx; const P = e.peek('party');
  const id = [...P.players.values()].find((x) => x.bot && P.alive[x.id] !== false).id;
  const b = P._bots.get(id); b.update = () => ({}); // hold it still
  let marker = false;
  e.events.on('damage:dealt', (x) => { if (x.confirmed && x.target?.remoteId === id && !x.killed) marker = true; });
  e.peek('grenades').spawn({ gid: 'devbot', owner: 'me', origin: [b.x + 0.5, b.y + 0.4, b.z], vel: [0, 0, 0] });
  const t0 = performance.now();
  while (performance.now() - t0 < 40000 && (P.hp[id] ?? 100) >= 100 && P.alive[id] !== false) await new Promise((r) => setTimeout(r, 200));
  return { id, hp: P.hp[id], alive: P.alive[id], marker };
});
console.log('bot after my grenade:', JSON.stringify(botHit));
if (botHit.hp >= 100 && botHit.alive !== false) fail("the host's own grenade did not hurt a bot");
await click('party-kill');
await p.waitForFunction(() => window.__ENGINE__.ctx.peek('party')._scores?.[0]?.[0] === 1, null, { timeout: 15000, polling: 250 }).catch(() => fail('+1 KILL did not count'));
await click('party-end');
await p.waitForSelector('[data-act="result"]', { timeout: 30000 }).catch(() => fail('END MATCH did not end it'));
await click('party-leave');
// the menu's VS BOTS: an offline room with 3 bots, no network
await p.waitForSelector('[data-act="bots"]', { timeout: 15000 });
await p.evaluate(() => document.querySelector('[data-act="bots"]').click());
await p.waitForFunction(() => { const P = window.__ENGINE__.ctx.peek('party'); return P.phase === 'lobby' && P.offline && [...P.players.values()].filter((x) => x.bot).length === 3; }, null, { timeout: 15000, polling: 250 })
  .catch(() => fail('VS BOTS did not open an offline room with 3 bots'));
console.log('vs bots room:', await p.evaluate(() => document.querySelector('[data-act="net-info"]')?.textContent));
await b.close();
console.log(failed ? 'DEV FAILED' : 'DEV OK');
process.exit(failed ? 1 : 0);
