import { describe, expect, it } from 'vitest';
import { DEPTH, VB, getBoardGeometry, tokenSpot } from './geometry';

describe('board geometry profiles', () => {
  for (const size of [7, 8, 9] as const) {
    it(`${size} spaces per side closes the ring and keeps tokens in their tile`, () => {
      const geom = getBoardGeometry(size);
      const corners = [0, size + 1, 2 * (size + 1), 3 * (size + 1)];
      expect(geom).toHaveLength(4 * (size + 1));
      expect(corners.map((i) => geom[i]!.corner)).toEqual([true, true, true, true]);
      expect(geom[0]).toMatchObject({ x: VB - DEPTH, y: VB - DEPTH, w: DEPTH, h: DEPTH });
      for (const i of [1, size, size + 2, geom.length - 1]) {
        const spot = tokenSpot(i, 0, 1, size);
        const g = geom[i]!;
        expect(spot.x).toBeGreaterThanOrEqual(g.x);
        expect(spot.x).toBeLessThanOrEqual(g.x + g.w);
        expect(spot.y).toBeGreaterThanOrEqual(g.y);
        expect(spot.y).toBeLessThanOrEqual(g.y + g.h);
      }
    });
  }
});
