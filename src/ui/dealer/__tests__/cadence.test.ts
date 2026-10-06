/**
 * Dealer talking cadence (cadence.ts, owner review 2026-10-06 "the arms go up over and over"):
 * while a voiced line plays, an arms-up expression shows half as often as before, the mouth keeps
 * flapping at the same rate, and arms-down expressions keep their cadence.
 */
import { describe, expect, it } from 'vitest';
import { ARMS_UP, FLAP_MS, flapFrame } from '../cadence';
import type { DealerExpr } from '../lines';

/** The cadence before the change: talk-a, talk-b, expr every FLAP_MS (Dealer.flapAfter until 2026-10-06). */
const before = (t: number, expr: string): string => {
  const f = Math.floor(t / FLAP_MS) % 3;
  return f === 0 ? 'talk-a' : f === 1 ? 'talk-b' : expr;
};

/** Sample `frame(t)` on the 30 Hz clock for `seconds` of talking: shows of the expression and mouth changes per second. */
function count(frame: (t: number) => string, expr: string, seconds = 12): { exprPerS: number; mouthPerS: number } {
  let prev = '';
  let shows = 0;
  let mouth = 0;
  for (let k = 0; k * (1000 / 30) < seconds * 1000; k++) {
    const s = frame(k * (1000 / 30));
    if (s !== prev) {
      if (s === expr) shows++;
      else if (prev !== '' && prev !== expr) mouth++;
    }
    prev = s;
  }
  return { exprPerS: shows / seconds, mouthPerS: mouth / seconds };
}

const ALL: DealerExpr[] = ['idle', 'point', 'cheer', 'surprised', 'sad', 'thinking', 'nervous', 'laugh', 'dice', 'present', 'trophy'];

describe('dealer talking cadence', () => {
  it('the arms-up sprites are the ones that raise a hand to the face or above', () => {
    expect([...ARMS_UP].sort()).toEqual(['cheer', 'dice', 'point', 'sad', 'surprised', 'thinking', 'trophy']);
  });

  it('halves the expression frames per second for every arms-up expression', () => {
    for (const e of ARMS_UP) {
      const b = count((t) => before(t, e), e);
      const a = count((t) => flapFrame(t, e), e);
      // Before: one every 360 ms (2.78/s). After: one every 720 ms (1.39/s).
      expect(b.exprPerS, e).toBeCloseTo(1000 / (3 * FLAP_MS), 0);
      expect(a.exprPerS, e).toBeLessThanOrEqual(b.exprPerS / 2 + 0.01);
      expect(a.exprPerS, e).toBeCloseTo(1000 / (6 * FLAP_MS), 0);
    }
  });

  it('keeps the cadence of arms-down expressions', () => {
    for (const e of ALL.filter((x) => !ARMS_UP.has(x))) {
      const b = count((t) => before(t, e), e);
      const a = count((t) => flapFrame(t, e), e);
      expect(a.exprPerS, e).toBe(b.exprPerS);
      for (let t = 0; t < 3000; t += 10) expect(flapFrame(t, e)).toBe(before(t, e));
    }
  });

  it('the mouth still changes every FLAP_MS between the expression frames', () => {
    const e: DealerExpr = 'cheer';
    for (let t = 0; t < 4000; t += FLAP_MS) {
      const s = flapFrame(t, e);
      const n = flapFrame(t + FLAP_MS, e);
      expect(n, `${t} ms`).not.toBe(s);
      if (s !== e && n !== e) expect(new Set([s, n])).toEqual(new Set(['talk-a', 'talk-b']));
    }
    // More mouth movement per second than before (the frames the arms used now move the mouth).
    expect(count((t) => flapFrame(t, e), e).mouthPerS).toBeGreaterThan(count((t) => before(t, e), e).mouthPerS);
  });
});
