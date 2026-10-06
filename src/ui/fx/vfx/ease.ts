/**
 * Easing curves (VFX.md §7.2b.0). Pure functions of t in [0, 1].
 *
 * `popBack(o)` is `easeOutBack` whose overshoot peak equals `o` (8 % → c1 1.5, 10 % → 1.70158,
 * 12 % → 1.9, 15 % → 2.17): the peak of easeOutBack(c1) is 1 + 4·c1³ / (27·(c1 + 1)²).
 */
type EaseFn = (t: number) => number;

export const inQuad: EaseFn = (t) => t * t;
export const outQuad: EaseFn = (t) => 1 - (1 - t) * (1 - t);
export const inOutQuad: EaseFn = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const inCubic: EaseFn = (t) => t * t * t;
export const outCubic: EaseFn = (t) => 1 - (1 - t) ** 3;
const outSine: EaseFn = (t) => Math.sin((t * Math.PI) / 2);

/** easeOutBack with overshoot constant c1 (1.70158 = the classic 10 % overshoot). */
export function outBack(t: number, c1 = 1.70158): number {
  const c3 = c1 + 1;
  const x = t - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

/** Peak value of easeOutBack(c1) − 1 (the overshoot as a fraction). */
export function backOvershoot(c1: number): number {
  return (4 * c1 * c1 * c1) / (27 * (c1 + 1) * (c1 + 1));
}

/** c1 that makes easeOutBack overshoot by `o` (bisection, monotonic in c1). */
export function c1ForOvershoot(o: number): number {
  let lo = 0;
  let hi = 6;
  for (let i = 0; i < 48; i++) {
    const m = (lo + hi) / 2;
    if (backOvershoot(m) < o) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/** The §7.2b.0 overshoot table: popBack(8/10/12/15 %) → c1. */
export const POP_C1 = { 8: 1.5, 10: 1.70158, 12: 1.9, 15: 2.17 } as const;
/** Pips / badges: popBack(c1 = 2.17). */
export const PIP_C1 = 2.17;

/** Tier pop per building level (§7.2b.0 table): overshoot c1, pop frames, zoomPunch. */
export const TIER_POP: Record<1 | 2 | 3 | 4, { c1: number; frames: number; zoom: number }> = {
  1: { c1: POP_C1[8], frames: 8, zoom: 1 },
  2: { c1: POP_C1[10], frames: 9, zoom: 1 },
  3: { c1: POP_C1[12], frames: 10, zoom: 1.1 },
  4: { c1: POP_C1[15], frames: 10, zoom: 1.25 },
};

/** Ease ids stored per particle (typed-array friendly). */
export const Ease = {
  Linear: 0,
  InQuad: 1,
  OutQuad: 2,
  InOutQuad: 3,
  InCubic: 4,
  OutCubic: 5,
  OutBack: 6,
  OutSine: 7,
} as const;
export type EaseId = (typeof Ease)[keyof typeof Ease];

/** Evaluate ease `id` (OutBack uses `c1`). */
export function ease(id: number, t: number, c1 = 1.70158): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  switch (id) {
    case Ease.InQuad:
      return inQuad(t);
    case Ease.OutQuad:
      return outQuad(t);
    case Ease.InOutQuad:
      return inOutQuad(t);
    case Ease.InCubic:
      return inCubic(t);
    case Ease.OutCubic:
      return outCubic(t);
    case Ease.OutBack:
      return outBack(t, c1);
    case Ease.OutSine:
      return outSine(t);
    default:
      return t;
  }
}

/** Quadratic Bézier coordinate. */
export function bezier2(a: number, c: number, b: number, t: number): number {
  const m = 1 - t;
  return m * m * a + 2 * m * t * c + t * t * b;
}
