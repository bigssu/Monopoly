/**
 * Rules version 3 (docs/research/10-strategy-depth.md, 11-skill-throw.md): the strategy package of
 * the 'advanced' level (전략 모드). 'normal' (캐주얼 모드) plays exactly as version 2.
 */
import { describe, expect, it } from 'vitest';
import { chooseAction, chooseRoll, cpuAccuracy, throwDistribution } from '../ai';
import { ECONOMY, SKILL_BANDS, SKILL_CAP } from '../economy';
import { counterbuyOptions, counterbuyPrice, createGame, gaugeRoll, isLegal, legalActions, reduce, skilledRoll } from '../reducer';
import { chaseMultiplier, round10, takeoverPrice, takeoverTerms, valueOf } from '../rules';
import { createRng, rollDice, seedToState } from '../rng';
import { deserialize, serialize, SaveError } from '../save';
import { RULES_VERSION, defaultPlayers, defaultSettings, ruleFlags } from '../settings';
import { simulateGame } from '../sim';
import type { Action, GameEvent, GameState, RuleLevel } from '../types';
import { buy, edit, game, ofType, own, pass, queueDice, roll, run } from './helpers';

const v3 = (rules: RuleLevel = 'advanced', n = 2, seed = 1) => game({ rules, rulesVersion: 3, n, seed });
const dice = (events: GameEvent[]) => events.find((e) => e.type === 'DiceRolled') as Extract<GameEvent, { type: 'DiceRolled' }>;

describe('rules version 3 flags', () => {
  it('is the current version and turns the strategy package on for advanced only', () => {
    expect(RULES_VERSION).toBe(3);
    expect(ruleFlags({ rules: 'advanced', rulesVersion: 3 })).toMatchObject({ strideChoice: true, skillThrow: true, diceGauge: false, winBack: true });
    expect(ruleFlags({ rules: 'normal', rulesVersion: 3 })).toMatchObject({ strideChoice: false, skillThrow: false, diceGauge: false });
    expect(ruleFlags({ rules: 'normal', rulesVersion: 3 })).toEqual(ruleFlags({ rules: 'normal', rulesVersion: 2 }));
    expect(ruleFlags({ rules: 'easy', rulesVersion: 3 })).toEqual(ruleFlags({ rules: 'easy', rulesVersion: 2 }));
    // Version 2 advanced keeps the B7 gauge.
    expect(ruleFlags({ rules: 'advanced', rulesVersion: 2 })).toMatchObject({ strideChoice: false, skillThrow: false, diceGauge: true });
  });
});

describe('stride choice and the skill throw', () => {
  const freq = (stride: 1 | 2, aim: 'low' | 'high' | undefined, accuracy: number, n = 40000) => {
    const rng = createRng(seedToState(42));
    const hist = new Array(13).fill(0) as number[];
    let assisted = 0;
    for (let i = 0; i < n; i++) {
      const r = skilledRoll(rng, stride, aim, accuracy);
      hist[stride === 1 ? r.dice[0] : r.dice[0] + r.dice[1]]!++;
      if (r.assisted) assisted++;
      if (stride === 1) expect(r.dice[1]).toBe(0);
    }
    return { p: hist.map((h) => h / n), assisted: assisted / n };
  };
  const band = (p: number[], [lo, hi]: readonly [number, number]) => p.slice(lo, hi + 1).reduce((a, b) => a + b, 0);

  it('a perfect throw lands in the aimed band about cap + (1 − cap) × natural of the time', () => {
    expect(SKILL_CAP).toBe(0.6);
    const two = freq(2, 'low', 1);
    expect(band(two.p, SKILL_BANDS[2].low)).toBeCloseTo(0.6 + 0.4 * (10 / 36), 1.6);
    expect(two.assisted).toBeCloseTo(0.6, 1.6);
    const high = freq(2, 'high', 1);
    expect(band(high.p, SKILL_BANDS[2].high)).toBeCloseTo(0.6 + 0.4 * (10 / 36), 1.6);
    const one = freq(1, 'low', 1);
    expect(band(one.p, SKILL_BANDS[1].low)).toBeCloseTo(0.6 + 0.4 / 3, 1.6);
    // Inside the band the natural proportions hold (4 is three times as likely as 2).
    expect(two.p[4]! / two.p[2]!).toBeCloseTo(3, 0);
    // Matches the analytic distribution the CPU plans with.
    const plan = throwDistribution(2, 'low', SKILL_CAP);
    for (let t = 2; t <= 12; t++) expect(two.p[t]!).toBeCloseTo(plan[t]!, 1.7);
  });

  it('no aim or accuracy 0 is a natural roll that draws nothing extra', () => {
    for (const [aim, acc] of [[undefined, 1], ['low', 0]] as const) {
      const a = createRng(seedToState(9));
      const b = createRng(seedToState(9));
      expect(skilledRoll(a, 2, aim, acc)).toEqual({ dice: rollDice(b), assisted: false });
      expect(a.state).toBe(b.state);
    }
    // Accuracy is clamped to 0..1.
    expect(freq(2, 'high', 5, 4000).assisted).toBeLessThanOrEqual(0.7);
  });

  it('one die never makes doubles: no extra roll, no bonus card', () => {
    const s = edit(v3(), (st) => queueDice(st, [3, 3]));
    const r = reduce(s, { type: 'Roll', playerId: 0, stride: 1 });
    const e = dice(r.events);
    expect(e).toMatchObject({ dice: [3, 0], total: 3, isDouble: false, steps: 3, stride: 1, assisted: false });
    expect(r.state.lastDice).toEqual([3, 0]);
    expect(r.state.players[0]!.position).toBe(3);
    expect(r.state.extraRoll).toBe(false);
    expect(r.events.some((ev) => ev.type === 'BonusCard')).toBe(false);
  });

  it('reports stride, aim, accuracy and whether the assist decided the roll', () => {
    const r = reduce(v3(), { type: 'Roll', playerId: 0, stride: 2, aim: 'high', accuracy: 0.92 });
    const e = dice(r.events);
    expect(e).toMatchObject({ stride: 2, aim: 'high', accuracy: 0.92 });
    expect(typeof e.assisted).toBe('boolean');
    // Aim on version 2 (or casual) is ignored, and the event keeps its old shape.
    const old = reduce(game({ rules: 'advanced', rulesVersion: 2 }), { type: 'Roll', playerId: 0, stride: 1, aim: 'low', accuracy: 1 });
    expect(Object.keys(dice(old.events))).not.toContain('stride');
    expect(dice(old.events).dice[1]).toBeGreaterThan(0);
    const casual = reduce(v3('normal'), { type: 'Roll', playerId: 0, stride: 1, aim: 'low', accuracy: 1 });
    expect(dice(casual.events)).toEqual(dice(reduce(v3('normal'), roll(0)).events));
  });

  it('ignores the gauge from version 3; version 2 advanced keeps it', () => {
    const g3 = reduce(v3('advanced', 2, 5), { type: 'Roll', playerId: 0, gauge: 1 }).state.lastDice;
    expect(g3).toEqual(reduce(v3('advanced', 2, 5), roll(0)).state.lastDice);
    const s2 = game({ rules: 'advanced', rulesVersion: 2, seed: 5 });
    const rng = createRng(s2.rng);
    const expected = gaugeRoll(rng, 1, rollDice(rng));
    expect(reduce(s2, { type: 'Roll', playerId: 0, gauge: 1 }).state.lastDice).toEqual(expected);
  });

  it('the island escape roll is always two natural dice', () => {
    const s = edit(v3(), (st) => {
      st.players[0]!.position = 8;
      st.players[0]!.islandTurns = 2;
      st.phase = { kind: 'island', playerId: 0, turnsLeft: 2, bail: 200, canPayBail: true, hasEscapeCard: false };
      queueDice(st, [4, 4]);
    });
    const r = reduce(s, { type: 'Roll', playerId: 0, stride: 1, aim: 'low', accuracy: 1 });
    expect(dice(r.events)).toMatchObject({ dice: [4, 4], isDouble: true, stride: 2, assisted: false, context: 'island' });
    expect(dice(r.events).aim).toBeUndefined();
  });

  it('offers every stride × aim before rolling; any accuracy is legal, malformed rolls are not', () => {
    const s = v3();
    expect(legalActions(s)).toHaveLength(6);
    expect(legalActions(game({ rules: 'normal', rulesVersion: 3 }))).toEqual([roll(0)]);
    expect(isLegal(s, { type: 'Roll', playerId: 0, stride: 1, aim: 'low', accuracy: 0.37 })).toBe(true);
    expect(isLegal(s, { type: 'Roll', playerId: 0 })).toBe(true);
    expect(isLegal(s, { type: 'Roll', playerId: 0, stride: 3 } as unknown as Action)).toBe(false);
    expect(isLegal(s, { type: 'Roll', playerId: 0, accuracy: Number.NaN })).toBe(false);
    expect(isLegal(s, { type: 'Roll', playerId: 1 })).toBe(false);
  });

  it('a one-die roll saves and loads on version 3 only', () => {
    const r = reduce(edit(v3(), (st) => queueDice(st, [5, 2])), { type: 'Roll', playerId: 0, stride: 1 }).state;
    expect(deserialize(serialize(r))).toEqual(r);
    const old = JSON.parse(serialize(game({ rules: 'advanced', rulesVersion: 2 })));
    old.state.lastDice = [5, 0];
    expect(() => deserialize(JSON.stringify(old))).toThrow(SaveError);
  });
});

describe('CPU stride and aim', () => {
  const cpuGame = (fn: (s: GameState) => void) => edit(createGame(defaultSettings({ players: defaultPlayers(2, { cpu: true }), rules: 'advanced' }), 3), fn);

  it('steps short of a row of expensive hotels just ahead', () => {
    // Opponent landmarks on 6, 7, 9, 10: the commonest two-dice totals from Start.
    const s = cpuGame((st) => {
      for (const i of [6, 7, 9, 10, 12]) own(st, i, 1, 4);
    });
    const a = chooseRoll(s, 0) as Extract<Action, { type: 'Roll' }>;
    expect(a.stride === 1 || a.aim !== undefined).toBe(true);
    expect(a.accuracy).toBeGreaterThanOrEqual(0);
    expect(a.accuracy).toBeLessThanOrEqual(1);
  });

  it('aims for a set-completing city within one die, and rolls plain on an empty board', () => {
    const s = cpuGame((st) => {
      own(st, 1, 0);
      st.players[0]!.position = 0;
    });
    // Brown = 1, 2: the CPU owns 1, so 2 completes the group (one die, low band).
    const a = chooseRoll(s, 0) as Extract<Action, { type: 'Roll' }>;
    expect(a).toMatchObject({ stride: 1, aim: 'low' });
    const plain = chooseRoll(cpuGame(() => {}), 0) as Extract<Action, { type: 'Roll' }>;
    expect(plain.stride).toBe(2);
  });

  it('samples accuracy per level from the seeded state, deterministically', () => {
    const accs = { easy: [] as number[], normal: [] as number[] };
    for (let seed = 1; seed <= 400; seed++) {
      for (const level of ['easy', 'normal'] as const) {
        const players = defaultPlayers(2, { cpu: true, cpuLevel: level });
        const s = createGame(defaultSettings({ players, rules: 'advanced' }), seed);
        const a = cpuAccuracy(s, 0);
        expect(cpuAccuracy(s, 0)).toBe(a);
        accs[level].push(a);
      }
    }
    const mean = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length;
    expect(mean(accs.normal)).toBeCloseTo(0.55, 1);
    expect(mean(accs.easy)).toBeCloseTo(0.25, 1);
    expect(Math.max(...accs.easy)).toBeLessThanOrEqual(0.5);
  });

  it('chooseAction stays pure and version-3 games are deterministic and always finish', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const settings = defaultSettings({ players: defaultPlayers(2 + (seed % 3), { cpu: true }), rules: 'advanced', roundLimit: 30 });
      const a = simulateGame(settings, seed);
      const b = simulateGame(settings, seed);
      expect(a.timedOut).toBe(false);
      expect(b.finalState).toEqual(a.finalState);
    }
    const s = createGame(defaultSettings({ players: defaultPlayers(2, { cpu: true }), rules: 'advanced' }), 4);
    const copy = JSON.stringify(s);
    expect(chooseAction(s, 0)).toEqual(chooseAction(s, 0));
    expect(JSON.stringify(s)).toBe(copy);
  });
});

// ---------------------------------------------------------------------------
// Start investment, monopoly notice + block-buy, chase takeover, news forecast, vault cap
// ---------------------------------------------------------------------------

/** End player 1's turn (a plain move onto an empty city) so `round` starts. */
function toRoundStart(s: GameState, round: number, tweak: (st: GameState) => void = () => {}): GameState {
  return edit(s, (st) => {
    st.round = round - 1;
    st.current = st.players.length - 1;
    st.phase = { kind: 'preRoll', playerId: st.current, rollAgain: false };
    st.players[st.current]!.position = 12;
    queueDice(st, [1, 2]);
    tweak(st);
  });
}

describe('start investment', () => {
  const atStart = (rules: RuleLevel = 'advanced') =>
    edit(v3(rules), (st) => {
      own(st, 4, 0);
      own(st, 31, 0, 3);
      st.players[0]!.position = 28;
      queueDice(st, [2, 4]);
    });

  it('passing Start offers one city a level at the build cost; a hotel needs a visit to go further', () => {
    // Passes Start onto the empty city 2 (declines it), then the offer.
    const r = run(atStart(), { type: 'Roll', playerId: 0, stride: 2 }, pass(0));
    expect(r.state.phase).toEqual({ kind: 'invest', playerId: 0, options: [4], then: 'landing' });
    const cash = r.state.players[0]!.cash;
    const done = reduce(r.state, { type: 'Invest', playerId: 0, spaceIndex: 4 });
    expect(done.events).toContainEqual({ type: 'Built', playerId: 0, spaceIndex: 4, level: 1, cost: 80, free: false, via: 'invest' });
    expect(done.state.players[0]!.cash).toBe(cash - 80);
    expect(done.events.some((e) => e.type === 'TurnEnded')).toBe(true);
    // Pass keeps the money; casual mode never asks.
    const skip = reduce(r.state, { type: 'Pass', playerId: 0 });
    expect(skip.state.properties[4]!.level).toBe(0);
    expect(skip.state.players[0]!.cash).toBe(cash);
    expect(run(atStart('normal'), roll(0), pass(0)).state.phase.kind).not.toBe('invest');
  });

  it('a move that ends on the island still gets its investment before the turn ends', () => {
    const s = edit(v3(), (st) => {
      own(st, 4, 0);
      st.players[0]!.position = 30;
      queueDice(st, [4, 6]);
    });
    const r = reduce(s, roll(0));
    expect(r.state.players[0]!.islandTurns).toBeGreaterThan(0);
    expect(r.state.phase).toMatchObject({ kind: 'invest', then: 'turn' });
    expect(deserialize(serialize(r.state))).toEqual(r.state);
    const next = reduce(r.state, { type: 'Invest', playerId: 0, spaceIndex: 4 });
    expect(next.state.current).toBe(1);
  });

  it('the CPU invests where opponents are likely to land, keeping a reserve', () => {
    const s = edit(createGame(defaultSettings({ players: defaultPlayers(2, { cpu: true }), rules: 'advanced' }), 2), (st) => {
      own(st, 1, 0);
      own(st, 14, 0);
      st.players[1]!.position = 7; // 14 is 7 away: the commonest roll
      st.phase = { kind: 'invest', playerId: 0, options: [1, 14], then: 'landing' };
    });
    expect(chooseAction(s, 0)).toEqual({ type: 'Invest', playerId: 0, spaceIndex: 14 });
    const poor = edit(s, (st) => (st.players[0]!.cash = 100));
    expect(chooseAction(poor, 0)).toEqual({ type: 'Pass', playerId: 0 });
  });
});

describe('monopoly notice and block-buy', () => {
  /** Player 0 holds side A but city 2 and lands on it with one die. */
  const completing = (rules: RuleLevel = 'advanced') =>
    edit(v3(rules), (st) => {
      for (const i of [1, 4, 6, 7]) own(st, i, 0);
      st.players[0]!.position = 0;
      queueDice(st, [2, 1]);
    });
  const announce = () => run(completing(), { type: 'Roll', playerId: 0, stride: 1 }, buy(0));

  it('completing a set announces it instead of winning; the owner wins at their next turn if it stands', () => {
    const r = announce();
    expect(r.state.phase.kind).not.toBe('gameOver');
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'MonopolyNotice', playerId: 0, victory: 'line', side: 'A', members: [1, 2, 4, 6, 7] }));
    expect(r.state.pendingWins).toEqual([{ playerId: 0, victory: 'line', side: 'A', members: [1, 2, 4, 6, 7], round: 1, blocked: [] }]);
    expect(deserialize(serialize(r.state))).toEqual(r.state);
    // Player 1 does not answer: at player 0's next turn the line wins.
    let s = r.state.phase.kind === 'build' ? reduce(r.state, pass(0)).state : r.state;
    s = edit(s, (st) => {
      st.players[1]!.position = 12;
      queueDice(st, [1, 2]);
    });
    const end = run(s, roll(1), pass(1));
    expect(end.state.phase).toMatchObject({ kind: 'gameOver', result: { winnerId: 0, victory: 'line', side: 'A' } });
  });

  it('casual mode still wins at once', () => {
    const r = run(edit(completing('normal'), (st) => (st.testHooks = { diceQueue: [[1, 1]] })), roll(0), buy(0));
    expect(r.state.phase).toMatchObject({ kind: 'gameOver', result: { winnerId: 0, victory: 'line' } });
  });

  /** Player 1 to move, facing player 0's notice. */
  const facing = () => {
    const r = announce();
    let s = r.state.phase.kind === 'build' ? reduce(r.state, pass(0)).state : r.state;
    expect(s.phase).toMatchObject({ kind: 'preRoll', playerId: 1 });
    s = edit(s, (st) => (st.players[1]!.cash = 5000));
    return s;
  };

  it('each opponent may block-buy one non-landmark city of the set from anywhere, once', () => {
    const s = edit(facing(), (st) => (st.properties[7]!.level = 4));
    const blocks = legalActions(s).filter((a) => a.type === 'Counterbuy').map((a) => (a as { spaceIndex: number }).spaceIndex);
    expect(blocks).toEqual([1, 2, 4, 6]);
    const price = counterbuyPrice(s, 1, 1);
    expect(price).toBe(takeoverPrice(s, 1, 1) + round10(ECONOMY.blockSurcharge * 100));
    const before = s.players.map((p) => p.cash);
    const r = reduce(s, { type: 'Counterbuy', playerId: 1, spaceIndex: 1 });
    expect(r.events).toContainEqual(expect.objectContaining({ type: 'TakenOver', buyerId: 1, sellerId: 0, spaceIndex: 1, price, block: true, why: 'chase' }));
    expect(r.events).toContainEqual({ type: 'MonopolyBroken', playerId: 0, by: 1 });
    expect(r.state.pendingWins).toBeUndefined();
    expect(r.state.properties[1]!.owner).toBe(1);
    expect(r.state.players[1]!.cash).toBe(before[1]! - price);
    expect(r.state.players[0]!.cash).toBe(before[0]! + price);
    expect(r.state.phase).toEqual({ kind: 'preRoll', playerId: 1, rollAgain: false });
  });

  it('a guard shield stops it (and uses up the answer); the owner cannot block-buy their own set', () => {
    const s = edit(facing(), (st) => st.players[0]!.cards.push('shield'));
    const r = reduce(s, { type: 'Counterbuy', playerId: 1, spaceIndex: 2 });
    expect(r.events).toContainEqual({ type: 'TakeoverBlocked', buyerId: 1, ownerId: 0, spaceIndex: 2, block: true });
    expect(r.state.players[0]!.cards).not.toContain('shield');
    expect(r.state.pendingWins?.[0]?.blocked).toEqual([1]);
    expect(legalActions(r.state).some((a) => a.type === 'Counterbuy')).toBe(false);
    expect(counterbuyOptions(r.state, 0)).toEqual([]);
  });

  it('is open on the island too, and the CPU blocks a win it can afford', () => {
    const s = edit(facing(), (st) => {
      st.players[1]!.position = 8;
      st.players[1]!.islandTurns = 2;
      st.phase = { kind: 'island', playerId: 1, turnsLeft: 2, bail: 200, canPayBail: true, hasEscapeCard: false };
    });
    expect(legalActions(s).some((a) => a.type === 'Counterbuy')).toBe(true);
    const a = chooseAction(s, 1);
    expect(a.type).toBe('Counterbuy');
    const r = reduce(s, a);
    expect(r.state.phase).toMatchObject({ kind: 'island', playerId: 1 });
    const broke = edit(s, (st) => (st.players[1]!.cash = 100));
    expect(chooseAction(broke, 1).type).not.toBe('Counterbuy');
  });
});

describe('chase takeover', () => {
  const at = (buyerCash: number, ownerCash: number) =>
    edit(v3(), (st) => {
      own(st, 9, 1, 1);
      st.players[0]!.cash = buyerCash;
      st.players[1]!.cash = ownerCash;
    });

  it('prices a takeover 1.5× … 2.5× by the buyer / owner asset ratio, with the reason', () => {
    const v = valueOf(9, 1);
    const ownerAssets = 3000 + v;
    expect(takeoverTerms(at(ownerAssets, 3000), 9, 0)).toEqual({ multiplier: 2, why: 'chase' });
    expect(takeoverTerms(at(ownerAssets / 2, 3000), 9, 0)).toEqual({ multiplier: 1.5, why: 'chase' });
    expect(takeoverTerms(at(ownerAssets * 4, 3000), 9, 0)).toEqual({ multiplier: 2.5, why: 'chase' });
    expect(takeoverPrice(at(ownerAssets / 2, 3000), 9, 0)).toBe(round10(1.5 * v));
    expect(chaseMultiplier(at(Math.round(ownerAssets / Math.SQRT2), 3000), 0, 1)).toBe(1.8);
    // Casual mode: the old 2×, no reason shown.
    const casual = edit(v3('normal'), (st) => own(st, 9, 1, 1));
    expect(takeoverTerms(casual, 9, 0)).toEqual({ multiplier: 2 });
    expect(takeoverPrice(casual, 9, 0)).toBe(2 * v);
  });

  it('the takeover prompt shows the multiplier; win-back stays 1×', () => {
    const s = edit(at(1500, 3000), (st) => {
      st.players[0]!.position = 4;
      queueDice(st, [2, 3]);
    });
    const r = reduce(s, roll(0));
    expect(r.state.phase).toMatchObject({ kind: 'takeover', multiplier: 1.5, why: 'chase' });
    expect(deserialize(serialize(r.state))).toEqual(r.state);
    const wb = edit(at(1500, 3000), (st) => (st.takenFrom = { 9: { from: 0, by: 1 } }));
    expect(takeoverTerms(wb, 9, 0)).toEqual({ multiplier: 1, why: 'winBack' });
  });
});

describe('news forecast and vault cap', () => {
  it('announces the headline a round early, then runs it', () => {
    const fore = run(toRoundStart(v3(), ECONOMY.newsEvery - 1, (st) => (st.testHooks = { ...st.testHooks, pickQueue: [0] })), roll(1), pass(1));
    expect(ofType(fore.events, 'NewsForecast')).toEqual([{ type: 'NewsForecast', id: 'tollFever', round: ECONOMY.newsEvery }]);
    expect(ofType(fore.events, 'NewsFlash')).toEqual([]);
    expect(fore.state.newsForecast).toEqual({ id: 'tollFever', round: ECONOMY.newsEvery });
    expect(deserialize(serialize(fore.state))).toEqual(fore.state);
    const due = run(toRoundStart(fore.state, ECONOMY.newsEvery), roll(1), pass(1));
    expect(ofType(due.events, 'NewsFlash')).toEqual([{ type: 'NewsFlash', id: 'tollFever', round: ECONOMY.newsEvery }]);
    expect(due.state.newsForecast).toBeUndefined();
    // Casual: no forecast.
    const casual = run(toRoundStart(v3('normal'), ECONOMY.newsEvery - 1), roll(1), pass(1));
    expect(ofType(casual.events, 'NewsForecast')).toEqual([]);
  });

  it('the vault stops at its cap and the bank adds less', () => {
    const s = edit(toRoundStart(v3(), 2), (st) => (st.pot = ECONOMY.vaultCap - 5));
    expect(run(s, roll(1), pass(1)).state.pot).toBe(ECONOMY.vaultCap);
    expect(run(toRoundStart(v3(), 2), roll(1), pass(1)).state.pot).toBe(ECONOMY.vaultSeedCapped);
    expect(run(toRoundStart(v3('normal'), 2), roll(1), pass(1)).state.pot).toBe(ECONOMY.vaultSeed);
  });
});

describe('the land-swap line win in 4p (research 10 diagnosis)', () => {
  it('was a bankruptcy transfer, not the swap: seed 352 ends on a line the creditor completes with the bankrupt player’s city', () => {
    let s = createGame({ ...defaultSettings(), players: defaultPlayers(4, { cpu: true }), roundLimit: 30, rules: 'normal', rulesVersion: 2 }, 352);
    let last: GameEvent[] = [];
    while (s.phase.kind !== 'gameOver') {
      const r = reduce(s, chooseAction(s, s.phase.playerId));
      // A swap never completes a set for either side.
      if (r.events.some((e) => e.type === 'CitySwapped')) expect(r.events.some((e) => e.type === 'GameOver')).toBe(false);
      last = r.events;
      s = r.state;
    }
    expect(s.phase.result).toMatchObject({ winnerId: 3, victory: 'line', side: 'C', round: 22 });
    expect(last.some((e) => e.type === 'CitySwapped')).toBe(false);
    expect(last).toContainEqual({ type: 'Bankrupt', playerId: 1, creditorId: 3, round: 22 });
    expect(last).toContainEqual({ type: 'PropertyTransferred', spaceIndex: 19, from: 1, to: 3, level: 1 });
  });
});

describe('strategy-mode fuzz', () => {
  it('2–4 player games with every rule (and no round limit) finish without errors, and save / load anywhere', () => {
    for (let seed = 1; seed <= 24; seed++) {
      const n = 2 + (seed % 3);
      const settings = defaultSettings({ players: defaultPlayers(n, { cpu: true }), rules: 'advanced', roundLimit: seed % 4 === 0 ? null : 30, endOnFirstBankruptcy: seed % 5 !== 0 });
      const r = simulateGame(settings, seed, { maxSteps: 60_000, checkInvariants: true, recordEvents: false });
      expect(r.timedOut, `seed ${seed}`).toBe(false);
      expect(r.victory).not.toBeNull();
    }
    let s = createGame(defaultSettings({ players: defaultPlayers(3, { cpu: true }), rules: 'advanced', roundLimit: 30 }), 99);
    for (let k = 0; s.phase.kind !== 'gameOver' && k < 4000; k++) {
      if (k % 7 === 0) expect(deserialize(serialize(s))).toEqual(s);
      s = reduce(s, chooseAction(s, s.phase.playerId)).state;
    }
  });
});
