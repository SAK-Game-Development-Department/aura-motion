import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SECURITY_HEADERS } from './src/config/headers.ts';

/**
 * Emits dist/sw.js with a precache manifest of every built asset (including the
 * same-origin MediaPipe WASM/models) and a content hash as the cache version.
 */
function serviceWorkerPlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'aura-sw',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const files: string[] = [];
      (function walk(d: string) {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, e.name);
          if (e.isDirectory()) walk(p);
          else files.push(relative(outDir, p).split('\\').join('/'));
        }
      })(outDir);
      const precache = files.filter((f) => !/^(sw\.js|_headers|_redirects)$/.test(f) && !f.endsWith('.map') && !f.startsWith('fixtures/'));
      const h = createHash('sha256');
      for (const f of precache.sort()) {
        h.update(f);
        h.update(String(statSync(join(outDir, f)).size));
        if (!/\.(wasm|task|tflite)$/.test(f)) h.update(readFileSync(join(outDir, f)));
      }
      const version = h.digest('hex').slice(0, 12);
      const tpl = readFileSync('src/sw/sw.template.js', 'utf8');
      // Cloudflare Pages serves "x.html" at "/x" (308 redirect), so precache the
      // extensionless URL; index.html is covered by "./".
      const urls = precache.filter((f) => f !== 'index.html').map((f) => (f.endsWith('.html') ? `./${f.slice(0, -5)}` : `./${f}`));
      const sw = tpl.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(['./', ...urls]));
      writeFileSync(join(outDir, 'sw.js'), sw);
      // Cloudflare Pages headers (also applied by vite preview below).
      const headers = [
        '/*',
        ...Object.entries(SECURITY_HEADERS).map(([k, v]) => `  ${k}: ${v}`),
        '/sw.js',
        '  Cache-Control: no-cache',
        '/card.html',
        '  Cache-Control: no-cache',
        '/index.html',
        '  Cache-Control: no-cache',
        '/assets/*',
        '  Cache-Control: public, max-age=31536000, immutable',
        '/mediapipe/*',
        '  Cache-Control: public, max-age=604800',
        '',
      ].join('\n');
      writeFileSync(join(outDir, '_headers'), headers);
    },
  };
}

/**
 * The shared ranking lives in Pages Functions (/api). Running locally there are
 * no functions, so the dev server relays /api to the deployed site (the browser
 * still only talks to its own origin). Set AURA_API to point elsewhere, or
 * AURA_API=off to disable. `vite preview` (E2E) relays only with AURA_API set.
 */
const API_ORIGIN = process.env.AURA_API ?? 'https://aura-motion.pages.dev';
const apiProxy = API_ORIGIN === 'off' ? undefined : { '/api': { target: API_ORIGIN, changeOrigin: true, secure: true } };

export default defineConfig({
  base: './',
  build: {
    target: 'es2023',
    rollupOptions: {
      input: { main: 'index.html', card: 'card.html', audience: 'audience.html' },
    },
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
  },
  worker: {
    format: 'es',
  },
  server: {
    headers: SECURITY_HEADERS,
    proxy: apiProxy,
  },
  preview: {
    headers: SECURITY_HEADERS,
    proxy: process.env.AURA_API && apiProxy ? apiProxy : undefined,
  },
  plugins: [serviceWorkerPlugin()],
});
