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
      const sw = tpl.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(['./', ...precache.map((f) => `./${f}`)]));
      writeFileSync(join(outDir, 'sw.js'), sw);
      // Cloudflare Pages headers (also applied by vite preview below).
      const headers = [
        '/*',
        ...Object.entries(SECURITY_HEADERS).map(([k, v]) => `  ${k}: ${v}`),
        '/sw.js',
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

export default defineConfig({
  base: './',
  build: {
    target: 'es2023',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
  },
  worker: {
    format: 'es',
  },
  server: {
    headers: SECURITY_HEADERS,
  },
  preview: {
    headers: SECURITY_HEADERS,
  },
  plugins: [serviceWorkerPlugin()],
});
