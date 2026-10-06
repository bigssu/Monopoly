import { describe, expect, it } from 'vitest';
import { validateSettings } from '@/engine';
import {
  activeSeats,
  buildSettings,
  rotateStart,
  defaultDraft,
  normalizeDraft,
  pick,
  seatNumber,
  toggleSeat,
  validateDraft,
} from '../setupModel';

const name = (n: number) => `P${n}`;

describe('setup draft', () => {
  it('defaults to two humans facing each other (S, N)', () => {
    const d = defaultDraft();
    expect(activeSeats(d)).toEqual(['S', 'N']);
    expect(validateDraft(d)).toBeNull();
    expect(d.spacesPerSide).toBe(7);
  });

  it('keeps the board choice through storage and engine settings, with 7 for legacy drafts', () => {
    for (const spacesPerSide of [7, 8, 9] as const) {
      const d = normalizeDraft({ ...defaultDraft(), spacesPerSide });
      expect(d.spacesPerSide).toBe(spacesPerSide);
      expect(buildSettings(d, name, () => 0).settings.spacesPerSide).toBe(spacesPerSide);
    }
    expect(normalizeDraft({ seats: defaultDraft().seats }).spacesPerSide).toBe(7);
    expect(normalizeDraft({ spacesPerSide: 10 }).spacesPerSide).toBe(7);
  });

  it('never turns S off and never drops below two players', () => {
    const d = defaultDraft();
    toggleSeat(d, 'S');
    toggleSeat(d, 'N');
    expect(activeSeats(d)).toEqual(['S', 'N']);
  });

  it('joining a seat gives it a free color and token', () => {
    const d = defaultDraft();
    d.seats.E.colorId = 'red';
    d.seats.E.tokenId = 'car';
    toggleSeat(d, 'E');
    expect(activeSeats(d)).toEqual(['S', 'E', 'N']);
    const colors = activeSeats(d).map((s) => d.seats[s].colorId);
    const tokens = activeSeats(d).map((s) => d.seats[s].tokenId);
    expect(new Set(colors).size).toBe(3);
    expect(new Set(tokens).size).toBe(3);
  });

  it('picking a taken color swaps it with its holder', () => {
    const d = defaultDraft();
    const nColor = d.seats.N.colorId;
    pick(d, 'S', 'colorId', nColor);
    expect(d.seats.S.colorId).toBe(nColor);
    expect(d.seats.N.colorId).toBe('red');
  });

  it('numbers automatic names among active seats', () => {
    const d = defaultDraft();
    expect(seatNumber(d, 'N')).toBe(2);
    toggleSeat(d, 'E');
    expect(seatNumber(d, 'N')).toBe(3);
  });

  it('normalizes garbage and duplicate colors from storage', () => {
    expect(activeSeats(normalizeDraft(null))).toEqual(['S', 'N']);
    const d = normalizeDraft({
      seats: { S: { on: false, colorId: 'blue', tokenId: 'cat' }, N: { on: true, colorId: 'blue', tokenId: 'cat' } },
      roundLimit: 7,
      startCash: 5000,
      promptTimer: 30,
    });
    expect(d.seats.S.on).toBe(true);
    expect(d.seats.S.colorId).not.toBe(d.seats.N.colorId);
    expect(d.seats.S.tokenId).not.toBe(d.seats.N.tokenId);
    expect(d.roundLimit).toBe(30);
    expect(d.startCash).toBe(5000);
    expect(d.promptTimer).toBe(30);
  });

  it('builds valid engine settings in seat order with a random start', () => {
    const d = defaultDraft();
    toggleSeat(d, 'E');
    toggleSeat(d, 'W');
    d.seats.W.controller = 'easy';
    d.seats.E.name = '민지';
    d.roundLimit = null;
    d.auction = true;
    // random() = 0.5 → start offset 2 of 4.
    const { settings, seed } = buildSettings(d, name, () => 0.5);
    expect(() => validateSettings(settings)).not.toThrow();
    expect(settings.players.map((p) => p.seat)).toEqual(['N', 'W', 'S', 'E']);
    expect(settings.players.map((p) => p.name)).toEqual(['P3', 'P4', 'P1', '민지']);
    expect(settings.players[1]).toMatchObject({ isCpu: true, cpuLevel: 'easy' });
    expect(settings.roundLimit).toBeNull();
    expect(settings.auction).toBe(true);
    expect(seed).toBe(0x80000000);
    const first = buildSettings(d, name, () => 0);
    expect(first.settings.players.map((p) => p.seat)).toEqual(['S', 'E', 'N', 'W']);
  });
});

describe('rotateStart', () => {
  it('keeps the order around the table and picks the start from random()', () => {
    const ring = ['S', 'E', 'N', 'W'];
    expect(rotateStart(ring, () => 0)).toEqual(['S', 'E', 'N', 'W']);
    expect(rotateStart(ring, () => 0.26)).toEqual(['E', 'N', 'W', 'S']);
    expect(rotateStart(ring, () => 0.99)).toEqual(['W', 'S', 'E', 'N']);
    expect(rotateStart([], () => 0.5)).toEqual([]);
    expect(ring).toEqual(['S', 'E', 'N', 'W']);
  });
});
