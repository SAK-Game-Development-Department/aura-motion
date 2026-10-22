// Gesture lab build (developer tool) — separate from the exhibition build.
//   npm run lab         → http://localhost:5174
//   npm run build:lab   → dist-lab/   (deploy: npm run deploy:lab → aura-lab.pages.dev)
import { defineConfig, type Plugin } from 'vite';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SECURITY_HEADERS } from './src/config/headers.ts';

function headers(): Plugin {
  let outDir = '';
  return {
    name: 'lab-headers',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      writeFileSync(join(outDir, '_headers'), ['/*', ...Object.entries(SECURITY_HEADERS).map(([k, v]) => `  ${k}: ${v}`), '  X-Robots-Tag: noindex', ''].join('\n'));
    },
  };
}

export default defineConfig({
  root: 'tools/gesture-lab',
  base: './',
  publicDir: '../../public',
  build: { outDir: '../../dist-lab', emptyOutDir: true, target: 'es2023' },
  worker: { format: 'es' },
  server: { port: 5174, headers: SECURITY_HEADERS },
  preview: { port: 4174, headers: SECURITY_HEADERS },
  plugins: [headers()],
});
