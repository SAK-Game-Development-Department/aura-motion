// Background music, composed live: every stage has its own key, scale, chord
// loop and instruments, played on the stage's own tempo and aligned to the
// beat grid the spirits arrive on. Sections add layers (intro: pad + sparse
// harp → rush: bass and drums → guard: tension → boss: everything → hidden boss:
// its own dark piece). Synthesized with Web Audio (no audio files); patterns
// come from a seeded Rng so a stage always sounds like itself.
import { Rng } from '../core/rng';
import type { Sound } from './sound';

type Lead = 'harp' | 'bell' | 'glass' | 'koto' | 'pluck';
type Pad = 'warm' | 'glass' | 'dark' | 'airy';
type Bass = 'sub' | 'pulse' | 'drive';
type Perc = 'none' | 'soft' | 'taiko' | 'pulse' | 'heart';

export interface Song {
  /** MIDI note of the key. */
  root: number;
  scale: readonly number[];
  /** Chord roots (scale degrees), one per bar. */
  prog: readonly number[];
  pad: Pad;
  lead: Lead;
  bass: Bass;
  perc: Perc;
  /** Arpeggio pattern over the chord (16ths): index into chord tones (+3 = octave up), -1 rest. */
  arp: readonly number[];
  /** Tempo for menus (in play the stage's tempo is used). */
  bpm: number;
}

const SC = {
  dorian: [0, 2, 3, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
  phrygDom: [0, 1, 4, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
} as const;

const R = -1;
export const SONGS: Record<string, Song> = {
  title: { root: 50, scale: SC.dorian, prog: [0, 5, 3, 4], pad: 'warm', lead: 'harp', bass: 'sub', perc: 'none', arp: [0, R, 2, R, 1, R, 3, R, 2, R, 1, R, 4, R, 2, R], bpm: 72 },
  results: { root: 53, scale: SC.major, prog: [0, 3, 4, 0], pad: 'airy', lead: 'bell', bass: 'sub', perc: 'none', arp: [0, R, R, 2, R, R, 4, R, 3, R, R, 1, R, R, 2, R], bpm: 66 },
  yoi: { root: 50, scale: SC.dorian, prog: [0, 6, 5, 3], pad: 'warm', lead: 'harp', bass: 'sub', perc: 'soft', arp: [0, 2, 4, 2, 3, 2, 1, 2, 0, 2, 4, 5, 4, 2, 1, 2], bpm: 76 },
  shinkai: { root: 45, scale: SC.minor, prog: [0, 5, 6, 4], pad: 'dark', lead: 'glass', bass: 'sub', perc: 'heart', arp: [0, R, R, 4, R, R, 2, R, 3, R, R, 1, R, 5, R, R], bpm: 74 },
  setsugetsu: { root: 52, scale: SC.lydian, prog: [0, 1, 0, 4], pad: 'airy', lead: 'bell', bass: 'sub', perc: 'soft', arp: [3, R, 4, R, 2, R, 4, R, 5, R, 4, R, 2, R, 1, R], bpm: 76 },
  hoshi: { root: 48, scale: SC.lydian, prog: [0, 4, 5, 1], pad: 'glass', lead: 'pluck', bass: 'pulse', perc: 'pulse', arp: [0, 1, 2, 3, 2, 1, 2, 4, 0, 1, 2, 3, 5, 4, 2, 1], bpm: 90 },
  raimei: { root: 42, scale: SC.phrygian, prog: [0, 1, 0, 6], pad: 'dark', lead: 'koto', bass: 'drive', perc: 'taiko', arp: [0, R, 0, 2, R, 1, R, 3, 0, R, 0, 2, 4, R, 3, R], bpm: 90 },
  hanagasumi: { root: 55, scale: SC.major, prog: [0, 3, 4, 5], pad: 'airy', lead: 'koto', bass: 'sub', perc: 'soft', arp: [0, R, 2, 1, R, 3, R, 2, 4, R, 3, R, 2, 1, R, R], bpm: 88 },
  guren: { root: 48, scale: SC.harmonic, prog: [0, 5, 4, 0], pad: 'dark', lead: 'pluck', bass: 'drive', perc: 'taiko', arp: [0, 2, 1, 3, 2, 4, 3, 2, 0, 2, 1, 3, 5, 4, 3, 1], bpm: 104 },
  gesshoku: { root: 47, scale: SC.minor, prog: [0, 5, 1, 4], pad: 'dark', lead: 'bell', bass: 'sub', perc: 'heart', arp: [0, R, R, R, 2, R, R, 1, R, R, 3, R, R, R, 2, R], bpm: 104 },
  kokuu: { root: 40, scale: SC.phrygDom, prog: [0, 1, 6, 0], pad: 'dark', lead: 'pluck', bass: 'drive', perc: 'pulse', arp: [0, 1, 2, 1, 3, 2, 1, 2, 0, 1, 2, 4, 3, 2, 1, 2], bpm: 106 },
  hidden: { root: 40, scale: SC.locrian, prog: [0, 1, 0, 4], pad: 'dark', lead: 'bell', bass: 'drive', perc: 'heart', arp: [0, R, 1, R, R, 4, R, R, 0, R, 1, R, 5, R, R, R], bpm: 100 },
};

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

interface Playing {
  song: Song;
  name: string;
  gain: GainNode;
  /** perf-clock time of step 0 and the 16th length (ms). */
  anchor: number;
  stepMs: number;
  next: number;
  seed: number;
}

export class Music {
  private cur: Playing | null = null;
  private want: { name: string; intensity: number; beatMs: number | null; anchor: number } | null = null;
  intensity = 0;

  constructor(private sound: Sound) {}

  /**
   * Play `name` (a stage id, or title / results / hidden). In play pass the
   * stage's beat length and the time of game time 0 so the music sits on the
   * same beats as the spirits.
   */
  set(name: string, intensity: number, beat?: { beatMs: number; anchor: number }): void {
    this.intensity = intensity;
    if (this.want && this.want.name === name && this.want.beatMs === (beat?.beatMs ?? null) && this.want.anchor === (beat?.anchor ?? this.want.anchor)) return;
    this.want = { name, intensity, beatMs: beat?.beatMs ?? null, anchor: beat?.anchor ?? -1 };
    this.cur = null; // re-created on the next tick (cross-faded)
  }

  stop(): void {
    this.want = null;
  }

  /** Call every frame with the perf clock. Schedules notes a little ahead. */
  tick(now: number): void {
    const a = this.sound.audio;
    if (!a) return;
    if (!this.want) {
      if (this.cur) this.fadeOut(this.cur, a.ctx);
      this.cur = null;
      return;
    }
    if (!this.cur) {
      const song = SONGS[this.want.name] ?? SONGS.title!;
      const beatMs = this.want.beatMs ?? 60000 / song.bpm;
      const gain = a.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, a.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(1, a.ctx.currentTime + 1.5);
      gain.connect(a.out);
      const old = this.playing;
      if (old) this.fadeOut(old, a.ctx);
      const anchor = this.want.anchor >= 0 ? this.want.anchor : now;
      const stepMs = beatMs / 4;
      this.cur = { song, name: this.want.name, gain, anchor, stepMs, next: Math.max(0, Math.ceil((now - anchor) / stepMs)), seed: hashName(this.want.name) };
      this.playing = this.cur;
    }
    const c = this.cur;
    // Map perf time → audio time.
    const toCtx = (ms: number) => a.ctx.currentTime + (ms - now) / 1000;
    const horizon = now + 250;
    // After a stall never try to catch up a whole backlog.
    const behind = Math.floor((now - c.anchor) / c.stepMs);
    if (c.next < behind - 2) c.next = behind;
    while (c.anchor + c.next * c.stepMs < horizon) {
      const tMs = c.anchor + c.next * c.stepMs;
      if (tMs >= now - 5) this.step(c, c.next, Math.max(a.ctx.currentTime + 0.01, toCtx(tMs)), a);
      c.next++;
    }
  }

  private playing: Playing | null = null;

  private fadeOut(p: Playing, ctx: AudioContext): void {
    const t = ctx.currentTime;
    p.gain.gain.cancelScheduledValues(t);
    p.gain.gain.setTargetAtTime(0.0001, t, 0.5);
    setTimeout(() => p.gain.disconnect(), 3000);
  }

  // ─────────────── arrangement ───────────────

  private step(p: Playing, i: number, t: number, a: NonNullable<Sound['audio']>): void {
    const s = p.song;
    const L = this.intensity;
    const stepInBar = i % 16;
    const bar = Math.floor(i / 16);
    const deg = s.prog[bar % s.prog.length]!;
    const chord = this.chord(s, deg, L >= 3 ? -12 : 0);
    const beatS = (p.stepMs * 4) / 1000;
    const rng = new Rng((p.seed ^ (bar * 2654435761)) >>> 0);
    // Pad: one chord per bar.
    if (stepInBar === 0) this.pad(a, t, chord, beatS * 4, s.pad, L);
    // Lead arpeggio: sparse in the intro, full from the rush, doubled at the boss.
    const ai = s.arp[stepInBar]!;
    const sparse = L < 1 && stepInBar % 2 === 1;
    if (ai >= 0 && !sparse && !(L < 1 && rng.chance(0.25))) {
      const n = this.tone(chord, ai);
      this.lead(a, t, mtof(n + 12), s.lead, 0.9);
      if (L >= 3 && stepInBar % 4 === 0) this.lead(a, t, mtof(n + 24), s.lead, 0.45);
    }
    // Bass from the rush on.
    if (L >= 1) {
      const root = chord[0]! - 12;
      if (s.bass === 'sub' && stepInBar % 8 === 0) this.bass(a, t, mtof(root), 'sub', beatS * 2);
      if (s.bass === 'pulse' && stepInBar % 2 === 0) this.bass(a, t, mtof(root + (stepInBar % 8 === 6 ? 7 : 0)), 'pulse', beatS * 0.45);
      if (s.bass === 'drive' && (stepInBar % 4 === 0 || stepInBar % 4 === 3)) this.bass(a, t, mtof(root), 'drive', beatS * 0.6);
    }
    // Drums.
    if (L >= 1 || s.perc === 'heart') this.perc(a, t, s.perc, stepInBar, L, rng);
  }

  private chord(s: Song, deg: number, shift: number): number[] {
    const sc = s.scale;
    const at = (d: number) => s.root + shift + sc[((d % sc.length) + sc.length) % sc.length]! + 12 * Math.floor(d / sc.length);
    return [at(deg), at(deg + 2), at(deg + 4)];
  }

  private tone(chord: number[], idx: number): number {
    return chord[idx % 3]! + 12 * Math.floor(idx / 3);
  }

  // ─────────────── instruments ───────────────

  private out(a: NonNullable<Sound['audio']>): AudioNode {
    return this.cur?.gain ?? a.out;
  }

  private env(g: GainNode, t: number, at: number, peak: number, dec: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + at);
    g.gain.exponentialRampToValueAtTime(0.0001, t + at + dec);
  }

  private pad(a: NonNullable<Sound['audio']>, t: number, chord: number[], dur: number, color: Pad, L: number): void {
    const { ctx } = a;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = color === 'dark' ? 600 : color === 'warm' ? 1100 : color === 'glass' ? 2600 : 1800;
    lp.Q.value = 0.8;
    const g = ctx.createGain();
    const peak = 0.05 + Math.min(L, 3) * 0.01;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + Math.min(1.2, dur * 0.3));
    g.gain.setValueAtTime(peak, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.25);
    lp.connect(g).connect(this.out(a));
    for (const m of chord) {
      for (const det of color === 'glass' ? [0] : [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = color === 'glass' ? 'sine' : color === 'airy' ? 'triangle' : 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = det;
        const og = ctx.createGain();
        og.gain.value = color === 'glass' ? 0.5 : 0.22;
        o.connect(og).connect(lp);
        o.start(t);
        o.stop(t + dur * 1.3);
      }
    }
  }

  private lead(a: NonNullable<Sound['audio']>, t: number, f: number, kind: Lead, vol: number): void {
    const { ctx } = a;
    const g = ctx.createGain();
    const send = ctx.createGain();
    send.gain.value = 0.35;
    g.connect(this.out(a));
    g.connect(send).connect(a.echo);
    const osc = (type: OscillatorType, fr: number, gain: number, dec: number) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = fr;
      const og = ctx.createGain();
      this.env(og, t, 0.004, gain, dec);
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + dec + 0.05);
      return o;
    };
    g.gain.value = vol;
    switch (kind) {
      case 'harp': {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 3200;
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        const og = ctx.createGain();
        this.env(og, t, 0.003, 0.11, 1.3);
        o.connect(lp).connect(og).connect(g);
        o.start(t);
        o.stop(t + 1.4);
        osc('sine', f * 2, 0.03, 0.6);
        break;
      }
      case 'bell':
        osc('sine', f, 0.08, 1.6);
        osc('sine', f * 2.76, 0.025, 0.7);
        osc('sine', f * 5.4, 0.012, 0.35);
        break;
      case 'glass':
        osc('sine', f, 0.07, 2.2);
        osc('sine', f * 2.01, 0.025, 1.2);
        break;
      case 'koto': {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f * 1.012, t);
        o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(4500, t);
        lp.frequency.exponentialRampToValueAtTime(500, t + 0.35);
        const og = ctx.createGain();
        this.env(og, t, 0.002, 0.07, 0.7);
        o.connect(lp).connect(og).connect(g);
        o.start(t);
        o.stop(t + 0.8);
        break;
      }
      case 'pluck': {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = f;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(2600, t);
        lp.frequency.exponentialRampToValueAtTime(400, t + 0.25);
        const og = ctx.createGain();
        this.env(og, t, 0.002, 0.045, 0.32);
        o.connect(lp).connect(og).connect(g);
        o.start(t);
        o.stop(t + 0.4);
        break;
      }
    }
  }

  private bass(a: NonNullable<Sound['audio']>, t: number, f: number, kind: Bass, dur: number): void {
    const { ctx } = a;
    const o = ctx.createOscillator();
    o.type = kind === 'sub' ? 'sine' : kind === 'pulse' ? 'triangle' : 'sawtooth';
    o.frequency.value = f;
    const g = ctx.createGain();
    this.env(g, t, 0.01, kind === 'sub' ? 0.22 : kind === 'pulse' ? 0.16 : 0.1, dur);
    if (kind === 'drive') {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      lp.Q.value = 3;
      o.connect(lp).connect(g);
    } else o.connect(g);
    g.connect(this.out(a));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private hit(a: NonNullable<Sound['audio']>, t: number, f0: number, f1: number, gain: number, dec: number): void {
    const { ctx } = a;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dec);
    const g = ctx.createGain();
    this.env(g, t, 0.002, gain, dec);
    o.connect(g).connect(this.out(a));
    o.start(t);
    o.stop(t + dec + 0.05);
  }

  private noise(a: NonNullable<Sound['audio']>, t: number, type: BiquadFilterType, f: number, gain: number, dec: number): void {
    const { ctx } = a;
    const s = ctx.createBufferSource();
    s.buffer = a.noise;
    const fl = ctx.createBiquadFilter();
    fl.type = type;
    fl.frequency.value = f;
    const g = ctx.createGain();
    this.env(g, t, 0.001, gain, dec);
    s.connect(fl).connect(g).connect(this.out(a));
    s.start(t, (t * 7.3) % 1.5);
    s.stop(t + dec + 0.05);
  }

  private perc(a: NonNullable<Sound['audio']>, t: number, kind: Perc, st: number, L: number, rng: Rng): void {
    const full = L >= 3;
    switch (kind) {
      case 'soft':
        if (st === 0 || st === 8) this.hit(a, t, 110, 48, 0.22, 0.25);
        if (st % 4 === 2 && (full || rng.chance(0.6))) this.noise(a, t, 'highpass', 7000, 0.035, 0.04);
        if (full && st === 12) this.hit(a, t, 110, 48, 0.18, 0.2);
        break;
      case 'taiko':
        if (st === 0 || st === 6 || st === 10) this.hit(a, t, 95, 52, 0.4, 0.4);
        if (st === 8 || (full && st === 14)) this.hit(a, t, 160, 90, 0.25, 0.25);
        if (full && st % 2 === 1 && rng.chance(0.4)) this.noise(a, t, 'bandpass', 2400, 0.05, 0.03);
        break;
      case 'pulse':
        if (st % 4 === 0) this.hit(a, t, 120, 45, 0.32, 0.22);
        if (st % 8 === 4) this.noise(a, t, 'bandpass', 1600, 0.12, 0.12);
        if (st % 2 === 1 || full) this.noise(a, t, 'highpass', 8000, full ? 0.04 : 0.025, 0.03);
        break;
      case 'heart':
        // A slow heartbeat (always on, even in the intro — quiet).
        if (st === 0) this.hit(a, t, 70, 40, L >= 1 ? 0.35 : 0.18, 0.25);
        if (st === 3) this.hit(a, t, 70, 40, L >= 1 ? 0.22 : 0.1, 0.2);
        if (full && (st === 8 || st === 11)) this.hit(a, t, 70, 40, 0.25, 0.2);
        break;
      case 'none':
        break;
    }
  }
}

function hashName(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
