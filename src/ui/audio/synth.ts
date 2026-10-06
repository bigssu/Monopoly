/**
 * Sound engine for every `SfxName`: generated samples when loaded, a Web Audio synthesizer otherwise.
 *
 * Graph: voice → per-play gain → sfx bus (ducked under the dealer) → master (volume/mute) → soft
 * compressor → destination. The dealer's voice (audio/voice.ts) plays straight into the master;
 * music (audio/music.ts) has its own bus under the master, ducked with the SFX.
 *
 * Generated samples (public/sfx, docs/superpowers/specs/2026-10-04-sound-design.md) replace the
 * synthesized voices name by name once decoded; until then (or if one is missing) the synth plays.
 * All sounds are scheduled on `ctx.currentTime`, short, and disconnect themselves.
 */
import type { Sfx, SfxName, SfxOpts } from './sfx';

type Wave = OscillatorType;

interface ToneOpts {
  f: number;
  /** Glide target frequency. */
  f2?: number;
  /** Glide time (defaults to the whole duration). */
  glide?: number;
  t: number;
  d: number;
  type?: Wave;
  g?: number;
  /** Attack seconds. */
  a?: number;
  detune?: number;
  /** Low-pass cutoff (Hz). */
  lp?: number;
  /** Low-pass cutoff envelope: start → lp over `lpT`. */
  lp0?: number;
  lpT?: number;
  vib?: { rate: number; depth: number; delay?: number };
  /** Hold at full level before the decay (fraction of d). */
  hold?: number;
}

interface NoiseOpts {
  t: number;
  d: number;
  g?: number;
  a?: number;
  type?: BiquadFilterType;
  f?: number;
  f2?: number;
  q?: number;
}

/** Minimum spacing between two plays of the same sound (seconds). */
export const THROTTLE: Partial<Record<SfxName, number>> = {
  tap: 0.03,
  hop: 0.03,
  'timer-tick': 0.08,
  'dice-shake': 0.09,
  // A throw plays at most three, at least 60 ms apart (throw.ts).
  'dice-clack': 0.05,
  'cash-in': 0.05,
  'cash-out': 0.05,
  toll: 0.05,
  // Money events: the ONE gate for clinks is the coin scheduler (fx/money/sound.ts: ≥ 25 ms, 6
  // voices); a second throttle here on the quantized audio clock would drop clinks it accepted.
  'coin-clink': 0,
  'coin-thud': 0.1,
  'coin-break': 0.06,
  sob: 0.5,
};
export const DEFAULT_THROTTLE = 0.04;

// Note frequencies.
const N = {
  C4: 261.63, E4: 329.63, F4: 349.23, Fs4: 369.99, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.0, B5: 987.77,
  C6: 1046.5, E6: 1318.51, G6: 1567.98, Gs6: 1661.22, A6: 1760.0, B6: 1975.53, C7: 2093.0, E7: 2637.02, G7: 3135.96, A7: 3520.0,
};

export class SynthSfx implements Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  /** Decoded sample takes per name (filled by loadSamples). */
  private samples = new Map<SfxName, AudioBuffer[]>();
  private samplesRequested = false;
  private noiseBuf: AudioBuffer | null = null;
  private muted = false;
  private volume = 0.8;
  private last = new Map<SfxName, number>();
  private failed = false;

  // ------------------------------------------------------------------ facade

  unlock(): void {
    const c = this.prepare();
    if (c && c.state !== 'running') void c.resume().catch(() => undefined);
  }

  /**
   * Build the audio context and load the samples. Called once at boot, while nothing is on screen
   * to stutter: constructing an AudioContext opens the audio device and blocks the main thread
   * (60-320 ms measured), which used to happen inside the first tap. The context stays suspended
   * until a gesture resumes it (`unlock`); Chrome may log an autoplay notice for it, harmlessly.
   */
  prepare(): AudioContext | null {
    const c = this.ensure();
    if (c && !this.samplesRequested) {
      this.samplesRequested = true;
      void this.loadSamples(c);
    }
    return c;
  }

  /** Fetch + decode every generated sample listed in sfx/manifest.json (name → takes). */
  private async loadSamples(c: AudioContext): Promise<void> {
    let manifest: Record<string, number>;
    try {
      const r = await fetch('sfx/manifest.json');
      if (!r.ok) return;
      manifest = (await r.json()) as Record<string, number>;
    } catch {
      return;
    }
    await Promise.all(
      Object.entries(manifest).map(async ([name, takes]) => {
        const files = takes > 1 ? Array.from({ length: takes }, (_, k) => `sfx/${name}.${k + 1}.ogg`) : [`sfx/${name}.ogg`];
        const bufs = await Promise.all(
          files.map((f) =>
            fetch(f)
              .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(f))))
              .then((b) => c.decodeAudioData(b))
              .catch(() => null),
          ),
        );
        const ok = bufs.filter((b): b is AudioBuffer => b !== null);
        if (ok.length) this.samples.set(name as SfxName, ok);
      }),
    );
  }

  /** Where background music plays (shared context, under the master volume). */
  musicOut(): { ctx: AudioContext; node: AudioNode } | null {
    const c = this.ctx;
    return c && this.musicBus ? { ctx: c, node: this.musicBus } : null;
  }

  /** Pause output while the app is in the background. */
  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend().catch(() => undefined);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGain();
  }

  isMuted(): boolean {
    return this.muted;
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    this.applyGain();
  }

  play(name: SfxName, opts: SfxOpts = {}): void {
    if (this.muted || this.volume <= 0) return;
    // Silent until a gesture has resumed the context (unlock).
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const now = c.currentTime;
    const gap = THROTTLE[name] ?? DEFAULT_THROTTLE;
    const prev = this.last.get(name);
    if (prev !== undefined && now - prev < gap) return;
    this.last.set(name, now);

    const out = c.createGain();
    out.gain.value = Math.max(0, opts.gain ?? 1);
    out.connect(this.sfxBus!);
    const p = opts.pitch && opts.pitch > 0 ? opts.pitch : 1;
    const takes = this.samples.get(name);
    if (takes?.length) {
      // A generated take (random among them, so repeats do not tire the ear); pitch = rate.
      const src = c.createBufferSource();
      src.buffer = takes[Math.floor(Math.random() * takes.length)]!;
      src.playbackRate.value = p;
      src.connect(out);
      src.onended = () => out.disconnect();
      src.start(now + 0.004);
      return;
    }
    let len = 0.5;
    try {
      len = this.voice(name, now + 0.008, p, out, opts.variant ?? 0);
    } catch (e) {
      console.warn('[sfx]', name, e);
    }
    setTimeout(() => out.disconnect(), (len + 0.3) * 1000);
  }

  /** Where the dealer's voice plays (shared context + volume), once unlocked and running. */
  voiceOut(): { ctx: AudioContext; node: AudioNode } | null {
    const c = this.ctx;
    return c && this.master && c.state === 'running' && !this.muted && this.volume > 0 ? { ctx: c, node: this.master } : null;
  }

  /** Lower the sound effects while the dealer talks. */
  duck(on: boolean): void {
    if (!this.sfxBus || !this.ctx) return;
    this.sfxBus.gain.setTargetAtTime(on ? 0.45 : 1, this.ctx.currentTime, 0.08);
    this.musicBus?.gain.setTargetAtTime(on ? 0.35 : 1, this.ctx.currentTime, 0.12);
  }

  // ------------------------------------------------------------------ setup

  private ensure(): AudioContext | null {
    if (this.ctx || this.failed) return this.ctx;
    const AC: typeof AudioContext | undefined =
      typeof window === 'undefined'
        ? undefined
        : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!AC) {
      this.failed = true;
      return null;
    }
    try {
      const c = new AC({ latencyHint: 'interactive' });
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 14;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      comp.connect(c.destination);
      const master = c.createGain();
      master.connect(comp);
      const bus = c.createGain();
      bus.connect(master);
      const music = c.createGain();
      music.connect(master);
      const buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.ctx = c;
      this.master = master;
      this.sfxBus = bus;
      this.musicBus = music;
      this.noiseBuf = buf;
      this.applyGain();
      return c;
    } catch {
      this.failed = true;
      return null;
    }
  }

  private applyGain(): void {
    if (!this.master || !this.ctx) return;
    // Perceptual curve; 0.9 headroom so stacked voices stay under the compressor knee.
    const v = this.muted ? 0 : 0.9 * this.volume * this.volume;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  // ------------------------------------------------------------------ primitives

  /**
   * Clamp a frequency into the nominal range of AudioParams (0 < f ≤ min(20 kHz, ~Nyquist)).
   * Pitched-up voices (hop pitch, pluck filter at f × 8…) would otherwise exceed it and Chrome
   * logs an "outside nominal range" warning per node.
   */
  private hz(f: number): number {
    const top = Math.min(20000, this.ctx!.sampleRate * 0.49);
    return Math.min(top, Math.max(1, f));
  }

  private tone(o: ToneOpts, out: AudioNode): void {
    const c = this.ctx!;
    // Partials above ~16 kHz are inaudible on tablet speakers and alias near Nyquist.
    const ceiling = Math.min(16000, c.sampleRate * 0.45);
    if (o.f >= ceiling) return;
    const osc = c.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(this.hz(o.f), o.t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.min(ceiling, this.hz(o.f2)), o.t + (o.glide ?? o.d));
    if (o.detune) osc.detune.value = o.detune;
    const env = c.createGain();
    const g = o.g ?? 0.3;
    const a = o.a ?? 0.005;
    env.gain.setValueAtTime(0.0001, o.t);
    env.gain.linearRampToValueAtTime(g, o.t + a);
    const holdEnd = o.t + a + (o.hold ?? 0) * o.d;
    if (o.hold) env.gain.setValueAtTime(g, holdEnd);
    env.gain.exponentialRampToValueAtTime(0.0001, o.t + o.d);
    let node: AudioNode = osc;
    const nodes: AudioNode[] = [osc, env];
    if (o.lp) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 0.8;
      if (o.lp0) {
        f.frequency.setValueAtTime(this.hz(o.lp0), o.t);
        f.frequency.exponentialRampToValueAtTime(this.hz(o.lp), o.t + (o.lpT ?? o.d));
      } else f.frequency.value = this.hz(o.lp);
      node.connect(f);
      node = f;
      nodes.push(f);
    }
    if (o.vib) {
      const lfo = c.createOscillator();
      const depth = c.createGain();
      lfo.frequency.value = o.vib.rate;
      depth.gain.setValueAtTime(0, o.t);
      depth.gain.linearRampToValueAtTime(o.vib.depth, o.t + (o.vib.delay ?? 0.05));
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(o.t);
      lfo.stop(o.t + o.d + 0.05);
      nodes.push(lfo, depth);
    }
    node.connect(env).connect(out);
    osc.start(o.t);
    osc.stop(o.t + o.d + 0.05);
    osc.onended = () => nodes.forEach((n) => n.disconnect());
  }

  private noise(o: NoiseOpts, out: AudioNode): void {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filt = c.createBiquadFilter();
    filt.type = o.type ?? 'bandpass';
    filt.Q.value = o.q ?? 1;
    filt.frequency.setValueAtTime(this.hz(o.f ?? 2000), o.t);
    if (o.f2) filt.frequency.exponentialRampToValueAtTime(this.hz(o.f2), o.t + o.d);
    const env = c.createGain();
    const g = o.g ?? 0.3;
    env.gain.setValueAtTime(0.0001, o.t);
    env.gain.linearRampToValueAtTime(g, o.t + (o.a ?? 0.003));
    env.gain.exponentialRampToValueAtTime(0.0001, o.t + o.d);
    src.connect(filt).connect(env).connect(out);
    src.start(o.t, Math.random() * 0.5);
    src.stop(o.t + o.d + 0.05);
    src.onended = () => {
      src.disconnect();
      filt.disconnect();
      env.disconnect();
    };
  }

  /** Metallic bell/coin: inharmonic sine partials. */
  private bell(f: number, t: number, d: number, g: number, out: AudioNode): void {
    this.tone({ f, t, d, g, a: 0.002 }, out);
    this.tone({ f: f * 2.0, t, d: d * 0.6, g: g * 0.35, a: 0.002 }, out);
    this.tone({ f: f * 2.76, t, d: d * 0.4, g: g * 0.2, a: 0.002 }, out);
    this.tone({ f: f * 5.4, t, d: d * 0.2, g: g * 0.08, a: 0.001 }, out);
  }

  /** Plucked string: bright saw through a closing low-pass. */
  private pluck(f: number, t: number, d: number, g: number, out: AudioNode): void {
    this.tone({ f, t, d, g, type: 'sawtooth', a: 0.003, lp0: f * 8, lp: f * 1.2, lpT: d * 0.6 }, out);
    this.tone({ f, t, d: d * 0.8, g: g * 0.5, type: 'triangle', a: 0.003 }, out);
  }

  /** Soft brass: two detuned saws with a swelling low-pass. */
  private brass(f: number, t: number, d: number, g: number, out: AudioNode): void {
    const o = { f, t, d, type: 'sawtooth' as Wave, a: 0.035, hold: 0.45, lp0: 500, lp: Math.min(4200, f * 5), lpT: 0.08 };
    this.tone({ ...o, g: g * 0.6, detune: -6 }, out);
    this.tone({ ...o, g: g * 0.6, detune: 7 }, out);
    this.tone({ f, t, d, g: g * 0.35, type: 'triangle', a: 0.02, hold: 0.45 }, out);
  }

  private sparkle(t: number, count: number, span: number, g: number, out: AudioNode, lo = 2200, hi = 4200): void {
    for (let i = 0; i < count; i++) {
      const at = t + Math.random() * span;
      this.bell(lo + Math.random() * (hi - lo), at, 0.18 + Math.random() * 0.15, g * (0.6 + Math.random() * 0.4), out);
    }
  }

  // ------------------------------------------------------------------ voices

  /** Schedules the sound and returns its length in seconds. */
  private voice(name: SfxName, t: number, p: number, out: AudioNode, variant = 0): number {
    switch (name) {
      case 'coin-clink': {
        // A small coin on coins: 4 round-robin timbres (inharmonic partial sets), short and bright.
        const V: ReadonlyArray<readonly [number, number, number]> = [
          [2350, 2.41, 3.93],
          [2600, 2.27, 4.11],
          [2180, 2.62, 3.71],
          [2480, 2.33, 4.4],
        ];
        const [f0, r1, r2] = V[((variant % V.length) + V.length) % V.length]!;
        const f = f0 * p;
        this.tone({ f, t, d: 0.12, g: 0.17, a: 0.001 }, out);
        this.tone({ f: f * r1, t, d: 0.08, g: 0.08, a: 0.001 }, out);
        this.tone({ f: f * r2, t, d: 0.05, g: 0.045, a: 0.001 }, out);
        this.noise({ t, d: 0.012, g: 0.07, type: 'highpass', f: 6000 }, out);
        return 0.13;
      }

      case 'coin-thud':
        // The end of paying: a low, soft "tuk" (no cha-ching on money going out).
        this.tone({ f: 150 * p, f2: 70 * p, t, d: 0.16, g: 0.42, a: 0.002 }, out);
        this.noise({ t, d: 0.05, g: 0.16, type: 'lowpass', f: 900 }, out);
        this.tone({ f: 1400 * p, t, d: 0.05, type: 'triangle', g: 0.04 }, out);
        return 0.2;

      case 'coin-break':
        // A gold coin turning into ten silver: a quick high shimmer.
        this.bell(N.E7 * p, t, 0.16, 0.09, out);
        this.sparkle(t + 0.02, 5, 0.12, 0.05, out, 3600, 6200);
        return 0.25;

      case 'sob': {
        // The crying dealer (sell cut-in): two hiccuping breaths, then a falling "huu" with a wobble.
        // Soft and low-passed: a sting under the coins, not a wail.
        for (const at of [0, 0.13]) {
          this.tone({ f: N.A4 * p, f2: N.F4 * p, t: t + at, d: 0.09, type: 'triangle', g: 0.15, a: 0.008, lp: 1500 }, out);
          this.noise({ t: t + at, d: 0.08, g: 0.045, type: 'bandpass', f: 1300, q: 0.8 }, out);
        }
        const huu = { f: N.G4 * p, f2: N.C4 * p, glide: 0.55, t: t + 0.28, d: 0.62, a: 0.025, hold: 0.3 };
        this.tone({ ...huu, type: 'triangle', g: 0.17, lp: 1400, vib: { rate: 7, depth: 12, delay: 0.08 } }, out);
        this.tone({ ...huu, f: huu.f * 0.5, f2: huu.f2 * 0.5, type: 'sine', g: 0.08 }, out);
        this.noise({ t: t + 0.28, d: 0.4, g: 0.03, type: 'lowpass', f: 900 }, out);
        return 0.95;
      }

      case 'tap':
        this.tone({ f: 1500 * p, f2: 950 * p, t, d: 0.05, type: 'triangle', g: 0.2, a: 0.002 }, out);
        this.noise({ t, d: 0.018, g: 0.05, type: 'highpass', f: 4500 }, out);
        return 0.06;

      case 'dice-shake': {
        for (let i = 0; i < 7; i++) {
          const at = t + i * 0.042 + Math.random() * 0.018;
          const k = 1 - i / 10;
          this.noise({ t: at, d: 0.028 + Math.random() * 0.012, g: 0.3 * k, type: 'bandpass', f: 2200 + Math.random() * 2600, q: 2.5 }, out);
          if (i % 2 === 0) this.tone({ f: 850 + Math.random() * 500, t: at, d: 0.025, type: 'triangle', g: 0.07 * k }, out);
        }
        return 0.34;
      }

      case 'dice-land': {
        const hit = (at: number, g: number) => {
          this.tone({ f: 170 * p, f2: 55, t: at, d: 0.14, g: 0.5 * g, a: 0.002 }, out);
          this.noise({ t: at, d: 0.05, g: 0.22 * g, type: 'lowpass', f: 1400 }, out);
          this.noise({ t: at, d: 0.016, g: 0.14 * g, type: 'highpass', f: 3800 }, out);
          this.tone({ f: 1250 * p, t: at, d: 0.03, type: 'triangle', g: 0.08 * g }, out);
        };
        hit(t, 1);
        hit(t + 0.075, 0.85);
        hit(t + 0.2, 0.3);
        return 0.35;
      }

      case 'dice-clack': {
        // A thrown die against the wall: one short, bright knock (dice-land's hit, higher and drier).
        this.tone({ f: 320 * p, f2: 140 * p, t, d: 0.07, g: 0.3, a: 0.001 }, out);
        this.noise({ t, d: 0.022, g: 0.2, type: 'bandpass', f: 3200 * p, q: 1.4 }, out);
        this.tone({ f: 1900 * p, f2: 1300 * p, t, d: 0.03, type: 'triangle', g: 0.09 }, out);
        return 0.1;
      }

      case 'doubles':
        this.bell(N.E6 * p, t, 0.35, 0.26, out);
        this.bell(N.B6 * p, t + 0.1, 0.55, 0.26, out);
        this.tone({ f: N.E7 * p, t: t + 0.2, d: 0.35, type: 'triangle', g: 0.07 }, out);
        this.sparkle(t + 0.18, 4, 0.3, 0.05, out, 3000, 5000);
        return 0.75;

      case 'hop': {
        const f = 520 * p;
        this.tone({ f, f2: f * 1.4, t, d: 0.075, g: 0.26, a: 0.003, glide: 0.05 }, out);
        this.tone({ f: f * 2, t, d: 0.03, type: 'triangle', g: 0.05 }, out);
        return 0.1;
      }

      case 'pass-start': {
        const notes = [N.B5, N.E6, N.Gs6, N.B6];
        notes.forEach((f, i) => this.bell(f * p, t + i * 0.065, 0.32, 0.2, out));
        this.sparkle(t + 0.28, 5, 0.35, 0.045, out, 3200, 5200);
        return 0.8;
      }

      case 'cash-in':
        this.bell(N.E6 * p, t, 0.28, 0.22, out);
        this.bell(N.A6 * p, t + 0.085, 0.4, 0.24, out);
        return 0.5;

      case 'cash-out':
        [N.A5, N.Fs4 * 2, N.D5].forEach((f, i) =>
          this.tone({ f: f * p, f2: f * p * 0.94, t: t + i * 0.085, d: 0.15, type: 'triangle', g: 0.2, a: 0.004 }, out),
        );
        return 0.4;

      case 'buy': {
        [N.C5, N.E5, N.G5].forEach((f, i) => this.pluck(f * p, t + i * 0.03, 0.55, 0.13, out));
        this.bell(N.C6 * p, t + 0.1, 0.5, 0.1, out);
        return 0.7;
      }

      case 'build': {
        const knock = (at: number) => {
          this.tone({ f: 460 * p, f2: 220 * p, t: at, d: 0.08, g: 0.42, a: 0.002 }, out);
          this.noise({ t: at, d: 0.045, g: 0.28, type: 'bandpass', f: 1000, q: 4 }, out);
        };
        knock(t);
        knock(t + 0.12);
        [N.C7, N.E7, N.G7].forEach((f, i) => this.bell(f * p, t + 0.24 + i * 0.05, 0.25, 0.07, out));
        return 0.6;
      }

      case 'landmark': {
        const seq: [number, number, number][] = [
          [N.G4, 0, 0.16],
          [N.C5, 0.14, 0.16],
          [N.E5, 0.28, 0.16],
          [N.G5, 0.42, 0.8],
        ];
        for (const [f, at, d] of seq) this.brass(f * p, t + at, d, 0.16, out);
        this.brass(N.C5 * p, t + 0.42, 0.8, 0.1, out);
        this.brass(N.E5 * p, t + 0.42, 0.8, 0.08, out);
        this.sparkle(t + 0.5, 7, 0.6, 0.045, out);
        return 1.3;
      }

      case 'toll':
        this.bell(N.E7 * p, t, 0.2, 0.16, out);
        this.noise({ t, d: 0.02, g: 0.05, type: 'highpass', f: 6000 }, out);
        this.bell(N.A7 * p, t + 0.065, 0.3, 0.15, out);
        this.noise({ t: t + 0.065, d: 0.02, g: 0.05, type: 'highpass', f: 6000 }, out);
        return 0.4;

      case 'takeover': {
        this.tone({ f: 120, f2: 38, t, d: 0.3, g: 0.75, a: 0.002 }, out);
        this.noise({ t, d: 0.14, g: 0.45, type: 'lowpass', f: 900 }, out);
        this.noise({ t, d: 0.03, g: 0.2, type: 'highpass', f: 3000 }, out);
        [N.C4, N.E4, N.G4].forEach((f) => this.brass(f * p, t + 0.14, 0.55, 0.12, out));
        this.brass(N.C5 * p, t + 0.3, 0.55, 0.13, out);
        return 0.9;
      }

      case 'card':
        this.noise({ t, d: 0.3, g: 0.32, a: 0.09, type: 'bandpass', f: 500, f2: 5200, q: 1.2 }, out);
        this.tone({ f: 600 * p, f2: 1300 * p, t: t + 0.05, d: 0.2, type: 'triangle', g: 0.04 }, out);
        return 0.35;

      case 'island': {
        const horn = (f: number, at: number, d: number, g: number) => {
          this.tone({ f, t: at, d, type: 'sawtooth', g, a: 0.12, hold: 0.55, lp: 420 }, out);
          this.tone({ f: f * 1.004, t: at, d, type: 'sawtooth', g: g * 0.8, a: 0.14, hold: 0.55, lp: 380 }, out);
          this.tone({ f: f * 0.5, t: at, d, g: g * 1.4, a: 0.1, hold: 0.55 }, out);
        };
        horn(110 * p, t, 0.55, 0.16);
        horn(98 * p, t + 0.62, 0.95, 0.18);
        return 1.6;
      }

      case 'escape':
        this.tone({ f: 700 * p, f2: 2100 * p, t, d: 0.45, g: 0.2, a: 0.02, hold: 0.5, vib: { rate: 8, depth: 30, delay: 0.1 } }, out);
        this.bell(N.C7 * p, t + 0.42, 0.3, 0.12, out);
        return 0.75;

      case 'festival': {
        [N.C5, N.E5, N.G5].forEach((f, i) => this.brass(f * p, t + i * 0.1, 0.14, 0.14, out));
        this.brass(N.C6 * p, t + 0.3, 0.45, 0.15, out);
        this.brass(N.G5 * p, t + 0.3, 0.45, 0.08, out);
        for (let i = 0; i < 5; i++) {
          const at = t + 0.45 + i * 0.13 + Math.random() * 0.06;
          this.noise({ t: at, d: 0.09, g: 0.3, type: 'bandpass', f: 1400 + Math.random() * 2400, q: 1.5 }, out);
          this.tone({ f: 180, f2: 60, t: at, d: 0.08, g: 0.2 }, out);
          for (let k = 0; k < 5; k++) {
            this.noise({ t: at + 0.08 + Math.random() * 0.22, d: 0.012, g: 0.06, type: 'highpass', f: 5000 }, out);
          }
        }
        return 1.5;
      }

      case 'travel':
        this.noise({ t, d: 0.95, g: 0.34, a: 0.35, type: 'bandpass', f: 280, f2: 2600, q: 0.9 }, out);
        this.tone({ f: 80 * p, f2: 180 * p, t, d: 0.95, type: 'sawtooth', g: 0.07, a: 0.3, lp: 320 }, out);
        this.tone({ f: 900 * p, f2: 1500 * p, t: t + 0.25, d: 0.6, g: 0.035, a: 0.2 }, out);
        return 1.0;

      case 'warning':
        this.tone({ f: 880 * p, t, d: 0.11, type: 'triangle', g: 0.2, a: 0.006 }, out);
        this.tone({ f: 880 * p, t: t + 0.17, d: 0.11, type: 'triangle', g: 0.2, a: 0.006 }, out);
        return 0.32;

      case 'bankrupt': {
        const seq: [number, number, number][] = [
          [N.G4, 0, 0.28],
          [N.Fs4, 0.3, 0.28],
          [N.F4, 0.6, 0.28],
        ];
        for (const [f, at, d] of seq) this.tone({ f: f * p, t: t + at, d, type: 'triangle', g: 0.24, a: 0.01, hold: 0.6, lp: 1800 }, out);
        this.tone({ f: N.E4 * p, f2: N.E4 * p * 0.97, t: t + 0.9, d: 1.0, type: 'triangle', g: 0.26, a: 0.01, hold: 0.5, lp: 1600, vib: { rate: 5.5, depth: 9, delay: 0.2 } }, out);
        this.tone({ f: N.E4 * p * 0.5, t: t + 0.9, d: 1.0, type: 'sine', g: 0.14, a: 0.02, hold: 0.5 }, out);
        return 2.0;
      }

      case 'win': {
        const arp = [N.C5, N.E5, N.G5, N.C6, N.E6, N.G6];
        arp.forEach((f, i) => {
          this.pluck(f * p, t + i * 0.07, 0.4, 0.1, out);
          this.bell(f * p, t + i * 0.07, 0.3, 0.06, out);
        });
        [N.C5, N.E5, N.G5, N.C6].forEach((f) => this.brass(f * p, t + 0.45, 1.1, 0.09, out));
        this.sparkle(t + 0.5, 12, 1.1, 0.05, out, 2600, 5200);
        return 1.8;
      }

      case 'turn':
        this.bell(N.C6 * p, t, 0.6, 0.15, out);
        this.bell(N.G6 * p, t + 0.09, 0.7, 0.12, out);
        return 0.8;

      case 'timer-tick':
        this.tone({ f: 2400 * p, t, d: 0.022, type: 'triangle', g: 0.1, a: 0.001 }, out);
        this.noise({ t, d: 0.01, g: 0.04, type: 'highpass', f: 5000 }, out);
        return 0.04;

      case 'error':
        this.tone({ f: 150 * p, t, d: 0.22, type: 'square', g: 0.08, a: 0.005, hold: 0.6, lp: 900 }, out);
        this.tone({ f: 157 * p, t, d: 0.22, type: 'square', g: 0.08, a: 0.005, hold: 0.6, lp: 900 }, out);
        return 0.25;
    }
  }
}
