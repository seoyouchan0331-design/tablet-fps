/**
 * Test runner: unit tests, then only the browser tests the change touches,
 * two at a time (this machine has 4 CPU cores and no GPU).
 *
 *   node tools/test.mjs              tests for files changed vs origin/main
 *   node tools/test.mjs --all        every browser test (before a release)
 *   node tools/test.mjs duel weapons just these
 *
 * Builds dist/ and serves it on :4173 if nothing is listening there.
 */
import { execSync, spawn } from 'node:child_process';

const SUITES = {
  smoke: 'tools/touch-smoke.mjs',
  controls: 'tools/controls-e2e.mjs',
  duel: 'tools/duel-e2e.mjs',
  stall: 'tools/stall-probe.mjs',
  weapons: 'tools/weapons-e2e.mjs',
  hitreg: 'tools/hitreg-e2e.mjs',
};

/** Which suites a changed path needs. */
const RULES = [
  [/^src\/(match|net|opponent)\//, ['duel', 'stall']],
  [/^src\/(weapons|audio)\/|^src\/ui\/(scope|loadout|lobby)\.js|^public\/sfx\//, ['weapons']],
  [/^src\/(weapons|physics|opponent|practice)\//, ['hitreg']],
  [/^src\/(ui|core\/(input|settings))/, ['controls', 'smoke']],
  [/^src\/(render|player|physics|world|fx)\//, ['smoke', 'stall']],
  [/^src\/main\.js|^index\.html|^vite\.config/, ['smoke']],
];

const args = process.argv.slice(2);
let pick;
if (args.includes('--all')) pick = Object.keys(SUITES);
else if (args.length) pick = args.filter((a) => SUITES[a]);
else {
  let changed = [];
  try {
    changed = execSync('git diff --name-only origin/main...HEAD; git diff --name-only HEAD; git ls-files -o --exclude-standard', { encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } catch { /* no remote: fall back to smoke */ }
  const set = new Set();
  for (const f of changed) for (const [re, s] of RULES) if (re.test(f)) s.forEach((x) => set.add(x));
  pick = [...set];
  console.log(`changed: ${changed.length} files -> ${pick.join(', ') || '(no browser tests)'}`);
}

const sh = (cmd) => execSync(cmd, { stdio: 'inherit' });
sh('node --test tests/*.test.mjs 2>&1 | grep -E "^# (pass|fail)|^not ok" ');
if (!pick.length) process.exit(0);

sh('npx vite build --logLevel error');
let server = null;
const up = async () => { try { return (await fetch('http://127.0.0.1:4173/')).ok; } catch { return false; } };
if (!(await up())) {
  server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore', detached: true });
  for (let i = 0; i < 40 && !(await up()); i++) await new Promise((r) => setTimeout(r, 250));
}

const run = (name) => new Promise((done) => {
  const t0 = Date.now();
  const p = spawn('node', [SUITES[name]], { env: { ...process.env, CHROME_PATH: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium' } });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (out += d));
  p.on('close', (code) => {
    const fails = out.split('\n').filter((l) => /FAIL/.test(l));
    console.log(`${code === 0 ? 'PASS' : 'FAIL'} ${name} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    for (const l of fails) console.log('   ' + l);
    if (code !== 0 && !fails.length) console.log(out.split('\n').slice(-15).join('\n'));
    done(code === 0);
  });
});

const queue = [...pick];
const results = [];
await Promise.all([0, 1].map(async () => {
  while (queue.length) results.push(await run(queue.shift()));
}));
if (server) process.kill(-server.pid);
const ok = results.every(Boolean);
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
