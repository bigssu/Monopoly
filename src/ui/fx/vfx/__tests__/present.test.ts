import { describe, expect, it } from 'vitest';
import { ADAPTIVE_DEFAULTS, AdaptiveQuality } from '../director';
import { Clusterer, quantScale, SLOT_CLASSES } from '../present';
import { Runner } from '../timeline';
import { ANIM_INDEX } from '../particles';
import { buildPreset } from '../presets';
import { fakeEnv } from './helpers';

const boxes = (list: Array<[number, number, number]>) => ({
  n: list.length,
  x0: Float64Array.from(list.map(([x, , r]) => x - r)),
  y0: Float64Array.from(list.map(([, y, r]) => y - r)),
  x1: Float64Array.from(list.map(([x, , r]) => x + r)),
  y1: Float64Array.from(list.map(([, y, r]) => y + r)),
});

describe('partial presentation: clustering (VFX.md §15)', () => {
  it('groups nearby particles and keeps distant groups apart', () => {
    const c = new Clusterer();
    const b = boxes([
      [100, 100, 10],
      [120, 110, 10],
      [900, 700, 10],
      [910, 690, 12],
    ]);
    expect(c.run(b.n, b.x0, b.y0, b.x1, b.y1, 1600, 1000, 3)).toBe(2);
    expect(c.label[0]).toBe(c.label[1]);
    expect(c.label[2]).toBe(c.label[3]);
    expect(c.label[0]).not.toBe(c.label[2]);
  });

  it('merges down to the canvas limit (least added area first) and overlapping boxes always', () => {
    const c = new Clusterer();
    const b = boxes([
      [100, 100, 10],
      [800, 100, 10],
      [1500, 900, 10],
      [300, 300, 200],
      [320, 300, 190],
    ]);
    const n = c.run(b.n, b.x0, b.y0, b.x1, b.y1, 1600, 1000, 2);
    expect(n).toBe(2);
    expect(c.label[3]).toBe(c.label[4]);
    // Every particle box lies inside its cluster box.
    for (let p = 0; p < b.n; p++) {
      const k = c.label[p]!;
      expect(b.x0[p]).toBeGreaterThanOrEqual(c.x0[k]!);
      expect(b.x1[p]).toBeLessThanOrEqual(c.x1[k]!);
      expect(b.y0[p]).toBeGreaterThanOrEqual(c.y0[k]!);
      expect(b.y1[p]).toBeLessThanOrEqual(c.y1[k]!);
    }
    expect(c.run(b.n, b.x0, b.y0, b.x1, b.y1, 1600, 1000, 1)).toBe(1);
  });

  it('quantizes backing scales downward and caps them', () => {
    expect(quantScale(3, 1.5)).toBe(1.5);
    expect(quantScale(1.1, 1.5)).toBe(1);
    expect(quantScale(0.61, 2)).toBe(0.6);
    expect(quantScale(0.01, 2)).toBeGreaterThan(0);
    // Size classes grow by area; the largest is the old single-canvas budget.
    const areas = SLOT_CLASSES.map((k) => k.w * k.h);
    expect(Math.max(...areas)).toBeLessThanOrEqual(0.6e6);
  });
});

describe('adaptive quality (VFX.md §15.4)', () => {
  const feed = (aq: AdaptiveQuality, n: number, tick: number, gap: number, t0 = 0): string[] => {
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const why = aq.sample(tick, gap, t0 + i * 33);
      if (why) out.push(`${aq.tier}`);
    }
    return out;
  };

  it('steps down after a slow window, and again, then retries low after a pause', () => {
    const aq = new AdaptiveQuality();
    expect(feed(aq, 30, 2, 33.3)).toEqual([]);
    expect(aq.tier).toBe('high');
    expect(feed(aq, 30, 8, 33.3)).toEqual([]);
    expect(feed(aq, 30, 8, 33.3)).toEqual(['low']);
    expect(feed(aq, 60, 2, 60)).toEqual(['minimal']);
    // No samples count in 'minimal'; a play after retryMs goes back to 'low'.
    expect(feed(aq, 60, 20, 90)).toEqual([]);
    expect(aq.onPlay(aq.since + 1000)).toBeNull();
    expect(aq.onPlay(aq.since + ADAPTIVE_DEFAULTS.retryMs)).not.toBeNull();
    expect(aq.tier).toBe('low');
  });

  it('a few late ticks (the game\'s own event frames) do not step down; sustained health steps back up', () => {
    const aq = new AdaptiveQuality();
    for (let w = 0; w < 5; w++) {
      feed(aq, 25, 1, 33.3);
      feed(aq, 5, 1, 66.7);
    }
    expect(aq.tier).toBe('high');
    aq.set('low', 0);
    expect(feed(aq, 30 * (ADAPTIVE_DEFAULTS.upWindows - 1), 1, 33.3)).toEqual([]);
    expect(feed(aq, 30, 1, 33.3)).toEqual(['high']);
  });
});

describe('quality low: lite effects (VFX.md §15.4)', () => {
  it('spawns no glow sprites and never shakes', () => {
    const shakes: number[] = [];
    const r = new Runner({ shake: (px) => shakes.push(px) });
    const tl = buildPreset('tollPay', { payer: 0, receiver: 2, amount: 3000, space: 22 }, fakeEnv());
    const e = r.start(tl, { u: 30, lite: true, quality: 0.5 });
    let glows = 0;
    for (let f = 0; f < 60; f++) {
      r.advance(1);
      for (let i = 0; i < r.pool.cap; i++) if (r.pool.isAlive(i) && r.pool.anim[i] === ANIM_INDEX.glow) glows++;
    }
    expect(e.stats.spawned).toBeGreaterThan(0);
    expect(shakes).toEqual([]);
    const full = new Runner({ shake: (px) => shakes.push(px) });
    full.start(buildPreset('tollPay', { payer: 0, receiver: 2, amount: 3000, space: 22 }, fakeEnv()), { u: 30 });
    for (let f = 0; f < 60; f++) full.advance(1);
    expect(shakes.length).toBeGreaterThan(0);
    expect(glows).toBe(0);
  });
});
