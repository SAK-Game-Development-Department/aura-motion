// Verifies dist/ against Cloudflare Pages limits (checked 2026-10-22 at
// https://developers.cloudflare.com/pages/platform/limits/ ; see docs/decisions.md).
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MiB per asset
const MAX_FILES = 20000; // Free plan
const MAX_HEADER_RULES = 100;
const MAX_REDIRECTS = 2100;

const dir = process.argv[2] ?? 'dist';
if (!existsSync(dir)) {
  console.error(`check-pages-limits: ${dir} does not exist`);
  process.exit(1);
}

const files = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else files.push({ path: relative(dir, p), size: statSync(p).size });
  }
})(dir);

const errors = [];
for (const f of files) {
  if (f.size > MAX_FILE_BYTES) errors.push(`${f.path} is ${(f.size / 2 ** 20).toFixed(2)} MiB (> 25 MiB)`);
}
if (files.length > MAX_FILES) errors.push(`${files.length} files (> ${MAX_FILES})`);

const headersPath = join(dir, '_headers');
if (existsSync(headersPath)) {
  const rules = readFileSync(headersPath, 'utf8').split('\n').filter((l) => l.length > 0 && !/^\s/.test(l) && !l.startsWith('#'));
  if (rules.length > MAX_HEADER_RULES) errors.push(`_headers has ${rules.length} rules (> ${MAX_HEADER_RULES})`);
}
const redirectsPath = join(dir, '_redirects');
if (existsSync(redirectsPath)) {
  const n = readFileSync(redirectsPath, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).length;
  if (n > MAX_REDIRECTS) errors.push(`_redirects has ${n} rules (> ${MAX_REDIRECTS})`);
}

const total = files.reduce((a, f) => a + f.size, 0);
const largest = [...files].sort((a, b) => b.size - a.size).slice(0, 3);
console.log(`check-pages-limits: ${files.length} files, ${(total / 2 ** 20).toFixed(1)} MiB total`);
for (const f of largest) console.log(`  largest: ${f.path} ${(f.size / 2 ** 20).toFixed(2)} MiB`);
if (errors.length) {
  for (const e of errors) console.error(`  ERROR ${e}`);
  process.exit(1);
}
console.log('check-pages-limits: OK');
