/** Lists scene objects outside the arena system and which materials have maps. */
import { chromium, devices } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ ...devices['iPad Pro 11 landscape'] });
const p = await ctx.newPage();
const errs = [];
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text() + ' @ ' + JSON.stringify(m.location())); });
await p.goto('http://127.0.0.1:4173/', { waitUntil: 'commit' });
await p.waitForFunction(() => window.__READY__ === true, null, { timeout: 900000, polling: 2000 });
const out = await p.evaluate(() => {
  const e = window.__ENGINE__;
  const rows = [];
  const arena = e.ctx.peek('world').root;
  e.ctx.scene.traverse((o) => {
    if (!(o.isMesh || o.isPoints || o.isLine) || !o.visible) return;
    let a = o; let inArena = false; while (a) { if (a === arena) inArena = true; a = a.parent; }
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const wp = o.getWorldPosition(new o.position.constructor());
    rows.push({ name: o.name || '(noname)', parent: o.parent?.name || '', type: o.type, inArena, pos: [wp.x, wp.y, wp.z].map((v) => +v.toFixed(1)), mat: m?.type, map: !!m?.map, tris: o.geometry?.index ? o.geometry.index.count / 3 : (o.geometry?.attributes?.position?.count ?? 0) / 3 });
  });
  const arenaMat = e.ctx.peek('world').material;
  return { rows, arenaMat: { type: arenaMat.type, map: !!arenaMat.map, normalMap: !!arenaMat.normalMap, keys: Object.keys(arenaMat.userData || {}) } };
});
console.log(JSON.stringify(out.arenaMat));
for (const r of out.rows.filter((r) => !r.inArena)) console.log(JSON.stringify(r));
console.log('ERRORS', errs.join('\n'));
const stray = out.rows.filter((r) => r.parent === 'ow-render-probe').length;
console.log(stray || errs.length ? `PROBE FAIL stray=${stray} errors=${errs.length}` : 'PROBE OK');
if (stray || errs.length) process.exitCode = 1;
await b.close();
