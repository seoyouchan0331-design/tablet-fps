/**
 * Reproduces the iPad/iOS "black world, HUD fine" bug on desktop Chromium by
 * hiding OES_texture_float_linear (iOS Safari does not expose it), then reports
 * the mean brightness of the 3D view.
 *   node tools/ios-repro.mjs --port=4173 [--allow=1]
 */
import { chromium, devices } from 'playwright';
import { PNG } from 'pngjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const PORT = Number(args.port ?? 4173);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'] });
if (args.allow !== '1') {
  await ctx.addInitScript(() => {
    const HIDE = 'OES_texture_float_linear';
    const P = WebGL2RenderingContext.prototype;
    const ge = P.getExtension;
    const gs = P.getSupportedExtensions;
    P.getExtension = function (n) { return n === HIDE ? null : ge.call(this, n); };
    P.getSupportedExtensions = function () { return (gs.call(this) || []).filter((n) => n !== HIDE); };
  });
}
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', String(e)));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'commit' });
await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 600000, polling: 2000 });
await page.waitForTimeout(3000);
const buf = await page.screenshot({ path: args.out ?? 'shots/ios-repro.png', timeout: 240000 });
const png = PNG.sync.read(buf);
// sample the middle band (sky + street), away from HUD corners
let sum = 0, n = 0;
for (let y = Math.floor(png.height * 0.3); y < png.height * 0.6; y += 4)
  for (let x = Math.floor(png.width * 0.3); x < png.width * 0.6; x += 4) {
    const i = (y * png.width + x) * 4;
    sum += (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3;
    n++;
  }
const mean = sum / n;
console.log(`hidden=${args.allow !== '1'} meanBrightness=${mean.toFixed(1)} → ${mean < 8 ? 'BLACK' : 'VISIBLE'}`);
await browser.close();
