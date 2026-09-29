import { describe, expect, it } from 'vitest';
import { createRng, rollDice, seedToState } from '../rng';

describe('rng (mulberry32)', () => {
  it('is deterministic per seed', () => {
    const a = createRng(seedToState(7));
    const b = createRng(seedToState(7));
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
    expect(a.state).toBe(b.state);
  });

  it('different seeds give different streams', () => {
    const a = createRng(seedToState(1));
    const b = createRng(seedToState(2));
    const xs = Array.from({ length: 10 }, () => a.next());
    const ys = Array.from({ length: 10 }, () => b.next());
    expect(xs).not.toEqual(ys);
  });

  it('values are in [0,1) and dice in 1..6 with a sane distribution', () => {
    const r = createRng(seedToState(123));
    const counts = [0, 0, 0, 0, 0, 0];
    let doubles = 0;
    const N = 60000;
    for (let i = 0; i < N; i++) {
      const [d1, d2] = rollDice(r);
      expect(d1).toBeGreaterThanOrEqual(1);
      expect(d1).toBeLessThanOrEqual(6);
      counts[d1 - 1]!++;
      counts[d2 - 1]!++;
      if (d1 === d2) doubles++;
    }
    for (const c of counts) expect(Math.abs(c / (2 * N) - 1 / 6)).toBeLessThan(0.01);
    expect(Math.abs(doubles / N - 1 / 6)).toBeLessThan(0.01);
  });

  it('can resume from a stored state', () => {
    const a = createRng(seedToState(99));
    a.next();
    a.next();
    const b = createRng(a.state);
    expect(b.next()).toBe(a.next());
  });
});
