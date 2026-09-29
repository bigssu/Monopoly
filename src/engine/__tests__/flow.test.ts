import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../economy';
import { IllegalActionError, createGame, defaultAction, legalActions, reduce } from '../reducer';
import { buildCost, round10, takeoverPrice, tollOf } from '../rules';
import type { Action, GameState, PlayerId } from '../types';
import { act, buy, diceFor, edit, game, ofType, own, pass, queueDice, roll, run, setupLanding, types } from './helpers';

/** Apply default actions until it is `pid`'s decision (or the game ends). */
function advanceTo(state: GameState, pid: PlayerId, max = 200): GameState {
  let s = state;
  for (let i = 0; i < max && s.phase.kind !== 'gameOver' && s.phase.playerId !== pid; i++) {
    s = reduce(s, defaultAction(s)!).state;
  }
  return s;
}

describe('game creation', () => {
  it('creates a fresh game', () => {
    const s = game({ n: 4, seed: 9 });
    expect(s.players).toHaveLength(4);
    expect(s.players.map((p) => p.seat)).toEqual(['S', 'E', 'N', 'W']);
    for (const p of s.players) {
      expect(p).toMatchObject({ cash: 3000, position: 0, islandTurns: 0, bankrupt: false, cards: [] });
      expect(p).toMatchObject({ travelPending: false, expressPending: false, consecutiveDoubles: 0 });
    }
    expect(s.phase).toEqual({ kind: 'preRoll', playerId: 0, rollAgain: false });
    expect(s.round).toBe(1);
    expect(s.pot).toBe(0);
    expect(s.properties.filter(Boolean)).toHaveLength(23);
  });

  it('validates settings', () => {
    expect(() => game({ n: 1 })).toThrow();
    const st = game().settings;
    expect(() => createGame({ ...st, players: [st.players[0]!, { ...st.players[1]!, seat: 'S' }] }, 1)).toThrow();
    expect(() => createGame({ ...st, startCash: 0 }, 1)).toThrow();
  });
});

describe('illegal actions', () => {
  it('throws IllegalActionError for the wrong player or action, without mutating input', () => {
    const s = game();
    const snapshot = JSON.stringify(s);
    expect(() => reduce(s, roll(1))).toThrow(IllegalActionError);
    expect(() => reduce(s, buy(0))).toThrow(IllegalActionError);
    expect(() => reduce(s, { type: 'PayBail', playerId: 0 })).toThrow(IllegalActionError);
    expect(() => reduce(s, { type: 'Build', playerId: 0, spaceIndex: 1 })).toThrow(IllegalActionError);
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it('reduce never mutates its input', () => {
    const s = edit(game(), (st) => setupLanding(st, 0, 6, 6));
    const snapshot = JSON.stringify(s);
    const r = reduce(s, roll(0));
    expect(JSON.stringify(s)).toBe(snapshot);
    expect(r.state).not.toBe(s);
  });

  it('rejects actions after the game is over', () => {
    const s = edit(game({ roundLimit: 1 }), (st) => {
      queueDice(st, [1, 2], [1, 2]);
      st.testHooks!.cardQueue = ['tax-refund', 'tax-refund'];
    });
    const r = run(s, roll(0), roll(1));
    expect(r.state.phase.kind).toBe('gameOver');
    expect(() => reduce(r.state, roll(0))).toThrow(IllegalActionError);
    expect(legalActions(r.state)).toEqual([]);
    expect(defaultAction(r.state)).toBeNull();
  });
});

describe('movement & Start', () => {
  it('rolling moves the token along the path and opens the buy prompt', () => {
    const s = edit(game(), (st) => queueDice(st, [2, 4]));
    const r = act(s, roll(0));
    expect(types(r.events)).toEqual(['DiceRolled', 'TokenMoved', 'PromptOpened']);
    const mv = ofType(r.events, 'TokenMoved')[0]!;
    expect(mv).toMatchObject({ from: 0, to: 6, path: [1, 2, 3, 4, 5, 6], passedStart: false, mode: 'walk' });
    expect(r.state.phase).toEqual({ kind: 'buy', playerId: 0, spaceIndex: 6, price: 180 });
  });

  it('passing Start pays the salary', () => {
    const s = edit(game(), (st) => {
      st.players[0]!.position = 29;
      queueDice(st, [1, 3]);
    });
    const r = act(s, roll(0));
    const mv = ofType(r.events, 'TokenMoved')[0]!;
    expect(mv.path).toEqual([30, 31, 0, 1]);
    expect(mv.passedStart).toBe(true);
    expect(ofType(r.events, 'PassedStart')[0]).toMatchObject({ salary: ECONOMY.salary, landed: false });
    expect(r.state.players[0]!.cash).toBe(3000 + ECONOMY.salary);
  });

  it('landing exactly on Start pays salary plus the donation pot', () => {
    const s = edit(game(), (st) => {
      st.pot = 250;
      setupLanding(st, 0, 0, 5);
    });
    const r = act(s, roll(0));
    expect(r.state.players[0]!.cash).toBe(3000 + ECONOMY.salary + 250);
    expect(r.state.pot).toBe(0);
    expect(ofType(r.events, 'PotChanged')).toEqual([{ type: 'PotChanged', delta: -250, pot: 0 }]);
    expect(r.state.phase).toMatchObject({ kind: 'preRoll', playerId: 1 });
  });
});

describe('buying & building', () => {
  it('buy → optional immediate build → turn passes', () => {
    const s = edit(game(), (st) => queueDice(st, [2, 4]));
    let r = run(s, roll(0), buy(0));
    expect(r.state.properties[6]).toEqual({ owner: 0, level: 0 });
    expect(r.state.players[0]!.cash).toBe(3000 - 180);
    expect(ofType(r.events, 'PropertyBought')[0]).toMatchObject({ playerId: 0, spaceIndex: 6, price: 180, via: 'buy' });
    if (ECONOMY.buildOnPurchase) {
      expect(r.state.phase).toMatchObject({ kind: 'build', spaceIndex: 6, toLevel: 1, cost: buildCost(180, 1) });
      r = run(r.state, pass(0));
    }
    expect(r.state.phase).toMatchObject({ kind: 'preRoll', playerId: 1 });
  });

  it('passing the buy prompt leaves it unowned', () => {
    const s = edit(game(), (st) => queueDice(st, [2, 4]));
    const r = run(s, roll(0), pass(0));
    expect(r.state.properties[6]!.owner).toBeNull();
    expect(r.state.phase).toMatchObject({ kind: 'preRoll', playerId: 1 });
  });

  it('cannot afford → no prompt (CannotAfford event)', () => {
    const s = edit(game(), (st) => {
      st.players[0]!.cash = 100;
      queueDice(st, [2, 4]);
    });
    const r = act(s, roll(0));
    expect(ofType(r.events, 'CannotAfford')).toHaveLength(1);
    expect(r.state.phase).toMatchObject({ kind: 'preRoll', playerId: 1 });
  });

  it('landing on your own city offers one level; landmark requires L3 and is the max', () => {
    let s = edit(game(), (st) => {
      own(st, 10, 0, 1);
      setupLanding(st, 0, 10, 5);
    });
    let r = act(s, roll(0));
    expect(r.state.phase).toEqual({ kind: 'build', playerId: 0, spaceIndex: 10, toLevel: 2, cost: 160 });
    r = act(r.state, { type: 'Build', playerId: 0, spaceIndex: 10 });
    expect(r.state.properties[10]!.level).toBe(2);
    expect(r.state.players[0]!.cash).toBe(3000 - 160);
    expect(ofType(r.events, 'Built')[0]).toMatchObject({ level: 2, cost: 160, free: false });
    expect(r.state.phase).toMatchObject({ kind: 'preRoll', playerId: 1 }); // one level per visit

    s = edit(game(), (st) => {
      own(st, 10, 0, 3);
      setupLanding(st, 0, 10, 5);
    });
    r = act(s, roll(0));
    expect(r.state.phase).toMatchObject({ kind: 'build', toLevel: 4, cost: 260 });

    s = edit(game(), (st) => {
      own(st, 10, 0, 4);
      setupLanding(st, 0, 10, 5);
    });
    r = act(s, roll(0));
    expect(r.state.phase).toMatchObject({ kind: 'preRoll', playerId: 1 });
  });

  it('no remote building by default; buildAnywhere allows one pre-roll build per turn', () => {
    const s0 = edit(game(), (st) => own(st, 2, 0, 0));
    expect(legalActions(s0)).toEqual([roll(0)]);
    const s1 = edit(game({ buildAnywhere: true }), (st) => own(st, 2, 0, 0));
    expect(legalActions(s1)).toContainEqual({ type: 'Build', playerId: 0, spaceIndex: 2 });
    const r = act(s1, { type: 'Build', playerId: 0, spaceIndex: 2 });
    expect(r.state.properties[2]!.level).toBe(1);
    expect(r.state.phase).toMatchObject({ kind: 'preRoll', playerId: 0 });
    expect(legalActions(r.state)).toEqual([roll(0)]);
  });

  it('hubs cannot be built on', () => {
    const s = edit(game(), (st) => {
      own(st, 5, 0);
      setupLanding(st, 0, 5, 5);
    });
    const r = act(s, roll(0));
    expect(r.state.phase).toMatchObject({ kind: 'preRoll', playerId: 1 });
  });
});

describe('doubles', () => {
  it('doubles grant another roll after resolving', () => {
    const s = edit(game(), (st) => queueDice(st, [2, 2], [1, 2]));
    let r = run(s, roll(0), pass(0));
    expect(r.state.phase).toEqual({ kind: 'preRoll', playerId: 0, rollAgain: true });
    r = run(r.state, roll(0));
    expect(r.state.players[0]!.position).toBe(7);
    r = run(r.state, pass(0));
    expect(r.state.phase).toMatchObject({ kind: 'preRoll', playerId: 1 });
  });

  it('third consecutive doubles sends you to the island without moving', () => {
    const s = edit(game(), (st) => queueDice(st, [1, 1], [2, 2], [3, 3]));
    const r = run(s, roll(0), pass(0), roll(0), pass(0), roll(0));
    const last = r.events.slice(r.events.findLastIndex((e) => e.type === 'DiceRolled'));
    expect(last[0]).toMatchObject({ type: 'DiceRolled', isDouble: true, consecutiveDoubles: 3, steps: 0 });
    expect(ofType(last, 'TokenMoved')[0]).toMatchObject({ from: 6, to: 8, mode: 'jump', path: [8] });
    expect(ofType(last, 'SentToIsland')[0]).toMatchObject({ cause: 'doubles' });
    expect(r.state.players[0]!).toMatchObject({ position: 8, islandTurns: ECONOMY.islandTurns, consecutiveDoubles: 0 });
    expect(r.state.phase).toMatchObject({ kind: 'preRoll', playerId: 1 });
  });
});

describe('island', () => {
  it('landing on the island (even with doubles) ends the turn and strands you for 3 turns', () => {
    const s = edit(game(), (st) => {
      st.players[0]!.position = 4;
      queueDice(st, [2, 2]);
    });
    const r = act(s, roll(0));
    expect(ofType(r.events, 'SentToIsland')[0]).toMatchObject({ cause: 'space' });
    expect(r.state.players[0]!.islandTurns).toBe(3);
    expect(r.state.phase).toMatchObject({ kind: 'preRoll', playerId: 1 });
  });

  it('3 failed turns, then you leave automatically (no fee) on the 4th turn', () => {
    let s = edit(game(), (st) => {
      st.players[0]!.position = 8;
      st.players[0]!.islandTurns = 3;
      st.current = 1;
      st.phase = { kind: 'preRoll', playerId: 1, rollAgain: false };
      queueDice(st, [1, 2]);
    });
    s = advanceTo(s, 0);
    for (const left of [3, 2, 1]) {
      expect(s.phase).toMatchObject({ kind: 'island', playerId: 0, turnsLeft: left });
      s = edit(s, (st) => queueDice(st, [1, 2]));
      const r = act(s, roll(0));
      expect(ofType(r.events, 'IslandStay')[0]!.turnsLeft).toBe(left - 1);
      if (left === 1) expect(ofType(r.events, 'Escaped')[0]).toMatchObject({ method: 'served' });
      expect(r.state.players[0]!.position).toBe(8);
      s = advanceTo(r.state, 0);
    }
    expect(s.phase).toMatchObject({ kind: 'preRoll', playerId: 0 });
    expect(s.players[0]!.cash).toBeGreaterThan(0);
  });

  function stranded(extra: (st: GameState) => void = () => {}): GameState {
    return edit(game(), (st) => {
      st.players[0]!.position = 8;
      st.players[0]!.islandTurns = 3;
      st.phase = { kind: 'island', playerId: 0, turnsLeft: 3, bail: ECONOMY.bail, canPayBail: true, hasEscapeCard: false };
      extra(st);
    });
  }

  it('doubles escape and move, without an extra roll', () => {
    const s = stranded((st) => queueDice(st, [3, 3]));
    const r = act(s, roll(0));
    expect(ofType(r.events, 'Escaped')[0]).toMatchObject({ method: 'doubles' });
    expect(r.state.players[0]!.position).toBe(14);
    expect(r.state.phase).toMatchObject({ kind: 'buy', spaceIndex: 14 });
    const r2 = act(r.state, pass(0));
    expect(r2.state.phase).toMatchObject({ kind: 'preRoll', playerId: 1 });
  });

  it('bail (200 to the bank) then a normal roll', () => {
    const s = stranded((st) => queueDice(st, [2, 2]));
    let r = act(s, { type: 'PayBail', playerId: 0 });
    expect(r.state.players[0]!.cash).toBe(3000 - ECONOMY.bail);
    expect(r.state.players[0]!.islandTurns).toBe(0);
    expect(r.state.phase).toEqual({ kind: 'preRoll', playerId: 0, rollAgain: false });
    r = run(r.state, roll(0), pass(0));
    expect(r.state.phase).toMatchObject({ kind: 'preRoll', playerId: 0, rollAgain: true }); // normal doubles
  });

  it('escape card', () => {
    const s = stranded((st) => {
      st.players[0]!.cards = ['escape'];
    });
    expect(legalActions(s)).toContainEqual({ type: 'UseEscapeCard', playerId: 0 });
    const r = act(s, { type: 'UseEscapeCard', playerId: 0 });
    expect(r.state.players[0]!.cards).toEqual([]);
    expect(ofType(r.events, 'CardUsed')[0]).toMatchObject({ card: 'escape' });
    expect(r.state.phase).toMatchObject({ kind: 'preRoll', playerId: 0 });
  });

  it('bail is not offered without the cash, escape card not without the card', () => {
    const s = stranded((st) => {
      st.players[0]!.cash = 150;
    });
    expect(legalActions(s)).toEqual([roll(0)]);
    expect(() => reduce(s, { type: 'PayBail', playerId: 0 })).toThrow(IllegalActionError);
    expect(() => reduce(s, { type: 'UseEscapeCard', playerId: 0 })).toThrow(IllegalActionError);
  });
});

describe('tolls & takeover', () => {
  it('pays the toll to the owner', () => {
    const s = edit(game(), (st) => {
      own(st, 31, 1, 1);
      setupLanding(st, 0, 31, 5);
    });
    const toll = tollOf(s, 31);
    const r = act(s, roll(0));
    expect(ofType(r.events, 'TollPaid')[0]).toMatchObject({ payerId: 0, ownerId: 1, amount: toll, waived: false });
    const money = ofType(r.events, 'MoneyChanged');
    expect(money).toContainEqual(expect.objectContaining({ playerId: 0, delta: -toll, reason: 'toll', counterpart: 1 }));
    expect(money).toContainEqual(expect.objectContaining({ playerId: 1, delta: toll, reason: 'toll', counterpart: 0 }));
    expect(r.state.players[1]!.cash).toBe(3000 + toll);
  });

  it('takeover: pay 2 × value to the owner, buildings stay, then may build', () => {
    const s = edit(game(), (st) => {
      own(st, 10, 1, 1);
      setupLanding(st, 0, 10, 5);
    });
    const toll = tollOf(s, 10);
    const price = takeoverPrice(s, 10);
    expect(price).toBe(2 * (260 + 130));
    let r = act(s, roll(0));
    expect(r.state.phase).toEqual({ kind: 'takeover', playerId: 0, spaceIndex: 10, ownerId: 1, price, ownerHasShield: false });
    r = act(r.state, { type: 'Takeover', playerId: 0 });
    expect(ofType(r.events, 'TakenOver')[0]).toMatchObject({ buyerId: 0, sellerId: 1, price });
    expect(r.state.properties[10]).toEqual({ owner: 0, level: 1 });
    expect(r.state.players[0]!.cash).toBe(3000 - toll - price);
    expect(r.state.players[1]!.cash).toBe(3000 + toll + price);
    if (ECONOMY.buildAfterTakeover) expect(r.state.phase).toMatchObject({ kind: 'build', spaceIndex: 10, toLevel: 2 });
  });

  it('landmarks cannot be taken over', () => {
    const s = edit(game(), (st) => {
      own(st, 10, 1, 4);
      setupLanding(st, 0, 10, 5);
    });
    const r = act(s, roll(0));
    expect(ofType(r.events, 'TollPaid')).toHaveLength(1);
    expect(r.state.phase).toMatchObject({ kind: 'preRoll', playerId: 1 });
  });

  it('takeover setting off → no takeover prompt', () => {
    const s = edit(game({ takeover: false }), (st) => {
      own(st, 2, 1, 1);
      setupLanding(st, 0, 2, 5);
    });
    expect(act(s, roll(0)).state.phase).toMatchObject({ kind: 'preRoll', playerId: 1 });
  });

  it('not offered when the visitor cannot afford it', () => {
    const s = edit(game(), (st) => {
      own(st, 10, 1, 1);
      st.players[0]!.cash = 300;
      setupLanding(st, 0, 10, 5);
    });
    expect(act(s, roll(0)).state.phase).toMatchObject({ kind: 'preRoll', playerId: 1 });
  });

  it('수호 방패 blocks one takeover attempt and is consumed', () => {
    const s = edit(game(), (st) => {
      own(st, 10, 1, 1);
      st.players[1]!.cards = ['shield'];
      setupLanding(st, 0, 10, 5);
    });
    let r = act(s, roll(0));
    expect(r.state.phase).toMatchObject({ kind: 'takeover', ownerHasShield: true });
    const cashBefore = r.state.players[0]!.cash;
    r = act(r.state, { type: 'Takeover', playerId: 0 });
    expect(ofType(r.events, 'TakeoverBlocked')).toHaveLength(1);
    expect(ofType(r.events, 'CardUsed')[0]).toMatchObject({ playerId: 1, card: 'shield' });
    expect(r.state.properties[10]!.owner).toBe(1);
    expect(r.state.players[1]!.cards).toEqual([]);
    expect(r.state.players[0]!.cash).toBe(cashBefore);
  });

  it('통행료 면제권 is used automatically on the next toll', () => {
    const s = edit(game(), (st) => {
      own(st, 10, 1, 1);
      st.players[0]!.cards = ['toll-pass', 'escape'];
      setupLanding(st, 0, 10, 5);
    });
    const r = act(s, roll(0));
    expect(ofType(r.events, 'TollPaid')[0]).toMatchObject({ amount: 0, waived: true });
    expect(r.state.players[0]!.cash).toBe(3000);
    expect(r.state.players[0]!.cards).toEqual(['escape']);
    expect(r.state.phase).toMatchObject({ kind: 'takeover' }); // may still take over
  });

  it('hub toll 100 × count and hub takeover at 500', () => {
    const s = edit(game(), (st) => {
      own(st, 5, 1);
      own(st, 13, 1);
      setupLanding(st, 0, 5, 5);
    });
    let r = act(s, roll(0));
    expect(ofType(r.events, 'TollPaid')[0]!.amount).toBe(200);
    expect(r.state.phase).toMatchObject({ kind: 'takeover', price: 500 });
    r = act(r.state, { type: 'Takeover', playerId: 0 });
    expect(r.state.properties[5]!.owner).toBe(0);
    expect(r.state.phase).toMatchObject({ kind: 'preRoll', playerId: 1 });
  });
});

describe('festival', () => {
  it('pick one own city; the single marker moves; toll ×2', () => {
    let s = edit(game(), (st) => {
      own(st, 1, 0);
      own(st, 2, 0);
      setupLanding(st, 0, 16, 5);
    });
    let r = act(s, roll(0));
    expect(r.state.phase).toEqual({ kind: 'festival', playerId: 0, options: [1, 2] });
    r = act(r.state, { type: 'SetFestival', playerId: 0, spaceIndex: 2 });
    expect(r.state.festival).toBe(2);
    expect(ofType(r.events, 'FestivalSet')[0]).toMatchObject({ spaceIndex: 2, previous: null });

    s = edit(r.state, (st) => {
      st.current = 0;
      st.phase = { kind: 'preRoll', playerId: 0, rollAgain: false };
      setupLanding(st, 0, 16, 6);
    });
    r = act(s, roll(0));
    expect(r.state.phase).toMatchObject({ kind: 'festival', options: [1] });
    r = act(r.state, { type: 'SetFestival', playerId: 0, spaceIndex: 1 });
    expect(r.state.festival).toBe(1);
    expect(ofType(r.events, 'FestivalSet')[0]).toMatchObject({ spaceIndex: 1, previous: 2 });
    expect(tollOf(r.state, 2)).toBe(round10(120 * ECONOMY.tollRates[0]!) * 2); // brown group bonus only
  });

  it('festival toll applies to visitors', () => {
    const s = edit(game(), (st) => {
      own(st, 31, 1, 1);
      st.festival = 31;
      st.players[0]!.cash = 5000;
      setupLanding(st, 0, 31, 5);
    });
    const r = act(s, roll(0));
    expect(ofType(r.events, 'TollPaid')[0]).toMatchObject({
      amount: round10(1000 * ECONOMY.tollRates[1]!) * 2,
      festival: true,
    });
  });

  it('no own city → nothing happens', () => {
    const s = edit(game(), (st) => setupLanding(st, 0, 16, 5));
    expect(act(s, roll(0)).state.phase).toMatchObject({ kind: 'preRoll', playerId: 1 });
  });
});

describe('travel (자유여행)', () => {
  it('landing grants travel next turn (no extra roll even on doubles)', () => {
    const s = edit(game(), (st) => {
      st.players[0]!.position = 20;
      queueDice(st, [2, 2]);
    });
    const r = act(s, roll(0));
    expect(ofType(r.events, 'TravelGranted')).toHaveLength(1);
    expect(r.state.players[0]!.travelPending).toBe(true);
    expect(r.state.phase).toMatchObject({ kind: 'preRoll', playerId: 1 });
    const s2 = advanceTo(r.state, 0);
    expect(s2.phase.kind).toBe('travel');
    const opts = (s2.phase as { options: number[] }).options;
    expect(opts).not.toContain(8);
    expect(opts).not.toContain(24);
    expect(opts).toHaveLength(30);
  });

  it('choose a destination: walk there (salary when passing Start) and resolve the landing', () => {
    const s = edit(game(), (st) => {
      st.players[0]!.position = 24;
      st.players[0]!.travelPending = true;
      st.phase = { kind: 'travel', playerId: 0, options: [] };
    });
    // options are recomputed by legalActions from the phase; use the real phase:
    const s1 = edit(s, (st) => {
      st.phase = { kind: 'travel', playerId: 0, options: Array.from({ length: 32 }, (_, i) => i).filter((i) => i !== 8 && i !== 24) };
    });
    expect(() => reduce(s1, { type: 'ChooseTravel', playerId: 0, spaceIndex: 8 })).toThrow(IllegalActionError);
    const r = act(s1, { type: 'ChooseTravel', playerId: 0, spaceIndex: 1 });
    const mv = ofType(r.events, 'TokenMoved')[0]!;
    expect(mv).toMatchObject({ cause: 'travel', passedStart: true, to: 1 });
    expect(r.state.players[0]!.cash).toBe(3000 + ECONOMY.salary);
    expect(r.state.players[0]!.travelPending).toBe(false);
    expect(r.state.phase).toMatchObject({ kind: 'buy', spaceIndex: 1 });
  });

  it('can decline and roll normally', () => {
    const s = edit(game(), (st) => {
      st.players[0]!.position = 24;
      st.players[0]!.travelPending = true;
      st.phase = { kind: 'travel', playerId: 0, options: [1, 2] };
    });
    const r = act(s, pass(0));
    expect(ofType(r.events, 'TravelDeclined')).toHaveLength(1);
    expect(r.state.phase).toEqual({ kind: 'preRoll', playerId: 0, rollAgain: false });
    expect(r.state.players[0]!.travelPending).toBe(false);
  });
});

describe('tax & donation', () => {
  it('tax office: 10% of cash rounded to 10 into the pot', () => {
    const s = edit(game(), (st) => {
      st.players[0]!.cash = 2345;
      setupLanding(st, 0, 23, 5);
    });
    const r = act(s, roll(0));
    expect(r.state.players[0]!.cash).toBe(2345 - 230);
    expect(r.state.pot).toBe(230);
  });

  it('donation: 100 (or all cash if less) into the pot', () => {
    let s = edit(game(), (st) => setupLanding(st, 0, 11, 5));
    let r = act(s, roll(0));
    expect(r.state.pot).toBe(100);
    s = edit(game(), (st) => {
      st.players[0]!.cash = 60;
      setupLanding(st, 0, 11, 5);
    });
    r = act(s, roll(0));
    expect(r.state.pot).toBe(60);
    expect(r.state.players[0]!.cash).toBe(0);
  });
});

describe('debt: sell to pay', () => {
  it('opens the debt phase, sells, then pays automatically', () => {
    const s = edit(game(), (st) => {
      own(st, 31, 1, 2);
      own(st, 30, 0, 1);
      st.players[0]!.cash = 1500;
      setupLanding(st, 0, 31, 5);
    });
    const toll = tollOf(s, 31);
    expect(toll).toBeGreaterThan(1500);
    let r = act(s, roll(0));
    expect(r.state.phase).toMatchObject({ kind: 'debt', playerId: 0, amount: toll, reason: 'toll' });
    expect(ofType(r.events, 'DebtStarted')[0]).toMatchObject({ shortfall: toll - 1500 });
    expect(legalActions(r.state)).toEqual([
      { type: 'SellBuilding', playerId: 0, spaceIndex: 30 },
      { type: 'SellProperty', playerId: 0, spaceIndex: 30 },
    ]);
    expect(() => reduce(r.state, pass(0))).toThrow(IllegalActionError);
    r = act(r.state, { type: 'SellBuilding', playerId: 0, spaceIndex: 30 });
    expect(r.state.players[0]!.cash).toBe(1500 + 200);
    expect(r.state.properties[30]!.level).toBe(0);
    if (1700 < toll) {
      expect(r.state.phase.kind).toBe('debt');
      r = act(r.state, { type: 'SellProperty', playerId: 0, spaceIndex: 30 });
    }
    expect(ofType(r.events, 'TollPaid')[0]).toMatchObject({ amount: toll });
    expect(ofType(r.events, 'DebtSettled')).toHaveLength(1);
    expect(r.state.players[0]!.cash).toBe(1500 + 200 + 400 - toll);
    expect(r.state.properties[30]).toEqual({ owner: null, level: 0 });
    expect(r.state.players[1]!.cash).toBe(3000 + toll);
  });

  it('selling the festival city removes the marker', () => {
    const s = edit(game(), (st) => {
      own(st, 31, 1, 2);
      own(st, 30, 0, 0);
      st.festival = 30;
      st.players[0]!.cash = 1800;
      setupLanding(st, 0, 31, 5);
    });
    let r = act(s, roll(0));
    r = act(r.state, { type: 'SellProperty', playerId: 0, spaceIndex: 30 });
    expect(r.state.festival).toBeNull();
  });
});

describe('bankruptcy', () => {
  it('to a player: properties (with buildings) and cash go to the creditor; with elimination play continues', () => {
    const s = edit(game({ n: 3, endOnFirstBankruptcy: false }), (st) => {
      own(st, 31, 1, 2);
      own(st, 1, 0, 1);
      st.festival = 1;
      st.players[0]!.cash = 100;
      st.players[0]!.cards = ['escape'];
      setupLanding(st, 0, 31, 5);
    });
    const r = act(s, roll(0));
    expect(ofType(r.events, 'Bankrupt')[0]).toMatchObject({ playerId: 0, creditorId: 1 });
    expect(ofType(r.events, 'PropertyTransferred')[0]).toMatchObject({ spaceIndex: 1, from: 0, to: 1, level: 1 });
    expect(r.state.properties[1]).toEqual({ owner: 1, level: 1 });
    expect(r.state.festival).toBe(1);
    expect(r.state.players[0]!).toMatchObject({ bankrupt: true, cash: 0, cards: [] });
    expect(r.state.players[1]!.cash).toBe(3100);
    expect(r.state.bankruptOrder).toEqual([0]);
    expect(r.state.phase).toMatchObject({ kind: 'preRoll', playerId: 1 });
  });

  it('bankrupt players are skipped; last solvent player wins', () => {
    const s = edit(game({ n: 3, endOnFirstBankruptcy: false }), (st) => {
      st.players[1]!.bankrupt = true;
      st.bankruptOrder = [1];
      own(st, 31, 2, 2);
      st.players[0]!.cash = 10;
      setupLanding(st, 0, 31, 5);
    });
    const r = act(s, roll(0));
    expect(r.state.phase).toMatchObject({ kind: 'gameOver' });
    const go = ofType(r.events, 'GameOver')[0]!;
    expect(go.result).toMatchObject({ winnerId: 2, victory: 'lastStanding' });
    expect(go.result.ranking.map((e) => e.playerId)).toEqual([2, 0, 1]);
  });

  it('to the bank: properties become unowned (buildings removed, festival cleared)', () => {
    const s = edit(game({ n: 3, endOnFirstBankruptcy: false }), (st) => {
      own(st, 1, 0, 2);
      st.festival = 1;
      st.players[0]!.cash = 10;
      setupLanding(st, 0, 3, 3);
      st.testHooks!.cardQueue = ['fine'];
    });
    const r = act(s, roll(0));
    expect(ofType(r.events, 'Bankrupt')[0]).toMatchObject({ playerId: 0, creditorId: null });
    expect(r.state.properties[1]).toEqual({ owner: null, level: 0 });
    expect(r.state.festival).toBeNull();
    expect(r.state.players[0]!.cash).toBe(0);
  });

  it('first bankruptcy ends the game by default (richest solvent player wins)', () => {
    const s = edit(game({ n: 3 }), (st) => {
      own(st, 31, 1, 2);
      st.players[2]!.cash = 9000;
      st.players[0]!.cash = 100;
      setupLanding(st, 0, 31, 5);
    });
    const r = act(s, roll(0));
    const go = ofType(r.events, 'GameOver')[0]!;
    expect(go.result.victory).toBe('bankruptcy');
    expect(go.result.winnerId).toBe(2);
    expect(go.result.ranking.at(-1)!.playerId).toBe(0);
  });

  it('cascade: properties received from a bankrupt player can complete a 독점 set', () => {
    const s = edit(game({ n: 3, endOnFirstBankruptcy: false }), (st) => {
      own(st, 5, 1);
      own(st, 13, 1);
      own(st, 21, 1);
      own(st, 29, 0);
      own(st, 31, 1, 3);
      st.players[0]!.cash = 50;
      setupLanding(st, 0, 31, 5);
    });
    const r = act(s, roll(0));
    expect(ofType(r.events, 'GameOver')[0]!.result).toMatchObject({ winnerId: 1, victory: 'hubs' });
  });
});

describe('auction (setting)', () => {
  const at = (extra: Partial<GameState['settings']> = {}) =>
    edit(game({ n: 3, auction: true, ...extra }), (st) => setupLanding(st, 0, 1, 5));

  it('declining starts an auction at 50% with +10% bids; highest bidder buys', () => {
    let r = run(at(), roll(0), pass(0));
    expect(ofType(r.events, 'AuctionStarted')[0]).toMatchObject({ spaceIndex: 1, minBid: 50, bidders: [1, 2] });
    expect(r.state.phase).toMatchObject({ kind: 'auction', playerId: 1, minBid: 50, increment: 10 });
    r = run(r.state, { type: 'Bid', playerId: 1 });
    expect(r.state.phase).toMatchObject({ kind: 'auction', playerId: 2, minBid: 60, highBid: 50, highBidderId: 1 });
    r = run(r.state, { type: 'Bid', playerId: 2 }, pass(1));
    expect(ofType(r.events, 'AuctionEnded')[0]).toMatchObject({ winnerId: 2, price: 60 });
    expect(r.state.properties[1]!.owner).toBe(2);
    expect(r.state.players[2]!.cash).toBe(3000 - 60);
    expect(r.state.phase).toMatchObject({ kind: 'preRoll', playerId: 1 });
  });

  it('nobody bids → stays unowned', () => {
    const r = run(at(), roll(0), pass(0), pass(1), pass(2));
    expect(ofType(r.events, 'AuctionEnded')[0]).toMatchObject({ winnerId: null });
    expect(r.state.properties[1]!.owner).toBeNull();
  });

  it('off by default', () => {
    const s = edit(game({ n: 3 }), (st) => setupLanding(st, 0, 1, 5));
    const r = run(s, roll(0), pass(0));
    expect(ofType(r.events, 'AuctionStarted')).toHaveLength(0);
  });
});

describe('round limit', () => {
  it('ends after the last turn of the final round; highest assets win', () => {
    const s = edit(game({ roundLimit: 2 }), (st) => {
      st.players[1]!.cash = 5000;
      queueDice(st, [1, 2], [1, 2], [3, 5], [3, 5]);
      st.testHooks!.cardQueue = ['tax-refund', 'tax-refund', 'tax-refund', 'tax-refund'];
    });
    let r = run(s, roll(0), roll(1));
    expect(r.state.round).toBe(2);
    expect(ofType(r.events, 'RoundStarted')[0]).toEqual({ type: 'RoundStarted', round: 2 });
    r = run(r.state, roll(0), roll(1));
    const go = ofType(r.events, 'GameOver')[0]!;
    expect(go.result).toMatchObject({ winnerId: 1, victory: 'roundLimit', round: 2 });
  });
});

describe('독점 victories are immediate', () => {
  it('hub set on purchase', () => {
    const s = edit(game(), (st) => {
      for (const i of [5, 13, 21]) own(st, i, 0);
      setupLanding(st, 0, 29, 5);
    });
    const r = run(s, roll(0), buy(0));
    expect(r.state.phase).toMatchObject({ kind: 'gameOver', result: { winnerId: 0, victory: 'hubs' } });
  });

  it('line on purchase', () => {
    const s = edit(game(), (st) => {
      for (const i of [17, 19, 20]) own(st, i, 0);
      setupLanding(st, 0, 22, 5);
    });
    const r = run(s, roll(0), buy(0));
    expect(r.state.phase).toMatchObject({ kind: 'gameOver', result: { victory: 'line', side: 'C' } });
  });

  it('triple on purchase', () => {
    const s = edit(game(), (st) => {
      for (const i of [1, 2, 30, 31, 4, 6]) own(st, i, 0);
      setupLanding(st, 0, 7, 5);
    });
    const r = run(s, roll(0), buy(0));
    expect(r.state.phase).toMatchObject({ kind: 'gameOver', result: { victory: 'triple' } });
  });

  it('독점 via takeover', () => {
    const s = edit(game(), (st) => {
      for (const i of [5, 13, 21]) own(st, i, 0);
      own(st, 29, 1);
      setupLanding(st, 0, 29, 5);
    });
    const r = run(s, roll(0), { type: 'Takeover', playerId: 0 });
    expect(r.state.phase).toMatchObject({ kind: 'gameOver', result: { winnerId: 0, victory: 'hubs' } });
  });
});

describe('OneAway warnings', () => {
  it('fires when a player becomes one property short of a set', () => {
    const s = edit(game(), (st) => {
      own(st, 4, 0);
      setupLanding(st, 0, 6, 5);
    });
    const r = run(s, roll(0), buy(0));
    expect(ofType(r.events, 'OneAway')).toContainEqual({ type: 'OneAway', playerId: 0, kind: 'group', id: 'sky', missing: 7 });
  });
});

describe('prompt defaults', () => {
  it('defaultAction is Pass for decline-able prompts and Roll for roll prompts', () => {
    const s = edit(game(), (st) => queueDice(st, [2, 4]));
    expect(defaultAction(s)).toEqual(roll(0));
    const r = act(s, roll(0));
    expect(defaultAction(r.state)).toEqual(pass(0));
  });

  it('every phase offers Pass except roll/island/debt', () => {
    const acts: Action[] = legalActions(edit(game(), (st) => queueDice(st, diceFor(6))));
    expect(acts.some((a) => a.type === 'Pass')).toBe(false);
  });
});
