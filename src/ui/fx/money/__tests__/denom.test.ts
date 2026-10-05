import { describe, expect, it } from 'vitest';
import {
  chunks, columnOverflows, countMs, flightsForAmount, ladderStep, maxTier, pileOf, pileValue, planDrain, planFlights, planMerge,
  tierFor, TIER, visibleCoins, COLUMN_MAX,
} from '../denom';

describe('denominations', () => {
  it('splits cash into gold / silver / bronze digits and an invisible rest', () => {
    expect(pileOf(3450)).toEqual({ gold: 3, silver: 4, bronze: 5, rest: 0 });
    expect(pileOf(3000)).toEqual({ gold: 3, silver: 0, bronze: 0, rest: 0 });
    expect(pileOf(300)).toEqual({ gold: 0, silver: 3, bronze: 0, rest: 0 });
    expect(pileOf(12345)).toEqual({ gold: 12, silver: 3, bronze: 4, rest: 5 });
    expect(pileOf(-5)).toEqual({ gold: 0, silver: 0, bronze: 0, rest: 0 });
    expect(pileValue(pileOf(98765))).toBe(98765);
  });

  it('shows silver / bronze exactly and log-compresses gold above 5', () => {
    expect([0, 1, 5, 6, 8, 12, 20].map((n) => visibleCoins('gold', n))).toEqual([0, 1, 5, 6, 7, 8, 9]);
    expect(visibleCoins('silver', 9)).toBe(9);
    expect(visibleCoins('bronze', 14)).toBe(14);
    expect(visibleCoins('silver', 40)).toBe(COLUMN_MAX);
    expect(visibleCoins('gold', 10 ** 6)).toBeLessThanOrEqual(COLUMN_MAX);
    expect(columnOverflows('gold', 5)).toBe(false);
    expect(columnOverflows('gold', 6)).toBe(false);
    expect(columnOverflows('gold', 8)).toBe(true);
    expect(columnOverflows('silver', 16)).toBe(true);
  });
});

describe('paying (planDrain)', () => {
  it('breaks a gold into ten silver, then a silver into ten bronze, right before the coins that need them', () => {
    const plan = planDrain(pileOf(3000), 240);
    expect(plan.coins.map((c) => c.metal)).toEqual(['silver', 'silver', 'bronze', 'bronze', 'bronze', 'bronze']);
    expect(plan.coins[0]!.breaks).toEqual([{ from: 'gold', to: 'silver' }]);
    expect(plan.coins[2]!.breaks).toEqual([{ from: 'silver', to: 'bronze' }]);
    expect(plan.coins.filter((c) => c.breaks.length).length).toBe(2);
    expect(plan.after).toEqual(pileOf(2760));
    expect(plan.paid).toBe(240);
  });

  it('breaks recursively (gold → silver → bronze) when only gold is left', () => {
    const plan = planDrain(pileOf(1000), 10);
    expect(plan.coins).toEqual([{ metal: 'bronze', breaks: [{ from: 'gold', to: 'silver' }, { from: 'silver', to: 'bronze' }] }]);
    expect(plan.after).toEqual(pileOf(990));
  });

  it('pays gold first and needs no break when the digits allow', () => {
    const plan = planDrain(pileOf(3450), 1230);
    expect(plan.coins.map((c) => c.metal)).toEqual(['gold', 'silver', 'silver', 'bronze', 'bronze', 'bronze']);
    expect(plan.coins.every((c) => !c.breaks.length)).toBe(true);
  });

  it('always leaves pileOf(cash − amount) and never pays more than the cash', () => {
    for (let cash = 0; cash <= 4200; cash += 37) {
      for (const amount of [0, 5, 10, 15, 95, 100, 240, 999, 1000, 1005, 2500, 5000]) {
        const plan = planDrain(pileOf(cash), amount);
        const paid = Math.min(amount, cash);
        expect(plan.paid).toBe(paid);
        expect(plan.after, `${cash} - ${amount}`).toEqual(pileOf(cash - paid));
        const coinValue = plan.coins.reduce((s, c) => s + ({ gold: 1000, silver: 100, bronze: 10 })[c.metal], 0);
        expect(coinValue + plan.rest).toBe(paid);
      }
    }
  });

  it('takes the sub-bronze rest from a broken bronze', () => {
    const plan = planDrain(pileOf(100), 5);
    expect(plan.coins).toEqual([]);
    expect(plan.rest).toBe(5);
    expect(plan.restBreaks).toEqual([{ from: 'silver', to: 'bronze' }, { from: 'bronze', to: 'rest' }]);
    expect(plan.after).toEqual(pileOf(95));
  });
});

describe('receiving (planMerge)', () => {
  it('merges 10 bronze → 1 silver and 10 silver → 1 gold, cascading', () => {
    const { merges, after } = planMerge({ gold: 2, silver: 9, bronze: 13, rest: 0 });
    expect(merges).toEqual([
      { from: 'bronze', to: 'silver', count: 1 },
      { from: 'silver', to: 'gold', count: 1 },
    ]);
    expect(after).toEqual({ gold: 3, silver: 0, bronze: 3, rest: 0 });
    expect(pileValue(after)).toBe(3030);
  });

  it('is a no-op on a canonical pile and folds the rest', () => {
    expect(planMerge(pileOf(3450)).merges).toEqual([]);
    expect(planMerge({ gold: 0, silver: 0, bronze: 9, rest: 15 }).after).toEqual({ gold: 0, silver: 1, bronze: 0, rest: 5 });
  });

  it('keeps the value of any arrival sequence', () => {
    for (let a = 0; a < 3000; a += 113) {
      for (let b = 0; b < 2500; b += 271) {
        const p = pileOf(a);
        const add = pileOf(b);
        const sum = { gold: p.gold + add.gold, silver: p.silver + add.silver, bronze: p.bronze + add.bronze, rest: p.rest + add.rest };
        expect(planMerge(sum).after).toEqual(pileOf(a + b));
      }
    }
  });
});

describe('flights', () => {
  it('stays within the tier range, carries every coin once and sums to the amount', () => {
    for (const amount of [5, 10, 30, 100, 240, 340, 999, 1000, 1360, 4870, 12000]) {
      for (const tier of ['S', 'M', 'L', 'XL'] as const) {
        const plan = planDrain(pileOf(20000), amount);
        const fl = planFlights(plan, tier);
        expect(fl.length).toBeGreaterThanOrEqual(TIER[tier].min);
        expect(fl.length).toBeLessThanOrEqual(TIER[tier].max);
        expect(fl.reduce((s, x) => s + x.value, 0)).toBe(amount);
        expect(fl.flatMap((x) => x.coins)).toEqual(plan.coins.map((c) => c.metal));
        for (const x of fl) if (x.coins.length) expect(x.metal).toBe(x.coins[0]);
      }
    }
  });

  it('tops up with decorative coins (value 0) when there are too few coins', () => {
    const fl = flightsForAmount(1000, 'M');
    expect(fl.length).toBe(TIER.M.min);
    expect(fl.filter((x) => x.value > 0)).toHaveLength(1);
    expect(fl.filter((x) => !x.coins.length).every((x) => x.value === 0)).toBe(true);
  });

  it('decorations interleave and the last flight always carries value (cha-ching on real money)', () => {
    const one = flightsForAmount(1000, 'M');
    expect(one.at(-1)!.value).toBe(1000);
    const three = flightsForAmount(300, 'M');
    expect(three.map((x) => x.value > 0)).toEqual([false, true, false, true, false, true]);
    for (const amount of [5, 10, 30, 100, 1000, 2000]) for (const t of ['S', 'M', 'L', 'XL'] as const) expect(flightsForAmount(amount, t).at(-1)!.value).toBeGreaterThan(0);
  });

  it('honours an explicit range (builds: 3 / 4 / 6 / 8 coins)', () => {
    for (const n of [3, 4, 6, 8]) expect(flightsForAmount(250, { min: n, max: n })).toHaveLength(n);
  });

  it('chunks split an amount exactly', () => {
    expect(chunks(340, 8).reduce((s, v) => s + v, 0)).toBe(340);
    expect(chunks(7, 3)).toEqual([2, 2, 3]);
    expect(chunks(5, 0)).toEqual([]);
  });
});

describe('tiers and timing', () => {
  it('picks the tier from the amount and the share of the payer cash', () => {
    expect(tierFor(50)).toBe('S');
    expect(tierFor(100)).toBe('M');
    expect(tierFor(499)).toBe('M');
    expect(tierFor(500)).toBe('L');
    expect(tierFor(1000)).toBe('XL');
    expect(tierFor(300, 600)).toBe('XL');
    expect(tierFor(300, 3000)).toBe('M');
    expect(tierFor(50, 60)).toBe('S');
    expect(maxTier('M', 'S')).toBe('M');
    expect(maxTier('L', 'XL')).toBe('XL');
  });

  it('tier lengths grow S < M < L < XL and keep ≤ 16 flights', () => {
    expect(TIER.S.frames).toBeLessThan(TIER.M.frames);
    expect(TIER.M.frames).toBeLessThan(TIER.L.frames);
    expect(TIER.L.frames).toBeLessThan(TIER.XL.frames);
    for (const t of Object.values(TIER)) expect(t.max).toBeLessThanOrEqual(16);
  });

  it('count-up length is 500 + 300·log10(1 + amount/10) ms, clamped to 500–1100', () => {
    expect(countMs(0)).toBe(500);
    expect(countMs(30)).toBeCloseTo(680.6, 0);
    expect(countMs(300)).toBeCloseTo(947.4, 0);
    expect(countMs(30000)).toBe(1100);
  });

  it('the receiving ladder is pentatonic and capped by the tier', () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => ladderStep(i, 7))).toEqual([0, 2, 4, 7, 7, 7]);
    expect(ladderStep(7, 12)).toBe(12);
    expect(ladderStep(2, 4)).toBe(4);
  });
});
