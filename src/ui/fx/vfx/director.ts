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
