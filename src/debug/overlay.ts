// Developer overlay (D key; hidden by default). Shows where every millisecond
// goes, the measured latency, tracking health and the silhouette/force field.
// Never shows camera images — only the derived mask/field.
import { Ring } from '../core/math';

export interface DebugStats {
  backend: string;
  tracking: string;
  source: string;
  fps: number;
  frameMs: number;
  breakdown: Record<string, number>;
  latency: { pipeline: number; display: number; predict: number; calib: number; calibAccepted: boolean };
  particles: number;
  quality: string;
  conf: number;
  jitter: number;
  people: number;
  luma: number;
  unstable: boolean;
  dda: number;
  missRate: number;
  phase: string;
  seed: number;
  extra: Record<string, string | number>;
}

export class DebugOverlay {
  readonly el: HTMLDivElement;
  private text: HTMLPreElement;
  private graph: HTMLCanvasElement;
  private fieldCv: HTMLCanvasElement;
  private frames = new Ring<number>(240);
  private visible = false;
  private lastText = 0;
  private field: { data: Uint8Array; w: number; h: number } | null = null;
  private fieldDirty = false;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.style.cssText =
      'position:fixed;left:8px;top:8px;z-index:50;display:none;font:12px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#cfe;background:rgba(2,2,8,.82);border:1px solid rgba(63,242,255,.35);border-radius:6px;padding:8px;pointer-events:none;max-height:96vh;overflow:hidden';
    this.text = document.createElement('pre');
    this.text.style.cssText = 'margin:0 0 6px;white-space:pre';
    this.graph = document.createElement('canvas');
    this.graph.width = 360;
    this.graph.height = 70;
    this.fieldCv = document.createElement('canvas');
    this.fieldCv.width = 360;
    this.fieldCv.height = 203;
    this.fieldCv.style.cssText = 'display:block;margin-top:6px;border:1px solid rgba(255,255,255,.15)';
    this.el.append(this.text, this.graph, this.fieldCv);
    parent.appendChild(this.el);
  }

  toggle(force?: boolean): void {
    this.visible = force ?? !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
  }

  get shown(): boolean {
    return this.visible;
  }

  pushFrame(ms: number): void {
    this.frames.push(ms);
  }

  setField(data: Uint8Array, w: number, h: number): void {
    if (!this.visible) return;
    this.field = { data, w, h };
    this.fieldDirty = true;
  }

  update(now: number, s: DebugStats): void {
    if (!this.visible) return;
    this.drawGraph();
    if (this.fieldDirty) this.drawField();
    if (now - this.lastText < 150) return;
    this.lastText = now;
    const fr = this.frames.toArray().sort((a, b) => a - b);
    const p95 = fr[Math.floor(fr.length * 0.95)] ?? 0;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
    const bd = Object.entries(s.breakdown)
      .map(([k, v]) => `${k.padEnd(10)} ${v.toFixed(2).padStart(6)} ms`)
      .join('\n');
    const ex = Object.entries(s.extra)
      .map(([k, v]) => `${k}: ${typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : v}`)
      .join('\n');
    this.text.textContent = [
      `AURA debug  [D] hide  [K] calm  [F] fullscreen  [M] mouse  [R] reset`,
      `phase ${s.phase}  seed ${s.seed}`,
      `render    ${s.backend}   tracking ${s.tracking}`,
      `source    ${s.source}`,
      `fps ${s.fps.toFixed(1)}  frame ema ${s.frameMs.toFixed(2)} ms  p95 ${p95.toFixed(1)} ms`,
      `── frame breakdown (CPU) ──`,
      bd,
      `── latency ──`,
      `capture→tracked  ${s.latency.pipeline.toFixed(0)} ms`,
      `tracked→display  ${s.latency.display.toFixed(0)} ms`,
      `total (measured) ${(s.latency.pipeline + s.latency.display).toFixed(0)} ms  (+camera sensor, not measurable)`,
      `predict ahead    ${s.latency.predict.toFixed(0)} ms`,
      `judge offset     ${s.latency.calib.toFixed(0)} ms ${s.latency.calibAccepted ? '(calibrated)' : '(default)'}`,
      `── tracking ──`,
      `conf ${s.conf.toFixed(2)}  jitter ${(s.jitter * 1000).toFixed(1)}e-3  people ${s.people}  luma ${s.luma.toFixed(2)} ${s.unstable ? ' UNSTABLE→wide windows' : ''}`,
      `── render ──`,
      `particles ${s.particles.toLocaleString()}  quality ${s.quality}`,
      `── game ──`,
      `dda ${s.dda.toFixed(2)}  miss rate ${(s.missRate * 100).toFixed(0)}%`,
      mem ? `heap ${(mem.usedJSHeapSize / 2 ** 20).toFixed(1)} / ${(mem.totalJSHeapSize / 2 ** 20).toFixed(1)} MiB  dom ${document.getElementsByTagName('*').length}` : `dom ${document.getElementsByTagName('*').length}`,
      ex,
      `field: mask (gray) · contour (cyan) · motion (amber arrows)`,
    ].join('\n');
  }

  private drawGraph(): void {
    const c = this.graph.getContext('2d');
    if (!c) return;
    const W = this.graph.width;
    const H = this.graph.height;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(255,255,255,0.05)';
    c.fillRect(0, 0, W, H);
    const y = (ms: number) => H - Math.min(1, ms / 50) * H;
    c.strokeStyle = 'rgba(63,242,255,0.35)';
    c.beginPath();
    c.moveTo(0, y(16.7));
    c.lineTo(W, y(16.7));
    c.stroke();
    c.strokeStyle = 'rgba(255,63,180,0.35)';
    c.beginPath();
    c.moveTo(0, y(33.3));
    c.lineTo(W, y(33.3));
    c.stroke();
    c.strokeStyle = '#ffb43f';
    c.beginPath();
    const n = this.frames.length;
    for (let i = 0; i < n; i++) {
      const x = (i / 240) * W;
      const v = this.frames.at(i)!;
      if (i === 0) c.moveTo(x, y(v));
      else c.lineTo(x, y(v));
    }
    c.stroke();
  }

  private drawField(): void {
    this.fieldDirty = false;
    const f = this.field;
    const c = this.fieldCv.getContext('2d');
    if (!f || !c) return;
    const img = c.createImageData(f.w, f.h);
    for (let i = 0; i < f.w * f.h; i++) {
      const m = f.data[i * 4 + 3]!;
      const sdf = f.data[i * 4]!;
      const edge = Math.abs(sdf - 128) < 5;
      img.data[i * 4] = edge ? 63 : m * 0.5;
      img.data[i * 4 + 1] = edge ? 242 : m * 0.5;
      img.data[i * 4 + 2] = edge ? 255 : m * 0.6;
      img.data[i * 4 + 3] = 255;
    }
    const tmp = new OffscreenCanvas(f.w, f.h);
    tmp.getContext('2d')!.putImageData(img, 0, 0);
    c.imageSmoothingEnabled = false;
    c.drawImage(tmp, 0, 0, this.fieldCv.width, this.fieldCv.height);
    // Motion field arrows.
    c.strokeStyle = '#ffb43f';
    c.lineWidth = 1;
    const sx = this.fieldCv.width / f.w;
    const sy = this.fieldCv.height / f.h;
    for (let y = 2; y < f.h; y += 6) {
      for (let x = 2; x < f.w; x += 6) {
        const i = (y * f.w + x) * 4;
        const vx = (f.data[i + 1]! - 128) / 128;
        const vy = (f.data[i + 2]! - 128) / 128;
        if (Math.abs(vx) + Math.abs(vy) < 0.04) continue;
        c.beginPath();
        c.moveTo(x * sx, y * sy);
        c.lineTo(x * sx + vx * 40, y * sy + vy * 40);
        c.stroke();
      }
    }
  }
}
