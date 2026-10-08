/**
 * Rules version 2 (docs/research/08-fun-analysis.md): lucky vault, news flash, comeback cards,
 * doubles bonus card, all or nothing, win-back — engine transitions, the CPU's use of each new
 * choice, and save compatibility (old saves keep the rules they started with).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMEBACK_CARD_IDS } from '../../content/cards';
import { chooseAction, cardValue } from '../ai';
import { ECONOMY } from '../economy';
import { createGame, deckFor, isComebackDraw, legalActions, reduce, swapOptions } from '../reducer';
import { nextBuildCost, propertyValue, round10, takeoverPrice, tollOf } from '../rules';
import { deserialize, serialize } from '../save';
import { RULES_VERSION, defaultPlayers, defaultSettings, ruleFlags } from '../settings';
import { simulateGame } from '../sim';
import type { GameState, NewsId, RuleLevel } from '../types';
import { act, edit, game, ofType, own, pass, queueCards, queueDice, queuePicks, roll, run, setupLanding, types } from './helpers';

const TAX = 23;
const EVENT = 3;
const v2 = (rules: RuleLevel = 'normal', n = 2) => game({ rules, rulesVersion: 2, n });

/** Advance the game to the start of `round` by ending turns with plain moves (no landing effects). */
function atRoundStart(s: GameState, round: number): GameState {
  return edit(s, (st) => {
    st.round = round - 1;
    st.current = st.players.length - 1;
    st.phase = { kind: 'preRoll', playerId: st.current, rollAgain: false };
  });
}

describe('rule flags (version 2)', () => {
  it('turns the fun rules on for normal / advanced games of version 2 only', () => {
    expect(defaultSettings().rulesVersion).toBe(RULES_VERSION);
    const on = { luckyVault: true, newsFlash: true, comebackCards: true, doublesCard: true, allOrNothing: true };
    expect(ruleFlags({ rules: 'normal', rulesVersion: 2 })).toMatchObject({ ...on, winBack: false });
    expect(ruleFlags({ rules: 'advanced', rulesVersion: 2 })).toMatchObject({ ...on, winBack: true });
    expect(ruleFlags({ rules: 'easy', rulesVersion: 2 })).toMatchObject({ luckyVault: false, newsFlash: false, comebackCards: false, doublesCard: false, allOrNothing: false, winBack: false });
    // A save from before (no version) keeps the rules it started with.
    expect(ruleFlags({ rules: 'advanced' })).toMatchObject({ luckyVault: false, newsFlash: false, winBack: false, hubGrowth: true });
  });

  it('keeps the original 24-card deck unless comeback cards are on', () => {
    expect(deckFor(defaultSettings({ rules: 'easy' }))).toHaveLength(24);
    expect(deckFor(defaultSettings({ rules: 'normal', rulesVersion: 1 }))).toHaveLength(24);
    expect(deckFor(defaultSettings({ rules: 'normal' })).map((c) => c.id).slice(-2)).toEqual(['swap', 'raid']);
  });
});

describe('lucky vault', () => {
  it('sends bail and card fines into the pot', () => {
    const s = edit(v2(), (st) => {
      st.players[0]!.position = 8;
      st.players[0]!.islandTurns = 2;
      st.phase = { kind: 'island', playerId: 0, turnsLeft: 2, bail: ECONOMY.bail, canPayBail: true, hasEscapeCard: false };
    });
    const r = act(s, { type: 'PayBail', playerId: 0 });
    expect(r.state.pot).toBe(ECONOMY.bail);
    const fine = edit(v2(), (st) => {
      setupLanding(st, 0, EVENT, 3);
      queueCards(st, 'fine', 'lottery');
    });
    const offered = act(fine, roll(0)).state;
    const chosen = act(offered, { type: 'ChooseCard', playerId: 0, cardId: 'fine' });
    expect(chosen.state.pot).toBe(150);
  });

  it('the bank adds to the pot at every round start (not in version 1)', () => {
    const s = edit(atRoundStart(v2(), 2), (st) => setupLanding(st, 1, 2, 4));
    const r = act(s, roll(1));
    // Round 2 starts after player 1's turn; player 1 lands on a city (a buy prompt) first.
    const end = act(r.state, pass(1));
    expect(ofType(end.events, 'RoundStarted')).toHaveLength(1);
    expect(end.state.pot).toBe(ECONOMY.vaultSeed);
    const old = edit(atRoundStart(game({ rules: 'normal', rulesVersion: 1 }), 2), (st) => setupLanding(st, 1, 2, 4));
    expect(act(act(old, roll(1)).state, pass(1)).state.pot).toBe(0);
  });
});

describe('news flash', () => {
  /** End player 1's turn so round `round` starts, with the news pick forced to `id`. */
  function newsRound(id: NewsId, round: number = ECONOMY.newsEvery, tweak: (st: GameState) => void = () => {}): { state: GameState; events: ReturnType<typeof run>['events'] } {
    const s = edit(atRoundStart(v2(), round), (st) => {
      setupLanding(st, 1, 2, 4);
      tweak(st);
      // The pick indexes the headlines that can run (a quake needs a building to hit).
      const hasBuilding = st.properties.some((pr) => pr && pr.level >= 1 && pr.level < 4);
      const order = NEWS_ORDER.filter((n) => n !== 'quake' || hasBuilding);
      st.testHooks = { ...st.testHooks, pickQueue: [order.indexOf(id), ...(st.testHooks?.pickQueue ?? [])] };
    });
    return run(s, roll(1), pass(1));
  }
  const NEWS_ORDER: NewsId[] = ['tollFever', 'quake', 'buildBoom', 'takeoverSale', 'shareDay', 'vaultBoom'];

  it('runs a headline every few rounds, for that round only', () => {
    const r = newsRound('tollFever');
    expect(ofType(r.events, 'NewsFlash')).toEqual([{ type: 'NewsFlash', id: 'tollFever', round: ECONOMY.newsEvery }]);
    const fever = edit(r.state, (st) => own(st, 31, 1, 1));
    const calm = edit(fever, (st) => (st.round += 1));
    expect(tollOf(fever, 31)).toBe(2 * tollOf(calm, 31));
    // Not in other rounds.
    expect(ofType(newsRound('tollFever', ECONOMY.newsEvery + 1).events, 'NewsFlash')).toHaveLength(0);
  });

  it('build boom halves build costs; takeover sale prices takeovers at 1.5×', () => {
    const boom = edit(newsRound('buildBoom').state, (st) => own(st, 31, 0, 1));
    expect(nextBuildCost(boom, 31)).toBe(round10(600 * ECONOMY.newsBuildRate)); // Seoul L2 costs 600
    const sale = edit(newsRound('takeoverSale').state, (st) => own(st, 31, 1, 1));
    expect(takeoverPrice(sale, 31)).toBe(round10(1.5 * propertyValue(sale, 31)));
  });

  it('a quake knocks a level off every building in one colour group (landmarks stand)', () => {
    const r = newsRound('quake', ECONOMY.newsEvery, (st) => {
      own(st, 19, 0, 2);
      own(st, 20, 1, 4);
      own(st, 22, 1, 1);
      queuePicks(st, 0); // the only group with buildings: red
    });
    expect(ofType(r.events, 'NewsFlash')[0]).toMatchObject({ id: 'quake', group: 'red' });
    expect(r.state.properties[19]!.level).toBe(1);
    expect(r.state.properties[20]!.level).toBe(4);
    expect(r.state.properties[22]!.level).toBe(0);
    expect(ofType(r.events, 'Demolished').map((e) => e.cause)).toEqual(['quake', 'quake']);
  });

  it('share day moves 10% of the leader’s cash to the last player; vault boom doubles the pot', () => {
    const share = newsRound('shareDay', ECONOMY.newsEvery, (st) => {
      st.players[0]!.cash = 5000;
      st.players[1]!.cash = 1000;
    });
    const m = ofType(share.events, 'MoneyChanged').filter((e) => e.reason === 'news');
    expect(m.map((e) => e.delta)).toEqual([-500, 500]);
    const boom = newsRound('vaultBoom', ECONOMY.newsEvery, (st) => (st.pot = 700));
    expect(boom.state.pot).toBe(2 * (700 + ECONOMY.vaultSeed));
  });

  it('does not repeat a headline until every one has run', () => {
    const seen: NewsId[] = [];
    let s = v2();
    for (let k = 1; k <= 6; k++) {
      const r = run(edit(atRoundStart(s, k * ECONOMY.newsEvery), (st) => setupLanding(st, 1, 2, 4)), roll(1), pass(1));
      seen.push(...ofType(r.events, 'NewsFlash').map((e) => e.id));
      s = r.state;
    }
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe('doubles bonus card', () => {
  it('draws an event card after a doubles landing, then rolls again', () => {
    const s = edit(v2(), (st) => {
      st.players[0]!.position = 0;
      queueDice(st, [1, 1]); // → 2 (a city: buy prompt)
      queueCards(st, 'tax-refund', 'bank-dividend');
    });
    const a = act(s, roll(0));
    expect(a.state.phase.kind).toBe('buy');
    const b = act(a.state, pass(0));
    expect(types(b.events)).toContain('BonusCard');
    expect(b.state.phase).toMatchObject({ kind: 'cardChoice', bonus: true });
    const c = act(b.state, { type: 'ChooseCard', playerId: 0, cardId: 'tax-refund' });
    expect(c.state.phase).toEqual({ kind: 'preRoll', playerId: 0, rollAgain: true });
    // The save round-trips at the bonus offer.
    expect(deserialize(serialize(b.state))).toEqual(b.state);
  });

  it('is one card per roll and never on easy', () => {
    const s = edit(game({ rules: 'easy', rulesVersion: RULES_VERSION }), (st) => queueDice(st, [1, 1]));
    const a = act(act(s, roll(0)).state, pass(0));
    expect(types(a.events)).not.toContain('BonusCard');
    expect(a.state.phase).toMatchObject({ kind: 'preRoll', rollAgain: true });
  });
});

describe('all or nothing (tax office)', () => {
  const atTax = (die?: number) =>
    edit(v2(), (st) => {
      st.players[0]!.cash = 2000;
      setupLanding(st, 0, TAX, 5);
      if (die !== undefined) queueDice(st, [die, 1]);
    });

  it('offers pay or roll; paying sends 10% of cash to the pot', () => {
    const a = act(atTax(), roll(0));
    expect(a.state.phase).toEqual({ kind: 'gamble', playerId: 0, tax: 200 });
    expect(legalActions(a.state).map((x) => x.type)).toEqual(['Gamble', 'Pass']);
    const paid = act(a.state, pass(0));
    expect(paid.state.players[0]!.cash).toBe(1800);
    expect(paid.state.pot).toBe(200);
  });

  it('4–6 pays nothing, 1–3 pays double', () => {
    const win = act(act(atTax(5), roll(0)).state, { type: 'Gamble', playerId: 0 });
    expect(ofType(win.events, 'Gambled')[0]).toMatchObject({ die: 5, win: true, paid: 0 });
    expect(win.state.players[0]!.cash).toBe(2000);
    const lose = act(act(atTax(2), roll(0)).state, { type: 'Gamble', playerId: 0 });
    expect(ofType(lose.events, 'Gambled')[0]).toMatchObject({ die: 2, win: false, paid: 400 });
    expect(lose.state.players[0]!.cash).toBe(1600);
    expect(lose.state.pot).toBe(400);
  });

  it('CPU: the leader pays, a trailing player with spare cash rolls', () => {
    const at = act(atTax(), roll(0)).state;
    const leading = edit(at, (st) => (st.players[1]!.cash = 100));
    expect(chooseAction(leading, 0).type).toBe('Pass');
    const behind = edit(at, (st) => own(st, 31, 1, 1));
    expect(chooseAction(behind, 0).type).toBe('Gamble');
  });
});

describe('comeback cards', () => {
  it('offers the last player a comeback card first', () => {
    const s = edit(v2(), (st) => {
      st.players[0]!.cash = 500;
      st.players[1]!.cash = 5000;
      setupLanding(st, 0, EVENT, 3);
    });
    expect(isComebackDraw(s, 0)).toBe(true);
    expect(isComebackDraw(s, 1)).toBe(false);
    const r = act(s, roll(0));
    expect(r.state.phase).toMatchObject({ kind: 'cardChoice', underdog: true });
    if (r.state.phase.kind !== 'cardChoice') throw new Error('no offer');
    expect(COMEBACK_CARD_IDS).toContain(r.state.phase.options[0]);
  });

  it('leader raid takes 20% of the richest player’s cash; no effect for the leader', () => {
    const s = edit(v2(), (st) => {
      st.players[0]!.cash = 1000;
      st.players[1]!.cash = 3000;
      setupLanding(st, 0, EVENT, 3);
      queueCards(st, 'raid', 'fine');
    });
    const r = run(s, roll(0), { type: 'ChooseCard', playerId: 0, cardId: 'raid' });
    expect(r.state.players.map((p) => p.cash)).toEqual([1600, 2400]);
    const lead = edit(s, (st) => (st.players[0]!.cash = 9000));
    expect(cardValue(lead, 0, 'raid')).toBeLessThan(0);
    const none = run(lead, roll(0), { type: 'ChooseCard', playerId: 0, cardId: 'raid' });
    expect(types(none.events)).toContain('CardNoEffect');
  });

  it('land swap trades the chosen city for your cheapest non-landmark city; a shield stops it', () => {
    const s = edit(v2(), (st) => {
      own(st, 1, 0, 1);
      own(st, 7, 0, 4);
      own(st, 31, 1, 2);
      own(st, 30, 1, 4);
      setupLanding(st, 0, EVENT, 3);
      queueCards(st, 'swap', 'fine');
    });
    const offer = run(s, roll(0), { type: 'ChooseCard', playerId: 0, cardId: 'swap' }).state;
    expect(offer.phase).toEqual({ kind: 'target', playerId: 0, card: 'swap', options: [31] });
    expect(swapOptions(offer, 0)).toEqual([31]);
    expect(deserialize(serialize(offer))).toEqual(offer);
    const done = act(offer, { type: 'ChooseTarget', playerId: 0, spaceIndex: 31 });
    expect(ofType(done.events, 'CitySwapped')).toEqual([{ type: 'CitySwapped', playerId: 0, ownerId: 1, took: 31, gave: 1 }]);
    expect([done.state.properties[31], done.state.properties[1]]).toEqual([{ owner: 0, level: 2 }, { owner: 1, level: 1 }]);
    // The CPU takes the better city; keeping is allowed.
    expect(chooseAction(offer, 0)).toEqual({ type: 'ChooseTarget', playerId: 0, spaceIndex: 31 });
    expect(act(offer, pass(0)).state.properties[31]!.owner).toBe(1);
    const shielded = edit(offer, (st) => st.players[1]!.cards.push('shield'));
    const blocked = act(shielded, { type: 'ChooseTarget', playerId: 0, spaceIndex: 31 });
    expect(types(blocked.events)).toContain('TakeoverBlocked');
    expect(blocked.state.properties[31]!.owner).toBe(1);
  });

  it('the CPU never swaps a city that hands the owner a winning set', () => {
    // Player 1 owns side D but Seoul; Seoul is all we could give, so taking Hanoi would hand them the line.
    const s = edit(v2(), (st) => {
      for (const i of [25, 26, 28, 30, 2]) own(st, i, 1, 1);
      own(st, 31, 0, 0);
      st.phase = { kind: 'target', playerId: 0, card: 'swap', options: [2, 25, 26, 28, 30] };
    });
    // A swap never decides the game: Hanoi (which would hand them the line) is not even offered.
    expect(swapOptions(s, 0)).toEqual([25, 26, 28, 30]);
    // Taking a side-D city breaks their line instead: fine. Hanoi alone: keep.
    expect(chooseAction(s, 0)).not.toEqual({ type: 'ChooseTarget', playerId: 0, spaceIndex: 2 });
    expect(chooseAction(edit(s, (st) => (st.phase = { kind: 'target', playerId: 0, card: 'swap', options: [2] })), 0)).toEqual(pass(0));
  });
});

describe('win-back (advanced)', () => {
  it('lets the player who lost a city take it back for 1× its value', () => {
    let s = edit(v2('advanced'), (st) => {
      own(st, 31, 1, 1);
      st.players[0]!.cash = 9000;
      setupLanding(st, 0, 31, 5);
    });
    s = act(s, roll(0)).state; // toll → takeover prompt
    expect(s.phase).toMatchObject({ kind: 'takeover', price: 2 * propertyValue(s, 31) });
    expect(s.phase).not.toHaveProperty('winBack');
    s = act(s, { type: 'Takeover', playerId: 0 }).state;
    expect(s.takenFrom?.[31]).toEqual({ from: 1, by: 0 });
    // Player 1 comes round to it.
    s = edit(s, (st) => {
      st.current = 1;
      st.players[1]!.cash = 9000;
      st.phase = { kind: 'preRoll', playerId: 1, rollAgain: false };
      st.extraRoll = false;
      setupLanding(st, 1, 31, 5);
    });
    s = act(s, roll(1)).state;
    expect(s.phase).toMatchObject({ kind: 'takeover', winBack: true, price: propertyValue(s, 31) });
    expect(deserialize(serialize(s))).toEqual(s);
    expect(chooseAction(s, 1).type).toBe('Takeover');
    const r = act(s, { type: 'Takeover', playerId: 1 });
    expect(ofType(r.events, 'TakenOver')[0]).toMatchObject({ winBack: true });
    expect(r.state.properties[31]!.owner).toBe(1);
    expect(r.state.takenFrom?.[31]).toBeUndefined();
  });

  it('is off on normal', () => {
    let s = edit(v2('normal'), (st) => {
      own(st, 31, 1, 1);
      st.players[0]!.cash = 9000;
      setupLanding(st, 0, 31, 5);
    });
    s = act(act(s, roll(0)).state, { type: 'Takeover', playerId: 0 }).state;
    expect(s.takenFrom).toBeUndefined();
  });
});

describe('save compatibility', () => {
  const files = JSON.parse(readFileSync(new URL('./fixtures/saves-2026-10-06.json', import.meta.url), 'utf8')) as Record<string, string>;
  /** Recorded with the code before rules version 2 (commit 1272ee6): the CPU plays on for 300 actions. */
  const EXPECTED: Record<string, object> = {
    'normal-4p-r9': { round: 15, turn: 60, rng: 2613459306, cash: [860, 0, 330, 3005], pot: 100, phase: 'gameOver' },
    'advanced-2p-r12': { round: 24, turn: 47, rng: 2805754340, cash: [0, 1250], pot: 0, phase: 'gameOver' },
    'easy-3p-r7': { round: 21, turn: 63, rng: 2567509490, cash: [2360, 740, 0], pot: 0, phase: 'gameOver' },
  };

  it.each(Object.keys(EXPECTED))('a save from before (%s) loads and plays on exactly as before', (name) => {
    let s = deserialize(files[name]!);
    expect(s.settings.rulesVersion).toBeUndefined();
    expect(ruleFlags(s.settings).newsFlash).toBe(false);
    for (let k = 0; k < 300 && s.phase.kind !== 'gameOver'; k++) s = reduce(s, chooseAction(s, s.phase.playerId)).state;
    expect({ round: s.round, turn: s.turn, rng: s.rng, cash: s.players.map((p) => p.cash), pot: s.pot, phase: s.phase.kind }).toEqual(EXPECTED[name]);
  });

  it('round-trips every phase a version-2 game reaches and rejects bad version-2 fields', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const settings = defaultSettings({ players: defaultPlayers(2 + (seed % 3), { cpu: true }), rules: seed % 2 ? 'normal' : 'advanced', roundLimit: 30 });
      let s = createGame(settings, seed);
      for (let k = 0; k < 4000 && s.phase.kind !== 'gameOver'; k++) {
        const kind = s.phase.kind === 'target' ? `target:${s.phase.card}` : s.phase.kind === 'cardChoice' && s.phase.bonus ? 'bonusCard' : s.phase.kind === 'takeover' && s.phase.winBack ? 'winBack' : s.phase.kind;
        if (!seen.has(kind)) {
          seen.add(kind);
          expect(deserialize(serialize(s)), kind).toEqual(s);
        }
        s = reduce(s, chooseAction(s, s.phase.playerId)).state;
      }
    }
    for (const k of ['gamble', 'bonusCard', 'target:swap']) expect(seen, k).toContain(k);
    const s = v2();
    const bad = (fn: (f: { state: Record<string, unknown> }) => void) => {
      const f = JSON.parse(serialize(s));
      fn(f);
      return () => deserialize(JSON.stringify(f));
    };
    expect(bad((f) => (f.state.news = { id: 'gala', round: 4 }))).toThrow();
    expect(bad((f) => (f.state.takenFrom = { 31: { from: 'x', by: 0 } }))).toThrow();
    expect(bad((f) => ((f.state.settings as Record<string, unknown>).rulesVersion = 99))).toThrow();
  });
});

describe('simulation', () => {
  it('version-2 games stay deterministic and always finish', () => {
    const settings = defaultSettings({ players: defaultPlayers(4, { cpu: true }), roundLimit: 30 });
    const a = simulateGame(settings, 77, { recordEvents: true });
    const b = simulateGame(settings, 77, { recordEvents: true });
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.timedOut).toBe(false);
    for (let seed = 1; seed <= 40; seed++) {
      const r = simulateGame({ ...settings, rules: seed % 2 ? 'normal' : 'advanced', players: defaultPlayers(2 + (seed % 3), { cpu: true }) }, seed);
      expect(r.timedOut).toBe(false);
    }
  });
});
