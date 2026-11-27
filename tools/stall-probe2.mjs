/** Single page: trigger each duel event directly and time it (sync ms + new shader programs). */
import { chromium, devices } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const c = await b.newContext({ ...devices['iPad Pro 11 landscape'] });
const p = await c.newPage();
p.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 300)));
await p.goto('http://127.0.0.1:4173/', { waitUntil: 'commit' });
await p.waitForFunction(() => window.__READY__ === true, null, { timeout: 600000, polling: 2000 });
await p.evaluate(() => document.querySelector('[data-act=practice]')?.click());
await p.waitForTimeout(500);
await p.evaluate(() => document.querySelector('.ow-loadout .start')?.click());
await p.waitForTimeout(4000);
const run = (label, code) => p.evaluate(async ([label, code]) => {
  const e = window.__ENGINE__; const ctx = e.ctx; const r = ctx.peek('render').renderer;
  const before = new Set(r.info.programs.map((x) => x.cacheKey));
  const t0 = performance.now();
  // eslint-disable-next-line no-new-func
  new Function('ctx', 'e', code)(ctx, e);
  const sync = performance.now() - t0;
  const t1 = performance.now();
  await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
  const frames = performance.now() - t1;
  const added = r.info.programs.filter((x) => !before.has(x.cacheKey)).map((x) => x.name);
  return `${label}: sync ${sync.toFixed(1)} ms, next 2 frames ${frames.toFixed(0)} ms, new programs ${added.length} [${added.join(', ')}]`;
}, [label, code]);
const V = "const V = ctx.camera.position.constructor;";
console.log(await run('idle (2 frames)', ''));
console.log(await run('victim first hit', V + "ctx.events.emit('damage:dealt', { target: ctx.peek('player'), amount: 20, from: new V(0,1.6,-10), confirmed: true });"));
console.log(await run('victim second hit', V + "ctx.events.emit('damage:dealt', { target: ctx.peek('player'), amount: 20, from: new V(0,1.6,-10), confirmed: true });"));
console.log(await run('shooter kill feedback', "const pr = ctx.peek('practice'); ctx.events.emit('damage:dealt', { target: ctx.peek('opponent').target, amount: 30, killed: true, point: pr.avatar.position, confirmed: true });"));
console.log(await run('victim death', V + "ctx.events.emit('damage:dealt', { target: ctx.peek('player'), amount: 100, from: new V(0,1.6,-10), confirmed: true });"));
console.log(await run('round reset (respawn+refill+banner)', "const pl = ctx.peek('player'); pl.respawn(1); ctx.peek('weapons').refillAll(); ctx.peek('ui').banner.show('Round 2', '1 – 0');"));
console.log(await run('round end banner', "ctx.peek('ui').banner.show('Round won', '1 – 0');"));
await b.close();
