/** Boots the game in iPad emulation and reports boot errors (fast pre-check before the full smoke). */
import { chromium, devices } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const c = await b.newContext({ ...devices['iPad Pro 11 landscape'] });
const p = await c.newPage();
let bad = 0;
p.on('pageerror', (e) => { bad++; console.log('PAGEERR', String(e).slice(0, 400)); });
p.on('console', (m) => { if (m.type() === 'error') { bad++; console.log('ERR', m.text().slice(0, 300)); } });
await p.goto(`http://127.0.0.1:${process.argv[2] ?? 4173}/`, { waitUntil: 'commit' });
const ok = await p.waitForFunction(() => window.__READY__ === true || document.body.innerText.includes('BOOT FAILURE'), null, { timeout: 600000, polling: 2000 }).then(() => true, () => false);
const st = await p.evaluate(() => ({ ready: !!window.__READY__, lite: !!window.__ENGINE__?.ctx.peek('render')?.lite, sky: !!window.__ENGINE__?.ctx.peek('sky') }));
console.log(ok && st.ready && !bad ? 'BOOT OK' : 'BOOT FAIL', JSON.stringify(st));
await b.close();
process.exitCode = ok && st.ready && !bad ? 0 : 1;
