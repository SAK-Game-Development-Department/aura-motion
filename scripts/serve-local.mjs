// Zero-dependency static server for offline exhibition use.
// Usage: node serve-local.mjs [dir] [port]   (defaults: ./dist or ., 8080)
// localhost is a secure context, so getUserMedia works without HTTPS.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? (existsSync('dist') ? 'dist' : '.'));
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
    let p = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
    if ((await stat(p).catch(() => null))?.isDirectory()) p = join(p, 'index.html');
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
