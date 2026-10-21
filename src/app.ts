// App: exhibition state machine and frame loop.
//
//   loading → title (attract demo when empty / positioning guide) → calibrate
//   → play (90 s) → results → title …
//
// Everything that can fail at a venue is handled here: camera errors (→ mouse
// emergency mode), tracking stalls (→ restart), exceptions (→ soft reset),
// empty booth (→ title after 10 s), and a stalled main loop (→ reload).
import { EXHIBIT, JUDGE, LATENCY, RENDER, TRACKING } from './config';
import type { Runtime } from './config/runtime';
import { Rng, hash32 } from './core/rng';
import { Ring, clamp } from './core/math';
import type { FieldFrame, PoseFrame, Vec2 } from './core/types';
import { DebugOverlay, type DebugStats } from './debug/overlay';
import { HighScores } from './exhibit/highscores';
import { HoldButtons } from './exhibit/holdButton';
import { nickname } from './exhibit/nickname';
import { PresenceTracker, judgePlacement, type Placement } from './exhibit/presence';
import { Watchdog, canReload } from './exhibit/watchdog';
import { LatencyCalibrator } from './game/calibration';
import { multiplier, rankOf } from './game/score';
import { GameSession, type GameEvent } from './game/session';
import { BodyTracker, emptySnapshot, type BodySnapshot } from './input/body';
import { CameraSource } from './input/camera';
import { MouseSource } from './input/mouse';
import { Recorder, ReplaySource, parseRecording } from './input/replay';
import type { InputSource } from './input/source';
import { SynthSource, attractScript, autoplayScript, scripts } from './input/synth';
import { FieldBuilder } from './input/tracking/field';
import { Gfx } from './render/gfx';
import { QualityGovernor } from './render/quality';
import { WorldView } from './render/world';
import { generateValidStage } from './stage/generator';
import type { Stage } from './stage/types';
import { Hud } from './ui/hud';

type Phase = 'loading' | 'title' | 'calibrate' | 'play' | 'results' | 'error';

interface Demo {
  source: SynthSource;
  tracker: BodyTracker;
  session: GameSession;
  stage: Stage;
  start: number;
  body: BodySnapshot | null;
  field: FieldBuilder;
}

export class App {
  private gfx!: Gfx;
  private world!: WorldView;
  private hud!: Hud;
  private debug!: DebugOverlay;
  private source: InputSource | null = null;
  private sourceOff: Array<() => void> = [];
  private tracker = new BodyTracker();
  private fieldBuilder = new FieldBuilder(TRACKING.fieldW, TRACKING.fieldH);
  private body: BodySnapshot | null = null;
  private phase: Phase = 'loading';
  private phaseAt = 0;
  private presence: PresenceTracker;
  private buttons = new HoldButtons();
  private session: GameSession | null = null;
  private stage: Stage | null = null;
  private calib: LatencyCalibrator | null = null;
  private offsetMs: number = LATENCY.defaultOffsetMs;
  private calibrated = false;
  private playStart = 0;
  private sectionIdx = -1;
  private demo: Demo | null = null;
  private quality!: QualityGovernor;
  private watchdog = new Watchdog();
  private scores = new HighScores();
  private forceSeated = false;
  private seatedThisRun = false;
  private requireNewVisitor = false;
  private calm: boolean;
  private lastFrameAt = 0;
  private lastLoopAt = 0;
  private fpsN = 0;
  private fpsT = 0;
  private fps = 0;
  private breakdown: Record<string, number> = {};
  private lat = { pipeline: 0, display: 0, pendingReceipt: 0 };
  private stability = new Ring<{ conf: number; jitter: number; luma: number }>(90);
  private unstable = false;
  private latestLuma = 0.4;
  private people = 0;
  private recorder: Recorder | null = null;
  private seedCounter: number;
  private lastWatchdogAt = 0;
  private swWaiting: ServiceWorker | null = null;
  private placement: Placement = 'none';
  private resultsInfo: { placed: number } | null = null;
  private lastFieldAt = 0;
  private maxParticles = 0;
  private emergency = false;
  private vt = 0;
  /** App clock: real time, or virtual time (?vt=1) advancing 1/60 s per frame. */
  private clock = (): number => (this.rt.virtualTime ? this.vt : performance.now());

  constructor(
    private canvas: HTMLCanvasElement,
    private rt: Runtime,
  ) {
    this.presence = new PresenceTracker(rt.absentReturnMs);
    this.calm = rt.calm;
    this.seedCounter = rt.seed ?? (Date.now() & 0xffffff);
  }

  // ───────────────────────── boot ─────────────────────────

  async start(): Promise<void> {
    this.hud = new Hud(document.body);
    this.hud.show('loading');
    this.hud.setLoading(0.02, 'がめんを じゅんびちゅう…');
    this.debug = new DebugOverlay(document.body);
    if (this.rt.debug) this.debug.toggle(true);

    this.gfx = await Gfx.create(this.canvas, { forceWebGL: this.rt.forceWebGL });
    const webgl = this.gfx.backend === 'webgl2';
    this.quality = new QualityGovernor({ webgl, startLevel: this.rt.quality ?? RENDER.startLevel });
    this.maxParticles = this.rt.flags.particles ? RENDER.particleLevels[this.quality.maxParticleLevel]! : 0;
    this.world = new WorldView(this.gfx, this.maxParticles, TRACKING.fieldW, TRACKING.fieldH);
    this.world.fxEnabled = this.rt.flags.fx;
    this.applyCalm();
    this.world.particles?.setCount(this.rt.particles ?? this.quality.particles);

    window.addEventListener('resize', () => this.gfx.resize());
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('error', () => this.watchdog.recordError(this.clock()));
    window.addEventListener('unhandledrejection', () => this.watchdog.recordError(this.clock()));
    document.addEventListener('visibilitychange', () => {
      this.lastLoopAt = performance.now();
    });
    this.registerServiceWorker();

    this.lastLoopAt = performance.now();
    requestAnimationFrame(this.loop);
    // Main-loop stall detection runs outside rAF.
    setInterval(() => this.checkStall(), 1000);

    await this.startSource(this.rt.source);
  }

  private async startSource(kind: Runtime['source']): Promise<void> {
    this.stopSource();
    this.setPhase('loading');
    let src: InputSource;
    try {
      if (kind === 'camera') {
        const cam = new CameraSource({
          segmentation: this.rt.flags.segmentation,
          preferWorker: this.rt.flags.worker,
          onProgress: (stage, loaded, total) => {
            const order = ['wasm', 'pose', 'segmenter', 'init'];
            const i = Math.max(0, order.indexOf(stage));
            const frac = (i + (total ? loaded / total : 0)) / order.length;
            const label = stage === 'init' ? 'からだを みつける じゅんび…' : `よみこみちゅう ${total ? Math.round((loaded / total) * 100) : 0}%`;
            this.hud.setLoading(0.05 + frac * 0.95, label);
          },
        });
        this.hud.setLoading(0.04, 'カメラを じゅんびちゅう…');
        src = cam;
      } else if (kind === 'mouse') {
        src = new MouseSource((x, y) => this.gfx.layout.screenToView(x, y));
        document.body.classList.add('cursor');
      } else if (kind === 'replay') {
        if (!this.rt.replayUrl) throw new Error('replay needs ?replay=<url>');
        const url = new URL(this.rt.replayUrl, document.baseURI);
        if (url.origin !== location.origin) throw new Error('replay must be same-origin');
        const rec = parseRecording(await (await fetch(url)).text());
        src = new ReplaySource(rec, true);
      } else if (kind === 'autoplay') {
        const bot = new SynthSource(scripts.visit(1e12), 30);
        src = bot;
      } else {
        src = new SynthSource(scripts.idle(), 30);
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
    this.tracker.reset();
    this.fieldBuilder.reset();
    this.body = null;
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
      tracking: '姿勢推定の初期化に失敗しました。',
    };
    this.hud.setError(
      'カメラが つかえません',
      [msg[code] ?? 'カメラを開始できませんでした。', '5秒後に <code>マウス</code> であそべる緊急モードに切り替えます。'],
      `staff: ${String((e as Error)?.message ?? e)} — 復旧: カメラを接続しなおして R キー（再試行）。docs/operations.md 参照`,
    );
    if (kind === 'camera') {
      setTimeout(() => {
        if (this.phase === 'error') void this.startSource('mouse');
      }, 5000);
    }
  }

  // ───────────────────────── input ─────────────────────────

  private onFrame(f: PoseFrame): void {
    const now = this.rt.virtualTime ? this.clock() : performance.now();
    this.people = f.poses.length;
    if (f.luma !== undefined) this.latestLuma = f.luma;
    this.recorder?.push(f);
    const b = this.tracker.update(f);
    this.body = b;
    if (f.timing) {
      this.lat.pipeline = f.timing.inferEnd - f.t;
      this.lat.pendingReceipt = now;
    } else {
      this.lat.pipeline = now - f.t;
      this.lat.pendingReceipt = now;
    }
    // Prediction horizon: compensate part of the measured display latency.
    this.tracker.predictMs = LATENCY.predictFraction * (this.lat.pipeline + this.lat.display);
    if (b.present) this.stability.push({ conf: b.conf, jitter: b.jitter, luma: this.latestLuma });
    if (this.source instanceof CameraSource) this.source.lockHint = b.present ? { x: b.anchor.x, y: b.anchor.y } : null;

    if (this.phase === 'calibrate' && this.calib) this.calib.feed(b);
    if (this.phase === 'play' && this.session) this.session.pushInput(f.t - this.playStart - this.offsetMs, b);

    // Sources without segmentation: build a capsule field from landmarks.
    const camWithField = this.source instanceof CameraSource;
    if (!camWithField && this.world.particles && now - this.lastFieldAt > 30) {
      this.lastFieldAt = now;
      const mask = this.fieldBuilder.maskFromLandmarks(b.present ? b.lm : null);
      const data = this.fieldBuilder.build(mask, b.present ? b.lm : null, f.t);
      this.world.setField(data);
      this.debug.setField(data, TRACKING.fieldW, TRACKING.fieldH);
    }
  }

  private onField(f: FieldFrame): void {
    this.world.setField(f.data);
    this.debug.setField(f.data, f.w, f.h);
  }

  private onKey(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    if (k === 'd') this.debug.toggle();
    else if (k === 'f') {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.();
    } else if (k === 'k') {
      this.calm = !this.calm;
      this.applyCalm();
    } else if (k === 'm' && !e.repeat) {
      void this.startSource(this.source?.kind === 'mouse' ? 'camera' : 'mouse');
    } else if (k === 'r' && !e.repeat) {
      if (this.phase === 'error') void this.startSource(this.rt.source);
      else this.softReset('staff');
    } else if (k === 's' && !e.repeat && this.phase === 'title') {
      this.forceSeated = !this.forceSeated;
    } else if (k === 'p' && this.rt.dev && !e.repeat) {
      this.toggleRecording();
    }
  }

  private toggleRecording(): void {
    if (!this.recorder) {
      this.recorder = new Recorder();
      console.info('[aura] recording landmarks (no images)…');
      return;
    }
    const rec = this.recorder.finish({ createdAt: new Date().toISOString(), source: this.source?.kind });
    this.recorder = null;
    // Saved locally via a Blob download — never sent anywhere.
    const blob = new Blob([JSON.stringify(rec)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `aura-pose-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  private applyCalm(): void {
    this.world.setCalm(this.calm, 0.8, 0.6);
    document.body.classList.toggle('calm', this.calm);
  }

  // ───────────────────────── phases ─────────────────────────

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseAt = this.clock();
    this.hud.show(p);
    if (p !== 'title') this.stopDemo();
    if (p === 'title') {
      this.presence.reset();
      this.buttons.set([]);
      this.hud.setButtons([], 'title');
      this.botScript();
      this.maybeActivateUpdate();
    }
  }

  private nextSeed(): number {
    if (this.rt.seed !== null) return this.rt.seed;
    this.seedCounter = hash32(this.seedCounter + 0x9e37);
    return this.seedCounter;
  }

  private startCalibration(now: number): void {
    this.seatedThisRun = this.forceSeated || !(this.body?.lowerBodyVisible ?? true);
    if (this.calibrated) {
      this.startPlay(now);
      return;
    }
    this.calib = new LatencyCalibrator(now, this.rt.calibPulses, this.rt.calibIntervalMs);
    this.setPhase('calibrate');
    this.hud.setCalib(this.calib.pulses.length, 0, 'ひかりが あわさったら てを たたいて');
    this.world.transform();
    this.botScript();
  }

  private finishCalibration(): void {
    if (!this.calib) return;
    const r = this.calib.result();
    this.offsetMs = r.offsetMs;
    this.calibrated = r.accepted;
    console.info('[aura] calibration', r);
    this.calib = null;
  }

  private startPlay(now: number): void {
    const f = this.rt.flags;
    this.stage = generateValidStage({
      seed: this.nextSeed(),
      seated: this.seatedThisRun,
      flow: f.flow,
      wall: f.wall,
      dodge: f.dodge,
      structure: f.structure,
      durationMs: this.rt.stageMs,
    });
    this.session = new GameSession({ stage: this.stage, dda: f.dda, windowScale: () => (this.unstable ? JUDGE.unstableWindowScale : 1) });
    this.playStart = now;
    this.sectionIdx = -1;
    this.world.reset();
    this.hud.setSections(this.stage.sections.map((s) => s.kind));
    this.setPhase('play');
    this.botScript();
  }

  private endPlay(): void {
    const s = this.session;
    if (!s) return;
    const sc = s.score;
    const nick = nickname(hash32(s.stage.seed ^ sc.score));
    const entry = { score: sc.score, name: nick, rank: rankOf(sc), at: Date.now(), seated: s.stage.seated };
    const todayBest = this.scores.today().reduce((m, e) => Math.max(m, e.score), 0);
    const placed = this.scores.add(entry);
    this.resultsInfo = { placed };
    this.hud.setResults({
      score: sc.score,
      rank: entry.rank,
      maxCombo: sc.maxCombo,
      counts: sc.counts,
      nick,
      placed,
      ranking: this.scores.list(),
      flow: sc.flowCaptured,
      isBest: sc.score > todayBest && sc.score > 0,
    });
    this.setPhase('results');
    this.requireNewVisitor = true;
    this.botScript();
  }

  private softReset(reason: string): void {
    console.warn('[aura] soft reset:', reason);
    this.session = null;
    this.calib = null;
    this.world.reset();
    this.tracker.reset();
    this.body = null;
    this.requireNewVisitor = false;
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
    if (this.phase !== 'loading' && !this.rt.virtualTime && this.quality.sample(now, dtMs)) {
      this.world.particles?.setCount(this.rt.particles ?? this.quality.particles);
      this.gfx.setResolutionScale(this.quality.resolutionScale);
      this.gfx.setEffects(this.quality.state.effects && this.rt.flags.fx);
    }

    // Input.
    this.source?.tick(now);
    if (this.lat.pendingReceipt) {
      this.lat.display = now - this.lat.pendingReceipt + dtMs * 0.5;
      this.lat.pendingReceipt = 0;
    }
    const t1 = performance.now();
    this.updateStability();

    // Phase logic.
    let events: GameEvent[] = [];
    let showBody: BodySnapshot | null = this.body?.present ? this.body : null;
    let showSession: GameSession | null = null;
    let gameT = 0;
    let beatMs = 0;
    const b = this.body;
    switch (this.phase) {
      case 'title': {
        this.presence.update(now, b, this.placement);
        if (b?.newVisitor) {
          this.calibrated = false;
          this.requireNewVisitor = false;
          this.forceSeated = false;
        }
        const absent = this.presence.absentFor(now);
        if (this.requireNewVisitor && absent > 1500) this.requireNewVisitor = false;
        const attract = absent > this.rt.attractDelayMs && !this.emergency;
        if (attract) {
          this.runDemo(now);
          showBody = this.demo?.body ?? null;
          showSession = this.demo?.session ?? null;
          gameT = this.demo ? now - this.demo.start : 0;
          beatMs = this.demo?.stage.beatMs ?? 0;
          if (this.demo) events = this.demo.session.update(gameT);
        } else if (this.demo) {
          this.stopDemo();
          this.world.transform();
        }
        const pi = judgePlacement(b, { forceSeated: this.forceSeated, preferStanding: !this.forceSeated && this.presence.presentFor(now) < this.rt.preferStandingMs });
        this.placement = this.requireNewVisitor ? 'none' : pi.placement;
        const progress = this.presence.startProgress(now);
        this.hud.setTitle({ attract, placement: attract ? 'none' : this.placement, progress, seated: pi.seated });
        this.updateButtons(now, attract ? [] : [{ id: 'seat', label: this.forceSeated ? 'たって<br>あそぶ' : 'すわって<br>あそぶ' }], 'title');
        if (!attract && this.presence.ready(now) && !this.requireNewVisitor) this.startCalibration(now);
        break;
      }
      case 'calibrate': {
        const c = this.calib;
        if (c) {
          this.hud.setCalib(c.pulses.length, c.matched());
          if (now > c.endT + 250) {
            this.finishCalibration();
            this.startPlay(now);
          }
        }
        this.presence.update(now, b, b?.present ? 'ok' : 'none');
        if (this.presence.absentFor(now) > 3000) this.setPhase('title');
        break;
      }
      case 'play': {
        const s = this.session!;
        gameT = now - this.playStart;
        beatMs = s.stage.beatMs;
        events = s.update(gameT);
        showSession = s;
        this.handlePlayEvents(events);
        const sc = s.score;
        this.hud.setPlay(sc.score, sc.combo, multiplier(sc.combo), gameT / s.stage.durationMs);
        this.presence.update(now, b, b?.present ? 'ok' : 'none');
        if (this.presence.empty(now)) this.softReset('player left');
        else if (s.ended) this.endPlay();
        break;
      }
      case 'results': {
        this.presence.update(now, b, b?.present ? 'ok' : 'none');
        this.updateButtons(now, [{ id: 'again', label: 'もう<br>いちど' }], 'results');
        if (now - this.phaseAt > this.rt.resultsMs) this.setPhase('title');
        break;
      }
      default:
        break;
    }
    this.hud.setWarning(this.warningText());
    const t2 = performance.now();

    // Render.
    if (showSession && events.length) this.world.onEvents(events, now, showSession);
    const energy = this.phase === 'play' ? (this.session?.section === 'finale' ? 1 : 0.7) : 0.3;
    this.world.update({
      now,
      dt,
      body: showBody,
      session: showSession,
      gameT,
      beatMs: beatMs || (this.phase === 'title' ? 1200 : 0),
      skeleton: true,
      particles: this.rt.flags.particles,
      calib: this.phase === 'calibrate' && this.calib ? { pulses: this.calib.pulses, now, intervalMs: this.calib.intervalMs, lastClap: this.calib.lastClap } : null,
      energy,
      showGame: this.phase === 'play' || (this.phase === 'title' && !!this.demo),
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
    if (this.debug.shown) this.debug.update(now, this.debugStats());
    if (now - this.lastWatchdogAt > 1000) {
      this.lastWatchdogAt = now;
      this.runWatchdog(now);
    }
  }

  private handlePlayEvents(events: GameEvent[]): void {
    const L = this.gfx.layout;
    for (const e of events) {
      if (e.type === 'judge') {
        const p = L.viewToScreen(e.view);
        this.hud.judge(e.grade, p.x, p.y - L.h * 0.06);
      } else if (e.type === 'section') {
        this.sectionIdx++;
        this.hud.setSection(this.sectionIdx, e.kind, this.sectionIdx > 0 || e.kind !== 'intro');
      }
    }
  }

  private updateButtons(now: number, specs: Array<{ id: string; label: string }>, layer: 'title' | 'results'): void {
    const b = this.body?.present ? this.body : null;
    if (!b || specs.length === 0) {
      if (this.buttons.buttons.length) this.buttons.set([]);
      this.hud.setButtons([], layer);
      return;
    }
    const L = this.gfx.layout;
    // Buttons sit just above shoulder height, an arm's length to the side.
    const a = b.anchor;
    const pos = (side: number): Vec2 => ({ x: clamp(a.x + (side * 2.0 * a.unit) / b.aspect, 0.08, 0.92), y: clamp(a.y - 0.7 * a.unit, 0.12, 0.8) });
    const placed = specs.map((s, i) => ({ id: s.id, label: s.label, pos: pos(specs.length === 1 ? (s.id === 'seat' ? -1 : 1) : i === 0 ? -1 : 1) }));
    const r = Math.max(EXHIBIT.buttonRadius, a.unit * 0.55);
    if (this.buttons.buttons.map((x) => x.id).join() !== placed.map((x) => x.id).join()) this.buttons.set(placed.map((p) => ({ id: p.id, pos: p.pos, r })));
    else this.buttons.buttons = placed.map((p) => ({ id: p.id, pos: p.pos, r }));
    const fired = this.buttons.update(now, [b.handsPred.L, b.handsPred.R], b.aspect);
    this.hud.setButtons(
      placed.map((p) => {
        const s = L.viewToScreen(p.pos);
        return { id: p.id, label: p.label, x: s.x, y: s.y, r: r * L.h * L.k };
      }),
      layer,
    );
    for (const p of placed) this.hud.setButtonProgress(p.id, this.buttons.progressOf(p.id));
    if (fired === 'seat') {
      this.forceSeated = !this.forceSeated;
      this.presence.reset();
    } else if (fired === 'again') {
      this.requireNewVisitor = false;
      this.startPlay(now);
    }
  }

  private updateStability(): void {
    const n = this.stability.length;
    if (n < 15) {
      this.unstable = false;
      return;
    }
    let conf = 0;
    let jit = 0;
    let luma = 0;
    for (let i = 0; i < n; i++) {
      const s = this.stability.at(i)!;
      conf += s.conf;
      jit += s.jitter;
      luma += s.luma;
    }
    conf /= n;
    jit /= n;
    luma /= n;
    this.unstable = conf < TRACKING.unstableVisibility || luma < TRACKING.darkLuma || jit > 0.02;
  }

  private warningText(): string | null {
    if (this.phase !== 'play' && this.phase !== 'calibrate') return null;
    if (this.people > 1) return 'ひとりずつ あそんでね';
    if (this.unstable) return 'くらいので はんていを ひろげています';
    return null;
  }

  // ───────────────────────── attract demo ─────────────────────────

  private runDemo(now: number): void {
    if (this.demo && now - this.demo.start > this.demo.stage.durationMs + 1500) this.stopDemo();
    if (!this.demo) {
      const stage = generateValidStage({ seed: 0xa77ac7 + (Math.floor(now / 1000) % 7), seated: false, flow: false, wall: this.rt.flags.wall, dodge: false, structure: false, durationMs: 30_000 });
      const source = new SynthSource(attractScript(stage), 30);
      const tracker = new BodyTracker();
      const session = new GameSession({ stage, dda: false });
      const demo: Demo = { source, tracker, session, stage, start: now + 1500, body: null, field: new FieldBuilder(TRACKING.fieldW, TRACKING.fieldH) };
      source.frames.on((f) => {
        const b = tracker.update(f);
        demo.body = b;
        session.pushInput(f.t - demo.start, b);
        if (this.world.particles) {
          const m = demo.field.maskFromLandmarks(b.present ? b.lm : null);
          this.world.setField(demo.field.build(m, b.present ? b.lm : null, f.t));
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
    if (this.rt.source !== 'autoplay' || !(this.source instanceof SynthSource)) return;
    const bot = this.source;
    bot.absolute = true;
    const now = this.clock();
    if (this.phase === 'title') {
      // Walk in after a short absence (lets the empty-booth logic run too).
      const arrive = now + (this.requireNewVisitor ? 2500 : 800);
      bot.script = (t) => (t < arrive ? null : scripts.idle()(t));
    } else if (this.phase === 'calibrate' && this.calib) {
      bot.script = scripts.clapper(this.calib.pulses, 0);
    } else if (this.phase === 'play' && this.stage) {
      bot.script = autoplayScript(this.stage, { playStartRel: this.playStart, offsetMs: this.offsetMs, errorMs: 60, missRate: 0.08, seed: this.stage.seed });
    } else if (this.phase === 'results') {
      const leave = now + 1200;
      bot.script = (t) => (t < leave ? scripts.idle()(t) : null);
    }
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
    else if (act === 'restartTracking') {
      console.warn('[aura] restarting tracking');
      void this.startSource('camera');
    } else if (act === 'reload') this.reload('watchdog');
  }

  private checkStall(): void {
    const now = performance.now();
    if (document.visibilityState === 'visible' && now - this.lastLoopAt > EXHIBIT.watchdog.rafStallMs) this.reload('main loop stalled');
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
        const track = (w: ServiceWorker | null) => {
          if (!w) return;
          w.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) this.swWaiting = w;
          });
        };
        if (reg.waiting && navigator.serviceWorker.controller) this.swWaiting = reg.waiting;
        track(reg.installing);
        reg.addEventListener('updatefound', () => track(reg.installing));
        // Check for updates every 30 min while running.
        setInterval(() => void reg.update().catch(() => {}), 30 * 60_000);
      })
      .catch((e) => console.warn('[aura] sw registration failed', e));
    navigator.serviceWorker?.addEventListener('controllerchange', () => {
      if (this.phase === 'title') location.reload();
    });
  }

  /** Activate a waiting SW only while idle at the title (never mid-play). */
  private maybeActivateUpdate(): void {
    if (this.swWaiting && this.presence.absentFor(this.clock()) > 5000) {
      this.swWaiting.postMessage('SKIP_WAITING');
      this.swWaiting = null;
    }
  }

  private debugStats(): DebugStats {
    const cam = this.source instanceof CameraSource ? this.source : null;
    const n = this.stability.length;
    const last = n ? this.stability.at(n - 1)! : { conf: 0, jitter: 0, luma: this.latestLuma };
    const s = this.session;
    return {
      backend: `${this.gfx.backend} ${this.gfx.layout.w}×${this.gfx.layout.h}`,
      tracking: cam?.status().backend ?? this.source?.kind ?? 'none',
      source: this.source?.status().detail ?? 'none',
      fps: this.fps,
      frameMs: this.quality.ema,
      breakdown: this.breakdown,
      latency: { pipeline: this.lat.pipeline, display: this.lat.display, predict: this.tracker.predictMs, calib: this.offsetMs, calibAccepted: this.calibrated },
      particles: this.world.particles?.count ?? 0,
      quality: `P${this.quality.state.particleLevel} R${this.quality.resolutionScale} FX${this.quality.state.effects ? 1 : 0} (changes ${this.quality.changes})`,
      conf: last.conf,
      jitter: last.jitter,
      people: this.people,
      luma: last.luma,
      unstable: this.unstable,
      dda: s?.difficulty.level ?? 1,
      missRate: s?.difficulty.missRate ?? 0,
      phase: this.phase,
      seed: s?.stage.seed ?? 0,
      extra: {
        placement: this.placement,
        seated: this.forceSeated ? 'forced' : String(this.seatedThisRun),
        errors: this.watchdog.errorsLastMinute,
        recording: this.recorder ? `${this.recorder.length} frames` : 'off',
        attempts: cam ? cam.attempts.map((a) => `${a.mode}/${a.delegate}:${a.ok ? 'ok' : 'x'}`).join(' ') : '-',
        glyphs: this.world.glyphs.used,
      },
    };
  }

  /** Test hook (E2E/soak): a snapshot of the app state. */
  inspect(): Record<string, unknown> {
    const s = this.session;
    return {
      t: this.clock(),
      gameT: this.phase === 'play' ? this.clock() - this.playStart : null,
      phase: this.phase,
      backend: this.gfx?.backend,
      source: this.source?.kind,
      present: !!this.body?.present,
      score: s?.score.score ?? null,
      counts: s?.score.counts ?? null,
      section: s?.section ?? null,
      ended: s?.ended ?? null,
      offsetMs: this.offsetMs,
      calibrated: this.calibrated,
      particles: this.world?.particles?.count ?? 0,
      fps: this.fps,
      demo: !!this.demo,
      highscores: this.scores.list().length,
      placed: this.resultsInfo?.placed ?? null,
      heap: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
      dom: document.getElementsByTagName('*').length,
      glyphs: this.world?.glyphs.used ?? 0,
      errors: this.watchdog.errorsLastMinute,
      rendererInfo: this.gfx ? { ...this.gfx.renderer.info.memory } : null,
    };
  }

  /** Test hook: seeded RNG for anything non-game that wants determinism. */
  readonly rng = new Rng(1);
  readonly empty = emptySnapshot;
}
