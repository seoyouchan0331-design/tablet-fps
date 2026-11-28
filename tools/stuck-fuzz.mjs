/**
 * Stuck fuzzer: the real player controller runs around a map with random
 * input (moves, sprint, dash, jump, crouch/slide, mantles happen by
 * themselves) from many starts; every 50 ms we check that the capsule is not
 * inside geometry and is still somewhere a player can stand. Reports where it
 * ever got inside a wall or out of the map.
 *
 *   node tools/stuck-fuzz.mjs [--maps=town,canal] [--seconds=60] [--port=4173]
 */
import { chromium } from 'playwright';
import { ipad, gameUrl } from './lib/env.mjs';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const PORT = Number(args.port ?? 4173);
const MAPS = (args.maps ?? 'town,canal,field,grid').split(',');
const SECONDS = Number(args.seconds ?? 60);
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext(ipad())).newPage();
await p.goto(gameUrl(`http://127.0.0.1:${PORT}/`), { waitUntil: 'commit' });
await p.waitForFunction(() => window.__READY__ === true, null, { timeout: 600000, polling: 2000 });
await p.evaluate(() => document.querySelector('[data-act=practice]').click());
await p.waitForTimeout(400);
await p.evaluate(() => document.querySelector('.ow-loadout .start')?.click());
await p.waitForTimeout(800);
let bad = 0;
for (const map of MAPS) {
  const res = await p.evaluate(async ([map, seconds]) => {
    const e = window.__ENGINE__.ctx;
    e.peek('world').load(map);
    e.peek('practice')?.setActive(false);
    await new Promise((r) => setTimeout(r, 500));
    const { buildNav, spawnPoints } = window.__NAV__ ?? {};
    const pl = e.peek('player');
    const mv = pl.movement;
    pl.setControlEnabled?.(true);
    const input = e.input;
    const held = new Set();
    const realAction = input.action.bind(input);
    input.action = (name) => held.has(name) || realAction(name);
    let mx = 0, my = 1;
    input.moveVector = (out = {}) => { out.x = mx; out.y = my; return out; };
    const L = e.peek('world').layout;
    const hx = L.size / 2 - 2, hz = (L.depth ?? L.size) / 2 - 2;
    const events = [];
    const trail = [];
    e.peek('unstuck').update = () => {}; // let it stay stuck so we can see how it got there
    let insideSince = null;
    const t0 = performance.now();
    let nextInput = 0, nextTeleport = 0;
    while (performance.now() - t0 < seconds * 1000) {
      const now = performance.now();
      if (now > nextTeleport) {
        // a fresh start every 8 s, on a spawn the game itself would use
        const sp = e.peek('world').spawn(Math.floor(Math.random() * 2));
        const x = Math.max(-hx, Math.min(hx, sp.position.x + (Math.random() - 0.5) * 30));
        const z = Math.max(-hz, Math.min(hz, sp.position.z + (Math.random() - 0.5) * 30));
        const gy = e.peek('physics').groundHeight(x, z, 12);
        if (Number.isFinite(gy) && mv.character.checkCapsule(x, gy + 0.05, z) && !e.peek('unstuck').insideSolid(L, x, gy + 0.55, z)) mv.teleport(x, gy + 0.05, z);
        nextTeleport = now + 8000;
      }
      if (now > nextInput) {
        mv.yaw += (Math.random() - 0.5) * 2.4;
        mx = Math.random() < 0.3 ? (Math.random() - 0.5) * 2 : 0;
        my = Math.random() < 0.85 ? 1 : -1;
        held.clear();
        for (const [a, pr] of [['sprint', 0.5], ['jump', 0.25], ['dash', 0.15], ['crouch', 0.2]]) if (Math.random() < pr) held.add(a);
        nextInput = now + 300 + Math.random() * 700;
      }
      await new Promise((r) => setTimeout(r, 50));
      const P = mv.position, c = mv.character;
      trail.push([+P.x.toFixed(2), +P.y.toFixed(2), +P.z.toFixed(2), mv.stance[0], mv.mantleMotion?.active ? 'M' : mv.dash?.active ? 'D' : '']);
      if (trail.length > 20) trail.shift();
      const clear = c.checkCapsule(P.x, P.y + 0.02, P.z, c.height) && !e.peek('unstuck').insideSolid(L, P.x, P.y + 0.5, P.z);
      const out = Math.abs(P.x) > L.size / 2 || Math.abs(P.z) > (L.depth ?? L.size) / 2 || P.y < -8 || P.y > 30;
      if (!clear) insideSince ??= now; else insideSince = null;
      if (out || (insideSince && now - insideSince > 600)) {
        events.push({ trail: trail.slice(-6), kind: out ? 'out' : 'inside', x: +P.x.toFixed(2), y: +P.y.toFixed(2), z: +P.z.toFixed(2), stance: mv.stance, h: +c.height.toFixed(2), mantle: !!mv.mantleMotion?.active });
        insideSince = null;
        nextTeleport = 0;
      }
    }
    input.action = realAction;
    return events;
  }, [map, SECONDS]);
  const uniq = [...new Map(res.map((e) => [`${Math.round(e.x)},${Math.round(e.y)},${Math.round(e.z)}`, e])).values()];
  console.log(`${map}: ${res.length} events`, JSON.stringify(uniq.slice(0, 20)));
  bad += res.length;
}
await b.close();
console.log(bad ? 'STUCK FOUND' : 'NO STUCK');
process.exit(bad ? 1 : 0);
