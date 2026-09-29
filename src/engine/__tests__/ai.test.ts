import { describe, expect, it } from 'vitest';
import { chooseAction } from '../ai';
import { isLegal, reduce } from '../reducer';
import type { GameState } from '../types';
import { edit, game, own } from './helpers';

function at(phase: GameState['phase'], setup: (st: GameState) => void = () => {}): GameState {
  return edit(game(), (st) => {
    st.phase = phase;
    setup(st);
  });
}

describe('CPU heuristics', () => {
  it('rolls in preRoll', () => {
    expect(chooseAction(game(), 0)).toEqual({ type: 'Roll', playerId: 0 });
  });

  it('refuses to act for another player', () => {
    expect(() => chooseAction(game(), 1)).toThrow();
  });

  it('island: escape card first, bail when cash ≥ 800, otherwise roll', () => {
    const ph = { kind: 'island', playerId: 0, turnsLeft: 3, bail: 200, canPayBail: true, hasEscapeCard: false } as const;
    expect(chooseAction(at(ph), 0).type).toBe('PayBail');
    expect(chooseAction(at(ph, (st) => (st.players[0]!.cash = 700)), 0).type).toBe('Roll');
    expect(chooseAction(at(ph, (st) => (st.players[0]!.cards = ['escape'])), 0).type).toBe('UseEscapeCard');
  });

  it('buys when affordable with no exposure; declines when the reserve is too thin', () => {
    const ph = { kind: 'buy', playerId: 0, spaceIndex: 10, price: 260 } as const;
    expect(chooseAction(at(ph), 0).type).toBe('Buy');
    const risky = at(ph, (st) => {
      st.players[0]!.cash = 300;
      own(st, 31, 1, 2);
      own(st, 30, 1, 2);
    });
    expect(chooseAction(risky, 0).type).toBe('Pass');
  });

  it('buys to complete a set or to stop an opponent from winning', () => {
    const ph = { kind: 'buy', playerId: 0, spaceIndex: 29, price: 250 } as const;
    const win = at(ph, (st) => {
      for (const i of [5, 13, 21]) own(st, i, 0);
      st.players[0]!.cash = 260;
      own(st, 31, 1, 3);
    });
    expect(chooseAction(win, 0).type).toBe('Buy');
    const block = at(ph, (st) => {
      for (const i of [5, 13, 21]) own(st, i, 1);
      st.players[0]!.cash = 260;
      own(st, 31, 1, 3);
    });
    expect(chooseAction(block, 0).type).toBe('Buy');
  });

  it('builds when cash ≥ 2× cost', () => {
    const ph = { kind: 'build', playerId: 0, spaceIndex: 10, toLevel: 2, cost: 160 } as const;
    expect(chooseAction(at(ph, (st) => own(st, 10, 0, 1)), 0).type).toBe('Build');
    expect(chooseAction(at(ph, (st) => { own(st, 10, 0, 1); st.players[0]!.cash = 300; }), 0).type).toBe('Pass');
  });

  it('takes over to win, never into a known shield', () => {
    const ph = { kind: 'takeover', playerId: 0, spaceIndex: 29, ownerId: 1, price: 500, ownerHasShield: false } as const;
    const s = at(ph, (st) => {
      for (const i of [5, 13, 21]) own(st, i, 0);
      own(st, 29, 1);
    });
    expect(chooseAction(s, 0).type).toBe('Takeover');
    expect(chooseAction(at({ ...ph, ownerHasShield: true }, (st) => own(st, 29, 1)), 0).type).toBe('Pass');
  });

  it('festival: picks the highest-toll own city', () => {
    const s = at({ kind: 'festival', playerId: 0, options: [1, 31] }, (st) => {
      own(st, 1, 0);
      own(st, 31, 0);
    });
    expect(chooseAction(s, 0)).toEqual({ type: 'SetFestival', playerId: 0, spaceIndex: 31 });
  });

  it('debt: sells the cheapest thing that covers the shortfall', () => {
    const s = at(
      { kind: 'debt', playerId: 0, amount: 300, payments: [{ to: 1, amount: 300 }], reason: 'toll', then: { kind: 'endLanding' } },
      (st) => {
        st.players[0]!.cash = 200;
        own(st, 1, 0);
        own(st, 31, 0, 1);
        own(st, 10, 0);
      },
    );
    const a = chooseAction(s, 0);
    expect(isLegal(s, a)).toBe(true);
    expect(a).toEqual({ type: 'SellProperty', playerId: 0, spaceIndex: 10 });
    expect(reduce(s, a).state.players[0]!.cash).toBe(200 + 130 - 300);
  });

  it('travel: goes for a winning purchase', () => {
    const opts = Array.from({ length: 32 }, (_, i) => i).filter((i) => i !== 8 && i !== 24);
    const s = at({ kind: 'travel', playerId: 0, options: opts }, (st) => {
      st.players[0]!.position = 24;
      for (const i of [5, 13, 21]) own(st, i, 0);
    });
    expect(chooseAction(s, 0)).toEqual({ type: 'ChooseTravel', playerId: 0, spaceIndex: 29 });
  });
});
