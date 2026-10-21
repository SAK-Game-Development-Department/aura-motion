// Packs dist/ plus the offline server into release/aura-<date>.zip for the
// exhibition day (used when the venue network is down).
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { zipSync } from 'fflate';

if (!existsSync('dist/index.html')) {
  console.error('dist/ not found. Run `npm run build` first.');
  process.exit(1);
}
const entries = {};
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else entries[`aura/dist/${relative('dist', p).split('\\').join('/')}`] = [readFileSync(p), { level: /\.(wasm|task|tflite|png|jpg)$/.test(p) ? 0 : 6 }];
  }
})('dist');
entries['aura/serve-local.mjs'] = readFileSync('scripts/serve-local.mjs');
entries['aura/README-OFFLINE.txt'] = new TextEncoder().encode(
  [
    'AURA offline package',
    '1. Install Node.js 20+ on the exhibition PC.',
    '2. Run:  node serve-local.mjs   (in this folder)',
    '3. Open  http://localhost:8080  in Chrome/Edge (localhost counts as a secure context, so the camera works).',
    '4. Press F11 for fullscreen. See docs/operations.md for details.',
    '',
  ].join('\n'),
);
mkdirSync('release', { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const out = join('release', `aura-${stamp}.zip`);
writeFileSync(out, zipSync(entries));
console.log(`wrote ${out} (${(statSync(out).size / 2 ** 20).toFixed(1)} MiB)`);
