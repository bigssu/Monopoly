import { describe, expect, it } from 'vitest';
import { cubicBezier, interpolator, quantizedEasing, stepKeyframes } from '@/ui/fx/quantize';

describe('frame-budget quantization', () => {
  it('samples a two-keyframe animation into 30 Hz step-end keyframes', () => {
    const kf = stepKeyframes([{ opacity: 0 }, { opacity: 1 }], 'linear', 200, 30)!;
    // 200 ms = 6 periods → 6 held samples + the final value.
    expect(kf).toHaveLength(7);
    expect(kf.slice(0, -1).every((k) => k.easing === 'step-end')).toBe(true);
    expect(kf.map((k) => k.opacity)).toEqual([0, 0.1667, 0.3333, 0.5, 0.6667, 0.8333, 1]);
    expect(kf[0]!.offset).toBe(0);
    expect(kf[6]!.offset).toBe(1);
    expect(kf[6]!.easing).toBeUndefined();
  });

  it('follows the effect easing and per-keyframe offsets', () => {
    const ease = 'cubic-bezier(.22,1,.36,1)';
    const f = cubicBezier(0.22, 1, 0.36, 1);
    const kf = stepKeyframes(
      [{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-10px) scale(1.2)', offset: 0.5 }, { transform: 'translateY(0) scale(1)' }],
      ease,
      400,
      30,
    )!;
    expect(kf).toHaveLength(13);
    const p = f(1 / 12); // progress at the 2nd sample (< 0.5: first segment)
    expect(p).toBeLessThan(0.5);
    const y = -10 * (p / 0.5);
    expect(kf[1]!.transform).toBe(`translateY(${Math.round(y * 1e4) / 1e4}px) scale(${Math.round((1 + 0.2 * (p / 0.5)) * 1e4) / 1e4})`);
    const q = f(8 / 12); // second segment: back down
    expect(q).toBeGreaterThan(0.5);
    const y2 = -10 + 10 * ((q - 0.5) / 0.5);
    expect(kf[8]!.transform).toBe(`translateY(${Math.round(y2 * 1e4) / 1e4}px) scale(${Math.round((1.2 - 0.2 * ((q - 0.5) / 0.5)) * 1e4) / 1e4})`);
    expect(kf[12]!.transform).toBe('translateY(0px) scale(1)');
  });

  it('pads transform lists and handles `none`', () => {
    const f = interpolator('transform', 'translate(0,0)', 'translate(-7px, 2.8px) rotate(-.3deg)')!;
    expect(f(0.5)).toBe('translate(-3.5px, 1.4px) rotate(-0.15deg)');
    const g = interpolator('transform', 'none', 'translateX(-4%) rotate(-2deg)')!;
    expect(g(0.5)).toBe('translateX(-2%) rotate(-1deg)');
    const s = interpolator('transform', 'scale(1.1)', 'scale(1.06, 1.22)')!;
    expect(s(0)).toBe('scale(1.1, 1.1)');
  });

  it('interpolates colors and individual transform properties', () => {
    expect(interpolator('color', '#000000', '#ffffff')!(0.5)).toBe('rgba(128, 128, 128, 1)');
    expect(interpolator('scale', '0.6', '1')!(0.5)).toBe('0.8');
  });

  it('gives up (caller falls back) on values it cannot evaluate', () => {
    expect(stepKeyframes([{ color: '#25A55A' }, { color: 'var(--ink)' }], 'linear', 300, 30)).toBeNull();
    // Implicit end value (the underlying style is only known to the browser).
    expect(stepKeyframes([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-20%)' }], 'linear', 300, 30)).toBeNull();
    expect(stepKeyframes([{ transform: 'matrix(1,0,0,1,0,0)' }, { transform: 'none' }], 'linear', 300, 30)).toBeNull();
    expect(stepKeyframes([{ opacity: 0 }, { opacity: 1 }], 'steps(4)', 300, 30)).toBeNull();
    // 60 Hz: no quantization at all.
    expect(stepKeyframes([{ opacity: 0 }, { opacity: 1 }], 'linear', 300, 60)).toBeNull();
  });

  it('extrapolates overshooting easings like CSS', () => {
    const f = cubicBezier(0.34, 1.56, 0.64, 1);
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => f(i / 49)))).toBeGreaterThan(1);
    const kf = stepKeyframes([{ opacity: 0 }, { opacity: 1 }], 'cubic-bezier(.34,1.56,.64,1)', 300, 30)!;
    expect(Math.max(...kf.map((k) => k.opacity as number))).toBeGreaterThan(1);
  });

  it('builds staircase effect easings (fallback path)', () => {
    expect(quantizedEasing('linear', 1300, 30, false)).toBe('steps(39, end)');
    expect(quantizedEasing('ease-out', 300, 30, false)).toBeNull();
    expect(quantizedEasing('ease-out', 300, 30, true)).toMatch(/^linear\(0 0%, 0 11\.1111%, /);
    expect(quantizedEasing('linear', 300, 60, true)).toBeNull();
  });
});
