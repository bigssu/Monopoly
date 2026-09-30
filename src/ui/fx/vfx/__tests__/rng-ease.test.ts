import { describe, expect, it } from 'vitest';
import { backOvershoot, c1ForOvershoot, ease, Ease, outBack, POP_C1, PIP_C1, TIER_POP, inOutQuad, outCubic } from '../ease';
import { mixSeed, mulberry32 } from '../rng';

describe('vfx rng', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const sa = Array.from({ length: 50 }, () => a.next());
    expect(Array.from({ length: 50 }, () => b.next())).toEqual(sa);
    expect(Array.from({ length: 50 }, () => c.next())).not.toEqual(sa);
    for (const v of sa) expect(v >= 0 && v < 1).toBe(true);
  });

  it('helpers stay in range and look uniform', () => {
    const r = mulberry32(7);
    let sum = 0;
    for (let i = 0; i < 20000; i++) {
      const v = r.range(2, 4);
      expect(v >= 2 && v < 4).toBe(true);
      const j = r.jitter(1);
      expect(Math.abs(j) <= 1).toBe(true);
      const n = r.int(5);
      expect(Number.isInteger(n) && n >= 0 && n < 5).toBe(true);
      sum += r.next();
    }
    expect(sum / 20000).toBeGreaterThan(0.48);
    expect(sum / 20000).toBeLessThan(0.52);
    expect(mixSeed(1, 2)).not.toBe(mixSeed(1, 3));
    expect(mixSeed(1, 2)).toBe(mixSeed(1, 2));
  });
});

describe('vfx easing (VFX.md §7.2b.0)', () => {
  const peak = (c1: number): number => {
    let m = 0;
    for (let i = 0; i <= 10000; i++) m = Math.max(m, outBack(i / 10000, c1));
    return m - 1;
  };

  it('popBack overshoot table: 8 / 10 / 12 / 15 %', () => {
    expect(peak(POP_C1[8])).toBeCloseTo(0.08, 3);
    expect(peak(POP_C1[10])).toBeCloseTo(0.1, 3);
    expect(peak(POP_C1[12])).toBeCloseTo(0.12, 2);
    expect(peak(POP_C1[15])).toBeCloseTo(0.15, 2);
    expect(peak(PIP_C1)).toBeCloseTo(0.15, 2);
    for (const c1 of [1.5, 1.70158, 1.9, 2.17]) expect(backOvershoot(c1)).toBeCloseTo(peak(c1), 4);
  });

  it('c1ForOvershoot inverts backOvershoot', () => {
    expect(c1ForOvershoot(0.1)).toBeCloseTo(1.70158, 3);
    expect(c1ForOvershoot(0.08)).toBeCloseTo(1.5, 2);
    expect(c1ForOvershoot(0.15)).toBeCloseTo(2.17, 1);
  });

  it('tier pops overshoot monotonically with the level', () => {
    const o = ([1, 2, 3, 4] as const).map((l) => backOvershoot(TIER_POP[l].c1));
    for (let i = 1; i < o.length; i++) expect(o[i]!).toBeGreaterThan(o[i - 1]!);
    expect(TIER_POP[3].zoom).toBe(1.1);
    expect(TIER_POP[4].zoom).toBe(1.25);
  });

  it('every ease id maps 0 → 0 and 1 → 1, in-range midpoints', () => {
    for (const id of Object.values(Ease)) {
      expect(ease(id, 0)).toBe(0);
      expect(ease(id, 1)).toBe(1);
      expect(Number.isFinite(ease(id, 0.5))).toBe(true);
    }
    expect(inOutQuad(0.5)).toBeCloseTo(0.5);
    expect(outCubic(0.5)).toBeCloseTo(0.875);
    expect(ease(Ease.InQuad, 0.5)).toBeCloseTo(0.25);
  });
});
