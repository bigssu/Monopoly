/**
 * Coin sounds for money events (docs/MONEY-EVENTS.md §5, research 06 §9.3), through the game's
 * sfx facade (master volume / mute / ducking of audio/synth.ts apply):
 *
 * - paying: each leaving coin clinks with a FALLING pitch (1.0 → 0.8 over the event, ±1 semitone
 *   jitter); the payment ends on a low thud, never a cha-ching. The first coin plays `cash-out`.
 * - receiving: each landing coin clinks up a pentatonic ladder (capped per tier: +4/+7/+9/+12);
 *   the last landing plays the cha-ching (`cash-in`, ≥ 150 ms apart).
 * - a gold breaking into ten silver: `coin-break`.
 * - 4 round-robin clink timbres (never the same one twice in a row), a coin bus of ≤ 6 voices and
 *   ≥ 25 ms between two clinks (the rest are dropped, not queued: a late clink sounds wrong).
 *
 * Haptics (≤ 10/s): first landing light, every 3rd landing tick, last landing + stamps medium/heavy.
 */
import { haptic, type HapticKind } from '@/ui/audio/haptics';
import { sfx, type SfxName, type SfxOpts } from '@/ui/audio/sfx';
import { ladderStep } from './denom';
import { mulberry32 } from '../vfx/rng';

/** Coin bus: concurrent clinks / minimum spacing (ms) / one clink's length (ms). */
const COIN_VOICES = 6;
export const COIN_SPACING = 25;
const CLINK_MS = 130;
const CHACHING_SPACING = 150;
const HAPTIC_SPACING = 100;

export interface SoundOut {
  play(name: SfxName, opts?: SfxOpts): void;
  haptic(kind: HapticKind): void;
  now(): number;
}

const defaultOut: SoundOut = {
  play: (n, o) => sfx.play(n, o),
  haptic: (k) => haptic(k),
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
};

const semis = (s: number): number => 2 ** (s / 12);

export class CoinSound {
  private voices: number[] = [];
  private lastClink = -Infinity;
  private lastChaChing = -Infinity;
  private lastHaptic = -Infinity;
  private variant = 0;
  /** Deterministic jitter (the visuals' RNG is separate from the game's). */
  private rand = mulberry32(7).next;
  /** Muted (headless scenes, tests). */
  enabled = true;

  constructor(private out: SoundOut = defaultOut) {}

  /** A coin clink at `pitch` (multiplier). Returns false when dropped by the bus limits. */
  clink(pitch: number, gain = 1): boolean {
    if (!this.enabled) return false;
    const now = this.out.now();
    if (now - this.lastClink < COIN_SPACING) return false;
    this.voices = this.voices.filter((end) => end > now);
    if (this.voices.length >= COIN_VOICES) return false;
    this.lastClink = now;
    this.voices.push(now + CLINK_MS);
    // Round robin without immediate repeats.
    this.variant = (this.variant + 1 + Math.floor(this.rand() * 3)) % 4;
    const jitter = semis((this.rand() * 2 - 1) * 1);
    this.out.play('coin-clink', { pitch: pitch * jitter, gain: gain * (0.85 + this.rand() * 0.3), variant: this.variant });
    return true;
  }

  /** Coin `i` of `n` leaves a wallet: falling pitch; the first one also plays `cash-out`. */
  depart(i: number, n: number): void {
    if (!this.enabled) return;
    if (i === 0) this.out.play('cash-out');
    const fall = n > 1 ? 1 - (0.2 * i) / (n - 1) : 1;
    this.clink(fall * 0.92, 0.8);
  }

  /** The payment is over: a low thud. */
  paid(): void {
    if (this.enabled) this.out.play('coin-thud');
  }

  /** Coin `i` lands on a receiver (ladder step i, capped at `top` semitones). */
  land(i: number, top: number, last: boolean): void {
    if (!this.enabled) return;
    this.clink(semis(ladderStep(i, top)));
    if (i === 0) this.buzz('light');
    else if (last) this.buzz('medium');
    else if (i % 3 === 2) this.buzz('tick');
    if (last) this.chaChing();
  }

  /** Coins swallowed by a sink (tax office, donation box, the bank): no ladder, a dull clink. */
  sink(i: number): void {
    if (!this.enabled) return;
    this.clink(0.8 + (i % 2) * 0.04, 0.7);
  }

  chaChing(): void {
    if (!this.enabled) return;
    const now = this.out.now();
    if (now - this.lastChaChing < CHACHING_SPACING) return;
    this.lastChaChing = now;
    this.out.play('cash-in');
  }

  /** A gold coin breaks into ten silver (or silver into bronze). */
  breakCoin(): void {
    if (this.enabled) this.out.play('coin-break');
  }

  /** Another named cue (toll / buy / build / landmark / takeover / bankrupt …). */
  cue(name: SfxName, opts?: SfxOpts): void {
    if (this.enabled) this.out.play(name, opts);
  }

  buzz(kind: HapticKind): void {
    if (!this.enabled) return;
    const now = this.out.now();
    if (now - this.lastHaptic < HAPTIC_SPACING) return;
    this.lastHaptic = now;
    this.out.haptic(kind);
  }
}
