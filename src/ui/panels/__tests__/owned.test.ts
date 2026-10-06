import { describe, expect, it } from 'vitest';
import { createGame, defaultPlayers, defaultSettings, getBoardInfo, type GameState, type Level } from '@/engine';
import { chipSize, ownedChips } from '../owned';

/** A fresh 4-player game with the given (index → [owner, level]) ownership. */
function stateWith(own: Record<number, [number, Level?]>, size: 7 | 9 = 7): GameState {
  const s = createGame(defaultSettings({ players: defaultPlayers(4, { cpu: true }), spacesPerSide: size }), 7);
  for (const [i, [owner, level]] of Object.entries(own)) s.properties[Number(i)] = { owner, level: level ?? 0 };
  return s;
}

describe('ownedChips (the panel lists only what a player owns)', () => {
  it('is empty for a player who owns nothing, whatever the others own', () => {
    const s = stateWith({ 1: [0], 4: [2, 3], 5: [3] });
    expect(ownedChips(s, 1)).toEqual([]);
  });

  it('lists exactly the owned cities and hubs, never anyone else\'s', () => {
    const s = stateWith({ 4: [0, 2], 6: [0, 1], 7: [0, 3], 5: [0], 10: [0], 9: [1], 12: [2], 13: [3] });
    expect(ownedChips(s, 0).map((c) => c.index)).toEqual([4, 6, 7, 10, 5]);
    expect(ownedChips(s, 1).map((c) => c.index)).toEqual([9]);
    expect(ownedChips(s, 3).map((c) => c.index)).toEqual([13]);
  });

  it('orders colour groups in board order with hubs last, so a hub never splits a colour', () => {
    // Sky is 4, 6, 7 with the hub 5 between them on the board.
    const s = stateWith({ 30: [0], 5: [0], 7: [0], 4: [0], 1: [0], 21: [0] });
    const chips = ownedChips(s, 0);
    expect(chips.map((c) => c.index)).toEqual([1, 4, 7, 30, 5, 21]);
    expect(chips.map((c) => c.kind)).toEqual(['city', 'city', 'city', 'city', 'hub', 'hub']);
    expect(chips.map((c) => c.group)).toEqual(['brown', 'sky', 'sky', 'blue', 'hubs', 'hubs']);
  });

  it('marks a complete colour (and only that colour) and carries levels and the festival', () => {
    const s = stateWith({ 4: [0, 2], 6: [0, 1], 7: [0, 4], 9: [0], 10: [0] });
    s.festival = 6;
    const chips = ownedChips(s, 0);
    expect(chips.filter((c) => c.complete).map((c) => c.index)).toEqual([4, 6, 7]);
    expect(chips.map((c) => c.level)).toEqual([2, 1, 4, 0, 0]);
    expect(chips.filter((c) => c.festival).map((c) => c.index)).toEqual([6]);
  });

  it('treats every hub as one set', () => {
    const hubs = getBoardInfo(7).hubIndices;
    const s = stateWith(Object.fromEntries(hubs.map((i) => [i, [2] as [number]])));
    const chips = ownedChips(s, 2);
    expect(chips.map((c) => c.index)).toEqual([...hubs]);
    expect(chips.every((c) => c.complete && c.kind === 'hub')).toBe(true);
  });

  it('follows the board size', () => {
    const size9 = getBoardInfo(9);
    const city = size9.cityIndices[size9.cityIndices.length - 1]!;
    const s = stateWith({ [city]: [1, 2] }, 9);
    expect(ownedChips(s, 1)).toEqual([expect.objectContaining({ index: city, kind: 'city', level: 2 })]);
  });
});

describe('chipSize (owned chips wrap in rows and always fit the box)', () => {
  it('keeps the largest size while the rows fit', () => {
    const r = chipSize(5, 257, 200, 41, 12);
    expect(r.size).toBe(41);
    expect(r.rows).toBe(1);
  });

  it('shrinks the chips only when the rows would not fit', () => {
    const r = chipSize(28, 152, 100, 22, 12);
    expect(r.size).toBeLessThan(22);
    expect(r.rows * (r.size + r.gap) - r.gap).toBeLessThanOrEqual(100);
    expect(r.perRow * r.rows).toBeGreaterThanOrEqual(28);
  });

  it('never goes below the minimum', () => {
    expect(chipSize(200, 100, 20, 30, 12).size).toBe(12);
  });
});
