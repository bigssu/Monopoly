/**
 * Headless simulation: CPU players play a whole game. Used by scripts/balance.ts,
 * the fuzz tests and the placeholder main.ts.
 */
import { chooseAction } from './ai';
import { createGame, reduce } from './reducer';
import { ranking, totalAssets } from './rules';
import type { GameEvent, GameState, PlayerId, Settings, VictoryKind } from './types';

export interface SimOptions {
  /** Hard stop (actions). Default 20,000. */
  maxSteps?: number;
  /** Keep every event (for determinism tests / replays). Default false. */
  recordEvents?: boolean;
  /** Invariant checks after every step (no negative cash, etc.). Default true. */
  checkInvariants?: boolean;
}

export interface SimBankruptcy {
  playerId: PlayerId;
  round: number;
  creditorId: PlayerId | null;
}

export interface SimResult {
  seed: number;
  /** Round in which the game ended. */
  rounds: number;
  turns: number;
  steps: number;
  /** True if `maxSteps` was hit before the game ended. */
  timedOut: boolean;
  winnerId: PlayerId | null;
  victory: VictoryKind | null;
  bankruptcies: SimBankruptcy[];
  /** Final total assets (cash + property values) per player id. */
  finalAssets: number[];
  finalCash: number[];
  /** Player ids in final ranking order. */
  ranking: PlayerId[];
  finalState: GameState;
  events?: GameEvent[];
  eventCount: number;
}

export function simulateGame(settings: Settings, seed: number, opts: SimOptions = {}): SimResult {
  const maxSteps = opts.maxSteps ?? 20_000;
  const check = opts.checkInvariants ?? true;
  let state = createGame(settings, seed);
  const events: GameEvent[] = [];
  const bankruptcies: SimBankruptcy[] = [];
  let eventCount = 0;
  let steps = 0;
  while (state.phase.kind !== 'gameOver' && steps < maxSteps) {
    const action = chooseAction(state, state.phase.playerId);
    const res = reduce(state, action);
    state = res.state;
    steps++;
    eventCount += res.events.length;
    for (const e of res.events) {
      if (e.type === 'Bankrupt') bankruptcies.push({ playerId: e.playerId, round: e.round, creditorId: e.creditorId });
    }
    if (opts.recordEvents) events.push(...res.events);
    if (check) assertInvariants(state);
  }
  const over = state.phase.kind === 'gameOver' ? state.phase.result : null;
  const result: SimResult = {
    seed,
    rounds: state.round,
    turns: state.turn,
    steps,
    timedOut: over === null,
    winnerId: over?.winnerId ?? null,
    victory: over?.victory ?? null,
    bankruptcies,
    finalAssets: state.players.map((p) => totalAssets(state, p.id)),
    finalCash: state.players.map((p) => p.cash),
    ranking: (over?.ranking ?? ranking(state)).map((r) => r.playerId),
    finalState: state,
    eventCount,
  };
  if (opts.recordEvents) result.events = events;
  return result;
}

export function assertInvariants(state: GameState): void {
  for (const p of state.players) {
    if (!Number.isInteger(p.cash) || p.cash < 0) throw new Error(`Invariant: player ${p.id} cash ${p.cash}`);
    if (p.bankrupt && state.properties.some((pr) => pr?.owner === p.id)) {
      throw new Error(`Invariant: bankrupt player ${p.id} still owns property`);
    }
    if (p.position < 0 || p.position >= 32) throw new Error(`Invariant: bad position ${p.position}`);
  }
  if (!Number.isInteger(state.pot) || state.pot < 0) throw new Error(`Invariant: pot ${state.pot}`);
  if (state.festival !== null) {
    const pr = state.properties[state.festival];
    if (!pr || pr.owner === null) throw new Error('Invariant: festival marker on an unowned space');
  }
  for (const pr of state.properties) {
    if (pr && pr.owner === null && pr.level !== 0) throw new Error('Invariant: unowned property with buildings');
  }
}
