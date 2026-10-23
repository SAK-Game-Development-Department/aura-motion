// Sound: every sound is synthesized live with Web Audio (no audio files, no
// network). The mood is quiet and cavernous — airy noise, short metallic
// strikes, deep bells and a long dark reverb — under a soft ambience that
// changes with the stage. Original designs (no samples from other works).
// Output only: the microphone is never used.
import { SOUND } from '../config';
import { Rng } from '../core/rng';
import type { StageTheme } from '../battle/stages';

export type Sfx =
  | 'cast'
  | 'hitPerfect'
  | 'hitGood'
  | 'kill'
  | 'bossHit'
  | 'miss'
  | 'hurt'
  | 'block'
  | 'seal'
  | 'cutin'
  | 'finish'
  | 'hiddenBoss'
  | 'combo'
  | 'section'
  | 'spawn'
  | 'select'
  | 'confirm'
  | 'key'
  | 'results';

interface Ambience {
  /** Two detuned drone sines (Hz) and their level. */
  drone: number;
  droneGain: number;
  /** Filtered noise bed. */
  noise: BiquadFilterType;
  noiseHz: number;
  noiseQ: number;
  noiseGain: number;
  /** Slow swell of the noise bed (Hz). */
  lfo: number;
}

/** The big moments are never dropped by the voice limit. */
const BIG = new Set<Sfx>(['seal', 'cutin', 'finish', 'hiddenBoss', 'section', 'results']);

const AMB: Record<StageTheme | 'none', Ambience> = {
  lake: { drone: 55, droneGain: 0.05, noise: 'lowpass', noiseHz: 500, noiseQ: 0.7, noiseGain: 0.05, lfo: 0.12 },
  sea: { drone: 41, droneGain: 0.08, noise: 'lowpass', noiseHz: 220, noiseQ: 1.2, noiseGain: 0.09, lfo: 0.07 },
  snow: { drone: 98, droneGain: 0.025, noise: 'bandpass', noiseHz: 2600, noiseQ: 0.6, noiseGain: 0.05, lfo: 0.18 },
  stars: { drone: 73, droneGain: 0.04, noise: 'highpass', noiseHz: 4000, noiseQ: 0.5, noiseGain: 0.02, lfo: 0.1 },
  crystal: { drone: 87, droneGain: 0.04, noise: 'bandpass', noiseHz: 1800, noiseQ: 4, noiseGain: 0.025, lfo: 0.15 },
  eclipse: { drone: 36.7, droneGain: 0.09, noise: 'lowpass', noiseHz: 300, noiseQ: 0.8, noiseGain: 0.05, lfo: 0.05 },
  storm: { drone: 46, droneGain: 0.06, noise: 'bandpass', noiseHz: 700, noiseQ: 1.5, noiseGain: 0.08, lfo: 0.22 },
  ember: { drone: 49, droneGain: 0.05, noise: 'highpass', noiseHz: 1500, noiseQ: 0.7, noiseGain: 0.04, lfo: 0.3 },
  thunder: { drone: 38, droneGain: 0.07, noise: 'lowpass', noiseHz: 380, noiseQ: 0.9, noiseGain: 0.08, lfo: 0.09 },
  petal: { drone: 110, droneGain: 0.025, noise: 'bandpass', noiseHz: 1200, noiseQ: 0.5, noiseGain: 0.035, lfo: 0.14 },
  none: { drone: 55, droneGain: 0, noise: 'lowpass', noiseHz: 400, noiseQ: 0.7, noiseGain: 0, lfo: 0.1 },
};

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private reverb!: ConvolverNode;
  /** Ping-pong echo send (shimmer on the big moments). */
  private echo!: GainNode;
  /** Background music bus (src/audio/music.ts plays into it). */
  musicBus: GainNode | null = null;
  musicVolume = 0.45;
  private noiseBuf!: AudioBuffer;
  private amb: { o1: OscillatorNode; o2: OscillatorNode; dg: GainNode; nf: BiquadFilterNode; ng: GainNode; lfo: OscillatorNode; lfoG: GainNode } | null = null;
  private last = new Map<Sfx, number>();
  private voices = 0;
  private theme: StageTheme | 'none' = 'none';
  enabled: boolean;
  sfxVolume: number;
  ambVolume: number;
  /** Extra attenuation (e.g. the attract demo plays quieter). */
  duck = 1;

  constructor(opts: { enabled: boolean; sfx: number; ambient: number }) {
    this.enabled = opts.enabled;
    this.sfxVolume = opts.sfx;
    this.ambVolume = opts.ambient;
  }

  /** True once audio is actually running (browsers need a user gesture first). */
  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Create / resume the audio graph (call from a user gesture when possible). */
  unlock(): void {
    if (!this.enabled) return;
    if (!this.ctx) this.build();
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on && this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
      this.amb = null;
    } else if (on) this.unlock();
  }

  setVolumes(sfx: number, ambient: number): void {
    this.sfxVolume = sfx;
    this.ambVolume = ambient;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sfxBus.gain.setTargetAtTime(sfx * this.duck, t, 0.05);
    this.ambBus.gain.setTargetAtTime(ambient * this.duck, t, 0.3);
    this.musicBus?.gain.setTargetAtTime(this.musicVolume * this.duck, t, 0.3);
  }

  setMusicVolume(v: number): void {
    this.musicVolume = v;
    if (this.ctx && this.musicBus) this.musicBus.gain.setTargetAtTime(v * this.duck, this.ctx.currentTime, 0.3);
  }

  /** Audio graph for the music engine (null until audio runs). */
  get audio(): { ctx: AudioContext; out: GainNode; echo: GainNode; noise: AudioBuffer } | null {
    return this.ctx && this.musicBus && this.ctx.state === 'running' ? { ctx: this.ctx, out: this.musicBus, echo: this.echo, noise: this.noiseBuf } : null;
  }

  /** Dip the music under a big moment (cut-ins, the finisher). */
  duckMusic(depth: number, seconds: number): void {
    if (!this.ctx || !this.musicBus) return;
    const t = this.ctx.currentTime;
    const g = this.musicBus.gain;
    const base = this.musicVolume * this.duck;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(base * (1 - depth), t, 0.05);
    g.setTargetAtTime(base, t + seconds, 0.6);
  }

  setDuck(d: number): void {
    if (d === this.duck) return;
    this.duck = d;
    this.setVolumes(this.sfxVolume, this.ambVolume);
  }

  private build(): void {
    const AC = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = SOUND.masterGain;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    // A long, dark cave reverb (generated impulse).
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(SOUND.reverbSeconds);
    const wet = ctx.createGain();
    wet.gain.value = SOUND.reverbMix;
    this.reverb.connect(wet).connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxVolume * this.duck;
    this.sfxBus.connect(this.master);
    this.sfxBus.connect(this.reverb);
    // Stereo ping-pong echo.
    this.echo = ctx.createGain();
    this.echo.gain.value = 0.9;
    const dl = ctx.createDelay(1);
    const dr = ctx.createDelay(1);
    dl.delayTime.value = 0.27;
    dr.delayTime.value = 0.4;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    const merge = ctx.createChannelMerger(2);
    this.echo.connect(dl);
    dl.connect(lp).connect(dr);
    dr.connect(fb).connect(dl);
    dl.connect(merge, 0, 0);
    dr.connect(merge, 0, 1);
    const echoOut = ctx.createGain();
    echoOut.gain.value = 0.5;
    merge.connect(echoOut).connect(this.master);
    echoOut.connect(this.reverb);
    // Music.
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVolume * this.duck;
    this.musicBus.connect(this.master);
    this.musicBus.connect(this.reverb);
    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = this.ambVolume * this.duck;
    this.ambBus.connect(this.master);
    this.ambBus.connect(this.reverb);
    // Shared noise source material.
    const n = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    const rng = new Rng(7);
    for (let i = 0; i < n; i++) d[i] = rng.next() * 2 - 1;
    this.buildAmbience();
  }

  private impulse(sec: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    const rng = new Rng(11);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const k = i / len;
        // Dark tail: low-passed noise with an exponential decay.
        lp += ((rng.next() * 2 - 1) - lp) * (0.35 - 0.25 * k);
        d[i] = lp * Math.pow(1 - k, 3.2);
      }
    }
    return buf;
  }

  private buildAmbience(): void {
    const ctx = this.ctx!;
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.type = 'sine';
    o2.type = 'sine';
    const dg = ctx.createGain();
    dg.gain.value = 0;
    o1.connect(dg);
    o2.connect(dg);
    dg.connect(this.ambBus);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const nf = ctx.createBiquadFilter();
    const ng = ctx.createGain();
    ng.gain.value = 0;
    src.connect(nf).connect(ng).connect(this.ambBus);
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    lfo.connect(lfoG).connect(ng.gain);
    o1.start();
    o2.start();
    src.start();
    lfo.start();
    this.amb = { o1, o2, dg, nf, ng, lfo, lfoG };
    const th = this.theme;
    this.theme = 'none';
    this.setTheme(th);
  }

  /** Cross-fade the ambience to a stage theme. */
  setTheme(theme: StageTheme | 'none'): void {
    if (theme === this.theme) return;
    this.theme = theme;
    if (!this.ctx || !this.amb) return;
    const a = AMB[theme];
    const t = this.ctx.currentTime;
    const T = 1.2;
    const m = this.amb;
    m.o1.frequency.setTargetAtTime(a.drone, t, T);
    m.o2.frequency.setTargetAtTime(a.drone * 1.004 + 0.3, t, T);
    m.dg.gain.setTargetAtTime(a.droneGain, t, T);
    m.nf.type = a.noise;
    m.nf.frequency.setTargetAtTime(a.noiseHz, t, T);
    m.nf.Q.setTargetAtTime(a.noiseQ, t, T);
    m.ng.gain.setTargetAtTime(a.noiseGain, t, T);
    m.lfo.frequency.setTargetAtTime(a.lfo, t, T);
    m.lfoG.gain.setTargetAtTime(a.noiseGain * 0.6, t, T);
  }

  // ─────────────── building blocks ───────────────

  private env(g: GainNode, t: number, a: number, peak: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + decay);
  }

  private voice(dur: number): boolean {
    if (this.voices >= SOUND.maxVoices) return false;
    this.voices++;
    setTimeout(() => this.voices--, (dur + 0.1) * 1000);
    return true;
  }

  /** Filtered noise burst. */
  private noise(t: number, o: { type: BiquadFilterType; f0: number; f1?: number; q?: number; a: number; d: number; gain: number; dest?: AudioNode }): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.playbackRate.value = 0.9 + ((t * 97.3) % 0.2);
    const f = ctx.createBiquadFilter();
    f.type = o.type;
    f.Q.value = o.q ?? 1;
    f.frequency.setValueAtTime(o.f0, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.a + o.d);
    const g = ctx.createGain();
    this.env(g, t, o.a, o.gain, o.d);
    s.connect(f).connect(g).connect(o.dest ?? this.sfxBus);
    s.start(t, (t * 13.7) % 1.5);
    s.stop(t + o.a + o.d + 0.05);
  }

  /** A sine/triangle partial with an optional pitch glide. */
  private tone(t: number, o: { f: number; f1?: number; type?: OscillatorType; a: number; d: number; gain: number }): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + o.a + o.d);
    const g = ctx.createGain();
    this.env(g, t, o.a, o.gain, o.d);
    osc.connect(g).connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + o.a + o.d + 0.05);
  }

  /** Route a tone/noise to the echo as well (shimmer). */
  private echoSend(node: AudioNode, amount: number): void {
    const g = this.ctx!.createGain();
    g.gain.value = amount;
    node.connect(g).connect(this.echo);
  }

  /**
   * Choir-like pad: per note, detuned saws through two vowel formants ("ah"),
   * with a slow swell. Spread left/right.
   */
  private choir(t: number, freqs: number[], o: { a: number; hold: number; r: number; gain: number; echo?: number }): void {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(o.gain, t + o.a);
    out.gain.setValueAtTime(o.gain, t + o.a + o.hold);
    out.gain.exponentialRampToValueAtTime(0.0001, t + o.a + o.hold + o.r);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 750;
    f1.Q.value = 3;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 1150;
    f2.Q.value = 4;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    const mix = ctx.createGain();
    f1.connect(mix);
    f2.connect(mix);
    mix.connect(lp).connect(out).connect(this.sfxBus);
    if (o.echo) this.echoSend(out, o.echo);
    const end = t + o.a + o.hold + o.r + 0.1;
    // Two detuned saws per note, one panner per note (few nodes: big moments must not stall a frame).
    freqs.forEach((f, i) => {
      const pan = ctx.createStereoPanner();
      pan.pan.value = ((i / Math.max(1, freqs.length - 1)) * 2 - 1) * 0.6;
      const g = ctx.createGain();
      g.gain.value = 0.27 / freqs.length;
      g.connect(pan);
      pan.connect(f1);
      pan.connect(f2);
      for (const det of [-8, 8]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = f;
        osc.detune.value = det + (i % 2 ? 3 : -3);
        osc.connect(g);
        osc.start(t);
        osc.stop(end);
      }
    });
  }

  /** A rising build: noise sweeping up and a gliding saw underneath. */
  private riser(t: number, dur: number, gain: number): void {
    this.noise(t, { type: 'bandpass', f0: 200, f1: 5000, q: 1.6, a: dur * 0.95, d: 0.05, gain });
    this.tone(t, { f: 110, f1: 440, type: 'sawtooth', a: dur * 0.95, d: 0.05, gain: gain * 0.12 });
  }

  /** A heavy hit: sub drop, a distorted low body, a bright crack and a long tail. */
  private impact(t: number, size: number): void {
    const ctx = this.ctx!;
    this.tone(t, { f: 90 * (1.2 - size * 0.2), f1: 28, a: 0.004, d: 1.2 + size, gain: 0.6 * Math.min(1.2, size) });
    // Distorted body.
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.4);
    const sh = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 4);
    }
    sh.curve = curve;
    const g = ctx.createGain();
    this.env(g, t, 0.003, 0.25 * size, 0.5);
    o.connect(sh).connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.6);
    this.noise(t, { type: 'highpass', f0: 1500, f1: 6000, a: 0.002, d: 0.5 + size * 0.3, gain: 0.35 * size });
    this.noise(t, { type: 'lowpass', f0: 1200, f1: 120, a: 0.004, d: 1.2, gain: 0.3 * size });
  }

  /** A deep drum (taiko-like): pitched body + skin click. */
  private drum(t: number, f: number, gain: number): void {
    this.tone(t, { f: f * 1.6, f1: f, a: 0.003, d: 0.5, gain });
    this.noise(t, { type: 'bandpass', f0: 1800, q: 1.5, a: 0.001, d: 0.04, gain: gain * 0.5 });
  }

  /** Bell arpeggio into the echo. */
  private sparkle(t: number, root: number, steps: number[], gap: number, gain: number): void {
    steps.forEach((s, i) => {
      const f = root * Math.pow(2, s / 12);
      this.strike(t + i * gap, f, gain, 1.6, [1, 2.76, 5.4]);
    });
  }

  /** Metallic strike: inharmonic partials (like a struck blade or bell). */
  private strike(t: number, f: number, gain: number, decay: number, partials = [1, 2.76, 5.4, 8.93]): void {
    partials.forEach((p, i) => this.tone(t, { f: f * p, a: 0.002, d: decay / (1 + i * 0.8), gain: gain / (1 + i * 1.3) }));
  }

  // ─────────────── the sounds ───────────────

  play(kind: Sfx, opts: { pitch?: number; gain?: number; variant?: string } = {}): void {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const min = SOUND.minGapMs[kind] ?? 30;
    const nowMs = performance.now();
    if (nowMs - (this.last.get(kind) ?? -1e9) < min) return;
    this.last.set(kind, nowMs);
    const big = BIG.has(kind);
    if (!big && !this.voice(1.5)) return;
    const t = this.ctx.currentTime + 0.005;
    const p = opts.pitch ?? 1;
    const k = opts.gain ?? 1;
    switch (kind) {
      case 'cast':
        this.castSound(t, opts.variant ?? '', p, k);
        break;
      case 'hitPerfect':
        this.noise(t, { type: 'highpass', f0: 3000, a: 0.001, d: 0.05, gain: 0.35 * k });
        this.strike(t, 880 * p, 0.22 * k, 0.6);
        this.tone(t, { f: 110, f1: 60, a: 0.003, d: 0.18, gain: 0.25 * k });
        break;
      case 'hitGood':
        this.noise(t, { type: 'highpass', f0: 2200, a: 0.001, d: 0.05, gain: 0.28 * k });
        this.strike(t, 660 * p, 0.16 * k, 0.4);
        break;
      case 'kill':
        // Shatter: crisp burst + falling glassy partial + low thump.
        this.noise(t, { type: 'highpass', f0: 1800, f1: 6000, a: 0.002, d: 0.35, gain: 0.3 * k });
        this.tone(t, { f: 1400 * p, f1: 500 * p, type: 'triangle', a: 0.002, d: 0.35, gain: 0.08 * k });
        this.tone(t, { f: 95, f1: 42, a: 0.004, d: 0.4, gain: 0.35 * k });
        break;
      case 'bossHit':
        this.strike(t, 330 * p, 0.25 * k, 1.4);
        this.impact(t, 0.6 * k);
        break;
      case 'miss':
        this.noise(t, { type: 'lowpass', f0: 700, f1: 200, a: 0.02, d: 0.3, gain: 0.18 * k });
        break;
      case 'hurt':
        this.tone(t, { f: 120, f1: 55, a: 0.005, d: 0.35, gain: 0.4 * k });
        this.noise(t, { type: 'lowpass', f0: 400, a: 0.004, d: 0.25, gain: 0.3 * k });
        break;
      case 'block':
        this.strike(t, 1240 * p, 0.2 * k, 1.1, [1, 1.5, 2.98]);
        this.noise(t, { type: 'bandpass', f0: 2500, q: 8, a: 0.001, d: 0.3, gain: 0.12 * k });
        break;
      case 'seal':
        // Two-hand pose: deep bell, a choir swell and a shimmer of bells in the echo.
        this.strike(t, 196 * p, 0.32 * k, 2.6, [1, 2, 2.4, 3.01, 4.16]);
        this.choir(t, [196 * p, 293.7 * p, 392 * p], { a: 0.25, hold: 0.4, r: 1.4, gain: 0.5 * k, echo: 0.3 });
        this.sparkle(t + 0.15, 784 * p, [0, 7, 12, 19], 0.07, 0.05 * k);
        this.noise(t, { type: 'bandpass', f0: 400, f1: 2400, q: 2, a: 0.25, d: 0.5, gain: 0.12 * k });
        this.duckMusic(0.4, 0.8);
        break;
      case 'cutin':
        // Reverse swell → two drum hits → a choir stab.
        this.noise(t, { type: 'bandpass', f0: 300, f1: 3000, q: 1, a: 0.32, d: 0.06, gain: 0.3 * k });
        this.drum(t + 0.34, 62, 0.6 * k);
        this.drum(t + 0.52, 48, 0.55 * k);
        this.choir(t + 0.34, [146.8, 220, 293.7, 440], { a: 0.03, hold: 0.25, r: 1.2, gain: 0.55 * k, echo: 0.2 });
        this.tone(t + 0.34, { f: 55, f1: 30, a: 0.005, d: 1.4, gain: 0.45 * k });
        this.duckMusic(0.55, 1.4);
        break;
      case 'finish': {
        // ゼニス: a long gathering riser, a heartbeat of silence, a huge impact,
        // then a wide choir chord and bells raining down in the echo.
        const hidden = p > 1.1;
        this.riser(t, 0.95, 0.38 * k);
        this.impact(t + 1.0, hidden ? 1.3 : 1.0);
        const chord = hidden ? [130.8, 196, 261.6, 329.6, 392, 523.3] : [130.8, 196, 261.6, 329.6, 392];
        this.choir(t + 1.02, chord, { a: 0.35, hold: 1.2, r: 2.6, gain: 0.75 * k, echo: 0.35 });
        this.sparkle(t + 1.1, 523.3, hidden ? [0, 4, 7, 12, 16, 19, 24, 28] : [0, 4, 7, 12, 16, 19], 0.09, 0.07 * k);
        this.drum(t + 1.0, 50, 0.7 * k);
        this.drum(t + 1.45, 45, 0.5 * k);
        this.duckMusic(0.85, 3.5);
        break;
      }
      case 'hiddenBoss':
        // Something wrong: a dark dissonant choir, a low brass-like swell and a heartbeat.
        this.choir(t, [61.7, 65.4, 92.5, 98], { a: 1.0, hold: 0.8, r: 1.8, gain: 0.6 * k, echo: 0.2 });
        for (const f of [41.2, 43.65]) this.tone(t, { f, a: 1.0, d: 2.2, gain: 0.2 * k, type: 'sawtooth' });
        for (const dt of [0.3, 0.55, 1.3, 1.55, 2.3, 2.55]) this.drum(t + dt, 40, 0.35 * k);
        this.noise(t, { type: 'lowpass', f0: 150, f1: 900, a: 1.2, d: 0.8, gain: 0.25 * k });
        this.duckMusic(0.8, 3);
        break;
      case 'combo':
        [0, 0.07, 0.14].forEach((dt, i) => this.strike(t + dt, 523.3 * Math.pow(1.26, i) * p, 0.08 * k, 0.9, [1, 2.76]));
        this.choir(t, [523.3 * p, 659.3 * p], { a: 0.05, hold: 0.1, r: 0.6, gain: 0.18 * k, echo: 0.3 });
        break;
      case 'section':
        this.strike(t, 147 * p, 0.22 * k, 2.6, [1, 2.01, 2.71, 3.9]);
        if (p < 1) {
          // Boss: drums announce it.
          this.drum(t, 55, 0.6 * k);
          this.drum(t + 0.22, 55, 0.45 * k);
          this.drum(t + 0.44, 41, 0.65 * k);
        }
        break;
      case 'spawn':
        this.noise(t, { type: 'bandpass', f0: 2400, f1: 900, q: 3, a: 0.06, d: 0.3, gain: 0.06 * k });
        break;
      case 'select':
        this.strike(t, 1046 * p, 0.05 * k, 0.25, [1, 2.76]);
        break;
      case 'confirm':
        this.strike(t, 523.3 * p, 0.14 * k, 1.2, [1, 2, 3.01]);
        this.strike(t + 0.08, 784 * p, 0.1 * k, 1.2, [1, 2, 3.01]);
        break;
      case 'key':
        this.noise(t, { type: 'bandpass', f0: 3000 * p, q: 6, a: 0.001, d: 0.04, gain: 0.12 * k });
        break;
      case 'results':
        for (const [i, f] of [196, 293.7, 392].entries()) this.strike(t + i * 0.12, f * p, 0.12 * k, 2.2, [1, 2, 3.01]);
        this.choir(t + 0.2, [196, 246.9, 293.7, 392], { a: 0.4, hold: 0.6, r: 1.6, gain: 0.35 * k, echo: 0.2 });
        break;
    }
  }

  /** Each technique family sounds different when it is cast. */
  private castSound(t: number, effect: string, p: number, k: number): void {
    switch (effect) {
      case 'beam':
      case 'twinbeam':
        // A laser: a saw zap falling in pitch, with a bright edge.
        this.tone(t, { f: 2400 * p, f1: 300 * p, type: 'sawtooth', a: 0.003, d: 0.22, gain: 0.07 * k });
        if (effect === 'twinbeam') this.tone(t + 0.04, { f: 2000 * p, f1: 260 * p, type: 'sawtooth', a: 0.003, d: 0.2, gain: 0.06 * k });
        this.noise(t, { type: 'highpass', f0: 4000, a: 0.002, d: 0.12, gain: 0.12 * k });
        break;
      case 'lightning':
        // Crackle: a burst of tiny clicks and a low rumble.
        for (let i = 0; i < 6; i++) this.noise(t + i * 0.025, { type: 'bandpass', f0: 3000 + i * 700, q: 2, a: 0.001, d: 0.03, gain: 0.18 * k });
        this.tone(t, { f: 70, f1: 40, a: 0.01, d: 0.5, gain: 0.25 * k });
        break;
      case 'wave':
      case 'nova':
      case 'shock':
        // A deep whoosh spreading out.
        this.noise(t, { type: 'lowpass', f0: 300, f1: 1400, q: 1, a: 0.06, d: 0.45, gain: 0.3 * k });
        this.tone(t, { f: 140, f1: 70, a: 0.01, d: 0.35, gain: 0.2 * k });
        break;
      case 'slash':
      case 'cross':
        // A blade swish: a quick bright sweep.
        this.noise(t, { type: 'bandpass', f0: 1200 * p, f1: 6000 * p, q: 3, a: 0.04, d: 0.12, gain: 0.3 * k });
        if (effect === 'cross') this.noise(t + 0.08, { type: 'bandpass', f0: 1500 * p, f1: 6500 * p, q: 3, a: 0.04, d: 0.12, gain: 0.25 * k });
        break;
      case 'bullet':
      case 'hook':
        // A tight pop.
        this.tone(t, { f: 900 * p, f1: 200 * p, type: 'triangle', a: 0.002, d: 0.08, gain: 0.18 * k });
        this.noise(t, { type: 'bandpass', f0: 2500, q: 3, a: 0.001, d: 0.05, gain: 0.15 * k });
        break;
      case 'bind':
        // A whirring tighten.
        this.tone(t, { f: 300 * p, f1: 900 * p, type: 'square', a: 0.02, d: 0.25, gain: 0.04 * k });
        this.noise(t, { type: 'bandpass', f0: 1600, f1: 3200, q: 6, a: 0.02, d: 0.25, gain: 0.1 * k });
        break;
      case 'burst':
      case 'flare':
        // A warm whoomp that flares up.
        this.noise(t, { type: 'lowpass', f0: 500, f1: 3000, a: 0.05, d: 0.3, gain: 0.3 * k });
        this.tone(t, { f: 220 * p, f1: 440 * p, a: 0.03, d: 0.3, gain: 0.08 * k });
        break;
      case 'sigil':
        // A drawn sigil: a bright chime arpeggio.
        this.sparkle(t, 659.3 * p, [0, 5, 12], 0.05, 0.08 * k);
        this.noise(t, { type: 'bandpass', f0: 800, f1: 3000, q: 1.4, a: 0.03, d: 0.25, gain: 0.18 * k });
        break;
      default:
        // Airy whoosh rising.
        this.noise(t, { type: 'bandpass', f0: 600 * p, f1: 2600 * p, q: 1.4, a: 0.03, d: 0.22, gain: 0.25 * k });
    }
  }

}
