// Tech Lens: holographic read-outs that show what the system is computing —
// per hand (landmarks, finger bend angles, shape confidence, state machine)
// and for the whole pipeline (renderer, particles, tracking rate, latency).
// DOM only; elements are created once and text is refreshed ~8×/s.
import type { GestureFrame } from '../gesture/engine';

export interface LensStats {
  fps: number;
  latencyMs: number;
  particles: number;
  backend: string;
  tracking: string;
  trackFps: number;
}

const FINGER = ['人', '中', '薬', '小'];

export class TechLens {
  readonly root: HTMLElement;
  private hands: HTMLElement[] = [];
  private sys: HTMLElement;
  private on = false;
  private lastText = -1e9;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'lens';
    for (let i = 0; i < 2; i++) {
      const e = document.createElement('div');
      e.className = 'lens-hand';
      this.root.appendChild(e);
      this.hands.push(e);
    }
    this.sys = document.createElement('div');
    this.sys.className = 'lens-sys';
    this.root.appendChild(this.sys);
    parent.appendChild(this.root);
  }

  get visible(): boolean {
    return this.on;
  }

  setVisible(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.root.classList.toggle('on', on);
  }

  /** toScreen maps view coords (0..1) to CSS pixels. */
  update(now: number, g: GestureFrame | null, s: LensStats, toScreen: (p: { x: number; y: number }) => { x: number; y: number }): void {
    if (!this.on) return;
    const refresh = now - this.lastText > 120;
    if (refresh) this.lastText = now;
    for (let i = 0; i < 2; i++) {
      const el = this.hands[i]!;
      const h = g?.hands[i];
      if (!h) {
        el.style.opacity = '0';
        continue;
      }
      const p = toScreen({ x: h.palm.x + h.size * 0.9, y: h.palm.y - h.size * 0.4 });
      el.style.opacity = '1';
      el.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px)`;
      if (refresh) {
        const d = h.decision;
        const bends = h.feat.bend.map((b, k) => `${FINGER[k]}${b.toFixed(0).padStart(4)}°`).join(' ');
        el.textContent =
          `HAND#${h.slot} · 21pt · ${(h.score * 100).toFixed(0)}%\n` +
          `${bends}\n` +
          `fan ${h.feat.fan.toFixed(0)}° pinch ${h.feat.pinch.toFixed(2)}\n` +
          (d.shape ? `▶ ${d.shape.toUpperCase()} ${d.conf.toFixed(2)}` : d.best && d.bestConf >= 0.3 ? `… ${d.best.toUpperCase()}? ${d.bestConf.toFixed(2)}` : '… scanning') +
          `  [${h.state}]` +
          (h.charge > 0 ? ` ${'▮'.repeat(Math.round(h.charge * 8)).padEnd(8, '▯')}` : '');
      }
    }
    if (refresh) {
      this.sys.textContent =
        `RENDER  ${s.backend.toUpperCase()} · TSL · ${s.fps.toFixed(0)} fps\n` +
        `PARTICLES ${s.particles.toLocaleString('en-US')} (GPU compute)\n` +
        `TRACKING ${s.tracking} · ${s.trackFps.toFixed(0)} Hz · 21×${g?.hands.length ?? 0} landmarks\n` +
        `LATENCY ≈ ${s.latencyMs.toFixed(0)} ms · on-device only`;
    }
  }
}
