/**
 * Per-pass draw-call / triangle breakdown of one frame (mobile preset, tablet emulation).
 *   node tools/pass-breakdown.mjs --port=4173
 */
import { chromium, devices } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const PORT = Number(args.port ?? 4173);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'] });
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${PORT}/${args.query ?? ''}`, { waitUntil: 'commit' });
await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 900000, polling: 2000 });
const out = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const r = e.ctx.peek('render').renderer;
  const raw = r.render.bind(r);
  const rows = {};
  let on = false;
  r.render = (scene, cam) => {
    if (!on) return raw(scene, cam);
    const tgt = r.getRenderTarget();
    const key = `${tgt?.texture?.name || tgt?.textures?.[0]?.name || (tgt ? 'rt' : 'canvas')} | ${cam.type}${cam === e.ctx.camera ? '(main)' : cam === e.ctx.viewCamera ? '(view)' : ''}`;
    const c0 = r.info.render.calls, t0 = r.info.render.triangles;
    raw(scene, cam);
    const row = (rows[key] ??= { n: 0, calls: 0, tris: 0 });
    row.n++; row.calls += r.info.render.calls - c0; row.tris += r.info.render.triangles - t0;
  };
  await new Promise((res) => requestAnimationFrame(() => { on = true; requestAnimationFrame(() => { on = false; res(); }); }));
  r.render = raw;
  let meshes = 0, inst = 0, skinned = 0;
  e.ctx.scene.traverse((o) => { if (o.isMesh) { meshes++; if (o.isInstancedMesh) inst++; if (o.isSkinnedMesh) skinned++; } });
  return { quality: e.ctx.config.quality, rows, meshes, inst, skinned, far: e.ctx.camera.far, perf: e.perf };
});
console.log(JSON.stringify({ quality: out.quality, meshes: out.meshes, instanced: out.inst, skinned: out.skinned, far: out.far, perf: out.perf }));
const sorted = Object.entries(out.rows).sort((a, b) => b[1].tris - a[1].tris);
for (const [k, v] of sorted) console.log(`${(v.tris / 1e3).toFixed(0).padStart(6)}k tris ${String(v.calls).padStart(4)} calls x${v.n}  ${k}`);
await browser.close();
