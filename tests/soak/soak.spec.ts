// Shortened soak test: the autoplay bot plays back-to-back sessions in fast
// mode (≈30 s per visitor cycle, ~3× the event density of real time) while we
// sample JS heap, DOM nodes and GPU resource counts. Writes soak-out/*.csv.
//
//   SOAK_MINUTES=30 npm run soak          (default 30)
//   SOAK_PARTICLES=20000 → include the particle compute path (slow on SwiftShader)
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const MINUTES = Number(process.env.SOAK_MINUTES ?? 30);
const PARTICLES = Number(process.env.SOAK_PARTICLES ?? 0);

test(`soak ${MINUTES} min`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const flags = PARTICLES > 0 ? `&particles=${PARTICLES}` : '&flags=-particles';
  await page.goto(`/?source=autoplay&fast=1${flags}`);
  const rows: string[] = ['elapsed_s,phase,heap_mb,dom,gpu_total_mb,geometries,textures,render_targets,storage_attrs,fps,plays,errors'];
  const t0 = Date.now();
  let plays = 0;
  let lastPhase = '';
  const samples: Array<{ heap: number; dom: number; geo: number; tex: number; gpu: number }> = [];
  while (Date.now() - t0 < MINUTES * 60_000) {
    await page.waitForTimeout(2000);
    const s = await page.evaluate(() => {
      (window as unknown as { gc?: () => void }).gc?.();
      return (window as unknown as { __aura: { inspect(): Record<string, unknown> } }).__aura.inspect();
    });
    if (s.phase === 'practice' && lastPhase !== 'practice') plays++;
    lastPhase = String(s.phase);
    const ri = (s.rendererInfo ?? {}) as Record<string, number>;
    const heap = Number(s.heap ?? 0) / 2 ** 20;
    const el = Math.round((Date.now() - t0) / 1000);
    if (el % 30 < 2) {
      rows.push([el, s.phase, heap.toFixed(2), s.dom, ((ri.total ?? 0) / 2 ** 20).toFixed(2), ri.geometries, ri.textures, ri.renderTargets, ri.storageAttributes, Number(s.fps).toFixed(1), plays, s.errors].join(','));
      samples.push({ heap, dom: Number(s.dom), geo: ri.geometries ?? 0, tex: ri.textures ?? 0, gpu: ri.total ?? 0 });
    }
  }
  mkdirSync('soak-out', { recursive: true });
  const file = `soak-out/soak-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  writeFileSync(file, rows.join('\n') + '\n');
  console.log(`soak: ${plays} plays, ${samples.length} samples → ${file}`);

  expect(errors).toEqual([]);
  expect(plays).toBeGreaterThanOrEqual(Math.max(1, Math.floor(MINUTES * 1.5)));
  // Compare the second half to the first half (after a warm-up sample).
  const warm = samples.slice(1);
  const half = Math.floor(warm.length / 2);
  if (half >= 2) {
    const avg = (xs: typeof warm, k: 'heap' | 'dom' | 'geo' | 'tex' | 'gpu') => xs.reduce((a, x) => a + x[k], 0) / xs.length;
    const a = warm.slice(0, half);
    const b = warm.slice(half);
    console.log(`heap ${avg(a, 'heap').toFixed(1)} → ${avg(b, 'heap').toFixed(1)} MiB, dom ${avg(a, 'dom')} → ${avg(b, 'dom')}`);
    expect(avg(b, 'heap')).toBeLessThan(avg(a, 'heap') * 1.15 + 2);
    expect(avg(b, 'dom')).toBeLessThanOrEqual(avg(a, 'dom') + 5);
    expect(Math.max(...b.map((x) => x.geo))).toBeLessThanOrEqual(Math.max(...a.map((x) => x.geo)) + 2);
    expect(Math.max(...b.map((x) => x.tex))).toBeLessThanOrEqual(Math.max(...a.map((x) => x.tex)) + 2);
  }
});
