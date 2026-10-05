/**
 * Canvas effects in the Android app are opt-in: some WebViews draw the effect canvases as opaque
 * white boxes flashing over the table (prefs.ts `fxQualityOn`).
 */
import { describe, expect, it } from 'vitest';
import { fxQualityOn } from '../prefs';

describe('effects quality per platform', () => {
  it('the web uses the chosen quality', () => {
    expect(fxQualityOn({ fxQuality: 'low', fxNative: false }, false)).toBe('low');
  });
  it('the Android app keeps canvas effects off until the player turns them on', () => {
    expect(fxQualityOn({ fxQuality: 'low', fxNative: false }, true)).toBe('off');
    expect(fxQualityOn({ fxQuality: 'high', fxNative: true }, true)).toBe('high');
    expect(fxQualityOn({ fxQuality: 'off', fxNative: true }, true)).toBe('off');
  });
});
