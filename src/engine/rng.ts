/**
 * Seeded PRNG (mulberry32). The generator state is a single uint32 that lives inside
 * `GameState.rng`, so the reducer stays pure and saves/resumes are exact.
 */

export interface Rng {
  /** Uniform float in [0, 1). Advances the state. */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** Current uint32 state (store it back into GameState). */
  readonly state: number;
}

/** One mulberry32 step: returns [value in [0,1), nextState]. */
export function mulberry32Step(state: number): [number, number] {
  const a = (state + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, a];
}

/** Normalize any number (seed) into a uint32 state. */
export function seedToState(seed: number): number {
  // Mix the seed a bit so that small consecutive seeds give unrelated streams.
  let h = (Math.floor(seed) ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function createRng(state: number): Rng {
  let s = state >>> 0;
  return {
    next() {
      const [v, n] = mulberry32Step(s);
      s = n;
      return v;
    },
    int(n: number) {
      const [v, next] = mulberry32Step(s);
      s = next;
      return Math.floor(v * n);
    },
    get state() {
      return s;
    },
  };
}

export type DicePair = readonly [number, number];

export function rollDice(rng: Rng): [number, number] {
  return [rng.int(6) + 1, rng.int(6) + 1];
}
