/**
 * Seeded PRNG for the VFX engine (mulberry32), independent of the game engine's RNG (VFX.md §1-5):
 * the same seed and the same sequence of `play()` calls give the same particles, frame for frame
 * (unit tests, deterministic filmstrips / screenshots).
 */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [a, b). */
  range(a: number, b: number): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** Symmetric jitter in [-a, a). */
  jitter(a: number): number;
  /** One element of a non-empty list. */
  pick<T>(list: readonly T[]): T;
  /** Current internal state (to fork or snapshot). */
  state(): number;
}

export function mulberry32(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (n) => Math.floor(next() * n),
    jitter: (a) => (next() * 2 - 1) * a,
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!,
    state: () => s,
  };
}

/** Mix a base seed with an effect counter (so effects started in the same frame differ). */
export function mixSeed(a: number, b: number): number {
  let h = (a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
