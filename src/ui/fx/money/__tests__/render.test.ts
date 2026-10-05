/** Money stage render tiers (render.ts, docs/MONEY-EVENTS.md §12). */
import { describe, expect, it } from 'vitest';
import { devicePixels, HEALTH_DEFAULTS, MoneyHealth, pickTier, resolveRender, stepsBelow, tier3d, TIER_BUDGET_MB, TIER_SCALE } from '../render';

describe('pickTier', () => {
  it('the test viewport (1600×1000 DPR 2) is high with 8 GB, mid with 4 GB', () => {
    expect(devicePixels({ w: 1600, h: 1000, dpr: 2 })).toBe(6_400_000);
    expect(pickTier({ w: 1600, h: 1000, dpr: 2, deviceMemory: 8 })).toBe('high');
    expect(pickTier({ w: 1600, h: 1000, dpr: 2, deviceMemory: 4 })).toBe('mid');
    expect(pickTier({ w: 1600, h: 1000, dpr: 2, deviceMemory: 2 })).toBe('low');
  });

  it('a 1280×800 DPR 1.5 tablet is mid or low, never high (a budget screen)', () => {
    expect(pickTier({ w: 1280, h: 800, dpr: 1.5, deviceMemory: 8 })).toBe('mid');
    expect(pickTier({ w: 1280, h: 800, dpr: 1.5, deviceMemory: 4 })).toBe('mid');
    expect(pickTier({ w: 1280, h: 800, dpr: 1.5, deviceMemory: 2 })).toBe('low');
    expect(pickTier({ w: 1280, h: 800, dpr: 1.5, deviceMemory: 1 })).toBe('low');
  });

  it('a 2560×1600 DPR 2 screen (16.4 M device pixels) is mid with 8 GB, low with less', () => {
    expect(pickTier({ w: 2560, h: 1600, dpr: 2, deviceMemory: 8 })).toBe('mid');
    expect(pickTier({ w: 2560, h: 1600, dpr: 2, deviceMemory: 4 })).toBe('low');
  });

  it('no deviceMemory (not reported) counts as 4 GB', () => {
    expect(pickTier({ w: 1600, h: 1000, dpr: 2 })).toBe('mid');
    expect(pickTier({ w: 1600, h: 1000, dpr: 2, deviceMemory: null })).toBe('mid');
    expect(pickTier({ w: 800, h: 450, dpr: 1 })).toBe('mid');
  });
});

describe('resolveRender', () => {
  it('auto follows the tier: scale, 3D, budget', () => {
    expect(resolveRender({ auto: 'high' })).toMatchObject({ tier: 'high', scale: 1, tilt: true, camera: true, budgetMB: 250, source: 'auto' });
    expect(resolveRender({ auto: 'low' })).toMatchObject({ tier: 'low', scale: 0.5, tilt: false, budgetMB: 100 });
    expect(TIER_SCALE.mid).toBe(0.75);
    expect(TIER_BUDGET_MB.mid).toBe(150);
  });

  it('the safety net lowers the auto tier; settings and dev overrides win', () => {
    expect(resolveRender({ auto: 'high', stepDown: 1 })).toMatchObject({ tier: 'mid', source: 'auto −1' });
    expect(resolveRender({ auto: 'high', stepDown: 2 })).toMatchObject({ tier: 'low' });
    expect(resolveRender({ auto: 'mid', stepDown: 5 }).tier).toBe('low');
    expect(resolveRender({ auto: 'low', res: 'high', stepDown: 2 })).toMatchObject({ tier: 'high', source: 'setting' });
    expect(resolveRender({ auto: 'high', res: 'low' })).toMatchObject({ tier: 'low', scale: 0.5 });
    expect(resolveRender({ auto: 'high', res: 'low', dev: 'mid' })).toMatchObject({ tier: 'mid', source: 'dev' });
    expect(resolveRender({ auto: 'low', fx3d: 'on' })).toMatchObject({ tilt: true, camera: true });
    expect(resolveRender({ auto: 'high', fx3d: 'off' })).toMatchObject({ tilt: false, camera: false });
    // Mid: the hero tilts, the board camera stays off (peak layers ≤ 20, PERFORMANCE.md "라운드 2").
    expect(resolveRender({ auto: 'mid', pixels: 1280 * 800 * 1.5 * 1.5 })).toMatchObject({ tier: 'mid', tilt: true, camera: false });
    expect(resolveRender({ auto: 'mid', fx3d: 'on' })).toMatchObject({ tilt: true, camera: false });
  });

  it('3D: always on high, on mid only up to 4.1 M device pixels, never on low', () => {
    expect(tier3d('high', 16e6)).toBe(true);
    expect(tier3d('mid', devicePixels({ w: 1280, h: 800, dpr: 1.5 }))).toBe(true);
    expect(tier3d('mid', devicePixels({ w: 1600, h: 1000, dpr: 2 }))).toBe(false);
    expect(tier3d('low', 1e6)).toBe(false);
    expect(resolveRender({ auto: 'mid', pixels: 2.3e6 }).tilt).toBe(true);
    expect(resolveRender({ auto: 'mid', pixels: 6.4e6 }).tilt).toBe(false);
  });

  it('stepsBelow', () => {
    expect([stepsBelow('high'), stepsBelow('mid'), stepsBelow('low')]).toEqual([2, 1, 0]);
  });
});

describe('MoneyHealth (runtime safety net)', () => {
  const scene = (h: MoneyHealth, step: number, gap: number, n = 40): ReturnType<MoneyHealth['end']> => {
    h.begin();
    for (let i = 0; i < n; i++) h.sample(step, gap);
    return h.end(2);
  };

  it('two bad cut-ins in a row step down one tier; one bad one does not', () => {
    const h = new MoneyHealth();
    expect(scene(h, 2, 34)).toBeNull();
    expect(scene(h, 2, 90)).toBeNull();
    expect(scene(h, 2, 34)).toBeNull();
    expect(scene(h, 2, 90)).toBeNull();
    const r = scene(h, 2, 90);
    expect(r?.change).toBe(1);
    expect(h.stepDown).toBe(1);
  });

  it('a slow scene step (JS) counts as bad too; late share is a share', () => {
    const h = new MoneyHealth();
    scene(h, 12, 34);
    expect(scene(h, 12, 34)?.change).toBe(1);
    const g = new MoneyHealth();
    // 20 % late (under 25 %): healthy.
    for (let k = 0; k < 3; k++) {
      g.begin();
      for (let i = 0; i < 40; i++) g.sample(1, i % 5 === 0 ? 80 : 33);
      expect(g.end(2)).toBeNull();
    }
    expect(g.history).toEqual(['ok', 'ok', 'ok']);
  });

  it('steps back up after four healthy cut-ins, never below the floor or above auto', () => {
    const h = new MoneyHealth();
    for (let k = 0; k < 4; k++) scene(h, 1, 120);
    expect(h.stepDown).toBe(2);
    // At the bottom: more bad cut-ins change nothing.
    expect(scene(h, 1, 120)).toBeNull();
    expect(scene(h, 1, 120)).toBeNull();
    expect(h.stepDown).toBe(2);
    for (let k = 0; k < HEALTH_DEFAULTS.upScenes - 1; k++) expect(scene(h, 1, 33)).toBeNull();
    expect(scene(h, 1, 33)?.change).toBe(-1);
    expect(h.stepDown).toBe(1);
    for (let k = 0; k < HEALTH_DEFAULTS.upScenes; k++) scene(h, 1, 33);
    expect(h.stepDown).toBe(0);
    for (let k = 0; k < 10; k++) expect(scene(h, 1, 33)).toBeNull();
  });

  it('short / skipped cut-ins are not judged', () => {
    const h = new MoneyHealth();
    expect(scene(h, 50, 500, 5)).toBeNull();
    expect(scene(h, 50, 500, 5)).toBeNull();
    expect(h.stepDown).toBe(0);
    expect(h.history).toEqual(['skip', 'skip']);
  });
});
