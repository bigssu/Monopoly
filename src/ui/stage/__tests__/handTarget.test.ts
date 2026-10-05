/**
 * The CPU hand presses the control each CPU decision maps to (src/ui/stage/handTarget.ts).
 * Every action the engine offers a CPU — and so every action `chooseAction` can produce — must
 * map to a prompt control or a board space, never silently to nothing.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  chooseAction,
  createGame,
  defaultPlayers,
  defaultSettings,
  legalActions,
  reduce,
  type Action,
  type ActionType,
  type GameState,
  type Phase,
  type Settings,
} from '@/engine';
import { controlSelector, cpuHandTarget } from '../handTarget';

const ALL_TYPES: readonly ActionType[] = [
  'Roll', 'PayBail', 'UseEscapeCard', 'ChooseTravel', 'Buy', 'Build', 'Takeover', 'SetFestival', 'FreeUpgrade',
  'Bid', 'SellBuilding', 'SellProperty', 'ChooseCard', 'UseCard', 'DoubleUpGuess', 'ChooseTarget', 'Pass',
];

/** Walk seeded all-CPU games; call `visit` with every decision state and the CPU's choice. */
function walk(settings: Settings, seeds: readonly number[], visit: (s: GameState, a: Action) => void, maxSteps = 4000): void {
  for (const seed of seeds) {
    let s = createGame(settings, seed);
    for (let n = 0; n < maxSteps && s.phase.kind !== 'gameOver'; n++) {
      const a = chooseAction(s, s.phase.playerId);
      visit(s, a);
      s = reduce(s, a).state;
    }
  }
}

const VARIANTS: Array<[string, Settings]> = [
  ['easy', defaultSettings({ players: defaultPlayers(4, { cpu: true }), rules: 'easy' })],
  ['normal + auction + build anywhere', defaultSettings({ players: defaultPlayers(4, { cpu: true }), rules: 'normal', auction: true, buildAnywhere: true })],
  ['advanced, 2 players, no round limit', defaultSettings({ players: defaultPlayers(2, { cpu: true }), rules: 'advanced', roundLimit: null, takeover: true })],
];

describe('cpuHandTarget', () => {
  it('maps every legal action of every decision in seeded CPU games to a control or a space', () => {
    const chosen = new Set<string>();
    const missing: string[] = [];
    for (const [name, settings] of VARIANTS) {
      walk(settings, [1, 7, 42, 2026], (s, a) => {
        chosen.add(`${s.phase.kind}:${a.type}`);
        for (const l of legalActions(s)) {
          const t = cpuHandTarget(s, l);
          if (t.kind === 'none') missing.push(`${name} ${s.phase.kind}:${l.type} (${t.reason})`);
        }
      });
    }
    expect(missing).toEqual([]);
    // The walk reached the decisions the hand is mostly seen on.
    for (const k of ['preRoll:Roll', 'buy:Buy', 'buy:Pass', 'build:Build', 'island:Roll', 'travel:ChooseTravel', 'festival:SetFestival']) {
      expect(chosen, k).toContain(k);
    }
  });

  it('gives the expected control per action', () => {
    const s = createGame(defaultSettings({ players: defaultPlayers(2, { cpu: true }) }), 3);
    const at = (phase: Phase): GameState => ({ ...s, phase });
    const pre = at({ kind: 'preRoll', playerId: 0, rollAgain: false });
    expect(cpuHandTarget(pre, { type: 'Roll', playerId: 0 })).toEqual({ kind: 'control', selector: '[data-action="Roll"]', space: null, hold: true });
    // Build anywhere has no button: the hand taps the city on the board.
    expect(cpuHandTarget(pre, { type: 'Build', playerId: 0, spaceIndex: 5 })).toEqual({ kind: 'space', space: 5, selector: null });

    const buy = at({ kind: 'buy', playerId: 0, spaceIndex: 3, price: 100 });
    expect(cpuHandTarget(buy, { type: 'Buy', playerId: 0 })).toEqual({ kind: 'control', selector: '[data-action="Buy"]', space: 3, hold: false });
    expect(cpuHandTarget(buy, { type: 'Pass', playerId: 0 })).toEqual({ kind: 'control', selector: '[data-action="Pass"]', space: 3, hold: false });

    const isl = at({ kind: 'island', playerId: 0, turnsLeft: 2, bail: 100, canPayBail: true, hasEscapeCard: true });
    expect(cpuHandTarget(isl, { type: 'Roll', playerId: 0 })).toMatchObject({ kind: 'control', hold: true });
    expect(cpuHandTarget(isl, { type: 'PayBail', playerId: 0 })).toMatchObject({ kind: 'control', selector: '[data-action="PayBail"]' });
    expect(cpuHandTarget(isl, { type: 'UseEscapeCard', playerId: 0 })).toMatchObject({ kind: 'control', selector: '[data-action="UseEscapeCard"]' });

    const travel = at({ kind: 'travel', playerId: 0, options: [4, 9] });
    expect(cpuHandTarget(travel, { type: 'ChooseTravel', playerId: 0, spaceIndex: 9 })).toEqual({ kind: 'space', space: 9, selector: '[data-action="ChooseTravel"][data-space="9"]' });
    expect(cpuHandTarget(travel, { type: 'Pass', playerId: 0 })).toMatchObject({ kind: 'control', selector: '[data-action="Pass"]' });

    const fest = at({ kind: 'festival', playerId: 0, options: [4] });
    expect(cpuHandTarget(fest, { type: 'SetFestival', playerId: 0, spaceIndex: 4 })).toMatchObject({ kind: 'space', space: 4 });

    const debt = at({ kind: 'debt', playerId: 0, amount: 500 } as Phase);
    expect(cpuHandTarget(debt, { type: 'SellBuilding', playerId: 0, spaceIndex: 6 })).toEqual({ kind: 'control', selector: '[data-action="SellBuilding"][data-space="6"]', space: 6, hold: false });

    const pick = at({ kind: 'cardChoice', playerId: 0, options: ['lottery', 'to-start'] } as Phase);
    expect(cpuHandTarget(pick, { type: 'ChooseCard', playerId: 0, cardId: 'to-start' })).toMatchObject({ selector: '[data-action="ChooseCard"][data-card="to-start"]' });
    const dbl = at({ kind: 'doubleUp', playerId: 0, shown: 3, stake: 100, wins: 0 } as Phase);
    expect(cpuHandTarget(dbl, { type: 'DoubleUpGuess', playerId: 0, guess: 'low' })).toMatchObject({ selector: '[data-action="DoubleUpGuess"][data-guess="low"]' });
  });

  it('answers none, with a reason, for an action the prompt has no control for', () => {
    const s = createGame(defaultSettings({ players: defaultPlayers(2, { cpu: true }) }), 3);
    const target: GameState = { ...s, phase: { kind: 'target', playerId: 0, options: [4] } as Phase };
    const t = cpuHandTarget(target, { type: 'Pass', playerId: 0 });
    expect(t.kind).toBe('none');
    expect(t.kind === 'none' && t.reason).toMatch(/Pass/);
    expect(cpuHandTarget({ ...s, phase: { kind: 'buy', playerId: 0, spaceIndex: 3, price: 1 } }, { type: 'Roll', playerId: 0 }).kind).toBe('none');
  });

  it('has a rule for every action type', () => {
    const s = createGame(defaultSettings({ players: defaultPlayers(2, { cpu: true }) }), 3);
    for (const type of ALL_TYPES) {
      // Never throws, whatever the phase.
      expect(() => cpuHandTarget(s, { type, playerId: 0, spaceIndex: 1, cardId: 'lottery', guess: 'high' } as Action)).not.toThrow();
    }
  });

  it('uses the data-* hooks the prompt buttons carry', () => {
    const src = readFileSync(new URL('../prompts.ts', import.meta.url), 'utf8');
    for (const attr of ['data-action', 'data-space', 'data-card', 'data-guess']) expect(src).toContain(`'${attr}'`);
    expect(controlSelector({ type: 'SellProperty', playerId: 1, spaceIndex: 12 })).toBe('[data-action="SellProperty"][data-space="12"]');
  });
});
