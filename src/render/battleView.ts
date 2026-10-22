// BattleView: draws the battle — shadow spirits, their weak-point marks and
// timing rings, technique effects (each technique has its own look), and the
// cinematic moments (seal cut-ins, the ultimate "天輪結界").
import { SAFETY } from '../config';
import { clamp, ease, lerp } from '../core/math';
import { HAND_BONES, type Vec2 } from '../core/types';
import type { BattleEvent, BattleSession, ActiveEnemy } from '../battle/session';
import type { Enemy } from '../battle/stage';
import { type Hue, type Req, type Technique } from '../battle/techniques';
import type { GestureFrame } from '../gesture/engine';
import { buildHand, defaultHand, sealHands, withShape } from '../gesture/handModel';
import { sigilPath } from '../gesture/sigil';
import { EnemyBatch } from './enemies';
import type { Gfx } from './gfx';
import { Shape, type GlyphBatch } from './glyphs';
import { C, type WorldView } from './world';

type RGB = readonly [number, number, number];
const HUE: Record<Hue, RGB> = { cyan: C.cyan, magenta: C.magenta, amber: C.amber };

const BASE_SIZE: Record<Enemy['kind'], number> = { wisp: 0.075, warden: 0.095, striker: 0.085, breaker: 0.12, lord: 0.22, eclipse: 0.26 };

interface Fx {
  kind: Technique['effect'] | 'fizzle' | 'blocked' | 'ultimate' | 'hurt';
  t0: number;
  dur: number;
  from: Vec2;
  to: Vec2;
  rgb: RGB;
  seed: number;
  big: number;
}

export interface UiRequest {
  cutin?: { title: string; reading: string; hue: Hue; big: boolean };
  hurt?: boolean;
  marks: Array<{ id: string; at: Vec2; text: string; strong: boolean }>;
}

export class BattleView {
  readonly enemies = new EnemyBatch(48);
  private fx: Fx[] = [];
  private domainUntil = 0;
  private domainT0 = 0;
  private dimUntil = 0;
  private sealIcons = new Map<string, Array<Array<{ x: number; y: number }>>>();
  /** Visual time scale (slow motion during cinematics). */
  timeScale = 1;

  constructor(
    private gfx: Gfx,
    private world: WorldView,
  ) {
    gfx.scene.add(this.enemies.mesh);
  }

  reset(): void {
    this.fx = [];
    this.domainUntil = 0;
    this.dimUntil = 0;
    this.enemies.begin();
    this.enemies.end();
  }

  /** Where an enemy is drawn (view) and how big (view-height units). */
  enemyPos(a: ActiveEnemy, gt: number): { at: Vec2; size: number; alpha: number; dissolve: number } {
    const e = a.e;
    const p = clamp((gt - e.spawn) / Math.max(1, e.arrive - e.spawn), 0, 1);
    const k = ease.outCubic(p);
    const bob = Math.sin(gt / 420 + e.id) * 0.008 * k;
    const x = lerp(0.5 + (e.x - 0.5) * 0.3, e.x, k) + Math.sin(gt / 900 + e.id * 1.7) * 0.01 * k;
    let y = lerp(0.14, e.y, k) + bob;
    let size = BASE_SIZE[e.kind] * lerp(0.28, 1, k);
    let alpha = clamp(p * 3, 0, 1);
    let dissolve = 0;
    if (a.state === 'dead') dissolve = clamp((gt - a.endT) / 650, 0, 1);
    if (a.state === 'gone') {
      const u = clamp((gt - a.endT) / 700, 0, 1);
      y -= u * 0.15;
      alpha *= 1 - u;
    }
    // Strikers wind up before their attack, then lunge.
    const st = e.steps[a.step];
    if (a.state === 'alive' && st && st.tech === 'heki' && st.t !== null) {
      const u = (gt - (st.t - 600)) / 600;
      if (u > 0 && u < 1.2) size *= 1 + 0.35 * ease.inCubic(clamp(u, 0, 1));
    }
    return { at: { x, y }, size, alpha, dissolve };
  }

  onEvents(events: BattleEvent[], now: number, gt: number, s: BattleSession, g: GestureFrame | null): UiRequest {
    const ui: UiRequest = { marks: [] };
    const handAt = (slot: number): Vec2 => {
      const h = g?.hands.find((x) => x.slot === slot) ?? g?.hands[0];
      return h ? h.palm : { x: 0.5, y: 0.85 };
    };
    for (const e of events) {
      if (e.type === 'cast') {
        if (!e.matched && e.tech) this.fx.push({ kind: 'fizzle', t0: now, dur: 450, from: handAt(e.hand), to: handAt(e.hand), rgb: HUE[e.tech.hue], seed: e.t, big: 0.3 });
        if (e.tech && e.matched && e.tech.req.kind === 'seal') {
          ui.cutin = { title: e.tech.name, reading: e.tech.reading, hue: e.tech.hue, big: false };
          this.dimUntil = now + 900;
          this.world.holdTime(now, 260);
        }
      } else if (e.type === 'hit') {
        const a = s.enemies.find((x) => x.e.id === e.enemy);
        const to = a ? this.enemyPos(a, gt).at : { x: 0.5, y: 0.35 };
        const from = e.tech.req.kind === 'seal' || e.tech.req.kind === 'spread' ? { x: 0.5, y: 0.66 } : handAt(e.hand);
        const big = e.kill ? (e.boss ? 1 : 0.7) : 0.45;
        this.fx.push({ kind: e.tech.effect, t0: now, dur: effectDur(e.tech.effect), from, to, rgb: HUE[e.tech.hue], seed: e.t + e.enemy, big });
        // Impact lands after the projectile travel time.
        const travel = travelMs(e.tech.effect);
        this.pendingImpacts.push({ at: now + travel, to, rgb: e.grade === 'perfect' ? C.amber : HUE[e.tech.hue], strength: e.grade === 'perfect' ? big + 0.2 : big });
      } else if (e.type === 'blocked') {
        const a = s.enemies.find((x) => x.e.id === e.enemy);
        this.fx.push({ kind: 'blocked', t0: now, dur: 600, from: { x: 0.5, y: 0.62 }, to: a ? this.enemyPos(a, gt).at : { x: 0.5, y: 0.4 }, rgb: C.cyan, seed: e.t, big: 0.6 });
      } else if (e.type === 'hurt') {
        ui.hurt = true;
        this.world.shake.kick(0.5);
      } else if (e.type === 'ultimate') {
        ui.cutin = { title: '天輪結界', reading: 'てんりんけっかい', hue: 'amber', big: true };
        this.domainT0 = now;
        this.domainUntil = now + 3200;
        this.dimUntil = now + 3200;
        this.world.holdTime(now, 700);
        this.fx.push({ kind: 'ultimate', t0: now, dur: 3000, from: { x: 0.5, y: 0.5 }, to: { x: 0.5, y: 0.3 }, rgb: C.amber, seed: e.t, big: 1 });
        this.world.flash.request(now, 0.8);
      }
    }
    return ui;
  }

  private pendingImpacts: Array<{ at: number; to: Vec2; rgb: RGB; strength: number }> = [];

  /** Draw the battle into the glyph batch (called between glyph begin/end). */
  draw(g: GlyphBatch, now: number, gt: number, s: BattleSession, ui: UiRequest, showMarks: boolean): void {
    const L = this.gfx.layout;
    // Impacts whose projectile has arrived.
    this.pendingImpacts = this.pendingImpacts.filter((p) => {
      if (now < p.at) return true;
      this.world.burst(p.to, p.rgb, Math.min(1, p.strength), now, p.at);
      return false;
    });
    // Cinematic background.
    const dom = now < this.domainUntil ? ease.inOutSine(clamp(Math.min((now - this.domainT0) / 500, (this.domainUntil - now) / 700), 0, 1)) : 0;
    this.world.bg.uDomain.value = dom;
    const dimTarget = now < this.dimUntil ? 0.7 : 0;
    this.world.bg.uDim.value += (dimTarget - this.world.bg.uDim.value) * 0.15;
    this.enemies.uTime.value = now / 1000;

    this.enemies.begin();
    for (const a of s.enemies) {
      const p = this.enemyPos(a, gt);
      if (p.alpha <= 0.01) continue;
      const w = L.viewToWorld(p.at);
      const size = L.len(p.size) * 2.6;
      const hurt = clamp(1 - (gt - a.lastMissT) / 300, 0, 1);
      const rim = a.e.kind === 'breaker' ? C.amber : a.e.kind === 'warden' ? C.cyan : C.magenta;
      this.enemies.add(w.x, w.y, size, rim, p.alpha * (dom > 0.5 && a.state === 'alive' ? 1 - (dom - 0.5) * 1.6 : 1), a.e.id * 1.37, hurt, p.dissolve);
      if (a.state !== 'alive' || p.dissolve > 0) continue;
      // Eyes.
      const eyeR = L.len(p.size) * 0.16;
      const blink = Math.sin(gt / 1700 + a.e.id * 3) > 0.97 ? 0.15 : 1;
      const ex = L.len(p.size) * 0.32;
      const eyes = a.e.kind === 'lord' ? [-1.2, -0.4, 0.4, 1.2] : [-1, 1];
      for (const k of eyes) g.add(Shape.Disk, w.x + ex * k * 0.8, w.y + L.len(p.size) * 0.12, eyeR, eyeR * blink, 0, a.e.kind === 'lord' ? C.amber : C.white, 1.3);
      if (a.e.kind === 'warden' && a.step === 0) {
        const rr = L.len(p.size) * 2.9;
        g.add(Shape.Ring, w.x, w.y, rr, rr, gt / 900, C.cyan, 0.9, 0.93, 40);
      }
      if (a.e.kind === 'lord') {
        for (let i = 0; i < 3; i++) {
          const rr = L.len(p.size) * (3.2 + i * 0.5);
          g.add(Shape.Ring, w.x, w.y, rr, rr * 0.35, (gt / 1600) * (i % 2 ? -1 : 1) + i, C.magenta, 0.6, 0.96, 50);
        }
      }
      if (!showMarks) continue;
      const step = a.e.steps[a.step];
      if (!step) continue;
      const req = s.req(step.tech);
      // Timing ring: closes onto the spirit at the step time.
      if (step.t !== null) {
        const u = clamp(1 - (step.t - gt) / 1500, 0, 1.15);
        const rr = L.len(p.size) * (5.2 - 2.4 * ease.inOutSine(Math.min(1, u)));
        const hot = Math.abs(step.t - gt) < 180;
        g.add(Shape.Ring, w.x, w.y, rr, rr, 0, hot ? C.amber : C.white, (hot ? 1.4 : 0.5) * clamp(u * 2, 0, 1), 0.95, 50);
      } else {
        const pulse = 0.6 + 0.4 * Math.sin(now / 200);
        const rr = L.len(p.size) * 3.4;
        g.add(Shape.Ring, w.x, w.y, rr, rr, 0, C.amber, pulse, 0.95, 40);
      }
      // Weak-point mark above the spirit.
      // Mark above the spirit; big spirits (or ones near the top) get it at their side.
      const msz = Math.max(0.05, Math.min(0.075, p.size * 0.55));
      let markAt = { x: p.at.x, y: p.at.y - p.size * 1.55 };
      if (markAt.y - msz * 2.2 < 0.06) markAt = { x: p.at.x + (p.at.x > 0.62 ? -1 : 1) * (p.size * 1.35 + msz * 1.8) / L.ca, y: Math.max(0.16, p.at.y) };
      this.drawReq(g, req, markAt, msz, now);
      const strong = a.e.tutorial || a.e.kind === 'lord' || req.kind === 'seal';
      if (strong || a.e.kind === 'breaker') ui.marks.push({ id: `e${a.e.id}`, at: { x: markAt.x, y: markAt.y + msz * 2.05 }, text: reqText(req, step.tech), strong });
    }
    this.enemies.end();
    this.drawFx(g, now);
  }

  /** Requirement icon: shape skeleton, motion cue, sigil trace or seal (two hands). */
  drawReq(g: GlyphBatch, r: Req, at: Vec2, size: number, now: number): void {
    const L = this.gfx.layout;
    const c = L.viewToWorld(at);
    const box = size * 2.2 * L.k;
    g.add(Shape.Disk, c.x, c.y, box * 1.1, box * 1.1, 0, [0.02, 0.02, 0.06], 0.0);
    switch (r.kind) {
      case 'shape':
        this.world.drawIcon(r.shape, at, size, colorOf(r), 1.2);
        break;
      case 'motion': {
        this.world.drawIcon(r.shape, at, size, colorOf(r), 1.1);
        const u = (now % 900) / 900;
        if (r.motion === 'swipe') {
          const a = { x: c.x - box * 0.7, y: c.y - box * 0.75 };
          const b = { x: c.x + box * 0.7, y: c.y - box * 0.75 };
          g.line(a.x, a.y, a.x + (b.x - a.x) * ease.outCubic(u), b.y, 0.004 * L.k, C.white, 1.2 * (1 - u * 0.5));
          g.line(b.x, b.y, b.x - box * 0.18, b.y + box * 0.14, 0.004 * L.k, C.white, 1.2);
          g.line(b.x, b.y, b.x - box * 0.18, b.y - box * 0.14, 0.004 * L.k, C.white, 1.2);
        } else if (r.motion === 'push' || r.motion === 'pull') {
          const k = r.motion === 'push' ? u : 1 - u;
          const rr = box * (0.5 + 1.0 * k);
          g.add(Shape.Ring, c.x, c.y, rr * 2, rr * 2, 0, C.white, 0.9 * (1 - Math.abs(k - 0.5)), 0.95, 50);
        } else {
          for (let i = 0; i < 3; i++) {
            const kk = (u + i / 3) % 1;
            g.add(Shape.Disk, c.x + box * (0.4 + kk * 0.6), c.y + box * (0.5 - kk * 1.2), box * 0.12, box * 0.12, 0, C.white, 1 - kk);
          }
        }
        break;
      }
      case 'sigil': {
        const path = sigilPath(r.sigil, 1, 0, 60);
        const n = Math.floor(((now % 1600) / 1600) * path.length);
        for (let i = 1; i < path.length; i++) {
          const a = path[i - 1]!;
          const b = path[i]!;
          const lit = i <= n;
          g.line(c.x + a.x * box * 0.75, c.y - a.y * box * 0.75, c.x + b.x * box * 0.75, c.y - b.y * box * 0.75, 0.004 * L.k, C.amber, lit ? 1.4 : 0.35);
        }
        break;
      }
      case 'seal': {
        let icon = this.sealIcons.get(r.seal);
        if (!icon) {
          icon = sealHands(r.seal, { x: 0, y: 0 }, 1).map((h) => buildHand(h));
          this.sealIcons.set(r.seal, icon);
        }
        for (const lm of icon) {
          const pts = lm.map((q) => L.viewToWorld({ x: at.x + q.x * size * 0.75, y: at.y + (q.y - 0.2) * size * 0.75 }));
          for (const [a, b] of HAND_BONES) g.line(pts[a]!.x, pts[a]!.y, pts[b]!.x, pts[b]!.y, 0.0035 * L.k, C.amber, 1.2);
        }
        g.add(Shape.Ring, c.x, c.y, box * 1.9, box * 1.9, now / 1200, C.amber, 0.7, 0.93, 40);
        break;
      }
      case 'spread': {
        const u = (now % 1400) / 1400;
        const gap = u < 0.5 ? 0.15 : 0.15 + (u - 0.5) * 1.6;
        for (const s of [-1, 1] as const) this.world.drawIcon('open', { x: at.x + s * gap * size * 1.5, y: at.y }, size * 0.7, C.amber, 1.1);
        break;
      }
    }
  }

  private drawFx(g: GlyphBatch, now: number): void {
    const L = this.gfx.layout;
    this.fx = this.fx.filter((f) => now - f.t0 < f.dur);
    for (const f of this.fx) {
      const k = (now - f.t0) / f.dur;
      const A = L.viewToWorld(f.from);
      const B = L.viewToWorld(f.to);
      const travel = clamp((now - f.t0) / travelMs(f.kind as Technique['effect']), 0, 1);
      const head = { x: lerp(A.x, B.x, ease.outCubic(travel)), y: lerp(A.y, B.y, ease.outCubic(travel)) };
      const fade = 1 - k;
      const W = 0.006 * L.k;
      const rnd = (i: number) => Math.abs(Math.sin(f.seed * 12.9898 + i * 78.233) * 43758.5453) % 1;
      switch (f.kind) {
        case 'beam':
        case 'twinbeam': {
          const offs = f.kind === 'twinbeam' ? [-0.012, 0.012] : [0];
          for (const o of offs) {
            const nx = -(B.y - A.y);
            const ny = B.x - A.x;
            const nl = Math.hypot(nx, ny) || 1;
            const ox = (nx / nl) * o * L.k;
            const oy = (ny / nl) * o * L.k;
            const flick = 0.7 + 0.3 * Math.sin(now / 18);
            g.line(A.x + ox, A.y + oy, head.x + ox, head.y + oy, W * 3 * fade, f.rgb, 1.4 * flick * fade);
            g.line(A.x + ox, A.y + oy, head.x + ox, head.y + oy, W * 1.1 * fade, C.white, 1.6 * fade);
          }
          break;
        }
        case 'burst':
        case 'flare': {
          if (travel < 1) g.add(Shape.Disk, head.x, head.y, 0.05 * L.k, 0.05 * L.k, 0, f.rgb, 1.6);
          else {
            const kk = clamp((k - 0.25) / 0.75, 0, 1);
            for (let i = 0; i < 10; i++) {
              const a = (i / 10) * Math.PI * 2 + rnd(i);
              const r0 = 0.03 * L.k;
              const r1 = (0.07 + 0.12 * ease.outExpo(kk)) * L.k * (1 + f.big);
              g.line(B.x + Math.cos(a) * r0, B.y + Math.sin(a) * r0, B.x + Math.cos(a) * r1, B.y + Math.sin(a) * r1, W * (1 - kk), f.rgb, 1.6 * (1 - kk));
            }
            if (f.kind === 'flare') g.add(Shape.Disk, B.x, B.y, 0.4 * L.k * ease.outCubic(kk), 0.4 * L.k * ease.outCubic(kk), 0, f.rgb, 0.8 * (1 - kk));
          }
          break;
        }
        case 'wave': {
          for (let i = 0; i < 3; i++) {
            const kk = clamp(k * 1.3 - i * 0.15, 0, 1);
            const d = Math.hypot(B.x - A.x, B.y - A.y) * 2.2;
            const rr = d * ease.outCubic(kk);
            g.add(Shape.Ring, A.x, A.y, rr, rr, 0, f.rgb, 1.3 * (1 - kk), 0.97, 60);
          }
          break;
        }
        case 'bind': {
          for (let i = 0; i < 6; i++) {
            const a0 = (i / 6) * Math.PI * 2 + now / 300;
            const r = 0.08 * L.k * (1.2 - 0.4 * k);
            const px = B.x + Math.cos(a0) * r;
            const py = B.y + Math.sin(a0) * r * 0.6;
            g.line(A.x + (px - A.x) * travel * 0.1, A.y + (py - A.y) * travel * 0.1, lerp(A.x, px, travel), lerp(A.y, py, travel), W * 0.7, f.rgb, 1.2 * fade);
            const q = (i + 1) / 6;
            const a1 = q * Math.PI * 2 + now / 300;
            g.line(px, py, B.x + Math.cos(a1) * r, B.y + Math.sin(a1) * r * 0.6, W * 0.7, f.rgb, 1.3 * fade * travel);
          }
          break;
        }
        case 'lightning': {
          // Strikes from above, jagged, re-rolls every 50 ms.
          const top = { x: B.x + (rnd(1) - 0.5) * 0.2, y: 0.55 };
          let prev = top;
          const seg = 9;
          const roll = Math.floor(now / 50);
          for (let i = 1; i <= seg; i++) {
            const u = i / seg;
            const j = i === seg ? 0 : (Math.abs(Math.sin(roll * 3.1 + i * 7.7 + f.seed)) - 0.5) * 0.09;
            const p = { x: lerp(top.x, B.x, u) + j, y: lerp(top.y, B.y, u) };
            g.line(prev.x, prev.y, p.x, p.y, W * 1.3 * fade, f.rgb, 1.8 * fade);
            g.line(prev.x, prev.y, p.x, p.y, W * 0.5 * fade, C.white, 1.6 * fade);
            prev = p;
          }
          break;
        }
        case 'hook': {
          const n = 16;
          let pv = A;
          for (let i = 1; i <= n; i++) {
            const u = (i / n) * travel;
            const bend = Math.sin(u * Math.PI) * 0.15 * L.k;
            const p = { x: lerp(A.x, B.x, u) + bend, y: lerp(A.y, B.y, u) };
            g.line(pv.x, pv.y, p.x, p.y, W, f.rgb, 1.4 * fade);
            pv = p;
          }
          break;
        }
        case 'shock': {
          for (let i = 0; i < 7; i++) {
            const kk = clamp(k * 1.4 - i * 0.07, 0, 1);
            const p = { x: lerp(A.x, B.x, kk), y: lerp(A.y, B.y, kk) };
            const rr = (0.03 + 0.12 * kk) * L.k;
            g.add(Shape.Ring, p.x, p.y, rr * 2, rr * 2, 0, f.rgb, 1.2 * (1 - kk), 0.92, 40);
          }
          break;
        }
        case 'slash':
        case 'cross': {
          const arcs = f.kind === 'cross' ? [Math.PI / 4, -Math.PI / 4] : [Math.PI * 0.1];
          for (const rot of arcs) {
            const len = 0.5 * L.k * (1 + f.big);
            const n = 14;
            const sweep = ease.outExpo(clamp(k * 2, 0, 1));
            let pv: Vec2 | null = null;
            for (let i = 0; i <= n; i++) {
              const u = (i / n) * sweep;
              const s2 = u - 0.5;
              const lx = s2 * len;
              const ly = -Math.abs(s2) * s2 * 0.3 * len + 0.02 * L.k;
              const p = { x: B.x + lx * Math.cos(rot) - ly * Math.sin(rot), y: B.y + lx * Math.sin(rot) + ly * Math.cos(rot) };
              if (pv) g.line(pv.x, pv.y, p.x, p.y, W * 1.6 * (1 - k) * (0.5 + Math.sin((i / n) * Math.PI)), f.kind === 'cross' ? f.rgb : C.white, 1.7 * fade);
              pv = p;
            }
          }
          break;
        }
        case 'bullet': {
          g.add(Shape.Disk, head.x, head.y, 0.03 * L.k, 0.03 * L.k, 0, C.white, 2 * fade);
          g.line(A.x + (head.x - A.x) * 0.6, A.y + (head.y - A.y) * 0.6, head.x, head.y, W * 1.2, f.rgb, 1.5 * fade);
          break;
        }
        case 'barrier':
        case 'blocked': {
          const c = f.kind === 'blocked' ? L.viewToWorld({ x: (f.from.x + f.to.x) / 2, y: (f.from.y + f.to.y) / 2 + 0.05 }) : A;
          const rr = 0.32 * L.k * ease.outBack(clamp(k * 3, 0, 1));
          for (let i = 0; i < 6; i++) {
            const a0 = (i / 6) * Math.PI * 2 + Math.PI / 6;
            const a1 = ((i + 1) / 6) * Math.PI * 2 + Math.PI / 6;
            g.line(c.x + Math.cos(a0) * rr, c.y + Math.sin(a0) * rr * 0.75, c.x + Math.cos(a1) * rr, c.y + Math.sin(a1) * rr * 0.75, W * 1.5, f.rgb, 1.6 * fade);
          }
          g.add(Shape.Disk, c.x, c.y, rr * 1.6, rr * 1.2, 0, f.rgb, 0.25 * fade);
          break;
        }
        case 'sigil': {
          const path = sigilPath('circle', 1, 0, 48);
          const rr = (0.05 + 0.25 * ease.outExpo(k)) * L.k;
          for (let i = 1; i < path.length; i++) {
            const a = path[i - 1]!;
            const b = path[i]!;
            g.line(B.x + a.x * rr, B.y + a.y * rr, B.x + b.x * rr, B.y + b.y * rr, W * 1.2, f.rgb, 1.6 * fade);
          }
          for (let i = 0; i < 8; i++) {
            const a0 = (i / 8) * Math.PI * 2 + now / 400;
            g.line(B.x + Math.cos(a0) * rr * 0.6, B.y + Math.sin(a0) * rr * 0.6, B.x + Math.cos(a0) * rr * 1.25, B.y + Math.sin(a0) * rr * 1.25, W * 0.8, C.white, 1.2 * fade);
          }
          break;
        }
        case 'seal':
        case 'nova': {
          const c = L.viewToWorld({ x: 0.5, y: 0.6 });
          for (let i = 0; i < 4; i++) {
            const kk = clamp(k * 1.2 - i * 0.12, 0, 1);
            const rr = (0.1 + 1.4 * ease.outCubic(kk)) * L.k;
            g.add(Shape.Ring, c.x, c.y, rr, rr, 0, i % 2 ? C.white : f.rgb, 1.3 * (1 - kk), 0.985, 80);
          }
          if (travel < 1) g.line(c.x, c.y, head.x, head.y, W * 2.5, f.rgb, 1.4);
          break;
        }
        case 'ultimate': {
          // Mandala of light over the field: rotating rings + radial strokes.
          const c = L.viewToWorld({ x: 0.5, y: 0.45 });
          const kk = ease.outCubic(clamp(k * 2.5, 0, 1));
          for (let i = 0; i < 5; i++) {
            const rr = (0.15 + i * 0.12) * L.k * kk;
            g.add(Shape.Ring, c.x, c.y, rr * 2, rr * 2, (now / 1000) * (i % 2 ? 1 : -1), i % 2 ? C.amber : C.white, 1.2 * fade, 0.97, 70);
          }
          for (let i = 0; i < 24; i++) {
            const a0 = (i / 24) * Math.PI * 2 + now / 2400;
            const r0 = 0.62 * L.k * kk;
            g.line(c.x + Math.cos(a0) * r0 * 0.3, c.y + Math.sin(a0) * r0 * 0.3, c.x + Math.cos(a0) * r0, c.y + Math.sin(a0) * r0, W * 0.6, C.amber, 1.1 * fade);
          }
          break;
        }
        case 'fizzle': {
          const rr = (0.02 + 0.06 * k) * L.k;
          g.add(Shape.Ring, A.x, A.y, rr * 2, rr * 2, 0, f.rgb, 0.8 * fade, 0.9, 25);
          break;
        }
        default:
          break;
      }
    }
    void SAFETY;
  }
}

function travelMs(e: Technique['effect'] | string): number {
  switch (e) {
    case 'beam':
    case 'twinbeam':
    case 'lightning':
      return 90;
    case 'bullet':
      return 140;
    case 'burst':
    case 'flare':
    case 'bind':
    case 'hook':
      return 200;
    case 'wave':
    case 'shock':
      return 260;
    case 'sigil':
    case 'seal':
    case 'nova':
      return 300;
    default:
      return 120;
  }
}

function effectDur(e: Technique['effect']): number {
  return e === 'nova' || e === 'seal' ? 1200 : e === 'sigil' ? 900 : e === 'wave' ? 700 : e === 'lightning' ? 420 : 600;
}

function colorOf(r: Req): RGB {
  if (r.kind === 'shape' || r.kind === 'motion') {
    const s = r.shape;
    return s === 'fist' || s === 'thumb' || s === 'horn' ? C.amber : s === 'open' || s === 'pinch' ? C.cyan : C.magenta;
  }
  return C.amber;
}

function reqText(r: Req, techId: string): string {
  void techId;
  const shape = { fist: 'にぎる', open: 'ひらく', point: 'さす', two: 'ふたえ', pinch: 'つまむ', horn: 'つの', thumb: 'たてる', ell: 'かぎ' } as const;
  switch (r.kind) {
    case 'shape':
      return shape[r.shape];
    case 'motion':
      return `${shape[r.shape]}→${{ swipe: 'はらう', push: 'おす', pull: 'ひく', flick: 'はじく' }[r.motion]}`;
    case 'sigil':
      return `ゆびで ${{ circle: 'まる', triangle: 'さんかく', zigzag: 'いなずま', spiral: 'うず' }[r.sigil]}`;
    case 'seal':
      return `印 ${{ gassho: '合', kensho: '拳掌', soshi: '双指', kanmon: '環門', kosa: '交差' }[r.seal]}`;
    case 'spread':
      return 'あわせて ひらく';
  }
}

export { withShape, defaultHand };
