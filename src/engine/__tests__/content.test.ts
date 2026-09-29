import { describe, expect, it } from 'vitest';
import { BOARD, BUILDING_LEVEL_NAMES, GROUP_COLORS } from '../../content/board';
import { CARDS, getCard } from '../../content/cards';
import { ICON_IDS } from '../../content/icons';
import {
  CITY_INDICES,
  HUB_INDICES,
  EVENT_INDICES,
  citiesInGroup,
  citiesOnSide,
  distance,
  nearestHubAhead,
  walkPath,
} from '../board';

describe('board content (DESIGN §3)', () => {
  it('has 32 spaces with corners at 0/8/16/24', () => {
    expect(BOARD).toHaveLength(32);
    BOARD.forEach((s, i) => expect(s.index).toBe(i));
    expect(BOARD[0]!.kind).toBe('start');
    expect(BOARD[8]!.kind).toBe('island');
    expect(BOARD[16]!.kind).toBe('festival');
    expect(BOARD[24]!.kind).toBe('travel');
  });

  it('has 19 cities (the §3 table; the "20" in the prose is a typo) in 7 groups, 4 hubs, 3 events, 1 tax, 1 donation', () => {
    expect(CITY_INDICES).toHaveLength(19);
    expect(HUB_INDICES).toEqual([5, 13, 21, 29]);
    expect(EVENT_INDICES).toEqual([3, 18, 27]);
    expect(BOARD.filter((s) => s.kind === 'tax').map((s) => s.index)).toEqual([23]);
    expect(BOARD.filter((s) => s.kind === 'donation').map((s) => s.index)).toEqual([11]);
    expect(citiesInGroup('brown')).toEqual([1, 2]);
    expect(citiesInGroup('sky')).toEqual([4, 6, 7]);
    expect(citiesInGroup('pink')).toEqual([9, 10, 12]);
    expect(citiesInGroup('orange')).toEqual([14, 15, 17]);
    expect(citiesInGroup('red')).toEqual([19, 20, 22]);
    expect(citiesInGroup('yellow')).toEqual([25, 26, 28]);
    expect(citiesInGroup('blue')).toEqual([30, 31]);
    expect(Object.keys(GROUP_COLORS)).toHaveLength(7);
  });

  it('matches the price table', () => {
    const prices: Record<number, number> = {
      1: 100, 2: 120, 4: 160, 5: 250, 6: 180, 7: 200, 9: 240, 10: 260, 12: 280, 13: 250, 14: 320,
      15: 340, 17: 360, 19: 420, 20: 440, 21: 250, 22: 480, 25: 540, 26: 560, 28: 600, 29: 250,
      30: 800, 31: 1000,
    };
    for (const s of BOARD) expect(s.price).toBe(prices[s.index] ?? null);
  });

  it('assigns line sides (cities only)', () => {
    expect(citiesOnSide('A')).toEqual([1, 2, 4, 6, 7]);
    expect(citiesOnSide('B')).toEqual([9, 10, 12, 14, 15]);
    expect(citiesOnSide('C')).toEqual([17, 19, 20, 22]);
    expect(citiesOnSide('D')).toEqual([25, 26, 28, 30, 31]);
  });

  it('has ko/en names and unique city icon ids', () => {
    for (const s of BOARD) {
      expect(s.name.ko.length).toBeGreaterThan(0);
      expect(s.name.en.length).toBeGreaterThan(0);
      expect(s.iconId).toMatch(/^[a-z]+-[a-z]+$/);
    }
    const icons = CITY_INDICES.map((i) => BOARD[i]!.iconId);
    expect(new Set(icons).size).toBe(19);
    expect(BOARD[1]!.iconId).toBe('city-manila');
    expect(BUILDING_LEVEL_NAMES.landmark).toEqual({ ko: '명소', en: 'Landmark' });
  });

  it('uses only icon ids that exist in the icon set', () => {
    const known = new Set(ICON_IDS);
    for (const s of BOARD) expect(known.has(s.iconId), s.iconId).toBe(true);
  });

  it('avoids forbidden trademark words in content', () => {
    const text = JSON.stringify({ BOARD, CARDS }).toLowerCase();
    // Forbidden words (C1) are stored base64-encoded so they never appear in the source.
    const forbidden = [
      '66eI67iU', 'bW9ub3BvbHk=', '7Zmp6riI7Je07Ieg', '7LCs7Iqk', '7Jis66a87ZS9', '7IS46rOE7Jes7ZaJ',
      'd29ybGR0b3Vy', '656c65Oc66eI7YGs', 'Y2hhbmNl', 'Y29tbXVuaXR5', '7Jqw7KO87Jes7ZaJ', '7IKs7ZqM67O17KeA6riw6riI',
    ].map((b) => Buffer.from(b, 'base64').toString('utf8'));
    for (const w of forbidden) expect(text).not.toContain(w.toLowerCase());
  });

  it('board helpers', () => {
    expect(distance(30, 2)).toBe(4);
    expect(distance(5, 5)).toBe(0);
    expect(walkPath(30, 4)).toEqual([31, 0, 1, 2]);
    expect(walkPath(1, -3)).toEqual([0, 31, 30]);
    expect(nearestHubAhead(3)).toBe(5);
    expect(nearestHubAhead(27)).toBe(29);
    expect(nearestHubAhead(29)).toBe(5);
    expect(nearestHubAhead(30)).toBe(5);
  });
});

describe('event cards (DESIGN §4)', () => {
  it('has 24 cards numbered 1..24 with unique ids and ko/en text', () => {
    expect(CARDS).toHaveLength(24);
    expect(CARDS.map((c) => c.number)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(24);
    for (const c of CARDS) {
      expect(c.title.ko && c.title.en && c.description.ko && c.description.en).toBeTruthy();
      expect(getCard(c.id)).toBe(c);
    }
  });

  it('has the specified effects', () => {
    expect(getCard('to-start').effect).toEqual({ kind: 'moveTo', target: 0 });
    expect(getCard('to-travel').effect).toEqual({ kind: 'moveTo', target: 24 });
    expect(getCard('to-festival').effect).toEqual({ kind: 'moveTo', target: 16 });
    expect(getCard('fine').effect).toEqual({ kind: 'money', amount: -150 });
    expect(getCard('lottery').effect).toEqual({ kind: 'money', amount: 500 });
    expect(getCard('leader-tax').effect).toEqual({ kind: 'leaderTax', amount: 200 });
    expect(getCard('shield').title.ko).toBe('수호 방패');
    expect(getCard('random-jump').title.ko).toBe('랜덤 점프');
    expect(() => getCard('nope' as never)).toThrow();
  });
});
