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

  for (const size of [7, 8, 9] as const) {
    it(`${size} per side, fixed view: the top row reads upright from S, rects unchanged`, () => {
      const table = getBoardGeometry(size);
      const up = getBoardGeometry(size, true);
      expect(up).toHaveLength(table.length);
      up.forEach((g, i) => {
        const t = table[i]!;
        expect({ x: g.x, y: g.y, w: g.w, h: g.h, edge: g.edge }).toEqual({ x: t.x, y: t.y, w: t.w, h: t.h, edge: t.edge });
        // Nothing prints upside-down for the reader at S (no 180° side, no ±135° corner).
        expect(Math.abs(g.rot)).toBeLessThanOrEqual(90);
        if (!g.corner && g.edge === 'N') expect(g.rot).toBe(0);
        if (!g.corner && g.edge !== 'N') expect(g.rot).toBe(t.rot);
        const spot = tokenSpot(i, 0, 1, size, true);
        expect(spot.x).toBeGreaterThanOrEqual(g.x);
        expect(spot.x).toBeLessThanOrEqual(g.x + g.w);
        expect(spot.y).toBeGreaterThanOrEqual(g.y);
        expect(spot.y).toBeLessThanOrEqual(g.y + g.h);
      });
      expect(up[2 * (size + 1)]!.rot).toBe(45);
      expect(up[3 * (size + 1)]!.rot).toBe(-45);
    });
  }
});
