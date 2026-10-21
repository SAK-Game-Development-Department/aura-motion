// WorldView: turns game state + body + events into light. Owns the particle
// system, glyph batch, walls, sparks and the safety-limited FX.
import { DODGE, JUDGE, LATENCY, PALETTE, POSE, SAFETY, hexToLinear } from '../config';
import { clamp, ease } from '../core/math';
import { BONES, LM, type Vec2 } from '../core/types';
import type { BodySnapshot } from '../input/body';
import type { GameEvent, GameSession } from '../game/session';
import { POSES } from '../stage/poses';
import { Background } from './background';
import { FlashLimiter, Shake } from './fx/safety';
import type { Gfx } from './gfx';
import { GlyphBatch, Shape, Sparks } from './glyphs';
import { Particles } from './particles/particles';
import { Walls } from './walls';

type RGB = readonly [number, number, number];
const C = {
  cyan: hexToLinear(PALETTE.cyan) as RGB,
  magenta: hexToLinear(PALETTE.magenta) as RGB,
  amber: hexToLinear(PALETTE.amber) as RGB,
  white: hexToLinear(PALETTE.white) as RGB,
  dim: [0.05, 0.07, 0.2] as RGB,
};

interface Effect {
  kind: 'ring' | 'fall' | 'goalPulse';
  x: number;
  y: number;
  t0: number;
  dur: number;
  rgb: RGB;
  size: number;
}

export interface CalibVisual {
  /** Pulse times and the current time in the same clock. */
  pulses: number[];
  now: number;
  intervalMs: number;
  /** Last detected clap (same clock) for feedback. */
  lastClap: number | null;
}

export interface WorldFrame {
  now: number;
  dt: number;
  body: BodySnapshot | null;
  session: GameSession | null;
  /** Game time for the session (ms). */
  gameT: number;
  beatMs: number;
  /** Show the skeleton light lines (Tier 0 silhouette). */
  skeleton: boolean;
  particles: boolean;
  calib: CalibVisual | null;
  /** Energy 0..1 (title=0.3, play=0.7, finale=1). */
  energy: number;
  /** Hide game objects (title/results). */
  showGame: boolean;
}

const KEYPOINT_IDX = [LM.nose, LM.leftShoulder, LM.rightShoulder, LM.leftElbow, LM.rightElbow, LM.leftWrist, LM.rightWrist, LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle, LM.leftIndex, LM.rightIndex, LM.leftHip];

export class WorldView {
  readonly bg = new Background();
  readonly glyphs = new GlyphBatch(1400);
  readonly sparks = new Sparks(700);
  readonly walls = new Walls(3);
  readonly flash = new FlashLimiter(SAFETY.defaultFlashIntensity);
  readonly shake = new Shake(SAFETY.defaultShakeIntensity);
  particles: Particles | null = null;
  private effects: Effect[] = [];
  private hitStopUntil = 0;
  private reveal = 0;
  private revealTarget = 0;
  private presentSince: number | null = null;
  private lastEventOrbView = new Map<number, Vec2>();
  fxEnabled = true;
  /** Background pulse amplitude multiplier (calm mode lowers it). */
  pulseAmp = 1;
  private time0 = 0;

  constructor(
    private gfx: Gfx,
    particleMax: number,
    fieldW: number,
    fieldH: number,
  ) {
    gfx.scene.add(this.bg.mesh);
    gfx.scene.add(this.walls.group);
    gfx.scene.add(this.glyphs.mesh);
    if (particleMax > 0) {
      this.particles = new Particles(particleMax, fieldW, fieldH);
      gfx.scene.add(this.particles.sprite);
    }
  }

  setCalm(calm: boolean, flash: number, shake: number): void {
    this.flash.intensity = calm ? SAFETY.calmFlashIntensity : flash;
    this.shake.intensity = calm ? SAFETY.calmShakeIntensity : shake;
    this.pulseAmp = calm ? 0.35 : 1;
  }

  setField(data: Uint8Array): void {
    this.particles?.setField(data);
  }

  /** Trigger the "become light" transformation (showpiece #1). */
  transform(): void {
    this.reveal = 0;
    this.revealTarget = 1;
  }

  // ───────────────────────── events ─────────────────────────

  onEvents(events: GameEvent[], now: number, session: GameSession | null): void {
    const L = this.gfx.layout;
    for (const e of events) {
      if (e.type === 'judge') {
        const w = L.viewToWorld(e.view);
        if (e.grade === 'miss') {
          this.effects.push({ kind: 'fall', x: w.x, y: w.y, t0: now, dur: 700, rgb: C.dim, size: 0.05 });
          if (e.what === 'dodge' && this.fxEnabled) {
            this.flash.request(now, 0.5);
            this.shake.kick(0.5);
            this.effects.push({ kind: 'ring', x: w.x, y: w.y, t0: now, dur: 500, rgb: C.magenta, size: 0.5 });
          }
          continue;
        }
        const perfect = e.grade === 'perfect';
        const rgb = perfect ? C.amber : C.cyan;
        // Hit = 1) hit stop 2) radiate 3) linger (docs/art-direction.md).
        if (this.fxEnabled) this.hitStopUntil = now + SAFETY.hitStopMs * (perfect ? 1 : 0.6) * Math.max(0.3, this.shake.intensity + 0.4);
        const big = e.what !== 'orb';
        this.sparks.burst(w.x, w.y, big ? 64 : perfect ? 36 : 20, big ? 0.9 : perfect ? 0.6 : 0.4, rgb, big ? 1.0 : 0.7, big ? 0.016 : 0.012, e.id);
        this.effects.push({ kind: 'ring', x: w.x, y: w.y, t0: now, dur: big ? 700 : 450, rgb: perfect ? C.white : C.cyan, size: big ? 0.9 : 0.22 });
        if (this.fxEnabled) {
          this.bg.uRipple.value = 0;
          this.bg.uRippleCenter.value.set(w.x, w.y);
          this.rippleT0 = now;
          if (perfect && (big || (session?.score.combo ?? 0) % 10 === 0)) this.flash.request(now, big ? 0.7 : 0.4);
          this.shake.kick(big ? 0.6 : perfect ? 0.25 : 0.12);
        }
      } else if (e.type === 'flowCapture') {
        const w = L.viewToWorld(e.view);
        this.sparks.burst(w.x, w.y, Math.min(12, 3 + e.count * 2), 0.35, C.amber, 0.5, 0.01, e.t);
        this.effects.push({ kind: 'goalPulse', x: w.x, y: w.y, t0: now, dur: 300, rgb: C.amber, size: 0.2 });
      } else if (e.type === 'section') {
        if (this.fxEnabled && e.kind === 'finale') this.flash.request(now, 0.6);
      }
    }
  }
  private rippleT0 = -1e9;

  // ───────────────────────── frame ─────────────────────────

  update(f: WorldFrame): void {
    const L = this.gfx.layout;
    const now = f.now;
    if (this.time0 === 0) this.time0 = now;
    const t = (now - this.time0) / 1000;
    const hitStop = now < this.hitStopUntil;
    const visDt = hitStop ? f.dt * 0.08 : f.dt;

    // Background.
    this.bg.fit(L.sa);
    this.bg.uTime.value = t;
    const beatPhase = f.beatMs > 0 ? ((f.gameT % f.beatMs) + f.beatMs) % f.beatMs / f.beatMs : 0;
    this.bg.uBeat.value = beatPhase;
    this.bg.uPulseAmp.value = this.pulseAmp * (f.showGame ? 1 : 0.4);
    this.bg.uIntensity.value = 0.5 + f.energy * 0.7;
    this.bg.uFlash.value = this.flash.value(now);
    this.bg.uRipple.value = clamp((now - this.rippleT0) / 900, 0, 1);
    const sec = f.session?.section;
    const warmTarget = sec === 'flow' ? 0.8 : sec === 'finale' ? 0.35 : 0;
    this.bg.uWarm.value += (warmTarget - this.bg.uWarm.value) * Math.min(1, f.dt * 2);

    // Camera shake.
    const sh = this.fxEnabled ? this.shake.offset(now) : { x: 0, y: 0 };
    this.gfx.camera.position.set(sh.x, sh.y, 5);

    // Presence & transformation reveal.
    const present = !!f.body?.present;
    if (present) this.presentSince ??= now;
    else this.presentSince = null;
    if (present && this.revealTarget === 0) this.transform();
    if (!present && this.presentSince === null) this.revealTarget = 0;
    this.reveal += (this.revealTarget - this.reveal) * Math.min(1, f.dt * (this.revealTarget > this.reveal ? 1.6 : 0.8));

    // Particles.
    if (this.particles) {
      const P = this.particles;
      P.sprite.visible = f.particles;
      P.uSa.value = L.sa;
      P.uCa.value = L.ca;
      P.uK.value = L.k;
      P.uPresent.value = present ? 1 : 0;
      P.uReveal.value = ease.outCubic(this.reveal);
      P.uWarm.value = this.bg.uWarm.value;
      const flow = f.session?.flow;
      if (flow && f.showGame && f.gameT < flow.phase.end + 1500) {
        P.uFlowOn.value = 1;
        const e = L.viewToWorld(flow.emitterView);
        const g = L.viewToWorld(flow.goalView);
        P.uEmitter.value.set(e.x, e.y);
        P.uGoal.value.set(g.x, g.y);
        P.uEmitDir.value.set(flow.phase.emitDir.x, -flow.phase.emitDir.y);
      } else P.uFlowOn.value = 0;
      if (present && f.body) {
        const kps = KEYPOINT_IDX.map((i) => {
          const p = f.body!.lm[i];
          return p && p.v > 0.3 ? L.viewToWorld(p) : L.viewToWorld(f.body!.anchor);
        });
        P.setKeypoints(kps);
      }
      if (f.particles) P.update(this.gfx.renderer, visDt, t);
    }

    // Glyphs.
    const g = this.glyphs;
    g.uTime.value = t;
    g.begin();
    const beatPulse = Math.exp(-beatPhase * 6);

    if (f.body?.present) this.drawBody(f.body, f.skeleton, f.particles, now);
    if (f.showGame && f.session) this.drawGame(f, beatPulse);
    else this.walls.hideAll();
    if (f.calib && f.body?.present) this.drawCalib(f.calib, f.body);

    this.sparks.update(visDt);
    this.sparks.draw(g);
    this.drawEffects(now);
    g.end();
  }

  private drawBody(b: BodySnapshot, skeleton: boolean, particles: boolean, now: number): void {
    const L = this.gfx.layout;
    const g = this.glyphs;
    const reveal = this.reveal;
    // Light-line skeleton: bright when it is the only silhouette, faint under particles.
    const lineI = skeleton ? (particles ? 0.25 + (1 - reveal) * 0.7 : 0.95) : 0;
    if (lineI > 0) {
      for (const [a, c] of BONES) {
        const p = b.lm[a];
        const q = b.lm[c];
        if (!p || !q || p.v < 0.35 || q.v < 0.35) continue;
        const pa = L.viewToWorld(p);
        const pb = L.viewToWorld(q);
        g.line(pa.x, pa.y, pb.x, pb.y, 0.006 * L.k, C.cyan, lineI);
      }
      const nose = b.lm[LM.nose];
      if (nose && nose.v > 0.35) {
        const w = L.viewToWorld(nose);
        const r = b.anchor.unit * 0.55 * L.k;
        g.add(Shape.Ring, w.x, w.y, r * 2, r * 2, 0, C.cyan, lineI * 0.8, 0.8, 30);
      }
    }
    // Hand glows at predicted positions (latency compensated display).
    for (const h of ['L', 'R'] as const) {
      const p = L.viewToWorld(b.handsPred[h]);
      const r = JUDGE.handRadius * b.anchor.unit * L.k * 2.2;
      const rgb = h === 'L' ? C.cyan : C.magenta;
      const pulse = 0.85 + 0.15 * Math.sin(now / 160 + (h === 'L' ? 0 : 1.5));
      g.add(Shape.Disk, p.x, p.y, r, r, 0, rgb, 0.7 * pulse);
      g.add(Shape.Disk, p.x, p.y, r * 0.35, r * 0.35, 0, C.white, 0.9);
    }
  }

  private drawGame(f: WorldFrame, beatPulse: number): void {
    const L = this.gfx.layout;
    const g = this.glyphs;
    const s = f.session!;
    const tg = f.gameT;

    // Orbs: core + target outline + shrinking approach ring.
    for (const o of s.orbs) {
      const w = L.viewToWorld(o.view);
      this.lastEventOrbView.set(o.note.id, o.view);
      const r = L.len(o.radius);
      const prog = clamp((tg - o.spawnT) / o.approachMs, 0, 1.2);
      const appear = ease.outBack(clamp((tg - o.spawnT) / 260, 0, 1));
      const quad = r * 2 * 3.4 * appear;
      const c = 1 / 3.4;
      const ringR = 1 - (1 - c) * ease.inOutSine(Math.min(prog, 1));
      const rgb = o.note.side === 'L' ? C.cyan : o.note.side === 'R' ? C.magenta : C.amber;
      const intensity = 0.9 + 0.25 * beatPulse + (prog > 0.85 ? 0.5 : 0);
      g.add(Shape.Orb, w.x, w.y, quad, quad, 0, rgb, intensity, c * (1 + 0.06 * beatPulse), ringR, clamp(prog * 2, 0, 1) * 1.2);
    }

    // Walls.
    const seen = new Set<number>();
    for (const wall of s.walls) {
      seen.add(wall.note.id);
      const slot = this.walls.slot(wall.note.id, () => [POSES[wall.note.pose], wall.anchor, L.ca, s.stage.seated]);
      if (!slot) continue;
      const prog = clamp((tg - wall.spawnT) / wall.approachMs, 0, 1);
      const e = ease.inCubic(prog);
      const a = L.viewToWorld(wall.anchor);
      const scale = 0.25 + 0.75 * e;
      const W = L.ca * L.k;
      const H = L.k;
      slot.mesh.visible = true;
      slot.mesh.scale.set(W * scale, H * scale, 1);
      // Scale about the player's anchor so the hole lands on them.
      slot.mesh.position.set(a.x * (1 - scale), a.y * (1 - scale), 0);
      slot.uProg.value = e;
      slot.uAlpha.value = clamp(prog * 1.5, 0, 1) * (tg > wall.note.t ? clamp(1 - (tg - wall.note.t) / 300, 0, 1) : 1);
      const target = wall.current ? clamp((wall.current.score - 0.5) / (POSE.passThreshold - 0.5), 0, 1) : 0;
      slot.uMatch.value += (target - slot.uMatch.value) * Math.min(1, f.dt * 8);
      slot.uTime.value = tg / 1000;
    }
    for (const sl of this.walls.active) if (!seen.has(sl.id)) this.walls.release(sl.id);

    // Dodges: danger bands (magenta chevrons).
    for (const d of s.dodges) {
      const prog = clamp((tg - d.spawnT) / d.approachMs, 0, 1.2);
      const e = ease.inOutSine(Math.min(1, prog));
      const b = f.body?.present ? f.body : null;
      const a = d.anchor;
      const unit = a.unit;
      const alpha = clamp(prog * 1.4, 0, 1) * (tg > d.note.t + DODGE.windowAfterMs ? 0 : 1);
      if (alpha <= 0) continue;
      const thick = (0.03 + 0.07 * e) * L.k;
      if (d.note.kind === 'jump') {
        const ankleY = b ? Math.max(b.lm[LM.leftAnkle]?.y ?? 0.9, b.lm[LM.rightAnkle]?.y ?? 0.9) : a.y + unit * 3.4;
        const w = L.viewToWorld({ x: 0.5, y: ankleY - 0.01 });
        g.add(Shape.Band, w.x, w.y, L.sa * (0.4 + 0.6 * e), thick, 0, C.magenta, alpha * 1.2, 10, 1.4);
      } else if (d.note.kind === 'crouch' || d.note.kind === 'duck') {
        const headY = b ? (b.lm[LM.nose]?.y ?? a.y - unit) : a.y - unit;
        const w = L.viewToWorld({ x: 0.5, y: headY - 0.02 });
        g.add(Shape.Band, w.x, w.y, L.sa * (0.4 + 0.6 * e), thick * 1.6, 0, C.magenta, alpha * 1.2, 10, 1.4);
      } else {
        // leanL = beam on the player's right → lean left (and vice versa).
        const side = d.note.kind === 'leanL' ? 1 : -1;
        const cx = a.x + (side * (0.45 * unit + 1.6 * unit)) / L.ca;
        const w = L.viewToWorld({ x: cx, y: 0.5 });
        const width = (2.6 * unit * L.k) * (0.4 + 0.6 * e);
        g.add(Shape.Band, w.x, w.y, L.k * 1.05, width, Math.PI / 2, C.magenta, alpha * 0.9, 8, 1.2 * side);
      }
    }

    // Flow: emitter + goal ring.
    if (s.flow && tg < s.flow.phase.end + 1500) {
      const e = L.viewToWorld(s.flow.emitterView);
      const gl = L.viewToWorld(s.flow.goalView);
      const on = tg >= s.flow.phase.start && tg < s.flow.phase.end;
      const fade = on ? 1 : clamp(1 - (tg - s.flow.phase.end) / 1500, 0, 1);
      g.add(Shape.Disk, e.x, e.y, 0.12, 0.12, 0, C.amber, 1.2 * fade);
      const gr = 0.09 * 2 * 2.2 * L.k;
      g.add(Shape.Ring, gl.x, gl.y, gr, gr, 0, C.amber, (1.2 + 0.4 * beatPulse) * fade, 1 / 2.2, 30);
      g.add(Shape.Disk, gl.x, gl.y, gr * 0.5, gr * 0.5, 0, C.amber, 0.35 * fade);
    }
  }

  private drawCalib(c: CalibVisual, b: BodySnapshot): void {
    const L = this.gfx.layout;
    const g = this.glyphs;
    // Two lights converge in front of the chest on each pulse → clap.
    const chest = L.viewToWorld({ x: b.anchor.x, y: b.anchor.y + b.anchor.unit * 0.9 });
    const unitW = b.anchor.unit * L.k;
    for (const p of c.pulses) {
      const u = (c.now - (p - c.intervalMs)) / c.intervalMs;
      if (u < 0 || u > 1.25) continue;
      const k = ease.inCubic(clamp(u, 0, 1));
      const spread = (1 - k) * unitW * 2.2;
      const a = u <= 1 ? 1 : clamp(1 - (u - 1) * 4, 0, 1);
      g.add(Shape.Disk, chest.x - spread, chest.y, unitW * 0.7, unitW * 0.7, 0, C.cyan, 1.1 * a);
      g.add(Shape.Disk, chest.x + spread, chest.y, unitW * 0.7, unitW * 0.7, 0, C.magenta, 1.1 * a);
      if (u > 0.98 && u < 1.25) {
        const rr = unitW * (1 + (u - 1) * 8);
        g.add(Shape.Ring, chest.x, chest.y, rr, rr, 0, C.amber, a * 1.5, 0.85, 25);
      }
    }
    if (c.lastClap !== null && c.now - c.lastClap < 400) {
      const k = (c.now - c.lastClap) / 400;
      const rr = unitW * (0.6 + k * 1.6);
      g.add(Shape.Ring, chest.x, chest.y, rr, rr, 0, C.white, (1 - k) * 1.4, 0.85, 30);
    }
    void LATENCY;
  }

  private drawEffects(now: number): void {
    const g = this.glyphs;
    this.effects = this.effects.filter((e) => now - e.t0 < e.dur);
    for (const e of this.effects) {
      const k = (now - e.t0) / e.dur;
      if (e.kind === 'ring') {
        const r = e.size * ease.outExpo(k);
        g.add(Shape.Ring, e.x, e.y, r * 2, r * 2, 0, e.rgb, (1 - k) * 1.6, 0.9, 25);
      } else if (e.kind === 'fall') {
        g.add(Shape.Disk, e.x, e.y - k * 0.08, e.size * (1 - k * 0.5), e.size * (1 - k * 0.5), 0, e.rgb, (1 - k) * 0.6);
      } else {
        const r = e.size * (1 + k * 0.4);
        g.add(Shape.Ring, e.x, e.y, r, r, 0, e.rgb, (1 - k) * 0.8, 0.8, 20);
      }
    }
  }

  reset(): void {
    this.effects = [];
    this.sparks.clear();
    this.walls.hideAll();
    this.lastEventOrbView.clear();
  }
}
