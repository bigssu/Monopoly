/**
 * Rules version 3 (docs/research/10-strategy-depth.md, 11-skill-throw.md): the strategy package of
 * the 'advanced' level (전략 모드). 'normal' (캐주얼 모드) plays exactly as version 2.
 */
import { describe, expect, it } from 'vitest';
import { chooseAction, chooseRoll, cpuAccuracy, throwDistribution } from '../ai';
import { SKILL_BANDS, SKILL_CAP } from '../economy';
import { createGame, gaugeRoll, isLegal, legalActions, reduce, skilledRoll } from '../reducer';
import { createRng, rollDice, seedToState } from '../rng';
import { deserialize, serialize, SaveError } from '../save';
import { RULES_VERSION, defaultPlayers, defaultSettings, ruleFlags } from '../settings';
import { simulateGame } from '../sim';
import type { Action, GameEvent, GameState, RuleLevel } from '../types';
import { edit, game, own, queueDice, roll } from './helpers';

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
