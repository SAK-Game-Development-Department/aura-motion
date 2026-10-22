// App: exhibition state machine and frame loop (hand / gesture edition).
//
//   loading → title (ghost-hand attract when empty / hand placement guide)
//   → calibrate (open & fist → personal thresholds; fist on the beat → latency)
//   → practice (P1: free play with live recognition)  … → title
//
// Handles camera errors (→ mouse emergency mode), tracking stalls (→ restart),
// exceptions (→ soft reset), empty booth (→ title) and a stalled loop (→ reload).
import { EXHIBIT, GESTURE, JUDGE, LATENCY, RENDER, TRACKING } from './config';
import type { Runtime } from './config/runtime';
import { Ring } from './core/math';
import type { FieldFrame, PoseFrame } from './core/types';
import { DebugOverlay, type DebugStats } from './debug/overlay';
import { Broadcaster } from './exhibit/broadcast';
import { HighScores } from './exhibit/highscores';
import { PresenceTracker, judgePlacement, type Placement } from './exhibit/presence';
import { Watchdog, canReload } from './exhibit/watchdog';
import { LatencyCalibrator } from './game/calibration';
import { GestureCalibrator } from './gesture/calibrate';
import { GestureEngine, type GestureEvent, type GestureFrame } from './gesture/engine';
import { CORE_SHAPES, SHAPE_IDS, SHAPE_LABEL, defaultHand, withShape, relaxedHand, type SynthHand } from './gesture/handModel';
import { MOTION_LABEL } from './gesture/motion';
import { HandSynthSource, perform, showcase, type HandScript } from './gesture/performer';
import { SIGIL_LABEL } from './gesture/sigil';
import { CameraSource } from './input/camera';
import { MouseSource } from './input/mouse';
import { ReplaySource, parseRecording } from './input/replay';
import type { InputSource } from './input/source';
import { FieldBuilder, HAND_SPLATS } from './input/tracking/field';
import { Gfx } from './render/gfx';
import { QualityGovernor } from './render/quality';
import { WorldView } from './render/world';
import { Hud } from './ui/hud';

type Phase = 'loading' | 'title' | 'calibrate' | 'practice' | 'error';
type CalibStep = 'open' | 'fist' | 'beat';

export class App {
  private gfx!: Gfx;
  private world!: WorldView;
  private hud!: Hud;
  private debug!: DebugOverlay;
  private source: InputSource | null = null;
  private sourceOff: Array<() => void> = [];
  readonly engine: GestureEngine;
  private gframe: GestureFrame | null = null;
  private pendingEvents: GestureEvent[] = [];
  private fieldBuilder = new FieldBuilder(TRACKING.fieldW, TRACKING.fieldH);
  private phase: Phase = 'loading';
  private phaseAt = 0;
  private presence: PresenceTracker;
  private calibStep: CalibStep = 'open';
  private calibStepAt = 0;
  private shapeCal = new GestureCalibrator();
  private latCal: LatencyCalibrator | null = null;
  private offsetMs: number = LATENCY.defaultOffsetMs;
  private calibrated = false;
  private thresholdsCalibrated = false;
  private quality!: QualityGovernor;
  private watchdog = new Watchdog();
  private scores = new HighScores();
  private calm: boolean;
  private lastFrameAt = 0;
  private lastLoopAt = 0;
  private fpsN = 0;
  private fpsT = 0;
  private fps = 0;
  private breakdown: Record<string, number> = {};
  private lat = { pipeline: 0, display: 0, pendingReceipt: 0 };
  private stability = new Ring<{ score: number; luma: number }>(90);
  private unstable = false;
  private latestLuma = 0.4;
  private lastWatchdogAt = 0;
  private swWaiting: ServiceWorker | null = null;
  private placement: Placement = 'none';
  private lastFieldAt = 0;
  private emergency = false;
  private vt = 0;
  private audience = new Broadcaster();
  private demo: { source: HandSynthSource; engine: GestureEngine; frame: GestureFrame | null; field: FieldBuilder } | null = null;
  private lastCast: { label: string; at: number } | null = null;
  private castCount = 0;
  private bench: { level: number; t0: number; samples: number[]; results: Array<Record<string, number | string>> } | null = null;
  private clock = (): number => (this.rt.virtualTime ? this.vt : performance.now());

  constructor(
    private canvas: HTMLCanvasElement,
    private rt: Runtime,
  ) {
    this.presence = new PresenceTracker(rt.absentReturnMs, rt.startHoldMs);
    this.calm = rt.calm;
    this.engine = new GestureEngine(this.engineOptions(false));
  }

  private engineOptions(degraded: boolean) {
    const f = this.rt.flags;
    return {
      shapes: degraded || !f.shapes8 ? CORE_SHAPES : SHAPE_IDS,
      motions: f.motions,
      sigils: f.sigils,
      twoHand: f.twoHand && !this.rt.oneHand,
    };
  }

  // ───────────────────────── boot ─────────────────────────

  async start(): Promise<void> {
    this.hud = new Hud(document.body);
    this.hud.show('loading');
    this.hud.setLoading(0.02, 'がめんを じゅんびちゅう…');
    this.debug = new DebugOverlay(document.body);
    if (this.rt.debug) this.debug.toggle(true);

    this.gfx = await Gfx.create(this.canvas, { forceWebGL: this.rt.forceWebGL });
    this.quality = new QualityGovernor({ webgl: this.gfx.backend === 'webgl2', startLevel: this.rt.quality ?? RENDER.startLevel });
    const maxParticles = this.rt.flags.particles ? RENDER.particleLevels[this.quality.maxParticleLevel]! : 0;
    this.world = new WorldView(this.gfx, maxParticles, TRACKING.fieldW, TRACKING.fieldH);
    this.world.fxEnabled = this.rt.flags.fx;
    this.applyCalm();
    this.world.particles?.setCount(this.rt.particles ?? this.quality.particles);

    window.addEventListener('resize', () => this.gfx.resize());
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('error', () => this.watchdog.recordError(this.clock()));
    window.addEventListener('unhandledrejection', () => this.watchdog.recordError(this.clock()));
    document.addEventListener('visibilitychange', () => (this.lastLoopAt = performance.now()));
    this.registerServiceWorker();

    this.lastLoopAt = performance.now();
    requestAnimationFrame(this.loop);
    setInterval(() => this.checkStall(), 1000);
    await this.startSource(this.rt.source);
  }

  private async startSource(kind: Runtime['source']): Promise<void> {
    this.stopSource();
    this.setPhase('loading');
    let src: InputSource;
    try {
      if (kind === 'camera') {
        src = new CameraSource({
          segmentation: this.rt.flags.segmentation,
          preferWorker: this.rt.flags.worker,
          onProgress: (stage, loaded, total) => {
            const order = ['wasm', 'hand', 'segmenter', 'init'];
            const i = Math.max(0, order.indexOf(stage));
            const frac = (i + (total ? loaded / total : 0)) / order.length;
            this.hud.setLoading(0.05 + frac * 0.95, stage === 'init' ? 'てを みつける じゅんび…' : `よみこみちゅう ${total ? Math.round((loaded / total) * 100) : 0}%`);
          },
        });
        this.hud.setLoading(0.04, 'カメラを じゅんびちゅう…');
      } else if (kind === 'mouse') {
        src = new MouseSource((x, y) => this.gfx.layout.screenToView(x, y));
        document.body.classList.add('cursor');
      } else if (kind === 'replay') {
        if (!this.rt.replayUrl) throw new Error('replay needs ?replay=<url>');
        const url = new URL(this.rt.replayUrl, document.baseURI);
        if (url.origin !== location.origin) throw new Error('replay must be same-origin');
        src = new ReplaySource(parseRecording(await (await fetch(url)).text()), true);
      } else if (kind === 'empty') {
        src = new HandSynthSource(() => []);
      } else {
        // synth / autoplay: a scripted visitor (the bot follows the phases).
        src = new HandSynthSource((t) => [relaxedHand({ ...defaultHand('R'), wrist: { x: 0.6 + Math.sin(t / 900) * 0.01, y: 0.7 } }, 0.15)]);
      }
      this.source = src;
      this.sourceOff.push(src.frames.on((f) => this.onFrame(f)));
      this.sourceOff.push(src.fields.on((f) => this.onField(f)));
      await src.start();
      this.emergency = kind === 'mouse';
      this.setPhase('title');
    } catch (e) {
      console.error('[aura] source failed', e);
      this.showSourceError(kind, e);
    }
  }

  private stopSource(): void {
    for (const off of this.sourceOff) off();
    this.sourceOff = [];
    this.source?.stop();
    this.source = null;
    document.body.classList.remove('cursor');
    this.engine.reset();
    this.fieldBuilder.reset();
    this.gframe = null;
  }

  private showSourceError(kind: Runtime['source'], e: unknown): void {
    this.setPhase('error');
    const cam = this.source instanceof CameraSource ? this.source : null;
    const code = cam?.error ?? (kind === 'camera' ? 'unknown' : 'source');
    const msg: Record<string, string> = {
      denied: 'カメラの使用が許可されていません。',
      notfound: 'カメラが見つかりません。',
      inuse: 'カメラがほかのアプリで使われています。',
      unsupported: 'このブラウザではカメラが使えません。',
      tracking: '手の認識の初期化に失敗しました。',
    };
    this.hud.setError(
      'カメラが つかえません',
      [msg[code] ?? 'カメラを開始できませんでした。', '5秒後に <code>マウス</code> であそべる緊急モードに切り替えます。'],
      `staff: ${String((e as Error)?.message ?? e)} — 復旧: カメラを接続しなおして R キー（再試行）。docs/operations.md 参照`,
    );
    if (kind === 'camera') setTimeout(() => this.phase === 'error' && void this.startSource('mouse'), 5000);
  }

  // ───────────────────────── input ─────────────────────────

  private onFrame(f: PoseFrame): void {
    const now = this.rt.virtualTime ? this.clock() : performance.now();
    if (f.luma !== undefined) this.latestLuma = f.luma;
    this.lat.pipeline = (f.timing ? f.timing.inferEnd : now) - f.t;
    this.lat.pendingReceipt = now;
    this.engine.tracker.predictMs = LATENCY.predictFraction * (this.lat.pipeline + this.lat.display);
    const g = this.engine.update(f);
    this.gframe = g;
    this.pendingEvents.push(...g.events);
    if (g.frame.present) this.stability.push({ score: g.frame.score, luma: this.latestLuma });
    this.onGestureFrame(g);
    // Sources without a tracker-side field: build the hand field here.
    if (!(this.source instanceof CameraSource) && this.world.particles && now - this.lastFieldAt > 30) {
      this.lastFieldAt = now;
      const lms = g.hands.map((h) => h.lm);
      const data = this.fieldBuilder.build(this.fieldBuilder.maskFromHands(lms), lms.length ? lms.flat() : null, f.t, HAND_SPLATS);
      this.world.setField(data);
      this.debug.setField(data, TRACKING.fieldW, TRACKING.fieldH);
    }
  }

  /** Per-tracking-frame logic (calibration sampling etc.). */
  private onGestureFrame(g: GestureFrame): void {
    if (this.phase !== 'calibrate') return;
    const h = g.hands[0];
    if (this.calibStep === 'open' || this.calibStep === 'fist') {
      // Sample after the first 600 ms of each step (time to form the shape).
      if (h && g.t - this.calibStepAt > 600) this.shapeCal.add(this.calibStep, h.feat);
    } else if (this.calibStep === 'beat' && this.latCal) {
      for (const e of g.events) if (e.type === 'stance' && e.shape === 'fist') this.latCal.addEvent(e.t);
    }
  }

  private onField(f: FieldFrame): void {
    this.world.setField(f.data);
    this.debug.setField(f.data, f.w, f.h);
  }

  private onKey(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    if (this.source?.kind === 'mouse' && /^[0-9]$|^arrow|^[+=\-gz ]$/.test(k)) return; // mouse-mode controls
    if (k === 'd') this.debug.toggle();
    else if (k === 'f') {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.();
    } else if (k === 'k') {
      this.calm = !this.calm;
      this.applyCalm();
    } else if (k === 'm' && !e.repeat) void this.startSource(this.source?.kind === 'mouse' ? 'camera' : 'mouse');
    else if (k === 'r' && !e.repeat) {
      if (this.phase === 'error') void this.startSource(this.rt.source);
      else this.softReset('staff');
    } else if (k === 'a' && !e.repeat) window.open('./audience', 'aura-audience', 'popup');
  }

  private applyCalm(): void {
    this.world.setCalm(this.calm, 0.8, 0.6);
    document.body.classList.toggle('calm', this.calm);
  }

  // ───────────────────────── phases ─────────────────────────

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseAt = this.clock();
    this.hud.show(p === 'practice' ? 'play' : p);
    if (p !== 'title') this.stopDemo();
    if (p === 'title') {
      this.presence.reset();
      this.maybeActivateUpdate();
    }
    this.botScript();
  }

  private startCalibration(now: number): void {
    this.world.transform();
    if (this.calibrated) {
      this.startPractice();
      return;
    }
    this.shapeCal = new GestureCalibrator();
    this.setPhase('calibrate');
    this.setCalibStep('open', now);
  }

  private setCalibStep(step: CalibStep, now: number): void {
    this.calibStep = step;
    this.calibStepAt = now;
    if (step === 'beat') this.latCal = new LatencyCalibrator(now, this.rt.calibPulses, this.rt.calibIntervalMs);
    const text = step === 'open' ? 'てを おおきく ひらいて' : step === 'fist' ? 'ぎゅっと にぎって' : 'ひかりが あわさったら にぎって';
    this.hud.setCalib(step === 'beat' ? this.rt.calibPulses : 0, 0, text);
    this.botScript();
  }

  private finishCalibration(): void {
    const sc = this.shapeCal.result();
    if (sc.ok) {
      this.engine.thresholds = sc.thresholds;
      this.thresholdsCalibrated = true;
    }
    const r = this.latCal?.result();
    if (r) {
      this.offsetMs = r.offsetMs;
      this.calibrated = r.accepted;
    }
    console.info('[aura] calibration', { shapes: sc.ok, latency: r });
    this.latCal = null;
  }

  private startPractice(): void {
    this.castCount = 0;
    this.setPhase('practice');
    this.hud.setSections([]);
    this.hud.setScoreVisible(false);
  }

  private softReset(reason: string): void {
    console.warn('[aura] soft reset:', reason);
    this.latCal = null;
    this.world.reset();
    this.engine.reset();
    this.gframe = null;
    if (this.source) this.setPhase('title');
  }

  // ───────────────────────── loop ─────────────────────────

  private loop = (realNow: number): void => {
    requestAnimationFrame(this.loop);
    if (this.rt.virtualTime) this.vt += 1000 / 60;
    const now = this.rt.virtualTime ? this.vt : realNow;
    const dtMs = this.lastFrameAt ? now - this.lastFrameAt : 16.7;
    this.lastFrameAt = now;
    this.lastLoopAt = performance.now();
    try {
      this.frame(now, dtMs);
    } catch (e) {
      console.error('[aura] frame error', e);
      this.watchdog.recordError(now);
    }
  };

  private frame(now: number, dtMs: number): void {
    const t0 = performance.now();
    const dt = Math.min(dtMs, 100) / 1000;
    this.fpsN++;
    if (now - this.fpsT > 1000) {
      this.fps = (this.fpsN * 1000) / (now - this.fpsT);
      this.fpsN = 0;
      this.fpsT = now;
    }
    this.debug.pushFrame(dtMs);
    if (this.rt.bench) this.runBench(now, dtMs);
    else if (this.phase !== 'loading' && !this.rt.virtualTime && this.quality.sample(now, dtMs)) {
      this.world.particles?.setCount(this.rt.particles ?? this.quality.particles);
      this.gfx.setResolutionScale(this.quality.resolutionScale);
      this.gfx.setEffects(this.quality.state.effects && this.rt.flags.fx);
    }

    this.source?.tick(now);
    if (this.lat.pendingReceipt) {
      this.lat.display = now - this.lat.pendingReceipt + dtMs * 0.5;
      this.lat.pendingReceipt = 0;
    }
    const t1 = performance.now();
    this.updateStability();
    const events = this.pendingEvents;
    this.pendingEvents = [];
    const g = this.gframe;
    const present = !!g?.frame.present;

    let showFrame: GestureFrame | null = g;
    let ghost: SynthHand[] | null = null;
    switch (this.phase) {
      case 'title': {
        this.placement = judgePlacement(g?.frame ?? null);
        this.presence.update(now, present, this.placement);
        if (g?.frame.newVisitor) {
          this.calibrated = false;
          this.thresholdsCalibrated = false;
        }
        const attract = this.presence.absentFor(now) > this.rt.attractDelayMs && !this.emergency;
        if (attract) {
          this.runDemo(now);
          showFrame = this.demo?.frame ?? null;
        } else if (this.demo) {
          this.stopDemo();
          this.world.transform();
        }
        this.hud.setTitle({ attract, placement: attract ? 'none' : this.placement, progress: this.presence.startProgress(now) });
        if (!attract && this.presence.ready(now)) this.startCalibration(now);
        break;
      }
      case 'calibrate': {
        const el = now - this.calibStepAt;
        if (this.calibStep === 'open') {
          ghost = [withShape({ ...defaultHand('L'), wrist: { x: 0.3, y: 0.62 }, size: 0.13 }, 'open')];
          if (el > 1700) this.setCalibStep('fist', now);
        } else if (this.calibStep === 'fist') {
          ghost = [withShape({ ...defaultHand('L'), wrist: { x: 0.3, y: 0.62 }, size: 0.13 }, 'fist')];
          if (el > 1700) this.setCalibStep('beat', now);
        } else if (this.latCal) {
          this.hud.setCalib(this.latCal.pulses.length, this.latCal.matched());
          if (now > this.latCal.endT + 250) {
            this.finishCalibration();
            this.startPractice();
          }
        }
        this.presence.update(now, present, present ? 'ok' : 'none');
        if (this.presence.absentFor(now) > 3000) this.setPhase('title');
        break;
      }
      case 'practice': {
        for (const e of events) {
          if (e.type !== 'cast') continue;
          this.castCount++;
          const how = e.release === 'hold' ? '' : e.release === 'sigil' ? `＋${SIGIL_LABEL[e.sigil!]}` : e.release === 'twoHand' ? '＋りょうて' : `＋${MOTION_LABEL[e.release]}`;
          this.lastCast = { label: `${SHAPE_LABEL[e.shape]}${how}`, at: now };
          this.hud.announce(this.lastCast.label);
        }
        this.presence.update(now, present, present ? 'ok' : 'none');
        if (this.presence.empty(now)) this.softReset('player left');
        break;
      }
      default:
        break;
    }
    this.hud.setWarning(this.warningText());
    const t2 = performance.now();

    if (events.length) this.world.onGestureEvents(events, g, now);
    this.world.update({
      now,
      dt,
      gesture: showFrame,
      ghost,
      beatMs: 0,
      beatT: now,
      particles: this.rt.flags.particles,
      calib: this.phase === 'calibrate' && this.latCal ? { pulses: this.latCal.pulses, now, intervalMs: this.latCal.intervalMs, lastEvent: this.latCal.lastEvent } : null,
      energy: this.phase === 'practice' ? 0.7 : 0.3,
      icons: this.phase !== 'title' || !!this.demo,
    });
    const t3 = performance.now();
    this.gfx.render();
    const t4 = performance.now();

    this.breakdown = { input: t1 - t0, logic: t2 - t1, world: t3 - t2, submit: t4 - t3 };
    if (this.source instanceof CameraSource) {
      const st = this.source.stats;
      this.breakdown['track.inf'] = st.inferMs;
      this.breakdown['track.seg'] = st.segMs;
      this.breakdown['track.fld'] = st.fieldMs;
    }
    if (this.debug.shown) {
      this.debug.setHand(g?.hands[0] ?? null);
      this.debug.update(now, this.debugStats());
    }
    this.broadcast(now);
    if (now - this.lastWatchdogAt > 1000) {
      this.lastWatchdogAt = now;
      this.runWatchdog(now);
    }
  }

  private updateStability(): void {
    const n = this.stability.length;
    if (n < 15) {
      this.unstable = false;
      return;
    }
    let score = 0;
    let luma = 0;
    for (let i = 0; i < n; i++) {
      score += this.stability.at(i)!.score;
      luma += this.stability.at(i)!.luma;
    }
    score /= n;
    luma /= n;
    const was = this.unstable;
    this.unstable = score < TRACKING.unstableScore || luma < TRACKING.darkLuma;
    // Dark-room fallback: only the three core shapes, wider windows (see JUDGE.unstableWindowScale).
    if (was !== this.unstable) this.engine.opts = { ...this.engine.opts, ...this.engineOptions(this.unstable) };
  }

  private warningText(): string | null {
    if (this.phase !== 'practice' && this.phase !== 'calibrate') return null;
    if ((this.gframe?.frame.ignored ?? 0) > 0) return 'ひとりずつ あそんでね';
    if (this.unstable) return 'くらいので つかう かたちを へらしています';
    return null;
  }

  // ───────────────────────── attract demo ─────────────────────────

  private runDemo(now: number): void {
    if (!this.demo) {
      const source = new HandSynthSource(showcase(now), 30);
      const engine = new GestureEngine({ shapes: SHAPE_IDS, motions: true, sigils: true, twoHand: false });
      const demo = { source, engine, frame: null as GestureFrame | null, field: new FieldBuilder(TRACKING.fieldW, TRACKING.fieldH) };
      source.frames.on((f) => {
        const gf = engine.update(f);
        demo.frame = gf;
        this.world.onGestureEvents(gf.events, gf, now);
        if (this.world.particles) {
          const lms = gf.hands.map((h) => h.lm);
          this.world.setField(demo.field.build(demo.field.maskFromHands(lms), lms.length ? lms.flat() : null, f.t, HAND_SPLATS));
        }
      });
      void source.start();
      this.demo = demo;
      this.world.transform();
    }
    this.demo.source.tick(now);
  }

  private stopDemo(): void {
    if (!this.demo) return;
    this.demo.source.stop();
    this.demo.source.frames.clear();
    this.demo = null;
    this.world.reset();
  }

  // ───────────────────────── autoplay bot (E2E / soak) ─────────────────────────

  private botScript(): void {
    if (this.rt.source !== 'autoplay' || !(this.source instanceof HandSynthSource)) return;
    const bot = this.source;
    const now = this.clock();
    let script: HandScript;
    if (this.phase === 'title') {
      const arrive = now + 800;
      const idle = perform([], 'R');
      script = (t) => (t < arrive ? [] : idle(t));
    } else if (this.phase === 'calibrate' && this.calibStep === 'open') {
      script = perform([{ at: now + 200, shape: 'open', holdMs: 1400 }], 'R');
      const s = script;
      script = (t) => s(t);
    } else if (this.phase === 'calibrate' && this.calibStep === 'fist') {
      script = perform([{ at: now + 100, shape: 'fist', holdMs: 1500 }], 'R');
    } else if (this.phase === 'calibrate' && this.calibStep === 'beat' && this.latCal) {
      // Make a fist exactly on each pulse (stance fires ~2 frames after forming).
      script = perform(this.latCal.pulses.map((p) => ({ at: p - 200, shape: 'fist' as const, holdMs: 250, formMs: 140 })), 'R');
    } else if (this.phase === 'practice') {
      const shows = showcase(now);
      const leaveAt = now + (this.rt.fast ? 9000 : 1e12);
      script = (t) => (t < leaveAt ? shows(t) : []);
    } else return;
    bot.script = script;
  }

  // ───────────────────────── health ─────────────────────────

  private runWatchdog(now: number): void {
    const cam = this.source instanceof CameraSource ? this.source : null;
    const act = this.watchdog.check({
      now,
      lastFrameAt: this.lastLoopAt,
      trackingAge: cam ? cam.resultAge : 0,
      trackingExpected: !!cam && this.phase !== 'loading' && this.phase !== 'error',
      cameraTrackEnded: cam?.trackEnded ?? false,
    });
    if (cam && cam.resultAge < 1000) this.watchdog.noteTrackingHealthy();
    if (act === 'softReset') this.softReset('error storm');
    else if (act === 'restartTracking') void this.startSource('camera');
    else if (act === 'reload') this.reload('watchdog');
  }

  private checkStall(): void {
    if (document.visibilityState === 'visible' && performance.now() - this.lastLoopAt > EXHIBIT.watchdog.rafStallMs) this.reload('main loop stalled');
  }

  private reload(why: string): void {
    console.error('[aura] reload:', why);
    let ss: Storage | null = null;
    try {
      ss = sessionStorage;
    } catch {
      /* blocked */
    }
    if (canReload(Date.now(), ss)) location.reload();
  }

  private registerServiceWorker(): void {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator) || this.rt.fast) return;
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        const track = (w: ServiceWorker | null) =>
          w?.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) this.swWaiting = w;
          });
        if (reg.waiting && navigator.serviceWorker.controller) this.swWaiting = reg.waiting;
        track(reg.installing);
        reg.addEventListener('updatefound', () => track(reg.installing));
        setInterval(() => void reg.update().catch(() => {}), 30 * 60_000);
      })
      .catch((e) => console.warn('[aura] sw registration failed', e));
    navigator.serviceWorker?.addEventListener('controllerchange', () => {
      if (this.phase === 'title') location.reload();
    });
  }

  private maybeActivateUpdate(): void {
    if (this.swWaiting && this.presence.absentFor(this.clock()) > 5000) {
      this.swWaiting.postMessage('SKIP_WAITING');
      this.swWaiting = null;
    }
  }

  private runBench(now: number, dtMs: number): void {
    if (this.phase === 'loading' || !this.world.particles) return;
    const levels = RENDER.particleLevels.slice(0, this.quality.maxParticleLevel + 1);
    if (!this.bench) {
      this.bench = { level: 0, t0: now, samples: [], results: [] };
      this.world.particles.setCount(levels[0]!);
    }
    const b = this.bench;
    if (b.level >= levels.length) return;
    if (now - b.t0 > 1000) b.samples.push(dtMs);
    if (now - b.t0 > 6000) {
      const xs = [...b.samples].sort((x, y) => x - y);
      const avg = xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length);
      const cam = this.source instanceof CameraSource ? this.source : null;
      b.results.push({
        particles: levels[b.level]!,
        backend: this.gfx.backend,
        tracking: cam?.status().backend ?? this.source?.kind ?? 'none',
        trackFps: cam ? Number(cam.stats.fps.toFixed(1)) : 0,
        inferMs: cam ? Number(cam.stats.inferMs.toFixed(2)) : 0,
        frameAvgMs: Number(avg.toFixed(2)),
        frameP95Ms: Number((xs[Math.floor(xs.length * 0.95)] ?? 0).toFixed(2)),
        fps: Number((1000 / avg).toFixed(1)),
      });
      console.table(b.results);
      b.level++;
      b.samples = [];
      b.t0 = now;
      if (b.level < levels.length) this.world.particles.setCount(levels[b.level]!);
      else {
        (window as unknown as { __benchResults: unknown }).__benchResults = b.results;
        const blob = new Blob([JSON.stringify({ ua: navigator.userAgent, results: b.results }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `aura-bench-${Date.now()}.json`;
        a.click();
      }
    }
  }

  private broadcast(now: number): void {
    const cam = this.source instanceof CameraSource ? this.source : null;
    const g = this.phase === 'title' && this.demo ? this.demo.frame : this.gframe;
    this.audience.send(now, {
      phase: this.phase,
      score: 0,
      combo: 0,
      section: this.lastCast && now - this.lastCast.at < 2000 ? this.lastCast.label : null,
      progress: 0,
      present: !!this.gframe?.frame.present,
      lastJudge: null,
      ranking: this.scores.today(),
      stats: {
        fps: this.fps,
        latencyMs: this.lat.pipeline + this.lat.display,
        particles: this.world.particles?.count ?? 0,
        backend: this.gfx.backend,
        tracking: cam?.status().backend ?? this.source?.kind ?? 'none',
        trackFps: cam?.stats.fps ?? 30,
      },
      hands: g ? g.hands.map((h) => h.lm.flatMap((p) => [p.x, p.y])) : null,
    });
  }

  private debugStats(): DebugStats {
    const cam = this.source instanceof CameraSource ? this.source : null;
    const n = this.stability.length;
    const last = n ? this.stability.at(n - 1)! : { score: 0, luma: this.latestLuma };
    return {
      backend: `${this.gfx.backend} ${this.gfx.layout.w}×${this.gfx.layout.h}`,
      tracking: cam?.status().backend ?? this.source?.kind ?? 'none',
      source: this.source?.status().detail ?? 'none',
      fps: this.fps,
      frameMs: this.quality.ema,
      breakdown: this.breakdown,
      latency: { pipeline: this.lat.pipeline, display: this.lat.display, predict: this.engine.tracker.predictMs, calib: this.offsetMs, calibAccepted: this.calibrated },
      particles: this.world.particles?.count ?? 0,
      quality: `P${this.quality.state.particleLevel} R${this.quality.resolutionScale} FX${this.quality.state.effects ? 1 : 0} (changes ${this.quality.changes})`,
      conf: last.score,
      jitter: 0,
      people: this.gframe?.frame.hands.length ?? 0,
      luma: last.luma,
      unstable: this.unstable,
      dda: 1,
      missRate: 0,
      phase: this.phase === 'calibrate' ? `calibrate/${this.calibStep}` : this.phase,
      seed: 0,
      extra: {
        placement: this.placement,
        thresholds: this.thresholdsCalibrated ? 'calibrated' : 'default',
        shapes: this.engine.opts.shapes.length,
        ignoredHands: this.gframe?.frame.ignored ?? 0,
        casts: this.castCount,
        errors: this.watchdog.errorsLastMinute,
        attempts: cam ? cam.attempts.map((a) => `${a.mode}/${a.delegate}:${a.ok ? 'ok' : 'x'}`).join(' ') : '-',
        windowScale: this.unstable ? JUDGE.unstableWindowScale : 1,
        chargeMs: GESTURE.chargeMs,
      },
    };
  }

  /** Test hook (E2E/soak). */
  inspect(): Record<string, unknown> {
    return {
      t: this.clock(),
      phase: this.phase,
      calibStep: this.phase === 'calibrate' ? this.calibStep : null,
      backend: this.gfx?.backend,
      source: this.source?.kind,
      present: !!this.gframe?.frame.present,
      hands: this.gframe?.hands.length ?? 0,
      shape: this.gframe?.hands[0]?.decision.shape ?? null,
      stance: this.gframe?.hands[0]?.stance ?? null,
      casts: this.castCount,
      lastCast: this.lastCast?.label ?? null,
      offsetMs: this.offsetMs,
      calibrated: this.calibrated,
      thresholdsCalibrated: this.thresholdsCalibrated,
      particles: this.world?.particles?.count ?? 0,
      fps: this.fps,
      demo: !!this.demo,
      heap: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
      dom: document.getElementsByTagName('*').length,
      glyphs: this.world?.glyphs.used ?? 0,
      errors: this.watchdog.errorsLastMinute,
      rendererInfo: this.gfx ? { ...this.gfx.renderer.info.memory } : null,
      trackingAttempts: this.source instanceof CameraSource ? this.source.attempts : null,
    };
  }

  /** Test hook (dev/fast only): drive the synthetic visitor. */
  test(cmd: 'leave' | 'return'): void {
    if (!this.rt.dev || !(this.source instanceof HandSynthSource)) return;
    this.source.script = cmd === 'leave' ? () => [] : perform([], 'R');
  }
}
