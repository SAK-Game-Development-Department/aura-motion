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

  /** Metallic strike: inharmonic partials (like a struck blade or bell). */
  private strike(t: number, f: number, gain: number, decay: number, partials = [1, 2.76, 5.4, 8.93]): void {
    partials.forEach((p, i) => this.tone(t, { f: f * p, a: 0.002, d: decay / (1 + i * 0.8), gain: gain / (1 + i * 1.3) }));
  }

  // ─────────────── the sounds ───────────────

  play(kind: Sfx, opts: { pitch?: number; gain?: number } = {}): void {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const min = SOUND.minGapMs[kind] ?? 30;
    const nowMs = performance.now();
    if (nowMs - (this.last.get(kind) ?? -1e9) < min) return;
    this.last.set(kind, nowMs);
    if (!this.voice(1.5)) return;
    const t = this.ctx.currentTime + 0.005;
    const p = opts.pitch ?? 1;
    const k = opts.gain ?? 1;
    switch (kind) {
      case 'cast':
        // Airy whoosh rising.
        this.noise(t, { type: 'bandpass', f0: 600 * p, f1: 2600 * p, q: 1.4, a: 0.03, d: 0.22, gain: 0.25 * k });
        break;
      case 'hitPerfect':
        this.noise(t, { type: 'highpass', f0: 3000, a: 0.001, d: 0.05, gain: 0.35 * k });
        this.strike(t, 880 * p, 0.22 * k, 0.6);
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
        this.tone(t, { f: 70, f1: 38, a: 0.004, d: 0.6, gain: 0.4 * k });
        this.noise(t, { type: 'lowpass', f0: 900, a: 0.003, d: 0.4, gain: 0.25 * k });
        break;
      case 'miss':
        // A muffled, falling breath.
        this.noise(t, { type: 'lowpass', f0: 700, f1: 200, a: 0.02, d: 0.3, gain: 0.18 * k });
        break;
      case 'hurt':
        this.tone(t, { f: 120, f1: 55, a: 0.005, d: 0.35, gain: 0.4 * k });
        this.noise(t, { type: 'lowpass', f0: 400, a: 0.004, d: 0.25, gain: 0.3 * k });
        break;
      case 'block':
        // Shield: a clear ringing "ting".
        this.strike(t, 1240 * p, 0.2 * k, 1.1, [1, 1.5, 2.98]);
        break;
      case 'seal':
        // A deep bell with a soft swell.
        this.strike(t, 196 * p, 0.3 * k, 2.4, [1, 2, 2.4, 3.01, 4.16]);
        this.noise(t, { type: 'bandpass', f0: 400, f1: 1600, q: 2, a: 0.25, d: 0.5, gain: 0.12 * k });
        break;
      case 'cutin':
        // Reverse swell into a low boom.
        this.noise(t, { type: 'bandpass', f0: 300, f1: 2400, q: 1, a: 0.35, d: 0.08, gain: 0.25 * k });
        this.tone(t + 0.35, { f: 60, f1: 35, a: 0.005, d: 1.0, gain: 0.45 * k });
        break;
      case 'finish':
        // Gather → release: rising air, then a deep impact and a long shimmering chord.
        this.noise(t, { type: 'bandpass', f0: 200, f1: 3000, q: 1.2, a: 0.9, d: 0.1, gain: 0.3 * k });
        this.tone(t + 0.9, { f: 55, f1: 30, a: 0.005, d: 1.6, gain: 0.55 * k });
        for (const f of [261.6, 392, 523.3, 784]) this.tone(t + 0.95, { f, a: 0.4, d: 2.6, gain: 0.06 * k });
        break;
      case 'hiddenBoss':
        // A dissonant low swell (something is wrong).
        for (const f of [41.2, 43.65, 87.3]) this.tone(t, { f, a: 1.0, d: 1.8, gain: 0.18 * k, type: 'triangle' });
        this.noise(t, { type: 'lowpass', f0: 150, f1: 900, a: 1.2, d: 0.8, gain: 0.25 * k });
        break;
      case 'combo':
        // Soft rising chime.
        [0, 0.07, 0.14].forEach((dt, i) => this.strike(t + dt, 523.3 * Math.pow(1.26, i) * p, 0.08 * k, 0.9, [1, 2.76]));
        break;
      case 'section':
        this.strike(t, 147 * p, 0.22 * k, 2.6, [1, 2.01, 2.71, 3.9]);
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
        break;
    }
  }
}
