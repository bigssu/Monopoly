import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../economy';
import {
  buildCost,
  canBeTakenOver,
  completedGroups,
  findVictory,
  liquidationValue,
  setVictory,
  oneAwayWarnings,
  ranking,
  round10,
  sellBuildingValue,
  sellPropertyValue,
  takeoverPrice,
  tollOf,
  totalAssets,
  valueOf,
} from '../rules';
import { edit, game, own } from './helpers';

describe('money helpers', () => {
  it('round10 rounds to the nearest 10 (half up)', () => {
    expect(round10(34)).toBe(30);
    expect(round10(35)).toBe(40);
    expect(round10(36)).toBe(40);
    expect(round10(0)).toBe(0);
    expect(round10(0.35 * 120)).toBe(40);
  });

  it('build costs per level: 0.5/0.6/0.7/1.0 × P rounded to 10', () => {
    expect(ECONOMY.buildCostRates).toEqual([0, 0.5, 0.6, 0.7, 1.0]);
    expect(buildCost(100, 1)).toBe(50);
    expect(buildCost(120, 2)).toBe(70); // 72 → 70
    expect(buildCost(1000, 3)).toBe(700);
    expect(buildCost(1000, 4)).toBe(1000);
    expect(() => buildCost(100, 0)).toThrow();
    expect(() => buildCost(100, 5)).toThrow();
  });

  it('property value = P + Σ build costs', () => {
    expect(valueOf(31, 0)).toBe(1000);
    expect(valueOf(31, 2)).toBe(1000 + 500 + 600);
    expect(valueOf(31, 4)).toBe(1000 + 500 + 600 + 700 + 1000);
    expect(valueOf(5, 0)).toBe(250);
  });
});

describe('tolls', () => {
  it('city toll by level uses the economy rates, rounded to 10', () => {
    for (let lvl = 0; lvl <= 4; lvl++) {
      const s = edit(game(), (st) => own(st, 2, 1, lvl as 0));
      expect(tollOf(s, 2)).toBe(round10(120 * ECONOMY.tollRates[lvl]!));
    }
  });

  it('owning the complete color group doubles the land-only toll', () => {
    const s1 = edit(game(), (st) => own(st, 1, 1, 0));
    const s2 = edit(s1, (st) => own(st, 2, 1, 0));
    const base = round10(100 * ECONOMY.tollRates[0]!);
    expect(tollOf(s1, 1)).toBe(base);
    expect(tollOf(s2, 1)).toBe(base * 2);
    // Not for built levels.
    const s3 = edit(s2, (st) => own(st, 1, 1, 1));
    expect(tollOf(s3, 1)).toBe(round10(100 * ECONOMY.tollRates[1]!));
  });

  it('festival doubles the toll once (single marker; stacks with group bonus, never ×4 from festival)', () => {
    const s = edit(game(), (st) => {
      own(st, 1, 1, 0);
      own(st, 2, 1, 0);
      st.festival = 1;
    });
    const base = round10(100 * ECONOMY.tollRates[0]!);
    expect(tollOf(s, 1)).toBe(base * 2 * 2);
    expect(tollOf(s, 2)).toBe(round10(120 * ECONOMY.tollRates[0]!) * 2);
  });

  it('hub toll = 100 × hubs owned', () => {
    let s = edit(game(), (st) => own(st, 5, 0));
    expect(tollOf(s, 5)).toBe(100);
    s = edit(s, (st) => own(st, 13, 0));
    expect(tollOf(s, 5)).toBe(200);
    s = edit(s, (st) => own(st, 21, 0));
    expect(tollOf(s, 13)).toBe(300);
    s = edit(s, (st) => own(st, 29, 1));
    expect(tollOf(s, 29)).toBe(100);
  });

  it('unowned property has no toll', () => {
    expect(tollOf(game(), 1)).toBe(0);
  });
});

describe('takeover & selling', () => {
  it('takeover price is 2 × value; landmarks cannot be taken over; hubs at 2 × 250', () => {
    const s = edit(game(), (st) => {
      own(st, 31, 1, 2);
      own(st, 30, 1, 4);
      own(st, 5, 1);
    });
    expect(takeoverPrice(s, 31)).toBe(2 * (1000 + 500 + 600));
    expect(canBeTakenOver(s, 31)).toBe(true);
    expect(canBeTakenOver(s, 30)).toBe(false);
    expect(takeoverPrice(s, 5)).toBe(500);
    expect(canBeTakenOver(s, 5)).toBe(true);
  });

  it('sell values: buildings at 50% of build cost, land at 50% of price, landmark city at 50% of value', () => {
    const s = edit(game(), (st) => {
      own(st, 31, 0, 2);
      own(st, 30, 0, 4);
      own(st, 1, 0, 0);
    });
    expect(sellBuildingValue(s, 31)).toBe(300); // 50% of 600
    expect(sellBuildingValue(s, 30)).toBeNull(); // landmark sells whole
    expect(sellBuildingValue(s, 1)).toBeNull(); // no building
    expect(sellPropertyValue(s, 1)).toBe(50);
    expect(sellPropertyValue(s, 30)).toBe(valueOf(30, 4) / 2);
    expect(liquidationValue(s, 0)).toBe(valueOf(31, 2) / 2 + valueOf(30, 4) / 2 + 50);
  });
});

describe('독점 sets & victory', () => {
  it('triple (트리플 독점) = 3 complete color groups', () => {
    const s = edit(game(), (st) => {
      for (const i of [1, 2, 30, 31]) own(st, i, 0);
      for (const i of [4, 6]) own(st, i, 0);
    });
    expect(completedGroups(s, 0)).toEqual(['brown', 'blue']);
    expect(setVictory(s, 0)).toBeNull();
    const s2 = edit(s, (st) => own(st, 7, 0));
    expect(setVictory(s2, 0)).toEqual({ victory: 'triple', groups: ['brown', 'sky', 'blue'] });
  });

  it('line (라인 독점) = every city on a side (hubs/events ignored)', () => {
    const s = edit(game(), (st) => {
      for (const i of [17, 19, 20, 22]) own(st, i, 1);
      own(st, 21, 0); // hub on side C owned by someone else: irrelevant
    });
    expect(setVictory(s, 1)).toEqual({ victory: 'line', side: 'C' });
  });

  it('hubs (허브 독점) = all 4 hubs', () => {
    const s = edit(game(), (st) => {
      for (const i of [5, 13, 21, 29]) own(st, i, 0);
    });
    expect(setVictory(s, 0)).toEqual({ victory: 'hubs' });
    expect(findVictory(s)).toEqual({ winnerId: 0, victory: 'hubs' });
  });

  it('last solvent player standing', () => {
    const s = edit(game({ n: 3 }), (st) => {
      st.players[0]!.bankrupt = true;
      st.players[2]!.bankrupt = true;
      st.bankruptOrder = [0, 2];
    });
    expect(findVictory(s)).toEqual({ winnerId: 1, victory: 'lastStanding' });
  });

  it('ranking: assets, then cash, then cities, then earlier seat; bankrupt last (latest first)', () => {
    const s = edit(game({ n: 4 }), (st) => {
      st.players[0]!.cash = 1000;
      st.players[1]!.cash = 900;
      own(st, 1, 1); // P2: 900 + 100 = 1000 assets, less cash
      st.players[2]!.cash = 1000; // tie with P1 on assets and cash, same cities → earlier seat wins
      st.players[3]!.cash = 0;
      st.players[3]!.bankrupt = true;
      st.bankruptOrder = [3];
    });
    expect(totalAssets(s, 1)).toBe(1000);
    const r = ranking(s);
    expect(r.map((e) => e.playerId)).toEqual([0, 2, 1, 3]);
    expect(r.map((e) => e.rank)).toEqual([1, 2, 3, 4]);

    const s2 = edit(s, (st) => {
      st.players[1]!.cash = 1000; // P2 now 1100 assets
    });
    expect(ranking(s2)[0]!.playerId).toBe(1);

    const s3 = edit(game({ n: 2 }), (st) => {
      st.players[0]!.cash = 900;
      own(st, 1, 0); // 1000 assets, 1 city
      st.players[1]!.cash = 880;
      own(st, 2, 1); // 1000 assets, 1 city, less cash
    });
    expect(ranking(s3)[0]!.playerId).toBe(0);
  });

  it('one-away warnings for groups, lines and hubs', () => {
    const s = edit(game(), (st) => {
      own(st, 1, 0);
      own(st, 5, 1);
      own(st, 13, 1);
      own(st, 21, 1);
      for (const i of [17, 19, 20]) own(st, i, 1);
    });
    const w = oneAwayWarnings(s);
    expect(w).toContainEqual({ playerId: 0, kind: 'group', id: 'brown', missing: 2 });
    expect(w).toContainEqual({ playerId: 1, kind: 'hub', id: 'hubs', missing: 29 });
    expect(w).toContainEqual({ playerId: 1, kind: 'line', id: 'C', missing: 22 });
    expect(w).toContainEqual({ playerId: 1, kind: 'group', id: 'red', missing: 22 });
  });
});
