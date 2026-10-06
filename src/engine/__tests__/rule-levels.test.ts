/**
 * Rule levels (docs/superpowers/specs/2026-10-04-rule-levels-design.md): B1 late toll, B4 grand festival,
 * B5 hub growth, the level flags and save compatibility.
 */
import { describe, expect, it } from 'vitest';
import { getBoardInfo } from '../board';
import { ECONOMY } from '../economy';
import { createGame, gaugeRoll, reduce } from '../reducer';
import { chooseAction } from '../ai';
import { createRng, rollDice, seedToState } from '../rng';
import { festivalMultiplier, hubStep, lateTollMultiplier, round10, tollOf } from '../rules';
import { deserialize, serialize } from '../save';
import { defaultPlayers, defaultSettings, ruleFlags } from '../settings';
import { simulateGame } from '../sim';
import type { CardId } from '../types';
import { act, edit, game, ofType, own, queueCards, roll, setupLanding } from './helpers';

describe('rule levels', () => {
  it('turn rules on by level; new games default to normal', () => {
    expect(ruleFlags({ rules: 'easy' })).toMatchObject({ lateToll: false, grandFestival: false, hubGrowth: false });
    expect(ruleFlags({ rules: 'normal' })).toMatchObject({ lateToll: true, cardChoice: true, manualCards: true, grandFestival: true, hubGrowth: false, doubleUp: false });
    expect(ruleFlags({ rules: 'advanced' })).toMatchObject({ hubGrowth: true, doubleUp: true, diceGauge: true });
    expect(ruleFlags({})).toMatchObject({ lateToll: false }); // older saves
    expect(defaultSettings().rules).toBe('normal');
  });

  it('loads a save without a rule level as easy', () => {
    const s = game({ rules: 'normal' });
    const file = JSON.parse(serialize(s));
    delete file.state.settings.rules;
    expect(deserialize(JSON.stringify(file)).settings.rules).toBe('easy');
  });
});

describe('B1 late toll', () => {
  const at = (round: number, rules: 'easy' | 'normal' = 'normal', limit: number | null = 15) =>
    edit(game({ rules, roundLimit: limit }), (st) => {
      st.round = round;
    });

  it('ramps ×1.25 … ×2.25 over the last five rounds', () => {
    expect(lateTollMultiplier(at(10))).toBe(1);
    expect(lateTollMultiplier(at(11))).toBe(1.25);
    expect(lateTollMultiplier(at(13))).toBe(1.75);
    expect(lateTollMultiplier(at(15))).toBe(2.25);
  });

  it('is off on easy and in unlimited games', () => {
    expect(lateTollMultiplier(at(15, 'easy'))).toBe(1);
    expect(lateTollMultiplier(at(15, 'normal', null))).toBe(1);
  });

  it('raises the toll a visitor pays', () => {
    const base = edit(at(10), (st) => own(st, 31, 1, 1));
    const late = edit(at(13), (st) => own(st, 31, 1, 1));
    expect(tollOf(late, 31)).toBe(round10(tollOf(base, 31) * 1.75));
  });
});

describe('B4 grand festival', () => {
  it('holding the festival again on the same city raises ×2 → ×3 → ×5; moving resets', () => {
    let s = edit(game({ rules: 'normal' }), (st) => {
      own(st, 1, 0);
      own(st, 2, 0);
      st.festival = 2;
      st.festivalLevel = 1;
      setupLanding(st, 0, 16, 5);
    });
    let r = act(s, roll(0));
    expect(r.state.phase).toMatchObject({ kind: 'festival', options: [1, 2] });
    r = act(r.state, { type: 'SetFestival', playerId: 0, spaceIndex: 2 });
    expect(r.state.festivalLevel).toBe(2);
    expect(festivalMultiplier(r.state)).toBe(3);
    s = edit(r.state, (st) => {
      st.festivalLevel = 2;
      st.current = 0;
      st.phase = { kind: 'preRoll', playerId: 0, rollAgain: false };
      setupLanding(st, 0, 16, 6);
    });
    r = act(act(s, roll(0)).state, { type: 'SetFestival', playerId: 0, spaceIndex: 2 });
    expect(festivalMultiplier(r.state)).toBe(ECONOMY.grandFestivalMultipliers[2]);
    s = edit(r.state, (st) => {
      st.current = 0;
      st.phase = { kind: 'preRoll', playerId: 0, rollAgain: false };
      setupLanding(st, 0, 16, 5);
    });
    // At the top level the current city is no longer offered; moving resets to ×2.
    const offer = act(s, roll(0)).state;
    expect(offer.phase).toMatchObject({ kind: 'festival', options: [1] });
    r = act(offer, { type: 'SetFestival', playerId: 0, spaceIndex: 1 });
    expect(r.state.festivalLevel).toBe(1);
    expect(festivalMultiplier(r.state)).toBe(2);
  });

  it('easy keeps the single ×2 festival and never re-offers its city', () => {
    const s = edit(game(), (st) => {
      own(st, 1, 0);
      own(st, 2, 0);
      st.festival = 2;
      setupLanding(st, 0, 16, 5);
    });
    expect(act(s, roll(0)).state.phase).toMatchObject({ kind: 'festival', options: [1] });
  });
});

describe('B5 hub growth', () => {
  const hub = getBoardInfo(7).hubIndices[0]!;

  it('each toll paid at a hub adds a step for its owner, up to ×4', () => {
    let s = edit(game({ rules: 'advanced', roundLimit: null }), (st) => {
      own(st, hub, 1);
      st.players[0]!.cash = 9000;
    });
    const base = tollOf(s, hub);
    for (let k = 0; k < 5; k++) {
      s = edit(s, (st) => {
        st.current = 0;
        st.phase = { kind: 'preRoll', playerId: 0, rollAgain: false };
        setupLanding(st, 0, hub, 4);
      });
      const r = reduce(s, roll(0));
      expect(ofType(r.events, 'TollPaid')[0]!.amount).toBe(base * Math.min(4, 1 + k));
      s = r.state;
    }
    expect(hubStep(s, hub)).toBe(4);
  });

  it('steps belong to the owner who earned them', () => {
    const s = edit(game({ rules: 'advanced' }), (st) => {
      own(st, hub, 2);
      st.hubVisits = { [hub]: { owner: 1, n: 3 } };
    });
    expect(hubStep(s, hub)).toBe(1);
  });

  it('is off below advanced', () => {
    const s = edit(game({ rules: 'normal' }), (st) => {
      own(st, hub, 1);
      st.hubVisits = { [hub]: { owner: 1, n: 3 } };
    });
    expect(hubStep(s, hub)).toBe(1);
  });
});

describe('B2 card choice', () => {
  const ev = getBoardInfo(7).eventIndices[0]!;
  const landOnEvent = (rules: 'easy' | 'normal', ...cards: CardId[]) =>
    edit(game({ rules }), (st) => {
      setupLanding(st, 0, ev, 5);
      queueCards(st, ...cards);
    });

  it('offers two cards and plays the chosen one', () => {
    const r = act(landOnEvent('normal', 'lottery', 'fine'), roll(0));
    expect(r.state.phase).toMatchObject({ kind: 'cardChoice', playerId: 0, options: ['lottery', 'fine'] });
    expect(ofType(r.events, 'CardsOffered')[0]).toMatchObject({ options: ['lottery', 'fine'] });
    const cash = r.state.players[0]!.cash;
    const c = act(r.state, { type: 'ChooseCard', playerId: 0, cardId: 'lottery' });
    expect(ofType(c.events, 'CardDrawn')[0]).toMatchObject({ cardId: 'lottery' });
    expect(c.state.players[0]!.cash).toBe(cash + 500);
  });

  it('never offers the same card twice', () => {
    const r = act(landOnEvent('normal', 'fine', 'fine', 'lottery'), roll(0));
    expect(r.state.phase).toMatchObject({ kind: 'cardChoice', options: ['fine', 'lottery'] });
  });

  it('easy draws straight away', () => {
    const r = act(landOnEvent('easy', 'lottery'), roll(0));
    expect(ofType(r.events, 'CardDrawn')[0]).toMatchObject({ cardId: 'lottery' });
    expect(r.state.phase.kind).not.toBe('cardChoice');
  });
});

describe('B3 manual keep-cards', () => {
  const visit = (rules: 'easy' | 'normal') =>
    edit(game({ rules }), (st) => {
      own(st, 31, 1, 1);
      st.players[0]!.cards = ['toll-pass'];
      st.players[0]!.cash = 5000;
      setupLanding(st, 0, 31, 5);
    });

  it('asks before spending the Toll Pass; using it waives the toll', () => {
    const r = act(visit('normal'), roll(0));
    expect(r.state.phase).toMatchObject({ kind: 'useCard', playerId: 0, card: 'toll-pass', spaceIndex: 31 });
    const used = act(r.state, { type: 'UseCard', playerId: 0 });
    expect(ofType(used.events, 'TollPaid')[0]).toMatchObject({ waived: true, amount: 0 });
    expect(used.state.players[0]!.cards).toEqual([]);
  });

  it('declining pays the toll and keeps the pass', () => {
    const r = act(visit('normal'), roll(0));
    const paid = act(r.state, { type: 'Pass', playerId: 0 });
    expect(ofType(paid.events, 'TollPaid')[0]!.amount).toBe(tollOf(r.state, 31));
    expect(paid.state.players[0]!.cards).toEqual(['toll-pass']);
  });

  it('easy still spends the pass automatically', () => {
    const r = act(visit('easy'), roll(0));
    expect(ofType(r.events, 'TollPaid')[0]).toMatchObject({ waived: true });
  });

  it('the owner decides on the Guard Shield', () => {
    const s = edit(game({ rules: 'normal' }), (st) => {
      own(st, 31, 1, 1);
      st.players[1]!.cards = ['shield'];
      st.players[0]!.cash = 9000;
      setupLanding(st, 0, 31, 5);
    });
    const offer = act(s, roll(0)).state;
    expect(offer.phase).toMatchObject({ kind: 'takeover', playerId: 0 });
    const ask = act(offer, { type: 'Takeover', playerId: 0 });
    expect(ask.state.phase).toMatchObject({ kind: 'useCard', playerId: 1, card: 'shield', buyerId: 0 });
    const blocked = act(ask.state, { type: 'UseCard', playerId: 1 });
    expect(ofType(blocked.events, 'TakeoverBlocked')).toHaveLength(1);
    expect(blocked.state.properties[31]!.owner).toBe(1);
    const allowed = act(ask.state, { type: 'Pass', playerId: 1 });
    expect(ofType(allowed.events, 'TakenOver')).toHaveLength(1);
    expect(allowed.state.properties[31]!.owner).toBe(0);
    expect(allowed.state.players[1]!.cards).toEqual(['shield']);
  });

  it('saves and loads the new prompts', () => {
    const pass = act(visit('normal'), roll(0)).state;
    expect(deserialize(serialize(pass)).phase).toEqual(pass.phase);
    const ev = getBoardInfo(7).eventIndices[0]!;
    const pick = act(edit(game({ rules: 'normal' }), (st) => { setupLanding(st, 0, ev, 5); queueCards(st, 'lottery', 'fine'); }), roll(0)).state;
    expect(deserialize(serialize(pick)).phase).toEqual(pick.phase);
  });
});

describe('advanced rules end to end', () => {
  it('CPU games stay legal and finish at every level', () => {
    for (const rules of ['easy', 'normal', 'advanced'] as const) {
      for (const seed of [11, 22, 33]) {
        const r = simulateGame({ ...defaultSettings({ players: defaultPlayers(4, { cpu: true }) }), rules }, seed);
        expect(r.finalState.phase.kind, `${rules} ${seed}`).toBe('gameOver');
      }
    }
  });
});

describe('B6 double-up', () => {
  const onStart = () =>
    edit(game({ rules: 'advanced' }), (st) => {
      setupLanding(st, 0, 0, 5);
    });

  it('landing exactly on Start offers the salary as the stake', () => {
    const r = act(onStart(), roll(0));
    expect(r.state.phase).toMatchObject({ kind: 'doubleUp', playerId: 0, stake: ECONOMY.salary, wins: 0 });
    expect(deserialize(serialize(r.state)).phase).toEqual(r.state.phase);
  });

  it('a right higher/lower guess doubles what is on the line, a wrong one (or a tie) loses it', () => {
    const offer = act(onStart(), roll(0)).state;
    const shown = (offer.phase as { shown: number }).shown;
    expect(shown).toBeGreaterThanOrEqual(1);
    for (const guess of ['high', 'low'] as const) {
      const cash = offer.players[0]!.cash;
      const r = act(offer, { type: 'DoubleUpGuess', playerId: 0, guess });
      const rolled = ofType(r.events, 'DoubleUpRolled')[0]!;
      expect(rolled.shown).toBe(shown);
      expect(rolled.win).toBe(guess === 'high' ? rolled.die > shown : rolled.die < shown);
      if (rolled.win) {
        expect(r.state.players[0]!.cash).toBe(cash + ECONOMY.salary);
        // The rolled die is the next one to beat.
        expect(r.state.phase).toMatchObject({ kind: 'doubleUp', stake: ECONOMY.salary * 2, wins: 1, shown: rolled.die });
      } else {
        expect(r.state.players[0]!.cash).toBe(cash - ECONOMY.salary);
        expect(r.state.phase.kind).not.toBe('doubleUp');
      }
    }
  });

  it('stops after the third right guess; Pass banks it', () => {
    const offer = edit(act(onStart(), roll(0)).state, (st) => {
      st.phase = { kind: 'doubleUp', playerId: 0, stake: ECONOMY.salary * 4, wins: 2, shown: 3 };
    });
    for (const guess of ['high', 'low'] as const) {
      const r = act(offer, { type: 'DoubleUpGuess', playerId: 0, guess });
      expect(r.state.phase.kind).not.toBe('doubleUp');
    }
    expect(act(offer, { type: 'Pass', playerId: 0 }).state.phase.kind).not.toBe('doubleUp');
  });
});

describe('B7 dice gauge', () => {
  const mean = (gauge: number) => {
    let total = 0;
    for (let seed = 1; seed <= 3000; seed++) {
      const rng = createRng(seedToState(seed));
      const d = gaugeRoll(rng, gauge, rollDice(rng));
      total += d[0] + d[1];
    }
    return total / 3000;
  };

  it('a high release nudges the total up, a low one down, the middle not at all', () => {
    const mid = mean(0.5);
    expect(mean(1)).toBeGreaterThan(mid + 0.4);
    expect(mean(0)).toBeLessThan(mid - 0.4);
  });

  it('is ignored below advanced', () => {
    const play = (rules: 'normal' | 'advanced') => act(game({ rules, seed: 5 }), { type: 'Roll', playerId: 0, gauge: 1 }).state.lastDice;
    expect(play('normal')).toEqual(act(game({ rules: 'normal', seed: 5 }), roll(0)).state.lastDice);
    expect(play('advanced')).not.toBeUndefined();
  });
});

describe('game statistics', () => {
  it('tolls paid equal tolls earned; one asset row per round; saved and loaded', () => {
    const r = simulateGame({ ...defaultSettings({ players: defaultPlayers(4, { cpu: true }) }), rules: 'normal' }, 7);
    const st = r.finalState.stats!;
    expect(st).toHaveLength(4);
    const sum = (k: 'tollPaid' | 'tollEarned') => st.reduce((a, p) => a + p[k], 0);
    expect(sum('tollPaid')).toBe(sum('tollEarned'));
    expect(sum('tollEarned')).toBeGreaterThan(0);
    expect(r.finalState.history!.length).toBe(r.finalState.round);
    const back = deserialize(serialize(r.finalState));
    expect(back.stats).toEqual(st);
  });
});

describe('wave 1: interaction, endings, fairness', () => {
  const ev = getBoardInfo(7).eventIndices[0]!;

  it('typhoon: the player picks the opponent city it hits', () => {
    const s = edit(game({ rules: 'normal' }), (st) => {
      own(st, 31, 1, 2);
      own(st, 22, 1, 1);
      setupLanding(st, 0, ev, 5);
      queueCards(st, 'typhoon', 'fine');
    });
    const pick = act(act(s, roll(0)).state, { type: 'ChooseCard', playerId: 0, cardId: 'typhoon' }).state;
    expect(pick.phase).toMatchObject({ kind: 'target', playerId: 0, card: 'typhoon' });
    expect((pick.phase as { options: number[] }).options.sort()).toEqual([22, 31]);
    expect(deserialize(serialize(pick)).phase).toEqual(pick.phase);
    const hit = act(pick, { type: 'ChooseTarget', playerId: 0, spaceIndex: 31 });
    expect(hit.state.properties[31]!.level).toBe(1);
    expect(hit.state.properties[22]!.level).toBe(1);
  });

  it('a first bankruptcy finishes the round before the game ends (normal); easy ends at once', () => {
    const bust = (rules: 'easy' | 'normal') =>
      edit(game({ rules, n: 3 }), (st) => {
        own(st, 31, 2, 3);
        st.players[0]!.cash = 10;
        setupLanding(st, 0, 31, 5);
      });
    const easy = act(bust('easy'), roll(0)).state;
    expect(easy.phase.kind).toBe('gameOver');
    const normal = act(bust('normal'), roll(0));
    expect(ofType(normal.events, 'FinalRoundCalled')).toHaveLength(1);
    expect(normal.state.phase.kind).not.toBe('gameOver');
    expect(normal.state.endsAfterRound).toBe(true);
    // Seats 1 and 2 still play this round; the game ends when it wraps.
    let s = normal.state;
    for (let k = 0; k < 40 && s.phase.kind !== 'gameOver'; k++) s = act(s, chooseAction(s, s.phase.playerId)).state;
    expect(s.phase.kind).toBe('gameOver');
    expect(s.round).toBe(normal.state.round);
  });

  it('later seats start with a little more cash on normal', () => {
    const cash = (rules: 'easy' | 'normal') => createGame({ ...defaultSettings({ players: defaultPlayers(4) }), rules }, 1).players.map((p) => p.cash);
    expect(cash('easy')).toEqual([3000, 3000, 3000, 3000]);
    expect(cash('normal')).toEqual([3000, 3200, 3400, 3600]);
  });

  it('with a face-down card the CPU never peeks at it', () => {
    const offered = (hidden: CardId) =>
      act(edit(game({ rules: 'normal' }), (st) => {
        setupLanding(st, 0, ev, 5);
        queueCards(st, 'tax-refund', hidden);
      }), roll(0)).state;
    // The same known card leads to the same choice whatever is face down.
    expect(chooseAction(offered('lottery'), 0)).toEqual(chooseAction(offered('to-island'), 0));
  });

  it('a save taken while a grown hub toll is owed loads again', () => {
    // Hub growth counts the visit right after pricing; the save check must price it the same way.
    const base = defaultSettings();
    const settings = {
      // Rules version 1: the seeded line of play that reaches the debt (version 2 changes it).
      ...base, rulesVersion: 1, spacesPerSide: 7 as const, rules: 'advanced' as const, roundLimit: null, auction: true, takeover: false, buildAnywhere: false, endOnFirstBankruptcy: true, startCash: 2000,
      players: [{ ...base.players[0]!, isCpu: false }, { ...base.players[1]!, isCpu: true }],
    };
    let s = createGame(settings, 2);
    for (let i = 0; i <= 100; i++) {
      const ph = s.phase;
      if (ph.kind === 'gameOver') break;
      s = reduce(s, chooseAction(s, ph.playerId)).state;
    }
    expect(s.phase.kind).toBe('debt');
    expect(() => deserialize(serialize(s))).not.toThrow();
  });
});
