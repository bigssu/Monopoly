/**
 * Canvas effects in the Android app are opt-in: some WebViews draw the effect canvases as opaque
 * white boxes flashing over the table (prefs.ts `fxQualityOn`).
 */
import { describe, expect, it } from 'vitest';
import { fxCanvasFor, fxQualityOn } from '../prefs';

describe('effects quality per platform', () => {
  it('the web uses the chosen quality', () => {
    expect(fxQualityOn({ fxQuality: 'low', fxNative: false }, false)).toBe('low');
  });
  it('the Android app keeps canvas effects off until the player turns them on', () => {
    expect(fxQualityOn({ fxQuality: 'low', fxNative: false }, true)).toBe('off');
    expect(fxQualityOn({ fxQuality: 'high', fxNative: true }, true)).toBe('high');
    expect(fxQualityOn({ fxQuality: 'off', fxNative: true }, true)).toBe('off');
  });
  it('the Result confetti follows the same rule: no canvas in the app by default, main thread when chosen', () => {
    expect(fxCanvasFor({ fxQuality: 'low', fxNative: false }, true)).toBeNull();
    expect(fxCanvasFor({ fxQuality: 'high', fxNative: true }, true)).toEqual({ quality: 'high', worker: false });
    expect(fxCanvasFor({ fxQuality: 'low', fxNative: false }, false)).toEqual({ quality: 'low', worker: true });
    expect(fxCanvasFor({ fxQuality: 'off', fxNative: false }, false)).toBeNull();
  });
});
