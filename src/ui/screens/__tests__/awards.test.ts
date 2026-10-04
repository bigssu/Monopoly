import { describe, expect, it } from 'vitest';
import { createGame, defaultPlayers, defaultSettings } from '@/engine';
import { awardsFor, leadChanges, storyFor } from '../awards';

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

describe('storyFor', () => {
  const base = () => {
    const s = createGame(defaultSettings({ players: defaultPlayers(3) }), 1);
    s.phase = { kind: 'gameOver', result: { winnerId: 0, victory: 'roundLimit', round: 4, ranking: [] } };
    return s;
  };

  it('tells a comeback when the winner fell to third or worse', () => {
    const s = base();
    s.history = [[3000, 3000, 3000], [2000, 4000, 3500], [3000, 3800, 3600]];
    expect(storyFor(s, [6000, 3000, 2000])).toMatchObject({ key: 'r.story.comeback', params: { rank: 3 } });
  });

  it('tells a wire-to-wire win', () => {
    const s = base();
    s.history = [[3000, 3000, 3000], [3600, 3000, 2900], [4200, 3100, 2500]];
    expect(storyFor(s, [5000, 3000, 2000])?.key).toBe('r.story.wire');
  });

  it('marks where the lead changed hands', () => {
    expect(leadChanges([[3, 3, 3], [4, 1, 1], [1, 5, 1], [9, 1, 1]])).toEqual([{ at: 2, pid: 1 }, { at: 3, pid: 0 }]);
  });
});
