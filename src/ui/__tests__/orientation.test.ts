import { describe, expect, it } from 'vitest';
import type { Seat } from '@/engine';
import { orientationFor, seatRemap, shiftSeat, viewMode, SEAT_CYCLE } from '../orientation';

const P = (seat: Seat, isCpu: boolean) => ({ seat, isCpu });
/** Players at `seats`; `humans` lists the human seats. */
const table = (seats: Seat[], humans: Seat[]) => seats.map((s) => P(s, !humans.includes(s)));

describe('view orientation policy', () => {
  it('is fixed for exactly one human with at least one CPU', () => {
    expect(viewMode(table(['S', 'N'], ['S']))).toBe('fixed');
    expect(viewMode(table(['S', 'E', 'W'], ['W']))).toBe('fixed');
    expect(viewMode(table(['S', 'E', 'N', 'W'], ['N']))).toBe('fixed');
  });

  it('stays the table model for 2+ humans, all CPUs, or a lone human', () => {
    expect(viewMode(table(['S', 'N'], ['S', 'N']))).toBe('table');
    expect(viewMode(table(['S', 'E', 'W'], ['S', 'E']))).toBe('table');
    expect(viewMode(table(['S', 'E', 'N', 'W'], ['S', 'E', 'N']))).toBe('table');
    expect(viewMode(table(['S', 'E', 'N', 'W'], ['S', 'E', 'N', 'W']))).toBe('table');
    expect(viewMode(table(['S', 'E', 'N', 'W'], []))).toBe('table');
    expect(viewMode(table(['S', 'N'], []))).toBe('table');
    expect(viewMode(table(['S'], ['S']))).toBe('table');
    expect(viewMode([])).toBe('table');
  });

  it('shiftSeat turns the table in quarter steps', () => {
    for (const s of SEAT_CYCLE) expect(shiftSeat(s, 0)).toBe(s);
    expect(SEAT_CYCLE.map((s) => shiftSeat(s, 1))).toEqual(['W', 'S', 'E', 'N']);
    expect(SEAT_CYCLE.map((s) => shiftSeat(s, 2))).toEqual(['N', 'W', 'S', 'E']);
    expect(SEAT_CYCLE.map((s) => shiftSeat(s, 3))).toEqual(['E', 'N', 'W', 'S']);
    expect(shiftSeat('N', -2)).toBe('S');
  });

  const all: Seat[] = ['S', 'E', 'N', 'W'];
  const cases: Array<[Seat, Record<Seat, Seat>]> = [
    ['S', { S: 'S', E: 'E', N: 'N', W: 'W' }],
    ['E', { S: 'W', E: 'S', N: 'E', W: 'N' }],
    ['N', { S: 'N', E: 'W', N: 'S', W: 'E' }],
    ['W', { S: 'E', E: 'N', N: 'W', W: 'S' }],
  ];
  for (const [human, want] of cases) {
    it(`one human at ${human} + 3 CPUs: the human is drawn at S, the others keep their order`, () => {
      const ps = table(all, [human]);
      expect(seatRemap(ps)).toEqual(want);
      const o = orientationFor(ps);
      expect(o.mode).toBe('fixed');
      expect(o.fixed).toBe(true);
      expect(o.seat(human)).toBe('S');
      // Everything faces the human, whoever acts.
      for (const s of all) expect(o.face(s)).toBe('S');
      expect(o.readers(all)).toEqual(['S']);
      // A bijection that keeps the turn order around the table (a rigid turn of the table).
      const drawn = all.map((s) => o.seat(s));
      expect(new Set(drawn).size).toBe(4);
      const k = SEAT_CYCLE.indexOf(drawn[0]!);
      expect(drawn).toEqual(all.map((_, i) => SEAT_CYCLE[(k + i) % 4]));
    });
  }

  it('one human at N + 1 CPU at S (2-player default seats): swapped', () => {
    const o = orientationFor(table(['S', 'N'], ['N']));
    expect(o.fixed).toBe(true);
    expect(o.seat('N')).toBe('S');
    expect(o.seat('S')).toBe('N');
  });

  it('one human at E with CPUs at S and W (3 players)', () => {
    const o = orientationFor(table(['S', 'E', 'W'], ['E']));
    expect([o.seat('S'), o.seat('E'), o.seat('W')]).toEqual(['W', 'S', 'N']);
  });

  for (const humans of [['S', 'N'], ['E', 'W'], ['S', 'E', 'N'], ['S', 'E', 'N', 'W'], []] as Seat[][]) {
    it(`table mode (${humans.length} humans): identity seats, content faces each seat`, () => {
      const seats: Seat[] = humans.length === 2 ? [...humans, ...all.filter((s) => !humans.includes(s)).slice(0, 1)] : all;
      const o = orientationFor(table(seats, humans));
      expect(o.mode).toBe('table');
      expect(o.fixed).toBe(false);
      for (const s of all) {
        expect(o.seat(s)).toBe(s);
        expect(o.face(s)).toBe(s);
      }
      expect(o.readers(seats)).toEqual(seats);
    });
  }
});
