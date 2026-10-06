/**
 * Which sprite the dealer shows while a voiced line plays (Dealer.flapAfter): the mouth flaps
 * between the two talking frames every FLAP_MS, and the line's expression comes back now and then
 * so the face keeps its mood.
 *
 * Owner review (2026-10-06): "every time the dealer speaks it throws its arms up over and over —
 * too distracting". The talking frames have the arms down; most expressions raise them, so each
 * expression frame was an arm raise. Before, the expression was every 3rd frame (talk-a, talk-b,
 * expr: an arm raise every 360 ms = 2.78/s). For an arms-up expression it is now every 6th frame
 * (talk-a, talk-b, talk-a, talk-b, talk-a, expr: every 720 ms = 1.39/s, exactly half); the mouth
 * moves the same (a new mouth frame every FLAP_MS). Arms-down expressions keep the old cadence.
 */
import type { DealerExpr } from './lines';

export const FLAP_MS = 120;

/**
 * Expressions whose sprite raises a hand to the face or above (public/dealer/*.webp, looked at):
 * cheer (both fists up), surprised (both hands on the cheeks), sad (a hand on the head), thinking
 * (a hand on the chin), point (an arm out at face height), dice (a die held up), trophy (the cup held
 * up). Arms down or at the chest: idle, nervous (fists at the chest), laugh (a hand on the belly),
 * present (hands out at the waist).
 */
export const ARMS_UP: ReadonlySet<DealerExpr> = new Set<DealerExpr>(['cheer', 'surprised', 'sad', 'thinking', 'point', 'dice', 'trophy']);

/** Frames per cycle: the expression is the last frame of each cycle. */
const flapCycle = (expr: DealerExpr): number => (ARMS_UP.has(expr) ? 6 : 3);

/** The sprite `t` ms into the flapping (t ≥ 0). */
export function flapFrame(t: number, expr: DealerExpr): string {
  const n = Math.floor(Math.max(0, t) / FLAP_MS);
  const cycle = flapCycle(expr);
  const k = n % cycle;
  if (k === cycle - 1) return expr;
  return k % 2 === 0 ? 'talk-a' : 'talk-b';
}
