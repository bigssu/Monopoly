/**
 * Sound effects facade: the game only calls `sfx.play(name)`. main.ts installs the SynthSfx engine
 * (audio/synth.ts), which plays the generated samples in public/sfx and falls back to its Web Audio
 * synthesizer for any name without a sample.
 */
export type SfxName =
  | 'tap' | 'dice-shake' | 'dice-land' | 'doubles' | 'hop' | 'pass-start' | 'cash-in' | 'cash-out'
  | 'buy' | 'build' | 'landmark' | 'toll' | 'takeover' | 'card' | 'island' | 'escape' | 'festival'
  | 'travel' | 'warning' | 'bankrupt' | 'win' | 'turn' | 'timer-tick' | 'error';

export interface Sfx {
  /** Play a sound (no-op when muted or before unlock). */
  play(name: SfxName, opts?: { pitch?: number; gain?: number }): void;
  /** Call from the first user gesture and on app resume. */
  unlock(): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  setVolume(v: number): void;
}

/** Silent until main.ts installs the real engine (tests run without one). */
let impl: Sfx = {
  play() {},
  unlock() {},
  setMuted() {},
  isMuted: () => false,
  setVolume() {},
};

export const sfx: Sfx = {
  play: (n, o) => impl.play(n, o),
  unlock: () => impl.unlock(),
  setMuted: (m) => impl.setMuted(m),
  isMuted: () => impl.isMuted(),
  setVolume: (v) => impl.setVolume(v),
};

export function installSfx(next: Sfx): void {
  impl = next;
}
