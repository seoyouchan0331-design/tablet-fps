/**
 * Prepare the claude.ai "Tablet FPS" artifact from a fresh build.
 *
 *   node tools/artifact-build.mjs
 *
 * 1. vite build -> dist/
 * 2. dist/models/robot.glb.b64.txt  (artifacts don't serve .glb; the game
 *    falls back to this text copy, see src/opponent/avatar.js)
 * 3. dist/artifact.html      the artifact page (boot overlay + current entry)
 *    dist/artifact-dev.html  the same with the developer panel switched on
 *                            (window.__DEV__) for the separate dev artifact
 * 4. prints the Artifact publish `files` map (root: dist): every served file
 *    except index.html, source maps and robot.glb.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

execSync('npx vite build --logLevel error', { stdio: 'inherit' });
writeFileSync('dist/models/robot.glb.b64.txt', readFileSync('dist/models/robot.glb').toString('base64'));
const entry = readFileSync('dist/index.html', 'utf8').match(/assets\/index-[^"]+\.js/)[0];
const page = readFileSync('tools/artifact/page.template.html', 'utf8').replace('__ENTRY__', entry);
writeFileSync('dist/artifact.html', page);
writeFileSync('dist/artifact-dev.html', page
  .replace('<title>Tablet FPS</title>', '<title>Tablet FPS Dev</title>')
  .replace('<script type="module"', '<script>window.__DEV__ = true;</script>\n<script type="module"'));

const files = {};
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else {
      const r = relative('dist', p);
      if (r === 'index.html' || r.startsWith('artifact') || r.endsWith('.map') || r.endsWith('.glb')) continue;
      files[r] = r;
    }
  }
};
walk('dist');
console.log(JSON.stringify({ file_path: 'dist/artifact.html', root: 'dist', entry, files }, null, 1));
