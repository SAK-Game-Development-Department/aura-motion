// BattleView: draws the battle — shadow spirits, their weak-point marks and
// timing rings, technique effects (each technique has its own look), and the
// cinematic moments (seal cut-ins, the ultimate "天輪結界").
import { SAFETY } from '../config';
import { clamp, ease, lerp } from '../core/math';
import { HAND_BONES, type Vec2 } from '../core/types';
import type { BattleEvent, BattleSession, ActiveEnemy } from '../battle/session';
import type { Enemy } from '../battle/stage';
import { FINISH, FINISH_HIDDEN, HIDDEN_BOSS, STAGES, type EnemyStyle, type RimColor, type StageDef } from '../battle/stages';
import { reqLabel, type Hue, type Req, type Technique } from '../battle/techniques';
import type { GestureFrame } from '../gesture/engine';
import { buildHand, defaultHand, sealHands, withShape } from '../gesture/handModel';
import { sigilPath } from '../gesture/sigil';
import { EnemyBatch } from './enemies';
import type { Gfx } from './gfx';
import { Shape, type GlyphBatch } from './glyphs';
import { C, type WorldView } from './world';

type RGB = readonly [number, number, number];
const HUE: Record<Hue, RGB> = { cyan: C.cyan, magenta: C.magenta, amber: C.amber };

const STYLE_INDEX: Record<EnemyStyle, number> = { shade: 0, crystal: 1, flame: 2, jelly: 3 };
const RIM_RGB: Record<RimColor, RGB> = { cyan: C.cyan, magenta: C.magenta, amber: C.amber, white: C.white, vermilion: C.vermilion };
/** Rim colour per stage and enemy kind (the kind stays readable within a stage). */
function rimOf(def: StageDef, kind: Enemy['kind']): RGB {
  if (kind === 'eclipse') return C.white;
  if (kind === 'warden') return RIM_RGB[def.rimWarden];
  if (kind === 'breaker') return def.rim === 'amber' || def.rimWarden === 'amber' ? C.white : C.amber;
  return RIM_RGB[def.rim];
}

const BASE_SIZE: Record<Enemy['kind'], number> = { wisp: 0.075, warden: 0.095, striker: 0.085, breaker: 0.12, lord: 0.22, eclipse: 0.26 };

interface Fx {
  kind: Technique['effect'] | 'fizzle' | 'blocked' | 'ultimate' | 'hurt' | 'rift' | 'shatter' | 'crack' | 'milestone';
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
  /** Combo milestone reached (10, 20, …). */
  combo?: number;
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
    this.seen.clear();
    this.world.particles?.setImplode(0, 0, 0);
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
        if (e.kill) {
          // Death: shards fly, a pillar of light rises, the soul drifts up.
          const sz = a ? this.enemyPos(a, gt).size : 0.08;
          this.fx.push({ kind: 'shatter', t0: now + travelMs(e.tech.effect), dur: 1100, from: to, to: { x: to.x, y: to.y - 0.25 }, rgb: HUE[e.tech.hue], seed: e.t + e.enemy * 7, big: Math.min(1.6, sz * 10) });
          this.world.punch(e.boss ? 1 : 0.35);
        }
        // Combo milestones.
        if (e.combo > 0 && e.combo % 10 === 0) {
          this.fx.push({ kind: 'milestone', t0: now, dur: 1200, from: { x: 0.5, y: 0.98 }, to: { x: 0.5, y: 0.5 }, rgb: C.amber, seed: e.combo, big: Math.min(1, e.combo / 30) });
          ui.combo = e.combo;
          this.world.shockwave({ x: 0.5, y: 0.95 }, 1);
        }
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
      } else if (e.type === 'hiddenBoss') {
        // Space cracks open; the void storm rolls in.
        ui.cutin = { title: HIDDEN_BOSS.name, reading: HIDDEN_BOSS.reading, hue: 'magenta', big: true };
        this.fx.push({ kind: 'crack', t0: now, dur: 3400, from: { x: 0.5, y: 0.35 }, to: { x: 0.5, y: 0.35 }, rgb: C.magenta, seed: e.t, big: 1 });
        this.dimUntil = now + 2600;
        this.world.holdTime(now, 500);
        this.world.punch(1, 1);
        this.world.shockwave({ x: 0.5, y: 0.35 }, 1);
      } else if (e.type === 'ultimate' && e.hidden) {
        ui.cutin = { title: FINISH_HIDDEN.name, reading: FINISH_HIDDEN.reading, hue: 'cyan', big: true };
        this.domainT0 = now;
        this.domainUntil = now + 3600;
        this.dimUntil = now + 3600;
        this.world.holdTime(now, 800);
        this.fx.push({ kind: 'ultimate', t0: now, dur: 3400, from: { x: 0.5, y: 0.5 }, to: { x: 0.5, y: 0.3 }, rgb: C.cyan, seed: e.t, big: 1.3 });
        this.world.flash.request(now, 0.8);
      } else if (e.type === 'ultimate') {
        ui.cutin = { title: FINISH.name, reading: FINISH.reading, hue: 'amber', big: true };
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
  private seen = new Set<number>();

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
    // Ultimate in three beats: implode (particles rush inward) → hold → release.
    if (this.world.particles) {
      const u = now - this.domainT0;
      const c = L.viewToWorld({ x: 0.5, y: 0.45 });
      const im = now < this.domainUntil ? (u < 900 ? -2.2 * ease.inCubic(u / 900) : u < 1500 ? -0.4 : u < 1900 ? 4.5 : 0) : 0;
      if (u >= 1500 && u < 1530) this.world.shockwave({ x: 0.5, y: 0.45 }, 1);
      this.world.particles.setImplode(c.x, c.y, im);
    }
    const dimTarget = now < this.dimUntil ? 0.7 : 0;
    this.world.bg.uDim.value += (dimTarget - this.world.bg.uDim.value) * 0.15;
    this.enemies.uTime.value = now / 1000;

    this.enemies.begin();
    const def = STAGES[s.stage.stageId] ?? STAGES.hoshi;
    const look: EnemyStyle = def.style;
    for (const a of s.enemies) {
      const p = this.enemyPos(a, gt);
      const style: EnemyStyle = a.e.kind === 'eclipse' ? 'shade' : look;
      const rim = rimOf(def, a.e.kind);
      if (!this.seen.has(a.e.id)) {
        // Entrance: a rift tears open where the spirit emerges.
        this.seen.add(a.e.id);
        const big = a.e.kind === 'lord' || a.e.kind === 'eclipse' ? 1.4 : a.e.kind === 'breaker' ? 0.9 : 0.5;
        this.fx.push({ kind: 'rift', t0: now, dur: 900, from: p.at, to: p.at, rgb: rim, seed: a.e.id, big });
      }
      if (p.alpha <= 0.01) continue;
      const w = L.viewToWorld(p.at);
      const size = L.len(p.size) * 2.6;
      const hurt = clamp(1 - (gt - a.lastMissT) / 300, 0, 1);
      this.enemies.add(w.x, w.y, size, rim, p.alpha * (dom > 0.5 && a.state === 'alive' ? 1 - (dom - 0.5) * 1.6 : 1), a.e.id * 1.37, hurt, p.dissolve, STYLE_INDEX[style]);
      if (a.state !== 'alive' || p.dissolve > 0) continue;
      // Eyes.
      const eyeR = L.len(p.size) * 0.16;
      const blink = Math.sin(gt / 1700 + a.e.id * 3) > 0.97 ? 0.15 : 1;
      const ex = L.len(p.size) * 0.32;
      const R0 = L.len(p.size);
      if (style === 'crystal') {
        // One tall slit eye; bosses get three.
        const n = a.e.kind === 'lord' ? 3 : 1;
        for (let i = 0; i < n; i++) g.add(Shape.Disk, w.x + (i - (n - 1) / 2) * ex * 1.1, w.y + R0 * 0.1, eyeR * 0.45, eyeR * 2.2 * blink, 0, a.e.kind === 'lord' ? C.amber : C.white, 1.4);
      } else if (style === 'flame') {
        // Two slanted eyes and short horns.
        const n = a.e.kind === 'lord' ? 2 : 1;
        for (const k of [-1, 1]) {
          for (let i = 0; i < n; i++) g.add(Shape.Disk, w.x + ex * k * (0.75 + i * 0.6), w.y + R0 * (0.08 - i * 0.12), eyeR * 1.2, eyeR * 0.45 * blink, k * 0.45, a.e.kind === 'lord' ? C.white : C.amber, 1.4);
          const hx = w.x + ex * k * 1.1;
          const hy = w.y + R0 * 0.75;
          g.line(hx, hy, hx + ex * k * 0.5, hy + R0 * 0.55, 0.004 * L.k, rim, 1.2);
        }
      } else if (style === 'jelly') {
        // Two small calm eyes inside the bell.
        for (const k of [-1, 1]) g.add(Shape.Disk, w.x + ex * k * 0.6, w.y + R0 * 0.18, eyeR * 0.7, eyeR * 0.7 * blink, 0, a.e.kind === 'lord' ? C.amber : C.white, 1.2);
      } else {
        const eyes = a.e.kind === 'lord' ? [-1.2, -0.4, 0.4, 1.2] : a.e.kind === 'eclipse' ? [-1.5, -0.75, 0, 0.75, 1.5] : [-1, 1];
        for (const k of eyes) g.add(Shape.Disk, w.x + ex * k * 0.8, w.y + R0 * 0.12 - (a.e.kind === 'eclipse' ? Math.abs(k) * ex * 0.15 : 0), eyeR, eyeR * blink, 0, a.e.kind === 'lord' ? C.amber : a.e.kind === 'eclipse' ? C.cyan : C.white, 1.3);
      }
      if (a.e.kind !== 'eclipse') this.drawDecor(g, def.decor, w, R0, now, a.e.id, rim);
      if (style === 'flame') {
        // Embers rising off flame spirits.
        const u = ((now / 900 + a.e.id * 0.37) % 1 + 1) % 1;
        g.add(Shape.Disk, w.x + Math.sin(a.e.id * 5 + now / 300) * R0 * 0.8, w.y + R0 * (0.8 + u * 1.6), R0 * 0.07, R0 * 0.07, 0, C.amber, 1.2 * (1 - u));
      }
      if (a.e.kind === 'eclipse') {
        // Hidden boss: an inverted halo and orbiting shards.
        const R = L.len(p.size);
        g.add(Shape.Ring, w.x, w.y, R * 3.6, R * 3.6, 0, C.white, 0.9 + 0.3 * Math.sin(now / 160), 0.97, 60);
        for (let i = 0; i < 9; i++) {
          const ang = (i / 9) * Math.PI * 2 + gt / 700;
          const rr = R * (2.2 + 0.3 * Math.sin(gt / 300 + i));
          const x0 = w.x + Math.cos(ang) * rr;
          const y0 = w.y + Math.sin(ang) * rr * 0.8;
          g.line(x0, y0, x0 + Math.cos(ang + 1.2) * R * 0.35, y0 + Math.sin(ang + 1.2) * R * 0.35, 0.004 * L.k, i % 2 ? C.magenta : C.cyan, 1.4);
        }
      }
      if (a.e.kind === 'warden' && a.step < a.e.steps.length - 1) {
        // Shield: one ring per remaining layer.
        for (let i = 0; i < a.e.steps.length - 1 - a.step; i++) {
          const rr = R0 * (2.9 + i * 0.45);
          if (style === 'crystal') this.polygon(g, w.x, w.y, rr * 0.5, 6, gt / 1400 + i, rim, 0.9);
          else g.add(Shape.Ring, w.x, w.y, rr, rr, gt / 900, rim, 0.9, 0.93, 40);
        }
      }
      if (a.e.kind === 'lord') this.drawLord(g, style, w, R0, gt, now, rim);
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
      if (strong || a.e.kind === 'breaker') ui.marks.push({ id: `e${a.e.id}`, at: { x: markAt.x, y: markAt.y + msz * 2.05 }, text: reqLabel(req), strong });
    }
    this.enemies.end();
    this.drawFx(g, now);
  }

  /** Regular polygon outline (world coords). */
  private polygon(g: GlyphBatch, x: number, y: number, r: number, n: number, rot: number, rgb: RGB, alpha: number, squash = 1): void {
    const L = this.gfx.layout;
    for (let i = 0; i < n; i++) {
      const a0 = rot + (i / n) * Math.PI * 2;
      const a1 = rot + ((i + 1) / n) * Math.PI * 2;
      g.line(x + Math.cos(a0) * r, y + Math.sin(a0) * r * squash, x + Math.cos(a1) * r, y + Math.sin(a1) * r * squash, 0.0035 * L.k, rgb, alpha);
    }
  }

  /** Each stage's boss has its own crown: rings, hexagon frames, a flame crown, trailing tentacles. */
  private drawLord(g: GlyphBatch, style: EnemyStyle, w: Vec2, R: number, gt: number, now: number, rim: RGB): void {
    const L = this.gfx.layout;
    if (style === 'crystal') {
      for (let i = 0; i < 3; i++) this.polygon(g, w.x, w.y, R * (1.7 + i * 0.35), 6, (gt / 2200) * (i % 2 ? -1 : 1) + i * 0.3, i === 1 ? C.white : rim, 0.8, 0.9);
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + gt / 1800;
        const x0 = w.x + Math.cos(ang) * R * 2.7;
        const y0 = w.y + Math.sin(ang) * R * 2.2;
        this.polygon(g, x0, y0, R * 0.22, 4, ang, rim, 1.1, 1.8);
      }
    } else if (style === 'flame') {
      for (let i = 0; i < 9; i++) {
        const ang = Math.PI / 2 + (i - 4) * 0.28;
        const flick = 0.75 + 0.25 * Math.sin(now / 90 + i * 1.9);
        const r0 = R * 1.25;
        const r1 = R * (1.9 + (i % 2 ? 0.5 : 0.9) * flick);
        g.line(w.x + Math.cos(ang) * r0, w.y + Math.sin(ang) * r0, w.x + Math.cos(ang) * r1, w.y + Math.sin(ang) * r1, 0.006 * L.k, i % 2 ? C.amber : rim, 1.3);
      }
      g.add(Shape.Ring, w.x, w.y, R * 3.4, R * 3.4, gt / 700, rim, 0.7, 0.95, 50);
    } else if (style === 'jelly') {
      // A crown of long trailing tentacles and a slow pulsing halo.
      for (let i = 0; i < 10; i++) {
        const x0 = w.x + (i - 4.5) * R * 0.32;
        let px = x0;
        let py = w.y - R * 0.6;
        for (let j = 1; j <= 6; j++) {
          const nx = x0 + Math.sin(gt / 420 + i + j * 0.7) * R * 0.18 * j * 0.4;
          const ny = w.y - R * (0.6 + j * 0.42);
          g.line(px, py, nx, ny, 0.004 * L.k * (1 - j * 0.1), rim, 1.1 * (1 - j * 0.12));
          px = nx;
          py = ny;
        }
      }
      const pr = R * (2.6 + 0.15 * Math.sin(gt / 500));
      g.add(Shape.Ring, w.x, w.y + R * 0.2, pr, pr * 0.8, 0, rim, 0.6, 0.96, 50);
    } else {
      for (let i = 0; i < 3; i++) {
        const rr = R * (3.2 + i * 0.5);
        g.add(Shape.Ring, w.x, w.y, rr, rr * 0.35, (gt / 1600) * (i % 2 ? -1 : 1) + i, rim, 0.6, 0.96, 50);
      }
    }
  }

  /** Stage ornaments around a spirit: crackling arcs, drifting petals or snowflakes. */
  private drawDecor(g: GlyphBatch, decor: StageDef['decor'], w: Vec2, R: number, now: number, id: number, rim: RGB): void {
    if (decor === 'none') return;
    const L = this.gfx.layout;
    if (decor === 'arcs') {
      // A short zig-zag arc that jumps around the body every ~120 ms.
      const k = Math.floor(now / 120) + id * 7;
      const a0 = ((k * 2.399) % 6.283) + 0.0;
      let px = w.x + Math.cos(a0) * R * 1.05;
      let py = w.y + Math.sin(a0) * R * 1.05;
      for (let j = 1; j <= 4; j++) {
        const ang = a0 + j * 0.28;
        const rr = R * (1.05 + ((k * 13 + j * 7) % 5) * 0.08);
        const nx = w.x + Math.cos(ang) * rr;
        const ny = w.y + Math.sin(ang) * rr;
        g.line(px, py, nx, ny, 0.003 * L.k, j % 2 ? C.white : rim, 1.5);
        px = nx;
        py = ny;
      }
      return;
    }
    for (let i = 0; i < 4; i++) {
      const u = ((now / (decor === 'snow' ? 2400 : 1700) + i * 0.25 + id * 0.13) % 1 + 1) % 1;
      const x = w.x + Math.sin(i * 2.1 + id + now / 700) * R * 1.4;
      const y = w.y + R * (1.3 - u * 2.6);
      const sz = R * (decor === 'snow' ? 0.06 : 0.09);
      g.add(Shape.Disk, x, y, sz, decor === 'snow' ? sz : sz * 0.55, now / 400 + i, decor === 'snow' ? C.white : C.magenta, 0.9 * Math.sin(u * Math.PI));
    }
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
        case 'rift': {
          // A vertical tear that opens and closes, spilling sparks.
          const open = Math.sin(Math.min(1, k * 1.4) * Math.PI);
          const h = 0.16 * L.k * f.big * (0.6 + 0.4 * open);
          const wdt = 0.035 * L.k * f.big * open;
          g.add(Shape.Ring, A.x, A.y, wdt * 2, h * 2, 0, f.rgb, 1.6 * open, 0.9, 30);
          g.add(Shape.Disk, A.x, A.y, wdt * 1.2, h * 1.6, 0, C.white, 0.9 * open);
          for (let i = 0; i < 6; i++) {
            const a0 = rnd(i) * Math.PI * 2;
            const r0 = (0.02 + 0.18 * k) * L.k * f.big;
            g.add(Shape.Disk, A.x + Math.cos(a0) * r0, A.y + Math.sin(a0) * r0 * 1.6, 0.012 * L.k, 0.012 * L.k, 0, f.rgb, 1.2 * (1 - k));
          }
          break;
        }
        case 'shatter': {
          if (k < 0) break;
          const kk = clamp(k, 0, 1);
          // Shards.
          for (let i = 0; i < 12; i++) {
            const a0 = (i / 12) * Math.PI * 2 + rnd(i) * 0.6;
            const sp = (0.12 + rnd(i + 20) * 0.3) * L.k * f.big;
            const dist = sp * ease.outCubic(kk);
            const cx = A.x + Math.cos(a0) * dist;
            const cy = A.y + Math.sin(a0) * dist - kk * kk * 0.08 * L.k;
            const rot = a0 + kk * (4 + rnd(i) * 6);
            const len = 0.025 * L.k * f.big * (1 - kk * 0.6);
            g.line(cx - Math.cos(rot) * len, cy - Math.sin(rot) * len, cx + Math.cos(rot) * len, cy + Math.sin(rot) * len, W * 1.2, i % 3 === 0 ? C.white : f.rgb, 1.6 * (1 - kk));
          }
          // Pillar of light.
          const pill = Math.sin(Math.min(1, kk * 2.2) * Math.PI) ;
          g.add(Shape.Band, A.x, A.y + 0.4 * L.k, 0.06 * L.k * f.big * pill + 0.001, 0.9 * L.k, Math.PI / 2, C.white, 0.6 * pill, 1, 0);
          // The soul drifts upward.
          const sy = A.y + ease.outCubic(kk) * 0.22 * L.k;
          g.add(Shape.Disk, A.x + Math.sin(kk * 9) * 0.01 * L.k, sy, 0.035 * L.k, 0.035 * L.k, 0, C.cyan, 1.3 * (1 - kk));
          break;
        }
        case 'crack': {
          // Cracks in space radiating from a point, glowing then fading.
          const grow = ease.outExpo(clamp(k * 3, 0, 1));
          const fadeC = 1 - clamp((k - 0.7) / 0.3, 0, 1);
          for (let j = 0; j < 9; j++) {
            let px = A.x;
            let py = A.y;
            let ang = (j / 9) * Math.PI * 2 + rnd(j) * 0.5;
            const segs = 6;
            for (let i = 0; i < segs; i++) {
              const len = (0.05 + rnd(j * 10 + i) * 0.07) * L.k * grow;
              ang += (rnd(j * 31 + i) - 0.5) * 1.1;
              const nx = px + Math.cos(ang) * len;
              const ny = py + Math.sin(ang) * len;
              g.line(px, py, nx, ny, W * (1.6 - i * 0.2), i % 2 ? C.white : f.rgb, 1.7 * fadeC);
              px = nx;
              py = ny;
            }
          }
          break;
        }
        case 'milestone': {
          // A wide arc of light sweeping up from the bottom edge.
          const kk = ease.outCubic(k);
          const rr = (0.3 + 1.6 * kk) * L.k;
          g.add(Shape.Ring, A.x, A.y - 0.1 * L.k, rr * 2, rr * 1.2, 0, f.rgb, 1.5 * (1 - k), 0.985, 70);
          g.add(Shape.Ring, A.x, A.y - 0.1 * L.k, rr * 1.7, rr * 1.0, 0, C.white, 1.0 * (1 - k), 0.985, 70);
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


export { withShape, defaultHand };
