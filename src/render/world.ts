// WorldView: hands → light. Owns the particle system (hands as particles),
// the glyph batch (light skeleton, fingertip trails, stance icons & charge
// rings, sigil strokes, ghost hands), sparks and the safety-limited FX.
import { PALETTE, SAFETY, hexToLinear } from '../config';
import { clamp, ease } from '../core/math';
import { HAND_BONES, type Landmark, type Vec2 } from '../core/types';
import type { GestureEvent, GestureFrame, GestureHand } from '../gesture/engine';
import { HandPredictor } from '../gesture/predict';
import type { StageTheme } from '../battle/stages';
import { buildHand, defaultHand, withShape, type ShapeId, type SynthHand } from '../gesture/handModel';
import { Background } from './background';
import { FlashLimiter, Shake } from './fx/safety';
import type { Gfx } from './gfx';
import { GlyphBatch, Shape, Sparks } from './glyphs';
import { Particles } from './particles/particles';

type RGB = readonly [number, number, number];
export const C = {
  cyan: hexToLinear(PALETTE.cyan) as RGB,
  magenta: hexToLinear(PALETTE.magenta) as RGB,
  amber: hexToLinear(PALETTE.amber) as RGB,
  vermilion: hexToLinear(PALETTE.vermilion) as RGB,
  white: hexToLinear(PALETTE.white) as RGB,
  dim: [0.05, 0.07, 0.2] as RGB,
  ghost: [0.35, 0.42, 0.9] as RGB,
};

interface Effect {
  kind: 'ring' | 'fall';
  x: number;
  y: number;
  t0: number;
  dur: number;
  rgb: RGB;
  size: number;
}

export interface CalibVisual {
  pulses: number[];
  now: number;
  intervalMs: number;
  lastEvent: number | null;
}

export interface WorldFrame {
  now: number;
  dt: number;
  gesture: GestureFrame | null;
  /** Translucent demonstration hands (synthetic). */
  ghost: SynthHand[] | null;
  beatMs: number;
  beatT: number;
  particles: boolean;
  calib: CalibVisual | null;
  /** Energy 0..1 (title=0.3, play=0.7, boss=1). */
  energy: number;
  /** 0..1 dims the hands (results screen). */
  dim?: number;
  /** Show the recognised-shape icon above the hand. */
  icons: boolean;
  /** Extra drawing into the glyph batch (battle). */
  overlay?: (g: GlyphBatch) => void;
}

const KEYPOINTS = [0, 4, 8, 12, 16, 20, 5, 9, 13, 17, 2, 6, 10, 14, 18, 3];
const TRAIL = 18;

/** Colour per shape family (colour is never the only cue: icons and motion differ too). */
export function shapeColor(s: ShapeId): RGB {
  return s === 'fist' || s === 'thumb' || s === 'horn' ? C.amber : s === 'open' || s === 'pinch' ? C.cyan : C.magenta;
}

export type WorldTheme = StageTheme | 'none';

export class WorldView {
  /** Extrapolates the drawn hands to render time (hides tracking latency). */
  readonly predictor = new HandPredictor();
  readonly bg = new Background();
  readonly glyphs = new GlyphBatch(4000);
  readonly sparks = new Sparks(900);
  readonly flash = new FlashLimiter(SAFETY.defaultFlashIntensity);
  readonly shake = new Shake(SAFETY.defaultShakeIntensity);
  particles: Particles | null = null;
  private effects: Effect[] = [];
  private hitStopUntil = 0;
  private reveal = 0;
  private revealTarget = 0;
  private trails = new Map<number, Vec2[]>();
  private icons = new Map<string, Landmark[]>();
  fxEnabled = true;
  /** Current stage theme; weights cross-fade toward it. */
  theme: WorldTheme = 'lake';
  pulseAmp = 1;
  private time0 = 0;
  private rippleT0 = -1e9;

  constructor(
    private gfx: Gfx,
    particleMax: number,
    fieldW: number,
    fieldH: number,
  ) {
    gfx.scene.add(this.bg.mesh);
    gfx.scene.add(this.glyphs.mesh);
    if (particleMax > 0) {
      this.particles = new Particles(particleMax, fieldW, fieldH);
      gfx.scene.add(this.particles.sprite);
    }
  }

  /** Staff effects strength (0..1): scales flashes, shakes, zoom punches and colour fringing. */
  effectScale = 1;

  setCalm(calm: boolean, flash: number, shake: number): void {
    this.flash.intensity = calm ? SAFETY.calmFlashIntensity : flash;
    this.shake.intensity = calm ? SAFETY.calmShakeIntensity : shake;
    this.pulseAmp = calm ? 0.35 : 1;
  }

  setField(data: Uint8Array): void {
    this.particles?.setField(data);
  }

  /** "Become light" (showpiece #1): particles gather into the hands. */
  transform(): void {
    this.reveal = 0;
    this.revealTarget = 1;
  }

  /** Freeze visuals (slow motion) for `ms` — cinematic beats. Game time keeps running. */
  holdTime(now: number, ms: number): void {
    if (this.fxEnabled) this.hitStopUntil = Math.max(this.hitStopUntil, now + ms * Math.max(0.3, this.shake.intensity + 0.4));
  }

  /** Hit = 1) hit stop 2) radiate 3) linger (docs/art-direction.md). */
  /** Zoom punch (0..1): the camera jolts in and eases back — big hits feel heavy. */
  private punchV = 0;
  /** Lens aberration kick (0..1). */
  private aberr = 0;
  /** World time in seconds (same clock as the particle compute). */
  private tSec = 0;

  punch(amount: number, aberration = amount): void {
    if (!this.fxEnabled) return;
    this.punchV = Math.min(1, this.punchV + amount * Math.max(0.2, this.shake.intensity + 0.3) * this.effectScale);
    this.aberr = Math.min(1, this.aberr + aberration);
  }

  /** A shockwave through the whole particle field (view coords). */
  shockwave(view: Vec2, strength: number): void {
    const w = this.gfx.layout.viewToWorld(view);
    this.particles?.shock(w.x, w.y, strength, this.tSec);
  }

  burst(view: Vec2, rgb: RGB, strength: number, now: number, seed = 0): void {
    const w = this.gfx.layout.viewToWorld(view);
    this.particles?.shock(w.x, w.y, Math.min(1, 0.3 + strength), this.tSec);
    this.punch(strength * 0.5, strength * 0.6);
    if (this.fxEnabled) this.hitStopUntil = now + SAFETY.hitStopMs * strength * Math.max(0.3, this.shake.intensity + 0.4);
    this.sparks.burst(w.x, w.y, Math.round(18 + 46 * strength), 0.35 + 0.6 * strength, rgb, 0.6 + 0.4 * strength, 0.011 + 0.006 * strength, seed);
    this.effects.push({ kind: 'ring', x: w.x, y: w.y, t0: now, dur: 380 + 320 * strength, rgb: strength > 0.7 ? C.white : rgb, size: 0.15 + 0.6 * strength });
    if (this.fxEnabled) {
      this.rippleT0 = now;
      this.bg.uRippleCenter.value.set(w.x, w.y);
      if (strength > 0.7) this.flash.request(now, 0.4 * strength);
      this.shake.kick(0.15 + 0.4 * strength);
    }
  }

  fizzle(view: Vec2, now: number): void {
    const w = this.gfx.layout.viewToWorld(view);
    this.effects.push({ kind: 'fall', x: w.x, y: w.y, t0: now, dur: 700, rgb: C.dim, size: 0.05 });
  }

  /** Visual response to raw gesture events (casts flare at the hand). */
  onGestureEvents(events: GestureEvent[], g: GestureFrame | null, now: number): void {
    for (const e of events) {
      if (e.type !== 'cast' || !g) continue;
      const h = g.hands.find((x) => x.slot === e.hand);
      if (!h) continue;
      const at = e.release === 'sigil' && h.stroke.length ? h.stroke[h.stroke.length - 1]! : h.palm;
      this.burst(at, shapeColor(e.shape), e.release === 'hold' ? 0.35 : 0.6, now, e.t);
    }
  }

  update(f: WorldFrame): void {
    const L = this.gfx.layout;
    const now = f.now;
    if (this.time0 === 0) this.time0 = now;
    const t = (now - this.time0) / 1000;
    this.tSec = t;
    const visDt = now < this.hitStopUntil ? f.dt * 0.08 : f.dt;

    this.bg.fit(L.sa);
    this.bg.uTime.value = t;
    const beatPhase = f.beatMs > 0 ? ((((f.beatT % f.beatMs) + f.beatMs) % f.beatMs) / f.beatMs) : 0;
    this.bg.uBeat.value = beatPhase;
    this.bg.uPulseAmp.value = this.pulseAmp * (f.energy > 0.5 ? 1 : 0.4);
    this.bg.uIntensity.value = 0.5 + f.energy * 0.7;
    this.bg.uFlash.value = this.flash.value(now);
    this.bg.uRipple.value = clamp((now - this.rippleT0) / 900, 0, 1);
    this.bg.uWarm.value += ((f.energy >= 1 ? 0.35 : 0) - this.bg.uWarm.value) * Math.min(1, f.dt * 2);
    // Stage themes cross-fade (≈1.5 s).
    const tw = Math.min(1, f.dt * 1.4);
    const B = this.bg;
    const target = (k: WorldView['theme']) => (this.theme === k ? 1 : 0);
    B.uLake.value += (target('lake') - B.uLake.value) * tw;
    B.uStars.value += (target('stars') - B.uStars.value) * tw;
    B.uCrystal.value += (target('crystal') - B.uCrystal.value) * tw;
    B.uEclipse.value += (target('eclipse') - B.uEclipse.value) * tw;
    B.uStorm.value += (target('storm') - B.uStorm.value) * tw;
    B.uEmber.value += (target('ember') - B.uEmber.value) * tw;
    B.uSea.value += (target('sea') - B.uSea.value) * tw;
    B.uSnow.value += (target('snow') - B.uSnow.value) * tw;
    B.uThunder.value += (target('thunder') - B.uThunder.value) * tw;
    B.uPetal.value += (target('petal') - B.uPetal.value) * tw;
    B.syncLayers();
    B.uWarp.value += ((f.energy > 0.5 ? 1.6 : 0.8) - B.uWarp.value) * tw;

    const sh = this.fxEnabled ? this.shake.offset(now) : { x: 0, y: 0 };
    this.gfx.camera.position.set(sh.x, sh.y, 5);
    // Zoom punch & lens aberration decay.
    this.punchV *= Math.exp(-f.dt * 7);
    this.aberr *= Math.exp(-f.dt * 5);
    this.gfx.camera.zoom = 1 + this.punchV * 0.07;
    this.gfx.camera.updateProjectionMatrix();
    this.gfx.uAberration.value = (0.12 + this.aberr * 1.6) * this.effectScale;
    this.gfx.uVignette.value = 0.45 + this.bg.uDim.value * 0.4;
    // Charging hands stir a vortex in the particle field.
    if (this.particles) {
      for (let i = 0; i < 2; i++) {
        const h = f.gesture?.hands[i];
        if (h && h.stance && h.state === 'stance') {
          const w = L.viewToWorld(h.palm);
          this.particles.setVortex(i, w.x, w.y, 0.4 + 0.9 * h.charge, L.len(h.size * 3.2));
        } else this.particles.setVortex(i, 0, 0, 0, 0.1);
      }
    }

    const hands = f.gesture?.hands ?? [];
    const present = hands.length > 0 || (f.ghost?.length ?? 0) > 0;
    if (present && this.revealTarget === 0) this.transform();
    if (!present) this.revealTarget = 0;
    this.reveal += (this.revealTarget - this.reveal) * Math.min(1, f.dt * (this.revealTarget > this.reveal ? 2.2 : 0.8));

    if (this.particles) {
      const P = this.particles;
      P.sprite.visible = f.particles;
      P.uSa.value = L.sa;
      P.uCa.value = L.ca;
      P.uK.value = L.k;
      P.uPresent.value = present ? 1 : 0;
      P.uReveal.value = ease.outCubic(this.reveal);
      P.uWarm.value = this.bg.uWarm.value;
      P.uFlowOn.value = 0;
      const src: Landmark[][] = hands.length ? hands.map((h) => this.predictor.predict(h, now).lm) : (f.ghost ?? []).map((g) => buildHand(g));
      if (src.length) {
        const kps: Vec2[] = [];
        for (let i = 0; i < KEYPOINTS.length; i++) kps.push(L.viewToWorld(src[i % src.length]![KEYPOINTS[i]!]!));
        P.setKeypoints(kps);
      }
      if (f.particles) P.update(this.gfx.renderer, visDt, t);
    }

    const g = this.glyphs;
    g.uTime.value = t;
    g.begin();
    const k = 1 - (f.dim ?? 0);
    if (f.ghost) for (const gh of f.ghost) this.drawSkeleton(buildHand(gh), C.ghost, 0.55 * (0.75 + 0.25 * Math.sin(now / 300)), 0.007);
    const seen = new Set<number>();
    for (const h of hands) {
      seen.add(h.slot);
      this.drawHand(h, f, now, k);
    }
    for (const slot of [...this.trails.keys()]) if (!seen.has(slot)) this.trails.delete(slot);
    if (f.calib) this.drawCalib(f.calib, hands[0]?.palm ?? { x: 0.5, y: 0.55 }, hands[0]?.size ?? 0.15);
    f.overlay?.(g);
    this.sparks.update(visDt);
    this.sparks.draw(g);
    this.drawEffects(now);
    g.end();
  }

  private drawSkeleton(lm: Landmark[], rgb: RGB, intensity: number, width: number): void {
    const L = this.gfx.layout;
    for (const [a, b] of HAND_BONES) {
      const p = L.viewToWorld(lm[a]!);
      const q = L.viewToWorld(lm[b]!);
      this.glyphs.line(p.x, p.y, q.x, q.y, width * L.k, rgb, intensity);
    }
  }

  private drawHand(h: GestureHand, f: WorldFrame, now: number, k: number): void {
    const L = this.gfx.layout;
    const g = this.glyphs;
    const stanceRgb = h.stance ? shapeColor(h.stance) : C.cyan;
    const lineI = (f.particles ? 0.3 + (1 - this.reveal) * 0.6 : 0.9) * k;
    // Drawn where the hand is *now* (extrapolated), not where it was when captured.
    const ph = this.predictor.predict(h, now);
    this.drawSkeleton(ph.lm, h.stance ? stanceRgb : C.cyan, lineI, 0.0045);

    // Fingertip light trail.
    const tip = L.viewToWorld(ph.tip);
    let tr = this.trails.get(h.slot);
    if (!tr) this.trails.set(h.slot, (tr = []));
    tr.push(tip);
    if (tr.length > TRAIL) tr.shift();
    for (let i = 1; i < tr.length; i++) {
      const a = tr[i - 1]!;
      const b = tr[i]!;
      const u = i / tr.length;
      g.line(a.x, a.y, b.x, b.y, 0.006 * u * L.k, C.cyan, 0.9 * u * k);
    }
    const r = 0.03 * L.k;
    g.add(Shape.Disk, tip.x, tip.y, r, r, 0, C.white, 1.1 * k);

    // Sigil stroke being drawn.
    if (h.stroke.length > 1) {
      for (let i = 1; i < h.stroke.length; i++) {
        const a = L.viewToWorld(h.stroke[i - 1]!);
        const b = L.viewToWorld(h.stroke[i]!);
        g.line(a.x, a.y, b.x, b.y, 0.007 * L.k, C.amber, 1.2 * k);
      }
    }

    // Stance: charge ring around the palm + the recognised shape icon above the hand.
    const palm = L.viewToWorld(ph.palm);
    const pr = h.size * L.k * 1.25;
    if (h.stance) {
      // Charge: the ring contracts onto the palm as the stance charges.
      const ch = ease.outCubic(h.charge);
      const rr = pr * (1.7 - 0.6 * ch);
      g.add(Shape.Ring, palm.x, palm.y, rr, rr, 0, stanceRgb, (0.25 + 0.5 * ch) * k * (h.state === 'spent' ? 0.4 : 1), 0.94, 45);
      if (f.icons) this.drawIcon(h.stance, { x: h.palm.x, y: h.palm.y - h.size * 2.6 }, h.size * 0.55, stanceRgb, 1.1 * k);
    } else if (f.icons && h.decision.best && h.decision.bestConf > 0.4) {
      // "Almost there": a faint, flickering icon of the nearest shape.
      const a = (h.decision.bestConf - 0.4) / 0.3;
      this.drawIcon(h.decision.best, { x: h.palm.x, y: h.palm.y - h.size * 2.6 }, h.size * 0.55, C.ghost, a * (0.6 + 0.4 * Math.sin(now / 90)) * k);
    }
  }

  /** Small glowing skeleton of a shape (icon), centred at `at` (view), size in view-height units. */
  drawIcon(shape: ShapeId, at: Vec2, size: number, rgb: RGB, intensity: number): void {
    if (intensity <= 0.01) return;
    let lm = this.icons.get(shape);
    if (!lm) {
      lm = buildHand(withShape({ ...defaultHand('R'), wrist: { x: 0, y: 0 }, size: 1 }, shape));
      this.icons.set(shape, lm);
    }
    const L = this.gfx.layout;
    const pts = lm.map((p) => L.viewToWorld({ x: at.x + p.x * size * 0.9, y: at.y + (p.y + 1.1) * size * 0.9 }));
    for (const [a, b] of HAND_BONES) this.glyphs.line(pts[a]!.x, pts[a]!.y, pts[b]!.x, pts[b]!.y, 0.004 * L.k, rgb, intensity);
    const c = L.viewToWorld({ x: at.x, y: at.y });
    const rr = size * 1.9 * L.k;
    this.glyphs.add(Shape.Ring, c.x, c.y, rr, rr, 0, rgb, intensity * 0.5, 0.95, 40);
  }

  private drawCalib(c: CalibVisual, centre: Vec2, size: number): void {
    const L = this.gfx.layout;
    const g = this.glyphs;
    const ch = L.viewToWorld(centre);
    const unit = size * 1.8 * L.k;
    for (const p of c.pulses) {
      const u = (c.now - (p - c.intervalMs)) / c.intervalMs;
      if (u < 0 || u > 1.25) continue;
      const kk = ease.inCubic(clamp(u, 0, 1));
      const spread = (1 - kk) * unit * 2.4;
      const a = u <= 1 ? 1 : clamp(1 - (u - 1) * 4, 0, 1);
      g.add(Shape.Disk, ch.x - spread, ch.y, unit * 0.5, unit * 0.5, 0, C.cyan, 1.1 * a);
      g.add(Shape.Disk, ch.x + spread, ch.y, unit * 0.5, unit * 0.5, 0, C.magenta, 1.1 * a);
      if (u > 0.98 && u < 1.25) {
        const rr = unit * (1 + (u - 1) * 8);
        g.add(Shape.Ring, ch.x, ch.y, rr, rr, 0, C.amber, a * 1.5, 0.85, 25);
      }
    }
    if (c.lastEvent !== null && c.now - c.lastEvent < 400) {
      const k = (c.now - c.lastEvent) / 400;
      const rr = unit * (0.6 + k * 1.6);
      g.add(Shape.Ring, ch.x, ch.y, rr, rr, 0, C.white, (1 - k) * 1.4, 0.85, 30);
    }
  }

  private drawEffects(now: number): void {
    const g = this.glyphs;
    this.effects = this.effects.filter((e) => now - e.t0 < e.dur);
    for (const e of this.effects) {
      const k = (now - e.t0) / e.dur;
      if (e.kind === 'ring') {
        const r = e.size * ease.outExpo(k);
        g.add(Shape.Ring, e.x, e.y, r * 2, r * 2, 0, e.rgb, (1 - k) * 1.6, 0.9, 25);
      } else {
        g.add(Shape.Disk, e.x, e.y - k * 0.08, e.size * (1 - k * 0.5), e.size * (1 - k * 0.5), 0, e.rgb, (1 - k) * 0.6);
      }
    }
  }

  reset(): void {
    this.effects = [];
    this.sparks.clear();
    this.trails.clear();
  }
}
