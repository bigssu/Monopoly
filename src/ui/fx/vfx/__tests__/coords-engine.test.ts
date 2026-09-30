import { describe, expect, it, vi } from 'vitest';
import type { Seat } from '@/engine';
import { ManualClock } from '../clock';
import { createCoords, rotateVec, SEAT_ANGLE, SEAT_DIR, seatLocal } from '../coords';
import { backingScale, createFx } from '../engine';
import { SEAT_ANGLE as UI_SEAT_ANGLE } from '@/ui/game/util';
import { fakeSource } from './helpers';

describe('coords + seat rotation (VFX.md §3.4)', () => {
  it('matches the UI seat angles and seat "up" vectors', () => {
    expect(SEAT_ANGLE).toEqual(UI_SEAT_ANGLE);
    for (const seat of ['S', 'E', 'N', 'W'] as Seat[]) {
      const up = seatLocal(seat, 0, -1);
      expect(up.x).toBeCloseTo(SEAT_DIR[seat][0], 9);
      expect(up.y).toBeCloseTo(SEAT_DIR[seat][1], 9);
    }
    const near = (a: { x: number; y: number }, x: number, y: number): void => {
      expect(a.x).toBeCloseTo(x, 9);
      expect(a.y).toBeCloseTo(y, 9);
    };
    near(seatLocal('E', 1, 0), 0, -1);
    near(seatLocal('N', 1, 2), -1, -2);
    near(seatLocal('W', 0, 1), -1, 0);
    const r = rotateVec(3, 4, 30);
    expect(Math.hypot(r.x, r.y)).toBeCloseTo(5);
  });

  it('converts client rects to layer px and derives u = board / 32', () => {
    const c = createCoords(fakeSource(960, 320, 40, { x: 100, y: 20, width: 1400, height: 960 }));
    expect(c.u).toBe(30);
    const s0 = c.space(0);
    // Start is the bottom-right corner: 460/3200 of 960 = 138 px.
    expect(s0.x).toBeCloseTo(320 + 960 - 69 - 100);
    expect(s0.y).toBeCloseTo(40 + 960 - 69 - 20);
    expect(s0.r).toBeCloseTo(69);
    const center = c.center();
    expect(center).toEqual({ x: 320 + 480 - 100, y: 40 + 480 - 20 });
  });

  it('panel anchors sit on the board-facing side of each seat panel', () => {
    const c = createCoords(fakeSource());
    const mid = c.center();
    for (const id of [0, 1, 2, 3]) {
      const p = c.panel(id);
      const toBoard = Math.hypot(mid.x - p.x, mid.y - p.y);
      const fromCentre = Math.hypot(mid.x - p.cx, mid.y - p.cy);
      expect(toBoard).toBeLessThan(fromCentre);
      expect(p.dir).toEqual(SEAT_DIR[p.seat]);
    }
    expect(c.panel(0).seat).toBe('S');
    expect(c.panel(1).seat).toBe('E');
  });
});

describe('engine (no DOM)', () => {
  it('backing scale: 0.75–1.5, DPR-capped, ≤ 0.9 MP', () => {
    expect(backingScale(400, 400, 2)).toBe(1.5);
    expect(backingScale(400, 400, 1)).toBe(1);
    expect(backingScale(1600, 1000, 2)).toBeCloseTo(0.75);
    const s = backingScale(2560, 1600, 2);
    expect(s * s * 2560 * 1600).toBeLessThanOrEqual(0.9e6 + 1);
    for (const [w, h] of [
      [300, 300],
      [800, 800],
      [1200, 900],
    ] as const)
      expect(backingScale(w, h, 3) ** 2 * w * h).toBeLessThanOrEqual(0.9e6 + 1);
  });

  const layer = (): HTMLElement & { append: ReturnType<typeof vi.fn> } => ({ append: vi.fn() }) as unknown as HTMLElement & { append: ReturnType<typeof vi.fn> };

  it('reduced motion: no canvas, no clock, sound + haptic + static highlight, cues resolve', async () => {
    const clock = new ManualClock();
    clock.reduced = true;
    const L = layer();
    const sfx = vi.fn();
    const haptic = vi.fn();
    const highlight = vi.fn();
    const loadAtlas = vi.fn(async () => null);
    const fx = createFx({ ...fakeSource(), layer: L, clock, sfx, haptic, highlight, loadAtlas });
    const h = fx.play('buildSeq', { space: 6, player: 0, level: 4 });
    await h.cue('swap');
    await h;
    expect(L.append).not.toHaveBeenCalled();
    expect(clock.active).toBe(0);
    expect(loadAtlas).not.toHaveBeenCalled();
    expect(sfx).toHaveBeenCalledTimes(1);
    expect(sfx.mock.calls[0]![0]).toBe('landmark');
    expect(haptic.mock.calls.map((c) => c[0])).toContain('heavy');
    expect(highlight).toHaveBeenCalledWith({ space: 6 }, 800);
  });

  it('instant (speed 0): nothing at all', async () => {
    const clock = new ManualClock();
    clock.spd = 0;
    const sfx = vi.fn();
    const fx = createFx({ ...fakeSource(), layer: layer(), clock, sfx });
    await fx.play('tollPay', { payer: 0, receiver: 1, amount: 900 });
    expect(sfx).not.toHaveBeenCalled();
    expect(clock.active).toBe(0);
  });

  it('atlas failure disables the canvas gracefully (reduced path, no throw)', async () => {
    const clock = new ManualClock();
    const L = layer();
    const sfx = vi.fn();
    const fx = createFx({ ...fakeSource(), layer: L, clock, sfx, loadAtlas: async () => null });
    const h = fx.play('takeoverStamp', { space: 22, buyer: 0, seller: 2 });
    await h.cue('frame');
    await h;
    await h.done;
    expect(L.append).not.toHaveBeenCalled();
    expect(clock.active).toBe(0);
    expect(sfx).toHaveBeenCalledWith('warning', {});
    expect(fx.stats().atlas).toBe('failed');
    expect(fx.stats().enabled).toBe(false);
  });
});
