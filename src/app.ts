// App: exhibition state machine and frame loop (hand / gesture edition).
//
//   loading → title (ghost-hand attract when empty / hand placement guide)
//   → calibrate (open & fist → personal thresholds; fist on the beat → latency)
//   → play (90 s battle: intro/tutorial → rush → guard → boss) → results → title
//   (?practice=1: free play with live recognition instead of the battle)
//
// Handles camera errors (→ mouse emergency mode), tracking stalls (→ restart),
// exceptions (→ soft reset), empty booth (→ title) and a stalled loop (→ reload).
import { EXHIBIT, GESTURE, HAND, JUDGE, LATENCY, RENDER, SAFETY, SETTINGS, SOUND, TRACKING } from './config';
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
import { WorldView, type WorldTheme } from './render/world';
import { Hud } from './ui/hud';
import { TechLens } from './ui/techLens';
import { SettingsPanel } from './ui/settingsPanel';
import { NameEntry } from './ui/nameEntry';
import { Sound } from './audio/sound';
import { GUEST_NAME } from './exhibit/playerName';
import { loadSettings, saveSettings, type Settings } from './exhibit/settings';
import { battleBot } from './battle/bot';
import { BattleSession, type BattleEvent } from './battle/session';
import { generateValidBattle, type BattleStage } from './battle/stage';
import { DIFFICULTIES, DIFFICULTY_IDS, FINISH, HIDDEN_BOSS, STAGES, stagesOf, type StageDef, type StageId } from './battle/stages';
import type { DifficultyId } from './config';
import { StageSelector } from './exhibit/stageSelect';
import { OnlineRanking } from './exhibit/online';
import { SUBMISSION_KEYS, type Diff, type ScoreSubmission } from './exhibit/scorePolicy';
import { BattleView, type UiRequest } from './render/battleView';
import { hash32 } from './core/rng';
import { rankOf, multiplier } from './game/score';
import { sealHands, type ShapeId } from './gesture/handModel';
import type { SealKind } from './gesture/seals';
import type { Vec2 } from './core/types';

type Phase = 'loading' | 'title' | 'select' | 'calibrate' | 'practice' | 'play' | 'results' | 'error';
type CalibStep = 'open' | 'fist' | 'beat';

export class App {
  private gfx!: Gfx;
  private world!: WorldView;
  private hud!: Hud;
  private debug!: DebugOverlay;
  private lens!: TechLens;
  /** Tech Lens: auto (attract demo and results), or forced on/off with T. */
  private lensMode: 'auto' | 'on' | 'off' = 'auto';
  /** Staff settings (S key), saved in this browser. */
  private settings: Settings = loadSettings();
  private settingsPanel!: SettingsPanel;
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
  private battleView!: BattleView;
  private battle: BattleSession | null = null;
  private bstage: BattleStage | null = null;
  /** Chosen stage (difficulty). */
  private stageId: StageId = 'hoshi';
  private selector: StageSelector | null = null;
  /** Selection in two steps: difficulty, then one of its stages. */
  private selectStep: 'difficulty' | 'stage' = 'difficulty';
  private selectDiff: DifficultyId = 'normal';
  private online!: OnlineRanking;
  /** Play token for the shared ranking (null = offline or not a camera play). */
  private runToken: string | null = null;
  private playId = 0;
  private lastBoardsAt = -1e9;
  private demoCount = 0;
  /** Autoplay: stage the bot picks next (normal → hard → easy …). */
  private botVisits = 0;
  private sealSet = new Set<SealKind>();
  private playStart = 0;
  private sectionIdx = -1;
  private requireNewVisitor = false;
  /** Result waiting for the player's name. */
  private pendingResult: { b: BattleSession; rank: string; todayBest: number } | null = null;
  private namedAt = 0;
  private nameEntry!: NameEntry;
  private sound!: Sound;
  private lastSelHover: number | null = null;
  private demoBattle: { session: BattleSession; start: number } | null = null;
  private lastUi: UiRequest = { marks: [] };
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
      seals: f.twoHand && !this.rt.oneHand && !degraded,
    };
  }

  // ───────────────────────── boot ─────────────────────────

  async start(): Promise<void> {
    this.hud = new Hud(document.body);
    this.hud.show('loading');
    this.hud.setLoading(0.02, '画面を準備中…');
    this.debug = new DebugOverlay(document.body);
    this.lens = new TechLens(document.body);
    this.nameEntry = new NameEntry(this.hud.resultsLayer, (name) => this.finishNaming(name));
    this.nameEntry.onKey = (k) => this.sound.play(k === '決定' ? 'confirm' : 'key');
    this.sound = new Sound({ enabled: this.settings.sound, sfx: this.settings.sfxVolume, ambient: this.settings.ambientVolume });
    // Browsers start audio only after a user gesture: any key / click unlocks it (staff press F for fullscreen anyway).
    const unlock = () => this.sound.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.sound.unlock();
    this.online = new OnlineRanking(this.rt.flags.online && this.settings.online);
    if (this.rt.debug) this.debug.toggle(true);

    this.gfx = await Gfx.create(this.canvas, { forceWebGL: this.rt.forceWebGL });
    this.quality = new QualityGovernor({ webgl: this.gfx.backend === 'webgl2', startLevel: this.rt.quality ?? RENDER.startLevel, particles: this.rt.flags.particles });
    const maxParticles = this.rt.flags.particles ? RENDER.particleLevels[this.quality.maxParticleLevel]! : 0;
    this.world = new WorldView(this.gfx, maxParticles, TRACKING.fieldW, TRACKING.fieldH);
    this.world.fxEnabled = this.rt.flags.fx;
    this.battleView = new BattleView(this.gfx, this.world);
    this.battleView.onSpawn = (big) => this.sound.play('spawn', { gain: 0.6 + big * 0.4 });
    this.settingsPanel = new SettingsPanel(document.body, () => this.settings, (s) => {
      this.settings = s;
      saveSettings(s);
      this.applySettings();
    });
    this.applySettings();

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
            this.hud.setLoading(0.05 + frac * 0.95, stage === 'init' ? '手の認識を準備中…' : `読み込み中 ${total ? Math.round((loaded / total) * 100) : 0}%`);
          },
        });
        this.hud.setLoading(0.04, 'カメラを準備中…');
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
      'カメラが使えません',
      [msg[code] ?? 'カメラを開始できませんでした。', '5秒後に <code>マウス</code> で遊べる緊急モードに切り替えます。'],
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
    if (this.phase === 'select' && /^[123]$/.test(k)) this.selector?.choose(Number(k) - 1);
    if (k === 's' && !e.repeat) this.settingsPanel.toggle();
    if (k === 'd') this.debug.toggle();
    else if (k === 't' && !e.repeat) this.lensMode = this.lensMode === 'auto' ? (this.lens.visible ? 'off' : 'on') : this.lensMode === 'on' ? 'off' : 'auto';
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
    const e = this.settings.effects;
    this.world.setCalm(this.calm, SAFETY.defaultFlashIntensity * e, SAFETY.defaultShakeIntensity * e);
    document.body.classList.toggle('calm', this.calm);
  }

  /** Push the staff settings into the renderer, effects, particles and features. */
  private applySettings(): void {
    const s = this.settings;
    this.gfx.uExposure.value = s.brightness;
    this.gfx.bloomStrength = RENDER.bloom.strength * s.glow;
    this.world.bg.uGain.value = s.background;
    this.world.effectScale = s.effects;
    this.applyCalm();
    this.gfx.setEffects(this.quality.state.effects && this.rt.flags.fx, this.quality.state.lens && s.lens);
    this.world.particles?.setCount(this.particleCount());
    this.lensMode = s.techLens;
    if (this.online) this.online.enabled = this.rt.flags.online && s.online;
    if (this.sound) {
      if (this.sound.enabled !== s.sound) this.sound.setEnabled(s.sound);
      this.sound.setVolumes(s.sfxVolume, s.ambientVolume);
    }
  }

  private particleCount(): number {
    if (this.rt.particles !== null) return this.rt.particles;
    const p = this.settings.particles;
    if (p === 'auto') return this.quality.particles;
    return RENDER.particleLevels[Math.min(SETTINGS.particleLevel[p], this.quality.maxParticleLevel)]!;
  }

  // ───────────────────────── phases ─────────────────────────

  private setPhase(p: Phase): void {
    this.phase = p;
    if (this.world && p !== 'select') this.world.theme = p === 'results' ? 'stars' : p === 'play' || p === 'calibrate' ? STAGES[this.stageId].themes.intro : 'lake';
    this.phaseAt = this.clock();
    if (p !== 'play') this.engine.expectSeals = new Set();
    if (p !== 'results' && this.nameEntry?.visible) {
      this.nameEntry.hide();
      this.hud.setNaming(false);
      this.pendingResult = null;
    }
    this.hud.show(p === 'practice' ? 'play' : p);
    if (p !== 'play') this.hud.setMarks([]);
    if (p !== 'title') this.stopDemo();
    if (p === 'title') {
      this.presence.reset();
      this.maybeActivateUpdate();
    }
    this.botScript();
  }

  /** Stage selection: difficulty, then stage (skipped in practice mode or when the staff fixed it with ?stage=). */
  private startSelect(now: number): void {
    const fixed = this.rt.stage;
    if (this.rt.practice || (fixed && fixed in STAGES)) {
      if (fixed && fixed in STAGES) this.stageId = fixed as StageId;
      this.startCalibration(now);
      return;
    }
    if (fixed && (DIFFICULTY_IDS as readonly string[]).includes(fixed)) this.openStageStep(now, fixed as DifficultyId);
    else this.openDifficultyStep(now);
    this.setPhase('select');
  }

  private bestToday(f: { diff?: string; stage?: string }): number {
    return this.scores.today(Date.now(), f).reduce((m, e) => Math.max(m, e.score), 0);
  }

  private openDifficultyStep(now: number): void {
    this.lastSelHover = null;
    this.selectStep = 'difficulty';
    this.selector = new StageSelector(now, this.rt.selectHoldMs);
    this.hud.setSelect(
      '難易度を選ぶ',
      DIFFICULTY_IDS.map((id) => {
        const d = DIFFICULTIES[id];
        const top = this.online.board(id, 'today')?.list[0];
        return { top: d.level, topSub: d.levelEn, stars: d.stars, title: d.level, sub: d.levelEn, desc: d.desc, foot: top ? `全国 本日1位　${top.score.toLocaleString('ja-JP')}（${top.region || '―'}）` : stagesOf(id).map((s) => s.name).join('・'), best: this.bestToday({ diff: id }), hue: d.hue };
      }),
    );
  }

  private openStageStep(now: number, diff: DifficultyId): void {
    this.lastSelHover = null;
    this.selectStep = 'stage';
    this.selectDiff = diff;
    // Shorter grace: the hand is already up from the first step.
    this.selector = new StageSelector(now, this.rt.selectHoldMs);
    const d = DIFFICULTIES[diff];
    this.hud.setSelect(
      `${d.level}　ステージを選ぶ`,
      stagesOf(diff).map((s) => ({ top: d.level, topSub: d.levelEn, stars: d.stars, title: s.name, sub: s.reading, desc: s.desc, foot: `ボス　${s.boss.name}`, best: this.bestToday({ stage: s.id }), hue: d.hue })),
    );
  }

  /** Cards on screen in the current selection step. */
  private selectOptions(): StageDef[] | null {
    return this.selectStep === 'stage' ? stagesOf(this.selectDiff) : null;
  }

  private startCalibration(now: number): void {
    this.world.transform();
    if (this.calibrated) {
      this.startMain();
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
    const text = step === 'open' ? '手を大きく開いて' : step === 'fist' ? '強く握って' : '光が重なった瞬間に握る';
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

  private startMain(): void {
    if (this.rt.practice) this.startPractice();
    else this.startPlay();
  }

  private startPlay(): void {
    const f = this.rt.flags;
    const now = this.clock();
    const twoHandOk = f.twoHand && !this.rt.oneHand;
    this.bstage = generateValidBattle({
      seed: this.rt.seed ?? hash32(Date.now() & 0xffffff),
      flags: f,
      oneHand: this.rt.oneHand,
      coreOnly: this.unstable,
      structure: f.structure,
      twoHandOk,
      durationMs: this.rt.playMs,
      stage: this.stageId,
    });
    this.battle = new BattleSession({ stage: this.bstage, dda: f.dda, oneHand: this.rt.oneHand, twoHandOk, windowScale: () => (this.unstable ? JUDGE.unstableWindowScale : 1) });
    this.playStart = now;
    this.sectionIdx = -1;
    // Shared ranking: only real camera plays submit (bots, mouse mode and tests never pollute it).
    const id = ++this.playId;
    this.runToken = null;
    if (this.canSubmit()) void this.online.startRun(this.stageId).then((t) => id === this.playId && (this.runToken = t));
    this.world.reset();
    this.battleView.reset();
    this.hud.setSections(this.bstage.sections.map((s) => s.kind));
    this.hud.setScoreVisible(true);
    this.setPhase('play');
  }

  private endPlay(): void {
    const b = this.battle;
    if (!b) return;
    const sc = b.score;
    const def = STAGES[b.stage.stageId];
    const lv = DIFFICULTIES[def.difficulty];
    const rank = rankOf(sc);
    this.pendingResult = { b, rank, todayBest: this.bestToday({ diff: def.difficulty }) };
    this.hud.setResults({
      score: sc.score,
      rank,
      maxCombo: sc.maxCombo,
      counts: sc.counts,
      nick: '',
      placed: -1,
      ranking: [],
      stage: `${lv.level}「${def.name}」`,
      flow: 0,
      isBest: false,
      extra: this.resultExtra(b),
    });
    this.hud.setMarks([]);
    this.setPhase('results');
    this.requireNewVisitor = true;
    // The player types a name (hands-free keyboard / mouse / keyboard); then it is recorded.
    this.hud.setNaming(true);
    this.nameEntry.show(this.clock());
    this.sound.play('results');
    this.botScript();
  }

  private resultExtra(b: BattleSession): string {
    const def = STAGES[b.stage.stageId];
    return `<span>撃破 <b>${b.kills}</b></span>${b.ultimates - (b.hiddenCleared ? 1 : 0) > 0 ? `<span><b>${FINISH.name}</b>を決めた</span>` : `<span>${def.boss.name}を逃した</span>`}${b.hiddenCleared ? `<span>隠しボス<b>${HIDDEN_BOSS.name}</b>撃破！</span>` : ''}`;
  }

  /** Name decided (or skipped → guest, kept on this device only): record and show the rankings. */
  private finishNaming(name: string | null): void {
    const pr = this.pendingResult;
    this.pendingResult = null;
    this.hud.setNaming(false);
    this.namedAt = this.clock();
    if (!pr) return;
    const { b, rank, todayBest } = pr;
    const sc = b.score;
    const def = STAGES[b.stage.stageId];
    const lv = DIFFICULTIES[def.difficulty];
    const nm = name ?? GUEST_NAME;
    const r = this.scores.add({ score: sc.score, name: nm, rank, at: Date.now(), seated: false, stage: def.id, diff: def.difficulty, stageName: def.name });
    const kept = r.updated ? '' : `<span>この名前の最高 <b>${r.best.score.toLocaleString('ja-JP')}</b> はそのまま</span>`;
    this.hud.setResults({
      score: sc.score,
      rank,
      maxCombo: sc.maxCombo,
      counts: sc.counts,
      nick: nm,
      placed: r.place,
      ranking: this.scores.list({ diff: def.difficulty }),
      stage: `${lv.level}「${def.name}」`,
      flow: 0,
      isBest: r.updated && sc.score > todayBest && sc.score > 0,
      extra: this.resultExtra(b) + kept,
    });
    void this.submitOnline(b, name, rank);
  }


  private canSubmit(): boolean {
    return this.online.enabled && (this.source instanceof CameraSource || this.rt.onlineTest);
  }

  /** Submit the play to the shared ranking and show where it placed (never blocks the results). */
  /** `name` null = guest: nothing is sent, the shared board is only shown. */
  private async submitOnline(b: BattleSession, name: string | null, rank: string): Promise<void> {
    const def = STAGES[b.stage.stageId];
    const lv = DIFFICULTIES[def.difficulty].level;
    const diff = def.difficulty as Diff;
    const sc = b.score;
    const token = this.runToken;
    this.runToken = null;
    const id = this.playId;
    let place = null;
    if (token && name && this.canSubmit()) {
      this.hud.setOnline({ state: 'loading', level: lv });
      const sub: ScoreSubmission = { token, stage: def.id, score: sc.score, rank, name, maxCombo: sc.maxCombo, perfect: sc.counts.perfect, good: sc.counts.good, miss: sc.counts.miss, device: OnlineRanking.deviceId() };
      // Only the fields in SUBMISSION_KEYS leave the device.
      const clean = Object.fromEntries(SUBMISSION_KEYS.map((k) => [k, sub[k]])) as unknown as ScoreSubmission;
      place = await this.online.submit(clean);
    }
    const board = await this.online.refresh(diff, 'today', place ? 0 : 30_000);
    if (id !== this.playId || this.phase !== 'results') return;
    if (!board) this.hud.setOnline({ state: 'offline', level: lv });
    else this.hud.setOnline({ state: 'ok', level: lv, list: board.list, me: name ? { name, score: sc.score } : undefined, place });
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
    this.battle = null;
    this.battleView?.reset();
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
      this.world.particles?.setCount(this.particleCount());
      this.gfx.setResolutionScale(this.quality.resolutionScale);
      this.gfx.setEffects(this.quality.state.effects && this.rt.flags.fx, this.quality.state.lens && this.settings.lens);
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
          this.requireNewVisitor = false;
        }
        const absent = this.presence.absentFor(now);
        if (this.requireNewVisitor && absent > 1500) this.requireNewVisitor = false;
        const attract = absent > this.rt.attractDelayMs && !this.emergency;
        if (attract) {
          this.runDemo(now);
          showFrame = this.demo?.frame ?? null;
        } else if (this.demo) {
          this.stopDemo();
          this.world.transform();
        }
        this.hud.setTitle({ attract, placement: attract ? 'none' : this.placement, progress: this.requireNewVisitor ? 0 : this.presence.startProgress(now), waitingNext: this.requireNewVisitor && present });
        if (now - this.lastBoardsAt > 60_000) {
          // Keep the shared boards warm for the selection cards and the results.
          this.lastBoardsAt = now;
          for (const d of DIFFICULTY_IDS) void this.online.refresh(d, 'today');
        }
        if (!attract && !this.requireNewVisitor && this.presence.ready(now)) this.startSelect(now);
        break;
      }
      case 'select': {
        const sel = this.selector!;
        const hand = g?.hands[0] ?? null;
        const st = sel.update(now, hand ? hand.palm.x : null);
        const L = this.gfx.layout;
        const rects = HAND.selectCardsX.map((_, i) => {
          const cx = HAND.selectCardsX[i]!;
          return { l: L.viewToScreen({ x: cx - HAND.selectCardHalfW, y: 0.5 }).x, r: L.viewToScreen({ x: cx + HAND.selectCardHalfW, y: 0.5 }).x };
        });
        this.hud.updateSelect(rects, st.hover, st.progress, hand ? L.viewToScreen(hand.palm) : null);
        if (st.hover !== this.lastSelHover) {
          this.lastSelHover = st.hover;
          if (st.hover !== null) this.sound.play('select');
        }
        if (st.chosen !== null) this.sound.play('confirm');
        const opts = this.selectOptions();
        if (st.hover !== null) this.world.theme = opts ? opts[st.hover]!.themes.intro : stagesOf(DIFFICULTY_IDS[st.hover]!)[0]!.themes.intro;
        if (st.chosen !== null) {
          if (!opts) {
            this.openStageStep(now, DIFFICULTY_IDS[st.chosen]!);
            this.botScript();
          } else {
            const def = opts[st.chosen]!;
            this.stageId = def.id;
            this.hud.cutin(def.name, `${DIFFICULTIES[def.difficulty].level}　${def.reading}`, 'amber', false);
            this.startCalibration(now);
          }
        }
        this.presence.update(now, present, present ? 'ok' : 'none');
        if (this.presence.absentFor(now) > 3000) this.setPhase('title');
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
            this.startMain();
          }
        }
        this.presence.update(now, present, present ? 'ok' : 'none');
        if (this.presence.absentFor(now) > 3000) this.setPhase('title');
        break;
      }
      case 'play': {
        const b = this.battle!;
        const gt = now - this.playStart;
        for (const e of events) b.pushEvent(e.t - this.playStart - this.offsetMs, e);
        this.engine.expectSeals = this.settings.sealAssist ? b.expectedSeals(gt, this.sealSet) : new Set();
        const bev = b.update(gt);
        this.handleBattleEvents(bev, now, gt, g);
        ghost = this.tutorialGhost(b, gt, g);
        const sc = b.score;
        this.hud.setPlay(sc.score, sc.combo, multiplier(sc.combo), gt / b.stage.durationMs);
        this.presence.update(now, present, present ? 'ok' : 'none');
        if (this.presence.empty(now)) this.softReset('player left');
        else if (b.ended) this.endPlay();
        break;
      }
      case 'results': {
        this.presence.update(now, present, present ? 'ok' : 'none');
        if (this.nameEntry.visible) {
          // Hands-free typing: the index fingertip is the pointer.
          const h = g?.hands[0];
          this.nameEntry.pointer(h ? this.gfx.layout.viewToScreen(this.world.predictor.predict(h, now).tip) : null, now);
          const idle = now - Math.max(this.phaseAt, this.nameEntry.lastActivity);
          // Skip when the player left (and nobody is typing) or after a long idle.
          if ((this.presence.absentFor(now) > 3000 && idle > 3000) || idle > this.rt.nameIdleMs) this.nameEntry.skip();
        } else if (now - this.namedAt > this.rt.resultsMs) this.setPhase('title');
        break;
      }
      case 'practice': {
        for (const e of events) {
          if (e.type !== 'cast') continue;
          this.castCount++;
          const how = e.release === 'hold' ? '' : e.release === 'sigil' ? `＋${SIGIL_LABEL[e.sigil!]}` : e.release === 'twoHand' ? '＋両手' : `＋${MOTION_LABEL[e.release]}`;
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
      energy: this.phase === 'play' ? (this.battle?.section === 'boss' ? 1 : 0.7) : this.phase === 'practice' ? 0.7 : 0.3,
      icons: this.phase !== 'title' || !!this.demo,
      overlay: (gb) => {
        const db = this.phase === 'title' && this.demo && this.demoBattle ? this.demoBattle : null;
        const b = this.phase === 'play' ? this.battle : db?.session ?? null;
        if (!b) return;
        const gt = this.phase === 'play' ? now - this.playStart : now - db!.start;
        const ui: UiRequest = { marks: [] };
        this.battleView.draw(gb, now, gt, b, ui, true);
        if (this.phase === 'play') {
          const L = this.gfx.layout;
          this.hud.setMarks(ui.marks.map((m) => ({ id: m.id, ...L.viewToScreen(m.at), text: m.text, strong: m.strong })));
        }
      },
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
    this.sound.setTheme(this.world.theme);
    this.sound.setDuck(this.phase === 'title' && this.demo ? SOUND.attractDuck : 1);
    this.lens.setVisible(!this.nameEntry.visible && (this.lensMode === 'on' || (this.lensMode === 'auto' && (this.phase === 'title' || this.phase === 'results'))));
    if (this.lens.visible) {
      const cam = this.source instanceof CameraSource ? this.source : null;
      const L = this.gfx.layout;
      this.lens.update(
        now,
        g,
        { fps: this.fps, latencyMs: this.lat.pipeline + this.lat.display, particles: this.world.particles?.count ?? 0, backend: this.gfx.backend, tracking: cam?.status().backend ?? this.source?.kind ?? 'none', trackFps: cam?.stats.fps ?? 30 },
        (p) => L.viewToScreen(p),
      );
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

  /** Sound for battle events (the picture is drawn by BattleView). */
  private playBattleSounds(bev: BattleEvent[], ui: UiRequest): void {
    const S = this.sound;
    for (const e of bev) {
      if (e.type === 'cast') {
        if (e.ev.type === 'seal') S.play('seal');
        else S.play('cast', { pitch: e.matched ? 1 : 0.8, gain: e.matched ? 1 : 0.6 });
      } else if (e.type === 'hit') {
        if (e.kill) S.play('kill', { pitch: e.boss ? 0.7 : 1 });
        else if (e.boss) S.play('bossHit');
        else S.play(e.grade === 'perfect' ? 'hitPerfect' : 'hitGood');
        if (e.kill && e.grade === 'perfect') S.play('hitPerfect', { gain: 0.6 });
      } else if (e.type === 'miss') S.play('miss');
      else if (e.type === 'hurt') S.play('hurt');
      else if (e.type === 'blocked') S.play('block');
      else if (e.type === 'ultimate') S.play('finish', { pitch: e.hidden ? 1.26 : 1 });
      else if (e.type === 'hiddenBoss') S.play('hiddenBoss');
      else if (e.type === 'section') S.play('section', { pitch: e.kind === 'boss' ? 0.75 : 1 });
    }
    if (ui.cutin?.big) S.play('cutin');
    if (ui.combo) S.play('combo', { pitch: 1 + Math.min(0.5, ui.combo / 60) });
  }

  private handleBattleEvents(bev: BattleEvent[], now: number, gt: number, g: GestureFrame | null): void {
    const b = this.battle!;
    const ui = this.battleView.onEvents(bev, now, gt, b, g);
    this.lastUi = ui;
    this.playBattleSounds(bev, ui);
    if (ui.cutin) this.hud.cutin(ui.cutin.title, ui.cutin.reading, ui.cutin.hue, ui.cutin.big);
    if (ui.hurt) this.hud.hurt();
    if (ui.combo) this.hud.announce(`${ui.combo} 連撃！`);
    const L = this.gfx.layout;
    for (const e of bev) {
      if (e.type === 'hit') {
        const a = b.enemies.find((x) => x.e.id === e.enemy);
        const at = a ? this.battleView.enemyPos(a, gt).at : { x: 0.5, y: 0.4 };
        const sp = L.viewToScreen(at);
        this.hud.judge(e.grade, sp.x, sp.y - L.h * 0.08);
        if (e.tech.req.kind !== 'seal' && (e.kill || e.boss)) this.hud.announce(e.tech.name);
        this.lastCast = { label: e.tech.name, at: now };
        this.castCount++;
      } else if (e.type === 'miss') {
        const a = b.enemies.find((x) => x.e.id === e.enemy);
        if (a) {
          const sp = L.viewToScreen(this.battleView.enemyPos(a, gt).at);
          this.hud.judge('miss', sp.x, sp.y - L.h * 0.06);
        }
      } else if (e.type === 'section') {
        const def = STAGES[b.stage.stageId];
        this.world.theme = def.themes[e.kind] as WorldTheme;
        this.sectionIdx++;
        this.hud.setSection(this.sectionIdx, e.kind, false);
        const call = e.kind === 'boss' ? `${def.boss.name}（${def.boss.reading}）` : e.kind === 'hidden' ? '' : def.calls[e.kind];
        if (call) this.hud.announce(call);
      }
    }
  }

  /** Tutorial: a translucent "ghost hand" demonstrates what the current tutorial spirit needs. */
  private tutorialGhost(b: BattleSession, gt: number, g: GestureFrame | null): SynthHand[] | null {
    const a = b.enemies.find((x) => x.state === 'alive' && x.e.tutorial && gt >= x.e.spawn + 600);
    if (!a) {
      // Seal guide (初級・中級): shortly before a seal is due, translucent hands show how to form it.
      if (STAGES[b.stage.stageId].difficulty === 'hard') return null;
      for (const x of b.enemies) {
        const st = x.state === 'alive' ? x.e.steps[x.step] : undefined;
        if (!st || st.t === null || st.t - gt > JUDGE.sealAssistLeadMs || st.t - gt < -300) continue;
        const r = b.req(st.tech);
        if (r.kind !== 'seal') continue;
        const hs = g?.hands ?? [];
        const at: Vec2 = hs.length ? { x: hs.reduce((m, h) => m + h.palm.x, 0) / hs.length, y: Math.min(0.75, hs.reduce((m, h) => m + h.palm.y, 0) / hs.length) } : { x: 0.5, y: 0.62 };
        return sealHands(r.seal, at, hs[0]?.size ?? 0.14);
      }
      return null;
    }
    const step = a.e.steps[a.step];
    if (!step) return null;
    const req = b.req(step.tech);
    const near: Vec2 = g?.hands[0] ? { x: Math.min(0.85, g.hands[0].palm.x + 0.16), y: g.hands[0].palm.y + 0.05 } : { x: 0.72, y: 0.7 };
    const size = g?.hands[0]?.size ?? 0.14;
    const cycle = (gt % 1600) / 1600;
    const base = { ...defaultHand('R'), size, wrist: { x: near.x, y: near.y + size * 0.6 } };
    if (req.kind === 'shape' || req.kind === 'motion') {
      // Relaxed → shape (loop) so the transformation itself is visible.
      const k = cycle < 0.25 ? cycle / 0.25 : 1;
      const shaped = withShape(base, req.shape as ShapeId);
      return [k < 1 ? { ...shaped, curl: shaped.curl.map((c, i) => relaxedHand(base, 0.15).curl[i]! + (c - relaxedHand(base, 0.15).curl[i]!) * k) as SynthHand['curl'] } : shaped];
    }
    if (req.kind === 'seal') return sealHands(req.seal, { x: 0.5, y: 0.62 }, size);
    return [withShape(base, 'point')];
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
    if ((this.gframe?.frame.ignored ?? 0) > 0) return 'お一人ずつ遊んでください';
    if (this.unstable) return '暗いため、使う形を減らしています';
    return null;
  }

  // ───────────────────────── attract demo ─────────────────────────

  private runDemo(now: number): void {
    if (this.demo && this.demoBattle && now - this.demoBattle.start > this.demoBattle.session.stage.durationMs + 1500) this.stopDemo();
    if (!this.demo) {
      // Attract: the bot fights a short battle on its own (ghost hands).
      // Cycle easy → normal → hard, a different stage each round.
      const n = this.demoCount++;
      const demoStage = stagesOf(DIFFICULTY_IDS[n % 3]!)[Math.floor(n / 3) % 3]!.id;
      const stage = generateValidBattle({ seed: 0xa77ac7 + (Math.floor(now / 1000) % 5), flags: this.rt.flags, oneHand: false, coreOnly: false, structure: true, twoHandOk: true, durationMs: 36_000, stage: demoStage });
      this.world.theme = STAGES[demoStage].themes.intro;
      const start = now + 800;
      const session = new BattleSession({ stage: { ...stage, enemies: stage.enemies.filter((e) => !e.tutorial) }, dda: false, oneHand: false, twoHandOk: true });
      this.demoBattle = { session, start };
      const script = this.rt.practice ? showcase(now) : battleBot(session.stage, { session, playStart: start, errorMs: 40, seed: 3 });
      const source = new HandSynthSource(script, 30);
      const engine = new GestureEngine({ shapes: SHAPE_IDS, motions: true, sigils: true, twoHand: true, seals: true });
      const demo = { source, engine, frame: null as GestureFrame | null, field: new FieldBuilder(TRACKING.fieldW, TRACKING.fieldH) };
      source.frames.on((f) => {
        if (this.demoBattle) engine.expectSeals = this.demoBattle.session.expectedSeals(f.t - this.demoBattle.start);
        const gf = engine.update(f);
        demo.frame = gf;
        const db = this.demoBattle;
        if (db) {
          for (const e of gf.events) db.session.pushEvent(e.t - db.start, e);
          const gt = f.t - db.start;
          const bev = db.session.update(gt);
          for (const e of bev) if (e.type === 'section') this.world.theme = STAGES[db.session.stage.stageId].themes[e.kind] as WorldTheme;
          this.playBattleSounds(bev, this.battleView.onEvents(bev, f.t, gt, db.session, gf));
        } else this.world.onGestureEvents(gf.events, gf, now);
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
    this.demoBattle = null;
    this.battleView?.reset();
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
    } else if (this.phase === 'select') {
      // Walk the hand over a card and hold it there.
      // Difficulty: normal → hard → easy …; stage: cycles every three visits.
      const pick = this.selectStep === 'difficulty' ? [1, 2, 0][this.botVisits % 3]! : Math.floor(this.botVisits++ / 3) % 3;
      const at = now + 300;
      script = perform([{ at, shape: 'open', holdMs: 60_000, formMs: 400, at2: { x: HAND.selectCardsX[pick]!, y: 0.66 } }], 'R');
    } else if (this.phase === 'calibrate' && this.calibStep === 'open') {
      script = perform([{ at: now + 200, shape: 'open', holdMs: 1400 }], 'R');
      const s = script;
      script = (t) => s(t);
    } else if (this.phase === 'calibrate' && this.calibStep === 'fist') {
      script = perform([{ at: now + 100, shape: 'fist', holdMs: 1500 }], 'R');
    } else if (this.phase === 'calibrate' && this.calibStep === 'beat' && this.latCal) {
      // Make a fist exactly on each pulse (stance fires ~2 frames after forming).
      script = perform(this.latCal.pulses.map((p) => ({ at: p - 200, shape: 'fist' as const, holdMs: 250, formMs: 140 })), 'R');
    } else if (this.phase === 'play' && this.bstage) {
      script = battleBot(this.bstage, { session: this.battle ?? undefined, playStart: this.playStart, offsetMs: this.offsetMs, oneHand: this.rt.oneHand, twoHandOk: this.rt.flags.twoHand && !this.rt.oneHand, errorMs: 60, missRate: 0.06, seed: this.bstage.seed });
    } else if (this.phase === 'results') {
      const leave = now + 1200;
      const idle = perform([], 'R');
      script = (t) => (t < leave ? idle(t) : []);
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
      score: this.battle?.score.score ?? 0,
      combo: this.battle?.score.combo ?? 0,
      section: this.phase === 'play' ? (this.battle?.section ?? null) : this.lastCast && now - this.lastCast.at < 2000 ? this.lastCast.label : null,
      progress: this.battle && this.phase === 'play' ? (now - this.playStart) / this.battle.stage.durationMs : 0,
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
      settings: this.settings,
      exposure: this.gfx?.uExposure.value ?? null,
      stage: this.stageId,
      t: this.clock(),
      gameT: this.phase === 'play' ? this.clock() - this.playStart : null,
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
      score: this.battle?.score.score ?? null,
      counts: this.battle?.score.counts ?? null,
      section: this.battle?.section ?? null,
      kills: this.battle?.kills ?? 0,
      ultimates: this.battle?.ultimates ?? 0,
      ended: this.battle?.ended ?? null,
      highscores: this.scores.list().length,
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
