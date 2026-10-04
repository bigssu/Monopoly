import { describe, expect, it } from 'vitest';
import { createGame, defaultPlayers, defaultSettings } from '@/engine';
import { awardsFor } from '../awards';

const zero = { tollPaid: 0, tollEarned: 0, biggestToll: 0, takeovers: 0, bought: 0, built: 0, islandVisits: 0, doubles: 0, cards: 0 };

describe('awardsFor', () => {
  it('serves players without an award first, at most four, in award order', () => {
    const s = createGame(defaultSettings({ players: defaultPlayers(3) }), 1);
    s.stats = [
      { ...zero, tollEarned: 900, biggestToll: 400, takeovers: 2, built: 5 },
      { ...zero, islandVisits: 3 },
      { ...zero, doubles: 4, built: 1 },
    ];
    const a = awardsFor(s);
    expect(a.map((x) => x.id)).toEqual(['toll', 'big', 'island', 'doubles']);
    expect(new Set(a.map((x) => x.pid))).toEqual(new Set([0, 1, 2]));
  });

  it('skips statistics nobody scored', () => {
    const s = createGame(defaultSettings({ players: defaultPlayers(2) }), 1);
    s.stats = [{ ...zero }, { ...zero, cards: 1 }];
    expect(awardsFor(s).map((x) => x.id)).toEqual(['cards']);
  });
});
