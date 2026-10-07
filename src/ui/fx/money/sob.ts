/**
 * The crying dealer's sob rhythm in the `sell` cut-in (docs/MONEY-EVENTS.md §14.5): which of the
 * baked sob frames (public/dealer/sad-sob.webp, `SOB` in src/content/fx/sob-sheet.ts) shows at a
 * given scene time. Pure: the scene clock's step asks it every frame, so pause, skip, speed and the
 * manual clock follow from the clock alone.
 *
 * - Between sobs (and through the still hold) he breathes slowly: one 6-phase cycle per BREATH_F.
 * - A sob (the two sniffle beats) runs whole fast cycles, one per SOB_F. The breath waits meanwhile,
 *   so it resumes on the phase it left: no jump in or out of a sob.
 * - Time is counted in whole 30 Hz scene frames, so a phase changes only on a frame.
 */
import { FRAME } from './clock';

/** One slow breath (6 phases), scene frames: ≈ 1.5 s. */
export const BREATH_F = 45;
/** One sob (6 phases), scene frames: ≈ 0.5 s. */
export const SOB_F = 15;

/** A sob window: from scene frame `at`, `cycles` fast cycles. */
export interface Sob {
  at: number;
  cycles: number;
}

/** Scene ms → whole scene frames (float slack: n frames of 33.33… ms are frame n). */
export const frameOf = (ms: number): number => Math.floor(ms / FRAME + 1e-6);

/**
 * The phase (0 … cells − 1) at scene time `t` (ms) for a crier that started breathing at scene
 * frame `start`, with these sobs (frames; in order, not overlapping).
 */
export function phaseAt(t: number, start: number, sobs: ReadonlyArray<Sob>, cells = 6): number {
  const k = frameOf(t) - start;
  if (k <= 0) return 0;
  let breath = 0; // frames of slow breath so far
  let last = 0; // frame where the slow breath last resumed
  let pos = -1;
  for (const s of sobs) {
    const a = s.at - start;
    const len = s.cycles * SOB_F;
    if (a >= k) break;
    breath += Math.max(0, a - last);
    if (k < a + len) {
      pos = breath / BREATH_F + (k - a) / SOB_F;
      break;
    }
    last = Math.max(last, a + len);
  }
  if (pos < 0) pos = (breath + Math.max(0, k - last)) / BREATH_F;
  const u = pos - Math.floor(pos);
  return Math.min(cells - 1, Math.floor(u * cells + 1e-9));
}
