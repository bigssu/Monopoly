import { describe, expect, it } from 'vitest';
import type { Seat } from '@/engine';
import { cardOnTop, cardRect, computeLayout } from '../layout';

const ALL = new Set<Seat>(['S', 'E', 'N', 'W']);

describe('seat panel card (only as tall as its content)', () => {
  it('stands on its seat edge in the table model, on the top edge for N / E in the fixed view', () => {
    for (const s of ['S', 'E', 'N', 'W'] as const) expect(cardOnTop(s, false)).toBe(false);
    expect(cardOnTop('N', true)).toBe(true);
    expect(cardOnTop('E', true)).toBe(true);
    expect(cardOnTop('S', true)).toBe(false);
    expect(cardOnTop('W', true)).toBe(false);
  });

  it('table model: each card hugs the screen edge of its seat', () => {
    const L = computeLayout(1600, 1000, ALL);
    const S = L.seats.S!;
    const E = L.seats.E!;
    const N = L.seats.N!;
    const W = L.seats.W!;
    const s = cardRect(S, 170, false);
    expect(s).toEqual({ x: S.x, y: S.y + S.h - 170, w: S.w, h: 170 });
    const e = cardRect(E, 150, false);
    expect(e).toEqual({ x: E.x + E.w - 150, y: E.y, w: 150, h: E.h });
    const n = cardRect(N, 170, false);
    expect(n).toEqual({ x: N.x, y: N.y, w: N.w, h: 170 });
    const w = cardRect(W, 150, false);
    expect(w).toEqual({ x: W.x, y: W.y, w: 150, h: W.h });
  });

  it('fixed view: N / E hang from the top of their box, S / W stand on the bottom', () => {
    const L = computeLayout(1600, 1000, ALL, true);
    const N = L.seats.N!;
    const W = L.seats.W!;
    expect(cardRect(N, 170, cardOnTop('N', true))).toEqual({ x: N.x, y: N.y, w: N.w, h: 170 });
    expect(cardRect(W, 170, cardOnTop('W', true))).toEqual({ x: W.x, y: W.y + W.h - 170, w: W.w, h: 170 });
  });

  it('never grows past its box', () => {
    const L = computeLayout(800, 450, ALL);
    const S = L.seats.S!;
    expect(cardRect(S, 10_000, false)).toEqual({ x: S.x, y: S.y, w: S.w, h: S.h });
  });
});
