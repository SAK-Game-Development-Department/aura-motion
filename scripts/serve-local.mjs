// Zero-dependency static server for offline exhibition use.
// Usage: node serve-local.mjs [dir] [port]   (defaults: ./dist or ., 8080)
// localhost is a secure context, so getUserMedia works without HTTPS.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? (existsSync('dist') ? 'dist' : '.'));
// The shared ranking (/api) lives on the deployed site; relay it when online so
// the browser still only talks to this origin. AURA_API=off disables the relay.
const API = process.env.AURA_API ?? 'https://aura-motion.pages.dev';
const port = Number(process.argv[3] ?? 8080);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.task': 'application/octet-stream', '.tflite': 'application/octet-stream', '.txt': 'text/plain',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/api/') && API !== 'off') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      try {
        const r = await fetch(API + url.pathname + url.search, {
          method: req.method,
          headers: { 'content-type': req.headers['content-type'] ?? 'application/json' },
          body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
          signal: AbortSignal.timeout(8000),
        });
        res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' });
        res.end(Buffer.from(await r.arrayBuffer()));
      } catch {
        res.writeHead(502, { 'content-type': 'application/json' }).end('{"error":"offline"}');
      }
      return;
    }
    let p = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
    if ((await stat(p).catch(() => null))?.isDirectory()) p = join(p, 'index.html');
    // Extensionless pages like Cloudflare Pages ("/audience" → audience.html).
    else if (!extname(p) && (await stat(`${p}.html`).catch(() => null))) p = `${p}.html`;
    const body = await readFile(p);
    res.writeHead(200, {
      'content-type': types[extname(p)] ?? 'application/octet-stream',
      'cache-control': p.endsWith('sw.js') || p.endsWith('.html') ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`AURA: http://localhost:${port}  (serving ${root})`));
