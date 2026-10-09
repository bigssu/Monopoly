/**
 * The skill throw (strategy mode; docs/research/11-skill-throw.md §2, docs/DESIGN.md "Skill
 * throw"): pure helpers, no DOM.
 *
 * - PRESS = timing. While the pad is held a ring around the dice runs one lap per `ringPeriod`
 *   (1.4 s at the default game pace), starting at the bottom and going clockwise; the green band
 *   is centred on the top (half a lap in) and spans ±`SKILL.band` of the lap. The accuracy is 1 at
 *   the band's centre and falls linearly to 0 at its edges (`accuracyAt`). It freezes when the drag
 *   starts (or at the release of a tap).
 * - DRAG = aim. The arrow's length in die sizes picks the zone (`zoneOf`): a dead zone (a tap,
 *   보통), short = 작게 (aim low), middle = 보통 (no aim), long = 크게 (aim high).
 * - RELEASE = throw: `Roll { stride, aim, accuracy }`; the throw's strength is the arrow's length
 *   (`dragStrength`, monotonic), its direction the arrow's.
 *
 * The engine decides the faces (`ECONOMY.skillCap` × accuracy of a chance to land in the aimed band); the
 * UI only collects the inputs and explains the result (`resultParts`).
 */
import { SKILL_BANDS, type GameEvent } from '@/engine';

export type Stride = 1 | 2;
export type Aim = 'low' | 'high';

/** The skill fields of a `DiceRolled` event (rules version 3). */
type SkillRolled = Pick<Extract<GameEvent, { type: 'DiceRolled' }>, 'stride' | 'aim' | 'accuracy' | 'assisted'>;

export const SKILL = {
  /** One lap of the ring (ms) at the default game pace; it follows the pace, never below `minPeriodMs`. */
  periodMs: 1400,
  minPeriodMs: 1000,
  /** Half-width of the green band, as a fraction of the lap (±12 % = 86° of the ring, ~336 ms of a 1.4 s lap). */
  band: 0.12,
  /** Arrow zones in die sizes (the layout die, ~100 px on a 1600×1000 screen, ~43 px at 800×450). */
  dead: 0.35,
  /** A floor for the dead zone in stage px (a finger's jitter on a small screen). */
  deadMinPx: 16,
  /** Below this (and past the dead zone): 작게. */
  short: 1.5,
  /** From this on: 크게. Between `short` and `long`: 보통. */
  long: 2.7,
  /** The arrow (and the throw's strength) stops growing here. */
  max: 3.6,
  /** The result line under the dice (ms at the default pace), then a 200 ms fade. */
  resultMs: 1500,
  /** Reachable spaces stay lit after a stride change (ms at the default pace). */
  reachMs: 1200,
} as const;

/** The ring's lap (ms) at game pace `pace` (default 2 = 1.4 s). */
export function ringPeriod(pace: number, defaultPace = 2): number {
  return Math.max(SKILL.minPeriodMs, (SKILL.periodMs * pace) / defaultPace);
}

/** Where the needle is (0..1 of a lap, 0 = bottom, clockwise, 0.5 = top) `elapsed` ms after the press. */
export function ringPhase(elapsed: number, period: number): number {
  if (!(period > 0)) return 0;
  const u = (elapsed / period) % 1;
  return u < 0 ? u + 1 : u;
}

/** Accuracy at needle phase `u`: 1 at the top (u = 0.5), 0 at the band's edges and outside. */
export function accuracyAt(u: number): number {
  return Math.max(0, 1 - Math.abs(u - 0.5) / SKILL.band);
}

/**
 * A needle phase whose accuracy is `accuracy` (the CPU hand stops the ring there): before the top
 * (`side` -1) or after it (+1). Accuracy 0 is shown well outside the band.
 */
export function phaseFor(accuracy: number, side: -1 | 1 = -1): number {
  const a = Math.min(1, Math.max(0, accuracy));
  const off = a <= 0 ? SKILL.band + 0.08 : (1 - a) * SKILL.band;
  return 0.5 + side * off;
}

/** The accuracy as a whole percentage (what the player reads). */
export function pct(accuracy: number): number {
  return Math.round(Math.min(1, Math.max(0, accuracy)) * 100);
}

export type Zone = 'tap' | 'low' | 'mid' | 'high';

/** The dead zone in die sizes for a die of `ds` px. */
export function deadZone(ds: number): number {
  return Math.max(SKILL.dead, ds > 0 ? SKILL.deadMinPx / ds : SKILL.dead);
}

/** The arrow's zone for a drag of `lenDs` die sizes (dice of `ds` px). */
export function zoneOf(lenDs: number, ds = 100): Zone {
  if (!(lenDs >= deadZone(ds))) return 'tap';
  if (lenDs < SKILL.short) return 'low';
  if (lenDs < SKILL.long) return 'mid';
  return 'high';
}

/** The aim a zone sends (보통 and a tap send none). */
export function aimOf(zone: Zone): Aim | undefined {
  return zone === 'low' ? 'low' : zone === 'high' ? 'high' : undefined;
}

/** The zone a CPU's aim is acted out in: the middle of that zone's span (die sizes). */
export function zoneLength(aim: Aim | undefined): number {
  if (aim === 'low') return (SKILL.dead + SKILL.short) / 2 + 0.1;
  if (aim === 'high') return (SKILL.long + SKILL.max) / 2;
  return (SKILL.short + SKILL.long) / 2;
}

/**
 * The throw's strength (0..1) of a drag of `lenDs` die sizes: linear from the dead zone to the
 * arrow's maximum, clamped. Monotonic: 작게 throws soft and short, 크게 hard and far.
 */
export function dragStrength(lenDs: number, ds = 100): number {
  const d = deadZone(ds);
  return Math.min(1, Math.max(0, (lenDs - d) / (SKILL.max - d)));
}

/** The totals a stride can roll. */
export function strideRange(stride: Stride): [number, number] {
  return stride === 1 ? [1, 6] : [2, 12];
}

/**
 * The spaces a stride can reach from `pos` on a board of `n` spaces, moving forward (an express
 * ticket doubles the steps).
 */
export function strideReach(pos: number, stride: Stride, n: number, express = false): number[] {
  const [lo, hi] = strideRange(stride);
  const k = express ? 2 : 1;
  const out: number[] = [];
  for (let s = lo; s <= hi; s++) {
    const i = (((pos + s * k) % n) + n) % n;
    if (!out.includes(i)) out.push(i);
  }
  return out;
}

/**
 * The faces to show for a roll: one die for a one-die roll (`[die, 0]`, stride 1), else both.
 * Also for `state.lastDice` (a resumed game).
 */
export function rolledFaces(dice: readonly [number, number], stride?: Stride): number[] {
  const ok = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= 6;
  if (stride === 1 || !ok(dice[1])) return [ok(dice[0]) ? dice[0] : 1];
  return [ok(dice[0]) ? dice[0] : 1, dice[1]];
}

/**
 * The result line's parts after a skill roll: null when nothing was aimed (보통, a tap, casual mode).
 * `hit`: the total landed in the aimed band.
 */
export function resultParts(ev: { total: number; dice: [number, number] } & SkillRolled): { accuracy: number; aim: Aim; hit: boolean; total: number } | null {
  if (!ev.aim || typeof ev.accuracy !== 'number') return null;
  const stride: Stride = ev.stride === 1 || ev.dice[1] === 0 ? 1 : 2;
  const total = ev.total;
  const [lo, hi] = SKILL_BANDS[stride][ev.aim];
  return { accuracy: pct(ev.accuracy), aim: ev.aim, hit: total >= lo && total <= hi, total };
}
