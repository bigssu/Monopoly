import { describe, expect, it } from 'vitest';
import { OWNER_INK_CONTRAST, PLAYER_COLORS, contrast, inkOn } from '../palette';

describe('ink on an owner-filled board space', () => {
  for (const c of PLAYER_COLORS) {
    it(`${c.id}: name / price ink reads on the full player color`, () => {
      const { ink } = inkOn(c);
      expect(contrast(ink, c.hex)).toBeGreaterThanOrEqual(OWNER_INK_CONTRAST);
      // Never the palette's `dark` (under 2:1 on its own color).
      expect(ink).not.toBe(c.dark);
    });
  }

  it('contrast() matches the WCAG reference values', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
  });
});
