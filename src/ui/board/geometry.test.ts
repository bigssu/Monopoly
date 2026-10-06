import { describe, expect, it } from 'vitest';
import {
  BLD_CLEAR,
  BLD_ON_CARD,
  BLD_OUT_MAX,
  BLD_SCALE,
  DEPTH,
  INNER,
  VB,
  buildingGeom,
  buildingLayout,
  cardFace,
  getBoardGeometry,
  tokenSpot,
  type BuildingGeom,
  type CardRect,
  type SpaceGeom,
} from './geometry';

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

/** Reach of a building past the inner edge of its space (board units) and onto its card. */
function reach(b: BuildingGeom, edge: string): { out: number; on: number } {
  const lo = INNER.x;
  const hi = INNER.x + INNER.size;
  if (edge === 'S') return { out: hi - b.y, on: b.y + b.size - hi };
  if (edge === 'N') return { out: b.y + b.size - lo, on: lo - b.y };
  if (edge === 'W') return { out: b.x + b.size - lo, on: lo - b.x };
  return { out: hi - b.x, on: b.x + b.size - hi };
}

const overlaps = (a: BuildingGeom, b: BuildingGeom): boolean =>
  a.x < b.x + b.size - 0.01 && b.x < a.x + a.size - 0.01 && a.y < b.y + b.size - 0.01 && b.y < a.y + a.size - 0.01;

describe('pop-out buildings', () => {
  it('stand on the inner edge of their space, upright for its reader (table view)', () => {
    const geom = getBoardGeometry(7);
    // One space per side: S 2, W 10, N 19, E 28.
    for (const [i, edge, rot] of [[2, 'S', 0], [10, 'W', 90], [19, 'N', 180], [28, 'E', -90]] as const) {
      const g = geom[i]!;
      expect(g.edge).toBe(edge);
      for (const lv of [1, 2, 3, 4] as const) {
        const b = buildingGeom(i, lv, 7)!;
        expect(b.rot).toBe(rot);
        expect(b.hanging).toBe(false);
        expect(b.size).toBeCloseTo(BLD_SCALE[lv] * g.lw, 6);
        // 70 % sticks out toward the centre, 30 % stands on the card (clear of the name).
        const r = reach(b, edge);
        expect(r.on).toBeCloseTo(BLD_ON_CARD * b.size, 6);
        expect(r.out).toBeCloseTo((1 - BLD_ON_CARD) * b.size, 6);
        expect(b.onCard).toBeCloseTo(r.on, 6);
        // Centred on its space along the edge.
        if (edge === 'S' || edge === 'N') expect(b.cx).toBeCloseTo(g.cx, 6);
        else expect(b.cy).toBeCloseTo(g.cy, 6);
      }
    }
  });

  it('hang under the top row in the fixed view (upright for S, off the card), sides unchanged', () => {
    const table = getBoardGeometry(7);
    const up = getBoardGeometry(7, true);
    for (let i = 17; i <= 23; i++) {
      const b = buildingGeom(i, 3, 7, true)!;
      expect(b.rot).toBe(0);
      expect(b.hanging).toBe(true);
      expect(b.onCard).toBe(0);
      expect(b.y).toBeCloseTo(INNER.y, 6);
      expect(b.cx).toBeCloseTo(up[i]!.cx, 6);
      expect(b.size).toBeLessThanOrEqual(BLD_OUT_MAX * up[i]!.lw + 1e-6);
    }
    for (const i of [2, 10, 28]) expect(buildingGeom(i, 2, 7, true)).toEqual(buildingGeom(i, 2, 7));
    expect(table[19]!.rot).toBe(180);
    expect(buildingGeom(0, 1, 7)).toBeNull();
  });

  for (const size of [7, 8, 9] as const) {
    for (const upright of [false, true]) {
      it(`${size} per side${upright ? ', fixed view' : ''}: every building inside the board, no two overlap, reach ≤ BLD_OUT_MAX`, () => {
        const geom = getBoardGeometry(size, upright);
        const W = geom[1]!.lw;
        const patterns: number[][] = [
          geom.map(() => 4),
          geom.map(() => 1),
          geom.map((_, i) => (i % 4) + 1),
          geom.map((_, i) => 4 - (i % 4)),
          geom.map((_, i) => (i * 7) % 5),
        ];
        for (const levels of patterns) {
          for (const minSize of [0, 160]) {
            const bs = buildingLayout(levels, size, upright, minSize);
            const list: Array<[number, BuildingGeom]> = [];
            bs.forEach((b, i) => {
              const g = geom[i]!;
              if (g.corner || !levels[i]) return expect(b).toBeNull();
              expect(b).not.toBeNull();
              expect(b!.x).toBeGreaterThanOrEqual(-1e-6);
              expect(b!.y).toBeGreaterThanOrEqual(-1e-6);
              expect(b!.x + b!.size).toBeLessThanOrEqual(VB + 1e-6);
              expect(b!.y + b!.size).toBeLessThanOrEqual(VB + 1e-6);
              const r = reach(b!, g.edge);
              expect(r.out).toBeLessThanOrEqual(BLD_OUT_MAX * W + 1e-6);
              expect(r.on).toBeLessThanOrEqual(BLD_ON_CARD * b!.size + 1e-6);
              list.push([i, b!]);
            });
            for (let a = 0; a < list.length; a++) {
              for (let c = a + 1; c < list.length; c++) {
                expect(overlaps(list[a]![1], list[c]![1]), `${list[a]![0]} vs ${list[c]![0]} (${levels.join('')})`).toBe(false);
              }
            }
          }
        }
      });
    }
  }

  it('a lone corner neighbour keeps its full size; a built pair slides apart', () => {
    const W = getBoardGeometry(7)[1]!.lw;
    const lone = buildingLayout([0, 4], 7)[1]!;
    expect(lone.size).toBeCloseTo(BLD_SCALE[4] * W, 6);
    const levels = new Array(32).fill(0);
    levels[31] = 4;
    levels[1] = 4;
    const pair = buildingLayout(levels, 7);
    // Space 1 (after the Start corner) slides left, away from the corner, past space 31's reach.
    const a = pair[1]!;
    const b = pair[31]!;
    expect(a.size).toBe(b.size);
    expect(VB - DEPTH - (a.x + a.size)).toBeGreaterThanOrEqual((1 - BLD_ON_CARD) * b.size - 1e-6);
    expect(overlaps(a, b)).toBe(false);
  });
});

/**
 * A card-local rect (lw × DEPTH frame, y = 0 at the inner edge) in board units, axis-aligned:
 * Board.spaceTransform for a side space, translate(cx cy) rotate(rot) translate(-lw/2 -lh/2).
 */
function toBoard(g: SpaceGeom, r: CardRect): CardRect {
  const a = (g.rot * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const pts = [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x, r.y + r.h],
    [r.x + r.w, r.y + r.h],
  ].map(([lx, ly]) => {
    const x = lx! - g.lw / 2;
    const y = ly! - g.lh / 2;
    return [g.cx + x * c - y * s, g.cy + x * s + y * c] as const;
  });
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** How deep two rects overlap (≤ 0: apart by at least that much). */
function overlapDepth(a: CardRect, b: CardRect): number {
  return Math.min(a.x + a.w - b.x, b.x + b.w - a.x, a.y + a.h - b.y, b.y + b.h - a.y);
}

describe('card face under a building', () => {
  // Board px at the four tested viewports (800×450, 1024×768, 1600×1000, 2560×1600; the same in
  // the table and the fixed view) → Board.minBuilding (about 22 px), plus no minimum.
  const MIN_SIZES = [0, ...[438, 653, 972, 1560].map((px) => (22 * VB) / px)];

  for (const size of [7, 8, 9] as const) {
    for (const upright of [false, true]) {
      it(`${size} per side${upright ? ', fixed view' : ''}: no building's on-card part covers the pill, price or art`, () => {
        const geom = getBoardGeometry(size, upright);
        const n = geom.length;
        // Every level alone on every side space, and every level pair on both neighbours of every
        // corner (the slide rule shrinks both).
        const layouts: number[][] = [];
        for (let i = 0; i < n; i++) {
          if (geom[i]!.corner) continue;
          for (const lv of [1, 2, 3, 4]) layouts.push(geom.map((_, j) => (j === i ? lv : 0)));
        }
        for (let a = 1; a <= 4; a++) {
          for (let b = 1; b <= 4; b++) {
            layouts.push(geom.map((_, j) => ((j + 1) % (size + 1) === 0 ? a : j % (size + 1) === 1 ? b : 0)));
          }
        }
        let checked = 0;
        for (const levels of layouts) {
          for (const minSize of MIN_SIZES) {
            buildingLayout(levels, size, upright, minSize).forEach((b, i) => {
              if (!b) return;
              const g = geom[i]!;
              // The building's on-card part: its box clipped to its own space.
              const x0 = Math.max(b.x, g.x);
              const y0 = Math.max(b.y, g.y);
              const x1 = Math.min(b.x + b.size, g.x + g.w);
              const y1 = Math.min(b.y + b.size, g.y + g.h);
              const on: CardRect = { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
              if (b.hanging) expect(on.w * on.h, `${i} hangs`).toBeCloseTo(0, 6);
              for (const chars of [0, 3, 4, 5, 6]) {
                const face = cardFace(g.lw, b.onCard, chars);
                const items: Array<[string, CardRect]> = [
                  ['pill', face.pill],
                  // The art's light plate (owned cards) reaches 10 above and below it.
                  ['art', { x: face.art.x, y: face.art.y - 10, w: face.art.w, h: face.art.h + 20 }],
                ];
                if (face.price) items.push(['price', face.price.box]);
                for (const [what, r] of items) {
                  const tag = `${size}${upright ? 'u' : ''} space ${i} lv ${levels[i]} min ${minSize.toFixed(0)} ${what} (${chars})`;
                  // Above the name (the art floor keeps it there however far the content moves).
                  expect(r.y + r.h, tag).toBeLessThanOrEqual(300);
                  if (on.w * on.h > 0) expect(overlapDepth(toBoard(g, r), on), tag).toBeLessThanOrEqual(-BLD_CLEAR + 1e-6);
                }
              }
              checked++;
            });
          }
        }
        expect(checked).toBeGreaterThan(100);
      });
    }
  }

  it('a card without a building keeps its rest layout; a deeper building moves the content further', () => {
    const W = getBoardGeometry(7)[1]!.lw;
    const rest = cardFace(W, 0, 3);
    expect(rest.dy).toBe(6);
    expect(rest.price!.baseline).toBe(80);
    expect(rest.art).toEqual({ x: (W - 152) / 2, y: 105, w: 152, h: 152 });
    let last = rest.dy;
    for (const lv of [1, 2, 3, 4] as const) {
      const f = cardFace(W, buildingGeom(2, lv, 7)!.onCard, 3);
      expect(f.dy).toBeGreaterThan(last);
      last = f.dy;
    }
  });
});
