/**
 * Escalation / combo rules (docs/VFX.md §6.2) as pure functions, applied by the engine when an
 * effect starts (`createFx({ policy })`, default `fxPolicy`) and by the game's sfx hook.
 *
 * 1. Merge window: the same preset on the same target within 400 ms (12 FX frames) of the
 *    previous one does not start a second full effect: it plays as an *accent* (particles ×0.4,
 *    no shake / hit-stop / flash; sound and haptics stay).
 * 2. Pitch ladder: consecutive `cash-in` within 1.5 s rise a semitone each (k = 0..7);
 *    `cash-out` falls (down to −4); 1.5 s without one resets.
 * 3. Chain demotion: an I1–I2 effect that starts while an I3+ effect is still running its
 *    timeline plays as an accent.
 * 4. Concurrency: at most 1 I3/I4 (the engine *queues* a second big one until the first has run
 *    its timeline, ≤ 900 ms — see `BIG_WAIT_FRAMES`), 2 I2 and 4 I1 at full strength; beyond
 *    that the newcomer is an accent. I0 accents are never demoted (they are already tiny).
 */
import type { HighlightTarget, Tier } from './timeline';

/** What the policy sees of an effect (running or about to start). */
export interface FxInfo {
  name: string;
  tier: Tier;
  highlight?: HighlightTarget;
}

export interface RunningFx extends FxInfo {
  /** FX frames since it started. */
  f: number;
  /** Its timeline still has ops to run (not just particles fading out). */
  active: boolean;
}

export type FxMode = 'full' | 'accent';

/** Merge window (§6.2-1): 400 ms = 12 FX frames. */
export const MERGE_FRAMES = 12;
/** Longest a big (I3+) effect waits for the previous big one (27 frames = 900 ms, ×5 when skipping). */
export const BIG_WAIT_FRAMES = 27;
/** Full-strength concurrency per tier (§6.2-4); I3/I4 are serialized by the engine queue. */
export const TIER_CONCURRENCY: Record<Tier, number> = { 0: Infinity, 1: 4, 2: 2, 3: 1, 4: 1 };
/** Particle multiplier of an accent. */
export const ACCENT_Q = 0.4;

function targetKey(h: HighlightTarget | undefined): string {
  if (!h) return '';
  if ('space' in h) return `s${h.space}`;
  if ('panel' in h) return `p${h.panel}`;
  if ('spaces' in h) return `g${h.spaces.join(',')}`;
  return 'stage';
}

export function sameTarget(a: HighlightTarget | undefined, b: HighlightTarget | undefined): boolean {
  return targetKey(a) === targetKey(b);
}

/** Decide how a new effect starts given the running ones (§6.2 rules 1, 3, 4). */
export function fxPolicy(next: FxInfo, running: readonly RunningFx[]): FxMode {
  if (next.tier >= 3) return 'full';
  if (next.tier > 0 && running.some((r) => r.active && r.tier >= 3)) return 'accent';
  if (running.some((r) => r.name === next.name && r.f <= MERGE_FRAMES && sameTarget(r.highlight, next.highlight))) return 'accent';
  if (next.tier > 0) {
    const same = running.filter((r) => r.active && r.tier === next.tier).length;
    if (same >= TIER_CONCURRENCY[next.tier]) return 'accent';
  }
  return 'full';
}

/** True while a big (I3+) effect is still running its timeline: a new big one waits (queue). */
export function bigBusy(running: readonly RunningFx[]): boolean {
  return running.some((r) => r.active && r.tier >= 3);
}

/**
 * Cash pitch ladder (§6.2-2). `apply(name, pitch, now)` returns the pitch to play: `cash-in`
 * climbs a semitone per call within `window` ms (k ≤ 7), `cash-out` descends (k ≥ −4).
 */
export class PitchLadder {
  private kIn = -1;
  private kOut = 1;
  private lastIn = -Infinity;
  private lastOut = -Infinity;
  constructor(readonly window = 1500) {}
  apply(name: string, pitch: number | undefined, now: number): number | undefined {
    if (name === 'cash-in') {
      this.kIn = now - this.lastIn <= this.window ? Math.min(7, this.kIn + 1) : 0;
      this.lastIn = now;
      return this.kIn ? (pitch ?? 1) * 2 ** (this.kIn / 12) : pitch;
    }
    if (name === 'cash-out') {
      this.kOut = now - this.lastOut <= this.window ? Math.max(-4, this.kOut - 1) : 0;
      this.lastOut = now;
      return this.kOut ? (pitch ?? 1) * 2 ** (this.kOut / 12) : pitch;
    }
    return pitch;
  }
  reset(): void {
    this.kIn = -1;
    this.kOut = 1;
    this.lastIn = this.lastOut = -Infinity;
  }
}

/** Quality tiers the adaptive controller moves between (engine.ts FxTier minus 'off'). */
export type AutoTier = 'high' | 'low' | 'minimal';

export interface AdaptiveOptions {
  /** p95 of the engine's JS per tick over a window above this → a bad window (ms). */
  tickMs: number;
  /** A tick later than this (gap since the previous one, ms; 30 Hz = 33.3) is late … */
  gapMs: number;
  /** … and more than this share of late ticks in a window makes it bad. */
  lateShare: number;
  /** Bad windows in a row before stepping down. */
  downWindows: number;
  /** Samples per window (≈ 1 s of effects at 30 Hz). */
  window: number;
  /** Healthy windows in a row before stepping up (low → high). */
  upWindows: number;
  /** In 'minimal' (no canvas → no samples), a new effect after this long tries 'low' again (ms). */
  retryMs: number;
}

export const ADAPTIVE_DEFAULTS: AdaptiveOptions = { tickMs: 6, gapMs: 40, lateShare: 0.2, downWindows: 2, window: 30, upWindows: 10, retryMs: 20000 };

/**
 * Adaptive effects quality (docs/VFX.md §15.4) for the setting 'auto': fed one sample per real-time
 * FX tick with particles on screen (engine JS ms, gap since the previous tick). A window (≈ 1 s) is
 * bad when the tick p95 is over `tickMs` or more than `lateShare` of its ticks came late (gap over
 * `gapMs`): one or two late ticks are the game's own event frames (a render, a prompt — they happen
 * with effects off too), a device that cannot hold 30 fps shows many. `downWindows` bad windows in a
 * row → one tier down (high → low → minimal); `upWindows` healthy ones → low → high. Nothing is
 * persisted: every engine (game) starts at 'high'.
 */
export class AdaptiveQuality {
  tier: AutoTier = 'high';
  since: number;
  private tick: Float32Array;
  private gap: Float32Array;
  private n = 0;
  private good = 0;
  private bad = 0;
  constructor(
    readonly o: AdaptiveOptions = ADAPTIVE_DEFAULTS,
    now = 0,
  ) {
    this.tick = new Float32Array(o.window);
    this.gap = new Float32Array(o.window);
    this.since = now;
  }

  /** Force a tier (setting changed); resets the window. */
  set(tier: AutoTier, now: number): void {
    this.tier = tier;
    this.since = now;
    this.n = this.good = this.bad = 0;
  }

  /** One tick sample; returns the transition reason when the tier changed. */
  sample(tickMs: number, gapMs: number, now: number): string | null {
    if (this.tier === 'minimal') return null;
    this.tick[this.n] = tickMs;
    this.gap[this.n] = gapMs;
    if (++this.n < this.o.window) return null;
    this.n = 0;
    const t = Array.from(this.tick).sort((x, y) => x - y)[Math.floor(this.o.window * 0.95)]!;
    let late = 0;
    for (const g of this.gap) if (g > this.o.gapMs) late++;
    if (t > this.o.tickMs || late > this.o.lateShare * this.o.window) {
      this.good = 0;
      if (++this.bad < this.o.downWindows) return null;
      this.set(this.tier === 'high' ? 'low' : 'minimal', now);
      return `${this.o.downWindows} windows: tick p95 ${t.toFixed(1)} ms, ${late}/${this.o.window} ticks late`;
    }
    this.bad = 0;
    if (this.tier === 'low' && ++this.good >= this.o.upWindows) {
      this.set('high', now);
      return `${this.o.upWindows} healthy windows`;
    }
    return null;
  }

  /** A new effect is about to play: 'minimal' retries 'low' after `retryMs`. Returns the reason on a change. */
  onPlay(now: number): string | null {
    if (this.tier !== 'minimal' || now - this.since < this.o.retryMs) return null;
    this.set('low', now);
    return `retry after ${this.o.retryMs / 1000} s`;
  }
}
